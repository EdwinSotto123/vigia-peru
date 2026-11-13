"""Lector del contrato u orden de un contrato menor (≤8 UIT): el PDF que la entidad registró en el Buscador de Contratos
del SEACE (prod4, en vivo: /api/con/documentos/descargar/<idDocumento>).

Extrae HECHOS: el tipo de documento, número, fecha, monto, el RUC del proveedor, los ítems con su precio unitario, el
plazo y la penalidad. Las banderas se calculan en la base (migración 252) porque comparan con lo registrado: el monto
del documento frente al del SEACE, y el RUC del documento frente al del proveedor registrado.
"""
from __future__ import annotations

CLASE = "menor_contrato"
VERSION = "v1"
TOPE_PAGINAS = 12

SISTEMA = """Lees el contrato, la orden de compra o la orden de servicio de una contratación menor del Estado peruano
(hasta 8 UIT), tal como la entidad la registró en el SEACE.

Extrae SOLO lo que dice el documento. Si algo no aparece: null en números, cadena vacía en textos, lista vacía.
Montos en la moneda del documento, sin separadores. La fecha en formato AAAA-MM-DD. El RUC, sólo sus 11 dígitos.
proveedor_ruc: el RUC del PROVEEDOR o contratista (a quien se le compra), nunca el de la entidad que compra.
No inventes montos ni fechas.

items: cada línea del documento (hasta 40) con su cantidad, unidad, precio unitario y subtotal.
firmantes: SOLO los cargos de quienes firman o autorizan (nunca sus nombres ni su DNI)."""

PEDIDO = "Extrae del documento lo que pide el esquema."

_TXT = {"type": "string"}
_NUM = {"type": ["number", "null"]}
ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["es_contrato", "tipo_documento", "numero", "fecha", "monto_total", "moneda", "proveedor_ruc", "items",
                 "plazo_dias", "penalidad", "garantia", "firmantes", "confianza"],
    "properties": {
        "es_contrato": {"type": "boolean", "description": "Si el documento es un contrato o una orden de compra o de servicio"},
        "tipo_documento": {"type": "string", "enum": ["orden_de_compra", "orden_de_servicio", "contrato", "otro"]},
        "numero": _TXT,
        "fecha": {"type": "string", "description": "AAAA-MM-DD, o cadena vacía"},
        "monto_total": _NUM,
        "moneda": {"type": "string", "enum": ["PEN", "USD", "otra", ""]},
        "proveedor_ruc": {"type": "string", "description": "11 dígitos, o cadena vacía"},
        "items": {
            "type": "array",
            "items": {"type": "object", "additionalProperties": False,
                      "required": ["descripcion", "cantidad", "unidad", "precio_unitario", "subtotal"],
                      "properties": {"descripcion": _TXT, "cantidad": _NUM, "unidad": _TXT, "precio_unitario": _NUM,
                                     "subtotal": _NUM}},
        },
        "plazo_dias": {"type": ["integer", "null"]},
        "penalidad": _TXT,
        "garantia": _TXT,
        "firmantes": {"type": "array", "items": {"type": "string", "description": "cargo"}},
        "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
    },
}

# Se publican sólo si dos lecturas coinciden (migración 252): un monto o un RUC mal leído no debe acusar a nadie.
BANDERAS = ["contrato_monto_distinto", "contrato_ruc_distinto"]
BANDERAS_A_CONFIRMAR = BANDERAS


def banderas_de(salida: dict) -> list[str]:
    return []


def banderas_contexto(salida: dict, ctx: dict) -> list[str]:
    """Lo que dice el documento frente a lo registrado en el SEACE (`ctx`: monto, moneda y RUC del proveedor)."""
    if not salida.get("es_contrato"):
        return []
    out = []
    doc, monto = salida.get("monto_total"), float(ctx.get("monto") or 0)
    if (isinstance(doc, (int, float)) and doc > 0 and monto > 0 and salida.get("moneda") in ("PEN", "")
            and ctx.get("moneda") in (None, "PEN") and abs(doc - monto) > max(100.0, 0.05 * monto)
            # con y sin IGV es el mismo monto
            and min(abs(doc - monto * 1.18), abs(doc * 1.18 - monto)) > 0.01 * monto):
        out.append("contrato_monto_distinto")
    ruc = "".join(c for c in str(salida.get("proveedor_ruc") or "") if c.isdigit())
    reg = str(ctx.get("proveedor_ruc") or "")
    # El RUC de la propia entidad no es «otro proveedor»: la lectura tomó el del comprador (15 de 168 el 2026-11-13).
    if (len(ruc) == 11 and ruc[:2] in ("10", "15", "17", "20") and len(reg) == 11 and ruc != reg
            and ruc != str(ctx.get("entidad_ruc") or "")):
        out.append("contrato_ruc_distinto")
    return out
