"""Parser en LOTE (WS D · plan 2026-09-15): tool pública `parse_documentos_seleccionados`
(selección determinista + parseo en lote) y su motor `parse_documentos_lote` (consolidación
cross-documento de ítems/postores/firmantes/comité/etc.)."""

from tools._core import *  # noqa: F401,F403
from tools.doc_select import seleccionar_documentos, recorte_seleccion
from ._base import _perfil_params, _norm_txt, _norm_razon, _LOOKALIKES, PARSE_GLOBAL_BUDGET_S, PARSE_LOTE_WORKERS
from .clasificacion import _es_doc_contratacion, _es_doc_de_adjudicacion, _es_doc_resultado, _origen_precio
from .entidades import (_rucs_ocds, _ganadores_ocds, _fusionar_postor, _ofertas_desde_postores,
                        _mismo_firmante, _mismo_nombre, _pagina_principal)
from .item_matching import _item_key, _buscar_item_similar, _desc_compacta
from .extractor import _merge_extraccion
from .orquestacion import _procesar_doc


def _ocds_ctx(state: dict) -> dict:
    cr = state.get("ocds") or {}
    tender = cr.get("tender") or {}
    return {"objeto": tender.get("description") or tender.get("title") or "",
            "entidad": (cr.get("buyer") or {}).get("name") or "",
            "items": [f"{(it.get('description') or '')[:140]} · cant {it.get('quantity')} {((it.get('unit') or {}).get('name') or '')}"
                      for it in (tender.get("items") or []) if isinstance(it, dict)]}


def parse_documentos_lote(state: dict, docs: list[dict], *, parser_bloque: str | None = None,
                          prioridad: tuple[str, ...] | None = None) -> dict:
    """OCR una sola vez (documentos_texto por sha256, páginas con marcadores ⟦p.N⟧), extracción con
    schema (base + bloque del perfil) y evidencia {documento_sha256, pagina, cita}. Escribe
    state['parser_raw_consolidated'], state['documentos_texto'] = {sha256: {n_paginas, chars, truncado}},
    y añade a state['recortes'].

    `docs`: lista de DocRef de `seleccionar_documentos`. El perfil sale de los kwargs o de
    state['perfil'] (defaults de bienes). Devuelve un resumen compacto (conteos, por documento,
    recortes, tiempos) apto para el trace."""
    t_ini = time.monotonic()
    bloque, prio, _mx = _perfil_params(state, parser_bloque, prioridad)
    ocds_ctx = _ocds_ctx(state)
    state.setdefault("recortes", [])
    state.setdefault("documentos_texto", {})
    docs = [d for d in (docs or []) if isinstance(d, dict)]
    if not docs:
        state["recortes"].append({"donde": "parser_lote", "limite": "sin_documentos", "omitido": "ningún documento elegible"})
        return {"n_docs": 0, "n_ok": 0, "recortes": state["recortes"][-1:], "_note": "sin documentos"}

    # Presupuesto global compartido con el resto del pipeline (mismo mecanismo que parse_document_pdf).
    now = time.monotonic()
    deadline = state.get("_parse_deadline")
    if not isinstance(deadline, (int, float)):
        deadline = now + PARSE_GLOBAL_BUDGET_S
        state["_parse_deadline"] = deadline
    budget = max(60.0, deadline - now)

    resultados: list[dict | None] = [None] * len(docs)
    ex = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, PARSE_LOTE_WORKERS))
    futures = {ex.submit(_procesar_doc, d, state, bloque, prio, ocds_ctx): i for i, d in enumerate(docs)}
    try:
        for fut in concurrent.futures.as_completed(futures, timeout=budget):
            i = futures[fut]
            try:
                resultados[i] = fut.result()
            except Exception as e:
                resultados[i] = {"doc": docs[i], "error": f"{type(e).__name__}: {str(e)[:160]}", "recortes": [], "tiempos": {},
                                 "sha256": docs[i].get("sha256"), "cache": {}}
    except concurrent.futures.TimeoutError:
        pend = [i for i in futures.values() if resultados[i] is None]
        state["recortes"].append({"donde": "parser_lote", "limite": f"PARSE_GLOBAL_BUDGET_S={PARSE_GLOBAL_BUDGET_S} (restaban {budget:.0f}s)",
                                  "omitido": [{"id": docs[i].get("id"), "titulo": docs[i].get("titulo")} for i in pend]})
        for i in pend:
            resultados[i] = {"doc": docs[i], "error": "parse timeout", "recortes": [], "tiempos": {}, "sha256": docs[i].get("sha256"), "cache": {}}
    finally:
        ex.shutdown(wait=False, cancel_futures=True)

    # ── Consolidación cross-doc (misma forma que parse_document_pdf + bloques + documentos[]) ──
    raw = state.get("parser_raw_consolidated") or {}
    raw.setdefault("items_consolidados", [])
    raw.setdefault("items_otros_documentos", [])
    raw.setdefault("postores_consolidados", [])
    raw.setdefault("firmantes_consolidados", [])
    raw.setdefault("comite_evaluacion", [])
    raw.setdefault("motivos_adjudicacion", [])
    raw.setdefault("red_flags_observadas", [])
    raw.setdefault("fundamento_legal", [])
    raw.setdefault("documentos", [])
    raw.setdefault("resumenes", [])
    if bloque:
        raw.setdefault(f"bloque_{bloque}", {})

    existing_keys = {}
    for _it in raw["items_consolidados"]:
        _k = _item_key(_it)
        if _k is not None:
            existing_keys[_k] = _it
    raw.setdefault("items_contratados", [])
    raw.setdefault("lista_invitados", [])
    raw.setdefault("contrato", {"ampliaciones_plazo": [], "penalidades_aplicadas": [], "adendas": [], "entregas": []})
    raw.setdefault("procedimiento_seleccion", {"factores_evaluacion": [], "puntajes_por_postor": [],
                                               "consultas_observaciones": [], "modificaciones_integracion": []})
    raw.setdefault("descartes_parser", [])
    rucs_ocds = _rucs_ocds(state)
    ganadores_ocds = _ganadores_ocds(state)
    estudio_best = state.get("estudio_mercado")
    contrato_best = state.get("contrato_final")
    gate_items: list[dict] = []
    gate_adj: list[dict] = []
    resumen_docs: list[dict] = []
    vistos_contratados: set = set()

    def _cita_vista(ev: list | None) -> list:
        return [e for e in (ev or []) if isinstance(e, dict)]

    for r in resultados:
        if not r:
            continue
        doc = r["doc"]
        sha = r.get("sha256")
        tx = r.get("tx") or {}
        ext = r.get("ext") or {}
        for rec in (r.get("recortes") or []):
            state["recortes"].append(rec)
        if r.get("error"):
            # Un documento que falló nunca debe perderse en silencio: recorte visible + log.
            print(f"[lote] ✗ {str(doc.get('titulo'))[:60]} · {r['error']}", flush=True)
            state["recortes"].append({"donde": "parser_lote", "limite": "error_documento",
                                      "omitido": {"documento": doc.get("titulo"), "sha256": sha, "error": r["error"]}})
        if sha:
            state["documentos_texto"][sha] = {
                "n_paginas": tx.get("n_paginas"), "chars": tx.get("chars"), "truncado": bool(tx.get("truncado")) or bool(ext.get("_truncado")),
                "titulo": doc.get("titulo"), "tipo": doc.get("tipo"), "seccion": doc.get("seccion"), "formato": doc.get("formato"),
                "motor": tx.get("motor"), "cache_texto": bool((r.get("cache") or {}).get("texto")),
                "cache_extraccion": bool((r.get("cache") or {}).get("extraccion")),
                "tipo_documento_detectado": ext.get("tipo_documento_detectado"),
                "etapa": ext.get("_etapa"),
            }
        entrada_doc = {
            "id": doc.get("id"), "url": doc.get("url"), "gs": doc.get("gs"), "titulo": doc.get("titulo"), "tipo": doc.get("tipo"),
            "seccion": doc.get("seccion"), "formato": doc.get("formato"), "sha256": sha,
            "n_paginas": tx.get("n_paginas"), "chars": tx.get("chars"), "motor": tx.get("motor"),
            "unidades": r.get("unidades"), "cache": r.get("cache"), "tiempos": r.get("tiempos"),
            "tipo_documento_detectado": ext.get("tipo_documento_detectado"), "etapa": ext.get("_etapa"),
            "contiene_requerimiento": bool(ext.get("contiene_requerimiento")),
            "n_items": len(ext.get("items") or []), "n_firmantes": len(ext.get("firmantes") or []),
            "truncado": bool(tx.get("truncado")) or bool(ext.get("_truncado")),
            "evidencia": ext.get("_evidencia_stats"), "usos": ext.get("_usos"), "error": r.get("error"),
        }
        raw["documentos"].append(entrada_doc)
        resumen_docs.append(entrada_doc)
        if r.get("error") or not ext:
            continue
        tipo_det = ext.get("tipo_documento_detectado")
        contratacion = ext.get("_etapa") == "contratacion" if ext.get("_etapa") else _es_doc_contratacion(tipo_det, doc)
        es_adjudicacion = _es_doc_resultado(tipo_det, doc) or (contratacion and doc.get("seccion") in ("award", "contract")
                                                                and "propuesta" not in _norm_txt(doc.get("titulo") or "").lower())
        for dsc in (ext.get("_descartes_parser") or []):
            raw["descartes_parser"].append({**dsc, "documento": doc.get("titulo"), "sha256": sha})
        # ── Ítems ──
        # Fuente de REQUERIMIENTO (bases/TDR/EETT/expediente): → items_consolidados (precio
        # referencial, marca exigida). Documento de CONTRATACIÓN (OC/contrato/acta/propuesta):
        # sus ítems → items_contratados (precio contratado/ofertado, marca ofertada) y NUNCA
        # a items_consolidados aunque el LLM marque contiene_requerimiento (la OC repite las
        # EETT). El resto de docs sin requerimiento → items_otros_documentos + recorte.
        items = [it for it in (ext.get("items") or []) if isinstance(it, dict)]
        es_fuente_req = (not contratacion) and (bool(ext.get("contiene_requerimiento")) or any(
            len(str(it.get("texto_literal") or it.get("requerimiento_tecnico_detallado") or "").strip()) > 40 for it in items))
        if es_fuente_req:
            for it in items:
                k = _item_key(it)
                if k is None:
                    raw["items_consolidados"].append(it)
                    continue
                prev = existing_keys.get(k) or _buscar_item_similar(existing_keys, k)
                if prev is None:
                    raw["items_consolidados"].append(it)
                    existing_keys[k] = it
                else:
                    new_req = it.get("texto_literal") or it.get("requerimiento_tecnico_detallado") or ""
                    cur_req = prev.get("texto_literal") or prev.get("requerimiento_tecnico_detallado") or ""
                    if len(new_req) > len(cur_req):
                        prev["texto_literal"] = new_req
                        prev["requerimiento_tecnico_detallado"] = new_req
                        prev["texto_literal_paginas"] = it.get("texto_literal_paginas")
                        prev["documento_sha256"] = it.get("documento_sha256")
                    ev_prev = prev.get("evidencia") or []
                    prev["evidencia"] = ev_prev + [e for e in (it.get("evidencia") or []) if e not in ev_prev]
                    for kk, vv in it.items():
                        if kk.startswith("_") or kk in ("marca_ofertada", "precio_unitario_contratado", "precio_unitario_ofertado", "origen_precio"):
                            continue
                        if prev.get(kk) in (None, "", [], {}) and vv not in (None, "", [], {}):
                            prev[kk] = vv
        elif items:
            if contratacion:
                origen = _origen_precio(tipo_det, doc)
                for it in items:
                    pu = it.get("precio_unitario_contratado") or it.get("precio_unitario_ofertado")
                    marca = it.get("marca_ofertada")
                    if pu is None and not marca and it.get("cantidad") is None:
                        continue   # cabecera sin datos (título del proceso repetido como ítem)
                    desc = it.get("descripcion_corta") or it.get("descripcion") or ""
                    kk = (_desc_compacta(desc), pu, it.get("cantidad"))
                    if kk in vistos_contratados:
                        continue   # el mismo renglón en el acta repetida / cuadro copia del acta
                    vistos_contratados.add(kk)
                    raw["items_contratados"].append({
                        "numero": it.get("numero"), "descripcion": desc, "cantidad": it.get("cantidad"),
                        "unidad": it.get("unidad"), "precio_unitario_contratado": pu,
                        "subtotal_contratado": it.get("subtotal_contratado") or it.get("cuantia_referencial_item"),
                        "marca_ofertada": marca, "origen": origen, "tipo_documento": tipo_det,
                        "documento": doc.get("titulo"), "documento_sha256": sha,
                        "pagina": _pagina_principal(it), "evidencia": _cita_vista(it.get("evidencia")),
                    })
            raw["items_otros_documentos"].extend({**it, "_documento": doc.get("titulo"),
                                                  "precio_contratado": (it.get("precio_unitario_contratado") or it.get("precio_unitario_ofertado")) if contratacion else None}
                                                 for it in items)
            gate_items.append({"documento": doc.get("titulo"), "sha256": sha, "n_items": len(items),
                               "etapa": "contratacion" if contratacion else "sin_requerimiento"})
        # ── Postores: fusión por RUC válido / razón social (nunca se descarta el repetido) ──
        for p in (ext.get("postores") or []):
            _fusionar_postor(raw["postores_consolidados"], p, es_adjudicacion, sha, rucs_ocds)
        for inv in (ext.get("invitados") or []):
            if not isinstance(inv, dict):
                continue
            e = _fusionar_postor(raw["lista_invitados"], {**inv, "estado": "invitado"}, False, sha, rucs_ocds)
            if e is not None:
                e.setdefault("fecha_invitacion", inv.get("fecha_invitacion"))
        # ── Firmantes: misma persona con nombre abreviado / cargo distinto → una sola entrada ──
        for f in (ext.get("firmantes") or []):
            if not isinstance(f, dict) or not (f.get("nombre_completo") or "").strip():
                continue
            prev = next((q for q in raw["firmantes_consolidados"] if _mismo_firmante(q, f)), None)
            if prev is None:
                f.setdefault("documentos", [doc.get("titulo")])
                raw["firmantes_consolidados"].append(f)
                continue
            if len(f.get("nombre_completo") or "") > len(prev.get("nombre_completo") or ""):
                prev["nombre_completo"] = f["nombre_completo"]
            cargo_new = (f.get("cargo") or "").strip()
            if cargo_new and _norm_razon(cargo_new) != _norm_razon(prev.get("cargo") or ""):
                if not prev.get("cargo"):
                    prev["cargo"] = cargo_new
                else:
                    cargos = prev.setdefault("cargos", [prev["cargo"]])
                    if cargo_new not in cargos:
                        cargos.append(cargo_new)
            for kk, vv in f.items():
                if kk in ("nombre_completo", "cargo"):
                    continue
                if kk == "evidencia":
                    ev_prev = prev.get("evidencia") or []
                    prev["evidencia"] = ev_prev + [e for e in (vv or []) if e not in ev_prev]
                elif prev.get(kk) in (None, "", [], {}) and vv not in (None, "", [], {}):
                    prev[kk] = vv
            docs_f = prev.setdefault("documentos", [])
            if doc.get("titulo") not in docs_f:
                docs_f.append(doc.get("titulo"))
        if _es_doc_de_adjudicacion(tipo_det):
            for x in (ext.get("comite_evaluacion") or []):
                if isinstance(x, dict) and not any(_mismo_firmante(q, x) for q in raw["comite_evaluacion"]):
                    raw["comite_evaluacion"].append(x)
            for x in (ext.get("motivos_adjudicacion") or []):
                if isinstance(x, dict):
                    dup = any(_norm_razon(q.get("ganador_razon_social")) == _norm_razon(x.get("ganador_razon_social"))
                              and (q.get("criterio_decisivo") or "") == (x.get("criterio_decisivo") or "") for q in raw["motivos_adjudicacion"])
                    if not dup:
                        raw["motivos_adjudicacion"].append(x)
            if ext.get("lugar_fecha_acta") and not raw.get("lugar_fecha_acta"):
                raw["lugar_fecha_acta"] = ext["lugar_fecha_acta"]
        elif (ext.get("comite_evaluacion") or ext.get("motivos_adjudicacion")):
            gate_adj.append({"documento": doc.get("titulo"), "tipo_detectado": tipo_det,
                             "n_comite": len(ext.get("comite_evaluacion") or []), "n_motivos": len(ext.get("motivos_adjudicacion") or [])})
        raw["fundamento_legal"] = list(dict.fromkeys(raw["fundamento_legal"] + [str(x) for x in (ext.get("fundamento_legal") or [])]))
        # cuantia_total: solo de documentos de requerimiento (la de un acta/OC es el monto
        # adjudicado → va aparte, para que compliance no la compare con el referencial)
        if ext.get("cuantia_total"):
            if not contratacion and not raw.get("cuantia_total"):
                raw["cuantia_total"] = ext["cuantia_total"]
            elif contratacion and not raw.get("monto_adjudicado_doc"):
                raw["monto_adjudicado_doc"] = ext["cuantia_total"]
                raw["monto_adjudicado_doc_sha256"] = sha
        if ext.get("cuantia_reservada") is True and not contratacion:
            raw["cuantia_reservada"] = True
        for k in ("modalidad", "fuente_financiamiento"):
            if ext.get(k) and not raw.get(k):
                raw[k] = ext[k]
        if ext.get("resumen"):
            raw["resumenes"].append({"documento": doc.get("titulo"), "sha256": sha, "resumen": ext["resumen"]})
        if isinstance(ext.get("estudio_mercado"), dict) and any(v not in (None, "", [], {}) for k, v in ext["estudio_mercado"].items() if k not in ("evidencia", "documento_sha256")):
            estudio_best = _mas_completo_lote(ext["estudio_mercado"], estudio_best)
        if isinstance(ext.get("contrato_final"), dict) and any(v not in (None, "", [], {}) for k, v in ext["contrato_final"].items() if k not in ("evidencia", "documento_sha256")):
            contrato_best = _mas_completo_lote(ext["contrato_final"], contrato_best)
        # ── procedimiento_seleccion (factores/puntajes/consultas/modificaciones) ──
        ps = ext.get("procedimiento_seleccion")
        if isinstance(ps, dict):
            for lk in ("factores_evaluacion", "puntajes_por_postor", "consultas_observaciones", "modificaciones_integracion"):
                for el in (ps.get(lk) or []):
                    if isinstance(el, dict) and any(v not in (None, "", [], {}) for k, v in el.items() if k not in ("pagina", "documento_sha256", "folio")):
                        el = {**el, "documento": doc.get("titulo"), "documento_sha256": el.get("documento_sha256") or sha}
                        if el not in raw["procedimiento_seleccion"][lk]:
                            raw["procedimiento_seleccion"][lk].append(el)
        # ── contrato (ejecución): ampliaciones / penalidades / adendas / entregas ──
        ec = ext.get("ejecucion_contractual")
        if isinstance(ec, dict):
            for lk in ("ampliaciones_plazo", "penalidades_aplicadas", "adendas", "entregas"):
                for el in (ec.get(lk) or []):
                    if isinstance(el, dict) and any(v not in (None, "", [], {}) for k, v in el.items() if k not in ("pagina", "documento_sha256", "folio")):
                        el = {**el, "documento": doc.get("titulo"), "documento_sha256": el.get("documento_sha256") or sha}
                        if el not in raw["contrato"][lk]:
                            raw["contrato"][lk].append(el)
            if ec.get("resolucion_contrato") and not raw["contrato"].get("resolucion_contrato"):
                raw["contrato"]["resolucion_contrato"] = ec["resolucion_contrato"]
                raw["contrato"]["resolucion_contrato_sha256"] = sha
            if ec.get("evidencia"):
                raw["contrato"].setdefault("evidencia", []).extend(e for e in ec["evidencia"] if e not in raw["contrato"].get("evidencia", []))
        if bloque and isinstance(ext.get(bloque), dict):
            raw[f"bloque_{bloque}"] = _merge_extraccion(raw.get(f"bloque_{bloque}") or {}, ext[bloque])

    # ── Postores: ganador desde el OCDS si ningún documento lo marcó; invitados vs. oferentes ──
    postores = raw["postores_consolidados"]
    if ganadores_ocds and not any(p.get("es_ganador") for p in postores):
        for p in postores:
            if p.get("ruc") in ganadores_ocds:
                p["es_ganador"] = True
                p["es_ganador_fuente"] = "ocds"
    for p in postores:
        if p.get("es_ganador") is None and p.get("ruc") in ganadores_ocds:
            p["es_ganador"] = True
            p["es_ganador_fuente"] = "ocds"
    if raw["lista_invitados"]:
        inv_rucs = {q.get("ruc") for q in raw["lista_invitados"] if q.get("ruc")}
        inv_noms = [q.get("razon_social") for q in raw["lista_invitados"]]
        for p in postores:
            fue_invitado = (p.get("ruc") in inv_rucs) or any(_mismo_nombre(p.get("razon_social"), n) for n in inv_noms)
            p["invitado"] = fue_invitado
            if not fue_invitado and p.get("monto_oferta") is not None and not p.get("estado"):
                p["estado"] = "no_invitado"
    for p in postores:
        if not p.get("estado") and p.get("monto_oferta") is not None:
            p["estado"] = "admitido"
        p.pop("_fuente_adjudicacion", None)
    raw["ofertas"] = _ofertas_desde_postores(postores)
    raw["postores"] = postores                       # alias: contrato de salida para R1/R3
    # ── Cruce items_consolidados × items_contratados: precio OFERTADO/CONTRATADO real por ítem ──
    _cruzar_items_contratados(raw["items_consolidados"], raw["items_contratados"])
    # Sin requerimiento legible (bases escaneadas/plantilla) pero con OC/contrato/acta: los ítems
    # contratados son la mejor descripción disponible del objeto → entran como origen='contrato'
    # (el mercado los usa con el precio contratado; compliance no marca "extracción fallida").
    if not raw["items_consolidados"] and raw["items_contratados"]:
        for j, it in enumerate(raw["items_contratados"], 1):
            if not isinstance(it, dict):
                continue
            raw["items_consolidados"].append({
                "numero": str(it.get("numero") or j), "descripcion_corta": it.get("descripcion"),
                "descripcion": it.get("descripcion"), "cantidad": it.get("cantidad"), "unidad": it.get("unidad"),
                "precio_unitario_ofertado": it.get("precio_unitario_contratado"),
                "precio_unitario_contratado": it.get("precio_unitario_contratado"),
                "marca_ofertada": it.get("marca_ofertada"), "origen": "contrato",
                "origen_precio": "contrato" if it.get("precio_unitario_contratado") is not None else None,
                "documento_sha256": it.get("documento_sha256"), "evidencia": it.get("evidencia") or [],
            })
        state["recortes"].append({"donde": "consolidacion_items", "limite": "sin_requerimiento_legible",
                                  "omitido": f"{len(raw['items_contratados'])} ítems tomados del contrato/OC/acta como descripción del objeto"})

    if gate_items:
        state["recortes"].append({"donde": "consolidacion_items", "limite": "solo_documentos_con_requerimiento",
                                  "omitido": gate_items})
    if gate_adj:
        state["recortes"].append({"donde": "consolidacion_comite_motivos", "limite": "solo_actas_cuadros_contratos",
                                  "omitido": gate_adj})
    raw["firmantes"] = raw["firmantes_consolidados"]
    raw["requerimiento_disponible"] = any(d.get("contiene_requerimiento") for d in raw["documentos"])
    if raw["resumenes"]:
        raw["resumen_ejecutivo"] = " · ".join(f"[{x['documento']}] {x['resumen']}" for x in raw["resumenes"])[:4000]
    state["parser_raw_consolidated"] = raw
    if estudio_best:
        state["estudio_mercado"] = estudio_best
    if contrato_best:
        state["contrato_final"] = contrato_best
    if bloque:
        raw[bloque] = raw.get(f"bloque_{bloque}") or {}          # alias corto (el driver lo lee como raw["servicio"], …)
        state[f"parser_bloque_{bloque}"] = raw[bloque]
    # document_analysis: si ningún LLM-agente lo escribió, lo armamos desde el raw para el
    # frontend/persistencia (mismo contenido que produce _backfill_document_analysis).
    da = state.get("document_analysis")
    if not isinstance(da, dict) or not da:
        state["document_analysis"] = {
            "items_consolidados": raw["items_consolidados"], "postores_extraidos": raw["postores_consolidados"],
            "firmantes": raw["firmantes_consolidados"], "comite_evaluacion": raw["comite_evaluacion"],
            "motivos_adjudicacion": raw["motivos_adjudicacion"], "lugar_fecha_acta": raw.get("lugar_fecha_acta"),
            "fundamento_legal": raw["fundamento_legal"], "modalidad": raw.get("modalidad"),
            "fuente_financiamiento": raw.get("fuente_financiamiento"), "cuantia_total": raw.get("cuantia_total"),
            "requerimiento_disponible": raw["requerimiento_disponible"], "resumen_ejecutivo": raw.get("resumen_ejecutivo"),
            "documentos": raw["documentos"], "_source": "parse_documentos_lote",
        }
    # caché por URL para la tool legacy (si el agente LLM la llama sobre el mismo doc → HIT)
    pdc = state.get("_parsed_doc_cache") or {}
    for d in resumen_docs:
        if d.get("url"):
            pdc[d["url"]] = {"n_pdfs_procesados": 1, "n_items_consolidados": d.get("n_items"), "_url": d["url"],
                             "_note": "procesado por parse_documentos_lote; detalle en state['parser_raw_consolidated']"}
    state["_parsed_doc_cache"] = pdc

    total_s = round(time.monotonic() - t_ini, 1)
    n_ok = sum(1 for d in resumen_docs if not d.get("error"))
    ev_tot = sum((d.get("evidencia") or {}).get("total", 0) for d in resumen_docs)
    ev_ok = sum((d.get("evidencia") or {}).get("verificadas", 0) for d in resumen_docs)
    resumen = {
        "n_docs": len(docs), "n_ok": n_ok, "n_error": len(docs) - n_ok,
        "n_cache_texto": sum(1 for d in resumen_docs if (d.get("cache") or {}).get("texto")),
        "n_cache_extraccion": sum(1 for d in resumen_docs if (d.get("cache") or {}).get("extraccion")),
        "n_items_consolidados": len(raw["items_consolidados"]), "n_items_otros_documentos": len(raw["items_otros_documentos"]),
        "n_items_contratados": len(raw["items_contratados"]),
        "n_items_con_precio_ofertado": sum(1 for it in raw["items_consolidados"] if isinstance(it, dict) and it.get("precio_unitario_ofertado") is not None),
        "n_postores": len(raw["postores_consolidados"]), "n_ofertas": len(raw["ofertas"]),
        "n_invitados": len(raw["lista_invitados"]), "n_firmantes": len(raw["firmantes_consolidados"]),
        "n_descartes_parser": len(raw["descartes_parser"]),
        "contrato": {k: len(v) for k, v in raw["contrato"].items() if isinstance(v, list)},
        "procedimiento_seleccion": {k: len(v) for k, v in raw["procedimiento_seleccion"].items() if isinstance(v, list)},
        "n_paginas_total": sum(int(d.get("n_paginas") or 0) for d in resumen_docs),
        "chars_total": sum(int(d.get("chars") or 0) for d in resumen_docs),
        "evidencia": {"total": ev_tot, "verificadas": ev_ok},
        "bloque": bloque, "segundos": total_s,
        "documentos": [{k: d.get(k) for k in ("id", "titulo", "tipo", "formato", "sha256", "n_paginas", "chars", "motor",
                                                "n_items", "n_firmantes", "cache", "tiempos", "truncado", "error",
                                                "tipo_documento_detectado")} for d in resumen_docs],
        "recortes": [r for r in state["recortes"]],
        "_note": "Detalle completo en state['parser_raw_consolidated'] y state['documentos_texto']",
    }
    print(f"[lote] {n_ok}/{len(docs)} docs · {resumen['n_paginas_total']} págs · {resumen['chars_total']:,} chars · "
          f"{len(raw['items_consolidados'])} ítems ({resumen['n_items_con_precio_ofertado']} con precio ofertado) · "
          f"{len(raw['items_contratados'])} contratados · {len(raw['postores_consolidados'])} postores / {len(raw['ofertas'])} ofertas · "
          f"{len(raw['firmantes_consolidados'])} firmantes · "
          f"evidencia {ev_ok}/{ev_tot} verificada · {len(state['recortes'])} recortes · {total_s}s", flush=True)
    return resumen


_STOP_DESC = {"DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "E", "O", "U", "PARA", "CON", "SIN", "EN", "POR", "UN", "UNA",
              "ADQUISICION", "COMPRA", "SUMINISTRO", "ITEM", "UND", "UNIDAD", "UNIDADES", "KG", "KLG", "KILOS", "KILOGRAMOS",
              "GALON", "GALONES", "LT", "LITRO", "LITROS", "SACO", "SACOS", "BOLSA", "BOLSAS", "TIPO", "MARCA"}


def _raiz(tok: str) -> str:
    """Stemming mínimo en español: quita plural y sufijos frecuentes (-es/-s, -ería, -ico/-ica…)."""
    t = tok
    for suf in ("ERIAS", "ERIA", "CIONES", "CION", "ICOS", "ICAS", "ICO", "ICA", "ALES", "AL", "ES", "S"):
        if len(t) > len(suf) + 3 and t.endswith(suf):
            t = t[: -len(suf)]
            break
    return t


def _tokens_raiz(desc: str) -> set[str]:
    d = re.sub(r"[^A-Z0-9 ]", " ", _norm_txt(desc or "").translate(_LOOKALIKES))
    return {_raiz(t) for t in d.split() if len(t) >= 3 and t not in _STOP_DESC}


def _cruzar_items_contratados(consolidados: list[dict], contratados: list[dict]) -> None:
    """Puebla en cada ítem consolidado (bases) `precio_unitario_ofertado`, `origen_precio`,
    `marca_ofertada` y la referencia del documento contratado que lo respalda, cruzando por
    raíces de palabras de la descripción + cantidad (OC 'ARROZ SUPERIOR - SOMOS DEL NORTE'
    ↔ bases 'ARROZ SUPERIOR'). Prioridad del origen: contrato > orden_de_compra >
    oferta_ganadora > adenda. Un ítem contratado se usa una sola vez."""
    if not consolidados or not contratados:
        return
    prio = {"contrato": 0, "orden_de_compra": 1, "oferta_ganadora": 2, "adenda": 3}
    cand = sorted([c for c in contratados if c.get("precio_unitario_contratado") is not None or c.get("marca_ofertada")],
                  key=lambda c: prio.get(c.get("origen"), 9))
    usados: set[int] = set()
    for it in consolidados:
        if not isinstance(it, dict):
            continue
        ti = _tokens_raiz(it.get("descripcion_corta") or it.get("descripcion") or "")
        if not ti:
            continue
        mejor, mejor_score = None, 0.0
        for j, c in enumerate(cand):
            if j in usados:
                continue
            tc = _tokens_raiz(c.get("descripcion") or "")
            if not tc:
                continue
            inter = ti & tc
            if not inter:
                continue
            score = len(inter) / max(1, min(len(ti), len(tc)))   # contención (una descripción amplía a la otra)
            if it.get("cantidad") is not None and c.get("cantidad") is not None:
                try:
                    if abs(float(it["cantidad"]) - float(c["cantidad"])) > 1e-6:
                        score *= 0.5
                except Exception:
                    pass
            if score > mejor_score:
                mejor, mejor_score = j, score
        # único ítem de cada lado → cruce directo aunque las descripciones difieran
        if mejor is None and len(consolidados) == 1 and len(cand) == 1 and not usados:
            mejor, mejor_score = 0, 0.5
        if mejor is None or mejor_score < 0.5:
            continue
        usados.add(mejor)
        c = cand[mejor]
        if c.get("precio_unitario_contratado") is not None:
            it["precio_unitario_ofertado"] = c["precio_unitario_contratado"]
            it["origen_precio"] = c.get("origen")
        if c.get("marca_ofertada"):
            it["marca_ofertada"] = c["marca_ofertada"]
        it["precio_ofertado_documento_sha256"] = c.get("documento_sha256")
        it["precio_ofertado_pagina"] = c.get("pagina")
        it["cruce_contratado"] = {"descripcion": c.get("descripcion"), "score": round(mejor_score, 2), "documento": c.get("documento")}


def _mas_completo_lote(nuevo, actual):
    def _peso(d):
        if not isinstance(d, dict):
            return 0
        return sum(1 for k, v in d.items() if k not in ("evidencia", "documento_sha256") and v not in (None, "", [], {}))
    return nuevo if _peso(nuevo) > _peso(actual) else actual


def parse_documentos_seleccionados(ocid: str, tool_context: ToolContext) -> dict:
    """Selecciona (determinista, por prioridad del perfil) y parsea EN LOTE todos los documentos
    del proceso: OCR una sola vez por sha256, extracción con evidencia por página. Una sola
    llamada reemplaza a list_documents + N × parse_document_pdf.

    Args:
        ocid: OCID de la convocatoria (largo o corto).

    Returns:
        Resumen compacto: n_docs, n_ok, ítems/firmantes consolidados, páginas, recortes.
        El detalle queda en state['parser_raw_consolidated'] y state['documentos_texto'].
    """
    state = tool_context.state
    bloque, prio, mx = _perfil_params(state)
    elegidos, omitidos = seleccionar_documentos(
        state.get("ocid") or ocid, state.get("ocds") or {}, state.get("doc_urls") or {}, prio, mx,
        doc_ids=state.get("doc_ids"),
    )
    state.setdefault("recortes", [])
    rec = recorte_seleccion(elegidos, omitidos, mx)
    if rec:
        state["recortes"].append(rec)
    state["documentos_seleccionados"] = elegidos
    state["documentos_omitidos"] = omitidos
    res = parse_documentos_lote(state, elegidos, parser_bloque=bloque, prioridad=prio)
    res["n_omitidos_seleccion"] = len(omitidos)
    return res


parse_documentos_seleccionados_tool = FunctionTool(func=parse_documentos_seleccionados)
