"""Selección DETERMINISTA de los documentos a parsear (sin LLM).

Fuentes, en este orden de confianza:
  1. `documentos_gcs` vigentes por ocid (blob en GCS + sha256) — catálogo del batch nocturno.
  2. Documentos del record OCDS: `tender.documents`, `awards[].documents`, `contracts[].documents`.
  3. `doc_urls` {url_origen: gs://…} que el dispatcher/admin manda en el body (subconjunto de 1).

Cada documento queda como DocRef = {id, url, gs, tipo, titulo, seccion, formato, sha256|None}
(+ `categoria` informativa: la clase de prioridad que lo ordenó). Se deduplica por sha256 y por
URL normalizada, se ordena por la prioridad del perfil (`prioridad`: tupla de etiquetas como
"bases integradas", "tdr", "acta", "contrato", … o documentTypes OCDS), se aplica el tope
`max_docs` y TODO lo que queda fuera va a `omitidos` con motivo — nada se pierde en silencio.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Callable, Iterable
from urllib.parse import urlparse, urlunparse

DocRef = dict  # {id, url, gs, tipo, titulo, seccion, formato, sha256|None, categoria}

# Prioridad por defecto (perfil BIENES) cuando P no manda una.
PRIORIDAD_DEFAULT: tuple[str, ...] = (
    "bases integradas", "bases", "especificaciones tecnicas", "resumen ejecutivo",
    "acta", "cuadro comparativo", "contrato", "orden de", "adenda", "absolucion",
)
MAX_DOCS_DEFAULT = 12

_SECCION_ORDEN = {"tender": 0, "award": 1, "contract": 2}


def _norm(s: str | None) -> str:
    """minúsculas, sin tildes, espacios colapsados."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.lower().split())


def norm_url(u: str | None) -> str:
    """URL sin query/fragment, sin barra final, en minúsculas — la misma regla que
    `_fetch_doc_bytes` usa para casar doc_urls con el OCDS. Las URLs de SEACE llevan el
    id en el query (`?fileCode=…`, `/descargar/123`): si al quitar el query la URL queda
    igual para documentos distintos, conservamos el query."""
    if not u:
        return ""
    try:
        p = urlparse(u.strip())
        path = p.path.rstrip("/")
        base = urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", "", "")).lower()
        if p.query and ("filecode" in p.query.lower() or "id=" in p.query.lower()):
            return f"{base}?{p.query.lower()}"
        return base
    except Exception:
        return u.strip().lower()


# ── Catálogo de categorías: clave canónica → (alias de la etiqueta de prioridad,
#    regex sobre el título normalizado, documentTypes OCDS que la implican) ──────────
_CATEGORIAS: list[tuple[str, tuple[str, ...], str, tuple[str, ...]]] = [
    ("bases_integradas", ("bases integradas", "bases_integradas", "integradas"),
     r"bases\s+integradas|integradas", ()),
    ("tdr", ("tdr", "terminos de referencia", "terminos_de_referencia"),
     r"terminos?\s+de\s+referencia|\btdr\b", ()),
    ("eett", ("eett", "especificaciones tecnicas", "especificaciones_tecnicas", "especificaciones"),
     r"especificaciones\s+tecnicas|\beett\b|especificaciones", ()),
    ("expediente_tecnico", ("expediente tecnico", "expediente_tecnico", "expediente"),
     r"expediente\s+tecnico|expediente", ("technicalSpecifications",)),
    ("presupuesto", ("presupuesto",), r"presupuesto|metrado|analisis\s+de\s+precios", ()),
    ("resumen_ejecutivo", ("resumen ejecutivo", "resumen_ejecutivo", "resumen"),
     r"resumen\s+ejecutivo", ()),
    ("informe", ("informe", "informe tecnico", "informe legal", "informe tecnico-legal", "informe_tecnico_legal",
                 "informe tecnico legal", "sustento"),
     r"informe|sustent", ()),
    ("resolucion", ("resolucion", "acto resolutivo", "acto_resolutivo", "acto", "acto aprobatorio"),
     r"resoluci[oó]n|acto\s+(resolutivo|aprobatorio|administrativo)|acuerdo\s+de\s+concejo|decreto", ()),
    ("cotizaciones", ("cotizaciones", "cotizacion", "indagacion de mercado", "estudio de mercado"),
     r"cotizaci|indagaci[oó]n\s+de\s+mercado|estudio\s+de\s+mercado", ()),
    ("bases", ("bases", "bases administrativas", "bases_administrativas", "biddingdocuments"),
     r"\bbases\b", ("biddingDocuments",)),
    ("acta", ("acta", "buena pro", "buena_pro", "otorgamiento", "awardnotice"),
     r"\bacta|buena\s+pro|otorgamiento|adjudicaci", ("awardNotice",)),
    ("cuadro_comparativo", ("cuadro comparativo", "cuadro_comparativo", "cuadro", "evaluacion", "evaluationreports",
                            "calificacion"),
     r"cuadro\s+comparativo|cuadro\s+de\s+evaluaci|evaluaci[oó]n|calificaci[oó]n", ("evaluationReports",)),
    ("propuesta", ("propuesta", "propuestas", "oferta", "ofertas"),
     r"propuesta|oferta", ()),
    ("contrato", ("contrato", "contratos", "archivos del contrato", "contractsigned"),
     r"contrato", ("contractSigned",)),
    ("orden", ("orden de", "orden de compra", "orden de servicio", "orden"),
     r"orden\s+de\s+(compra|servicio)|\borden\b", ()),
    ("adenda", ("adenda", "adendas", "adicional", "adicionales", "ampliacion", "contractamendment",
                "adendas/adicionales", "adendas adicionales"),
     r"adenda|adicional|ampliaci[oó]n|modificaci[oó]n\s+contractual", ("contractAmendment",)),
    ("valorizaciones", ("valorizaciones", "valorizacion"), r"valorizaci", ()),
    ("absolucion", ("absolucion", "absolucion de consultas", "consultas", "observaciones", "clarifications",
                    "pliego"),
     r"absoluci|consultas|observaciones|pliego", ("clarifications",)),
]
_CAT_BY_KEY = {c[0]: c for c in _CATEGORIAS}


def _resolver_etiqueta(etiqueta: str) -> tuple[list[str], list[str]]:
    """Etiqueta de `prioridad` → (claves canónicas, patrones libres). Una etiqueta puede
    traer alternativas separadas por '/', '|' o ' o ' ("Acta/Cuadro comparativo",
    "Contrato/Orden", "Adendas/adicionales"). Lo que no está en el catálogo se usa como
    substring sobre título/tipo normalizados."""
    keys: list[str] = []
    libres: list[str] = []
    partes = [p for p in re.split(r"\s*[/|]\s*|\s+o\s+", _norm(etiqueta).replace("_", " ")) if p]
    for e in partes:
        e = e.strip()
        hit = None
        for key, aliases, _rx, dtypes in _CATEGORIAS:
            if (e == key.replace("_", " ") or e in tuple(_norm(a) for a in aliases)
                    or e in tuple(_norm(d) for d in dtypes)):
                hit = key
                break
        if hit is None:
            # plural/singular simple: "adendas" → "adenda", "informes" → "informe"
            for key, aliases, _rx, _d in _CATEGORIAS:
                if e.rstrip("s") in tuple(_norm(a).rstrip("s") for a in aliases):
                    hit = key
                    break
        if hit is not None:
            if hit not in keys:
                keys.append(hit)
        elif e:
            libres.append(e)
    return keys, libres


def categorias_de(titulo: str | None, tipo: str | None) -> list[str]:
    """Todas las categorías que describen un documento (título + documentType).
    Un título como 'Bases Integradas' devuelve ['bases_integradas', 'bases'] (la más
    específica primero); un 'Documentos de Otorgamiento de Buena Pro' → ['acta']."""
    t = _norm(titulo)
    d = str(tipo or "")
    out: list[str] = []
    for key, _aliases, rx, dtypes in _CATEGORIAS:
        if (t and re.search(rx, t)) or (d and d in dtypes):
            out.append(key)
    # 'bases integradas' implica 'bases', pero 'bases' no debe ganar como integradas.
    if "bases" in out and "bases_integradas" in out:
        out.remove("bases")
        out.append("bases")
    return out


def rank_documento(titulo: str | None, tipo: str | None, prioridad: Iterable[str]) -> tuple[int, str | None]:
    """(posición en `prioridad` del primer match, categoría) — sin match: (len(prioridad), None)."""
    prios = list(prioridad or ())
    cats = categorias_de(titulo, tipo)
    t = _norm(titulo)
    d = _norm(tipo)
    resueltas = [_resolver_etiqueta(p) for p in prios]
    for i, (keys, libres) in enumerate(resueltas):
        for key in keys:
            if key in cats:
                # 'bases' genérico no captura 'bases integradas' si 'bases integradas' está
                # más adelante en la lista: la categoría específica manda.
                if key == "bases" and "bases_integradas" in cats and any(
                        "bases_integradas" in k2 for k2, _l in resueltas[i + 1:]):
                    continue
                return i, key
        for libre in libres:
            if libre and (libre in t or libre in d):
                return i, libre
    return len(prios), (cats[0] if cats else None)


def _formato(fmt: str | None, *urls: str | None) -> str | None:
    """'application/pdf' → 'pdf'; si no viene, la extensión de gs:// o de la URL."""
    f = _norm(fmt)
    if f:
        f = f.split("/")[-1].split(";")[0].strip()
        f = {"x-rar-compressed": "rar", "x-rar": "rar", "vnd.rar": "rar", "x-zip-compressed": "zip",
             "octet-stream": "", "vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
             "vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "msword": "doc",
             "vnd.ms-excel": "xls", "x-7z-compressed": "7z"}.get(f, f)
        if f and re.fullmatch(r"[a-z0-9]{2,5}", f):
            return f
    for u in urls:
        if not u:
            continue
        m = re.search(r"\.([a-z0-9]{2,5})(?:[?#]|$)", u.lower())
        if m and m.group(1) not in ("com", "pe", "gob", "net", "org"):
            return m.group(1)
    return None


def _documentos_gcs_vigentes(ocid: str) -> list[dict]:
    """Filas vigentes de `documentos_gcs` para el ocid (formato corto o largo). Lista vacía si
    la tabla no existe o la BD no responde. Los tests la reemplazan (monkeypatch)."""
    try:
        from tools._core import _pg, _short_ocid
    except Exception:
        return []
    corto = _short_ocid(ocid) if ocid else ocid
    try:
        conn = _pg()
    except Exception as e:  # sin BD (tests, local sin credenciales)
        print(f"[doc_select] sin BD para documentos_gcs: {str(e)[:100]}", flush=True)
        return []
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, tipo, titulo, seccion, url_gcs, sha256, url_origen, formato, bytes
                 FROM documentos_gcs
                WHERE (ocid = %s OR ocid = %s) AND borrado_at IS NULL
                  AND (expira_at IS NULL OR expira_at > now())
                ORDER BY id""",
            (corto, ocid),
        )
        cols = ("gcs_id", "tipo", "titulo", "seccion", "url_gcs", "sha256", "url_origen", "formato", "bytes")
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    except Exception as e:
        print(f"[doc_select] documentos_gcs no disponible: {str(e)[:120]}", flush=True)
        return []
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _docs_del_record(ocds: dict | None) -> list[dict]:
    out: list[dict] = []
    cr = ocds or {}
    for stage, seccion in (("tender", "tender"), ("awards", "award"), ("contracts", "contract")):
        node = cr.get(stage)
        arr = node if isinstance(node, list) else ([node] if node else [])
        for nd in arr:
            if not isinstance(nd, dict):
                continue
            for d in (nd.get("documents") or []):
                if isinstance(d, dict) and (d.get("url") or d.get("id")):
                    out.append({
                        "id": str(d.get("id") or "") or None,
                        "url": d.get("url"),
                        "tipo": d.get("documentType"),
                        "titulo": d.get("title"),
                        "seccion": seccion,
                        "formato": d.get("format"),
                        "fecha": (d.get("datePublished") or "")[:10] or None,
                    })
    return out


def seleccionar_documentos(
    ocid: str,
    ocds: dict | None,
    doc_urls: dict[str, str] | None,
    prioridad: tuple[str, ...] | None = None,
    max_docs: int | None = None,
    doc_ids: Iterable[str] | None = None,
    gcs_rows: list[dict] | None = None,
    fetch_gcs: Callable[[str], list[dict]] | None = None,
) -> tuple[list[DocRef], list[dict]]:
    """Devuelve (elegidos, omitidos). DocRef = {id, url, gs, tipo, titulo, seccion, formato, sha256|None}.

    Lee documentos_gcs por ocid (vigentes) y los documentos del record (tender/awards/contracts);
    nunca llama a un LLM. `doc_ids` (body del orquestador) restringe el lote a esos ids OCDS /
    sha256 / URLs. `gcs_rows`/`fetch_gcs` permiten inyectar el catálogo (tests) en vez de leer
    la BD. `omitidos`: [{id, titulo, tipo, seccion, url, motivo}] con motivo ∈
    {tope_docs, no_en_doc_ids, duplicado_sha256, duplicado_url}.
    """
    prioridad = tuple(prioridad or PRIORIDAD_DEFAULT)
    max_docs = int(max_docs or MAX_DOCS_DEFAULT)
    doc_urls = doc_urls or {}
    if gcs_rows is None:
        gcs_rows = (fetch_gcs or _documentos_gcs_vigentes)(ocid) if ocid else []

    # ── 1. Unificar por URL normalizada ─────────────────────────────────────────
    by_url: dict[str, DocRef] = {}
    orden: list[str] = []          # claves en orden de aparición (estable)

    def _get(url_key: str) -> DocRef:
        if url_key not in by_url:
            by_url[url_key] = {"id": None, "url": None, "gs": None, "tipo": None, "titulo": None,
                               "seccion": None, "formato": None, "sha256": None, "categoria": None}
            orden.append(url_key)
        return by_url[url_key]

    # Record OCDS primero (id, título y sección oficiales). La primera aparición de una URL
    # manda; una segunda entrada con la misma URL (repetida en el record) se registra como
    # omitida `duplicado_url` para no perderla en silencio.
    omitidos: list[dict] = []
    for d in _docs_del_record(ocds):
        k = norm_url(d["url"]) or f"id:{d['id']}"
        if k in by_url and by_url[k].get("id"):
            omitidos.append(_omitido({**by_url[k], "id": d["id"], "titulo": d["titulo"]}, "duplicado_url"))
            continue
        ref = _get(k)
        ref.update({"id": d["id"] or ref["id"], "url": d["url"] or ref["url"], "tipo": d["tipo"] or ref["tipo"],
                    "titulo": d["titulo"] or ref["titulo"], "seccion": d["seccion"] or ref["seccion"],
                    "formato": ref["formato"] or _formato(d["formato"], d["url"])})

    # documentos_gcs: blob + sha256 (+ metadata si el record no lo trae)
    for r in gcs_rows or []:
        k = norm_url(r.get("url_origen")) or f"gs:{r.get('url_gcs')}"
        ref = _get(k)
        ref["gs"] = ref["gs"] or r.get("url_gcs")
        ref["sha256"] = ref["sha256"] or r.get("sha256")
        ref["url"] = ref["url"] or r.get("url_origen")
        ref["tipo"] = ref["tipo"] or r.get("tipo")
        ref["titulo"] = ref["titulo"] or r.get("titulo")
        ref["seccion"] = ref["seccion"] or r.get("seccion")
        ref["formato"] = _formato(r.get("formato"), r.get("url_gcs")) or ref["formato"]
        if ref["id"] is None and r.get("gcs_id") is not None:
            ref["id"] = f"gcs:{r['gcs_id']}"

    # doc_urls del body: {url_origen: gs://…}
    for u, gs in doc_urls.items():
        if not u or not gs:
            continue
        k = norm_url(u)
        ref = _get(k)
        ref["gs"] = ref["gs"] or gs
        ref["url"] = ref["url"] or u
        ref["formato"] = ref["formato"] or _formato(None, gs, u)
        if ref["id"] is None:
            ref["id"] = f"url:{k[-40:]}"

    refs = [by_url[k] for k in orden]
    for ref in refs:
        if not ref["formato"]:
            ref["formato"] = _formato(None, ref.get("gs"), ref.get("url"))
        if not ref["seccion"]:
            ref["seccion"] = "tender"

    # ── 2. Dedupe por sha256 (mismo blob publicado con dos URLs) ───────────────
    vistos_sha: dict[str, DocRef] = {}
    unicos: list[DocRef] = []
    for ref in refs:
        sha = ref.get("sha256")
        if sha and sha in vistos_sha:
            omitidos.append(_omitido(ref, "duplicado_sha256"))
            continue
        if sha:
            vistos_sha[sha] = ref
        unicos.append(ref)

    # ── 3. Restricción por doc_ids (body) ──────────────────────────────────────
    if doc_ids:
        quiere = {str(x).strip() for x in doc_ids if str(x or "").strip()}
        quiere_norm = {norm_url(x) for x in quiere if x.startswith("http")}
        filtrados = []
        for ref in unicos:
            claves = {str(ref.get("id") or ""), str(ref.get("sha256") or ""), str(ref.get("gs") or "")}
            if claves & quiere or (ref.get("url") and norm_url(ref["url"]) in quiere_norm):
                filtrados.append(ref)
            else:
                omitidos.append(_omitido(ref, "no_en_doc_ids"))
        unicos = filtrados

    # ── 4. Orden por prioridad del perfil (estable) y tope ─────────────────────
    def _clave(ix_ref: tuple[int, DocRef]):
        ix, ref = ix_ref
        rank, cat = rank_documento(ref.get("titulo"), ref.get("tipo"), prioridad)
        ref["categoria"] = cat
        return (rank, _SECCION_ORDEN.get(ref.get("seccion") or "tender", 3), ix)

    ordenados = [r for _, r in sorted(enumerate(unicos), key=_clave)]
    elegidos = ordenados[:max_docs]
    for ref in ordenados[max_docs:]:
        omitidos.append(_omitido(ref, "tope_docs"))
    return elegidos, omitidos


def _omitido(ref: DocRef, motivo: str) -> dict:
    return {"id": ref.get("id"), "titulo": ref.get("titulo"), "tipo": ref.get("tipo"),
            "seccion": ref.get("seccion"), "url": ref.get("url"), "motivo": motivo}


def recorte_seleccion(elegidos: list[DocRef], omitidos: list[dict], max_docs: int) -> dict | None:
    """Entrada para state['recortes'] si la selección dejó documentos fuera por el tope."""
    fuera = [o for o in omitidos if o.get("motivo") == "tope_docs"]
    if not fuera:
        return None
    return {"donde": "seleccion_documentos", "limite": f"parse_max_docs={max_docs}",
            "omitido": [{"id": o.get("id"), "titulo": o.get("titulo"), "tipo": o.get("tipo")} for o in fuera]}


__all__ = ["DocRef", "PRIORIDAD_DEFAULT", "MAX_DOCS_DEFAULT", "seleccionar_documentos", "rank_documento",
           "categorias_de", "norm_url", "recorte_seleccion"]
