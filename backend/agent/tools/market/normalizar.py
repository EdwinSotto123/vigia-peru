"""Tools del dominio: market."""

from tools._core import *  # noqa: F401,F403
from .config import MARKET_UMBRAL_ELEVADO, MARKET_UMBRAL_MUY_ELEVADO

class _StateCtx:
    """ToolContext mínimo para reutilizar tools que solo usan `.state`."""
    __slots__ = ("state",)

    def __init__(self, state: dict):
        self.state = state


# ── Registro en state (recortes / descartes / grounding) ─────────────
def _registrar_descarte(state: dict, donde: str, motivo: str, detalle: str = "") -> None:
    state.setdefault("descartes", []).append({"donde": donde, "motivo": motivo, "detalle": str(detalle)[:300]})


def _registrar_recorte(state: dict, donde: str, limite, omitido) -> None:
    state.setdefault("recortes", []).append({"donde": donde, "limite": limite, "omitido": omitido})


def _publicar_grounding(state: dict, fuentes: list[dict]) -> None:
    """Publica URLs REALES en `state["grounding_urls"]` (lista de str, sin duplicados) y el
    detalle {uri, titulo, dominio, origen} en `state["market_grounding"]`."""
    urls = state.setdefault("grounding_urls", [])
    if not isinstance(urls, list):
        urls = state["grounding_urls"] = list(urls) if isinstance(urls, (set, tuple)) else []
    det = state.setdefault("market_grounding", [])
    vistos = set(urls)
    for f in fuentes:
        u = (f or {}).get("uri")
        if not u or u in vistos:
            continue
        vistos.add(u)
        urls.append(u)
        det.append({"uri": u, "titulo": f.get("titulo"), "dominio": f.get("dominio"), "origen": f.get("origen", "grounding")})


# ── Aritmética (todo en código, nada en el LLM) ──────────────────────
def _mediana(vals: list[float]) -> float | None:
    v = sorted(x for x in vals if isinstance(x, (int, float)))
    if not v:
        return None
    n = len(v)
    return float(v[n // 2]) if n % 2 else float((v[n // 2 - 1] + v[n // 2]) / 2)


def _percentil(vals: list[float], p: float) -> float | None:
    v = sorted(x for x in vals if isinstance(x, (int, float)))
    if not v:
        return None
    if len(v) == 1:
        return float(v[0])
    k = (len(v) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return float(v[lo] + (v[hi] - v[lo]) * (k - lo))


def _diff_pct(valor, mediana) -> float | None:
    try:
        if valor is None or mediana is None or float(mediana) <= 0:
            return None
        return round((float(valor) - float(mediana)) / float(mediana) * 100, 2)
    except (TypeError, ValueError):
        return None


def _veredicto(diff_pct) -> str:
    """|Δ| < 15 alineado · 15 ≤ Δ < 50 elevado · Δ ≥ 50 muy_elevado · Δ ≤ −15 barato."""
    if not isinstance(diff_pct, (int, float)):
        return "sin_dato"
    if diff_pct >= MARKET_UMBRAL_MUY_ELEVADO:
        return "muy_elevado"
    if diff_pct >= MARKET_UMBRAL_ELEVADO:
        return "elevado"
    if diff_pct <= -MARKET_UMBRAL_ELEVADO:
        return "barato"
    return "alineado"


def _filtrar_outliers(precios: list[float], factor: float = 5.0) -> tuple[list[float], list[float]]:
    """Descarta precios fuera de [mediana/factor, mediana×factor] (otro producto u otra
    unidad). Devuelve (conservados, descartados)."""
    if len(precios) < 3:
        return list(precios), []
    med = _mediana(precios)
    keep = [p for p in precios if med / factor <= p <= med * factor]
    drop = [p for p in precios if p not in keep]
    return keep, drop


def _market_to_num(x):
    """Coerce un precio a float. Acepta números y strings tipo 'S/ 1,200.50',
    '1.200,50', '120 soles'. Devuelve None si no es un número positivo."""
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return float(x) if x > 0 else None
    if not isinstance(x, str):
        return None
    s = x.strip().lower()
    for tok in ("s/.", "s/", "soles", "sol", "pen", "us$", "usd", "$"):
        s = s.replace(tok, "")
    s = s.replace(" ", "")
    if "," in s and "." in s:
        # 1.200,50 (europeo) vs 1,200.50 (anglo): el último separador es el decimal
        s = (s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".")
             else s.replace(",", ""))
    elif "," in s:
        dec = s.split(",")[-1]
        s = s.replace(",", "." if len(dec) <= 2 else "")
    s = re.sub(r"[^0-9.]", "", s)
    if not s or s == ".":
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v > 0 else None


def _norm_num(x) -> str:
    s = str(x if x is not None else "").strip()
    return s.lstrip("0") or "0" if s else ""


def _finding_vacio(it: dict, motivo: str, comentario: str) -> dict:
    return {
        "item_numero": it.get("numero"),
        "item_descripcion": (it.get("descripcion_corta") or it.get("descripcion") or "")[:300],
        "cantidad": it.get("cantidad"), "unidad": it.get("unidad"),
        "precio_unitario_referencial": it.get("precio_unitario_referencial"),
        "precio_unitario_ofertado": it.get("precio_unitario_ofertado"),
        "origen_precio_ofertado": it.get("origen_precio"),
        "precios_observados": [], "proveedores_potenciales": [],
        "caracteristicas_solicitadas_clave": [],
        "precio_mediana_mercado": None, "rango_min": None, "rango_max": None, "n_precios": 0,
        "n_precios_normalizados": 0,
        "diff_pct": None, "diff_base": None, "veredicto": "sin_dato",
        "es_estimacion": True, "motivo_estimacion": motivo,
        "estado": "sin_dato", "evidencia": [], "spec_restrictiva": None,
        "referencias_internas": [], "ancla_regional": {"estado": "sin_dato", "motivo": "no_consultada"},
        "comentario": comentario,
    }


_OBJ_STOP = {
    "para", "de", "la", "el", "y", "del", "con", "en", "por", "los", "las", "un", "una", "al", "a", "e", "o",
    "adquisicion", "contratacion", "suministro", "compra", "servicio", "servicios", "proyecto", "obra",
    "meta", "municipalidad", "distrital", "provincial", "regional", "gobierno", "mejoramiento",
    "ampliacion", "construccion", "creacion", "instalacion", "sistema", "distrito", "provincia",
    "departamento", "region", "cui", "item", "lote", "paquete", "segun", "tipo", "cantidad", "unidad",
    "und", "pulgadas", "pulg", "plan", "programa", "ejecucion", "mantenimiento", "recuperacion",
    "reposicion", "puesto", "obra", "almacen", "entidad", "sede", "nuevo", "nueva", "anio", "fiscal",
    "in", "cm", "mm", "kg", "gal", "m2", "m3", "und", "unid", "pza", "bolsa", "saco", "rollo",
}
# Comodines: objetos genéricos que no dicen qué se compra (todo ítem "coincide").
_OBJ_COMODINES = ("bien", "material", "insumo", "producto", "articulo", "mercader", "equipamient", "divers")
# Hiperónimo → raíces de hipónimos frecuentes en compras públicas.
_OBJ_SINONIMOS = {
    "geosintet": ("geomall", "geotext", "geomembr", "geocel", "geodren", "geored"),
    "perfil": ("parant", "riel", "perfil", "canal", "omega", "angul", "esquiner"),
    "drywall": ("parant", "riel", "placa", "plancha", "yeso"),
    "combust": ("diesel", "gasohol", "gasolin", "petrol", "biodiesel", "glp", "gnv"),
    "aliment": ("arroz", "azucar", "aceit", "leche", "atun", "fideo", "lentej", "frijol", "menestr",
                "harin", "avena", "conserv", "quinua", "sal", "galleta"),
    "agregad": ("piedr", "arena", "hormig", "grava", "afirm", "confit", "ripio"),
    "ferret": ("clavo", "alambr", "tornill", "pintur", "tubo", "cement", "fierro", "acero"),
    "util": ("papel", "lapic", "cuadern", "boligr", "archiv", "folder", "tinta", "toner"),
    "comput": ("laptop", "computador", "cpu", "monitor", "impresor", "teclad", "mouse", "servidor", "tablet"),
    "equip": ("laptop", "computador", "monitor", "impresor", "estacion", "gps", "camara", "dron"),
    "topograf": ("estacion", "nivel", "gps", "prisma", "tripod", "mira"),
    "medicament": ("tablet", "ampoll", "jarab", "capsul", "inyect"),
    "reactiv": ("kit", "antiglobul", "suero", "control", "reactiv", "calibr"),
    "inmunohemat": ("kit", "antiglobul", "suero", "reactiv", "tarjet", "gel"),
    "vehicul": ("camion", "camionet", "volquet", "motocicl", "automov", "minibus", "omnibus"),
    "llanta": ("neumat", "llanta"),
    "uniform": ("blusa", "pantalon", "camisa", "polo", "casaca", "chaleco", "zapato", "gorra"),
    "vestuar": ("blusa", "pantalon", "camisa", "polo", "casaca", "chaleco", "zapato", "gorra"),
    "mobiliar": ("escritor", "silla", "mesa", "estant", "archivador", "carpeta"),
}
_OBJ_SUFIJOS = ("erias", "eria", "icas", "icos", "ica", "ico", "ales", "al", "es", "s", "a", "o", "e")


def _sin_tildes(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn")


def _raiz(tok: str) -> str:
    """Raíz muy simple (es): minúsculas sin tildes y hasta 2 sufijos frecuentes recortados."""
    t = _sin_tildes(tok).lower()
    for _ in range(2):
        for suf in _OBJ_SUFIJOS:
            if t.endswith(suf) and len(t) - len(suf) >= 4:
                t = t[: -len(suf)]
                break
    return t


def _raices(texto: str) -> set[str]:
    """Raíces de las palabras significativas: alfabéticas ≥ 3 letras (sin stopwords) y números de
    ≥ 2 dígitos (calibres, medidas: "10", "12", "50")."""
    out: set[str] = set()
    for tok in re.split(r"[^0-9a-záéíóúñü]+", _sin_tildes(texto or "").lower()):
        if not tok:
            continue
        if tok.isdigit():
            if len(tok) >= 2:
                out.add(tok)
            continue
        if len(tok) < 3 or tok in _OBJ_STOP or not tok.isalpha():
            continue
        out.add(_raiz(tok))
    return out


def _raices_coinciden(a: str, b: str) -> bool:
    if a.isdigit() or b.isdigit():
        return a == b
    if len(a) >= 5 and len(b) >= 5:
        return a[:5] == b[:5]
    return a == b


def _solape_raices(item_texto: str, otro_texto: str) -> float:
    """Fracción de raíces del ítem presentes en `otro_texto` (0..1)."""
    ri, ro = _raices(item_texto), _raices(otro_texto)
    if not ri or not ro:
        return 0.0
    n = sum(1 for a in ri if any(_raices_coinciden(a, b) for b in ro))
    return n / len(ri)


def _coincide_objeto_fallback(objeto: str, items) -> bool:
    """Fallback local de `coincide_objeto` (R1 la define en compliance_rules): raíz de palabras +
    sinónimos/hiperónimos + comodines. `items`: str o dict con descripcion/descripcion_corta."""
    ro = _raices(objeto)
    if not ro:
        return True
    if any(r.startswith(c) for r in ro for c in _OBJ_COMODINES):
        return True
    for it in items or []:
        texto = it if isinstance(it, str) else " ".join(
            str(it.get(k) or "") for k in ("descripcion_corta", "descripcion", "item_descripcion")) if isinstance(it, dict) else str(it)
        ri = _raices(texto)
        if not ri:
            continue
        if any(_raices_coinciden(a, b) for a in ro for b in ri):
            return True
        for hiper, hipos in _OBJ_SINONIMOS.items():
            if any(_pref(a, hiper) for a in ro) and any(_pref(b, h) for b in ri for h in hipos):
                return True
            if any(_pref(b, hiper) for b in ri) and any(_pref(a, h) for a in ro for h in hipos):
                return True
    return False


def _pref(raiz: str, patron: str) -> bool:
    """`raiz` (ya reducida) comparte prefijo con `patron` (hiperónimo/hipónimo del mapa)."""
    p = _raiz(patron)
    if raiz == p:
        return True
    n = min(len(raiz), len(p), 5)
    return n >= 4 and raiz[:n] == p[:n]


def _coincide_objeto(objeto: str, items) -> bool:
    """Usa `tools.compliance_rules.coincide_objeto` si existe (helper único de R1); si no, el
    fallback por raíces de este módulo."""
    textos = []
    for it in items or []:
        if isinstance(it, dict):
            textos.append(" ".join(str(it.get(k) or "") for k in ("descripcion_corta", "descripcion", "item_descripcion")).strip())
        elif it:
            textos.append(str(it))
    try:
        from tools.compliance_rules import coincide_objeto as _co  # import perezoso (R1)
    except Exception:
        _co = None
    if _co is not None:
        try:
            return bool(_co(objeto, textos))
        except Exception:
            pass
    return _coincide_objeto_fallback(objeto, textos)


_DIM_UNIDADES: dict[str, tuple[str, float]] = {}
for _alias, _dim, _f in (
    ("kg kgs kilo kilos kilogramo kilogramos", "masa", 1.0),
    ("g gr grs gramo gramos", "masa", 0.001),
    ("tn ton tm tonelada toneladas", "masa", 1000.0),
    ("l lt lts litro litros", "volumen", 1.0),
    ("ml mililitro mililitros cc", "volumen", 0.001),
    ("gal galon galones", "volumen", 3.785),
    ("m mt mts metro metros ml", "longitud", 1.0),   # "ml" solo como unidad del ÍTEM (metro lineal)
    ("cm centimetro centimetros", "longitud", 0.01),
    ("m2 m² metro_cuadrado metros_cuadrados", "area", 1.0),
    ("m3 m³ metro_cubico metros_cubicos", "volumen_solido", 1.0),
):
    for _a in _alias.split():
        _DIM_UNIDADES.setdefault(_a, (_dim, _f))
_DIM_UNIDADES["ml"] = ("volumen", 0.001)   # en precios observados "ml" es mililitro
_CONTENEDORES = {
    "und", "unidad", "unidades", "unid", "u", "pieza", "piezas", "pza", "pzas", "bolsa", "bolsas", "saco",
    "sacos", "rollo", "rollos", "caja", "cajas", "paquete", "paquetes", "lata", "latas", "balde", "baldes",
    "cilindro", "cilindros", "bidon", "bidones", "botella", "botellas", "frasco", "frascos", "galonera",
    "galoneras", "juego", "juegos", "kit", "kits", "par", "pares", "plancha", "planchas", "barra", "barras",
    "tubo", "tubos", "envase", "envases", "display", "pack", "sobre", "sobres", "frasco", "tarro", "tarros",
    "cono", "conos", "pliego", "pliegos", "resma", "resmas", "cartucho", "cartuchos", "bulto", "bultos",
}
_UNIDADES_MEDIDA = ("masa", "volumen", "longitud", "area", "volumen_solido")


def _unidad_canon(u, *, item: bool = False) -> tuple[str, float] | None:
    """('masa', 1.0) para "KG"; ('unidad', 1.0) para envases/piezas; None si no se reconoce.
    Con `item=True`, "ML"/"metro lineal" es METRO LINEAL (convención SEACE), no mililitro."""
    s = _sin_tildes(str(u or "")).lower().strip().strip(".").replace("  ", " ")
    if not s:
        return None
    if item and s in ("ml", "metro lineal", "metros lineales", "m.l", "m.l."):
        return ("longitud", 1.0)
    s = s.replace("metros cuadrados", "m2").replace("metro cuadrado", "m2").replace("metros cubicos", "m3") \
         .replace("metro cubico", "m3").replace("metros lineales", "m").replace("metro lineal", "m") \
         .replace("kilogramos", "kg").replace("kilogramo", "kg").replace("galones", "gal").replace("galon", "gal")
    if s in _DIM_UNIDADES:
        return _DIM_UNIDADES[s]
    primero = re.split(r"[\s/()]+", s)[0]
    if primero in _DIM_UNIDADES:
        return _DIM_UNIDADES[primero]
    if primero in _CONTENEDORES or s in _CONTENEDORES:
        return ("unidad", 1.0)
    return None


_NUM = r"(\d+(?:[.,]\d+)?)"
_RE_MASA = re.compile(_NUM + r"\s*(kg|kgs|kilos?|kilogramos?|gr|grs|g|gramos?|tn|ton|toneladas?)(?![a-z])")
_RE_VOL = re.compile(_NUM + r"\s*(ml|mililitros?|lts?|litros?|l|gal|galon(?:es)?)(?![a-z])")
_RE_AREA = re.compile(_NUM + r"\s*(m2|m²|metros? cuadrados?)(?![a-z])")
_RE_VOL3 = re.compile(_NUM + r"\s*(m3|m³|metros? cubicos?)(?![a-z])")
_RE_LONG = re.compile(_NUM + r"\s*(mts?|metros?|m)(?![a-z0-9²³])")
_RE_DIM2 = re.compile(_NUM + r"\s*(?:mts?|metros?|m)?\s*[x×]\s*" + _NUM + r"\s*(?:mts?|metros?|m)(?![a-z0-9²³])")
_RE_ESPESOR = re.compile(r"(\d+[.,]\d+)\s*mm(?![a-z])")


def _num_es(s: str) -> float | None:
    try:
        s = s.replace(",", ".") if s.count(",") == 1 and len(s.split(",")[-1]) <= 2 else s.replace(",", "")
        v = float(s)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def _presentacion(texto: str) -> dict:
    """Contenido declarado en un texto ("bolsa 5 kg", "rollo 4 m x 100 m", "parante x 3 m",
    "bidón 20 l"), en unidades base por dimensión. `longitud` solo si hay UNA longitud distinta."""
    t = _sin_tildes(texto or "").lower()
    out: dict = {}
    for rx, dim in ((_RE_MASA, "masa"), (_RE_VOL, "volumen"), (_RE_AREA, "area"), (_RE_VOL3, "volumen_solido")):
        for m in rx.finditer(t):
            v = _num_es(m.group(1))
            u = _DIM_UNIDADES.get(m.group(2))
            if v and u and dim not in out:
                out[dim] = v * u[1]
    dims = []
    for m in _RE_DIM2.finditer(t):
        a, b = _num_es(m.group(1)), _num_es(m.group(2))
        if a and b:
            dims.append((a, b))
    if dims and "area" not in out:
        out["area"] = dims[0][0] * dims[0][1]
        out["area_de_dimensiones"] = True
    longs = []
    for m in _RE_LONG.finditer(t):
        v = _num_es(m.group(1))
        if v and v not in longs:
            longs.append(v)
    if longs:
        out["longitudes"] = longs
        if len(longs) == 1:
            out["longitud"] = longs[0]
    return out


def _espesor_mm(texto: str) -> float | None:
    """Espesor/calibre declarado ("0.90 mm", "0,45mm"); solo valores con decimales y ≤ 3 mm."""
    vals = [_num_es(m.group(1)) for m in _RE_ESPESOR.finditer(_sin_tildes(texto or "").lower())]
    vals = [v for v in vals if v and v <= 3.0]
    return min(vals) if vals else None


def _contexto_unidad_item(it: dict) -> dict:
    descr = it.get("descripcion_corta") or it.get("descripcion") or ""
    canon = _unidad_canon(it.get("unidad"), item=True)
    return {
        "unidad": it.get("unidad"),
        "dim": canon[0] if canon else None,
        "factor": canon[1] if canon else 1.0,
        "presentacion": _presentacion(descr),
        "espesor_mm": _espesor_mm(descr),
    }


def _normalizar_precio_observado(precio: float, unidad_obs: str | None, producto_obs: str | None, ctx: dict) -> tuple[float | None, dict]:
    """Lleva un precio observado a la unidad del ítem. Devuelve (precio_normalizado | None si se
    descarta, info). Reglas:
      · misma_unidad / conversion_unidad: el precio viene "por kg", "por litro", "por galón"…
      · precio_por_presentacion: el precio es por envase/rollo/pieza con contenido declarado
        (bolsa 5 kg, rollo 4 m x 100 m, bidón 20 l) → precio / contenido.
      · prorrateo_<dim>: ítem por pieza con medida propia (parante de 4.00 m) vs pieza observada
        de otra medida (3 m) → precio × 4/3; <dim>_por_unidad_de_medida si el precio es por metro/kg.
      · espesor_distinto: calibre declarado en ambos lados y difiere > 20 % → descartado.
      · asumida_misma_unidad: sin presentación detectable → se asume la unidad del ítem (no cuenta
        como precio "normalizado" para el guardarraíl)."""
    info = {"precio_original": round(float(precio), 4), "unidad_observada": (unidad_obs or "")[:60] or None,
            "regla": "asumida_misma_unidad", "factor": 1.0}
    dim, f_item = ctx.get("dim"), ctx.get("factor") or 1.0
    texto = f"{unidad_obs or ''} {producto_obs or ''}"
    esp_i, esp_o = ctx.get("espesor_mm"), _espesor_mm(texto)
    if esp_i and esp_o and abs(esp_o - esp_i) / esp_i > 0.20:
        info.update({"regla": "espesor_distinto", "descartar": True,
                     "detalle": f"espesor observado {esp_o} mm vs exigido {esp_i} mm"})
        return None, info
    canon_obs = _unidad_canon(unidad_obs)
    pres_obs = _presentacion(texto)

    def _ok(factor: float, regla: str, **extra):
        info.update({"regla": regla, "factor": round(factor, 6), **extra})
        return round(float(precio) * factor, 4), info

    if dim in _UNIDADES_MEDIDA:
        if canon_obs and canon_obs[0] == dim:
            factor = f_item / canon_obs[1]
            return _ok(factor, "misma_unidad" if abs(factor - 1.0) < 1e-9 else "conversion_unidad")
        contenido = pres_obs.get(dim)
        if contenido:
            return _ok(f_item / contenido, "precio_por_presentacion", contenido_observado=contenido)
        return float(precio), info
    if dim == "unidad":
        pres_item = ctx.get("presentacion") or {}
        for d in ("longitud", "masa", "volumen", "area", "volumen_solido"):
            ci = pres_item.get(d)
            if not ci:
                continue
            if canon_obs and canon_obs[0] == d:
                return _ok(ci / canon_obs[1], f"{d}_por_unidad_de_medida", contenido_item=ci)
            co = pres_obs.get(d)
            if co:
                if abs(co - ci) / ci < 0.02:
                    return _ok(1.0, "misma_presentacion", contenido_item=ci, contenido_observado=co)
                return _ok(ci / co, f"prorrateo_{d}", contenido_item=ci, contenido_observado=co)
        return float(precio), info
    return float(precio), info
