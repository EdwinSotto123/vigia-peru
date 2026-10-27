"""
Aplica la migración 173 (convocatoria_texto: la búsqueda de contratos con su fecha) en producción sin frenar las cargas:
la tabla y los triggers en una transacción, el relleno en una sentencia y los índices CONCURRENTLY (el .sql los crea
sin CONCURRENTLY, que con dev.py migrar va en una sola transacción). Idempotente.

    MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin python backend/scripts/aplicar_173.py [--base prod|dev]
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "infrastructure", "aws"))
from tunel_rds import conexion  # noqa: E402

MIGRACION = os.path.join(os.path.dirname(__file__), "..", "db", "migrations", "173_busqueda_con_fecha.sql")


def partes() -> tuple[str, str, list[str]]:
    """El .sql en tres tramos: DDL (hasta los triggers), relleno (INSERT + DELETE) e índices (+ ANALYZE)."""
    sql = open(MIGRACION, encoding="utf-8").read()
    i_relleno = sql.index("INSERT INTO convocatoria_texto (ocid, texto, fecha, alta)\nSELECT")
    i_indices = sql.index("CREATE INDEX IF NOT EXISTS convocatoria_texto_gin")
    indices = [s.strip() for s in sql[i_indices:].split(";") if s.strip()]
    return sql[:i_relleno], sql[i_relleno:i_indices], indices


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="prod", choices=["prod", "dev"])
    args = ap.parse_args()
    ddl, relleno, indices = partes()
    with conexion(args.base) as c:
        c.autocommit = True
        cur = c.cursor()
        cur.execute("SET statement_timeout = 0")
        t = time.time()
        cur.execute("BEGIN")
        cur.execute(ddl)
        cur.execute("COMMIT")
        print(f"tabla, función y triggers: {time.time() - t:.1f} s", flush=True)
        t = time.time()
        cur.execute(relleno)
        cur.execute("SELECT count(*) FROM convocatoria_texto")
        print(f"relleno: {cur.fetchone()[0]:,} filas en {time.time() - t:.0f} s", flush=True)
        for s in indices:
            t = time.time()
            # CONCURRENTLY no frena las escrituras (las de los triggers de convocatorias incluidas).
            cur.execute(re.sub(r"^CREATE INDEX IF NOT EXISTS", "CREATE INDEX CONCURRENTLY IF NOT EXISTS", s))
            print(f"{s.split()[5] if s.startswith('CREATE') else s}: {time.time() - t:.0f} s", flush=True)
        # Un CONCURRENTLY interrumpido deja el índice inválido: avisar en vez de seguir como si estuviera.
        cur.execute("""SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                        WHERE i.indrelid = 'convocatoria_texto'::regclass AND NOT i.indisvalid""")
        malos = [r[0] for r in cur.fetchall()]
        if malos:
            sys.exit(f"índices inválidos (DROP INDEX y volver a correr): {malos}")
        # La tabla vieja (migración 86) se borra en la 176: sin ella, sólo el conteo de la nueva.
        cur.execute("SELECT to_regclass('convocatoria_busqueda') IS NOT NULL")
        if not cur.fetchone()[0]:
            cur.execute("SELECT count(*), count(*) FILTER (WHERE alta IS NULL) FROM convocatoria_texto")
            n, sin_alta = cur.fetchone()
            print(f"convocatoria_texto {n:,}, sin alta {sin_alta:,}")
            return
        cur.execute("""SELECT (SELECT count(*) FROM convocatoria_texto), (SELECT count(*) FROM convocatoria_busqueda),
                              (SELECT count(*) FROM convocatoria_texto t WHERE NOT EXISTS (SELECT 1 FROM convocatoria_busqueda b WHERE b.ocid = t.ocid)),
                              (SELECT count(*) FROM convocatoria_texto WHERE alta IS NULL)""")
        n, viejo, solo_nuevo, sin_alta = cur.fetchone()
        print(f"convocatoria_texto {n:,}, convocatoria_busqueda {viejo:,}, sólo en la nueva {solo_nuevo:,}, sin alta {sin_alta:,}")


if __name__ == "__main__":
    main()
