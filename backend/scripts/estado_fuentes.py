"""Estado de todas las fuentes de datos, desde la PC: lo mismo que el panel (Cobertura, Fuentes de datos), en texto.

Uso:  MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin python backend/scripts/estado_fuentes.py prod|dev

Abre un túnel a la base (infrastructure/aws/tunel_rds.py, sesión de sólo lectura) y muestra, por fuente:
  - la última corrida del Worker vigia-scrapers (corridas_fuente, migración 74): cuándo, cómo terminó y el error;
  - la última carga de un dato nuevo (datasets_cargas, migración 23), que es lo único que anotan los cargadores de PC;
y además las corridas con error de los últimos 7 días y las que quedaron «corriendo» más de 12 h (el Worker las cierra
solo en cada cron). Qué es cada fuente, dónde corre y cada cuánto debería cargar: SCRAPERS.md y
backend/api/src/lib/catalogoFuentes.ts. No imprime filas de datos: sólo fuentes, fechas, cuentas y errores recortados.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))
import tunel_rds  # noqa: E402

CONSULTAS = {
    "Por fuente (última corrida del Worker y último dato nuevo)": """
        WITH c AS (
          SELECT DISTINCT ON (fuente) fuente, estado, inicio, segundos, left(regexp_replace(coalesce(error, ''), '\\s+', ' ', 'g'), 90) AS error,
                 max(inicio) FILTER (WHERE estado = 'ok') OVER (PARTITION BY fuente) AS ultima_ok
            FROM corridas_fuente ORDER BY fuente, inicio DESC),
        d AS (
          SELECT fuente, count(*) AS cargas, count(*) FILTER (WHERE estado <> 'ok') AS con_error,
                 max(cargado_at) FILTER (WHERE estado = 'ok') AS ultima_carga, sum(filas) AS filas
            FROM datasets_cargas GROUP BY fuente)
        SELECT COALESCE(c.fuente, d.fuente) AS fuente,
               c.estado AS ultima_corrida,
               to_char(c.inicio AT TIME ZONE 'America/Lima', 'MM-DD HH24:MI') AS cuando,
               c.segundos AS seg,
               to_char(c.ultima_ok AT TIME ZONE 'America/Lima', 'MM-DD') AS ultima_ok,
               to_char(d.ultima_carga AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS dato_nuevo,
               d.con_error AS cargas_error,
               c.error
          FROM c FULL JOIN d ON d.fuente = c.fuente
         ORDER BY (c.estado = 'error') DESC NULLS LAST, COALESCE(c.inicio, d.ultima_carga) DESC NULLS LAST""",
    "Corridas con error en 7 días": """
        SELECT fuente, to_char(inicio AT TIME ZONE 'America/Lima', 'MM-DD HH24:MI') AS cuando, origen,
               left(regexp_replace(coalesce(error, ''), '\\s+', ' ', 'g'), 150) AS error
          FROM corridas_fuente WHERE estado = 'error' AND inicio > now() - interval '7 days' ORDER BY inicio DESC""",
    "Corridas colgadas (corriendo hace más de 12 h)": """
        SELECT fuente, instancia, to_char(inicio AT TIME ZONE 'America/Lima', 'MM-DD HH24:MI') AS desde
          FROM corridas_fuente WHERE estado = 'corriendo' AND inicio < now() - interval '12 hours' ORDER BY inicio""",
    "Ahora en la base (rol vigia_jobs)": """
        SELECT round(extract(epoch FROM now() - query_start))::int AS seg, left(regexp_replace(query, '\\s+', ' ', 'g'), 90) AS consulta
          FROM pg_stat_activity WHERE usename = 'vigia_jobs' AND state <> 'idle' ORDER BY query_start""",
}


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ("prod", "dev"):
        sys.exit(__doc__)
    with tunel_rds.conexion(sys.argv[1]) as con:
        con.set_session(readonly=True)
        cur = con.cursor()
        cur.execute("SET statement_timeout = '60s'")
        for titulo, q in CONSULTAS.items():
            print(f"\n== {titulo}")
            cur.execute(q)
            filas = cur.fetchall()
            if not filas:
                print("   (nada)")
                continue
            print(" | ".join(d[0] for d in cur.description))
            for r in filas:
                print(" | ".join("" if x is None else str(x) for x in r))


if __name__ == "__main__":
    main()
