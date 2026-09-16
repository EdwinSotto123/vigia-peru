"""Verificación DETERMINISTA de banderas y del dictamen (WS V · auditoría §6.2-5 y §6.2-10).

Nada que un LLM haya escrito se persiste como bandera si sus identificadores no
existen en las fuentes que el pipeline SÍ obtuvo de forma determinista:

  · RUC (11 dígitos)   → ocds.parties/awards/tenderers, sunat_decolecta, sunat_profiles,
                          rnp_*, texto completo de documentos (documentos_texto), BD propia
                          (empresas / entidades / rnp_conformacion_juridica).
  · DNI (8 dígitos)    → batch_person_lookup*, rnp_*, person_network_context, firmantes del
                          parser, dígitos 3-10 de un RUC 10xxxxxxxx, documentos_texto, BD.
  · Montos (S/ …)      → cualquier `amount` del OCDS, convocatoria_items, market_analysis
                          (los calcula el código), bloques del parser, documentos_texto.
  · Fechas             → OCDS, SUNAT, documentos_texto (solo motivo; no descartan).
  · URLs               → state['grounding_urls'] (lo llena M), dominios oficiales; si falta
                          el registro de grounding → `no_verificable` (nunca "falsa").

Interfaz compartida (plan 2026-09-15):
    verificar_bandera(flag, state) -> dict   # añade flag["verificacion"] = {ok, motivos, n_checks}
    verificar_dictamen(md, state)  -> {banderas_no_existentes, urls_no_respaldadas, degradado, ...}
    sanitizar_dictamen(md, ver)    -> (md_limpio, cambios)   # revisión lote 1 · T9

`ok=false` SOLO cuando un RUC, DNI o monto no está respaldado por ninguna fuente. Las
URLs y fechas nunca bajan `ok` (quedan como motivo `no_verificable`). Las banderas con
`ok=false` no se persisten: `persistence.py` las manda a state['descartes'].

T9 (revisión lote 1): el dictamen publicaba DNI de particulares (proveedor persona natural,
gerentes), un RUC de entidad inventado (1225062: verify solo avisaba) y URLs de gob.pe
inventadas aceptadas por dominio (1225256: `…/normas-legales/5923940-326-2026-…` redirige a
otra resolución). Ahora: TODO DNI se enmascara (`12****78`), RUC/DNI sin respaldo se
sustituyen por "[… no verificado]" y las URLs de gob.pe que no respalda el grounding pasan
por un HEAD (5 s) que exige institución + número de norma en la URL efectiva; si falla, la
URL se quita del dictamen y queda como no verificable.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any, Iterable

from tools._core import _pg, _safe_parse_json, _table_exists

# ─── Regex ──────────────────────────────────────────────────────────────────
_RUC_RE = re.compile(r"(?<!\d)(?:10|15|16|17|20)\d{9}(?!\d)")
# DNI solo con contexto explícito: un 8-dígitos suelto suele ser un N° de resolución,
# teléfono o parte de un monto. "DNI 12345678", "D.N.I. N° 12345678", "DNI: 12345678".
_DNI_CTX_RE = re.compile(r"\bD\.?\s?N\.?\s?I\.?\s*(?:N[°º\.]?\s*)?:?\s*(\d{8})(?!\d)", re.I)
_MONTO_RE = re.compile(
    r"S/\.?\s*(\d[\d.,]*)"                       # S/. 1,234.56  ·  S/ 1234
    r"|(\d[\d.,]*)\s*(?:nuevos\s+)?soles\b",     # 1234.56 soles
    re.I,
)
_URL_RE = re.compile(r"https?://[^\s)\]>\"'`]+")
_FECHA_RE = re.compile(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)|(?<!\d)(\d{1,2}/\d{1,2}/\d{4})(?!\d)")
_SLUG_RE = re.compile(r"\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b")
_DIGITS_RE = re.compile(r"\d+")
_PAGE_MARK_RE = re.compile(r"⟦p\.(\d+)⟧")

# Dominios oficiales: las URLs canónicas las genera el CÓDIGO (no un LLM) → respaldadas.
_OFFICIAL_DOMAINS = (
    "oece.gob.pe", "osce.gob.pe", "sunat.gob.pe", "seace.gob.pe", "contraloria.gob.pe",
    "jne.gob.pe", "onpe.gob.pe", "sunarp.gob.pe", "mef.gob.pe", "gob.pe",
)

# Catálogo de slugs de reglas que el sistema puede emitir (compliance_rules + persistence +
# banderas de juicio). verificar_dictamen usa el catálogo para detectar banderas CITADAS
# en el dictamen que NO fueron persistidas.
RULE_SLUGS: frozenset[str] = frozenset({
    "unico_postor_alto", "proveedor_sancionado_osce", "procedimiento_no_competitivo",
    "plazo_convocatoria_minimo", "tipo_proceso_vs_monto", "directa_sin_fundamento",
    "directa_emergencia_sin_acto_resolutivo", "directa_causal_imprecisa",
    "ruc_ganador_muy_nuevo", "ciiu_vs_objeto", "concentracion_entidad",
    "firmante_vinculado_ganador", "testaferro_multi_ruc", "ruc_ultra_nuevo",
    "postor_unico_mayoritario", "inconsistencia_doc_vs_ocds", "objeto_no_corresponde_documento",
    "extraccion_documento_fallida", "lobby_visits_pre_convocatoria",
    "sobreprecio_muy_elevado", "sobreprecio_elevado", "spec_restrictiva",
    "sobreprecio_lote_muy_elevado", "sobreprecio_lote_elevado", "red_flag_documental",
    "capacidad_operativa_cuestionable", "conflicto_interes_funcionario_empresa",
    "rubro_ciiu_incongruente", "adicional_acumulado", "personal_clave_vinculado",
    "fraccionamiento", "directa_recurrente",
    "antecedente_proveedor_web", "cobertura_prensa_adversa", "vinculo_red_personas",
    "oferta_igual_valor_referencial", "ofertas_agrupadas", "unica_oferta_valida", "ganador_no_invitado",
    "oferta_mas_barata_no_gana", "fecha_buena_pro_incoherente", "firmante_con_empresa_rnp", "postores_vinculados_rnp",
    "ampliacion_denegada_penalidad", "sancion_historica_oece", "penalidades_oece_historicas", "cuantia_al_limite_del_tope",
})

# Claves del state que son fuente FUERTE (obtenidas de forma determinista: OCDS, SUNAT,
# RNP, BD propia) vs fuente PARSER (extraídas por LLM del documento; sirven como
# respaldo secundario porque son el input literal que vieron los agentes downstream).
_STRONG_KEYS = ("ocds", "ocds_preloaded", "sunat_decolecta", "sunat_profiles",
                "person_network_context", "convocatoria_items", "estado_real",
                "analisis_postores")
_STRONG_PREFIXES = ("rnp_", "batch_person_lookup")
_PARSER_KEYS = ("parser_raw_consolidated", "document_analysis", "estudio_mercado",
                "contrato_final", "legal_analysis")
_MARKET_KEYS = ("market_analysis", "market_input")
_RESEARCH_KEYS = ("entity_personnel", "web_research", "news_research", "person_network")

_MAX_TEXT_CHARS = int(os.getenv("VERIFY_MAX_TEXT_CHARS", "2000000"))
_texto_cache: dict[str, str | None] = {}
_bd_cache: dict[str, bool] = {}


# ─── Extracción de identificadores del texto de una bandera ─────────────────
def _parse_monto(raw: str) -> list[float]:
    """Devuelve las interpretaciones plausibles de un monto escrito ('1,234.56',
    '1.234,56', '12,500', '1.234'). Ambigüedades → varias candidatas."""
    s = (raw or "").strip().rstrip(".,")
    if not s:
        return []
    out: set[float] = set()
    try:
        if "," in s and "." in s:
            if s.rfind(",") > s.rfind("."):       # 1.234,56 → europeo
                out.add(float(s.replace(".", "").replace(",", ".")))
            else:                                  # 1,234.56 → anglosajón
                out.add(float(s.replace(",", "")))
        elif "," in s:
            tail = s.rsplit(",", 1)[1]
            if len(tail) == 3:                     # 12,500 → miles
                out.add(float(s.replace(",", "")))
            out.add(float(s.replace(",", ".")))    # 12,50 → decimal (también candidata)
        elif "." in s:
            tail = s.rsplit(".", 1)[1]
            out.add(float(s))                      # 1234.56
            if len(tail) == 3:                     # 1.234 → puede ser miles
                out.add(float(s.replace(".", "")))
        else:
            out.add(float(s))
    except ValueError:
        return []
    return [v for v in out if v > 0]


def extraer_identificadores(texto: str) -> dict:
    """RUC, DNI (con contexto), montos, fechas y URLs presentes en un texto."""
    t = texto or ""
    rucs = sorted(set(_RUC_RE.findall(t)))
    dnis = sorted(set(_DNI_CTX_RE.findall(t)))
    montos: dict[str, list[float]] = {}
    for m in _MONTO_RE.finditer(t):
        raw = m.group(1) or m.group(2) or ""
        vals = _parse_monto(raw)
        if vals:
            montos[raw] = vals
    fechas = sorted({(a or b) for a, b in _FECHA_RE.findall(t)})
    urls = sorted({u.rstrip(".,;:") for u in _URL_RE.findall(t)})
    return {"rucs": rucs, "dnis": dnis, "montos": montos, "fechas": fechas, "urls": urls}


# ─── Recolección de fuentes desde el state ──────────────────────────────────
class _Fuentes:
    __slots__ = ("digits11", "digits8", "nums", "fechas", "urls")

    def __init__(self):
        self.digits11: set[str] = set()
        self.digits8: set[str] = set()
        self.nums: set[float] = set()
        self.fechas: set[str] = set()
        self.urls: set[str] = set()

    def add_text(self, s: str):
        for d in _DIGITS_RE.findall(s):
            if len(d) == 11:
                self.digits11.add(d)
                if d.startswith("10"):
                    self.digits8.add(d[2:10])      # RUC de persona natural = 10 + DNI + dv
            elif len(d) == 8:
                self.digits8.add(d)
        for a, b in _FECHA_RE.findall(s):
            self.fechas.add(a or b)
        for u in _URL_RE.findall(s):
            self.urls.add(u.rstrip(".,;:"))

    def walk(self, obj: Any, depth: int = 0):
        if depth > 12 or obj is None:
            return
        if isinstance(obj, bool):
            return
        if isinstance(obj, (int, float)):
            if obj > 0:
                self.nums.add(float(obj))
            return
        if isinstance(obj, str):
            if len(obj) > 200000:
                obj = obj[:200000]
            self.add_text(obj)
            # números "puros" en strings (montos que vienen como texto en OCDS/parser)
            if len(obj) <= 32:
                for v in _parse_monto(obj):
                    self.nums.add(v)
            return
        if isinstance(obj, dict):
            for v in obj.values():
                self.walk(v, depth + 1)
            return
        if isinstance(obj, (list, tuple, set)):
            for v in obj:
                self.walk(v, depth + 1)


def _fuentes_state(state: dict, keys: Iterable[str], prefixes: Iterable[str] = ()) -> _Fuentes:
    f = _Fuentes()
    for k in keys:
        v = state.get(k)
        if isinstance(v, str):
            parsed = _safe_parse_json(v)
            v = parsed if parsed else v
        f.walk(v)
    for k in list(state.keys()):
        if any(str(k).startswith(p) for p in prefixes):
            f.walk(state.get(k))
    return f


def _texto_documento(sha: str) -> str | None:
    """Texto completo de `documentos_texto` por sha256 (tabla del WS D). Cache por
    proceso. Si la tabla no existe todavía → None ("sin texto")."""
    if not sha:
        return None
    if sha in _texto_cache:
        return _texto_cache[sha]
    texto = None
    try:
        conn = _pg()
        try:
            cur = conn.cursor()
            if _table_exists(cur, "documentos_texto"):
                cur.execute("SELECT texto FROM documentos_texto WHERE sha256=%s", (sha,))
                row = cur.fetchone()
                if row and row[0]:
                    texto = str(row[0])[:_MAX_TEXT_CHARS]
        finally:
            conn.close()
    except Exception:
        texto = None
    if len(_texto_cache) > 60:
        _texto_cache.clear()
    _texto_cache[sha] = texto
    return texto


def textos_documentos(state: dict) -> dict[str, str]:
    """{sha256: texto completo} de los documentos registrados en state['documentos_texto'].
    Acepta también textos embebidos en el state (`texto`) si D los dejara ahí."""
    reg = state.get("documentos_texto")
    out: dict[str, str] = {}
    if not isinstance(reg, dict):
        return out
    for sha, meta in reg.items():
        if isinstance(meta, dict) and isinstance(meta.get("texto"), str) and meta["texto"]:
            out[sha] = meta["texto"][:_MAX_TEXT_CHARS]
            continue
        t = _texto_documento(str(sha))
        if t:
            out[sha] = t
    return out


def buscar_en_documentos(state: dict, patron: "re.Pattern[str] | str") -> dict | None:
    """Busca un regex en el texto completo de los documentos; devuelve
    {sha256, pagina, cita, match} del primer hallazgo o None."""
    rx = re.compile(patron, re.I) if isinstance(patron, str) else patron
    for sha, texto in textos_documentos(state).items():
        m = rx.search(texto)
        if not m:
            continue
        marks = list(_PAGE_MARK_RE.finditer(texto, 0, m.start()))
        pagina = int(marks[-1].group(1)) if marks else None
        ini, fin = max(0, m.start() - 120), min(len(texto), m.end() + 160)
        return {"sha256": sha, "pagina": pagina, "match": m.group(0),
                "cita": texto[ini:fin].replace("\n", " ").strip()[:240]}
    return None


def _en_bd(kind: str, valor: str) -> bool:
    """Último recurso para RUC/DNI: ¿existe en la BD propia (empresas/entidades/RNP/
    personas)? Solo confirma existencia de la entidad, no la relación afirmada."""
    key = f"{kind}:{valor}"
    if key in _bd_cache:
        return _bd_cache[key]
    ok = False
    try:
        conn = _pg()
        try:
            cur = conn.cursor()
            if kind == "ruc":
                cur.execute(
                    "SELECT 1 FROM empresas WHERE ruc=%s "
                    "UNION ALL SELECT 1 FROM entidades WHERE ruc=%s LIMIT 1",
                    (valor, valor))
                ok = cur.fetchone() is not None
                if not ok and _table_exists(cur, "rnp_conformacion_juridica"):
                    cur.execute("SELECT 1 FROM rnp_conformacion_juridica WHERE ruc_empresa=%s LIMIT 1", (valor,))
                    ok = cur.fetchone() is not None
            else:
                for tabla, col in (("personas", "dni"), ("rnp_conformacion_juridica", "numero_documento"),
                                   ("visitas_entidades", "numero_documento")):
                    if _table_exists(cur, tabla):
                        cur.execute(f"SELECT 1 FROM {tabla} WHERE {col}=%s LIMIT 1", (valor,))
                        if cur.fetchone() is not None:
                            ok = True
                            break
        finally:
            conn.close()
    except Exception:
        ok = False
    _bd_cache[key] = ok
    return ok


def _monto_en(nums: set[float], candidatos: list[float]) -> bool:
    for c in candidatos:
        tol = max(1.0, abs(c) * 0.005)
        for n in nums:
            if abs(n - c) <= tol:
                return True
    return False


def _monto_en_texto(texto: str, candidatos: list[float]) -> bool:
    for c in candidatos:
        variantes = {f"{c:,.2f}", f"{c:.2f}", f"{c:,.0f}", f"{c:.0f}", f"{c:,.1f}"}
        variantes |= {v.replace(",", "X").replace(".", ",").replace("X", ".") for v in list(variantes)}
        if any(v in texto for v in variantes):
            return True
    return False


_GROUNDING_REDIRECT = "vertexaisearch.cloud.google.com/grounding-api-redirect/"


def _es_redirect_grounding(url: str) -> bool:
    """URLs `…/grounding-api-redirect/…` las emite el grounding de Vertex, no el modelo: cuentan como
    respaldadas aunque no estén en state['grounding_urls'] (web/news/entity con schema no traen chunks)."""
    return _GROUNDING_REDIRECT in (url or "")


def _grounding_urls(state: dict) -> set[str] | None:
    g = state.get("grounding_urls")
    if g is None:
        return None
    out: set[str] = set()
    if isinstance(g, dict):
        g = list(g.keys()) + list(g.values())
    if isinstance(g, (list, tuple, set)):
        for x in g:
            if isinstance(x, str):
                out.add(x.rstrip("/"))
            elif isinstance(x, dict):
                for k in ("url", "uri", "link"):
                    if isinstance(x.get(k), str):
                        out.add(x[k].rstrip("/"))
    return out


def _host_path(url: str) -> tuple[str, str]:
    try:
        resto = re.sub(r"^https?://", "", url)
        host = resto.split("/")[0].split(":")[0].lower()
        path = "/" + resto.split("/", 1)[1] if "/" in resto else "/"
        return host, path.split("?")[0].split("#")[0]
    except Exception:
        return "", "/"


def _url_oficial(url: str) -> bool:
    host, _ = _host_path(url)
    return bool(host) and any(host == d or host.endswith("." + d) for d in _OFFICIAL_DOMAINS)


# Hosts cuyas URLs las construye el CÓDIGO (fichas OECE/SEACE/SUNAT por RUC u OCID): no
# necesitan HEAD. El resto de gob.pe (www.gob.pe/institucion/…/normas-legales/<id>-<slug>,
# portales municipales) lo escribe el modelo y el ID numérico suele ser inventado.
_CANONICAL_HOSTS = frozenset({
    "contratacionesabiertas.oece.gob.pe", "apps.oece.gob.pe", "apps.osce.gob.pe",
    "prod2.seace.gob.pe", "prod1.seace.gob.pe", "e-consultaruc.sunat.gob.pe",
    "www.oece.gob.pe", "www.osce.gob.pe", "portal.osce.gob.pe",
})
_NORMA_GOB_RE = re.compile(r"^/institucion/([^/]+)/normas-legales/(\d+)-([^/]+)/?$")
_HEAD_TIMEOUT = float(os.getenv("VERIFY_HEAD_TIMEOUT", "5"))
_HEAD_ACTIVO = os.getenv("VERIFY_HEAD_URLS", "1") != "0"
_head_cache: dict[str, tuple[int | None, str | None]] = {}


def _head(url: str, timeout: float | None = None) -> tuple[int | None, str | None]:
    """HEAD (o GET si el servidor no admite HEAD) con timeout corto. Devuelve
    (status, url_efectiva); (None, None) si la red falla. Cache por proceso."""
    if url in _head_cache:
        return _head_cache[url]
    timeout = timeout or _HEAD_TIMEOUT
    res: tuple[int | None, str | None] = (None, None)
    headers = {"User-Agent": "Mozilla/5.0 (compatible; VigiaPeru-verificador/1.0)"}
    for metodo in ("HEAD", "GET"):
        try:
            req = urllib.request.Request(url, method=metodo, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                res = (int(r.status), str(r.geturl()))
                break
        except urllib.error.HTTPError as e:
            res = (int(e.code), str(e.geturl() or url))
            if e.code in (403, 405) and metodo == "HEAD":
                continue
            break
        except Exception:
            res = (None, None)
            break
    if len(_head_cache) > 200:
        _head_cache.clear()
    _head_cache[url] = res
    return res


def verificar_url_gob(url: str) -> tuple[bool | None, str]:
    """¿Una URL de dominio oficial que NINGÚN output respalda existe de verdad y apunta a lo
    que dice? (True, motivo) / (False, motivo) / (None, 'head_desactivado').
      · host canónico (fichas por RUC/OCID) o solo dominio → True sin red;
      · www.gob.pe/institucion/<inst>/normas-legales/<id>-<slug> → HEAD 200 y la URL efectiva
        conserva la institución y los tokens con dígitos del slug (número y año de la norma);
      · otro path oficial → HEAD 200 y host final en gob.pe."""
    host, path = _host_path(url)
    if host in _CANONICAL_HOSTS:
        return True, "host_canonico"
    if path in ("", "/"):
        return True, "dominio_institucional"
    if not _HEAD_ACTIVO:
        return None, "head_desactivado"
    status, efectiva = _head(url)
    if status is None:
        return False, "sin_respuesta"
    if status != 200:
        return False, f"http_{status}"
    ehost, epath = _host_path(efectiva or url)
    if not (ehost == host or ehost.endswith(".gob.pe")):
        return False, "redirige_fuera_de_gob_pe"
    m = _NORMA_GOB_RE.match(path)
    if m:
        inst, _id, slug = m.groups()
        if f"/institucion/{inst}/" not in epath:
            return False, "redirige_a_otra_institucion"
        tokens = [t for t in slug.lower().split("-") if any(c.isdigit() for c in t)]
        if tokens and not all(t in epath.lower() for t in tokens):
            return False, "redirige_a_otra_norma"
    return True, "head_ok"


# ─── Verificación de UNA bandera ────────────────────────────────────────────
def _texto_bandera(flag: dict) -> str:
    parts = []
    for k in ("evidencia", "descripcion", "texto", "detalle", "norma"):
        v = flag.get(k)
        if isinstance(v, str):
            parts.append(v)
        elif v is not None and k == "detalle":
            parts.append(json.dumps(v, ensure_ascii=False, default=str)[:4000])
    ev = flag.get("evidencia")
    if isinstance(ev, (list, dict)):
        parts.append(json.dumps(ev, ensure_ascii=False, default=str)[:4000])
    for k in ("fuente_url", "fuente"):
        v = flag.get(k)
        if isinstance(v, str):
            parts.append(v)
    return "\n".join(parts)


def verificar_bandera(flag: dict, state: dict) -> dict:
    """Coteja RUC/DNI/montos/fechas/URLs de la bandera contra las fuentes deterministas
    del state. Escribe y devuelve flag["verificacion"] = {ok, motivos, n_checks}."""
    if not isinstance(flag, dict):
        return {"ok": False, "motivos": ["bandera_no_es_dict"], "n_checks": 0}
    state = state if isinstance(state, dict) else {}
    ids = extraer_identificadores(_texto_bandera(flag))
    motivos: list[str] = []
    ok = True
    n_checks = 0

    fuerte = _fuentes_state(state, _STRONG_KEYS, _STRONG_PREFIXES)
    parser = _fuentes_state(state, _PARSER_KEYS)
    market = _fuentes_state(state, _MARKET_KEYS)
    textos = textos_documentos(state) if (ids["rucs"] or ids["dnis"] or ids["montos"] or ids["fechas"]) else {}

    def _tier_digits(valor: str, largo: int) -> str | None:
        attr = "digits11" if largo == 11 else "digits8"
        if valor in getattr(fuerte, attr):
            return "fuente_determinista"
        if any(valor in t for t in textos.values()):
            return "documentos_texto"
        if valor in getattr(parser, attr):
            return "parser"
        if _en_bd("ruc" if largo == 11 else "dni", valor):
            return "bd_propia"
        return None

    for ruc in ids["rucs"]:
        n_checks += 1
        tier = _tier_digits(ruc, 11)
        if tier is None and ruc.startswith("10"):
            t8 = _tier_digits(ruc[2:10], 8)
            tier = f"dni_de_ruc_natural:{t8}" if t8 else None
        if tier:
            motivos.append(f"ruc:{ruc}:{tier}")
        else:
            ok = False
            motivos.append(f"ruc:{ruc}:no_respaldado")

    for dni in ids["dnis"]:
        n_checks += 1
        tier = _tier_digits(dni, 8)
        if tier:
            motivos.append(f"dni:{dni}:{tier}")
        else:
            ok = False
            motivos.append(f"dni:{dni}:no_respaldado")

    for raw, cands in ids["montos"].items():
        n_checks += 1
        if _monto_en(fuerte.nums, cands):
            motivos.append(f"monto:{raw}:fuente_determinista")
        elif _monto_en(market.nums, cands):
            motivos.append(f"monto:{raw}:market_analysis")
        elif _monto_en(parser.nums, cands):
            motivos.append(f"monto:{raw}:parser")
        elif any(_monto_en_texto(t, cands) for t in textos.values()):
            motivos.append(f"monto:{raw}:documentos_texto")
        else:
            ok = False
            motivos.append(f"monto:{raw}:no_respaldado")

    for fecha in ids["fechas"]:
        n_checks += 1
        if fecha in fuerte.fechas or fecha in parser.fechas or any(fecha in t for t in textos.values()):
            motivos.append(f"fecha:{fecha}:respaldada")
        else:
            motivos.append(f"fecha:{fecha}:no_verificable")

    grounding = _grounding_urls(state)
    for url in ids["urls"]:
        n_checks += 1
        u = url.rstrip("/")
        if _url_oficial(u) or u in fuerte.urls:
            motivos.append(f"url:{u}:oficial_o_determinista")
        elif _es_redirect_grounding(u):
            # URL de redirección del grounding de Vertex: solo el buscador la produce (no el modelo).
            motivos.append(f"url:{u}:grounding_redirect")
        elif grounding is None:
            motivos.append(f"url:{u}:no_verificable")
        elif u in grounding:
            motivos.append(f"url:{u}:grounding")
        else:
            motivos.append(f"url:{u}:no_en_grounding")

    if n_checks == 0:
        motivos.append("sin_identificadores_verificables")
    res = {"ok": ok, "motivos": motivos, "n_checks": n_checks}
    flag["verificacion"] = res
    return res


# ─── Verificación del dictamen ──────────────────────────────────────────────
def _banderas_persistidas(state: dict) -> list[dict]:
    """La BD es la verdad (varios agentes/hilos persisten): si hay `alerta_codigo` se lee de ahí;
    el state solo sirve de respaldo cuando no hay conexión."""
    b = state.get("banderas")
    en_state = [x for x in b if isinstance(x, dict)] if isinstance(b, list) else []
    codigo = state.get("alerta_codigo")
    if not codigo:
        return en_state
    try:
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT b.regla, b.severidad, b.evidencia, b.norma, b.fuente_url, b.agente_origen "
                "FROM banderas b JOIN alertas a ON a.id=b.alerta_id WHERE a.codigo=%s", (codigo,))
            filas = [{"regla": r[0], "severidad": r[1], "evidencia": r[2], "norma": r[3],
                      "fuente_url": r[4], "agente_origen": r[5]} for r in cur.fetchall()]
            return filas or en_state
        finally:
            conn.close()
    except Exception:
        return en_state


def verificar_dictamen(md: str, state: dict) -> dict:
    """Valida en código que el dictamen no cite banderas inexistentes ni URLs que
    ningún output respalde. Devuelve {banderas_no_existentes, urls_no_respaldadas,
    degradado, rucs_no_respaldados, dnis_no_respaldados, banderas_citadas}."""
    md = md or ""
    state = state if isinstance(state, dict) else {}
    persistidas = _banderas_persistidas(state)
    slugs_ok = {str(b.get("regla")) for b in persistidas if b.get("regla")}
    citadas = sorted({t for t in _SLUG_RE.findall(md.lower()) if t in RULE_SLUGS})
    banderas_no_existentes = [t for t in citadas if t not in slugs_ok]

    # URLs: respaldadas si están en grounding, en algún output del state o son oficiales.
    todo = _Fuentes()
    for k, v in state.items():
        if str(k).startswith("_") or k in ("docs_b64",):
            continue
        if isinstance(v, str):
            parsed = _safe_parse_json(v)
            v = parsed if parsed else v
        todo.walk(v)
    grounding = _grounding_urls(state) or set()
    urls_md = sorted({u.rstrip(".,;:") for u in _URL_RE.findall(md)})
    urls_no = []
    urls_gob_no: list[dict] = []
    urls_gob_ok: list[str] = []
    for u in urls_md:
        uu = u.rstrip("/")
        if uu in grounding or uu in todo.urls or u in todo.urls or _es_redirect_grounding(uu):
            continue
        if _url_oficial(uu):
            # T9: dominio oficial NO respaldado por ningún output → el modelo la escribió de
            # memoria. HEAD + coherencia institución/número de norma; si falla, se quita.
            ok, motivo = verificar_url_gob(u)
            if ok is False:
                urls_no.append(u)
                urls_gob_no.append({"url": u, "motivo": motivo})
            elif ok is None:
                urls_gob_no.append({"url": u, "motivo": motivo})
            else:
                urls_gob_ok.append(u)
            continue
        urls_no.append(u)

    ids = extraer_identificadores(md)
    fuerte = _fuentes_state(state, _STRONG_KEYS, _STRONG_PREFIXES)
    parser = _fuentes_state(state, _PARSER_KEYS)
    textos = textos_documentos(state) if (ids["rucs"] or ids["dnis"]) else {}
    rucs_no = [r for r in ids["rucs"]
               if r not in fuerte.digits11 and r not in parser.digits11
               and not any(r in t for t in textos.values()) and not _en_bd("ruc", r)]
    dnis_no = [d for d in ids["dnis"]
               if d not in fuerte.digits8 and d not in parser.digits8
               and not any(d in t for t in textos.values()) and not _en_bd("dni", d)]
    # Identificadores que solo aparecen en la investigación web (entity_personnel, web_research,
    # person_network: resoluciones de designación, etc.): respaldo secundario (grounding), no
    # degradan el dictamen pero quedan listados como no verificables.
    secundario = _fuentes_state(state, _RESEARCH_KEYS)
    rucs_sec = [r for r in rucs_no if r in secundario.digits11]
    dnis_sec = [d for d in dnis_no if d in secundario.digits8]
    rucs_no = [r for r in rucs_no if r not in rucs_sec]
    dnis_no = [d for d in dnis_no if d not in dnis_sec]

    degradado = bool(banderas_no_existentes or urls_no or rucs_no or dnis_no
                     or state.get("_dictamen_sanitizado"))
    return {
        "banderas_no_existentes": banderas_no_existentes,
        "urls_no_respaldadas": urls_no,
        "urls_gob_no_verificadas": urls_gob_no,
        "urls_gob_verificadas": urls_gob_ok,
        "degradado": degradado,
        "rucs_no_respaldados": rucs_no,
        "dnis_no_respaldados": dnis_no,
        "dnis_en_dictamen": ids["dnis"],
        "rucs_solo_investigacion": rucs_sec,
        "dnis_solo_investigacion": dnis_sec,
        "banderas_citadas": citadas,
        "n_banderas_persistidas": len(persistidas),
    }


# ─── Sanitización del dictamen (T9) ─────────────────────────────────────────
NO_VERIFICADO_RUC = "[RUC no verificado]"
NO_VERIFICADO_DNI = "[DNI no verificado]"
NO_VERIFICABLE_URL = "[URL no verificable]"


def enmascarar_dni(dni: str) -> str:
    """'12345678' → '12****78' (misma máscara que el frontend, Redact.tsx)."""
    d = str(dni or "")
    return d[:2] + "****" + d[-2:] if len(d) == 8 else d


def enmascarar_dnis(md: str) -> tuple[str, int]:
    """Enmascara TODO DNI con contexto ('DNI 12345678' → 'DNI 12****78'). Ningún dictamen
    publica un DNI en claro: ni de particulares ni de funcionarios (queda nombre y cargo)."""
    def _rep(m: "re.Match[str]") -> str:
        return m.group(0).replace(m.group(1), enmascarar_dni(m.group(1)))
    return _DNI_CTX_RE.subn(_rep, md or "")


def sanitizar_dictamen(md: str, ver: dict | None) -> tuple[str, dict]:
    """Aplica al markdown el resultado de `verificar_dictamen`: RUC/DNI sin respaldo →
    "[… no verificado]"; URLs no respaldadas (inventadas o gob.pe que no resolvió) → se
    quitan (el texto del enlace se conserva + "[URL no verificable]"); DNI restantes →
    enmascarados. Devuelve (md_limpio, cambios) — `cambios` va a
    `verificacion_dictamen.sanitizacion` y a state['descartes']."""
    md = md or ""
    ver = ver if isinstance(ver, dict) else {}
    cambios: dict = {"rucs_sustituidos": [], "dnis_sustituidos": [], "urls_eliminadas": [],
                     "dnis_enmascarados": 0}
    for ruc in ver.get("rucs_no_respaldados") or []:
        md, n = re.subn(rf"(?<!\d){re.escape(str(ruc))}(?!\d)", NO_VERIFICADO_RUC, md)
        if n:
            cambios["rucs_sustituidos"].append(str(ruc))
    for dni in ver.get("dnis_no_respaldados") or []:
        md, n = re.subn(rf"(?<!\d){re.escape(str(dni))}(?!\d)", NO_VERIFICADO_DNI, md)
        if n:
            cambios["dnis_sustituidos"].append(str(dni))
    for url in sorted(set(ver.get("urls_no_respaldadas") or []), key=len, reverse=True):
        u = str(url)
        antes = md
        # [texto](url) → texto [URL no verificable]
        md = re.sub(r"\[([^\]]*)\]\(\s*" + re.escape(u) + r"/?\s*\)", r"\1 " + NO_VERIFICABLE_URL, md)
        # <url> / url suelta
        md = re.sub(r"<\s*" + re.escape(u) + r"/?\s*>", NO_VERIFICABLE_URL, md)
        md = re.sub(re.escape(u) + r"/?(?![\w/.-])", NO_VERIFICABLE_URL, md)
        if md != antes:
            cambios["urls_eliminadas"].append(u)
    md, n = enmascarar_dnis(md)
    cambios["dnis_enmascarados"] = n
    cambios["modificado"] = bool(cambios["rucs_sustituidos"] or cambios["dnis_sustituidos"]
                                 or cambios["urls_eliminadas"] or n)
    return md, cambios


__all__ = ["verificar_bandera", "verificar_dictamen", "sanitizar_dictamen", "enmascarar_dnis",
           "verificar_url_gob", "extraer_identificadores", "buscar_en_documentos",
           "textos_documentos", "RULE_SLUGS"]
