"""
Cliente compatible con `genai.Client` respaldado por un endpoint tipo OpenAI (`/v1/chat/completions`).

Pensado para el Worker `vigia-llm` (Workers AI con respaldo, ver backend/llm-worker): las llamadas DIRECTAS del
pipeline (extractor, OCR, sanitize, self-eval, estructurar, precios) usan el mismo modelo que los agentes, sin
Vertex/Gemini. Acepta la misma interfaz que las demás llamadas directas y la traduce:

  · contents: str, Part(s) de texto / bytes, Content(s). Un PDF se pasa como su texto (PyMuPDF); un PDF escaneado
              sin texto o una imagen levantan error (el modelo no ve imágenes): el llamador ya degrada en ese caso.
  · config:   system_instruction, max_output_tokens, temperature; `response_schema` / JSON → el esquema va en las
              instrucciones y `.text` es el JSON extraído de la respuesta.
  · tools=[Tool(google_search=…)]: el modelo propone consultas, se buscan con Tavily (TAVILY_API_KEY) y responde
              citando [n]; devuelve un `candidates[0].grounding_metadata` sintético (grounding_chunks /
              grounding_supports con offsets en bytes UTF-8 / web_search_queries) para que el parser de precios no cambie.

Se activa con `LLM_BACKEND=compatible` (ver `_gemini_client()` en tools/_core.py). Endpoint y token: LLM_COMPAT_URL /
LLM_COMPAT_TOKEN, o si faltan WORKERS_AI_URL / WORKERS_AI_TOKEN (los de los agentes). Modelo: LLM_COMPAT_MODEL, o
WORKERS_AI_MODEL, o "default" (el que elija el Worker). No cubre embeddings.
"""
from __future__ import annotations

import json
import os
import random
import re
import time
from types import SimpleNamespace

_TOPE_SALIDA = 16000


def _url() -> str:
    base = (os.getenv("LLM_COMPAT_URL") or os.getenv("WORKERS_AI_URL") or "").rstrip("/")
    if not base:
        raise RuntimeError("LLM_BACKEND=compatible pero falta LLM_COMPAT_URL (o WORKERS_AI_URL)")
    return base if base.endswith("/chat/completions") else base + "/chat/completions"


def modelo(config=None) -> str:
    """El modelo de una llamada directa. Las etapas de `LLM_COMPAT_ETAPAS_CAPAZ` (los jueces y el verificador de
    precio: deciden si una señal se publica) van al modelo capaz; lo demás, al rápido."""
    rapido = os.getenv("LLM_COMPAT_MODEL") or os.getenv("WORKERS_AI_MODEL") or "default"
    capaz = os.getenv("WORKERS_AI_MODEL_SMART")
    if config is not None and capaz:
        etapas = {e.strip() for e in os.getenv("LLM_COMPAT_ETAPAS_CAPAZ", "juez,verificador_precio").split(",") if e.strip()}
        try:
            if _etapa(config) in etapas:
                return capaz
        except Exception:  # noqa: BLE001
            pass
    return rapido


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
        out = {k: (v.lower() if k == "type" and isinstance(v, str) else _normalizar(v))
               for k, v in x.items() if k not in ("title", "property_ordering", "propertyOrdering", "nullable")}
        if x.get("nullable") and isinstance(out.get("type"), str):
            out["type"] = [out["type"], "null"]
        return out
    if isinstance(x, list):
        return [_normalizar(i) for i in x]
    return x


# ── contents → mensajes ───────────────────────────────────────────────────────────────────────────
def _texto_pdf(datos: bytes) -> str:
    import fitz  # PyMuPDF
    with fitz.open(stream=datos, filetype="pdf") as d:
        texto = "\n\n".join(f"[página {i + 1}]\n{p.get_text()}" for i, p in enumerate(d))
    if len(texto.strip()) < 40 * max(1, texto.count("[página")):
        raise ValueError("PDF sin capa de texto: el modelo compatible no lee imágenes")
    return texto


def _bloque_imagen(datos: bytes, mime: str) -> dict:
    """Una imagen como bloque `image_url` (JPEG en base64). El modelo abierto sí lee imágenes (los lectores de
    backend/lector ya le mandan las páginas escaneadas así); antes el agente las rechazaba y 4 685 páginas escaneadas
    de 72 contratos quedaban sin leer (auditoría 2026-11-14). Un PNG se pasa a JPEG: pesa la quinta parte."""
    import base64
    if mime != "image/jpeg":
        import fitz  # PyMuPDF
        pix = fitz.Pixmap(datos)
        # Sin el canal alfa primero (un PNG con transparencia): pasarlo a RGB lo conservaba y el JPEG fallaba con
        # «cannot have alpha» (las imágenes de un Word, 2026-11-24).
        if pix.alpha:
            pix = fitz.Pixmap(pix, 0)
        if pix.n > 3:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        datos = pix.tobytes(output="jpeg", jpg_quality=int(os.getenv("OCR_JPEG_CALIDAD", "72")))
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(datos).decode()}}


def _parte(p):
    """Texto (str) o, para una imagen, su bloque `image_url`."""
    if isinstance(p, str):
        return p
    t = getattr(p, "text", None)
    if t is not None:
        return t
    inl = getattr(p, "inline_data", None)
    if inl is not None and getattr(inl, "data", None) is not None:
        mime = getattr(inl, "mime_type", "") or ""
        if mime == "application/pdf":
            return _texto_pdf(inl.data)
        if mime.startswith("image/"):
            return _bloque_imagen(inl.data, mime)
        raise ValueError(f"tipo de archivo no soportado por el adaptador compatible: {mime}")
    raise ValueError(f"parte no soportada por el adaptador compatible: {type(p).__name__}")


def _contenido(partes):
    """El contenido de un mensaje: un texto, o bloques de texto e imagen en su orden si hay alguna imagen."""
    piezas = [_parte(p) for p in partes]
    if all(isinstance(x, str) for x in piezas):
        return "\n\n".join(piezas)
    bloques: list[dict] = []
    for x in piezas:
        if isinstance(x, str):
            if bloques and bloques[-1]["type"] == "text":
                bloques[-1]["text"] += "\n\n" + x
            else:
                bloques.append({"type": "text", "text": x})
        else:
            bloques.append(x)
    return bloques


def _solo_texto(contenido) -> str:
    if isinstance(contenido, str):
        return contenido
    return "\n\n".join(b.get("text", "") for b in contenido if isinstance(b, dict) and b.get("type") == "text")


def _mensajes(contents):
    if isinstance(contents, str):
        return [{"role": "user", "content": contents}]
    if not isinstance(contents, (list, tuple)):
        contents = [contents]
    if contents and all(hasattr(c, "parts") for c in contents):  # lista de Content
        return [{"role": "assistant" if getattr(c, "role", "user") == "model" else "user",
                 "content": _contenido(c.parts or [])} for c in contents]
    return [{"role": "user", "content": _contenido(contents)}]


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


def _json_de(texto: str) -> str:
    """El primer valor JSON de la respuesta (sin cercas ```json ni texto alrededor)."""
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", texto.strip())
    for ini in (i for i, ch in enumerate(t) if ch in "{["):
        try:
            v, _ = json.JSONDecoder().raw_decode(t[ini:])
            return json.dumps(v, ensure_ascii=False)
        except ValueError:
            continue
    return t


# ── búsqueda (Tavily) → grounding sintético ───────────────────────────────────────────────────────
def _tavily(consulta: str, n: int) -> list[dict]:
    import requests
    from tools.busqueda import _resultados_externos
    clave = os.getenv("TAVILY_API_KEY")
    if not clave:
        return []
    r = requests.post("https://api.tavily.com/search", headers={"Authorization": f"Bearer {clave}"},
                      json={"query": consulta, "max_results": n, "country": "peru"},
                      timeout=float(os.getenv("BUSQUEDA_TIMEOUT_S", "90")))
    return _resultados_externos("tavily", r.json()) if r.status_code < 400 else []


def _grounding(texto: str, fuentes: list[dict], consultas: list[str]):
    """Cada línea con marcas [n] es un segmento apoyado en esas fuentes (offsets en bytes UTF-8, como Gemini)."""
    from urllib.parse import urlparse
    chunks = [SimpleNamespace(web=SimpleNamespace(uri=f["url"], title=f.get("titulo"), domain=urlparse(f["url"]).netloc))
              for f in fuentes]
    supports, pos = [], 0
    for linea in texto.splitlines(keepends=True):
        b = len(linea.encode("utf-8"))
        idxs = sorted({int(m) - 1 for m in re.findall(r"\[(\d+)\]", linea) if 0 < int(m) <= len(fuentes)})
        if idxs:
            supports.append(SimpleNamespace(segment=SimpleNamespace(start_index=pos, end_index=pos + b, text=linea),
                                            grounding_chunk_indices=idxs))
        pos += b
    return SimpleNamespace(grounding_chunks=chunks, grounding_supports=supports, web_search_queries=consultas)


class _Modelos:
    def generate_content(self, *, model=None, contents=None, config=None, **_):
        mensajes = _mensajes(contents)
        sis = _sistema(config) or ""
        tope = min(int(getattr(config, "max_output_tokens", None) or _TOPE_SALIDA), _TOPE_SALIDA)
        busca = _pide_busqueda(config)
        n_busquedas, fuentes, consultas = 0, [], []
        if busca:
            pedido = _solo_texto(mensajes[-1]["content"])[:6000]
            plan, _ = _llamar([{"role": "system", "content": "Devuelve SOLO un arreglo JSON con 1 a 3 consultas de búsqueda web "
                                "(en español, foco Perú) para responder la tarea del usuario."},
                               {"role": "user", "content": pedido}], 400, config)
            try:
                consultas = [str(q) for q in json.loads(_json_de(plan)) if str(q).strip()][:3]
            except (ValueError, TypeError):
                consultas = [pedido[:300]]
            vistos = set()
            for q in consultas:
                n_busquedas += 1
                for f in _tavily(q, int(os.getenv("BUSQUEDA_N_RESULTADOS", "6"))):
                    if f["url"] not in vistos:
                        vistos.add(f["url"])
                        fuentes.append(f)
            fuentes = fuentes[:12]
            ctx = "\n".join(f"[{i + 1}] {f.get('titulo') or ''} — {f['url']}\n{f.get('extracto') or ''}" for i, f in enumerate(fuentes))
            sis = (sis + "\n\n" if sis else "") + ("Resultados de búsqueda web (úsalos como fuente; cita cada dato con su número entre "
                                                  "corchetes, p. ej. [2]; no inventes URLs ni precios):\n" + (ctx or "(sin resultados)"))
        esquema = getattr(config, "response_schema", None) or getattr(config, "response_json_schema", None)
        pide_json = esquema is not None or "json" in str(getattr(config, "response_mime_type", "") or "").lower()
        if pide_json and not busca:
            js = _json_schema(esquema)
            sis = (sis + "\n\n" if sis else "") + "Responde ÚNICAMENTE con JSON válido, sin texto adicional." + (
                f"\nEsquema JSON de la respuesta:\n{json.dumps(js, ensure_ascii=False)}" if js else "")
        msgs = ([{"role": "system", "content": sis}] if sis else []) + mensajes
        texto, d = _llamar(msgs, tope, config)
        if pide_json and not busca:
            texto = _json_de(texto)
        fin = {"stop": "STOP", "length": "MAX_TOKENS", "content_filter": "SAFETY", "tool_calls": "STOP"}.get(
            ((d.get("choices") or [{}])[0]).get("finish_reason"), "OTHER")
        uso = d.get("usage") or {}
        um = SimpleNamespace(prompt_token_count=uso.get("prompt_tokens") or 0, cached_content_token_count=0,
                             candidates_token_count=uso.get("completion_tokens") or 0, thoughts_token_count=0, traffic_type=None)
        try:
            from tools import costo_llm
            costo_llm.registrar_externo(modelo(config), _etapa(config), um,
                                        extra_usd=n_busquedas * float(os.getenv("BUSQUEDA_USD_POR_BUSQUEDA", "0.008")))
        except Exception:
            pass
        cand = SimpleNamespace(finish_reason=fin, content=None, grounding_metadata=_grounding(texto, fuentes, consultas) if busca else None)
        # `model_version` como en genai: el modelo que RESPONDIÓ (el que dice el Worker, o el pedido al Worker). El
        # `model=` de la llamada se ignora aquí; quien lo anotaba como «el modelo» dejaba «gemini-3.6-flash» en lecturas
        # que hizo Haiku (2026-11-05).
        return SimpleNamespace(text=texto, usage_metadata=um, candidates=[cand], parsed=None, prompt_feedback=None,
                               model_version=str(d.get("model") or modelo(config)))


# Modelos que rechazan `temperature` con HTTP 400 ("deprecated for this model"): se aprende en la primera
# respuesta y ya no se manda. Antes cada llamada directa fallaba (mercado, jueces, saneo, estructurar).
_SIN_TEMPERATURA: set[str] = set()


def _llamar(mensajes: list[dict], tope: int, config, intentos: int = 3) -> tuple[str, dict]:
    import requests
    cuerpo = {"model": modelo(config), "messages": mensajes, "max_tokens": tope}
    temp = getattr(config, "temperature", None)
    if temp is not None and modelo(config) not in _SIN_TEMPERATURA:
        cuerpo["temperature"] = float(temp)
    if os.getenv("WORKERS_AI_REASONING"):
        cuerpo["reasoning_effort"] = os.environ["WORKERS_AI_REASONING"]
    token = os.getenv("LLM_COMPAT_TOKEN") or os.getenv("WORKERS_AI_TOKEN") or ""
    headers = {"authorization": f"Bearer {token}", "content-type": "application/json"}
    # Sin respaldo (WORKERS_AI_SIN_RESPALDO, por defecto sí): si Workers AI falla, el error, nunca el proveedor de respaldo.
    if os.getenv("WORKERS_AI_SIN_RESPALDO", "1").strip().lower() not in ("0", "false", "no", "off"):
        headers["x-vigia-respaldo"] = "nunca"
    espera = 2.0
    for i in range(intentos):
        try:
            r = requests.post(_url(), headers=headers, json=cuerpo, timeout=float(os.getenv("LLM_COMPAT_TIMEOUT_S", "180")))
        except requests.RequestException as e:
            if i == intentos - 1:
                raise RuntimeError(f"LLM compatible sin conexión: {type(e).__name__}") from e
            time.sleep(espera + random.uniform(0, 1))
            espera *= 2
            continue
        if r.status_code < 400:
            d = r.json()
            msg = ((d.get("choices") or [{}])[0]).get("message") or {}
            if not (msg.get("content") or "").strip() and not msg.get("tool_calls") and i < intentos - 1:
                time.sleep(espera + random.uniform(0, 1))   # 200 con el contenido vacío: se reintenta
                espera *= 2
                continue
            return (msg.get("content") or ""), d
        if r.status_code == 400 and "temperature" in cuerpo and "temperature" in r.text:
            _SIN_TEMPERATURA.add(modelo(config))
            cuerpo.pop("temperature")
            r = requests.post(_url(), headers=headers, json=cuerpo, timeout=float(os.getenv("LLM_COMPAT_TIMEOUT_S", "180")))
            if r.status_code < 400:
                d = r.json()
                return (((d.get("choices") or [{}])[0]).get("message") or {}).get("content") or "", d
        if r.status_code not in (429, 500, 502, 503, 504) or i == intentos - 1:
            raise RuntimeError(f"LLM compatible HTTP {r.status_code}: {r.text[:300]}")
        time.sleep(espera + random.uniform(0, 1))
        espera *= 2
    raise RuntimeError("LLM compatible: sin respuesta")


class ClienteCompatible:
    """Sustituto de `genai.Client` para las llamadas directas del pipeline."""

    def __init__(self):
        self.models = _Modelos()
