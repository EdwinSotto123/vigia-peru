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
`--minutos`: deja de lanzar al llegar y espera a los que están en vuelo.

El libro: cada contrato entra a `agente_masivo` como «en vuelo» al lanzarse (la auditoría lo cuenta en «leyéndose ahora») y
queda como `externo` con su OCID, su costo y su motivo «reanálisis: …» al terminar (o `error`); la corrida abre su fila en
`agente_masivo_tanda` con `--presupuesto` (el tope acumulado del libro, por defecto MASIVO_TOPE), que es el «presupuestado»
de la auditoría. Antes se anotaba un total cada 25 análisis y la auditoría decía «leyéndose ahora: 0» con ocho en curso y
llamaba «pruebas de calidad» a los reanálisis (2026-11-24).

La red sale del tipo de contratación de la convocatoria (como en masivo_agentes.py). Workers AI admite ≤ 9 análisis a la
vez en total y el masivo puede estar corriendo: por defecto 2 hilos.
"""
from __future__ import annotations

import argparse
import json
import os
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
    ap.add_argument("--reintentos", default=None,
                    help="archivo donde quedan los OCID cuyo dictamen salió con páginas escaneadas sin leer (por defecto, "
                         "<archivo>.ocr.txt o reintentos_ocr.txt)")
    ap.add_argument("--presupuesto", type=float, default=float(os.environ["MASIVO_TOPE"]) if os.getenv("MASIVO_TOPE") else None,
                    help="tope acumulado del libro (US$) que muestra la auditoría; por defecto MASIVO_TOPE")
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
    hecho = {"ok": 0, "error": 0, "usd": 0.0, "anotado": 0.0, "desde_nota": 0, "en_libro": 0.0, "ocr": []}
    reintentos = a.reintentos or (f"{a.archivo}.ocr.txt" if a.archivo else "reintentos_ocr.txt")
    origen = f"reanalisis-{os.environ['CI_JOB_ID']}" if os.getenv("CI_JOB_ID") else f"reanalisis-pc-{time.strftime('%Y%m%d-%H%M')}"
    motivo = f"reanálisis: {a.motivo}"[:300]

    def abrir_tanda(cu):
        g, _ = M.gasto(cu)
        cu.execute("""INSERT INTO agente_masivo_tanda (origen, tope, plan, filtro, pendientes, sin_info, gastado_al_inicio)
                      VALUES (%s, %s, %s, %s, %s::jsonb, '{}'::jsonb, %s) ON CONFLICT (origen) DO NOTHING""",
                   (origen, a.presupuesto, motivo[:200], f"{len(trabajos)} dictámenes",
                    json.dumps({r: sum(1 for _, x in trabajos if x == r) for r in {x for _, x in trabajos}}), g))

    def reservar(o: str, r: str) -> int | None:
        """Su fila en el libro, «en vuelo» (si el masivo ya lo tiene en vuelo, sin fila: se anota en el total)."""
        def ins(cu):
            cu.execute("""INSERT INTO agente_masivo (ocid, red, origen, motivo) VALUES (%s, %s, %s, %s)
                          ON CONFLICT (ocid) WHERE estado = 'en_vuelo' DO NOTHING RETURNING id""", (o, r, origen, motivo))
            f = cu.fetchone()
            return f[0] if f else None
        try:
            return M.base(ins)
        except Exception as e:  # noqa: BLE001
            M.log(f"[EXC] sin fila en el libro para {o}: {str(e)[:120]}")
            return None

    def cerrar(rid: int, ok: bool, costo: float, medido: bool, segundos, score, error) -> bool:
        try:
            M.base(lambda cu: cu.execute(
                """UPDATE agente_masivo SET estado = %s, costo = %s, costo_medido = %s, segundos = %s, score = %s, error = %s,
                          terminado_en = now() WHERE id = %s""",
                ("externo" if ok else "error", costo, medido, segundos, score, (str(error)[:300] if error else None), rid)))
            return True
        except Exception as e:  # noqa: BLE001
            M.log(f"[EXC] no pude cerrar la fila {rid}: {str(e)[:120]}")
            return False

    try:
        M.base(abrir_tanda)
    except Exception as e:  # noqa: BLE001
        M.log(f"[EXC] no pude abrir la tanda: {str(e)[:150]}")
    hasta = time.time() + a.minutos * 60 if a.minutos else None

    def anotar(final: bool = False) -> None:
        """Lo gastado desde la última nota, al libro del masivo (cada 25 análisis y al final: si la corrida se corta, sólo se
        pierde la cuenta de lo último)."""
        with _lock:
            # Lo que ya quedó en su fila del libro no se vuelve a anotar.
            nuevo = round(hecho["usd"] - hecho["en_libro"] - hecho["anotado"], 4)
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
        rid = reservar(o, r)
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
        medido = costo is not None
        costo = float(costo) if costo is not None else (0.0 if (res.get("segundos") or 0) < 15 else M.COSTO_SUPUESTO)
        en_fila = rid is not None and cerrar(rid, ok, costo, medido, res.get("segundos"), st.get("score"), res.get("error"))
        # Un dictamen con páginas escaneadas sin leer (el OCR falló: casi siempre el límite de uso) no se da por hecho:
        # queda en la lista de reintentos (2026-11-24: 155 de 203 reanálisis del día salieron así).
        if ok and any(isinstance(x, dict) and x.get("donde") == "ocr_gemini_vision" for x in (st.get("recortes") or [])):
            with _lock:
                hecho["ocr"].append(o)
                with Path(reintentos).open("a", encoding="utf-8") as f:
                    f.write(o + "\n")
            M.log(f"[OCR] {o}: quedaron páginas escaneadas sin leer; va a {reintentos}")
        with _lock:
            hecho["usd"] += costo - M.COSTO_SUPUESTO
            hecho["ok" if ok else "error"] += 1
            hecho["desde_nota"] += 1
            if en_fila:
                hecho["en_libro"] += costo
        anotar()
        M.log(f"[{'ok ' if ok else 'ERR'}] {o} {r} {res.get('segundos')}s USD {costo:.4f} score {st.get('score')} "
              f"{str(res.get('error') or '')[:120]}")

    try:
        with ThreadPoolExecutor(max(1, a.hilos)) as ex:
            list(ex.map(uno, trabajos))
        anotar(final=True)
        try:
            M.base(lambda cu: cu.execute("UPDATE agente_masivo_tanda SET fin = now(), ok = %s, errores = %s, costo = %s WHERE origen = %s",
                                         (hecho["ok"], hecho["error"], round(hecho["usd"], 4), origen)))
        except Exception as e:  # noqa: BLE001
            M.log(f"[EXC] no pude cerrar la tanda: {str(e)[:150]}")
        M.log(f"fin: {hecho['ok']} ok ({len(hecho['ocr'])} con páginas escaneadas sin leer, en {reintentos}), "
              f"{hecho['error']} con error, USD {hecho['usd']:.2f} (anotado en el libro del masivo)")
    finally:
        # El túnel se cierra aquí: al apagarse el intérprete ya no puede (y quedaba la sesión de SSM abierta).
        if M._db.get("cm") is not None:
            try:
                M._db["cm"].__exit__(None, None, None)
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    main()
