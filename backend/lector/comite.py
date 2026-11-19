"""Lector del comité de selección: quiénes lo integraron, con su papel, del acta de la buena pro.

Para cruzar por dentro, nunca para publicar: las señales que lo usan (comite_mismo_ganador, 396; comite_socio_proveedor,
407) muestran sólo el papel en el comité y una clave estable. La clase «comite» está fuera del índice del chat y de las
lecturas de la ficha (lib/rag.ts, contratos_detalle.ts).

Hasta el 2026-11-19 los nombres del comité los traían sólo los agentes (alertas.analisis_full, 3 306 procesos); el lector
de actas leyó 17 538 y no los guardaba (sólo n_miembros_comite). Con éste, las dos señales de comité ven ~5 veces más.

  python -X utf8 backend/lector/leer.py prod --clase comite --motor workers --tope-usd 20

El modelo lee; el código prepara y comprueba (vigia-feedback-extraccion-llm): `elegir_paginas` manda las primeras y las
últimas páginas de cada PDF (el comité se nombra al abrir el acta y firma al cerrarla) y `comprobar_pdfs` busca cada nombre en
el texto de esas páginas: `verificada` sólo si todas sus palabras están en una misma página. En un escaneo no hay texto:
queda sin verificar (la segunda lectura, `--segunda`, puede confirmarlo si las dos coinciden).
"""
from __future__ import annotations

import re
import unicodedata

CLASE = "comite"
TIPOS_DOC = ["awardNotice", "evaluationReports"]   # el acta primero, como el lector de buena pro
VERSION = "v1"
TOPE_PAGINAS = 14
PRIMERAS, ULTIMAS = 2, 3

SISTEMA = """Lees actas de procedimientos de selección del Estado peruano (SEACE): el acta de otorgamiento de la buena pro
y, a veces, las actas de admisión, evaluación y calificación. Te llegan sus primeras y últimas páginas.

Extrae SOLO a quienes integraron el comité de selección (o el órgano encargado de las contrataciones cuando él conduce el
procedimiento): presidente, primer miembro, segundo miembro, tercer miembro y suplentes. Para cada uno:
  nombre_completo  como está escrito en el acta, nombres y apellidos, SIN títulos ni grados (Ing., Abog., Lic., CPC, Arq.,
                   Mg., Dr.) y sin su número de colegiatura
  rol              su papel en el comité tal como lo dice el acta (por ejemplo «Presidente», «Primer miembro titular»)
  pagina           el número de página donde aparece su nombre (el de las marcas [página N])
  cita             una frase copiada del acta, palabra por palabra, que contiene su nombre

NO incluyas: postores, representantes o apoderados de empresas, notarios, veedores, observadores, personal de apoyo, ni a
quien sólo firma sin decir que es del comité. No extraigas DNI ni ningún otro dato personal. Si el acta no nombra al
comité (sólo firmas sin nombre legible, o es un reporte que genera el sistema), deja la lista vacía. No inventes nombres:
si no puedes leer un nombre completo, no lo pongas."""

PEDIDO = "Extrae del acta a los integrantes del comité de selección con lo que pide el esquema."

_STR = {"type": ["string", "null"]}
ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["comite", "confianza"],
    "properties": {
        "comite": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["nombre_completo", "rol", "pagina", "cita"],
                "properties": {
                    "nombre_completo": {"type": "string"},
                    "rol": _STR,
                    "pagina": {"type": ["integer", "null"]},
                    "cita": {"type": "string", "description": "Frase copiada del acta, palabra por palabra, con el nombre"},
                },
            },
        },
        "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
    },
}

BANDERAS: list[str] = []

# Los mismos títulos que quitan las funciones SQL (396, 407): el nombre debe compararse igual en los dos lados.
_TITULOS = re.compile(r"^((ING|ARQ|ABOG|ABG|LIC|DR|DRA|SR|SRA|SRTA|CPC|C P C|ECON|ECO|BLGO|BIOL|MG|MBA|PROF|TEC|BACH|OBST|"
                      r"ENF|Q F|QF|MED|CD|PSIC|M C|MC|CAP|CRNL|MAY|TTE|ADM|CONT)\s+)+")


def plano(t: str) -> str:
    """Mayúsculas sin tildes, sólo letras y espacios simples (como upper(unaccent(...)) y las expresiones del SQL)."""
    t = unicodedata.normalize("NFKD", t or "")
    t = "".join(c for c in t if not unicodedata.combining(c)).upper()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z ]", " ", t)).strip()


def clave(nombre: str) -> str:
    """El nombre sin títulos, como `clave` en la 396 y la 407."""
    return _TITULOS.sub("", plano(nombre)).strip()


def elegir_paginas(b: bytes, queda: int) -> list[int]:
    """Las primeras y las últimas páginas de cada PDF: el comité se nombra al abrir el acta y firma al cerrarla."""
    import fitz  # PyMuPDF

    with fitz.open(stream=b, filetype="pdf") as doc:
        n = doc.page_count
    indices = sorted(set(list(range(min(PRIMERAS, n))) + list(range(max(0, n - ULTIMAS), n))))
    return indices[: max(0, queda)]


def textos_de(pdfs: list[tuple[str, bytes]]) -> list[str]:
    """El texto plano de cada página de los PDF enviados (vacío en un escaneo)."""
    import fitz  # PyMuPDF

    out: list[str] = []
    for _, b in pdfs:
        with fitz.open(stream=b, filetype="pdf") as doc:
            out.extend(plano(p.get_text("text")) for p in doc)
    return out


def comprobar_pdfs(salida: dict, pdfs: list[tuple[str, bytes]]) -> dict:
    """Sin modelo: deja los nombres de 3 palabras o más (sin títulos), quita los repetidos y marca `verificada` si todas
    sus palabras están en el texto de una misma página. Lo llama leer.py después de leer."""
    textos = textos_de(pdfs)
    paginas = [f" {t} " for t in textos]
    sin_texto = sum(1 for t in textos if len(t.replace(" ", "")) < 40)
    vistos: set[str] = set()
    miembros = []
    for m in salida.get("comite") or []:
        if not isinstance(m, dict):
            continue
        k = clave(str(m.get("nombre_completo") or ""))
        palabras = k.split()
        if len(palabras) < 3 or k in vistos:
            continue
        vistos.add(k)
        en = [i for i, t in enumerate(paginas) if all(f" {w} " in t for w in palabras)]
        # La cita es literal y un acta puede decir «identificado con DNI N° …»: ningún número de documento se guarda.
        cita = re.sub(r"(?<!\d)\d{8}(?!\d)", "…", str(m.get("cita") or ""))
        miembros.append({**m, "cita": cita, "clave": k, "verificada": bool(en), "pagina_texto": (en[0] + 1) if en else None})
    # Las páginas escaneadas (sin texto) no se pueden comprobar así: el nombre se leyó de la imagen.
    return {**salida, "comite": miembros, "paginas_con_texto": len(textos) - sin_texto, "paginas_sin_texto": sin_texto}


def banderas_de(salida: dict) -> list[str]:
    return []
