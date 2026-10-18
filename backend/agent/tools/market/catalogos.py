"""Precios de catálogo de tiendas peruanas: el primer nivel (gratis) del mercado de bienes.

Las tiendas con plataforma VTEX publican su catálogo con precio vigente en una API pública
(`/api/catalog_system/pub/products/search?ft=<texto>`), sin clave ni costo. Para cada ítem:
  1. se buscan candidatos en todas las tiendas a la vez (≤ CATALOGO_POR_TIENDA por tienda);
  2. UNA llamada al modelo de juicio, para todos los ítems, elige qué candidatos son el MISMO bien en una
     presentación comparable (el texto de búsqueda trae ruido: "cemento" también devuelve fragua);
  3. los ítems con ≥ MARKET_MIN_PRECIOS precios elegidos ya no van a la búsqueda web pagada.
Medido 2026-10-17: Promart, Plaza Vea, Oechsle, Metro y Wong responden; Sodimac, Tottus y las farmacias no.

Con PRECIOS_URL + PRECIOS_TOKEN las consultas van al Worker vigia-precios (backend/precios-worker): caché de 7 días,
pausa automática de la tienda que falla e historial propio. Sin ellas, directo a las tiendas.
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
    "https://www.promart.pe,https://www.plazavea.com.pe,https://www.oechsle.pe,https://www.metro.pe,https://www.wong.pe",
).split(",") if t.strip())
CATALOGO_POR_TIENDA = int(os.getenv("CATALOGO_POR_TIENDA", "4"))
CATALOGO_MAX_ITEMS = int(os.getenv("CATALOGO_MAX_ITEMS", "15"))
CATALOGO_TIMEOUT_S = float(os.getenv("CATALOGO_TIMEOUT_S", "12"))
_UA = {"User-Agent": "Mozilla/5.0 (compatible; VigiaPeru/1.0; +https://vigia-web.vigiaperu.workers.dev)"}

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


def _de_tienda(base: str, termino: str) -> list[dict]:
    import httpx
    url = f"{base}/api/catalog_system/pub/products/search?ft={quote(termino)}&_from=0&_to={CATALOGO_POR_TIENDA - 1}"
    try:
        r = httpx.get(url, headers=_UA, timeout=CATALOGO_TIMEOUT_S)
        if r.status_code >= 400:
            return []
        datos = r.json()
    except Exception:
        return []
    out = []
    for p in datos if isinstance(datos, list) else []:
        try:
            it = p["items"][0]
            oferta = it["sellers"][0]["commertialOffer"]
            precio = float(oferta.get("Price") or 0)
            if precio <= 0 or not oferta.get("AvailableQuantity", 1):
                continue
            out.append({
                "producto": str(p.get("productName") or "")[:200],
                "marca": p.get("brand"),
                "precio": precio,
                "unidad_medida": it.get("measurementUnit"),
                "multiplicador": it.get("unitMultiplier"),
                "tienda": base.split("//")[-1].removeprefix("www."),
                "url": p.get("link") or f"{base}/{p.get('linkText')}/p",
            })
        except (KeyError, IndexError, TypeError, ValueError):
            continue
    return out


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
                 "tienda": p["tienda"], "url": p["url"]} for p in d.get("productos") or [] if p.get("precio")]
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(TIENDAS) or 1) as ex:
        listas = list(ex.map(lambda b: _de_tienda(b, termino), TIENDAS))
    return [c for lista in listas for c in lista]


_JUEZ = """Para cada ítem de una compra pública peruana tienes productos de catálogos de tiendas (id, producto, precio).
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
    cfg = types.GenerateContentConfig(temperature=0, max_output_tokens=4000, response_mime_type="application/json",
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


def precios_de_catalogo(items: list[dict]) -> tuple[list[dict], dict]:
    """Precios en el formato de los workers de goods_retail (`precios[]`) + resumen para el informe."""
    elegibles = items[:CATALOGO_MAX_ITEMS]
    cands = {str(it.get("numero")): candidatos(termino_busqueda(it.get("descripcion_corta") or "")) for it in elegibles}
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
                "fuentes": [{"uri": c["url"], "titulo": c["producto"], "dominio": c["tienda"]}],
                "origen": "catalogo_tienda", "precio_publicado": c["precio"], "unidades_por_producto": n,
            })
    return precios, {"tiendas": list(TIENDAS), "items_consultados": len(elegibles), "candidatos": n_cands,
                     "precios_elegidos": len(precios)}


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


def precios_combustible(items: list[dict], departamento: str) -> tuple[list[dict], dict]:
    """Para cada ítem de combustible, las declaraciones oficiales más recientes del departamento (o nacionales si hay
    pocas) como precios observados, con la fuente de Osinergmin. Sin Worker configurado, nada."""
    precios, info = [], {"items": 0, "precios": 0}
    for it in items:
        if not es_combustible(it):
            continue
        try:
            d = _worker("/combustible", {"producto": it.get("descripcion_corta") or "", "departamento": departamento, "dias": 120})
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


def precios_mayorista(items: list[dict], dias: int = 30) -> tuple[list[dict], dict]:
    """Para cada ítem con precio en el Mercado Mayorista de Lima: p25, mediana y p75 del precio promedio diario por kg
    de la variedad que mejor coincide con la descripción (últimos `dias`). Oficial y mayorista: es la referencia justa
    para frescos (el supermercado es un tope minorista). Ítems sin variedad en EMMSA (frutas que se venden en el
    Mercado de Frutas, p. ej. papaya) no reciben nada y siguen a los demás niveles."""
    precios, info = [], {"items": 0, "precios": 0, "variedades": {}}
    for it in items:
        desc = it.get("descripcion_corta") or ""
        consulta = termino_busqueda(desc, max_palabras=2)
        if not consulta:
            continue
        try:
            d = _worker("/mayorista", {"q": consulta, "dias": dias})
        except Exception as e:  # noqa: BLE001
            info["error"] = str(e)[:160]
            continue
        vars_ = [v for v in (d or {}).get("variedades") or [] if v.get("mediana")]
        if not vars_ and " " in consulta:          # "naranja valencia" no está → "naranja"
            try:
                d = _worker("/mayorista", {"q": consulta.split()[0], "dias": dias})
                vars_ = [v for v in (d or {}).get("variedades") or [] if v.get("mediana")]
            except Exception:  # noqa: BLE001
                vars_ = []
        if not vars_:
            continue
        pal = _palabras(desc)
        mejor = max(vars_, key=lambda v: (len(pal & _palabras(v.get("variedad") or "")), v.get("n_dias") or 0))
        info["items"] += 1
        info["variedades"][str(it.get("numero"))] = {k: mejor.get(k) for k in ("variedad", "n_dias", "p25", "mediana", "p75")}
        fuente = ((d or {}).get("fuente") or {}).get("url") or "https://www.emmsa.com.pe/index.php/precios-diarios/"
        for etiqueta, clave in (("percentil 25", "p25"), ("mediana", "mediana"), ("percentil 75", "p75")):
            if mejor.get(clave):
                precios.append({
                    "item_numero": str(it.get("numero")),
                    "producto": f"{mejor.get('variedad')} · Mercado Mayorista de Lima, {etiqueta} de {mejor.get('n_dias')} días"[:300],
                    "precio": float(mejor[clave]), "moneda_origen": "PEN", "unidad": "kg",
                    "proveedor": "EMMSA", "origen": "emmsa",
                    "fuentes": [{"uri": fuente, "titulo": "EMMSA · Gran Mercado Mayorista de Lima, precios diarios", "dominio": "emmsa.com.pe"}],
                })
                info["precios"] += 1
    return precios, info
