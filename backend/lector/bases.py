"""Lector de las bases del procedimiento (biddingDocuments): lo que se exigió para competir, como hechos.

Las bases estándar del OECE tienen una sección general (igual en todas) y una específica: el requerimiento, los
requisitos de calificación y los factores de evaluación. elegir_paginas manda al modelo sólo esas páginas. Las banderas
salen de reglas sobre lo extraído (banderas_de). Se prueba la estabilidad entre dos lecturas (backend/evals/bases).
"""
from __future__ import annotations

import io
import re

CLASE = "bases"
TIPOS_DOC = ["biddingDocuments"]
VERSION = "v1"

# Títulos de la sección que importa (en mayúsculas y sin tildes, como queda el texto normalizado).
CLAVES = [r"REQUISITOS DE CALIFICACION", r"EXPERIENCIA DEL POSTOR", r"FACTORES DE EVALUACION", r"PERSONAL CLAVE",
          r"EQUIPAMIENTO ESTRATEGICO", r"ESPECIFICACIONES TECNICAS", r"TERMINOS DE REFERENCIA", r"SECCION ESPECIFICA",
          r"CAPACIDAD TECNICA", r"FACTURACION"]


def _norma(t: str) -> str:
    import unicodedata
    t = unicodedata.normalize("NFKD", t)
    return "".join(c for c in t if not unicodedata.combining(c)).upper()


# Lo que no son las bases en el ZIP de «biddingDocuments»: piezas del expediente técnico y formatos.
NO_BASES = re.compile(r"RESUMEN EJECUTIVO|PLANO|METRADO|PRESUPUESTO|ANALISIS DE (PRECIOS|COSTOS)|COSTOS UNITARIOS|CRONOGRAMA|"
                      r"MEMORIA|ESTUDIO|PANEL FOTO|FOTOGRAF|FORMATO|ANEXO|DECLARACION JURADA|CERTIFICA", re.I)


def ordenar_pdfs(pdfs: list[tuple[str, bytes]]) -> list[tuple[str, bytes]]:
    """Primero las bases (por su nombre: «bases integradas», «bases»), después lo demás y al final el expediente técnico;
    las que no son bases se descartan si hay alguna que sí."""
    def puntaje(nombre: str) -> int:
        n = _norma(nombre)
        return (3 if "BASES" in n else 0) + (2 if "INTEGRAD" in n else 0) + (1 if "ESPECIFICACIONES" in n or "TERMINOS" in n else 0)             - (5 if NO_BASES.search(n) else 0)
    orden = sorted(pdfs, key=lambda x: -puntaje(x[0]))
    if orden and puntaje(orden[0][0]) >= 3:
        orden = [x for x in orden if puntaje(x[0]) >= 0]
    return orden


def elegir_paginas(b: bytes, cupo: int) -> list[int]:
    """Las páginas con los requisitos: si el PDF tiene texto, las que nombran esos títulos y las que les siguen; si es
    escaneado, la segunda mitad (la sección específica va después de la general)."""
    from pypdf import PdfReader
    paginas = PdfReader(io.BytesIO(b)).pages
    n = len(paginas)
    if n <= cupo:
        return list(range(n))
    textos = []
    for p in paginas:
        try:
            textos.append(_norma(p.extract_text() or ""))
        except Exception:  # noqa: BLE001
            textos.append("")
    con_texto = sum(len(t) > 200 for t in textos)
    if con_texto < n * 0.5:
        ini = max(0, n // 2 - 5)
        return list(range(ini, min(n, ini + cupo)))
    puntaje = [sum(len(re.findall(k, t)) for k in CLAVES) for t in textos]
    elegidas: set[int] = set()
    for i in sorted(range(n), key=lambda i: -puntaje[i]):
        if puntaje[i] == 0 or len(elegidas) >= cupo:
            break
        for j in (i, i + 1, i + 2):          # el título y lo que le sigue (las tablas de requisitos son largas)
            if j < n and len(elegidas) < cupo:
                elegidas.add(j)
    if not elegidas:
        ini = max(0, n // 2 - 5)
        return list(range(ini, min(n, ini + cupo)))
    return sorted(elegidas)


SISTEMA = """Lees las bases de un procedimiento de selección del Perú (SEACE): lo que la entidad exigió para competir.
Te llegan sólo algunas páginas (la sección específica: el requerimiento, los requisitos de calificación y los factores
de evaluación).

Extrae SOLO lo que dicen las páginas. Si algo no aparece: null en números, cadena vacía en textos, lista vacía.
Montos en soles, sin separadores. No inventes montos ni años.

experiencia_postor: la experiencia que se exige al postor como requisito de calificación (monto facturado mínimo,
en cuántos años, en qué especialidad), con una cita copiada de las bases.
personal_clave: cada cargo exigido con los años de experiencia que se le piden (nunca nombres de personas).
marcas: SOLO marcas comerciales, fabricantes o modelos que las bases exigen o nombran para el bien o servicio, con una
cita copiada palabra por palabra; con_equivalente es true si la misma frase admite «o equivalente» o «similar»."""

PEDIDO = "Extrae de las bases lo que pide el esquema."

_TXT = {"type": "string"}
_NUM = {"type": ["number", "null"]}
ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["es_bases", "objeto", "valor_referencial", "plazo_dias", "experiencia_postor", "personal_clave",
                 "equipamiento", "factores_evaluacion", "marcas", "confianza"],
    "properties": {
        "es_bases": {"type": "boolean", "description": "Si las páginas son de las bases del procedimiento"},
        "objeto": _TXT,
        "valor_referencial": _NUM,
        "plazo_dias": {"type": ["integer", "null"]},
        "experiencia_postor": {
            "type": "object", "additionalProperties": False,
            "required": ["monto_minimo", "anios", "especialidad", "cita"],
            "properties": {"monto_minimo": _NUM, "anios": {"type": ["integer", "null"]}, "especialidad": _TXT, "cita": _TXT},
        },
        "personal_clave": {
            "type": "array",
            "items": {"type": "object", "additionalProperties": False, "required": ["cargo", "experiencia_anios"],
                      "properties": {"cargo": _TXT, "experiencia_anios": {"type": ["number", "null"]}}},
        },
        "equipamiento": {"type": "array", "items": _TXT},
        "factores_evaluacion": {
            "type": "array",
            "items": {"type": "object", "additionalProperties": False, "required": ["factor", "puntaje"],
                      "properties": {"factor": _TXT, "puntaje": _NUM}},
        },
        "marcas": {
            "type": "array",
            "items": {"type": "object", "additionalProperties": False, "required": ["marca", "con_equivalente", "cita"],
                      "properties": {"marca": _TXT, "con_equivalente": {"type": "boolean"}, "cita": _TXT}},
        },
        "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
    },
}

BANDERAS = ["bases_marca_sin_equivalente", "bases_experiencia_alta"]


def banderas_de(salida: dict) -> list[str]:
    out = set()
    if any(not m.get("con_equivalente") and (m.get("marca") or "").strip() and (m.get("cita") or "").strip()
           for m in salida.get("marcas") or []):
        out.add("bases_marca_sin_equivalente")
    e = salida.get("experiencia_postor") or {}
    vr = salida.get("valor_referencial")
    if isinstance(e.get("monto_minimo"), (int, float)) and isinstance(vr, (int, float)) and vr > 0 and e["monto_minimo"] >= 3 * vr:
        out.add("bases_experiencia_alta")
    return sorted(out)
