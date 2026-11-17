"""La FICHA COMPLETA de unas bases: todo lo que un investigador necesita de ellas, leído entero y por tramos con un modelo.

El lector anterior de bases (lector/bases.py) leía 27 páginas de unas 120, elegidas por palabras, y guardaba cinco cosas
(experiencia, personal clave, equipamiento, factores y marcas). Se perdía el requerimiento, los documentos de admisión, la
capacidad legal, las penalidades y las garantías.

Aquí se lee TODA la parte específica de las bases (lo que la entidad llenó: desde «SECCIÓN ESPECÍFICA» hasta el final de
la proforma del contrato; ni la sección general, que es texto fijo, ni los formatos en blanco de los anexos), en tramos
seguidos de páginas enteras. Cada tramo se pide con el MISMO esquema («saca lo que aparezca en este tramo») y después se
juntan. Se probó antes partir fino por títulos y mandar cada sección a su pedido: perdía contenido, porque la armazón
varía (en obras los requisitos van dentro del capítulo de evaluación, hay secciones de 150 mil caracteres, el título
«Anexos» aparece a media obra). Leer seguido no depende de eso.

Lo que el código sí garantiza, sin decidir ningún dato:
  · la CUANTÍA sólo se acepta del tramo que trae las generalidades (nunca de un monto de experiencia de más adelante);
  · cada tramo dice bajo qué títulos empieza («Capítulo III > Requisitos de calificación»), para que el modelo sepa si un
    monto es un requisito o un factor de evaluación aunque el título haya quedado en el tramo anterior;
  · cada cita se busca en el texto que se le dio al modelo;
  · las páginas ESCANEADAS de la parte específica (el requerimiento suele venir pegado como imagen) se cuentan y se
    nombran: la ficha queda «parcial» hasta que esas páginas se transcriban. Esa es la medida de lo que falta leer.
"""
from __future__ import annotations

import re

from lector import secciones

VERSION = "m3"
TRAMO = 42_000                         # caracteres por pedido (≈ 13 mil tokens): páginas enteras hasta llegar ahí
TOPE_TRAMOS = 9
MIN_LETRAS_PAGINA = 300
BLOQUE_ESCANEADO = 3                   # páginas seguidas casi sin texto para contarlas como un escaneo
_NULO = ["string", "null"]
_NUM = ["number", "null"]
_ENT = ["integer", "null"]
_PAG = {"pagina": {"type": _ENT}}
_CITA = {"pagina": {"type": _ENT}, "cita": {"type": "string"}}


def _objeto(requeridos: list[str], propiedades: dict) -> dict:
    return {"type": "object", "additionalProperties": False, "required": requeridos, "properties": propiedades}


def _lista(requeridos: list[str], propiedades: dict) -> dict:
    return {"type": "array", "items": _objeto(requeridos, propiedades)}


SISTEMA = """Eres un lector de bases de procedimientos de selección del Estado peruano. Recibes UN TRAMO de la parte
específica de unas bases (lo que la entidad llenó) y devuelves lo que ese tramo dice, con el esquema pedido.

Reglas que no se rompen:
- Sólo lo que ESTE tramo dice. Lo que no aparece en el tramo va null o lista vacía: otro tramo lo traerá. No completes con
  lo que sería normal ni repitas datos de la cabecera de cada página.
- El texto trae marcas ⟦p.N⟧: lo que sigue a una marca está en la página N. La página de un dato es la de la marca
  anterior a él.
- Los montos van como número sin separadores («S/ 1,234,567.50» es 1234567.5). Los plazos, en días calendario.
- Una «cita» es una frase copiada del tramo palabra por palabra (hasta 200 caracteres), con el número como está escrito.
- Un texto entre corchetes («[CONSIGNAR…]», «[INDICAR…]») es la plantilla sin llenar: no es un dato.
- Las listas van COMPLETAS y en el orden del documento: un elemento por requisito, documento, factor o penalidad, sin
  juntar dos en uno y sin saltarte ninguno. Resume cada uno en una frase fiel; no opines.

Cómo se distingue lo que más se confunde:
- La CUANTÍA de la contratación (antes «valor referencial») sólo sale de su apartado en las GENERALIDADES (Capítulo I). Si
  la entidad dice que «ha determinado no dar a conocer la cuantía» o que «no se dará a conocer», el estado es «reservada»
  y el valor va null. Si el tramo no trae ese apartado, «no_figura». En obras puede venir como tabla de costos: la cuantía
  es el TOTAL (no el costo directo ni el subtotal); si hay límite inferior y superior, es el valor del medio.
- La EXPERIENCIA DEL POSTOR que se EXIGE es un requisito de calificación («debe acreditar un monto facturado acumulado
  equivalente a S/ …» o «a una vez la cuantía»): va en requisitos_calificacion, con tipo experiencia_postor. NO es la
  cuantía. La cifra rebajada para micro y pequeñas empresas es otro requisito, con para = «mype».
- La experiencia ADICIONAL que da puntaje va en factores_evaluacion, con su monto. Lo decide el título bajo el que
  aparece: «Requisitos de calificación» es requisito; «Factores de evaluación» o «Evaluación técnica» es factor.
- Los DOCUMENTOS DE ADMISIÓN son la lista con letras de «documentos para la admisión de la oferta»; los REQUISITOS PARA
  PERFECCIONAR EL CONTRATO son otra lista, la de lo que entrega el ganador antes de firmar.
- El PERSONAL CLAVE va sólo en personal_clave (cargo, profesión y experiencia juntos, un elemento por cargo) y el
  EQUIPAMIENTO sólo en equipamiento: no los repitas en requisitos_calificacion.
- Las EXIGENCIAS PARTICULARES son las que no todo proveedor del rubro cumple: una muestra, una visita obligatoria, una
  certificación o carta del fabricante, un local o planta en la zona, una antigüedad máxima del equipo. Copia la
  exigencia; no juzgues si es válida.
- Una MARCA exigida «o equivalente» admite equivalente; si sólo nombra la marca, no; si no se sabe, null.
- Los topes que fija la ley («cuando la cuantía adjudicada sea igual o menor a S/ 480 000,00») no son datos de este
  proceso."""

PEDIDO = ("De este tramo de las bases, lo que aparezca: la cuantía, el objeto, el sistema de contratación, la fuente de "
          "financiamiento, los plazos, los documentos de admisión, los requisitos de calificación, los factores de evaluación "
          "con su puntaje, los requisitos para perfeccionar el contrato, los adelantos, la forma de pago, qué se contrata, los "
          "ítems (hasta 40), el personal clave, el equipamiento, las exigencias particulares, las marcas, las penalidades, las "
          "garantías, cómo se resuelven las controversias, y una o dos frases que resuman el tramo.")

LISTAS = ("plazos", "documentos_admision", "requisitos_calificacion", "factores_evaluacion", "requisitos_perfeccionar", "items",
          "personal_clave", "equipamiento", "exigencias_particulares", "marcas", "penalidades", "garantias")
ESCALARES = ("objeto", "sistema_contratacion", "fuente_financiamiento", "forma_de_pago", "solucion_controversias")

ESQUEMA = _objeto(
    ["cuantia", *ESCALARES, "adelantos", "requerimiento", *LISTAS, "resumen_tramo"], {
        "cuantia": _objeto(["estado", "valor", "moneda", "pagina", "cita"], {
            "estado": {"type": "string", "enum": ["publica", "reservada", "no_figura"]}, "valor": {"type": _NUM},
            "moneda": {"type": ["string", "null"], "enum": ["PEN", "USD", "EUR", None]}, **_CITA}),
        "objeto": {"type": _NULO}, "sistema_contratacion": {"type": _NULO}, "fuente_financiamiento": {"type": _NULO},
        "forma_de_pago": {"type": _NULO}, "solucion_controversias": {"type": _NULO},
        "adelantos": _objeto(["directo_pct", "materiales_pct", "pagina", "cita"], {
            "directo_pct": {"type": _NUM}, "materiales_pct": {"type": _NUM}, **_CITA}),
        "requerimiento": _objeto(["tipo", "prestacion", "lugar"], {
            "tipo": {"type": "string", "enum": ["especificaciones_tecnicas", "terminos_de_referencia", "expediente_tecnico",
                                                "remite_a_otro_archivo", "no_figura"]},
            "prestacion": {"type": _NULO}, "lugar": {"type": _NULO}}),
        "plazos": _lista(["que", "dias", "pagina", "cita"], {"que": {"type": "string"}, "dias": {"type": _ENT}, **_CITA}),
        "documentos_admision": _lista(["documento", "pagina"], {"documento": {"type": "string"}, **_PAG}),
        "requisitos_calificacion": _lista(["tipo", "requisito", "cantidad", "unidad", "anios", "para", "acreditacion", "pagina", "cita"], {
            "tipo": {"type": "string", "enum": ["capacidad_legal", "experiencia_postor", "capacidad_tecnica", "otro"]},
            "requisito": {"type": "string"}, "cantidad": {"type": _NUM},
            "unidad": {"type": ["string", "null"], "enum": ["soles", "veces_la_cuantia", "anios", "unidades", None]},
            "anios": {"type": _ENT}, "para": {"type": "string", "enum": ["general", "mype", "item"]},
            "acreditacion": {"type": _NULO}, **_CITA}),
        "factores_evaluacion": _lista(["factor", "puntaje_maximo", "criterio", "monto", "pagina", "cita"], {
            "factor": {"type": "string"}, "puntaje_maximo": {"type": _NUM}, "criterio": {"type": _NULO}, "monto": {"type": _NUM}, **_CITA}),
        "requisitos_perfeccionar": _lista(["documento", "pagina"], {"documento": {"type": "string"}, **_PAG}),
        "items": _lista(["numero", "descripcion", "cantidad", "unidad", "pagina"], {
            "numero": {"type": _NULO}, "descripcion": {"type": "string"}, "cantidad": {"type": _NUM}, "unidad": {"type": _NULO}, **_PAG}),
        "personal_clave": _lista(["cargo", "cantidad", "profesion", "experiencia", "pagina"], {
            "cargo": {"type": "string"}, "cantidad": {"type": _ENT}, "profesion": {"type": _NULO}, "experiencia": {"type": _NULO}, **_PAG}),
        "equipamiento": _lista(["equipo", "cantidad", "pagina"], {"equipo": {"type": "string"}, "cantidad": {"type": _NUM}, **_PAG}),
        "exigencias_particulares": _lista(["exigencia", "pagina", "cita"], {"exigencia": {"type": "string"}, **_CITA}),
        "marcas": _lista(["marca", "admite_equivalente", "pagina", "cita"], {
            "marca": {"type": "string"}, "admite_equivalente": {"type": ["boolean", "null"]}, **_CITA}),
        "penalidades": _lista(["tipo", "descripcion", "tope_pct", "pagina", "cita"], {
            "tipo": {"type": "string", "enum": ["mora", "otra"]}, "descripcion": {"type": "string"}, "tope_pct": {"type": _NUM}, **_CITA}),
        "garantias": _lista(["tipo", "porcentaje", "pagina"], {
            "tipo": {"type": "string", "enum": ["fiel_cumplimiento", "adelanto", "comercial", "prestaciones_accesorias", "otra"]},
            "porcentaje": {"type": _NUM}, **_PAG}),
        "resumen_tramo": {"type": "string"}})

_TITULO = re.compile(r"^(CAPITULO [IVX]{1,4}\b.{0,60}|(\d\.\d{1,2}\.?\s*)?REQUISITOS DE CALIFICACION\b.{0,30}|"
                     r"(\d\.\d{1,2}\.?\s*)?FACTORES DE EVALUACION\b.{0,30}|(\d\.\d{1,2}\.?\s*)?EVALUACION (TECNICA|ECONOMICA)\b.{0,20}|"
                     r"PROFORMA DEL CONTRATO\b.{0,20}|(\d\.\d{1,2}\.?\s*)?(ESPECIFICACIONES TECNICAS|TERMINOS DE REFERENCIA|"
                     r"EXPEDIENTE TECNICO)\b.{0,30})$")


def _plano(s: str) -> str:
    return " ".join(s.translate(str.maketrans("ÁÉÍÓÚÜáéíóúü", "AEIOUUaeiouu")).upper().split())


def rango_especifico(paginas: list[dict]) -> tuple[int, int] | None:
    """Las páginas (primera y última, por su número) de la parte específica que se lee: desde su título hasta el final de
    la proforma del contrato o, si no hay proforma, hasta donde empiezan los formatos en blanco. None sin la armazón."""
    secs = secciones.partir(paginas)
    utiles = [s for s in secs if s["clave"] != "general"]
    if not utiles:
        return None
    ini = utiles[0]["pag_ini"]
    proformas = [s for s in utiles if s["clave"] == "proforma"]
    if proformas:
        fin = proformas[-1]["pag_fin"]
    else:
        anexos = [s for s in utiles if s["clave"] == "anexos"]
        # El último «ANEXOS» es el de los formatos; uno anterior es de adentro del requerimiento y sí se lee.
        fin = (anexos[-1]["pag_ini"] if anexos and anexos[-1]["pag_ini"] > ini else utiles[-1]["pag_fin"])
    return ini, max(fin, ini)


def bloques_escaneados(paginas: list[tuple[int, int]], minimo: int = BLOQUE_ESCANEADO) -> list[int]:
    """Las páginas escaneadas de verdad: las casi sin texto que van SEGUIDAS (tres o más). Una página suelta casi vacía
    es una carátula de capítulo o una hoja en blanco, no un escaneo: ahí no se pierde nada."""
    escaneadas: list[int] = []
    racha: list[int] = []
    for n, largo in [*paginas, (-1, 10**9)]:
        if largo < MIN_LETRAS_PAGINA:
            racha.append(n)
            continue
        if len(racha) >= minimo:
            escaneadas.extend(racha)
        racha = []
    return escaneadas


def preparar(paginas: list[dict]) -> dict | None:
    """Los tramos de la parte específica: {tramos: [{texto, pag_ini, pag_fin, con_generalidades}], escaneadas, sin_leer}."""
    rango = rango_especifico(paginas)
    if rango is None:
        return None
    ini, fin = rango
    dentro = [p for p in paginas if ini <= int(p.get("n") or 0) <= fin]
    escaneadas = bloques_escaneados([(int(p["n"]), len((p.get("texto") or "").strip())) for p in dentro])
    tramos: list[dict] = []
    rastro: list[str] = []                      # los títulos bajo los que cae lo que se va leyendo
    actual: dict | None = None
    for p in dentro:
        texto = (p.get("texto") or "").strip()
        n = int(p["n"])
        if len(texto) < MIN_LETRAS_PAGINA:
            continue
        if actual is None or actual["largo"] + len(texto) > TRAMO:
            if len(tramos) >= TOPE_TRAMOS:
                break
            actual = {"pag_ini": n, "pag_fin": n, "largo": 0, "partes": [], "rastro": " > ".join(rastro[-2:]), "con_generalidades": False}
            tramos.append(actual)
        actual["partes"].append(f"⟦p.{n}⟧\n{texto}")
        actual["largo"] += len(texto)
        actual["pag_fin"] = n
        for linea in texto.splitlines():
            t = _plano(linea)
            if len(t) <= 90 and _TITULO.match(t):
                # Un capítulo nuevo borra el rastro; un apartado se suma al capítulo.
                rastro = [t] if t.startswith("CAPITULO") else [*(rastro[:1] if rastro and rastro[0].startswith("CAPITULO") else []), t]
            if re.match(r"(1\.\s?\d{1,2}\.?\s*)?(CUANTIA DE LA CONTRATACION|VALOR REFERENCIAL|VALOR ESTIMADO)\s?\d{0,2}$", t):
                actual["con_generalidades"] = True
    leidas = {n for t in tramos for n in range(t["pag_ini"], t["pag_fin"] + 1)}
    con_texto = [int(p["n"]) for p in dentro if len((p.get("texto") or "").strip()) >= MIN_LETRAS_PAGINA]
    salida = []
    for t in tramos:
        cabeza = f"Tramo de las páginas {t['pag_ini']} a {t['pag_fin']} de las bases."
        if t["rastro"]:
            cabeza += f" Empieza bajo estos títulos: {t['rastro']}."
        salida.append({"texto": cabeza + "\n\n" + "\n".join(t["partes"]), "pag_ini": t["pag_ini"], "pag_fin": t["pag_fin"],
                       "con_generalidades": t["con_generalidades"]})
    if salida and not any(t["con_generalidades"] for t in salida):
        salida[0]["con_generalidades"] = True     # sin el título del apartado, las generalidades son el comienzo
    return {"tramos": salida, "rango": [ini, fin], "escaneadas": escaneadas,
            "sin_leer_por_tope": sorted(n for n in con_texto if n not in leidas)}


def _llave(nombre: str, e: dict) -> tuple:
    campo = {"plazos": "que", "documentos_admision": "documento", "requisitos_calificacion": "requisito", "factores_evaluacion": "factor",
             "requisitos_perfeccionar": "documento", "items": "descripcion", "personal_clave": "cargo", "equipamiento": "equipo",
             "exigencias_particulares": "exigencia", "marcas": "marca", "penalidades": "descripcion", "garantias": "tipo"}[nombre]
    extra = (e.get("para"), e.get("numero")) if nombre in ("requisitos_calificacion", "items") else ()
    return (_plano(str(e.get(campo) or ""))[:70], *extra)


def juntar(salidas: list[dict | None], tramos: list[dict]) -> dict:
    """Una ficha con lo de todos los tramos: las listas en orden y sin repetidos; los datos sueltos, del primer tramo que
    los trae; la cuantía, sólo del tramo de las generalidades."""
    ficha: dict = {k: None for k in ESCALARES}
    ficha.update({k: [] for k in LISTAS})
    ficha["cuantia"] = {"estado": "no_figura", "valor": None, "moneda": None, "pagina": None, "cita": ""}
    ficha["adelantos"] = {"directo_pct": None, "materiales_pct": None, "pagina": None, "cita": ""}
    ficha["requerimiento"] = {"tipo": "no_figura", "prestacion": None, "lugar": None}
    resumen, vistos = [], {k: set() for k in LISTAS}
    for s, t in zip(salidas, tramos):
        if not s:
            continue
        c = s.get("cuantia") or {}
        if t["con_generalidades"] and c.get("estado") in ("publica", "reservada") and ficha["cuantia"]["estado"] == "no_figura":
            ficha["cuantia"] = c
        for k in ESCALARES:
            if ficha[k] is None and s.get(k):
                ficha[k] = s[k]
        a = s.get("adelantos") or {}
        if (a.get("directo_pct") is not None or a.get("materiales_pct") is not None) and ficha["adelantos"]["pagina"] is None:
            ficha["adelantos"] = a
        r = s.get("requerimiento") or {}
        if r.get("tipo") not in (None, "no_figura") and ficha["requerimiento"]["tipo"] in ("no_figura", "remite_a_otro_archivo"):
            ficha["requerimiento"] = r
        elif r.get("prestacion") and not ficha["requerimiento"].get("prestacion"):
            ficha["requerimiento"]["prestacion"] = r["prestacion"]
        for k in LISTAS:
            for e in s.get(k) or []:
                llave = _llave(k, e)
                if llave[0] and llave not in vistos[k]:
                    vistos[k].add(llave)
                    ficha[k].append(e)
        if s.get("resumen_tramo"):
            resumen.append(s["resumen_tramo"].strip())
    ficha["resumen"] = " ".join(resumen)[:2500]
    return ficha


def revisar_citas(nodo, texto_llano: str, cita_en_texto, ruta: str = "", r: dict | None = None) -> dict:
    """Recorre la ficha: cada «cita» no vacía debe estar en el texto. Devuelve {total, en_texto, fallas}."""
    r = r if r is not None else {"total": 0, "en_texto": 0, "fallas": []}
    if isinstance(nodo, dict):
        cita = nodo.get("cita")
        if isinstance(cita, str) and cita.strip():
            r["total"] += 1
            if cita_en_texto(cita, texto_llano):
                r["en_texto"] += 1
            elif len(r["fallas"]) < 20:
                r["fallas"].append(ruta)
        for k, v in nodo.items():
            if isinstance(v, (dict, list)):
                revisar_citas(v, texto_llano, cita_en_texto, f"{ruta}.{k}" if ruta else k, r)
    elif isinstance(nodo, list):
        for i, v in enumerate(nodo):
            revisar_citas(v, texto_llano, cita_en_texto, f"{ruta}[{i}]", r)
    return r
