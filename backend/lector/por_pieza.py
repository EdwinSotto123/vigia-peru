#!/usr/bin/env python3
"""Lectura CON MODELO, una pieza por vez y con un extractor a medida para cada tipo de documento.

  python -X utf8 backend/lector/por_pieza.py prod --lector reporte_evaluacion --limite 120 --tope-usd 2
  python -X utf8 backend/lector/por_pieza.py prod --lector bases_secciones --limite 150 --tope-usd 5
  python -X utf8 backend/lector/por_pieza.py prod --lector bases --limite 500 --tope-usd 6          # la ficha completa

El dato lo lee un modelo abierto (GLM 5.3 flash por vigia-llm; nunca Claude). El código hace lo demás:
  · prepara   el texto de la pieza con sus marcas de página (documentos_texto) y, en las bases, sólo las secciones que
              tocan (lector/secciones.partir): generalidades, requisitos de calificación y factores de evaluación;
  · comprueba que cada cita que el modelo copió esté en el texto que se le dio y traiga el valor (`citas` en la salida);
  · guarda    la lectura en pieza_lectura (migración 325) con el modelo, los tokens y el costo.
Las lecturas por regla de la misma pieza (lector/plantillas.py, lector/secciones.py) quedan al lado, con otra versión:
son la segunda lectura independiente. backend/evals/hechos/comparar.py dice cuánto coinciden.

Tope: el gasto total con modelo sobre piezas no pasa de TOPE_TOTAL_USD (el tope propio del plan de extracción, aparte
del análisis masivo). Se cuenta en la base, así que sobrevive a un reinicio.

Privacidad: el pie de los reportes del SEACE trae el DNI de quien los generó: se quita antes de mandar el texto.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import ExitStack
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend"))
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from lector import ficha_bases, fichas_cortas, secciones  # noqa: E402

VERSION = "m1"
TOPE_TOTAL_USD = 315.0
TANDA = 24                             # piezas por consulta: cada una trae el texto de sus páginas
_NULO = ["string", "null"]
_NUM = ["number", "null"]
_ENT = ["integer", "null"]

_COMUN = """Eres un lector de documentos de contratación pública del Perú. Extraes datos de UN documento y los devuelves con
el esquema pedido. Reglas que no se rompen:
- Sólo lo que el documento dice. Si un dato no figura, va null (o la opción «no_figura»). Nunca lo completes con lo que
  sería normal ni con un número de otra parte del documento.
- Los montos van como número, sin separadores de miles: «S/ 1,234,567.50» es 1234567.5.
- Las fechas van como AAAA-MM-DD y las horas como HH:MM:SS.
- El texto trae marcas ⟦p.N⟧: lo que sigue a una marca está en la página N. Cuando se pida la página de un dato, es la
  de la marca anterior a su cita.
- Cuando se pida una cita, cópiala del documento palabra por palabra (hasta 200 caracteres), con el número tal como está
  escrito. Una cita que no está en el documento invalida el dato."""

# ── Los reportes que genera el SEACE ──
_REPORTE = _COMUN + """

El documento es un reporte que genera el SEACE. Su texto salió de un PDF y las líneas vienen en un orden particular: el
VALOR de cada campo suele ir ANTES de su etiqueta (por ejemplo «Adjudicado» y debajo «Resultado»; el monto y debajo
«Valor Referencial :»). Un nombre largo puede ocupar dos líneas. Un reporte puede traer varios ítems: cada fila pertenece
al ítem bajo cuyo encabezado aparece (en la presentación de ofertas, los ítems que siguen al primero vienen compactos:
la descripción, su número y «RUC / Código»). Si una hoja continúa en la siguiente, la cabecera se repite: no dupliques filas."""

REPORTE_PRESENTACION = {
    "tipos": ["reporte_presentacion"],
    "SISTEMA": _REPORTE,
    "PEDIDO": "Del reporte «Presentación de ofertas / expresión de interés»: por cada ítem, quiénes presentaron oferta, con su RUC "
              "o código, su nombre o razón social, la fecha y la hora de presentación. Un ítem sin ofertas va con la lista vacía.",
    "ESQUEMA": {"type": "object", "additionalProperties": False, "required": ["nomenclatura", "items"], "properties": {
        "nomenclatura": {"type": _NULO},
        "items": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["item", "ofertas"], "properties": {
            "item": {"type": _ENT},
            "ofertas": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                                 "required": ["ruc", "nombre", "fecha", "hora"], "properties": {
                "ruc": {"type": _NULO}, "nombre": {"type": "string"}, "fecha": {"type": _NULO}, "hora": {"type": _NULO}}}}}}}}},
}
REPORTE_EVALUACION = {
    "tipos": ["reporte_evaluacion"],
    "SISTEMA": _REPORTE,
    "PEDIDO": "Del «Reporte de evaluación técnica»: por cada ítem y cada postor, si su oferta fue admitida (true) o no admitida "
              "(false), su puntaje técnico (null si trae un guion) y si quedó calificada (true), descalificada (false) o sin "
              "calificar (null, cuando trae un guion). Un ítem sin postores va con la lista vacía.",
    "ESQUEMA": {"type": "object", "additionalProperties": False, "required": ["nomenclatura", "items"], "properties": {
        "nomenclatura": {"type": _NULO},
        "items": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["item", "postores"], "properties": {
            "item": {"type": _ENT},
            "postores": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                                  "required": ["nombre", "admitida", "puntaje_tecnico", "calificada"], "properties": {
                "nombre": {"type": "string"}, "admitida": {"type": ["boolean", "null"]}, "puntaje_tecnico": {"type": _NUM},
                "calificada": {"type": ["boolean", "null"]}}}}}}}}},
}
REPORTE_OTORGAMIENTO = {
    "tipos": ["reporte_otorgamiento"],
    "SISTEMA": _REPORTE,
    "PEDIDO": "Del «Reporte de otorgamiento de buena pro»: por cada ítem, el resultado (adjudicado, desierto, monto_mayor si dice "
              "«Monto mayor al valor…», cancelado, nulo u otro), el valor referencial del ítem con su moneda (PEN si dice S/, USD si "
              "dice $) y, si se adjudicó, a quién: RUC o código, nombre, monto adjudicado y, si es un consorcio, sus integrantes "
              "(la primera fila es el consorcio; las siguientes, con su RUC, son los integrantes).",
    "ESQUEMA": {"type": "object", "additionalProperties": False, "required": ["nomenclatura", "items"], "properties": {
        "nomenclatura": {"type": _NULO},
        "items": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                           "required": ["item", "resultado", "valor_referencial", "moneda", "adjudicados"], "properties": {
            "item": {"type": _ENT},
            "resultado": {"type": "string", "enum": ["adjudicado", "desierto", "monto_mayor", "cancelado", "nulo", "otro"]},
            "valor_referencial": {"type": _NUM}, "moneda": {"type": ["string", "null"], "enum": ["PEN", "USD", "EUR", None]},
            "adjudicados": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                                     "required": ["ruc", "nombre", "monto", "integrantes"], "properties": {
                "ruc": {"type": _NULO}, "nombre": {"type": "string"}, "monto": {"type": _NUM},
                "integrantes": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["ruc", "nombre"],
                                                          "properties": {"ruc": {"type": _NULO}, "nombre": {"type": "string"}}}}}}}}}}}},
}

# ── Las bases, por secciones ──
_CITADO = {"pagina": {"type": _ENT}, "cita": {"type": "string"}}
BASES_SECCIONES = {
    "tipos": ["bases", "bases_integradas"],
    "SISTEMA": _COMUN + """

El documento son las bases de un procedimiento de selección. Recibes sólo tres secciones de su parte específica (lo que
la entidad llenó), cada una bajo un título «=== … ===»:
- GENERALIDADES (Capítulo I): aquí está la CUANTÍA de la contratación (antes, «valor referencial»), el plazo y la fuente
  de financiamiento.
- REQUISITOS DE CALIFICACIÓN (dentro del Capítulo III): aquí está la experiencia que se EXIGE al postor.
- FACTORES DE EVALUACIÓN (Capítulo IV): aquí está la experiencia ADICIONAL que da puntaje.

Lo que más se confunde, y cómo se distingue:
- La CUANTÍA sólo sale del apartado «Cuantía de la contratación» (o «Valor referencial») de las GENERALIDADES. La entidad
  puede reservarla: si dice que «ha determinado no dar a conocer la cuantía» o «no se dará a conocer», el estado es
  «reservada» y el valor va null. Si el apartado no está, «no_figura». En obras puede venir como una tabla de costos: la
  cuantía es el TOTAL, nunca el costo directo, los gastos generales, la utilidad ni el subtotal. Si hay un límite inferior
  y uno superior, la cuantía es la del medio, no los límites.
- La EXPERIENCIA EXIGIDA es un requisito: «el postor debe acreditar un monto facturado acumulado equivalente a S/ …» o «a
  una vez la cuantía de la contratación». NO es la cuantía, aunque sea un monto grande. Suele haber una segunda cifra,
  menor, para micro y pequeñas empresas («mype»), y a veces una por ítem.
- La EXPERIENCIA ADICIONAL es un factor de evaluación: se premia con puntos a quien acredite más. Tampoco es la cuantía
  ni un requisito.
- Un texto entre corchetes («[CONSIGNAR EL MONTO…]») es la plantilla sin llenar: no es un dato.
- Los topes de la ley («cuando la cuantía adjudicada sea igual o menor a S/ 480 000,00») no son datos de este proceso.""",
    "PEDIDO": "De estas bases: la cuantía de la contratación (pública, reservada o que no figura), la experiencia que se exige "
              "al postor, la experiencia adicional que da puntaje, el plazo de ejecución o de entrega en días y la fuente de "
              "financiamiento. Cada dato con su página y su cita.",
    "ESQUEMA": {"type": "object", "additionalProperties": False,
                "required": ["cuantia", "experiencia_exigida", "experiencia_adicional", "plazo", "fuente_financiamiento"], "properties": {
        "cuantia": {"type": "object", "additionalProperties": False, "required": ["estado", "valor", "moneda", "pagina", "cita"], "properties": {
            "estado": {"type": "string", "enum": ["publica", "reservada", "no_figura"]},
            "valor": {"type": _NUM}, "moneda": {"type": ["string", "null"], "enum": ["PEN", "USD", "EUR", None]}, **_CITADO}},
        "experiencia_exigida": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                                         "required": ["monto", "veces_la_cuantia", "anios", "para", "item", "pagina", "cita"], "properties": {
            "monto": {"type": _NUM}, "veces_la_cuantia": {"type": _NUM}, "anios": {"type": _ENT},
            "para": {"type": "string", "enum": ["general", "mype"]}, "item": {"type": _NULO}, **_CITADO}}},
        "experiencia_adicional": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                                           "required": ["monto", "veces_la_cuantia", "puntos", "pagina", "cita"], "properties": {
            "monto": {"type": _NUM}, "veces_la_cuantia": {"type": _NUM}, "puntos": {"type": _NUM}, **_CITADO}}},
        "plazo": {"type": "object", "additionalProperties": False, "required": ["dias", "pagina", "cita"], "properties": {
            "dias": {"type": _ENT}, **_CITADO}},
        "fuente_financiamiento": {"type": _NULO}}},
}

# «bases» es la ficha completa (lector/ficha_bases.py): dos pedidos por pieza y una sola pieza por proceso (las bases
# integradas si las hay). «bases_secciones» es su versión corta del piloto (cuantía y experiencia), para comparar con la regla.
LECTORES = {"reporte_presentacion": REPORTE_PRESENTACION, "reporte_evaluacion": REPORTE_EVALUACION,
            "reporte_otorgamiento": REPORTE_OTORGAMIENTO, "bases_secciones": BASES_SECCIONES,
            "bases": {"tipos": ["bases", "bases_integradas"], "ficha": True},
            # Los documentos cortos que nunca se leían (lector/fichas_cortas.py): garantía, modificación, resolución, desierto.
            **fichas_cortas.LECTORES}


def version_de(nombre: str) -> str:
    return ficha_bases.VERSION if nombre == "bases" else VERSION


class _Lector:
    """La forma que espera MotorWorkers: SISTEMA, PEDIDO y ESQUEMA."""

    def __init__(self, d: dict):
        self.SISTEMA, self.PEDIDO, self.ESQUEMA = d["SISTEMA"], d["PEDIDO"], d["ESQUEMA"]


# ── Preparar: el texto que se le da al modelo ──
_PIE_USUARIO = re.compile(r"(Usuario(?: que actualiz[oó])?\s*:\s*)\S+", re.I)


def texto_de_paginas(paginas: list[dict]) -> str:
    """El texto de una pieza con una marca ⟦p.N⟧ por página y sin el DNI del pie de los reportes."""
    partes = []
    for i, p in enumerate(paginas or []):
        t = _PIE_USUARIO.sub(r"\1[omitido]", p.get("texto") or "")
        partes.append(f"⟦p.{p.get('n') or i + 1}⟧\n{t}")
    return "\n".join(partes)


TOPE_SECCION = {"generalidades": 14_000, "requisitos_calificacion": 26_000, "evaluacion": 22_000}
TITULO_SECCION = {"generalidades": "GENERALIDADES (Capítulo I)", "requisitos_calificacion": "REQUISITOS DE CALIFICACIÓN",
                  "evaluacion": "FACTORES DE EVALUACIÓN (Capítulo IV)"}


def texto_de_bases(paginas: list[dict]) -> str | None:
    """De unas bases, sólo las secciones que el lector necesita. None si no tienen la armazón estándar."""
    secs = secciones.partir(paginas)
    if not secs:
        return None
    partes = []
    for clave in ("generalidades", "requisitos_calificacion", "evaluacion"):
        s = next((x for x in secs if x["clave"] == clave), None)
        if s is None and clave == "requisitos_calificacion":
            # Sin el título de los requisitos, van las últimas páginas del requerimiento (donde suelen estar).
            req = next((x for x in secs if x["clave"] == "requerimiento"), None)
            s = {**req, "texto": req["texto"][-TOPE_SECCION[clave]:]} if req else None
        if s:
            partes.append(f"=== {TITULO_SECCION[clave]} ===\n{s['texto'][:TOPE_SECCION[clave]]}")
    return "\n\n".join(partes) if partes else None


# ── Comprobar: la cita está en lo que se le dio al modelo y trae el valor ──
def _llano(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", "".join(c for c in s if not unicodedata.combining(c)).lower()).split())


def cita_en_texto(cita: str, texto_llano: str) -> bool:
    """7 de cada 10 tríos de palabras seguidas de la cita están en el texto (tolera saltos de línea y guiones)."""
    pal = _llano(cita).split()
    if len(pal) < 3:
        return bool(pal) and " ".join(pal) in texto_llano
    trios = [" ".join(pal[i:i + 3]) for i in range(len(pal) - 2)]
    return sum(t in texto_llano for t in trios) / len(trios) >= 0.7


def valor_en_cita(valor, cita: str) -> bool:
    """Los dígitos del valor (su parte entera) aparecen en la cita."""
    if valor is None:
        return True
    return str(int(abs(float(valor)))) in re.sub(r"\D", "", cita or "")


def comprobar_bases(salida: dict, texto: str) -> dict:
    """Por cada dato con cita: si la cita está en el texto y si trae el valor. No cambia la salida: la acompaña."""
    llano = _llano(texto)
    r = {"total": 0, "cita_en_texto": 0, "valor_en_cita": 0, "fallas": []}

    def uno(nombre, valor, cita):
        if not cita and valor is None:
            return
        r["total"] += 1
        a, b = cita_en_texto(cita or "", llano), valor_en_cita(valor, cita or "")
        r["cita_en_texto"] += a
        r["valor_en_cita"] += b
        if not (a and b):
            r["fallas"].append(nombre)

    c = salida.get("cuantia") or {}
    if c.get("estado") in ("publica", "reservada"):
        uno("cuantia", c.get("valor"), c.get("cita"))
    for i, e in enumerate(salida.get("experiencia_exigida") or []):
        uno(f"experiencia_exigida[{i}]", e.get("monto") if e.get("monto") is not None else None, e.get("cita"))
    for i, e in enumerate(salida.get("experiencia_adicional") or []):
        uno(f"experiencia_adicional[{i}]", e.get("monto"), e.get("cita"))
    p = salida.get("plazo") or {}
    if p.get("dias") is not None:
        uno("plazo", p.get("dias"), p.get("cita"))
    return r


# ── Correr ──
PENDIENTES = """
SELECT p.id, p.tipo_documento,
       (SELECT jsonb_agg(jsonb_build_object('n', e.p->'n', 'texto', e.p->'texto') ORDER BY e.ord)
          FROM jsonb_array_elements(t.paginas) WITH ORDINALITY AS e(p, ord)
         WHERE (e.p->>'n') ~ '^\\d+$' AND (e.p->>'n')::int BETWEEN p.pag_ini AND p.pag_fin) AS paginas
  FROM documento_pieza p JOIN documentos_texto t ON t.sha256 = p.sha256
 WHERE p.tipo_documento = ANY (%(tipos)s) AND p.paginas_con_texto * 2 >= p.paginas AND jsonb_typeof(t.paginas) = 'array'
   AND NOT EXISTS (SELECT 1 FROM pieza_lectura l WHERE l.pieza_id = p.id AND l.lector = %(lector)s AND l.version = %(version)s
                                                   AND l.estado NOT IN ('error'))
   {filtro}
 ORDER BY {orden}
 LIMIT %(limite)s
"""
# Para comparar con la regla hace falta que la pieza ya tenga su lectura por regla.
CON_REGLA = "AND EXISTS (SELECT 1 FROM pieza_lectura r WHERE r.pieza_id = p.id AND r.lector = %(lector)s AND r.modelo = 'plantilla')"
# La ficha de las bases se lee una vez por PROCESO: de sus piezas de bases con texto, las integradas si las hay; primero
# los procesos más recientes.
PENDIENTES_BASES = """
SELECT p.id, p.tipo_documento,
       (SELECT jsonb_agg(jsonb_build_object('n', e.p->'n', 'texto', e.p->'texto') ORDER BY e.ord)
          FROM jsonb_array_elements(t.paginas) WITH ORDINALITY AS e(p, ord)
         WHERE (e.p->>'n') ~ '^\\d+$' AND (e.p->>'n')::int BETWEEN p.pag_ini AND p.pag_fin) AS paginas
  FROM (SELECT DISTINCT ON (q.ocid) q.id, q.ocid, q.sha256, q.tipo_documento, q.pag_ini, q.pag_fin
          FROM documento_pieza q
         WHERE q.tipo_documento = ANY (%(tipos)s) AND q.paginas >= 15 AND q.paginas_con_texto * 2 >= q.paginas
         ORDER BY q.ocid, (q.tipo_documento = 'bases_integradas') DESC, q.paginas_con_texto DESC, q.id DESC) p
  JOIN documentos_texto t ON t.sha256 = p.sha256
  LEFT JOIN convocatorias c ON c.ocid = p.ocid
 WHERE jsonb_typeof(t.paginas) = 'array'
   AND NOT EXISTS (SELECT 1 FROM pieza_lectura l JOIN documento_pieza z ON z.id = l.pieza_id
                    WHERE z.ocid = p.ocid AND l.lector = %(lector)s AND l.version = %(version)s AND l.estado <> 'error'
                      -- Una ficha que esperaba la transcripción vuelve a la cola cuando el texto del documento cambió.
                      AND NOT (l.estado = 'espera_vision' AND z.id = p.id AND t.actualizado_at > l.leido_at))
 ORDER BY c.fecha_convocatoria DESC NULLS LAST, p.id DESC
 LIMIT %(limite)s
"""
GUARDAR = """
INSERT INTO pieza_lectura (pieza_id, lector, version, modelo, estado, salida, sobrante, tokens_in, tokens_out, costo_usd, detalle, leido_at)
VALUES (%(pieza_id)s, %(lector)s, %(version)s, %(modelo)s, %(estado)s, %(salida)s, 0, %(tokens_in)s, %(tokens_out)s, %(costo_usd)s,
        %(detalle)s, now())
ON CONFLICT (pieza_id, lector, version) DO UPDATE SET
  modelo = EXCLUDED.modelo, estado = EXCLUDED.estado, salida = EXCLUDED.salida, tokens_in = EXCLUDED.tokens_in,
  tokens_out = EXCLUDED.tokens_out, costo_usd = EXCLUDED.costo_usd, detalle = EXCLUDED.detalle, leido_at = now()
"""
GASTADO = "SELECT COALESCE(sum(costo_usd), 0)::float FROM pieza_lectura WHERE modelo <> 'plantilla'"


def leer_ficha_bases(motor, fila: dict, paginas: list[dict], con_escaneos: bool = False) -> dict:
    """La ficha completa de unas bases: la parte específica entera, por tramos seguidos, con el mismo esquema en cada uno;
    después se juntan, se comprueban las citas y se dice qué quedó sin leer (páginas escaneadas, tramos que fallaron).
    Queda «ok» sólo si se leyó todo; si no, «parcial» con lo que sí se leyó."""
    prep = ficha_bases.preparar(paginas)
    if prep is None:
        return {**fila, "estado": "sin_armazon"}
    if prep["escaneadas"] and not con_escaneos:
        # Con un bloque escaneado adentro (el requerimiento pegado como imagen) la ficha saldría a medias y habría que
        # pagarla otra vez tras transcribir: espera su turno. `paginas` va en el detalle para la cola de transcripción.
        return {**fila, "estado": "espera_vision",
                "detalle": json.dumps({"escaneadas": prep["escaneadas"], "rango": prep["rango"]})[:2000]}
    if not prep["tramos"]:
        return {**fila, "estado": "sin_texto", "detalle": f"{len(prep['escaneadas'])} páginas escaneadas en la parte específica"}
    lector = _Lector({"SISTEMA": ficha_bases.SISTEMA, "PEDIDO": ficha_bases.PEDIDO, "ESQUEMA": ficha_bases.ESQUEMA})
    salidas: list[dict | None] = []
    fallos: list[str] = []
    tin = tout = 0
    costo = 0.0
    for t in prep["tramos"]:
        r = motor.llamar_texto(lector, t["texto"])
        tin, tout, costo = tin + (r["tokens_in"] or 0), tout + (r["tokens_out"] or 0), costo + float(r["costo_usd"] or 0)
        fila["modelo"] = r["modelo"]
        if r["estado"] == "ok":
            salidas.append(r["salida"])
        else:
            salidas.append(None)
            fallos.append(f"páginas {t['pag_ini']}-{t['pag_fin']}: {r['estado']}")
    fila.update(tokens_in=tin, tokens_out=tout, costo_usd=round(costo, 6))
    if not any(salidas):
        return {**fila, "estado": "error", "detalle": "; ".join(fallos)[:300]}
    ficha = ficha_bases.juntar(salidas, prep["tramos"])
    ficha["citas"] = ficha_bases.revisar_citas(ficha, _llano("\n".join(t["texto"] for t in prep["tramos"])), cita_en_texto)
    ficha["lectura"] = {"paginas": prep["rango"], "tramos": len(prep["tramos"]), "tramos_fallidos": fallos,
                        "paginas_escaneadas": prep["escaneadas"], "sin_leer_por_tope": prep["sin_leer_por_tope"]}
    completo = not fallos and not prep["escaneadas"] and not prep["sin_leer_por_tope"]
    detalle = "; ".join(x for x in (
        f"{len(prep['escaneadas'])} páginas escaneadas sin leer" if prep["escaneadas"] else "",
        f"{len(prep['sin_leer_por_tope'])} páginas fuera por tope" if prep["sin_leer_por_tope"] else "",
        "; ".join(fallos)) if x)[:300]
    return {**fila, "estado": "ok" if completo else "parcial", "detalle": detalle or None, "salida": json.dumps(ficha, ensure_ascii=False)}


def leer_una(motor, nombre: str, pieza_id: int, tipo: str, paginas: list[dict], con_escaneos: bool = False) -> dict:
    fila = {"pieza_id": pieza_id, "lector": nombre, "version": version_de(nombre), "modelo": motor.nombre, "estado": "sin_texto",
            "salida": None, "tokens_in": None, "tokens_out": None, "costo_usd": 0, "detalle": None}
    if nombre == "bases":
        return leer_ficha_bases(motor, fila, paginas, con_escaneos)
    texto = texto_de_bases(paginas) if nombre == "bases_secciones" else texto_de_paginas(paginas)
    if not texto or len(texto) < 200:
        return {**fila, "estado": "sin_armazon" if nombre == "bases_secciones" else "sin_texto"}
    if len(texto) > 240_000:
        return {**fila, "estado": "grande", "detalle": f"{len(texto)} caracteres"}
    r = motor.llamar_texto(_Lector(LECTORES[nombre]), texto)
    fila.update(modelo=r["modelo"], tokens_in=r["tokens_in"], tokens_out=r["tokens_out"], costo_usd=r["costo_usd"],
                estado=r["estado"], detalle=r.get("detalle"))
    if r["estado"] != "ok":
        return fila
    salida = r["salida"]
    if nombre == "bases_secciones":
        salida["citas"] = comprobar_bases(salida, texto)
    elif nombre in fichas_cortas.LECTORES:
        salida["citas"] = ficha_bases.revisar_citas(salida, _llano(texto), cita_en_texto)
    fila["salida"] = json.dumps(salida, ensure_ascii=False)
    return fila


def main() -> None:
    from lector.motor_workers import MODELO_DEFECTO, MotorWorkers
    from tunel_rds import conexion

    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--lector", required=True, choices=sorted(LECTORES))
    ap.add_argument("--limite", type=int, default=100)
    ap.add_argument("--tope-usd", type=float, default=2.0, help="gasto máximo de esta corrida")
    ap.add_argument("--hilos", type=int, default=5, help="Workers AI aguanta 9 a la vez en total: deja sitio a lo demás")
    ap.add_argument("--modelo", default=None)
    ap.add_argument("--con-regla", action="store_true", help="sólo piezas que ya tienen su lectura por regla (para comparar)")
    ap.add_argument("--varios-items", action="store_true", help="primero las piezas largas (reportes de varios ítems)")
    ap.add_argument("--con-escaneos", action="store_true",
                    help="bases: leer también las que traen un bloque escaneado (quedan «parcial»); sin esto, esperan la transcripción")
    a = ap.parse_args()
    lector = LECTORES[a.lector]
    motor = MotorWorkers(a.modelo or MODELO_DEFECTO)
    consulta = PENDIENTES_BASES if a.lector == "bases" else PENDIENTES.format(
        filtro=CON_REGLA if a.con_regla else "", orden="p.paginas DESC, p.id DESC" if a.varios_items else "p.id DESC")
    t0 = time.time()
    with ExitStack() as pila:
        cn = pila.enter_context(conexion(a.entorno))
        cur = cn.cursor()
        # Una sola corrida de este lector a la vez (la PC y el CI leen la misma cola): candado de sesión en la base.
        cur.execute("SELECT pg_try_advisory_lock(hashtext(%s))", (f"lector.por_pieza:{a.lector}",))
        if not cur.fetchone()[0]:
            sys.exit("otra corrida igual está en curso: no se hace nada")
        cur.execute(GASTADO)
        total = cur.fetchone()[0]
        if total >= TOPE_TOTAL_USD:
            sys.exit(f"tope total alcanzado: USD {total:.2f} de {TOPE_TOTAL_USD}")
        print(f"{a.entorno}: hasta {a.limite} piezas con {motor.nombre} ({a.lector} {version_de(a.lector)}), tope USD {a.tope_usd}; "
              f"gastado hasta ahora USD {total:.2f} de {TOPE_TOTAL_USD}", flush=True)
        gastado, hechos = 0.0, 0
        cuenta: dict[str, int] = {}
        vistas: set[int] = set()
        seguir = True
        with ThreadPoolExecutor(max_workers=a.hilos) as pool:
            # Por tandas: cada pieza viaja con el texto de sus páginas (unas bases son cientos de KB).
            while seguir and hechos < a.limite:
                cur.execute(consulta, {"tipos": lector["tipos"], "lector": a.lector, "version": version_de(a.lector),
                                       "limite": min(TANDA, a.limite - hechos)})
                piezas = [x for x in cur.fetchall() if x[0] not in vistas]
                cn.commit()
                if not piezas:
                    break
                vistas.update(x[0] for x in piezas)
                futuros = {pool.submit(leer_una, motor, a.lector, pid, tipo, paginas or [], a.con_escaneos): pid
                           for pid, tipo, paginas in piezas}
                for listo in as_completed(futuros):
                    pid = futuros[listo]
                    try:
                        fila = listo.result()
                    except Exception as e:  # noqa: BLE001 — queda como error y se reintenta en otra corrida
                        fila = {"pieza_id": pid, "lector": a.lector, "version": version_de(a.lector), "modelo": motor.nombre,
                                "estado": "error", "salida": None, "tokens_in": None, "tokens_out": None, "costo_usd": 0,
                                "detalle": f"{type(e).__name__}: {str(e)[:200]}"}
                    cur.execute(GUARDAR, fila)
                    cn.commit()
                    gastado += float(fila["costo_usd"] or 0)
                    hechos += 1
                    cuenta[fila["estado"]] = cuenta.get(fila["estado"], 0) + 1
                    if hechos % 20 == 0:
                        print(f"  {hechos} piezas USD {gastado:.3f} {cuenta} {round(time.time() - t0)} s", flush=True)
                if gastado >= a.tope_usd or total + gastado >= TOPE_TOTAL_USD:
                    print("  tope alcanzado: no se mandan más", flush=True)
                    seguir = False
    print(f"FIN {a.lector}: {hechos} piezas, USD {gastado:.3f} (USD {gastado / max(hechos, 1):.5f} por pieza), {cuenta}, "
          f"{round(time.time() - t0)} s")


if __name__ == "__main__":
    main()
