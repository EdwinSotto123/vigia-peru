#!/usr/bin/env python3
"""
Motor de compliance · corre las 8 reglas duras sobre UNA convocatoria.

Uso:
  python backend/scripts/detect/run_compliance.py <ocid>
  python backend/scripts/detect/run_compliance.py ocds-dgv273-seacev3-1202858

Qué hace:
  1. Lee la convocatoria + items + postores + ofertas + entidad/empresas de BD
  2. Para cada regla (C1..C8), evalúa contra esa convocatoria
  3. Si la regla dispara, crea una bandera con norma/severidad/evidencia
  4. Si hay ≥1 bandera, crea (o actualiza) la alerta correspondiente
     con score computado
  5. Imprime el reporte

Reglas implementadas:
  C1 — edad RUC < 90 días (solo si tenemos fecha_alta_ruc)
  C2 — único postor con oferta ≥ 95% del valor referencial
  C4 — empresa con sanción OSCE vigente (persona_flags tipo='sancion_osce')
  C5 — inhabilitación judicial vigente (tipo='inhabilitacion_judicial')
  C6 — > 3 penalidades históricas (tabla penalidades)
  C8 — procedimiento "No Competitivo" / "Contratación Directa"

Pendientes (necesitan más data):
  C3 — adenda > 25% del original (requiere contractAmendments)
  C7 — sobreprecio detectado por market_price_agent (capa IA)

Idempotente: borra banderas previas del agente 'compliance_agent' y reinsertanta.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR.parent / "ingest"))

from lib.pg import connect  # noqa: E402


# ─── pesos de score por severidad ────────────────────────────────

WEIGHT = {"alta": 35, "media": 18, "baja": 8}
SCORE_CAP = 100


# ─── reglas ──────────────────────────────────────────────────────

def regla_C1_edad_ruc_baja(cur, ocid: str) -> list[dict]:
    """Empresa ganadora con RUC creado hace < 90 días (Heurística Funes)."""
    cur.execute(
        """
        SELECT DISTINCT p.empresa_ruc, e.razon_social,
                        e.metadata->>'fecha_alta_ruc' AS fecha_alta,
                        c.fecha_buena_pro, c.cuantia_referencial
          FROM convocatorias c
          JOIN postores p ON p.ocid = c.ocid
          JOIN ofertas o ON o.postor_id = p.id AND o.ganadora = TRUE
          JOIN empresas e ON e.ruc = p.empresa_ruc
         WHERE c.ocid = %s
           AND e.metadata->>'fecha_alta_ruc' IS NOT NULL
        """,
        (ocid,),
    )
    out = []
    for ruc, razon, fecha_alta, fecha_bp, cuantia in cur.fetchall():
        if not (fecha_alta and fecha_bp):
            continue
        # diff de fechas — psycopg2 trae como date
        try:
            from datetime import date
            if isinstance(fecha_alta, str):
                fecha_alta = date.fromisoformat(fecha_alta[:10])
            dias = (fecha_bp - fecha_alta).days
        except Exception:
            continue
        if dias < 90 and float(cuantia or 0) > 500_000:
            out.append({
                "regla": "edad_ruc_baja",
                "severidad": "alta",
                "evidencia": f"RUC {ruc} creado hace {dias} días · ganó "
                             f"contrato por S/. {float(cuantia):,.0f}",
                "norma": "Heurística — modelo Funes (OjoPúblico)",
                "fuente_url": f"https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/?ruc={ruc}",
            })
    return out


def regla_C2_unico_postor_alto(cur, ocid: str) -> list[dict]:
    """Único postor con oferta ≥ 95% del valor referencial, contando por ítem.

    En procesos por ítems (lo más común en OECE), cada ítem es una "carrera"
    propia. Si todos los ítems tuvieron 1 solo postor al 95%+, es señal fuerte.
    """
    cur.execute(
        """
        WITH per_item AS (
          SELECT i.id AS item_id,
                 i.descripcion AS desc,
                 COUNT(DISTINCT p.empresa_ruc) AS n_postores,
                 MAX(o.porcentaje_referencial) FILTER (WHERE o.ganadora) AS pct_ganador
            FROM convocatoria_items i
            LEFT JOIN ofertas o ON o.item_id = i.id
            LEFT JOIN postores p ON p.id = o.postor_id
           WHERE i.ocid = %s
           GROUP BY i.id, i.descripcion
        )
        SELECT
          COUNT(*) AS total_items,
          COUNT(*) FILTER (WHERE n_postores = 1) AS items_unico_postor,
          COUNT(*) FILTER (WHERE n_postores = 1 AND pct_ganador >= 95) AS items_unico_alto,
          ROUND(AVG(pct_ganador)::numeric, 2) AS pct_promedio
        FROM per_item
        """,
        (ocid,),
    )
    total, unicos, unicos_altos, pct_avg = cur.fetchone() or (0, 0, 0, 0)
    if not total:
        return []
    out = []
    # Caso fuerte: TODOS los ítems con único postor al ≥95%
    if total > 0 and unicos_altos == total:
        out.append({
            "regla": "unico_postor_alto",
            "severidad": "alta",
            "evidencia": f"{total}/{total} ítems con 1 solo postor admitido · "
                         f"todas las ofertas ganadoras al {float(pct_avg or 0):.1f}% "
                         f"del valor referencial — sin competencia real",
            "norma": "Art. 27 Reglamento Ley 32069 — competencia mínima",
            "fuente_url": "https://contratacionesabiertas.oece.gob.pe/proceso/" + ocid,
        })
    # Caso parcial: la mayoría
    elif total > 0 and unicos_altos >= max(1, total // 2):
        out.append({
            "regla": "unico_postor_alto",
            "severidad": "media",
            "evidencia": f"{unicos_altos}/{total} ítems con 1 solo postor al ≥95% del referencial",
            "norma": "Art. 27 Reglamento Ley 32069",
            "fuente_url": "https://contratacionesabiertas.oece.gob.pe/proceso/" + ocid,
        })
    return out


def regla_C4_proveedor_sancionado(cur, ocid: str) -> list[dict]:
    """Empresa ganadora con sanción OSCE vigente."""
    cur.execute(
        """
        SELECT e.ruc, e.razon_social,
               COUNT(pf.*) AS n_sanciones,
               STRING_AGG(LEFT(COALESCE(pf.detalle, ''), 80), ' · ') AS detalles,
               MAX(pf.fuente_url) AS url
          FROM convocatorias c
          JOIN postores p ON p.ocid = c.ocid
          JOIN ofertas o ON o.postor_id = p.id AND o.ganadora = TRUE
          JOIN empresas e ON e.ruc = p.empresa_ruc
          JOIN persona_flags pf ON pf.empresa_ruc = e.ruc
                                AND pf.tipo = 'sancion_osce'
         WHERE c.ocid = %s
         GROUP BY e.ruc, e.razon_social
        """,
        (ocid,),
    )
    out = []
    for ruc, razon, n, detalles, url in cur.fetchall():
        out.append({
            "regla": "proveedor_sancionado_osce",
            "severidad": "alta",
            "evidencia": f"{razon} (RUC {ruc}) tiene {n} sanción(es) OSCE · "
                         f"{(detalles or '')[:120]}",
            "norma": "Art. 50 TUO Ley 30225",
            "fuente_url": url or "https://apps.osce.gob.pe/perfilprov-ui/inhabilitado.xhtml",
        })
    return out


def regla_C5_inhabilitacion_judicial(cur, ocid: str) -> list[dict]:
    cur.execute(
        """
        SELECT DISTINCT e.ruc, e.razon_social, pf.detalle, pf.fuente_url
          FROM convocatorias c
          JOIN postores p ON p.ocid = c.ocid
          JOIN ofertas o ON o.postor_id = p.id AND o.ganadora = TRUE
          JOIN empresas e ON e.ruc = p.empresa_ruc
          JOIN persona_flags pf ON pf.empresa_ruc = e.ruc
                                AND pf.tipo = 'inhabilitacion_judicial'
         WHERE c.ocid = %s
        """,
        (ocid,),
    )
    out = []
    for ruc, razon, detalle, url in cur.fetchall():
        out.append({
            "regla": "inhabilitacion_judicial",
            "severidad": "alta",
            "evidencia": f"{razon} (RUC {ruc}) inhabilitada judicialmente · {detalle[:80]}",
            "norma": "Art. 50 TUO Ley 30225",
            "fuente_url": url or "",
        })
    return out


def regla_C6_penalidades_acumuladas(cur, ocid: str) -> list[dict]:
    """Empresa ganadora con > 3 penalidades aplicadas en contratos previos."""
    cur.execute(
        """
        SELECT e.ruc, e.razon_social, COUNT(pen.*) AS n_pen, SUM(pen.monto) AS total
          FROM convocatorias c
          JOIN postores p ON p.ocid = c.ocid
          JOIN ofertas o ON o.postor_id = p.id AND o.ganadora = TRUE
          JOIN empresas e ON e.ruc = p.empresa_ruc
          LEFT JOIN penalidades pen ON pen.empresa_ruc = e.ruc
         WHERE c.ocid = %s
         GROUP BY e.ruc, e.razon_social
        HAVING COUNT(pen.*) > 3
        """,
        (ocid,),
    )
    out = []
    for ruc, razon, n, total in cur.fetchall():
        out.append({
            "regla": "penalidades_acumuladas",
            "severidad": "media",
            "evidencia": f"{razon} tiene {n} penalidades históricas · "
                         f"monto total S/. {float(total or 0):,.0f}",
            "norma": "Histórico de cumplimiento contractual",
            "fuente_url": "https://contratacionesdelestado.gob.pe/",
        })
    return out


def regla_C8_proc_no_competitivo(cur, ocid: str) -> list[dict]:
    cur.execute(
        """
        SELECT tipo_proceso, ocds_payload->'planning'->'budget' AS budget
          FROM convocatorias WHERE ocid = %s
        """,
        (ocid,),
    )
    row = cur.fetchone()
    if not row:
        return []
    tipo, _ = row
    if not tipo:
        return []
    u = tipo.upper()
    if "NO COMPETITIVO" in u or "DIRECTA" in u or "EXONER" in u:
        return [{
            "regla": "procedimiento_no_competitivo",
            "severidad": "media",
            "evidencia": f"Tipo de proceso: {tipo} · invocó una causal de "
                         f"excepción que limita la competencia",
            "norma": "Art. 55.1 Ley 32069 — supuestos de selección no competitiva",
            "fuente_url": "https://contratacionesabiertas.oece.gob.pe/proceso/" + ocid,
        }]
    return []


REGLAS = [
    ("C1", regla_C1_edad_ruc_baja),
    ("C2", regla_C2_unico_postor_alto),
    ("C4", regla_C4_proveedor_sancionado),
    ("C5", regla_C5_inhabilitacion_judicial),
    ("C6", regla_C6_penalidades_acumuladas),
    ("C8", regla_C8_proc_no_competitivo),
]


# ─── alerta ──────────────────────────────────────────────────────

def compute_score(banderas: list[dict]) -> int:
    s = 0
    for b in banderas:
        s += WEIGHT.get(b["severidad"], 5)
    return min(s, SCORE_CAP)


def upsert_alerta_y_banderas(cur, ocid: str, banderas: list[dict]) -> str | None:
    """Crea/actualiza la alerta para esta convocatoria. Devuelve UUID alerta."""
    if not banderas:
        return None

    # Datos de la convocatoria para llenar la alerta
    cur.execute(
        """
        SELECT c.entidad_ruc, c.region, c.fecha_buena_pro, c.objeto,
               c.codigo, c.cuantia_referencial,
               (SELECT empresa_ruc FROM postores p
                  JOIN ofertas o ON o.postor_id = p.id AND o.ganadora = TRUE
                 WHERE p.ocid = c.ocid LIMIT 1) AS ganador_ruc
          FROM convocatorias c WHERE c.ocid = %s
        """,
        (ocid,),
    )
    row = cur.fetchone()
    if not row:
        return None
    entidad_ruc, region, fecha_bp, objeto, codigo_conv, cuantia, ganador_ruc = row

    score = compute_score(banderas)
    reglas = list({b["regla"] for b in banderas})
    codigo_alerta = f"OECE-{codigo_conv}"

    cur.execute(
        """
        INSERT INTO alertas
          (codigo, ocid, entidad_ruc, proveedor_ruc, monto_adjudicado,
           fecha_buena_pro, region, score, reglas_disparadas, estado,
           objeto, codigo_convocatoria, fuente_url)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'activa', %s, %s, %s)
        ON CONFLICT (codigo) DO UPDATE SET
          score = EXCLUDED.score,
          reglas_disparadas = EXCLUDED.reglas_disparadas,
          objeto = EXCLUDED.objeto,
          updated_at = NOW()
        RETURNING id
        """,
        (codigo_alerta, ocid, entidad_ruc, ganador_ruc, float(cuantia or 0),
         fecha_bp, region, score, reglas, objeto[:500] if objeto else "",
         codigo_conv, f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"),
    )
    alerta_id = cur.fetchone()[0]

    # Borrar banderas previas del compliance_agent para esta alerta y re-insertar
    cur.execute(
        "DELETE FROM banderas WHERE alerta_id = %s AND agente_origen = 'compliance_agent'",
        (alerta_id,),
    )
    for b in banderas:
        cur.execute(
            """
            INSERT INTO banderas (alerta_id, regla, severidad, evidencia,
                                  norma, fuente_url, agente_origen)
            VALUES (%s, %s, %s, %s, %s, %s, 'compliance_agent')
            ON CONFLICT DO NOTHING
            """,
            (alerta_id, b["regla"], b["severidad"], b["evidencia"],
             b["norma"], b["fuente_url"]),
        )
    return alerta_id


# ─── main ────────────────────────────────────────────────────────

def run(ocid: str) -> dict:
    print(f"\n▶ Compliance sobre {ocid}", flush=True)

    conn = connect()
    banderas_all: list[dict] = []
    try:
        with conn.cursor() as cur:
            # Verifica que existe
            cur.execute("SELECT codigo, objeto FROM convocatorias WHERE ocid = %s", (ocid,))
            row = cur.fetchone()
            if not row:
                print(f"✗ convocatoria {ocid} no existe en BD")
                print(f"  → corré primero: python backend/scripts/ingest/ingest_oece_one.py {ocid}")
                return {"error": "not_ingested"}
            print(f"  · {row[0]} · {row[1][:80] if row[1] else ''}", flush=True)

            for code, fn in REGLAS:
                hits = fn(cur, ocid)
                if hits:
                    print(f"  🚩 {code} → {len(hits)} bandera(s)", flush=True)
                    for h in hits:
                        print(f"     · [{h['severidad']}] {h['regla']}: {h['evidencia'][:90]}",
                              flush=True)
                    banderas_all.extend(hits)
                else:
                    print(f"  ✓ {code} → no disparó", flush=True)

            alerta_id = upsert_alerta_y_banderas(cur, ocid, banderas_all)
        conn.commit()
    finally:
        conn.close()

    score = compute_score(banderas_all)
    print(f"\n────────────────────────────────────────────")
    print(f"  Banderas totales: {len(banderas_all)}")
    print(f"  Score computado:  {score}/100")
    if alerta_id:
        print(f"  Alerta creada/actualizada: {alerta_id}")
        print(f"  Codigo:                    OECE-{ocid.split('-')[-1]}")
    else:
        print(f"  Sin alerta (no se dispararon reglas)")
    print(f"────────────────────────────────────────────\n")

    return {
        "ocid": ocid,
        "banderas": len(banderas_all),
        "score": score,
        "alerta_id": str(alerta_id) if alerta_id else None,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: python backend/scripts/detect/run_compliance.py <ocid>")
        return 1
    run(sys.argv[1])
    return 0


if __name__ == "__main__":
    sys.exit(main())
