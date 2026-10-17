"""Precios de catálogo de tiendas peruanas: el primer nivel (gratis) del mercado de bienes.

Las tiendas con plataforma VTEX publican su catálogo con precio vigente en una API pública
(`/api/catalog_system/pub/products/search?ft=<texto>`), sin clave ni costo. Para cada ítem:
  1. se buscan candidatos en todas las tiendas a la vez (≤ CATALOGO_POR_TIENDA por tienda);
  2. UNA llamada al modelo de juicio, para todos los ítems, elige qué candidatos son el MISMO bien en una
     presentación comparable (el texto de búsqueda trae ruido: "cemento" también devuelve fragua);
  3. los ítems con ≥ MARKET_MIN_PRECIOS precios elegidos ya no van a la búsqueda web pagada.
Medido 2026-10-17: Promart, Plaza Vea, Oechsle, Metro y Wong responden; Sodimac, Tottus y las farmacias no.
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


def candidatos(termino: str) -> list[dict]:
    if not termino:
        return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(TIENDAS) or 1) as ex:
        listas = list(ex.map(lambda b: _de_tienda(b, termino), TIENDAS))
    return [c for lista in listas for c in lista]


_JUEZ = """Para cada ítem de una compra pública peruana tienes productos de catálogos de tiendas (id, producto, precio).
Elige SOLO los que son el MISMO bien que el ítem (mismo tipo, misma especificación principal; la marca puede variar
salvo que el ítem exija una). Descarta accesorios, repuestos, otros productos y presentaciones no comparables.
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
