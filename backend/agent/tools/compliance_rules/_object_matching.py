"""compliance_rules._object_matching — coincide_objeto: rubro del objeto del contrato vs ítems."""

from tools._core import *  # noqa: F401,F403
from tools.compliance_rules._base import _sin_tildes  # noqa: F401


# ─── coincide_objeto: rubro del objeto vs ítems (lote 1 · T3/T14) ──────────────
#
# Compara por RAÍZ de palabra (no por token crudo) y con una tabla mínima de
# hiperónimos/sinónimos frecuentes en compras públicas. Casos reales que disparaban
# falso positivo: "geosintéticos" vs geomalla/geotextil (1225062), "perfilería" vs
# parante/riel (1225266), "reactivos de inmunohematología" vs kit (1225090), "equipos
# topográficos" vs estación total (1225392), "combustible" vs diésel/gasohol. Los
# términos comodín (bienes, materiales, insumos, …) no permiten afirmar incongruencia.
_STOP_OBJETO = {
    "adquisicion", "servicio", "servicios", "contratacion", "para", "por", "con", "del", "las",
    "los", "meta", "proyecto", "mejoramiento", "mantenimiento", "obra", "obras", "general",
    "generales", "sede", "central", "unidad", "mediante", "modalidad", "proceso", "seleccion",
    "compra", "suministro", "item", "items", "municipalidad", "distrital", "provincial",
    "gobierno", "regional", "entidad", "ejecucion", "creacion", "construccion", "instalacion",
    "ampliacion", "sistema", "segun", "tipo", "cada", "sus", "una", "uno", "unas", "unos", "que",
    "como", "sobre", "entre", "hacia", "desde", "hasta", "este", "esta", "estos", "estas",
    "anexo", "cui", "codigo", "numero", "lote", "paquete", "region", "provincia", "distrito",
    "localidad", "centro", "poblado", "comunidad", "sector", "zona", "plan", "programa",
    "actividad", "componente", "etapa", "fase", "primera", "segunda", "tercera", "convocatoria",
    "gerencia", "subgerencia", "oficina", "direccion", "area", "usuaria", "servicio",
}
_COMODIN_OBJETO = {"bien", "material", "insumo", "suministro", "producto", "articulo", "diverso",
                   "vario", "equipamiento", "implemento", "accesorio", "util", "utiles", "otros"}
_SUFIJOS = ("erias", "eria", "icas", "icos", "ica", "ico", "ales", "ados", "adas", "ado", "ada",
            "es", "s")

_HIPERONIMOS: dict[str, set[str]] = {
    "geosintet": {"geomalla", "geotextil", "geomembrana", "geored", "geocelda", "geodren", "geocompuest"},
    "perfil": {"parante", "riel", "perfil", "canal", "omega", "esquiner", "angulo"},
    "drywall": {"parante", "riel", "placa", "plancha", "perfil"},
    "combustibl": {"diesel", "gasohol", "gasolina", "petroleo", "biodiesel", "glp", "gnv", "kerosene"},
    "hidrocarbur": {"diesel", "gasohol", "gasolina", "petroleo", "biodiesel", "glp", "gnv"},
    "reactiv": {"kit", "tarjeta", "antiglobulina", "suero", "reactiv", "solucion", "inmunohematolog",
                "prueba", "test", "cassette", "tira"},
    "inmunohematolog": {"kit", "tarjeta", "antiglobulina", "reactiv", "gel", "columna"},
    "laboratori": {"reactiv", "kit", "pipeta", "tubo", "microscopi", "centrifug", "analizador"},
    "topograf": {"estacion", "prisma", "tripode", "nivel", "teodolito", "gps", "gnss", "receptor",
                 "distanciometr", "jalon", "mira", "wincha"},
    "ferreter": {"clavo", "alambre", "tornillo", "perno", "cemento", "pintura", "tuberia", "fierro",
                 "calamina", "plancha", "madera", "triplay", "candado", "bisagra"},
    "agregad": {"piedra", "arena", "hormigon", "grava", "afirmado", "confitillo", "ripio"},
    "aliment": {"arroz", "azucar", "aceite", "leche", "conserva", "menestra", "fideo", "harina",
                "avena", "quinua", "carne", "pollo", "huevo", "atun", "pescado", "fruta", "verdura",
                "galleta", "pan", "sal", "lenteja", "frijol", "papa"},
    "vivere": {"arroz", "azucar", "aceite", "leche", "conserva", "menestra", "fideo", "harina",
               "avena", "quinua", "carne", "pollo", "huevo", "atun", "galleta", "sal"},
    "medicament": {"tableta", "ampolla", "jarabe", "capsula", "inyectable", "comprimido", "vacuna"},
    "farmac": {"tableta", "ampolla", "jarabe", "capsula", "inyectable", "medicament"},
    "mobiliari": {"silla", "mesa", "escritori", "estante", "armari", "carpeta", "pupitre", "sillon",
                  "modulo", "anaquel", "archivador"},
    "informat": {"laptop", "computador", "impresor", "servidor", "monitor", "switch", "router",
                 "software", "licencia", "proyector", "scanner", "escaner", "tablet", "disco", "ups"},
    "comput": {"laptop", "computador", "impresor", "servidor", "monitor", "software", "licencia", "cpu"},
    "vehicul": {"camioneta", "camion", "volquete", "motocicleta", "moto", "automovil", "bus",
                "minibus", "ambulancia", "cisterna", "trimoto"},
    "maquinari": {"excavador", "cargador", "retroexcavador", "motonivelador", "rodillo", "tractor",
                  "compactador", "minicargador", "mezclador", "vibrador"},
    "epp": {"casco", "guante", "bota", "chaleco", "lente", "respirador", "mascarilla", "arnes"},
    "seguridad": {"casco", "guante", "bota", "chaleco", "lente", "respirador", "mascarilla", "arnes",
                  "extintor", "camara", "alarma"},
    "textil": {"uniforme", "polo", "pantalon", "camisa", "chompa", "casaca", "buzo", "frazada",
               "colcha", "sabana", "tela", "gorro", "zapato", "zapatilla"},
    "vestuari": {"uniforme", "polo", "pantalon", "camisa", "chompa", "casaca", "buzo", "gorro", "calzado"},
    "electric": {"cable", "luminaria", "lampara", "poste", "transformador", "tablero", "interruptor",
                 "tomacorriente", "conductor", "medidor", "panel", "fotovoltaic"},
    "construccion": {"parante", "riel", "cemento", "ladrillo", "fierro", "agregad", "piedra", "arena",
                     "tuberia", "madera", "calamina", "plancha", "perfil", "drywall", "clavo",
                     "alambre", "hormigon", "acero", "gavion", "geomalla", "geotextil"},
    "gavion": {"piedra", "malla", "alambre", "canasta"},
    "medic": {"reactiv", "kit", "insumo", "jeringa", "guante", "mascarilla", "equipo", "monitor",
              "camilla", "ecograf", "oximetr"},
    "hospitalari": {"reactiv", "kit", "jeringa", "guante", "mascarilla", "camilla", "cama", "monitor"},
    "limpieza": {"detergente", "lejia", "escoba", "trapeador", "jabon", "papel", "desinfectante", "bolsa"},
    "escritori": {"papel", "lapicero", "folder", "archivador", "cuaderno", "toner", "tinta", "engrapador"},
    "oficina": {"papel", "lapicero", "folder", "archivador", "toner", "tinta", "silla", "escritori"},
    "riego": {"tuberia", "aspersor", "goteo", "manguera", "valvula", "bomba", "motobomba"},
    "agua": {"tuberia", "valvula", "bomba", "tanque", "cloro", "hipoclorito", "medidor"},
    "saneamiento": {"tuberia", "valvula", "bomba", "tanque", "cloro", "hipoclorito", "buzon"},
    "agropecuari": {"semilla", "fertilizante", "abono", "alevino", "cuy", "vacuno", "ovino", "alpaca",
                    "pollo", "pasto", "plantones", "planton", "insecticida", "fungicida"},
    "semilla": {"semilla", "planton"},
    "deportiv": {"balon", "pelota", "net", "arco", "tablero", "colchoneta", "uniforme"},
    "musical": {"guitarra", "trompeta", "tambor", "bombo", "organo", "teclado", "parlante"},
    "sonido": {"parlante", "amplificador", "microfono", "consola", "mezclador"},
    "audiovisual": {"proyector", "pantalla", "parlante", "camara", "televisor", "ecran"},
    "impresion": {"toner", "tinta", "papel", "impresor", "banner", "gigantograf"},
    "cocina": {"olla", "cocina", "balon", "plato", "vaso", "cubierto", "refrigerador", "congelador"},
    "juguete": {"juguete", "muneca", "pelota", "rompecabeza"},
    "poste": {"poste"},
    "concret": {"poste", "tubo", "buzon", "bloque", "adoquin", "cemento"},
    "acero": {"fierro", "varilla", "perfil", "parante", "riel", "plancha", "tubo", "alambre"},
    "metal": {"fierro", "varilla", "perfil", "parante", "riel", "plancha", "tubo", "alambre", "acero"},
    "pintura": {"pintura", "esmalte", "latex", "barniz", "thinner", "brocha", "rodillo"},
    "neumatic": {"llanta", "neumatic", "camara"},
    "llanta": {"llanta", "neumatic"},
    "repuesto": {"filtro", "bateria", "llanta", "aceite", "bujia", "faja", "pastilla"},
    "lubricant": {"aceite", "grasa", "refrigerante", "hidrolina"},
}


def _raiz(w: str) -> str:
    """Raíz simple en español: minúsculas, sin tildes, sin sufijos frecuentes."""
    w = _sin_tildes(w).lower().strip()
    for suf in _SUFIJOS:
        if w.endswith(suf) and len(w) - len(suf) >= 4:
            w = w[: -len(suf)]
            break
    return w


def _tokens_raiz(txt: str) -> set[str]:
    txt = _sin_tildes(txt or "").lower()
    txt = re.sub(r"[^a-z0-9 ]", " ", txt)
    out = set()
    for w in txt.split():
        if len(w) <= 3 or w in _STOP_OBJETO or w.isdigit():
            continue
        out.add(_raiz(w))
    return out


def _misma_raiz(a: str, b: str) -> bool:
    if a == b:
        return True
    if len(a) >= 5 and len(b) >= 5 and (a.startswith(b) or b.startswith(a)):
        return True
    return False


def _rubro_compatible(a: str, b: str) -> bool:
    """a y b son raíces. True si coinciden por raíz o si una es hiperónimo de la otra."""
    if _misma_raiz(a, b):
        return True
    for hiper, hijos in _HIPERONIMOS.items():
        if _misma_raiz(a, hiper) and any(_misma_raiz(b, h) for h in hijos):
            return True
        if _misma_raiz(b, hiper) and any(_misma_raiz(a, h) for h in hijos):
            return True
    return False


def _es_comodin(raiz: str) -> bool:
    return any(_misma_raiz(raiz, c) for c in _COMODIN_OBJETO)


def _textos_items(items) -> list[str]:
    if isinstance(items, str):
        return [items]
    out = []
    for it in (items or []):
        if isinstance(it, dict):
            t = " ".join(str(it.get(k) or "") for k in ("descripcion_corta", "descripcion", "item_descripcion",
                                                        "description", "nombre", "texto_literal"))
            out.append(t[:600])
        elif it:
            out.append(str(it))
    return out


def coincide_objeto_detalle(objeto: str, items, resumen: str | None = None) -> dict:
    """Detalle de la comparación objeto ↔ ítems (ver `coincide_objeto`)."""
    # Parte "producto" del objeto: lo que va antes de PARA / META / PROYECTO / CUI / DESTINADO
    # ("ADQUISICIÓN DE BIENES PARA EL MEJORAMIENTO DE LA CARRETERA…" → "bienes" = comodín →
    # genérico). Para la comparación se usa el objeto completo (más tolerante).
    _prod_part = re.split(r"\b(para|meta|proyecto|cui|destinad\w*|con destino|en el marco|del proyecto|de la obra)\b",
                          _sin_tildes(objeto or "").lower(), maxsplit=1)[0]
    prod_tokens = {t for t in _tokens_raiz(_prod_part) if not _es_comodin(t)}
    obj_tokens = _tokens_raiz(objeto)
    obj_prod = {t for t in obj_tokens if not _es_comodin(t)} if prod_tokens else set()
    item_tokens: set[str] = set()
    for t in _textos_items(items):
        item_tokens |= _tokens_raiz(t)
    res = {"coincide": True, "motivo": "", "tokens_objeto": sorted(obj_prod)[:12],
           "tokens_items": sorted(item_tokens)[:20], "comunes": []}
    if not obj_prod:
        res["motivo"] = "objeto genérico (solo términos comodín): no se puede afirmar incongruencia"
        return res
    if not item_tokens:
        res["motivo"] = "sin descripciones de ítems para comparar"
        return res
    comunes = sorted({a for a in obj_prod for b in item_tokens if _rubro_compatible(a, b)})
    if comunes:
        res["comunes"] = comunes
        res["motivo"] = "coincidencia por raíz/hiperónimo"
        return res
    # Respaldo: resumen ejecutivo del parser (≥ 2 raíces de producto en común).
    if resumen:
        res_tokens = _tokens_raiz(resumen)
        comunes_res = sorted({a for a in obj_prod for b in res_tokens if _rubro_compatible(a, b)})
        if len(comunes_res) >= 2 or (len(obj_prod) == 1 and comunes_res):
            res["comunes"] = comunes_res
            res["motivo"] = "coincidencia con el resumen ejecutivo del expediente"
            return res
    res["coincide"] = False
    res["motivo"] = "ninguna raíz de producto del objeto aparece en los ítems"
    return res


def coincide_objeto(objeto: str, items, resumen: str | None = None) -> bool:
    """¿El objeto convocado corresponde al rubro de los ítems extraídos? Comparación por
    raíces + hiperónimos; los objetos genéricos ("adquisición de bienes…") siempre
    coinciden (no hay base para afirmar lo contrario). `items` puede ser una lista de
    strings, de dicts (descripcion_corta/descripcion/item_descripcion) o un string."""
    return bool(coincide_objeto_detalle(objeto, items, resumen).get("coincide"))
