"""Lector del pliego de absolución de consultas y observaciones (clarifications): lo que preguntaron o reclamaron los
participantes sobre las bases y qué respondió la entidad, como hechos.

Las banderas salen de reglas sobre lo extraído (banderas_de). No hay un registro oficial con qué compararlo: se mide la
estabilidad entre dos lecturas (backend/evals/consultas).
"""
from __future__ import annotations

CLASE = "consultas"
TIPOS_DOC = ["clarifications"]
VERSION = "v1"

SISTEMA = """Lees el pliego de absolución de consultas y observaciones de un procedimiento de selección del Perú (SEACE):
lo que los participantes preguntaron u observaron sobre las bases y lo que respondió el comité o la entidad.

Extrae SOLO lo que dice el documento. Una «consulta» pide una aclaración; una «observación» cuestiona las bases (un
requisito, una especificación, un plazo) y pide cambiarlas. Cuenta cada pregunta u observación numerada una vez.

tema de cada observación:
  requisito_calificacion  experiencia, personal clave, equipamiento, capacidad legal o técnica exigida
  especificacion_tecnica  características del bien, servicio u obra pedidos
  marca_o_proveedor       el participante dice que algo apunta a una marca, un fabricante o un proveedor
  plazo_o_lugar           plazos, lugar de entrega, cronograma
  forma_o_garantias       garantías, forma de pago, penalidades, documentos de presentación
  otro                    otro tema
respuesta: acogida (se cambia lo pedido), acogida_parcial, no_acogida, o null si el documento no lo dice.

denuncias: SOLO si un participante dice de forma explícita que las bases están dirigidas o favorecen a alguien
(«direccionamiento», «sólo cumple la marca…», «requisito que únicamente cumple…»). Copia su frase palabra por palabra.
Si no hay, deja la lista vacía. No extraigas nombres ni DNI de personas; de los participantes, sólo su razón social."""

PEDIDO = "Extrae del pliego de consultas y observaciones lo que pide el esquema."

TEMAS = ["requisito_calificacion", "especificacion_tecnica", "marca_o_proveedor", "plazo_o_lugar", "forma_o_garantias", "otro"]
RESPUESTAS = ["acogida", "acogida_parcial", "no_acogida"]

ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["es_pliego", "n_consultas", "n_participantes", "observaciones", "denuncias", "confianza"],
    "properties": {
        "es_pliego": {"type": "boolean", "description": "Si el documento es el pliego de consultas y observaciones"},
        "n_consultas": {"type": "integer"},
        "n_participantes": {"type": ["integer", "null"], "description": "Cuántos participantes distintos preguntaron u observaron"},
        "observaciones": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False, "required": ["tema", "respuesta", "resumen"],
                "properties": {
                    "tema": {"type": "string", "enum": TEMAS},
                    "respuesta": {"anyOf": [{"type": "string", "enum": RESPUESTAS}, {"type": "null"}]},
                    "resumen": {"type": "string", "description": "Qué se pidió cambiar, en una frase"},
                },
            },
        },
        "denuncias": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False, "required": ["explicacion", "cita"],
                "properties": {"explicacion": {"type": "string"},
                               "cita": {"type": "string", "description": "Frase del participante, palabra por palabra"}},
            },
        },
        "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
    },
}

BANDERAS = ["observaciones_a_requisitos_rechazadas", "denuncia_de_direccionamiento"]


def banderas_de(salida: dict) -> list[str]:
    out = set()
    sobre_requisitos = [o for o in salida.get("observaciones") or []
                        if o.get("tema") in ("requisito_calificacion", "especificacion_tecnica", "marca_o_proveedor")]
    con_respuesta = [o for o in sobre_requisitos if o.get("respuesta")]
    if len(con_respuesta) >= 2 and all(o["respuesta"] == "no_acogida" for o in con_respuesta):
        out.add("observaciones_a_requisitos_rechazadas")
    if salida.get("denuncias"):
        out.add("denuncia_de_direccionamiento")
    return sorted(out)
