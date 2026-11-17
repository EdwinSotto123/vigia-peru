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


_JUEZ = """Para cada ítem de una compra pública peruana tienes productos de catálogos de tiendas, compras de otras entidades
públicas ya adjudicadas ("compra de …": precio unitario pagado) y productos de los catálogos electrónicos de Perú Compras
("catálogo de Perú Compras: mediana de N órdenes…": lo que pagaron varias entidades por ese producto exacto) (id, producto, precio).
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


def _perucompras(items: list[dict], hasta: str | None) -> tuple[dict[str, list[dict]], str | None]:
    """Candidatos de los catálogos electrónicos de Perú Compras por ítem (tools/market/perucompras.py), en paralelo."""
    if os.getenv("PERUCOMPRAS_ACTIVO", "1") == "0" or not items:
        return {}, None
    from .perucompras import candidatos_perucompras
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futs = {str(it.get("numero")): ex.submit(candidatos_perucompras, it, hasta) for it in items}
    out, error = {}, None
    for num, f in futs.items():
        try:
            out[num] = f.result()
        except Exception as e:  # noqa: BLE001  (sin la tabla, el nivel queda fuera; lo demás sigue)
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
    de_pc, error_pc = _perucompras(elegibles, hasta)
    for num, extra in de_pc.items():
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
                             "dominio": c["url"].split("//")[-1].split("/")[0] if c.get("origen") in ("conosce", "perucompras") else c["tienda"]}],
                "origen": c.get("origen") or "catalogo_tienda", "precio_publicado": c["precio"], "unidades_por_producto": n,
                # Perú Compras: cuántas entidades sostienen la mediana y su cuartil 3 (por unidad del ítem).
                **({"respaldo": c["respaldo"], "tope_referencia": round(c["tope_referencia"] / n, 4)} if c.get("respaldo") else {}),
            })
    return precios, {"tiendas": list(TIENDAS), "items_consultados": len(elegibles), "candidatos": n_cands,
                     "candidatos_compras_estado": sum(len(v) for v in del_estado.values()),
                     "candidatos_perucompras": sum(len(v) for v in de_pc.values()),
                     **({"error_perucompras": error_pc} if error_pc else {}),
                     "precios_perucompras": sum(1 for p in precios if p["origen"] == "perucompras"),
                     **({"error_compras_estado": error_estado} if error_estado else {}),
                     "precios_elegidos": len(precios),
                     "precios_compras_estado": sum(1 for p in precios if p["origen"] == "conosce")}


# ─── combustibles: precios oficiales de Osinergmin (vía vigia-precios) ──────────
_COMBUSTIBLE = re.compile(r"\b(diesel|di[eé]sel|petr[oó]leo diesel|gasohol|gasolina|glp|gas licuado|petr[oó]leo industrial)\b", re.I)


# Bienes que NOMBRAN un combustible sin serlo («aceite para motor diesel», «filtro de petróleo», «cocina a GLP», «grupo
# electrógeno diesel»): recibían el precio del galón de Osinergmin y salían «muy elevado» (auditoría 2026-11-13).
_NO_ES_COMBUSTIBLE = re.compile(
    r"\b(aceites?|lubricantes?|grasas?|filtros?|bombas?|motobombas?|cocinas?|grupos?|electrogen\w*|generador\w*|mangueras?|motor\w*"
    r"|tanques?|valvulas?|aditivos?|surtidor\w*|cilindros?|balon\w*|regulador\w*|quemador\w*|calentador\w*|termas?|estufas?"
    r"|lamparas?|sopletes?|vehiculos?|camionetas?|camion\w*|tractor\w*|kits?|repuestos?|servicios?|mantenimiento|inyector\w*"
    r"|detector\w*|medidor\w*|equipos?|hornos?|calderas?|refrigerante|anticongelante|limpiador\w*|bidon\w*|envases?)\b")
_UNIDAD_COMBUSTIBLE = re.compile(r"^\s*(us\s*)?(gal|gln|gl\b|galon|lt\b|lts\b|l\b|litro)")


def _llano(s: str) -> str:
    t = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in t if not unicodedata.combining(c)).lower()


# Lo que dice PARA QUÉ se compra («… para los vehículos asignados a la sede», «(suministro para la flota)») no dice QUÉ
# es: el bien es lo de antes. Sin este corte, «Diesel B5 S-50 (suministro de combustible para los vehículos asignados a
# la Sede Central…)» caía en la lista de no-combustibles por «vehículos» y perdía el precio oficial de Osinergmin
# (golden 1225299, imagen 9d4943a9: sobreprecio de 36 % que pasó a «alineado»).
_PROPOSITO = re.compile(r"\s(para|destinad[oa]s?|con destino|a utilizar|a usarse|que se)\s.*$|\s*[\(\[].*$")


def _cabeza(desc: str) -> str:
    """«diesel b5 s-50 (suministro … para los vehiculos …)» → «diesel b5 s-50». Si al cortar no queda nada (empieza con
    paréntesis), la descripción entera."""
    corte = _PROPOSITO.sub("", desc).strip(" ,;:-")
    return corte or desc


def es_combustible(it: dict) -> bool:
    """El ítem ES un combustible líquido que se compra por galón o litro: lo nombra, no es otro bien que lo menciona, y
    su unidad (si la trae) es de volumen (el GLP por balón o por kilo no se compara con el precio por galón). Lo que
    descarta («aceite», «grupo electrógeno», «vehículos»…) se busca sólo en el bien, no en su destino."""
    desc = _llano(it.get("descripcion_corta") or "")
    if not _COMBUSTIBLE.search(desc) or _NO_ES_COMBUSTIBLE.search(_cabeza(desc)):
        return False
    unidad = _llano(str(it.get("unidad") or ""))
    return not unidad or bool(_UNIDAD_COMBUSTIBLE.match(unidad))


_DEPARTAMENTOS = {"01": "AMAZONAS", "02": "ANCASH", "03": "APURIMAC", "04": "AREQUIPA", "05": "AYACUCHO", "06": "CAJAMARCA",
                  "07": "CALLAO", "08": "CUSCO", "09": "HUANCAVELICA", "10": "HUANUCO", "11": "ICA", "12": "JUNIN",
                  "13": "LA LIBERTAD", "14": "LAMBAYEQUE", "15": "LIMA", "16": "LORETO", "17": "MADRE DE DIOS",
                  "18": "MOQUEGUA", "19": "PASCO", "20": "PIURA", "21": "PUNO", "22": "SAN MARTIN", "23": "TACNA",
                  "24": "TUMBES", "25": "UCAYALI"}


def departamento_de(ocds: dict) -> str:
    """Departamento de la entidad compradora: por el ubigeo de la convocatoria en la base y, si no, por el OCDS. El
    `address.region` del OCDS suele traer la PROVINCIA («Sullana», «Jorge Basadre»): con ella el servicio de precios no
    hallaba el departamento y comparaba contra el ámbito nacional (52 de 56 combustibles en PROD, 2026-11-14)."""
    ocid = str((ocds or {}).get("ocid") or "")
    if ocid:
        try:
            from tools._core import _pg, _short_ocid
            conn = _pg()
            try:
                cur = conn.cursor()
                cur.execute("SELECT left(ubigeo, 2) FROM convocatorias WHERE ocid = %s", (_short_ocid(ocid),))
                fila = cur.fetchone()
                if fila and _DEPARTAMENTOS.get(str(fila[0] or "")):
                    return _DEPARTAMENTOS[str(fila[0])]
            finally:
                conn.close()
        except Exception:  # noqa: BLE001 — sin base, lo que diga el OCDS
            pass
    for p in (ocds or {}).get("parties") or []:
        if isinstance(p, dict) and "buyer" in (p.get("roles") or []):
            d = p.get("address") or {}
            region = _llano(str(d.get("department") or d.get("region") or "")).upper()
            return region if region in _DEPARTAMENTOS.values() else ""
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


# Palabras que no dicen qué producto es (envase, unidad, trámite): no cuentan para decidir la variedad.
_NO_DISTINGUE = {"bolsa", "bolsas", "malla", "mallas", "caja", "cajas", "saco", "sacos", "jaba", "jabas", "kg", "kilo", "kilos",
                 "kilogramo", "kilogramos", "por", "de", "del", "en", "la", "el", "primera", "segunda", "calidad", "fresco", "fresca",
                 "frescos", "frescas", "nacional", "tipo", "unidad", "unidades", "granel", "adquisicion", "compra", "suministro",
                 "alimento", "alimentos", "para", "con", "extra", "categoria", "clase", "grado", "variedad", "tamano", "entero", "entera", "seleccionado", "seleccionada", "und"}
# Un producto elaborado no es el fresco del mercado mayorista: «papa seca», «ají panca molido», «pasta de tomate».
_ELABORADO = re.compile(
    r"\b(sec[oa]s?|molid[oa]s?|pasta|sachet|latas?|conservas?|harina|polvo|deshidratad\w*|congelad\w*|enlatad\w*|frascos?|salsa"
    r"|jugo|nectar|mermelada|aceite|chuno|tostad\w*|frit[oa]s?|hojuelas?|pure|envasad\w*|precocid\w*|extracto|esencia|pelad\w*"
    r"|picad\w*|encurtid\w*|almibar|crema|pulpa|concentrad\w*|instantane\w*|sopa|galletas?|fideos?|bebida|refresco)\b")
_UNIDAD_PESO = re.compile(r"kg|kilo|gramo|tonel|^\s*t\s*$")


def _propias(s: str) -> list[str]:
    return [w for w in termino_busqueda(s, max_palabras=8).split() if w not in _NO_DISTINGUE]


def _misma_palabra(a: str, b: str) -> bool:
    """Igual salvo el plural: «papas» = «papa», «limones» = «limon»."""
    return a == b or a + "s" == b or b + "s" == a or a + "es" == b or b + "es" == a


def _variedad_del_item(desc: str, variedades: list[dict]) -> tuple[dict | None, str]:
    """La variedad del mercado que ES el bien del ítem, o (None, por qué no). Calza cuando el producto de la variedad
    (su primera palabra) está en la descripción y TODA palabra propia de la descripción está en la variedad: «papa
    blanca» calza con «PAPA BLANCA» y no con «PAPA AMARILLA»; «zapallo loche» no calza con «ZAPALLO MACRE». Con sólo el
    producto («papa») y varias variedades de precios distintos no hay cómo saber cuál es: no se elige ninguna."""
    d = _propias(desc)
    if not d:
        return None, "sin_palabras"
    calzan = []
    for v in variedades:
        pv = _propias(v.get("variedad") or "")
        if pv and any(_misma_palabra(pv[0], x) for x in d) and all(any(_misma_palabra(x, y) for y in pv) for x in d):
            calzan.append(v)
    if not calzan:
        return None, "otra_variedad"
    if len(d) == 1 and len({(v.get("variedad") or "").upper() for v in calzan}) > 1:
        return None, "variedad_sin_precisar"
    return max(calzan, key=lambda v: v.get("n_dias") or 0), ""


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
        # Sólo frescos comprados por peso: un elaborado («papa seca», «pasta de tomate») o una compra por atado, caja o
        # unidad no se compara con el precio por kilo del mercado (auditoría 2026-11-13: «PAPA SECA» a S/ 12,50 salía
        # +942 % contra la «PAPA BLANCA» y, con precio «oficial», ya no se miraban las 12 compras de otras entidades).
        unidad = _llano(str(it.get("unidad") or ""))
        if _ELABORADO.search(_llano(desc)) or (unidad and not _UNIDAD_PESO.search(unidad)):
            info["descartadas"] += 1
            continue
        consulta = " ".join(_propias(desc)[:2])
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
        # La variedad tiene que SER el bien (ver `_variedad_del_item`): coincidir en el envase («bolsa») o sólo en el
        # producto con otra variedad («papa» seca contra papa blanca) no cuenta.
        mejor, por_que = _variedad_del_item(desc, vars_)
        if not mejor:
            info["descartadas"] += 1
            info.setdefault("motivos", {})[str(it.get("numero"))] = por_que
            continue
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
