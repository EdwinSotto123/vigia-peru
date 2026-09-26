"""Tools del dominio: market."""

from tools._core import *  # noqa: F401,F403
from tools.costo_llm import etiquetas
from .ancla_regional import _ancla_regional_item, _consultar_referencias_internas
from .config import (MARKET_CHUNK_SIZE, MARKET_CHUNK_SIZE_ESTIMACION, MARKET_COBERTURA_LOTE,
    MARKET_DELTA_IMPLAUSIBLE, MARKET_ESTIMACION_DESDE, MARKET_MAX_WORKERS, MARKET_MIN_PRECIOS,
    MARKET_RETRY, MARKET_TIMEOUT_S, MARKET_UMBRAL_ELEVADO, MARKET_USD_PEN, MARKET_WORKER_MODEL)
from .historico_seace import _cubsos_del_record
from .state_io import read_market_input
from .normalizar import (_StateCtx, _contexto_unidad_item, _diff_pct, _filtrar_outliers,
    _finding_vacio, _market_to_num, _mediana, _norm_num, _normalizar_precio_observado,
    _publicar_grounding, _registrar_descarte, _registrar_recorte, _veredicto)
from .prompts import _MARKET_WORKER_INSTRUCCIONES, _ESTIMACION_INSTRUCCIONES

_LINEA_PRECIO_RE = re.compile(
    r"^\W*(?:í|i)tem\s*(?P<num>[\w.\-/]+)\s*:\s*el producto\s*[\"“«']?(?P<producto>.+?)[\"”»']?\s*"
    r"se ofrece a\s*(?P<moneda>S/\.?|PEN|USD|US\$|\$)\s*(?P<precio>\d[\d.,]*)"
    r"(?:\s*por\s+(?P<unidad>.+?))?(?:\s+en\s+(?P<tienda>.+?))?[.\s]*$",
    re.IGNORECASE,
)
_LINEA_SIN_RE = re.compile(r"^\W*(?:í|i)tem\s*(?P<num>[\w.\-/]+)\s*:\s*sin precios observados", re.IGNORECASE)
_LINEA_COMENT_RE = re.compile(r"^\W*comentario\s+(?:í|i)tem\s*(?P<num>[\w.\-/]+)\s*:\s*(?P<texto>.+)$", re.IGNORECASE)


def _spans_grounding(text: str, gm) -> list[tuple[int, int, list[int]]]:
    """[(start_char, end_char, [chunk_idx…])] a partir de `grounding_supports` (offsets en
    BYTES UTF-8 según la API) convertidos a offsets de caracteres."""
    spans = []
    if not gm or not getattr(gm, "grounding_supports", None):
        return spans
    b = text.encode("utf-8")
    for s in gm.grounding_supports:
        seg = getattr(s, "segment", None)
        if seg is None:
            continue
        sb = seg.start_index or 0
        eb = seg.end_index if seg.end_index is not None else len(b)
        try:
            sc = len(b[:sb].decode("utf-8", errors="ignore"))
            ec = len(b[:eb].decode("utf-8", errors="ignore"))
        except Exception:
            continue
        idx = [int(i) for i in (s.grounding_chunk_indices or [])]
        # Respaldo: si los offsets no calzan, buscar el texto del segmento.
        if seg.text and text[sc:ec].strip() != seg.text.strip():
            pos = text.find(seg.text.strip())
            if pos >= 0:
                sc, ec = pos, pos + len(seg.text.strip())
        spans.append((sc, ec, idx))
    return spans


def _chunks_grounding(gm) -> list[dict]:
    out = []
    for c in (getattr(gm, "grounding_chunks", None) or []):
        w = getattr(c, "web", None)
        if w is None or not getattr(w, "uri", None):
            out.append({"uri": None, "titulo": None, "dominio": None})
            continue
        out.append({"uri": w.uri, "titulo": getattr(w, "title", None), "dominio": getattr(w, "domain", None)})
    return out


def _parsear_worker(text: str, gm, items_chunk: list) -> dict:
    """Parsea la prosa del worker línea a línea y le asigna a cada precio las URLs de los
    chunks de grounding cuyo soporte cubre esa línea. Sin soporte → descarte."""
    chunks = _chunks_grounding(gm)
    spans = _spans_grounding(text, gm)
    nums_validos = {_norm_num(it.get("numero")) for it in items_chunk}
    precios, comentarios, sin_precios, descartes = [], {}, set(), []
    pos = 0
    for raw in text.splitlines():
        start = text.find(raw, pos)
        if start < 0:
            start = pos
        end = start + len(raw)
        pos = end
        linea = raw.strip()
        if not linea:
            continue
        m = _LINEA_COMENT_RE.match(linea)
        if m:
            comentarios[_norm_num(m.group("num"))] = m.group("texto").strip()[:800]
            continue
        m = _LINEA_SIN_RE.match(linea)
        if m:
            sin_precios.add(_norm_num(m.group("num")))
            continue
        m = _LINEA_PRECIO_RE.match(linea)
        if not m:
            if len(linea) > 20:
                descartes.append({"motivo": "linea_no_parseable", "detalle": linea[:160]})
            continue
        num = _norm_num(m.group("num"))
        if num not in nums_validos:
            descartes.append({"motivo": "item_no_solicitado", "detalle": linea[:160]})
            continue
        precio = _market_to_num(m.group("precio"))
        if precio is None:
            descartes.append({"motivo": "precio_no_numerico", "detalle": linea[:160]})
            continue
        moneda = "USD" if m.group("moneda").upper().replace(".", "") in ("USD", "US$", "$") else "PEN"
        idxs: list[int] = []
        for sc, ec, idx in spans:
            if sc < end and ec > start:   # solape del soporte con la línea
                idxs.extend(i for i in idx if i not in idxs)
        fuentes = [chunks[i] for i in idxs if 0 <= i < len(chunks) and chunks[i].get("uri")]
        if not fuentes:
            descartes.append({"motivo": "precio_sin_grounding", "detalle": linea[:160]})
            continue
        precios.append({
            "item_numero": num,
            "producto": m.group("producto").strip()[:300],
            "precio": precio,
            "moneda_origen": moneda,
            "unidad": (m.group("unidad") or "Unidad").strip()[:60],
            "proveedor": (m.group("tienda") or fuentes[0].get("dominio") or "").strip()[:200] or None,
            "fuentes": fuentes,
        })
    return {"precios": precios, "comentarios": comentarios, "sin_precios": sin_precios,
            "descartes": descartes, "chunks": [c for c in chunks if c.get("uri")],
            "n_soportes": len(spans)}


def _worker_goods_retail(items_chunk: list, objeto: str, idx: int, contexto: str = "") -> dict:
    """Worker: precia ~3 ítems con UNA llamada Gemini + google_search (grounding)."""
    from google.genai import types
    items_min = []
    for it in items_chunk:
        items_min.append({
            "numero": it.get("numero"),
            "descripcion_corta": (it.get("descripcion_corta") or "")[:300],
            "cantidad": it.get("cantidad"), "unidad": it.get("unidad"),
            "marca_o_modelo_exigido": it.get("marca_o_modelo_exigido"),
            "certificaciones_exigidas": (it.get("certificaciones_exigidas") or [])[:6],
            "requerimiento_tecnico_detallado": (str(it.get("requerimiento_tecnico_detallado") or ""))[:1500] or None,
        })
    prompt = (
        "Eres un analista de precios de mercado peruano. Tu herramienta es Google Search "
        "(grounding en vivo).\n\n"
        f"OBJETO DEL CONTRATO: {objeto[:300]}\n"
        "Cada ítem de abajo pertenece a ese objeto: no busques productos de otro rubro.\n"
        f"{(contexto or '')[:400]}\n\n"
        f"ÍTEMS A PRECIAR ({len(items_chunk)}):\n{json.dumps(items_min, ensure_ascii=False)}\n"
        f"{_MARKET_WORKER_INSTRUCCIONES}"
    )
    client = _gemini_client()
    cfg = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())],
        temperature=0.2,
        max_output_tokens=8192,
        # Buscar y transcribir precios: sin thinking_config el worker pensaba en MEDIUM y la
        # salida la dominaba el razonamiento.
        thinking_config=thinking_crudo("market", MARKET_WORKER_MODEL, "low"),
        labels=etiquetas("mercado"),
    )

    # Sin _throttle_gemini(): el semáforo global (2) serializaría los workers. La
    # concurrencia la acota el ThreadPool; los 429 los maneja el retry exponencial.
    def _call():
        return client.models.generate_content(model=MARKET_WORKER_MODEL, contents=prompt, config=cfg)

    resp = _gemini_call_with_retry(_call)
    text = getattr(resp, "text", "") or ""
    gm = None
    try:
        gm = resp.candidates[0].grounding_metadata
    except Exception:
        gm = None
    out = _parsear_worker(text, gm, items_chunk)
    out["idx"] = idx
    out["queries"] = list(getattr(gm, "web_search_queries", None) or []) if gm else []
    out["raw_len"] = len(text)
    try:
        um = resp.usage_metadata
        out["tokens"] = {"prompt": um.prompt_token_count, "salida": um.candidates_token_count,
                         "pensamiento": getattr(um, "thoughts_token_count", None)}
    except Exception:
        pass
    return out


def _fanout_goods_retail(items: list, objeto: str, state: dict, contexto: str = "") -> tuple[list, dict, set, list, int]:
    """Lanza los workers. Devuelve (precios, comentarios, sin_precios, chunks, n_chunks)."""
    lotes = [items[i:i + MARKET_CHUNK_SIZE] for i in range(0, len(items), MARKET_CHUNK_SIZE)]
    precios, comentarios, sin_precios, chunks = [], {}, set(), []
    errores = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=MARKET_MAX_WORKERS) as ex:
        futs = [ex.submit(_worker_goods_retail, ch, objeto, i, contexto) for i, ch in enumerate(lotes)]
        try:
            for fut in concurrent.futures.as_completed(futs, timeout=MARKET_TIMEOUT_S):
                try:
                    r = fut.result()
                except Exception as e:
                    errores += 1
                    _registrar_descarte(state, "market.goods_retail.worker", "error_worker", str(e)[:200])
                    continue
                precios.extend(r.get("precios") or [])
                comentarios.update(r.get("comentarios") or {})
                sin_precios |= set(r.get("sin_precios") or ())
                chunks.extend(r.get("chunks") or [])
                for d in r.get("descartes") or []:
                    _registrar_descarte(state, "market.goods_retail.linea", d["motivo"], d["detalle"])
                state.setdefault("market_queries", []).extend(r.get("queries") or [])
        except concurrent.futures.TimeoutError:
            pend = sum(1 for f in futs if not f.done())
            _registrar_recorte(state, "market.goods_retail.fanout_timeout", MARKET_TIMEOUT_S, pend)
            for f in futs:
                f.cancel()
    if errores:
        _registrar_recorte(state, "market.goods_retail.workers_con_error", len(lotes), errores)
    return precios, comentarios, sin_precios, chunks, len(lotes)


# ── Estimación IA (sin grounding) para el resto del lote cuando hay demasiados ítems ──
# No es una búsqueda: el modelo da una cifra desde su conocimiento previo. Se usa SOLO para
# los ítems de menor valor cuando el requerimiento tiene más de MARKET_ESTIMACION_DESDE ítems
# (priciar los 90 con google_search sería lento y caro). Las cifras quedan en campos
# `*_estimacion_ia` que NINGÚN consumidor existente lee — no pueden alimentar sobreprecio_pct,
# veredicto_global, cobertura_mercado ni banderas (`persist_market_flags_as_banderas` solo
# dispara con veredicto_item en {elevado, muy_elevado}, que estos findings nunca tienen).
_LINEA_ESTIMADO_RE = re.compile(
    r"^\W*(?:í|i)tem\s*(?P<num>[\w.\-/]+)\s*:\s*estimado\s*(?P<moneda>S/\.?|PEN|USD|US\$|\$)\s*(?P<precio>\d[\d.,]*)"
    r"\s*por\s+(?P<unidad>.+?)\s*·\s*confianza\s*(?P<confianza>alta|media|baja)\s*·\s*(?P<justif>.+?)[.\s]*$",
    re.IGNORECASE,
)
_LINEA_ESTIMADO_SIN_RE = re.compile(r"^\W*(?:í|i)tem\s*(?P<num>[\w.\-/]+)\s*:\s*sin estimaci(?:ó|o)n confiable", re.IGNORECASE)


def _parsear_worker_estimacion(text: str, items_chunk: list) -> dict:
    nums_validos = {_norm_num(it.get("numero")) for it in items_chunk}
    estimaciones: dict[str, dict] = {}
    sin_estimacion: set[str] = set()
    descartes: list[dict] = []
    for raw in text.splitlines():
        linea = raw.strip()
        if not linea:
            continue
        m = _LINEA_ESTIMADO_SIN_RE.match(linea)
        if m:
            sin_estimacion.add(_norm_num(m.group("num")))
            continue
        m = _LINEA_ESTIMADO_RE.match(linea)
        if not m:
            if len(linea) > 20:
                descartes.append({"motivo": "linea_no_parseable_estimacion", "detalle": linea[:160]})
            continue
        num = _norm_num(m.group("num"))
        if num not in nums_validos:
            descartes.append({"motivo": "item_no_solicitado", "detalle": linea[:160]})
            continue
        precio = _market_to_num(m.group("precio"))
        if precio is None:
            continue
        moneda = "USD" if m.group("moneda").upper().replace(".", "") in ("USD", "US$", "$") else "PEN"
        valor = precio * MARKET_USD_PEN if moneda == "USD" else precio
        estimaciones[num] = {
            "precio_estimado": round(valor, 2),
            "unidad": (m.group("unidad") or "Unidad").strip()[:60],
            "confianza": m.group("confianza").lower(),
            "justificacion": m.group("justif").strip()[:300],
        }
    return {"estimaciones": estimaciones, "sin_estimacion": sin_estimacion, "descartes": descartes}


def _worker_estimacion_llm(items_chunk: list, objeto: str, idx: int, contexto: str = "") -> dict:
    """Worker: ESTIMA ~10 ítems con una llamada Gemini SIN google_search — usa el conocimiento
    previo del modelo. Para el resto del lote cuando hay demasiados ítems para priciar todos
    con búsqueda real (ver `_worker_goods_retail`, que sí busca)."""
    from google.genai import types
    items_min = []
    for it in items_chunk:
        items_min.append({
            "numero": it.get("numero"),
            "descripcion_corta": (it.get("descripcion_corta") or "")[:300],
            "cantidad": it.get("cantidad"), "unidad": it.get("unidad"),
            "marca_o_modelo_exigido": it.get("marca_o_modelo_exigido"),
        })
    prompt = (
        "Eres un analista de precios de mercado peruano.\n\n"
        f"OBJETO DEL CONTRATO: {objeto[:300]}\n"
        "Cada ítem de abajo pertenece a ese objeto: no estimes productos de otro rubro.\n"
        f"{(contexto or '')[:400]}\n\n"
        f"ÍTEMS A ESTIMAR ({len(items_chunk)}):\n{json.dumps(items_min, ensure_ascii=False)}\n"
        f"{_ESTIMACION_INSTRUCCIONES}"
    )
    client = _gemini_client()
    cfg = types.GenerateContentConfig(
        temperature=0.3, max_output_tokens=4096,
        thinking_config=thinking_crudo("market_estimacion", MARKET_WORKER_MODEL, "minimal"),
        labels=etiquetas("mercado_estimacion"))

    def _call():
        return client.models.generate_content(model=MARKET_WORKER_MODEL, contents=prompt, config=cfg)

    resp = _gemini_call_with_retry(_call)
    text = getattr(resp, "text", "") or ""
    out = _parsear_worker_estimacion(text, items_chunk)
    out["idx"] = idx
    try:
        um = resp.usage_metadata
        out["tokens"] = {"prompt": um.prompt_token_count, "salida": um.candidates_token_count}
    except Exception:
        pass
    return out


def _fanout_estimacion_llm(items: list, objeto: str, state: dict, contexto: str = "") -> tuple[dict, set, int]:
    """Como `_fanout_goods_retail` pero SIN búsqueda. Devuelve (estimaciones_por_numero,
    sin_estimacion, n_chunks)."""
    if not items:
        return {}, set(), 0
    lotes = [items[i:i + MARKET_CHUNK_SIZE_ESTIMACION] for i in range(0, len(items), MARKET_CHUNK_SIZE_ESTIMACION)]
    estimaciones: dict[str, dict] = {}
    sin_estimacion: set[str] = set()
    errores = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=MARKET_MAX_WORKERS) as ex:
        futs = [ex.submit(_worker_estimacion_llm, ch, objeto, i, contexto) for i, ch in enumerate(lotes)]
        try:
            for fut in concurrent.futures.as_completed(futs, timeout=MARKET_TIMEOUT_S):
                try:
                    r = fut.result()
                except Exception as e:
                    errores += 1
                    _registrar_descarte(state, "market.estimacion_llm.worker", "error_worker", str(e)[:200])
                    continue
                estimaciones.update(r.get("estimaciones") or {})
                sin_estimacion |= set(r.get("sin_estimacion") or ())
                for d in r.get("descartes") or []:
                    _registrar_descarte(state, "market.estimacion_llm.linea", d["motivo"], d["detalle"])
        except concurrent.futures.TimeoutError:
            pend = sum(1 for f in futs if not f.done())
            _registrar_recorte(state, "market.estimacion_llm.fanout_timeout", MARKET_TIMEOUT_S, pend)
            for f in futs:
                f.cancel()
    if errores:
        _registrar_recorte(state, "market.estimacion_llm.workers_con_error", len(lotes), errores)
    return estimaciones, sin_estimacion, len(lotes)


def _contexto_entrega(ocds: dict, state: dict) -> str:
    """Región/lugar de entrega para el worker (1225030: comparables de Lima para piedra puesta
    en obra en Cusco). Se toma del buyer del OCDS y de `condiciones_entrega` del parser."""
    region, localidad = None, None
    for p in (ocds.get("parties") or []):
        if isinstance(p, dict) and ("buyer" in (p.get("roles") or []) or "procuringEntity" in (p.get("roles") or [])):
            addr = p.get("address") or {}
            region, localidad = addr.get("region"), addr.get("locality")
            break
    raw = state.get("parser_raw_consolidated") or {}
    lugar = None
    for src in (raw, _safe_parse_json(state.get("document_analysis")) or {}):
        ce = src.get("condiciones_entrega") if isinstance(src, dict) else None
        if isinstance(ce, dict) and ce.get("lugar_entrega"):
            lugar = str(ce["lugar_entrega"])[:160]
            break
    partes = []
    if region or localidad:
        partes.append(f"REGIÓN DE LA ENTIDAD: {', '.join(x for x in (localidad, region) if x)}")
    if lugar:
        partes.append(f"LUGAR DE ENTREGA: {lugar}")
    if partes:
        partes.append("Prioriza precios de esa región (o nacionales) e indica si el precio incluye transporte/puesto en obra.")
    return " · ".join(partes)


def _valor_item(it: dict, f: dict | None = None) -> float | None:
    """Valor del ítem para la cobertura por VALOR: ofertado × cantidad > referencial × cantidad >
    cuantía referencial del ítem > mediana de mercado × cantidad (si se preció)."""
    cant = it.get("cantidad")
    if not isinstance(cant, (int, float)) or cant <= 0:
        return _market_to_num(it.get("cuantia_referencial_item"))
    for k in ("precio_unitario_ofertado", "precio_unitario_referencial"):
        v = _market_to_num(it.get(k))
        if v:
            return v * float(cant)
    v = _market_to_num(it.get("cuantia_referencial_item"))
    if v:
        return v
    if f and isinstance(f.get("precio_mediana_mercado"), (int, float)):
        return float(f["precio_mediana_mercado"]) * float(cant)
    return None


def _mercado_goods_retail(state: dict) -> dict:
    mi = state.get("market_input")
    if not (isinstance(mi, dict) and mi.get("items")):
        mi = read_market_input(tool_context=_StateCtx(state))
    items = [it for it in ((mi or {}).get("items") or []) if isinstance(it, dict)]
    if not items:
        return {"estado": "sin_dato", "motivo": "sin_items_para_preciar", "findings": [],
                "observaciones_clave": ["Sin ítems con cantidad/unidad para comparar contra mercado."]}

    ocds = state.get("ocds") or {}
    tender = ocds.get("tender") or {}
    objeto = tender.get("description") or tender.get("title") or ""
    ocid = _short_ocid(ocds.get("ocid") or state.get("ocid") or mi.get("ocid") or "")
    padre_lote = mi.get("padre_lote") if isinstance(mi.get("padre_lote"), dict) else None
    cubsos_record = _cubsos_del_record(ocds)

    contexto = _contexto_entrega(ocds, state)

    # Demasiados ítems para priciar TODOS con búsqueda real: se prioriza el fan-out grounded
    # a los MARKET_ESTIMACION_DESDE ítems de mayor valor (los que más pesan en el total); el
    # resto se ESTIMA con el conocimiento previo del modelo (ver `_fanout_estimacion_llm`).
    items_grounded, items_estimar = items, []
    if len(items) > MARKET_ESTIMACION_DESDE:
        ordenados = sorted(items, key=lambda it: _valor_item(it) or 0, reverse=True)
        items_grounded = ordenados[:MARKET_ESTIMACION_DESDE]
        items_estimar = ordenados[MARKET_ESTIMACION_DESDE:]
        _registrar_recorte(state, "market.goods_retail.estimacion_por_volumen", MARKET_ESTIMACION_DESDE, len(items_estimar))

    precios, comentarios, sin_precios, chunks, n_chunks = _fanout_goods_retail(items_grounded, objeto, state, contexto)

    # 2º pase: ítems sin ningún precio con grounding (solo entre los enviados a búsqueda real).
    n_retry = 0
    if MARKET_RETRY:
        con_precio = {p["item_numero"] for p in precios}
        faltan = [it for it in items_grounded if _norm_num(it.get("numero")) not in con_precio]
        if faltan:
            p2, c2, s2, ch2, n2 = _fanout_goods_retail(faltan, objeto, state, contexto)
            n_retry = len({p["item_numero"] for p in p2})
            precios += p2
            for k, v in c2.items():
                comentarios.setdefault(k, v)
            sin_precios |= s2
            chunks += ch2
            n_chunks += n2

    _publicar_grounding(state, chunks)

    # Ítems de menor valor fuera del presupuesto de búsqueda: estimación IA (sin grounding),
    # nunca cuenta como respaldo (ver nota en la rama `elif estimacion:` más abajo).
    estimaciones_llm: dict[str, dict] = {}
    if items_estimar:
        estimaciones_llm, _sin_estimacion_llm, _n_chunks_estimacion = _fanout_estimacion_llm(
            items_estimar, objeto, state, contexto)

    findings: list[dict] = []
    por_item: dict[str, list[dict]] = {}
    for p in precios:
        por_item.setdefault(p["item_numero"], []).append(p)

    # Ancla regional (BD propia) por ítem: una consulta por CUBSO/descripción; falla → sin ancla.
    cache_refs: dict[tuple, list[dict]] = {}

    def _refs_para(it: dict) -> list[dict]:
        cubsos = [c for c in ([it.get("cubso")] + cubsos_record) if c]
        descr = it.get("descripcion_corta") or ""
        key = (tuple(sorted(set(cubsos))), descr[:80])
        if key in cache_refs:
            return cache_refs[key]
        try:
            refs = _consultar_referencias_internas(ocid, sorted(set(cubsos)), descr) if ocid else []
        except Exception as e:
            _registrar_descarte(state, "market.goods_retail.ancla_regional", "error_bd", f"{type(e).__name__}: {str(e)[:160]}")
            refs = []
        cache_refs[key] = refs
        return refs

    for it in items:
        num = _norm_num(it.get("numero"))
        ctx = _contexto_unidad_item(it)
        base_val, base = None, None
        if _market_to_num(it.get("precio_unitario_ofertado")):
            base_val, base = float(it["precio_unitario_ofertado"]), "ofertado"
        elif _market_to_num(it.get("precio_unitario_referencial")):
            base_val, base = float(it["precio_unitario_referencial"]), "referencial"
        ancla, refs_usables = _ancla_regional_item(it, _refs_para(it), base_val, ctx)
        if refs_usables:
            _publicar_grounding(state, [{"uri": r["url"], "titulo": f"SEACE {r['ocid']}",
                                         "dominio": "contratacionesabiertas.oece.gob.pe", "origen": "bd_convocatorias"}
                                        for r in refs_usables])
        refs_pub = [{k: r.get(k) for k in ("ocid", "entidad", "entidad_ruc", "descripcion", "cantidad", "unidad", "cubso",
                                            "fecha_convocatoria", "region", "etapa", "precio_unitario_referencial",
                                            "precio_unitario_adjudicado", "precio_unitario", "precio_base", "misma_region",
                                            "mismo_cubso", "solape_raices", "url")} for r in refs_usables][:12]
        oferta_vs_ref = _diff_pct(it.get("precio_unitario_ofertado"), it.get("precio_unitario_referencial"))
        nota_base = ("La oferta coincide con el valor referencial (±3 %): la señal apunta al estudio de mercado "
                     "de la entidad, no a la oferta." if isinstance(oferta_vs_ref, (int, float)) and abs(oferta_vs_ref) <= 3 else None)

        obs = por_item.get(num) or []
        if not obs:
            estimacion = estimaciones_llm.get(num)
            motivo = "sin_precios_en_mercado" if num in sin_precios else "sin_precio_con_fuente_verificable"
            f = _finding_vacio(it, motivo, comentarios.get(num) or "Sin precios observados con fuente verificable en esta corrida.")
            f.update({"referencias_internas": refs_pub, "ancla_regional": ancla, "unidad_normalizacion": ctx.get("dim"),
                      "oferta_vs_referencial_pct": oferta_vs_ref, "nota_base": nota_base})
            # Sin retail pero con ancla regional decisiva → veredicto por la BD propia.
            if ancla.get("estado") == "hallado" and base_val is not None:
                # La tabla del dictamen muestra `precio_mediana_mercado`: sin retail, la mediana visible
                # es la regional (marcada con `fuente_mediana`) para que veredicto y tabla no se contradigan.
                f.update({"precio_mediana_regional": ancla.get("mediana"), "veredicto": ancla["veredicto_regional"],
                          "precio_mediana_mercado": ancla.get("mediana"), "fuente_mediana": "ancla_regional",
                          "rango_min": ancla.get("rango_min"), "rango_max": ancla.get("rango_max"),
                          "n_referencias_internas": ancla.get("n"),
                          "veredicto_retail": "sin_dato", "diff_pct": ancla.get("diff_vs_mediana_pct"),
                          "diff_base": base, "diff_fuente": "ancla_regional", "estado": "hallado",
                          "es_estimacion": False, "motivo_estimacion": None,
                          "precio_mediana_comparacion": ancla.get("mediana"),
                          "evidencia": [{"url": r["url"], "cita": f"{r['descripcion'][:150]} · S/ {r['precio_unitario']:.2f}/{it.get('unidad') or 'u'} ({r['precio_base']})"[:240]}
                                        for r in refs_usables][:20],
                          "comentario": (f"Sin precios retail con fuente; {ancla['n']} referencia(s) interna(s) "
                                         f"({ancla['ambito']}) en la BD SEACE propia: rango S/ {ancla['rango_min']:,.2f}-{ancla['rango_max']:,.2f} "
                                         f"por {it.get('unidad') or 'unidad'}; el precio {base} queda {ancla['posicion'].replace('_', ' ')}.")})
            # Ítem fuera del presupuesto de búsqueda (lote grande): estimación IA desde
            # conocimiento previo, SIN grounding. Va en campos `*_estimacion_ia` propios —
            # nunca toca precio_mediana_mercado/diff_pct/veredicto, así que jamás puede
            # alimentar sobreprecio_pct, cobertura_mercado ni una bandera de sobreprecio
            # (persist_market_flags_as_banderas solo dispara con veredicto en
            # {elevado, muy_elevado}, que este finding no tiene).
            elif estimacion:
                diff_est = _diff_pct(base_val, estimacion["precio_estimado"]) if base_val is not None else None
                f.update({"estado": "estimado_ia", "motivo_estimacion": "estimado_por_ia_sin_busqueda",
                          "precio_estimado_ia": estimacion["precio_estimado"],
                          "unidad_estimacion_ia": estimacion["unidad"],
                          "confianza_estimacion_ia": estimacion["confianza"],
                          "diff_pct_estimacion_ia": diff_est,
                          "comentario": (f"Sin precio verificado con fuente (fuera del presupuesto de búsqueda de este "
                                         f"lote). El modelo ESTIMÓ S/ {estimacion['precio_estimado']:.2f} por "
                                         f"{estimacion['unidad']} desde su conocimiento previo — confianza "
                                         f"{estimacion['confianza']}, NO es una búsqueda en vivo ni evidencia "
                                         f"verificada: {estimacion['justificacion']}")})
            findings.append(f)
            continue

        precios_obs, descartados = [], []
        for p in obs:
            valor = p["precio"] * MARKET_USD_PEN if p["moneda_origen"] == "USD" else p["precio"]
            f0 = p["fuentes"][0]
            norm, info = _normalizar_precio_observado(valor, p.get("unidad"), p.get("producto"), ctx)
            fila = {
                "producto": p["producto"], "precio": round(norm, 2) if norm is not None else None,
                "precio_publicado": round(valor, 2), "unidad": p["unidad"],
                "unidad_item": it.get("unidad"), "normalizacion": info,
                "url": f0["uri"], "fecha": None, "proveedor": p["proveedor"],
                "moneda_origen": p["moneda_origen"],
                "tipo_cambio_aplicado": MARKET_USD_PEN if p["moneda_origen"] == "USD" else None,
                "titulo_fuente": f0.get("titulo"), "dominio": f0.get("dominio"),
                "urls_adicionales": [x["uri"] for x in p["fuentes"][1:]],
                # compat frontend (columna `valor`)
                "valor": round(norm, 2) if norm is not None else None,
            }
            if norm is None:
                descartados.append(fila)
                _registrar_descarte(state, f"market.goods_retail.item_{num}", info.get("regla") or "no_normalizable",
                                    f"{p['producto'][:80]} · {info.get('detalle') or ''}")
                continue
            precios_obs.append(fila)
        valores = [x["precio"] for x in precios_obs]
        keep, drop = _filtrar_outliers(valores)
        if drop:
            _registrar_descarte(state, f"market.goods_retail.item_{num}", "outlier",
                                f"{len(drop)} precio(s) (ya normalizados a {it.get('unidad')}) fuera de [mediana/5, mediana×5]: {drop[:5]}")
        mediana = _mediana(keep)
        n = len(keep)
        n_norm = sum(1 for x in precios_obs if x["precio"] in keep and (x["normalizacion"] or {}).get("regla") != "asumida_misma_unidad")
        diff_retail = _diff_pct(base_val, mediana) if n >= MARKET_MIN_PRECIOS else None
        veredicto_retail = _veredicto(diff_retail) if diff_retail is not None else "sin_dato"
        motivo = None
        if n < MARKET_MIN_PRECIOS:
            motivo = "precios_insuficientes"
        elif base_val is None:
            motivo = "sin_precio_ofertado_ni_referencial"

        # Combinación retail + ancla regional.
        veredicto, diff, diff_fuente, med_comparacion = veredicto_retail, diff_retail, "retail", mediana
        if ancla.get("estado") == "hallado" and base_val is not None:
            vr = ancla["veredicto_regional"]
            if ancla.get("posicion") == "dentro_rango":
                veredicto, diff_fuente = "alineado_regional", "ancla_regional"
                med_comparacion = ancla.get("mediana")
                motivo = None
            elif veredicto_retail == "sin_dato":
                veredicto, diff, diff_fuente = vr, ancla.get("diff_vs_mediana_pct"), "ancla_regional"
                med_comparacion = ancla.get("mediana")
                motivo = None
            else:
                ancla["concuerda_con_retail"] = (vr == veredicto_retail)
        # Guardarraíl: Δ implausible sin precios con unidad confirmada → no_verificable.
        if (isinstance(diff, (int, float)) and diff > MARKET_DELTA_IMPLAUSIBLE
                and n_norm < MARKET_MIN_PRECIOS and diff_fuente == "retail"):
            veredicto, motivo = "no_verificable", "delta_implausible_sin_unidad_confirmada"
            _registrar_descarte(state, f"market.goods_retail.item_{num}", "delta_implausible",
                                f"Δ {diff:+.0f} % con {n_norm} precio(s) de unidad confirmada (< {MARKET_MIN_PRECIOS})")
        proveedores = []
        vistos = set()
        for x in precios_obs:
            k = (x.get("proveedor") or x.get("dominio") or "").lower()
            if k and k not in vistos:
                vistos.add(k)
                proveedores.append({"nombre": x.get("proveedor") or x.get("dominio"), "url": x["url"]})
        findings.append({
            "item_numero": it.get("numero"),
            "item_descripcion": (it.get("descripcion_corta") or "")[:300],
            "cantidad": it.get("cantidad"), "unidad": it.get("unidad"),
            "unidad_normalizacion": ctx.get("dim"),
            "precio_unitario_referencial": it.get("precio_unitario_referencial"),
            "precio_unitario_ofertado": it.get("precio_unitario_ofertado"),
            "origen_precio_ofertado": it.get("origen_precio"),
            "oferta_vs_referencial_pct": oferta_vs_ref, "nota_base": nota_base,
            "precios_observados": precios_obs,
            "precios_descartados": descartados[:10],
            "proveedores_potenciales": proveedores[:6],
            "caracteristicas_solicitadas_clave": [],
            "precio_mediana_mercado": round(mediana, 2) if mediana is not None else None,
            "fuente_mediana": "retail",
            "precio_mediana_regional": ancla.get("mediana") if ancla.get("estado") == "hallado" else None,
            "n_referencias_internas": ancla.get("n") if ancla.get("estado") == "hallado" else 0,
            "precio_mediana_comparacion": round(med_comparacion, 2) if isinstance(med_comparacion, (int, float)) else None,
            "rango_min": round(min(keep), 2) if keep else None,
            "rango_max": round(max(keep), 2) if keep else None,
            "n_precios": n, "n_precios_normalizados": n_norm,
            "diff_pct": diff, "diff_base": base if diff is not None else None,
            "diff_fuente": diff_fuente if (diff is not None or veredicto == "alineado_regional") else None,
            "diff_pct_retail": diff_retail, "veredicto_retail": veredicto_retail,
            "veredicto": veredicto,
            "es_estimacion": veredicto in ("sin_dato", "no_verificable"),
            "motivo_estimacion": motivo,
            "estado": "hallado" if veredicto != "no_verificable" else "no_verificable",
            "evidencia": ([{"url": x["url"], "cita": f"{x['producto'][:150]} · S/ {x['precio']:.2f}/{it.get('unidad') or 'u'}"[:240]} for x in precios_obs]
                          + [{"url": r["url"], "cita": f"SEACE {r['ocid']}: {r['descripcion'][:120]} · S/ {r['precio_unitario']:.2f} ({r['precio_base']})"[:240]}
                             for r in refs_usables])[:20],
            "referencias_internas": refs_pub,
            "ancla_regional": ancla,
            "spec_restrictiva": None,   # lo evalúa document_legal_analyst (vector marca_unica / specs_convergentes)
            "comentario": comentarios.get(num) or "",
        })

    # ── Totales (código) ──────────────────────────────────────────
    # Cobertura por VALOR: Σ valor de los ítems respaldados / Σ valor de todos (1225450: 100 gal de
    # gasohol sobre 5 100 gal → 1.4 %, no "1/1 = 100 %"). Respaldado = mediana con ≥ MIN precios
    # (retail) o ancla regional decisiva.
    n_total = len(items)
    by_num = {_norm_num(it.get("numero")): it for it in items}
    con_mediana = [f for f in findings if isinstance(f.get("precio_mediana_comparacion"), (int, float))
                   or isinstance(f.get("precio_mediana_mercado"), (int, float))]
    # Respaldado: mediana con ≥ MIN precios (o ancla regional) y sin guardarraíl disparado. Un ítem
    # sin precio base propio (lote tipo canasta) igual aporta su mediana × cantidad al total.
    respaldados = [f for f in findings if f.get("veredicto") != "no_verificable"
                   and isinstance(f.get("precio_mediana_comparacion") or f.get("precio_mediana_mercado"), (int, float))
                   and (f.get("n_precios", 0) >= MARKET_MIN_PRECIOS or (f.get("ancla_regional") or {}).get("estado") == "hallado")]
    valores_all = {_norm_num(f.get("item_numero")): _valor_item(by_num.get(_norm_num(f.get("item_numero")), {}), f) for f in findings}
    resp_nums = {_norm_num(f.get("item_numero")) for f in respaldados}
    suma_all = sum(v for v in valores_all.values() if v)
    suma_resp = sum(v for k, v in valores_all.items() if v and k in resp_nums)
    cobertura_conteo = (len(respaldados) / n_total) if n_total else 0.0
    if suma_all > 0 and all(v for v in valores_all.values()):
        cobertura = suma_resp / suma_all
    elif suma_all > 0:
        cobertura = min(suma_resp / suma_all, cobertura_conteo)
    else:
        cobertura = cobertura_conteo

    def _med(f):
        return float(f.get("precio_mediana_comparacion") or f.get("precio_mediana_mercado"))
    total_mercado_resp = sum(_med(f) * f["cantidad"] for f in respaldados if isinstance(f.get("cantidad"), (int, float)))

    total_ofertado = mi.get("total_ofertado")
    total_ofertado_base = mi.get("total_ofertado_base")
    if not isinstance(total_ofertado, (int, float)):
        if padre_lote and isinstance(padre_lote.get("cuantia_total"), (int, float)):
            total_ofertado, total_ofertado_base = float(padre_lote["cuantia_total"]), "referencial"
        else:
            total_ofertado, total_ofertado_base = None, None
    es_referencial = total_ofertado_base == "referencial"

    # Base ofertada sobre los MISMOS ítems que el total de mercado (1225090: 3 de 4 ítems de
    # mercado contra el lote completo → +156 % ficticio).
    ofert_resp = [(by_num.get(_norm_num(f.get("item_numero")), {}).get("precio_unitario_ofertado"), f.get("cantidad")) for f in respaldados]
    lote_base = None
    total_ofertado_resp = None
    if respaldados and all(_market_to_num(p) and isinstance(c, (int, float)) for p, c in ofert_resp):
        total_ofertado_resp = sum(float(p) * float(c) for p, c in ofert_resp)
        lote_base = "ofertado_items"
    elif total_ofertado and not es_referencial and suma_all > 0 and all(v for v in valores_all.values()):
        total_ofertado_resp = float(total_ofertado) * (suma_resp / suma_all)
        lote_base = "contrato_prorrateado" if cobertura < 0.999 else total_ofertado_base
    elif total_ofertado and cobertura >= 0.999:
        total_ofertado_resp, lote_base = float(total_ofertado), total_ofertado_base

    sobreprecio_pct = None
    estimado_vs_mercado_pct = None
    veredicto_global = "sin_dato"
    lote = {"aplica": n_total >= 2, "n_items": n_total, "n_respaldados": len(respaldados),
            "cobertura_valor": round(cobertura, 3), "cobertura_conteo": round(cobertura_conteo, 3),
            "base": lote_base, "total_ofertado_respaldados": round(total_ofertado_resp, 2) if total_ofertado_resp else None,
            "total_mercado_respaldados": round(total_mercado_resp, 2) if total_mercado_resp else None, "motivo": None}
    if n_total < 2:
        lote["motivo"] = "un_solo_item_sin_bandera_de_lote"
        veredicto_global = findings[0].get("veredicto") if findings else "sin_dato"
    elif not respaldados:
        lote["motivo"] = "sin_items_respaldados"
    elif cobertura < MARKET_COBERTURA_LOTE:
        lote["motivo"] = f"cobertura_por_valor_insuficiente ({cobertura*100:.0f} % < {MARKET_COBERTURA_LOTE*100:.0f} %)"
        veredicto_global = "cobertura_parcial"
    elif not (total_ofertado_resp and total_mercado_resp):
        lote["motivo"] = "sin_base_ofertada_comparable_por_item"
        veredicto_global = "cobertura_parcial"
    else:
        delta = _diff_pct(total_ofertado_resp, total_mercado_resp)
        if lote_base == "referencial":
            # Solo hay cuantía estimada: nunca "sobreprecio ofertado"; señal informativa aparte.
            estimado_vs_mercado_pct = delta
            veredicto_global = "estimado_sobre_mercado" if (delta is not None and delta >= MARKET_UMBRAL_ELEVADO) else _veredicto(delta)
            lote["motivo"] = "solo_cuantia_referencial_disponible"
        else:
            sobreprecio_pct = delta
            veredicto_global = _veredicto(delta)
            n_norm_resp = sum(f.get("n_precios_normalizados", 0) for f in respaldados) + sum(
                1 for f in respaldados if (f.get("ancla_regional") or {}).get("estado") == "hallado")
            if delta is not None and delta > MARKET_DELTA_IMPLAUSIBLE and (cobertura < MARKET_COBERTURA_LOTE or n_norm_resp < MARKET_MIN_PRECIOS):
                veredicto_global, sobreprecio_pct = "no_verificable", None
                lote["motivo"] = f"delta_implausible ({delta:+.0f} %) sin cobertura/unidades confirmadas"
                _registrar_descarte(state, "market.goods_retail.lote", "delta_implausible", lote["motivo"])
            # Ancla regional: si todos los respaldados están alineados regionalmente, el lote no es señal.
            elif all(f.get("veredicto") == "alineado_regional" for f in respaldados) and veredicto_global in ("elevado", "muy_elevado"):
                veredicto_global = "alineado_regional"
                lote["motivo"] = "items_alineados_con_referencias_regionales"
                lote["delta_retail_pct"] = delta
                sobreprecio_pct = None

    obs = [f"Preciados {len(con_mediana)}/{n_total} ítems; {len(respaldados)} respaldado(s) (≥{MARKET_MIN_PRECIOS} precios "
           f"con fuente de grounding normalizados a la unidad del ítem, o ancla regional) · cobertura por valor "
           f"{cobertura*100:.0f} % vía {n_chunks} worker(s)."]
    if n_retry:
        obs.append(f"2º pase recuperó {n_retry} ítem(s).")
    n_estimados_ia = sum(1 for f in findings if f.get("precio_estimado_ia") is not None)
    if items_estimar:
        obs.append(f"Lote con {n_total} ítems (> {MARKET_ESTIMACION_DESDE}): {len(items_estimar)} de menor valor no "
                    f"entraron a la búsqueda real; {n_estimados_ia} recibieron una ESTIMACIÓN del modelo (conocimiento "
                    f"previo, sin grounding) — informativa, no cuenta como respaldo ni mueve sobreprecio_pct.")
    n_ancla = sum(1 for f in findings if (f.get("ancla_regional") or {}).get("estado") == "hallado")
    if n_ancla:
        obs.append(f"{n_ancla} ítem(s) con ancla regional en la BD SEACE propia (referencias_internas).")
    if total_ofertado_base:
        obs.append(f"Total ofertado tomado de: {total_ofertado_base}" + (" (cuantía referencial, no precio ofertado)." if es_referencial else "."))
    if n_total < 2:
        obs.append("Un solo ítem: no se emite bandera de lote (misma evidencia que la bandera por ítem).")
    elif lote.get("motivo"):
        obs.append(f"Lote: {lote['motivo']}.")
    obs.append("Mediana, rango, Δ% y veredicto calculados en código; URLs tomadas exclusivamente de grounding_metadata y de la BD propia.")
    return {
        "estado": "hallado" if con_mediana else "sin_dato",
        "findings": findings,
        "total_ofertado": total_ofertado,
        "total_ofertado_base": total_ofertado_base,
        "total_ofertado_es_referencial": es_referencial,
        "cuantia_referencial_total": mi.get("cuantia_referencial_total"),
        # Solo se publica cuando el Δ de lote es válido (≥ 2 ítems, cobertura por valor ≥ 0.7, base
        # ofertada real): así ningún consumidor recalcula un "sobreprecio" desde totales no comparables
        # (un solo ítem, cuantía referencial, cobertura parcial). El detalle queda en `lote`.
        "total_estimado_mercado": (round(total_mercado_resp, 2) if (total_mercado_resp and sobreprecio_pct is not None) else None),
        "sobreprecio_pct": sobreprecio_pct,
        "estimado_vs_mercado_pct": estimado_vs_mercado_pct,
        "veredicto_global": veredicto_global,
        "cobertura_mercado": round(cobertura, 3),
        "cobertura_conteo": round(cobertura_conteo, 3),
        "lote": lote,
        "n_items": n_total, "n_con_mediana": len(con_mediana), "n_respaldados": len(respaldados),
        "n_items_estimados_ia": n_estimados_ia,
        "n_chunks": n_chunks,
        "confianza_global": ("alta" if cobertura >= 0.8 else "media" if cobertura >= 0.5 else "baja"),
        "requerimiento_disponible_para_analisis": bool(mi.get("tiene_requerimiento")),
        "valor_referencial_oficial": ((mi or {}).get("estudio_mercado") or {}).get("valor_referencial"),
        "precio_final_contrato": ((mi or {}).get("contrato_final") or {}).get("precio_final_total"),
        "precio_final_vs_referencial": (mi or {}).get("precio_final_vs_referencial"),
        "observaciones_clave": obs,
        "grounding_urls": [c["uri"] for c in chunks if c.get("uri")],
        "_modo": "sharded_fanout_grounded",
    }
