"""Tool pública legacy `parse_document_pdf`: descarga + expansión de contenedores +
page-sharding + llamadas Gemini en paralelo + consolidación en state."""

from tools._core import *  # noqa: F401,F403
from ._base import _perfil_params, PARSE_GLOBAL_BUDGET_S, PARSE_OVERALL_TIMEOUT_S, PARSE_MAX_WORKERS
from .fetch import _fetch_doc_bytes
from .contenedores import _expandir_contenedor
from .legacy_extract import _paginas_a_pdf_sintetico, _parse_single_pdf_with_gemini
from .pdf_utils import _split_pdf_by_pages
from .item_matching import _item_key
from .clasificacion import _es_doc_contratacion, _es_doc_de_adjudicacion, _es_doc_resultado
from .entidades import _rucs_ocds, _fusionar_postor, _ofertas_desde_postores


def parse_document_pdf(document_url: str, tool_context: ToolContext) -> dict:
    """Descarga un documento de SEACE y lo procesa con Gemini 2.5 Flash.
    SI el documento es un ZIP, descomprime y procesa TODOS los PDFs internos
    en paralelo (hasta 5 por archivo). Devuelve un consolidado.

    Estrategia de descarga (en orden):
      1. state['docs_b64'][url] — inline b64 del bridge (PDFs chicos).
      2. state['doc_urls'][url] — GCS bucket (PDFs grandes archivados por el bridge).
      3. OECE_RELAY_URL — Cloudflare Worker que bypassa el WAF.
      4. Directo — último recurso (suele dar 403 desde IPs de GCP).

    Args:
        document_url: URL del documento (`tender.documents[].url` del OCDS).

    Returns:
        Diccionario con `pdfs_procesados` (lista, uno por PDF interno), más
        consolidados: items_consolidados, postores_consolidados, red_flags,
        cuantia_total, fundamento_legal. Si la descarga falló, devuelve
        `error` + `_fetch_attempts` describiendo qué se intentó.
    """
    # ── Caché por URL (fix #2): si ya parseamos este documento en este run, NO
    #    re-descargamos ni re-OCR'eamos (Document AI + Gemini son caros). El primer
    #    parseo ya volcó su data a state['parser_raw_consolidated']; devolvemos el
    #    output compacto cacheado.
    _pdoc_cache = tool_context.state.get("_parsed_doc_cache") or {}
    if document_url in _pdoc_cache:
        print(f"[parse] cache HIT · ...{document_url[-44:]} — evito re-descarga/re-OCR", flush=True)
        return _pdoc_cache[document_url]

    blob, fetch_source, fetch_error = _fetch_doc_bytes(document_url, tool_context)
    if blob is None:
        return {
            "error": "download_failed",
            "url": document_url,
            "_fetch_attempts": fetch_error,
        }

    # Expansión de contenedores SIN topes (ZIP/RAR anidados, DOCX, XLSX, imágenes): cada
    # archivo interno es una unidad, ordenada por la prioridad del perfil. Lo que no se
    # pudo abrir queda en state['recortes'] (antes: 3 PDF + 3 DOCX por ZIP, sin registro).
    _prio = _perfil_params(tool_context.state)[1]
    _unidades, _rec = _expandir_contenedor(blob, document_url.rsplit("/", 1)[-1][:80], _prio)
    if _rec:
        tool_context.state.setdefault("recortes", [])
        tool_context.state["recortes"].extend(_rec)
    pdf_blobs: list[tuple[str, bytes]] = []
    for _u in _unidades:
        if _u["kind"] in ("pdf", "imagenes") and _u.get("data"):
            pdf_blobs.append((_u["nombre"], _u["data"]))
        elif _u["kind"] == "paginas":
            _synth = _paginas_a_pdf_sintetico(_u.get("paginas") or [])
            if _synth:
                pdf_blobs.append((f"{_u['nombre']} (texto→PDF sintético)", _synth))
    if not pdf_blobs:
        return {"error": "sin_contenido_procesable", "url": document_url, "size": len(blob),
                "first_bytes_hex": blob[:8].hex(), "recortes": _rec}

    # Estrategia de partición según el extractor disponible:
    #   · CON Document AI: NO shardeаmos para Gemini. El doc entero va como 1
    #     unidad → docai.extract_text_docai hace OCR (chunkeа a ≤30 págs INTERNO
    #     por el límite de la API) y CONCATENA el texto → Gemini estructura TODO
    #     en UNA sola llamada (90 págs ≈ 200-300K chars, entran de sobra).
    #   · SIN Document AI (fallback): page-sharding histórico — sub-PDFs por
    #     rango → varias llamadas Gemini Vision más chicas en paralelo.
    try:
        from tools.docai import docai_enabled
        _use_docai = docai_enabled()
    except Exception:
        _use_docai = False

    _expanded: list[tuple[str, bytes]] = []
    for (name, b) in pdf_blobs:
        if isinstance(b, (bytes, bytearray)) and b[:4] == b"%PDF" and not _use_docai:
            _expanded.extend(_split_pdf_by_pages(bytes(b), name))
        else:
            _expanded.append((name, b))  # con docai: doc entero (1 sola llamada Gemini)
    pdf_blobs = _expanded

    pdfs_procesados: list[dict] = [None] * len(pdf_blobs)
    # La concurrencia REAL la limita _throttle_gemini (semáforo global) para no
    # gatillar el rate limiter; el pool sólo encola los shards listos.
    #
    # TECHO GLOBAL: `as_completed(timeout=...)` corta a los PARSE_OVERALL_TIMEOUT_S
    # aunque algún shard se haya quedado lento. Antes esto usaba un `with` +
    # `fut.result(timeout=120)` que era código muerto (as_completed sólo entrega
    # futures YA terminados) y, peor, el `with` hacía shutdown(wait=True) → esperaba
    # igual a los hilos lentos. Resultado: una llamada Gemini de 7m+ colgaba toda la
    # corrida y nunca se llegaba al writer/persist/force_flush.
    # Presupuesto GLOBAL compartido: el 1er parse fija el deadline; los siguientes
    # respetan lo que queda. El techo efectivo de ESTE documento = min(techo
    # por-documento, presupuesto global restante), con un piso de 30s.
    _now = time.monotonic()
    _deadline = tool_context.state.get("_parse_deadline")
    if not isinstance(_deadline, (int, float)):
        _deadline = _now + PARSE_GLOBAL_BUDGET_S
        try:
            tool_context.state["_parse_deadline"] = _deadline
        except Exception:
            pass
    _eff_timeout = max(30.0, min(float(PARSE_OVERALL_TIMEOUT_S), _deadline - _now))

    ex = concurrent.futures.ThreadPoolExecutor(max_workers=PARSE_MAX_WORKERS)
    futures = {
        ex.submit(_parse_single_pdf_with_gemini, b, name): i
        for i, (name, b) in enumerate(pdf_blobs)
    }
    try:
        for fut in concurrent.futures.as_completed(futures, timeout=_eff_timeout):
            i = futures[fut]
            try:
                pdfs_procesados[i] = fut.result()
            except Exception as e:
                pdfs_procesados[i] = {"error": f"parallel exec failed: {str(e)[:120]}",
                                       "_source": pdf_blobs[i][0]}
    except concurrent.futures.TimeoutError:
        pendientes = [i for i in futures.values() if pdfs_procesados[i] is None]
        print(f"[parser] techo {_eff_timeout:.0f}s agotado (global restante {_deadline-_now:.0f}s) · "
              f"{len(pendientes)}/{len(futures)} shard(s) sin terminar → marcados timeout",
              flush=True)
        for i in pendientes:
            pdfs_procesados[i] = {"error": f"parse timeout (>{PARSE_OVERALL_TIMEOUT_S}s)",
                                   "_source": pdf_blobs[i][0]}
    finally:
        # No esperamos a los hilos lentos (no se pueden matar en Python); cancelamos
        # los encolados y seguimos el pipeline. Sus llamadas Gemini liberan el
        # semáforo de _throttle_gemini cuando terminen por su cuenta.
        ex.shutdown(wait=False, cancel_futures=True)

    items_all: list[dict] = []
    postores_all: list[dict] = []
    red_flags_all: list[str] = []
    fundamento_all: list[str] = []
    firmantes_all: list[dict] = []
    comite_all: list[dict] = []
    motivos_all: list[dict] = []
    lugar_fecha_acta = None
    cuantia_total = None
    algun_pdf_con_requerimiento = False
    estudio_mercado_best = None   # bloque tipado del Resumen Ejecutivo/Informe
    contrato_final_best = None    # bloque tipado de la Orden de Compra/Contrato

    def _mas_completo(nuevo, actual):
        """Devuelve el dict con más contenido (más campos no-nulos)."""
        def _peso(d):
            if not isinstance(d, dict):
                return 0
            return sum(1 for v in d.values() if v not in (None, "", [], {}))
        return nuevo if _peso(nuevo) > _peso(actual) else actual

    for r in pdfs_procesados:
        if "error" in r:
            continue
        if isinstance(r.get("estudio_mercado"), dict):
            estudio_mercado_best = _mas_completo(r["estudio_mercado"], estudio_mercado_best)
        if isinstance(r.get("contrato_final"), dict):
            contrato_final_best = _mas_completo(r["contrato_final"], contrato_final_best)
        # Los ÍTEMS con especificaciones viven en el documento de REQUERIMIENTO
        # (Bases Administrativas / EETT / TDR). Acta de Buena Pro, Cuadro de evaluación,
        # Invitación y Contrato solo repiten el TÍTULO del contrato como "ítem" (sin
        # specs) → ese era el RUIDO que después había que deduplicar (cabecera-objeto,
        # 9→7, 15→7...). Tomamos ítems SOLO de fuentes de requerimiento: el LLM marcó
        # contiene_requerimiento=true, O algún ítem trae requerimiento_tecnico_detallado
        # real (robusto si el LLM no marcó el flag). Misma filosofía que el gate de
        # comité/motivos por _es_doc_de_adjudicacion (abajo). Si NINGÚN doc resulta
        # fuente de requerimiento, items_consolidados queda vacío y lo cubren los ítems
        # del OCDS (SQL) + la bandera extraccion_documento_fallida — sin meter ruido.
        _es_fuente_req = (not _es_doc_contratacion(r.get("tipo_documento_detectado"))) and (
            bool(r.get("contiene_requerimiento")) or any(
                isinstance(it, dict) and len(str(it.get("requerimiento_tecnico_detallado") or "").strip()) > 40
                for it in (r.get("items") or [])))
        if _es_fuente_req:
            items_all.extend(r.get("items") or [])
        for _p in (r.get("postores") or []):
            if isinstance(_p, dict):
                postores_all.append({**_p, "_es_adjudicacion": _es_doc_resultado(r.get("tipo_documento_detectado"))})
        # red_flags_observadas: campo legacy, ya no se pide al parser. El análisis
        # legal lo hace `document_legal_analyst_agent` aparte. Si algún parser
        # legacy aún lo emite, lo recolectamos pero el flujo ya no depende de eso.
        red_flags_all.extend(r.get("red_flags_observadas") or [])
        fundamento_all.extend(r.get("fundamento_legal") or [])
        firmantes_all.extend(r.get("firmantes") or [])
        # comité / motivos de adjudicación / acta SOLO existen en documentos de la
        # etapa de adjudicación/contrato. Si vienen de un Bases/TDR/EETT/Resumen
        # (pre-adjudicación), el LLM los inventó → se ignoran. Gate por tipo de doc.
        if _es_doc_de_adjudicacion(r.get("tipo_documento_detectado")):
            comite_all.extend(r.get("comite_evaluacion") or [])
            motivos_all.extend(r.get("motivos_adjudicacion") or [])
            if r.get("lugar_fecha_acta") and not lugar_fecha_acta:
                lugar_fecha_acta = r.get("lugar_fecha_acta")
        if r.get("contiene_requerimiento"):
            algun_pdf_con_requerimiento = True
        if cuantia_total is None and r.get("cuantia_total"):
            cuantia_total = r["cuantia_total"]

    # Items consolidados: dedup por clave SEMÁNTICA (descripción+cantidad), no por
    # número (fix #1). Priorizamos el `requerimiento_tecnico_detallado` más largo.
    consolidado_by_key: dict = {}
    for it in items_all:
        key = _item_key(it) or ("_unk", len(consolidado_by_key))
        actual = consolidado_by_key.get(key)
        if actual is None:
            consolidado_by_key[key] = dict(it)
            continue
        # Merge: campos no nulos del nuevo sobrescriben sólo si el actual no tiene
        for k, v in it.items():
            if v in (None, "", [], {}):
                continue
            cur = actual.get(k)
            # El requerimiento_tecnico_detallado más LARGO gana
            if k == "requerimiento_tecnico_detallado":
                if not cur or (isinstance(v, str) and len(v) > len(cur or "")):
                    actual[k] = v
            elif cur in (None, "", [], {}):
                actual[k] = v
    items_consolidados = list(consolidado_by_key.values())

    # Deduplicar firmantes por nombre+cargo
    seen_firm = set()
    firmantes_dedup = []
    for f in firmantes_all:
        if not isinstance(f, dict):
            continue
        # Usar `or ""` para tolerar valores None explícitos (que .get() con default
        # no captura — solo captura key-missing).
        key = ((f.get("nombre_completo") or "").strip().upper(),
               (f.get("cargo") or "").strip().upper())
        if key in seen_firm or not key[0]:
            continue
        seen_firm.add(key)
        firmantes_dedup.append(f)

    # Output COMPACTO para no inflar el context del orquestador. La data
    # completa va a state['parser_raw_consolidated'] (líneas abajo) y
    # build_market_input / persist_analysis_outputs la leen desde ahí.
    # Si el orquestador o el agent quieren ver detalle, leen state.
    output_dict = {
        "n_pdfs_procesados": len(pdfs_procesados),
        "n_pdfs_con_error": sum(1 for r in pdfs_procesados if "error" in r),
        "algun_pdf_con_requerimiento": algun_pdf_con_requerimiento,
        "n_items_consolidados": len(items_consolidados),
        "n_postores": len(postores_all),
        "n_firmantes": len(firmantes_dedup),
        "n_motivos_adjudicacion": len(motivos_all),
        "tiene_acta": bool(lugar_fecha_acta),
        "cuantia_total": cuantia_total,
        "_url": document_url,
        "_fetch_source": fetch_source,
        "_note": "Detalle completo en state['parser_raw_consolidated']",
    }
    # Detalle completo SOLO si hubo error en TODOS los PDFs (para debug).
    # Si todo ok, no devolvemos `pdfs_procesados` al caller.
    if output_dict["n_pdfs_con_error"] >= output_dict["n_pdfs_procesados"] and output_dict["n_pdfs_procesados"] > 0:
        output_dict["pdfs_procesados_debug"] = pdfs_procesados

    # GUARDAR el output ACUMULADO en state['parser_raw_consolidated'] para que
    # build_market_input y otros consumers puedan leer la data completa
    # SIN depender de que el agente document_parser la incluya íntegra en
    # su respuesta final (que se guarda en state['document_analysis']).
    # Cada vez que se procesa un PDF, mergeamos sus items/postores/firmantes
    # al acumulador.
    raw = tool_context.state.get("parser_raw_consolidated") or {
        "items_consolidados": [],
        "postores_consolidados": [],
        "firmantes_consolidados": [],
        "comite_evaluacion": [],
        "motivos_adjudicacion": [],
        "red_flags_observadas": [],
        "fundamento_legal": [],
        "documentos": [],
    }
    # Dedup items por clave SEMÁNTICA (fix #1) — antes era por `numero`, que dejaba
    # pasar el mismo ítem numerado distinto en dos documentos ('2' vs '02').
    existing_keys = {}
    for _it in raw["items_consolidados"]:
        _k = _item_key(_it)
        if _k is not None:
            existing_keys[_k] = _it
    for it in items_consolidados:
        k = _item_key(it)
        if k is None:
            raw["items_consolidados"].append(it)
            continue
        prev = existing_keys.get(k)
        if prev is None:
            raw["items_consolidados"].append(it)
            existing_keys[k] = it
        else:
            # Ya existe (mismo ítem desde otro doc): conservamos el requerimiento
            # técnico más largo y descartamos el duplicado.
            new_req = it.get("requerimiento_tecnico_detallado") or ""
            cur_req = prev.get("requerimiento_tecnico_detallado") or ""
            if len(new_req) > len(cur_req):
                prev["requerimiento_tecnico_detallado"] = new_req
    # Postores: fusión por RUC válido / razón social (nunca se descarta el repetido: se completan
    # monto_oferta / es_ganador / puntaje / estado desde el acta) — mismo helper que el lote.
    _rucs_conocidos = _rucs_ocds(tool_context.state)
    for p in postores_all:
        _fusionar_postor(raw["postores_consolidados"], {k: v for k, v in p.items() if k != "_es_adjudicacion"},
                         bool(p.get("_es_adjudicacion")), p.get("documento_sha256"), _rucs_conocidos)
    for p in raw["postores_consolidados"]:
        p.pop("_fuente_adjudicacion", None)
    raw["postores"] = raw["postores_consolidados"]
    raw["ofertas"] = _ofertas_desde_postores(raw["postores_consolidados"])
    # Dedup firmantes por (nombre, cargo)
    seen_firm = {((f.get("nombre_completo") or "").upper(), (f.get("cargo") or "").upper())
                 for f in raw["firmantes_consolidados"]}
    for f in firmantes_dedup:
        key = ((f.get("nombre_completo") or "").upper(), (f.get("cargo") or "").upper())
        if key not in seen_firm:
            raw["firmantes_consolidados"].append(f)
            seen_firm.add(key)
    # Extends simples
    raw["comite_evaluacion"].extend(comite_all)
    raw["motivos_adjudicacion"].extend(motivos_all)
    raw["red_flags_observadas"] = list(dict.fromkeys(
        raw["red_flags_observadas"] + list(red_flags_all)
    ))
    raw["fundamento_legal"] = list(dict.fromkeys(
        raw["fundamento_legal"] + list(fundamento_all)
    ))
    raw["documentos"].append({
        "url": document_url,
        "n_pdfs_procesados": len(pdfs_procesados),
        "n_pdfs_con_error": sum(1 for r in pdfs_procesados if "error" in r),
        "algun_pdf_con_requerimiento": algun_pdf_con_requerimiento,
        "_fetch_source": fetch_source,
    })
    if lugar_fecha_acta and not raw.get("lugar_fecha_acta"):
        raw["lugar_fecha_acta"] = lugar_fecha_acta
    if cuantia_total and not raw.get("cuantia_total"):
        raw["cuantia_total"] = cuantia_total

    # NOTA: NO hay consolidación/dedup fuzzy de ítems. Los ítems vienen SOLO de la fuente
    # de requerimiento (la Bases — gate de `items_all` arriba) y Document AI manda esa
    # Bases a Gemini en UNA sola extracción → la lista ya sale limpia. El dedup por
    # `_item_key` (descripción+cantidad, arriba) basta para fundir un mismo renglón
    # repetido entre documentos SIN fusionar productos distintos. Se eliminó el pase LLM
    # de consolidación y las heurísticas (_merge_item_variants/_es_cabecera_objeto): con
    # una sola fuente limpia eran complejidad autoinfligida y sobre-fusionaban ítems
    # legítimamente distintos (ej. 'AMPLIFICADOR DE AUDIO' vs 'AMPLIFICADOR DE AUDIO DE 600 W').
    print(f"[parser] {len(raw.get('items_consolidados') or [])} ítems (de la fuente de requerimiento, sin dedup fuzzy)", flush=True)

    tool_context.state["parser_raw_consolidated"] = raw

    # ── Bloques tipados (ruteo incremental) ──
    # El Resumen Ejecutivo / Orden de Compra suelen venir en llamadas distintas a
    # parse_document_pdf; acumulamos quedándonos con el más completo entre corridas.
    if estudio_mercado_best:
        tool_context.state["estudio_mercado"] = _mas_completo(
            estudio_mercado_best, tool_context.state.get("estudio_mercado"))
        output_dict["tiene_estudio_mercado"] = True
    if contrato_final_best:
        tool_context.state["contrato_final"] = _mas_completo(
            contrato_final_best, tool_context.state.get("contrato_final"))
        output_dict["tiene_contrato_final"] = True

    # Cachear el output compacto por URL (fix #2) para no re-parsear el mismo doc.
    _pdoc_cache[document_url] = output_dict
    tool_context.state["_parsed_doc_cache"] = _pdoc_cache

    return output_dict
