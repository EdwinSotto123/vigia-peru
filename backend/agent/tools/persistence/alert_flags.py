"""Ciclo de vida de la alerta de compliance: banderas contextuales del
orquestador (`add_contextual_flag`) que se acumulan en state['pending_flags']
hasta que `persist_alert_from_flags` crea/actualiza la fila en `alertas`."""

from tools._core import *  # noqa: F401,F403
from tools.persistence.shared import (
    _advisory_lock, _insert_bandera, _limpiar_banderas_agente, _montos_alerta,
    _peso, _recalcular_score, _verificar_o_descartar,
)


def add_contextual_flag(regla: str, severidad: str, evidencia: str,
                         norma: str, tool_context: ToolContext,
                         fuente: str = "") -> dict:
    """Agrega una bandera detectada por razonamiento del orquestador al
    state['pending_flags'] para que sea persistida en la siguiente llamada a
    `persist_alert_from_flags`.

    Útil para PASO 7.7 — hallazgos contextuales que el LLM detecta razonando
    sobre el conjunto de datos (ej. rubro CIIU no coincide con objeto del
    contrato, capacidad operativa cuestionable, declaratoria de emergencia
    no acreditada) y que NO los detecta ninguna regla automática.

    Args:
        regla: identificador corto (ej. 'rubro_ciiu_incongruente').
        severidad: 'alta' | 'media' | 'baja'.
        evidencia: texto factual con el hallazgo, CON DATOS VERIFICABLES
            (OCID, monto S/., RUC, DNI, fecha, artículo). Max 500 chars.
        norma: artículo o principio normativo citado.
        fuente: URL oficial que respalda la bandera (SEACE/OECE/SUNAT/OSCE/RNP).
            Si se omite, se usa por defecto la URL del proceso en OECE
            Contrataciones Abiertas. Toda bandera DEBE quedar con fuente.

    Returns:
        dict con la bandera agregada + total de pending_flags acumulados.
    """
    if severidad not in ("alta", "media", "baja"):
        severidad = "media"
    flag = {
        "regla": (regla or "contextual")[:80],
        "severidad": severidad,
        "evidencia": (evidencia or "")[:500],
        "norma": (norma or "")[:200],
        # fuente_url: si el orquestador pasó una URL específica la usamos; si
        # no, persist_alert_from_flags le pone la URL oficial del proceso por
        # defecto (cita_evidencia exige norma + fuente en TODA bandera).
        "fuente_url": ((fuente or "").strip()[:300] or None),
        "triggered": True,
        "_source": "orchestrator_paso_7.7",
    }
    pending = tool_context.state.setdefault("pending_flags", [])
    pending.append(flag)
    return {
        "ok": True,
        "flag_agregada": flag,
        "n_pending_total": len(pending),
        "hint": "La bandera quedará persistida cuando llames `persist_alert_from_flags(ocid)`.",
    }

def persist_alert_from_flags(ocid: str, tool_context: ToolContext) -> dict:
    """Persiste en BD una alerta con las banderas detectadas que estén
    acumuladas en state['pending_flags']. Si no hay banderas, no crea alerta.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con alerta_codigo, alerta_id, score, banderas_persistidas.
    """
    state = tool_context.state
    pendientes = [b for b in (state.get("pending_flags") or []) if isinstance(b, dict)]
    # Dedupe (regla + evidencia): las reglas pueden correr dos veces (agente LLM + driver).
    banderas: list[dict] = []
    _vistas: set = set()
    for b in pendientes:
        k = (b.get("regla"), (b.get("evidencia") or "")[:200])
        if k in _vistas:
            continue
        _vistas.add(k)
        banderas.append(b)
    if not banderas:
        # Las reglas corrieron y no dispararon: si la alerta ya existe (re-análisis), sus banderas
        # de compliance de la corrida anterior quedan obsoletas → limpiarlas.
        lim = _limpiar_banderas_agente(f"OECE-{_short_ocid(ocid)}", "compliance_agent", state)
        return {"alerta_codigo": None, "score": 0, "banderas_persistidas": 0,
                "mensaje": "Sin banderas — no se creó alerta", **lim}
    # Verificación determinista ANTES de tocar la BD: lo no respaldado se descarta.
    banderas = [b for b in banderas
                if _verificar_o_descartar(b, state, "persist_alert_from_flags", "compliance_agent")]
    n_descartadas = len(_vistas) - len(banderas)
    if not banderas:
        lim = _limpiar_banderas_agente(f"OECE-{_short_ocid(ocid)}", "compliance_agent", state)
        return {"alerta_codigo": None, "score": 0, "banderas_persistidas": 0,
                "banderas_descartadas": n_descartadas,
                "mensaje": "Todas las banderas fueron descartadas por la verificación determinista", **lim}
    # Score provisional (solo para el INSERT inicial; se recalcula con TODAS al final).
    score = min(sum(_peso("compliance_agent", b.get("severidad")) for b in banderas), 100)
    codigo = f"OECE-{_short_ocid(ocid)}"  # _short_ocid → soporta flat y año-secuencia (no 'OECE-12')
    conn = _pg()
    try:
        cur = conn.cursor()
        _advisory_lock(cur, codigo)
        cur.execute(
            """SELECT entidad_ruc, region, fecha_buena_pro, objeto, cuantia_referencial,
                      (SELECT empresa_ruc FROM postores p
                         JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                        WHERE p.ocid=convocatorias.ocid LIMIT 1)
                 FROM convocatorias WHERE ocid=%s""",
            (ocid,),
        )
        row = cur.fetchone()
        if not row:
            # La convocatoria no fue registrada (register_convocatoria_in_db falló).
            # Creamos la alerta igual con los pocos datos que tenemos del state.
            ocds_state = tool_context.state.get("ocds") or tool_context.state.get("ocds_preloaded") or {}
            tender = ocds_state.get("tender") or {}
            # El id de procuringEntity puede venir como 'PE-RUC-20131380951',
            # con sufijos o en otro formato. Extraemos sólo los dígitos y exigimos
            # exactamente 11 (largo de un RUC); si no, None — entidad_ruc es CHAR(11)
            # y cualquier valor más largo revienta con 22001 'value too long'.
            _proc_ent = tender.get("procuringEntity") or {}
            _raw_ent_id = _proc_ent.get("id") or ""
            _ent_digits = "".join(ch for ch in _raw_ent_id if ch.isdigit())
            ent_ruc = _ent_digits if len(_ent_digits) == 11 else None
            # Garantiza la fila padre: entidad_ruc tiene FK a entidades(ruc). Si la
            # convocatoria no se registró, la entidad tampoco existe → el INSERT en
            # alertas violaría el FK (23503). Upsert defensivo idempotente.
            if ent_ruc:
                cur.execute(
                    "INSERT INTO entidades (ruc, nombre, tipo) VALUES (%s, %s, 'organismo_autonomo') "
                    "ON CONFLICT (ruc) DO NOTHING",
                    (ent_ruc, _proc_ent.get("name") or ""),
                )
            region = None
            fbp = None
            objeto = tender.get("description") or tender.get("title") or ""
            cuantia = tender.get("value", {}).get("amount") if isinstance(tender.get("value"), dict) else None
            prov_ruc = None
        else:
            ent_ruc, region, fbp, objeto, cuantia, prov_ruc = row
        monto_adj, monto_ref, _fuente_monto = _montos_alerta(state, cuantia)
        if not prov_ruc:
            from tools.compliance_rules import _ganador_ocds
            prov_ruc, _ = _ganador_ocds(state.get("ocds") or state.get("ocds_preloaded") or {})
        cur.execute(
            """INSERT INTO alertas (codigo, ocid, entidad_ruc, proveedor_ruc, monto_adjudicado,
                                   monto_referencial, fecha_buena_pro, region, score, reglas_disparadas,
                                   estado, objeto, codigo_convocatoria, fuente_url, analizado_en)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'activa', %s, %s, %s, NOW())
               ON CONFLICT (codigo) DO UPDATE SET score=EXCLUDED.score,
                 reglas_disparadas=EXCLUDED.reglas_disparadas,
                 monto_adjudicado=COALESCE(EXCLUDED.monto_adjudicado, alertas.monto_adjudicado),
                 monto_referencial=COALESCE(EXCLUDED.monto_referencial, alertas.monto_referencial),
                 proveedor_ruc=COALESCE(EXCLUDED.proveedor_ruc, alertas.proveedor_ruc),
                 analizado_en=NOW(),
                 updated_at=NOW()
               RETURNING id""",
            (codigo, ocid, ent_ruc, prov_ruc, monto_adj, monto_ref, fbp, region, score,
             [b["regla"] for b in banderas], (objeto or "")[:500],
             ocid.split("-")[-1], f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"),
        )
        alerta_id = cur.fetchone()[0]
        state["montos_alerta"] = {"monto_adjudicado": monto_adj, "monto_referencial": monto_ref, "fuente": _fuente_monto}
        # Limpiar SOLO las banderas propias (compliance_agent) — cada run del compliance
        # empieza desde cero, pero las de document_legal_analyst / market_price NO se
        # tocan (hallazgo #1: antes `DELETE … WHERE alerta_id` borraba todas y el score
        # se recalculaba solo con las de compliance).
        cur.execute("DELETE FROM banderas WHERE alerta_id=%s AND agente_origen='compliance_agent'",
                    (alerta_id,))
        # URL oficial por defecto: toda bandera DEBE quedar con fuente (el
        # evaluador determinista cita_evidencia exige norma + fuente_url). Las
        # banderas de reglas duras ya traen su fuente; las contextuales (de
        # add_contextual_flag sin `fuente`) caen a la URL canónica del proceso.
        _fuente_default = f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"
        for b in banderas:
            _insert_bandera(cur, alerta_id, b.get("regla", "sin_regla"), b.get("severidad", "media"),
                            b.get("evidencia", ""), b.get("norma", ""),
                            b.get("fuente_url") or _fuente_default, "compliance_agent",
                            b.get("verificacion"))
        # Score con TODAS las banderas de la alerta (compliance + legal + market + …).
        score, todas = _recalcular_score(cur, alerta_id, state)
        conn.commit()
        state["alerta_codigo"] = codigo
        # pending_flags queda solo con lo verificado (sin duplicados ni descartadas):
        # evaluate_normative_compliance y el writer no deben ver banderas descartadas.
        state["pending_flags"] = banderas
        return {
            "alerta_codigo": codigo, "alerta_id": str(alerta_id),
            "score": score, "banderas_persistidas": len(banderas),
            "banderas_descartadas": n_descartadas,
            "banderas_total_alerta": len(todas),
        }
    finally:
        conn.close()

# ── FunctionTool wrappers ──
persist_alert_from_flags_tool = FunctionTool(func=persist_alert_from_flags)
add_contextual_flag_tool = FunctionTool(func=add_contextual_flag)
