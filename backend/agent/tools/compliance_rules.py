"""Tools del dominio: compliance_rules.

Reglas deterministas de cumplimiento. Desde el WS V (plan 2026-09-15) TODAS las
reglas `check_*_rule` aceptan dos kwargs opcionales que el driver pasa desde el
perfil (`agents/_shared/profiles.py`):

    reglas_activas: frozenset[str] | None   # nombres de reglas habilitadas; None = todas
    topes_uit:      dict | None             # topes por tipo de proceso; None = defaults

Como los FunctionTool de ADK no pueden declarar `frozenset`, los wrappers `*_tool`
exponen solo `(ocid, tool_context)` y leen el perfil de `state['reglas_activas']` /
`state['topes_uit']` si el driver los dejó ahí (ver `_as_tool`).
"""

from tools._core import *  # noqa: F401,F403
from tools.legal import query_legal_rag
from tools import verify as _verify

# Claves aceptadas en `topes_uit` (todas opcionales; default = comportamiento anterior):
#   uit / uit_soles                          → valor de la UIT en soles (5350)
#   comparacion_precios / comparacion_precios_max → tope superior de CP (15 UIT)
#   adjudicacion_simplificada / adjudicacion_simplificada_max / licitacion_publica
#                                            → tope superior de AS = mínimo de LP (400 UIT;
#                                              obras: 1800)
_TOPES_DEFAULT = {"uit_soles": 5350.0, "comparacion_precios_max": 15.0,
                  "adjudicacion_simplificada_max": 400.0}

# Ley 32069 (procesos desde 22-abr-2025) — topes en SOLES, no en UIT (lote 1 · T11):
#   · art. 14 Ley 32513 (Presupuesto 2026): LP/CP bienes-servicios ≥ S/ 485 000; por debajo,
#     Licitación/Concurso Público ABREVIADO. Obras: LP ≥ S/ 5 000 000.
#   · Reglamento D.S. 009-2025-EF: Comparación de Precios hasta S/ 100 000 (bienes/servicios
#     de disponibilidad inmediata; las bases estándar 2026 lo repiten: "cuantía hasta S/ 100 000").
#   · UIT 2026 = S/ 5 500 (contrataciones menores ≤ 8 UIT = S/ 44 000, fuera de la ley).
# Sobrescribibles desde `topes_uit` del perfil con las mismas claves.
_TOPES_LEY_32069 = {"uit_soles": 5500.0, "comparacion_precios_max_soles": 100000.0,
                    "licitacion_publica_min_soles": 485000.0, "obras_licitacion_min_soles": 5000000.0}


def _tope(topes: dict | None, default: float, *claves: str) -> float:
    for k in claves:
        if isinstance(topes, dict) and topes.get(k) is not None:
            try:
                return float(topes[k])
            except (TypeError, ValueError):
                continue
    return default


def _perfil_reglas(tool_context, reglas_activas):
    """reglas_activas explícito > state['reglas_activas'] > None (todas)."""
    if reglas_activas is not None:
        return frozenset(reglas_activas)
    try:
        v = tool_context.state.get("reglas_activas")
    except Exception:
        v = None
    if isinstance(v, (list, tuple, set, frozenset)):
        return frozenset(str(x) for x in v)
    return None


def _perfil_topes(tool_context, topes_uit):
    if topes_uit is not None:
        return topes_uit
    try:
        v = tool_context.state.get("topes_uit")
    except Exception:
        v = None
    return v if isinstance(v, dict) else None


def _regla_omitida(nombre: str, reglas: frozenset | None, activa_por_defecto: bool = False) -> dict | None:
    """Si el perfil no activa `nombre`, devuelve el resultado neutro (sin bandera).

    `activa_por_defecto=True` (reglas del lote 1, 2026-09-15): la regla corre aunque el
    perfil no la liste — solo se omite si el perfil la desactiva explícitamente con el
    prefijo `-` (p. ej. `-ofertas_agrupadas`) en `reglas_activas`."""
    if reglas is None:
        return None
    if activa_por_defecto:
        if f"-{nombre}" in reglas:
            return {"regla": nombre, "triggered": False, "omitida": True,
                    "estado": "sin_dato", "motivo": "regla desactivada explícitamente en el perfil"}
        return None
    if nombre not in reglas:
        return {"regla": nombre, "triggered": False, "omitida": True,
                "estado": "sin_dato", "motivo": "regla no activa en el perfil"}
    return None


# ─── Régimen normativo aplicable (lote 1 · T3) ──────────────────────────────
#
# Procesos convocados desde el 22-abr-2025 se rigen por la Ley 32069 y su Reglamento
# (D.S. 009-2025-EF); antes, por el TUO de la Ley 30225 (D.S. 082-2019-EF). Citar el TUO
# derogado en un expediente 2026 resta credibilidad ante un fiscal (informes 1225062,
# 1225256, 1225266, 1225416, 1225450).
_INICIO_LEY_32069 = _dt.date(2025, 4, 22)

_NORMAS = {
    "ley_32069": {
        "regimen": "ley_32069",
        "ley": "Ley N° 32069",
        "reglamento": "D.S. N° 009-2025-EF",
        "principios": "Art. 5 Ley 32069 — principios de competencia, transparencia e integridad",
        "transparencia": "Art. 5 Ley 32069 — principio de transparencia y publicidad",
        "competencia": "Art. 5 Ley 32069 — principio de competencia",
        "integridad": "Art. 5 Ley 32069 — principio de integridad",
        "impedimentos": "Art. 30 Ley 32069 — impedimentos para contratar",
        "sanciones": "Art. 30 lit. Ley 32069 — impedimentos derivados de sanciones / Reglamento D.S. 009-2025-EF",
        "procedimientos": "Art. 54 Ley 32069 y art. 14 Ley 32513 (Presupuesto 2026) — procedimientos según cuantía",
        "comparacion_precios": "Reglamento D.S. 009-2025-EF — comparación de precios (lista de invitados, oferta ≤ cuantía)",
        "penalidades": "Reglamento D.S. 009-2025-EF — penalidad por mora y ampliación de plazo",
    },
    "tuo_30225": {
        "regimen": "tuo_30225",
        "ley": "TUO Ley N° 30225",
        "reglamento": "D.S. N° 344-2018-EF",
        "principios": "Art. 2 TUO Ley 30225 — principios de libertad de concurrencia y transparencia",
        "transparencia": "Art. 2 TUO Ley 30225 — principio de transparencia",
        "competencia": "Art. 2 TUO Ley 30225 — principio de competencia",
        "integridad": "Art. 2 TUO Ley 30225 — principio de integridad",
        "impedimentos": "Art. 11 TUO Ley 30225 — impedimentos para contratar",
        "sanciones": "Art. 50 TUO Ley 30225 — infracciones y sanciones",
        "procedimientos": "Anexo IV TUO Ley 30225 — procedimientos según monto",
        "comparacion_precios": "Art. 22 TUO Ley 30225 — comparación de precios",
        "penalidades": "Arts. 158-162 Reglamento TUO Ley 30225 — penalidades y ampliación de plazo",
    },
}


def _to_date(v) -> "_dt.date | None":
    if v is None:
        return None
    if isinstance(v, _dt.datetime):
        return v.date()
    if isinstance(v, _dt.date):
        return v
    s = str(v).strip()
    try:
        return _dt.date.fromisoformat(s[:10])
    except ValueError:
        pass
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        try:
            return _dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None


def norma_aplicable(fecha_convocatoria=None) -> dict:
    """Régimen normativo por fecha de convocatoria (helper único del plan 2026-09-15).
    Sin fecha → se asume el régimen vigente (Ley 32069)."""
    f = _to_date(fecha_convocatoria)
    if f is not None and f < _INICIO_LEY_32069:
        return dict(_NORMAS["tuo_30225"])
    return dict(_NORMAS["ley_32069"])


def _fecha_convocatoria_state(state: dict):
    """Fecha de convocatoria desde el OCDS del state (tenderPeriod.startDate > datePublished > date)."""
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    tender = ocds.get("tender") or {}
    for v in ((tender.get("tenderPeriod") or {}).get("startDate"), tender.get("datePublished"),
              ocds.get("date")):
        d = _to_date(v)
        if d:
            return d
    return None


def _norma_state(state: dict) -> dict:
    return norma_aplicable(_fecha_convocatoria_state(state))


def _procurement_method(state: dict, tipo_bd: str | None = None) -> str:
    """Nombre del procedimiento: OCDS `tender.procurementMethodDetails` > valor de BD
    (COALESCE(tipo_proceso, modalidad)) > ''."""
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    tender = ocds.get("tender") or {}
    pmd = tender.get("procurementMethodDetails") or tender.get("procurementMethod")
    return str(pmd or tipo_bd or "").strip()


def _es_subasta(tipo: str) -> bool:
    u = _sin_tildes(tipo or "").upper()
    return "SUBASTA" in u or "SIE" == u.strip() or u.startswith("SIE-")


def _es_comparacion_precios(tipo: str) -> bool:
    u = _sin_tildes(tipo or "").upper()
    return "COMPARACION" in u or u.startswith("CP-") or u.startswith("COMPRE")


def _montos_ocds(ocds: dict) -> dict:
    """Montos publicados en el OCDS: referencial (tender.value), adjudicados (awards[].value)
    y contratados (contracts[].value)."""
    ocds = ocds or {}
    tender = ocds.get("tender") or {}

    def _amt(node):
        try:
            v = float(((node or {}).get("value") or {}).get("amount") or 0)
        except (TypeError, ValueError):
            v = 0.0
        return v if v > 0 else None

    referencial = _amt(tender)
    awards = [a for a in (_amt(a) for a in (ocds.get("awards") or []) if isinstance(a, dict)) if a]
    contracts = [c for c in (_amt(c) for c in (ocds.get("contracts") or []) if isinstance(c, dict)) if c]
    return {"referencial": referencial, "awards": awards, "contracts": contracts,
            "suma_awards": sum(awards) if awards else None,
            "suma_contracts": sum(contracts) if contracts else None}


def _monto_adjudicado_ocds(ocds: dict):
    """Monto adjudicado/contratado: contracts > awards > None (T8)."""
    m = _montos_ocds(ocds)
    if m["suma_contracts"]:
        return m["suma_contracts"], "contracts"
    if m["suma_awards"]:
        return m["suma_awards"], "awards"
    return None, None


def _ganador_ocds(ocds: dict) -> tuple[str | None, str | None]:
    for a in ((ocds or {}).get("awards") or []):
        for sup in (a.get("suppliers") or []):
            pid = str(sup.get("id") or "")
            digits = "".join(ch for ch in pid if ch.isdigit())
            if len(digits) == 11:
                return digits, sup.get("name")
    return None, None


def _f(v):
    try:
        x = float(v)
        return x if x > 0 else None
    except (TypeError, ValueError):
        return None


def _norm_razon_cr(s: str) -> str:
    s = _sin_tildes(str(s or "")).upper()
    s = re.sub(r"\b(S\.?A\.?C\.?|S\.?R\.?L\.?(TDA)?|E\.?I\.?R\.?L\.?|S\.?A\.?A?\.?|S\.?C\.?R\.?L\.?)\b", " ", s)
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", s).split())


def _postores_parser(state: dict) -> list[dict]:
    """Postores con montos desde el parser (tolerante a las claves nuevas de R4):
    `parser_raw_consolidated.postores[]` > `postores_consolidados[]` > `document_analysis.
    postores_extraidos[]`, completados con `ofertas[]` (postor, monto, orden) si existen.
    Cada entrada: {ruc, razon_social, monto, es_ganador, puntaje, estado, orden}."""
    raw = (state or {}).get("parser_raw_consolidated") or {}
    da = _safe_parse_json((state or {}).get("document_analysis")) or {}
    fuentes = [raw.get("postores"), raw.get("postores_consolidados"), da.get("postores_extraidos")]
    base = next((f for f in fuentes if isinstance(f, list) and f), [])
    out: list[dict] = []
    for p in base:
        if not isinstance(p, dict):
            continue
        ruc = "".join(ch for ch in str(p.get("ruc") or "") if ch.isdigit())
        out.append({
            "ruc": ruc if len(ruc) == 11 else None,
            "razon_social": (p.get("razon_social") or p.get("nombre") or "").strip(),
            "monto": _f(p.get("monto_oferta") if p.get("monto_oferta") is not None else p.get("monto")),
            "es_ganador": p.get("es_ganador"),
            "puntaje": p.get("puntaje"),
            "estado": str(p.get("estado") or p.get("estado_oferta") or "").strip().lower() or None,
            "orden": p.get("orden") or p.get("orden_prelacion"),
        })
    # `ofertas[]` (R4): {postor|razon_social, ruc, monto, orden, estado} — completa montos.
    for o in (raw.get("ofertas") or []):
        if not isinstance(o, dict):
            continue
        monto = _f(o.get("monto") or o.get("monto_oferta"))
        if monto is None:
            continue
        ruc = "".join(ch for ch in str(o.get("ruc") or "") if ch.isdigit())
        nom = _norm_razon_cr(o.get("postor") or o.get("razon_social") or "")
        dest = None
        for p in out:
            if (ruc and p["ruc"] == ruc) or (nom and _norm_razon_cr(p["razon_social"]) == nom):
                dest = p
                break
        if dest is None:
            dest = {"ruc": ruc if len(ruc) == 11 else None, "razon_social": o.get("postor") or o.get("razon_social") or "",
                    "monto": None, "es_ganador": o.get("es_ganador"), "puntaje": o.get("puntaje"),
                    "estado": None, "orden": o.get("orden")}
            out.append(dest)
        if dest["monto"] is None:
            dest["monto"] = monto
        if dest["orden"] is None and o.get("orden") is not None:
            dest["orden"] = o.get("orden")
        if dest["estado"] is None and o.get("estado"):
            dest["estado"] = str(o.get("estado")).strip().lower()
    # Ganador: si el parser no lo marcó, cruzar con awards del OCDS.
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    g_ruc, g_nom = _ganador_ocds(ocds)
    if g_ruc and not any(p.get("es_ganador") for p in out):
        for p in out:
            if p["ruc"] == g_ruc or (g_nom and _norm_razon_cr(p["razon_social"]) == _norm_razon_cr(g_nom)):
                p["es_ganador"] = True
    return out


_ESTADOS_INVALIDOS = ("descalific", "no admit", "inadmit", "no valid", "invalid", "no invit",
                      "rechaz", "excluid", "no califica", "desestim")


def _oferta_invalida(p: dict) -> bool:
    e = _sin_tildes(str(p.get("estado") or "")).lower()
    return any(k in e for k in _ESTADOS_INVALIDOS)


_RE_CUANTIA_RESERVADA = re.compile(
    r"(no\s+(se\s+)?(dar|dara|dará|da)\s+a\s+conocer|sin\s+dar\s+a\s+conocer|cuant[ií]a\s+(reservada|no\s+publicada)|"
    r"no\s+se\s+(revela|publica|difunde)\s+(el\s+)?(valor|la\s+cuant))", re.I)


def _cuantia_reservada(state: dict) -> bool:
    """True si las bases declaran que la cuantía/valor referencial no se dio a conocer.
    Fuentes: flag del parser (`cuantia_reservada`, R4) > resúmenes/texto en state."""
    raw = (state or {}).get("parser_raw_consolidated") or {}
    da = _safe_parse_json((state or {}).get("document_analysis")) or {}
    for src in (raw, da):
        v = src.get("cuantia_reservada")
        if isinstance(v, bool):
            return v
    textos = []
    for r in (raw.get("resumenes") or []):
        if isinstance(r, dict):
            textos.append(str(r.get("resumen") or ""))
    textos.append(str(raw.get("resumen_ejecutivo") or da.get("resumen_ejecutivo") or ""))
    for it in (raw.get("items_consolidados") or []):
        if isinstance(it, dict):
            textos.append(str(it.get("texto_literal") or "")[:3000])
    dt = (state or {}).get("documentos_texto") or {}
    if isinstance(dt, dict):
        for v in dt.values():
            if isinstance(v, dict) and isinstance(v.get("texto"), str):
                textos.append(v["texto"][:20000])
    return any(_RE_CUANTIA_RESERVADA.search(t) for t in textos if t)


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


def _sin_tildes(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn")


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


def _as_tool(fn):
    """FunctionTool con firma simple `(ocid, tool_context)`: ADK no sabe declarar
    `frozenset[str] | None`, y los sub-agentes LLM no deben elegir el perfil."""
    def _w(ocid: str, tool_context: ToolContext) -> dict:
        return fn(ocid, tool_context)
    _w.__name__ = fn.__name__
    _w.__qualname__ = fn.__qualname__
    _w.__doc__ = fn.__doc__
    return FunctionTool(func=_w)


def _n_postores_ocds(ocds: dict) -> int | None:
    """Número de postores según el OCDS: numberOfTenderers > tender.tenderers >
    parties[role=tenderer]. None si el registro no lo informa."""
    if not isinstance(ocds, dict):
        return None
    tender = ocds.get("tender") or {}
    n = tender.get("numberOfTenderers")
    try:
        if n is not None and int(n) > 0:
            return int(n)
    except (TypeError, ValueError):
        pass
    tenderers = tender.get("tenderers") or []
    if tenderers:
        return len({(t.get("id") or t.get("name")) for t in tenderers if isinstance(t, dict)}) or len(tenderers)
    parties = [p for p in (ocds.get("parties") or [])
               if isinstance(p, dict) and "tenderer" in (p.get("roles") or [])]
    if parties:
        return len(parties)
    return None


def check_unique_bidder_rule(ocid: str, tool_context: ToolContext,
                             reglas_activas: frozenset[str] | None = None,
                             topes_uit: dict | None = None) -> dict:
    """Evalúa la regla C2 — único postor con oferta ≥ 95% del valor referencial.

    Postores: `tender.numberOfTenderers` / `tender.tenderers` / `parties[role=tenderer]`
    del OCDS; si el OCDS no lo informa, `ofertas` de la BD SOLO si registra ofertas
    no ganadoras (ganadora=false: el registro incluyó a todos los postores). Sin dato
    de postores → `estado: sin_dato` y NO se emite bandera (antes `ofertas` solo
    tenía ganadores y la regla disparaba siempre que hubiera award: falso positivo).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered (bool), estado, n_postores, pct_ganador,
        severidad, evidencia, norma.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("unico_postor_alto", reglas)
    if om:
        return om
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    n_postores = _n_postores_ocds(ocds)
    fuente_n = "ocds" if n_postores is not None else None

    pct = None
    conn = _pg()
    try:
        cur = conn.cursor()
        if n_postores is None:
            cur.execute(
                """SELECT COUNT(DISTINCT p.empresa_ruc),
                          COUNT(*) FILTER (WHERE NOT o.ganadora)
                     FROM postores p JOIN ofertas o ON o.postor_id=p.id
                    WHERE p.ocid=%s""", (ocid,))
            n_bd, n_no_ganadoras = cur.fetchone() or (0, 0)
            if n_bd and n_no_ganadoras:
                n_postores, fuente_n = int(n_bd), "ofertas_bd"
        cur.execute(
            """SELECT ROUND(AVG(o.porcentaje_referencial)::numeric, 2)
                 FROM ofertas o JOIN convocatoria_items i ON i.id=o.item_id
                WHERE i.ocid=%s AND o.ganadora""", (ocid,))
        row = cur.fetchone()
        pct = float(row[0]) if row and row[0] is not None else None
    finally:
        conn.close()

    if pct is None:
        tender = ocds.get("tender") or {}
        ref = (tender.get("value") or {}).get("amount")
        adj = sum(float(((a.get("value") or {}).get("amount")) or 0)
                  for a in (ocds.get("awards") or []) if isinstance(a, dict))
        try:
            if ref and adj:
                pct = round(adj / float(ref) * 100, 2)
        except (TypeError, ValueError, ZeroDivisionError):
            pct = None

    result = {
        "regla": "unico_postor_alto",
        "n_postores": n_postores,
        "fuente_n_postores": fuente_n,
        "pct_ganador_vs_referencial": pct,
        "triggered": False,
        "estado": "sin_dato" if n_postores is None else "hallado",
    }
    if n_postores is None:
        result["motivo"] = "el OCDS no informa numberOfTenderers/tenderers y la BD no registra ofertas no ganadoras"
        return result
    if n_postores == 1 and pct is not None and pct >= 95:
        result.update({
            "triggered": True, "severidad": "alta",
            "evidencia": (f"Un solo postor registrado ({fuente_n}: numberOfTenderers/tenderers) y "
                          f"oferta ganadora al {pct}% del valor referencial."),
            "norma": _norma_state(state)["competencia"],
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        tool_context.state.setdefault("pending_flags", []).append(result)
    elif n_postores == 1:
        result["motivo"] = "un solo postor pero oferta < 95% del referencial (o sin porcentaje)"
    return result

def check_sanctioned_provider_rule(ocid: str, tool_context: ToolContext,
                                   reglas_activas: frozenset[str] | None = None,
                                   topes_uit: dict | None = None) -> dict:
    """Evalúa C4 + C7 — proveedor adjudicado con sanción OSCE vigente o
    con SOCIOS/representantes sancionados (inhabilitado vía consorcio).

    Cruza contra `osce_sancionados_vigentes` (3,899 sanciones activas a hoy:
    1,101 definitivas + 2,078 temporales + 720 multas con suspensión cautelar).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia y listas:
          - empresas_sancionadas_directas[]
          - empresas_con_socios_sancionados[] (C7 — inhabilitado vía consorcio)
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("proveedor_sancionado_osce", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        if not _table_exists(cur, "osce_sancionados"):
            return {"regla": "proveedor_sancionado_osce", "triggered": False,
                    "dataset_no_disponible": True}

        cur.execute(
            """SELECT e.razon_social, e.ruc,
                      s.tipo, s.periodo, s.fecha_hasta, s.resolucion,
                      LEFT(s.infraccion, 200) AS infraccion_short
                 FROM postores p
                 JOIN ofertas o   ON o.postor_id = p.id AND o.ganadora
                 JOIN empresas e  ON e.ruc = p.empresa_ruc
                 JOIN osce_sancionados_vigentes s ON s.ruc = e.ruc
                WHERE p.ocid = %s""",
            (ocid,),
        )
        directas = [
            {"razon_social": r[0], "ruc": r[1], "tipo": r[2],
             "periodo": r[3], "vence": r[4].isoformat() if r[4] else "DEFINITIVO",
             "resolucion": r[5], "infraccion": r[6]}
            for r in cur.fetchall()
        ]

        socios_sancionados = []
        if _table_exists(cur, "rnp_conformacion_juridica"):
            cur.execute(
                """SELECT e.razon_social, e.ruc,
                          s.razon_social, s.ruc,
                          r.tipo_rol,
                          s.tipo, s.fecha_hasta, s.resolucion
                     FROM postores p
                     JOIN ofertas o  ON o.postor_id = p.id AND o.ganadora
                     JOIN empresas e ON e.ruc = p.empresa_ruc
                     JOIN rnp_conformacion_juridica r ON r.ruc_empresa = e.ruc
                     JOIN osce_sancionados_vigentes s
                          ON (s.es_persona_natural = TRUE AND SUBSTRING(s.ruc FROM 3 FOR 8) = r.numero_documento)
                    WHERE p.ocid = %s""",
                (ocid,),
            )
            socios_sancionados = [
                {"empresa_ganadora": r[0], "ruc_empresa": r[1],
                 "socio_sancionado": r[2], "ruc_socio": r[3],
                 "rol_en_empresa": r[4], "tipo_sancion": r[5],
                 "vence": r[6].isoformat() if r[6] else "DEFINITIVO",
                 "resolucion": r[7]}
                for r in cur.fetchall()
            ]

        triggered = bool(directas or socios_sancionados)
        result = {
            "regla": "proveedor_sancionado_osce",
            "triggered": triggered,
            "n_directas": len(directas),
            "n_socios_sancionados": len(socios_sancionados),
            "empresas_sancionadas_directas": directas,
            "empresas_con_socios_sancionados": socios_sancionados,
        }
        if triggered:
            if directas:
                principal = directas[0]
                ev = (f"{principal['razon_social']} — sanción {principal['tipo']} VIGENTE "
                      f"(vence {principal['vence']}, resolución {principal['resolucion']})")
            else:
                principal = socios_sancionados[0]
                ev = (f"{principal['empresa_ganadora']} es ganadora; su {principal['rol_en_empresa']} "
                      f"{principal['socio_sancionado']} (RUC {principal['ruc_socio']}) tiene sanción "
                      f"{principal['tipo_sancion']} VIGENTE — patrón 'inhabilitado vía consorcio' (C7).")
            result.update({
                "severidad": "alta",
                "evidencia": ev,
                "norma": _norma_state(tool_context.state)["impedimentos"],
                "fuente_url": "https://apps.osce.gob.pe/perfilprov-ui/inhabilitado.xhtml",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

def check_non_competitive_process_rule(ocid: str, tool_context: ToolContext,
                                       reglas_activas: frozenset[str] | None = None,
                                       topes_uit: dict | None = None) -> dict:
    """Evalúa la regla C8 — el tipo de proceso es no competitivo (contratación
    directa, exoneración, situación de emergencia) y por tanto reduce
    competencia legalmente.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, tipo_proceso detectado, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("procedimiento_no_competitivo", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        # `tipo_proceso` está NULL en el 99.6 % de `convocatorias` (la ingesta llena
        # `modalidad`); el OCDS del state trae `procurementMethodDetails` (lote 1 · T11).
        cur.execute("SELECT COALESCE(tipo_proceso, modalidad) FROM convocatorias WHERE ocid=%s", (ocid,))
        row = cur.fetchone()
        tipo = _procurement_method(tool_context.state, (row or [None])[0])
        if not tipo or tipo.strip().lower() == "desconocido":
            return {"regla": "procedimiento_no_competitivo", "triggered": False, "tipo_proceso": None}
        u = _sin_tildes(tipo).upper()
        no_competitive = any(t in u for t in ("NO COMPETITIVO", "DIRECTA", "EXONER", "EMERGEN"))
        result = {
            "regla": "procedimiento_no_competitivo",
            "tipo_proceso": tipo,
            "triggered": no_competitive,
        }
        if no_competitive:
            result.update({
                "severidad": "media",
                "evidencia": f"Tipo de proceso: {tipo} · invocó causal de excepción que limita la competencia abierta",
                "norma": "Art. 55.1 Ley 32069 — supuestos de selección no competitiva",
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

def check_plazo_convocatoria_rule(ocid: str, tool_context: ToolContext,
                                  reglas_activas: frozenset[str] | None = None,
                                  topes_uit: dict | None = None) -> dict:
    """Evalúa si el plazo entre publicación de convocatoria y buena pro
    cumple el mínimo legal según tipo de proceso.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia, norma.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("plazo_convocatoria_minimo", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT COALESCE(tipo_proceso, modalidad), fecha_convocatoria, fecha_buena_pro, cuantia_referencial "
            "FROM convocatorias WHERE ocid=%s", (ocid,),
        )
        row = cur.fetchone()
        if not row:
            return {"regla": "plazo_convocatoria_minimo", "triggered": False, "motivo": "convocatoria no encontrada"}
        tipo, fconv, fbp, cuantia = row
        tipo = _procurement_method(tool_context.state, tipo)
        fconv, fbp = _to_date(fconv), _to_date(fbp)
        if not fconv or not fbp:
            return {"regla": "plazo_convocatoria_minimo", "triggered": False, "motivo": "sin fechas"}
        delta_dias = (fbp - fconv).days
        # Los plazos legales se cuentan en DÍAS HÁBILES entre la convocatoria y la presentación de
        # ofertas; aquí solo tenemos la buena pro (posterior), así que la ventana medida es MAYOR
        # que la legal: si aun así es corta, la señal es sólida. Se cuenta lunes-viernes (sin
        # feriados: por eso hay un margen de 2 días antes de marcar "alta").
        habiles = sum(1 for i in range(delta_dias) if (fconv + _dt.timedelta(days=i + 1)).weekday() < 5)
        tipo_norm = _sin_tildes(tipo or "").upper()

        # Mínimos referenciales en días hábiles entre convocatoria y presentación de ofertas
        # (Reglamento Ley 32069 / valores del régimen anterior cuando coinciden):
        #   Licitación / Concurso Público 22 · Subasta Inversa Electrónica 8 · Adjudicación
        #   Simplificada 8 (bienes/servicios) · Comparación de Precios 3 · Directa: sin mínimo.
        minimo = None
        if ("LICITACION" in tipo_norm or "CONCURSO" in tipo_norm) and "ABREVIAD" in tipo_norm:
            minimo = 8          # LPA / CPA (Ley 32069): plazos abreviados
        elif "LICITACION" in tipo_norm or "CONCURSO" in tipo_norm:
            minimo = 22
        elif "SUBASTA" in tipo_norm:
            minimo = 8
        elif "ADJUDICACION SIMPLIFICADA" in tipo_norm or "AS-" in tipo_norm:
            minimo = 8
        elif "COMPARACION" in tipo_norm:
            minimo = 3
        elif "DIRECTA" in tipo_norm:
            minimo = 0
        result = {
            "regla": "plazo_convocatoria_minimo",
            "tipo_proceso": tipo,
            "dias_efectivos": delta_dias,
            "dias_habiles": habiles,
            "dias_minimo_habiles": minimo,
            "triggered": False,
        }
        if minimo is not None and minimo > 0 and habiles < minimo:
            claro = habiles <= minimo - 2          # margen por feriados no contados
            result.update({
                "triggered": True,
                "severidad": "alta" if claro else "media",
                "requiere_verificacion": not claro,
                "evidencia": (
                    f"Entre la convocatoria ({fconv}) y la buena pro ({fbp}) pasaron {habiles} días hábiles "
                    f"({delta_dias} calendario) — por debajo del mínimo referencial de {minimo} días hábiles "
                    f"para {tipo}" + ("" if claro else " (margen de feriados: verificar el cronograma de las bases)") + "."
                ),
                "norma": _norma_state(tool_context.state).get("plazos", "Reglamento Ley 32069 — plazos mínimos del procedimiento de selección"),
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

def check_tipo_proceso_vs_monto_rule(ocid: str, tool_context: ToolContext,
                                     reglas_activas: frozenset[str] | None = None,
                                     topes_uit: dict | None = None) -> dict:
    """Verifica que el tipo de proceso elegido corresponda al monto referencial.
    Por ejemplo, una contratación de S/. 5M debería ir por Licitación Pública,
    no por Adjudicación Simplificada o Comparación de Precios.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia, norma.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("tipo_proceso_vs_monto", reglas)
    if om:
        return om
    topes = _perfil_topes(tool_context, topes_uit)
    state = tool_context.state
    conn = _pg()
    try:
        cur = conn.cursor()
        # `tipo_proceso` NULL en el 99.6 % de las filas → COALESCE con `modalidad` y, sobre
        # todo, `procurementMethodDetails` del OCDS en state (lote 1 · T11).
        cur.execute(
            "SELECT COALESCE(tipo_proceso, modalidad), cuantia_referencial, fecha_convocatoria "
            "FROM convocatorias WHERE ocid=%s",
            (ocid,),
        )
        row = cur.fetchone()
    finally:
        conn.close()
    tipo_bd, cuantia, fconv_bd = row if row else (None, None, None)
    tipo = _procurement_method(state, tipo_bd)
    if not cuantia:
        cuantia = _montos_ocds(state.get("ocds") or state.get("ocds_preloaded") or {}).get("referencial")
    if not tipo or tipo.strip().lower() == "desconocido" or not cuantia:
        return {"regla": "tipo_proceso_vs_monto", "triggered": False, "estado": "sin_dato",
                "motivo": "sin tipo de procedimiento o cuantía (BD/OCDS)"}
    tipo_norm = _sin_tildes(tipo).upper()
    cuantia_f = float(cuantia)
    norma = norma_aplicable(_fecha_convocatoria_state(state) or fconv_bd)
    es_obras = str(((state.get("perfil") or {}).get("nombre")) or state.get("pipeline_profile") or "").lower() == "obras" \
        or _tope(topes, 0.0, "licitacion_publica") >= 1000
    fuente = f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"
    result = {"regla": "tipo_proceso_vs_monto", "tipo_proceso": tipo, "cuantia_soles": cuantia_f,
              "regimen": norma["regimen"], "triggered": False}

    if norma["regimen"] == "ley_32069":
        # Topes en SOLES (Ley 32069 art. 54 + art. 14 Ley 32513, Presupuesto 2026; Reglamento
        # D.S. 009-2025-EF para la comparación de precios). UIT 2026 = S/ 5 500.
        #   · Comparación de precios (bienes/servicios de disponibilidad inmediata): ≤ S/ 100 000
        #   · Licitación / Concurso Público abreviados (bienes/servicios): < S/ 485 000
        #   · Licitación / Concurso Público (bienes/servicios): ≥ S/ 485 000
        #   · Obras: LP ≥ S/ 5 000 000; LPA por debajo
        #   · Contrataciones menores (excluidas de la ley): ≤ 8 UIT = S/ 44 000
        t = dict(_TOPES_LEY_32069)
        for k in t:
            t[k] = _tope(topes, t[k], k)
        tope_cp = t["comparacion_precios_max_soles"]
        tope_lp = t["obras_licitacion_min_soles"] if es_obras else t["licitacion_publica_min_soles"]
        result["topes_soles"] = {"comparacion_precios_max": tope_cp, "licitacion_publica_min": tope_lp,
                                 "uit_soles": t["uit_soles"], "menores_max": 8 * t["uit_soles"]}
        es_cp = _es_comparacion_precios(tipo_norm)
        es_abreviado = ("ABREVIAD" in tipo_norm or "LPA" in tipo_norm.split("-") or "CPA" in tipo_norm.split("-")
                        or "ADJUDICACION SIMPLIFICADA" in tipo_norm or tipo_norm.startswith("AS-"))
        if es_cp and cuantia_f > tope_cp:
            result.update({
                "triggered": True, "severidad": "alta",
                "evidencia": (f"Comparación de Precios con cuantía S/ {cuantia_f:,.2f}, por encima del tope "
                              f"de S/ {tope_cp:,.0f} que fija el Reglamento para ese procedimiento "
                              f"({norma['ley']}). Correspondía un procedimiento abreviado."),
                "norma": norma["procedimientos"], "fuente_url": fuente})
            state.setdefault("pending_flags", []).append(result)
        elif es_abreviado and cuantia_f >= tope_lp:
            result.update({
                "triggered": True, "severidad": "alta",
                "evidencia": (f"Procedimiento abreviado ({tipo}) con cuantía S/ {cuantia_f:,.2f}, igual o mayor al "
                              f"umbral de S/ {tope_lp:,.0f} desde el que corresponde Licitación/Concurso Público "
                              f"(art. 14 Ley 32513)."),
                "norma": norma["procedimientos"], "fuente_url": fuente})
            state.setdefault("pending_flags", []).append(result)
        elif es_cp and cuantia_f >= 0.95 * tope_cp:
            # Informativa (baja): la cuantía se fijó al borde del tope de la comparación de
            # precios (99.6 % en 1225062, 99.7 % en 1225266, 95 % en 1225392). No es
            # irregular por sí sola; sí es dato para el lector.
            pct = cuantia_f / tope_cp * 100
            sub = {"regla": "cuantia_al_limite_del_tope", "triggered": True, "severidad": "baja",
                   "evidencia": (f"La cuantía (S/ {cuantia_f:,.2f}) equivale al {pct:.1f} % del tope de la "
                                 f"Comparación de Precios (S/ {tope_cp:,.0f}). Observación informativa: el "
                                 f"procedimiento se dimensionó al límite del umbral."),
                   "norma": norma["procedimientos"], "fuente_url": fuente}
            result["sub_regla"] = sub
            state.setdefault("pending_flags", []).append(sub)
        return result

    # Régimen TUO Ley 30225: topes en UIT del perfil (Anexo IV). Defaults bienes/servicios:
    #   CP ≤ 15 UIT · AS ≤ 400 UIT (obras 1 800) · LP por encima. UIT 2025 = S/ 5 350.
    UIT = _tope(topes, _TOPES_DEFAULT["uit_soles"], "uit_soles", "uit")
    tope_cp = _tope(topes, _TOPES_DEFAULT["comparacion_precios_max"],
                    "comparacion_precios_max", "comparacion_precios")
    tope_as = _tope(topes, _TOPES_DEFAULT["adjudicacion_simplificada_max"],
                    "adjudicacion_simplificada_max", "adjudicacion_simplificada",
                    "licitacion_publica")
    en_uit = cuantia_f / UIT
    result.update({"cuantia_uit": round(en_uit, 1),
                   "topes_uit": {"uit_soles": UIT, "comparacion_precios_max": tope_cp,
                                 "adjudicacion_simplificada_max": tope_as}})
    if _es_comparacion_precios(tipo_norm) and en_uit > tope_cp:
        result.update({
            "triggered": True, "severidad": "alta",
            "evidencia": (f"Tipo 'Comparación de Precios' usado con monto {cuantia_f:.2f} soles "
                          f"({en_uit:.1f} UIT) — excede el tope de {tope_cp:g} UIT para CP. "
                          f"Debería haber ido por Adjudicación Simplificada o Licitación Pública."),
            "norma": norma["procedimientos"], "fuente_url": fuente})
        state.setdefault("pending_flags", []).append(result)
    elif ("ADJUDICACION SIMPLIFICADA" in tipo_norm or tipo_norm.startswith("AS-")) and en_uit > tope_as:
        result.update({
            "triggered": True, "severidad": "alta",
            "evidencia": (f"Tipo 'Adjudicación Simplificada' usado con monto {cuantia_f:.2f} soles "
                          f"({en_uit:.1f} UIT) — excede el tope de {tope_as:g} UIT para AS según el "
                          f"tipo de contratación. Debería haber ido por Licitación Pública."),
            "norma": norma["procedimientos"], "fuente_url": fuente})
        state.setdefault("pending_flags", []).append(result)
    return result

def _identificar_causal_directa(fundamento_textos: list[str], objeto_contrato: str = "") -> dict:
    """Identifica qué causal del Art. 27 / Art. 55 invocó la entidad para una
    Contratación Directa. Retorna {causal_letra, descripcion, evidencia_text,
    requiere_acto_resolutivo, match_score}.

    Si ninguna causal coincide, retorna {causal_letra: None, ...}.
    """
    import re as _re
    corpus = " ".join(str(t) for t in (fundamento_textos or []))[:10000]
    corpus_lower = corpus.lower()

    for letra, pattern, descripcion, requiere_resol in _CAUSALES_DIRECTA:
        m = _re.search(pattern, corpus_lower, _re.IGNORECASE)
        if m:
            return {
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
        if not row or not row[0]:
            return {"regla": "directa_sin_fundamento", "triggered": False}
        tipo, objeto = row[0], (row[1] or "")
        if "DIRECTA" not in (tipo or "").upper() and "EXONERA" not in (tipo or "").upper():
            return {"regla": "directa_sin_fundamento", "triggered": False,
                    "motivo": "no es contratación directa"}

        state = tool_context.state

        # 1. Extraer fundamento_legal del document_analysis
        doc = _safe_parse_json(state.get("document_analysis"))
        fund = (doc or {}).get("fundamento_legal") or []
        # También considerar el parser_raw_consolidated como fallback
        raw = state.get("parser_raw_consolidated") or {}
        if not fund and raw.get("fundamento_legal"):
            fund = raw["fundamento_legal"]

        # 2. Identificar causal específica
        causal = _identificar_causal_directa(fund, objeto)
        # Mantener compatibilidad con la heurística vieja: si el regex no
        # encontró una causal pero el texto menciona keywords legales,
        # consideramos que SÍ hay una causal vaga (no triggera bandera).
        tiene_keyword_legal = any(
            "55" in str(f) or "EMERGENCIA" in str(f).upper() or
            "EXONERA" in str(f).upper() or "D.S." in str(f) or
            "DECRETO SUPREMO" in str(f).upper()
            for f in fund
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
            # No identificamos causal ni hay keywords legales → bandera ALTA
            result.update({
                "triggered": True,
                "severidad": "alta",
                "evidencia": (
                    f"Tipo de proceso '{tipo}' sin causal legal claramente "
                    f"identificable del Art. 27 TUO Ley 30225 / Art. 55 Ley 32069. "
                    f"Fundamento extraído del documento: "
                    f"{fund if fund else 'ninguno'}"
                ),
                "norma": "Art. 27 TUO Ley 30225 / Art. 55.1 Ley 32069 — causales "
                         "de selección no competitiva deben estar acreditadas",
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
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
                    f"La Contratación Directa invocó causal '{causal['descripcion']}' "
                    f"(Art. 27 lit. {causal['causal_letra']}), pero no se identifica "
                    + ("en el texto completo de los documentos publicados "
                       if not solo_resumenes else
                       "en los resúmenes disponibles de los documentos (texto completo no disponible: "
                       "requiere verificación manual del expediente) ")
                    + "el acto resolutivo que declara la situación (D.S./D.U./Resolución/Acuerdo "
                    "Regional). Sin acto resolutivo acreditable, la causal carece de sustento legal."
                ),
                "norma": "Art. 27.1 lit. a) TUO Ley 30225 — la situación de emergencia "
                         "debe estar acreditada por declaratoria oficial",
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
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
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

def check_edad_ruc_ganador_rule(ocid: str, tool_context: ToolContext,
                                reglas_activas: frozenset[str] | None = None,
                                topes_uit: dict | None = None) -> dict:
    """Evalúa si el proveedor adjudicado tiene un RUC muy reciente (<2 años)
    para un contrato de monto considerable (>S/. 100K). Lee del state los
    perfiles SUNAT cargados por query_sunat_decolecta.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("ruc_ganador_muy_nuevo", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT e.ruc, e.razon_social, SUM(o.monto_ofertado) as monto_total
                 FROM postores p
                 JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                 JOIN empresas e ON e.ruc=p.empresa_ruc
                WHERE p.ocid=%s GROUP BY e.ruc, e.razon_social""",
            (ocid,),
        )
        ganadores = cur.fetchall()
        if not ganadores:
            return {"regla": "ruc_ganador_muy_nuevo", "triggered": False, "motivo": "sin ganadores en BD"}

        sunat_profiles = tool_context.state.get("sunat_profiles") or {}
        triggered_list = []
        from datetime import date
        for ruc, razon, monto in ganadores:
            monto_f = float(monto or 0)
            if monto_f < 100000:
                continue
            profile = sunat_profiles.get(ruc) or {}
            fecha_inicio = profile.get("fecha_inicio_actividades")
            edad_dias = profile.get("edad_dias")
            if not edad_dias and fecha_inicio:
                try:
                    from datetime import datetime
                    d = datetime.strptime(str(fecha_inicio)[:10], "%Y-%m-%d").date()
                    edad_dias = (date.today() - d).days
                except Exception:
                    edad_dias = None
            if edad_dias is not None and edad_dias < 730:  # < 2 años
                triggered_list.append({
                    "ruc": ruc,
                    "razon_social": razon,
                    "monto": monto_f,
                    "edad_dias": edad_dias,
                    "edad_meses": round(edad_dias / 30, 1),
                    "fecha_inicio": fecha_inicio,
                })
        result = {
            "regla": "ruc_ganador_muy_nuevo",
            "n_ganadores_evaluados": len(ganadores),
            "n_triggered": len(triggered_list),
            "detalle": triggered_list,
            "triggered": len(triggered_list) > 0,
        }
        if triggered_list:
            principal = triggered_list[0]
            result.update({
                "severidad": "alta",
                "evidencia": (
                    f"{principal['razon_social']} (RUC {principal['ruc']}) tiene "
                    f"{principal['edad_meses']} meses de antigüedad y recibe contrato por "
                    f"S/. {(principal.get('monto') or 0):,.2f}. Patrón típico de empresa creada para ganar contrato."
                ),
                "norma": "Heurística — " + _norma_state(tool_context.state)["impedimentos"],
                "fuente_url": f"https://sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc={principal['ruc']}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

def check_ciiu_vs_objeto_rule(ocid: str, tool_context: ToolContext,
                              reglas_activas: frozenset[str] | None = None,
                              topes_uit: dict | None = None) -> dict:
    """Verifica que el CIIU principal del proveedor sea coherente con el objeto
    del contrato. Si el CIIU es 'venta de textiles' y el contrato es 'compra de
    equipos médicos', es señal de proveedor improvisado o testaferro.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("ciiu_vs_objeto", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT c.objeto, e.ruc, e.razon_social
                 FROM convocatorias c
                 JOIN postores p ON p.ocid=c.ocid
                 JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                 JOIN empresas e ON e.ruc=p.empresa_ruc
                WHERE c.ocid=%s LIMIT 1""", (ocid,),
        )
        row = cur.fetchone()
        if not row:
            return {"regla": "ciiu_vs_objeto", "triggered": False, "motivo": "sin datos"}
        objeto, ruc, razon = row
        # Ítems del OCDS (descripción del producto real; el `objeto` suele ser el nombre
        # del proyecto: "…CARRETERA PAUCARTAMBO…" no dice "estación total").
        cur.execute("SELECT descripcion FROM convocatoria_items WHERE ocid=%s", (ocid,))
        descs_ocds = [r[0] for r in cur.fetchall() if r and r[0]]
    finally:
        conn.close()
    state = tool_context.state
    sunat = (state.get("sunat_profiles") or {}).get(ruc) or {}
    ciiu = (sunat.get("ciiu_principal") or "").lower()
    activs = sunat.get("actividades_economicas") or []
    if not ciiu and not activs:
        return {"regla": "ciiu_vs_objeto", "triggered": False, "estado": "sin_dato", "motivo": "sin CIIU disponible"}

    raw = state.get("parser_raw_consolidated") or {}
    descs_parser = [str(it.get("descripcion_corta") or "") for it in (raw.get("items_consolidados") or [])
                    if isinstance(it, dict)]
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    tender = ocds.get("tender") or {}
    descs_tender = [str(it.get("description") or "") for it in (tender.get("items") or []) if isinstance(it, dict)]
    texto_objeto = " ".join([objeto or "", tender.get("description") or ""] + descs_ocds + descs_tender + descs_parser)
    cat_objeto = _categoria_objeto(texto_objeto)
    ciiu_full = (ciiu + " " + " ".join(str(a) for a in activs)).lower()
    cat_ciiu = _categoria_ciiu(ciiu_full)

    result = {
        "regla": "ciiu_vs_objeto",
        "objeto_categoria": cat_objeto,
        "ciiu_categoria": cat_ciiu,
        "ciiu_principal": sunat.get("ciiu_principal"),
        "actividades": activs,
        "estado": "hallado" if (cat_objeto and cat_ciiu) else "sin_dato",
        "triggered": False,
    }
    if cat_objeto and cat_ciiu and not _categorias_compatibles(cat_objeto, cat_ciiu):
        result.update({
            "triggered": True,
            "severidad": "media",
            "evidencia": (
                f"{razon} (RUC {ruc}) declara ante SUNAT la actividad '{(sunat.get('ciiu_principal') or ciiu_full)[:80]}' "
                f"(rubro '{cat_ciiu}') mientras el objeto contratado es de '{cat_objeto}'. Señal de riesgo: "
                f"verificar la capacidad técnica y operativa real del proveedor para este rubro."
            ),
            "norma": "Heurística — coherencia rubro empresa vs objeto del contrato",
            "fuente_url": f"https://sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc={ruc}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result


# Categorías de objeto/CIIU (lote 1 · T11). Keywords específicas; se evita "mayor/menor/obra".
_CATEGORIAS_OBJETO: dict[str, tuple[str, ...]] = {
    "combustible": ("combustible", "diesel", "gasohol", "gasolina", "petroleo", "hidrocarburo", "glp", "gnv", "lubricante"),
    "alimentos": ("alimento", "comestible", "bebida", "viveres", "carne", "lacteo", "abarrote", "arroz", "azucar",
                  "aceite", "leche", "menestra", "harina", "quinua", "avena", "pollo", "huevo", "conserva", "racion",
                  "desayuno", "almuerzo", "canasta", "panaderia", "fideo"),
    "construccion": ("construccion", "ferreteria", "cemento", "agregado", "edificacion", "asfalto", "ladrillo",
                     "fierro", "acero", "drywall", "perfileria", "perfil ", "parante", "riel", "gavion", "piedra",
                     "arena", "hormigon", "geosintetico", "geomalla", "geotextil", "tuberia", "madera", "calamina",
                     "pintura", "poste", "concreto", "sanitario", "electrico"),
    "informatica": ("computadora", "informatica", "software", "tecnologia", "laptop", "impresora", "servidor",
                    "licencia", "monitor", "proyector", "tablet", "router", "switch", "scanner", "computo"),
    "equipos": ("equipo topografico", "topograf", "estacion total", "prisma", "tripode", "gps", "gnss",
                "instrumento", "medicion", "laboratorio", "analizador", "balanza", "microscopio", "equipamiento",
                "maquina", "generador", "compresor", "bomba", "motobomba", "soldadora", "electrobomba"),
    "vehiculos": ("vehiculo", "maquinaria", "camion", "volquete", "camioneta", "motocicleta", "ambulancia",
                  "excavadora", "cargador frontal", "retroexcavadora", "tractor", "cisterna", "llanta", "neumatico",
                  "repuesto"),
    "salud": ("medico", "farmaceutico", "hospital", "salud", "medicamento", "insumo medico", "reactivo",
              "inmunohematolog", "laboratorio clinico", "dispositivo medico", "jeringa", "vacuna", "odontolog"),
    "textil": ("textil", "calzado", "ropa", "uniforme", "confeccion", "vestuario", "prenda", "chompa", "buzo",
               "frazada", "colcha", "zapato", "zapatilla"),
    "mobiliario": ("mobiliario", "mueble", "silla", "escritorio", "carpeta", "estante", "armario", "pupitre"),
    "agropecuario": ("agropecuario", "agricola", "semilla", "fertilizante", "abono", "planton", "alevino",
                     "ganado", "vacuno", "ovino", "alpaca", "cuy", "pasto", "insecticida", "veterinari", "pecuari"),
    "limpieza": ("limpieza", "detergente", "lejia", "desinfectante", "papel higienico", "jabon", "escoba"),
    "oficina": ("utiles de oficina", "papeleria", "utiles de escritorio", "toner", "tinta", "impresion", "papel bond"),
    "seguridad": ("seguridad", "epp", "casco", "chaleco", "extintor", "camara de vigilancia", "vigilancia"),
}
# CIIU (texto de SUNAT/decolecta) → categoría. El CIIU habla en términos de "venta al por
# mayor/menor de …", "fabricación de …", "alquiler de …".
_CATEGORIAS_CIIU: dict[str, tuple[str, ...]] = {
    "combustible": ("combustible", "hidrocarburo", "estacion de servicio", "grifo", "lubricante", "gas licuado"),
    "alimentos": ("aliment", "bebida", "abarrote", "restaurant", "comida", "panader", "carne", "lacteo", "agroindustri"),
    "construccion": ("construccion", "ferreter", "material de construccion", "materiales de construccion", "pintura",
                     "vidrio", "metalic", "cemento", "hormigon", "edific", "acabado", "obras de ingenieria"),
    "informatica": ("informatic", "software", "computador", "ordenador", "tecnologia de la informacion", "programacion",
                    "equipo de computo"),
    "equipos": ("maquinaria", "equipo", "instrumento", "aparato", "electrico", "electronic", "optic", "precision"),
    "vehiculos": ("vehiculo", "automotor", "automovil", "camion", "motocicleta", "repuesto", "transporte", "llanta"),
    "salud": ("farmac", "medic", "hospital", "salud", "laboratorio", "odontolog", "clinic", "dental"),
    "textil": ("textil", "calzado", "prenda", "confeccion", "ropa", "vestir", "cuero"),
    "mobiliario": ("mueble", "mobiliario", "carpinter"),
    "agropecuario": ("agricol", "agropecuari", "ganader", "pecuari", "cultivo", "cria de", "veterinari", "silvicultura"),
    "limpieza": ("limpieza", "jabon", "detergente", "aseo"),
    "oficina": ("papeler", "utiles", "libreria", "imprenta", "impresion", "articulos de oficina"),
    "seguridad": ("seguridad", "vigilancia", "investigacion y seguridad"),
    "alquiler": ("alquiler", "arrendamiento", "arriendo", "leasing"),
    "servicios": ("consultor", "asesor", "contabil", "juridic", "arquitectura", "ingenieria", "publicidad",
                  "actividades de oficina", "servicios administrativos", "enseñanza", "educacion", "inmobiliari"),
    "comercio_general": ("otros productos", "productos diversos", "no especializ", "diversos", "otros tipos",
                         "n.c.p", "ncp", "otras actividades de venta", "bazar"),
}
# Pares compatibles (además de la igualdad): el CIIU "equipos" cubre instrumentos de salud
# y computo; "construccion" cubre "equipos" de obra; el comercio general cubre todo.
_CATEGORIAS_COMPATIBLES = {
    ("equipos", "informatica"), ("equipos", "salud"), ("equipos", "construccion"), ("equipos", "vehiculos"),
    ("equipos", "seguridad"), ("construccion", "seguridad"), ("construccion", "mobiliario"),
    ("salud", "limpieza"), ("oficina", "informatica"), ("oficina", "mobiliario"), ("alimentos", "agropecuario"),
    ("agropecuario", "combustible"), ("vehiculos", "combustible"), ("textil", "seguridad"),
}


def _categoria_objeto(texto: str) -> str | None:
    t = _sin_tildes(texto or "").lower()
    puntajes = {cat: sum(1 for kw in kws if kw in t) for cat, kws in _CATEGORIAS_OBJETO.items()}
    best = max(puntajes.items(), key=lambda kv: kv[1]) if puntajes else (None, 0)
    return best[0] if best[1] > 0 else None


def _categoria_ciiu(texto: str) -> str | None:
    t = _sin_tildes(texto or "").lower()
    # "alquiler de …" domina: un CIIU de alquiler no acredita venta del bien (1225392).
    if any(kw in t for kw in _CATEGORIAS_CIIU["alquiler"]) and not any(kw in t for kw in ("venta", "comercio")):
        return "alquiler"
    puntajes = {cat: sum(1 for kw in kws if kw in t) for cat, kws in _CATEGORIAS_CIIU.items() if cat != "alquiler"}
    best = max(puntajes.items(), key=lambda kv: kv[1]) if puntajes else (None, 0)
    return best[0] if best[1] > 0 else None


def _categorias_compatibles(cat_objeto: str, cat_ciiu: str) -> bool:
    if cat_objeto == cat_ciiu:
        return True
    if cat_ciiu == "comercio_general":
        return True
    if cat_ciiu in ("alquiler", "servicios"):
        return False
    return (cat_objeto, cat_ciiu) in _CATEGORIAS_COMPATIBLES or (cat_ciiu, cat_objeto) in _CATEGORIAS_COMPATIBLES

def _ganador_ruc(ocid: str, state: dict, cur=None) -> tuple[str | None, str | None]:
    """(ruc, razon_social) del ganador: BD (ofertas ganadora) → OCDS awards.suppliers."""
    ruc, nombre = None, None
    if cur is not None:
        try:
            cur.execute(
                """SELECT e.ruc, e.razon_social FROM postores p
                     JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                     JOIN empresas e ON e.ruc=p.empresa_ruc
                    WHERE p.ocid=%s LIMIT 1""", (ocid,))
            row = cur.fetchone()
            if row:
                ruc, nombre = row[0], row[1]
        except Exception:
            ruc = None
    if not ruc:
        ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
        for a in (ocds.get("awards") or []):
            for sup in (a.get("suppliers") or []):
                pid = str(sup.get("id") or "")
                digits = "".join(ch for ch in pid if ch.isdigit())
                if len(digits) == 11:
                    return digits, sup.get("name")
    return ruc, nombre


def _tokens_objeto(txt: str) -> set[str]:
    import re as _re
    _STOP = {"adquisicion", "adquisición", "servicio", "servicios", "contratacion", "contratación",
             "para", "por", "con", "del", "las", "los", "meta", "proyecto", "mejoramiento",
             "mantenimiento", "bien", "bienes", "obra", "obras", "general", "generales", "sede",
             "central", "unidad", "mediante", "modalidad", "proceso", "seleccion", "selección",
             "compra", "suministro", "item", "items", "equipo", "equipos", "municipalidad",
             "distrital", "provincial", "gobierno", "regional", "entidad"}
    txt = _re.sub(r"[^a-záéíóúñ0-9 ]", " ", (txt or "").lower())
    return {w for w in txt.split() if len(w) > 3 and w not in _STOP}


def check_concentracion_entidad_rule(ocid: str, tool_context: ToolContext,
                                     reglas_activas: frozenset[str] | None = None,
                                     topes_uit: dict | None = None) -> dict:
    """Detecta si el proveedor adjudicado concentra contratos con la entidad
    contratante actual. Cuenta en `convocatorias` (BD propia: procesos ingestados
    del SEACE), NO en lo que `web_research` (LLM con grounding) "dijo haber visto"
    (hallazgo #8). Dispara con ≥3 contratos previos con la misma entidad Y ≥40 % de
    su historial en la BD; el alcance (solo procesos en la base de Vigía) queda
    explícito en la evidencia.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia, ocids_misma_entidad.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("concentracion_entidad", reglas)
    if om:
        return om
    state = tool_context.state
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT c.entidad_ruc, (SELECT nombre FROM entidades e WHERE e.ruc=c.entidad_ruc) "
            "FROM convocatorias c WHERE c.ocid=%s", (ocid,))
        row = cur.fetchone()
        entidad_ruc = (row and row[0]) or None
        entidad_nombre = (row and row[1]) or ""
        prov_ruc, prov_nombre = _ganador_ruc(ocid, state, cur)
        if not prov_ruc:
            return {"regla": "concentracion_entidad", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin proveedor adjudicado identificable"}
        cur.execute(
            """SELECT DISTINCT c.ocid, c.entidad_ruc, c.fecha_convocatoria, c.cuantia_referencial
                 FROM convocatorias c
                 LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                 LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                WHERE c.ocid<>%s AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)""",
            (prov_ruc, ocid, prov_ruc))
        rows = cur.fetchall()
    finally:
        conn.close()

    n_total = len(rows)
    misma = [r for r in rows if entidad_ruc and r[1] == entidad_ruc]
    n_misma = len(misma)
    pct = (n_misma / n_total * 100) if n_total else 0.0
    result = {
        "regla": "concentracion_entidad",
        "proveedor_ruc": prov_ruc,
        "n_contratos_misma_entidad": n_misma,
        "n_total_contratos_en_base": n_total,
        "pct_concentracion": round(pct, 1),
        "ocids_misma_entidad": [r[0] for r in misma][:10],
        "estado": "hallado" if n_total else "sin_dato",
        "_nota_alcance": "Conteos sobre procesos ingestados en la base de Vigía, no el universo SEACE.",
        "triggered": False,
    }
    if n_misma >= 3 and pct >= 40:
        result.update({
            "triggered": True,
            "severidad": "media",
            "evidencia": (
                f"{prov_nombre or 'El proveedor'} (RUC {prov_ruc}) registra {n_misma} procesos previos "
                f"con {entidad_nombre or 'esta entidad'} sobre {n_total} procesos suyos en la base de "
                f"Vigía ({pct:.0f}%). Procesos: {', '.join(result['ocids_misma_entidad'][:5])}. "
                f"Patrón de concentración con un solo comprador (alcance: base propia, no universo SEACE)."
            ),
            "norma": "Heurística — concentración cliente público debilita la competencia natural",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        tool_context.state.setdefault("pending_flags", []).append(result)
    return result

def check_recurrencia_firmante_rule(ocid: str, tool_context: ToolContext,
                                    reglas_activas: frozenset[str] | None = None,
                                    topes_uit: dict | None = None) -> dict:
    """Detecta si algún firmante de la entidad coincide con personas vinculadas
    al proveedor (gerente, socios). Usa el cruce_firmantes_ganador que pobló
    person_network_agent, pero SOLO promueve a bandera los cruces con
    `fuente_url` verificable (http) y `confianza_match == 'alta'` (hallazgo #8):
    el resto queda como `cruces_no_verificables` (no bandera).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia, cruces_no_verificables.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("firmante_vinculado_ganador", reglas)
    if om:
        return om
    person = _safe_parse_json(tool_context.state.get("person_network")) or {}
    cruces = person.get("cruce_firmantes_ganador") or []
    relevantes, no_verificables = [], []
    for c in cruces:
        if not isinstance(c, dict):
            continue
        if not c.get("tipo_relacion") or c.get("tipo_relacion") == "sin_relacion":
            continue
        if c.get("severidad") not in ("alta", "media"):
            continue
        fuente = str(c.get("fuente_url") or "").strip()
        conf = str(c.get("confianza_match") or c.get("confianza") or "").strip().lower()
        if fuente.startswith("http") and conf == "alta":
            relevantes.append(c)
        else:
            falta = []
            if not fuente.startswith("http"):
                falta.append("fuente_url")
            if conf != "alta":
                falta.append(f"confianza_match={conf or 'ausente'}")
            no_verificables.append({**c, "_no_verificable_por": falta})
    result = {
        "regla": "firmante_vinculado_ganador",
        "n_cruces_detectados": len(relevantes),
        "n_cruces_no_verificables": len(no_verificables),
        "detalle": relevantes[:5],
        "cruces_no_verificables": no_verificables[:5],
        "estado": "hallado" if relevantes else ("no_verificable" if no_verificables else "sin_dato"),
        "triggered": len(relevantes) > 0,
    }
    if relevantes:
        primero = relevantes[0]
        result.update({
            "severidad": primero.get("severidad", "media"),
            "evidencia": (
                f"Posible vínculo entre firmante '{primero.get('firmante')}' "
                f"({primero.get('cargo_firmante')}) y persona del proveedor "
                f"'{primero.get('persona_proveedor')}': "
                f"{primero.get('evidencia', primero.get('tipo_relacion'))} "
                f"(confianza alta, fuente: {primero.get('fuente_url')})"
            ),
            "norma": "Heurística — " + _norma_state(tool_context.state)["impedimentos"] + " / Ley 30057",
            "fuente_url": primero.get("fuente_url"),
        })
        tool_context.state.setdefault("pending_flags", []).append(result)
    return result

def check_testaferro_multi_ruc_rule(ocid: str, tool_context: ToolContext,
                                    reglas_activas: frozenset[str] | None = None,
                                    topes_uit: dict | None = None) -> dict:
    """C9 — Testaferro multi-RUC: detecta cuando el representante legal / socio /
    titular del ganador aparece como representante de ≥3 empresas distintas que
    también ganaron contratos del Estado. Patrón típico de testaferro.

    Fuente: cruza datos de `query_rnp_empresa` + alertas históricas en BD.
    Norma: Art. 50 TUO Ley 30225 (impedimentos) + Art. 11 inc. m (consorcio sin declarar).
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("testaferro_multi_ruc", reglas)
    if om:
        return om
    state = tool_context.state
    # `rnp_empresa_proveedor` no la escribe nadie: el RNP del ganador vive en
    # `person_network_context.rnp_proveedor` (personas.py) — informe 1225266 P6. Se
    # complementa con los DNI del perfil OECE del ganador (`oece_perfiles[ruc]`).
    pnc = state.get("person_network_context") or {}
    rnp_empresa = (state.get("rnp_empresa_proveedor") or pnc.get("rnp_proveedor")
                   or (pnc.get("rnp_empresa") if isinstance(pnc.get("rnp_empresa"), dict) else None) or {})
    socios = rnp_empresa.get("socios") or []
    representantes = rnp_empresa.get("representantes_legales") or []
    organos = rnp_empresa.get("organos_administracion") or []

    # Extraer todos los DNI/RUC de personas vinculadas al proveedor
    personas = set()
    for p in socios + representantes + organos:
        if isinstance(p, dict):
            doc = (p.get("numero_documento") or p.get("dni") or "").strip()
            if doc:
                personas.add(doc)
    g_ruc, _ = _ganador_ruc(ocid, state)
    perfil_oece = (state.get("oece_perfiles") or {}).get(g_ruc) or {} if g_ruc else {}
    for k in ("socios_dni", "representantes_dni", "organos_dni"):
        for d in (perfil_oece.get(k) or []):
            d = str(d).strip()
            if d.isdigit() and len(d) == 8:
                personas.add(d)

    if not personas:
        return {"regla": "testaferro_multi_ruc", "triggered": False,
                "motivo": "sin personas vinculadas en RNP del proveedor"}

    conn = _pg()
    try:
        cur = conn.cursor()
        # Por cada persona, contar cuántas empresas DISTINTAS donde aparece y han ganado contratos del Estado
        triggered_list = []
        for doc in personas:
            cur.execute(
                """SELECT COUNT(DISTINCT r.ruc_empresa) AS n_empresas,
                          ARRAY_AGG(DISTINCT r.ruc_empresa) AS rucs
                     FROM rnp_conformacion_juridica r
                     JOIN alertas a ON a.proveedor_ruc = r.ruc_empresa
                    WHERE r.numero_documento = %s
                      AND a.analizado_en >= NOW() - INTERVAL '12 months'""",
                (doc,),
            )
            row = cur.fetchone()
            if row and (row[0] or 0) >= 3:
                triggered_list.append({
                    "numero_documento": doc,
                    "n_empresas_ganadoras": int(row[0]),
                    "rucs_empresas": (row[1] or [])[:10],
                })

        result = {
            "regla": "testaferro_multi_ruc",
            "n_personas_evaluadas": len(personas),
            "n_triggered": len(triggered_list),
            "detalle": triggered_list,
            "triggered": len(triggered_list) > 0,
        }
        if triggered_list:
            principal = triggered_list[0]
            result.update({
                "severidad": "alta",
                "evidencia": (
                    f"Persona con documento {principal['numero_documento']} figura como representante "
                    f"de {principal['n_empresas_ganadoras']} empresas distintas que ganaron "
                    f"contratos del Estado en los últimos 12 meses. Patrón típico de testaferro multi-RUC."
                ),
                "norma": "Art. 50 TUO Ley 30225 — Impedimentos / Art. 11 inc. m (consorcio sin declarar)",
                "fuente_url": None,
            })
            state.setdefault("pending_flags", []).append(result)
        return result
    except Exception as e:
        return {"regla": "testaferro_multi_ruc", "triggered": False, "error": str(e)[:200]}
    finally:
        conn.close()

def check_ruc_ultra_nuevo_rule(ocid: str, tool_context: ToolContext,
                               reglas_activas: frozenset[str] | None = None,
                               topes_uit: dict | None = None) -> dict:
    """C10 — RUC ultra-nuevo: el proveedor adjudicado tiene RUC con
    `fecha_inicio_actividades` < 90 días antes de la buena pro y el monto ≥ 8 UIT
    (~S/. 41,200 con UIT 2026 = S/. 5,150). Patrón típico de empresa creada
    expressamente para ganar el contrato (puente, lavado o evasión).

    Refina `check_edad_ruc_ganador_rule` que solo dispara a > 2 años / > S/. 100K;
    esta detecta el caso más extremo y temprano.

    Norma: Art. 50 lit. d TUO Ley 30225 + Opinión OECE 056-2023 (empresa de papel).
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("ruc_ultra_nuevo", reglas)
    if om:
        return om
    state = tool_context.state
    sunat_profiles = state.get("sunat_profiles") or {}
    UIT_2026 = 5500
    UMBRAL = 8 * UIT_2026  # S/ 44 000 (contrataciones menores quedan fuera de la ley)

    # Lote 1 · T11: la regla evalúa a TODOS los postores (informe 1225266: el rival
    # ER & CO tenía RNP de 10 meses y `n_evaluados: 1`). Ganador → alta; perdedor → media.
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT e.ruc, e.razon_social,
                      SUM(o.monto_ofertado) FILTER (WHERE o.ganadora) AS monto_ganado,
                      BOOL_OR(o.ganadora) AS es_ganador, c.fecha_buena_pro, c.cuantia_referencial
                 FROM postores p
                 JOIN ofertas o ON o.postor_id=p.id
                 JOIN empresas e ON e.ruc=p.empresa_ruc
                 LEFT JOIN convocatorias c ON c.ocid=p.ocid
                WHERE p.ocid=%s
                GROUP BY e.ruc, e.razon_social, c.fecha_buena_pro, c.cuantia_referencial""",
            (ocid,),
        )
        filas = cur.fetchall()
    finally:
        conn.close()

    postores: dict[str, dict] = {}
    fbp_bd, cuantia_bd = None, None
    for ruc, razon, monto, es_g, fbp, cuantia in filas:
        fbp_bd, cuantia_bd = fbp_bd or fbp, cuantia_bd or cuantia
        postores[ruc] = {"ruc": ruc, "razon_social": razon, "es_ganador": bool(es_g),
                         "monto": float(monto or 0) or None}
    # Postores del OCDS y del parser (con monto ofertado si el acta lo trae).
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    for t in ((ocds.get("tender") or {}).get("tenderers") or []):
        r = "".join(ch for ch in str((t or {}).get("id") or "") if ch.isdigit())
        if len(r) == 11 and r not in postores:
            postores[r] = {"ruc": r, "razon_social": (t or {}).get("name") or f"RUC {r}",
                           "es_ganador": False, "monto": None}
    for p in _postores_parser(state):
        r = p.get("ruc")
        if not r:
            continue
        d = postores.setdefault(r, {"ruc": r, "razon_social": p.get("razon_social") or f"RUC {r}",
                                    "es_ganador": bool(p.get("es_ganador")), "monto": None})
        if p.get("es_ganador"):
            d["es_ganador"] = True
        if d.get("monto") is None and p.get("monto"):
            d["monto"] = p["monto"]
    g_ruc, _ = _ganador_ocds(ocds)
    if g_ruc and g_ruc in postores:
        postores[g_ruc]["es_ganador"] = True
    if not postores:
        return {"regla": "ruc_ultra_nuevo", "triggered": False, "estado": "sin_dato", "motivo": "sin postores"}

    referencial = float(cuantia_bd or 0) or (_montos_ocds(ocds).get("referencial") or 0)
    adjudicado, _src = _monto_adjudicado_ocds(ocds)
    fbp = _to_date(fbp_bd) or _to_date(((ocds.get("awards") or [{}])[0] or {}).get("date")) or _dt.date.today()

    triggered_list = []
    n_evaluados = 0
    for ruc, d in postores.items():
        monto_f = d.get("monto") or (adjudicado if d["es_ganador"] else None) or referencial or 0
        if monto_f < UMBRAL:
            continue
        profile = sunat_profiles.get(ruc) or {}
        fecha_inicio = profile.get("fecha_inicio_actividades")
        if not fecha_inicio:
            continue
        d_inicio = _to_date(fecha_inicio)
        if not d_inicio:
            continue
        n_evaluados += 1
        edad_dias_a_bp = (fbp - d_inicio).days
        if 0 <= edad_dias_a_bp < 90:
            triggered_list.append({
                "ruc": ruc, "razon_social": d["razon_social"], "es_ganador": d["es_ganador"],
                "monto": monto_f, "edad_dias_a_buena_pro": edad_dias_a_bp,
                "fecha_inicio_ruc": str(fecha_inicio), "fecha_buena_pro": str(fbp),
            })

    triggered_list.sort(key=lambda x: (not x["es_ganador"], x["edad_dias_a_buena_pro"]))
    result = {"regla": "ruc_ultra_nuevo", "n_postores": len(postores), "n_evaluados": n_evaluados,
              "n_triggered": len(triggered_list), "detalle": triggered_list,
              "triggered": len(triggered_list) > 0}
    if triggered_list:
        p = triggered_list[0]
        norma = _norma_state(state)
        if p["es_ganador"]:
            sev = "alta"
            ev = (f"{p['razon_social']} (RUC {p['ruc']}), adjudicatario, tenía {p['edad_dias_a_buena_pro']} días "
                  f"desde el alta del RUC a la fecha de la buena pro ({p['fecha_buena_pro']}); monto S/ "
                  f"{(p.get('monto') or 0):,.2f}. Señal de riesgo: empresa constituida en la ventana de 90 días "
                  f"previa a la adjudicación.")
        else:
            sev = "media"
            ev = (f"El postor no ganador {p['razon_social']} (RUC {p['ruc']}) tenía {p['edad_dias_a_buena_pro']} "
                  f"días desde el alta del RUC a la fecha de la buena pro ({p['fecha_buena_pro']}). Señal de "
                  f"riesgo de competencia aparente (postor de acompañamiento); requiere verificación.")
        result.update({
            "severidad": sev, "evidencia": ev,
            "norma": norma["impedimentos"] + " + Opinión OECE 056-2023",
            "fuente_url": f"https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc={p['ruc']}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result

def check_postor_unico_mayoritario_rule(ocid: str, tool_context: ToolContext,
                                        reglas_activas: frozenset[str] | None = None,
                                        topes_uit: dict | None = None) -> dict:
    """C11 — Postor único en ≥70% de ítems (refina C2). `check_unique_bidder_rule`
    solo dispara si 100% de ítems tienen 1 postor; esta detecta el caso donde
    HAY varios postores nominales pero la mayoría de ítems se adjudicó sin
    competencia efectiva (postores que solo concursaron por 1 ítem cada uno).

    Norma: Art. 2 TUO Ley 30225 — Principio de Competencia Efectiva.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("postor_unico_mayoritario", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT i.numero_item, COUNT(DISTINCT o.postor_id) AS n_postores
                 FROM convocatoria_items i
                 LEFT JOIN ofertas o ON o.item_id = i.id
                WHERE i.ocid = %s
                GROUP BY i.numero_item""",
            (ocid,),
        )
        items = cur.fetchall()
        if not items:
            return {"regla": "postor_unico_mayoritario", "triggered": False,
                    "motivo": "sin items en BD"}

        n_total = len(items)
        n_unicos = sum(1 for _, n in items if (n or 0) == 1)
        pct = (n_unicos / n_total) * 100 if n_total else 0

        result = {"regla": "postor_unico_mayoritario",
                  "n_items": n_total, "n_items_un_solo_postor": n_unicos,
                  "pct_items_sin_competencia": round(pct, 1),
                  "triggered": pct >= 70 and n_unicos < n_total}
        if result["triggered"]:
            result.update({
                "severidad": "alta",
                "evidencia": (
                    f"{n_unicos} de {n_total} ítems ({pct:.0f}%) fueron adjudicados con "
                    f"UN solo postor admitido. Aunque el proceso global registra varios postores, "
                    f"la mayoría de ítems se otorgaron sin competencia efectiva — patrón de "
                    f"segmentación que evade la regla del 100%."
                ),
                "norma": _norma_state(tool_context.state)["competencia"],
                "fuente_url": None,
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
        if base:
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
        _prio = ["objeto_no_corresponde_documento", "extraccion_documento_fallida",
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

def evaluate_normative_compliance(ocid: str, tool_context: ToolContext) -> dict:
    """Cruza TODAS las banderas detectadas (compliance + parser + market + person)
    contra el RAG legal de 723 opiniones OECE. Para cada bandera, devuelve la
    opinión OECE más relevante (num_opinion, link, snippet, score). Esto es lo
    que la UI muestra en la sección 'Cumplimiento Normativo'.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con `evaluaciones`: lista de {bandera, opinion_oece}.
    """
    state = tool_context.state
    # Lote 1: las reglas deterministas nuevas (oferta = VR, ofertas agrupadas, única oferta
    # válida, ganador no invitado, firmante con empresa RNP, ampliación denegada, postores
    # vinculados, oferta más barata no gana, fechas incoherentes) corren aquí, ANTES del
    # cruce RAG y de `persist_alert_from_flags`, porque el driver invoca esta función en
    # todos los perfiles. Idempotente (una vez por corrida).
    try:
        run_reglas_lote1(ocid, tool_context)
    except Exception as _e:  # nunca tumbar el cruce normativo por una regla nueva
        state.setdefault("descartes", []).append({"donde": "run_reglas_lote1", "motivos": [str(_e)[:160]]})
    # Acumular hallazgos de todas las fuentes
    hallazgos: list[dict] = []

    # 1) Banderas duras del compliance (pending_flags). Solo las que superan la
    #    verificación determinista: una bandera con RUC/monto no respaldado no debe
    #    "fundamentarse" con una opinión OECE (auditoría #3).
    for b in state.get("pending_flags") or []:
        if not isinstance(b, dict):
            continue
        ver = b.get("verificacion")
        if not isinstance(ver, dict):
            try:
                ver = _verify.verificar_bandera(b, state)
            except Exception:
                ver = {"ok": True}
        if ver.get("ok") is False:
            continue
        hallazgos.append({
            "fuente": "compliance_rule",
            "titulo": b.get("regla", "regla"),
            "descripcion": b.get("evidencia", ""),
            "severidad": b.get("severidad", "media"),
        })

    # 2) Red flags documentales: emitidos por document_legal_analyst_agent
    #    (fallback al campo legacy del document_analysis si todavía lo trae)
    legal = _safe_parse_json(state.get("legal_analysis"))
    red_flags_doc = (legal or {}).get("red_flags_documentales") or []
    if not red_flags_doc:
        doc = _safe_parse_json(state.get("document_analysis"))
        red_flags_doc = (doc or {}).get("red_flags_documentales") or []
    for f in red_flags_doc:
        if isinstance(f, dict):
            hallazgos.append({
                "fuente": "legal_analyst_red_flag",
                "titulo": (f.get("descripcion") or "")[:80],
                "descripcion": f.get("descripcion", ""),
                "severidad": f.get("severidad", "media"),
            })
        elif isinstance(f, str):
            hallazgos.append({
                "fuente": "legal_analyst_red_flag",
                "titulo": f[:80],
                "descripcion": f,
                "severidad": "media",
            })

    # 3) Hallazgos de market_price (spec restrictiva, sobreprecio)
    mk = _safe_parse_json(state.get("market_analysis"))
    for finding in (mk or {}).get("findings") or []:
        if finding.get("spec_restrictiva"):
            hallazgos.append({
                "fuente": "market_spec_restrictiva",
                "titulo": "Especificación restrictiva",
                "descripcion": finding.get("spec_restrictiva", ""),
                "severidad": "alta",
            })
        if finding.get("veredicto") in ("elevado", "muy_elevado"):
            hallazgos.append({
                "fuente": "market_sobreprecio",
                "titulo": f"Sobreprecio ítem {finding.get('item_numero')}",
                "descripcion": (finding.get("comentario") or "")[:300],
                "severidad": "alta" if finding.get("veredicto") == "muy_elevado" else "media",
            })

    # 4) Cruce firmantes ↔ ganador
    pn = _safe_parse_json(state.get("person_network"))
    for c in (pn or {}).get("cruce_firmantes_ganador") or []:
        if c.get("tipo_relacion") and c.get("tipo_relacion") != "sin_relacion":
            hallazgos.append({
                "fuente": "person_cruce",
                "titulo": f"Vínculo firmante↔ganador: {c.get('tipo_relacion')}",
                "descripcion": c.get("evidencia", ""),
                "severidad": c.get("severidad", "media"),
            })

    # Dedupe (misma fuente+título) y prioridad por severidad. Ya NO se corta a 10:
    # el tope es RAG_MAX_HALLAZGOS (default 60) y, si se supera, el recorte queda
    # registrado en state['recortes'] (auditoría 6.1-4).
    _vistos: set = set()
    _dedup: list[dict] = []
    for h in hallazgos:
        k = (h.get("fuente"), (h.get("titulo") or "")[:80], (h.get("descripcion") or "")[:120])
        if k in _vistos:
            continue
        _vistos.add(k)
        _dedup.append(h)
    _sev = {"alta": 0, "media": 1, "baja": 2}
    _dedup.sort(key=lambda h: _sev.get(str(h.get("severidad")), 3))
    _max = int(os.getenv("RAG_MAX_HALLAZGOS", "60"))
    if len(_dedup) > _max:
        state.setdefault("recortes", []).append({
            "donde": "evaluate_normative_compliance", "limite": _max,
            "omitido": len(_dedup) - _max,
            "detalle": "hallazgos de menor severidad sin cruce RAG"})
    hallazgos = _dedup[:_max]

    # Lote 1 · T3: una opinión OECE solo se adjunta si supera el umbral (`RAG_MIN_SCORE`,
    # default 0.7, cuando el backend expone score) Y trata del mismo tema (raíces en común
    # entre el hallazgo y el snippet; sin opiniones de obra para bienes/servicios). Antes
    # se pegaba `matches[0]` sin filtro: opiniones de metrados de obra, compras corporativas
    # o penalidades colgadas de banderas de objeto/cuantía (1225030, 1225058, 1225062, 1225256).
    perfil_nombre = str(((state.get("perfil") or {}).get("nombre")) or state.get("pipeline_profile") or "").lower()
    norma = _norma_state(state)
    evaluaciones = []
    for h in hallazgos:
        question = f"{h['titulo']}: {h['descripcion']}"
        opinion, motivo = None, None
        try:
            rag_resp = query_legal_rag(question, tool_context)
            matches = rag_resp.get("matches") or []
            opinion, motivo = _elegir_opinion_pertinente(h, matches, perfil_nombre, norma)
        except Exception as _e:
            motivo = f"rag_error:{str(_e)[:80]}"
        evaluaciones.append({
            "hallazgo": h,
            "opinion_oece": opinion,
            "motivo_sin_opinion": motivo if opinion is None else None,
        })

    out = {
        "ocid": ocid,
        "n_hallazgos_evaluados": len(evaluaciones),
        "n_hallazgos_totales": len(_dedup),
        "truncado": len(_dedup) > _max,
        "regimen": norma["regimen"],
        "evaluaciones": evaluaciones,
    }
    tool_context.state["normative_compliance"] = out
    return out


_RAG_STOP_TEMA = {"opinion", "consulta", "entidad", "entidades", "contratista", "proveedor", "proveedores",
                  "contrato", "contratos", "ley", "reglamento", "articulo", "norma", "normativa", "caso",
                  "supuesto", "procedimiento", "proceso", "seleccion", "postor", "postores", "oferta", "ofertas",
                  "monto", "montos", "valor", "valores", "referencial", "publica", "publico", "estado", "puede",
                  "debe", "corresponde", "aplica", "aplicacion", "conforme", "respecto", "dicha", "dicho"}
_TERMINOS_OBRA = ("metrado", "valorizacion", "valorizaciones", "adicional de obra", "expediente tecnico",
                  "residente", "supervisor de obra", "liquidacion de obra", "obra")


def _elegir_opinion_pertinente(h: dict, matches: list, perfil_nombre: str, norma: dict) -> tuple[dict | None, str | None]:
    """Primera opinión OECE que supere el umbral de score (si lo hay) y comparta tema con el
    hallazgo. Devuelve (opinion|None, motivo_si_none)."""
    if not matches:
        return None, "sin_matches"
    min_score = float(os.getenv("RAG_MIN_SCORE", "0.7") or 0.7)
    txt_h = _sin_tildes(f"{h.get('titulo') or ''} {h.get('descripcion') or ''}").lower()
    tok_h = {t for t in _tokens_raiz(txt_h) if t not in _RAG_STOP_TEMA}
    motivos = []
    for m in matches:
        if not isinstance(m, dict):
            continue
        sc = m.get("score")
        if isinstance(sc, (int, float)) and sc < min_score:
            motivos.append(f"score {sc:.2f} < {min_score}")
            continue
        snippet = _sin_tildes(" ".join(str(m.get(k) or "") for k in
                                       ("interpretacion_snippet", "snippet", "texto", "titulo", "tema"))).lower()
        tok_m = {t for t in _tokens_raiz(snippet) if t not in _RAG_STOP_TEMA}
        comunes = {a for a in tok_h for b in tok_m if _misma_raiz(a, b)}
        if len(comunes) < 2:
            motivos.append(f"tema no afín (raíces comunes: {len(comunes)})")
            continue
        if perfil_nombre in ("bienes", "servicios") and "obra" not in txt_h and \
                sum(1 for t in _TERMINOS_OBRA if t in snippet) >= 2:
            motivos.append("opinión sobre obras para un proceso de bienes/servicios")
            continue
        # Preferir opiniones del régimen aplicable si la opinión declara norma.
        nm = _sin_tildes(str(m.get("norma") or "")).lower()
        if norma.get("regimen") == "ley_32069" and "30225" in nm and "32069" not in nm:
            m = {**m, "_regimen_distinto": True}
        return m, None
    return None, "; ".join(motivos[:3]) or "sin opinión pertinente"


# ─── Reglas nuevas por perfil (WS V · Task V3) ─────────────────────────────

def check_adicional_acumulado_rule(ocid: str, tool_context: ToolContext,
                                   reglas_activas: frozenset[str] | None = None,
                                   topes_uit: dict | None = None) -> dict:
    """OBRAS — adicionales acumulados. Fuentes (en orden): bloque `obra.adicionales[]`
    del parser (pct_acumulado o montos vs presupuesto), `contracts[].value` vs
    `awards[].value` del OCDS (el contrato vigente supera lo adjudicado) y docs
    `contractAmendment`/`contracts[].amendments[]`. MEDIA si el acumulado supera
    15 % (tope sin autorización) y ALTA si supera 50 % (tope máximo con CGR). Si
    solo hay enmiendas sin monto → `estado: no_verificable` (sin bandera).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, pct_acumulado, fuente, n_adendas, severidad, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("adicional_acumulado", reglas)
    if om:
        return om
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    raw = state.get("parser_raw_consolidated") or {}
    obra = (raw.get("obra") if isinstance(raw, dict) else None) or {}
    pct, fuente, detalle = None, None, {}

    adicionales = obra.get("adicionales") or []
    if isinstance(adicionales, list) and adicionales:
        pcts = [a.get("pct_acumulado") for a in adicionales if isinstance(a, dict)
                and isinstance(a.get("pct_acumulado"), (int, float))]
        montos = [float(a.get("monto") or 0) for a in adicionales if isinstance(a, dict)]
        presupuesto = ((obra.get("expediente_tecnico") or {}).get("presupuesto_total")
                       or obra.get("presupuesto_total"))
        if pcts:
            pct, fuente = float(max(pcts)), "parser_obra_adicionales"
        elif montos and presupuesto:
            try:
                pct, fuente = sum(montos) / float(presupuesto) * 100, "parser_obra_adicionales"
            except (TypeError, ValueError, ZeroDivisionError):
                pct = None
        detalle = {"n_adicionales": len(adicionales),
                   "resoluciones": [a.get("resolucion") for a in adicionales if isinstance(a, dict)][:5]}

    if pct is None:
        adj = sum(float(((a.get("value") or {}).get("amount")) or 0)
                  for a in (ocds.get("awards") or []) if isinstance(a, dict))
        con = sum(float(((c.get("value") or {}).get("amount")) or 0)
                  for c in (ocds.get("contracts") or []) if isinstance(c, dict))
        if adj > 0 and con > 0 and con > adj:
            pct, fuente = (con - adj) / adj * 100, "ocds_contract_vs_award"
            detalle = {"monto_adjudicado": adj, "monto_contrato": con}

    n_amend_docs = 0
    for c in (ocds.get("contracts") or []):
        if not isinstance(c, dict):
            continue
        n_amend_docs += len(c.get("amendments") or [])
        n_amend_docs += sum(1 for d in (c.get("documents") or [])
                            if isinstance(d, dict) and str(d.get("documentType") or "").lower() == "contractamendment")
    result = {"regla": "adicional_acumulado", "pct_acumulado": round(pct, 1) if pct is not None else None,
              "fuente": fuente, "n_adendas_ocds": n_amend_docs, "detalle": detalle,
              "estado": "hallado" if pct is not None else ("no_verificable" if n_amend_docs else "sin_dato"),
              "triggered": False}
    if pct is not None and pct > 15:
        sev = "alta" if pct > 50 else "media"
        result.update({
            "triggered": True, "severidad": sev,
            "evidencia": (f"Adicionales de obra acumulados: {pct:.1f}% del monto contractual "
                          f"(fuente: {fuente}; {n_amend_docs} adenda(s) en el OCDS). "
                          + ("Supera el 50% máximo autorizable." if pct > 50 else
                             "Supera el 15% que la entidad puede aprobar sin autorización previa de la CGR.")),
            "norma": "Art. 34 TUO Ley 30225 / Art. 205 Reglamento — prestaciones adicionales de obra (15% / 50%)",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result


def check_personal_clave_vinculado_rule(ocid: str, tool_context: ToolContext,
                                        reglas_activas: frozenset[str] | None = None,
                                        topes_uit: dict | None = None) -> dict:
    """SERVICIOS — personal clave del TDR/propuesta (bloque `servicio.personal_clave[]`
    del parser) que coincide por nombre normalizado con firmantes/comité de la
    entidad o con funcionarios designados (entity_personnel). Si el bloque no trae
    nombres (solo perfiles exigidos) → `estado: sin_dato`.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, coincidencias[], severidad, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("personal_clave_vinculado", reglas)
    if om:
        return om
    state = tool_context.state
    raw = state.get("parser_raw_consolidated") or {}
    servicio = (raw.get("servicio") if isinstance(raw, dict) else None) or {}
    personal = [p for p in (servicio.get("personal_clave") or []) if isinstance(p, dict)]
    con_nombre = [(p, _normalize_persona(p.get("nombre") or p.get("nombre_completo") or ""))
                  for p in personal]
    con_nombre = [(p, n) for p, n in con_nombre if len(n.split()) >= 2]
    if not con_nombre:
        return {"regla": "personal_clave_vinculado", "triggered": False, "estado": "sin_dato",
                "n_personal_clave": len(personal),
                "motivo": "el bloque de personal clave no trae nombres (solo perfiles exigidos)"}

    doc = _safe_parse_json(state.get("document_analysis")) or {}
    candidatos: list[tuple[str, str, str]] = []   # (nombre_norm, rol, origen)
    for k in ("firmantes", "firmantes_consolidados", "comite_evaluacion"):
        for f in (doc.get(k) or (raw.get(k) if isinstance(raw, dict) else None) or []):
            if isinstance(f, dict):
                n = _normalize_persona(f.get("nombre") or f.get("nombre_completo") or "")
                if n:
                    candidatos.append((n, f.get("cargo") or k, "documento"))
    ep = _safe_parse_json(state.get("entity_personnel")) or {}
    for f in (ep.get("funcionarios_designados") or ep.get("funcionarios") or []):
        if isinstance(f, dict):
            n = _normalize_persona(f.get("nombre") or f.get("nombre_completo") or "")
            if n and (f.get("fuente_url") or f.get("fuente") or f.get("url")):
                candidatos.append((n, f.get("cargo") or "funcionario", "entity_personnel"))

    coincidencias = []
    for p, n in con_nombre:
        toks = set(n.split())
        for cn, rol, origen in candidatos:
            ctoks = set(cn.split())
            # Coincidencia exacta o de ≥3 tokens (dos apellidos + nombre): nunca por un apellido solo.
            if n == cn or len(toks & ctoks) >= 3:
                coincidencias.append({"personal_clave": p.get("nombre") or p.get("nombre_completo"),
                                      "cargo_propuesto": p.get("cargo"), "coincide_con": cn,
                                      "rol_en_entidad": rol, "origen": origen})
    result = {"regla": "personal_clave_vinculado", "n_personal_clave": len(personal),
              "coincidencias": coincidencias[:5], "estado": "hallado" if coincidencias else "sin_dato",
              "triggered": bool(coincidencias)}
    if coincidencias:
        c0 = coincidencias[0]
        result.update({
            "severidad": "alta",
            "evidencia": (f"El personal clave propuesto '{c0['personal_clave']}' ({c0['cargo_propuesto']}) "
                          f"coincide con '{c0['coincide_con']}' ({c0['rol_en_entidad']}) de la entidad "
                          f"contratante según {c0['origen']}."),
            "norma": "Art. 11 TUO Ley 30225 — impedimentos; Ley 27588 — incompatibilidades de funcionarios",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result


def check_fraccionamiento_rule(ocid: str, tool_context: ToolContext,
                               reglas_activas: frozenset[str] | None = None,
                               topes_uit: dict | None = None) -> dict:
    """Fraccionamiento: misma entidad + mismo proveedor + objeto similar (solape de
    tokens ≥ 0.5) en una ventana de ±90 días, contando en `convocatorias` (BD propia).
    MEDIA; ALTA si además la suma de los procesos supera el tope de la modalidad
    usada (p. ej. varias CP que juntas exceden 15 UIT).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, procesos_relacionados[], severidad, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("fraccionamiento", reglas)
    if om:
        return om
    topes = _perfil_topes(tool_context, topes_uit)
    state = tool_context.state
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT entidad_ruc, objeto, fecha_convocatoria, cuantia_referencial, tipo_proceso "
                    "FROM convocatorias WHERE ocid=%s", (ocid,))
        row = cur.fetchone()
        if not row or not row[0] or not row[2]:
            return {"regla": "fraccionamiento", "triggered": False, "estado": "sin_dato",
                    "motivo": "convocatoria sin entidad/fecha en BD"}
        entidad_ruc, objeto, fecha, cuantia, tipo = row
        prov_ruc, prov_nombre = _ganador_ruc(ocid, state, cur)
        if not prov_ruc:
            return {"regla": "fraccionamiento", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin proveedor adjudicado identificable"}
        cur.execute(
            """SELECT DISTINCT c.ocid, c.objeto, c.fecha_convocatoria, c.cuantia_referencial, c.tipo_proceso
                 FROM convocatorias c
                 LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                 LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                WHERE c.ocid<>%s AND c.entidad_ruc=%s
                  AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)
                  AND c.fecha_convocatoria BETWEEN %s::date - INTERVAL '90 days' AND %s::date + INTERVAL '90 days'""",
            (prov_ruc, ocid, entidad_ruc, prov_ruc, fecha, fecha))
        rows = cur.fetchall()
    finally:
        conn.close()

    base = _tokens_objeto(objeto or "")
    relacionados = []
    for r in rows:
        toks = _tokens_objeto(r[1] or "")
        if not base or not toks:
            continue
        sim = len(base & toks) / len(base | toks)
        if sim >= 0.5:
            relacionados.append({"ocid": r[0], "objeto": (r[1] or "")[:120],
                                 "fecha": str(r[2])[:10], "cuantia": float(r[3] or 0),
                                 "tipo_proceso": r[4], "similitud": round(sim, 2)})
    result = {"regla": "fraccionamiento", "proveedor_ruc": prov_ruc,
              "procesos_relacionados": relacionados[:10], "estado": "hallado" if relacionados else "sin_dato",
              "_nota_alcance": "Conteos sobre procesos ingestados en la base de Vigía.", "triggered": False}
    if relacionados:
        suma = float(cuantia or 0) + sum(r["cuantia"] for r in relacionados)
        UIT = _tope(topes, _TOPES_DEFAULT["uit_soles"], "uit_soles", "uit")
        tipo_u = (tipo or "").upper()
        tope = None
        if "COMPARACION" in tipo_u or "CP-" in tipo_u:
            tope = _tope(topes, _TOPES_DEFAULT["comparacion_precios_max"], "comparacion_precios_max", "comparacion_precios")
        elif "ADJUDICACION SIMPLIFICADA" in tipo_u or "AS-" in tipo_u:
            tope = _tope(topes, _TOPES_DEFAULT["adjudicacion_simplificada_max"],
                         "adjudicacion_simplificada_max", "adjudicacion_simplificada", "licitacion_publica")
        elif "DIRECTA" in tipo_u or "MENOR" in tipo_u:
            tope = 8.0
        excede = tope is not None and (suma / UIT) > tope
        result.update({
            "triggered": True, "severidad": "alta" if excede else "media",
            "suma_soles": round(suma, 2), "suma_uit": round(suma / UIT, 1), "tope_uit_modalidad": tope,
            "evidencia": (f"{prov_nombre or 'El proveedor'} (RUC {prov_ruc}) obtuvo {len(relacionados)} proceso(s) "
                          f"adicional(es) de objeto similar con la misma entidad en ±90 días "
                          f"({', '.join(r['ocid'] for r in relacionados[:4])}); suma S/ {suma:,.2f} "
                          f"({suma / UIT:.1f} UIT)"
                          + (f", por encima del tope de {tope:g} UIT de la modalidad '{tipo}'." if excede else ".")),
            "norma": "Art. 20 TUO Ley 30225 / Art. 36 Ley 32069 — prohibición de fraccionamiento",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result


def check_directa_recurrente_rule(ocid: str, tool_context: ToolContext,
                                  reglas_activas: frozenset[str] | None = None,
                                  topes_uit: dict | None = None) -> dict:
    """OTROS — proveedor con ≥ 3 contrataciones directas (cualquier entidad) en los 12
    meses previos a la convocatoria, contadas en `convocatorias` (BD propia). MEDIA.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, n_directas_12m, procesos[], severidad, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("directa_recurrente", reglas)
    if om:
        return om
    state = tool_context.state
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT fecha_convocatoria, tipo_proceso FROM convocatorias WHERE ocid=%s", (ocid,))
        row = cur.fetchone()
        fecha = (row and row[0]) or None
        prov_ruc, prov_nombre = _ganador_ruc(ocid, state, cur)
        if not prov_ruc:
            return {"regla": "directa_recurrente", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin proveedor adjudicado identificable"}
        if fecha:
            cur.execute(
                """SELECT DISTINCT c.ocid, c.entidad_ruc, c.fecha_convocatoria, c.cuantia_referencial
                     FROM convocatorias c
                     LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                     LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                    WHERE c.ocid<>%s AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)
                      AND UPPER(COALESCE(c.tipo_proceso,'')) LIKE '%%DIRECTA%%'
                      AND c.fecha_convocatoria BETWEEN %s::date - INTERVAL '12 months' AND %s::date""",
                (prov_ruc, ocid, prov_ruc, fecha, fecha))
        else:
            cur.execute(
                """SELECT DISTINCT c.ocid, c.entidad_ruc, c.fecha_convocatoria, c.cuantia_referencial
                     FROM convocatorias c
                     LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                     LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                    WHERE c.ocid<>%s AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)
                      AND UPPER(COALESCE(c.tipo_proceso,'')) LIKE '%%DIRECTA%%'
                      AND c.fecha_convocatoria >= NOW() - INTERVAL '12 months'""",
                (prov_ruc, ocid, prov_ruc))
        rows = cur.fetchall()
    finally:
        conn.close()
    procesos = [{"ocid": r[0], "entidad_ruc": r[1], "fecha": str(r[2])[:10], "cuantia": float(r[3] or 0)}
                for r in rows]
    result = {"regla": "directa_recurrente", "proveedor_ruc": prov_ruc, "n_directas_12m": len(procesos),
              "procesos": procesos[:10], "estado": "hallado" if procesos else "sin_dato",
              "_nota_alcance": "Conteos sobre procesos ingestados en la base de Vigía.", "triggered": False}
    if len(procesos) >= 3:
        result.update({
            "triggered": True, "severidad": "media",
            "evidencia": (f"{prov_nombre or 'El proveedor'} (RUC {prov_ruc}) acumula {len(procesos)} contrataciones "
                          f"directas en los 12 meses previos ({', '.join(p['ocid'] for p in procesos[:4])}), "
                          f"además de la presente. Recurrencia en procedimientos no competitivos."),
            "norma": "Art. 27 TUO Ley 30225 / Art. 55 Ley 32069 — carácter excepcional de la contratación directa",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result

def check_lobby_visits_rule(ocid: str, tool_context: ToolContext,
                            reglas_activas: frozenset[str] | None = None,
                            topes_uit: dict | None = None) -> dict:
    """Evalúa lobby pre-convocatoria — socios/representantes del ganador o
    de cualquier postor que visitaron a la ENTIDAD CONTRATANTE en los 180 días
    previos a la fecha de convocatoria.

    Cruza `visitas_entidades` × `rnp_conformacion_juridica` × `convocatorias`.
    Fuente: Registro Único de Visitas (Ley 28024 — Gestión de Intereses).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        dict con triggered, evidencia, visitas[], severidad.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("lobby_visits_pre_convocatoria", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        if not _table_exists(cur, "visitas_entidades"):
            return {"regla": "lobby_visits_pre_convocatoria", "triggered": False,
                    "dataset_no_disponible": True,
                    "hint": "Cargar dataset visitas con backend/scripts/load_visitas_entidades.py"}

        cur.execute(
            """SELECT v.visitante, v.numero_documento, r.tipo_rol,
                      emp.razon_social, emp.ruc,
                      v.funcionario_nombre, v.funcionario_cargo,
                      v.fecha_visita, v.motivo, v.duracion_min,
                      c.fecha_convocatoria, e.nombre AS entidad_nombre,
                      o.ganadora
                 FROM convocatorias c
                 JOIN entidades  e   ON e.ruc = c.entidad_ruc
                 JOIN postores   p   ON p.ocid = c.ocid
                 JOIN ofertas    o   ON o.postor_id = p.id
                 JOIN empresas   emp ON emp.ruc = p.empresa_ruc
                 JOIN rnp_conformacion_juridica r ON r.ruc_empresa = emp.ruc
                 JOIN visitas_entidades v
                      ON v.numero_documento = r.numero_documento
                     AND v.entidad_visitada_norm = UPPER(unaccent(e.nombre))
                     AND c.fecha_convocatoria IS NOT NULL
                     AND v.fecha_visita BETWEEN
                           (c.fecha_convocatoria - INTERVAL '180 days')
                       AND  c.fecha_convocatoria
                WHERE c.ocid = %s
                ORDER BY o.ganadora DESC, v.fecha_visita""",
            (ocid,),
        )
        rows = cur.fetchall()
        visitas = [
            {
                "visitante": r[0], "dni": r[1], "rol_en_empresa": r[2],
                "empresa_postora": r[3], "ruc_empresa": r[4],
                "funcionario_visitado": r[5], "cargo_funcionario": r[6],
                "fecha_visita": r[7].isoformat() if r[7] else None,
                "motivo": r[8], "duracion_min": r[9],
                "fecha_convocatoria": r[10].isoformat() if r[10] else None,
                "entidad_contratante": r[11],
                "empresa_ganadora": bool(r[12]),
            }
            for r in rows
        ]
        ganadoras = [v for v in visitas if v["empresa_ganadora"]]
        result = {
            "regla": "lobby_visits_pre_convocatoria",
            "triggered": bool(visitas),
            "n_visitas_total": len(visitas),
            "n_visitas_de_ganador": len(ganadoras),
            "visitas": visitas[:25],
            "fuente_url": "https://www.gob.pe/registro-visitas",
        }
        if ganadoras:
            v0 = ganadoras[0]
            result.update({
                "severidad": "alta",
                "evidencia": (
                    f"{v0['empresa_postora']} (RUC {v0['ruc_empresa']}) — su "
                    f"{v0['rol_en_empresa']} {v0['visitante']} visitó al funcionario "
                    f"{v0['funcionario_visitado']} ({v0['cargo_funcionario']}) "
                    f"el {v0['fecha_visita']} en {v0['entidad_contratante']}, antes de "
                    f"la convocatoria del {v0['fecha_convocatoria']}. Esta empresa fue "
                    f"declarada ganadora."
                ),
                "norma": "Ley 28024 (Gestión de Intereses) — registro de visitas obligatorio para detectar lobby.",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        elif visitas:
            result["severidad"] = "media"
            result["evidencia"] = (
                f"{len(visitas)} visitas de socios/representantes de POSTORES (no ganador) "
                f"a la entidad contratante en los 180 días previos a la convocatoria."
            )
        return result
    finally:
        conn.close()

def detect_estado_real(ocid: str, tool_context: ToolContext) -> dict:
    """Detecta el estado REAL de una convocatoria cruzando OCDS contra los
    documentos del expediente. Sirve para identificar inconsistencias del tipo:
    'hay archivo de Buena Pro pero el OCDS dice convocatoria abierta'.

    Args:
        ocid: OCID OCDS (ej. 'ocds-dgv273-seacev3-1185504') o codigo corto.

    Returns:
        dict con:
          · estado_ocds: 'convocatoria_abierta' | 'adjudicada' | 'contrato_firmado' | 'desconocido'
          · estado_documentos: 'convocatoria' | 'buena_pro' | 'contrato' | 'cancelada'
          · estado_inconsistente: bool — true si OCDS y documentos no coinciden
          · n_postores_oferentes: int
          · n_awards: int
          · n_contracts: int
          · documentos_clave: lista de docs que sugieren estado (buena_pro, contrato, etc.)
          · evidencia: descripción human-readable
    """
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}

    # Si no tenemos OCDS, fallback a Cloud SQL
    if not ocds:
        conn = None
        try:
            conn = _pg()
            cur = conn.cursor()
            cur.execute("SELECT ocds_payload FROM convocatorias WHERE ocid = %s OR ocid LIKE %s LIMIT 1",
                        (ocid, f"%{ocid}"))
            row = cur.fetchone()
            if row and row[0]:
                ocds = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        except Exception as e:
            return {"error": f"no_ocds_disponible: {e}"}
        finally:
            if conn:
                conn.close()

    tender = ocds.get("tender") or {}
    awards = ocds.get("awards") or []
    contracts = ocds.get("contracts") or []
    documents = (tender.get("documents") or []) + sum(
        ((c.get("documents") or []) for c in contracts), []
    )
    tenderers = tender.get("tenderers") or []
    n_postores = len(tenderers) or int(tender.get("numberOfTenderers") or 0)

    # Estado OCDS
    if contracts:
        estado_ocds = "contrato_firmado"
    elif awards:
        estado_ocds = "adjudicada"
    elif tender:
        estado_ocds = "convocatoria_abierta"
    else:
        estado_ocds = "desconocido"

    # Detectar estado por documentos
    documentos_clave = []
    has_buena_pro = False
    has_contrato_doc = False
    has_cancelacion = False
    for d in documents:
        title = (d.get("title") or "").lower()
        dtype = (d.get("documentType") or "").lower()
        if (("buena" in title and "pro" in title) or
            "otorgamiento" in title or
            "awardnotice" in dtype):
            has_buena_pro = True
            documentos_clave.append({"tipo": "buena_pro", "titulo": d.get("title"), "fecha": d.get("datePublished"), "url": d.get("url")})
        elif ("contrato" in title and ("firmado" in title or "suscrito" in title)) or \
             "contractsigned" in dtype:
            has_contrato_doc = True
            documentos_clave.append({"tipo": "contrato_firmado", "titulo": d.get("title"), "fecha": d.get("datePublished"), "url": d.get("url")})
        elif "nulidad" in title or "cancelacion" in title or "cancelación" in title or "desierta" in title:
            has_cancelacion = True
            documentos_clave.append({"tipo": "cancelada", "titulo": d.get("title"), "fecha": d.get("datePublished"), "url": d.get("url")})

    if has_cancelacion:
        estado_documentos = "cancelada"
    elif has_contrato_doc:
        estado_documentos = "contrato"
    elif has_buena_pro:
        estado_documentos = "buena_pro"
    else:
        estado_documentos = "convocatoria"

    # Inconsistencia: OCDS dice convocatoria_abierta pero hay buena pro/contrato en docs
    estado_inconsistente = (
        (estado_ocds == "convocatoria_abierta" and estado_documentos in ("buena_pro", "contrato"))
        or
        (estado_ocds == "adjudicada" and estado_documentos == "contrato" and not contracts)
    )

    evidencia = (
        f"OCDS={estado_ocds} ({len(awards)} awards, {len(contracts)} contratos); "
        f"docs sugieren={estado_documentos}; postores={n_postores}; "
        f"docs_clave={len(documentos_clave)}"
    )
    if estado_inconsistente:
        evidencia += " · ⚠ INCONSISTENCIA: documentos publicados son posteriores al estado OCDS."

    return {
        "estado_ocds": estado_ocds,
        "estado_documentos": estado_documentos,
        "estado_inconsistente": estado_inconsistente,
        "n_postores_oferentes": n_postores,
        "n_awards": len(awards),
        "n_contracts": len(contracts),
        "documentos_clave": documentos_clave[:5],
        "evidencia": evidencia,
    }

def analyze_postores_pattern(ocid: str, tool_context: ToolContext) -> dict:
    """Analiza patrones sospechosos entre los postores que participaron en la
    convocatoria — útil cuando NO hay ganador (convocatoria abierta) o cuando
    querés evaluar si los perdedores fueron 'figurantes' de un cartel.

    Para cada postor analiza:
      · n_apariciones_base_vigia (apariciones del RUC en NUESTRA base de alertas;
        NO es su historial real en SEACE — ausencia = desconocido, no cero)
      · direccion_compartida (con otros postores del mismo proceso)
      · co_ocurrencia_en_base_vigia (OCIDs en que aparece junto a otros postores
        del proceso, SOLO dentro de los procesos ya analizados por Vigía)

    Args:
        ocid: OCID o codigo corto.

    Returns:
        dict con `postores: [{ruc, razon_social, sospechas: [...], score}]`
        + `patrones_red` (resumen agregado).
    """
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    if not ocds:
        return {"error": "no_ocds_disponible"}

    tender = ocds.get("tender") or {}
    parties = ocds.get("parties") or []
    tenderers_raw = tender.get("tenderers") or []

    # Extraer RUC + razón social de cada postor
    postores: list[dict] = []
    for t in tenderers_raw:
        pid = t.get("id") or ""
        ruc = pid.replace("PE-RUC-", "") if pid.startswith("PE-RUC-") else None
        nombre = t.get("name") or ""
        # Buscar más info en parties
        party = next((p for p in parties if p.get("id") == pid), None)
        direccion = None
        if party:
            addr = party.get("address") or {}
            direccion = ", ".join(filter(None, [
                addr.get("streetAddress"), addr.get("locality"), addr.get("region")
            ]))
        if ruc:
            postores.append({"ruc": ruc, "razon_social": nombre, "direccion": direccion})

    if not postores:
        return {"postores": [], "patrones_red": {}, "evidencia": "Sin postores en OCDS."}

    # Analizar cada postor contra Cloud SQL (RNP + alertas + convocatorias previas)
    conn = None
    try:
        conn = _pg()
        cur = conn.cursor()
        rucs = [p["ruc"] for p in postores]
        # Edad de RUC (vía SUNAT pública si la tenemos en BD; sino N/A)
        # n_otros_contratos: contar apariciones del RUC en alertas/convocatorias
        cur.execute(
            """SELECT proveedor_ruc, COUNT(*) AS n
                 FROM alertas
                WHERE proveedor_ruc = ANY(%s)
                GROUP BY proveedor_ruc""",
            (rucs,),
        )
        contratos_por_ruc = {r[0]: int(r[1]) for r in cur.fetchall()}

        # Co-ocurrencia: pares de postores que aparecen juntos en otros procesos
        # Usamos `convocatorias` o `postores` table — si no existe, omitimos.
        co_ocurrencia: dict = {}
        try:
            # Heurística: postores en común en convocatorias del proveedor adjudicado
            # (si la tabla `postores` o similar existe en BD).
            cur.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name='postores'"
            )
            cols_postores = {r[0] for r in cur.fetchall()}
            if "ocid" in cols_postores and "empresa_ruc" in cols_postores:
                # Buscar OCIDs donde participan ≥2 de los RUCs analizados, EXCLUYENDO el
                # proceso actual (lote 1 · T11: todo par del mismo proceso recibía
                # `co_ocurrencia:1` y +5 de score por co-ocurrir consigo mismo).
                _propio = {str(ocid or ""), _short_ocid(str(ocid or "")), _short_ocid(str(ocds.get("ocid") or ocid or ""))}
                cur.execute(
                    """SELECT empresa_ruc, ARRAY_AGG(DISTINCT ocid) AS ocids
                         FROM postores
                        WHERE empresa_ruc = ANY(%s)
                          AND ocid <> ALL(%s)
                        GROUP BY empresa_ruc""",
                    (rucs, sorted(_propio)),
                )
                ruc_to_ocids = {r[0]: {o for o in (r[1] or []) if _short_ocid(str(o)) not in _propio}
                                for r in cur.fetchall()}
                # Calcular intersecciones pair-wise
                for i, a in enumerate(rucs):
                    for b in rucs[i + 1:]:
                        common = ruc_to_ocids.get(a, set()) & ruc_to_ocids.get(b, set())
                        if common:
                            # Guardamos los OCIDs reales (no solo el conteo) para
                            # poder mostrarlos/linkearlos en la UI como evidencia.
                            co_ocurrencia[f"{a}↔{b}"] = sorted(common)
        except Exception:
            pass

    except Exception as e:
        contratos_por_ruc = {}
        co_ocurrencia = {}
    finally:
        if conn:
            conn.close()

    # Direcciones repetidas entre postores del mismo proceso (señal cartel)
    dir_map: dict = {}
    for p in postores:
        if p.get("direccion"):
            dir_map.setdefault(p["direccion"].lower().strip(), []).append(p["ruc"])
    direcciones_compartidas = {k: v for k, v in dir_map.items() if len(v) > 1}

    # Score y sospechas por postor.
    # ⚠ HONESTIDAD: `contratos_por_ruc` cuenta apariciones del RUC en NUESTRA
    # base de alertas (procesos ya analizados por Vigía), NO su historial real
    # en el SEACE. Una empresa ausente de nuestra base tiene historial
    # DESCONOCIDO, no cero. Por eso NO emitimos "sin_historial_contractual"
    # como bandera: sería un falso positivo contra contratistas legítimos
    # (ej. un proveedor con 20 contratos reales aparecería como "sin historial").
    for p in postores:
        sospechas = []
        score = 0
        ruc = p["ruc"]
        n_apariciones = contratos_por_ruc.get(ruc, 0)
        # Dirección compartida con otro postor del MISMO proceso (señal válida).
        if p.get("direccion") and p["direccion"].lower().strip() in direcciones_compartidas:
            sospechas.append("direccion_compartida_con_otro_postor")
            score += 35
        # Co-ocurrencia con otros postores — SOLO dentro de la base de Vigía.
        ocids_co = sorted({o for k, v in co_ocurrencia.items() if ruc in k for o in v})
        if ocids_co:
            sospechas.append(f"co_ocurrencia_en_base_vigia:{len(ocids_co)}")
            score += min(len(ocids_co) * 5, 30)

        # Informativo (no bandera): apariciones en la base de Vigía.
        p["n_apariciones_base_vigia"] = n_apariciones
        p["ocids_co_ocurrencia"] = ocids_co
        p["sospechas"] = sospechas
        p["score_sospecha"] = min(score, 100)

    # Ordenar por score descendente
    postores.sort(key=lambda x: x["score_sospecha"], reverse=True)

    # Patrones agregados
    patrones = {
        "n_postores_total": len(postores),
        "n_con_direccion_compartida": sum(1 for p in postores if any("direccion_compartida" in s for s in p["sospechas"])),
        "n_con_co_ocurrencia": sum(1 for p in postores if any(s.startswith("co_ocurrencia") for s in p["sospechas"])),
        "direcciones_repetidas": {k: v for k, v in direcciones_compartidas.items()},
        "pares_co_ocurrentes": co_ocurrencia,  # {par: [ocids]} — dentro de la base de Vigía
        "_nota_alcance": ("Conteos y co-ocurrencias son SOLO sobre procesos ya "
                          "analizados por Vigía, no el universo completo del SEACE."),
    }

    result = {
        "postores": postores[:15],  # Top 15 más sospechosos
        "patrones_red": patrones,
        "evidencia": f"Analizados {len(postores)} postores · "
                     f"{len(direcciones_compartidas)} direcciones compartidas · "
                     f"{len(co_ocurrencia)} pares con co-ocurrencia en la base de Vigía.",
    }
    # Persistir en state para que el adapter lo expose a la UI
    state["analisis_postores"] = result
    return result

def _detect_estado_real_persist(ocid: str, tool_context: ToolContext) -> dict:
    """Wrapper que persiste el resultado en state para que la UI lo lea."""
    r = detect_estado_real(ocid, tool_context)
    tool_context.state["estado_real"] = r
    return r

# ─── Reglas deterministas del lote 1 (plan 2026-09-15 · T12 + extras) ───────────
#
# Todas leen `parser_raw_consolidated` (postores[] / postores_consolidados[] / ofertas[] /
# lista_invitados[] / contrato — R4 garantiza montos; el código tolera que aún no existan
# y devuelve `sin_dato`), `state["ocds"]` y `person_network_context`. Corren en todos los
# perfiles (activas por defecto; se desactivan con `-<regla>` en `reglas_activas`).

def _vr_state(state: dict) -> float | None:
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    return _montos_ocds(ocds).get("referencial")


def _nombre_postor(p: dict) -> str:
    return (p.get("razon_social") or (f"RUC {p['ruc']}" if p.get("ruc") else "postor sin identificar"))[:80]


def _flag(state: dict, result: dict, severidad: str, evidencia: str, norma: str, fuente_url: str | None) -> dict:
    result.update({"triggered": True, "severidad": severidad, "evidencia": evidencia[:500],
                   "norma": norma, "fuente_url": fuente_url, "estado": "hallado"})
    state.setdefault("pending_flags", []).append(result)
    return result


def check_oferta_igual_valor_referencial_rule(ocid: str, tool_context: ToolContext,
                                              reglas_activas: frozenset[str] | None = None,
                                              topes_uit: dict | None = None) -> dict:
    """Una oferta (ganadora o no) coincide con el valor referencial al 0.1 %. ALTA si las
    bases declaran la cuantía reservada (1225030: oferta perdedora = VR al céntimo con
    "NO DAR A CONOCER LA CUANTÍA"); MEDIA si la cuantía era pública (1225392: ganador al
    100 % de la cuantía)."""
    om = _regla_omitida("oferta_igual_valor_referencial", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    vr = _vr_state(state)
    postores = [p for p in _postores_parser(state) if p.get("monto")]
    result = {"regla": "oferta_igual_valor_referencial", "triggered": False, "valor_referencial": vr,
              "n_ofertas_con_monto": len(postores)}
    if not vr or not postores:
        result.update({"estado": "sin_dato", "motivo": "sin valor referencial o sin montos de oferta en el expediente"})
        return result
    hits = [p for p in postores if abs(p["monto"] - vr) / vr <= 0.001]
    result["coincidencias"] = [{"postor": _nombre_postor(p), "monto": p["monto"], "es_ganador": bool(p.get("es_ganador"))}
                               for p in hits]
    if not hits:
        result["estado"] = "hallado"
        return result
    reservada = _cuantia_reservada(state)
    result["cuantia_reservada"] = reservada
    p = sorted(hits, key=lambda x: (bool(x.get("es_ganador")),))[0]
    rol = "adjudicatario" if p.get("es_ganador") else "postor no ganador"
    ev = (f"La oferta de {_nombre_postor(p)} ({rol}) fue S/ {p['monto']:,.2f}, igual al valor referencial "
          f"(S/ {vr:,.2f}) con una diferencia ≤ 0.1 %. ")
    if reservada:
        ev += ("Las bases declaran que la cuantía NO se dio a conocer: coincidir al céntimo con un valor "
               "reservado es una señal de riesgo de filtración del estudio de mercado u oferta de "
               "acompañamiento; requiere verificación.")
        sev = "alta"
    else:
        ev += ("La cuantía era pública; ofertar exactamente el referencial es una señal de riesgo de "
               "competencia aparente (precio ancla), no una irregularidad por sí sola.")
        sev = "media"
    if len(hits) > 1:
        ev += f" Otras ofertas iguales al referencial: {len(hits) - 1}."
    return _flag(state, result, sev, ev, _norma_state(state)["integridad"],
                 f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}")


def check_ofertas_agrupadas_rule(ocid: str, tool_context: ToolContext,
                                 reglas_activas: frozenset[str] | None = None,
                                 topes_uit: dict | None = None) -> dict:
    """≥ 3 ofertas válidas con dispersión (max−min)/mediana < 1 % → MEDIA (1225266: 99 180 /
    99 270 / 99 320 bajo una cuantía "no revelada")."""
    om = _regla_omitida("ofertas_agrupadas", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    postores = [p for p in _postores_parser(state) if p.get("monto") and not _oferta_invalida(p)]
    result = {"regla": "ofertas_agrupadas", "triggered": False, "n_ofertas": len(postores)}
    if len(postores) < 3:
        result.update({"estado": "sin_dato" if len(postores) == 0 else "hallado",
                       "motivo": "se requieren ≥ 3 ofertas válidas con monto"})
        return result
    montos = sorted(p["monto"] for p in postores)
    mediana = montos[len(montos) // 2] if len(montos) % 2 else (montos[len(montos) // 2 - 1] + montos[len(montos) // 2]) / 2
    dispersion = (montos[-1] - montos[0]) / mediana * 100 if mediana else 0.0
    result.update({"dispersion_pct": round(dispersion, 2), "montos": montos, "estado": "hallado"})
    if dispersion >= 1.0:
        return result
    vr = _vr_state(state)
    reservada = _cuantia_reservada(state)
    result["cuantia_reservada"] = reservada
    ev = (f"{len(postores)} ofertas válidas agrupadas en una banda del {dispersion:.2f} % "
          f"(S/ {montos[0]:,.2f} a S/ {montos[-1]:,.2f}). ")
    if vr:
        ev += f"Todas entre el {montos[0] / vr * 100:.1f} % y el {montos[-1] / vr * 100:.1f} % del valor referencial (S/ {vr:,.2f}). "
    if reservada:
        ev += "Las bases declaran la cuantía no revelada. "
    ev += "Señal de riesgo de cotización coordinada o de filtración del valor; requiere verificación."
    return _flag(state, result, "media", ev, _norma_state(state)["integridad"],
                 f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}")


def check_unica_oferta_valida_rule(ocid: str, tool_context: ToolContext,
                                   reglas_activas: frozenset[str] | None = None,
                                   topes_uit: dict | None = None) -> dict:
    """Con ≥ 2 ofertas, solo la ganadora resulta válida (las demás por encima de la cuantía
    en Comparación de Precios/SIE, o descalificadas/no admitidas) → MEDIA; ALTA si además el
    ganador ofertó ≥ 99 % de la cuantía (1225379: 65 000 de 65 100 con rivales a 68 500 y
    72 650; 1225392: 95 000 = cuantía con rivales a 97 960 y 99 940)."""
    om = _regla_omitida("unica_oferta_valida", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    vr = _vr_state(state)
    tipo = _procurement_method(state)
    tope_aplica = _es_comparacion_precios(tipo) or _es_subasta(tipo)
    postores = [p for p in _postores_parser(state) if p.get("monto") or p.get("estado")]
    result = {"regla": "unica_oferta_valida", "triggered": False, "n_postores": len(postores),
              "tipo_proceso": tipo or None}
    if len(postores) < 2:
        result.update({"estado": "sin_dato" if not postores else "hallado", "motivo": "se requieren ≥ 2 ofertas"})
        return result
    validas, invalidas = [], []
    for p in postores:
        motivo = None
        if _oferta_invalida(p):
            motivo = f"estado '{p.get('estado')}'"
        elif tope_aplica and vr and p.get("monto") and p["monto"] > vr * 1.0005:
            motivo = f"oferta S/ {p['monto']:,.2f} > cuantía S/ {vr:,.2f}"
        (invalidas if motivo else validas).append((p, motivo))
    result.update({"n_validas": len(validas), "n_invalidas": len(invalidas), "estado": "hallado",
                   "invalidas": [{"postor": _nombre_postor(p), "motivo": m} for p, m in invalidas]})
    if len(validas) != 1 or not invalidas:
        return result
    g, _ = validas[0]
    if not g.get("es_ganador"):
        return result
    pct = (g["monto"] / vr * 100) if (vr and g.get("monto")) else None
    sev = "alta" if (pct is not None and pct >= 99.0) else "media"
    ev = (f"De {len(postores)} ofertas, solo la del adjudicatario {_nombre_postor(g)} resultó válida"
          + (f" (S/ {g['monto']:,.2f}, {pct:.2f} % de la cuantía)" if pct is not None else "") + ". Las demás: "
          + "; ".join(f"{_nombre_postor(p)} — {m}" for p, m in invalidas[:4])
          + ". Señal de riesgo de competencia aparente (ofertas de acompañamiento); requiere verificación.")
    return _flag(state, result, sev, ev, _norma_state(state)["competencia"],
                 f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}")


def check_ganador_no_invitado_rule(ocid: str, tool_context: ToolContext,
                                   reglas_activas: frozenset[str] | None = None,
                                   topes_uit: dict | None = None) -> dict:
    """Comparación de Precios (lista cerrada): el adjudicatario no figura entre los invitados
    publicados en las bases (1225379: 3 invitaciones, ganó un cuarto proveedor)."""
    om = _regla_omitida("ganador_no_invitado", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    raw = state.get("parser_raw_consolidated") or {}
    tipo = _procurement_method(state)
    result = {"regla": "ganador_no_invitado", "triggered": False, "tipo_proceso": tipo or None}
    if not _es_comparacion_precios(tipo):
        result.update({"estado": "sin_dato", "motivo": "solo aplica a Comparación de Precios"})
        return result
    invitados = raw.get("lista_invitados") or []
    inv_norm = []
    for i in invitados:
        if isinstance(i, dict):
            ruc = "".join(ch for ch in str(i.get("ruc") or "") if ch.isdigit())
            inv_norm.append((ruc if len(ruc) == 11 else None, _norm_razon_cr(i.get("razon_social") or i.get("nombre") or "")))
        elif i:
            s = str(i)
            ruc = "".join(ch for ch in s if ch.isdigit())
            inv_norm.append((ruc if len(ruc) == 11 else None, _norm_razon_cr(s)))
    result["n_invitados"] = len(inv_norm)
    if not inv_norm:
        result.update({"estado": "sin_dato", "motivo": "las bases no traen lista de invitados (o el parser no la extrajo)"})
        return result
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    g_ruc, g_nom = _ganador_ocds(ocds)
    if not g_ruc:
        for p in _postores_parser(state):
            if p.get("es_ganador"):
                g_ruc, g_nom = p.get("ruc"), p.get("razon_social")
                break
    if not g_ruc and not g_nom:
        result.update({"estado": "sin_dato", "motivo": "sin adjudicatario identificable"})
        return result
    g_nom_n = _norm_razon_cr(g_nom or "")
    g_tok = set(g_nom_n.split())

    def _match(ruc, nom):
        if g_ruc and ruc and ruc == g_ruc:
            return True
        if nom and g_nom_n and (nom == g_nom_n or (len(g_tok & set(nom.split())) >= 2 and len(g_tok) >= 2)):
            return True
        return False
    result["estado"] = "hallado"
    if any(_match(r, n) for r, n in inv_norm):
        return result
    sev = "alta" if len(inv_norm) >= 3 else "media"
    ev = (f"El adjudicatario {g_nom or g_ruc} (RUC {g_ruc or 's/d'}) no aparece entre los {len(inv_norm)} proveedores "
          f"invitados que publican las bases de la Comparación de Precios (procedimiento de lista cerrada). "
          f"Señal de riesgo: verificar si existió una invitación adicional no publicada en el expediente.")
    return _flag(state, result, sev, ev, _norma_state(state)["comparacion_precios"],
                 f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}")


_CARGOS_PUBLICOS = ("jefe", "gerente", "subgerente", "sub gerente", "oficial", "director", "responsable",
                    "residente", "inspector", "supervisor", "alcalde", "administraci", "abastecimiento",
                    "logistica", "adquisicion", "contrataciones", "presidente", "miembro", "comite",
                    "coordinador", "especialista", "asistente", "tesorer", "contador", "secretari")


def _firmantes_entidad(state: dict) -> list[dict]:
    """Firmantes del lado de la ENTIDAD (no del contratista) según parser: cargo público o
    entidad distinta del proveedor."""
    raw = state.get("parser_raw_consolidated") or {}
    da = _safe_parse_json(state.get("document_analysis")) or {}
    firm = raw.get("firmantes_consolidados") or raw.get("firmantes") or da.get("firmantes") or []
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    g_ruc, g_nom = _ganador_ocds(ocds)
    g_tok = set(_norm_razon_cr(g_nom or "").split())
    out = []
    for f in firm:
        if not isinstance(f, dict) or not (f.get("nombre_completo") or "").strip():
            continue
        cargo = _sin_tildes(str(f.get("cargo") or "")).lower()
        ent = _norm_razon_cr(f.get("entidad") or "")
        es_proveedor = bool(ent) and g_tok and len(g_tok & set(ent.split())) >= 2
        if es_proveedor and not any(c in cargo for c in _CARGOS_PUBLICOS):
            continue
        if any(k in cargo for k in ("representante legal", "apoderado", "titular", "contratista", "postor", "proveedor")) \
                and not any(c in cargo for c in ("residente", "inspector", "jefe", "gerente municipal", "oficial")):
            continue
        out.append(f)
    return out


def check_firmante_con_empresa_rnp_rule(ocid: str, tool_context: ToolContext,
                                        reglas_activas: frozenset[str] | None = None,
                                        topes_uit: dict | None = None) -> dict:
    """Firmante de la entidad (OEC, oficial de compras, jefe de abastecimiento, residente…)
    que figura en el RNP como socio/titular/representante de una empresa proveedora del
    Estado (`rnp_firmantes_resultados` con match ≥ 0.95). MEDIA; ALTA si la empresa es
    postora del proceso o su rubro coincide con el objeto (1225058, 1225266, 1225450)."""
    om = _regla_omitida("firmante_con_empresa_rnp", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    pnc = state.get("person_network_context") or {}
    resultados = pnc.get("rnp_firmantes_resultados") or []
    result = {"regla": "firmante_con_empresa_rnp", "triggered": False, "n_firmantes_consultados": len(resultados)}
    if not resultados:
        result.update({"estado": "sin_dato", "motivo": "sin cruce RNP de firmantes en person_network_context"})
        return result
    firmantes_ent = {_norm_razon_cr(f.get("nombre_completo")): f for f in _firmantes_entidad(state)}
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    g_ruc, _ = _ganador_ocds(ocds)
    rucs_postores = {p["ruc"] for p in _postores_parser(state) if p.get("ruc")}
    for t in ((ocds.get("tender") or {}).get("tenderers") or []):
        r = "".join(ch for ch in str((t or {}).get("id") or "") if ch.isdigit())
        if len(r) == 11:
            rucs_postores.add(r)
    if g_ruc:
        rucs_postores.add(g_ruc)
    objeto = ((ocds.get("tender") or {}).get("description") or "")
    hallazgos = []
    for r in resultados:
        if not isinstance(r, dict):
            continue
        nombre = str(r.get("firmante") or "").strip()
        nn = _norm_razon_cr(nombre)
        f = firmantes_ent.get(nn)
        if f is None and firmantes_ent:
            # firmante conocido pero fuera del lado entidad (representante del contratista) → saltar
            continue
        for e in (r.get("empresas") or []):
            if not isinstance(e, dict):
                continue
            score = float(e.get("match_score") or 0)
            exacto = str(r.get("match_por") or "") == "nombre_exacto"
            if not exacto and score < 0.95:
                continue
            ruc_e = str(e.get("ruc_empresa") or "")
            if g_ruc and ruc_e == g_ruc and not f:
                continue  # es el representante del propio contratista
            es_postora = ruc_e in rucs_postores
            rubro = coincide_objeto(objeto, [e.get("nombre_visto") or ""]) if objeto and e.get("nombre_visto") else False
            hallazgos.append({"firmante": nombre, "cargo": (f or {}).get("cargo"), "ruc_empresa": ruc_e,
                              "empresa": e.get("nombre_visto"), "roles": e.get("roles"), "match_score": score,
                              "es_postora": es_postora, "rubro_coincide": bool(rubro),
                              "vigencia_desde": e.get("fecha_inicio_vigencia")})
    result.update({"estado": "hallado", "n_hallazgos": len(hallazgos), "detalle": hallazgos[:6]})
    if not hallazgos:
        return result
    hallazgos.sort(key=lambda h: (not h["es_postora"], not h["rubro_coincide"], -h["match_score"]))
    h = hallazgos[0]
    sev = "alta" if (h["es_postora"] or h["rubro_coincide"]) else "media"
    ev = (f"{h['firmante']}" + (f" ({h['cargo']})" if h.get("cargo") else "") + f", firmante del expediente por la "
          f"entidad, figura en el RNP como {', '.join(h.get('roles') or ['socio/representante'])} de "
          f"{h.get('empresa') or 'una empresa'} (RUC {h['ruc_empresa']}), proveedora inscrita del Estado. ")
    if h["es_postora"]:
        ev += "Esa empresa es postora en este mismo proceso: conflicto de interés directo a verificar."
    elif h["rubro_coincide"]:
        ev += "El rubro de la empresa coincide con el objeto contratado: posible conflicto de interés; requiere verificación."
    else:
        ev += ("No es impedimento por sí solo (la empresa no postuló aquí); es una observación de "
               "conflicto de interés potencial que el dictamen debe consignar.")
    if len(hallazgos) > 1:
        ev += f" Otros firmantes con empresa en RNP: {len(hallazgos) - 1}."
    return _flag(state, result, sev, ev, _norma_state(state)["impedimentos"] + " / Ley 27815 (Código de Ética)",
                 f"https://apps.oece.gob.pe/perfilprov-ui/ficha/{h['ruc_empresa']}")


_RE_AMPL_IMPROC = re.compile(r"(improcedente|denegad|no procede|desestim|infundad|no ha lugar)", re.I)
_RE_AMPL = re.compile(r"ampliaci[oó]n\s+de\s+plazo|ampliaci[oó]n\s+del\s+plazo", re.I)
_RE_PENAL = re.compile(r"penalidad(es)?\s+(por\s+mora|aplicad|impuest)|aplic\w+\s+(la\s+)?penalidad|resoluci[oó]n\s+(total|parcial)?\s*del\s+contrato|resuelve\s+el\s+contrato", re.I)


def check_ampliacion_denegada_penalidad_rule(ocid: str, tool_context: ToolContext,
                                             reglas_activas: frozenset[str] | None = None,
                                             topes_uit: dict | None = None) -> dict:
    """Ejecución contractual observada (informativa, MEDIA): ampliación de plazo declarada
    improcedente, penalidad por mora aplicada o resolución del contrato. Fuente: bloque
    `contrato.ampliaciones_plazo[] / penalidades_aplicadas[]` (R4) o, en su defecto, los
    resúmenes de resoluciones/adendas del expediente (1225058: Res. OGA 506-2026)."""
    om = _regla_omitida("ampliacion_denegada_penalidad", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    raw = state.get("parser_raw_consolidated") or {}
    contrato = raw.get("contrato") if isinstance(raw.get("contrato"), dict) else {}
    cf = _safe_parse_json(state.get("contrato_final")) or {}
    result = {"regla": "ampliacion_denegada_penalidad", "triggered": False}
    hechos = []
    for src in (contrato, cf if isinstance(cf, dict) else {}):
        for a in (src.get("ampliaciones_plazo") or []):
            if not isinstance(a, dict):
                continue
            res = str(a.get("resultado") or a.get("resolucion") or "")
            if _RE_AMPL_IMPROC.search(res) or str(a.get("resultado") or "").lower() in ("improcedente", "denegada", "denegado"):
                hechos.append(f"ampliación de plazo N° {a.get('n') or '?'} declarada improcedente"
                              + (f" ({a.get('resolucion')})" if a.get("resolucion") and a.get("resolucion") != res else ""))
        for p in (src.get("penalidades_aplicadas") or []):
            if isinstance(p, dict):
                hechos.append("penalidad aplicada" + (f": {str(p.get('motivo') or p.get('tipo') or '')[:80]}" if (p.get("motivo") or p.get("tipo")) else "")
                              + (f" por S/ {float(p['monto']):,.2f}" if _f(p.get("monto")) else ""))
            elif p:
                hechos.append(f"penalidad aplicada: {str(p)[:80]}")
    fuente_doc = None
    if not hechos:
        for r in (raw.get("resumenes") or []):
            if not isinstance(r, dict):
                continue
            txt = str(r.get("resumen") or "")
            if _RE_AMPL.search(txt) and _RE_AMPL_IMPROC.search(txt):
                hechos.append("ampliación de plazo declarada improcedente según el documento "
                              f"'{str(r.get('documento') or '')[:60]}'")
                fuente_doc = r.get("documento")
            elif _RE_PENAL.search(txt):
                hechos.append(f"penalidad/resolución contractual según el documento '{str(r.get('documento') or '')[:60]}'")
                fuente_doc = r.get("documento")
    result.update({"estado": "hallado" if (contrato or cf or raw.get("resumenes")) else "sin_dato",
                   "hechos": hechos[:6]})
    if not hechos:
        return result
    ev = ("Ejecución contractual con incidencias documentadas en el expediente: " + "; ".join(hechos[:3]) +
          ". Es información de ejecución (no una irregularidad del proceso de selección): el dictamen debe "
          "consignarla con la fecha y la resolución que la sustenta.")
    result["documento"] = fuente_doc
    return _flag(state, result, "media", ev, _norma_state(state)["penalidades"],
                 f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}")


def _apellidos(nombre: str) -> tuple[str, str] | None:
    """(ap_paterno, ap_materno) desde 'APELLIDO1 APELLIDO2 NOMBRES' o 'APELLIDOS, NOMBRES'."""
    s = _sin_tildes(str(nombre or "")).upper().strip()
    if "," in s:
        s = s.split(",", 1)[0]
    toks = [t for t in re.sub(r"[^A-Z ]", " ", s).split() if len(t) > 1 and t not in ("DE", "DEL", "LA", "LAS", "LOS", "Y")]
    if len(toks) < 3 and "," not in str(nombre or ""):
        return None
    if len(toks) < 2:
        return None
    return toks[0], toks[1]


def _socios_por_postor(state: dict) -> list[dict]:
    """[{ruc, razon_social, socios:[{nombre, dni}]}] para ganador + rivales (RNP)."""
    pnc = state.get("person_network_context") or {}
    out = []
    for r in (pnc.get("socios_postores_rivales") or []):
        if isinstance(r, dict) and r.get("socios"):
            out.append({"ruc": r.get("ruc_postor"), "razon_social": r.get("razon_social"),
                        "socios": [s for s in r["socios"] if isinstance(s, dict)]})
    rnp = pnc.get("rnp_proveedor") or {}
    if isinstance(rnp, dict):
        socios = []
        for grupo in ("socios", "representantes_legales", "organos_administracion"):
            for s in (rnp.get(grupo) or []):
                if isinstance(s, dict) and (s.get("nombre") or s.get("numero_documento") or s.get("dni")):
                    socios.append({"nombre": s.get("nombre"), "dni": s.get("numero_documento") or s.get("dni")})
        if socios:
            ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
            g_ruc, g_nom = _ganador_ocds(ocds)
            out.append({"ruc": rnp.get("ruc") or g_ruc, "razon_social": rnp.get("razon_social") or g_nom or "adjudicatario",
                        "socios": socios, "es_ganador": True})
    return out


def check_postores_vinculados_rnp_rule(ocid: str, tool_context: ToolContext,
                                       reglas_activas: frozenset[str] | None = None,
                                       topes_uit: dict | None = None) -> dict:
    """Socios/representantes de dos postores distintos con el MISMO DNI (alta) o con los dos
    apellidos completos iguales (media, "requiere verificación"; nunca por un solo
    apellido). Casos: Arias Oblitas en PROMAINGSA y MÉTRICA (1225062); Flórez García en
    Inversiones Puquin y Grifo Latino (1225416)."""
    om = _regla_omitida("postores_vinculados_rnp", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    postores = _socios_por_postor(state)
    result = {"regla": "postores_vinculados_rnp", "triggered": False, "n_postores_con_socios": len(postores)}
    if len(postores) < 2:
        result.update({"estado": "sin_dato", "motivo": "se requieren socios RNP de ≥ 2 postores"})
        return result
    pares = []
    for i, a in enumerate(postores):
        for b in postores[i + 1:]:
            if a.get("ruc") and a.get("ruc") == b.get("ruc"):
                continue
            for sa in a["socios"]:
                for sb in b["socios"]:
                    da_, db_ = str(sa.get("dni") or "").strip(), str(sb.get("dni") or "").strip()
                    if da_ and db_ and da_ == db_ and len(da_) == 8:
                        pares.append({"tipo": "mismo_dni", "postor_a": a["razon_social"], "postor_b": b["razon_social"],
                                      "persona": sa.get("nombre") or sb.get("nombre")})
                        continue
                    apa, apb = _apellidos(sa.get("nombre")), _apellidos(sb.get("nombre"))
                    if apa and apb and apa == apb:
                        pares.append({"tipo": "dos_apellidos", "postor_a": a["razon_social"], "postor_b": b["razon_social"],
                                      "apellidos": " ".join(apa), "persona_a": sa.get("nombre"), "persona_b": sb.get("nombre")})
    result.update({"estado": "hallado", "n_pares": len(pares), "detalle": pares[:6]})
    if not pares:
        return result
    pares.sort(key=lambda p: p["tipo"] != "mismo_dni")
    p = pares[0]
    if p["tipo"] == "mismo_dni":
        sev = "alta"
        ev = (f"Una misma persona ({p.get('persona')}) figura en el RNP como socio/representante de dos postores "
              f"rivales: {p['postor_a']} y {p['postor_b']}. Señal de riesgo de competencia simulada; requiere verificación.")
    else:
        sev = "media"
        ev = (f"Socios de dos postores rivales comparten los dos apellidos '{p['apellidos']}' según el RNP: "
              f"{p.get('persona_a')} ({p['postor_a']}) y {p.get('persona_b')} ({p['postor_b']}). Coincidencia de "
              f"apellidos: no acredita parentesco ni concertación; requiere verificación.")
    if len(pares) > 1:
        ev += f" Pares adicionales: {len(pares) - 1}."
    return _flag(state, result, sev, ev, _norma_state(state)["integridad"],
                 f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}")


def check_oferta_mas_barata_no_gana_rule(ocid: str, tool_context: ToolContext,
                                         reglas_activas: frozenset[str] | None = None,
                                         topes_uit: dict | None = None) -> dict:
    """La oferta económica más baja admitida no es la ganadora y la diferencia es ≥ 5 % →
    MEDIA, con el factor que decidió si el parser trae `procedimiento_seleccion.
    puntajes_por_postor` (1225090: 597 510 perdió frente a 649 800 por garantía comercial)."""
    om = _regla_omitida("oferta_mas_barata_no_gana", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    postores = [p for p in _postores_parser(state) if p.get("monto") and not _oferta_invalida(p)]
    result = {"regla": "oferta_mas_barata_no_gana", "triggered": False, "n_ofertas_validas": len(postores)}
    ganador = next((p for p in postores if p.get("es_ganador")), None)
    if len(postores) < 2 or ganador is None:
        result.update({"estado": "sin_dato", "motivo": "se requieren ≥ 2 ofertas válidas con monto y ganador identificado"})
        return result
    barata = min(postores, key=lambda p: p["monto"])
    result["estado"] = "hallado"
    if barata is ganador or barata["monto"] >= ganador["monto"]:
        return result
    diff = (ganador["monto"] - barata["monto"]) / barata["monto"] * 100
    result.update({"oferta_mas_baja": barata["monto"], "oferta_ganadora": ganador["monto"], "diff_pct": round(diff, 2)})
    if diff < 5.0:
        return result
    raw = state.get("parser_raw_consolidated") or {}
    ps = raw.get("procedimiento_seleccion") if isinstance(raw.get("procedimiento_seleccion"), dict) else {}
    puntajes = ps.get("puntajes_por_postor") or raw.get("puntajes_por_postor") or []
    factor_txt = ""
    if isinstance(puntajes, list) and puntajes:
        def _busca(nombre):
            nn = _norm_razon_cr(nombre)
            for q in puntajes:
                if isinstance(q, dict) and _norm_razon_cr(q.get("postor") or q.get("razon_social") or "") == nn:
                    return q
            return None
        qg, qb = _busca(ganador["razon_social"]), _busca(barata["razon_social"])
        if qg and qb:
            factor_txt = (f" Puntajes: ganador {qg.get('total')} (económico {qg.get('economico')}, técnico {qg.get('tecnico')}) "
                          f"vs {qb.get('total')} (económico {qb.get('economico')}, técnico {qb.get('tecnico')}).")
            fg, fb = qg.get("factores") or {}, qb.get("factores") or {}
            if isinstance(fg, dict) and isinstance(fb, dict):
                decisivos = [k for k in fg if _f(fg.get(k)) and (float(fg.get(k) or 0) > float(fb.get(k) or 0))]
                if decisivos:
                    factor_txt += f" Factores que decidieron: {', '.join(str(k) for k in decisivos[:3])}."
    ev = (f"La oferta más baja admitida fue la de {_nombre_postor(barata)} (S/ {barata['monto']:,.2f}); ganó "
          f"{_nombre_postor(ganador)} con S/ {ganador['monto']:,.2f} (+{diff:.1f} %).{factor_txt} No es irregular "
          f"cuando la evaluación pondera factores técnicos, pero es un dato que el dictamen debe explicar: qué "
          f"factor no económico decidió la adjudicación y si estaba en las bases.")
    return _flag(state, result, "media", ev, _norma_state(state)["competencia"],
                 f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}")


def _digits(s) -> str:
    return "".join(ch for ch in str(s or "") if ch.isdigit())


def check_fecha_buena_pro_incoherente_rule(ocid: str, tool_context: ToolContext,
                                           reglas_activas: frozenset[str] | None = None,
                                           topes_uit: dict | None = None) -> dict:
    """Coherencia documental (MEDIA): el contrato cita una fecha de buena pro anterior a la
    convocatoria, o el número de la garantía difiere entre contrato y carta fianza. Solo si
    el parser trae ambos datos (1225090: "27 de mayo" en el contrato con convocatoria del
    15-jun; carta fianza 010674143 vs contrato 101674143)."""
    om = _regla_omitida("fecha_buena_pro_incoherente", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    raw = state.get("parser_raw_consolidated") or {}
    contrato = raw.get("contrato") if isinstance(raw.get("contrato"), dict) else {}
    cf = _safe_parse_json(state.get("contrato_final")) or {}
    cf = cf if isinstance(cf, dict) else {}
    result = {"regla": "fecha_buena_pro_incoherente", "triggered": False, "estado": "sin_dato"}
    fconv = _fecha_convocatoria_state(state)
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    fbp_ocds = _to_date(((ocds.get("awards") or [{}])[0] or {}).get("date"))
    hechos = []
    fbp_doc = None
    for src in (contrato, cf):
        for k in ("fecha_buena_pro_citada", "fecha_buena_pro", "fecha_adjudicacion"):
            d = _to_date(src.get(k))
            if d:
                fbp_doc = d
                break
        if fbp_doc:
            break
    if fbp_doc and fconv:
        result["estado"] = "hallado"
        result.update({"fecha_buena_pro_documento": str(fbp_doc), "fecha_convocatoria": str(fconv)})
        if fbp_doc < fconv:
            hechos.append(f"el contrato cita la buena pro el {fbp_doc:%d/%m/%Y}, antes de la convocatoria "
                          f"({fconv:%d/%m/%Y})" + (f"; el OCDS registra la buena pro el {fbp_ocds:%d/%m/%Y}" if fbp_ocds else ""))
    # Garantía: número en el contrato vs número en la carta fianza (documento aparte).
    num_contrato = None
    for src in (contrato, cf):
        g = src.get("garantia") or src.get("garantia_fiel_cumplimiento") or {}
        if isinstance(g, dict) and _digits(g.get("numero") or g.get("nro")):
            num_contrato = _digits(g.get("numero") or g.get("nro"))
            break
    num_carta = None
    for g in (raw.get("garantias") or raw.get("cartas_fianza") or []):
        if isinstance(g, dict) and _digits(g.get("numero") or g.get("nro")):
            num_carta = _digits(g.get("numero") or g.get("nro"))
            break
    if num_contrato and num_carta:
        result["estado"] = "hallado"
        result.update({"garantia_contrato": num_contrato, "garantia_carta": num_carta})
        if num_contrato != num_carta and num_contrato.lstrip("0") != num_carta.lstrip("0"):
            hechos.append(f"el número de la garantía difiere entre el contrato ({num_contrato}) y la carta fianza ({num_carta})")
    if not hechos:
        return result
    ev = ("Incoherencia documental en el expediente: " + "; ".join(hechos) +
          ". Puede ser un error material de la entidad; es un dato que un revisor preguntaría y el dictamen debe consignar.")
    return _flag(state, result, "media", ev, _norma_state(state)["transparencia"],
                 f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}")


REGLAS_LOTE1 = {
    "oferta_igual_valor_referencial": check_oferta_igual_valor_referencial_rule,
    "ofertas_agrupadas": check_ofertas_agrupadas_rule,
    "unica_oferta_valida": check_unica_oferta_valida_rule,
    "ganador_no_invitado": check_ganador_no_invitado_rule,
    "firmante_con_empresa_rnp": check_firmante_con_empresa_rnp_rule,
    "ampliacion_denegada_penalidad": check_ampliacion_denegada_penalidad_rule,
    "postores_vinculados_rnp": check_postores_vinculados_rnp_rule,
    "oferta_mas_barata_no_gana": check_oferta_mas_barata_no_gana_rule,
    "fecha_buena_pro_incoherente": check_fecha_buena_pro_incoherente_rule,
}


def run_reglas_lote1(ocid: str, tool_context: ToolContext, force: bool = False) -> dict:
    """Corre las reglas deterministas del lote 1 una sola vez por corrida (idempotente:
    `state['reglas_lote1']`). Las banderas quedan en `pending_flags`; el resultado por regla
    en `state['reglas_lote1']` para la traza/UI."""
    state = tool_context.state
    ya = state.get("reglas_lote1")
    if isinstance(ya, dict) and ya.get("_ocid") == str(ocid) and not force:
        return ya
    out: dict = {"_ocid": str(ocid)}
    for nombre, fn in REGLAS_LOTE1.items():
        try:
            out[nombre] = fn(ocid, tool_context)
        except Exception as e:  # una regla nueva nunca tumba la corrida
            out[nombre] = {"regla": nombre, "triggered": False, "error": str(e)[:200]}
    out["_disparadas"] = [k for k, v in out.items() if isinstance(v, dict) and v.get("triggered")]
    state["reglas_lote1"] = out
    return out


# ── FunctionTool wrappers ──
# Las reglas se exponen con firma simple (ocid, tool_context); el perfil (reglas_activas,
# topes_uit) llega por kwargs desde el driver o por state['reglas_activas'/'topes_uit'].
check_unique_bidder_rule_tool = _as_tool(check_unique_bidder_rule)
check_sanctioned_provider_rule_tool = _as_tool(check_sanctioned_provider_rule)
check_non_competitive_process_rule_tool = _as_tool(check_non_competitive_process_rule)
check_plazo_convocatoria_rule_tool = _as_tool(check_plazo_convocatoria_rule)
check_tipo_proceso_vs_monto_rule_tool = _as_tool(check_tipo_proceso_vs_monto_rule)
check_directa_fundamento_rule_tool = _as_tool(check_directa_fundamento_rule)
check_edad_ruc_ganador_rule_tool = _as_tool(check_edad_ruc_ganador_rule)
check_ciiu_vs_objeto_rule_tool = _as_tool(check_ciiu_vs_objeto_rule)
check_concentracion_entidad_rule_tool = _as_tool(check_concentracion_entidad_rule)
check_recurrencia_firmante_rule_tool = _as_tool(check_recurrencia_firmante_rule)
check_testaferro_multi_ruc_rule_tool = _as_tool(check_testaferro_multi_ruc_rule)
check_ruc_ultra_nuevo_rule_tool = _as_tool(check_ruc_ultra_nuevo_rule)
check_postor_unico_mayoritario_rule_tool = _as_tool(check_postor_unico_mayoritario_rule)
check_inconsistencia_doc_vs_ocds_rule_tool = _as_tool(check_inconsistencia_doc_vs_ocds_rule)
check_lobby_visits_rule_tool = _as_tool(check_lobby_visits_rule)
check_adicional_acumulado_rule_tool = _as_tool(check_adicional_acumulado_rule)
check_personal_clave_vinculado_rule_tool = _as_tool(check_personal_clave_vinculado_rule)
check_fraccionamiento_rule_tool = _as_tool(check_fraccionamiento_rule)
check_directa_recurrente_rule_tool = _as_tool(check_directa_recurrente_rule)

# Reglas disponibles por nombre (para que el driver/perfil las itere sin importar cada una).
REGLAS_POR_NOMBRE = {
    "unico_postor_alto": check_unique_bidder_rule,
    "proveedor_sancionado_osce": check_sanctioned_provider_rule,
    "procedimiento_no_competitivo": check_non_competitive_process_rule,
    "plazo_convocatoria_minimo": check_plazo_convocatoria_rule,
    "tipo_proceso_vs_monto": check_tipo_proceso_vs_monto_rule,
    "directa_sin_fundamento": check_directa_fundamento_rule,
    "ruc_ganador_muy_nuevo": check_edad_ruc_ganador_rule,
    "ciiu_vs_objeto": check_ciiu_vs_objeto_rule,
    "concentracion_entidad": check_concentracion_entidad_rule,
    "firmante_vinculado_ganador": check_recurrencia_firmante_rule,
    "testaferro_multi_ruc": check_testaferro_multi_ruc_rule,
    "ruc_ultra_nuevo": check_ruc_ultra_nuevo_rule,
    "postor_unico_mayoritario": check_postor_unico_mayoritario_rule,
    "inconsistencia_doc_vs_ocds": check_inconsistencia_doc_vs_ocds_rule,
    "lobby_visits_pre_convocatoria": check_lobby_visits_rule,
    "adicional_acumulado": check_adicional_acumulado_rule,
    "personal_clave_vinculado": check_personal_clave_vinculado_rule,
    "fraccionamiento": check_fraccionamiento_rule,
    "directa_recurrente": check_directa_recurrente_rule,
    # Lote 1 (activas por defecto en todos los perfiles; ver run_reglas_lote1).
    **REGLAS_LOTE1,
}
check_oferta_igual_valor_referencial_rule_tool = _as_tool(check_oferta_igual_valor_referencial_rule)
check_ofertas_agrupadas_rule_tool = _as_tool(check_ofertas_agrupadas_rule)
check_unica_oferta_valida_rule_tool = _as_tool(check_unica_oferta_valida_rule)
check_ganador_no_invitado_rule_tool = _as_tool(check_ganador_no_invitado_rule)
check_firmante_con_empresa_rnp_rule_tool = _as_tool(check_firmante_con_empresa_rnp_rule)
check_ampliacion_denegada_penalidad_rule_tool = _as_tool(check_ampliacion_denegada_penalidad_rule)
check_postores_vinculados_rnp_rule_tool = _as_tool(check_postores_vinculados_rnp_rule)
check_oferta_mas_barata_no_gana_rule_tool = _as_tool(check_oferta_mas_barata_no_gana_rule)
check_fecha_buena_pro_incoherente_rule_tool = _as_tool(check_fecha_buena_pro_incoherente_rule)
run_reglas_lote1_tool = FunctionTool(func=run_reglas_lote1)
evaluate_normative_compliance_tool = FunctionTool(func=evaluate_normative_compliance)
detect_estado_real_tool = FunctionTool(func=_detect_estado_real_persist)
analyze_postores_pattern_tool = FunctionTool(func=analyze_postores_pattern)
