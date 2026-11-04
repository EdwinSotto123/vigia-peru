"""Lector del contrato firmado (contractSigned): sus condiciones, como hechos.

Las banderas salen de reglas sobre lo extraído (banderas_de), nunca las elige el modelo. Se valida contra
conosce_contratos (monto, fecha de suscripción, contratista): backend/evals/contratos.
"""
from __future__ import annotations

CLASE = "contrato"
TIPOS_DOC = ["contractSigned", "contractAnnexe"]
VERSION = "v1"

SISTEMA = """Lees contratos de contrataciones públicas del Perú (SEACE): el contrato firmado entre la entidad y el contratista
y, a veces, sus anexos o adendas.

Extrae SOLO lo que dice el documento. Si algo no aparece: null en números y fechas, cadena vacía en los textos.
No inventes montos, porcentajes ni fechas.
Montos en soles, sin separadores (si el contrato está en otra moneda, pon la moneda y el monto tal cual). Fechas en
formato AAAA-MM-DD. Porcentajes como número (10 para 10 %).

El contratista puede ser un consorcio: su nombre («CONSORCIO …») y, en integrantes_ruc, los RUC de sus integrantes si
el contrato los da; un consorcio no tiene RUC propio en el contrato: deja ruc en null.

De quien firma por la entidad, sólo el CARGO (nunca el nombre ni el DNI). No extraigas DNI de nadie.

observaciones: SOLO cláusulas que el contrato muestra y que alguien que vigila el gasto querría revisar (una cláusula
fuera de lo común, un pago o adelanto antes de ejecutar, una condición que favorece al contratista de forma inusual).
Cada una con una cita copiada del contrato palabra por palabra. Lo normal es que no haya ninguna: un contrato común no
tiene observaciones; deja la lista vacía."""

PEDIDO = "Extrae del contrato lo que pide el esquema."

_STR = {"type": ["string", "null"]}
_TXT = {"type": "string"}
_NUM = {"type": ["number", "null"]}
CONTROVERSIAS = ["conciliacion_y_arbitraje", "arbitraje", "junta_de_resolucion_de_disputas", "poder_judicial", "otro"]
GARANTIAS = ["carta_fianza", "poliza_de_caucion", "retencion", "no_se_exige", "otro"]

ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["es_contrato", "numero_contrato", "fecha_suscripcion", "moneda", "monto_contratado", "contratista",
                 "objeto", "plazo_dias", "fecha_inicio", "fecha_fin", "forma_de_pago", "garantia_fiel_cumplimiento",
                 "adelanto_directo_pct", "adelanto_materiales_pct", "penalidad_mora_tope_pct", "otras_penalidades",
                 "solucion_controversias", "cargo_firmante_entidad", "observaciones", "confianza"],
    "properties": {
        "es_contrato": {"type": "boolean", "description": "Si el documento es el contrato firmado (o su adenda)"},
        "numero_contrato": _TXT,
        "fecha_suscripcion": _STR,
        "moneda": _TXT,
        "monto_contratado": _NUM,
        "contratista": {
            "type": "object", "additionalProperties": False,
            "required": ["nombre", "ruc", "es_consorcio", "integrantes_ruc"],
            "properties": {"nombre": _TXT, "ruc": _STR, "es_consorcio": {"type": "boolean"},
                           "integrantes_ruc": {"type": "array", "items": {"type": "string"}}},
        },
        "objeto": _TXT,
        "plazo_dias": {"type": ["integer", "null"], "description": "Plazo de ejecución en días calendario"},
        "fecha_inicio": _TXT,
        "fecha_fin": _TXT,
        "forma_de_pago": {**_TXT, "description": "En una frase: pago único, mensual, por valorizaciones, por entregables…"},
        "garantia_fiel_cumplimiento": {
            "type": "object", "additionalProperties": False, "required": ["tipo", "porcentaje"],
            "properties": {"tipo": {"anyOf": [{"type": "string", "enum": GARANTIAS}, {"type": "null"}]}, "porcentaje": _NUM},
        },
        "adelanto_directo_pct": _NUM,
        "adelanto_materiales_pct": _NUM,
        "penalidad_mora_tope_pct": {**_NUM, "description": "Tope de la penalidad por mora, en % del monto"},
        "otras_penalidades": {"type": ["boolean", "null"], "description": "Si fija otras penalidades además de la de mora"},
        "solucion_controversias": {"anyOf": [{"type": "string", "enum": CONTROVERSIAS}, {"type": "null"}]},
        "cargo_firmante_entidad": _TXT,
        "observaciones": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False, "required": ["explicacion", "cita"],
                "properties": {"explicacion": {"type": "string"},
                               "cita": {"type": "string", "description": "Frase copiada del contrato, palabra por palabra"}},
            },
        },
        "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
    },
}

# Reglas con base en la norma (Ley 30225 y su reglamento): adelanto directo hasta 10 % y de materiales hasta 20 % (obras);
# la penalidad por mora tiene un tope del 10 % del monto; la garantía de fiel cumplimiento es el 10 % (salvo excepciones
# de la norma, como las micro y pequeñas empresas con retención: por eso no se marca su falta).
BANDERAS = ["adelanto_directo_sobre_tope", "adelanto_materiales_sobre_tope", "penalidad_sobre_tope", "observaciones_contrato"]


def _num(x) -> float | None:
    return float(x) if isinstance(x, (int, float)) else None


def banderas_de(salida: dict) -> list[str]:
    out = set()
    if (_num(salida.get("adelanto_directo_pct")) or 0) > 10:
        out.add("adelanto_directo_sobre_tope")
    if (_num(salida.get("adelanto_materiales_pct")) or 0) > 20:
        out.add("adelanto_materiales_sobre_tope")
    if (_num(salida.get("penalidad_mora_tope_pct")) or 0) > 10:
        out.add("penalidad_sobre_tope")
    if salida.get("observaciones"):
        out.add("observaciones_contrato")
    return sorted(out)
