"""Rellena `procesamientos.fases` (migración 20) a partir de `eventos` para las filas que
se procesaron con un dispatcher anterior (fases = '{}'). Idempotente; solo toca filas
terminadas (procesado/error): las vivas las escribe el dispatcher.

Uso:  PGHOST=… PGPASSWORD=… PGSSLMODE=require python -m backend.dispatcher.backfill_fases
"""
from __future__ import annotations

import psycopg2
from psycopg2.extras import Json

from .events import reduce_event
from .main import dsn


def reducir(eventos: list[dict]) -> dict:
    state: dict = {}
    for ev in eventos or []:
        kind = ev.get("kind")
        raw = {"kind": kind, "name": ev.get("name"), "msg": ev.get("msg")}
        if kind == "error":
            raw["detail"] = ev.get("msg")
        state.update(reduce_event(state, raw, ts=ev.get("ts")))
    return state.get("fases") or {}


def main() -> int:
    conn = psycopg2.connect(dsn())
    n = 0
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT ocid, eventos FROM procesamientos WHERE fases = '{}'::jsonb AND jsonb_array_length(eventos) > 0 "
                        "AND estado IN ('procesado', 'error')")
            filas = cur.fetchall()
            for ocid, eventos in filas:
                fases = reducir(eventos)
                if fases:
                    cur.execute("UPDATE procesamientos SET fases = %s::jsonb WHERE ocid = %s", (Json(fases), ocid))
                    n += 1
    finally:
        conn.close()
    print(f"fases rellenadas: {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
