"""
Cliente compatible con `genai.Client` respaldado por la API de Anthropic (sin Vertex/Gemini).

Las llamadas DIRECTAS del pipeline (extractor, OCR, sanitize, self-eval, estructurar, precios) hacen
`client.models.generate_content(model=…, contents=…, config=GenerateContentConfig(…))` y leen `resp.text`,
`resp.usage_metadata` y `resp.candidates[0].finish_reason`. Este adaptador acepta lo mismo y lo traduce:

  · contents: str, Part(s) de texto / bytes (PDF → bloque `document`, imagen → bloque `image`) o Content(s)
  · config:   system_instruction, max_output_tokens (temperature NO: Haiku 5.5 la rechaza); `response_schema` (pydantic, genai Schema o dict) con
              `response_mime_type=application/json` → herramienta forzada `responder` y `.text` = su JSON
  · tools=[Tool(google_search=…)]: usa la búsqueda web de Anthropic (herramienta de servidor `web_search`) y devuelve un
              `candidates[0].grounding_metadata` SINTÉTICO (grounding_chunks / grounding_supports con offsets en bytes UTF-8 /
              web_search_queries) hecho con las citas del texto, para que el parser de precios no cambie
  · thinking_config, http_options, labels, top_p: se ignoran (Haiku se llama sin razonamiento: es extracción/clasificación)

Se activa con `LLM_BACKEND=anthropic` (ver `_gemini_client()` en tools/_core.py). Modelo: env LLM_ANTHROPIC_MODEL
(default claude-haiku-5-5) para TODOS los ids pedidos. Clave: ANTHROPIC_API_KEY (+ ANTHROPIC_WORKSPACE_ID).
No cubre `google_search` ni embeddings: los precios con grounding y los embeddings tienen su propio camino.
"""
from __future__ import annotations

import base64
import json
import os
import random
import time
from types import SimpleNamespace

_API = "https://api.anthropic.com/v1/messages"
_TOPE_SALIDA = 64000


def modelo() -> str:
    return os.getenv("LLM_ANTHROPIC_MODEL", "claude-haiku-5-5")


# ── esquema (genai Schema / pydantic / dict) → JSON Schema ────────────────────────────────────────
def _json_schema(s):
    if s is None:
        return None
    if isinstance(s, type) and hasattr(s, "model_json_schema"):
        return s.model_json_schema()
    if hasattr(s, "model_dump") and not isinstance(s, dict):
        s = s.model_dump(exclude_none=True, mode="json")
    return _normalizar(s)


def _normalizar(x):
    if isinstance(x, dict):
        out = {}
        for k, v in x.items():
            if k in ("title", "property_ordering", "propertyOrdering", "nullable", "min_items", "max_items", "minItems", "maxItems"):
                continue  # el JSON Schema de las herramientas no los usa (nullable se aplica abajo)
            if k == "type" and isinstance(v, str):
                out[k] = v.lower()
            else:
                out[k] = _normalizar(v)
        if x.get("nullable") and isinstance(out.get("type"), str):
            out["type"] = [out["type"], "null"]
        return out
    if isinstance(x, list):
        return [_normalizar(i) for i in x]
    return x


# ── contents → mensajes ───────────────────────────────────────────────────────────────────────────
def _bloque(p):
    if isinstance(p, str):
        return {"type": "text", "text": p}
    t = getattr(p, "text", None)
    if t is not None:
        return {"type": "text", "text": t}
    inl = getattr(p, "inline_data", None)
    if inl is not None and getattr(inl, "data", None) is not None:
        datos = base64.standard_b64encode(inl.data).decode("ascii")
        mime = getattr(inl, "mime_type", "") or ""
        tipo = "document" if mime == "application/pdf" else "image"
        return {"type": tipo, "source": {"type": "base64", "media_type": mime, "data": datos}}
    raise ValueError(f"parte no soportada por el adaptador Anthropic: {type(p).__name__}")


def _mensajes(contents):
    if isinstance(contents, str):
        return [{"role": "user", "content": contents}]
    if not isinstance(contents, (list, tuple)):
        contents = [contents]
    if contents and all(hasattr(c, "parts") for c in contents):  # lista de Content
        msgs = []
        for c in contents:
            rol = "assistant" if getattr(c, "role", "user") == "model" else "user"
            msgs.append({"role": rol, "content": [_bloque(p) for p in (c.parts or [])]})
        return msgs
    return [{"role": "user", "content": [_bloque(p) for p in contents]}]


def _sistema(config) -> str | None:
    si = getattr(config, "system_instruction", None)
    if si is None:
        return None
    if isinstance(si, str):
        return si
    partes = getattr(si, "parts", None)
    if partes:
        return "\n".join(getattr(p, "text", "") or "" for p in partes)
    return str(si)


def _etapa(config) -> str:
    labels = getattr(config, "labels", None) or {}
    return str(labels.get("vigia_etapa") or labels.get("adk_agent_name") or "otras")


def _pide_busqueda(config) -> bool:
    return any(getattr(t, "google_search", None) is not None for t in (getattr(config, "tools", None) or []))


def _grounding(d: dict, texto: str):
    """grounding_metadata sintético desde las citas de los bloques `text` de Anthropic (el texto completo es la unión)."""
    from urllib.parse import urlparse
    chunks, indice, supports, consultas, pos = [], {}, [], [], 0
    for b in d.get("content") or []:
        if b.get("type") == "server_tool_use" and isinstance(b.get("input"), dict) and b["input"].get("query"):
            consultas.append(b["input"]["query"])
        if b.get("type") != "text":
            continue
        t = b.get("text") or ""
        ini, fin = pos, pos + len(t.encode("utf-8"))
        pos = fin
        idxs = []
        for c in b.get("citations") or []:
            u = c.get("url")
            if not u:
                continue
            if u not in indice:
                indice[u] = len(chunks)
                chunks.append(SimpleNamespace(web=SimpleNamespace(uri=u, title=c.get("title"), domain=urlparse(u).netloc)))
            if indice[u] not in idxs:
                idxs.append(indice[u])
        if idxs:
            supports.append(SimpleNamespace(segment=SimpleNamespace(start_index=ini, end_index=fin, text=t), grounding_chunk_indices=idxs))
    return SimpleNamespace(grounding_chunks=chunks, grounding_supports=supports, web_search_queries=consultas)


class _Modelos:
    def generate_content(self, *, model=None, contents=None, config=None, **_):
        import requests

        clave = os.getenv("ANTHROPIC_API_KEY")
        if not clave:
            raise RuntimeError("LLM_BACKEND=anthropic pero falta ANTHROPIC_API_KEY")
        headers = {"x-api-key": clave, "anthropic-version": "2023-06-01", "content-type": "application/json"}
        if os.getenv("ANTHROPIC_WORKSPACE_ID"):
            headers["anthropic-workspace-id"] = os.environ["ANTHROPIC_WORKSPACE_ID"]
        mdl = modelo()
        cuerpo = {"model": mdl, "messages": _mensajes(contents),
                  "max_tokens": min(int(getattr(config, "max_output_tokens", None) or _TOPE_SALIDA), _TOPE_SALIDA)}
        sis = _sistema(config)
        if sis:
            cuerpo["system"] = sis
        # Haiku 5.5 rechaza `temperature` (400 "deprecated for this model", medido 2026-10-12): no se manda.
        # LLM_ANTHROPIC_TEMPERATURE=1 la reenvía para modelos que sí la aceptan.
        temp = getattr(config, "temperature", None)
        if temp is not None and os.getenv("LLM_ANTHROPIC_TEMPERATURE") == "1":
            cuerpo["temperature"] = float(temp)
        busca = _pide_busqueda(config)
        if busca:
            cuerpo["tools"] = [{"type": "web_search_20250305", "name": "web_search",
                                "max_uses": int(os.getenv("LLM_ANTHROPIC_MAX_BUSQUEDAS", "5")),
                                "user_location": {"type": "approximate", "timezone": "America/Lima"}}]
        esquema = _json_schema(getattr(config, "response_schema", None) or getattr(config, "response_json_schema", None))
        envuelto = False
        if esquema is not None and not busca:
            if esquema.get("type") != "object":  # una herramienta exige objeto en la raíz
                esquema, envuelto = {"type": "object", "properties": {"valor": esquema}, "required": ["valor"]}, True
            cuerpo["tools"] = [{"name": "responder", "description": "Entrega la respuesta final con este esquema.", "input_schema": esquema}]
            cuerpo["tool_choice"] = {"type": "tool", "name": "responder"}
            cuerpo["thinking"] = {"type": "disabled"}  # una herramienta forzada no admite razonamiento
        elif not busca and "json" in str(getattr(config, "response_mime_type", "") or "").lower():
            cuerpo["system"] = ((sis + "\n\n") if sis else "") + "Responde ÚNICAMENTE con JSON válido, sin texto adicional."
        d = _post(requests, headers, cuerpo)
        texto, finish = "", {"end_turn": "STOP", "tool_use": "STOP", "max_tokens": "MAX_TOKENS", "stop_sequence": "STOP", "refusal": "SAFETY"}.get(d.get("stop_reason"), "OTHER")
        for b in d.get("content") or []:
            if b.get("type") == "tool_use" and b.get("name") == "responder":
                entrada = b.get("input") or {}
                texto = json.dumps(entrada.get("valor") if envuelto else entrada, ensure_ascii=False)
            elif b.get("type") == "text" and (busca or not texto):
                texto += b.get("text") or ""
        uso = d.get("usage") or {}
        um = SimpleNamespace(prompt_token_count=(uso.get("input_tokens") or 0) + (uso.get("cache_read_input_tokens") or 0),
                             cached_content_token_count=uso.get("cache_read_input_tokens") or 0,
                             candidates_token_count=uso.get("output_tokens") or 0, thoughts_token_count=0, traffic_type=None)
        try:
            from tools import costo_llm
            n_bus = int(((uso.get("server_tool_use") or {}).get("web_search_requests")) or 0)
            costo_llm.registrar_externo(mdl, _etapa(config), um, extra_usd=n_bus * float(os.getenv("BUSQUEDA_USD_POR_BUSQUEDA", "0.01")))
        except Exception:
            pass
        cand = SimpleNamespace(finish_reason=finish, content=None, grounding_metadata=_grounding(d, texto) if busca else None)
        return SimpleNamespace(text=texto, usage_metadata=um, candidates=[cand], parsed=None, prompt_feedback=None)


def _post(requests, headers, cuerpo, intentos: int = 3, timeout: float | None = None):
    espera = 2.0
    for i in range(intentos):
        r = requests.post(_API, headers=headers, json=cuerpo, timeout=timeout or float(os.getenv("LLM_ANTHROPIC_TIMEOUT_S", "300")))
        if r.status_code < 400:
            return r.json()
        transitorio = r.status_code in (429, 500, 502, 503, 504, 529)
        if not transitorio or i == intentos - 1:
            raise RuntimeError(f"Anthropic HTTP {r.status_code}: {r.text[:300]}")
        time.sleep(espera + random.uniform(0, 1))
        espera *= 2


class ClienteAnthropic:
    """Sustituto de `genai.Client` para las llamadas directas del pipeline."""

    def __init__(self):
        self.models = _Modelos()
