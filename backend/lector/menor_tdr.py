"""Lector del requerimiento de un contrato menor (≤8 UIT): los términos de referencia o las especificaciones técnicas que
la entidad publicó en el SEACE para pedir cotizaciones (prod6, espejado en el R2: seace/menores/req/<id>.pdf).

Extrae HECHOS: qué se pide, para qué, quién lo pide, el perfil exigido al proveedor, las marcas que nombra y si nombra a
quién contratar. Las banderas salen de reglas (banderas_de); las que dependen de lo que el modelo juzga (una marca sin
«o equivalente», un proveedor nombrado) se publican sólo si DOS lecturas independientes coinciden (migración 252).
Las que necesitan el monto del contrato (experiencia exigida desproporcionada) se calculan en la base, no aquí.
"""
from __future__ import annotations

CLASE = "menor_tdr"
VERSION = "v1"
TOPE_PAGINAS = 25

SISTEMA = """Lees el requerimiento de una contratación menor del Estado peruano (hasta 8 UIT, sin proceso de selección):
los términos de referencia (servicios) o las especificaciones técnicas (bienes) que la entidad publicó para pedir
cotizaciones.

Extrae SOLO lo que dice el documento. Si algo no aparece: null en números, cadena vacía en textos, lista vacía.
Montos en soles, sin separadores. No inventes montos, plazos ni requisitos.

items: lo que se pide, uno por línea del requerimiento (hasta 30), con su cantidad y unidad si las dice.
perfil_proveedor: lo que se exige a quien preste el servicio o venda el bien (formación, años de experiencia, monto
facturado mínimo), con una cita copiada del documento. Nunca nombres de personas en estos campos.
requisitos: cada requisito exigido al proveedor (experiencia, título, colegiatura, certificación, registro, equipo,
local, otro), con una cita breve copiada del documento.
marcas: SOLO marcas comerciales, fabricantes o modelos que el documento exige o nombra para lo que se compra, con una
cita copiada palabra por palabra; con_equivalente es true si la misma frase admite «o equivalente», «similar» o
«referencial».
proveedor_nombrado: true SOLO si el documento dice a qué persona o empresa concreta se contratará o a quién se le
comprará (por su nombre, RUC o DNI), antes de las cotizaciones; con la cita. Nombrar a la entidad, al área usuaria o a
un funcionario que firma NO cuenta."""

PEDIDO = "Extrae del requerimiento lo que pide el esquema."

_TXT = {"type": "string"}
_NUM = {"type": ["number", "null"]}
_CITA = {"type": "string", "description": "copiada del documento, breve"}
ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["es_requerimiento", "tipo", "objeto", "finalidad", "area_usuaria", "items", "plazo_dias", "lugar",
                 "perfil_proveedor", "requisitos", "marcas", "proveedor_nombrado", "forma_pago", "penalidad",
                 "monto_estimado", "confianza"],
    "properties": {
        "es_requerimiento": {"type": "boolean", "description": "Si el documento es un requerimiento (TDR o especificaciones)"},
        "tipo": {"type": "string", "enum": ["terminos_de_referencia", "especificaciones_tecnicas", "otro"]},
        "objeto": {"type": "string", "description": "Qué se contrata, en una frase"},
        "finalidad": {"type": "string", "description": "Para qué, según el documento (finalidad pública)"},
        "area_usuaria": _TXT,
        "items": {
            "type": "array",
            "items": {"type": "object", "additionalProperties": False,
                      "required": ["descripcion", "cantidad", "unidad", "caracteristicas"],
                      "properties": {"descripcion": _TXT, "cantidad": _NUM, "unidad": _TXT,
                                     "caracteristicas": {"type": "string", "description": "las principales, breve"}}},
        },
        "plazo_dias": {"type": ["integer", "null"], "description": "Plazo de ejecución o entrega, en días calendario"},
        "lugar": _TXT,
        "perfil_proveedor": {
            "type": "object", "additionalProperties": False,
            "required": ["tipo", "formacion", "experiencia_anios", "experiencia_monto", "cita"],
            "properties": {"tipo": {"type": "string", "enum": ["persona_natural", "empresa", "cualquiera", "no_dice"]},
                           "formacion": _TXT, "experiencia_anios": _NUM, "experiencia_monto": _NUM, "cita": _CITA},
        },
        "requisitos": {
            "type": "array",
            "items": {"type": "object", "additionalProperties": False, "required": ["tipo", "requisito", "cita"],
                      "properties": {"tipo": {"type": "string", "enum": ["experiencia", "titulo", "colegiatura", "certificacion",
                                                                          "registro", "equipo", "local", "otro"]},
                                     "requisito": _TXT, "cita": _CITA}},
        },
        "marcas": {
            "type": "array",
            "items": {"type": "object", "additionalProperties": False, "required": ["marca", "con_equivalente", "cita"],
                      "properties": {"marca": _TXT, "con_equivalente": {"type": "boolean"}, "cita": _CITA}},
        },
        "proveedor_nombrado": {
            "type": "object", "additionalProperties": False, "required": ["nombrado", "cita"],
            "properties": {"nombrado": {"type": "boolean"}, "cita": _CITA},
        },
        "forma_pago": _TXT,
        "penalidad": _TXT,
        "monto_estimado": {"type": ["number", "null"], "description": "Sólo si el documento dice el monto o el valor estimado"},
        "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
    },
}

# Todas se publican sólo con dos lecturas que coinciden (la segunda corre sólo donde la primera encontró alguna).
BANDERAS = ["tdr_marca_sin_equivalente", "tdr_proveedor_nombrado", "tdr_experiencia_alta", "tdr_monto_distinto"]
BANDERAS_A_CONFIRMAR = BANDERAS


def banderas_de(salida: dict) -> list[str]:
    out = set()
    if not salida.get("es_requerimiento"):
        return []
    if any(not m.get("con_equivalente") and (m.get("marca") or "").strip() and (m.get("cita") or "").strip()
           for m in salida.get("marcas") or []):
        out.add("tdr_marca_sin_equivalente")
    pn = salida.get("proveedor_nombrado") or {}
    if pn.get("nombrado") and (pn.get("cita") or "").strip():
        out.add("tdr_proveedor_nombrado")
    return sorted(out)


def banderas_contexto(salida: dict, ctx: dict) -> list[str]:
    """Las que comparan con lo registrado en el SEACE (`ctx`: monto y moneda del contrato menor)."""
    if not salida.get("es_requerimiento") or ctx.get("moneda") not in (None, "PEN"):
        return []
    out = []
    monto = float(ctx.get("monto") or 0)
    exp = (salida.get("perfil_proveedor") or {}).get("experiencia_monto")
    if monto > 0 and isinstance(exp, (int, float)) and exp >= 3 * monto:
        out.append("tdr_experiencia_alta")
    est = salida.get("monto_estimado")
    # Cinco veces más o menos que lo estimado: no es una rebaja ni un reajuste, es otro monto (o uno mal registrado).
    if monto > 0 and isinstance(est, (int, float)) and est > 0 and max(monto / est, est / monto) >= 5:
        out.append("tdr_monto_distinto")
    return out
