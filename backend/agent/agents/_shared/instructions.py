"""
Helpers de instrucción (instruction providers) compartidos:
  · with_today_header        → antepone la fecha de HOY al prompt (anti-alucinación
                               de fechas; el LLM cree que estamos en su cutoff).
  · make_state_aware_instruction → inyecta state[key] serializado al final del
                               prompt en runtime (evita que el orquestador tenga
                               que copiar JSONs grandes en el mensaje).
Extraído textual del agents.py monolítico.
"""
import json as _json
import datetime as _dt


def with_today_header(static_str: str):
    """Devuelve un InstructionProvider que antepone la fecha de hoy."""
    def _provider(_ctx):
        today = _dt.date.today().isoformat()
        header = (
            "═══════════════════════════════════════════════════════════════════════════\n"
            f"⏰ FECHA DE HOY (en tiempo real al momento del análisis): {today}\n"
            "═══════════════════════════════════════════════════════════════════════════\n"
            "Las tools de Cloud SQL devuelven fechas en formato ISO yyyy-mm-dd y\n"
            "anotan `_fecha_es_futura: true` ÚNICAMENTE cuando la fecha es estrictamente\n"
            "posterior a HOY. Si `_fecha_es_futura: false` (o el campo no existe), la\n"
            "fecha está en el PASADO o es HOY — NO la marques como \"fecha futura\" ni\n"
            "como \"posible error de registro\". El año actual es {year}.\n"
            "═══════════════════════════════════════════════════════════════════════════\n"
            "🔒 REGLAS UNIVERSALES (aplican a TODO agente, sin excepción):\n"
            "1. NUNCA inventes datos. Si un RUC, monto, nombre, fecha, marca, norma o URL\n"
            "   no aparece LITERAL en las fuentes/tools que consultaste, NO lo escribas.\n"
            "2. \"No encontrado\" es una respuesta VÁLIDA y esperada. Devolvé el campo en\n"
            "   null / \"\" / [] con una nota breve del porqué, en vez de rellenar con\n"
            "   suposiciones. Es preferible un dato faltante honesto a uno inventado.\n"
            "3. Toda señal de riesgo debe rastrearse a una fuente concreta (RUC, código de\n"
            "   convocatoria, artículo de ley, URL oficial). Sin fuente verificable → no es\n"
            "   bandera, es ruido: no la emitas.\n"
            "4. COMPLETITUD: si el input trae N ítems / personas / documentos, procesalos\n"
            "   TODOS — no abrevies \"por brevedad\". Si no llegaste a todos, decí cuántos\n"
            "   faltaron y por qué, en vez de fingir que están.\n"
            "5. Tu salida es DATO para otro agente (no prosa para un humano): respetá EXACTO\n"
            "   el schema/JSON pedido y los campos obligatorios.\n"
            "═══════════════════════════════════════════════════════════════════════════\n\n"
        ).format(year=today[:4])
        return header + static_str
    return _provider


import os as _os

# Tope de chars por bloque inyectado. Antes se cortaba el JSON serializado a 40 000
# chars A MITAD DE STRING (auditoría 1.4-8): el sub-agente recibía JSON inválido y lo
# "completaba". Ahora se serializa por secciones y, si excede, se recortan listas y
# strings con marcas `_truncado`/`_omitidos` hasta que quepa: el JSON SIEMPRE es válido.
_INJECTION_MAX_CHARS = int(_os.getenv("STATE_INJECTION_MAX_CHARS", "40000"))
_SHRINK_STEPS = [(60, 4000), (30, 2500), (15, 1500), (8, 900), (4, 500), (2, 300), (1, 200)]


def _shrink(obj, max_list: int, max_str: int, _depth: int = 0):
    """Recorta listas/strings con marca explícita (misma convención que
    tools.state_loaders._paginar)."""
    if _depth > 10:
        return obj
    if isinstance(obj, str):
        if len(obj) <= max_str:
            return obj
        return obj[:max_str] + f" …[_truncado: {len(obj) - max_str} chars omitidos]"
    if isinstance(obj, list):
        items = [_shrink(x, max_list, max_str, _depth + 1) for x in obj[:max_list]]
        if len(obj) > max_list:
            return {"items": items, "_truncado": True, "_omitidos": len(obj) - max_list,
                    "_total": len(obj)}
        return items
    if isinstance(obj, dict):
        return {k: _shrink(v, max_list, max_str, _depth + 1) for k, v in obj.items()}
    return obj


def _dumps(data) -> str:
    return _json.dumps(data, ensure_ascii=False, default=str)


def serializar_acotado(data, max_chars: int = _INJECTION_MAX_CHARS) -> tuple[str, dict | None]:
    """Serializa `data` a JSON válido de ≤ max_chars. Devuelve (blob, recorte) donde
    `recorte` es None si entró entero o {limite, pasos, secciones_omitidas} si hubo
    que recortar. Estrategia: (1) entero; (2) listas/strings cada vez más cortas con
    marcas `_truncado`; (3) si aun así no cabe, se omiten secciones de nivel 1 (las
    últimas) dejando `_secciones_omitidas` en el objeto."""
    blob = _dumps(data)
    if len(blob) <= max_chars:
        return blob, None
    for i, (ml, ms) in enumerate(_SHRINK_STEPS):
        shr = _shrink(data, ml, ms)
        blob = _dumps(shr)
        if len(blob) <= max_chars:
            return blob, {"limite": max_chars, "pasos": i + 1, "secciones_omitidas": []}
    # Último recurso: omitir secciones enteras (de nivel 1) hasta que quepa.
    if isinstance(data, dict):
        shr = _shrink(data, *_SHRINK_STEPS[-1])
        keys = list(shr.keys())
        omitidas: list[str] = []
        while keys:
            cand = {k: shr[k] for k in keys}
            cand["_secciones_omitidas"] = omitidas
            blob = _dumps(cand)
            if len(blob) <= max_chars:
                return blob, {"limite": max_chars, "pasos": len(_SHRINK_STEPS),
                              "secciones_omitidas": list(omitidas)}
            omitidas.append(keys.pop())
    # Escalar: ni una sección cabe (string gigante) → placeholder válido.
    blob = _dumps({"_truncado": True, "_motivo": "bloque demasiado grande para inyectar",
                   "_chars": len(_dumps(data))})
    return blob, {"limite": max_chars, "pasos": len(_SHRINK_STEPS), "secciones_omitidas": ["*"]}


def make_state_aware_instruction(static_str: str, injections: list):
    """Convierte un prompt estático en un InstructionProvider que en cada
    llamada lee `state[key]` (de `injections` = lista de (key, label)) y lo
    concatena al final del prompt como JSON. Reemplaza el patrón roto de pegar
    JSONs grandes en el `request` del sub-agente.

    El JSON inyectado SIEMPRE es válido: si excede STATE_INJECTION_MAX_CHARS se
    recortan listas/strings con `_truncado`/`_omitidos` (nunca un corte a mitad de
    string) y el recorte queda anotado en state['recortes'] cuando el state lo permite.
    """
    def _provider(ctx):
        try:
            state = ctx.state
        except Exception:
            return static_str
        parts = [static_str]
        for state_key, label in injections:
            data = None
            try:
                data = state.get(state_key) if hasattr(state, "get") else state[state_key]
            except Exception:
                data = None
            if not data:
                continue
            if isinstance(data, str):
                # Output de otro agente guardado como string JSON → parsear para poder
                # recortar por secciones; si no parsea, se inyecta como string acotado.
                try:
                    parsed = _json.loads(data)
                    data = parsed if isinstance(parsed, (dict, list)) else data
                except Exception:
                    pass
            try:
                if isinstance(data, str):
                    # Texto libre (no JSON): se inyecta tal cual, acotado con marca.
                    if len(data) > _INJECTION_MAX_CHARS:
                        blob = (data[:_INJECTION_MAX_CHARS]
                                + f"\n…[_truncado: {len(data) - _INJECTION_MAX_CHARS} chars omitidos]")
                        recorte = {"limite": _INJECTION_MAX_CHARS, "pasos": 1, "secciones_omitidas": []}
                    else:
                        blob, recorte = data, None
                else:
                    blob, recorte = serializar_acotado(data)
            except Exception:
                continue
            aviso = ""
            if recorte:
                aviso = (f"(RECORTADO para caber en {recorte['limite']} chars: las listas con "
                         f"`_truncado: true` tienen `_omitidos` elementos que NO ves"
                         + (f"; secciones omitidas: {recorte['secciones_omitidas']}"
                            if recorte["secciones_omitidas"] else "")
                         + ". No completes lo que falta: decláralo como no disponible.)\n")
                try:
                    rec = state.get("recortes") if hasattr(state, "get") else None
                    entry = {"donde": f"inyeccion:{state_key}", "limite": recorte["limite"],
                             "omitido": f"pasos={recorte['pasos']} secciones={recorte['secciones_omitidas']}"}
                    if isinstance(rec, list):
                        if entry not in rec:
                            rec.append(entry)
                            state["recortes"] = rec
                    else:
                        state["recortes"] = [entry]
                except Exception:
                    pass
            parts.append(
                f"\n\n═══════════════════════════════════════════════════════════════════════════\n"
                f"{label} — INYECTADO DESDE session.state['{state_key}']\n"
                f"(Esta sección la inyecta el runtime ADK en cada arranque del sub-agente. "
                f"NO depende de que el orquestador pegue JSON en el mensaje. Si está "
                f"presente, es la fuente de verdad — usala como input principal de tu análisis.)\n"
                f"{aviso}"
                f"═══════════════════════════════════════════════════════════════════════════\n"
                f"{blob}\n"
            )
        return "".join(parts)

    return _provider
