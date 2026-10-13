"""
Búsqueda web propia (sin Google/Vertex): reemplaza al `google_search` nativo de Gemini.

`google_search(consulta)` hace UNA llamada a la API de Anthropic con la herramienta de servidor `web_search` y devuelve
{resumen, fuentes[{titulo,url}], citas[{texto,url}]}. Las URLs reales se publican en `state["grounding_urls"]`, que es de
donde las lee `verify.py` para dar por respaldada una URL (el modelo nunca las inventa).

Tiene el MISMO nombre que la herramienta de Gemini a propósito: los prompts de los agentes dicen "tu única herramienta es
`google_search`". `herramienta_busqueda()` elige cuál usar (env `BUSQUEDA_WEB=google|anthropic`, default google).

Proveedor (env BUSQUEDA_PROVEEDOR): `anthropic` (default; web_search de Anthropic, ~US$0,01 por búsqueda + los tokens de los resultados),
`serper` (SERPER_API_KEY, resultados de Google, ~US$0,001), `brave` (BRAVE_API_KEY) o `tavily` (TAVILY_API_KEY). Los externos devuelven
los resultados (título, URL, extracto) sin llamar a ningún LLM: el agente que llama a la herramienta es quien los lee.

Env: ANTHROPIC_API_KEY (+ ANTHROPIC_WORKSPACE_ID si la clave no es de un workspace), BUSQUEDA_MODELO (claude-haiku-5-5),
BUSQUEDA_MAX_USOS (3 búsquedas por consulta), BUSQUEDA_TIMEOUT_S (90).
Costo: tokens del modelo + USD 0,01 por búsqueda (tarifa de lista de web_search; verificar en la consola de Anthropic).
"""
from __future__ import annotations

import os
from types import SimpleNamespace

USD_POR_BUSQUEDA = float(os.getenv("BUSQUEDA_USD_POR_BUSQUEDA", "0.01"))
_API = "https://api.anthropic.com/v1/messages"
_SISTEMA = (
    "Eres un buscador para una auditoría anticorrupción en Perú. Busca en la web y resume SOLO lo que dicen las fuentes "
    "encontradas, citándolas. Si no hay resultados útiles, dilo. No inventes datos, cifras ni URLs."
)


def _parsear(d: dict) -> dict:
    textos, fuentes, citas = [], [], []
    vistas = set()
    for b in d.get("content") or []:
        if b.get("type") == "text":
            textos.append(b.get("text") or "")
            for c in b.get("citations") or []:
                if c.get("url"):
                    citas.append({"texto": (c.get("cited_text") or "")[:300], "url": c["url"], "titulo": c.get("title")})
        elif b.get("type") == "web_search_tool_result" and isinstance(b.get("content"), list):
            for r in b["content"]:
                u = r.get("url")
                if u and u not in vistas:
                    vistas.add(u)
                    fuentes.append({"titulo": r.get("title"), "url": u, "fecha": r.get("page_age")})
    for c in citas:
        if c["url"] not in vistas:
            vistas.add(c["url"])
            fuentes.append({"titulo": c.get("titulo"), "url": c["url"]})
    uso = d.get("usage") or {}
    return {"resumen": "".join(textos).strip(), "fuentes": fuentes, "citas": citas,
            "_busquedas": int((uso.get("server_tool_use") or {}).get("web_search_requests") or 0), "_uso": uso}


def _publicar(state, fuentes: list[dict]) -> None:
    if state is None:
        return
    urls = state.get("grounding_urls")
    if not isinstance(urls, list):
        urls = list(urls) if isinstance(urls, (set, tuple)) else []
    for f in fuentes:
        if f["url"] not in urls:
            urls.append(f["url"])
    state["grounding_urls"] = urls


def _registrar_costo(modelo: str, uso: dict, n_busquedas: int) -> None:
    try:
        from tools import costo_llm
        um = SimpleNamespace(prompt_token_count=(uso.get("input_tokens") or 0) + (uso.get("cache_read_input_tokens") or 0),
                             cached_content_token_count=uso.get("cache_read_input_tokens") or 0,
                             candidates_token_count=uso.get("output_tokens") or 0, thoughts_token_count=0)
        costo_llm.registrar_externo(modelo, "busqueda_web", um, extra_usd=n_busquedas * USD_POR_BUSQUEDA)
    except Exception:
        pass


def _resultados_externos(proveedor: str, d: dict) -> list[dict]:
    """Normaliza la respuesta de Serper / Brave / Tavily a [{titulo, url, extracto, fecha}]."""
    if proveedor == "serper":
        filas = [(r.get("title"), r.get("link"), r.get("snippet"), r.get("date")) for r in d.get("organic") or []]
        kg = d.get("answerBox") or {}
        if kg.get("snippet") or kg.get("answer"):
            filas.insert(0, (kg.get("title"), kg.get("link"), kg.get("snippet") or kg.get("answer"), None))
    elif proveedor == "brave":
        filas = [(r.get("title"), r.get("url"), r.get("description"), r.get("age")) for r in (d.get("web") or {}).get("results") or []]
    else:  # tavily
        filas = [(r.get("title"), r.get("url"), r.get("content"), r.get("published_date")) for r in d.get("results") or []]
    return [{"titulo": t, "url": u, "extracto": (e or "")[:500], "fecha": f} for t, u, e, f in filas if u]


async def _buscar_externo(proveedor: str, consulta: str, cli) -> dict:
    n = int(os.getenv("BUSQUEDA_N_RESULTADOS", "8"))
    if proveedor == "serper":
        r = await cli.post("https://google.serper.dev/search", headers={"X-API-KEY": os.environ["SERPER_API_KEY"]},
                           json={"q": consulta, "gl": "pe", "hl": "es", "num": n})
    elif proveedor == "brave":
        r = await cli.get("https://api.search.brave.com/res/v1/web/search", headers={"X-Subscription-Token": os.environ["BRAVE_API_KEY"]},
                          params={"q": consulta, "country": "pe", "search_lang": "es", "count": n})
    else:
        r = await cli.post("https://api.tavily.com/search", headers={"Authorization": f"Bearer {os.environ['TAVILY_API_KEY']}"},
                           json={"query": consulta, "max_results": n, "country": "peru"})
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code} {r.text[:200]}")
    res = _resultados_externos(proveedor, r.json())
    return {"resumen": "\n".join(f"- {x['titulo']}: {x['extracto']} ({x['url']})" for x in res), "fuentes": [
        {"titulo": x["titulo"], "url": x["url"], "fecha": x["fecha"]} for x in res], "citas": [], "resultados": res}


async def google_search(consulta: str, tool_context=None) -> dict:
    """Busca en la web (con foco en Perú) y devuelve un resumen con citas y las fuentes reales (URL, título).
    Usa consultas concretas (nombre completo, RUC, entidad, año). Solo las URLs de `fuentes` existen."""
    import httpx

    proveedor = os.getenv("BUSQUEDA_PROVEEDOR", "anthropic").strip().lower()
    if proveedor in ("serper", "brave", "tavily"):
        if not os.getenv(f"{proveedor.upper()}_API_KEY"):
            return {"error": f"búsqueda web no configurada (falta {proveedor.upper()}_API_KEY)", "resumen": "", "fuentes": [], "citas": []}
        try:
            async with httpx.AsyncClient(timeout=float(os.getenv("BUSQUEDA_TIMEOUT_S", "90"))) as cli:
                res = await _buscar_externo(proveedor, consulta, cli)
        except Exception as e:  # noqa: BLE001
            return {"error": f"búsqueda falló: {type(e).__name__}: {str(e)[:200]}", "resumen": "", "fuentes": [], "citas": []}
        _publicar(getattr(tool_context, "state", None), res["fuentes"])
        return res
    clave = os.getenv("ANTHROPIC_API_KEY")
    if not clave:
        return {"error": "búsqueda web no configurada (falta ANTHROPIC_API_KEY)", "resumen": "", "fuentes": [], "citas": []}
    modelo = os.getenv("BUSQUEDA_MODELO", "claude-haiku-5-5")
    headers = {"x-api-key": clave, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    if os.getenv("ANTHROPIC_WORKSPACE_ID"):
        headers["anthropic-workspace-id"] = os.environ["ANTHROPIC_WORKSPACE_ID"]
    cuerpo = {"model": modelo, "max_tokens": 4000, "system": _SISTEMA,
              "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": int(os.getenv("BUSQUEDA_MAX_USOS", "3")),
                         "user_location": {"type": "approximate", "timezone": "America/Lima"}}],
              "messages": [{"role": "user", "content": consulta}]}
    try:
        async with httpx.AsyncClient(timeout=float(os.getenv("BUSQUEDA_TIMEOUT_S", "90"))) as cli:
            r = await cli.post(_API, headers=headers, json=cuerpo)
        if r.status_code >= 400:
            return {"error": f"búsqueda falló: HTTP {r.status_code} {r.text[:200]}", "resumen": "", "fuentes": [], "citas": []}
        res = _parsear(r.json())
    except Exception as e:  # noqa: BLE001
        return {"error": f"búsqueda falló: {type(e).__name__}: {str(e)[:200]}", "resumen": "", "fuentes": [], "citas": []}
    _registrar_costo(modelo, res.pop("_uso"), res.pop("_busquedas"))
    _publicar(getattr(tool_context, "state", None), res["fuentes"])
    return res


google_search._propia = True  # type: ignore[attr-defined]  # no es el grounding de Gemini: cualquier modelo puede usarla


def herramienta_busqueda():
    """La tool de búsqueda según `BUSQUEDA_WEB`: 'anthropic' → la propia; otro valor → `google_search` de ADK (Gemini)."""
    if os.getenv("BUSQUEDA_WEB", "google").strip().lower() in ("anthropic", "propia", "claude"):
        return google_search
    from google.adk.tools import google_search as gemini
    return gemini
