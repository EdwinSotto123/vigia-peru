"""Tools del dominio: persistence."""

from tools._core import *  # noqa: F401,F403

def add_contextual_flag(regla: str, severidad: str, evidencia: str,
                         norma: str, tool_context: ToolContext) -> dict:
    """Agrega una bandera detectada por razonamiento del orquestador al
    state['pending_flags'] para que sea persistida en la siguiente llamada a
    `persist_alert_from_flags`.

    Útil para PASO 7.7 — hallazgos contextuales que el LLM detecta razonando
    sobre el conjunto de datos (ej. rubro CIIU no coincide con objeto del
    contrato, capacidad operativa cuestionable, declaratoria de emergencia
    no acreditada) y que NO los detecta ninguna regla automática.

    Args:
        regla: identificador corto (ej. 'rubro_ciiu_incongruente').
        severidad: 'alta' | 'media' | 'baja'.
        evidencia: texto factual con el hallazgo (max 500 chars).
        norma: artículo o principio normativo citado.

    Returns:
        dict con la bandera agregada + total de pending_flags acumulados.
    """
    if severidad not in ("alta", "media", "baja"):
        severidad = "media"
    flag = {
        "regla": (regla or "contextual")[:80],
        "severidad": severidad,
        "evidencia": (evidencia or "")[:500],
        "norma": (norma or "")[:200],
        "triggered": True,
        "_source": "orchestrator_paso_7.7",
    }
    pending = tool_context.state.setdefault("pending_flags", [])
    pending.append(flag)
    return {
        "ok": True,
        "flag_agregada": flag,
        "n_pending_total": len(pending),
        "hint": "La bandera quedará persistida cuando llames `persist_alert_from_flags(ocid)`.",
    }

def persist_alert_from_flags(ocid: str, tool_context: ToolContext) -> dict:
    """Persiste en BD una alerta con las banderas detectadas que estén
    acumuladas en state['pending_flags']. Si no hay banderas, no crea alerta.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con alerta_codigo, alerta_id, score, banderas_persistidas.
    """
    banderas = tool_context.state.get("pending_flags") or []
    if not banderas:
        return {"alerta_codigo": None, "score": 0, "banderas_persistidas": 0,
                "mensaje": "Sin banderas — no se creó alerta"}
    score = min(sum({"alta": 35, "media": 18, "baja": 8}.get(b.get("severidad"), 5)
                    for b in banderas), 100)
    codigo = f"OECE-{ocid.split('-')[-1]}"
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT entidad_ruc, region, fecha_buena_pro, objeto, cuantia_referencial,
                      (SELECT empresa_ruc FROM postores p
                         JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                        WHERE p.ocid=convocatorias.ocid LIMIT 1)
                 FROM convocatorias WHERE ocid=%s""",
            (ocid,),
        )
        row = cur.fetchone()
        if not row:
            # La convocatoria no fue registrada (register_convocatoria_in_db falló).
            # Creamos la alerta igual con los pocos datos que tenemos del state.
            ocds_state = tool_context.state.get("ocds") or tool_context.state.get("ocds_preloaded") or {}
            tender = ocds_state.get("tender") or {}
            # El id de procuringEntity puede venir como 'PE-RUC-20131380951',
            # con sufijos o en otro formato. Extraemos sólo los dígitos y exigimos
            # exactamente 11 (largo de un RUC); si no, None — entidad_ruc es CHAR(11)
            # y cualquier valor más largo revienta con 22001 'value too long'.
            _proc_ent = tender.get("procuringEntity") or {}
            _raw_ent_id = _proc_ent.get("id") or ""
            _ent_digits = "".join(ch for ch in _raw_ent_id if ch.isdigit())
            ent_ruc = _ent_digits if len(_ent_digits) == 11 else None
            # Garantiza la fila padre: entidad_ruc tiene FK a entidades(ruc). Si la
            # convocatoria no se registró, la entidad tampoco existe → el INSERT en
            # alertas violaría el FK (23503). Upsert defensivo idempotente.
            if ent_ruc:
                cur.execute(
                    "INSERT INTO entidades (ruc, nombre, tipo) VALUES (%s, %s, 'organismo_autonomo') "
                    "ON CONFLICT (ruc) DO NOTHING",
                    (ent_ruc, _proc_ent.get("name") or ""),
                )
            region = None
            fbp = None
            objeto = tender.get("description") or tender.get("title") or ""
            cuantia = tender.get("value", {}).get("amount") if isinstance(tender.get("value"), dict) else None
            prov_ruc = None
        else:
            ent_ruc, region, fbp, objeto, cuantia, prov_ruc = row
        cur.execute(
            """INSERT INTO alertas (codigo, ocid, entidad_ruc, proveedor_ruc, monto_adjudicado,
                                   fecha_buena_pro, region, score, reglas_disparadas, estado,
                                   objeto, codigo_convocatoria, fuente_url, analizado_en)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'activa', %s, %s, %s, NOW())
               ON CONFLICT (codigo) DO UPDATE SET score=EXCLUDED.score,
                 reglas_disparadas=EXCLUDED.reglas_disparadas,
                 analizado_en=NOW(),
                 updated_at=NOW()
               RETURNING id""",
            (codigo, ocid, ent_ruc, prov_ruc, cuantia, fbp, region, score,
             [b["regla"] for b in banderas], (objeto or "")[:500],
             ocid.split("-")[-1], f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"),
        )
        alerta_id = cur.fetchone()[0]
        # LIMPIAR TODAS las banderas viejas de esta alerta — cada run empieza
        # desde cero para evitar acumulación entre reprocesamientos del mismo
        # código (típico cuando el flujo se cortó en un run anterior y la
        # alerta quedó con banderas obsoletas/alucinadas).
        cur.execute("DELETE FROM banderas WHERE alerta_id=%s", (alerta_id,))
        for b in banderas:
            # Defensive .get() para banderas que pueden venir de add_contextual_flag
            # (sin fuente_url) o de reglas duras (con fuente_url).
            cur.execute(
                """INSERT INTO banderas (alerta_id, regla, severidad, evidencia, norma,
                                         fuente_url, agente_origen)
                   VALUES (%s, %s, %s, %s, %s, %s, 'compliance_agent')""",
                (
                    alerta_id,
                    b.get("regla", "sin_regla"),
                    b.get("severidad", "media"),
                    b.get("evidencia", ""),
                    b.get("norma", ""),
                    b.get("fuente_url"),
                ),
            )
        conn.commit()
        tool_context.state["alerta_codigo"] = codigo
        tool_context.state["score"] = score
        tool_context.state["banderas"] = banderas
        return {
            "alerta_codigo": codigo, "alerta_id": str(alerta_id),
            "score": score, "banderas_persistidas": len(banderas),
        }
    finally:
        conn.close()

def persist_doc_flags_as_banderas(alerta_codigo: str, tool_context: ToolContext) -> dict:
    """Toma los `red_flags_documentales` emitidos por document_legal_analyst_agent
    (cada uno con descripción + severidad + norma citada + evidencia textual) y
    los persiste como banderas vinculadas a la alerta. Sirve para que la UI
    muestre las banderas documentales junto con las banderas de reglas duras
    del compliance_agent.

    Args:
        alerta_codigo: Código de la alerta (ej. 'OECE-1211237').

    Returns:
        Diccionario con count de banderas persistidas + lista.
    """
    state = tool_context.state
    # Lectura prioritaria: legal_analysis del nuevo agente especializado
    legal = _safe_parse_json(state.get("legal_analysis"))
    if not isinstance(legal, dict):
        legal = {}
    red_flags = legal.get("red_flags_documentales") or []

    # Fallback legacy (mientras tanto, algunos pipelines viejos puedan tenerlo)
    if not red_flags:
        raw = state.get("parser_raw_consolidated") or {}
        red_flags = raw.get("red_flags_observadas") or []
    if not red_flags:
        doc_analysis = _safe_parse_json(state.get("document_analysis"))
        if not isinstance(doc_analysis, dict):
            doc_analysis = {}
        red_flags = doc_analysis.get("red_flags_documentales") or []
    if not red_flags:
        return {"persistidas": 0, "mensaje": "Sin red_flags documentales en state"}

    # Normalizar alerta_codigo: si vino el OCID completo, convertir a OECE-XXXX
    raw_codigo = (alerta_codigo or "").strip()
    if raw_codigo.startswith("ocds-"):
        raw_codigo = "OECE-" + raw_codigo.split("-")[-1]
    if raw_codigo and not raw_codigo.startswith("OECE-") and raw_codigo.isdigit():
        raw_codigo = f"OECE-{raw_codigo}"

    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM alertas WHERE codigo=%s", (raw_codigo,))
        row = cur.fetchone()
        if not row:
            # No hay alerta todavía — guardamos los flags en state para que
            # persist_analysis_outputs los anexe cuando cree la alerta stub.
            tool_context.state["pending_doc_flags"] = red_flags
            return {
                "persistidas": 0,
                "skipped": True,
                "alerta_codigo": raw_codigo,
                "mensaje": "Alerta aún no creada. red_flags quedan en state['pending_doc_flags'] para persistencia downstream.",
            }
        alerta_id = row[0]
        # Toda bandera debe linkear a evidencia oficial (principio innegociable):
        # URL canónica del proceso en OECE Contrataciones Abiertas.
        _fuente_oficial = f"https://contratacionesabiertas.oece.gob.pe/proceso/{state.get('ocid') or raw_codigo.replace('OECE-', '')}"

        # Borrar previas del mismo agente (idempotente)
        cur.execute(
            "DELETE FROM banderas WHERE alerta_id=%s AND agente_origen IN "
            "('document_parser_agent','document_legal_analyst_agent')",
            (alerta_id,),
        )

        persistidas = []
        score_extra = 0
        for rf in red_flags:
            if isinstance(rf, str):
                descr, sev, norma = rf, "media", None
            elif isinstance(rf, dict):
                descr = rf.get("descripcion") or rf.get("texto") or rf.get("evidencia") or str(rf)
                sev = (rf.get("severidad") or "media").lower()
                if sev not in ("alta", "media", "baja"):
                    sev = "media"
                norma = rf.get("norma_citada") or rf.get("norma")
            else:
                continue

            norma_final = (norma or "Art. 2 TUO Ley 30225 — Principio de Libertad de Concurrencia")[:300]
            cur.execute(
                """INSERT INTO banderas
                       (alerta_id, regla, severidad, evidencia, norma,
                        fuente_url, agente_origen)
                   VALUES (%s, %s, %s, %s, %s, %s, 'document_legal_analyst_agent')""",
                (alerta_id, "red_flag_documental", sev, descr[:500], norma_final, _fuente_oficial),
            )
            persistidas.append({"severidad": sev, "evidencia": descr[:200], "norma": norma_final})
            score_extra += {"alta": 25, "media": 12, "baja": 5}.get(sev, 5)

        # Sumar al score de la alerta (capped a 100)
        cur.execute("SELECT score FROM alertas WHERE id=%s", (alerta_id,))
        cur_score = (cur.fetchone() or [0])[0] or 0
        new_score = min(int(cur_score) + score_extra, 100)
        cur.execute("UPDATE alertas SET score=%s, updated_at=NOW() WHERE id=%s", (new_score, alerta_id))

        conn.commit()
        return {
            "persistidas": len(persistidas),
            "score_anterior": int(cur_score),
            "score_nuevo": new_score,
            "banderas": persistidas,
        }
    except Exception as e:
        return {"error": str(e)[:200], "alerta_codigo": alerta_codigo}
    finally:
        conn.close()

def persist_market_flags_as_banderas(alerta_codigo: str, tool_context: ToolContext) -> dict:
    """Toma los hallazgos del market_price_agent (sobreprecio por ítem,
    especificación restrictiva, sobreprecio total del lote) y los persiste
    como banderas vinculadas a la alerta. Aumenta el `score` de la alerta
    proporcionalmente a la severidad de cada hallazgo.

    Banderas que genera:
      · `sobreprecio_muy_elevado` (severidad alta, +25 pts) — Δ ≥ 50%
      · `sobreprecio_elevado` (severidad media, +12 pts) — 15% ≤ Δ < 50%
      · `spec_restrictiva` (severidad alta, +25 pts) por sub-ítem con esa marca
      · `sobreprecio_lote_muy_elevado` (severidad alta, +25 pts) — lote total >50%
      · `sobreprecio_lote_elevado` (severidad media, +12 pts) — lote total 15-50%

    Args:
        alerta_codigo: Código de la alerta (ej. 'OECE-1212765').

    Returns:
        Diccionario con count, banderas persistidas, score nuevo.
    """
    state = tool_context.state
    mk = _safe_parse_json(state.get("market_analysis"))
    if not isinstance(mk, dict):
        return {"persistidas": 0, "mensaje": "Sin market_analysis en state"}

    # ─── ANTI-ALUCINACIÓN: validar coherencia con objeto del contrato ───
    #
    # Caso real (OCID 1212147): contrato de "ADQUISICIÓN DE CARNES" pero el
    # market_price_agent produjo findings de camión volquete + excavadora +
    # mantenimiento maquinaria (copiado del ejemplo del prompt). Detectamos
    # esto comparando palabras clave del objeto vs item_descripcion.
    #
    # IMPORTANTE: en OCDS de OECE, `tender.title` suele ser el CÓDIGO del
    # proceso (ej. "DIRECTA-DIRECTA-1-2026-MPT-DEC-1") y `tender.description`
    # es el OBJETO real (ej. "ADQUISICIÓN DE CAMAS PLEGABLES..."). Tomamos
    # AMBOS y concatenamos para que el dominio de palabras sea amplio y no
    # rechacemos ítems legítimos.
    ocds_state = state.get("ocds") or {}
    tender = ocds_state.get("tender") or {}
    objeto_contrato = " ".join(
        str(x) for x in (tender.get("description"), tender.get("title")) if x
    ).upper()
    _STOPWORDS = {
        "PARA", "DE", "LA", "EL", "Y", "DEL", "CON", "EN", "POR", "LOS", "LAS",
        "ADQUISICION", "ADQUISICIÓN", "CONTRATACION", "CONTRATACIÓN", "SERVICIO",
        "SUMINISTRO", "BIENES", "OBRAS", "PROYECTO", "MUNICIPALIDAD",
    }
    def _palabras_relevantes(s: str) -> set:
        if not s:
            return set()
        out = set()
        for w in s.upper().replace(",", " ").replace(":", " ").replace(".", " ").split():
            w = w.strip()
            if len(w) < 4 or w in _STOPWORDS or not any(c.isalpha() for c in w):
                continue
            out.add(w)
        return out
    palabras_objeto = _palabras_relevantes(objeto_contrato)
    findings_raw = mk.get("findings") or []
    findings = []
    findings_descartados: list[str] = []
    if palabras_objeto and findings_raw:
        # También miramos items del OCDS para ampliar el dominio
        items_ocds = state.get("convocatoria_items") or []
        for it in items_ocds:
            palabras_objeto |= _palabras_relevantes(
                (it.get("descripcion") if isinstance(it, dict) else None) or ""
            )
        for f in findings_raw:
            if not isinstance(f, dict):
                continue
            desc = (f.get("item_descripcion") or "")
            palabras_item = _palabras_relevantes(desc)
            # Si el item no comparte NI UNA palabra significativa con el objeto,
            # es alucinación (ej. "Camión volquete" vs "Carnes").
            overlap = palabras_item & palabras_objeto
            if not overlap and palabras_item:
                findings_descartados.append(desc[:80])
                continue
            findings.append(f)
        if findings_descartados:
            try:
                import json as _json2
                print(_json2.dumps({
                    "_vigia": True,
                    "kind": "market_findings_descartados",
                    "ocid": state.get("ocid"),
                    "objeto_contrato": objeto_contrato[:100],
                    "n_descartados": len(findings_descartados),
                    "descripciones": findings_descartados[:5],
                }, ensure_ascii=False), flush=True)
            except Exception:
                pass
            # Si TODOS fueron descartados → abortar la persistencia
            if not findings:
                return {
                    "persistidas": 0,
                    "mensaje": (
                        "Todos los findings del market_price_agent fueron "
                        "descartados por NO coincidir con el objeto del contrato "
                        f"'{objeto_contrato[:80]}'. Posible alucinación del agente."
                    ),
                    "findings_descartados": findings_descartados,
                }
    else:
        findings = findings_raw

    veredicto_global = (mk.get("veredicto_global") or "").lower()
    sobreprecio_pct = mk.get("sobreprecio_pct")
    total_ofertado = mk.get("total_ofertado")
    total_mercado = mk.get("total_estimado_mercado")
    # Fallback: si el LLM no llenó sobreprecio_pct, computar del padre lote
    if sobreprecio_pct is None and total_ofertado and total_mercado:
        try:
            sobreprecio_pct = ((total_ofertado - total_mercado) / total_mercado) * 100
        except Exception:
            pass

    banderas_a_persistir: list[dict] = []

    # 1) Banderas por sub-ítem (sobreprecio + spec restrictiva)
    for f in findings:
        if not isinstance(f, dict):
            continue
        item_desc = (f.get("item_descripcion") or "")[:80]
        veredicto_item = (f.get("veredicto") or "").lower()
        if veredicto_item == "muy_elevado":
            banderas_a_persistir.append({
                "regla": "sobreprecio_muy_elevado",
                "severidad": "alta",
                "evidencia": (
                    f"Ítem '{item_desc}': precio ofertado {f.get('diff_pct',0):.1f}% "
                    f"por encima de la mediana de mercado."
                )[:500],
                "norma": "Art. 12 Reglamento Ley 32069 — valor referencial razonable",
            })
        elif veredicto_item == "elevado":
            banderas_a_persistir.append({
                "regla": "sobreprecio_elevado",
                "severidad": "media",
                "evidencia": (
                    f"Ítem '{item_desc}': precio ofertado {f.get('diff_pct',0):.1f}% "
                    f"por encima de la mediana de mercado."
                )[:500],
                "norma": "Art. 12 Reglamento Ley 32069 — valor referencial razonable",
            })
        if f.get("spec_restrictiva"):
            banderas_a_persistir.append({
                "regla": "spec_restrictiva",
                "severidad": "alta",
                "evidencia": (
                    f"Ítem '{item_desc}': {str(f.get('spec_restrictiva',''))[:300]}"
                )[:500],
                "norma": "Art. 2 TUO Ley 30225 — Principio de Libertad de Concurrencia",
            })

    # 2) Bandera de sobreprecio del LOTE completo (cuando hay padre OCDS
    #    con N sub-items y la suma de mercado vs ofertado da diferencia)
    # COBERTURA: si solo unos pocos sub-ítems tienen mediana de mercado, comparar
    # el total del lote contra esa suma parcial es apples-vs-oranges → falso
    # "sobreprecio_lote". Solo emitimos la bandera con cobertura ≥70%.
    _fi = [f for f in findings if isinstance(f, dict)]
    _n_con_mediana = len([f for f in _fi if isinstance(f.get("precio_mediana_mercado"), (int, float))])
    _cobertura_mercado = (_n_con_mediana / len(_fi)) if _fi else 0
    if isinstance(sobreprecio_pct, (int, float)) and _cobertura_mercado >= 0.7:
        # Los totales pueden venir None aunque el pct esté (el LLM no siempre
        # llena total_ofertado/total_mercado) → formatear S/. solo si son números.
        _has_montos = isinstance(total_ofertado, (int, float)) and isinstance(total_mercado, (int, float))
        _detalle = (
            f"precio ofertado total S/. {total_ofertado:,.2f} vs estimado de mercado S/. {total_mercado:,.2f} "
            if _has_montos else ""
        )
        if sobreprecio_pct >= 50:
            banderas_a_persistir.append({
                "regla": "sobreprecio_lote_muy_elevado",
                "severidad": "alta",
                "evidencia": (
                    f"Lote completo: {_detalle}({sobreprecio_pct:+.1f}% sobre el estimado de mercado)."
                )[:500],
                "norma": "Art. 12 Reglamento Ley 32069 — valor referencial razonable",
            })
        elif sobreprecio_pct >= 15:
            banderas_a_persistir.append({
                "regla": "sobreprecio_lote_elevado",
                "severidad": "media",
                "evidencia": (
                    f"Lote completo: {_detalle}({sobreprecio_pct:+.1f}% sobre el estimado de mercado)."
                )[:500],
                "norma": "Art. 12 Reglamento Ley 32069 — valor referencial razonable",
            })

    if not banderas_a_persistir:
        return {"persistidas": 0, "mensaje": "Sin hallazgos de sobreprecio o spec restrictiva en market_analysis"}

    # Normalizar alerta_codigo
    raw_codigo = (alerta_codigo or "").strip()
    if raw_codigo.startswith("ocds-"):
        raw_codigo = "OECE-" + raw_codigo.split("-")[-1]
    if raw_codigo and not raw_codigo.startswith("OECE-") and raw_codigo.isdigit():
        raw_codigo = f"OECE-{raw_codigo}"

    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM alertas WHERE codigo=%s", (raw_codigo,))
        row = cur.fetchone()
        if not row:
            tool_context.state["pending_market_flags"] = banderas_a_persistir
            return {
                "persistidas": 0,
                "skipped": True,
                "alerta_codigo": raw_codigo,
                "mensaje": "Alerta aún no creada. banderas quedan en state['pending_market_flags'].",
            }
        alerta_id = row[0]
        _fuente_oficial = f"https://contratacionesabiertas.oece.gob.pe/proceso/{state.get('ocid') or raw_codigo.replace('OECE-', '')}"

        # Idempotencia: borrar previas del mismo agente
        cur.execute(
            "DELETE FROM banderas WHERE alerta_id=%s AND agente_origen='market_price_agent'",
            (alerta_id,),
        )

        score_extra = 0
        for b in banderas_a_persistir:
            cur.execute(
                """INSERT INTO banderas
                       (alerta_id, regla, severidad, evidencia, norma,
                        fuente_url, agente_origen)
                   VALUES (%s, %s, %s, %s, %s, %s, 'market_price_agent')""",
                (alerta_id, b["regla"], b["severidad"], b["evidencia"][:500],
                 b["norma"][:300], _fuente_oficial),
            )
            score_extra += {"alta": 25, "media": 12, "baja": 5}.get(b["severidad"], 5)

        cur.execute("SELECT score FROM alertas WHERE id=%s", (alerta_id,))
        cur_score = (cur.fetchone() or [0])[0] or 0
        new_score = min(int(cur_score) + score_extra, 100)
        cur.execute("UPDATE alertas SET score=%s, updated_at=NOW() WHERE id=%s",
                    (new_score, alerta_id))
        conn.commit()
        return {
            "persistidas": len(banderas_a_persistir),
            "score_anterior": int(cur_score),
            "score_nuevo": new_score,
            "banderas": banderas_a_persistir,
        }
    except Exception as e:
        return {"error": str(e)[:200], "alerta_codigo": alerta_codigo}
    finally:
        conn.close()

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
    # Intenta parsear los outputs que vienen como JSON string del LLM
    def _try_parse(s):
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
        # 4. Fallback: preservar el texto crudo en lugar de retornar None.
        # Esto permite que el frontend muestre el raw output del sub-agente
        # como fallback (existe `news_research_raw` en el shape adapter).
        return {"_raw_text": s[:50000], "_parse_failed": True}

    # document_analysis: combinar el output del agente (que puede tener resumen
    # narrativo) con el parser_raw_consolidated (que tiene la data completa
    # de cada PDF procesado: items, firmantes, motivos, comité). El raw gana
    # en data estructurada; el output del agente aporta el resumen ejecutivo.
    doc_from_agent = _try_parse(state.get("document_analysis")) or {}
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

    analisis = {
        "market_analysis":      _try_parse(state.get("market_analysis")),
        "document_analysis":    doc_from_agent or doc_raw,
        "web_research":         _try_parse(state.get("web_research")),
        "news_research":        _try_parse(state.get("news_research")),
        "person_network":       _try_parse(state.get("person_network")),
        # Pre-fetched data por persona — el frontend lo usa para mostrar
        # vinculaciones políticas (ONPE/JNE/PEP/visitas) de TODAS las personas
        # investigadas (titular + socios + familia + firmantes + comité),
        # no solo de persona_principal.
        "person_network_context": state.get("person_network_context"),
        # CAPA 3 — funcionarios designados de la entidad (gerentes municipales,
        # procurador, asesor legal, OCI). Output del entity_personnel_agent.
        "entity_personnel": _try_parse(state.get("entity_personnel")),
        "normative_compliance": state.get("normative_compliance"),
        "compliance_summary":   state.get("compliance_result"),
        # Causal de Contratación Directa (si aplica) + acto resolutivo encontrado
        "causal_directa_invocada": state.get("causal_directa_invocada"),
        "acto_resolutivo_directa": state.get("acto_resolutivo_directa"),
        # Fase 1+2 — estado real y patrones de postores (incluso si no hay ganador)
        "estado_real":          state.get("estado_real"),
        "analisis_postores":    state.get("analisis_postores"),
    }
    dictamen_md = state.get("final_dictamen") or ""
    blob = json.dumps(analisis, ensure_ascii=False, default=str)

    # Normalizar el alerta_codigo: el LLM a veces pasa el OCID completo
    # (ej. 'ocds-dgv273-seacev3-1213010') en vez del código corto. Si detectamos
    # eso, lo convertimos a 'OECE-XXXXXXX'.
    raw_codigo = (alerta_codigo or "").strip()
    if raw_codigo.startswith("ocds-"):
        raw_codigo = "OECE-" + raw_codigo.split("-")[-1]
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
        # Migración idempotente (corre solo en la primera invocación)
        cur.execute(
            "ALTER TABLE alertas "
            "ADD COLUMN IF NOT EXISTS analisis_full JSONB, "
            "ADD COLUMN IF NOT EXISTS dictamen_markdown TEXT, "
            "ADD COLUMN IF NOT EXISTS analizado_en TIMESTAMPTZ"
        )
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
            cur.execute(
                """INSERT INTO alertas
                     (codigo, ocid, entidad_ruc, proveedor_ruc, monto_adjudicado,
                      fecha_buena_pro, region, score, reglas_disparadas, estado,
                      objeto, codigo_convocatoria, fuente_url, analizado_en)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, 0, '{}', 'activa',
                           %s, %s, %s, NOW())
                   ON CONFLICT (codigo) DO UPDATE SET analizado_en=NOW(),
                     updated_at=NOW()
                   RETURNING id""",
                (raw_codigo, ocid, ent_ruc, prov_ruc, cuantia, fbp, region,
                 (objeto or "")[:500], ocid.split("-")[-1],
                 f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"),
            )
            _stub_created = True
            print(f"[persist_analysis] stub creado para {raw_codigo} (convocatoria_existia={conv is not None})")

        # Si hay pending_doc_flags (skipeados antes porque no había alerta),
        # los insertamos ahora.
        pending_flags = state.get("pending_doc_flags") or []
        n_pending_inserted = 0
        if pending_flags:
            cur.execute("SELECT id FROM alertas WHERE codigo=%s", (raw_codigo,))
            r = cur.fetchone()
            if r:
                alerta_id = r[0]
                score_bump = 0
                for rf in pending_flags:
                    if isinstance(rf, str):
                        descr, sev, norma = rf, "media", None
                    elif isinstance(rf, dict):
                        descr = rf.get("descripcion") or rf.get("texto") or rf.get("evidencia") or str(rf)
                        sev = (rf.get("severidad") or "media").lower()
                        if sev not in ("alta", "media", "baja"):
                            sev = "media"
                        norma = rf.get("norma_citada") or rf.get("norma")
                    else:
                        continue
                    norma_final = (norma or "Art. 2 TUO Ley 30225 — Principio de Libertad de Concurrencia")[:300]
                    cur.execute(
                        """INSERT INTO banderas
                               (alerta_id, regla, severidad, evidencia, norma,
                                fuente_url, agente_origen)
                           VALUES (%s, %s, %s, %s, %s, %s, 'document_parser_agent')""",
                        (alerta_id, "red_flag_documental", sev, descr[:500], norma_final,
                         f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"),
                    )
                    n_pending_inserted += 1
                    score_bump += {"alta": 25, "media": 12, "baja": 5}.get(sev, 5)
                if score_bump:
                    cur.execute(
                        "UPDATE alertas SET score = LEAST(COALESCE(score, 0) + %s, 100), updated_at = NOW() WHERE id = %s",
                        (score_bump, alerta_id),
                    )

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
            "rows_updated": rows,
            "bytes_saved": len(blob),
            "dictamen_chars": len(dictamen_md),
        }
    except Exception as e:
        return {"persisted": False, "error": str(e)[:200], "alerta_codigo_input": alerta_codigo}
    finally:
        conn.close()

# ── FunctionTool wrappers ──
persist_alert_from_flags_tool = FunctionTool(func=persist_alert_from_flags)
add_contextual_flag_tool = FunctionTool(func=add_contextual_flag)
persist_doc_flags_as_banderas_tool = FunctionTool(func=persist_doc_flags_as_banderas)
persist_market_flags_as_banderas_tool = FunctionTool(func=persist_market_flags_as_banderas)
persist_analysis_outputs_tool = FunctionTool(func=persist_analysis_outputs)
