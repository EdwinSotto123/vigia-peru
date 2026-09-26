"""Tools del dominio: state_loaders."""

import re as _re

from tools._core import *  # noqa: F401,F403

_RUC_11_RE = _re.compile(r"(?<!\d)(?:10|15|16|17|20)\d{9}(?!\d)")


def _ruc_de_party(party, fallback_id=None) -> str | None:
    """RUC de un `parties[]`/`buyer`/`supplier` del OCDS: `additionalIdentifiers[scheme=PE-RUC]`,
    `identifier.id`, o el `id` ("PE-RUC-20123456789"). None si no hay 11 dígitos."""
    cands = []
    if isinstance(party, dict):
        for ai in party.get("additionalIdentifiers") or []:
            if isinstance(ai, dict) and str(ai.get("scheme") or "").upper().endswith("RUC"):
                cands.append(str(ai.get("id") or ""))
        ident = party.get("identifier")
        if isinstance(ident, dict):
            cands.append(str(ident.get("id") or ""))
        cands.append(str(party.get("id") or ""))
    if fallback_id:
        cands.append(str(fallback_id))
    for c in cands:
        m = _RUC_11_RE.search(c)
        if m:
            return m.group(0)
    return None


def _compact_ocds(ocds, entidad_ruc=None):
    """Proyección del OCDS para el dictamen: entidad (con RUC), monto, ganador, postores,
    ítems raíz y documentos (conteo + títulos). No lleva `parties`/`planning`/
    `sources` crudos (inflan el contexto), pero SÍ los datos que el writer necesita
    para no inventar: `buyer.ruc`, `numberOfTenderers`, `tenderers`, `items`, `documents`,
    `awards[].value`, `contracts[].value` (revisión lote 1: el writer inventó el RUC de la
    entidad porque solo recibía `buyer.id`)."""
    if not isinstance(ocds, dict):
        return ocds
    tender = ocds.get("tender") or {}
    buyer = ocds.get("buyer") or {}
    awards = ocds.get("awards") or []
    contracts = ocds.get("contracts") or []
    docs = tender.get("documents") or []
    parties = [p for p in (ocds.get("parties") or []) if isinstance(p, dict)]
    buyer_party = next((p for p in parties if "buyer" in (p.get("roles") or []) or p.get("id") == buyer.get("id")), None)
    buyer_ruc = _ruc_de_party(buyer_party or buyer, buyer.get("id")) or _ruc_de_party(None, entidad_ruc)
    parties_por_id = {str(p.get("id")): p for p in parties if p.get("id")}

    def _supplier(s):
        return {"id": s.get("id"), "name": s.get("name"),
                "ruc": _ruc_de_party(parties_por_id.get(str(s.get("id"))) or s, s.get("id"))}

    return {
        "ocid": ocds.get("ocid"),
        "buyer": {"name": buyer.get("name"), "id": buyer.get("id"), "ruc": buyer_ruc},
        "tender": {
            "title": tender.get("title"),
            "description": (tender.get("description") or "")[:1200] or None,
            "value": tender.get("value"),
            "procurementMethod": tender.get("procurementMethod"),
            "procurementMethodDetails": tender.get("procurementMethodDetails"),
            "mainProcurementCategory": tender.get("mainProcurementCategory"),
            "status": tender.get("status"),
            "numberOfTenderers": tender.get("numberOfTenderers"),
            "tenderers": [{"id": t.get("id"), "name": t.get("name")}
                          for t in (tender.get("tenderers") or []) if isinstance(t, dict)][:30],
            "items": [{"id": it.get("id"), "description": (it.get("description") or "")[:200],
                       "quantity": it.get("quantity"), "unit": (it.get("unit") or {}).get("name"),
                       "totalValue": it.get("totalValue")}
                      for it in (tender.get("items") or []) if isinstance(it, dict)][:60],
            "n_items": len(tender.get("items") or []),
            "tenderPeriod": tender.get("tenderPeriod"),
            "n_documents": len(docs),
            "documents": [{"title": d.get("title"), "documentType": d.get("documentType"),
                           "datePublished": (d.get("datePublished") or "")[:10]}
                          for d in docs if isinstance(d, dict)][:30],
        },
        "awards": [
            {"id": a.get("id"), "status": a.get("status"),
             "suppliers": [_supplier(s) for s in (a.get("suppliers") or []) if isinstance(s, dict)],
             "value": a.get("value"), "date": a.get("date")}
            for a in awards[:20] if isinstance(a, dict)
        ],
        "n_awards": len(awards),
        "contracts": [
            {"id": c.get("id"), "status": c.get("status"), "value": c.get("value"),
             "dateSigned": c.get("dateSigned"), "n_amendments": len(c.get("amendments") or [])}
            for c in contracts[:20] if isinstance(c, dict)
        ],
        "n_contracts": len(contracts),
    }


# Campos de `document_analysis.documentos[*]` que sirven al dictamen (el resto —gs, url,
# sha256, cache, tiempos, usos, unidades, motor— es telemetría del parser).
_DOC_CAMPOS_DICTAMEN = ("id", "titulo", "tipo", "seccion", "formato", "n_paginas", "n_items", "n_firmantes",
                        "tipo_documento_detectado", "contiene_requerimiento", "truncado", "error")


def _sin_sha(ev):
    if isinstance(ev, list):
        return [{k: v for k, v in e.items() if k != "documento_sha256"} if isinstance(e, dict) else e for e in ev]
    return ev


from tools.contexto import compactar_errores  # noqa: E402

# Por hallazgo de mercado el dictamen necesita el veredicto, la mediana, el precio ofertado y
# algunas fuentes; no los ~7 k chars de precios observados, evidencia, referencias internas y
# consultas (medido en staging, 400 hallazgos: precios 1,9 k, evidencia 1,6 k, referencias 1 k).
_MERCADO_TOPE_LISTA = 3
_MERCADO_SIN_VALOR_PARA_DICTAMEN = ("requerimiento_usado", "queries_realizadas", "evidencia",
                                    "caracteristicas_solicitadas_clave")


def _compact_market_analysis(ma):
    """Copia de `market_analysis` para el writer: cada hallazgo conserva sus campos de
    veredicto y hasta 3 precios observados / referencias internas / proveedores (con el total
    en `<campo>_total`). No muta el state."""
    if not isinstance(ma, dict) or not isinstance(ma.get("findings"), list):
        return ma
    out = {k: v for k, v in ma.items() if k != "findings"}
    findings = []
    for f in ma["findings"]:
        if not isinstance(f, dict):
            findings.append(f)
            continue
        g = {}
        for k, v in f.items():
            if k in _MERCADO_SIN_VALOR_PARA_DICTAMEN:
                continue
            if isinstance(v, list) and len(v) > _MERCADO_TOPE_LISTA and k in (
                    "precios_observados", "referencias_internas", "proveedores_potenciales", "fuentes"):
                g[k] = v[:_MERCADO_TOPE_LISTA]
                g[f"{k}_total"] = len(v)
            else:
                g[k] = v
        findings.append(g)
    out["findings"] = findings
    return out


def _compact_document_analysis(da):
    """Proyección de `document_analysis` para el writer SIN lo redundante (verificado en un
    contexto real: 28 k de 62 k chars eran document_analysis):
      · `requerimiento_tecnico_detallado` es ALIAS de `texto_literal` por ítem (hasta 4 000
        chars duplicados por ítem) → se deja solo `texto_literal`;
      · `firmantes_consolidados` == `firmantes` y `postores_consolidados` == `postores_extraidos`;
      · `documentos[*]` se reduce a los campos útiles (sin telemetría del OCR);
      · `documento_sha256` (por ítem/evidencia/firmante/…) no es citable en el dictamen.
    No se quita ninguna información única. Devuelve una COPIA (no muta el state)."""
    if not isinstance(da, dict):
        return da
    out = {}
    for k, v in da.items():
        if k in ("_source", "_note"):
            continue
        if k == "firmantes_consolidados" and v == da.get("firmantes"):
            continue
        if k == "postores_consolidados" and v == da.get("postores_extraidos"):
            continue
        if k == "documentos" and isinstance(v, list):
            out[k] = [{c: d.get(c) for c in _DOC_CAMPOS_DICTAMEN if d.get(c) not in (None, "", [], {})}
                      if isinstance(d, dict) else d for d in v]
            continue
        if isinstance(v, list):
            nv = []
            for it in v:
                if not isinstance(it, dict):
                    nv.append(it)
                    continue
                it2 = {}
                for ik, iv in it.items():
                    if ik == "documento_sha256":
                        continue
                    if ik == "requerimiento_tecnico_detallado" and iv == it.get("texto_literal"):
                        continue
                    it2[ik] = _sin_sha(iv) if ik == "evidencia" else iv
                nv.append(it2)
            out[k] = nv
        elif isinstance(v, dict):
            out[k] = {ik: (_sin_sha(iv) if ik == "evidencia" else iv) for ik, iv in v.items() if ik != "documento_sha256"}
        else:
            out[k] = v
    return out


def _paginar(obj, max_str: int, max_list: int, _depth: int = 0):
    """Paginación por sección: en vez de cortar silenciosamente (viejo `_cap`), cada
    lista que supera `max_list` se reemplaza por {"items": [...], "_truncado": true,
    "_omitidos": n, "_total": N} y cada string larga termina en un marcador con el
    conteo de chars omitidos. El writer SIEMPRE sabe qué no vio."""
    if _depth > 8:
        return obj
    if isinstance(obj, str):
        if len(obj) <= max_str:
            return obj
        return obj[:max_str] + f" …[_truncado: {len(obj) - max_str} chars omitidos]"
    if isinstance(obj, list):
        items = [_paginar(x, max_str, max_list, _depth + 1) for x in obj[:max_list]]
        if len(obj) > max_list:
            return {"items": items, "_truncado": True, "_omitidos": len(obj) - max_list,
                    "_total": len(obj)}
        return items
    if isinstance(obj, dict):
        return {k: _paginar(v, max_str, max_list, _depth + 1) for k, v in obj.items()}
    return obj


def _banderas_para_dictamen(state) -> list[dict] | None:
    """Banderas PERSISTIDAS (todos los agentes) leídas de BD por alerta_codigo; si la
    BD no responde, las que dejó `persist_alert_from_flags` en state['banderas']."""
    codigo = state.get("alerta_codigo")
    if codigo:
        try:
            conn = _pg()
            try:
                cur = conn.cursor()
                cur.execute("SELECT 1 FROM information_schema.columns WHERE table_name='banderas' "
                            "AND column_name='verificacion'")
                con_ver = cur.fetchone() is not None
                cur.execute(
                    "SELECT b.regla, b.severidad, b.evidencia, b.norma, b.fuente_url, b.agente_origen"
                    + (", b.verificacion" if con_ver else ", NULL") +
                    " FROM banderas b JOIN alertas a ON a.id=b.alerta_id WHERE a.codigo=%s "
                    "ORDER BY CASE b.severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, b.id",
                    (codigo,))
                rows = cur.fetchall()
                if rows:
                    out = []
                    for r in rows:
                        ver = r[6]
                        if isinstance(ver, str):
                            ver = _safe_parse_json(ver)
                        out.append({"regla": r[0], "severidad": r[1], "evidencia": r[2], "norma": r[3],
                                    "fuente_url": r[4], "agente_origen": r[5], "verificacion": ver})
                    return out
            finally:
                conn.close()
        except Exception:
            pass
    b = state.get("banderas")
    return [x for x in b if isinstance(x, dict)] if isinstance(b, list) else None


_NARRATIVA_DEGRADADA = ("resumen_ejecutivo", "sintesis", "sintesis_personal", "observaciones",
                        "justificacion", "detalle", "observacion")
_AVISO_NO_VERIFICABLE = ("[NO VERIFICABLE] salida degradada por el validador (sin evidencia validada): "
                         "NO narrar como hecho; solo puede citarse como 'observación no verificada del agente'")
_RNP_MATCH_MIN = 0.95


def _marcar_no_verificable(obj, _depth: int = 0):
    """Revisión lote 1: cuando una salida de agente quedó `estado='no_verificable'` (todas sus
    banderas/cruces se descartaron), su prosa (`resumen_ejecutivo`, `sintesis`,
    `direccionamiento_detectado.justificacion`…) llegaba íntegra al writer y se publicaba como
    hecho (1225030: familia Baca; 1225392: carpeta fiscal no localizable). Aquí cada campo
    narrativo se prefija con "[NO VERIFICABLE]" y se añade `_aviso`. Devuelve una COPIA."""
    if _depth > 4 or not isinstance(obj, dict):
        return obj
    out = {}
    for k, v in obj.items():
        if k in _NARRATIVA_DEGRADADA and isinstance(v, str) and v.strip() and not v.startswith("[NO VERIFICABLE]"):
            out[k] = "[NO VERIFICABLE] " + v
        elif isinstance(v, dict):
            out[k] = _marcar_no_verificable(v, _depth + 1)
        else:
            out[k] = v
    if _depth == 0:
        out["_aviso"] = _AVISO_NO_VERIFICABLE
        if isinstance(out.get("direccionamiento_detectado"), dict) and out["direccionamiento_detectado"].get("hay_indicios") \
                and not out.get("red_flags_documentales"):
            out["direccionamiento_detectado"]["_aviso"] = ("hay_indicios sin ninguna red_flag validada: "
                                                           "no existe vector de direccionamiento verificable")
    return out


def _oece_perfil_para_dictamen(state) -> dict | None:
    """`oece_perfiles` (query_oece_perfil, determinista) compactado por RUC: sanciones,
    inhabilitaciones, penalidades, aptitud. `n_sanciones = 0` es un DATO verificado del OECE,
    no `sin_dato` (1225030 decía 'sin_dato' teniendo 0 sanciones verificadas)."""
    perfiles = state.get("oece_perfiles")
    if isinstance(perfiles, str):
        perfiles = _safe_parse_json(perfiles)
    if not isinstance(perfiles, dict) or not perfiles:
        return None
    out = {}
    for ruc, p in list(perfiles.items())[:10]:
        if not isinstance(p, dict):
            continue
        out[str(ruc)] = {
            "ruc": p.get("ruc") or ruc, "razon_social": p.get("razon_social"),
            "es_apto_contratar": p.get("es_apto_contratar"), "es_habilitado": p.get("es_habilitado"),
            "n_sanciones": p.get("n_sanciones"), "n_inhabilitaciones_judiciales": p.get("n_inhabilitaciones_judiciales"),
            "n_inhabilitaciones_administrativas": p.get("n_inhabilitaciones_administrativas"),
            "n_penalidades": p.get("n_penalidades"), "n_medidas_cautelares": p.get("n_medidas_cautelares"),
            "sanciones": (p.get("sanciones") or [])[:5],
            "inhabilitaciones_administrativas": (p.get("inhabilitaciones_administrativas") or [])[:5],
            "inhabilitaciones_judiciales": (p.get("inhabilitaciones_judiciales") or [])[:5],
            "fuente_url": p.get("fuente_url"),
        }
    if not out:
        return None
    out["_nota"] = ("Dato determinista del OECE (perfilprov). Un conteo 0 es un hecho verificado "
                    "('sin sanciones registradas en OECE'), no 'sin_dato'. Una sanción con vigente=false "
                    "o multa pagada es antecedente histórico, no sanción vigente.")
    return out


def _rnp_firmantes_para_dictamen(state) -> list[dict] | None:
    """Firmantes del expediente que figuran en el RNP como socios/representantes de empresas
    proveedoras del Estado con match ≥ 0.95 (nombre exacto). Es un cruce determinista que el
    dictamen negaba ('no se hallaron relaciones societarias') mientras el contexto lo traía
    (1225058, 1225266, 1225450)."""
    ctx = state.get("person_network_context")
    if isinstance(ctx, str):
        ctx = _safe_parse_json(ctx)
    if not isinstance(ctx, dict):
        return None
    res = ctx.get("rnp_firmantes_resultados")
    if not isinstance(res, list):
        return None
    out = []
    for r in res:
        if not isinstance(r, dict):
            continue
        empresas = []
        for e in r.get("empresas") or []:
            if not isinstance(e, dict):
                continue
            try:
                score = float(e.get("match_score") or 0)
            except (TypeError, ValueError):
                score = 0.0
            if score >= _RNP_MATCH_MIN or r.get("match_por") == "nombre_exacto":
                empresas.append({"ruc_empresa": e.get("ruc_empresa"), "nombre_visto": e.get("nombre_visto"),
                                 "roles": e.get("roles"), "forma_societaria": e.get("forma_societaria"),
                                 "fecha_inicio_vigencia": e.get("fecha_inicio_vigencia"), "match_score": score})
        if empresas:
            out.append({"firmante": r.get("firmante"), "match_por": r.get("match_por"), "empresas": empresas[:10],
                        "_nota": "cruce determinista RNP (match ≥ 0.95): el firmante figura en la conformación "
                                 "jurídica de estas empresas; no es irregular per se, es observación de red"})
    return out or []


def get_dictamen_context(tool_context: ToolContext) -> dict:
    """Devuelve el contexto investigativo de la convocatoria en curso, leído del
    session.state. Es la ÚNICA forma en que el report_writer accede a los datos
    reales del análisis — sin llamar esto, NO tiene información y CUALQUIER cosa
    que escriba será alucinación.

    Incluye (WS V · auditoría #6 y §6.1-4):
      · `banderas`: las PERSISTIDAS en BD por todos los agentes (compliance, legal,
        market), con `verificacion`. El dictamen solo puede citar estas.
      · `reglas_evaluadas`: pending_flags (resultado de las reglas deterministas).
      · `entity_personnel`, `estado_real`, `analisis_postores`,
        `causal_directa_invocada`, `acto_resolutivo_directa`, `sunat_decolecta`.
      · `recortes` / `descartes` / `validaciones_pendientes`: lo que NO entró al
        análisis, para la sección "Recortes y datos no verificables".
      · `normative_compliance` completo (ya sin corte a 10 hallazgos).

    Paginación: cada sección se recorta con marca explícita (`_truncado`,
    `_omitidos`, `_total`) — nunca un corte silencioso. En el REINTENTO
    (`state['_dictamen_compact']`) bajan los topes pero NO se elimina
    `legal_analysis`. Un output no parseable llega como
    {"estado": "sin_dato", "_parse_failed": true}, nunca como texto crudo.

    Returns:
        Diccionario con ocds (compacto), banderas, document_analysis, legal_analysis,
        market_analysis, web_research, news_research, person_network, entity_personnel,
        compliance_result, normative_compliance, reglas_evaluadas, estado_real,
        analisis_postores, causal_directa_invocada, acto_resolutivo_directa,
        sunat_decolecta, estudio_mercado, contrato_final, recortes, descartes,
        validaciones_pendientes, alerta_codigo, perfil.
    """
    state = tool_context.state
    compact = bool(state.get("_dictamen_compact"))
    keys = [
        "ocds", "document_analysis", "legal_analysis", "market_analysis",
        "web_research", "news_research", "person_network", "entity_personnel",
        "compliance_result", "normative_compliance", "alerta_codigo",
        "estado_real", "analisis_postores", "causal_directa_invocada",
        "acto_resolutivo_directa", "sunat_decolecta",
        # Bloques tipados por documento (ruteo incremental): estudio de mercado +
        # causal (Resumen Ejecutivo) y condiciones FINALES (Orden de Compra).
        "estudio_mercado", "contrato_final",
        "recortes", "descartes", "validaciones_pendientes", "perfil",
    ]
    out: dict = {}
    for k in keys:
        v = state.get(k)
        if v is None:
            out[k] = None
            continue
        if isinstance(v, str):
            parsed = _safe_parse_json(v)
            if parsed:
                out[k] = parsed
            elif k in ("compliance_result", "alerta_codigo", "perfil"):
                out[k] = v          # texto legítimo (síntesis / código / nombre del perfil)
            else:
                out[k] = {"estado": "sin_dato", "_parse_failed": True,
                          "_motivo": "output del agente no parseable como JSON"}
        else:
            out[k] = v
    out["ocds"] = _compact_ocds(out.get("ocds"), entidad_ruc=state.get("entidad_ruc"))
    out["document_analysis"] = _compact_document_analysis(out.get("document_analysis"))
    # `perfil` completo (listas de prioridad de documentos, reglas, topes) no aporta al texto:
    # las secciones del dictamen ya viajan en el mensaje del writer.
    if isinstance(out.get("perfil"), dict):
        out["perfil"] = {k: out["perfil"].get(k) for k in ("nombre", "market_estrategia", "legal_vectores")}
    # Salidas degradadas (`estado: no_verificable`): su prosa se marca, no se entrega como hecho.
    degradadas = []
    for k in ("legal_analysis", "web_research", "news_research", "person_network", "entity_personnel"):
        v = out.get(k)
        if isinstance(v, dict) and str(v.get("estado") or "").lower() == "no_verificable":
            out[k] = _marcar_no_verificable(v)
            degradadas.append(k)
    out["salidas_no_verificables"] = degradadas
    out["oece_perfil"] = _oece_perfil_para_dictamen(state)
    out["rnp_firmantes_resultados"] = _rnp_firmantes_para_dictamen(state)
    out["banderas"] = _banderas_para_dictamen(state)
    # Sin `reglas_evaluadas` (= pending_flags): repetía las banderas, y el dictamen solo puede
    # citar las persistidas en `banderas`.
    out["n_banderas"] = len(out["banderas"] or [])
    out["market_analysis"] = _compact_market_analysis(out.get("market_analysis"))
    out = compactar_errores(out)
    out["_nota"] = ("Solo se pueden citar banderas presentes en `banderas`. Las secciones con "
                    "`_truncado: true` fueron paginadas; `_omitidos` dice cuántos elementos no se "
                    "muestran. `recortes`/`descartes`/`validaciones_pendientes` deben listarse en "
                    "la sección 'Recortes y datos no verificables'. Las salidas listadas en "
                    "`salidas_no_verificables` traen su prosa marcada '[NO VERIFICABLE]': no se narran "
                    "como hechos. `oece_perfil` es dato oficial determinista (0 sanciones = verificado). "
                    "`rnp_firmantes_resultados` son cruces RNP deterministas de firmantes (match ≥ 0.95). "
                    "El RUC de la entidad es `ocds.buyer.ruc`; el del proveedor, `ocds.awards[].suppliers[].ruc`: "
                    "si vienen null, no existen para el dictamen.")
    if compact:
        out = _paginar(out, max_str=1600, max_list=15)
    else:
        out = _paginar(out, max_str=6000, max_list=60)
    return out

def read_document_analysis(tool_context: ToolContext) -> dict:
    """Devuelve el state['document_analysis'] producido por el document_parser_agent.
    Sirve a sub-agentes (legal_analyst, etc.) que necesitan leer items/firmantes/
    comite/motivos_adjudicacion del documento parseado sin depender de que el
    orchestrator inyecte el JSON en el mensaje (operación que el LLM falla
    cuando el JSON es grande).

    Fallback: si state['document_analysis'] está vacío o malformado, lee
    state['parser_raw_consolidated'] que la tool parse_document_pdf escribe
    directamente con el JSON ya estructurado (sin pasar por el LLM).

    Returns:
        dict con el state['document_analysis'] parseado a JSON, o
        {error: '...'} si no se ha ejecutado el parser todavía.
    """
    state = tool_context.state

    # Helper: limpia markdown fences ```json ... ``` antes de parsear
    def _strip_fences(s: str) -> str:
        s = s.strip()
        if s.startswith("```"):
            # Quitar primera línea (```json o ```)
            first_nl = s.find("\n")
            if first_nl > 0:
                s = s[first_nl + 1:]
            # Quitar ``` final
            if s.endswith("```"):
                s = s[:-3].strip()
        return s

    # PRIORIDAD INVERTIDA (fix 2026-06-17): la AUTORIDAD es `parser_raw_consolidated`
    # (extracción DETERMINISTA de la tool parse_document_pdf), NO el document_analysis del
    # AGENTE. El document_parser_AGENTE recibe de la tool solo un RESUMEN compacto (conteos,
    # NO los ítems), así que cuando arma su document_analysis a veces ECHA el schema como
    # valor — placeholders tipo "Descripción corta del Ítem N extraída de las Bases",
    # "POSTOR DE BASES 1", "NOMBRE FIRMANTE BASES". Esa basura envenenaba al legal_analyst
    # (leía ítems/firmantes inventados). La tool SÍ tiene los datos reales. Antes esto solo
    # se usaba como fallback "si document_analysis vacío"; ahora gana SIEMPRE que tenga datos.
    raw = state.get("parser_raw_consolidated")
    if isinstance(raw, dict) and (raw.get("items_consolidados") or raw.get("firmantes")
                                  or raw.get("postores_consolidados") or raw.get("postores_extraidos")):
        # Una sola lista de ítems y sin alias/sha256 (`_compact_document_analysis`): antes viajaba
        # `items` Y `items_consolidados` (la misma lista), cada ítem con `texto_literal` y su alias
        # `requerimiento_tecnico_detallado` → 4 copias del texto, reenviadas en cada turno del
        # agente legal (28 % de la respuesta de esta tool en las trazas de septiembre).
        return _compact_document_analysis({
            "items": raw.get("items_consolidados", []),
            "postores_extraidos": raw.get("postores_extraidos") or raw.get("postores_consolidados") or [],
            "firmantes": raw.get("firmantes", []),
            "comite_evaluacion": raw.get("comite_evaluacion", []),
            "motivos_adjudicacion": raw.get("motivos_adjudicacion", []),
            "cuantia_total": raw.get("cuantia_total"),
            "modalidad": raw.get("modalidad"),
            "fundamento_legal": raw.get("fundamento_legal"),
            # Estudio de mercado + causal (Resumen Ejecutivo) para que el análisis
            # legal evalúe la VALIDEZ de la causal de contratación directa.
            "estudio_mercado": state.get("estudio_mercado"),
            "contrato_final": state.get("contrato_final"),
            "_source": "parser_raw_consolidated",
            "_note": "Extracción determinista de la tool (autoritativa sobre el LLM del parser).",
        })

    # Fallback: el output del AGENTE (solo si la tool no dejó nada extraído).
    v = state.get("document_analysis")
    if v is not None:
        if isinstance(v, dict):
            if v.get("items") or v.get("items_consolidados") or v.get("firmantes"):
                return v
        if isinstance(v, str):
            cleaned = _strip_fences(v)
            parsed = _safe_parse_json(cleaned)
            if parsed and (parsed.get("items") or parsed.get("items_consolidados")
                           or parsed.get("firmantes")):
                return parsed

    return {
        "error": "document_analysis no está en state — el parser aún no corrió.",
        "items": [],
        "firmantes": [],
        "comite_evaluacion": [],
        "motivos_adjudicacion": [],
    }

def get_alerta_full_context(alerta_codigo: str, tool_context: ToolContext) -> dict:
    """Trae todo el contexto disponible de una alerta para que el report
    writer arme el dictamen: convocatoria, banderas, items, hallazgos de
    mercado, web research, documentos parseados.

    Args:
        alerta_codigo: Código de la alerta (ej. 'OECE-1203694').

    Returns:
        Diccionario con alerta, banderas, items, market_findings, web_research.
    """
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT a.id::text, a.codigo, a.ocid, a.score, a.estado,
                      a.entidad_ruc, a.proveedor_ruc, a.monto_adjudicado,
                      a.fecha_buena_pro, a.region, a.objeto, a.fuente_url,
                      e.nombre, emp.razon_social, emp.actividad_economica
                 FROM alertas a
                 LEFT JOIN entidades e ON e.ruc=a.entidad_ruc
                 LEFT JOIN empresas emp ON emp.ruc=a.proveedor_ruc
                WHERE a.codigo=%s LIMIT 1""",
            (alerta_codigo,),
        )
        row = cur.fetchone()
        if not row:
            return {"error": "alerta not found"}
        keys = ["id", "codigo", "ocid", "score", "estado", "entidad_ruc",
                "proveedor_ruc", "monto", "fecha_bp", "region", "objeto",
                "fuente_url", "entidad_nombre", "proveedor_nombre", "actividad_proveedor"]
        alerta = dict(zip(keys, row))
        alerta["monto"] = float(alerta["monto"] or 0)
        alerta["fecha_bp"] = str(alerta["fecha_bp"]) if alerta["fecha_bp"] else None

        cur.execute(
            "SELECT regla, severidad, evidencia, norma, fuente_url FROM banderas "
            "WHERE alerta_id=%s ORDER BY CASE severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END",
            (alerta["id"],),
        )
        banderas = [
            {"regla": r[0], "severidad": r[1], "evidencia": r[2], "norma": r[3], "fuente_url": r[4]}
            for r in cur.fetchall()
        ]
        cur.execute(
            "SELECT numero_item, descripcion, cantidad, unidad, cuantia_referencial "
            "FROM convocatoria_items WHERE ocid=%s ORDER BY numero_item",
            (alerta["ocid"],),
        )
        items = [{"n": r[0], "desc": r[1], "cant": float(r[2] or 0),
                  "unidad": r[3], "ref": float(r[4] or 0)} for r in cur.fetchall()]
        return {
            "alerta": alerta, "banderas": banderas, "items": items,
            "market_findings": tool_context.state.get("market_findings", []),
            "web_research_text": tool_context.state.get("web_research", ""),
            "doc_parser_text": tool_context.state.get("document_analysis", ""),
        }
    finally:
        conn.close()

# ── FunctionTool wrappers ──
get_alerta_full_context_tool = FunctionTool(func=get_alerta_full_context)
get_dictamen_context_tool = FunctionTool(func=get_dictamen_context)
read_document_analysis_tool = FunctionTool(func=read_document_analysis)
