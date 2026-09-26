"""Utilidades de contexto sin dependencias del paquete `agents` (evita imports circulares:
las usan tanto `agents._shared.instructions` como `tools.state_loaders`)."""

_CLAVES_ERROR = {"error", "body", "status", "status_code", "detail", "url", "fuente", "http_status"}


def compactar_errores(obj, _depth: int = 0):
    """Reemplaza cada bloque que es SOLO un error de una fuente externa
    ({"error": "HTTP 401 — API key inválida…", "body": "…"}) por
    {"estado": "no_disponible", "motivo": "<error corto>"}. El modelo no gana nada leyendo el
    cuerpo del error (en septiembre, el 401 de decolecta/SUNAT viajaba en 115 análisis) y el
    dato ausente queda dicho de forma explícita. Devuelve una copia; no muta el state."""
    if _depth > 8:
        return obj
    if isinstance(obj, dict):
        if obj.get("error") and set(obj.keys()) <= _CLAVES_ERROR:
            return {"estado": "no_disponible", "motivo": str(obj.get("error"))[:160]}
        return {k: compactar_errores(v, _depth + 1) for k, v in obj.items()}
    if isinstance(obj, list):
        return [compactar_errores(v, _depth + 1) for v in obj]
    return obj
