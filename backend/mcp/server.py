"""Vigía Perú · servidor MCP remoto (Cloud Run).

Expone datos PÚBLICOS de Vigía (alertas de riesgo, banderas con su evidencia,
sanciones OSCE) a cualquier cliente LLM (Gemini CLI / Cursor / etc.) como tools
read-only. Así un periodista o fiscal puede preguntar desde su propio agente
"dame las alertas rojas de Áncash" y recibirlas con su evidencia oficial.

Reglas innegociables que este servidor respeta:
  · #1 — devuelve "señal de riesgo", nunca acusación (ver disclaimer).
  · #2 — NO expone datos personales de ciudadanos. Solo funcionarios en
         ejercicio y empresas que contratan con el Estado (data pública por ley).
  · solo LECTURA — ningún tool escribe en la base.

Transporte: streamable-HTTP en `/mcp` (apto para Cloud Run). Distinto del
Phoenix MCP (que introspecciona NUESTRAS trazas); acá Vigía es el SERVIDOR.
"""
from __future__ import annotations

import os
import pg8000.dbapi
from mcp.server.fastmcp import FastMCP

PG_HOST = os.getenv("PGHOST", "/cloudsql/vivid-spot-480905-a4:us-central1:vigia-db")
PG_USER = os.getenv("PGUSER", "postgres")
PG_PASS = os.getenv("PGPASSWORD", "")
PG_DB = os.getenv("PGDATABASE", "vigia")

_DISCLAIMER = ("Señal de riesgo, no acusación. La denuncia formal corresponde a "
               "Contraloría/Fiscalía. Verificar en la fuente oficial SEACE/OECE.")


def _pg():
    if PG_HOST.startswith("/cloudsql/"):
        return pg8000.dbapi.connect(
            user=PG_USER, password=PG_PASS, database=PG_DB,
            unix_sock=f"{PG_HOST}/.s.PGSQL.5432",
        )
    return pg8000.dbapi.connect(
        host=PG_HOST, port=5432, user=PG_USER, password=PG_PASS,
        database=PG_DB, ssl_context=True,
    )


def _short_ocid(ocid: str) -> str:
    s = str(ocid or "")
    return s.rsplit("-", 1)[-1] if s.startswith("ocds-") else s


mcp = FastMCP("vigia-peru", host="0.0.0.0", port=int(os.getenv("PORT", "8080")))


@mcp.tool()
def buscar_alertas(region: str = "", severidad_min: int = 0, limite: int = 20) -> list[dict]:
    """Lista alertas de riesgo de corrupción en contrataciones públicas del Perú.

    Args:
        region: filtra por región/departamento (vacío = todas).
        severidad_min: score mínimo 0-100 (0 = todas).
        limite: máximo de resultados (1-50).
    """
    limite = max(1, min(int(limite or 20), 50))
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT a.codigo, a.ocid, a.region, a.score, a.monto_adjudicado, c.objeto,
                      (SELECT count(*) FROM banderas b WHERE b.alerta_id = a.id)
                 FROM alertas a
                 LEFT JOIN convocatorias c ON c.ocid = a.ocid
                WHERE (%s = '' OR a.region ILIKE %s)
                  AND COALESCE(a.score, 0) >= %s
                ORDER BY a.score DESC NULLS LAST
                LIMIT %s""",
            (region, f"%{region}%", int(severidad_min or 0), limite),
        )
        return [
            {"codigo": r[0], "ocid": r[1], "region": r[2], "score": r[3],
             "monto_adjudicado": float(r[4]) if r[4] is not None else None,
             "objeto": r[5], "n_banderas": r[6]}
            for r in cur.fetchall()
        ]
    finally:
        conn.close()


@mcp.tool()
def riesgo_convocatoria(ocid: str) -> dict:
    """Score de riesgo + banderas (con evidencia y norma citada) de una convocatoria.

    Args:
        ocid: OCID o código (ej. '1221190' o 'OECE-1221190').
    """
    short = _short_ocid(ocid)
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT a.id, a.codigo, a.ocid, a.score, a.region, a.monto_adjudicado, c.objeto
                 FROM alertas a LEFT JOIN convocatorias c ON c.ocid = a.ocid
                WHERE a.ocid = %s OR a.codigo = %s OR a.codigo = %s
                LIMIT 1""",
            (short, str(ocid), f"OECE-{short}"),
        )
        row = cur.fetchone()
        if not row:
            return {"encontrada": False, "ocid": ocid}
        alerta_id = row[0]
        cur.execute(
            """SELECT regla, severidad, evidencia, norma FROM banderas
                WHERE alerta_id = %s
                ORDER BY CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END""",
            (alerta_id,),
        )
        banderas = [{"regla": b[0], "severidad": b[1], "evidencia": b[2], "norma": b[3]}
                    for b in cur.fetchall()]
        return {
            "encontrada": True, "codigo": row[1], "ocid": row[2], "score": row[3],
            "region": row[4],
            "monto_adjudicado": float(row[5]) if row[5] is not None else None,
            "objeto": row[6], "n_banderas": len(banderas), "banderas": banderas,
            "disclaimer": _DISCLAIMER,
        }
    finally:
        conn.close()


@mcp.tool()
def empresa_sancionada(ruc: str) -> dict:
    """Indica si una empresa (por RUC) tiene sanciones VIGENTES en el OSCE.

    Args:
        ruc: RUC de la empresa (11 dígitos).
    """
    ruc = "".join(ch for ch in str(ruc) if ch.isdigit())
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT razon_social, tipo, periodo, fecha_hasta, resolucion, LEFT(infraccion, 300)
                 FROM osce_sancionados_vigentes WHERE ruc = %s""",
            (ruc,),
        )
        sanciones = [
            {"razon_social": r[0], "tipo": r[1], "periodo": r[2],
             "vence": r[3].isoformat() if r[3] else "DEFINITIVO",
             "resolucion": r[4], "infraccion": r[5]}
            for r in cur.fetchall()
        ]
        return {"ruc": ruc, "tiene_sancion_vigente": bool(sanciones),
                "n_sanciones": len(sanciones), "sanciones": sanciones,
                "disclaimer": _DISCLAIMER}
    finally:
        conn.close()


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
