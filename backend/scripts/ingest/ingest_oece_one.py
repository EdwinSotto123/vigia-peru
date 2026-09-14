#!/usr/bin/env python3
"""
Ingesta UNA convocatoria del OECE a Cloud SQL.

Uso:
  python backend/scripts/ingest/ingest_oece_one.py <ocid>
  python backend/scripts/ingest/ingest_oece_one.py ocds-dgv273-seacev3-1202858

Qué hace, en orden:
  1. Pide el `compiledRelease` al OECE OCDS API
  2. Extrae el RUC real del buyer (de additionalIdentifiers)
  3. Para el buyer + cada supplier:
     · Llama decolecta para enriquecer (estado SUNAT, dirección, actividad)
     · UPSERT en entidades / empresas
  4. UPSERT en convocatorias (con ocds_payload completo en JSONB)
  5. INSERT en convocatoria_items con classification CUBSO
  6. INSERT en postores (uno por supplier) + ofertas (de awards)
  7. INSERT en documentos con URL directa al PDF de SEACE
  8. Imprime resumen para verificación

Idempotente — corre N veces, queda el mismo resultado.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

from psycopg2.extras import Json

# soporte para correr desde la raíz: agregamos al path
THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

from lib.pg import connect              # noqa: E402
from lib.decolecta import consultar_ruc # noqa: E402
from lib import oece                    # noqa: E402


# ─── helpers ────────────────────────────────────────────────────

def slug_region(name: str | None) -> str | None:
    """Normaliza región: 'PIURA' → 'Piura', 'ÁNCASH' → 'Áncash', etc."""
    if not name:
        return None
    name = name.strip().title()
    name = name.replace("Ancash", "Áncash").replace("Junin", "Junín")
    return name


def tipo_entidad(nombre: str | None) -> str:
    """Mapeo heurístico nombre → tipo."""
    if not nombre:
        return "organismo_autonomo"
    u = nombre.upper()
    if "MINISTERIO" in u or "MINSA" in u or "MINEDU" in u:
        return "ministerio"
    if "GOBIERNO REGIONAL" in u or "PROYECTO ESPECIAL" in u:
        return "gobierno_regional"
    if "MUNICIPALIDAD" in u:
        if "DISTRITAL" in u or "MUN. DIST" in u:
            return "municipal_distrital"
        return "municipal_provincial"
    if any(x in u for x in ("S.A.", "SAC", "S.A.C", "EMPRESA")):
        return "empresa_publica"
    return "organismo_autonomo"


def parse_decolecta_address(d: dict) -> tuple[str | None, str | None, str | None, str | None]:
    """Devuelve (region, provincia, distrito, direccion)."""
    if not d:
        return (None, None, None, None)
    return (
        slug_region(d.get("departamento")),
        d.get("provincia", "").title() or None,
        d.get("distrito", "").title() or None,
        d.get("direccion") or None,
    )


# ─── upserts ────────────────────────────────────────────────────

def upsert_entidad(cur, ruc: str, nombre: str, sunat: dict | None) -> None:
    """Crea/actualiza una entidad con datos del OCDS + decolecta."""
    region, provincia, distrito, direccion = parse_decolecta_address(sunat)
    estado = sunat.get("estado") if sunat else None
    tipo = tipo_entidad(nombre)

    cur.execute(
        """
        INSERT INTO entidades (ruc, nombre, tipo, region, provincia, distrito, estado_sunat, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (ruc) DO UPDATE SET
          nombre = EXCLUDED.nombre,
          tipo = COALESCE(entidades.tipo, EXCLUDED.tipo),
          region = COALESCE(entidades.region, EXCLUDED.region),
          provincia = COALESCE(entidades.provincia, EXCLUDED.provincia),
          distrito = COALESCE(entidades.distrito, EXCLUDED.distrito),
          estado_sunat = COALESCE(EXCLUDED.estado_sunat, entidades.estado_sunat),
          metadata = COALESCE(entidades.metadata, '{}'::jsonb) || EXCLUDED.metadata,
          updated_at = NOW()
        """,
        (ruc, nombre, tipo, region, provincia, distrito, estado,
         Json({"sunat_full": sunat, "direccion_fiscal": direccion} if sunat else {})),
    )


def upsert_empresa(cur, ruc: str, razon_social: str, sunat: dict | None) -> None:
    """Crea/actualiza un proveedor con datos SUNAT."""
    estado = sunat.get("estado") if sunat else None
    condicion = sunat.get("condicion") if sunat else None
    direccion = sunat.get("direccion") if sunat else None
    actividad = sunat.get("actividad_economica") if sunat else None
    es_agente = sunat.get("es_agente_retencion") if sunat else None
    es_buen = sunat.get("es_buen_contribuyente") if sunat else None
    n_trabajadores = sunat.get("numero_trabajadores") if sunat else None
    comercio_ext = sunat.get("comercio_exterior") if sunat else None

    cur.execute(
        """
        INSERT INTO empresas (ruc, razon_social, estado_sunat, domicilio_fiscal,
                              actividad_economica, rnp_vigente, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (ruc) DO UPDATE SET
          razon_social = EXCLUDED.razon_social,
          estado_sunat = COALESCE(EXCLUDED.estado_sunat, empresas.estado_sunat),
          domicilio_fiscal = COALESCE(EXCLUDED.domicilio_fiscal, empresas.domicilio_fiscal),
          actividad_economica = COALESCE(EXCLUDED.actividad_economica, empresas.actividad_economica),
          metadata = COALESCE(empresas.metadata, '{}'::jsonb) || EXCLUDED.metadata,
          updated_at = NOW()
        """,
        (ruc, razon_social, estado, direccion, actividad,
         True,  # asumimos RNP vigente porque ganó OECE
         Json({
             "condicion_sunat": condicion,
             "es_agente_retencion": es_agente,
             "es_buen_contribuyente": es_buen,
             "numero_trabajadores": n_trabajadores,
             "comercio_exterior": comercio_ext,
             "locales_anexos_count": len((sunat.get("locales_anexos") or []) if sunat else []),
         } if sunat else {})),
    )


def upsert_convocatoria(cur, cr: dict) -> str:
    ocid = cr["ocid"]
    buyer_r = oece.buyer_ruc(cr)
    tender = cr.get("tender", {}) or {}
    objeto = tender.get("description") or tender.get("title") or ""
    tipo_proceso = tender.get("procurementMethodDetails") or "Desconocido"

    cur.execute(
        """
        INSERT INTO convocatorias
          (ocid, codigo, entidad_ruc, objeto, tipo_proceso,
           cuantia_referencial, fecha_convocatoria, fecha_buena_pro,
           region, ocds_payload)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (ocid) DO UPDATE SET
          objeto = EXCLUDED.objeto,
          tipo_proceso = EXCLUDED.tipo_proceso,
          cuantia_referencial = EXCLUDED.cuantia_referencial,
          fecha_buena_pro = EXCLUDED.fecha_buena_pro,
          ocds_payload = EXCLUDED.ocds_payload,
          updated_at = NOW()
        """,
        (
            ocid,
            oece.codigo_convocatoria(ocid),
            buyer_r,
            objeto[:2000],
            tipo_proceso,
            oece.tender_value(cr),
            oece.fecha_convocatoria(cr),
            oece.fecha_buena_pro(cr),
            slug_region(oece.region_from_buyer(cr)),
            Json(cr),
        ),
    )
    return ocid


def upsert_items(cur, ocid: str, items: list[dict]) -> int:
    cur.execute("DELETE FROM convocatoria_items WHERE ocid = %s", (ocid,))
    n = 0
    for it in items:
        cur.execute(
            """
            INSERT INTO convocatoria_items
              (ocid, numero_item, descripcion, descripcion_corta, cantidad,
               unidad, cuantia_referencial, precio_unit_ref, cubso, especs_tecnicas)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                ocid,
                int(it.get("position") or n + 1),
                it.get("description") or "",
                (it.get("description") or "")[:80],
                float(it.get("quantity") or 0),
                ((it.get("unit") or {}).get("name")) or "UND",
                float((it.get("totalValue") or {}).get("amount") or 0),
                (
                    float((it.get("totalValue") or {}).get("amount") or 0)
                    / max(float(it.get("quantity") or 1), 1)
                ),
                ((it.get("classification") or {}).get("id")),
                Json({
                    "classification": it.get("classification"),
                    "additionalClassifications": it.get("additionalClassifications", []),
                    "status": it.get("status"),
                    "statusDetails": it.get("statusDetails"),
                }),
            ),
        )
        n += 1
    return n


def upsert_postores_y_ofertas(cur, ocid: str, cr: dict) -> tuple[int, int]:
    """Crea postores (1 por supplier) y ofertas (1 por award.item)."""
    sups = oece.suppliers(cr)
    aws = oece.awards(cr)

    # Borrar previos para idempotencia
    cur.execute("DELETE FROM postores WHERE ocid = %s", (ocid,))

    # Crear postores
    postor_id_by_ruc: dict[str, int] = {}
    for s in sups:
        cur.execute(
            """
            INSERT INTO postores (ocid, empresa_ruc, tipo, rnp_vigente)
            VALUES (%s, %s, 'persona_juridica', TRUE)
            RETURNING id
            """,
            (ocid, s["ruc"]),
        )
        postor_id_by_ruc[s["ruc"]] = cur.fetchone()[0]

    # Crear ofertas (sólo las ganadoras vienen en awards)
    n_ofertas = 0
    for a in aws:
        # award.suppliers tiene IDs como "PE-RUC-XXXXXXXXXXX"
        winners = [s.get("id", "").replace("PE-RUC-", "") for s in (a.get("suppliers") or [])]
        for ruc in winners:
            postor_id = postor_id_by_ruc.get(ruc)
            if not postor_id:
                continue
            for it in (a.get("items") or []):
                # Buscar el item_id real en convocatoria_items
                cur.execute(
                    "SELECT id, cuantia_referencial FROM convocatoria_items WHERE ocid = %s AND cubso = %s",
                    (ocid, ((it.get("classification") or {}).get("id"))),
                )
                row = cur.fetchone()
                if not row:
                    continue
                item_id, cuantia_ref = row
                monto = float((it.get("totalValue") or {}).get("amount") or 0)
                pct_ref = (
                    (monto / float(cuantia_ref) * 100)
                    if cuantia_ref and float(cuantia_ref) > 0 else 0
                )
                cur.execute(
                    """
                    INSERT INTO ofertas (postor_id, item_id, monto_ofertado,
                                         porcentaje_referencial, admitida, calificada, ganadora)
                    VALUES (%s, %s, %s, %s, TRUE, TRUE, TRUE)
                    """,
                    (postor_id, item_id, monto, round(pct_ref, 3)),
                )
                n_ofertas += 1
    return (len(sups), n_ofertas)


OCDS_DOC_TYPE_MAP = {
    "biddingDocuments": "bases",
    "technicalSpecifications": "expediente_tecnico",
    "awardNotice": "acta_buena_pro",
    "evaluationReports": "reporte_buena_pro",
    "contractSigned": "contrato",
    "contractAmendment": "adenda",
    "physicalProgressReports": "otro",
    "financialProgressReports": "otro",
    "clarifications": "otro",
    "procurementPlan": "otro",
}


def upsert_documentos(cur, ocid: str, docs: list[dict]) -> int:
    cur.execute("DELETE FROM documentos WHERE ocid = %s", (ocid,))
    n = 0
    for d in docs:
        cur.execute(
            """
            INSERT INTO documentos (ocid, tipo, nombre, blob_url, fecha, metadata)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                ocid,
                OCDS_DOC_TYPE_MAP.get(d.get("documentType"), "otro"),
                d.get("title") or "(sin título)",
                d.get("url"),
                (d.get("datePublished") or "")[:10] or None,
                Json({
                    "ocds_documentType": d.get("documentType"),
                    "format": d.get("format"),
                    "language": d.get("language"),
                    "ocds_id": d.get("id"),
                }),
            ),
        )
        n += 1
    return n


# ─── flow principal ─────────────────────────────────────────────

def ingest_one(ocid: str) -> dict:
    print(f"\n▶ Ingestando {ocid}", flush=True)
    print(f"  1/6 fetching OECE OCDS…", flush=True)
    cr = oece.fetch_record(ocid)
    if not cr:
        raise SystemExit(f"✗ OCID {ocid} no encontrado en OECE")

    buyer_r = oece.buyer_ruc(cr)
    buyer_n = oece.buyer_name(cr)
    sups = oece.suppliers(cr)
    print(f"  ✓ buyer={buyer_r} ({buyer_n[:50] if buyer_n else '?'})", flush=True)
    print(f"  ✓ {len(sups)} suppliers · {len(oece.tender_items(cr))} items · "
          f"{len(oece.tender_documents(cr))} docs · {len(oece.awards(cr))} awards",
          flush=True)

    print(f"  2/6 consultando SUNAT (decolecta)…", flush=True)
    sunat_buyer = consultar_ruc(buyer_r) if buyer_r else None
    if sunat_buyer:
        print(f"    · buyer SUNAT: {sunat_buyer.get('estado')} · "
              f"{sunat_buyer.get('condicion')}", flush=True)
    sunat_sups = {}
    for s in sups:
        sunat = consultar_ruc(s["ruc"])
        sunat_sups[s["ruc"]] = sunat
        if sunat:
            print(f"    · {s['ruc']} {sunat.get('estado')} · "
                  f"{sunat.get('actividad_economica', '')[:40]}", flush=True)

    print(f"  3/6 escribiendo en Cloud SQL…", flush=True)
    conn = connect()
    try:
        with conn.cursor() as cur:
            if buyer_r:
                upsert_entidad(cur, buyer_r, buyer_n, sunat_buyer)
            for s in sups:
                upsert_empresa(cur, s["ruc"], s["name"], sunat_sups.get(s["ruc"]))

            ocid_saved = upsert_convocatoria(cur, cr)
            n_items = upsert_items(cur, ocid_saved, oece.tender_items(cr))
            n_postores, n_ofertas = upsert_postores_y_ofertas(cur, ocid_saved, cr)
            n_docs = upsert_documentos(cur, ocid_saved, oece.tender_documents(cr))
        conn.commit()
    finally:
        conn.close()

    print(f"  ✓ convocatoria + {n_items} items + {n_postores} postores + "
          f"{n_ofertas} ofertas + {n_docs} docs", flush=True)

    print(f"  4/6 verificación…", flush=True)
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.codigo, c.cuantia_referencial, c.fecha_buena_pro,
                       e.nombre, COUNT(DISTINCT p.id), COUNT(DISTINCT i.id),
                       COUNT(DISTINCT d.id)
                  FROM convocatorias c
                  LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
                  LEFT JOIN postores p ON p.ocid = c.ocid
                  LEFT JOIN convocatoria_items i ON i.ocid = c.ocid
                  LEFT JOIN documentos d ON d.ocid = c.ocid
                  WHERE c.ocid = %s
                  GROUP BY c.codigo, c.cuantia_referencial, c.fecha_buena_pro, e.nombre
                """,
                (ocid,),
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if row:
        print(f"    código={row[0]} · cuantía=S/. {row[1]:,.0f} · "
              f"BP={row[2]} · entidad={row[3][:40] if row[3] else '?'}", flush=True)
        print(f"    en BD: {row[4]} postores · {row[5]} items · {row[6]} docs", flush=True)

    print(f"\n✓ {ocid} ingestado · ahora podés correr:", flush=True)
    print(f"  python backend/scripts/detect/run_compliance.py {ocid}", flush=True)
    return {"ocid": ocid, "buyer_ruc": buyer_r, "n_items": n_items,
            "n_postores": n_postores, "n_ofertas": n_ofertas, "n_docs": n_docs}


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: python backend/scripts/ingest/ingest_oece_one.py <ocid>")
        print("Ej:  python backend/scripts/ingest/ingest_oece_one.py ocds-dgv273-seacev3-1202858")
        return 1
    ingest_one(sys.argv[1])
    return 0


if __name__ == "__main__":
    sys.exit(main())
