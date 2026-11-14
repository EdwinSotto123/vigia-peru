"""compliance_rules._rules_directa — reglas de contratación directa e inconsistencia doc-vs-OCDS."""

from tools._core import *  # noqa: F401,F403
from tools import verify as _verify  # noqa: F401
from tools.compliance_rules._base import _as_tool, _es_subasta, _montos_ocds, _norma_state, _perfil_reglas, _procurement_method, _regla_omitida  # noqa: F401
from tools.compliance_rules._object_matching import coincide_objeto_detalle  # noqa: F401
from tools.fuentes import proceso_oece  # noqa: E402


def _juez_coherencia_dice_coherente(state: dict) -> bool:
    """True si el juez `coherencia_objeto_items` (self_eval) ya dictaminó 'coherente'."""
    se = (state or {}).get("self_evals") or (state or {}).get("self_eval") or {}
    cands = []
    if isinstance(se, dict):
        cands.append(se)
        cands.extend(v for v in se.values() if isinstance(v, dict))
    elif isinstance(se, list):
        cands.extend(x for x in se if isinstance(x, dict))
    for c in cands:
        for k in ("coherencia", "coherencia_objeto_items"):
            v = c.get(k)
            if isinstance(v, str) and v.strip().lower() == "coherente":
                return True
            if isinstance(v, dict) and str(v.get("veredicto") or v.get("resultado") or "").lower() == "coherente":
                return True
    return False

# Causales de la contratación directa: (clave, literal del art. 27.1 del TUO de la Ley 30225, patrón, descripción,
# ¿necesita el acto que declara la situación?). El catálogo anterior (`_CAUSALES_DIRECTA` de tools/_core.py) no tenía
# las dos causales más usadas —proveedor único y arrendamiento o compra de inmuebles—, así que una directa por
# proveedor único salía como «sin causal identificable» en severidad alta; y sus literales no eran los de la ley
# (ponía la emergencia en el «a», que es la contratación entre entidades). El literal es sólo el del TUO: en la
# evidencia se nombra la causal, no la letra, porque la Ley 32069 (art. 55.1) rige desde el 22-abr-2025.
_CAUSALES: list[tuple[str, str | None, str, str, bool]] = [
    ("emergencia", "b", r"(situaci[oó]n de emergencia|desastre|catastrofe|cat[áa]strofe|"
                        r"emergencia\s+(?:nacional|sanitaria|ambiental)|lluvias intensas|sismo|terremoto)",
     "Situación de emergencia / desastre", True),
    ("desabastecimiento", "c", r"desabastecimiento(\s+inminente)?", "Desabastecimiento inminente", True),
    ("entre_entidades", "a", r"contrataci[oó]n\s+(entre|con)\s+entidad(es)?\s+p[uú]blica|"
                             r"contrat\w+\s+(entre\s+entidades|con\s+otra\s+entidad)",
     "Contratación entre entidades públicas", False),
    ("proveedor_unico", "e", r"proveedor\s+[uú]nico|[uú]nico\s+proveedor|"
                             r"s[oó]lo\s+pued[ae]n?\s+obtenerse\s+de\s+un\s+determinado\s+proveedor|"
                             r"determinado\s+proveedor\s+(que\s+)?posea\s+derechos\s+exclusivos|"
                             r"(propiedad\s+(intelectual|industrial)|patente|marca\s+registrada|derechos?\s+de\s+autor)"
                             r"\s+.{0,40}([uú]nic|exclusiv)",
     "Proveedor único / derechos exclusivos", False),
    ("inmuebles", "j", r"(arrendamiento|alquiler|adquisici[oó]n)\s+de\s+(un\s+|el\s+|los\s+)?(bien(es)?\s+)?inmuebles?",
     "Arrendamiento o adquisición de bienes inmuebles", False),
    ("personalisimo", "f", r"servicios?\s+personal[ií]simos?|notoria\s+especializaci[oó]n",
     "Servicio personalísimo / notoria especialización", False),
    ("publicidad", "g", r"servicios?\s+de\s+publicidad\s+(en\s+medios|por\s+medios|para\s+el\s+estado|estatal)",
     "Servicio de publicidad en medios", False),
    ("consultoria_continuacion", "h", r"servicios?\s+de\s+consultor[ií]a(\s+especializa)?",
     "Servicios de consultoría (continuación o especializada)", False),
    ("investigacion", "i", r"fines\s+de\s+investigaci[oó]n|investigaci[oó]n,\s+experimentaci[oó]n",
     "Bienes y servicios con fines de investigación, experimentación o desarrollo", False),
    ("asesoria_legal", "k", r"asesor[ií]a\s+legal\s+(en\s+casos\s+excepcionales|excepcional)|"
                            r"defensa\s+de\s+(funcionarios|servidores|ex\s*funcionarios)",
     "Asesoría legal para la defensa de funcionarios", False),
    ("contrato_resuelto", "l", r"contrato\s+(resuelto|declarado\s+nulo)|prestaciones\s+no\s+ejecutadas|"
                               r"continuidad\s+de\s+la\s+ejecuci[oó]n",
     "Continuidad de un contrato resuelto o declarado nulo", False),
    ("capacitacion", "m", r"capacitaci[oó]n\s+(de\s+inter[eé]s\s+)?(institucional|necesaria)|pasant[ií]a",
     "Capacitación de interés institucional", False),
    ("secreto", "d", r"car[aá]cter\s+(de\s+)?secreto|secreto\s+militar|razones\s+de\s+orden\s+interno",
     "Carácter secreto, secreto militar o de orden interno", False),
    # Dos supuestos que el catálogo anterior ya reconocía y que la ley trata fuera del art. 27 (sin literal).
    ("tarifa_regulada", None, r"servicios?\s+p[uú]blicos?\s+.{0,30}\s+tarifa(s)?\s+regulad",
     "Servicio público con tarifa regulada", False),
    ("servicios_financieros", None, r"servicios?\s+financieros?\s+del\s+estado",
     "Servicios financieros del Estado", False),
]


def _textos_causal(state: dict) -> list[str]:
    """Dónde más dice el expediente qué causal se invoca: el bloque `sustento_directa` del parser (causal_articulo,
    causal_texto, proveedor_unico_justificacion) y el estudio de mercado. La regla sólo leía `fundamento_legal`
    (las normas citadas: «Art. 55 Ley 32069»), que casi nunca nombra la causal."""
    raw = state.get("parser_raw_consolidated") or {}
    doc = _safe_parse_json(state.get("document_analysis")) or {}
    em = _safe_parse_json(state.get("estudio_mercado")) or {}
    out: list[str] = []
    for src in ((raw.get("sustento_directa") if isinstance(raw, dict) else None), state.get("parser_bloque_sustento_directa"),
                (doc.get("sustento_directa") if isinstance(doc, dict) else None), em):
        if not isinstance(src, dict):
            continue
        for k in ("causal_articulo", "causal_texto", "proveedor_unico_justificacion"):
            v = src.get(k)
            if isinstance(v, str) and v.strip() and v.strip() not in out:
                out.append(v.strip())
    return out


def _se_leyo_algo(state: dict, doc, raw, textos_causal: list[str]) -> bool:
    """¿Hubo texto de algún documento? `document_analysis` y `parser_raw_consolidated` existen siempre que corre el
    parser, aunque todo llegue vacío (PDF escaneado): que el diccionario exista no es haber leído."""
    if textos_causal:
        return True
    try:
        if _verify.textos_documentos(state):
            return True
    except Exception:  # noqa: BLE001
        pass
    for src in (doc, raw):
        if not isinstance(src, dict):
            continue
        for k in ("fundamento_legal", "items_consolidados", "items", "resumen_ejecutivo", "firmantes",
                  "firmantes_consolidados", "postores_extraidos", "postores_consolidados", "motivos_adjudicacion",
                  "comite_evaluacion", "requerimiento_tecnico_detallado"):
            if src.get(k):
                return True
    return False


def _identificar_causal_directa(fundamento_textos: list[str], objeto_contrato: str = "") -> dict:
    """Identifica qué causal del Art. 27 / Art. 55 invocó la entidad para una
    Contratación Directa. Retorna {causal_clave, causal_letra, descripcion, evidencia_text,
    requiere_acto_resolutivo, match}. `causal_letra` es el literal del art. 27.1 del TUO de la Ley 30225.

    Si ninguna causal coincide, retorna {causal_letra: None, ...}.
    """
    import re as _re
    corpus = " ".join(str(t) for t in (fundamento_textos or []))[:10000]
    corpus_lower = corpus.lower()

    # Gana la causal que el texto nombra PRIMERO, no la primera del catálogo: «proveedor único … para evitar el
    # desabastecimiento» invoca el proveedor único (y no necesita el acto que declara un desabastecimiento).
    hallazgos = []
    for orden, (clave, letra, pattern, descripcion, requiere_resol) in enumerate(_CAUSALES):
        m = _re.search(pattern, corpus_lower, _re.IGNORECASE)
        if m:
            hallazgos.append((m.start(), orden, m, clave, letra, descripcion, requiere_resol))
    if hallazgos:
        _, _, m, clave, letra, descripcion, requiere_resol = min(hallazgos, key=lambda h: (h[0], h[1]))
        if m:
            return {
                "causal_clave": clave,
                "causal_letra": letra,
                "descripcion": descripcion,
                "evidencia_text": corpus[max(0, m.start()-50):m.end()+100],
                "requiere_acto_resolutivo": requiere_resol,
                "match": True,
            }
    return {"causal_letra": None, "descripcion": None, "evidencia_text": None,
            "requiere_acto_resolutivo": False, "match": False}

_ACTO_PATTERNS = [
    ("D.S.",    r"((?:D\.\s?S\.|Decreto\s+Supremo)\s*N[°º\.\s]*\s*\d{1,4}\s*-\s*\d{4}(?:-[A-Z]+)?)", "Decreto Supremo"),
    ("D.U.",    r"((?:D\.\s?U\.|Decreto\s+de\s+Urgencia)\s*N[°º\.\s]*\s*\d{1,4}\s*-\s*\d{4})", "Decreto de Urgencia"),
    ("RM",      r"((?:R\.\s?M\.|Resoluci[oó]n\s+Ministerial)\s*N[°º\.\s]*\s*\d{1,5}\s*-\s*\d{4}(?:-[\w/]+)?)", "Resolución Ministerial"),
    ("RVM",     r"((?:R\.\s?V\.\s?M\.|Resoluci[oó]n\s+Viceministerial)\s*N[°º\.\s]*\s*\d{1,5}\s*-\s*\d{4}(?:-[\w/]+)?)", "Resolución Viceministerial"),
    ("RJ",      r"((?:R\.\s?J\.|Resoluci[oó]n\s+Jefatural)\s*N[°º\.\s]*\s*\d{1,5}\s*-\s*\d{4}(?:-[\w/]+)?)", "Resolución Jefatural"),
    ("RA",      r"((?:R\.\s?A\.|Resoluci[oó]n\s+de\s+Alcald[ií]a|Resoluci[oó]n\s+Ejecutiva\s+Regional|Resoluci[oó]n\s+Gerencial(?:\s+General)?|Resoluci[oó]n\s+Directoral|Resoluci[oó]n\s+de\s+Gerencia\s+General)\s*N[°º\.\s]*\s*\d{1,5}\s*-\s*\d{4}(?:-[\w/]+)?)", "Resolución de la entidad"),
    ("ACUERDO", r"(Acuerdo\s+(?:Regional|Municipal|de\s+Concejo|de\s+Consejo\s+Regional)\s+N[°º\.\s]*\s*\d{1,5}\s*-\s*\d{4}(?:-[\w/]+)?)", "Acuerdo Regional/Municipal"),
    ("ORD",     r"(Ordenanza\s+(?:Regional|Municipal)\s+N[°º\.\s]*\s*\d{1,5}\s*-\s*\d{4}(?:-[\w/]+)?)", "Ordenanza"),
]
_FECHA_CERCANA_RE = r"(\d{1,2}\s+de\s+\w+\s+(?:del?\s+)?\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4})"


def _buscar_acto_resolutivo(state: dict) -> dict:
    """Busca el acto resolutivo (D.S., D.U., R.M., acuerdo regional, resolución de
    alcaldía/gerencia, ordenanza) que sustenta una causal de Contratación Directa.

    Orden de búsqueda (hallazgo #5 de la auditoría):
      1. TEXTO COMPLETO de los documentos (`documentos_texto` por sha256 en state) →
         devuelve `documento_sha256`, `pagina` y `cita` literal.
      2. Bloques tipados del parser: `estudio_mercado.causal_articulo/causal_texto`,
         `sustento_directa.acto_aprobatorio` (bloque del perfil OTROS).
      3. Resúmenes del parser (fundamento_legal, motivos, requerimientos) — fuente
         DÉBIL: si SOLO hubo resúmenes y no se encontró, `solo_resumenes=true` y la
         regla degrada la bandera a MEDIA con `requiere_verificacion`.

    Retorna {encontrado, tipo, numero, fecha_proxima, fragmento/cita, fuente,
             documento_sha256, pagina, texto_completo_disponible, solo_resumenes}.
    """
    import re as _re

    # 1) Texto completo por sha256 (tabla documentos_texto del WS D)
    textos = _verify.textos_documentos(state)
    texto_completo = bool(textos)
    for _tipo, pattern, descripcion in _ACTO_PATTERNS:
        hit = _verify.buscar_en_documentos(state, _re.compile(pattern, _re.IGNORECASE))
        if hit:
            fecha_m = _re.search(_FECHA_CERCANA_RE, hit["cita"])
            return {
                "encontrado": True, "tipo": descripcion, "numero": hit["match"],
                "fecha_proxima": fecha_m.group(1) if fecha_m else None,
                "fragmento": hit["cita"], "cita": hit["cita"],
                "fuente": "documentos_texto", "documento_sha256": hit["sha256"],
                "pagina": hit["pagina"], "texto_completo_disponible": True,
                "solo_resumenes": False,
            }

    # 2) Bloques tipados del parser (estudio de mercado / sustento de la directa)
    raw = state.get("parser_raw_consolidated") or {}
    doc_analysis = state.get("document_analysis")
    if isinstance(doc_analysis, str):
        doc_analysis = _safe_parse_json(doc_analysis) or {}
    em = _safe_parse_json(state.get("estudio_mercado")) or {}
    tipados: list[str] = []
    for src in (em, (raw.get("sustento_directa") if isinstance(raw, dict) else None) or {},
                (doc_analysis or {}).get("sustento_directa") or {}):
        if not isinstance(src, dict):
            continue
        for k in ("causal_articulo", "causal_texto", "acto_aprobatorio", "informe_tecnico",
                  "informe_legal", "acto_resolutivo"):
            v = src.get(k)
            if isinstance(v, str):
                tipados.append(v)
            elif isinstance(v, dict):
                tipados.append(" ".join(str(x) for x in v.values() if x))
    corpus_tipado = "\n".join(tipados)
    # El acto que el parser ya extrajo por campos (tipo, número, fecha): «Resolución de Alcaldía» + «045-2026-MDSJ» no
    # trae el «N°» que piden los patrones y se daba por inexistente.
    for src in ((raw.get("sustento_directa") if isinstance(raw, dict) else None) or {},
                (doc_analysis or {}).get("sustento_directa") or {}):
        if not isinstance(src, dict):
            continue
        for k in ("acto_aprobatorio", "acto_resolutivo"):
            v = src.get(k)
            if isinstance(v, dict) and str(v.get("numero") or "").strip():
                cita = " ".join(str(v.get(x)) for x in ("tipo", "numero", "fecha") if v.get(x))[:240]
                return {"encontrado": True, "tipo": str(v.get("tipo") or "Acto aprobatorio"),
                        "numero": str(v["numero"]).strip(), "fecha_proxima": v.get("fecha") or None,
                        "fragmento": cita, "cita": cita,
                        "fuente": "parser_bloque_tipado", "documento_sha256": None, "pagina": v.get("pagina"),
                        "texto_completo_disponible": texto_completo, "solo_resumenes": not texto_completo}
    for _tipo, pattern, descripcion in _ACTO_PATTERNS:
        m = _re.search(pattern, corpus_tipado, _re.IGNORECASE)
        if m:
            frag = corpus_tipado[max(0, m.start() - 100):m.end() + 200]
            fecha_m = _re.search(_FECHA_CERCANA_RE, frag)
            return {"encontrado": True, "tipo": descripcion, "numero": m.group(1),
                    "fecha_proxima": fecha_m.group(1) if fecha_m else None,
                    "fragmento": frag.strip()[:400], "cita": frag.strip()[:240],
                    "fuente": "parser_bloque_tipado", "documento_sha256": None, "pagina": None,
                    "texto_completo_disponible": texto_completo, "solo_resumenes": not texto_completo}

    # 3) Resúmenes del parser (fuente débil)
    texts: list[str] = []
    for src in (raw if isinstance(raw, dict) else {}, doc_analysis or {}):
        for k in ("fundamento_legal", "motivos_adjudicacion", "lugar_fecha_acta",
                  "raw_text_excerpt", "considerandos"):
            v = src.get(k)
            if isinstance(v, str):
                texts.append(v)
            elif isinstance(v, list):
                texts.extend(str(x) for x in v)
        for it in (src.get("items") or src.get("items_consolidados") or []):
            if isinstance(it, dict):
                for k in ("requerimiento_tecnico_detallado", "texto_literal"):
                    v = it.get(k)
                    if isinstance(v, str):
                        texts.append(v)
    corpus = "\n".join(texts)
    if not corpus.strip() and not texto_completo and not corpus_tipado.strip():
        return {"encontrado": False, "motivo": "documentos sin texto parseable",
                "texto_completo_disponible": False, "solo_resumenes": True}
    for _tipo, pattern, descripcion in _ACTO_PATTERNS:
        m = _re.search(pattern, corpus, _re.IGNORECASE)
        if m:
            frag = corpus[max(0, m.start() - 100):m.end() + 200]
            fecha_m = _re.search(_FECHA_CERCANA_RE, frag)
            return {"encontrado": True, "tipo": descripcion, "numero": m.group(1),
                    "fecha_proxima": fecha_m.group(1) if fecha_m else None,
                    "fragmento": frag.strip()[:400], "cita": frag.strip()[:240],
                    "fuente": "parser_resumen", "documento_sha256": None, "pagina": None,
                    "texto_completo_disponible": texto_completo, "solo_resumenes": not texto_completo}
    return {"encontrado": False,
            "motivo": ("ningún acto resolutivo identificado en el texto completo de los documentos"
                       if texto_completo else
                       "ningún acto resolutivo en los resúmenes del parser (sin texto completo disponible)"),
            "texto_completo_disponible": texto_completo, "solo_resumenes": not texto_completo,
            "documentos_revisados": len(textos)}

def check_directa_fundamento_rule(ocid: str, tool_context: ToolContext,
                                  reglas_activas: frozenset[str] | None = None,
                                  topes_uit: dict | None = None) -> dict:
    """Si el tipo de proceso es Contratación Directa, verifica que la causal
    legal del Art. 27 TUO Ley 30225 / Art. 55 Ley 32069 esté:
      1. IDENTIFICADA (cuál de las letras a/b/c/.../k se invoca).
      2. ACREDITADA con acto resolutivo (D.S., D.U., resolución, acuerdo) si
         la causal lo exige (emergencia, desabastecimiento).

    Lee state['document_analysis'].fundamento_legal + parser_raw_consolidated.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con causal_invocada, acto_resolutivo, triggered, severidad,
        evidencia, norma.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("directa_sin_fundamento", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT tipo_proceso, objeto FROM convocatorias WHERE ocid=%s", (ocid,))
        row = cur.fetchone()
        state = tool_context.state
        # `tipo_proceso` está NULL en casi toda la tabla (la ingesta llena `modalidad`): el procedimiento sale del
        # OCDS del state, como en las demás reglas (`_procurement_method`); antes la regla terminaba acá sin evaluar.
        tipo = _procurement_method(state, (row[0] if row else None))
        if not tipo or tipo.strip().lower() == "desconocido":
            return {"regla": "directa_sin_fundamento", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin tipo de procedimiento en la base ni en el OCDS"}
        _ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
        objeto = ((row[1] if row else None) or (_ocds.get("tender") or {}).get("description") or "")
        if "DIRECTA" not in (tipo or "").upper() and "EXONERA" not in (tipo or "").upper():
            return {"regla": "directa_sin_fundamento", "triggered": False,
                    "motivo": "no es contratación directa"}

        # 1. Extraer fundamento_legal del document_analysis
        doc = _safe_parse_json(state.get("document_analysis"))
        fund = (doc or {}).get("fundamento_legal") or []
        # También considerar el parser_raw_consolidated como fallback
        raw = state.get("parser_raw_consolidated") or {}
        if not fund and raw.get("fundamento_legal"):
            fund = raw["fundamento_legal"]

        # 2. Identificar causal específica: en las normas citadas y en lo que el expediente dice de la causal
        textos_causal = _textos_causal(state)
        causal = _identificar_causal_directa(textos_causal + [str(f) for f in fund], objeto)
        # Mantener compatibilidad con la heurística vieja: si el regex no
        # encontró una causal pero el texto menciona keywords legales,
        # consideramos que SÍ hay una causal vaga (no triggera bandera).
        tiene_keyword_legal = any(
            "55" in str(f) or "EMERGENCIA" in str(f).upper() or
            "EXONERA" in str(f).upper() or "D.S." in str(f) or
            "DECRETO SUPREMO" in str(f).upper()
            for f in list(fund) + textos_causal
        )

        # 3. Buscar acto resolutivo si la causal lo requiere
        acto = None
        if causal["match"] and causal["requiere_acto_resolutivo"]:
            acto = _buscar_acto_resolutivo(state)

        # Persistir hallazgos en state para que el dictamen los cite
        state["causal_directa_invocada"] = causal
        if acto is not None:
            state["acto_resolutivo_directa"] = acto

        result = {
            "regla": "directa_sin_fundamento",
            "tipo_proceso": tipo,
            "fundamento_legal_documentado": fund,
            "causal_invocada": causal,
            "acto_resolutivo": acto,
            "triggered": False,
        }

        # Decidir si triggea bandera y con qué severidad
        if not causal["match"] and not tiene_keyword_legal:
            # ¿De verdad no hay causal, o no se pudo LEER el documento? Si no hubo análisis del documento ni texto del
            # parser, la ausencia de causal es falta de extracción (PDF escaneado o no publicado), no una irregularidad:
            # MEDIA con verificación manual, no ALTA (auditoría 2026-10-23: antes era alta sistemática sobre ilegibles).
            hubo_texto = _se_leyo_algo(state, doc, raw, textos_causal)
            result.update({
                "triggered": True,
                "severidad": "alta" if hubo_texto else "media",
                "requiere_verificacion": not hubo_texto,
                "evidencia": (
                    f"Tipo de proceso '{tipo}' sin causal legal claramente identificable del Art. 27 TUO Ley 30225 / "
                    f"Art. 55 Ley 32069. "
                    + (f"Fundamento extraído del documento: {fund if fund else 'ninguno'}."
                       if hubo_texto else
                       "No se pudo leer el texto de los documentos (posible PDF escaneado o no publicado): requiere "
                       "verificación manual del expediente.")
                ),
                "norma": "Art. 27 TUO Ley 30225 / Art. 55.1 Ley 32069 — causales "
                         "de selección no competitiva deben estar acreditadas",
                "fuente_url": proceso_oece(ocid),
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        elif causal["match"] and causal["requiere_acto_resolutivo"] and acto and not acto.get("encontrado"):
            # Identificamos causal de emergencia/desabastecimiento pero NO se encuentra
            # el acto resolutivo que la declara. ALTA solo si se revisó el TEXTO COMPLETO
            # de los documentos; si solo hubo resúmenes del parser → MEDIA con
            # `requiere_verificacion` (hallazgo #5: el acto puede estar en el PDF y no
            # en el resumen).
            solo_resumenes = bool(acto.get("solo_resumenes"))
            result.update({
                "triggered": True,
                "severidad": "media" if solo_resumenes else "alta",
                "requiere_verificacion": solo_resumenes,
                "regla": "directa_emergencia_sin_acto_resolutivo",
                "evidencia": (
                    f"La Contratación Directa invocó causal '{causal['descripcion']}', "
                    f"pero no se identifica "
                    + ("en el texto completo de los documentos publicados "
                       if not solo_resumenes else
                       "en los resúmenes disponibles de los documentos (texto completo no disponible: "
                       "requiere verificación manual del expediente) ")
                    + "el acto resolutivo que declara la situación (D.S./D.U./Resolución/Acuerdo "
                    "Regional). Sin acto resolutivo acreditable, la causal carece de sustento legal."
                ),
                "norma": "Art. 27.1 lit. b) y c) TUO Ley 30225 / Art. 55.1 Ley 32069 — la emergencia o el "
                         "desabastecimiento deben estar acreditados por el acto que los declara",
                "fuente_url": proceso_oece(ocid),
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        elif not causal["match"] and tiene_keyword_legal:
            # Keywords legales presentes pero sin causal específica → bandera MEDIA
            result.update({
                "triggered": True,
                "severidad": "media",
                "regla": "directa_causal_imprecisa",
                "evidencia": (
                    f"Tipo de proceso '{tipo}' menciona referencias legales pero no "
                    f"identifica la causal específica del Art. 27/55. Fundamento "
                    f"detectado: {fund}"
                ),
                "norma": "Art. 27 TUO Ley 30225 / Art. 55.1 Ley 32069",
                "fuente_url": proceso_oece(ocid),
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

def check_inconsistencia_doc_vs_ocds_rule(ocid: str, tool_context: ToolContext,
                                          reglas_activas: frozenset[str] | None = None,
                                          topes_uit: dict | None = None) -> dict:
    """C12 — Inconsistencia documento ↔ OCDS: el monto/items extraídos del PDF
    por el `document_parser_agent` difieren del OCDS publicado por OECE. Indica:
    (a) manipulación del acta, (b) error de publicación, o (c) el OCDS no
    refleja la realidad documental.

    Norma: principio de transparencia (Art. 2 TUO) + Art. 64 — publicidad de actos.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("inconsistencia_doc_vs_ocds", reglas)
    if om:
        return om
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    doc = _safe_parse_json(state.get("document_analysis")) or {}
    if not ocds or not doc:
        return {"regla": "inconsistencia_doc_vs_ocds", "triggered": False,
                "motivo": "sin datos suficientes (OCDS o document_analysis vacío)"}

    tender = ocds.get("tender") or {}
    val = tender.get("value") or {}
    cuantia_ocds = float(val.get("amount") or 0)
    cuantia_doc = float(doc.get("cuantia_total") or 0)

    n_items_ocds = len(tender.get("items") or [])
    items_doc = doc.get("items_consolidados") or []
    n_items_doc = len(items_doc)
    # Solo ÍTEMS RAÍZ para comparar conteos: el parser desglosa sub-ítems
    # (`padre_ocds_item` ≠ null, `subitems`, `es_subitem`) que el OCDS nunca lista;
    # compararlos disparaba "items_count_distinto" por diseño (auditoría §2.1).
    items_raiz = [it for it in items_doc if isinstance(it, dict)
                  and not it.get("padre_ocds_item") and not it.get("es_subitem")
                  and not it.get("padre")]
    n_items_raiz = len(items_raiz)

    inconsistencias = []
    # CUANTÍA (lote 1 · T2): `cuantia_total` del expediente suele ser el monto del acta /
    # contrato (adjudicado), no el referencial. Solo hay discrepancia si NO coincide (±0.5 %)
    # con `tender.value` NI con ningún `awards[].value` / `contracts[].value` (ni sus sumas).
    # En Subasta Inversa nunca se compara contra el referencial: la rebaja por lances es el
    # resultado esperado (1225058, 1225256, 1225416, 1225450 eran falsos positivos).
    montos = _montos_ocds(ocds)
    tipo_proc = _procurement_method(state)
    es_sie = _es_subasta(tipo_proc)
    candidatos = [("awards", a) for a in montos["awards"]] + [("contracts", c) for c in montos["contracts"]]
    if montos["suma_awards"]:
        candidatos.append(("suma_awards", montos["suma_awards"]))
    if montos["suma_contracts"]:
        candidatos.append(("suma_contracts", montos["suma_contracts"]))
    if cuantia_ocds > 0 and not es_sie:
        candidatos.append(("tender.value", cuantia_ocds))
    coincide_con = None
    if cuantia_doc > 0:
        for nombre, m in candidatos:
            if m and abs(m - cuantia_doc) / max(m, 1) * 100 <= 0.5:
                coincide_con = nombre
                break
    result_cuantia = {"cuantia_documento_coincide_con": coincide_con,
                      "cuantia_documento_es_adjudicada": coincide_con in ("awards", "contracts", "suma_awards", "suma_contracts")}
    if cuantia_doc > 0 and coincide_con is None and candidatos:
        base_nombre, base = ("awards/contracts", montos["suma_contracts"] or montos["suma_awards"]) \
            if (montos["suma_contracts"] or montos["suma_awards"]) else ("tender.value", cuantia_ocds)
        # Un monto del documento que es la cuota o el honorario mensual (S/ 15 000 al mes por 3 meses = S/ 45 000,
        # 1228800) no es una discrepancia: el total es un múltiplo entero exacto (2 a 36).
        _k = (base / cuantia_doc) if (base and cuantia_doc) else 0
        _cuota = 2 <= round(_k) <= 36 and abs(_k - round(_k)) <= 0.005 * round(_k)
        if base and not _cuota:
            diff_pct = abs(base - cuantia_doc) / max(base, 1) * 100
            if diff_pct > 5:
                inconsistencias.append({
                    "tipo": "cuantia_distinta",
                    "ocds": base, "ocds_base": base_nombre, "documento": cuantia_doc,
                    "diff_pct": round(diff_pct, 1),
                })
    # Conteo de ítems: el OCDS suele publicar el lote como 1 ítem mientras las bases desglosan
    # varios (1225416: 1 vs 2). Es informativo, nunca una señal (lote 1 · T2).
    nota_items = None
    if n_items_ocds > 0 and n_items_raiz > 0 and n_items_ocds != n_items_raiz:
        nota_items = {"tipo": "items_count_distinto", "n_items_ocds": n_items_ocds,
                      "n_items_documento": n_items_raiz, "n_items_documento_con_subitems": n_items_doc}

    # INCONGRUENCIA OBJETO ↔ DOCUMENTO: compara el PRODUCTO del objeto convocado
    # (la parte antes de META/PROYECTO/CUI) contra lo que el parser extrajo de los
    # documentos (descripciones de ítems). CERO solape de tokens de producto = el
    # Bases adjunto NO corresponde al objeto (Bases mal adjuntado, plantilla reusada,
    # expediente incongruente). NO depende de items OCDS (que suelen venir vacíos).
    # Detecta el caso 1221246: objeto "BALDOSAS DE FIBRA MINERAL" con Bases de laptops/PCs.
    import re as _re_inc
    _STOP = {"adquisicion", "adquisición", "servicio", "servicios", "contratacion",
             "contratación", "para", "por", "con", "del", "las", "los", "meta", "proyecto",
             "mejoramiento", "mantenimiento", "bien", "bienes", "obra", "obras", "general",
             "generales", "sede", "central", "unidad", "mediante", "modalidad", "proceso",
             "seleccion", "selección", "compra", "suministro", "item", "items", "equipo", "equipos"}

    def _tok_prod(txt):
        txt = _re_inc.sub(r"[^a-záéíóúñ0-9 ]", " ", (txt or "").lower())
        # singular simple (laptops→laptop, equipos→equipo) para no marcar incongruencia
        # por número gramatical.
        return {(w[:-1] if w.endswith("s") and len(w) > 4 else w)
                for w in txt.split() if len(w) > 3 and w not in _STOP}
    # `tender.description` es el PRODUCTO ("ADQUISICIÓN DE BALDOSAS…"); `tender.title`
    # suele ser el CÓDIGO del proceso ("COMPRE-COMPRE-73-…") → preferir description.
    objeto = tender.get("description") or doc.get("objeto") or tender.get("title") or ""
    objeto_prod = _re_inc.split(r"\b(meta|proyecto|con cui|cui\s*n)\b", objeto, maxsplit=1, flags=_re_inc.I)[0]
    doc_descs = [str(it.get("descripcion_corta") or "") for it in items_doc if isinstance(it, dict)]
    doc_items_txt = " ".join(doc_descs)
    # Si los ítems del doc son PLACEHOLDERS genéricos (parser no extrajo el producto
    # real: 'BIEN/SERVICIO PRINCIPAL 1', 'COMPONENTE A', 'Bien o servicio del ítem X'),
    # NO es una incongruencia de rubro → no flaggear (evita falso positivo).
    _gen = _re_inc.compile(r"bien\s*/?\s*servicio|bien o servicio|componente\s+[ab]\b|principal\s*\d|<.*>|gen[eé]ric", _re_inc.I)
    doc_es_generico = bool(doc_descs) and all(_gen.search(d) for d in doc_descs if d)
    # Lote 1 · T3: comparación por raíces + hiperónimos (`coincide_objeto`) sobre el objeto
    # COMPLETO y los ítems del OCDS + del parser; el resumen ejecutivo sirve de respaldo.
    # Si el juez `coherencia_objeto_items` ya dijo "coherente", no se emite (1225062/1225266).
    # Solo lo que dice el EXPEDIENTE (los ítems del OCDS repiten el objeto y siempre coincidirían).
    _det_obj = coincide_objeto_detalle(objeto, list(doc_descs), doc.get("resumen_ejecutivo"))
    result_objeto = {"coincide_objeto": _det_obj.get("coincide"), "coincide_objeto_motivo": _det_obj.get("motivo")}
    if (doc_descs and not doc_es_generico and not _det_obj.get("coincide")
            and not _juez_coherencia_dice_coherente(state)):
        inconsistencias.append({
            "tipo": "objeto_no_corresponde_documento",
            "objeto_producto": objeto_prod.strip()[:90],
            "doc_items": doc_items_txt[:90],
            "doc_resumen": (doc.get("resumen_ejecutivo") or "")[:120],
            "tokens_objeto": _det_obj.get("tokens_objeto"),
        })

    # EXTRACCIÓN FALLIDA: el parser corrió sobre un documento pero NO extrajo el
    # producto real. Dos variantes: (a) produjo ítems pero TODOS vacíos o genéricos
    # ('BIEN/SERVICIO PRINCIPAL 1', 'Bien o servicio del ítem X'); (b) NO produjo
    # NINGÚN ítem (items_consolidados == []) pese a haber procesado el documento
    # (resumen/tipo/requerimiento presentes). Distinto de la incongruencia (rubro
    # distinto): acá no hay rubro, hay placeholders o vacío → el análisis del
    # documento no es confiable (caso 1221246: Bases ilegible/escaneada/plantilla).
    _descs_reales = [d for d in doc_descs if d and d.strip()]
    _doc_procesado = (bool((doc.get("resumen_ejecutivo") or "").strip())
                      or bool(doc.get("tipo_documento"))
                      or doc.get("requerimiento_disponible") is not None)
    _items_inservibles = bool(items_doc) and (not _descs_reales or doc_es_generico)
    # Lote 1: los ítems de OC/contrato viven aparte (`items_contratados`) y los postores en `postores`;
    # si el parser extrajo cualquiera de ellos, el expediente SÍ se leyó (no es "extracción fallida").
    _raw_pr = _safe_parse_json(state.get("parser_raw_consolidated")) or {}
    _hay_otra_extraccion = bool(_raw_pr.get("items_contratados") or _raw_pr.get("postores") or _raw_pr.get("ofertas")
                                or doc.get("items_contratados") or doc.get("postores"))
    _sin_items_pese_a_doc = (n_items_doc == 0 and _doc_procesado and not _hay_otra_extraccion)
    if _items_inservibles or _sin_items_pese_a_doc:
        inconsistencias.append({
            "tipo": "extraccion_documento_fallida",
            "n_items": n_items_doc,
            "doc_resumen": (doc.get("resumen_ejecutivo") or "")[:120],
        })

    # EL ARCHIVO PUBLICADO COMO CONTRATO ES DE OTRA COMPRA: el lector del contrato (lecturas_documentos.contrato) ya
    # dice de quién es, de cuándo y si es un contrato. La regla sólo comparaba cuantías y dejaba pasar una orden de
    # compra de 2025 a otro proveedor colgada en un proceso de 2026 (prueba de oro de directas: 1226155, 1232065,
    # 1230657). Hacen falta DOS indicios independientes: uno solo puede ser un error de lectura.
    try:
        _lc = (state.get("lecturas_documentos") or {}).get("contrato") or {}
        _lc = _lc.get("salida") if isinstance(_lc, dict) and isinstance(_lc.get("salida"), dict) else _lc
        if isinstance(_lc, dict) and _lc:
            from datetime import date as _date
            from tools.compliance_rules._base import ganadores_evaluables
            _gan = ganadores_evaluables(ocid, state) or []
            _rucs = {str(g.get("ruc")) for g in _gan if g.get("ruc")}
            _ruc_doc = "".join(ch for ch in str((_lc.get("contratista") or {}).get("ruc") or "") if ch.isdigit())
            _integrantes = {str(x) for x in ((_lc.get("contratista") or {}).get("integrantes_ruc") or [])}
            indicios = []
            if len(_ruc_doc) == 11 and _rucs and _ruc_doc not in _rucs and not (_integrantes & _rucs):
                indicios.append("está a nombre de otro proveedor, que no es el adjudicado")

            def _f(v):
                try:
                    return _date.fromisoformat(str(v)[:10])
                except (TypeError, ValueError):
                    return None
            _f_doc = _f(_lc.get("fecha_suscripcion")) or _f(_lc.get("fecha_inicio"))
            _f_bp = min((d for d in (_f(g.get("fecha_buena_pro")) for g in _gan) if d), default=None)
            if _f_doc and _f_bp and (_f_bp - _f_doc).days > 30:
                indicios.append(f"tiene fecha {_f_doc.isoformat()}, anterior a la buena pro del {_f_bp.isoformat()}")
            if _lc.get("es_contrato") is False:
                indicios.append("no es un contrato ni una orden de este proceso")
            _mon_doc = str(_lc.get("moneda") or "").upper()
            _mon_reg = str(val.get("currency") or "PEN").upper()
            if ("US" in _mon_doc or "DOL" in _mon_doc) and _mon_reg in ("PEN", ""):
                indicios.append("está en dólares y el registro en soles")
            if len(indicios) >= 2:
                inconsistencias.append({"tipo": "contrato_publicado_es_otro_documento", "indicios": indicios,
                                        "objeto_documento": str(_lc.get("objeto") or "")[:140]})
    except Exception:  # noqa: BLE001 — sin lectura del contrato no hay nada que comparar
        pass

    result = {
        "regla": "inconsistencia_doc_vs_ocds",
        "cuantia_ocds": cuantia_ocds,
        "cuantia_documento": cuantia_doc,
        "montos_ocds": {"awards": montos["awards"], "contracts": montos["contracts"]},
        "tipo_proceso": tipo_proc or None,
        "n_items_ocds": n_items_ocds,
        "n_items_documento": n_items_doc,
        "inconsistencias": inconsistencias,
        "nota_items": nota_items,
        "triggered": len(inconsistencias) > 0,
        **result_cuantia, **result_objeto,
    }
    norma = _norma_state(state)
    if inconsistencias:
        # Priorizar la incongruencia de OBJETO (la más grave) si está presente.
        _prio = ["objeto_no_corresponde_documento", "contrato_publicado_es_otro_documento", "extraccion_documento_fallida",
                 "cuantia_distinta", "items_count_distinto"]
        primera = min(inconsistencias,
                      key=lambda i: _prio.index(i["tipo"]) if i["tipo"] in _prio else 99)
        severidad = "media"
        if primera["tipo"] == "objeto_no_corresponde_documento":
            severidad = "alta"
            result["regla"] = "objeto_no_corresponde_documento"
            ev = (f"El objeto convocado ('{primera.get('objeto_producto')}') NO corresponde al "
                  f"contenido de los documentos del expediente, que describen un rubro distinto "
                  f"('{primera.get('doc_items') or primera.get('doc_resumen')}'). Posible Bases mal "
                  f"adjuntado, plantilla reusada o expediente incongruente — la evaluación técnica "
                  f"y de precio del proceso queda comprometida.")
        elif primera["tipo"] == "contrato_publicado_es_otro_documento":
            _obj = primera.get("objeto_documento")
            ev = ("El archivo publicado como contrato de este proceso es de otra compra: "
                  + "; ".join(primera.get("indicios") or []) + "."
                  + (f" Lo que describe: «{_obj}»." if _obj else "")
                  + " El contrato real de este proceso no está publicado: no se puede comprobar qué se firmó.")
        elif primera["tipo"] == "extraccion_documento_fallida":
            result["regla"] = "extraccion_documento_fallida"
            _ni = primera.get("n_items") or 0
            _det = (f"{_ni} ítem(s) extraídos, todos vacíos o genéricos" if _ni
                    else "no se extrajo ningún ítem usable del documento procesado")
            ev = (f"El parser no logró extraer el detalle real de los documentos del expediente "
                  f"({_det}). El Bases podría estar mal adjuntado, ser una plantilla o estar "
                  f"ilegible/escaneado → el análisis técnico y de precio de este proceso NO es "
                  f"confiable y debe revisarse manualmente.")
        elif primera["tipo"] == "cuantia_distinta":
            _base_lbl = ("monto adjudicado/contratado" if primera.get("ocds_base") == "awards/contracts"
                         else "valor referencial")
            ev = (f"Discrepancia de cuantía: el OCDS publica S/ {(primera.get('ocds') or 0):,.2f} "
                  f"({_base_lbl}) pero el documento del expediente indica S/ {(primera.get('documento') or 0):,.2f} "
                  f"({primera.get('diff_pct')} % de diferencia) y no coincide con ningún monto adjudicado ni "
                  f"contratado del registro. Requiere verificación manual (acta parcial, ítem desierto o "
                  f"publicación desactualizada).")
        else:
            ev = (f"OCDS lista {primera['n_items_ocds']} ítems pero el documento "
                  f"tiene {primera['n_items_documento']} ítems raíz. Discrepancia entre el registro OCDS y "
                  f"el expediente documental; requiere verificación manual.")
        result.update({
            "severidad": severidad,
            "evidencia": ev,
            "norma": norma["transparencia"],
            "fuente_url": None,
        })
        state.setdefault("pending_flags", []).append(result)
    return result
check_directa_fundamento_rule_tool = _as_tool(check_directa_fundamento_rule)
check_inconsistencia_doc_vs_ocds_rule_tool = _as_tool(check_inconsistencia_doc_vs_ocds_rule)
