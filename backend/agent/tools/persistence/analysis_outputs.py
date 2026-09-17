"""Persistencia del análisis completo (`alertas.analisis_full` + `dictamen_markdown`):
combina los outputs JSON de todos los sub-agentes, aplica las banderas diferidas
(pending_doc_flags/pending_market_flags) y el puente banderas de investigación
(person_network/web_research/news_research) → `banderas`."""

from tools._core import *  # noqa: F401,F403
import time as _time
from tools import verify as _verify
from tools.persistence.shared import (
    _advisory_lock, _insert_bandera, _montos_alerta, _norma,
    _normalizar_red_flag, _recalcular_score, _verificar_o_descartar,
)


def persist_analysis_outputs(alerta_codigo: str, tool_context: ToolContext) -> dict:
    """Persiste el análisis completo de los sub-agentes en Cloud SQL para
    que se pueda consultar el histórico de convocatorias analizadas. Guarda:
      · `market_analysis` (JSON estructurado del market_price_agent)
      · `document_analysis` (JSON estructurado del document_parser_agent)
      · `web_research` (JSON estructurado del web_research_agent)
      · `news_research` (JSON del news_research_agent — prensa peruana)
      · `person_network` (JSON del person_network_agent — gerente + red)
      · `final_dictamen` (markdown del report_writer_agent)
    Todo va a la columna `alertas.analisis_full` (JSONB) + columnas individuales.

    Args:
        alerta_codigo: Código de la alerta (ej. 'OECE-1203694') creada por
                       compliance_agent.

    Returns:
        Diccionario con `persisted`, `bytes_saved`, `alerta_codigo`.
    """
    state = tool_context.state
    warns: list[str] = []
    # Intenta parsear los outputs que vienen como JSON string del LLM
    def _try_parse(s, clave: str = "?"):
        if not s:
            return s
        if not isinstance(s, str):
            return s
        # 1. JSON directo
        try:
            return json.loads(s)
        except Exception:
            pass
        # 2. Limpiar fences markdown ```json ... ```
        s_clean = s.strip()
        if s_clean.startswith("```"):
            first_nl = s_clean.find("\n")
            if first_nl > 0:
                s_clean = s_clean[first_nl + 1:]
            if s_clean.endswith("```"):
                s_clean = s_clean[:-3].strip()
            try:
                return json.loads(s_clean)
            except Exception:
                pass
        # 3. Regex que busca el JSON externo (más codicioso)
        m = re.search(r"\{[\s\S]+\}", s)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
        # 4. Sin fallback a texto crudo (auditoría §6.2-9): un output que no parsea
        # es `sin_dato` explícito + warn; el texto libre no se persiste ni se muestra
        # como si fuera análisis.
        warns.append(f"{clave}: output del agente no parseable como JSON ({len(s)} chars) → sin_dato")
        state.setdefault("descartes", []).append({
            "donde": "persist_analysis_outputs", "agente": clave,
            "motivos": ["json_no_parseable"], "chars": len(s)})
        return {"estado": "sin_dato", "_parse_failed": True,
                "_motivo": "output del agente no parseable como JSON"}

    # document_analysis: combinar el output del agente (que puede tener resumen
    # narrativo) con el parser_raw_consolidated (que tiene la data completa
    # de cada PDF procesado: items, firmantes, motivos, comité). El raw gana
    # en data estructurada; el output del agente aporta el resumen ejecutivo.
    doc_from_agent = _try_parse(state.get("document_analysis"), "document_analysis") or {}
    doc_raw = state.get("parser_raw_consolidated") or {}
    if isinstance(doc_from_agent, dict) and doc_raw:
        # Mergeamos: si el agente NO tiene un campo o lo tiene vacío, usamos el del raw
        for k in ("items_consolidados", "postores_extraidos", "postores_consolidados",
                  "firmantes", "firmantes_consolidados", "comite_evaluacion",
                  "motivos_adjudicacion", "red_flags_documentales",
                  "red_flags_observadas", "fundamento_legal", "lugar_fecha_acta",
                  "documentos"):
            raw_v = doc_raw.get(k)
            agent_v = doc_from_agent.get(k)
            # Si el raw tiene más items, gana
            if isinstance(raw_v, list) and len(raw_v) > (len(agent_v) if isinstance(agent_v, list) else 0):
                # Para firmantes_consolidados ↔ firmantes, asegurar ambos keys
                doc_from_agent[k] = raw_v
                if k == "firmantes_consolidados" and not doc_from_agent.get("firmantes"):
                    doc_from_agent["firmantes"] = raw_v
                elif k == "red_flags_observadas" and not doc_from_agent.get("red_flags_documentales"):
                    doc_from_agent["red_flags_documentales"] = raw_v
            elif raw_v and not agent_v:
                doc_from_agent[k] = raw_v
        # Forzar campos críticos si están en raw
        if doc_raw.get("items_consolidados") and not doc_from_agent.get("items_consolidados"):
            doc_from_agent["items_consolidados"] = doc_raw["items_consolidados"]

    # Dedup FINAL de variantes del mismo bien sobre la lista que se va a persistir
    # (el agente suele listar 'EQUIPO DE FTIR' / 'Equipo FTIR' / 'Equipo de FTIR
    # Espectrofotómetro...' como ítems separados; el merge del parser no alcanza
    # porque el persist se queda con la lista —más larga— del agente).
    _final_doc = doc_from_agent or doc_raw
    if isinstance(_final_doc, dict):
        # GARANTÍA DETERMINISTA: el parser es extractor puro; NO debe llevar banderas.
        # Aunque el LLM del parser emita `red_flags_documentales` por hábito (con
        # alucinaciones tipo "Microsoft Office"/"ISO 19798"), las eliminamos del JSON
        # persistido. El análisis de riesgo legal vive SOLO en `legal_analysis`.
        _final_doc.pop("red_flags_documentales", None)
        _final_doc.pop("red_flags_observadas", None)
        # comité / motivos de adjudicación / acta: la AUTORIDAD es
        # `parser_raw_consolidated`, que ya viene GATED por tipo de documento (solo
        # acepta estos campos de actas/evaluaciones/contratos, NO de Bases/TDR). El
        # `document_analysis` del agente (LLM) puede re-inventarlos aunque el doc no
        # los tenga (proceso no competitivo) → los forzamos desde el raw gated.
        # Fix de raíz: no depende de blocklists de nombres ni de heurísticas de fecha.
        if isinstance(doc_raw, dict) and doc_raw:
            _final_doc["comite_evaluacion"] = doc_raw.get("comite_evaluacion") or []
            _final_doc["motivos_adjudicacion"] = doc_raw.get("motivos_adjudicacion") or []
            _final_doc["lugar_fecha_acta"] = doc_raw.get("lugar_fecha_acta")
        # SIN dedup fuzzy de ítems acá: los ítems ya vienen de la extracción única de la
        # Bases (parser_raw_consolidated, deduplicada por _item_key exacto). El viejo
        # `_merge_item_variants` (token-overlap) SOBRE-FUSIONABA productos legítimamente
        # distintos (ej. 'AMPLIFICADOR DE AUDIO' #1 vs 'AMPLIFICADOR DE AUDIO DE 600 W' #3
        # → 1) — se eliminó como parte de la simplificación del flujo de ítems.

        # Guard anti-placeholder de firmantes: el parser a veces invent a/templa
        # firmantes genéricos de una proforma ("POSTOR DOS E.I.R.L.", "Juan Perez"
        # con entidad "Entidad Contratante", sin DNI). Descartamos los que NO tienen
        # DNI Y tienen una ENTIDAD genérica de plantilla. Keyeamos por la ENTIDAD
        # (segura), nunca por el nombre solo — "Juan Perez" podría ser real. Los
        # firmantes con DNI o con entidad nombrada (empresa/GORE real) se mantienen.
        import re as _re_ph

        def _firmante_placeholder(f):
            if not isinstance(f, dict):
                return True
            if str(f.get("dni") or "").strip():
                return False  # con DNI → es real
            ent = str(f.get("entidad") or "").strip().lower()
            if not ent:
                return False  # sin entidad no es señal suficiente por sí sola
            if _re_ph.match(r"^(el|la)?\s*(postor|proveedor|contratista|licitante|adjudicatari)\b", ent):
                return True
            return ent in ("entidad contratante", "entidad", "la entidad", "el proveedor",
                           "proveedor", "postor", "el postor", "la empresa", "empresa")
        for _key in ("firmantes", "firmantes_consolidados"):
            _fl = _final_doc.get(_key)
            if isinstance(_fl, list) and _fl:
                _keep = [f for f in _fl if not _firmante_placeholder(f)]
                if len(_keep) < len(_fl):
                    print(f"[persist] firmantes placeholder descartados en {_key}: "
                          f"{len(_fl)}→{len(_keep)}", flush=True)
                _final_doc[_key] = _keep

    analisis = {
        "market_analysis":      _try_parse(state.get("market_analysis"), "market_analysis"),
        "document_analysis":    _final_doc,
        "web_research":         _try_parse(state.get("web_research"), "web_research"),
        "news_research":        _try_parse(state.get("news_research"), "news_research"),
        "person_network":       _try_parse(state.get("person_network"), "person_network"),
        # Pre-fetched data por persona — el frontend lo usa para mostrar
        # vinculaciones políticas (ONPE/JNE/PEP/visitas) de TODAS las personas
        # investigadas (titular + socios + familia + firmantes + comité),
        # no solo de persona_principal.
        "person_network_context": state.get("person_network_context"),
        # CAPA 3 — funcionarios designados de la entidad (gerentes municipales,
        # procurador, asesor legal, OCI). Output del entity_personnel_agent.
        "entity_personnel": _try_parse(state.get("entity_personnel"), "entity_personnel"),
        "normative_compliance": state.get("normative_compliance"),
        # WS V: trazabilidad de lo que NO entró al análisis y del control del dictamen.
        "recortes":             state.get("recortes") or [],
        "descartes":            state.get("descartes") or [],
        "validaciones_pendientes": state.get("validaciones_pendientes"),
        "verificacion_dictamen": state.get("verificacion_dictamen"),
        "perfil":               state.get("perfil") or state.get("pipeline_profile"),
        # `compliance_summary` se completa más abajo con el conteo REAL de banderas de la
        # alerta (lote 1 · T5): el texto del agente decía "0 banderas" porque se genera
        # antes de compliance_extended/mercado/legal.
        "compliance_summary":   state.get("compliance_result"),
        # T5: el análisis legal (agente más caro tras el dictamen) no se guardaba.
        "legal_analysis":       _try_parse(state.get("legal_analysis"), "legal_analysis"),
        "compliance_extended":  _try_parse(state.get("compliance_extended"), "compliance_extended"),
        "reglas_lote1":         state.get("reglas_lote1"),
        "montos_alerta":        state.get("montos_alerta"),
        "items_otros_documentos": (state.get("parser_raw_consolidated") or {}).get("items_otros_documentos"),
        # Causal de Contratación Directa (si aplica) + acto resolutivo encontrado
        "causal_directa_invocada": state.get("causal_directa_invocada"),
        "acto_resolutivo_directa": state.get("acto_resolutivo_directa"),
        # Fase 1+2 — estado real y patrones de postores (incluso si no hay ganador)
        "estado_real":          state.get("estado_real"),
        "analisis_postores":    state.get("analisis_postores"),
        # Bloques tipados por documento (ruteo incremental): estudio de mercado +
        # causal (Resumen Ejecutivo/Informe) y condiciones finales (Orden de Compra).
        "estudio_mercado":      _try_parse(state.get("estudio_mercado"), "estudio_mercado"),
        "contrato_final":       _try_parse(state.get("contrato_final"), "contrato_final"),
    }
    for w in warns:
        try:
            print(json.dumps({"_vigia": True, "kind": "warn", "donde": "persist_analysis_outputs",
                              "msg": w}, ensure_ascii=False), flush=True)
        except Exception:
            pass
    dictamen_md = state.get("final_dictamen") or ""
    _t0 = _time.monotonic()
    tiempos: dict[str, float] = {}

    # Normalizar el alerta_codigo: el LLM a veces pasa el OCID completo
    # (ej. 'ocds-dgv273-seacev3-1213010') en vez del código corto. Si detectamos
    # eso, lo convertimos a 'OECE-XXXXXXX'.
    raw_codigo = (alerta_codigo or "").strip()
    if raw_codigo.startswith("ocds-"):
        raw_codigo = "OECE-" + _short_ocid(raw_codigo)
    if raw_codigo and not raw_codigo.startswith("OECE-") and raw_codigo.isdigit():
        raw_codigo = f"OECE-{raw_codigo}"

    # Si no recibimos alerta_codigo o aún no existe la fila, derivamos uno
    # desde el OCID que el orquestador tiene en state. SIEMPRE persistimos
    # el análisis aunque no haya alerta formal de compliance.
    # IMPORTANTE: normalizar OCID al formato corto que usa convocatorias/alertas
    # (sin prefijo 'ocds-dgv273-seacev3-'). Bug detectado 2026-05-25 en OCID
    # 1212841: persist_analysis_outputs intentaba INSERT con ocid largo y la
    # FK alertas_ocid_fkey → convocatorias.ocid (que es corto) fallaba.
    ocid_raw = state.get("ocid") or ((state.get("ocds") or {}).get("ocid"))
    ocid = _short_ocid(ocid_raw) if ocid_raw else None
    if not raw_codigo and ocid:
        raw_codigo = f"OECE-{ocid}"

    conn = _pg()
    try:
        cur = conn.cursor()
        _advisory_lock(cur, raw_codigo)
        tiempos["lock_s"] = round(_time.monotonic() - _t0, 3)
        # T13: sin `ALTER TABLE … IF NOT EXISTS` aquí (ver nota al inicio del módulo): las
        # columnas analisis_full / dictamen_markdown / analizado_en existen por migración.
        cur.execute("SELECT id, codigo FROM alertas WHERE codigo=%s", (raw_codigo,))
        row = cur.fetchone()

        # Si la alerta no existe (compliance no creó banderas duras), creamos
        # una alerta-stub. Intentamos sacar datos de `convocatorias` PERO si esa
        # fila tampoco existe (porque register_convocatoria_in_db falló silen.),
        # fallback al OCDS del state. EL STUB SE CREA SIEMPRE QUE TENGAMOS OCID.
        _stub_created = False
        if not row and ocid:
            cur.execute(
                """SELECT entidad_ruc, region, fecha_buena_pro, objeto, cuantia_referencial,
                          (SELECT empresa_ruc FROM postores p
                             JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                            WHERE p.ocid=convocatorias.ocid LIMIT 1)
                     FROM convocatorias WHERE ocid=%s""",
                (ocid,),
            )
            conv = cur.fetchone()
            if conv:
                ent_ruc, region, fbp, objeto, cuantia, prov_ruc = conv
            else:
                # Fallback al OCDS en state (mejor algo que nada).
                ocds_state = state.get("ocds") or state.get("ocds_preloaded") or {}
                tender = ocds_state.get("tender") or {}
                buyer = next((p for p in (ocds_state.get("parties") or [])
                              if "buyer" in (p.get("roles") or [])), {})
                addr = (buyer.get("address") or {})
                # Mismo cuidado que en persist_alert_from_flags: entidad_ruc es
                # CHAR(11). Tomamos sólo dígitos del identifier (o del id) y
                # exigimos largo 11; cualquier otra cosa → None (evita 22001).
                _raw_ent_id = ((buyer.get("identifier") or {}).get("id")
                               or buyer.get("id") or "")
                _ent_digits = "".join(ch for ch in _raw_ent_id if ch.isdigit())
                ent_ruc = _ent_digits if len(_ent_digits) == 11 else None
                # Garantiza la fila padre (FK entidad_ruc→entidades) para no
                # disparar 23503 cuando register_convocatoria no corrió.
                if ent_ruc:
                    cur.execute(
                        "INSERT INTO entidades (ruc, nombre, tipo) VALUES (%s, %s, 'organismo_autonomo') "
                        "ON CONFLICT (ruc) DO NOTHING",
                        (ent_ruc, buyer.get("name") or ""),
                    )
                region = addr.get("region") or addr.get("department") or None
                fbp = None
                objeto = tender.get("description") or tender.get("title") or ""
                v = tender.get("value")
                cuantia = (v.get("amount") if isinstance(v, dict) else None)
                prov_ruc = None
            monto_adj, monto_ref, _fuente_monto = _montos_alerta(state, cuantia)
            if not prov_ruc:
                from tools.compliance_rules import _ganador_ocds
                prov_ruc, _ = _ganador_ocds(state.get("ocds") or state.get("ocds_preloaded") or {})
            cur.execute(
                """INSERT INTO alertas
                     (codigo, ocid, entidad_ruc, proveedor_ruc, monto_adjudicado, monto_referencial,
                      fecha_buena_pro, region, score, reglas_disparadas, estado,
                      objeto, codigo_convocatoria, fuente_url, analizado_en)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 0, '{}', 'activa',
                           %s, %s, %s, NOW())
                   ON CONFLICT (codigo) DO UPDATE SET analizado_en=NOW(),
                     monto_adjudicado=COALESCE(EXCLUDED.monto_adjudicado, alertas.monto_adjudicado),
                     monto_referencial=COALESCE(EXCLUDED.monto_referencial, alertas.monto_referencial),
                     updated_at=NOW()
                   RETURNING id""",
                (raw_codigo, ocid, ent_ruc, prov_ruc, monto_adj, monto_ref, fbp, region,
                 (objeto or "")[:500], ocid.split("-")[-1],
                 f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"),
            )
            state["montos_alerta"] = {"monto_adjudicado": monto_adj, "monto_referencial": monto_ref, "fuente": _fuente_monto}
            analisis["montos_alerta"] = state["montos_alerta"]
            _stub_created = True
            print(f"[persist_analysis] stub creado para {raw_codigo} (convocatoria_existia={conv is not None})")
        elif row:
            # Alerta ya creada por compliance: corregir monto_adjudicado/monto_referencial con
            # el OCDS del state (T8) sin tocar score ni banderas.
            monto_adj, monto_ref, _fuente_monto = _montos_alerta(state, None)
            if monto_adj or monto_ref:
                cur.execute("UPDATE alertas SET monto_adjudicado=COALESCE(%s, monto_adjudicado), "
                            "monto_referencial=COALESCE(%s, monto_referencial) WHERE id=%s",
                            (monto_adj, monto_ref, row[0]))
                state["montos_alerta"] = {"monto_adjudicado": monto_adj, "monto_referencial": monto_ref, "fuente": _fuente_monto}
                analisis["montos_alerta"] = state["montos_alerta"]
        tiempos["stub_s"] = round(_time.monotonic() - _t0, 3)

        # Banderas DIFERIDAS (skipeadas antes porque la alerta no existía):
        # pending_doc_flags (legal) y pending_market_flags (mercado; hallazgo #2: antes
        # nadie las consumía). Se verifican, se insertan con su agente de origen, se
        # recalcula el score con TODAS y se limpian del state (no se re-insertan en los
        # siguientes checkpoints).
        pending_doc = state.get("pending_doc_flags") or []
        pending_market = state.get("pending_market_flags") or []
        n_pending_inserted = 0
        n_pending_descartadas = 0
        _fuente_proc = f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"
        if pending_doc or pending_market:
            cur.execute("SELECT id FROM alertas WHERE codigo=%s", (raw_codigo,))
            r = cur.fetchone()
            if r:
                alerta_id = r[0]
                if pending_doc:
                    cur.execute("DELETE FROM banderas WHERE alerta_id=%s AND agente_origen IN "
                                "('document_parser_agent','document_legal_analyst_agent')", (alerta_id,))
                for rf in pending_doc:
                    norm = _normalizar_red_flag(rf)
                    if not norm:
                        continue
                    descr, sev, norma = norm
                    norma_final = (norma or _norma(state, "competencia"))[:300]
                    flag = {"regla": "red_flag_documental", "severidad": sev, "evidencia": descr[:500],
                            "norma": norma_final, "fuente_url": _fuente_proc}
                    if not _verificar_o_descartar(flag, state, "persist_analysis_outputs(pending_doc)",
                                                  "document_legal_analyst_agent"):
                        n_pending_descartadas += 1
                        continue
                    _insert_bandera(cur, alerta_id, "red_flag_documental", sev, descr, norma_final,
                                    _fuente_proc, "document_legal_analyst_agent", flag.get("verificacion"))
                    n_pending_inserted += 1
                if pending_market:
                    cur.execute("DELETE FROM banderas WHERE alerta_id=%s AND agente_origen='market_price_agent'",
                                (alerta_id,))
                for b in pending_market:
                    if not isinstance(b, dict):
                        continue
                    b.setdefault("fuente_url", _fuente_proc)
                    if not _verificar_o_descartar(b, state, "persist_analysis_outputs(pending_market)",
                                                  "market_price_agent"):
                        n_pending_descartadas += 1
                        continue
                    _insert_bandera(cur, alerta_id, b.get("regla"), b.get("severidad"), b.get("evidencia"),
                                    b.get("norma"), _fuente_proc, "market_price_agent", b.get("verificacion"))
                    n_pending_inserted += 1
                _recalcular_score(cur, alerta_id, state)
                state.pop("pending_doc_flags", None)
                state.pop("pending_market_flags", None)
        tiempos["pending_s"] = round(_time.monotonic() - _t0, 3)

        # Puente banderas de investigación → banderas (lote 1 · T14): `person_network.
        # banderas_red`, `web_research.banderas_sugeridas`, `news_research.banderas_prensa`
        # se persisten SOLO con evidencia + URL respaldada por grounding/fuente oficial +
        # confianza alta (R2 garantiza el schema). Antes no tenían camino a `banderas`
        # (1225062: parentesco entre postores rivales validado y nunca persistido).
        n_red_inserted, n_red_descartadas = 0, 0
        try:
            candidatas = _banderas_investigacion(state)
        except Exception as _e:
            candidatas = []
            warns.append(f"banderas_investigacion: {str(_e)[:120]}")
        cur.execute("SELECT id FROM alertas WHERE codigo=%s", (raw_codigo,))
        _r = cur.fetchone()
        if _r:
            alerta_id = _r[0]
            cur.execute("DELETE FROM banderas WHERE alerta_id=%s AND agente_origen IN "
                        "('person_network_agent','web_research_agent','news_research_agent')", (alerta_id,))
            for b in candidatas:
                if not _verificar_o_descartar(b, state, "persist_analysis_outputs(investigacion)", b["agente_origen"]):
                    n_red_descartadas += 1
                    continue
                _insert_bandera(cur, alerta_id, b["regla"], b["severidad"], b["evidencia"], b["norma"],
                                b["fuente_url"], b["agente_origen"], b.get("verificacion"))
                n_red_inserted += 1
            score_final, banderas_final = _recalcular_score(cur, alerta_id, state)
            # T5: `compliance_summary` con el conteo REAL (el texto del agente se conserva).
            _por_agente: dict[str, int] = {}
            for b in banderas_final:
                _por_agente[b.get("agente_origen") or "?"] = _por_agente.get(b.get("agente_origen") or "?", 0) + 1
            _texto_llm = state.get("compliance_result")
            _texto_llm = _texto_llm if isinstance(_texto_llm, str) else (json.dumps(_texto_llm, ensure_ascii=False, default=str) if _texto_llm else "")
            _cab = (f"RESULTADO DETERMINISTA (todas las fuentes): {len(banderas_final)} bandera(s) persistida(s) · "
                    f"score {score_final} · reglas: {', '.join(sorted({b.get('regla') or '' for b in banderas_final})) or 'ninguna'} · "
                    f"por agente: {', '.join(f'{k}={v}' for k, v in sorted(_por_agente.items())) or '—'}. "
                    f"El resumen del agente de compliance (abajo) se redactó antes de las reglas extendidas, "
                    f"el análisis legal y el mercado; prevalece el conteo determinista.")
            analisis["compliance_summary"] = _cab + ("\n\n" + _texto_llm if _texto_llm else "")
            analisis["compliance_resumen_det"] = {"n_banderas": len(banderas_final), "score": score_final,
                                                  "por_agente": _por_agente,
                                                  "reglas": sorted({b.get("regla") or "" for b in banderas_final})}
        tiempos["investigacion_s"] = round(_time.monotonic() - _t0, 3)
        analisis["descartes"] = state.get("descartes") or []
        blob = json.dumps(analisis, ensure_ascii=False, default=str)

        cur.execute(
            """UPDATE alertas
                  SET analisis_full = %s::jsonb,
                      dictamen_markdown = %s,
                      analizado_en = NOW(),
                      updated_at = NOW()
                WHERE codigo = %s""",
            (blob, dictamen_md, raw_codigo),
        )
        rows = cur.rowcount
        conn.commit()
        tiempos["total_s"] = round(_time.monotonic() - _t0, 3)
        if rows == 0:
            print(f"[persist_analysis] ⚠ UPDATE no matched: codigo={raw_codigo} ocid={ocid} stub_created={_stub_created}")
        else:
            print(f"[persist_analysis] ✓ persistido {raw_codigo} · bytes={len(blob)} · dictamen={len(dictamen_md)}")
        return {
            "persisted": rows > 0,
            "alerta_codigo": raw_codigo,
            "alerta_codigo_input": alerta_codigo,
            "stub_alerta_created": _stub_created,
            "doc_flags_diferidas_inserted": n_pending_inserted,
            "flags_diferidas_descartadas": n_pending_descartadas,
            "banderas_investigacion_inserted": n_red_inserted,
            "banderas_investigacion_descartadas": n_red_descartadas,
            "warns": warns,
            "rows_updated": rows,
            "bytes_saved": len(blob),
            "dictamen_chars": len(dictamen_md),
            "tiempos": tiempos,
        }
    except Exception as e:
        return {"persisted": False, "error": str(e)[:200], "alerta_codigo_input": alerta_codigo,
                "tiempos": tiempos}
    finally:
        conn.close()


_AGENTES_INVESTIGACION = (
    ("person_network", "banderas_red", "person_network_agent"),
    ("web_research", "banderas_sugeridas", "web_research_agent"),
    ("news_research", "banderas_prensa", "news_research_agent"),
)


def _url_respaldada(url: str, state: dict) -> bool:
    """URL con respaldo: redirect de grounding de Vertex, presente en state['grounding_urls'],
    o ficha canónica (OECE/SEACE/SUNAT). Las URLs de gob.pe escritas por el modelo NO cuentan
    (1225256: normas-legales/<id> inventados)."""
    u = str(url or "").strip().rstrip("/")
    if not u.startswith("http"):
        return False
    try:
        if _verify._es_redirect_grounding(u):
            return True
    except Exception:
        pass
    try:
        g = _verify._grounding_urls(state)
        if g and u in g:
            return True
    except Exception:
        pass
    try:
        host, _ = _verify._host_path(u)
        if host in getattr(_verify, "_CANONICAL_HOSTS", ()):
            return True
    except Exception:
        pass
    return False


def _banderas_investigacion(state: dict) -> list[dict]:
    """Candidatas a bandera desde los agentes de investigación. Exige: evidencia con cita,
    URL respaldada y confianza alta (o `estado` hallado con URL respaldada)."""
    out: list[dict] = []
    for clave, lista, agente in _AGENTES_INVESTIGACION:
        obj = _safe_parse_json(state.get(clave))
        if not isinstance(obj, dict):
            continue
        for b in (obj.get(lista) or []):
            if not isinstance(b, dict):
                continue
            conf = str(b.get("confianza") or b.get("confianza_match") or "").strip().lower()
            estado = str(b.get("estado") or "").strip().lower()
            if conf not in ("alta",) and estado not in ("hallado", "confirmado", "verificado"):
                continue
            if estado in ("no_verificable", "no_hallado", "sin_dato", "descartado"):
                continue
            evs = b.get("evidencia") or []
            if isinstance(evs, dict):
                evs = [evs]
            if isinstance(evs, str):
                evs = [{"cita": evs}]
            citas = [str(e.get("cita") or "") for e in evs if isinstance(e, dict) and str(e.get("cita") or "").strip()]
            urls = [str(e.get("url") or "") for e in evs if isinstance(e, dict) and e.get("url")]
            if b.get("fuente_url"):
                urls.append(str(b["fuente_url"]))
            url_ok = next((u for u in urls if _url_respaldada(u, state)), None)
            if not citas or not url_ok:
                continue
            sev = str(b.get("severidad") or "media").strip().lower()
            if sev not in ("alta", "media", "baja"):
                sev = "media"
            # Slug FIJO por agente (el frontend/verify enumeran reglas); el título libre queda en la evidencia.
            _SLUG_AGENTE = {"web_research": "antecedente_proveedor_web", "news_research": "cobertura_prensa_adversa",
                            "person_network": "vinculo_red_personas"}
            regla_libre = str(b.get("regla") or b.get("titulo") or b.get("nombre") or "").strip()
            regla = _SLUG_AGENTE.get(clave, f"{clave}_hallazgo")
            titulo = re.sub(r"\s+", " ", regla_libre)[:120]
            descr = str(b.get("descripcion") or b.get("detalle") or b.get("resumen") or b.get("titulo") or "")
            if titulo and titulo.lower() not in descr.lower():
                descr = f"{titulo}: {descr}" if descr else titulo
            texto = (descr + (f" Evidencia: {citas[0][:200]}" if citas else "")).strip()
            if not texto:
                continue
            out.append({"regla": regla, "severidad": sev, "evidencia": texto[:500],
                        "norma": str(b.get("norma") or b.get("norma_citada") or _norma(state, "integridad"))[:300],
                        "fuente_url": url_ok, "agente_origen": agente, "confianza": conf or estado})
    return out

# ── FunctionTool wrappers ──
persist_analysis_outputs_tool = FunctionTool(func=persist_analysis_outputs)
