"""Precios de catálogo de tiendas peruanas: el primer nivel (gratis) del mercado de bienes.

Las tiendas con plataforma VTEX publican su catálogo con precio vigente en una API pública
(`/api/catalog_system/pub/products/search?ft=<texto>`), sin clave ni costo. Para cada ítem:
  1. se buscan candidatos en todas las tiendas a la vez (≤ CATALOGO_POR_TIENDA por tienda);
  2. UNA llamada al modelo de juicio, para todos los ítems, elige qué candidatos son el MISMO bien en una
     presentación comparable (el texto de búsqueda trae ruido: "cemento" también devuelve fragua);
  3. los ítems con ≥ MARKET_MIN_PRECIOS precios elegidos ya no van a la búsqueda web pagada.
Medido 2026-10-17: Promart, Plaza Vea, Oechsle, Metro y Wong responden; Sodimac, Tottus y las farmacias no.
2026-10-18: también Cassinelli (ferretería) y Coolbox (tecnología). 2026-11-10: Shopstar, Estilos y Carsa (VTEX).

Con PRECIOS_URL + PRECIOS_TOKEN las consultas van al Worker vigia-precios (backend/precios-worker): caché de 7 días,
pausa automática de la tienda que falla e historial propio, y además las tiendas que no son VTEX (Sodimac, Falabella,
Ripley, Hiraoka, Tai Loy). Sin ellas, directo a las tiendas VTEX.
Combustibles: precios oficiales de Osinergmin vía el mismo Worker (`precios_combustible`).
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import re
import unicodedata
from urllib.parse import quote

TIENDAS = tuple(t.strip() for t in os.getenv(
    "CATALOGO_TIENDAS",
    "https://www.promart.pe,https://www.plazavea.com.pe,https://www.oechsle.pe,https://www.metro.pe,https://www.wong.pe,"
    "https://www.cassinelli.com,https://www.coolbox.pe,https://www.shopstar.pe,https://www.estilos.com.pe,https://www.carsa.pe",
).split(",") if t.strip())
CATALOGO_POR_TIENDA = int(os.getenv("CATALOGO_POR_TIENDA", "4"))
CATALOGO_MAX_ITEMS = int(os.getenv("CATALOGO_MAX_ITEMS", "15"))
CATALOGO_TIMEOUT_S = float(os.getenv("CATALOGO_TIMEOUT_S", "12"))
_UA = {"User-Agent": "Mozilla/5.0 (compatible; VigiaPeru/1.0; +https://vigia-web.vigiaperu.workers.dev)"}
# A las tiendas, como un navegador común (algunas rechazan los User-Agent que no lo son).
_UA_TIENDA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/130.0.0.0 Safari/537.36",
              "Accept": "application/json", "Accept-Language": "es-PE,es;q=0.9"}

_RUIDO = re.compile(r"\b(de|del|la|el|los|las|para|con|y|o|en|x|por|tipo|marca|modelo|similar|equivalente|unidad|und|"
                    r"un|una|incluye|segun|según|especificaciones|tecnicas|técnicas)\b", re.I)


def termino_busqueda(descripcion: str, max_palabras: int = 5) -> str:
    """Palabras que identifican el bien (sin medidas sueltas, signos ni conectores)."""
    t = unicodedata.normalize("NFD", descripcion or "")
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    t = re.sub(r"[^a-z0-9ñ ]+", " ", t)
    t = _RUIDO.sub(" ", t)
    palabras = [p for p in t.split() if len(p) > 1 and not p.isdigit()]
    return " ".join(palabras[:max_palabras])


def _numero(x) -> float:
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def oferta_vtex(p: dict) -> tuple[float, dict, str | None] | None:
    """(precio, SKU, vendedor) de un producto VTEX: el primer SKU con algún vendedor con stock y, en ese SKU, el menor
    precio. En Plaza Vea, Shopstar o Carsa el primer vendedor suele ser la tienda misma, con precio 0 y sin stock,
    mientras un vendedor del marketplace tiene el precio real (leer solo `sellers[0]` perdía esos productos). Sin
    ofertas por vendedor (Intelligent Search puede omitirlas), el rango de precios del producto."""
    items = [it for it in (p.get("items") or []) if isinstance(it, dict)]
    con_vendedores = False
    for it in items:
        mejor = None
        for s in it.get("sellers") or []:
            con_vendedores = True
            s = s if isinstance(s, dict) else {}
            o = s.get("commertialOffer") or {}
            precio = _numero(o.get("Price"))
            if precio <= 0 or ("AvailableQuantity" in o and _numero(o.get("AvailableQuantity")) <= 0):
                continue
            if mejor is None or precio < mejor[0]:
                mejor = (precio, it, s.get("sellerName"))
        if mejor:
            return mejor
    if con_vendedores or not items:
        return None
    bajo = _numero(((p.get("priceRange") or {}).get("sellingPrice") or {}).get("lowPrice"))
    return (bajo, items[0], None) if bajo > 0 else None


def productos_vtex(datos, base: str) -> list[dict]:
    """Respuesta VTEX (catálogo: lista; Intelligent Search: {"products": [...]}) → candidatos con precio y stock."""
    lista = datos.get("products") if isinstance(datos, dict) else datos
    out = []
    for p in lista if isinstance(lista, list) else []:
        if not isinstance(p, dict) or p.get("advertisement"):      # `advertisement`: patrocinado (VTEX Ads)
            continue
        oferta = oferta_vtex(p)
        if not oferta:
            continue
        precio, it, vendedor = oferta
        link = p.get("link") or f"/{p.get('linkText')}/p"
        out.append({
            "producto": str(p.get("productName") or "")[:200],
            "marca": p.get("brand"),
            "precio": precio,
            "unidad_medida": it.get("measurementUnit"),
            "multiplicador": it.get("unitMultiplier"),
            "vendedor": vendedor,
            "tienda": base.split("//")[-1].removeprefix("www."),
            "url": base + link if link.startswith("/") else link,
        })
    return out


def _de_tienda(base: str, termino: str) -> list[dict]:
    import httpx
    # quote() deja los espacios como %20: el firewall de VTEX rechaza "+".
    url = f"{base}/api/catalog_system/pub/products/search?ft={quote(termino)}&_from=0&_to={CATALOGO_POR_TIENDA - 1}"
    try:
        r = httpx.get(url, headers=_UA_TIENDA, timeout=CATALOGO_TIMEOUT_S)
        if r.status_code >= 400:
            return []
        return productos_vtex(r.json(), base)
    except Exception:  # noqa: BLE001  (una tienda caída no deja sin candidatos a las demás)
        return []


def _worker(ruta: str, params: dict) -> dict | None:
    import httpx
    url, token = os.getenv("PRECIOS_URL"), os.getenv("PRECIOS_TOKEN")
    if not (url and token):
        return None
    r = httpx.get(url.rstrip("/") + ruta, params=params, headers={"authorization": f"Bearer {token}", **_UA},
                  timeout=CATALOGO_TIMEOUT_S * 2)
    r.raise_for_status()
    return r.json()


def candidatos(termino: str) -> list[dict]:
    if not termino:
        return []
    try:
        d = _worker("/tiendas/buscar", {"q": termino, "n": CATALOGO_POR_TIENDA})
    except Exception:  # noqa: BLE001  (el Worker caído no deja al mercado sin catálogo: se va directo)
        d = None
    if d is not None:
        return [{"producto": p["producto"], "marca": p.get("marca"), "precio": float(p["precio"]),
                 "unidad_medida": p.get("unidad_medida"), "multiplicador": p.get("multiplicador"),
                 "vendedor": p.get("vendedor"), "tienda": p["tienda"], "url": p["url"]}
                for p in d.get("productos") or [] if p.get("precio") and not p.get("patrocinado")]
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(TIENDAS) or 1) as ex:
        listas = list(ex.map(lambda b: _de_tienda(b, termino), TIENDAS))
    return [c for lista in listas for c in lista]


_JUEZ = """Para cada ítem de una compra pública peruana tienes productos de catálogos de tiendas y compras de otras entidades
públicas ya adjudicadas ("compra de …": precio unitario pagado) (id, producto, precio).
Elige SOLO los que son el MISMO bien que el ítem (mismo tipo, misma especificación principal; la marca puede variar
salvo que el ítem exija una). Descarta accesorios, repuestos, otros productos y presentaciones no comparables.
Si el ítem exige certificaciones o especificaciones (`certificaciones`, `especificaciones`) y el nombre del producto no
muestra que las cumple, NO es el mismo bien: un casco básico no equivale a uno certificado ANSI Z89.1, ni un guante
común a uno dieléctrico. En compras públicas suele exigirse más que lo que vende una tienda: ante la duda, no elijas.
Para cada elegido indica cuántas unidades del ítem trae ese producto (`unidades_item`): p. ej. el ítem es "galón" y el
producto es un bidón de 5 galones → 5; si es la misma unidad → 1. Si dudas, no lo elijas.
Responde SOLO JSON: {"items": [{"numero": "<n>", "elegidos": [{"id": "<id>", "unidades_item": <número>}]}]}"""


def _juzgar(items: list[dict], cands: dict[str, list[dict]]) -> dict[str, list[tuple[dict, float]]]:
    from google.genai import types
    from tools._core import _gemini_client
    entrada = []
    for it in items:
        num = str(it.get("numero"))
        lista = cands.get(num) or []
        if not lista:
            continue
        entrada.append({"numero": num, "descripcion": (it.get("descripcion_corta") or "")[:300],
                        "unidad": it.get("unidad"), "marca_exigida": it.get("marca_o_modelo_exigido"),
                        "certificaciones": (it.get("certificaciones_exigidas") or [])[:6],
                        "especificaciones": str(it.get("requerimiento_tecnico_detallado") or it.get("valores_tecnicos_clave") or "")[:600],
                        "productos": [{"id": f"{num}-{i}", "producto": c["producto"], "marca": c.get("marca"),
                                       "precio": c["precio"]} for i, c in enumerate(lista)]})
    if not entrada:
        return {}
    # 15 tiendas × CATALOGO_POR_TIENDA candidatos por ítem: con 4000 la respuesta podía cortarse (JSON roto = ningún precio).
    cfg = types.GenerateContentConfig(temperature=0, max_output_tokens=8000, response_mime_type="application/json",
                                      labels={"etapa": "mercado_catalogo"})
    resp = _gemini_client().models.generate_content(
        model=os.getenv("CATALOGO_MODELO_JUEZ", os.getenv("MARKET_JUDGE_MODEL", "gemini-3.5-flash-lite")),
        contents=_JUEZ + "\n\n" + json.dumps(entrada, ensure_ascii=False), config=cfg)
    try:
        datos = json.loads(getattr(resp, "text", "") or "{}")
    except ValueError:
        return {}
    out: dict[str, list[tuple[dict, float]]] = {}
    for r in (datos.get("items") or []) if isinstance(datos, dict) else []:
        num = str(r.get("numero"))
        lista = cands.get(num) or []
        for e in r.get("elegidos") or []:
            try:
                idx = int(str(e.get("id")).rsplit("-", 1)[1])
                n = float(e.get("unidades_item") or 1) or 1.0
            except (ValueError, IndexError, TypeError):
                continue
            if 0 <= idx < len(lista):
                out.setdefault(num, []).append((lista[idx], n))
    return out


def _compras_estado(items: list[dict], hasta: str | None, departamento: str) -> tuple[dict[str, list[dict]], str | None]:
    """Candidatos de compras de otras entidades (OECE/CONOSCE) por ítem; una consulta por ítem, en paralelo."""
    if os.getenv("COMPRAS_ESTADO_ACTIVO", "1") == "0" or not items:
        return {}, None
    from .compras_estado import candidatos_compras_estado
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futs = {str(it.get("numero")): ex.submit(candidatos_compras_estado, it, hasta, departamento) for it in items}
    out, error = {}, None
    for num, f in futs.items():
        try:
            out[num] = f.result()
        except Exception as e:  # noqa: BLE001  (sin base, el nivel queda fuera; los catálogos siguen)
            error = str(e)[:160]
    return out, error


def precios_de_catalogo(items: list[dict], hasta: str | None = None, departamento: str = "") -> tuple[list[dict], dict]:
    """Precios en el formato de los workers de goods_retail (`precios[]`) + resumen para el informe. A los candidatos
    de las tiendas se suman las compras de otras entidades del mismo bien (precio unitario adjudicado, hasta la fecha
    de la convocatoria): la referencia de los bienes específicos que no venden las tiendas. El mismo juez elige."""
    elegibles = items[:CATALOGO_MAX_ITEMS]
    cands = {str(it.get("numero")): candidatos(termino_busqueda(it.get("descripcion_corta") or "")) for it in elegibles}
    del_estado, error_estado = _compras_estado(elegibles, hasta, departamento)
    for num, extra in del_estado.items():
        cands[num] = (cands.get(num) or []) + extra
    n_cands = sum(len(v) for v in cands.values())
    try:
        elegidos = _juzgar(elegibles, cands) if n_cands else {}
    except Exception as e:  # noqa: BLE001  (sin juez no se usa el catálogo: mejor nada que precios de otro bien)
        return [], {"error": str(e)[:200], "candidatos": n_cands}
    precios = []
    for it in elegibles:
        num = str(it.get("numero"))
        for c, n in elegidos.get(num, []):
            precios.append({
                "item_numero": num, "producto": c["producto"], "precio": round(c["precio"] / n, 4),
                "moneda_origen": "PEN", "unidad": it.get("unidad") or "Unidad", "proveedor": c["tienda"],
                "fuentes": [{"uri": c["url"], "titulo": c["producto"],
                             "dominio": c["url"].split("//")[-1].split("/")[0] if c.get("origen") == "conosce" else c["tienda"]}],
                "origen": c.get("origen") or "catalogo_tienda", "precio_publicado": c["precio"], "unidades_por_producto": n,
            })
    return precios, {"tiendas": list(TIENDAS), "items_consultados": len(elegibles), "candidatos": n_cands,
                     "candidatos_compras_estado": sum(len(v) for v in del_estado.values()),
                     **({"error_compras_estado": error_estado} if error_estado else {}),
                     "precios_elegidos": len(precios),
                     "precios_compras_estado": sum(1 for p in precios if p["origen"] == "conosce")}


# ─── combustibles: precios oficiales de Osinergmin (vía vigia-precios) ──────────
_COMBUSTIBLE = re.compile(r"\b(diesel|di[eé]sel|petr[oó]leo diesel|gasohol|gasolina|glp|gas licuado|petr[oó]leo industrial)\b", re.I)


def es_combustible(it: dict) -> bool:
    return bool(_COMBUSTIBLE.search(it.get("descripcion_corta") or ""))


def departamento_de(ocds: dict) -> str:
    """Región de la entidad compradora según el OCDS (parties[role=buyer].address.region)."""
    for p in (ocds or {}).get("parties") or []:
        if isinstance(p, dict) and "buyer" in (p.get("roles") or []):
            return str(((p.get("address") or {}).get("region")) or "")
    return ""


def fecha_convocatoria(ocds: dict) -> str | None:
    """YYYY-MM-DD de la convocatoria: inicio del período de ofertas > fecha del registro. Los precios de referencia se
    toman de los días PREVIOS a esta fecha (al procesar procesos pasados, el precio de ese momento, no el de hoy)."""
    t = (ocds or {}).get("tender") or {}
    for v in ((t.get("tenderPeriod") or {}).get("startDate"), t.get("datePublished"), (ocds or {}).get("date")):
        if isinstance(v, str) and re.match(r"\d{4}-\d{2}-\d{2}", v):
            return v[:10]
    return None


def precios_combustible(items: list[dict], departamento: str, hasta: str | None = None) -> tuple[list[dict], dict]:
    """Para cada ítem de combustible, las declaraciones oficiales más recientes del departamento (o nacionales si hay
    pocas) como precios observados, con la fuente de Osinergmin. Sin Worker configurado, nada."""
    precios, info = [], {"items": 0, "precios": 0}
    for it in items:
        if not es_combustible(it):
            continue
        try:
            d = _worker("/combustible", {"producto": it.get("descripcion_corta") or "", "departamento": departamento, "dias": 120,
                                         **({"hasta": hasta} if hasta else {})})
        except Exception as e:  # noqa: BLE001
            info["error"] = str(e)[:160]
            continue
        if not d or not d.get("observaciones"):
            continue
        info["items"] += 1
        info.setdefault("estadisticas", {})[str(it.get("numero"))] = {**(d.get("estadistica") or {}), "ambito": d.get("ambito")}
        fuente = (d.get("fuente") or {}).get("url") or "https://www.osinergmin.gob.pe"
        est = d.get("estadistica") or {}
        # La distribución de TODAS las declaraciones del período (p25, mediana, p75), no las 10 más recientes: esas
        # suelen ser del mismo día y casi iguales, y sesgaban la mediana del mercado.
        for etiqueta, clave in (("percentil 25", "p25"), ("mediana", "mediana"), ("percentil 75", "p75")):
            if not est.get(clave):
                continue
            precios.append({
                "item_numero": str(it.get("numero")),
                "producto": (f"{it.get('descripcion_corta') or ''} · Osinergmin, {etiqueta} de {est.get('n')} declaraciones "
                             f"({est.get('desde')} a {est.get('hasta')}, {d.get('departamento') or 'nacional'}, ámbito {d.get('ambito')})")[:300],
                "precio": float(est[clave]), "moneda_origen": "PEN", "unidad": "galón",
                "proveedor": "Osinergmin", "origen": "osinergmin",
                "fuentes": [{"uri": fuente, "titulo": "Osinergmin · Registro de Precios de Distribuidores Minoristas",
                             "dominio": "osinergmin.gob.pe"}],
            })
            info["precios"] += 1
    return precios, info


# ─── alimentos frescos: Gran Mercado Mayorista de Lima (EMMSA, vía vigia-precios) ─
def _palabras(s: str) -> set[str]:
    return set(termino_busqueda(s, max_palabras=8).split())


def precios_mayorista(items: list[dict], dias: int = 30, hasta: str | None = None) -> tuple[list[dict], dict]:
    """Para cada ítem con precio en el Mercado Mayorista de Lima: p25, mediana y p75 del precio promedio diario por kg
    de la variedad que mejor coincide con la descripción (últimos `dias`). Oficial y mayorista: es la referencia justa
    para frescos (el supermercado es un tope minorista). Ítems sin variedad en EMMSA (frutas que se venden en el
    Mercado de Frutas, p. ej. papaya) no reciben nada y siguen a los demás niveles."""
    precios, info = [], {"items": 0, "precios": 0, "variedades": {}, "descartadas": 0}
    for it in items:
        desc = it.get("descripcion_corta") or ""
        # Sólo alimentos: con código del catálogo (CUBSO), su segmento tiene que ser el 50 (alimentos, bebidas y tabaco).
        # Sin este filtro se consultaba TODO ítem y una «bolsa de aspiración de secreciones» recibía el precio del «LIMON
        # CITRICO BOLSA» (dictamen 1256664, 2026-11): además quedaba fuera de la comparación con otras compras del Estado.
        cubso = re.sub(r"\D", "", str(it.get("cubso") or ""))
        if cubso and not cubso.startswith("50"):
            continue
        consulta = termino_busqueda(desc, max_palabras=2)
        if not consulta:
            continue
        try:
            d = _worker("/mayorista", {"q": consulta, "dias": dias, **({"hasta": hasta} if hasta else {})})
        except Exception as e:  # noqa: BLE001
            info["error"] = str(e)[:160]
            continue
        vars_ = [v for v in (d or {}).get("variedades") or [] if v.get("mediana")]
        if not vars_ and " " in consulta:          # "naranja valencia" no está → "naranja"
            try:
                d = _worker("/mayorista", {"q": consulta.split()[0], "dias": dias, **({"hasta": hasta} if hasta else {})})
                vars_ = [v for v in (d or {}).get("variedades") or [] if v.get("mediana")]
            except Exception:  # noqa: BLE001
                vars_ = []
        if not vars_:
            continue
        pal = _palabras(desc)
        # La variedad tiene que SER el bien: su nombre principal (la primera palabra: «limon», «naranja») debe estar en la
        # descripción del ítem. Coincidir en otra palabra («bolsa», «malla», «caja») no cuenta: es el envase.
        vars_ = [v for v in vars_ if (termino_busqueda(v.get("variedad") or "", max_palabras=1) or "?") in pal]
        if not vars_:
            info["descartadas"] += 1
            continue
        mejor = max(vars_, key=lambda v: (len(pal & _palabras(v.get("variedad") or "")), v.get("n_dias") or 0))
        info["items"] += 1
        info["variedades"][str(it.get("numero"))] = {k: mejor.get(k) for k in ("variedad", "n_dias", "p25", "mediana", "p75")}
        fuente = ((d or {}).get("fuente") or {}).get("url") or "https://www.emmsa.com.pe/index.php/precios-diarios/"
        for etiqueta, clave in (("percentil 25", "p25"), ("mediana", "mediana"), ("percentil 75", "p75")):
            if mejor.get(clave):
                precios.append({
                    "item_numero": str(it.get("numero")),
                    "producto": (f"{mejor.get('variedad')} · Mercado Mayorista de Lima, {etiqueta} de {mejor.get('n_dias')} días"
                                 f" hasta {(d or {}).get('hasta')}")[:300],
                    "precio": float(mejor[clave]), "moneda_origen": "PEN", "unidad": "kg",
                    "proveedor": "EMMSA", "origen": "emmsa",
                    "fuentes": [{"uri": fuente, "titulo": "EMMSA · Gran Mercado Mayorista de Lima, precios diarios", "dominio": "emmsa.com.pe"}],
                })
                info["precios"] += 1
    return precios, info
