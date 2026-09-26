"""Reglas de cumplimiento en CÓDIGO (sin LLM). Activo con REGLAS_EN_CODIGO=1 (default).

Medido en septiembre 2026 (trazas de Phoenix): `compliance_agent` (674 llamadas) y
`compliance_extended_agent` (620) usaban Gemini solo para invocar, un turno por vez y en orden
fijo, reglas que ya son funciones deterministas; cada turno reenviaba el prompt completo (hasta
34 k chars, ~12,6 k tokens). Acá las reglas corren directo; el LLM queda solo para las 2 banderas
de juicio (capacidad operativa, conflicto de interés) y solo si hay datos para juzgar.

Además corrige dos pérdidas: las reglas del perfil sin tool en el agente (fraccionamiento,
personal_clave_vinculado, adicional_acumulado, directa_recurrente) ahora corren en todos los
perfiles, y las 3 duras ya no se repiten en `otros` (se excluían con nombres inexistentes).

Rollback: REGLAS_EN_CODIGO=0 vuelve a los agentes originales (pipeline_phases).
"""
from __future__ import annotations

import asyncio
import json
import os

from pipeline_runtime import _tool
from pipeline_state import _kwargs_soportados
from tools.contexto import compactar_errores

REGLAS_DURAS = ("unico_postor_alto", "proveedor_sancionado_osce", "procedimiento_no_competitivo")


def reglas_en_codigo() -> bool:
    return os.getenv("REGLAS_EN_CODIGO", "1").strip().lower() not in ("0", "false", "no")


async def _t(pc, fn, fname: str, agent: str, **kw):
    """Igual que `pipeline_phases.t_call` (sin importarlo, para no crear un ciclo)."""
    if pc.dag:
        return await asyncio.to_thread(_tool, fn, fname, pc.state, agent, **kw)
    return _tool(fn, fname, pc.state, agent, **kw)


def _registro(pc) -> dict:
    reg = pc.reglas_por_nombre if isinstance(pc.reglas_por_nombre, dict) else None
    return reg or getattr(pc.T, "REGLAS_POR_NOMBRE", None) or {}


def _fn_regla(pc, slug: str):
    fn = _registro(pc).get(slug)
    if callable(fn):
        return fn
    fn = getattr(pc.T, f"check_{slug}_rule", None)
    return fn if callable(fn) else None


def _linea(nombre: str, r) -> str:
    """Una línea del resumen, con la misma semántica que exigían los prompts: una regla omitida
    o con error NO fue evaluada (nunca se reporta como 'no disparó')."""
    if not isinstance(r, dict):
        return f"· {nombre}: sin resultado"
    if r.get("omitida"):
        motivo = str(r.get("motivo") or r.get("omitida_motivo") or "")[:120]
        return f"· {nombre}: no evaluada (omitida{': ' + motivo if motivo else ''})"
    if r.get("error"):
        return f"· {nombre}: no evaluada (error: {str(r.get('error'))[:120]})"
    if "triggered" not in r:
        ev = str(r.get("evidencia") or "")[:260]
        return f"· {nombre}: {ev}" if ev else f"· {nombre}: sin resultado"
    if r.get("triggered"):
        ev = str(r.get("evidencia") or r.get("detalle") or r.get("motivo") or "")[:220]
        return f"· {nombre}: DISPARÓ ({r.get('severidad') or 'sin severidad'}){' — ' + ev if ev else ''}"
    return f"· {nombre}: no disparó"


def _estado_real_persist(pc):
    """Igual que tools.compliance_rules._analysis._detect_estado_real_persist (no exportado):
    corre `detect_estado_real` y deja el resultado en state['estado_real'] (lo lee el dictamen)."""
    det = getattr(pc.T, "detect_estado_real", None)
    if not callable(det):
        return None

    def detect_estado_real(ocid, tool_context):
        r = det(ocid, tool_context)
        tool_context.state["estado_real"] = r
        return r
    return detect_estado_real


def _transfer(nombre: str, msg: str) -> dict:
    # El grafo del frontend enciende el nodo del agente con este evento (ver agent_call).
    return {"kind": "transfer", "from": "orch", "to": nombre, "agent": "orch", "msg": msg}


async def fase_compliance_codigo(pc):
    """3 reglas duras + estado real + patrón de postores + creación de la alerta, en código.
    Deja `state['compliance_result']` con el resumen que antes redactaba el LLM (lo lee el
    dictamen). El RAG por regla ya no se consulta acá: `evaluate_normative_compliance` lo hace
    después para todas las banderas (antes se consultaba dos veces)."""
    yield {"kind": "phase", "name": "compliance", "msg": "reglas duras en código (sin LLM)"}
    yield _transfer("compliance_agent", "reglas duras en código")
    pasos = [(slug, _fn_regla(pc, slug)) for slug in REGLAS_DURAS]
    pasos += [("estado_real", _estado_real_persist(pc)),
              ("patron_postores", getattr(pc.T, "analyze_postores_pattern", None))]
    lineas = []
    for nombre, fn in pasos:
        if fn is None:
            lineas.append(f"· {nombre}: no disponible")
            continue
        evs, res = await _t(pc, fn, getattr(fn, "__name__", nombre), "compliance_agent", ocid=pc.ocid)
        for e in evs:
            yield e
        lineas.append(_linea(nombre, res))
    evs, res = await _t(pc, pc.T.persist_alert_from_flags, "persist_alert_from_flags", "compliance_agent",
                        ocid=pc.ocid)
    for e in evs:
        yield e
    cod = res.get("alerta_codigo") if isinstance(res, dict) else None
    pc.state["compliance_result"] = ("Reglas duras evaluadas en código:\n" + "\n".join(lineas)
                                     + (f"\nAlerta: {cod}" if cod else ""))


async def reglas_extendidas_codigo(pc, reglas_kw: dict):
    """Todas las reglas ACTIVAS del perfil salvo las duras (ya corrieron) y las del lote 1
    (corren dentro de `evaluate_normative_compliance`), en código y para todos los perfiles."""
    lote1 = set(getattr(pc.T, "REGLAS_LOTE1", {}) or {})
    reglas = [(r, _fn_regla(pc, r)) for r in sorted(pc.profile.reglas_activas)
              if r not in REGLAS_DURAS and r not in lote1]
    faltan = [r for r, fn in reglas if fn is None]
    reglas = [(r, fn) for r, fn in reglas if fn is not None]
    if not reglas:
        return
    yield {"kind": "phase", "name": "compliance_rules",
           "msg": f"{len(reglas)} reglas del perfil {pc.profile.nombre} en código (sin LLM)"
                  + (f"; sin implementación: {', '.join(faltan)}" if faltan else "")}
    for r, fn in reglas:
        evs, _ = await _t(pc, fn, getattr(fn, "__name__", f"check_{r}_rule"), "compliance_extended_agent",
                          ocid=pc.ocid, **_kwargs_soportados(fn, **reglas_kw))
        for e in evs:
            yield e


def _bloque_util(v) -> bool:
    """True si un bloque inyectado trae algo juzgable (no vacío ni solo un error de fuente)."""
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            return bool(v.strip())
    v = compactar_errores(v)
    if not v:
        return False
    if isinstance(v, dict) and str(v.get("estado") or "").lower() in ("no_disponible", "sin_dato"):
        return False
    return True


def hay_datos_para_juicio(pc) -> bool:
    """Las 2 banderas de juicio necesitan SUNAT/web (capacidad operativa) o la red de personas
    (conflicto de interés). Sin ninguno de los tres, no hay nada que juzgar: 0 llamadas."""
    return any(_bloque_util(pc.state.get(k)) for k in ("sunat_decolecta", "web_research", "person_network"))


def mensaje_juicio(pc) -> str:
    """Mensaje del agente de juicio: monto y ganador del OCDS (la bandera de capacidad operativa
    exige citar el monto) y las reglas deterministas que dispararon, en forma compacta."""
    ocds = pc.state.get("ocds") or pc.state.get("ocds_preloaded") or {}
    awards = [a for a in (ocds.get("awards") or []) if isinstance(a, dict)] if isinstance(ocds, dict) else []
    ganadores = [{"proveedor": s.get("name"), "id": s.get("id"), "monto": (a.get("value") or {}).get("amount"),
                  "moneda": (a.get("value") or {}).get("currency")}
                 for a in awards[:5] for s in (a.get("suppliers") or []) if isinstance(s, dict)]
    disparadas = [{"regla": b.get("regla"), "severidad": b.get("severidad"),
                   "evidencia": str(b.get("evidencia") or "")[:200]}
                  for b in (pc.state.get("pending_flags") or []) if isinstance(b, dict)][:30]
    return (f"OCID {pc.ocid}. Las 12 reglas deterministas ya corrieron en código.\n"
            f"ADJUDICACIÓN (OCDS): {json.dumps(ganadores, ensure_ascii=False, default=str)}\n"
            f"REGLAS QUE DISPARARON: {json.dumps(disparadas, ensure_ascii=False, default=str)}\n"
            "Haz solo el juicio contextual con los bloques inyectados en tu instrucción.")
