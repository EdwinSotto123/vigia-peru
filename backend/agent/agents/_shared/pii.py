"""Redacción de DNI en lo que SALE del pipeline hacia terceros o a registros técnicos:
trazas de Arize/Phoenix, `agent_trace` guardado en la base y previsualizaciones de logs.

Auditoría 2026-09-26: Phoenix Cloud guardaba 823 DNI distintos en claro (prompts, respuestas y
resultados de tools; sobre todo la red de personas). No toca lo que va al modelo ni los datos
del dossier (el frontend los muestra bajo vidrio, revelables al clic).

Solo se tapa un número de 8 dígitos cuando está pegado a una etiqueta de documento (dni,
numero_documento, "DNI N°", …), con cualquier nivel de escape JSON en medio. Un 8 dígitos suelto
(montos, códigos) no se toca. Los RUC tampoco: son públicos en el SEACE.
"""
from __future__ import annotations

import os
import re

MASCARA = "[DNI]"

_DNI_CTX = re.compile(
    r"(?i)((?:\bdni|numero_documento|nro_documento|num_documento|documento_identidad|doc_identidad"
    r"|d\.n\.i\.?)[^0-9a-z]{0,24}(?:n(?:ro|°|º|o)\.?[^0-9a-z]{0,4})?)(\d{8})(?!\d)")


def activo() -> bool:
    """Se apaga con TRACE_REDACTAR_PII=0 (solo para depurar en local)."""
    return os.getenv("TRACE_REDACTAR_PII", "1").strip() != "0"


def redactar_texto(s):
    """Texto con cada DNI etiquetado reemplazado por [DNI]. Cualquier otro tipo, igual."""
    if not isinstance(s, str) or len(s) < 9:
        return s
    return _DNI_CTX.sub(lambda m: m.group(1) + MASCARA, s)


def redactar(obj):
    """Copia de `obj` (dict/list/tuple/str anidados) con los DNI tapados, en claves y valores."""
    if isinstance(obj, str):
        return redactar_texto(obj)
    if isinstance(obj, dict):
        # Valor de una clave de documento (p. ej. {"dni": "12345678"}): se tapa aunque sea un int,
        # y con 7 dígitos si vino como número y perdió el cero inicial.
        out = {}
        for k, v in obj.items():
            if isinstance(k, str) and k.lower() in ("dni", "numero_documento", "nro_documento", "documento_identidad") \
                    and isinstance(v, (str, int)) and not isinstance(v, bool) \
                    and re.fullmatch(r"\d{7,8}", str(v).strip()):
                out[k] = MASCARA
            else:
                out[k] = redactar(v)
        return out
    if isinstance(obj, list):
        return [redactar(v) for v in obj]
    if isinstance(obj, tuple):
        return tuple(redactar(v) for v in obj)
    return obj


def instalar_en_opentelemetry() -> bool:
    """Tapa los DNI en TODO atributo que se guarde en un span o evento de OpenTelemetry, antes
    de que lo vea cualquier exportador (Arize, Phoenix u otro). Se parchea el punto único de
    almacenamiento (`BoundedAttributes.__setitem__`), así da igual qué instrumentor lo escriba.
    Idempotente."""
    if not activo():
        return False
    try:
        from opentelemetry import attributes as _attrs
    except Exception:
        return False
    cls = _attrs.BoundedAttributes
    if getattr(cls.__setitem__, "_vigia_pii", False):
        return True
    original = cls.__setitem__

    def __setitem__(self, key, value):
        if isinstance(value, str):
            value = redactar_texto(value)
        elif isinstance(value, (list, tuple)) and any(isinstance(v, str) for v in value):
            value = type(value)(redactar_texto(v) for v in value)
        return original(self, key, value)

    __setitem__._vigia_pii = True
    cls.__setitem__ = __setitem__
    return True
