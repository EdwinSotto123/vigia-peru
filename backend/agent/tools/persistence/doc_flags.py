"""Banderas documentales: toma `red_flags_documentales` del
document_legal_analyst_agent y las persiste vinculadas a la alerta."""

from tools._core import *  # noqa: F401,F403
from tools.persistence.shared import (
    _advisory_lock, _insert_bandera, _limpiar_banderas_agente, _norma,
    _normalizar_red_flag, _recalcular_score, _verificar_o_descartar,
)


def persist_doc_flags_as_banderas(alerta_codigo: str, tool_context: ToolContext) -> dict:
    """Toma los `red_flags_documentales` emitidos por document_legal_analyst_agent
    (cada uno con descripción + severidad + norma citada + evidencia textual) y
    los persiste como banderas vinculadas a la alerta. Sirve para que la UI
    muestre las banderas documentales junto con las banderas de reglas duras
    del compliance_agent.

    Args:
        alerta_codigo: Código de la alerta (ej. 'OECE-1211237').

    Returns:
        Diccionario con count de banderas persistidas + lista.
    """
    state = tool_context.state
    # Lectura prioritaria: legal_analysis del nuevo agente especializado
    legal = _safe_parse_json(state.get("legal_analysis"))
    if not isinstance(legal, dict):
        legal = {}
    red_flags = legal.get("red_flags_documentales") or []

    # Las banderas documentales vienen SOLO del document_legal_analyst (grounded en
    # los ítems reales + cita norma/opinión OECE). Se ELIMINÓ el fallback al
    # document_parser / parser_raw_consolidated: el parser es extractor puro y cuando
    # emitía red_flags ALUCINABA (ej. "ítem 3 SOFTWARE DE OFIMÁTICA / Microsoft Office",
    # "ISO 19798 impresora" en un contrato de equipos de laboratorio). Si el legal no
    # produjo banderas, no se persiste ninguna documental.
    if not red_flags:
        # El legal corrió y no halló nada: limpiar las banderas documentales de la corrida anterior.
        lim = _limpiar_banderas_agente(alerta_codigo, "document_legal_analyst_agent", state) if state.get("legal_analysis") else {}
        return {"persistidas": 0, "mensaje": "Sin red_flags del legal_analyst en state", **lim}

    # Normalizar alerta_codigo: si vino el OCID completo, convertir a OECE-XXXX
    raw_codigo = (alerta_codigo or "").strip()
    if raw_codigo.startswith("ocds-"):
        raw_codigo = "OECE-" + _short_ocid(raw_codigo)
    if raw_codigo and not raw_codigo.startswith("OECE-") and raw_codigo.isdigit():
        raw_codigo = f"OECE-{raw_codigo}"

    conn = _pg()
    try:
        cur = conn.cursor()
        _advisory_lock(cur, raw_codigo)
        cur.execute("SELECT id FROM alertas WHERE codigo=%s", (raw_codigo,))
        row = cur.fetchone()
        if not row:
            # No hay alerta todavía — guardamos los flags en state para que
            # persist_analysis_outputs los anexe cuando cree la alerta stub.
            tool_context.state["pending_doc_flags"] = red_flags
            return {
                "persistidas": 0,
                "skipped": True,
                "alerta_codigo": raw_codigo,
                "mensaje": "Alerta aún no creada. red_flags quedan en state['pending_doc_flags'] para persistencia downstream.",
            }
        alerta_id = row[0]
        # Toda bandera debe linkear a evidencia oficial (principio innegociable):
        # URL canónica del proceso en OECE Contrataciones Abiertas.
        _fuente_oficial = f"https://contratacionesabiertas.oece.gob.pe/proceso/{state.get('ocid') or raw_codigo.replace('OECE-', '')}"

        # Borrar previas del mismo agente (idempotente)
        cur.execute(
            "DELETE FROM banderas WHERE alerta_id=%s AND agente_origen IN "
            "('document_parser_agent','document_legal_analyst_agent')",
            (alerta_id,),
        )

        cur.execute("SELECT score FROM alertas WHERE id=%s", (alerta_id,))
        cur_score = (cur.fetchone() or [0])[0] or 0

        persistidas = []
        descartadas = 0
        for rf in red_flags:
            norm = _normalizar_red_flag(rf)
            if not norm:
                continue
            descr, sev, norma = norm
            norma_final = (norma or _norma(state, "competencia"))[:300]
            flag = {"regla": "red_flag_documental", "severidad": sev, "evidencia": descr[:500],
                    "norma": norma_final, "fuente_url": _fuente_oficial}
            if isinstance(rf, dict):
                for k in ("evidencia_textual", "documento", "pagina", "cita", "evidencia"):
                    if rf.get(k) is not None and k not in flag:
                        flag[k] = rf[k]
            if not _verificar_o_descartar(flag, state, "persist_doc_flags_as_banderas",
                                          "document_legal_analyst_agent"):
                descartadas += 1
                continue
            _insert_bandera(cur, alerta_id, "red_flag_documental", sev, descr, norma_final,
                            _fuente_oficial, "document_legal_analyst_agent", flag.get("verificacion"))
            persistidas.append({"severidad": sev, "evidencia": descr[:200], "norma": norma_final})

        # Score con TODAS las banderas de la alerta (no incremental: idempotente en reruns).
        new_score, _ = _recalcular_score(cur, alerta_id, state)
        conn.commit()
        return {
            "persistidas": len(persistidas),
            "descartadas": descartadas,
            "score_anterior": int(cur_score),
            "score_nuevo": new_score,
            "banderas": persistidas,
        }
    except Exception as e:
        return {"error": str(e)[:200], "alerta_codigo": alerta_codigo}
    finally:
        conn.close()

# ── FunctionTool wrappers ──
persist_doc_flags_as_banderas_tool = FunctionTool(func=persist_doc_flags_as_banderas)
