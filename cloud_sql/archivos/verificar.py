"""Compara el número de filas de cada tabla (y de las vistas materializadas) entre dos bases.

    python cloud_sql/archivos/verificar.py <host_a> <pass_a> <host_b> <pass_b>
"""
import sys

import psycopg2


def contar(host: str, pw: str) -> dict[str, int]:
    c = psycopg2.connect(host=host, user="postgres", dbname="vigia", password=pw, sslmode="require")
    cu = c.cursor()
    cu.execute("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace "
               "where n.nspname='public' and c.relkind in ('r','m') order by 1")
    out = {}
    for (t,) in cu.fetchall():
        cu.execute(f'select count(*) from public."{t}"')
        out[t] = cu.fetchone()[0]
    return out


a, b = contar(sys.argv[1], sys.argv[2]), contar(sys.argv[3], sys.argv[4])
difieren = {t: (a.get(t), b.get(t)) for t in sorted(set(a) | set(b)) if a.get(t) != b.get(t)}
print(f"tablas: {len(a)} vs {len(b)} · filas A={sum(a.values())} B={sum(b.values())}")
print("IGUALES" if not difieren else f"DIFIEREN ({len(difieren)}): {difieren}")
sys.exit(1 if difieren else 0)
