#!/usr/bin/env python3
"""Vuelve a analizar contratos que YA tienen dictamen, con las Lambdas de agentes de producción (que escriben la alerta).

Para cuando una corrección del agente cambia lo publicado (2026-11-16: la regla de la misma persona en varias empresas
contaba a una empresa accionista como persona; el OCID con guiones dejaba al agente sin sus lecturas). El análisis
masivo no sirve para esto: salta los contratos que ya tienen alerta. El gasto se anota en el libro del masivo
(agente_masivo, como «externo») para que el tope lo cuente.

  python -X utf8 backend/scripts/reanalizar_contratos.py prod 1250529 1191481 --motivo "regla testaferro corregida"
  python -X utf8 backend/scripts/reanalizar_contratos.py prod --archivo ocids.txt --tope 40 --hilos 2 --motivo "…"

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


def main() -> None:
    ap = argparse.ArgumentParser(description="Reanaliza contratos con dictamen en las Lambdas de producción.")
    ap.add_argument("entorno", choices=["prod"])
    ap.add_argument("ocids", nargs="*")
    ap.add_argument("--archivo", help="un OCID por línea")
    ap.add_argument("--motivo", required=True, help="por qué se reanaliza (queda en el libro)")
    ap.add_argument("--tope", type=float, default=20.0, help="US$ máximos para esta corrida (se corta antes de pasarlos)")
    ap.add_argument("--hilos", type=int, default=2)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    ocids = list(dict.fromkeys(a.ocids + ([x.strip() for x in Path(a.archivo).read_text(encoding="utf-8").splitlines() if x.strip()]
                                             if a.archivo else [])))
    if not ocids:
        raise SystemExit("sin OCID")
    M._db["entorno"] = a.entorno
    por_red, tok = M.urls(), M.token()
    trabajos = []
    for o in ocids:
        r = M.base(lambda cu: red_de(cu, o))
        if not r or r not in por_red:
            M.log(f"[--] {o}: sin red o sin Lambda ({r})")
            continue
        trabajos.append((o, r))
    hecho = {"ok": 0, "error": 0, "usd": 0.0}

    def uno(job):
        o, r = job
        with _lock:
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
        M.log(f"[{'ok ' if ok else 'ERR'}] {o} {r} {res.get('segundos')}s USD {costo:.4f} score {st.get('score')} "
              f"{str(res.get('error') or '')[:120]}")

    with ThreadPoolExecutor(max(1, a.hilos)) as ex:
        list(ex.map(uno, trabajos))
    if hecho["usd"] > 0:
        M.anotar(round(hecho["usd"], 4), f"reanálisis: {a.motivo} ({hecho['ok']} ok, {hecho['error']} con error)")
    M.log(f"fin: {hecho['ok']} ok, {hecho['error']} con error, USD {hecho['usd']:.2f} (anotado en el libro del masivo)")


if __name__ == "__main__":
    main()
