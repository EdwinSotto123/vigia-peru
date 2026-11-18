"""Qué consultas le cuestan tiempo a la base AHORA: dos fotos de pg_stat_statements separadas por unos minutos y su
diferencia por consulta (pg_stat_statements acumula desde el 2026-10-20 y mezcla lo ya arreglado con lo de hoy).

  python -X utf8 backend/scripts/medir_consultas.py foto ahora.json              # la primera foto
  python -X utf8 backend/scripts/medir_consultas.py foto despues.json ahora.json # la segunda, y la diferencia

Lo que se aprendió usándolo (2026-11-18):
- Los literales salen como $n: para encontrar una consulta en el código, buscar por los alias de sus columnas.
- Una consulta cara una sola vez puede ser lectura en frío: medirla en caliente antes de cambiarla (los 14,6 s del
  rastreador de planillas eran disco; la versión «más rápida» resultó más lenta en caliente).
- Mirar `blq` (bloques leídos del disco): muchos con pocas llamadas es frío o falta de índice; muchas llamadas baratas
  que suman, un rastreador recorriendo fichas.
- Una comparación `char(11)` contra texto recorre la tabla entera: ver `empresas.ruc` en vigia-rendimiento.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

SQL = """SELECT queryid::text, r.rolname, calls, total_exec_time, rows, shared_blks_read, left(query, 400)
           FROM pg_stat_statements s JOIN pg_roles r ON r.oid = s.userid"""


def foto(entorno: str = "prod") -> dict:
    with conexion(entorno) as cn:
        cur = cn.cursor()
        cur.execute(SQL)
        return {q: {"rol": rol, "calls": c, "ms": t, "rows": n, "leidos": b, "sql": s} for q, rol, c, t, n, b, s in cur.fetchall()}


def diferencia(nueva: dict, vieja: dict, rol: str | None = None, n: int = 25) -> None:
    filas = []
    for q, d in nueva.items():
        a = vieja.get(q, {"calls": 0, "ms": 0, "leidos": 0})
        dc, dm = d["calls"] - a["calls"], d["ms"] - a["ms"]
        if dc > 0 and dm > 0 and (rol is None or d["rol"] == rol):
            filas.append((dm, dc, d["leidos"] - a["leidos"], d["rol"], d["sql"]))
    filas.sort(reverse=True)
    print(f"tiempo total: {sum(f[0] for f in filas) / 1000:.0f} s")
    for dm, dc, dl, r, s in filas[:n]:
        print(f"{dm / 1000:8.1f} s {dc:6d}x {dm / dc:9.1f} ms/x {dl:9d} blq {r:16s} {' '.join(s.split())[:230]}")


def main() -> None:
    if len(sys.argv) < 3 or sys.argv[1] != "foto":
        raise SystemExit(__doc__)
    nueva = foto()
    Path(sys.argv[2]).write_text(json.dumps(nueva), encoding="utf-8")
    print("consultas:", len(nueva))
    if len(sys.argv) > 3:
        vieja = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
        rol = sys.argv[4] if len(sys.argv) > 4 else None
        diferencia(nueva, vieja, rol)


if __name__ == "__main__":
    main()
