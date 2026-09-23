#!/usr/bin/env python3
"""
Seed Cloud SQL con la data que ya tenemos:
  1. Entidades (de mocks.json)
  2. Alertas + banderas (de mocks.json)
  3. Reportes ciudadanos + convergencias (de mocks.json) → tabla `reportes_indexados`
  4. Expediente Chira Piura → convocatorias + items + postores + ofertas + documentos
  5. MEF region budget (de frontend/public/mef-budget.json)
  6. MEF entity budget (de frontend/public/mef-entities.json)

Uso:
  python backend/scripts/seed/seed_db.py            # seed completo
  python backend/scripts/seed/seed_db.py --reset    # TRUNCATE primero, después seed
  python backend/scripts/seed/seed_db.py --only mef # solo MEF, sin tocar lo otro
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import Json

ROOT = Path(__file__).resolve().parent.parent.parent.parent  # raíz del repo
PW_FILE = ROOT / ".cloudsql-password"
MOCKS_JSON = ROOT / "backend" / "scripts" / "seed" / "mocks.json"
MEF_BUDGET_JSON = ROOT / "frontend" / "public" / "mef-budget.json"
MEF_ENTITIES_JSON = ROOT / "frontend" / "public" / "mef-entities.json"

PG_HOST = os.getenv("PGHOST", "127.0.0.1")
PG_PORT = int(os.getenv("PGPORT", "5432"))
PG_USER = os.getenv("PGUSER", "postgres")
PG_DB = os.getenv("PGDATABASE", "vigia")
PG_SSLMODE = os.getenv("PGSSLMODE", "prefer")


# ─── Helpers ─────────────────────────────────────────────────────

def read_password() -> str:
    env = os.getenv("PGPASSWORD")
    if env:
        return env
    if not PW_FILE.exists():
        raise SystemExit(f"✗ Falta PGPASSWORD y no existe {PW_FILE}.")
    text = PW_FILE.read_text(encoding="utf-8").strip()
    m = re.search(r"password:\s*(\S+)", text, flags=re.IGNORECASE)
    if not m:
        raise SystemExit(f"✗ no pude parsear {PW_FILE}")
    return m.group(1)


def connect():
    return psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        user=PG_USER, password=read_password(),
        dbname=PG_DB, sslmode=PG_SSLMODE,
        connect_timeout=15,
    )


def slugify_region(s: str) -> str:
    """Normaliza nombre de región para hacer match a un departamento MEF."""
    return s.upper().replace("Á", "A").replace("É", "E").replace("Í", "I") \
        .replace("Ó", "O").replace("Ú", "U").replace("Ñ", "N")


# ─── Seed por bloques ───────────────────────────────────────────

def seed_entidades(conn, mocks: dict) -> int:
    """Inserta entidades del mock."""
    rows = mocks["entidades"]
    n = 0
    with conn.cursor() as cur:
        for e in rows:
            cur.execute(
                """
                INSERT INTO entidades (ruc, nombre, tipo, region, provincia, distrito, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (ruc) DO UPDATE SET
                  nombre = EXCLUDED.nombre,
                  tipo = EXCLUDED.tipo,
                  region = EXCLUDED.region,
                  provincia = EXCLUDED.provincia,
                  distrito = EXCLUDED.distrito,
                  metadata = EXCLUDED.metadata,
                  updated_at = NOW()
                """,
                (
                    e["ruc"], e["nombre"], e["tipo"],
                    e.get("region"), e.get("provincia"), e.get("distrito"),
                    Json({
                        "alertas_mock": e.get("alertas"),
                        "reportes_mock": e.get("reportes"),
                        "contratos": e.get("contratos"),
                        "contratos_vigilados": e.get("contratosVigilados"),
                        "monto_mock": e.get("monto"),
                        "score_promedio": e.get("scorePromedio"),
                        "serie_mock": e.get("serie"),
                    }),
                ),
            )
            n += 1
    conn.commit()
    return n


def seed_empresas_y_alertas(conn, mocks: dict) -> tuple[int, int, int]:
    """Crea empresas (proveedores) y alertas con sus banderas."""
    alertas = mocks["alertas"]
    n_emp, n_alt, n_band = 0, 0, 0

    with conn.cursor() as cur:
        # 1. Empresas (proveedores) — únicas por RUC
        empresas_vistas = {}
        for a in alertas:
            ruc = a["rucProveedor"]
            if ruc in empresas_vistas:
                continue
            empresas_vistas[ruc] = a["proveedor"]
            cur.execute(
                """
                INSERT INTO empresas (ruc, razon_social, estado_sunat, rnp_vigente, metadata)
                VALUES (%s, %s, 'ACTIVO', TRUE, %s)
                ON CONFLICT (ruc) DO NOTHING
                """,
                (
                    ruc, a["proveedor"],
                    Json({"edad_ruc_dias_mock": a.get("edadRucDias")}),
                ),
            )
            n_emp += 1

        # 2. Alertas
        for a in alertas:
            # ubicación geo
            geo_sql = "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography"
            cur.execute(
                f"""
                INSERT INTO alertas
                  (codigo, entidad_ruc, proveedor_ruc,
                   monto_adjudicado, fecha_buena_pro, region, score,
                   reglas_disparadas, ubicacion_geo, estado,
                   objeto, codigo_convocatoria, provincia, distrito,
                   unico_postor, edad_ruc_dias, fuente_url)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, {geo_sql}, 'activa',
                        %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (codigo) DO UPDATE SET
                  score = EXCLUDED.score,
                  reglas_disparadas = EXCLUDED.reglas_disparadas,
                  objeto = EXCLUDED.objeto,
                  codigo_convocatoria = EXCLUDED.codigo_convocatoria,
                  provincia = EXCLUDED.provincia,
                  distrito = EXCLUDED.distrito,
                  unico_postor = EXCLUDED.unico_postor,
                  edad_ruc_dias = EXCLUDED.edad_ruc_dias,
                  fuente_url = EXCLUDED.fuente_url,
                  updated_at = NOW()
                RETURNING id
                """,
                (
                    a["id"], a["rucEntidad"], a["rucProveedor"],
                    a["montoSoles"], a["fechaBuenaPro"], a["region"], a["score"],
                    [b["regla"] for b in a["banderas"]],
                    a["lon"], a["lat"],
                    a.get("objeto"), a.get("codigoconvocatoria"),
                    a.get("provincia"), a.get("distrito"),
                    a.get("unicoPostor"), a.get("edadRucDias"),
                    a.get("fuenteUrl"),
                ),
            )
            alerta_id = cur.fetchone()[0]
            n_alt += 1

            # 3. Banderas — borrar las viejas para esta alerta y re-insertar
            cur.execute("DELETE FROM banderas WHERE alerta_id = %s", (alerta_id,))
            for b in a["banderas"]:
                cur.execute(
                    """
                    INSERT INTO banderas
                      (alerta_id, regla, severidad, evidencia, norma, opinion_oece, fuente_url, agente_origen)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (
                        alerta_id, b["regla"], b["severidad"], b["evidencia"],
                        b["norma"], b.get("opinionOece"), b["fuenteUrl"], "compliance_agent",
                    ),
                )
                n_band += 1
    conn.commit()
    return (n_emp, n_alt, n_band)


def seed_reportes(conn, mocks: dict) -> tuple[int, int]:
    """Inserta reportes ciudadanos + convergencias."""
    reportes = mocks["reportes"]
    convergencias = mocks["convergencias"]
    n_rep, n_cnv = 0, 0

    with conn.cursor() as cur:
        for r in reportes:
            geo_sql = "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography"
            cur.execute(
                f"""
                INSERT INTO reportes_indexados
                  (id, categoria, descripcion, foto_url, ubicacion_geo, region,
                   fecha, confirmado, anonimo, moderacion_estado)
                VALUES (%s, %s, %s, %s, {geo_sql}, %s, %s, %s, TRUE, %s)
                ON CONFLICT (id) DO UPDATE SET
                  descripcion = EXCLUDED.descripcion,
                  confirmado = EXCLUDED.confirmado
                """,
                (
                    r["id"], r["categoria"], r["descripcion"], r.get("fotoUrl"),
                    r["lon"], r["lat"], r["region"], r["fecha"], r["confirmado"],
                    "aprobado" if r["confirmado"] else "pendiente",
                ),
            )
            n_rep += 1

        for c in convergencias:
            # convergencias.alertaId apunta al `codigo` de alertas (ALT-2026-...)
            cur.execute(
                "SELECT id FROM alertas WHERE codigo = %s",
                (c["alertaId"],),
            )
            row = cur.fetchone()
            if not row:
                print(f"⚠ convergencia {c['id']}: alerta {c['alertaId']} no existe", flush=True)
                continue
            alerta_uuid = row[0]
            geo_sql = "ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography"
            cur.execute(
                f"""
                INSERT INTO convergencias
                  (id, alerta_id, reporte_ids, ubicacion_geo, resumen, radio_match_m, delta_dias)
                VALUES (%s, %s, %s, {geo_sql}, %s, 500, 90)
                ON CONFLICT (id) DO UPDATE SET
                  reporte_ids = EXCLUDED.reporte_ids,
                  resumen = EXCLUDED.resumen
                """,
                (
                    c["id"], alerta_uuid, c["reporteIds"],
                    c["lon"], c["lat"], c["resumen"],
                ),
            )
            n_cnv += 1
    conn.commit()
    return (n_rep, n_cnv)


def seed_expediente(conn, mocks: dict) -> dict:
    """Inserta el caso Chira Piura como convocatoria + items + postores + ofertas + documentos."""
    e = mocks["expediente_chira_piura"]
    counts = {"convocatorias": 0, "items": 0, "postores": 0, "ofertas": 0, "documentos": 0, "empresas": 0}

    with conn.cursor() as cur:
        # 0. Asegurar que la entidad PECHP exista
        ent = e["entidad"]
        cur.execute(
            """
            INSERT INTO entidades (ruc, nombre, tipo, region, metadata)
            VALUES (%s, %s, 'organismo_autonomo', 'Piura', %s)
            ON CONFLICT (ruc) DO NOTHING
            """,
            (ent["ruc"], ent["nombre"], Json({"ubicacion": ent.get("ubicacion")})),
        )

        # 1. Convocatoria — OCID sintético basado en codigoProceso
        ocid = f"ocds-vigia-{e['codigoProceso']}"
        cur.execute(
            """
            INSERT INTO convocatorias
              (ocid, codigo, entidad_ruc, objeto, tipo_proceso, modalidad_pago,
               cuantia_referencial, fuente_financiamiento,
               fecha_convocatoria, fecha_buena_pro, region, ocds_payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (ocid) DO UPDATE SET
              cuantia_referencial = EXCLUDED.cuantia_referencial,
              updated_at = NOW()
            """,
            (
                ocid, e["codigoProceso"], ent["ruc"], e["objeto"],
                e["tipoProceso"], e["modalidadPago"],
                e["cuantiaTotal"], e["fuenteFinanciamiento"],
                e["fechaConvocatoria"], e["fechaBuenaPro"], "Piura",
                Json({"fundamento_legal": e["fundamentoLegal"]}),
            ),
        )
        counts["convocatorias"] = 1

        # 2. Items (limpiar primero por idempotencia)
        cur.execute("DELETE FROM convocatoria_items WHERE ocid = %s", (ocid,))
        item_id_by_num = {}
        for it in e["items"]:
            cur.execute(
                """
                INSERT INTO convocatoria_items
                  (ocid, numero_item, descripcion, descripcion_corta, cantidad,
                   unidad, cuantia_referencial, precio_unit_ref, especs_tecnicas)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    ocid, it["numero"], it["descripcion"], it["descripcionCorta"],
                    it["cantidad"], it["unidad"], it["cuantiaReferencial"],
                    it["precioUnitarioReferencial"],
                    Json({
                        "specs_red_flag": it.get("especsRedFlag"),
                        "market_ref": it.get("marketRef"),
                    }),
                ),
            )
            item_id_by_num[it["numero"]] = cur.fetchone()[0]
            counts["items"] += 1

        # 3. Empresas postoras + postores + ofertas
        cur.execute("DELETE FROM postores WHERE ocid = %s", (ocid,))
        for p in e["postores"]:
            cur.execute(
                """
                INSERT INTO empresas (ruc, razon_social, estado_sunat, rnp_vigente)
                VALUES (%s, %s, 'ACTIVO', %s)
                ON CONFLICT (ruc) DO NOTHING
                """,
                (p["ruc"], p["razonSocial"], p["rnpVigente"]),
            )
            counts["empresas"] += 1

            cur.execute(
                """
                INSERT INTO postores (ocid, empresa_ruc, tipo, rnp_vigente)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (ocid, empresa_ruc) DO UPDATE SET
                  tipo = EXCLUDED.tipo
                RETURNING id
                """,
                (ocid, p["ruc"], p["tipo"], p["rnpVigente"]),
            )
            postor_id = cur.fetchone()[0]
            counts["postores"] += 1

            for o in p["ofertas"]:
                cur.execute(
                    """
                    INSERT INTO ofertas
                      (postor_id, item_id, monto_ofertado, porcentaje_referencial,
                       admitida, calificada, ganadora)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        postor_id, item_id_by_num[o["itemNumero"]],
                        o["montoOfertado"], o["porcentajeReferencial"],
                        o["admitida"], o["calificada"], o["ganador"],
                    ),
                )
                counts["ofertas"] += 1

        # 4. Documentos
        cur.execute("DELETE FROM documentos WHERE ocid = %s", (ocid,))
        for d in e["documentos"]:
            cur.execute(
                """
                INSERT INTO documentos
                  (ocid, tipo, nombre, blob_url, fecha, paginas,
                   resumen_agente, agente_version)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    ocid, d["tipo"], d["nombre"], d["url"],
                    d["fecha"], d.get("paginas"),
                    d.get("resumenAgente"), d.get("agente"),
                ),
            )
            counts["documentos"] += 1

    conn.commit()
    return counts


def seed_mef_region(conn) -> int:
    if not MEF_BUDGET_JSON.exists():
        print(f"⚠ {MEF_BUDGET_JSON.name} no existe, salteo")
        return 0
    data = json.loads(MEF_BUDGET_JSON.read_text(encoding="utf-8"))
    n = 0
    with conn.cursor() as cur:
        for dept, payload in data.items():
            cur.execute(
                """
                INSERT INTO mef_region_budget
                  (departamento, total_rows, by_year, top_sectores, top_pliegos,
                   top_programas, top_genericas, last_refreshed)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (departamento) DO UPDATE SET
                  total_rows = EXCLUDED.total_rows,
                  by_year = EXCLUDED.by_year,
                  top_sectores = EXCLUDED.top_sectores,
                  top_pliegos = EXCLUDED.top_pliegos,
                  top_programas = EXCLUDED.top_programas,
                  top_genericas = EXCLUDED.top_genericas,
                  last_refreshed = NOW()
                """,
                (
                    dept, payload.get("totalRows", 0),
                    Json(payload.get("byYear", [])),
                    Json(payload.get("topSectores", [])),
                    Json(payload.get("topPliegos", [])),
                    Json(payload.get("topProgramas", [])),
                    Json(payload.get("topGenericas", [])),
                ),
            )
            n += 1
    conn.commit()
    return n


def seed_mef_entities(conn) -> int:
    if not MEF_ENTITIES_JSON.exists():
        print(f"⚠ {MEF_ENTITIES_JSON.name} no existe, salteo")
        return 0
    data = json.loads(MEF_ENTITIES_JSON.read_text(encoding="utf-8"))
    n = 0
    with conn.cursor() as cur:
        for ruc, payload in data.items():
            # Verifica que la entidad exista (FK) — si no, omite
            cur.execute("SELECT 1 FROM entidades WHERE ruc = %s", (ruc,))
            if not cur.fetchone():
                continue
            cur.execute(
                """
                INSERT INTO mef_entity_budget
                  (entidad_ruc, keyword, total_rows, by_year, matched_pliegos, kind, last_refreshed)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (entidad_ruc) DO UPDATE SET
                  keyword = EXCLUDED.keyword,
                  total_rows = EXCLUDED.total_rows,
                  by_year = EXCLUDED.by_year,
                  matched_pliegos = EXCLUDED.matched_pliegos,
                  kind = EXCLUDED.kind,
                  last_refreshed = NOW()
                """,
                (
                    ruc, payload.get("keyword"),
                    payload.get("totalRows", 0),
                    Json(payload.get("byYear", [])),
                    payload.get("matchedPliegos", []),
                    payload.get("kind", "ok"),
                ),
            )
            n += 1
    conn.commit()
    return n


# ─── Main ─────────────────────────────────────────────────────

RESET_ORDER = [
    # respeta FKs
    "ofertas", "postores", "convocatoria_items", "documentos",
    "convergencias", "reportes_indexados",
    "banderas", "persona_flags", "network_expansions", "alertas",
    "mef_entity_budget", "mef_region_budget",
    "convocatorias", "empresa_personas", "empresas", "entidades",
]


def reset_data(conn):
    print("→ TRUNCATE (orden respetando FKs)…", flush=True)
    with conn.cursor() as cur:
        for tbl in RESET_ORDER:
            cur.execute(f"TRUNCATE TABLE {tbl} CASCADE")
    conn.commit()
    print("  ✓ tablas vacías", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="TRUNCATE tablas antes de seed")
    ap.add_argument("--only", choices=["entidades", "alertas", "reportes", "expediente", "mef_region", "mef_entities"])
    args = ap.parse_args()

    if not MOCKS_JSON.exists():
        raise SystemExit(f"✗ {MOCKS_JSON} no existe. Corré: cd frontend && npx tsx scripts/dump-mocks.ts > ../backend/scripts/seed/mocks.json")

    mocks = json.loads(MOCKS_JSON.read_text(encoding="utf-8"))
    print(f"→ mocks cargados: {len(mocks['entidades'])} entidades, {len(mocks['alertas'])} alertas, {len(mocks['reportes'])} reportes", flush=True)

    conn = connect()
    print(f"✓ conectado a {PG_DB}@{PG_HOST}\n", flush=True)

    if args.reset:
        reset_data(conn)

    def should(name): return args.only is None or args.only == name

    if should("entidades"):
        n = seed_entidades(conn, mocks)
        print(f"✓ entidades: {n}", flush=True)
    if should("alertas"):
        e, a, b = seed_empresas_y_alertas(conn, mocks)
        print(f"✓ empresas proveedoras: {e} · alertas: {a} · banderas: {b}", flush=True)
    if should("reportes"):
        r, c = seed_reportes(conn, mocks)
        print(f"✓ reportes: {r} · convergencias: {c}", flush=True)
    if should("expediente"):
        counts = seed_expediente(conn, mocks)
        print(f"✓ expediente Chira Piura: {counts}", flush=True)
    if should("mef_region"):
        n = seed_mef_region(conn)
        print(f"✓ mef_region_budget: {n} departamentos", flush=True)
    if should("mef_entities"):
        n = seed_mef_entities(conn)
        print(f"✓ mef_entity_budget: {n} entidades", flush=True)

    # Resumen de la BD
    print("\n→ totales en BD:")
    with conn.cursor() as cur:
        for tbl in ["entidades", "empresas", "alertas", "banderas",
                    "reportes_indexados", "convergencias",
                    "convocatorias", "convocatoria_items", "postores", "ofertas",
                    "documentos", "mef_region_budget", "mef_entity_budget"]:
            cur.execute(f"SELECT COUNT(*) FROM {tbl}")
            print(f"  · {tbl}: {cur.fetchone()[0]}")

    conn.close()
    print("\n✓ seed completo")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
