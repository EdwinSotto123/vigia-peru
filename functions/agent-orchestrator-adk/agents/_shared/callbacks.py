"""
Callbacks compartidos por todos los agentes: init de state + logging
estructurado JSON (tool calls, model calls, resultados). Extraído textual del
agents.py monolítico. `CALLBACKS` es el bundle que se pasa a cada Agent.
"""
import json as _json
import time as _time

from google.adk.agents.callback_context import CallbackContext


def _log_event(**fields) -> None:
    """Loggea un evento estructurado JSON a stdout (Cloud Logging lo indexa)."""
    try:
        line = _json.dumps(
            {"_vigia": True, "ts": _time.time(), **fields},
            ensure_ascii=False, default=str,
        )
    except Exception as e:
        line = _json.dumps({"_vigia": True, "ts": _time.time(),
                            "kind": "log_error", "error": str(e)[:200]})
    print(line, flush=True)


def _truncate(s, n: int = 1200) -> str:
    if s is None:
        return ""
    txt = s if isinstance(s, str) else str(s)
    return txt if len(txt) <= n else txt[:n] + f"…(+{len(txt) - n} chars)"


async def init_state(callback_context: CallbackContext) -> None:
    """Inicializa keys de state usadas como acumuladores + loggea inicio."""
    state = callback_context.state
    state.setdefault("pending_flags", [])
    state.setdefault("market_findings", [])
    _log_event(
        kind="agent_start",
        agent=getattr(callback_context, "agent_name", None) or "?",
    )


async def after_agent_log(callback_context: CallbackContext) -> None:
    """Loggea el fin del agente."""
    _log_event(
        kind="agent_end",
        agent=getattr(callback_context, "agent_name", None) or "?",
    )


def before_tool_log(tool, args, tool_context):
    """Loggea cada tool_call con sus args (truncados)."""
    try:
        args_repr = _truncate(args, 600)
        _log_event(
            kind="tool_call",
            agent=getattr(tool_context, "agent_name", None) or "?",
            tool=getattr(tool, "name", str(tool)),
            args_preview=args_repr,
        )
    except Exception:
        pass
    return None


def after_tool_log(tool, args, tool_context, tool_response):
    """Loggea el resultado del tool (truncado)."""
    try:
        if isinstance(tool_response, dict):
            preview = {}
            for k, v in tool_response.items():
                if isinstance(v, (int, float, bool, type(None))):
                    preview[k] = v
                elif isinstance(v, (list, tuple)):
                    preview[k] = f"<list n={len(v)}>"
                elif isinstance(v, dict):
                    preview[k] = f"<dict keys={list(v.keys())[:8]}>"
                else:
                    preview[k] = _truncate(v, 300)
            resp = preview
        else:
            resp = _truncate(tool_response, 1500)
        _log_event(
            kind="tool_result",
            agent=getattr(tool_context, "agent_name", None) or "?",
            tool=getattr(tool, "name", str(tool)),
            response=resp,
        )
    except Exception:
        pass
    return None


def before_model_log(callback_context, llm_request):
    """Loggea el prompt que va al LLM (último mensaje + n_parts). Clave para
    auditar QUÉ información reciben los sub-agentes."""
    try:
        last_user = ""
        n_parts = 0
        for content in (llm_request.contents or []):
            n_parts += len(content.parts or [])
        for content in reversed(llm_request.contents or []):
            for p in content.parts or []:
                if hasattr(p, "text") and p.text:
                    last_user = p.text
                    break
            if last_user:
                break
        _log_event(
            kind="model_call",
            agent=getattr(callback_context, "agent_name", None) or "?",
            model=getattr(llm_request, "model", None),
            n_blocks=len(llm_request.contents or []),
            n_parts=n_parts,
            prompt_preview=_truncate(last_user, 2500),
        )
    except Exception:
        pass
    return None


def after_model_log(callback_context, llm_response):
    """Loggea el output del LLM: texto + function_calls que decidió emitir."""
    try:
        text_out = ""
        fn_calls = []
        content = getattr(llm_response, "content", None)
        if content:
            for p in (content.parts or []):
                if hasattr(p, "text") and p.text:
                    text_out += p.text
                if hasattr(p, "function_call") and p.function_call:
                    fc = p.function_call
                    fn_calls.append({
                        "name": fc.name,
                        "args_preview": _truncate(
                            dict(fc.args) if fc.args else {}, 400,
                        ),
                    })
        _log_event(
            kind="model_result",
            agent=getattr(callback_context, "agent_name", None) or "?",
            text_preview=_truncate(text_out, 2500),
            function_calls=fn_calls,
        )
    except Exception:
        pass
    return None


# Bundle — todos los callbacks juntos para pasar a un Agent con **CALLBACKS
CALLBACKS = dict(
    before_agent_callback=init_state,
    after_agent_callback=after_agent_log,
    before_tool_callback=before_tool_log,
    after_tool_callback=after_tool_log,
    before_model_callback=before_model_log,
    after_model_callback=after_model_log,
)
