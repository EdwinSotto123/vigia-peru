"""compliance_rules._analysis — evaluación normativa (RAG legal), estado real y patrón de postores."""

from tools._core import *  # noqa: F401,F403
from tools.legal import query_legal_rag  # noqa: F401
from tools import verify as _verify  # noqa: F401
from tools.compliance_rules._base import _norma_state, _sin_tildes  # noqa: F401
from tools.compliance_rules._rules_lote1 import run_reglas_lote1  # noqa: F401
from tools.compliance_rules._object_matching import _misma_raiz, _tokens_raiz  # noqa: F401


def evaluate_normative_compliance(ocid: str, tool_context: ToolContext) -> dict:
    """Cruza TODAS las banderas detectadas (compliance + parser + market + person)
    contra el RAG legal de 723 opiniones OECE. Para cada bandera, devuelve la
    opinión OECE más relevante (num_opinion, link, snippet, score). Esto es lo
    que la UI muestra en la sección 'Cumplimiento Normativo'.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con `evaluaciones`: lista de {bandera, opinion_oece}.
    """
    state = tool_context.state
    # Lote 1: las reglas deterministas nuevas (oferta = VR, ofertas agrupadas, única oferta
    # válida, ganador no invitado, firmante con empresa RNP, ampliación denegada, postores
    # vinculados, oferta más barata no gana, fechas incoherentes) corren aquí, ANTES del
    # cruce RAG y de `persist_alert_from_flags`, porque el driver invoca esta función en
    # todos los perfiles. Idempotente (una vez por corrida).
    try:
        run_reglas_lote1(ocid, tool_context)
    except Exception as _e:  # nunca tumbar el cruce normativo por una regla nueva
        state.setdefault("descartes", []).append({"donde": "run_reglas_lote1", "motivos": [str(_e)[:160]]})
    # Acumular hallazgos de todas las fuentes
    hallazgos: list[dict] = []

    # 1) Banderas duras del compliance (pending_flags). Solo las que superan la
    #    verificación determinista: una bandera con RUC/monto no respaldado no debe
    #    "fundamentarse" con una opinión OECE (auditoría #3).
    for b in state.get("pending_flags") or []:
        if not isinstance(b, dict):
            continue
        ver = b.get("verificacion")
        if not isinstance(ver, dict):
            try:
                ver = _verify.verificar_bandera(b, state)
            except Exception:
                ver = {"ok": True}
        if ver.get("ok") is False:
            continue
        hallazgos.append({
            "fuente": "compliance_rule",
            "titulo": b.get("regla", "regla"),
            "descripcion": b.get("evidencia", ""),
            "severidad": b.get("severidad", "media"),
        })

    # 2) Red flags documentales: emitidos por document_legal_analyst_agent
    #    (fallback al campo legacy del document_analysis si todavía lo trae)
    legal = _safe_parse_json(state.get("legal_analysis"))
    red_flags_doc = (legal or {}).get("red_flags_documentales") or []
    if not red_flags_doc:
        doc = _safe_parse_json(state.get("document_analysis"))
        red_flags_doc = (doc or {}).get("red_flags_documentales") or []
    for f in red_flags_doc:
        if isinstance(f, dict):
            hallazgos.append({
                "fuente": "legal_analyst_red_flag",
                "titulo": (f.get("descripcion") or "")[:80],
                "descripcion": f.get("descripcion", ""),
                "severidad": f.get("severidad", "media"),
            })
        elif isinstance(f, str):
            hallazgos.append({
                "fuente": "legal_analyst_red_flag",
                "titulo": f[:80],
                "descripcion": f,
                "severidad": "media",
            })

    # 3) Hallazgos de market_price (spec restrictiva, sobreprecio)
    mk = _safe_parse_json(state.get("market_analysis"))
    for finding in (mk or {}).get("findings") or []:
        if finding.get("spec_restrictiva"):
            hallazgos.append({
                "fuente": "market_spec_restrictiva",
                "titulo": "Especificación restrictiva",
                "descripcion": finding.get("spec_restrictiva", ""),
                "severidad": "alta",
            })
        if finding.get("veredicto") in ("elevado", "muy_elevado"):
            hallazgos.append({
                "fuente": "market_sobreprecio",
                "titulo": f"Sobreprecio ítem {finding.get('item_numero')}",
                "descripcion": (finding.get("comentario") or "")[:300],
                "severidad": "alta" if finding.get("veredicto") == "muy_elevado" else "media",
            })

    # 4) Cruce firmantes ↔ ganador
    pn = _safe_parse_json(state.get("person_network"))
    for c in (pn or {}).get("cruce_firmantes_ganador") or []:
        if c.get("tipo_relacion") and c.get("tipo_relacion") != "sin_relacion":
            hallazgos.append({
                "fuente": "person_cruce",
                "titulo": f"Vínculo firmante↔ganador: {c.get('tipo_relacion')}",
                "descripcion": c.get("evidencia", ""),
                "severidad": c.get("severidad", "media"),
            })

    # Dedupe (misma fuente+título) y prioridad por severidad. Ya NO se corta a 10:
    # el tope es RAG_MAX_HALLAZGOS (default 60) y, si se supera, el recorte queda
    # registrado en state['recortes'] (auditoría 6.1-4).
    # `descripcion`/`titulo` a TEXTO: un cruce de la red de personas trae `evidencia` como LISTA
    # ([{url, cita}, …]); con una lista la clave de dedupe no es hasheable y la función entera caía
    # ("unhashable type: 'list'") → se perdían el cruce normativo y las reglas del lote 1 de la
    # corrida, en silencio (visto en 1225884 el 2026-09-26). La pregunta al RAG usa el mismo texto.
    def _texto(v) -> str:
        if isinstance(v, str):
            return v
        if isinstance(v, list):
            return " · ".join(_texto(x) for x in v if x not in (None, "", [], {}))
        if isinstance(v, dict):
            partes = [str(v.get(c)) for c in ("cita", "texto", "descripcion", "url", "fuente") if v.get(c)]
            return " — ".join(partes) if partes else json.dumps(v, ensure_ascii=False, default=str)
        return "" if v is None else str(v)
    for h in hallazgos:
        h["titulo"] = _texto(h.get("titulo"))
        h["descripcion"] = _texto(h.get("descripcion"))
    _vistos: set = set()
    _dedup: list[dict] = []
    for h in hallazgos:
        k = (str(h.get("fuente")), h["titulo"][:80], h["descripcion"][:120])
        if k in _vistos:
            continue
        _vistos.add(k)
        _dedup.append(h)
    _sev = {"alta": 0, "media": 1, "baja": 2}
    _dedup.sort(key=lambda h: _sev.get(str(h.get("severidad")), 3))
    _max = int(os.getenv("RAG_MAX_HALLAZGOS", "60"))
    if len(_dedup) > _max:
        state.setdefault("recortes", []).append({
            "donde": "evaluate_normative_compliance", "limite": _max,
            "omitido": len(_dedup) - _max,
            "detalle": "hallazgos de menor severidad sin cruce RAG"})
    hallazgos = _dedup[:_max]

    # Lote 1 · T3: una opinión OECE solo se adjunta si supera el umbral (`RAG_MIN_SCORE`,
    # default 0.7, cuando el backend expone score) Y trata del mismo tema (raíces en común
    # entre el hallazgo y el snippet; sin opiniones de obra para bienes/servicios). Antes
    # se pegaba `matches[0]` sin filtro: opiniones de metrados de obra, compras corporativas
    # o penalidades colgadas de banderas de objeto/cuantía (1225030, 1225058, 1225062, 1225256).
    perfil_nombre = str(((state.get("perfil") or {}).get("nombre")) or state.get("pipeline_profile") or "").lower()
    norma = _norma_state(state)
    evaluaciones = []
    for h in hallazgos:
        question = f"{h['titulo']}: {h['descripcion']}"
        opinion, motivo = None, None
        try:
            rag_resp = query_legal_rag(question, tool_context)
            matches = rag_resp.get("matches") or []
            opinion, motivo = _elegir_opinion_pertinente(h, matches, perfil_nombre, norma)
        except Exception as _e:
            motivo = f"rag_error:{str(_e)[:80]}"
        evaluaciones.append({
            "hallazgo": h,
            "opinion_oece": opinion,
            "motivo_sin_opinion": motivo if opinion is None else None,
        })

    out = {
        "ocid": ocid,
        "n_hallazgos_evaluados": len(evaluaciones),
        "n_hallazgos_totales": len(_dedup),
        "truncado": len(_dedup) > _max,
        "regimen": norma["regimen"],
        "evaluaciones": evaluaciones,
    }
    tool_context.state["normative_compliance"] = out
    return out


_RAG_STOP_TEMA = {"opinion", "consulta", "entidad", "entidades", "contratista", "proveedor", "proveedores",
                  "contrato", "contratos", "ley", "reglamento", "articulo", "norma", "normativa", "caso",
                  "supuesto", "procedimiento", "proceso", "seleccion", "postor", "postores", "oferta", "ofertas",
                  "monto", "montos", "valor", "valores", "referencial", "publica", "publico", "estado", "puede",
                  "debe", "corresponde", "aplica", "aplicacion", "conforme", "respecto", "dicha", "dicho"}
_TERMINOS_OBRA = ("metrado", "valorizacion", "valorizaciones", "adicional de obra", "expediente tecnico",
                  "residente", "supervisor de obra", "liquidacion de obra", "obra")


def _elegir_opinion_pertinente(h: dict, matches: list, perfil_nombre: str, norma: dict) -> tuple[dict | None, str | None]:
    """Primera opinión OECE que supere el umbral de score (si lo hay) y comparta tema con el
    hallazgo. Devuelve (opinion|None, motivo_si_none)."""
    if not matches:
        return None, "sin_matches"
    min_score = float(os.getenv("RAG_MIN_SCORE", "0.7") or 0.7)
    txt_h = _sin_tildes(f"{h.get('titulo') or ''} {h.get('descripcion') or ''}").lower()
    tok_h = {t for t in _tokens_raiz(txt_h) if t not in _RAG_STOP_TEMA}
    motivos = []
    for m in matches:
        if not isinstance(m, dict):
            continue
        sc = m.get("score")
        if isinstance(sc, (int, float)) and sc < min_score:
            motivos.append(f"score {sc:.2f} < {min_score}")
            continue
        snippet = _sin_tildes(" ".join(str(m.get(k) or "") for k in
                                       ("interpretacion_snippet", "snippet", "texto", "titulo", "tema"))).lower()
        tok_m = {t for t in _tokens_raiz(snippet) if t not in _RAG_STOP_TEMA}
        comunes = {a for a in tok_h for b in tok_m if _misma_raiz(a, b)}
        if len(comunes) < 2:
            motivos.append(f"tema no afín (raíces comunes: {len(comunes)})")
            continue
        if perfil_nombre in ("bienes", "servicios") and "obra" not in txt_h and \
                sum(1 for t in _TERMINOS_OBRA if t in snippet) >= 2:
            motivos.append("opinión sobre obras para un proceso de bienes/servicios")
            continue
        # Preferir opiniones del régimen aplicable si la opinión declara norma.
        nm = _sin_tildes(str(m.get("norma") or "")).lower()
        if norma.get("regimen") == "ley_32069" and "30225" in nm and "32069" not in nm:
            m = {**m, "_regimen_distinto": True}
        return m, None
    return None, "; ".join(motivos[:3]) or "sin opinión pertinente"

def detect_estado_real(ocid: str, tool_context: ToolContext) -> dict:
    """Detecta el estado REAL de una convocatoria cruzando OCDS contra los
    documentos del expediente. Sirve para identificar inconsistencias del tipo:
    'hay archivo de Buena Pro pero el OCDS dice convocatoria abierta'.

    Args:
        ocid: OCID OCDS (ej. 'ocds-dgv273-seacev3-1185504') o codigo corto.

    Returns:
        dict con:
          · estado_ocds: 'convocatoria_abierta' | 'adjudicada' | 'contrato_firmado' | 'desconocido'
          · estado_documentos: 'convocatoria' | 'buena_pro' | 'contrato' | 'cancelada'
          · estado_inconsistente: bool — true si OCDS y documentos no coinciden
          · n_postores_oferentes: int
          · n_awards: int
          · n_contracts: int
          · documentos_clave: lista de docs que sugieren estado (buena_pro, contrato, etc.)
          · evidencia: descripción human-readable
    """
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}

    # Si no tenemos OCDS, fallback a Cloud SQL
    if not ocds:
        conn = None
        try:
            conn = _pg()
            cur = conn.cursor()
            cur.execute("SELECT ocds_payload FROM convocatorias WHERE ocid = %s OR ocid LIKE %s LIMIT 1",
                        (ocid, f"%{ocid}"))
            row = cur.fetchone()
            if row and row[0]:
                ocds = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        except Exception as e:
            return {"error": f"no_ocds_disponible: {e}"}
        finally:
            if conn:
                conn.close()

    tender = ocds.get("tender") or {}
    awards = ocds.get("awards") or []
    contracts = ocds.get("contracts") or []
    documents = (tender.get("documents") or []) + sum(
        ((c.get("documents") or []) for c in contracts), []
    )
    tenderers = tender.get("tenderers") or []
    n_postores = len(tenderers) or int(tender.get("numberOfTenderers") or 0)

    # Estado OCDS
    if contracts:
        estado_ocds = "contrato_firmado"
    elif awards:
        estado_ocds = "adjudicada"
    elif tender:
        estado_ocds = "convocatoria_abierta"
    else:
        estado_ocds = "desconocido"

    # Detectar estado por documentos
    documentos_clave = []
    has_buena_pro = False
    has_contrato_doc = False
    has_cancelacion = False
    for d in documents:
        title = (d.get("title") or "").lower()
        dtype = (d.get("documentType") or "").lower()
        if (("buena" in title and "pro" in title) or
            "otorgamiento" in title or
            "awardnotice" in dtype):
            has_buena_pro = True
            documentos_clave.append({"tipo": "buena_pro", "titulo": d.get("title"), "fecha": d.get("datePublished"), "url": d.get("url")})
        elif ("contrato" in title and ("firmado" in title or "suscrito" in title)) or \
             "contractsigned" in dtype:
            has_contrato_doc = True
            documentos_clave.append({"tipo": "contrato_firmado", "titulo": d.get("title"), "fecha": d.get("datePublished"), "url": d.get("url")})
        elif "nulidad" in title or "cancelacion" in title or "cancelación" in title or "desierta" in title:
            has_cancelacion = True
            documentos_clave.append({"tipo": "cancelada", "titulo": d.get("title"), "fecha": d.get("datePublished"), "url": d.get("url")})

    if has_cancelacion:
        estado_documentos = "cancelada"
    elif has_contrato_doc:
        estado_documentos = "contrato"
    elif has_buena_pro:
        estado_documentos = "buena_pro"
    else:
        estado_documentos = "convocatoria"

    # Inconsistencia: OCDS dice convocatoria_abierta pero hay buena pro/contrato en docs
    estado_inconsistente = (
        (estado_ocds == "convocatoria_abierta" and estado_documentos in ("buena_pro", "contrato"))
        or
        (estado_ocds == "adjudicada" and estado_documentos == "contrato" and not contracts)
    )

    evidencia = (
        f"OCDS={estado_ocds} ({len(awards)} awards, {len(contracts)} contratos); "
        f"docs sugieren={estado_documentos}; postores={n_postores}; "
        f"docs_clave={len(documentos_clave)}"
    )
    if estado_inconsistente:
        evidencia += " · ⚠ INCONSISTENCIA: documentos publicados son posteriores al estado OCDS."

    return {
        "estado_ocds": estado_ocds,
        "estado_documentos": estado_documentos,
        "estado_inconsistente": estado_inconsistente,
        "n_postores_oferentes": n_postores,
        "n_awards": len(awards),
        "n_contracts": len(contracts),
        "documentos_clave": documentos_clave[:5],
        "evidencia": evidencia,
    }

def analyze_postores_pattern(ocid: str, tool_context: ToolContext) -> dict:
    """Analiza patrones sospechosos entre los postores que participaron en la
    convocatoria — útil cuando NO hay ganador (convocatoria abierta) o cuando
    querés evaluar si los perdedores fueron 'figurantes' de un cartel.

    Para cada postor analiza:
      · n_apariciones_base_vigia (apariciones del RUC en NUESTRA base de alertas;
        NO es su historial real en SEACE — ausencia = desconocido, no cero)
      · direccion_compartida (con otros postores del mismo proceso)
      · co_ocurrencia_en_base_vigia (OCIDs en que aparece junto a otros postores
        del proceso, SOLO dentro de los procesos ya analizados por Vigía)

    Args:
        ocid: OCID o codigo corto.

    Returns:
        dict con `postores: [{ruc, razon_social, sospechas: [...], score}]`
        + `patrones_red` (resumen agregado).
    """
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    if not ocds:
        return {"error": "no_ocds_disponible"}

    tender = ocds.get("tender") or {}
    parties = ocds.get("parties") or []
    tenderers_raw = tender.get("tenderers") or []

    # Extraer RUC + razón social de cada postor
    postores: list[dict] = []
    for t in tenderers_raw:
        pid = t.get("id") or ""
        ruc = pid.replace("PE-RUC-", "") if pid.startswith("PE-RUC-") else None
        nombre = t.get("name") or ""
        # Buscar más info en parties
        party = next((p for p in parties if p.get("id") == pid), None)
        direccion = None
        if party:
            addr = party.get("address") or {}
            direccion = ", ".join(filter(None, [
                addr.get("streetAddress"), addr.get("locality"), addr.get("region")
            ]))
        if ruc:
            postores.append({"ruc": ruc, "razon_social": nombre, "direccion": direccion})

    if not postores:
        return {"postores": [], "patrones_red": {}, "evidencia": "Sin postores en OCDS."}

    # Analizar cada postor contra Cloud SQL (RNP + alertas + convocatorias previas)
    conn = None
    try:
        conn = _pg()
        cur = conn.cursor()
        rucs = [p["ruc"] for p in postores]
        # Edad de RUC (vía SUNAT pública si la tenemos en BD; sino N/A)
        # n_otros_contratos: contar apariciones del RUC en alertas/convocatorias
        cur.execute(
            """SELECT proveedor_ruc, COUNT(*) AS n
                 FROM alertas
                WHERE proveedor_ruc = ANY(%s)
                GROUP BY proveedor_ruc""",
            (rucs,),
        )
        contratos_por_ruc = {r[0]: int(r[1]) for r in cur.fetchall()}

        # Co-ocurrencia: pares de postores que aparecen juntos en otros procesos
        # Usamos `convocatorias` o `postores` table — si no existe, omitimos.
        co_ocurrencia: dict = {}
        try:
            # Heurística: postores en común en convocatorias del proveedor adjudicado
            # (si la tabla `postores` o similar existe en BD).
            cur.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name='postores'"
            )
            cols_postores = {r[0] for r in cur.fetchall()}
            if "ocid" in cols_postores and "empresa_ruc" in cols_postores:
                # Buscar OCIDs donde participan ≥2 de los RUCs analizados, EXCLUYENDO el
                # proceso actual (lote 1 · T11: todo par del mismo proceso recibía
                # `co_ocurrencia:1` y +5 de score por co-ocurrir consigo mismo).
                _propio = {str(ocid or ""), _short_ocid(str(ocid or "")), _short_ocid(str(ocds.get("ocid") or ocid or ""))}
                cur.execute(
                    """SELECT empresa_ruc, ARRAY_AGG(DISTINCT ocid) AS ocids
                         FROM postores
                        WHERE empresa_ruc = ANY(%s)
                          AND ocid <> ALL(%s)
                        GROUP BY empresa_ruc""",
                    (rucs, sorted(_propio)),
                )
                ruc_to_ocids = {r[0]: {o for o in (r[1] or []) if _short_ocid(str(o)) not in _propio}
                                for r in cur.fetchall()}
                # Calcular intersecciones pair-wise
                for i, a in enumerate(rucs):
                    for b in rucs[i + 1:]:
                        common = ruc_to_ocids.get(a, set()) & ruc_to_ocids.get(b, set())
                        if common:
                            # Guardamos los OCIDs reales (no solo el conteo) para
                            # poder mostrarlos/linkearlos en la UI como evidencia.
                            co_ocurrencia[f"{a}↔{b}"] = sorted(common)
        except Exception:
            pass

    except Exception as e:
        contratos_por_ruc = {}
        co_ocurrencia = {}
    finally:
        if conn:
            conn.close()

    # Direcciones repetidas entre postores del mismo proceso (señal cartel)
    dir_map: dict = {}
    for p in postores:
        if p.get("direccion"):
            dir_map.setdefault(p["direccion"].lower().strip(), []).append(p["ruc"])
    direcciones_compartidas = {k: v for k, v in dir_map.items() if len(v) > 1}

    # Score y sospechas por postor.
    # ⚠ HONESTIDAD: `contratos_por_ruc` cuenta apariciones del RUC en NUESTRA
    # base de alertas (procesos ya analizados por Vigía), NO su historial real
    # en el SEACE. Una empresa ausente de nuestra base tiene historial
    # DESCONOCIDO, no cero. Por eso NO emitimos "sin_historial_contractual"
    # como bandera: sería un falso positivo contra contratistas legítimos
    # (ej. un proveedor con 20 contratos reales aparecería como "sin historial").
    for p in postores:
        sospechas = []
        score = 0
        ruc = p["ruc"]
        n_apariciones = contratos_por_ruc.get(ruc, 0)
        # Dirección compartida con otro postor del MISMO proceso (señal válida).
        if p.get("direccion") and p["direccion"].lower().strip() in direcciones_compartidas:
            sospechas.append("direccion_compartida_con_otro_postor")
            score += 35
        # Co-ocurrencia con otros postores — SOLO dentro de la base de Vigía.
        ocids_co = sorted({o for k, v in co_ocurrencia.items() if ruc in k for o in v})
        if ocids_co:
            sospechas.append(f"co_ocurrencia_en_base_vigia:{len(ocids_co)}")
            score += min(len(ocids_co) * 5, 30)

        # Informativo (no bandera): apariciones en la base de Vigía.
        p["n_apariciones_base_vigia"] = n_apariciones
        p["ocids_co_ocurrencia"] = ocids_co
        p["sospechas"] = sospechas
        p["score_sospecha"] = min(score, 100)

    # Ordenar por score descendente
    postores.sort(key=lambda x: x["score_sospecha"], reverse=True)

    # Patrones agregados
    patrones = {
        "n_postores_total": len(postores),
        "n_con_direccion_compartida": sum(1 for p in postores if any("direccion_compartida" in s for s in p["sospechas"])),
        "n_con_co_ocurrencia": sum(1 for p in postores if any(s.startswith("co_ocurrencia") for s in p["sospechas"])),
        "direcciones_repetidas": {k: v for k, v in direcciones_compartidas.items()},
        "pares_co_ocurrentes": co_ocurrencia,  # {par: [ocids]} — dentro de la base de Vigía
        "_nota_alcance": ("Conteos y co-ocurrencias son SOLO sobre procesos ya "
                          "analizados por Vigía, no el universo completo del SEACE."),
    }

    result = {
        "postores": postores[:15],  # Top 15 más sospechosos
        "patrones_red": patrones,
        "evidencia": f"Analizados {len(postores)} postores · "
                     f"{len(direcciones_compartidas)} direcciones compartidas · "
                     f"{len(co_ocurrencia)} pares con co-ocurrencia en la base de Vigía.",
    }
    # Persistir en state para que el adapter lo expose a la UI
    state["analisis_postores"] = result
    return result

def _detect_estado_real_persist(ocid: str, tool_context: ToolContext) -> dict:
    """Wrapper que persiste el resultado en state para que la UI lo lea."""
    r = detect_estado_real(ocid, tool_context)
    tool_context.state["estado_real"] = r
    return r
evaluate_normative_compliance_tool = FunctionTool(func=evaluate_normative_compliance)
detect_estado_real_tool = FunctionTool(func=_detect_estado_real_persist)
analyze_postores_pattern_tool = FunctionTool(func=analyze_postores_pattern)
