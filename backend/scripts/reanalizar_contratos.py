#!/usr/bin/env python3
"""Vuelve a analizar contratos que YA tienen dictamen, con las Lambdas de agentes de producción (que escriben la alerta).

Para cuando una corrección del agente cambia lo publicado (2026-11-16: la regla de la misma persona en varias empresas
contaba a una empresa accionista como persona; el OCID con guiones dejaba al agente sin sus lecturas). El análisis
masivo no sirve para esto: salta los contratos que ya tienen alerta. El gasto se anota en el libro del masivo
(agente_masivo, como «externo») para que el tope lo cuente.

  python -X utf8 backend/scripts/reanalizar_contratos.py prod 1250529 1191481 --motivo "regla testaferro corregida"
  python -X utf8 backend/scripts/reanalizar_contratos.py prod --archivo ocids.txt --tope 40 --hilos 2 --motivo "…"
  python -X utf8 backend/scripts/reanalizar_contratos.py prod --guiones --minutos 150 --tope 120 --hilos 3 --motivo "…"

`--guiones`: la lista sale de la base (los dictámenes de OCID con guiones hechos antes del arreglo de e267f269 que tenían
lecturas; los ya rehechos quedan fuera): cada corrida retoma donde quedó la anterior, como el job `tarea:reanalisis` del CI.
`--minutos`: deja de lanzar al llegar y espera a los que están en vuelo. El gasto se anota en el libro cada 25 análisis.

La red sale del tipo de contratación de la convocatoria (como en masivo_agentes.py). Workers AI admite ≤ 9 análisis a la
vez en total y el masivo puede estar corriendo: por defecto 2 hilos.
"""
from __future__ import annotations

import argparse
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend" / "scripts"))
import masivo_agentes as M  # noqa: E402

_lock = threading.Lock()


def red_de(cu, ocid: str) -> str | None:
    cu.execute("SELECT lower(tipo_contratacion) FROM convocatorias WHERE ocid = %s", (ocid,))
    fila = cu.fetchone()
    t = fila[0] if fila else None
    return next((r for r, tipos in M.TIPOS.items() if t in tipos), None)


SQL_GUIONES = M.SQL_GUIONES  # la misma lista que mira el masivo para cederle hilos


def main() -> None:
    ap = argparse.ArgumentParser(description="Reanaliza contratos con dictamen en las Lambdas de producción.")
    ap.add_argument("entorno", choices=["prod"])
    ap.add_argument("ocids", nargs="*")
    ap.add_argument("--archivo", help="un OCID por línea")
    ap.add_argument("--motivo", required=True, help="por qué se reanaliza (queda en el libro)")
    ap.add_argument("--tope", type=float, default=20.0, help="US$ máximos para esta corrida (se corta antes de pasarlos)")
    ap.add_argument("--hilos", type=int, default=2)
    ap.add_argument("--guiones", action="store_true", help="la lista de los dictámenes de OCID con guiones hechos sin sus lecturas")
    ap.add_argument("--minutos", type=float, default=None, help="deja de lanzar análisis pasados estos minutos")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    M._db["entorno"] = a.entorno
    ocids = list(dict.fromkeys(a.ocids + ([x.strip() for x in Path(a.archivo).read_text(encoding="utf-8").splitlines() if x.strip()]
                                             if a.archivo else [])))
    if a.guiones:
        ocids += [o for o in M.base(lambda cu: (cu.execute(SQL_GUIONES), [f[0] for f in cu.fetchall()])[1]) if o not in ocids]
    if not ocids:
        # Con --guiones, la lista vacía es el final del trabajo, no un error: el horario del CI (tarea:reanalisis) puede
        # seguir activo sin fallar ni gastar; cada corrida termina aquí en segundos.
        if a.guiones:
            M.log("nada pendiente: todos los dictámenes con guiones ya se rehicieron")
            if M._db.get("cm") is not None:   # el túnel que abrió la consulta de la lista
                try:
                    M._db["cm"].__exit__(None, None, None)
                except Exception:  # noqa: BLE001
                    pass
            return
        raise SystemExit("sin OCID")
    por_red, tok = M.urls(), M.token()
    # La red de todos en UNA consulta: de uno en uno, con 1 245 OCID, eran más de 20 minutos sin lanzar nada (2026-11-18).
    tipo_de = dict(M.base(lambda cu: (cu.execute(
        "SELECT ocid, lower(tipo_contratacion) FROM convocatorias WHERE ocid = ANY(%s)", (ocids,)), cu.fetchall())[1]))
    trabajos = []
    for o in ocids:
        r = next((red for red, tipos in M.TIPOS.items() if tipo_de.get(o) in tipos), None)
        if not r or r not in por_red:
            M.log(f"[--] {o}: sin red o sin Lambda ({r})")
            continue
        trabajos.append((o, r))
    M.log(f"{len(trabajos)} contratos para reanalizar, {a.hilos} a la vez")
    hecho = {"ok": 0, "error": 0, "usd": 0.0, "anotado": 0.0, "desde_nota": 0}
    hasta = time.time() + a.minutos * 60 if a.minutos else None

    def anotar(final: bool = False) -> None:
        """Lo gastado desde la última nota, al libro del masivo (cada 25 análisis y al final: si la corrida se corta, sólo se
        pierde la cuenta de lo último)."""
        with _lock:
            nuevo = round(hecho["usd"] - hecho["anotado"], 4)
            if nuevo <= 0 or (not final and hecho["desde_nota"] < 25):
                return
            hecho["anotado"] += nuevo
            hecho["desde_nota"] = 0
        M.anotar(nuevo, f"reanálisis: {a.motivo} ({hecho['ok']} ok, {hecho['error']} con error hasta ahora)")

    def uno(job):
        o, r = job
        with _lock:
            if hasta and time.time() > hasta:
                return
            if hecho["usd"] + M.COSTO_SUPUESTO > a.tope:
                M.log(f"[--] {o}: tope de US$ {a.tope} alcanzado")
                return
            hecho["usd"] += M.COSTO_SUPUESTO   # reserva; se ajusta al costo medido
        cuerpo = M.base(lambda cu: M.ab_modelos.cuerpo(cu, o))
        res = {}
        for _ in range(3):
            res = M.ab_modelos.correr_uno(por_red[r], tok, cuerpo)
            if res.get("final") or (res.get("segundos") or 0) >= 15:
                break
            time.sleep(5)
        st = (res.get("final") or {}).get("state") or {}
        costo = (st.get("llm_metrics") or {}).get("cost_usd")
        ok = bool(res.get("final")) and not res.get("error")
        costo = float(costo) if costo is not None else (0.0 if (res.get("segundos") or 0) < 15 else M.COSTO_SUPUESTO)
        with _lock:
            hecho["usd"] += costo - M.COSTO_SUPUESTO
            hecho["ok" if ok else "error"] += 1
            hecho["desde_nota"] += 1
        anotar()
        M.log(f"[{'ok ' if ok else 'ERR'}] {o} {r} {res.get('segundos')}s USD {costo:.4f} score {st.get('score')} "
              f"{str(res.get('error') or '')[:120]}")

    try:
        with ThreadPoolExecutor(max(1, a.hilos)) as ex:
            list(ex.map(uno, trabajos))
        anotar(final=True)
        M.log(f"fin: {hecho['ok']} ok, {hecho['error']} con error, USD {hecho['usd']:.2f} (anotado en el libro del masivo)")
    finally:
        # El túnel se cierra aquí: al apagarse el intérprete ya no puede (y quedaba la sesión de SSM abierta).
        if M._db.get("cm") is not None:
            try:
                M._db["cm"].__exit__(None, None, None)
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    main()
