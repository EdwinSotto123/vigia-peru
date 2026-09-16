"""Tools del dominio: documentos.

Dos caminos conviven:
  · `parse_documentos_lote` / `parse_documentos_seleccionados` (WS D, 2026-09-15): selección
    determinista (tools/doc_select.py), OCR una sola vez por sha256 (tabla documentos_texto,
    páginas ⟦p.N⟧), extracción con schema base + bloque del perfil y evidencia verificable.
  · `list_documents` / `parse_document_pdf` (legacy, tool del LlmAgent): misma expansión de
    contenedores sin topes y mismo schema, pero por URL y sin caché entre corridas.
"""

from tools._core import *  # noqa: F401,F403
from tools._core import downloader_base


def _norm_txt(s: str) -> str:
    """MAYÚSCULAS sin tildes, espacios colapsados — para comparar descripciones."""
    import unicodedata
    s = " ".join((s or "").strip().upper().split())
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


_TIPOS_ADJUDICACION = ("acta", "buena_pro", "buena pro", "otorgamiento", "adjudic",
                       "evaluac", "calificac", "contrato", "orden de compra",
                       "orden_de_compra", "propuesta")


def _es_doc_de_adjudicacion(tipo: str) -> bool:
    """True si el `tipo_documento_detectado` corresponde a la etapa de ADJUDICACIÓN
    o CONTRATO (acta de buena pro, cuadro de evaluación, contrato/orden de compra).
    Solo esos documentos contienen comité, motivos de adjudicación y acta. Un
    Bases/TDR/EETT/Resumen es PRE-adjudicación: no existen ahí, y si el LLM los
    'rellenó', son inventados → se descartan (fix determinista, sin blocklist de
    nombres)."""
    t = (tipo or "").lower()
    return any(k in t for k in _TIPOS_ADJUDICACION)


# ── Etapa del documento (lote 1 · T7) ─────────────────────────────────────────────────
# Un documento es de REQUERIMIENTO (bases, integradas, TDR, EETT, expediente, resumen
# ejecutivo, informe de sustento, absolución) o de CONTRATACIÓN (propuesta, acta, cuadro,
# contrato, orden de compra/servicio, adenda, garantía, resolución de ejecución). Solo los
# primeros alimentan `items_consolidados` (precio REFERENCIAL, marca EXIGIDA); los ítems de
# los segundos van a `items_contratados` (precio CONTRATADO/OFERTADO, marca OFERTADA) y se
# cruzan por clave normalizada. Antes la OC con `contiene_requerimiento=true` entraba como
# fuente de requerimiento y su marca se fundía en el ítem de las bases ("las bases exigen la
# marca SOMOS DEL NORTE": inventado).
_TIPOS_REQUERIMIENTO_KW = ("bases", "termino", "referencia", "especificacion", "eett", "tdr", "expediente",
                           "resumen", "sustento", "ficha", "requerimiento", "absolucion", "consulta", "pliego",
                           "estudio_mercado", "estudio de mercado", "informe_tecnico", "informe tecnico")
_TIPOS_CONTRATACION_KW = ("contrato", "orden_de_compra", "orden_de_servicio", "orden de compra", "orden de servicio",
                          "acta", "buena_pro", "buena pro", "cuadro", "evaluac", "calificac", "propuesta", "oferta",
                          "adenda", "garantia", "fianza", "conformidad", "resolucion", "adjudic", "otorgamiento",
                          "ampliacion", "penalidad", "valorizacion", "presentacion")
_CATS_REQUERIMIENTO = ("bases_integradas", "bases", "tdr", "eett", "expediente_tecnico", "presupuesto",
                       "resumen_ejecutivo", "informe", "absolucion", "cotizaciones")
_CATS_CONTRATACION = ("acta", "cuadro_comparativo", "propuesta", "contrato", "orden", "adenda", "valorizaciones",
                      "resolucion")


def _es_doc_contratacion(tipo_detectado: str | None, doc: dict | None = None) -> bool:
    """True si el documento pertenece a la etapa de contratación/adjudicación (sus ítems
    NO son requerimiento). Decide por `tipo_documento_detectado`; si el LLM no lo detectó
    ('otro'/None), por título + documentType del DocRef (tools/doc_select)."""
    t = _norm_txt(tipo_detectado or "").lower().replace("_", " ")
    if t and t not in ("otro", "null", "none", "desconocido"):
        if any(k.replace("_", " ") in t for k in _TIPOS_REQUERIMIENTO_KW):
            return False
        if any(k.replace("_", " ") in t for k in _TIPOS_CONTRATACION_KW):
            return True
    if doc:
        try:
            from tools.doc_select import categorias_de
            cats = categorias_de(doc.get("titulo"), doc.get("tipo"))
        except Exception:
            cats = []
        if any(c in cats for c in _CATS_REQUERIMIENTO):
            return False
        if any(c in cats for c in _CATS_CONTRATACION):
            return True
    return False


def _es_doc_resultado(tipo_detectado: str | None, doc: dict | None = None) -> bool:
    """Documento que FIJA el resultado de la selección (acta de buena pro, cuadro de evaluación,
    contrato, orden): sus montos/ganador/puntajes mandan al fusionar postores. El reporte de
    presentación de propuestas (solo quién ofertó) NO lo es."""
    t = _norm_txt(tipo_detectado or "").lower().replace("_", " ")
    if "propuesta" in t or "presentacion" in t:
        return False
    if t and _es_doc_de_adjudicacion(t):
        return True
    if doc and not t:
        titulo = _norm_txt(doc.get("titulo") or "").lower()
        if "propuesta" in titulo or "presentacion" in titulo:
            return False
        return any(k in titulo for k in ("acta", "buena pro", "otorgamiento", "cuadro", "evaluac", "contrato", "orden de"))
    return False


def _origen_precio(tipo_detectado: str | None, doc: dict | None = None) -> str:
    """Etiqueta del origen de un precio contratado/ofertado: contrato > orden_de_compra >
    oferta_ganadora (acta/cuadro/propuesta) > adenda > otro."""
    t = _norm_txt(tipo_detectado or "").lower().replace("_", " ")
    titulo = _norm_txt((doc or {}).get("titulo") or "").lower()
    for src in (t, titulo):
        if "orden" in src:
            return "orden_de_compra"
        if "contrato" in src or "contract" in src:
            return "contrato"
        if any(k in src for k in ("acta", "cuadro", "propuesta", "oferta", "buena pro", "otorgamiento", "evaluac")):
            return "oferta_ganadora"
        if any(k in src for k in ("adenda", "ampliacion", "adicional")):
            return "adenda"
    return "documento_contratacion"


_RUC_PESOS = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)


def _solo_digitos(ruc) -> str:
    return re.sub(r"\D", "", str(ruc or ""))


def ruc_valido(ruc) -> bool:
    """RUC peruano de 11 dígitos con dígito verificador (módulo 11, pesos 5432765432).
    Un RUC mal leído por el OCR (un dígito cambiado) NO pasa y, por tanto, no crea un postor
    fantasma (1225090: 'DIAGNOSTICA PERUANA B.A.C.' 20501867286 como tercer postor)."""
    r = _solo_digitos(ruc)
    if len(r) != 11 or r[:2] not in ("10", "15", "16", "17", "20"):
        return False
    s = sum(int(d) * w for d, w in zip(r[:10], _RUC_PESOS))
    c = 11 - (s % 11)
    c = {10: 0, 11: 1}.get(c, c)
    return c == int(r[10])


def _corregir_ruc(ruc, candidatos) -> str | None:
    """Si `ruc` (leído por OCR) difiere en UN solo dígito de un RUC válido conocido (OCDS
    tenderers/suppliers), devuelve el conocido; si no, None."""
    r = _solo_digitos(ruc)
    if len(r) != 11:
        return None
    for c in candidatos or ():
        c = _solo_digitos(c)
        if len(c) == 11 and sum(1 for a, b in zip(r, c) if a != b) == 1:
            return c
    return None


def _rucs_ocds(state: dict) -> dict[str, str]:
    """{ruc: nombre} de tender.tenderers, parties[tenderer|supplier] y awards[].suppliers."""
    out: dict[str, str] = {}
    cr = (state or {}).get("ocds") or {}
    tender = cr.get("tender") or {}
    for t in (tender.get("tenderers") or []):
        if isinstance(t, dict):
            rid = _solo_digitos(str(t.get("id") or "").replace("PE-RUC-", ""))
            if len(rid) == 11:
                out.setdefault(rid, str(t.get("name") or ""))
    for pty in (cr.get("parties") or []):
        if not isinstance(pty, dict):
            continue
        roles = pty.get("roles") or []
        if any(r in roles for r in ("tenderer", "supplier")):
            ident = pty.get("identifier") or {}
            if ident.get("scheme") == "PE-RUC":
                rid = _solo_digitos(ident.get("id"))
                if len(rid) == 11:
                    out.setdefault(rid, str(pty.get("name") or ""))
    for a in (cr.get("awards") or []):
        for sup in ((a or {}).get("suppliers") or []):
            if isinstance(sup, dict):
                rid = _solo_digitos(str(sup.get("id") or "").replace("PE-RUC-", ""))
                if len(rid) == 11:
                    out.setdefault(rid, str(sup.get("name") or ""))
    return out


def _ganadores_ocds(state: dict) -> set[str]:
    cr = (state or {}).get("ocds") or {}
    out: set[str] = set()
    for a in (cr.get("awards") or []):
        if not isinstance(a, dict):
            continue
        if str(a.get("status") or "active").lower() in ("cancelled", "unsuccessful"):
            continue
        for sup in (a.get("suppliers") or []):
            if isinstance(sup, dict):
                rid = _solo_digitos(str(sup.get("id") or "").replace("PE-RUC-", ""))
                if len(rid) == 11:
                    out.add(rid)
    for pty in (cr.get("parties") or []):
        if isinstance(pty, dict) and "supplier" in (pty.get("roles") or []):
            rid = _solo_digitos((pty.get("identifier") or {}).get("id"))
            if len(rid) == 11:
                out.add(rid)
    return out


def _mismo_nombre(a: str, b: str) -> bool:
    """Razón social comparable: mismo conjunto de tokens ('ABEL CARPIO COBOS' == 'CARPIO COBOS
    ABEL'), o similitud ≥ 0.9 tras normalizar ('DIAGNOSTICA PERUANA B.A.C.' ~ '... S.A.C.')."""
    import difflib
    na, nb = _norm_razon(a), _norm_razon(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    _sufijos = {"SAC", "SA", "SRL", "EIRL", "SCRL", "SOCIEDAD", "ANONIMA", "CERRADA", "EMPRESA", "INDIVIDUAL",
                "RESPONSABILIDAD", "LIMITADA", "BAC", "COMERCIAL", "DE", "DEL", "LA", "EL", "Y", "E"}
    ta = {t for t in na.split() if t not in _sufijos and len(t) > 1}
    tb = {t for t in nb.split() if t not in _sufijos and len(t) > 1}
    if ta and tb and ta == tb:
        return True
    return difflib.SequenceMatcher(None, na, nb).ratio() >= 0.9


_CAMPOS_OFERTA = ("monto_oferta", "es_ganador", "puntaje", "estado", "orden_prelacion", "item")


def _pagina_principal(obj: dict) -> int | None:
    """Página de la primera evidencia verificada (o de la primera, si ninguna lo está)."""
    evs = [e for e in (obj.get("evidencia") or []) if isinstance(e, dict)]
    for e in evs:
        if e.get("verificada") and e.get("pagina") is not None:
            return e["pagina"]
    for e in evs:
        if e.get("pagina") is not None:
            return e["pagina"]
    return None


def _fusionar_postor(lista: list[dict], p: dict, es_adjudicacion: bool, sha: str | None,
                     rucs_conocidos: dict[str, str] | None = None) -> dict | None:
    """Incorpora el postor `p` a `lista` FUSIONANDO por RUC (válido) o por razón social
    normalizada. Nunca descarta: el mismo RUC visto antes (reporte de propuestas sin montos)
    se COMPLETA con `monto_oferta`/`es_ganador`/`puntaje`/`estado` del acta/cuadro; si el
    nuevo dato viene de un documento de adjudicación y el previo no, el del acta manda.
    RUC inválido (dígito verificador) → se intenta corregir contra los RUC del OCDS (1 dígito
    de diferencia); si no se puede, se guarda en `ruc_ocr` y el postor se fusiona por nombre.
    Devuelve la entrada consolidada (o None si `p` no tiene ni RUC ni nombre)."""
    if not isinstance(p, dict):
        return None
    nombre = str(p.get("razon_social") or "").strip()
    ruc_raw = _solo_digitos(p.get("ruc"))
    ruc = ruc_raw if ruc_valido(ruc_raw) else None
    ruc_ocr = None
    if ruc_raw and not ruc:
        fix = _corregir_ruc(ruc_raw, list((rucs_conocidos or {}).keys()))
        if fix:
            ruc, ruc_ocr = fix, ruc_raw
        else:
            ruc_ocr = ruc_raw
    if not ruc and not nombre:
        return None
    prev = None
    if ruc:
        prev = next((q for q in lista if q.get("ruc") == ruc), None)
    if prev is None and nombre:
        prev = next((q for q in lista if _mismo_nombre(q.get("razon_social"), nombre)), None)
    nuevo = {k: v for k, v in p.items() if k not in ("ruc",)}
    nuevo["ruc"] = ruc
    if ruc_ocr:
        nuevo["ruc_ocr"] = ruc_ocr
    if ruc and rucs_conocidos and rucs_conocidos.get(ruc):
        nuevo["razon_social_ocds"] = rucs_conocidos[ruc]
    nuevo["_fuente_adjudicacion"] = bool(es_adjudicacion)
    nuevo["fuentes"] = [sha] if sha else []
    if sha and not nuevo.get("documento_sha256"):
        nuevo["documento_sha256"] = sha
    nuevo["pagina"] = _pagina_principal(p)
    if prev is None:
        lista.append(nuevo)
        return nuevo
    # ── fusión ──
    if ruc and not prev.get("ruc"):
        prev["ruc"] = ruc
    if ruc_ocr and not prev.get("ruc_ocr") and prev.get("ruc") != ruc_ocr:
        prev["ruc_ocr"] = ruc_ocr
    if nuevo.get("razon_social_ocds") and not prev.get("razon_social_ocds"):
        prev["razon_social_ocds"] = nuevo["razon_social_ocds"]
    manda_nuevo = es_adjudicacion and not prev.get("_fuente_adjudicacion")
    for k in _CAMPOS_OFERTA:
        v = nuevo.get(k)
        if v in (None, "", [], {}):
            continue
        if prev.get(k) in (None, "", [], {}) or (manda_nuevo and k != "item"):
            prev[k] = v
    if manda_nuevo:
        prev["_fuente_adjudicacion"] = True
        if sha:
            prev["documento_sha256"] = sha
            prev["pagina"] = nuevo.get("pagina") if nuevo.get("pagina") is not None else prev.get("pagina")
    elif prev.get("pagina") is None and nuevo.get("pagina") is not None:
        prev["pagina"] = nuevo["pagina"]
    if sha and sha not in prev.setdefault("fuentes", []):
        prev["fuentes"].append(sha)
    ev_prev = prev.get("evidencia") or []
    prev["evidencia"] = ev_prev + [e for e in (nuevo.get("evidencia") or []) if e not in ev_prev]
    for k, v in nuevo.items():
        if k in ("evidencia", "fuentes", "_fuente_adjudicacion", "ruc", "ruc_ocr", "pagina", "documento_sha256"):
            continue
        if prev.get(k) in (None, "", [], {}) and v not in (None, "", [], {}):
            prev[k] = v
    return prev


def _ofertas_desde_postores(postores: list[dict]) -> list[dict]:
    """`ofertas[]` completas {postor, ruc, monto, orden, es_ganador, estado, fuente, pagina}
    ordenadas por orden de prelación (si el acta lo trae) o por monto ascendente."""
    con_monto = [p for p in postores if isinstance(p, dict) and isinstance(p.get("monto_oferta"), (int, float))
                 and p["monto_oferta"] > 0]
    def _k(p):
        o = p.get("orden_prelacion")
        return (0, float(o)) if isinstance(o, (int, float)) else (1, float(p["monto_oferta"]))
    out = []
    for i, p in enumerate(sorted(con_monto, key=_k), start=1):
        out.append({"postor": p.get("razon_social"), "ruc": p.get("ruc"), "monto": float(p["monto_oferta"]),
                    "orden": int(p["orden_prelacion"]) if isinstance(p.get("orden_prelacion"), (int, float)) else i,
                    "es_ganador": bool(p.get("es_ganador")) if p.get("es_ganador") is not None else None,
                    "estado": p.get("estado"), "fuente": p.get("documento_sha256"), "pagina": p.get("pagina")})
    return out


def _mismo_firmante(a: dict, b: dict) -> bool:
    """'YHONY E. QUISPE CANAZA' y 'Yhony Edwin Quispe Canaza' son la misma persona: los
    tokens largos (≥ 3 letras) de uno están contenidos en el otro y comparten ≥ 2."""
    na = [t for t in _norm_razon(a.get("nombre_completo")).split() if len(t) >= 3]
    nb = [t for t in _norm_razon(b.get("nombre_completo")).split() if len(t) >= 3]
    if not na or not nb:
        return False
    sa, sb = set(na), set(nb)
    inter = sa & sb
    if len(inter) < 2:
        return False
    return sa <= sb or sb <= sa or len(inter) >= 3


def list_documents(ocid: str, tool_context: ToolContext) -> dict:
    """Lista los documentos publicados en SEACE para esta convocatoria.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con documents (lista con id, title, documentType, url,
        format, has_b64).
    """
    cr = tool_context.state.get("ocds") or {}
    docs_b64 = tool_context.state.get("docs_b64") or {}
    # Recolectar documentos de TODAS las etapas, no solo `tender`. El contrato
    # firmado (Orden de Compra) vive en `contracts.documents` y antes quedaba
    # invisible → nunca se parseaba (contrato_final salía null). Mapeo de etapa
    # para que el agente priorice (Bases/Resumen→Convocatoria, Acta→Adjudicación,
    # Contrato/garantía→Contrato).
    docs: list[dict] = []
    for stage in ("tender", "awards", "contracts"):
        node = cr.get(stage)
        arr = node if isinstance(node, list) else ([node] if node else [])
        for nd in arr:
            if isinstance(nd, dict):
                for d in (nd.get("documents") or []):
                    if isinstance(d, dict):
                        docs.append({**d, "_stage": stage})
    return {
        "n_documents": len(docs),
        "documents": [
            {
                "id": d.get("id"), "title": d.get("title"),
                "documentType": d.get("documentType"), "url": d.get("url"),
                "format": d.get("format"), "stage": d.get("_stage"),
                "has_b64_preloaded": d.get("url") in docs_b64,
            }
            for d in docs
        ],
        "_note": "La selección y el parseo en lote los hace parse_documentos_seleccionados (determinista).",
    }

_LOOKALIKES = str.maketrans({"Μ": "M", "Α": "A", "Β": "B", "Ε": "E", "Η": "H", "Ι": "I", "Κ": "K", "Ν": "N",
                              "Ο": "O", "Ρ": "P", "Τ": "T", "Χ": "X", "Ζ": "Z", "І": "I", "О": "O", "А": "A",
                              "Е": "E", "Р": "P", "С": "C", "Т": "T", "Н": "H", "К": "K", "М": "M", "В": "B"})


def _desc_compacta(desc: str) -> str:
    """Descripción como clave: MAYÚSCULAS sin tildes, lookalikes griegos/cirílicos del OCR
    (Μ→M), sin espacios ni puntuación ('DRYWALL 0.90 mm' == 'DRYWALL0.90 MM …')."""
    d = _norm_txt(str(desc or "")).translate(_LOOKALIKES)
    return re.sub(r"[^A-Z0-9]", "", d)


def _buscar_item_similar(existing_keys: dict, k):
    """Clave ('d', desc[, cantidad]) → ítem ya consolidado cuya descripción compacta sea
    ≥ 0.92 similar (difflib) con la MISMA cantidad; None si no hay. Evita el ítem duplicado
    por ruido OCR (total de mercado doble) sin fundir productos distintos."""
    import difflib
    if not k or k[0] != "d":
        return None
    desc = k[1]
    cant = k[2] if len(k) > 2 else None
    for k2, it in existing_keys.items():
        if k2[0] != "d" or (len(k2) > 2) != (len(k) > 2):
            continue
        if len(k2) > 2 and k2[2] != cant:
            continue
        if abs(len(k2[1]) - len(desc)) > max(4, int(0.15 * len(desc))):
            continue
        if difflib.SequenceMatcher(None, k2[1], desc).ratio() >= 0.92:
            return it
    return None


def _item_key(it: dict):
    """Clave semántica para dedup de ítems (fix #1): descripción normalizada +
    cantidad. Evita que el MISMO ítem, numerado distinto en dos documentos
    ('2' vs '02', '1.0' vs '01'), sobreviva duplicado y duplique el trabajo del
    market agent. Devuelve None si no hay descripción ni número."""
    desc = _desc_compacta(it.get("descripcion_corta") or it.get("descripcion") or "")
    if desc:
        req = (it.get("requerimiento_tecnico_detallado") or "").strip()
        # Cabeceras de objeto/agregador (SIN requerimiento): el mismo
        # "ADQUISICIÓN DE LLANTAS..." aparece como "ítem 1" en cada documento
        # (acta, reporte, contrato) → dedup por descripción SOLA para no
        # multiplicarlo. Ítems reales (con requerimiento) usan desc+cantidad
        # para no fusionar productos distintos del mismo rubro.
        return ("d", desc) if not req else ("d", desc, it.get("cantidad"))
    num = it.get("numero")
    if num is not None and str(num).strip():
        return ("n", str(num).strip())
    return None


def _analyze_pdf_layout(blob: bytes) -> dict:
    """Analiza la estructura de un PDF para detectar páginas cuyo contenido
    está rasterizado como imagen (es decir, el PDF tiene texto extraíble bajo,
    pero las páginas tienen imágenes grandes que cubren la mayoría del área).
    Estas páginas necesitan ser renderizadas a PNG y pasadas a Gemini Vision
    porque el OCR implícito del SDK sobre el bytestream del PDF muchas veces
    no recupera bien el contenido.

    Returns:
        {
          "n_pages": int,
          "needs_render_pages": [indices 0-based],
          "low_text_pages": [indices con <300 chars],
          "total_text_chars": int,
          "es_pdf_completamente_escaneado": bool,
        }
    """
    try:
        import fitz  # PyMuPDF
    except Exception as e:
        return {"error": f"pymupdf not available: {e}", "needs_render_pages": []}

    doc = fitz.open(stream=blob, filetype="pdf")
    needs_render: list[int] = []
    low_text: list[int] = []
    total_chars = 0
    n = len(doc)
    for i in range(n):
        page = doc[i]
        text = (page.get_text() or "").strip()
        n_chars = len(text)
        total_chars += n_chars
        if n_chars < 300:
            low_text.append(i)
        if n_chars >= 600:
            # página con texto suficiente — no requiere render
            continue
        # ¿hay imágenes cubriendo el área de la página?
        try:
            page_area = float(page.rect.width * page.rect.height) or 1.0
        except Exception:
            page_area = 1.0
        img_area = 0.0
        try:
            for img in page.get_images(full=True):
                xref = img[0]
                try:
                    for r in page.get_image_rects(xref):
                        img_area += float(r.width * r.height)
                except Exception:
                    # algunas builds no exponen image_rects con xref
                    pass
        except Exception:
            pass
        ratio = img_area / page_area if page_area else 0.0
        if ratio > 0.25:
            needs_render.append(i)
    es_escaneado = len(low_text) >= max(3, int(0.7 * n))
    doc.close()
    return {
        "n_pages": n,
        "needs_render_pages": needs_render,
        "low_text_pages": low_text,
        "total_text_chars": total_chars,
        "es_pdf_completamente_escaneado": es_escaneado,
    }

def _render_pdf_pages_to_png(
    blob: bytes, page_indices: list[int], dpi: int = 160,
) -> list[tuple[int, bytes]]:
    """Renderiza páginas específicas de un PDF a PNG bytes.

    Args:
        blob: bytes del PDF.
        page_indices: lista de índices 0-based de páginas a renderizar.
        dpi: resolución de render. 160 DPI = ~1300x1700 px en página A4, balance
             OCR vs tamaño.

    Returns:
        Lista de tuples (page_index_0based, png_bytes).
    """
    try:
        import fitz
    except Exception:
        return []
    doc = fitz.open(stream=blob, filetype="pdf")
    out: list[tuple[int, bytes]] = []
    try:
        for i in page_indices:
            if i < 0 or i >= len(doc):
                continue
            try:
                pix = doc[i].get_pixmap(dpi=dpi)
                out.append((i, pix.tobytes("png")))
            except Exception:
                continue
    finally:
        doc.close()
    return out

# ── Page-sharding: parte un PDF grande en sub-PDFs por rango de páginas ──
# Cada shard se procesa con su propia llamada Gemini (más chica, más rápida y
# sin riesgo de truncar el JSON), en paralelo (acotado por _throttle_gemini), y
# el merge de parse_document_pdf consolida items/firmantes/etc. por número.
PARSE_PAGES_PER_SHARD = int(os.getenv("PARSE_PAGES_PER_SHARD", "12"))
PARSE_SHARD_THRESHOLD = int(os.getenv("PARSE_SHARD_THRESHOLD", "16"))
PARSE_MAX_WORKERS = int(os.getenv("PARSE_MAX_WORKERS", "4"))
# Timeout por-llamada Gemini (ms): ninguna extracción de un shard puede colgarse
# más de esto. Visto en prod: una sola llamada de 7m36s congelaba toda la corrida.
PARSE_CALL_TIMEOUT_MS = int(os.getenv("PARSE_CALL_TIMEOUT_MS", "120000"))
# Techo POR-DOCUMENTO (s): una sola llamada a parse_document_pdf devuelve dentro
# de este presupuesto; los shards que no terminaron se marcan como timeout.
PARSE_OVERALL_TIMEOUT_S = int(os.getenv("PARSE_OVERALL_TIMEOUT_S", "600"))
# Techo GLOBAL del parser (s) across TODA la corrida: el primer parse_document_pdf
# fija un deadline compartido en state; cada documento respeta lo que queda. Así la
# SUMA de todos los PDFs no se come el wall de Cloud Run (1800s) y siempre se llega
# al writer + persist + force_flush. Debe dejar margen para el resto del pipeline.
PARSE_GLOBAL_BUDGET_S = int(os.getenv("PARSE_GLOBAL_BUDGET_S", "700"))


def _split_pdf_by_pages(blob: bytes, label: str,
                        pages_per_shard: int = PARSE_PAGES_PER_SHARD,
                        threshold: int = PARSE_SHARD_THRESHOLD,
                        overlap: int = 1) -> list[tuple[str, bytes]]:
    """Si el PDF supera `threshold` páginas, lo parte en sub-PDFs de
    ~`pages_per_shard` páginas (con `overlap` págs de solape para no cortar un
    ítem a la mitad). Devuelve [(label, blob)] tal cual si es chico o si falla."""
    try:
        import fitz
        src = fitz.open(stream=blob, filetype="pdf")
        n = src.page_count
        if n <= threshold:
            src.close()
            return [(label, blob)]
        shards: list[tuple[str, bytes]] = []
        for start in range(0, n, pages_per_shard):
            a = max(0, start - overlap)
            b = min(n - 1, start + pages_per_shard - 1)
            dst = fitz.open()
            dst.insert_pdf(src, from_page=a, to_page=b)
            shards.append((f"{label} [pp.{a + 1}-{b + 1}/{n}]", dst.tobytes()))
            dst.close()
            if b >= n - 1:
                break
        src.close()
        print(json.dumps({"pdf_sharded": label[:80], "n_pages": n, "n_shards": len(shards)}), flush=True)
        return shards or [(label, blob)]
    except Exception as e:
        print(json.dumps({"pdf_shard_error": str(e)[:160], "label": label[:80]}), flush=True)
        return [(label, blob)]


# ═══════════════════════════════════════════════════════════════════════════════
# Parser en LOTE (WS D · plan 2026-09-15): documentos elegidos de forma determinista
# (tools/doc_select.py), OCR UNA sola vez por sha256 (tabla documentos_texto, páginas con
# marcador ⟦p.N⟧), extracción con schema base + bloque del perfil y evidencia
# {documento_sha256, pagina, cita} por ítem/firmante/postor/comité/motivo. Ningún tope es
# silencioso: cada recorte va a state['recortes'] = [{donde, limite, omitido}].
# ═══════════════════════════════════════════════════════════════════════════════
import hashlib as _hashlib
import subprocess as _subprocess
import tempfile as _tempfile
from collections import OrderedDict as _OrderedDict

from tools.doc_select import (  # noqa: F401  (re-exportado vía `from tools import *`)
    seleccionar_documentos, rank_documento, recorte_seleccion, PRIORIDAD_DEFAULT, MAX_DOCS_DEFAULT,
)

# Versión del extractor de TEXTO (OCR + layout + marcadores). Cambiarla invalida la caché
# de `documentos_texto` (se vuelve a hacer OCR). La extracción estructurada se cachea
# aparte por (bloque, PARSER_SCHEMA_VERSION, modelo) dentro de `extraccion` JSONB.
VERSION_PARSER = os.getenv("PARSER_TEXT_VERSION", "texto-v1")
# schema-v3 (lote 1 · T7): precio/marca por etapa (referencial vs ofertado/contratado), postores
# con puntaje/estado/orden, invitados, procedimiento_seleccion, ejecucion_contractual, folio.
PARSER_SCHEMA_VERSION = os.getenv("PARSER_SCHEMA_VERSION", "schema-v3")
# Chars de texto OCR por llamada Gemini (≈ 150K tokens). Documentos más largos se parten
# por páginas en varias llamadas y se fusionan — no se omite nada.
PARSE_MAX_CHARS_POR_LLAMADA = int(os.getenv("PARSE_MAX_CHARS_POR_LLAMADA", "600000"))
# Documentos del lote procesados A LA VEZ (descarga → OCR → extracción, cada uno en su hilo):
# PARSE_CONCURRENCY (default 3; alias histórico PARSE_LOTE_WORKERS). El orden de prioridad del
# perfil se conserva en la consolidación (resultados indexados por posición, no por llegada);
# el lock por sha256 (_esperar_sha) evita OCR doble de bytes idénticos dentro del lote.
PARSE_LOTE_WORKERS = int(os.getenv("PARSE_CONCURRENCY") or os.getenv("PARSE_LOTE_WORKERS", "3"))
PARSE_REUSE_EXTRACCION = os.getenv("PARSE_REUSE_EXTRACCION", "1") != "0"
# Solo para MEDIR (benchmark): ignora el texto cacheado en documentos_texto y vuelve a hacer
# OCR (la extracción cacheada también se ignora porque cuelga del texto). Default 0.
PARSE_SKIP_TEXTO_CACHE = os.getenv("PARSE_SKIP_TEXTO_CACHE", "0") == "1"
# Unidades de un contenedor (ZIP con varios PDF) y rangos de páginas de un documento largo
# (> PARSE_MAX_CHARS_POR_LLAMADA) se OCR-ean / extraen a la vez con este pool (orden preservado).
PARSE_UNIT_WORKERS = max(1, int(os.getenv("PARSE_UNIT_WORKERS", "3") or 3))
TEXTO_LITERAL_MAX = 4000
CITA_MAX = 240

_BLOQUES_VALIDOS = ("servicio", "obra", "sustento_directa")
_IMG_EXTS = (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif", ".webp")


# ── Schema del parser: base + bloque del perfil ────────────────────────────────────────
def _schema_evidencia(desc: str = "") -> "gtypes.Schema":
    from google.genai import types as gtypes
    return gtypes.Schema(
        type=gtypes.Type.ARRAY,
        description=(desc or "Respaldo LITERAL de este dato en el documento: "
                     "`pagina` = número N del marcador ⟦p.N⟧ bajo el que aparece la cita (índice real de "
                     "página del archivo, NUNCA el número impreso al pie); `cita` = fragmento textual copiado "
                     f"tal cual (≤ {CITA_MAX} chars). Sin evidencia el dato NO se persiste."),
        items=gtypes.Schema(
            type=gtypes.Type.OBJECT,
            properties={
                "pagina": gtypes.Schema(type=gtypes.Type.INTEGER, nullable=True),
                "folio": gtypes.Schema(type=gtypes.Type.INTEGER, nullable=True,
                                       description="Número IMPRESO en la página (folio/pie 'Página 22 de 69'), si se ve. Distinto de `pagina`."),
                "cita": gtypes.Schema(type=gtypes.Type.STRING),
            },
            required=["cita"],
        ),
    )


def _schema_bloque(bloque: str | None) -> "gtypes.Schema | None":
    """Bloque extra del schema según `parser_bloque` del perfil (§4.2 de la auditoría)."""
    from google.genai import types as gtypes
    S, T = gtypes.Schema, gtypes.Type
    if not bloque:
        return None
    if bloque == "servicio":
        return S(type=T.OBJECT, nullable=True, description=(
            "SOLO para Términos de Referencia / Bases de un SERVICIO o CONSULTORÍA: la unidad de "
            "análisis es el entregable/actividad y la tarifa (HH, mes, visita, km), no un bien físico. "
            "Dejá null si el documento no describe un servicio."),
            properties={
                "alcance": S(type=T.STRING, nullable=True, description="Alcance del servicio, LITERAL (≤ 1500 chars)."),
                "actividades": S(type=T.ARRAY, items=S(type=T.STRING), description="Actividades/tareas exigidas, literales."),
                "entregables": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "nombre": S(type=T.STRING), "plazo_dias": S(type=T.INTEGER, nullable=True),
                    "porcentaje_pago": S(type=T.NUMBER, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["nombre"])),
                "plazo_total_dias": S(type=T.INTEGER, nullable=True),
                "personal_clave": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "cargo": S(type=T.STRING), "profesion": S(type=T.STRING, nullable=True),
                    "experiencia_min_anios": S(type=T.NUMBER, nullable=True),
                    "dedicacion": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["cargo"])),
                "experiencia_postor": S(type=T.OBJECT, nullable=True, properties={
                    "monto_facturado_min": S(type=T.NUMBER, nullable=True),
                    "n_contratos": S(type=T.INTEGER, nullable=True),
                    "rubro": S(type=T.STRING, nullable=True)}),
                "tarifas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "concepto": S(type=T.STRING), "unidad": S(type=T.STRING, nullable=True),
                    "precio_unitario": S(type=T.NUMBER, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["concepto"])),
                "penalidades": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "tipo": S(type=T.STRING), "formula": S(type=T.STRING, nullable=True),
                    "tope_pct": S(type=T.NUMBER, nullable=True)}, required=["tipo"])),
                "subcontratacion_permitida": S(type=T.BOOLEAN, nullable=True),
                "forma_pago": S(type=T.STRING, nullable=True),
                "lugar_prestacion": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia(),
            })
    if bloque == "obra":
        return S(type=T.OBJECT, nullable=True, description=(
            "SOLO para OBRAS: expediente técnico, presupuesto y ejecución (adicionales, ampliaciones, "
            "valorizaciones). Dejá null si el documento no es de una obra."),
            properties={
                "expediente_tecnico": S(type=T.OBJECT, nullable=True, properties={
                    "memoria": S(type=T.STRING, nullable=True, description="Memoria descriptiva, LITERAL (≤ 1500 chars)."),
                    "presupuesto_total": S(type=T.NUMBER, nullable=True),
                    "partidas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                        "codigo": S(type=T.STRING, nullable=True), "descripcion": S(type=T.STRING),
                        "metrado": S(type=T.NUMBER, nullable=True), "unidad": S(type=T.STRING, nullable=True),
                        "precio_unitario": S(type=T.NUMBER, nullable=True), "parcial": S(type=T.NUMBER, nullable=True),
                        "pagina": S(type=T.INTEGER, nullable=True)}, required=["descripcion"])),
                    "gastos_generales_pct": S(type=T.NUMBER, nullable=True),
                    "utilidad_pct": S(type=T.NUMBER, nullable=True),
                    "plazo_dias": S(type=T.INTEGER, nullable=True),
                    "cronograma": S(type=T.STRING, nullable=True)}),
                "residente_requisitos": S(type=T.STRING, nullable=True),
                "supervisor_requisitos": S(type=T.STRING, nullable=True),
                "garantia_fiel_cumplimiento": S(type=T.STRING, nullable=True),
                "adelantos": S(type=T.STRING, nullable=True),
                "adicionales": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "monto": S(type=T.NUMBER, nullable=True),
                    "pct_acumulado": S(type=T.NUMBER, nullable=True), "motivo": S(type=T.STRING, nullable=True),
                    "resolucion": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)})),
                "ampliaciones_plazo": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "dias": S(type=T.INTEGER, nullable=True),
                    "motivo": S(type=T.STRING, nullable=True), "resolucion": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)})),
                "valorizaciones": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "periodo": S(type=T.STRING, nullable=True),
                    "monto": S(type=T.NUMBER, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)})),
                "evidencia": _schema_evidencia(),
            })
    if bloque == "sustento_directa":
        return S(type=T.OBJECT, nullable=True, description=(
            "SOLO para contratación DIRECTA / convenio / consultoría por causal: la causal invocada y el "
            "expediente que la sustenta (informes, acto aprobatorio, cotizaciones). Dejá null si el "
            "documento no sustenta una directa ni es un convenio."),
            properties={
                "causal_articulo": S(type=T.STRING, nullable=True, description="Artículo/literal invocado, LITERAL."),
                "causal_texto": S(type=T.STRING, nullable=True, description="Fundamento textual de la causal (≤ 1500 chars)."),
                "informe_tecnico": S(type=T.OBJECT, nullable=True, properties={
                    "numero": S(type=T.STRING, nullable=True), "fecha": S(type=T.STRING, nullable=True),
                    "firmante": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)}),
                "informe_legal": S(type=T.OBJECT, nullable=True, properties={
                    "numero": S(type=T.STRING, nullable=True), "fecha": S(type=T.STRING, nullable=True),
                    "firmante": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)}),
                "acto_aprobatorio": S(type=T.OBJECT, nullable=True, properties={
                    "tipo": S(type=T.STRING, nullable=True, description="resolución de alcaldía / acuerdo de concejo / resolución ejecutiva regional / …"),
                    "numero": S(type=T.STRING, nullable=True), "fecha": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}),
                "cotizaciones": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "proveedor": S(type=T.STRING), "ruc": S(type=T.STRING, nullable=True),
                    "monto": S(type=T.NUMBER, nullable=True), "fecha": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["proveedor"])),
                "proveedor_unico_justificacion": S(type=T.STRING, nullable=True),
                "fecha_publicacion_seace": S(type=T.STRING, nullable=True),
                "convenio": S(type=T.OBJECT, nullable=True, properties={
                    "entidades_parte": S(type=T.ARRAY, items=S(type=T.STRING)),
                    "objeto": S(type=T.STRING, nullable=True), "aportes": S(type=T.STRING, nullable=True),
                    "vigencia": S(type=T.STRING, nullable=True)}),
                "evidencia": _schema_evidencia(),
            })
    raise ValueError(f"parser_bloque desconocido: {bloque!r} (válidos: {_BLOQUES_VALIDOS})")


# Gemini rechaza (400 INVALID_ARGUMENT) un response_schema demasiado grande: con los bloques de
# procedimiento de selección + ejecución contractual + ítems, el schema completo supera el límite.
# Por eso los bloques pesados entran solo cuando el documento puede contenerlos (por tipo/título).
_SECCIONES_OPCIONALES = ("procedimiento_seleccion", "ejecucion_contractual", "contrato_final", "estudio_mercado")
PARSER_SCHEMA_MAX_CHARS = int(os.getenv("PARSER_SCHEMA_MAX_CHARS", "20500"))


def secciones_para_documento(label: str | None, tipo_hint: str | None, seccion: str | None = None) -> set[str]:
    """Qué bloques opcionales del schema aplican a un documento según su título/tipo OCDS/sección."""
    t = f"{label or ''} {tipo_hint or ''} {seccion or ''}".lower()
    out: set[str] = set()
    if any(k in t for k in ("acta", "buena pro", "evaluaci", "calificaci", "cuadro", "integrada", "absoluci", "consulta",
                            "observaci", "propuesta", "oferta", "award", "tender")):
        out.add("procedimiento_seleccion")
    if any(k in t for k in ("contrato", "contract", "orden de", "adenda", "ampliaci", "penalidad", "resoluci", "garant",
                            "conformidad", "entrega")):
        out.update({"ejecucion_contractual", "contrato_final"})
    if any(k in t for k in ("estudio", "mercado", "indagaci", "informe", "sustento", "cotizaci")):
        out.add("estudio_mercado")
    return out


def _parser_schema(bloque: str | None = None, secciones: set[str] | None = None) -> "gtypes.Schema":
    """Schema de extracción: base (ítems, postores, firmantes, comité, motivos, estudio de
    mercado, contrato final) + bloque del perfil. Cada ítem/firmante/postor/comité/motivo
    lleva `evidencia: [{pagina, cita}]`; el requerimiento va LITERAL en `texto_literal`."""
    from google.genai import types as gtypes
    S, T = gtypes.Schema, gtypes.Type
    props = {
        "cuantia_total": S(type=T.NUMBER, nullable=True),
        "fuente_financiamiento": S(type=T.STRING, nullable=True),
        "modalidad": S(type=T.STRING, nullable=True),
        "tipo_documento_detectado": S(
            type=T.STRING, nullable=True,
            description=(
                "Tipo de documento OECE detectado a partir del contenido: "
                "bases_administrativas, bases_integradas, terminos_de_referencia, expediente_tecnico, "
                "resumen_ejecutivo, informe_sustento, acta_buena_pro, cuadro_evaluacion, contrato, "
                "orden_de_compra, adenda, propuesta_economica, absolucion_consultas, otro."
            ),
        ),
        "contiene_requerimiento": S(
            type=T.BOOLEAN, nullable=True,
            description=(
                "True si en este documento aparece la sección 'REQUERIMIENTO' / 'Términos de "
                "Referencia' / 'Especificaciones Técnicas' / 'Expediente técnico' con detalle técnico."
            ),
        ),
        "items": S(
            type=T.ARRAY,
            items=S(
                type=T.OBJECT,
                properties={
                    "numero": S(type=T.STRING, nullable=True,
                        description="Número del ítem como string: '1', '1.1', '2'. Sub-numeración con punto si el OCDS agrupa varios productos en un ítem."),
                    "padre_ocds_item": S(type=T.STRING, nullable=True,
                        description="Si es desglose de un ítem padre del OCDS, número del padre."),
                    "descripcion_corta": S(type=T.STRING, description="TÍTULO del ítem tal como aparece (1 línea, ≤200 chars)."),
                    "cantidad": S(type=T.NUMBER, nullable=True),
                    "unidad": S(type=T.STRING, nullable=True, description="UND, KG, M3, LITRO, SACO, MES, HH, SERVICIO, etc."),
                    "precio_unitario_referencial": S(type=T.NUMBER, nullable=True,
                        description="SOLO en bases/TDR/EETT/resumen ejecutivo/estudio de mercado: precio unitario del valor referencial. En contrato/orden/acta/propuesta va null (usá precio_unitario_contratado / precio_unitario_ofertado)."),
                    "cuantia_referencial_item": S(type=T.NUMBER, nullable=True,
                        description="Valor referencial / cuantía total del ítem (bases, resumen ejecutivo o reporte del acta)."),
                    "precio_unitario_ofertado": S(type=T.NUMBER, nullable=True,
                        description="SOLO en propuesta económica / acta / cuadro de evaluación: precio unitario ofertado por el ganador."),
                    "precio_unitario_contratado": S(type=T.NUMBER, nullable=True,
                        description="SOLO en contrato / orden de compra o servicio: precio unitario pactado."),
                    "subtotal_contratado": S(type=T.NUMBER, nullable=True,
                        description="SOLO en contrato / orden: subtotal del ítem (cantidad × precio unitario)."),
                    "marca_o_modelo_exigido": S(type=T.STRING, nullable=True,
                        description=("SOLO en bases/TDR/EETT y SOLO si el texto del requerimiento dice literalmente "
                                     "'marca', 'modelo', 'o equivalente' u 'o similar' junto a un nombre comercial: copiá el texto exacto. "
                                     "Null si el requerimiento es genérico, si solo hay códigos de parte, o si el documento es "
                                     "contrato/orden/acta/propuesta (ahí la marca va en marca_ofertada).")),
                    "marca_ofertada": S(type=T.STRING, nullable=True,
                        description="SOLO en contrato/orden/propuesta/acta: marca y modelo del producto ofertado o contratado, literal."),
                    "certificaciones_exigidas": S(type=T.ARRAY, items=S(type=T.STRING),
                        description="Normas/certificaciones exigidas, cada string LITERAL (≤80 chars)."),
                    "valores_tecnicos_clave": S(type=T.OBJECT, nullable=True,
                        description="Valores numéricos discretos del requerimiento. Solo los que aparezcan.",
                        properties={
                            "potencia_min_hp": S(type=T.NUMBER, nullable=True),
                            "potencia_min_kw": S(type=T.NUMBER, nullable=True),
                            "capacidad_volumen": S(type=T.STRING, nullable=True),
                            "capacidad_carga_ton": S(type=T.NUMBER, nullable=True),
                            "peso_operativo_ton": S(type=T.STRING, nullable=True),
                            "alcance_m": S(type=T.NUMBER, nullable=True),
                            "ano_fabricacion_min": S(type=T.INTEGER, nullable=True),
                            "estado": S(type=T.STRING, nullable=True),
                            "presentacion": S(type=T.STRING, nullable=True),
                            "color": S(type=T.STRING, nullable=True),
                            "material": S(type=T.STRING, nullable=True),
                        }),
                    "garantia": S(type=T.OBJECT, nullable=True, properties={
                        "meses": S(type=T.INTEGER, nullable=True), "horas": S(type=T.INTEGER, nullable=True),
                        "alcance": S(type=T.STRING, nullable=True)}),
                    "condiciones_entrega": S(type=T.OBJECT, nullable=True, properties={
                        "plazo_dias_calendario": S(type=T.INTEGER, nullable=True, description="Plazo de ENTREGA (no el de suministro/vigencia)."),
                        "plazo_dias_tipo": S(type=T.STRING, nullable=True, description="'habiles' o 'calendario', tal como lo diga el texto."),
                        "lugar_entrega": S(type=T.STRING, nullable=True),
                        "modalidad": S(type=T.STRING, nullable=True)}),
                    "requisitos_postor": S(type=T.OBJECT, nullable=True,
                        description="Requisitos al postor (no al bien/servicio).",
                        properties={
                            "experiencia_minima_soles": S(type=T.NUMBER, nullable=True, description="Monto facturado acumulado exigido como experiencia."),
                            "anos_experiencia_min": S(type=T.NUMBER, nullable=True,
                                description="SOLO si se exige antigüedad mínima del postor. NO la ventana estándar ('durante los 10 años anteriores') para computar la facturación."),
                            "n_contratos_similares": S(type=T.INTEGER, nullable=True,
                                description="SOLO si se exige un número mínimo de contratos. NO el tope 'máximo de 20 contrataciones'."),
                            "certificaciones_postor": S(type=T.ARRAY, items=S(type=T.STRING)),
                            "infraestructura_exigida": S(type=T.STRING, nullable=True),
                            "personal_clave": S(type=T.ARRAY, items=S(type=T.STRING)),
                        }),
                    "penalidades": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                        "causal": S(type=T.STRING), "monto_o_porcentaje": S(type=T.STRING, nullable=True),
                        "base_calculo": S(type=T.STRING, nullable=True)}, required=["causal"])),
                    "subitems": S(type=T.ARRAY,
                        description="Si el ítem es un PAQUETE/LOTE/CANASTA con N productos distintos, listalos acá.",
                        items=S(type=T.OBJECT, properties={
                            "descripcion": S(type=T.STRING), "cantidad": S(type=T.NUMBER, nullable=True),
                            "unidad": S(type=T.STRING, nullable=True), "presentacion": S(type=T.STRING, nullable=True),
                            "specs_clave": S(type=T.STRING, nullable=True)}, required=["descripcion"])),
                    "texto_literal": S(type=T.STRING, nullable=True,
                        description=(
                            f"EXTRACTO LITERAL (copiado tal cual, SIN resumir ni reescribir) del requerimiento "
                            "técnico de este ítem: especificaciones, normas, garantía, plazo, requisitos del postor. "
                            f"Copiá el requerimiento COMPLETO hasta agotar los {TEXTO_LITERAL_MAX} chars (no elijas un "
                            "fragmento corto: si hay 3 páginas de especificaciones, transcribí las 3 hasta el tope). "
                            "Si es más largo que el tope, copiá desde el inicio y declará en `texto_literal_paginas` "
                            "TODAS las páginas que abarca. Null si el documento no tiene requerimiento para este ítem."
                        )),
                    "texto_literal_paginas": S(type=T.ARRAY, items=S(type=T.INTEGER),
                        description="Páginas (N de ⟦p.N⟧) donde vive el requerimiento de este ítem."),
                    "evidencia": _schema_evidencia(),
                },
                required=["descripcion_corta"],
            ),
        ),
        "postores": S(type=T.ARRAY,
            description=("TODOS los postores/participantes que el documento nombra (reporte de propuestas, acta, "
                         "cuadro, Formato 11): con su RUC, el precio de su oferta (sección 'precio de la oferta' / "
                         "orden de prelación), si ganó, puntaje total y estado. Un postor por fila, aunque no haya ganado."),
            items=S(type=T.OBJECT, properties={
            "ruc": S(type=T.STRING, nullable=True), "razon_social": S(type=T.STRING),
            "monto_oferta": S(type=T.NUMBER, nullable=True, description="Precio ofertado por ESTE postor (número, sin separadores)."),
            "es_ganador": S(type=T.BOOLEAN, nullable=True),
            "puntaje": S(type=T.NUMBER, nullable=True, description="Puntaje total (técnico + económico) si el cuadro/acta lo trae."),
            "orden_prelacion": S(type=T.INTEGER, nullable=True),
            "estado": S(type=T.STRING, nullable=True,
                        description="admitido | no_admitido | descalificado | desierto | invitado | participante_sin_oferta — según el documento."),
            "motivo_estado": S(type=T.STRING, nullable=True, description="Razón literal de la no admisión / descalificación, si la hay."),
            "item": S(type=T.STRING, nullable=True), "evidencia": _schema_evidencia()},
            required=["razon_social"])),
        "invitados": S(type=T.ARRAY,
            description=("SOLO si el documento trae una lista de proveedores INVITADOS (Comparación de Precios: "
                         "'Formato de invitación', 'Anexo 1', informe de invitación): cada invitado con RUC y nombre."),
            items=S(type=T.OBJECT, properties={
                "ruc": S(type=T.STRING, nullable=True), "razon_social": S(type=T.STRING),
                "fecha_invitacion": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia()}, required=["razon_social"])),
        "cuantia_reservada": S(type=T.BOOLEAN, nullable=True,
            description="True si las bases dicen que el valor referencial / cuantía NO se publica (reservada, 'no se dará a conocer')."),
        "firmantes": S(type=T.ARRAY,
            description="Personas que FIRMAN el documento (actas, cuadros, contratos). Solo con DNI, entidad real o firma visible.",
            items=S(type=T.OBJECT, properties={
                "nombre_completo": S(type=T.STRING), "dni": S(type=T.STRING, nullable=True),
                "cargo": S(type=T.STRING, nullable=True),
                "rol_en_documento": S(type=T.STRING, nullable=True,
                    description="area_usuaria (firma el requerimiento/EETT en las bases), comite, oec, contratista, entidad, elaboro, aprobo, otro."),
                "entidad": S(type=T.STRING, nullable=True), "fecha_firma": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia()}, required=["nombre_completo"])),
        "comite_evaluacion": S(type=T.ARRAY,
            description="Composición del Comité de Selección si el documento lo lista (solo actas/cuadros/contratos).",
            items=S(type=T.OBJECT, properties={
                "nombre_completo": S(type=T.STRING), "cargo": S(type=T.STRING, nullable=True),
                "rol": S(type=T.STRING, nullable=True), "certificacion_sican": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia()}, required=["nombre_completo"])),
        "motivos_adjudicacion": S(type=T.ARRAY,
            description="Para cada ganador, el motivo documentado en el acta/reporte de buena pro.",
            items=S(type=T.OBJECT, properties={
                "ganador_razon_social": S(type=T.STRING), "ganador_ruc": S(type=T.STRING, nullable=True),
                "item_adjudicado": S(type=T.STRING, nullable=True), "criterio_decisivo": S(type=T.STRING, nullable=True),
                "posicion_ranking": S(type=T.INTEGER, nullable=True),
                "observaciones_evaluacion": S(type=T.STRING, nullable=True),
                "competidores_descalificados": S(type=T.ARRAY, items=S(type=T.STRING)),
                "evidencia": _schema_evidencia()}, required=["ganador_razon_social"])),
        "lugar_fecha_acta": S(type=T.OBJECT, nullable=True, properties={
            "lugar": S(type=T.STRING, nullable=True), "fecha": S(type=T.STRING, nullable=True),
            "hora": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)}),
        "fundamento_legal": S(type=T.ARRAY, items=S(type=T.STRING),
            description="Normas/artículos citados LITERALMENTE por el documento."),
        "estudio_mercado": S(type=T.OBJECT, nullable=True,
            description="SOLO si el documento es un Resumen Ejecutivo / Informe que sustenta la contratación: estudio de mercado y causal. Si no, null.",
            properties={
                "resumen": S(type=T.STRING, nullable=True),
                "valor_referencial": S(type=T.NUMBER, nullable=True),
                "moneda": S(type=T.STRING, nullable=True),
                "comparacion_precio_historico": S(type=T.STRING, nullable=True),
                "causal_articulo": S(type=T.STRING, nullable=True),
                "causal_texto": S(type=T.STRING, nullable=True),
                "proveedores_evaluados": S(type=T.ARRAY, items=S(type=T.STRING)),
                "descalificaciones": S(type=T.ARRAY, items=S(type=T.STRING)),
                "evidencia": _schema_evidencia(),
            }),
        "contrato_final": S(type=T.OBJECT, nullable=True,
            description="SOLO si el documento es la ORDEN DE COMPRA/SERVICIO o el CONTRATO firmado: condiciones finales. Si no, null.",
            properties={
                "precio_final_total": S(type=T.NUMBER, nullable=True),
                "moneda": S(type=T.STRING, nullable=True),
                "cronograma_entregas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "descripcion": S(type=T.STRING, nullable=True), "cantidad": S(type=T.NUMBER, nullable=True),
                    "plazo_dias": S(type=T.INTEGER, nullable=True), "monto": S(type=T.NUMBER, nullable=True)})),
                "penalidades": S(type=T.ARRAY, items=S(type=T.STRING)),
                "forma_pago": S(type=T.STRING, nullable=True),
                "proveedor_ruc": S(type=T.STRING, nullable=True),
                "plazo_ejecucion_dias": S(type=T.INTEGER, nullable=True),
                "fecha_suscripcion": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia(),
            }),
        "procedimiento_seleccion": S(type=T.OBJECT, nullable=True,
            description=("Reglas y resultado de la EVALUACIÓN: factores de evaluación con puntaje máximo (bases/integradas), "
                         "puntajes por postor y factor (acta/cuadro), consultas y observaciones absueltas (pliego) y "
                         "modificaciones introducidas al integrar las bases (bases integradas / pliego). Null si el documento no trae nada de esto."),
            properties={
                "factores_evaluacion": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "factor": S(type=T.STRING), "puntaje_max": S(type=T.NUMBER, nullable=True),
                    "criterio": S(type=T.STRING, nullable=True, description="Cómo se asigna el puntaje, literal (≤ 300 chars)."),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["factor"])),
                "puntajes_por_postor": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "ruc": S(type=T.STRING, nullable=True), "razon_social": S(type=T.STRING, nullable=True),
                    "factor": S(type=T.STRING, description="Nombre del factor, o 'total' / 'tecnico' / 'economico'."),
                    "puntaje": S(type=T.NUMBER, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)},
                    required=["factor"])),
                "consultas_observaciones": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "postor": S(type=T.STRING, nullable=True, description="Participante que consulta/observa."),
                    "tema": S(type=T.STRING, nullable=True, description="Qué pide, literal resumido (≤ 300 chars)."),
                    "absuelta": S(type=T.STRING, nullable=True, description="se_acoge | se_acoge_parcialmente | no_se_acoge | sin_dato"),
                    "cambio_en_bases": S(type=T.STRING, nullable=True, description="Qué cambió en las bases a raíz de esta consulta, literal (≤ 300 chars); null si nada."),
                    "pagina": S(type=T.INTEGER, nullable=True)})),
                "modificaciones_integracion": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "texto_original": S(type=T.STRING, nullable=True), "texto_integrado": S(type=T.STRING, nullable=True),
                    "a_pedido_de": S(type=T.STRING, nullable=True, description="Participante cuya consulta originó el cambio, si consta."),
                    "pagina": S(type=T.INTEGER, nullable=True)})),
                "evidencia": _schema_evidencia(),
            }),
        "ejecucion_contractual": S(type=T.OBJECT, nullable=True,
            description=("SOLO en documentos de EJECUCIÓN del contrato (adendas, resoluciones sobre ampliación de plazo, "
                         "penalidades, actas de entrega/conformidad, cartas): lo que pasó DESPUÉS de firmar. Null en bases/actas de buena pro/OC."),
            properties={
                "ampliaciones_plazo": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "dias_solicitados": S(type=T.INTEGER, nullable=True),
                    "solicitada_por": S(type=T.STRING, nullable=True), "fecha_solicitud": S(type=T.STRING, nullable=True),
                    "resolucion": S(type=T.STRING, nullable=True, description="Número/fecha del acto que resuelve."),
                    "resultado": S(type=T.STRING, nullable=True, description="procedente | improcedente | parcial | sin_dato"),
                    "motivo": S(type=T.STRING, nullable=True, description="Fundamento literal (≤ 300 chars)."),
                    "pagina": S(type=T.INTEGER, nullable=True)})),
                "penalidades_aplicadas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "tipo": S(type=T.STRING, description="mora | otra"), "monto": S(type=T.NUMBER, nullable=True),
                    "motivo": S(type=T.STRING, nullable=True), "documento": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["tipo"])),
                "adendas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "tipo": S(type=T.STRING, nullable=True, description="ampliacion_plazo | adicional | reduccion | cambio_condiciones | otra"),
                    "objeto": S(type=T.STRING, nullable=True), "monto": S(type=T.NUMBER, nullable=True),
                    "fecha": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)})),
                "entregas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "fecha_prevista": S(type=T.STRING, nullable=True),
                    "fecha_real": S(type=T.STRING, nullable=True), "cantidad": S(type=T.NUMBER, nullable=True),
                    "observacion": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)})),
                "resolucion_contrato": S(type=T.STRING, nullable=True, description="Si el contrato se resolvió: causal y fecha, literal."),
                "evidencia": _schema_evidencia(),
            }),
        "resumen": S(type=T.STRING, nullable=True, description="3-4 líneas describiendo el documento REAL."),
    }
    if bloque:
        props[bloque] = _schema_bloque(bloque)
    if secciones is not None:
        for k in _SECCIONES_OPCIONALES:
            if k not in secciones:
                props.pop(k, None)
    # Presupuesto de tamaño (medido 2026-09-15: Gemini 3.6 acepta ≈ 20 k chars de schema y rechaza
    # ≈ 23 k con 400 INVALID_ARGUMENT). Se descartan bloques opcionales del menos al más valioso.
    import json as _json
    orden_descarte = ["estudio_mercado", "contrato_final", "ejecucion_contractual", "procedimiento_seleccion"]
    if bloque:
        orden_descarte.append(bloque)
    descartados: list[str] = []
    while len(_json.dumps(S(type=T.OBJECT, properties=props).model_dump(exclude_none=True))) > PARSER_SCHEMA_MAX_CHARS and orden_descarte:
        k = orden_descarte.pop(0)
        if k in props:
            props.pop(k)
            descartados.append(k)
    if descartados:
        print(f"[lote] schema recortado por tamaño: sin {descartados} (se piden en una 2.ª llamada)", flush=True)
    _ULTIMOS_DESCARTES[:] = descartados
    return S(type=T.OBJECT, properties=props)


# Bloques que no cupieron en la última construcción del schema (los recupera _llamar_extractor
# con una segunda llamada solo con ellos).
_ULTIMOS_DESCARTES: list[str] = []


def _schema_solo(bloques: list[str], bloque_perfil: str | None) -> "gtypes.Schema":
    """Schema mínimo con solo `bloques` (para la 2.ª pasada)."""
    from google.genai import types as gtypes
    S, T = gtypes.Schema, gtypes.Type
    full = _parser_schema(bloque_perfil, set(_SECCIONES_OPCIONALES) | {bloque_perfil} if bloque_perfil else set(_SECCIONES_OPCIONALES))
    # `full` puede haber recortado; reconstruimos cada bloque pedido desde las funciones fuente.
    props = {}
    for k in bloques:
        if k == bloque_perfil:
            props[k] = _schema_bloque(k)
        elif k in full.properties:
            props[k] = full.properties[k]
        else:
            props[k] = _parser_schema(None, {k}).properties.get(k)
    props = {k: v for k, v in props.items() if v is not None}
    return S(type=T.OBJECT, properties=props)


# ── Contenedores: ZIP / RAR / DOCX / XLSX / DOC / imágenes → unidades de texto ────────
def _sha256_hex(blob: bytes) -> str:
    return _hashlib.sha256(blob).hexdigest()


def _unidad(nombre: str, kind: str, data=None, paginas=None) -> dict:
    """kind ∈ {'pdf' (data=bytes), 'paginas' (paginas=[{texto}] ya extraídas), 'imagenes' (data=pdf sintético)}."""
    return {"nombre": nombre, "kind": kind, "data": data, "paginas": paginas}


def _paginar_texto(texto: str, max_chars: int = 4500) -> list[str]:
    t = (texto or "").strip()
    if not t:
        return []
    return [t[i:i + max_chars] for i in range(0, len(t), max_chars)]


_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _docx_rels_media(z: "zipfile.ZipFile") -> dict[str, str]:
    """rId → nombre de entrada del ZIP (word/media/imageN.ext) según document.xml.rels."""
    import xml.etree.ElementTree as ET
    rels: dict[str, str] = {}
    try:
        root = ET.fromstring(z.read("word/_rels/document.xml.rels"))
    except Exception:
        return rels
    for rel in root:
        rid, tgt = rel.get("Id"), (rel.get("Target") or "")
        if not rid or not tgt or str(rel.get("TargetMode") or "").lower() == "external":
            continue
        tgt = tgt.lstrip("/")
        if not tgt.startswith("word/"):
            tgt = "word/" + tgt
        rels[rid] = tgt
    return rels


def _docx_media_en_orden(z: "zipfile.ZipFile") -> tuple[list[str], dict[str, str]]:
    """Imágenes de word/media en ORDEN DE APARICIÓN en el cuerpo (r:embed / r:link de
    word/document.xml) y luego las no referenciadas (namelist). Devuelve (nombres, rId→nombre).
    Antes se usaba `namelist()`: el requerimiento escaneado (image4…image12) quedaba
    intercalado (p.27 = image6, p.30 = image1, …) y el LLM leía las EETT desordenadas."""
    rels = _docx_rels_media(z)
    disponibles = {n for n in z.namelist() if n.startswith("word/media/") and n.lower().endswith(_IMG_EXTS)}
    orden: list[str] = []
    try:
        xml = z.read("word/document.xml").decode("utf-8", errors="replace")
        for m in re.finditer(r'r:(?:embed|link)="([^"]+)"', xml):
            name = rels.get(m.group(1))
            if name and name in disponibles and name not in orden:
                orden.append(name)
    except Exception:
        pass

    def _nat(n: str):
        m = re.search(r"(\d+)", n.rsplit("/", 1)[-1])
        return (int(m.group(1)) if m else 10 ** 9, n)
    for n in sorted(disponibles - set(orden), key=_nat):
        orden.append(n)
    return orden, rels


def _docx_bloques(d, rels: dict[str, str]) -> list[dict]:
    """Cuerpo del DOCX en orden real: [{texto, salto_antes, imagenes:[nombre…]}] por párrafo
    o tabla. `salto_antes` = hubo w:br type=page / w:lastRenderedPageBreak / sectPr antes del
    bloque → permite paginar como Word y no en trozos ficticios de 4500 chars."""
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    W = "{%s}" % _W_NS
    R = "{%s}" % _R_NS
    bloques: list[dict] = []
    pendiente_salto = False
    body = d.element.body
    for child in body.iterchildren():
        tag = child.tag
        if tag == W + "p":
            texto = (Paragraph(child, d).text or "").strip()
            # saltos de página dentro del párrafo
            saltos = [br for br in child.iter(W + "br") if br.get(W + "type") == "page"]
            saltos += list(child.iter(W + "lastRenderedPageBreak"))
            imgs = []
            for blip in child.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}blip"):
                rid = blip.get(R + "embed") or blip.get(R + "link")
                name = rels.get(rid or "")
                if name:
                    imgs.append(name)
            for imd in child.iter("{urn:schemas-microsoft-com:vml}imagedata"):
                rid = imd.get(R + "id")
                name = rels.get(rid or "")
                if name and name not in imgs:
                    imgs.append(name)
            if texto or imgs:
                bloques.append({"texto": texto, "salto_antes": pendiente_salto or bool(saltos), "imagenes": imgs})
                pendiente_salto = False
            elif saltos:
                pendiente_salto = True
            if child.find(".//" + W + "sectPr") is not None:
                pendiente_salto = True
        elif tag == W + "tbl":
            filas = []
            try:
                for row in Table(child, d).rows:
                    cells = [(c.text or "").strip().replace("\n", " ") for c in row.cells]
                    line = " | ".join(c for c in cells if c)
                    if line.strip(" |"):
                        filas.append(line)
            except Exception:
                pass
            if filas:
                bloques.append({"texto": "\n".join(filas), "salto_antes": pendiente_salto, "imagenes": []})
                pendiente_salto = False
        elif tag == W + "sectPr":
            pendiente_salto = True
    return bloques


def _docx_a_unidades(blob: bytes, nombre: str) -> list[dict]:
    """DOCX → páginas de texto (cuerpo en orden: párrafos y tablas intercalados, cortado por
    los saltos de página reales del documento; si no hay, trozos ⟦bloque⟧ de 4500 chars) +
    una unidad 'imagenes' (PDF sintético) con las imágenes embebidas EN ORDEN DE APARICIÓN
    en el cuerpo (r:embed), para OCR. Cada imagen deja un marcador
    `[imagen N: word/media/imageK.jpg]` en el texto donde estaba."""
    out: list[dict] = []
    orden_imgs: list[str] = []
    rels: dict[str, str] = {}
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            orden_imgs, rels = _docx_media_en_orden(z)
    except Exception:
        pass
    idx_img = {n: i + 1 for i, n in enumerate(orden_imgs)}
    paginas_txt: list[str] = []
    try:
        from docx import Document
        d = Document(io.BytesIO(blob))
        bloques = _docx_bloques(d, rels)
        hay_saltos = any(b["salto_antes"] for b in bloques)
        cur: list[str] = []
        for b in bloques:
            if b["salto_antes"] and cur:
                paginas_txt.append("\n".join(cur))
                cur = []
            if b["texto"]:
                cur.append(b["texto"])
            for n in b["imagenes"]:
                cur.append(f"[imagen {idx_img.get(n, '?')}: {n} — ver páginas OCR de 'imágenes embebidas']")
        if cur:
            paginas_txt.append("\n".join(cur))
        if not hay_saltos:
            paginas_txt = _paginar_texto("\n".join(paginas_txt))
        else:
            # páginas reales pero muy largas (tablas enormes) → sub-cortar para no exceder el tope
            rec: list[str] = []
            for pg in paginas_txt:
                rec.extend(_paginar_texto(pg, 12000) or [""])
            paginas_txt = [x for x in rec if x.strip()]
    except Exception as e:
        print(f"[lote] python-docx falló en {nombre[:60]}: {str(e)[:100]}", flush=True)
    if paginas_txt:
        out.append(_unidad(nombre, "paginas", paginas=[{"texto": p} for p in paginas_txt]))
    images: list[tuple[str, bytes]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            for name in orden_imgs:
                try:
                    images.append((name, z.read(name)))
                except Exception:
                    continue
    except Exception:
        pass
    if images:
        synth = _images_to_synthetic_pdf(images)
        if synth:
            u = _unidad(f"{nombre} (imágenes embebidas)", "imagenes", data=synth)
            u["orden_imagenes"] = [n for n, _ in images]
            out.append(u)
    return out


def _xlsx_a_unidades(blob: bytes, nombre: str) -> tuple[list[dict], list[dict]]:
    """XLSX → una página por hoja (filas ' | '); requiere openpyxl (si falta → recorte)."""
    try:
        import openpyxl
    except Exception:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado",
                     "omitido": f"{nombre} (openpyxl no instalado)"}]
    try:
        wb = openpyxl.load_workbook(io.BytesIO(blob), read_only=True, data_only=True)
    except Exception as e:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "xlsx_ilegible",
                     "omitido": f"{nombre} ({str(e)[:80]})"}]
    paginas: list[dict] = []
    for ws in wb.worksheets:
        lines = []
        for row in ws.iter_rows(values_only=True):
            cells = ["" if v is None else str(v).strip() for v in row]
            if any(cells):
                lines.append(" | ".join(cells).rstrip(" |"))
        txt = f"[hoja: {ws.title}]\n" + "\n".join(lines)
        for chunk in _paginar_texto(txt, 12000):
            paginas.append({"texto": chunk})
    return ([_unidad(nombre, "paginas", paginas=paginas)] if paginas else []), []


def _xls_a_unidades(blob: bytes, nombre: str) -> tuple[list[dict], list[dict]]:
    try:
        import xlrd  # type: ignore
    except Exception:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado",
                     "omitido": f"{nombre} (.xls: xlrd no instalado)"}]
    try:
        wb = xlrd.open_workbook(file_contents=blob)
        paginas = []
        for sh in wb.sheets():
            lines = []
            for r in range(sh.nrows):
                cells = [str(sh.cell_value(r, c)).strip() for c in range(sh.ncols)]
                if any(cells):
                    lines.append(" | ".join(cells).rstrip(" |"))
            for chunk in _paginar_texto(f"[hoja: {sh.name}]\n" + "\n".join(lines), 12000):
                paginas.append({"texto": chunk})
        return ([_unidad(nombre, "paginas", paginas=paginas)] if paginas else []), []
    except Exception as e:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "xls_ilegible",
                     "omitido": f"{nombre} ({str(e)[:80]})"}]


def _doc_a_unidades(blob: bytes, nombre: str) -> tuple[list[dict], list[dict]]:
    """`.doc` legado → texto con `antiword` si está en PATH (no está en la imagen de Cloud
    Run por defecto); si no, recorte formato_no_soportado."""
    import shutil
    tool = shutil.which("antiword")
    if not tool:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado",
                     "omitido": f"{nombre} (.doc: antiword no disponible)"}]
    try:
        with _tempfile.NamedTemporaryFile(suffix=".doc", delete=False) as tf:
            tf.write(blob)
            path = tf.name
        try:
            res = _subprocess.run([tool, "-t", path], capture_output=True, timeout=60)
            txt = res.stdout.decode("utf-8", errors="replace")
        finally:
            try:
                os.unlink(path)
            except Exception:
                pass
        pags = [{"texto": p} for p in _paginar_texto(txt)]
        if not pags:
            return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "doc_sin_texto", "omitido": nombre}]
        return [_unidad(nombre, "paginas", paginas=pags)], []
    except Exception as e:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "doc_ilegible",
                     "omitido": f"{nombre} ({str(e)[:80]})"}]


def _leer_rar(blob: bytes) -> list[tuple[str, bytes]]:
    """Lista [(nombre, bytes)] de un RAR con `rarfile` (backends unar/bsdtar/7z/unrar)."""
    import rarfile
    with _tempfile.NamedTemporaryFile(suffix=".rar", delete=False) as tf:
        tf.write(blob)
        rar_path = tf.name
    out: list[tuple[str, bytes]] = []
    try:
        with rarfile.RarFile(rar_path) as rf:
            for info in rf.infolist():
                if info.is_dir():
                    continue
                try:
                    out.append((info.filename, rf.read(info)))
                except Exception as e:
                    out.append((info.filename, b""))
                    print(f"[lote] rar: no pude leer {info.filename[:60]}: {str(e)[:80]}", flush=True)
    finally:
        try:
            os.unlink(rar_path)
        except Exception:
            pass
    return out


def _expandir_contenedor(blob: bytes, nombre: str, prioridad: tuple[str, ...] | None = None,
                         depth: int = 0, vistos: dict[str, str] | None = None) -> tuple[list[dict], list[dict]]:
    """Blob de cualquier formato → (unidades de texto, recortes). SIN topes de cantidad: un ZIP
    con 9 PDFs produce 9 unidades ordenadas por la prioridad del perfil (título del archivo),
    no por `namelist()`. Lo que no se puede abrir (7z, .doc sin antiword, PDF cifrado, RAR
    sin backend) queda como recorte `formato_no_soportado` / `*_ilegible` — nunca en silencio."""
    recortes: list[dict] = []
    unidades: list[dict] = []
    if vistos is None:
        vistos = {}
    if not blob:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "vacio", "omitido": nombre}]
    if depth > 3:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "profundidad_zip>3", "omitido": nombre}]
    low = nombre.lower()
    head = blob[:8]

    def _hijos(entries: list[tuple[str, bytes]], prefix: str) -> None:
        # Orden determinista: prioridad del perfil sobre el nombre del archivo, luego nombre.
        ranked = sorted(entries, key=lambda e: (rank_documento(e[0], None, prioridad or PRIORIDAD_DEFAULT)[0],
                                                e[0].lower()))
        imgs: list[tuple[str, bytes]] = []
        for name, data in ranked:
            base = name.rsplit("/", 1)[-1]
            if not base or name.endswith("/"):
                continue
            if base.lower().endswith(_IMG_EXTS):
                imgs.append((name, data))
                continue
            # Mismo archivo publicado varias veces dentro del paquete (acta repetida como
            # "cuadro de evaluación"): se procesa UNA vez y el duplicado queda registrado
            # como recorte `duplicado_sha256` (señal formal: cuadro de evaluación ausente).
            if data:
                sha = _sha256_hex(data)
                if sha in vistos:
                    recortes.append({"donde": f"contenedor:{prefix[:80]}", "limite": "duplicado_sha256",
                                     "omitido": f"{name} (= copia byte a byte de {vistos[sha]})"})
                    continue
                vistos[sha] = f"{prefix}{name}"
            u, r = _expandir_contenedor(data, f"{prefix}{name}", prioridad, depth + 1, vistos)
            unidades.extend(u)
            recortes.extend(r)
        if imgs:
            synth = _images_to_synthetic_pdf(imgs)
            if synth:
                unidades.append(_unidad(f"{prefix}{len(imgs)} imágenes (escaneo→PDF)", "imagenes", data=synth))
            else:
                recortes.append({"donde": f"contenedor:{prefix[:80]}", "limite": "imagenes_ilegibles",
                                 "omitido": [n for n, _ in imgs][:20]})

    if head[:4] == b"Rar!":
        try:
            entries = _leer_rar(blob)
        except Exception as e:
            return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "rar_no_extraible",
                         "omitido": f"{nombre} ({type(e).__name__}: {str(e)[:100]})"}]
        _hijos(entries, f"{nombre}/")
        return unidades, recortes
    if head[:2] == b"PK":
        if _is_docx_blob(blob):
            return _docx_a_unidades(blob, nombre), []
        if low.endswith(".xlsx") or _es_xlsx_blob(blob):
            return _xlsx_a_unidades(blob, nombre)
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                entries = []
                for info in z.infolist():
                    if info.is_dir():
                        continue
                    try:
                        entries.append((info.filename, z.read(info)))
                    except Exception as e:
                        recortes.append({"donde": f"contenedor:{nombre[:80]}", "limite": "zip_entrada_ilegible",
                                         "omitido": f"{info.filename} ({str(e)[:60]})"})
        except zipfile.BadZipFile:
            return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "zip_corrupto", "omitido": nombre}]
        _hijos(entries, f"{nombre}/")
        return unidades, recortes
    if head[:4] == b"%PDF":
        try:
            import fitz
            d = fitz.open(stream=blob, filetype="pdf")
            if d.is_encrypted and not d.authenticate(""):
                d.close()
                return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "pdf_cifrado", "omitido": nombre}]
            d.close()
        except Exception:
            pass
        return [_unidad(nombre, "pdf", data=blob)], []
    if head[:6] == b"7z\xbc\xaf\x27\x1c":
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado", "omitido": f"{nombre} (.7z)"}]
    if head[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":  # OLE2: .doc / .xls
        if low.endswith(".xls"):
            return _xls_a_unidades(blob, nombre)
        return _doc_a_unidades(blob, nombre)
    if low.endswith(_IMG_EXTS) or head[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1", b"II*\x00", b"MM\x00*"):
        synth = _images_to_synthetic_pdf([(nombre, blob)])
        if synth:
            return [_unidad(nombre, "imagenes", data=synth)], []
    if low.endswith((".txt", ".csv", ".md")):
        try:
            txt = blob.decode("utf-8", errors="replace")
            return [_unidad(nombre, "paginas", paginas=[{"texto": p} for p in _paginar_texto(txt)])], []
        except Exception:
            pass
    return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado",
                 "omitido": f"{nombre} (bytes {blob[:4].hex()}, {len(blob)} B)"}]


def _es_xlsx_blob(blob: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            return any(n == "xl/workbook.xml" for n in z.namelist())
    except Exception:
        return False


# ── Texto por página: Document AI o PyMuPDF (+ Gemini Vision para páginas rasterizadas) ──
def _paginas_pymupdf(pdf: bytes, page_offset: int) -> tuple[list[dict], list[dict]]:
    """Fallback sin Document AI: texto extraíble por página; las páginas rasterizadas
    (texto < 300 chars con imagen > 25 % del área) se transcriben con Gemini Vision en
    lotes de ≤ 8 PNGs. Devuelve (paginas, recortes)."""
    import fitz
    recortes: list[dict] = []
    layout = _analyze_pdf_layout(pdf)
    d = fitz.open(stream=pdf, filetype="pdf")
    paginas: list[dict] = []
    try:
        for i in range(len(d)):
            t = (d[i].get_text() or "").strip()
            paginas.append({"n": page_offset + i + 1, "texto": t, "chars": len(t)})
    finally:
        d.close()
    need = list(layout.get("needs_render_pages") or [])
    if need:
        try:
            rendered = _render_pdf_pages_to_png(pdf, need, dpi=160)
            for k in range(0, len(rendered), 8):
                lote = rendered[k:k + 8]
                textos = _ocr_paginas_gemini(lote)
                for (idx, _png), txt in zip(lote, textos):
                    if txt and len(txt) > paginas[idx]["chars"]:
                        paginas[idx] = {"n": page_offset + idx + 1, "texto": txt, "chars": len(txt), "ocr": "gemini_vision"}
        except Exception as e:
            recortes.append({"donde": "ocr_gemini_vision", "limite": "fallo",
                             "omitido": f"páginas rasterizadas {[page_offset + i + 1 for i in need][:30]} ({str(e)[:80]})"})
    return paginas, recortes


def _ocr_paginas_gemini(rendered: list[tuple[int, bytes]]) -> list[str]:
    """Transcripción literal de ≤ 8 páginas PNG con Gemini (solo fallback sin Document AI)."""
    from google.genai import types as gtypes
    client = _gemini_client()
    schema = gtypes.Schema(type=gtypes.Type.OBJECT, properties={
        "paginas": gtypes.Schema(type=gtypes.Type.ARRAY, items=gtypes.Schema(type=gtypes.Type.OBJECT, properties={
            "indice": gtypes.Schema(type=gtypes.Type.INTEGER), "texto": gtypes.Schema(type=gtypes.Type.STRING)},
            required=["indice", "texto"]))}, required=["paginas"])
    parts = [gtypes.Part.from_text(text=(
        f"Adjunto {len(rendered)} imágenes de páginas escaneadas (índices 0..{len(rendered) - 1}, en ese orden). "
        "Transcribí LITERALMENTE todo el texto de cada una (tablas como filas con ' | '). No resumas, no "
        "inventes, no completes. Si una página es ilegible, devolvé texto vacío para ese índice."))]
    for _idx, png in rendered:
        parts.append(gtypes.Part.from_bytes(data=png, mime_type="image/png"))
    cfg = gtypes.GenerateContentConfig(response_mime_type="application/json", response_schema=schema,
                                       max_output_tokens=65535, temperature=0.0,
                                       http_options=gtypes.HttpOptions(timeout=PARSE_CALL_TIMEOUT_MS))
    with _throttle_gemini():
        resp = _gemini_call_with_retry(lambda: client.models.generate_content(
            model=DEFAULT_GEMINI_MODEL, contents=parts, config=cfg))
    data = _safe_parse_json((resp.text or "").strip()) or {}
    out = [""] * len(rendered)
    for p in (data.get("paginas") or []):
        try:
            i = int(p.get("indice"))
            if 0 <= i < len(out):
                out[i] = str(p.get("texto") or "").strip()
        except Exception:
            continue
    return out


def _texto_de_unidades(unidades: list[dict]) -> dict:
    """Todas las unidades → páginas con numeración GLOBAL continua ({n, texto, chars, archivo}),
    texto con marcadores ⟦archivo: …⟧ / ⟦p.N⟧, motor y recortes."""
    from tools.docai import docai_enabled, extract_docai, marcar_paginas
    use_docai = False
    try:
        use_docai = docai_enabled()
    except Exception:
        pass
    paginas: list[dict] = []
    recortes: list[dict] = []
    motores: set[str] = set()
    truncado = False

    def _ocr_unidad(u: dict, offset: int) -> tuple[list[dict], list[dict], bool, str | None]:
        """OCR de UNA unidad PDF con numeración global desde `offset` →
        (paginas, recortes, truncado, motor). Nunca levanta. El mismo PDF (sha256) dentro
        del proceso (acta repetida en dos ZIPs distintos del mismo lote) se OCR-ea UNA vez."""
        nombre = u["nombre"]
        pdf = u["data"]
        sha_u = _sha256_hex(pdf) if pdf else None
        cached = _unit_cache_get(sha_u) if sha_u else None
        if cached is not None:
            pags = [{**p, "n": offset + i + 1, "archivo": nombre} for i, p in enumerate(cached["paginas"])]
            print(f"[lote] unidad {nombre[:50]} · sha {sha_u[:8]} ya OCR-eada en este proceso → reutilizo {len(pags)} págs", flush=True)
            return pags, [dict(r) for r in cached["recortes"]], cached["truncado"], cached["motor"]
        pags, rec, trunc, motor = _ocr_unidad_real(u, offset)
        if sha_u and pags and not trunc:
            _unit_cache_put(sha_u, {"paginas": [{k: v for k, v in p.items() if k not in ("n", "archivo")} for p in pags],
                                    "recortes": rec, "truncado": trunc, "motor": motor})
        return pags, rec, trunc, motor

    def _ocr_unidad_real(u: dict, offset: int) -> tuple[list[dict], list[dict], bool, str | None]:
        nombre = u["nombre"]
        pdf = u["data"]
        res = None
        if use_docai:
            try:
                res = extract_docai(pdf, page_offset=offset)
            except Exception as e:
                print(f"[lote] docai falló en {nombre[:60]}: {str(e)[:100]}", flush=True)
                res = None
        if res:
            for p in res["paginas"]:
                p["archivo"] = nombre
            return res["paginas"], list(res.get("recortes") or []), bool(res.get("truncado")), "docai"
        try:
            pags, rec = _paginas_pymupdf(pdf, offset)
        except Exception as e:
            return [], [{"donde": f"ocr:{nombre[:80]}", "limite": "pdf_ilegible", "omitido": f"{nombre} ({str(e)[:80]})"}], True, None
        for p in pags:
            p["archivo"] = nombre
        return pags, rec, False, ("pymupdf+gemini_vision" if any(p.get("ocr") for p in pags) else "pymupdf")

    # Offsets de página GLOBALES precalculados (conteo con PyMuPDF, barato) → las unidades PDF
    # se OCR-ean EN PARALELO (PARSE_UNIT_WORKERS) conservando la numeración y el orden. Si
    # alguna unidad no se puede contar, se cae al recorrido secuencial histórico.
    pdf_units = [u for u in unidades if u["kind"] != "paginas"]
    offsets: dict[int, int] | None = {}
    if len(pdf_units) > 1 and PARSE_UNIT_WORKERS > 1:
        acc = 0
        for idx, u in enumerate(unidades):
            offsets[idx] = acc
            if u["kind"] == "paginas":
                acc += len(u["paginas"] or [])
            else:
                n = _n_paginas_pdf(u["data"])
                if n is None:
                    offsets = None
                    break
                acc += n
    else:
        offsets = None

    if offsets is not None:
        resultados: dict[int, tuple] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(PARSE_UNIT_WORKERS, len(pdf_units))) as ex:
            futs = {ex.submit(_ocr_unidad, u, offsets[idx]): idx
                    for idx, u in enumerate(unidades) if u["kind"] != "paginas"}
            for fut in concurrent.futures.as_completed(futs):
                idx = futs[fut]
                try:
                    resultados[idx] = fut.result()
                except Exception as e:  # _ocr_unidad no levanta; por si acaso
                    u = unidades[idx]
                    resultados[idx] = ([], [{"donde": f"ocr:{u['nombre'][:80]}", "limite": "pdf_ilegible",
                                             "omitido": f"{u['nombre']} ({str(e)[:80]})"}], True, None)
        for idx, u in enumerate(unidades):
            if u["kind"] == "paginas":
                offset = offsets[idx]
                for i, p in enumerate(u["paginas"] or []):
                    t = (p.get("texto") or "").strip()
                    paginas.append({"n": offset + i + 1, "texto": t, "chars": len(t), "archivo": u["nombre"]})
                motores.add("texto_nativo")
                continue
            pags, rec, trunc, motor = resultados[idx]
            paginas.extend(pags)
            recortes.extend(rec)
            truncado = truncado or trunc
            if motor:
                motores.add(motor)
    else:
        for u in unidades:
            offset = len(paginas)
            nombre = u["nombre"]
            if u["kind"] == "paginas":
                for i, p in enumerate(u["paginas"] or []):
                    t = (p.get("texto") or "").strip()
                    paginas.append({"n": offset + i + 1, "texto": t, "chars": len(t), "archivo": nombre})
                motores.add("texto_nativo")
                continue
            pags, rec, trunc, motor = _ocr_unidad(u, offset)
            paginas.extend(pags)
            recortes.extend(rec)
            truncado = truncado or trunc
            if motor:
                motores.add(motor)
    # Texto con marcadores; cabecera ⟦archivo⟧ cuando cambia la unidad (contenedores).
    partes: list[str] = []
    cur_archivo = None
    multi = len({p.get("archivo") for p in paginas}) > 1
    for p in paginas:
        if multi and p.get("archivo") != cur_archivo:
            cur_archivo = p.get("archivo")
            partes.append(f"⟦archivo: {cur_archivo}⟧")
        partes.append(f"⟦p.{p['n']}⟧\n{p.get('texto') or ''}")
    texto = "\n".join(partes).strip()
    motor = "+".join(sorted(motores)) if len(motores) > 1 else (next(iter(motores)) if motores else "ninguno")
    return {"paginas": paginas, "texto": texto, "n_paginas": len(paginas), "chars": sum(p["chars"] for p in paginas),
            "motor": motor, "truncado": truncado or any(p.get("error") for p in paginas), "recortes": recortes}


_UNIT_CACHE: "_OrderedDict[str, dict]" = _OrderedDict()
_UNIT_CACHE_LOCK = threading.Lock()
_UNIT_CACHE_MAX = max(0, int(os.getenv("PARSE_UNIT_CACHE_MAX", "64") or 64))


def _unit_cache_get(sha: str) -> dict | None:
    with _UNIT_CACHE_LOCK:
        r = _UNIT_CACHE.get(sha)
        if r is not None:
            _UNIT_CACHE.move_to_end(sha)
        return r


def _unit_cache_put(sha: str, res: dict) -> None:
    if _UNIT_CACHE_MAX <= 0:
        return
    with _UNIT_CACHE_LOCK:
        _UNIT_CACHE[sha] = res
        _UNIT_CACHE.move_to_end(sha)
        while len(_UNIT_CACHE) > _UNIT_CACHE_MAX:
            _UNIT_CACHE.popitem(last=False)


def _n_paginas_pdf(pdf_bytes: bytes) -> int | None:
    """Páginas de un PDF (PyMuPDF); None si no se puede abrir."""
    try:
        import fitz
        src = fitz.open(stream=pdf_bytes, filetype="pdf")
        n = src.page_count
        src.close()
        return n
    except Exception:
        return None


# ── Caché en BD: documentos_texto (+ memoria del proceso: si la BD no está, el mismo PDF
#    publicado 2-3 veces en el lote igual se OCR-ea una sola vez) ─────────────────────────
_TX_MEM: "_OrderedDict[str, dict]" = _OrderedDict()
_TX_MEM_LOCK = threading.Lock()
_TX_MEM_MAX = max(0, int(os.getenv("PARSE_TEXTO_MEM_MAX", "64") or 64))


def _tx_mem_get(sha256: str) -> dict | None:
    with _TX_MEM_LOCK:
        tx = _TX_MEM.get(sha256)
        if tx is not None:
            _TX_MEM.move_to_end(sha256)
            return json.loads(json.dumps(tx, ensure_ascii=False, default=str))
    return None


def _tx_mem_put(sha256: str, tx: dict) -> None:
    if _TX_MEM_MAX <= 0 or not sha256:
        return
    with _TX_MEM_LOCK:
        _TX_MEM[sha256] = {k: v for k, v in tx.items() if k != "extraccion"} | {"extraccion": dict(tx.get("extraccion") or {})}
        _TX_MEM.move_to_end(sha256)
        while len(_TX_MEM) > _TX_MEM_MAX:
            _TX_MEM.popitem(last=False)


def _texto_cache_get(sha256: str) -> dict | None:
    """Fila de documentos_texto con la versión actual del extractor de texto, o None
    (antes, la copia en memoria del proceso)."""
    if not sha256:
        return None
    mem = _tx_mem_get(sha256)
    if mem is not None:
        return mem
    try:
        conn = _pg()
    except Exception:
        return None
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT n_paginas, texto, paginas, truncado, motor, formato, extraccion, recortes
                 FROM documentos_texto WHERE sha256=%s AND version_parser=%s""",
            (sha256, VERSION_PARSER),
        )
        row = cur.fetchone()
        if not row:
            return None
        n_paginas, texto, paginas, truncado, motor, formato, extraccion, recortes = row
        if isinstance(paginas, str):
            paginas = json.loads(paginas)
        if isinstance(extraccion, str):
            extraccion = json.loads(extraccion)
        if isinstance(recortes, str):
            recortes = json.loads(recortes)
        return {"n_paginas": n_paginas, "texto": texto or "", "paginas": paginas or [], "truncado": bool(truncado),
                "motor": motor, "formato": formato, "extraccion": extraccion or {}, "recortes": recortes or [],
                "chars": sum(int(p.get("chars") or 0) for p in (paginas or []))}
    except Exception as e:
        print(f"[lote] documentos_texto no disponible (get): {str(e)[:120]}", flush=True)
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _texto_cache_put(sha256: str, ocid: str | None, url_gcs: str | None, formato: str | None, tx: dict) -> bool:
    if not sha256:
        return False
    _tx_mem_put(sha256, tx)
    try:
        conn = _pg()
    except Exception:
        return False
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO documentos_texto (sha256, ocid, url_gcs, formato, n_paginas, motor, version_parser,
                                             texto, paginas, truncado, recortes, actualizado_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, now())
               ON CONFLICT (sha256) DO UPDATE SET
                 ocid=COALESCE(EXCLUDED.ocid, documentos_texto.ocid), url_gcs=COALESCE(EXCLUDED.url_gcs, documentos_texto.url_gcs),
                 formato=EXCLUDED.formato, n_paginas=EXCLUDED.n_paginas, motor=EXCLUDED.motor,
                 version_parser=EXCLUDED.version_parser, texto=EXCLUDED.texto, paginas=EXCLUDED.paginas,
                 truncado=EXCLUDED.truncado, recortes=EXCLUDED.recortes, extraccion=NULL, actualizado_at=now()""",
            (sha256, _short_ocid(ocid) if ocid else None, url_gcs, formato, tx["n_paginas"], tx["motor"], VERSION_PARSER,
             tx["texto"], json.dumps(tx["paginas"], ensure_ascii=False), bool(tx["truncado"]),
             json.dumps(tx.get("recortes") or [], ensure_ascii=False)),
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"[lote] documentos_texto no disponible (put): {str(e)[:120]}", flush=True)
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _extraccion_cache_put(sha256: str, clave: str, extraccion: dict) -> bool:
    if not sha256:
        return False
    with _TX_MEM_LOCK:
        if sha256 in _TX_MEM:
            _TX_MEM[sha256].setdefault("extraccion", {})[clave] = json.loads(json.dumps(extraccion, ensure_ascii=False, default=str))
    try:
        conn = _pg()
    except Exception:
        return False
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE documentos_texto
                  SET extraccion = COALESCE(extraccion, '{}'::jsonb) || %s::jsonb, actualizado_at = now()
                WHERE sha256 = %s""",
            (json.dumps({clave: extraccion}, ensure_ascii=False, default=str), sha256),
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"[lote] documentos_texto no disponible (extraccion): {str(e)[:120]}", flush=True)
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ── Extracción estructurada sobre el texto (con reintento por rango de páginas) ────────
_SYSTEM_LOTE = (
    "Sos un extractor experto en documentos del Sistema Electrónico de Contrataciones del Estado "
    "(SEACE) del Perú y del OECE (ex-OSCE): Bases Administrativas/Integradas, Términos de Referencia "
    "(TDR), Especificaciones Técnicas (EETT), Expedientes Técnicos, Resúmenes Ejecutivos e informes "
    "que sustentan una contratación directa, Actas de Buena Pro, Cuadros de evaluación, Contratos, "
    "Órdenes de compra/servicio, Adendas y Propuestas.\n\n"
    "ENTRADA: el TEXTO OCR del documento completo. Cada página empieza con un marcador ⟦p.N⟧ (N = número "
    "de página). Si el documento es un paquete (ZIP/RAR), cada archivo interno empieza con ⟦archivo: nombre⟧ "
    "y la numeración de páginas es continua a lo largo de todos los archivos.\n\n"
    "SALIDA: SOLO JSON conforme al schema. Sos un EXTRACTOR PURO: volcás HECHOS del documento a campos "
    "discretos. NO emitís juicios legales ni banderas de riesgo (eso lo hace otro agente sobre tu output).\n\n"
    "REGLAS DE INTEGRIDAD (innegociables):\n"
    "  · NUNCA inventes contenido. Si un dato no está en el texto, el campo va null / lista vacía. Preferí "
    "campo vacío a campo inventado. JAMÁS uses placeholders ni ejemplos de memoria (marcas, RUC, nombres, "
    "normas, cifras) que no aparezcan literalmente en el texto.\n"
    "  · EVIDENCIA OBLIGATORIA: cada ítem, postor, firmante, miembro de comité, motivo de adjudicación, "
    "estudio de mercado, contrato final y bloque del perfil lleva `evidencia: [{pagina, cita}]` con la "
    "página del marcador ⟦p.N⟧ donde aparece y una cita textual copiada tal cual (≤ 240 chars). Sin "
    "evidencia el dato no se persiste; con evidencia falsa (cita que no está en esa página) el dato se "
    "descarta y se cuenta como alucinación.\n"
    "  · `texto_literal` de cada ítem es un EXTRACTO LITERAL (copiado, sin resumir ni reescribir) del "
    "requerimiento técnico de ese ítem, hasta 4000 chars, con `texto_literal_paginas` = páginas que abarca. "
    "El resumen legible lo hace otro agente: vos no resumís.\n"
    "  · Copiá marcas, normas, cifras y nombres LITERALES del texto — no traduzcas, no normalices, no completes.\n"
    "  · PÁGINA = el número N del marcador ⟦p.N⟧ bajo el que está el texto que citás (índice real del archivo). "
    "NUNCA uses el número impreso al pie de la hoja (folio 'Página 22 de 69'): si lo ves, ponelo en `folio`.\n"
    "  · ETAPA DEL DOCUMENTO — precios y marcas van en el campo de SU etapa:\n"
    "      – BASES / INTEGRADAS / TDR / EETT / EXPEDIENTE / RESUMEN EJECUTIVO (requerimiento): "
    "`precio_unitario_referencial`, `cuantia_referencial_item`, `marca_o_modelo_exigido`. La marca exigida SOLO "
    "si el requerimiento dice literalmente 'marca', 'modelo', 'o equivalente' u 'o similar' junto a un nombre "
    "comercial; códigos de parte o accesorios con nombre propio NO son una marca exigida (van en texto_literal). "
    "`marca_ofertada`, `precio_unitario_ofertado` y `precio_unitario_contratado` quedan null.\n"
    "      – PROPUESTA / ACTA / CUADRO DE EVALUACIÓN: `precio_unitario_ofertado` y `marca_ofertada`; "
    "`precio_unitario_referencial` y `marca_o_modelo_exigido` null (aunque el acta repita el valor referencial: "
    "ese va en `cuantia_referencial_item`).\n"
    "      – CONTRATO / ORDEN DE COMPRA O SERVICIO / ADENDA: `precio_unitario_contratado`, `subtotal_contratado` y "
    "`marca_ofertada`; `precio_unitario_referencial` y `marca_o_modelo_exigido` null. La OC repite las EETT: eso "
    "NO la convierte en requerimiento (`contiene_requerimiento=false`).\n"
    "  · POSTORES: en reportes de propuestas, actas, cuadros y Formato 11 listá a TODOS los postores (ganador y "
    "perdedores) con su RUC, `monto_oferta` (sección 'precio de la oferta' / 'orden de prelación'), `puntaje`, "
    "`orden_prelacion` y `estado` (admitido / no_admitido / descalificado / desierto / participante_sin_oferta). "
    "Los proveedores INVITADOS (Comparación de Precios: formato de invitación / anexo) van en `invitados`, no en "
    "`postores`, salvo que además hayan ofertado.\n"
    "  · BASES / TDR / EETT / RESUMEN EJECUTIVO son PRE-adjudicación: NO tienen comité, motivos de adjudicación ni "
    "acta. En esos documentos dejá `comite_evaluacion=[]`, `motivos_adjudicacion=[]`, `lugar_fecha_acta=null`. "
    "Sí podés listar en `firmantes` a quienes FIRMAN el requerimiento/EETT (residente, inspector, área usuaria, "
    "jefe que aprueba) con `rol_en_documento='area_usuaria'` si su nombre y cargo son visibles (sellos/firmas). "
    "Comité, OEC, motivos y acta solo en ACTAS / CUADROS DE EVALUACIÓN / CONTRATOS.\n"
    "  · EVALUACIÓN Y CONSULTAS (`procedimiento_seleccion`): en bases/integradas volcá los factores de evaluación "
    "con su puntaje máximo; en actas/cuadros los puntajes por postor y factor; en el pliego de absolución cada "
    "consulta/observación (quién la hizo, tema, si se acogió y qué cambió en las bases); en bases integradas las "
    "modificaciones respecto de las bases originales y a pedido de quién.\n"
    "  · EJECUCIÓN (`ejecucion_contractual`): en adendas, resoluciones y cartas posteriores al contrato volcá "
    "ampliaciones de plazo (días pedidos, quién, resultado procedente/improcedente, acto que resuelve), penalidades "
    "aplicadas, adendas y entregas (prevista/real). Null en bases, actas de buena pro y OC originales.\n"
    "  · FIRMANTE válido solo si hay (a) DNI visible, o (b) entidad REAL con nombre concreto, o (c) firma "
    "legible al pie con nombre. Plantillas/proformas ('POSTOR 1', 'EL CONTRATISTA', 'Juan Pérez') → no van.\n"
    "  · El OBJETO del contrato viene del OCDS y debe coincidir con lo que extraés. Si tu extracción "
    "discrepa radicalmente, revisá tu lectura del texto.\n"
    "  · Si el texto es ilegible o está vacío: contiene_requerimiento=false, items=[], resumen='No se pudo "
    "extraer información legible del documento'.\n"
)


def _prompt_lote(label: str, bloque: str | None, ocds_ctx: dict, rango: tuple[int, int] | None,
                 tipo_hint: str | None) -> str:
    objeto = str(ocds_ctx.get("objeto") or "")[:600]
    entidad = str(ocds_ctx.get("entidad") or "")[:200]
    items_ocds = ocds_ctx.get("items") or []
    items_txt = "\n".join(f"  - ítem {i + 1}: {str(it)[:200]}" for i, it in enumerate(items_ocds[:40]))
    rango_txt = (f"Este texto cubre SOLO las páginas {rango[0]}-{rango[1]} del documento (extracción por rango: "
                 "extraé todo lo que haya en estas páginas; lo demás lo cubren otras llamadas).\n") if rango else ""
    bloque_txt = ""
    if bloque == "servicio":
        bloque_txt = ("BLOQUE `servicio` (perfil SERVICIOS/CONSULTORÍA): si el documento describe el servicio (TDR/Bases), "
                      "completá alcance (literal), actividades, entregables con plazo y % de pago, plazo total, personal "
                      "clave (cargo, profesión, años, dedicación), experiencia exigida al postor, tarifas (concepto/unidad/precio), "
                      "penalidades, si se permite subcontratar, forma de pago y lugar. Cada entregable/personal/tarifa con su página.\n")
    elif bloque == "obra":
        bloque_txt = ("BLOQUE `obra` (perfil OBRAS): expediente técnico (memoria literal, presupuesto total, partidas con "
                      "metrado/unidad/precio/parcial, GG % y utilidad %, plazo, cronograma), requisitos de residente y supervisor, "
                      "garantía de fiel cumplimiento, adelantos; y si es adenda/valorización: adicionales (n, monto, % acumulado, "
                      "motivo, resolución), ampliaciones de plazo y valorizaciones. Cada partida/adicional con su página.\n")
    elif bloque == "sustento_directa":
        bloque_txt = ("BLOQUE `sustento_directa` (perfil OTROS: directa/convenio/consultoría por causal): causal invocada "
                      "(artículo y texto LITERAL), informe técnico e informe legal (número, fecha, firmante), acto aprobatorio "
                      "(tipo, número, fecha), cotizaciones (proveedor, RUC, monto, fecha), justificación de proveedor único, fecha "
                      "de publicación en SEACE; para convenios: entidades parte, objeto, aportes, vigencia.\n")
    return (
        f"DOCUMENTO: {label}\n"
        + (f"Tipo declarado en SEACE: {tipo_hint}\n" if tipo_hint else "")
        + f"CONTEXTO OCDS — entidad: {entidad} · objeto: {objeto}\n"
        + (f"Ítems del OCDS (referencia para numerar; NO para inventar):\n{items_txt}\n" if items_txt else "")
        + rango_txt
        + "\nHacé esto, en orden:\n"
        "PASO 1 — `tipo_documento_detectado` por el contenido; `contiene_requerimiento` si hay sección REQUERIMIENTO / "
        "TDR / EETT / expediente técnico con detalle.\n"
        "PASO 2 — `items[]`: un objeto por ítem del proceso (cada fila de una tabla de ítems es un ítem; si el OCDS "
        "tiene 1 ítem que agrupa varios productos, sub-numerá 1.1, 1.2 con `padre_ocds_item`='1' y conservá el padre). "
        "Para cada ítem: campos discretos (cantidad, unidad, precio SEGÚN LA ETAPA del documento —referencial en bases, "
        "ofertado en propuesta/acta, contratado en contrato/OC—, marca exigida SOLO en bases y SOLO si el texto dice "
        "'marca'/'modelo'/'o equivalente', marca ofertada en OC/contrato/propuesta, normas, valores técnicos, garantía, "
        "entrega con tipo de días, requisitos del postor, penalidades, subitems) + `texto_literal` (extracto literal "
        "≤ 4000 chars) + `texto_literal_paginas` + `evidencia`.\n"
        "PASO 3 — `postores` (TODOS, con monto/puntaje/orden/estado) e `invitados` si el documento los lista; "
        "`comite_evaluacion`, `motivos_adjudicacion`, `lugar_fecha_acta` SOLO si es acta/cuadro/contrato; `firmantes` "
        "en actas/cuadros/contratos y, en bases, quienes firman el requerimiento (rol area_usuaria). Todo con evidencia y página.\n"
        "PASO 4 — `fundamento_legal`: normas citadas literalmente por el documento. `cuantia_reservada` si las bases dicen "
        "que el valor referencial no se publica.\n"
        "PASO 5 — `estudio_mercado` SOLO si es Resumen Ejecutivo / informe de sustento; `contrato_final` SOLO si es "
        "contrato / orden de compra o servicio firmado; `procedimiento_seleccion` si hay factores de evaluación, puntajes, "
        "consultas absueltas o modificaciones de la integración; `ejecucion_contractual` SOLO en documentos posteriores al "
        "contrato (adendas, resoluciones de ampliación, penalidades, entregas). En cualquier otro caso van null.\n"
        + (f"PASO 6 — {bloque_txt}" if bloque_txt else "")
        + "PASO FINAL — `cuantia_total`, `fuente_financiamiento`, `modalidad` y `resumen` (3-4 líneas del documento REAL).\n"
        "Devolvé SOLO JSON. Sin markdown, sin fences, sin texto antes ni después."
    )


def _finish_reason(resp) -> str:
    try:
        return str(resp.candidates[0].finish_reason or "")
    except Exception:
        return ""


def _llamar_extractor(texto: str, label: str, bloque: str | None, ocds_ctx: dict,
                      rango: tuple[int, int] | None, tipo_hint: str | None) -> tuple[dict, bool, dict]:
    """Una llamada Gemini sobre `texto`. Devuelve (data, truncado, uso)."""
    from google.genai import types as gtypes
    client = _gemini_client()
    cfg_kwargs = dict(
        response_mime_type="application/json",
        response_schema=_parser_schema(bloque, secciones_para_documento(label, tipo_hint)),
        max_output_tokens=65535,
        http_options=gtypes.HttpOptions(timeout=PARSE_CALL_TIMEOUT_MS),
        system_instruction=_SYSTEM_LOTE,
    )
    temp = os.getenv("PARSER_TEMPERATURE", "").strip()
    if temp:
        try:
            cfg_kwargs["temperature"] = float(temp)
        except ValueError:
            pass
    config = gtypes.GenerateContentConfig(**cfg_kwargs)
    parts = [
        gtypes.Part.from_text(text="═══ TEXTO OCR DEL DOCUMENTO (marcadores ⟦p.N⟧ por página) ═══\n" + texto),
        gtypes.Part.from_text(text=_prompt_lote(label, bloque, ocds_ctx, rango, tipo_hint)),
    ]
    descartados = list(_ULTIMOS_DESCARTES)
    model = os.getenv("PARSER_MODEL", DEFAULT_GEMINI_MODEL)
    t0 = time.monotonic()
    with _throttle_gemini():
        resp = _gemini_call_with_retry(lambda: client.models.generate_content(
            model=model, contents=parts, config=config))
    dt = time.monotonic() - t0
    raw_text = (resp.text or "").strip()
    fr = _finish_reason(resp)
    truncado = "MAX_TOKENS" in fr.upper()
    try:
        data = json.loads(raw_text)
    except Exception:
        data = _safe_parse_json(raw_text)
        truncado = True  # solo se pudo recuperar cerrando llaves → hubo corte
    if not isinstance(data, dict):
        data = {}
    # 2.ª pasada: los bloques que no cupieron en el schema (límite de Gemini) se piden aparte
    # sobre el mismo texto y se fusionan. Cuesta una llamada extra solo en documentos de
    # contrato/acta con perfil no-bienes.
    if descartados:
        try:
            cfg2 = dict(cfg_kwargs)
            cfg2["response_schema"] = _schema_solo(descartados, bloque)
            cfg2["max_output_tokens"] = 16384
            parts2 = [parts[0], gtypes.Part.from_text(text=(
                f"Del TEXTO OCR anterior extraé SOLO los bloques {descartados} (documento: {label}; "
                f"tipo declarado: {tipo_hint or 'desconocido'}). Si el documento no contiene ese bloque, devolvé null. "
                "Cada dato con `evidencia` (página y cita literal). Devolvé SOLO JSON."))]
            with _throttle_gemini():
                resp2 = _gemini_call_with_retry(lambda: client.models.generate_content(
                    model=model, contents=parts2, config=gtypes.GenerateContentConfig(**cfg2)))
            d2 = _safe_parse_json((resp2.text or "").strip()) or {}
            if isinstance(d2, dict):
                for k in descartados:
                    if d2.get(k) is not None and data.get(k) in (None, {}, []):
                        data[k] = d2[k]
            um2 = getattr(resp2, "usage_metadata", None)
            if um2:
                dt += 0.0
                data.setdefault("_uso_segunda_pasada", {"tokens_prompt": int(getattr(um2, "prompt_token_count", 0) or 0),
                                                       "tokens_output": int(getattr(um2, "candidates_token_count", 0) or 0),
                                                       "bloques": descartados})
        except Exception as e:  # noqa: BLE001 — la 2.ª pasada nunca tumba la extracción principal
            print(f"[lote] 2.ª pasada ({descartados}) falló: {str(e)[:120]}", flush=True)
    um = getattr(resp, "usage_metadata", None)
    uso = {"modelo": model, "segundos": round(dt, 1), "finish_reason": fr,
           "tokens_prompt": int(getattr(um, "prompt_token_count", 0) or 0) if um else 0,
           "tokens_output": int(getattr(um, "candidates_token_count", 0) or 0) if um else 0,
           "tokens_thoughts": int(getattr(um, "thoughts_token_count", 0) or 0) if um else 0}
    print(f"[lote-llm] {label[:50]} rango={rango} · {len(texto):,} chars → {uso['tokens_output']} tok out · "
          f"{dt:.0f}s · {fr}{' · TRUNCADO' if truncado else ''}", flush=True)
    return data, truncado, uso


def _merge_extraccion(a, b):
    """Fusión recursiva de dos extracciones (de rangos/llamadas distintas del MISMO doc):
    listas → concatenación con dedupe exacto; dicts → unión campo a campo; escalares →
    el primero no vacío."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = _merge_extraccion(a.get(k), v) if k in a else v
        return out
    if isinstance(a, list) and isinstance(b, list):
        out = list(a)
        seen = {json.dumps(x, sort_keys=True, default=str) for x in a}
        for x in b:
            key = json.dumps(x, sort_keys=True, default=str)
            if key not in seen:
                out.append(x)
                seen.add(key)
        return out
    if a in (None, "", [], {}):
        return b
    return a


def _texto_rango(paginas: list[dict], a: int, b: int) -> str:
    partes = []
    cur = None
    multi = len({p.get("archivo") for p in paginas}) > 1
    for p in paginas:
        if a <= p["n"] <= b:
            if multi and p.get("archivo") != cur:
                cur = p.get("archivo")
                partes.append(f"⟦archivo: {cur}⟧")
            partes.append(f"⟦p.{p['n']}⟧\n{p.get('texto') or ''}")
    return "\n".join(partes)


def _extraer_rango(paginas: list[dict], a: int, b: int, label: str, bloque: str | None, ocds_ctx: dict,
                   tipo_hint: str | None, recortes: list[dict], usos: list[dict], depth: int = 0,
                   rango_explicito: bool = False) -> dict:
    """Extrae las páginas [a, b]. Si el JSON llega truncado (MAX_TOKENS) y el rango tiene más
    de una página, se parte en dos y se re-pide cada mitad (hasta depth 2); si aun así se
    trunca, se registra el recorte y se devuelve lo recuperado con `_truncado=True`."""
    texto = _texto_rango(paginas, a, b)
    data, truncado, uso = _llamar_extractor(texto, label, bloque, ocds_ctx, (a, b) if rango_explicito else None, tipo_hint)
    usos.append({**uso, "rango": [a, b]})
    if not truncado:
        return data
    if b > a and depth < 2:
        mid = (a + b) // 2
        print(f"[lote] JSON truncado en págs {a}-{b} → re-pido {a}-{mid} y {mid + 1}-{b}", flush=True)
        left = _extraer_rango(paginas, a, mid, label, bloque, ocds_ctx, tipo_hint, recortes, usos, depth + 1, True)
        right = _extraer_rango(paginas, mid + 1, b, label, bloque, ocds_ctx, tipo_hint, recortes, usos, depth + 1, True)
        merged = _merge_extraccion(left, right)
        merged["_truncado"] = bool(left.get("_truncado") or right.get("_truncado"))
        return merged
    recortes.append({"donde": f"extraccion:{label[:80]}", "limite": "max_output_tokens=65535",
                     "omitido": f"páginas {a}-{b}: JSON truncado tras {depth} subdivisiones; se conserva lo recuperado"})
    data["_truncado"] = True
    return data


def _extraer_documento(tx: dict, label: str, bloque: str | None, ocds_ctx: dict, tipo_hint: str | None) -> dict:
    """Extracción estructurada de TODO el documento: se parte por páginas en llamadas de ≤
    PARSE_MAX_CHARS_POR_LLAMADA chars (nada se omite) y se fusiona. Devuelve la extracción con
    `_recortes`, `_usos` (tokens/tiempos por llamada) y `_truncado`."""
    paginas = tx["paginas"]
    recortes: list[dict] = []
    usos: list[dict] = []
    if not paginas:
        return {"_truncado": True, "_recortes": [{"donde": f"extraccion:{label[:80]}", "limite": "sin_texto", "omitido": label}],
                "_usos": [], "items": [], "resumen": "Documento sin texto extraíble"}
    # Rangos por chars
    rangos: list[tuple[int, int]] = []
    a = paginas[0]["n"]
    acc = 0
    for p in paginas:
        if acc + p["chars"] > PARSE_MAX_CHARS_POR_LLAMADA and acc > 0:
            rangos.append((a, p["n"] - 1))
            a = p["n"]
            acc = 0
        acc += p["chars"]
    rangos.append((a, paginas[-1]["n"]))
    if len(rangos) > 1:
        print(f"[lote] {label[:60]}: {tx['chars']:,} chars → {len(rangos)} llamadas por rango de páginas", flush=True)
    result: dict = {}
    if len(rangos) > 1 and PARSE_UNIT_WORKERS > 1:
        # Rangos de un mismo documento largo: llamadas independientes → en paralelo, fusión en
        # el orden de las páginas (los recortes/usos de cada rango se agregan tras el join).
        partes: list[dict | None] = [None] * len(rangos)
        recs: list[list] = [[] for _ in rangos]
        usos_r: list[list] = [[] for _ in rangos]
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(PARSE_UNIT_WORKERS, len(rangos))) as ex:
            futs = {ex.submit(_extraer_rango, paginas, ra, rb, label, bloque, ocds_ctx, tipo_hint,
                              recs[i], usos_r[i], 0, True): i for i, (ra, rb) in enumerate(rangos)}
            for fut in concurrent.futures.as_completed(futs):
                i = futs[fut]
                try:
                    partes[i] = fut.result()
                except Exception as e:
                    ra, rb = rangos[i]
                    recs[i].append({"donde": f"extraccion:{label[:80]}", "limite": "error_llamada",
                                    "omitido": f"páginas {ra}-{rb}: {type(e).__name__}: {str(e)[:120]}"})
                    partes[i] = {"_truncado": True}
        for i, parte in enumerate(partes):
            recortes.extend(recs[i])
            usos.extend(usos_r[i])
            result = _merge_extraccion(result, parte) if result else (parte or {})
    else:
        for i, (ra, rb) in enumerate(rangos):
            parte = _extraer_rango(paginas, ra, rb, label, bloque, ocds_ctx, tipo_hint, recortes, usos,
                                   rango_explicito=len(rangos) > 1)
            result = _merge_extraccion(result, parte) if result else parte
    result["_truncado"] = bool(result.get("_truncado")) or any(r.get("limite", "").startswith("max_output") for r in recortes)
    result["_recortes"] = recortes
    result["_usos"] = usos
    return result


# ── Post-proceso: evidencia verificable, sha256 por dato, alias de compat ──────────────
def _cita_en_pagina(cita: str, texto_pagina: str) -> bool:
    """¿La cita (normalizada) aparece en el texto de la página? Tolerante a espacios/tildes/caja;
    con citas largas basta con que aparezca un prefijo de 60 chars normalizados."""
    c = _norm_txt(cita or "")
    t = _norm_txt(texto_pagina or "")
    if not c or not t:
        return False
    if c in t:
        return True
    c2 = re.sub(r"[^A-Z0-9 ]", " ", c)
    t2 = re.sub(r"[^A-Z0-9 ]", " ", t)
    c2 = " ".join(c2.split()); t2 = " ".join(t2.split())
    if c2 and c2 in t2:
        return True
    return len(c2) > 60 and c2[:60] in t2


_FOLIO_RX = (
    re.compile(r"p[aá]g(?:ina)?\.?\s*(?:n[°º]?\s*)?(\d{1,3})\s*(?:de|/)\s*\d{1,3}", re.I),
    re.compile(r"^\s*(?:p[aá]g(?:ina)?\.?\s*)?(\d{1,3})\s*(?:de|/)\s*\d{1,3}\s*$", re.I | re.M),
    re.compile(r"^\s*(?:-\s*)?(\d{1,3})\s*(?:-\s*)?$", re.M),
)


def _detectar_folio(texto: str) -> int | None:
    """Número IMPRESO de página (folio) si el pie/cabecera lo trae: 'Página 22 de 69',
    '22 / 69' o un número suelto en las 3 últimas / 2 primeras líneas. None si no se ve.
    Es informativo: la página citada es SIEMPRE el índice real ⟦p.N⟧."""
    t = (texto or "").strip()
    if not t:
        return None
    lineas = [l for l in t.splitlines() if l.strip()]
    borde = "\n".join(lineas[-3:] + lineas[:2])
    pie = "\n".join(lineas[-2:])
    for i, rx in enumerate(_FOLIO_RX):
        m = rx.search(borde if i < 2 else pie)   # el número suelto solo cuenta en el pie
        if m:
            try:
                n = int(m.group(1))
                if 0 < n < 1000:
                    return n
            except Exception:
                continue
    return None


def _tokens_cita(cita: str) -> list[str]:
    c = re.sub(r"[^A-Z0-9 ]", " ", _norm_txt(cita or ""))
    return [t for t in c.split() if len(t) >= 3 or t.isdigit()]


def _cita_tokens_en_pagina(cita: str, texto_pagina: str) -> bool:
    """Bolsa de tokens: ≥ 85 % de los tokens de la cita (mín. 4) están en la página. Cubre
    filas de tabla que el OCR reordena o parte en dos líneas (Formato 11, tablas de la OC)."""
    toks = _tokens_cita(cita)
    if len(toks) < 4:
        return False
    t = " " + re.sub(r"[^A-Z0-9 ]", " ", _norm_txt(texto_pagina or "")) + " "
    t = " ".join(t.split())
    t = f" {t} "
    hits = sum(1 for k in toks if f" {k} " in t)
    return hits / len(toks) >= 0.85


def _verificar_evidencia(obj: dict, paginas_by_n: dict[int, dict], sha256: str | None, stats: dict) -> None:
    """Marca cada evidencia como verificada/no verificada contra el texto de la página y
    estampa `documento_sha256`. No borra nada: V (verify.py) decide qué persistir.
    Orden: página declarada → ±1 → TODAS las páginas (el LLM a veces cita el folio impreso
    en vez del índice ⟦p.N⟧: se corrige `pagina` y se conserva `pagina_declarada`) → bolsa de
    tokens en la página declarada ±1 (`verificacion='tokens'`). `folio` = número impreso
    detectado en la página final, si lo hay."""
    if not isinstance(obj, dict):
        return
    obj["documento_sha256"] = sha256
    evs = obj.get("evidencia")
    if not isinstance(evs, list):
        obj["evidencia"] = []
        return
    out = []
    for ev in evs:
        if not isinstance(ev, dict):
            continue
        cita = str(ev.get("cita") or "")[:CITA_MAX]
        pagina = ev.get("pagina")
        try:
            pagina = int(pagina) if pagina is not None else None
        except Exception:
            pagina = None
        declarada = pagina
        ok = False
        metodo = None
        if pagina is not None and pagina in paginas_by_n:
            ok = _cita_en_pagina(cita, paginas_by_n[pagina].get("texto") or "")
            if ok:
                metodo = "literal"
            if not ok:  # tolerancia ±1 página (tablas que cruzan de página)
                for q in (pagina - 1, pagina + 1):
                    if q in paginas_by_n and _cita_en_pagina(cita, paginas_by_n[q].get("texto") or ""):
                        ok, pagina, metodo = True, q, "literal"
                        break
        if not ok and len(_tokens_cita(cita)) >= 3:
            # folio impreso ≠ índice real: buscar la cita literal en todo el documento
            for q, pg in sorted(paginas_by_n.items()):
                if q == declarada:
                    continue
                if _cita_en_pagina(cita, pg.get("texto") or ""):
                    ok, pagina, metodo = True, q, "literal"
                    break
        if not ok and declarada is not None:
            for q in (declarada, declarada - 1, declarada + 1):
                if q in paginas_by_n and _cita_tokens_en_pagina(cita, paginas_by_n[q].get("texto") or ""):
                    ok, pagina, metodo = True, q, "tokens"
                    break
        stats["total"] = stats.get("total", 0) + 1
        stats["verificadas"] = stats.get("verificadas", 0) + (1 if ok else 0)
        e = {"pagina": pagina, "cita": cita, "verificada": ok, "documento_sha256": sha256}
        if metodo:
            e["verificacion"] = metodo
        if ok and declarada is not None and declarada != pagina:
            e["pagina_declarada"] = declarada
            stats["paginas_corregidas"] = stats.get("paginas_corregidas", 0) + 1
        folio = None
        if pagina is not None and pagina in paginas_by_n:
            folio = _detectar_folio(paginas_by_n[pagina].get("texto") or "")
        if folio is None:
            try:
                folio = int(ev["folio"]) if ev.get("folio") is not None else None
            except Exception:
                folio = None
        if folio is not None:
            e["folio"] = folio
        out.append(e)
    obj["evidencia"] = out


_KW_MARCA = ("MARCA", "MODELO", "EQUIVALENTE", "SIMILAR")


def _marca_respaldada(marca: str, paginas: list[dict]) -> tuple[bool, int | None]:
    """¿El texto del documento contiene la marca Y, en esa misma página, la palabra
    'marca'/'modelo'/'equivalente'/'similar'? Si no, la marca no fue EXIGIDA por ese
    documento (vino de otro lado o el LLM la infirió de códigos de parte)."""
    m = _norm_txt(marca or "")
    m = re.sub(r"\b(O|U)\s+(SIMILAR|EQUIVALENTE)\b", " ", m)
    m = re.sub(r"[^A-Z0-9 ]", " ", m)
    m = " ".join(m.split())
    if len(m) < 2:
        return False, None
    for pg in paginas or []:
        t = " ".join(re.sub(r"[^A-Z0-9 ]", " ", _norm_txt(pg.get("texto") or "")).split())
        if m in t and any(k in t for k in _KW_MARCA):
            return True, pg.get("n")
    return False, None


def _post_procesar(data: dict, tx: dict, sha256: str | None, doc: dict | None = None) -> dict:
    """Aplica verificación de evidencia a ítems/postores/firmantes/comité/motivos/bloques,
    recorta `texto_literal` al tope, y deja `requerimiento_tecnico_detallado` como ALIAS de
    `texto_literal` para los consumidores existentes (market, legal, self-eval).

    Además (lote 1 · T7) etiqueta cada ítem con la ETAPA del documento y remapea los campos
    según ella: en documentos de CONTRATACIÓN (contrato/OC/acta/propuesta) el precio va a
    `precio_unitario_contratado` (u `ofertado`) y la marca a `marca_ofertada`; nunca quedan
    como `precio_unitario_referencial` / `marca_o_modelo_exigido`. En documentos de
    REQUERIMIENTO, `marca_o_modelo_exigido` solo sobrevive si el texto del documento trae
    la marca junto a 'marca'/'modelo'/'equivalente'/'similar' (si no → `marca_no_respaldada`)."""
    paginas = tx.get("paginas") or []
    paginas_by_n = {int(p["n"]): p for p in paginas if p.get("n") is not None}
    stats: dict = {}
    tipo = data.get("tipo_documento_detectado")
    contratacion = _es_doc_contratacion(tipo, doc)
    data["_etapa"] = "contratacion" if contratacion else "requerimiento"
    descartes: list[dict] = list(data.get("_descartes_parser") or [])
    origen = _origen_precio(tipo, doc) if contratacion else None
    for it in (data.get("items") or []):
        if not isinstance(it, dict):
            continue
        tl = it.get("texto_literal")
        if isinstance(tl, str) and len(tl) > TEXTO_LITERAL_MAX:
            it["texto_literal"] = tl[:TEXTO_LITERAL_MAX]
            it["texto_literal_truncado"] = True
        if it.get("texto_literal") and not it.get("requerimiento_tecnico_detallado"):
            it["requerimiento_tecnico_detallado"] = it["texto_literal"]
        _verificar_evidencia(it, paginas_by_n, sha256, stats)
        it["_tipo_documento"] = tipo
        it["_etapa"] = data["_etapa"]
        if contratacion:
            pu = it.get("precio_unitario_contratado") or it.get("precio_unitario_ofertado") or it.get("precio_unitario_referencial")
            if origen in ("contrato", "orden_de_compra", "adenda"):
                it["precio_unitario_contratado"] = pu
                it.setdefault("precio_unitario_ofertado", None)
            else:
                it["precio_unitario_ofertado"] = pu
                it.setdefault("precio_unitario_contratado", None)
            it["origen_precio"] = origen if pu else None
            marca = it.get("marca_ofertada") or it.get("marca_o_modelo_exigido")
            it["marca_ofertada"] = marca or None
            if it.get("marca_o_modelo_exigido"):
                descartes.append({"campo": "marca_o_modelo_exigido", "valor": it["marca_o_modelo_exigido"],
                                  "motivo": f"documento de contratación ({tipo}): es marca ofertada, no exigida",
                                  "item": it.get("descripcion_corta")})
            it["marca_o_modelo_exigido"] = None
            it["precio_unitario_referencial"] = None
        else:
            marca = it.get("marca_o_modelo_exigido")
            if marca:
                ok, pg = _marca_respaldada(marca, paginas)
                if ok:
                    it["marca_exigida_pagina"] = pg
                else:
                    it["marca_no_respaldada"] = marca
                    it["marca_o_modelo_exigido"] = None
                    descartes.append({"campo": "marca_o_modelo_exigido", "valor": marca,
                                      "motivo": "el texto del requerimiento no exige esa marca (sin 'marca'/'modelo'/'o equivalente' junto al nombre)",
                                      "item": it.get("descripcion_corta")})
            if it.get("marca_ofertada"):
                it["marca_ofertada"] = None
        # texto_literal_paginas: si TODAS las evidencias verificadas se corrigieron con el
        # mismo desfase (folio impreso vs índice real), desplazar también estas páginas.
        deltas = {e["pagina"] - e["pagina_declarada"] for e in (it.get("evidencia") or [])
                  if isinstance(e, dict) and e.get("verificada") and e.get("pagina_declarada") is not None}
        if len(deltas) == 1 and isinstance(it.get("texto_literal_paginas"), list):
            d = deltas.pop()
            if d:
                it["texto_literal_paginas_declaradas"] = list(it["texto_literal_paginas"])
                it["texto_literal_paginas"] = [int(x) + d for x in it["texto_literal_paginas"] if isinstance(x, (int, float))]
    for key in ("postores", "firmantes", "comite_evaluacion", "motivos_adjudicacion", "invitados"):
        for obj in (data.get(key) or []):
            _verificar_evidencia(obj, paginas_by_n, sha256, stats)
    for key in ("estudio_mercado", "contrato_final", "procedimiento_seleccion", "ejecucion_contractual", *_BLOQUES_VALIDOS):
        obj = data.get(key)
        if isinstance(obj, dict):
            _verificar_evidencia(obj, paginas_by_n, sha256, stats)
            # sub-listas con `pagina`: estampar sha (la página la puso el LLM; folio si se detecta)
            for lk, lv in obj.items():
                if isinstance(lv, list):
                    for el in lv:
                        if isinstance(el, dict):
                            el["documento_sha256"] = sha256
                            pg = el.get("pagina")
                            if isinstance(pg, int) and pg in paginas_by_n:
                                f = _detectar_folio(paginas_by_n[pg].get("texto") or "")
                                if f is not None:
                                    el["folio"] = f
    if descartes:
        data["_descartes_parser"] = descartes
    data["_evidencia_stats"] = stats
    return data


def _perfil_params(state: dict, parser_bloque=None, prioridad=None, max_docs=None) -> tuple[str | None, tuple[str, ...], int]:
    """(parser_bloque, doc_prioridad, parse_max_docs) desde argumentos, state['perfil'] (dataclass
    Profile de P, dict o nombre) o defaults de BIENES."""
    perfil = state.get("perfil")
    if isinstance(perfil, str):
        try:
            from agents._shared import profiles as _prof  # type: ignore
            perfil = _prof.get_profile() if perfil == getattr(_prof, "PROFILE", None) else perfil
        except Exception:
            pass

    def _g(name, default):
        if isinstance(perfil, dict):
            return perfil.get(name, default)
        return getattr(perfil, name, default) if perfil is not None else default

    bloque = parser_bloque if parser_bloque is not None else _g("parser_bloque", None)
    if bloque not in (None, *_BLOQUES_VALIDOS):
        print(f"[lote] parser_bloque desconocido {bloque!r} → sin bloque", flush=True)
        bloque = None
    prio = tuple(prioridad or _g("doc_prioridad", None) or PRIORIDAD_DEFAULT)
    mx = int(max_docs or _g("parse_max_docs", None) or MAX_DOCS_DEFAULT)
    return bloque, prio, mx


def _ocds_ctx(state: dict) -> dict:
    cr = state.get("ocds") or {}
    tender = cr.get("tender") or {}
    return {"objeto": tender.get("description") or tender.get("title") or "",
            "entidad": (cr.get("buyer") or {}).get("name") or "",
            "items": [f"{(it.get('description') or '')[:140]} · cant {it.get('quantity')} {((it.get('unit') or {}).get('name') or '')}"
                      for it in (tender.get("items") or []) if isinstance(it, dict)]}


def _bytes_de_doc(doc: dict, state: dict) -> tuple[bytes | None, str, str | None]:
    """Bytes del documento: gs:// del DocRef → cadena histórica (_fetch_doc_bytes: b64 inline,
    doc_urls, downloader local, relay, directo)."""
    gs = doc.get("gs")
    if gs:
        blob, err = _download_from_gcs(gs)
        if blob is not None:
            return blob, "gcs", None
        print(f"[lote] gcs falló para {gs[:80]}: {err}", flush=True)
    url = doc.get("url")
    if url:
        class _Ctx:
            __slots__ = ("state",)

            def __init__(self, st):
                self.state = st
        return _fetch_doc_bytes(url, _Ctx(state))
    return None, "failed", "sin gs:// ni url"


_INFLIGHT_LOCK = threading.Lock()
_INFLIGHT: dict[str, threading.Event] = {}


def _sha_por_url_get(ocid: str | None, url: str | None) -> str | None:
    """sha256 conocido para (ocid, url) en `documentos` (migración 17) — evita bajar de nuevo un
    documento que no está en documentos_gcs pero cuyo texto ya está cacheado."""
    if not ocid or not url:
        return None
    try:
        conn = _pg()
    except Exception:
        return None
    try:
        cur = conn.cursor()
        cur.execute("SELECT sha256 FROM documentos WHERE ocid=%s AND blob_url=%s AND sha256 IS NOT NULL LIMIT 1",
                    (_short_ocid(ocid), url))
        row = cur.fetchone()
        return row[0] if row else None
    except Exception:
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _sha_por_url_put(ocid: str | None, url: str | None, sha256: str, doc: dict) -> None:
    if not ocid or not url or not sha256:
        return
    try:
        conn = _pg()
    except Exception:
        return
    try:
        cur = conn.cursor()
        cur.execute("UPDATE documentos SET sha256=%s WHERE ocid=%s AND blob_url=%s", (sha256, _short_ocid(ocid), url))
        if cur.rowcount == 0:
            cur.execute(
                """INSERT INTO documentos (ocid, tipo, nombre, blob_url, metadata, seccion, ocds_doc_id, sha256)
                   VALUES (%s, 'otro', %s, %s, %s, %s, %s, %s) ON CONFLICT (ocid, blob_url) DO UPDATE SET sha256=EXCLUDED.sha256""",
                (_short_ocid(ocid), doc.get("titulo") or "(sin título)", url,
                 json.dumps({"ocds_documentType": doc.get("tipo"), "format": doc.get("formato")}),
                 doc.get("seccion"), str(doc.get("id") or "") or None, sha256))
        conn.commit()
    except Exception as e:
        print(f"[lote] documentos.sha256 no actualizable: {str(e)[:100]}", flush=True)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _esperar_sha(sha: str) -> bool:
    """Si otro hilo del MISMO lote ya está procesando este sha (bytes idénticos publicados
    con dos URLs), espera a que termine y devuelve True (→ leer de caché). Si no, reclama el
    sha y devuelve False."""
    with _INFLIGHT_LOCK:
        ev = _INFLIGHT.get(sha)
        if ev is None:
            _INFLIGHT[sha] = threading.Event()
            return False
    ev.wait(timeout=PARSE_OVERALL_TIMEOUT_S)
    return True


def _liberar_sha(sha: str) -> None:
    with _INFLIGHT_LOCK:
        ev = _INFLIGHT.pop(sha, None)
    if ev is not None:
        ev.set()


def _procesar_doc(doc: dict, state: dict, bloque: str, prioridad: tuple[str, ...], ocds_ctx: dict) -> dict:
    """Pipeline de UN documento: caché de texto → (descarga → expansión → OCR → persistir) →
    caché de extracción → (extracción → persistir) → post-proceso. Devuelve un dict con
    `tx` (texto), `ext` (extracción), `recortes`, `tiempos`, `sha256`, `cache`."""
    t0 = time.monotonic()
    label = f"{doc.get('titulo') or doc.get('id') or 'documento'}"
    if doc.get("formato"):
        label += f" [{doc['formato']}]"
    out = {"doc": doc, "sha256": doc.get("sha256"), "recortes": [], "tiempos": {}, "cache": {"texto": False, "extraccion": False}}
    ocid = state.get("ocid") or state.get("ocid_preloaded")
    sha = doc.get("sha256") or _sha_por_url_get(ocid, doc.get("url"))
    if sha and not doc.get("sha256"):
        doc["sha256"] = sha
        doc["_sha_desde_documentos"] = True
        out["sha256"] = sha
    reclamado: str | None = None
    if sha:
        if _esperar_sha(sha):
            out["cache"]["esperado_en_lote"] = True
        else:
            reclamado = sha
    try:
        tx = _texto_cache_get(sha) if (sha and not PARSE_SKIP_TEXTO_CACHE) else None
        blob = None
        if tx is None:
            blob, fuente, err = _bytes_de_doc(doc, state)
            out["tiempos"]["descarga_s"] = round(time.monotonic() - t0, 1)
            if blob is None:
                out["error"] = f"download_failed: {err}"
                out["recortes"].append({"donde": f"descarga:{label[:80]}", "limite": "descarga_fallida", "omitido": f"{label} ({err})"})
                return out
            if not sha:
                sha = _sha256_hex(blob)
                out["sha256"] = sha
                doc["sha256"] = sha
                if _esperar_sha(sha):
                    out["cache"]["esperado_en_lote"] = True
                else:
                    reclamado = sha
                tx = None if PARSE_SKIP_TEXTO_CACHE else _texto_cache_get(sha)
            out["fuente"] = fuente
        return _procesar_doc_texto(doc, state, bloque, ocds_ctx, out, label, sha, tx, blob, t0, prioridad)
    finally:
        if reclamado:
            _liberar_sha(reclamado)


def _procesar_doc_texto(doc, state, bloque, ocds_ctx, out, label, sha, tx, blob, t0, prioridad) -> dict:
    """Segunda mitad de _procesar_doc: OCR (si hace falta) + extracción + post-proceso."""
    if tx is not None:
        out["cache"]["texto"] = True
        out["recortes"].extend(tx.get("recortes") or [])   # recortes del OCR original (chunks perdidos, etc.)
        print(f"[lote] texto en caché · {label[:60]} · {tx['n_paginas']} págs · {tx['chars']:,} chars", flush=True)
    else:
        t1 = time.monotonic()
        unidades, rec = _expandir_contenedor(blob, doc.get("titulo") or doc.get("url") or "documento", prioridad)
        out["recortes"].extend(rec)
        if not unidades:
            out["error"] = "sin_contenido_procesable"
            return out
        tx = _texto_de_unidades(unidades)
        tx["extraccion"] = {}
        out["recortes"].extend(tx.get("recortes") or [])
        out["tiempos"]["ocr_s"] = round(time.monotonic() - t1, 1)
        out["unidades"] = [{"nombre": u["nombre"], "kind": u["kind"]} for u in unidades]
        _texto_cache_put(sha, state.get("ocid") or state.get("ocid_preloaded"), doc.get("gs"), doc.get("formato"), tx)
        print(f"[lote] OCR · {label[:60]} · {len(unidades)} unidad(es) · {tx['n_paginas']} págs · {tx['chars']:,} chars · "
              f"{tx['motor']} · {out['tiempos']['ocr_s']}s", flush=True)
    out["tx"] = tx
    # ── extracción (cacheada por bloque + versión de schema + modelo) ──
    model = os.getenv("PARSER_MODEL", DEFAULT_GEMINI_MODEL)
    clave = f"{bloque or 'base'}@{PARSER_SCHEMA_VERSION}@{model}"
    ext = None
    if PARSE_REUSE_EXTRACCION and isinstance(tx.get("extraccion"), dict) and isinstance(tx["extraccion"].get(clave), dict):
        ext = tx["extraccion"][clave]
        out["cache"]["extraccion"] = True
        print(f"[lote] extracción en caché · {label[:60]} · {clave}", flush=True)
    if ext is None:
        t2 = time.monotonic()
        ext = _extraer_documento(tx, label, bloque, ocds_ctx, doc.get("tipo"))
        out["tiempos"]["extraccion_s"] = round(time.monotonic() - t2, 1)
        out["recortes"].extend(ext.get("_recortes") or [])
        ext = _post_procesar(ext, tx, sha, doc)
        _extraccion_cache_put(sha, clave, ext)   # incluye _recortes/_usos: en caché también se reportan
    else:
        out["recortes"].extend(ext.get("_recortes") or [])
    out["ext"] = ext
    out["tiempos"]["total_s"] = round(time.monotonic() - t0, 1)
    # Dejar el sha en `documentos` (ocid, url) también para los que vinieron de documentos_gcs:
    # cuando el blob expire (90 días) el texto sigue localizable por URL sin volver a bajarlo.
    if doc.get("url") and sha and not doc.get("_sha_desde_documentos"):
        _sha_por_url_put(state.get("ocid") or state.get("ocid_preloaded"), doc["url"], sha, doc)
    return out


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


def _norm_razon(s: str | None) -> str:
    """Razón social comparable: MAYÚSCULAS sin tildes ni puntuación ('S.A.C.' == 'SAC')."""
    return " ".join(re.sub(r"[^A-Z0-9 ]", "", _norm_txt(s or "")).split())


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


def _paginas_a_pdf_sintetico(paginas: list[dict]) -> bytes | None:
    """Páginas de texto ({texto}) → PDF sintético (una página A4 por entrada) para el
    pipeline legacy de parse_document_pdf."""
    try:
        import fitz
    except Exception:
        return None
    out = fitz.open()
    try:
        for p in paginas:
            page = out.new_page(width=595, height=842)
            try:
                page.insert_textbox(fitz.Rect(36, 36, 559, 806), str(p.get("texto") or "")[:6000],
                                    fontsize=9, fontname="helv")
            except Exception:
                pass
        if len(out) == 0:
            return None
        return out.tobytes()
    finally:
        out.close()


def _parse_single_pdf_with_gemini(blob: bytes, source_label: str) -> dict:
    """Procesa un PDF (bytes) con Gemini. Devuelve dict con extracción
    o {"error": ...}.

    Estrategia híbrida:
      1. Analiza la layout del PDF con PyMuPDF.
      2. Si hay páginas con texto < 300 chars + imagen cubriendo > 25% del área
         (típico cuando el REQUERIMIENTO está rasterizado como imagen embebida),
         renderiza esas páginas a PNG 160 DPI y se las pasa a Gemini como
         `image/png` parts adicionales junto con el PDF.
      3. Gemini hace OCR visual de alta calidad sobre los PNGs y combina con el
         texto extraíble del resto del PDF.
    """
    from google.genai import types as gtypes
    client = _gemini_client()

    # ── Análisis layout ─────────────────────────────────────────────
    layout = _analyze_pdf_layout(blob)

    # ── Document AI OCR (per-use): texto del shard en UNA llamada barata.
    #    Si funciona, a Gemini le pasamos el TEXTO (no PNGs rasterizados) →
    #    menos tokens, más rápido, mejor extracción. Si falla o no está
    #    configurado, caemos al render histórico de PNGs (sin romper nada). ──
    docai_text: str | None = None
    try:
        from tools.docai import extract_text_docai
        docai_text = extract_text_docai(blob)
    except Exception as _e:
        print(f"[docai] caller error ({type(_e).__name__}: {str(_e)[:160]})", flush=True)
        docai_text = None
    print(
        f"[docai] {source_label[:55]} → "
        + (f"TEXTO {len(docai_text):,} chars (Gemini sobre texto)" if docai_text
           else "None → fallback render+Gemini Vision"),
        flush=True,
    )

    # Con texto OCR no hace falta rasterizar páginas (el OCR ya cubre las
    # rasterizadas). Sin texto OCR → render como antes.
    pages_to_render = [] if docai_text else (layout.get("needs_render_pages") or [])[:_MAX_RENDER_PAGES]
    rendered: list[tuple[int, bytes]] = []
    if pages_to_render:
        rendered = _render_pdf_pages_to_png(blob, pages_to_render, dpi=160)
    schema = _parser_schema(None)
    _cfg_extra = {}
    _t = os.getenv("PARSER_TEMPERATURE", "").strip()
    if _t:
        try:
            _cfg_extra["temperature"] = float(_t)
        except ValueError:
            pass
    config = gtypes.GenerateContentConfig(
        **_cfg_extra,
        response_mime_type="application/json",
        response_schema=schema, max_output_tokens=65535,
        http_options=gtypes.HttpOptions(timeout=PARSE_CALL_TIMEOUT_MS),  # techo por-llamada
        system_instruction=(
            "Sos un extractor experto en documentos del Sistema Electrónico de "
            "Contrataciones del Estado (SEACE) del Perú y del Organismo Especializado "
            "para las Contrataciones Eficientes del Estado (OECE / ex-OSCE). "
            "Procesás Bases Administrativas, Términos de Referencia (TDR), "
            "Especificaciones Técnicas (EETT), Expedientes Técnicos, Actas de Buena "
            "Pro, Contratos y Propuestas Económicas.\n"
            "\n"
            "ENTRADA: vas a recibir UN PDF en `application/pdf`. ADEMÁS, en muchos "
            "casos vas a recibir entre 1 y 30 imágenes PNG ADICIONALES. Esas imágenes "
            "son RENDERS A 160 DPI de páginas específicas del MISMO PDF cuyo "
            "contenido está rasterizado como imagen embebida (típico en bases del "
            "OECE — la sección REQUERIMIENTO viene casi siempre como imagen pegada en "
            "un PDF, NO como texto). El prompt del usuario te indica el número de "
            "página al que corresponde cada PNG. DEBÉS combinar el texto extraíble "
            "del PDF con el contenido de las imágenes para reconstruir la información "
            "completa. SIN las imágenes el REQUERIMIENTO no se ve.\n"
            "\n"
            "MISIÓN CRÍTICA: localizar la sección 'REQUERIMIENTO' (también llamada "
            "'Términos de Referencia', 'Especificaciones Técnicas', 'Características "
            "Técnicas del Bien', 'Características Técnicas del Servicio', 'Alcance "
            "del Servicio' o 'Características de la Obra') y EXTRAERLA A CAMPOS "
            "ESTRUCTURADOS — no transcribir, no perder información, no truncar.\n"
            "\n"
            "⚠ ANTI-ALUCINACIÓN — REGLA CRÍTICA DE INTEGRIDAD:\n"
            "  · NUNCA INVENTES contenido. Si no podés leer claramente el texto del\n"
            "    PDF (porque está mal rasterizado, las imágenes adjuntas no son\n"
            "    legibles, o el PDF aparenta estar dañado), respondé:\n"
            "      contiene_requerimiento=false\n"
            "      items=[]\n"
            "      resumen='No se pudo extraer información legible del documento'\n"
            "    NO completes con un caso 'genérico' o 'plantilla' (ej. servicio de\n"
            "    limpieza, kit de útiles, broca traumatológica) basado en tu memoria\n"
            "    de bases administrativas peruanas. Si NO está EN EL DOCUMENTO,\n"
            "    NO existe.\n"
            "  · El OBJETO DEL CONTRATO viene en el OCDS (entregado por la entidad)\n"
            "    y debe coincidir con lo que extraés del PDF. Si tu extracción\n"
            "    discrepa radicalmente del objeto OCDS (ej. OCDS dice 'codeína\n"
            "    fosfato' pero el PDF según vos habla de 'limpieza'), prioritariamente\n"
            "    revisá si te equivocaste leyendo el PDF — probablemente el PDF\n"
            "    SÍ habla de codeína y vos lo malinterpretaste.\n"
            "\n"
            "\n"
            "REGLAS DE EXTRACCIÓN ESTRUCTURADA (no perder NADA relevante):\n"
            "  · Sos un EXTRACTOR ESTRUCTURADO. Tu trabajo es leer el documento y\n"
            "    volcar TODA la información relevante a CAMPOS DISCRETOS. Cada dato\n"
            "    tiene su lugar específico en el schema:\n"
            "      - Marca/modelo →  `marca_o_modelo_exigido` (string)\n"
            "      - Normas técnicas →  `certificaciones_exigidas` (lista corta)\n"
            "      - Valores numéricos (potencia, capacidad, año, peso, alcance)\n"
            "        →  `valores_tecnicos_clave` (objeto con campos numéricos discretos)\n"
            "      - Garantía →  `garantia` (objeto: meses, horas, alcance)\n"
            "      - Plazo y lugar de entrega →  `condiciones_entrega` (objeto)\n"
            "      - Requisitos al postor (experiencia mínima en soles, años,\n"
            "        certificaciones del postor como 'concesionario MTC', infra)\n"
            "        →  `requisitos_postor` (objeto)\n"
            "      - Penalidades (causal + % + base de cálculo)\n"
            "        →  `penalidades` (lista de objetos)\n"
            "      - Si el ítem es un PAQUETE/LOTE/CANASTA con N productos\n"
            "        adentro (típico en bases de alimentos, kits escolares)\n"
            "        →  `subitems` (lista anidada, NO uses sub-numeración\n"
            "        en items[] para esto; usá esta lista)\n"
            "      - El requerimiento del ítem, LITERAL (sin resumir, ≤ 4000 chars)\n"
            "        →  `texto_literal` + `texto_literal_paginas` + `evidencia` [{pagina, cita}]\n"
            "\n"
            "  · La spec técnica va en CAMPOS DISCRETOS y, además, copiada LITERAL en\n"
            "    `texto_literal` (hasta 4000 chars por ítem). NO resumas ni reescribas.\n"
            "  · EVIDENCIA: cada ítem/postor/firmante/comité/motivo lleva `evidencia`\n"
            "    [{pagina, cita}] con la página del marcador ⟦p.N⟧ y una cita textual.\n"
            "\n"
            "  · NO inventés especificaciones que no estén en el PDF/imágenes. Si un\n"
            "    campo no aparece, dejalo null.\n"
            "\n"
            "  · Asociás cada bloque de requerimiento con su NÚMERO DE ÍTEM "
            "(Ítem 1, Ítem 2, etc.). Si el documento tiene un solo ítem global, todo "
            "el REQUERIMIENTO se asocia a ese ítem.\n"
            "  · Si en el PDF figuran TABLAS de ítems (frecuente en bases para "
            "alimentos, uniformes, medicamentos, útiles), cada FILA de la tabla suele "
            "ser un ítem independiente — extraé un objeto en `items[]` por cada fila.\n"
            "  · NO inventás especificaciones que no estén en el PDF/imágenes.\n"
            "  · Si el documento NO contiene la sección REQUERIMIENTO (ej. es solo un "
            "acta o un contrato), dejá `contiene_requerimiento=false` y "
            "`texto_literal=null` en cada ítem.\n"
            "  · Detectás marcas/modelos explícitos que aparezcan en el documento, "
            "y por separado las certificaciones/normas técnicas (MTC, Euro, Tier, "
            "ISO, NTP, DIGESA, SENASA, ASTM, EPA, etc.). Copiá los strings LITERALES "
            "del PDF — no traduzcas, no normalices, no completes con tu memoria.\n"
            "  · Identificás 'red flags' documentales: especificaciones que restringen "
            "competencia (marca única sin 'o similar', certificación atípica, plazos "
            "ultra-cortos, experiencia desproporcionada, lotes empaquetados sin "
            "justificación).\n"
            "\n"
            "EXTRACCIÓN OBLIGATORIA (CRÍTICO PARA EL PIPELINE INVESTIGATIVO):\n"
            "\n"
            "  · `firmantes`: TODA persona que firma el documento al pie. Suele estar\n"
            "    en la última página con título, nombre, cargo y firma. Capturá nombre\n"
            "    completo, DNI (si aparece), cargo institucional, rol respecto al\n"
            "    documento (aprobador / evaluador / presidente_comite / representante_proveedor /\n"
            "    testigo) y entidad. ESPECIALMENTE en actas de buena pro y contratos.\n"
            "    Este dato es lo que cruzaremos con el gerente del proveedor para\n"
            "    detectar parentezco o cargo previo compartido.\n"
            "\n"
            "  · `comite_evaluacion`: composición del Comité de Selección / Comisión\n"
            "    Evaluadora si el documento lo lista. Capturá nombre, cargo, rol\n"
            "    (presidente/miembro_titular/miembro_suplente/secretario) y certificación\n"
            "    SICAN si se menciona.\n"
            "\n"
            "  · `motivos_adjudicacion`: si es Acta de Buena Pro o Reporte, para CADA\n"
            "    postor ganador documentá: por qué ganó (criterio_decisivo: 'menor\n"
            "    precio', 'único postor admitido', 'mejor calificación técnica', 'sorteo'),\n"
            "    posición en ranking, observaciones del comité (descalificaciones de\n"
            "    otros postores, ajustes de precio, etc.), competidores_descalificados\n"
            "    con razones específicas.\n"
            "\n"
            "  · `lugar_fecha_acta`: lugar, fecha y hora de emisión cuando aplique.\n"
            "\n"
            "🚨 BASES ADMINISTRATIVAS ≠ ACTA DE BUENA PRO 🚨\n"
            "Las BASES ADMINISTRATIVAS se publican ANTES de la convocatoria. NO\n"
            "tienen ni firmantes del comité, ni motivos de adjudicación, ni acta\n"
            "de buena pro. Esos datos solo existen en documentos posteriores:\n"
            "Acta de Buena Pro, Contrato firmado, Cuadro de Evaluación.\n"
            "Si el documento que estás procesando es BASES ADMINISTRATIVAS o\n"
            "TÉRMINOS DE REFERENCIA, dejá `firmantes=[]`, `motivos_adjudicacion=[]`,\n"
            "`comite_evaluacion=[]`, `lugar_fecha_acta=null`. NO inventes un\n"
            "comité de selección, ni un Presidente del Comité, ni una fecha de\n"
            "firma — eso es alucinación.\n"
            "\n"
            "Si el documento NO es un acta / reporte / contrato (ej. son bases\n"
            "administrativas puras), dejá `firmantes=[]`, `motivos_adjudicacion=[]`,\n"
            "`comite_evaluacion=[]`, `lugar_fecha_acta=null`. NO inventes nombres,\n"
            "cargos, RUCs, entidades, lugares ni fechas. JAMÁS uses placeholders\n"
            "tipo 'LUGAR_ACTA_EXAMPLE', 'FIRMANTE_ACTA_EXAMPLE', 'CARGO_EXAMPLE',\n"
            "'POSTOR_1_EXAMPLE', 'ENTIDAD_CONTRATANTE_EXAMPLE', '12345678901',\n"
            "'Nombre Apellido', 'Funcionario X', 'Juan Perez Quispe', 'Juan Pérez',\n"
            "ni cualquier valor genérico — son alucinaciones. Si el dato no está\n"
            "en el PDF, el campo va vacío/null. PREFERÍ campo vacío a campo\n"
            "inventado.\n"
            "\n"
            "REGLA DURA — VALIDACIÓN DE FIRMANTE:\n"
            "Para emitir un objeto en `firmantes[]` DEBÉS tener AL MENOS UNO de:\n"
            "  (a) DNI explícito del firmante (8 dígitos visibles en el PDF), o\n"
            "  (b) Nombre de la entidad REAL del firmante (no 'Entidad\n"
            "      Contratante' literal, sino 'Municipalidad de X', 'Ministerio\n"
            "      de Y', con nombre concreto que aparece en el PDF), o\n"
            "  (c) Imagen/firma escaneada visible al pie del documento que\n"
            "      acompañe un nombre legible.\n"
            "Si NINGUNA de las tres se cumple, el firmante NO va al output.\n"
            "\n"
            "Devolvé SOLO JSON conforme al schema, sin markdown, sin fences."
        ),
    )

    # ── Armado de parts ─────────────────────────────────────────────
    docai_note = ""
    if docai_text:
        # CON Document AI: mandamos SOLO el texto OCR del documento completo
        # (sin el PDF ni PNGs) → 1 llamada Gemini lean. Cap 1M chars ≈ 250K
        # tokens (cubre ~330 págs; entra de sobra en el contexto de Gemini 2.5).
        parts: list = [gtypes.Part.from_text(text=(
            "═══ TEXTO OCR DEL DOCUMENTO COMPLETO (Google Document AI, alta fidelidad) ═══\n"
            + docai_text[:1000000]
        ))]
        docai_note = (
            "ARRIBA está el TEXTO OCR COMPLETO del documento entero, extraído por "
            "Google Document AI (incluye tablas y páginas que estaban rasterizadas "
            "como imagen). Es la ÚNICA fuente — extraé de ahí TODOS los ítems, "
            "especificaciones técnicas y banderas. Procesá el documento completo.\n\n"
        )
    else:
        # SIN Document AI (fallback): PDF + PNGs renderizados (Gemini Vision).
        parts = [gtypes.Part.from_bytes(data=blob, mime_type="application/pdf")]
    render_note = ""
    if rendered:
        pages_human = ", ".join(str(i + 1) for i, _ in rendered)
        render_note = (
            f"ADJUNTO {len(rendered)} imágenes PNG a 160 DPI correspondientes a las "
            f"páginas {pages_human} del PDF (en ese mismo orden). Esas páginas tienen "
            f"el contenido RASTERIZADO COMO IMAGEN dentro del PDF (no texto extraíble), "
            f"por eso te las paso por separado. Hacé OCR visual sobre ellas y "
            f"transcribí palabra por palabra cualquier especificación técnica, tabla "
            f"de ítems, listado de marcas, certificación, plazo o requisito que "
            f"contengan. Lo más probable es que el REQUERIMIENTO completo viva "
            f"acá.\n\n"
        )
        for idx, png in rendered:
            parts.append(gtypes.Part.from_bytes(data=png, mime_type="image/png"))

    layout_note = ""
    if layout and not layout.get("error"):
        layout_note = (
            f"Layout detectado por PyMuPDF: {layout['n_pages']} páginas, "
            f"{layout['total_text_chars']:,} chars de texto extraíble, "
            f"{len(layout.get('low_text_pages') or [])} páginas con < 300 chars "
            f"de texto, {len(layout.get('needs_render_pages') or [])} páginas "
            f"rasterizadas (con contenido en imagen).\n\n"
        )

    prompt = (
        f"PDF a procesar: {source_label}.\n\n"
        f"{layout_note}"
        f"{docai_note}"
        f"{render_note}"
        "Hacé esto, en este orden:\n"
        "\n"
        "PASO 1 — Identificá el tipo de documento (Bases Administrativas, TDR, EETT, "
        "Acta de Buena Pro, Contrato, Propuesta, etc.) y completá `tipo_documento_detectado`.\n"
        "\n"
        "PASO 2 — BUSCÁ la sección REQUERIMIENTO. Suele estar en el Capítulo III de las "
        "Bases Estándar del OECE, titulada 'REQUERIMIENTO' o 'TÉRMINOS DE REFERENCIA' o "
        "'ESPECIFICACIONES TÉCNICAS'. Si la encontrás (sea como texto del PDF o como "
        "contenido OCR de las imágenes adjuntas), marcá `contiene_requerimiento=true`.\n"
        "\n"
        "PASO 3 — Para CADA ítem del proceso (1, 2, 3... — si hay tabla de ítems en\n"
        "el documento o en las imágenes, cada fila es un ítem) extraé toda la info\n"
        "del REQUERIMIENTO técnico en CAMPOS DISCRETOS del schema:\n"
        "\n"
        "  IDENTIFICACIÓN:\n"
        "  · `numero` (string): '1', '1.1', '2', etc.\n"
        "  · `padre_ocds_item`: null si es ítem root del OCDS; el número del padre\n"
        "    si es un sub-ítem dentro de un ítem compuesto.\n"
        "  · `descripcion_corta` (≤200 chars): TÍTULO del ítem tal como aparece en\n"
        "    el documento (no inventes una más corta).\n"
        "  · `cantidad`, `unidad`, `precio_unitario_referencial`, `cuantia_referencial_item`.\n"
        "\n"
        "  MARCA Y NORMAS (copia LITERAL del documento, NO uses ejemplos de memoria):\n"
        "  · `marca_o_modelo_exigido` (string corto): texto exacto del documento si\n"
        "    el ítem exige una marca/modelo. 'sin marca' si el ítem es genérico.\n"
        "    Null si la sección no menciona requisito de marca.\n"
        "  · `certificaciones_exigidas` (lista corta): solo los códigos de norma\n"
        "    LITERALES del documento (cada string como aparece).\n"
        "\n"
        "  VALORES NUMÉRICOS CLAVE (objeto `valores_tecnicos_clave`):\n"
        "    Llená SOLO los campos que aparecen en el documento; resto null:\n"
        "      potencia_min_hp / potencia_min_kw / capacidad_volumen ('1.0 m3') /\n"
        "      capacidad_carga_ton / peso_operativo_ton / alcance_m /\n"
        "      ano_fabricacion_min / estado ('nueva sin uso') /\n"
        "      presentacion (para consumibles: 'saco 50kg', 'lata 140g') /\n"
        "      color / material.\n"
        "\n"
        "  GARANTÍA (objeto `garantia`):\n"
        "      meses (int) / horas (int — maquinaria) / alcance ('comercial', 'fábrica').\n"
        "\n"
        "  ENTREGA (objeto `condiciones_entrega`):\n"
        "      plazo_dias_calendario / lugar_entrega / modalidad ('única', 'parcial').\n"
        "\n"
        "  REQUISITOS AL POSTOR (objeto `requisitos_postor`):\n"
        "      experiencia_minima_soles / anos_experiencia_min /\n"
        "      n_contratos_similares / certificaciones_postor (ej. 'concesionario MTC',\n"
        "      'representante oficial de marca') / infraestructura_exigida /\n"
        "      personal_clave.\n"
        "\n"
        "  PENALIDADES (lista `penalidades`):\n"
        "      [{causal, monto_o_porcentaje, base_calculo}, ...].\n"
        "      Ej. {causal: 'mora en entrega', monto_o_porcentaje: '0.10%',\n"
        "           base_calculo: 'sobre monto del bien por cada día'}.\n"
        "\n"
        "  SUB-ÍTEMS — si el ítem es un PAQUETE/LOTE/CANASTA con varios productos:\n"
        "      `subitems`: [{descripcion, cantidad, unidad, presentacion, specs_clave},...]\n"
        "      Ej. para 'CANASTA DE ALIMENTOS':\n"
        "        [{descripcion: 'Arroz superior', cantidad: 2, unidad: 'BOLSA',\n"
        "          presentacion: '1kg', specs_clave: 'grano largo, taquillado'}, ...]\n"
        "\n"
        "  REQUERIMIENTO LITERAL (`texto_literal`, ≤ 4000 chars):\n"
        "    Extracto copiado tal cual del documento con las especificaciones del ítem\n"
        "    (marca, normas, dimensiones, garantía, plazo, requisitos del postor). NO es\n"
        "    resumen: no reescribas, no completes con tu memoria. Anotá en\n"
        "    `texto_literal_paginas` las páginas (⟦p.N⟧) que abarca y en `evidencia`\n"
        "    una cita textual con su página. Si el documento no tiene requerimiento\n"
        "    para el ítem, null.\n"
        "\n"
        "PASO 4 — Identificá `postores` (RUC, razón social, monto, ganador) si el PDF/imágenes los "
        "mencionan (típicamente en actas y propuestas).\n"
        "\n"
        "PASO 5 — `fundamento_legal` (lista de artículos citados textualmente por el\n"
        "documento: 'Art. 55.1.b Ley 32069', 'Art. 2 TUO Ley 30225', 'D.S. 009-2025-EF\n"
        "Art. 12', etc.). Solo LO QUE EL DOCUMENTO CITA — no interpretes si están bien\n"
        "invocados o no. Eso lo evalúa `document_legal_analyst_agent` aparte.\n"
        "\n"
        "PASO 5.5 — SEGÚN EL TIPO DE DOCUMENTO, llená UNO de estos objetos (o ninguno):\n"
        "  · Si es RESUMEN EJECUTIVO o 'Informe que sustenta' (justifica una directa o\n"
        "    comparación de precios) → completá `estudio_mercado` (valor referencial,\n"
        "    comparación de precio histórico LITERAL, causal/artículo invocado, texto de\n"
        "    la causal, proveedores evaluados, descalificaciones). Es el 'POR QUÉ' del proceso.\n"
        "  · Si es ORDEN DE COMPRA / CONTRATO firmado ('Archivos del contrato') →\n"
        "    completá `contrato_final` (precio FINAL total + moneda, cronograma de\n"
        "    entregas, penalidades, forma de pago, RUC del proveedor). Es lo REALMENTE pagado.\n"
        "  · En CUALQUIER OTRO documento (Bases, acta, presentación, cuadros) → dejá\n"
        "    AMBOS objetos en null. NO inventes; copiá montos/causales LITERALES del PDF.\n"
        "\n"
        "PASO 6 — `cuantia_total`, `fuente_financiamiento`, `modalidad` (suma alzada / precios "
        "unitarios / esquema mixto / tarifas) y `resumen` (3-4 líneas).\n"
        "\n"
        "REGLAS FINALES:\n"
        "  · Sos EXTRACTOR puro: extraés HECHOS del documento. NO emitís juicios\n"
        "    legales ni banderas de riesgo — eso lo hace `document_legal_analyst_agent`\n"
        "    sobre tu output. Si tu extracción es buena (campos discretos completos,\n"
        "    frases textuales preservadas, sin invención), el analyst hace su trabajo\n"
        "    sin problema.\n"
        "  · Si el documento NO es una base / TDR / EETT, `contiene_requerimiento=false` y "
        "los requerimientos por ítem quedan en null.\n"
        "  · Devolvé SOLO JSON. SIN markdown, SIN fences, SIN texto antes ni después."
    )
    parts.append(gtypes.Part.from_text(text=prompt))

    try:
        with _throttle_gemini():
            resp = _gemini_call_with_retry(
                lambda: client.models.generate_content(
                    model=DEFAULT_GEMINI_MODEL, contents=parts, config=config,
                ),
            )
        text = (resp.text or "").strip()
        data = _safe_parse_json(text)
        if not isinstance(data, dict) or not data:
            return {"error": f"non-json response: {text[:200]}"}
        if "MAX_TOKENS" in _finish_reason(resp).upper():
            data["_truncado"] = True
        for _it in (data.get("items") or []):
            if isinstance(_it, dict) and _it.get("texto_literal") and not _it.get("requerimiento_tecnico_detallado"):
                _it["requerimiento_tecnico_detallado"] = _it["texto_literal"]
        data["_size_bytes"] = len(blob)
        data["_source"] = source_label
        data["_pdf_layout"] = {
            "n_pages": layout.get("n_pages"),
            "rendered_pages_1based": [i + 1 for i, _ in rendered],
            "total_text_chars": layout.get("total_text_chars"),
            "es_pdf_completamente_escaneado": layout.get("es_pdf_completamente_escaneado"),
        }
        # LOGGING DE ORIGEN POR-PDF (caza-contaminación): qué documento produjo
        # qué ítems. Si un run de acelerómetros loguea 'CARNE DE RES', el source
        # apunta al PDF/URL cruzado → confirma fetch-chain vs parser.
        try:
            _it = data.get("items") or []
            _first = str((_it[0] if _it else {}).get("descripcion_corta") or "")[:90]
            print(f"[parser-src] src={source_label} · bytes={len(blob)} · "
                  f"n_items={len(_it)} · first='{_first}'", flush=True)
        except Exception:
            pass
        return data
    except Exception as e:
        return {"error": f"gemini failed: {str(e)[:150]}", "_source": source_label}

def _fetch_doc_bytes(document_url: str, tool_context: ToolContext) -> tuple[bytes | None, str, str | None]:
    """Obtiene los bytes de un documento intentando 4 caminos en orden:

      1. state['docs_b64'][url]      → b64 inline (path rápido, cuando el
                                       bridge pre-cargó por POST).
      2. state['doc_urls'][url]      → URL pública de GCS donde el bridge
                                       archivó el PDF. Descargamos con
                                       google-cloud-storage (auth automática
                                       con la SA del Cloud Run).
      3. OECE_RELAY_URL (env var)    → Cloudflare Worker que bypassa el WAF.
      4. Descarga directa            → último recurso (SEACE bloquea IPs GCP,
                                       devuelve 403 casi seguro).

    Returns:
        (bytes_o_None, fuente_str, mensaje_error_o_None)
        fuente_str ∈ {'inline_b64', 'gcs', 'relay', 'direct'}
    """
    # Helper: normalizar URL para matching robusto (sin query/fragment, sin trailing slash).
    # Necesario porque la URL del OCDS puede tener variantes (?v=1, /, encoding) que
    # difieren de la URL que el cliente registró en doc_urls/docs_b64.
    def _norm(u: str) -> str:
        try:
            from urllib.parse import urlparse, urlunparse
            p = urlparse(u)
            path = p.path.rstrip("/")
            return urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", "", "")).lower()
        except Exception:
            return (u or "").lower()

    target_norm = _norm(document_url)

    def _lookup(d: dict):
        if document_url in d:
            return d[document_url]
        # Fallback: match por URL normalizada
        for k, v in d.items():
            if _norm(k) == target_norm:
                return v
        return None

    # 1) inline b64
    docs_b64 = tool_context.state.get("docs_b64") or {}
    pdf_b64 = _lookup(docs_b64)
    if pdf_b64:
        try:
            return base64.b64decode(pdf_b64, validate=True), "inline_b64", None
        except Exception as e:
            return None, "inline_b64", f"invalid_b64: {e}"

    # 2) GCS (preferido cuando no hay b64)
    doc_urls = tool_context.state.get("doc_urls") or {}
    gcs_target = _lookup(doc_urls)
    if gcs_target:
        blob, err = _download_from_gcs(gcs_target)
        if blob is not None:
            return blob, "gcs", None
        # si GCS falla, seguimos a relay/directo
        gcs_error = err
    else:
        gcs_error = None

    # 2.5) Downloader local (puente residencial peruano vía túnel) — el path
    #      CONFIABLE: SEACE bloquea IPs de datacenter (Cloud Run, colos de CF)
    #      con 403 pero acepta IPs residenciales PE. El servicio corre en la
    #      máquina del usuario, descarga con su IP, sube a GCS y devuelve gs://.
    dl_base = downloader_base()
    if dl_base:
        try:
            ocid_hint = (
                tool_context.state.get("ocid")
                or tool_context.state.get("ocid_preloaded")
                or ""
            )
            r = requests.post(
                f"{dl_base.rstrip('/')}/download",
                json={"url": document_url, "ocid": ocid_hint},
                headers={"X-Vigia-Token": os.getenv("LOCAL_DOWNLOADER_TOKEN", "")},
                timeout=180,
            )
            if r.status_code == 200:
                gs = (r.json() or {}).get("gcs_path")
                if gs:
                    blob, err = _download_from_gcs(gs)
                    if blob is not None:
                        return blob, "local_downloader", None
                    downloader_error = f"downloader_gcs_read={err}"
                else:
                    downloader_error = "downloader_sin_gcs_path"
            else:
                downloader_error = f"downloader HTTP {r.status_code}"
        except Exception as e:
            downloader_error = f"downloader_exception: {str(e)[:120]}"
    else:
        downloader_error = None

    # 3) relay (Cloudflare Worker)
    relay_base = os.getenv("OECE_RELAY_URL", "").strip()
    if relay_base:
        try:
            relay_url = (
                f"{relay_base.rstrip('/')}/?url={requests.utils.quote(document_url, safe='')}"
            )
            r = requests.get(relay_url, headers=BROWSER, timeout=60)
            if r.status_code == 200 and len(r.content) > 100:
                return r.content, "relay", None
            relay_error = f"relay HTTP {r.status_code}"
        except Exception as e:
            relay_error = f"relay_exception: {str(e)[:120]}"
    else:
        relay_error = "OECE_RELAY_URL no configurado"

    # 4) directo
    try:
        r = requests.get(document_url, headers=BROWSER, timeout=30)
        if r.status_code == 200:
            return r.content, "direct", None
        direct_error = f"direct HTTP {r.status_code}"
    except Exception as e:
        direct_error = f"direct_exception: {str(e)[:120]}"

    # Todo falló — construimos error compuesto
    parts = []
    if gcs_target:
        parts.append(f"gcs={gcs_error or 'failed'}")
    if dl_base:
        parts.append(f"downloader={downloader_error}")
    parts.append(f"relay={relay_error}")
    parts.append(direct_error)
    return None, "failed", " · ".join(parts)

def _download_from_gcs(gcs_or_https_url: str) -> tuple[bytes | None, str | None]:
    """Descarga bytes desde GCS. Acepta dos formas de URL:
      · gs://bucket/path                          → usa google-cloud-storage SDK
      · https://storage.googleapis.com/bucket/p   → requests.get directo (más rápido,
        sin auth — funciona con buckets públicos de lectura que es nuestro caso).

    Para buckets privados con SA en Cloud Run, el path SDK se autentica con
    Application Default Credentials.
    """
    if gcs_or_https_url.startswith("https://"):
        try:
            r = requests.get(gcs_or_https_url, timeout=60)
            if r.status_code == 200 and len(r.content) > 100:
                return r.content, None
            return None, f"https GET HTTP {r.status_code}"
        except Exception as e:
            return None, f"https_exception: {str(e)[:200]}"

    # gs:// → SDK
    if not gcs_or_https_url.startswith("gs://"):
        return None, f"url GCS no parseable: {gcs_or_https_url[:120]}"
    try:
        from google.cloud import storage
    except Exception as e:
        return None, f"google-cloud-storage no instalado: {e}"
    rest = gcs_or_https_url[5:]
    if "/" not in rest:
        return None, f"url GCS no parseable: {gcs_or_https_url[:120]}"
    bucket_name, blob_path = rest.split("/", 1)
    try:
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        data = blob.download_as_bytes()
        if data and len(data) > 100:
            return data, None
        return None, "gcs blob vacío o muy chico"
    except Exception as e:
        return None, f"gcs_exception: {str(e)[:200]}"

def _is_docx_blob(blob: bytes) -> bool:
    """True si el blob es un archivo DOCX (Office Open XML).
    Un DOCX siempre empieza con PK (ZIP) y contiene `word/document.xml`.
    SEACE V3 publica algunas Bases Administrativas en DOCX en lugar de PDF.
    """
    if not blob or blob[:2] != b"PK":
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            names = z.namelist()
            return any(n == "word/document.xml" for n in names)
    except zipfile.BadZipFile:
        return False

def _docx_to_synthetic_pdf(blob: bytes) -> bytes | None:
    """Convierte un DOCX en un PDF sintético procesable por el pipeline de
    Gemini. Estrategia híbrida:

      1. Extrae texto + tablas con python-docx → páginas de texto plano.
      2. Extrae imágenes embebidas (word/media/*) → páginas separadas con cada
         imagen renderizada full-page.

    El PDF sintético NO es visualmente bonito pero sí leíble por Gemini, que
    hará OCR Vision sobre las imágenes y leerá el texto plano directamente.

    Returns: bytes del PDF resultante o None si la conversión falla.
    """
    try:
        from docx import Document
        import fitz
    except Exception:
        return None

    # 1. Texto + tablas del DOCX
    text_chunks: list[str] = []
    try:
        d = Document(io.BytesIO(blob))
        for para in d.paragraphs:
            t = (para.text or "").strip()
            if t:
                text_chunks.append(t)
        for tbl in d.tables:
            for row in tbl.rows:
                cells = [(c.text or "").strip() for c in row.cells]
                line = " | ".join(c for c in cells if c)
                if line.strip(" |"):
                    text_chunks.append(line)
    except Exception:
        pass

    # 2. Imágenes embebidas (PNG/JPEG/etc en word/media/)
    images: list[tuple[str, bytes]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            for name in z.namelist():
                if name.startswith("word/media/") and not name.endswith("/"):
                    ext = name.rsplit(".", 1)[-1].lower()
                    if ext in ("png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"):
                        try:
                            images.append((name, z.read(name)))
                        except Exception:
                            continue
    except Exception:
        pass

    if not text_chunks and not images:
        return None

    # 3. Construir PDF sintético con PyMuPDF
    out_doc = fitz.open()
    full_text = "\n".join(text_chunks)
    # Páginas de texto: A4 portrait, 1700pt de alto, 595pt de ancho
    PAGE_W, PAGE_H = 595, 842
    MARGIN = 36
    FONT_SIZE = 9
    LINE_H = 12
    if full_text:
        # Dividir en chunks que caben en una página
        max_chars_per_page = 4500  # heurístico
        text_pages = [full_text[i:i + max_chars_per_page]
                      for i in range(0, len(full_text), max_chars_per_page)] or [""]
        for chunk in text_pages:
            page = out_doc.new_page(width=PAGE_W, height=PAGE_H)
            try:
                page.insert_textbox(
                    fitz.Rect(MARGIN, MARGIN, PAGE_W - MARGIN, PAGE_H - MARGIN),
                    chunk, fontsize=FONT_SIZE, fontname="helv",
                )
            except Exception:
                # Fallback: insertar como texto plano sin caja
                try:
                    page.insert_text((MARGIN, MARGIN + FONT_SIZE), chunk[:3000], fontsize=FONT_SIZE)
                except Exception:
                    pass
    # Páginas de imagen: una imagen por página (full-bleed)
    for name, img_bytes in images:
        try:
            page = out_doc.new_page(width=PAGE_W, height=PAGE_H)
            page.insert_image(
                fitz.Rect(MARGIN, MARGIN, PAGE_W - MARGIN, PAGE_H - MARGIN),
                stream=img_bytes,
            )
        except Exception:
            continue
    try:
        pdf_bytes = out_doc.tobytes()
    finally:
        out_doc.close()
    return pdf_bytes if pdf_bytes else None

def _images_to_synthetic_pdf(images: list[tuple[str, bytes]]) -> bytes | None:
    """Convierte una lista de imágenes (JPG/PNG/TIFF/BMP) en un PDF sintético
    de 1 imagen por página. Útil para bases SEACE que vienen como ZIP de
    escaneos sueltos. Gemini hace OCR Vision sobre cada página.
    """
    try:
        import fitz  # PyMuPDF
    except Exception:
        return None
    if not images:
        return None
    out = fitz.open()
    try:
        for name, img_bytes in images:
            try:
                # Insertar como página completa A4 (vertical o horizontal según aspect)
                pix = fitz.Pixmap(img_bytes)
                w, h = pix.width, pix.height
                # A4 = 595x842 pt; ajustamos orientación
                if w > h:
                    page = out.new_page(width=842, height=595)
                else:
                    page = out.new_page(width=595, height=842)
                rect = page.rect
                page.insert_image(rect, stream=img_bytes)
            except Exception:
                continue
        if len(out) == 0:
            return None
        pdf_bytes = out.tobytes()
    finally:
        out.close()
    return pdf_bytes if pdf_bytes else None

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


# ── Capa 2 (LLM único de sanitización) ─────────────────────────────────────
# Esta herramienta es la ÚNICA responsable de producir la lista canónica de productos
# a partir de los items crudos que dejó el parseo (que pueden tener duplicados por OCR
# ruidoso, el mismo bien numerado distinto en dos documentos ['001' vs '1'], o el
# título del contrato colándose como ítem). NO usa thresholds/regex/lookalike — el
# LLM JUZZGA el listado completo con su propio criterio. Es la capa de sanitización
# (capa 2) de la arquitectura por capas que pidió el usuario; el parseo es la capa 1.

_CAMPOS_SOLO_REQUERIMIENTO = ("marca_o_modelo_exigido", "precio_unitario_referencial", "cuantia_referencial_item",
                              "certificaciones_exigidas", "requisitos_postor", "texto_literal",
                              "requerimiento_tecnico_detallado", "texto_literal_paginas")


def sanitize_items_with_llm(raw_items, objeto: str = "", tool_context=None) -> list:
    """Recibe los items CRUDOS acumulados de TODOS los documentos parseados de un
    contrato, más el objeto del OCDS. Devuelve la LISTA CANÓNICA ÚNICA de productos.

    Diseño: el LLM SOLO DECIDE (no genera). Devuelve los ÍNDICES a fundir/descartar
    (NO reconstruye items). El merge de campos lo hace el código sobre los crudos
    originales. Esto garantiza:
      - Cobertura perfecta: cada item de la salida corresponde a uno (o varios) del input.
      - Sin alucinaciones: el LLM no puede inventar items nuevos (no genera contenido).
      - Campos preservados tal cual: numero, descripcion_corta, cantidad, requerimiento,
        marca, certificaciones, padre_ocds_item — todo del input crudo.

    Acciones del LLM:
      - Normaliza `numero` ('001'→'1', '02'→'2', '1.0'→'1') → campo `num_normalizado`.
      - Grupos de índices a fundir (mismo bien físico descrito distinto).
      - Índices a descartar (cabecera del contrato repetida como ítem).
    Robusto: si el LLM falla, devuelve los items crudos sin cambios (fail-safe)."""
    items = [it for it in (raw_items or []) if isinstance(it, dict)]
    if len(items) <= 1:
        return items
    try:
        from google.genai import types as gtypes
        # Catálogo MINIMAL para no inflar el prompt. El LLM solo decide, no genera.
        catalogo = [{"i": i, "num": str(it.get("numero") or "")[:20],
                     "desc": str(it.get("descripcion_corta") or it.get("descripcion") or "")[:200],
                     "cant": it.get("cantidad"), "und": str(it.get("unidad") or "")[:20]}
                    for i, it in enumerate(items)]
        schema = gtypes.Schema(
            type=gtypes.Type.OBJECT,
            properties={
                "num_normalizado": gtypes.Schema(
                    type=gtypes.Type.ARRAY,
                    description="Para cada item de entrada, su `numero` canónico (sin ceros a la izquierda ni sub-decimal .0). Mismo orden que la entrada.",
                    items=gtypes.Schema(type=gtypes.Type.STRING),
                ),
                "grupos_fundir": gtypes.Schema(
                    type=gtypes.Type.ARRAY,
                    description="Cada sub-lista = índices que son EL MISMO bien físico y deben fundirse en uno solo. Solo grupos de >=2 elementos (los ítems únicos no van).",
                    items=gtypes.Schema(type=gtypes.Type.ARRAY, items=gtypes.Schema(type=gtypes.Type.INTEGER)),
                ),
                "indices_descartar": gtypes.Schema(
                    type=gtypes.Type.ARRAY,
                    description="Índices a descartar (típicamente el TÍTULO/OBJETO del contrato repetido como ítem, sin specs técnicas reales).",
                    items=gtypes.Schema(type=gtypes.Type.INTEGER),
                ),
            },
            required=["num_normalizado", "grupos_fundir", "indices_descartar"],
        )
        prompt = (
            f"OBJETO del contrato (referencia, NO para filtrar): '{(objeto or '')[:300]}'\n\n"
            f"ITEMS CRUDOS extraídos de VARIOS documentos del mismo proceso (Bases, "
            f"Acta, Cuadro, Contrato, etc.). Cada item tiene un índice 0..N-1. Problemas típicos:\n"
            f"  • Mismo bien numerado distinto en dos documentos ('001' y '1', '02' y '2', '1.0' y '1')\n"
            f"  • Descripciones distintas del MISMO bien por OCR ruidoso\n"
            f"  • El TÍTULO/OBJETO del contrato repetido como ítem sin specs técnicas reales\n\n"
            f"Tu tarea: DECIDE (NO generes items, NO modifiques descripciones). Devuelve:\n"
            f"1. `num_normalizado`: array (mismo orden que la entrada) con cada `numero` canónico. "
            f"Ej: '001' → '1', '02' → '2', '1.0' → '1', '01' → '1'. Conserva string vacío si vacío.\n"
            f"2. `grupos_fundir`: array de arrays de índices que son EL MISMO bien físico (descripción "
            f"distinta por OCR pero mismo producto). Solo grupos de >=2. Conserva la cantidad canónica.\n"
            f"3. `indices_descartar`: índices a descartar (típicamente el TÍTULO/OBJETO del contrato "
            f"repetido como ítem, sin specs reales; o un ítem que sea claramente cabecera).\n\n"
            f"REGLAS:\n"
            f"• Items con `requerimiento_tecnico_detallado` largo (>40 chars) NO se descartan (son items reales).\n"
            f"• Items con descripción MUY PARECIDA al objeto del contrato Y sin specs SÍ se descartan (cabecera).\n"
            f"• Items con numero distinto (después de normalizar) son bienes DISTINTOS, NO se funden.\n"
            f"• Items con numero igual pero descripción distinta (por OCR) SÍ se funden (mismo bien).\n"
            f"• Conserva el mayor `requerimiento_tecnico_detallado` entre los del grupo a fundir.\n\n"
            f"INPUT ({len(catalogo)} items):\n{json.dumps(catalogo, ensure_ascii=False)}"
        )
        sys_inst = (
            "Sos un consolidador de ítems de contrataciones públicas peruanas (SEACE/OECE). "
            "Tu única tarea es DECIDIR (no generar items): normalizar numeros, "
            "identificar grupos a fundir (mismo bien físico), e índices a descartar "
            "(típicamente el título del contrato repetido). Devolvé SOLO JSON conforme "
            "al schema, sin markdown, sin fences, sin texto adicional."
        )
        cfg = gtypes.GenerateContentConfig(
            temperature=0.0, top_p=0.1, response_mime_type="application/json",
            response_schema=schema, max_output_tokens=8192,
            http_options=gtypes.HttpOptions(timeout=60000),
            system_instruction=sys_inst,
        )
        client = _gemini_client()
        model = os.getenv("SANITIZE_ITEMS_MODEL", DEFAULT_GEMINI_MODEL)
        with _throttle_gemini():
            resp = _gemini_call_with_retry(
                lambda: client.models.generate_content(model=model, contents=[gtypes.Part.from_text(text=prompt)], config=cfg))
        data = _safe_parse_json((resp.text or "").strip()) or {}
        if not isinstance(data, dict):
            print(f"[sanitize-items] LLM no devolvió un objeto JSON válido → conservo crudos (fail-safe)", flush=True)
            return items
        # Cobertura / validación: cada índice 0..N-1 debe aparecer EXACTAMENTE una vez
        # entre los grupos de fundir + los índices a descartar + los items individuales
        # (los que no estén en ningún grupo ni descartados quedan como ítems únicos).
        nums = data.get("num_normalizado") or []
        grupos = [g for g in (data.get("grupos_fundir") or []) if isinstance(g, list)]
        descartar = set(i for i in (data.get("indices_descartar") or []) if isinstance(i, int))
        if not isinstance(nums, list) or len(nums) != len(items):
            print(f"[sanitize-items] LLM devolvió num_normalizado con tamaño {len(nums) if isinstance(nums,list) else '?'} != {len(items)} → conservo crudos (fail-safe)", flush=True)
            return items
        # Aplicar normalización del numero a los crudos
        for it, n in zip(items, nums):
            if isinstance(n, str):
                it["numero"] = n.strip()
        # Validar cobertura: cada índice aparece 1 vez entre (grupos × N) + descartar
        coverage_vistos: set = set()
        for g in grupos:
            for i in g:
                if isinstance(i, int) and 0 <= i < len(items): coverage_vistos.add(i)
        coverage_vistos.update(descartar)
        # Los demás índices (los que NO están en grupo ni descartados) son ítems únicos
        # restantes — los representamos como grupos de 1 elemento para unificar el merge
        for i in range(len(items)):
            if i not in coverage_vistos:
                grupos.append([i])
        # Validación final: cada índice exactamente una vez
        flat = [i for g in grupos for i in g if isinstance(i, int)]
        if sorted(flat) != list(range(len(items))) or len(flat) != len(set(flat)):
            print(f"[sanitize-items] LLM cobertura inválida ({len(set(flat))}/{len(items)}) → conservo crudos (fail-safe)", flush=True)
            return items
        # MERGE de los grupos (el código decide, no el LLM). El item con el
        # `requerimiento_tecnico_detallado` más largo es la base; los demás solo
        # COMPLETAN campos vacíos (no sobreescriben lo que ya está).
        out: list[dict] = []
        for g in grupos:
            grp = [items[i] for i in g if 0 <= i < len(items)]
            if not grp: continue
            if any(i in descartar for i in g): continue  # descartar explícito
            # base = ítem de REQUERIMIENTO con el texto más largo; los de contratación (OC/acta)
            # solo aportan marca/precio OFERTADOS, nunca `marca_o_modelo_exigido` ni referencial.
            grp.sort(key=lambda x: (x.get("_etapa") == "contratacion",
                                    -len(str(x.get("requerimiento_tecnico_detallado") or ""))))
            base = dict(grp[0])
            for other in grp[1:]:
                de_contratacion = other.get("_etapa") == "contratacion"
                for k, v in other.items():
                    if de_contratacion and k in _CAMPOS_SOLO_REQUERIMIENTO:
                        continue
                    if base.get(k) in (None, "", [], {}, 0) and v not in (None, "", [], {}, 0):
                        base[k] = v
            out.append(base)
        descartados_n = len(descartar)
        fundidos_n = len(items) - len(out) - descartados_n
        print(f"[sanitize-items] {len(items)}→{len(out)} items canónicos · {descartados_n} descartados · {fundidos_n} fundidos", flush=True)
        return out
    except Exception as e:
        print(f"[sanitize-items] LLM falló ({type(e).__name__}: {str(e)[:160]}) → conservo crudos (fail-safe)", flush=True)
        return items


# ── FunctionTool wrappers ──
list_documents_tool = FunctionTool(func=list_documents)
parse_document_pdf_tool = FunctionTool(func=parse_document_pdf)
sanitize_items_with_llm_tool = FunctionTool(func=sanitize_items_with_llm)
# parse_documentos_seleccionados_tool se define junto al parser en lote (arriba).
