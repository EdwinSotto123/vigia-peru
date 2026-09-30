"""Salida con FORMA GARANTIZADA para los agentes que investigan con Google Search.

El problema de raíz: web_research, news_research, entity_personnel y person_network no pueden
generar con `response_schema`, porque con esquema + Google Search Vertex deja
`grounding_chunks` vacío (medido 3/3 con 3.6-flash, agents/_shared/models.py). Entonces escriben
"JSON en el texto" y el driver lo valida después con pydantic; la forma no está restringida y el
modelo se desvía: un cargo como frase en vez de objeto, `socios: null` en vez de lista, una nota
sin `titulo`. La validación tolerante descartaba esos ítems (lote de 78 contratos del 29/09/2026:
~200 descartes de esquema, 21 bloques `empresa` enteros).

La solución es separar las dos tareas: la búsqueda se queda como está (con sus fuentes) y, cuando
su salida no calza con el esquema, una segunda llamada SIN herramientas y CON el esquema como
`response_json_schema` la reorganiza. Con decodificación restringida el modelo no puede emitir
una forma que el esquema no admite. La instrucción le prohíbe agregar hechos: solo mueve lo que
la salida ya dice a los campos que corresponden (y las reglas semánticas, como "hallado exige
evidencia", las sigue aplicando pydantic después).

Costo: una llamada corta al modelo rápido, y solo para las salidas que no calzaron.
"""
from __future__ import annotations

import json
import os
import time

from tools._core import _gemini_call_with_retry, _gemini_client, _throttle_gemini, thinking_crudo
from tools.costo_llm import etiquetas

# Palabras de JSON Schema que la decodificación restringida de Gemini usa. El resto (pattern,
# default, minLength/maxLength, title…) se quita: pydantic las sigue validando después.
_CLAVES = {"type", "properties", "required", "items", "enum", "anyOf", "$ref", "$defs",
           "description", "minItems", "maxItems", "minimum", "maximum", "format",
           "additionalProperties"}

_INSTRUCCION = """Eres un transcriptor estricto. Recibes la SALIDA de un agente de investigación \
(JSON con errores de forma, o texto) y debes devolver EXACTAMENTE la misma información \
organizada según el esquema de respuesta.

Reglas:
1. No agregues hechos, nombres, cargos, montos, fechas, RUC, DNI ni URLs que no estén en la salida.
2. Si un campo no tiene dato en la salida, déjalo en null o como lista vacía.
3. Copia textuales las citas, las URLs y los nombres.
4. Si un dato viene en una frase, sepáralo en sus campos (por ejemplo "Gerente general en X \
S.A.C." es cargo "Gerente general" y empresa "X S.A.C."). Si la frase no dice uno de los dos, \
no lo inventes: usa el texto que haya o null si el campo lo admite.
5. Conserva el estado que la salida declara (hallado, sin_dato, no_verificable) y todas las \
evidencias que traiga.
6. No resumas ni descartes ítems: cada elemento de la salida debe quedar en el campo que le \
corresponde, con sus evidencias. Si a un ítem le falta un dato opcional, déjalo en null y \
conserva el ítem."""


def _modelo() -> str:
    try:
        from agents._shared.models import _MODEL_FAST  # type: ignore
        return os.getenv("ESTRUCTURADOR_MODEL", _MODEL_FAST)
    except Exception:
        return os.getenv("ESTRUCTURADOR_MODEL", "gemini-3.5-flash-lite")


def esquema_de_generacion(modelo) -> dict:
    """El JSON Schema del modelo pydantic con solo las palabras que usa Gemini."""
    return _limpiar_nodo(modelo.model_json_schema())


def _limpiar_nodo(n):
    """Recorre el esquema: en un nodo de esquema se quedan las claves de `_CLAVES`; dentro de
    `properties` y `$defs` las claves son NOMBRES (de campo o de definición) y se conservan todas."""
    if isinstance(n, list):
        return [_limpiar_nodo(x) for x in n]
    if not isinstance(n, dict):
        return n
    out = {}
    for k, v in n.items():
        if k in ("properties", "$defs") and isinstance(v, dict):
            out[k] = {nombre: _limpiar_nodo(sub) for nombre, sub in v.items()}
        elif k in _CLAVES:
            out[k] = _limpiar_nodo(v)
    return out


def _texto(salida) -> str:
    if isinstance(salida, (dict, list)):
        return json.dumps(salida, ensure_ascii=False)
    return str(salida or "")


def estructurar(salida, modelo, *, agente: str, max_chars: int = 60_000) -> tuple[dict | None, dict]:
    """Reorganiza `salida` según el modelo pydantic `modelo` con decodificación restringida.

    Devuelve (datos | None, info). `info` lleva segundos, modelo y error para la traza. Nunca
    lanza: si la llamada falla, el driver se queda con la validación tolerante de siempre."""
    t0 = time.monotonic()
    info: dict = {"modelo": _modelo(), "agente": agente}
    texto = _texto(salida)
    if not texto.strip():
        info["error"] = "salida vacía"
        return None, info
    if len(texto) > max_chars:
        info["recortado_de"] = len(texto)
        texto = texto[:max_chars]
    try:
        from google.genai import types as gt
        cfg = gt.GenerateContentConfig(
            temperature=0.0,
            response_mime_type="application/json",
            response_json_schema=esquema_de_generacion(modelo),
            system_instruction=_INSTRUCCION,
            thinking_config=thinking_crudo("estructurador", info["modelo"], "minimal"),
            http_options=gt.HttpOptions(timeout=90_000),
            labels=etiquetas(f"estructurar_{agente}"),
        )
        client = _gemini_client()
        with _throttle_gemini():
            resp = _gemini_call_with_retry(lambda: client.models.generate_content(
                model=info["modelo"], contents=[f"SALIDA DEL AGENTE {agente}:\n\n{texto}"], config=cfg))
        datos = json.loads(resp.text or "null")
        if not isinstance(datos, dict):
            info["error"] = "respuesta sin objeto"
            return None, info
        return datos, info
    except Exception as e:
        info["error"] = f"{type(e).__name__}: {str(e)[:200]}"
        return None, info
    finally:
        info["segundos"] = round(time.monotonic() - t0, 2)
