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


def make_state_aware_instruction(static_str: str, injections: list):
    """Convierte un prompt estático en un InstructionProvider que en cada
    llamada lee `state[key]` (de `injections` = lista de (key, label)) y lo
    concatena al final del prompt como JSON. Reemplaza el patrón roto de pegar
    JSONs grandes en el `request` del sub-agente.
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
            try:
                blob = _json.dumps(data, ensure_ascii=False, default=str)[:40000]
            except Exception:
                continue
            parts.append(
                f"\n\n═══════════════════════════════════════════════════════════════════════════\n"
                f"{label} — INYECTADO DESDE session.state['{state_key}']\n"
                f"(Esta sección la inyecta el runtime ADK en cada arranque del sub-agente. "
                f"NO depende de que el orquestador pegue JSON en el mensaje. Si está "
                f"presente, es la fuente de verdad — usala como input principal de tu análisis.)\n"
                f"═══════════════════════════════════════════════════════════════════════════\n"
                f"{blob}\n"
            )
        return "".join(parts)

    return _provider
