"""Tools del dominio: ocds."""

from tools._core import *  # noqa: F401,F403
from tools._core import downloader_base

# El OCID OECE tiene DOS esquemas: flat ('ocds-dgv273-seacev3-1221284') y
# año-secuencia ('ocds-dgv273-seacev3-2026-10404-12'). En el 2º, el número de
# convocatoria (ej. 1195235) es el `tender.id`, NO el sufijo del OCID. Si alguien
# usa el `tender.id` como si fuera el OCID, OECE devuelve 404.
_OCID_HINT = ("El número ingresado podría ser el `tender.id` (código de convocatoria SEACE), "
              "no el OCID. Algunos procesos usan OCID con formato año-secuencia "
              "(ej. ocds-dgv273-seacev3-2026-10404-12). Buscá el OCID real en el portal OECE "
              "(contratacionesabiertas.oece.gob.pe) e ingresalo completo.")


def fetch_ocds_record(ocid: str, tool_context: ToolContext) -> dict:
    """Obtiene el OCDS record desde el OECE para una convocatoria.
    Si el caller pre-cargó el OCDS en state, lo usa para evitar el WAF de OECE
    que bloquea IPs de GCP.

    Args:
        ocid: Identificador OCDS, ej. 'ocds-dgv273-seacev3-1203694' o sólo
              el código numérico '1203694'.

    Returns:
        Diccionario con buyer_nombre, buyer_ruc, objeto, tipo_proceso,
        cuantia, fecha_buena_pro, n_items, n_postores, n_documentos, suppliers.
    """
    # El input puede ser el OCID completo, el sufijo flat ('1221284') o el sufijo
    # año-secuencia ('2026-10404-12'). Anteponemos el prefijo a CUALQUIER sufijo que
    # empiece con dígito (antes solo a los puramente numéricos → los año-secuencia,
    # que llevan guiones, NO recibían prefijo y daban 404 aun pasando el OCID correcto).
    if ocid and not str(ocid).startswith("ocds-") and re.match(r"^\d", str(ocid)):
        ocid = f"ocds-dgv273-seacev3-{ocid}"

    cr = tool_context.state.get("ocds_preloaded") or tool_context.state.get("ocds")
    if not cr:
        import os
        rec_url = f"{OECE_BASE}/record/{ocid}"
        raw = None
        # 1) Puente local (IP residencial PE) — OECE bloquea datacenter con 403.
        #    Si está configurado, traemos la metadata por la IP del usuario.
        dl_base = downloader_base()
        if dl_base:
            try:
                fr = requests.post(
                    f"{dl_base.rstrip('/')}/fetch",
                    json={"url": rec_url},
                    headers={"X-Vigia-Token": os.getenv("LOCAL_DOWNLOADER_TOKEN", "")},
                    timeout=60,
                )
                if fr.status_code == 200:
                    data = fr.json() or {}
                    if data.get("ok") and data.get("body"):
                        raw = json.loads(data["body"])
            except Exception:
                raw = None  # caemos al directo
        # 2) Directo (suele dar 403 desde GCP — fallback)
        if raw is None:
            try:
                r = requests.get(rec_url, headers=BROWSER, timeout=30)
                if r.status_code != 200:
                    return {"error": f"OECE HTTP {r.status_code}", "ocid": ocid,
                            "hint": _OCID_HINT if r.status_code == 404 else ""}
                raw = r.json()
            except Exception as e:
                return {"error": f"fetch failed: {e}", "ocid": ocid}
        recs = (raw or {}).get("records") or []
        cr = recs[0].get("compiledRelease") if recs else None

    if not cr:
        return {"error": "no OCDS record", "ocid": ocid, "hint": _OCID_HINT}

    tool_context.state["ocds"] = cr
    # state['ocid'] siempre en formato corto para consistencia con SQL
    tool_context.state["ocid"] = _short_ocid(cr.get("ocid") or ocid)

    tender = cr.get("tender") or {}
    parties = cr.get("parties") or []
    buyer_ruc = None
    for p in parties:
        if "buyer" in (p.get("roles") or []):
            for ai in (p.get("additionalIdentifiers") or []):
                if ai.get("scheme") == "PE-RUC":
                    buyer_ruc = ai["id"]; break
            break

    suppliers = [
        {"ruc": (p.get("identifier") or {}).get("id"), "name": p.get("name")}
        for p in parties
        if "supplier" in (p.get("roles") or [])
        and (p.get("identifier") or {}).get("scheme") == "PE-RUC"
    ]
    return {
        "ocid": cr.get("ocid"),
        "buyer_nombre": (cr.get("buyer") or {}).get("name"),
        "buyer_ruc": buyer_ruc,
        "objeto": (tender.get("description") or tender.get("title") or "")[:300],
        "tipo_proceso": tender.get("procurementMethodDetails"),
        "cuantia": float((tender.get("value") or {}).get("amount") or 0),
        "fecha_buena_pro": ((cr.get("awards") or [{}])[0].get("date") or "")[:10] or None,
        "n_items": len(tender.get("items") or []),
        "n_postores": len([p for p in parties if "tenderer" in (p.get("roles") or [])]),
        "n_documentos": len(tender.get("documents") or []),
        "suppliers": suppliers,
    }

def get_ganador(ocid: str, tool_context: ToolContext) -> dict:
    """Lee LITERAL del OCDS quién es el proveedor adjudicado (ganador) y la
    entidad contratante. Usar SIEMPRE esta tool en vez de "recordar" RUCs de
    turns previos — Gemini ha alucinado RUCs alternativos entre turns largos.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        dict con:
          · ganador: { ruc, razon_social, monto_ganado } o null si sin adjudicación
          · todos_postores: lista de { ruc, razon_social, es_ganador }
          · entidad: { ruc, nombre, region }
          · n_postores: int
    """
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    if not ocds:
        return {"error": "no_ocds_en_state", "hint": "Llamá fetch_ocds_record primero."}

    parties = ocds.get("parties") or []
    awards = ocds.get("awards") or []
    tender = ocds.get("tender") or {}

    # Map RUC → suppliers/awards
    winning_rucs: dict[str, float] = {}
    for a in awards:
        for s in (a.get("suppliers") or []):
            sid = (s.get("id") or "").replace("PE-RUC-", "")
            if sid:
                winning_rucs[sid] = winning_rucs.get(sid, 0) + float(a.get("value", {}).get("amount") or 0)

    todos_postores: list[dict] = []
    ganador: dict | None = None
    for p in parties:
        roles = p.get("roles") or []
        if "supplier" not in roles and "tenderer" not in roles:
            continue
        ident = p.get("identifier") or {}
        ruc = ident.get("id") if ident.get("scheme") == "PE-RUC" else (p.get("id") or "").replace("PE-RUC-", "")
        razon_social = p.get("name") or ident.get("legalName") or ""
        es_ganador = ruc in winning_rucs
        item = {"ruc": ruc, "razon_social": razon_social, "es_ganador": es_ganador}
        if es_ganador:
            item["monto_ganado"] = winning_rucs.get(ruc, 0)
            if not ganador:
                ganador = item.copy()
        todos_postores.append(item)

    # Entidad contratante
    entidad = {}
    for p in parties:
        if "buyer" in (p.get("roles") or []):
            addr = p.get("address") or {}
            ai = next((x for x in (p.get("additionalIdentifiers") or [])
                       if x.get("scheme") == "PE-RUC"), {})
            entidad = {
                "ruc": ai.get("id") or (p.get("id") or "").replace("PE-RUC-", "") or None,
                "nombre": p.get("name") or "",
                "region": addr.get("region") or addr.get("department") or None,
            }
            break

    # Si el ganador es persona natural (RUC empieza con '10'), extraer el DNI
    # subyacente — los dígitos 3-10 del RUC peruano persona natural son el DNI
    # de la persona. Ej: RUC 10444256279 → DNI 44425627.
    # Esto permite al orchestrator llamar `detect_puerta_giratoria(dni)` y
    # `detect_aporte_a_partido_del_alcalde(dni)` sin pedírselo al LLM.
    if ganador and ganador.get("ruc"):
        ruc_g = str(ganador["ruc"])
        if len(ruc_g) == 11 and ruc_g.startswith("10"):
            ganador["dni_persona_natural"] = ruc_g[2:10]

    return {
        "ganador": ganador,
        "todos_postores": todos_postores,
        "n_postores": len(todos_postores),
        "entidad": entidad,
        "ocid": ocid,
        "hint": (
            "USAR LITERAL ESTOS VALORES. NUNCA inventes un RUC distinto al de "
            "`ganador.ruc`. Si `ganador.dni_persona_natural` está poblado, "
            "el ganador es persona natural — usá ese DNI (8 dígitos) para "
            "llamar `detect_puerta_giratoria` y `detect_aporte_a_partido_del_alcalde`."
        ),
    }

def register_convocatoria_in_db(ocid: str, tool_context: ToolContext) -> dict:
    """Guarda la convocatoria fetcheada en Cloud SQL.

    Args:
        ocid: OCID de la convocatoria que ya fue fetcheada con fetch_ocds_record.
              Se acepta tanto el formato corto ('1212841') como el largo
              ('ocds-dgv273-seacev3-1212841'); internamente se normaliza al
              formato CORTO para mantener consistencia con `convocatoria_items`
              y la FK `alertas_ocid_fkey`.

    Returns:
        Diccionario con ok, ocid_saved, n_items, n_postores, n_docs.
    """
    # Normalizar al formato corto — bug histórico: la tabla tiene mezcla de
    # formatos largo/corto y eso rompe la FK alertas_ocid_fkey downstream.
    ocid = _short_ocid(ocid)
    cr = tool_context.state.get("ocds")
    if not cr:
        return {"error": "ocds no en state - llamá fetch_ocds_record primero"}

    tender = cr.get("tender") or {}
    parties = cr.get("parties") or []
    buyer_ruc = None
    buyer_name = (cr.get("buyer") or {}).get("name") or ""
    for p in parties:
        if "buyer" in (p.get("roles") or []):
            for ai in (p.get("additionalIdentifiers") or []):
                if ai.get("scheme") == "PE-RUC" and len(ai.get("id", "")) == 11:
                    buyer_ruc = ai["id"]; break
            break

    suppliers = [
        {"ruc": (p.get("identifier") or {}).get("id"), "name": p.get("name")}
        for p in parties
        if any(r in (p.get("roles") or []) for r in ("supplier", "tenderer"))
        and (p.get("identifier") or {}).get("scheme") == "PE-RUC"
    ]
    # Postores que se presentaron (no solo los adjudicados): `tender.tenderers[]` y
    # `parties[role=tenderer]`. Se registran como ofertas con ganadora=false para que
    # la regla C2 (único postor) cuente postores reales y no solo ganadores.
    tenderer_rucs: list[str] = []
    for t in (tender.get("tenderers") or []):
        tid = str((t or {}).get("id") or "").replace("PE-RUC-", "").strip()
        if len(tid) == 11 and tid.isdigit() and tid not in tenderer_rucs:
            tenderer_rucs.append(tid)
            if not any(s["ruc"] == tid for s in suppliers):
                suppliers.append({"ruc": tid, "name": (t or {}).get("name") or f"RUC {tid}"})
    for p in parties:
        if "tenderer" in (p.get("roles") or []) and (p.get("identifier") or {}).get("scheme") == "PE-RUC":
            tid = str((p.get("identifier") or {}).get("id") or "").strip()
            if len(tid) == 11 and tid.isdigit() and tid not in tenderer_rucs:
                tenderer_rucs.append(tid)

    DOC_TYPE_MAP = {
        "biddingDocuments": "bases", "technicalSpecifications": "expediente_tecnico",
        "awardNotice": "acta_buena_pro", "evaluationReports": "reporte_buena_pro",
        "contractSigned": "contrato", "contractAmendment": "adenda",
    }

    def _tipo_ent(n: str) -> str:
        u = (n or "").upper()
        if "MINISTERIO" in u: return "ministerio"
        if "GOBIERNO REGIONAL" in u or "PROYECTO ESPECIAL" in u: return "gobierno_regional"
        if "MUNICIPALIDAD" in u and "DISTRITAL" in u: return "municipal_distrital"
        if "MUNICIPALIDAD" in u: return "municipal_provincial"
        return "organismo_autonomo"

    conn = _pg()
    try:
        cur = conn.cursor()
        if buyer_ruc:
            cur.execute(
                "INSERT INTO entidades (ruc, nombre, tipo) VALUES (%s, %s, %s) "
                "ON CONFLICT (ruc) DO UPDATE SET nombre=COALESCE(EXCLUDED.nombre, entidades.nombre)",
                (buyer_ruc, buyer_name, _tipo_ent(buyer_name)),
            )
        for s in suppliers:
            if s["ruc"] and len(s["ruc"]) == 11:
                cur.execute(
                    "INSERT INTO empresas (ruc, razon_social, rnp_vigente) VALUES (%s, %s, TRUE) "
                    "ON CONFLICT (ruc) DO UPDATE SET razon_social=COALESCE(EXCLUDED.razon_social, empresas.razon_social)",
                    (s["ruc"], s["name"]),
                )
        codigo_conv = ocid.split("-")[-1]
        objeto = (tender.get("description") or tender.get("title") or "")[:2000]
        # NULL (no "Desconocido") cuando el OCDS no lo trae: así el COALESCE con `modalidad`
        # de la ingesta funciona y el ON CONFLICT no pisa un valor real (lote 1 · T11).
        tipo_proc = tender.get("procurementMethodDetails") or None
        cuantia = float((tender.get("value") or {}).get("amount") or 0)
        tp = tender.get("tenderPeriod") or {}
        fecha_conv = (tp.get("startDate") or "")[:10] or None
        aws = cr.get("awards") or []
        fbp = max((a.get("date") for a in aws if a.get("date")), default=None)
        fbp = fbp[:10] if fbp else (tp.get("endDate") or "")[:10] or None
        region = None
        for p in parties:
            if "buyer" in (p.get("roles") or []):
                r = (p.get("address") or {}).get("region")
                region = r.strip().title() if r else None
                break
        cur.execute(
            """INSERT INTO convocatorias
                 (ocid, codigo, entidad_ruc, objeto, tipo_proceso, cuantia_referencial,
                  fecha_convocatoria, fecha_buena_pro, region, ocds_payload)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (ocid) DO UPDATE SET
                 objeto=EXCLUDED.objeto, cuantia_referencial=EXCLUDED.cuantia_referencial,
                 fecha_buena_pro=EXCLUDED.fecha_buena_pro, ocds_payload=EXCLUDED.ocds_payload,
                 tipo_proceso=COALESCE(NULLIF(EXCLUDED.tipo_proceso, 'Desconocido'), convocatorias.tipo_proceso,
                                       convocatorias.modalidad),
                 fecha_convocatoria=COALESCE(convocatorias.fecha_convocatoria, EXCLUDED.fecha_convocatoria),
                 updated_at=NOW()""",
            (ocid, codigo_conv, buyer_ruc, objeto, tipo_proc, cuantia,
             fecha_conv, fbp, region, json.dumps(cr)),
        )
        cur.execute("DELETE FROM convocatoria_items WHERE ocid=%s", (ocid,))
        items = tender.get("items") or []
        item_id_by_cubso = {}
        for i, it in enumerate(items):
            cubso = (it.get("classification") or {}).get("id")
            qty = float(it.get("quantity") or 0)
            tot = float((it.get("totalValue") or {}).get("amount") or 0)
            cur.execute(
                """INSERT INTO convocatoria_items
                     (ocid, numero_item, descripcion, descripcion_corta, cantidad, unidad,
                      cuantia_referencial, precio_unit_ref, cubso)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                # numero_item = índice del loop (1..N), SIEMPRE único. Antes era
                # `position or i+1`, pero el OCDS a veces trae items con `position`
                # DUPLICADA (caso real 2026-10404-12: 2 items con position '1') →
                # chocaba la constraint única (ocid, numero_item) y register fallaba
                # entero (→ sin convocatoria → persist_alert violaba la FK → 0 alertas).
                (ocid, i + 1,
                 it.get("description") or "", (it.get("description") or "")[:80],
                 qty, ((it.get("unit") or {}).get("name")) or "UND",
                 tot, tot / max(qty, 1), cubso),
            )
            item_id_by_cubso[cubso] = cur.fetchone()[0]

        cur.execute("DELETE FROM postores WHERE ocid=%s", (ocid,))
        postor_by_ruc = {}
        for s in suppliers:
            if s["ruc"] and len(s["ruc"]) == 11:
                cur.execute(
                    "INSERT INTO postores (ocid, empresa_ruc, tipo, rnp_vigente) "
                    "VALUES (%s, %s, 'persona_juridica', TRUE) RETURNING id",
                    (ocid, s["ruc"]),
                )
                postor_by_ruc[s["ruc"]] = cur.fetchone()[0]

        for a in aws:
            for sup in (a.get("suppliers") or []):
                ruc = sup.get("id", "").replace("PE-RUC-", "")
                pid = postor_by_ruc.get(ruc)
                if not pid: continue
                for it in (a.get("items") or []):
                    cubso = (it.get("classification") or {}).get("id")
                    iid = item_id_by_cubso.get(cubso)
                    if not iid: continue
                    monto = float((it.get("totalValue") or {}).get("amount") or 0)
                    cur.execute("SELECT cuantia_referencial FROM convocatoria_items WHERE id=%s", (iid,))
                    ref = cur.fetchone()
                    # porcentaje_referencial es NUMERIC(6,3) → máx 999.999. Datos
                    # sucios del OCDS (referencial casi cero) dispararían 22003
                    # 'numeric field overflow' y abortarían el registro entero.
                    pct = (monto / float(ref[0]) * 100) if ref and ref[0] else 0
                    pct = min(pct, 999.999)
                    cur.execute(
                        """INSERT INTO ofertas (postor_id, item_id, monto_ofertado,
                             porcentaje_referencial, admitida, calificada, ganadora)
                           VALUES (%s, %s, %s, %s, TRUE, TRUE, TRUE)""",
                        (pid, iid, monto, round(pct, 3)),
                    )
        # Postores NO ganadores: una oferta por (postor × ítem) con ganadora=false y sin
        # monto (el OCDS de OECE no publica el monto de las ofertas perdedoras). ON CONFLICT
        # respeta las ofertas ganadoras ya insertadas arriba.
        for ruc in tenderer_rucs:
            pid = postor_by_ruc.get(ruc)
            if not pid:
                continue
            for iid in item_id_by_cubso.values():
                cur.execute(
                    """INSERT INTO ofertas (postor_id, item_id, monto_ofertado, porcentaje_referencial,
                                            admitida, calificada, ganadora)
                       VALUES (%s, %s, NULL, NULL, NULL, NULL, FALSE)
                       ON CONFLICT (postor_id, item_id) DO NOTHING""",
                    (pid, iid),
                )
        # Catálogo de documentos: TODAS las secciones (tender/awards/contracts) y upsert por
        # (ocid, blob_url) — ya no se borra la tabla en cada corrida (migración 17). Las
        # columnas seccion/ocds_doc_id/sha256 existen desde la 17; si la instancia no la
        # tiene aplicada, se cae al INSERT histórico (solo tender, sin borrar).
        docs: list[dict] = []
        for stage, seccion in (("tender", "tender"), ("awards", "award"), ("contracts", "contract")):
            node = cr.get(stage)
            arr = node if isinstance(node, list) else ([node] if node else [])
            for nd in arr:
                if isinstance(nd, dict):
                    for d in (nd.get("documents") or []):
                        if isinstance(d, dict) and d.get("url"):
                            docs.append({**d, "_seccion": seccion})
        try:
            cur.execute("SAVEPOINT docs_upsert")
            for d in docs:
                cur.execute(
                    """INSERT INTO documentos (ocid, tipo, nombre, blob_url, fecha, metadata, seccion, ocds_doc_id)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (ocid, blob_url) DO UPDATE SET
                         tipo=EXCLUDED.tipo, nombre=EXCLUDED.nombre, fecha=COALESCE(EXCLUDED.fecha, documentos.fecha),
                         metadata=EXCLUDED.metadata, seccion=EXCLUDED.seccion, ocds_doc_id=EXCLUDED.ocds_doc_id""",
                    (ocid, DOC_TYPE_MAP.get(d.get("documentType"), "otro"),
                     d.get("title") or "(sin título)", d.get("url"),
                     (d.get("datePublished") or "")[:10] or None,
                     json.dumps({"ocds_documentType": d.get("documentType"), "format": d.get("format")}),
                     d["_seccion"], str(d.get("id") or "") or None),
                )
            cur.execute("RELEASE SAVEPOINT docs_upsert")
        except Exception as _e:
            print(f"[register] upsert documentos (migración 17) falló → inserción simple: {str(_e)[:120]}", flush=True)
            cur.execute("ROLLBACK TO SAVEPOINT docs_upsert")
            for d in docs:
                cur.execute("SELECT 1 FROM documentos WHERE ocid=%s AND blob_url=%s LIMIT 1", (ocid, d.get("url")))
                if cur.fetchone():
                    continue
                cur.execute(
                    """INSERT INTO documentos (ocid, tipo, nombre, blob_url, fecha, metadata)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (ocid, DOC_TYPE_MAP.get(d.get("documentType"), "otro"),
                     d.get("title") or "(sin título)", d.get("url"),
                     (d.get("datePublished") or "")[:10] or None,
                     json.dumps({"ocds_documentType": d.get("documentType"), "format": d.get("format"),
                                 "seccion": d["_seccion"]})),
                )
        conn.commit()
        return {"ok": True, "ocid_saved": ocid, "n_items": len(items),
                "n_postores": len(postor_by_ruc), "n_tenderers": len(tenderer_rucs),
                "n_docs": len(docs)}
    finally:
        conn.close()

# ── FunctionTool wrappers ──
fetch_ocds_record_tool = FunctionTool(func=fetch_ocds_record)
get_ganador_tool = FunctionTool(func=get_ganador)
register_convocatoria_in_db_tool = FunctionTool(func=register_convocatoria_in_db)
