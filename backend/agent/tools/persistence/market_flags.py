"""Banderas de sobreprecio: toma los hallazgos del market_price_agent
(sobreprecio por ítem, spec restrictiva, sobreprecio del lote) y los persiste
vinculados a la alerta, con el guardarraíl anti-alucinación que cotejo cada
finding contra las fuentes deterministas antes de aceptarlo."""

from tools._core import *  # noqa: F401,F403
from tools.compliance_rules import coincide_objeto_detalle
from tools.persistence.shared import (
    _advisory_lock, _insert_bandera, _limpiar_banderas_agente, _norma,
    _recalcular_score, _verificar_o_descartar,
)


def _cobertura_por_valor(findings: list[dict], mk: dict | None = None) -> float:
    """Cobertura del mercado por VALOR: Σ(cantidad × precio) de los ítems con mediana /
    Σ(cantidad × precio) de todos. Precio = ofertado > referencial > mediana. Sin
    cantidades/precios → cobertura por conteo. Respeta `mk['cobertura_valor']` si viene."""
    if isinstance(mk, dict) and isinstance(mk.get("cobertura_valor"), (int, float)):
        return float(mk["cobertura_valor"])
    if not findings:
        return 0.0

    def _num(v):
        try:
            x = float(v)
            return x if x > 0 else None
        except (TypeError, ValueError):
            return None
    tot, cub = 0.0, 0.0
    con_valor = 0
    for f in findings:
        cant = _num(f.get("cantidad")) or _num(f.get("quantity"))
        precio = (_num(f.get("precio_unitario_ofertado")) or _num(f.get("precio_unitario_referencial"))
                  or _num(f.get("precio_mediana_mercado")))
        if cant and precio:
            con_valor += 1
            v = cant * precio
            tot += v
            if _num(f.get("precio_mediana_mercado")):
                cub += v
    if tot > 0 and con_valor == len(findings):
        return cub / tot
    n_med = len([f for f in findings if _num(f.get("precio_mediana_mercado"))])
    return n_med / len(findings)


def persist_market_flags_as_banderas(alerta_codigo: str, tool_context: ToolContext) -> dict:
    """Toma los hallazgos del market_price_agent (sobreprecio por ítem,
    especificación restrictiva, sobreprecio total del lote) y los persiste
    como banderas vinculadas a la alerta. Aumenta el `score` de la alerta
    proporcionalmente a la severidad de cada hallazgo.

    Banderas que genera:
      · `sobreprecio_muy_elevado` (severidad alta, +25 pts) — Δ ≥ 50%
      · `sobreprecio_elevado` (severidad media, +12 pts) — 15% ≤ Δ < 50%
      · `spec_restrictiva` (severidad alta, +25 pts) por sub-ítem con esa marca
      · `sobreprecio_lote_muy_elevado` (severidad alta, +25 pts) — lote total >50%
      · `sobreprecio_lote_elevado` (severidad media, +12 pts) — lote total 15-50%

    Args:
        alerta_codigo: Código de la alerta (ej. 'OECE-1212765').

    Returns:
        Diccionario con count, banderas persistidas, score nuevo.
    """
    state = tool_context.state
    mk = _safe_parse_json(state.get("market_analysis"))
    if not isinstance(mk, dict):
        return {"persistidas": 0, "mensaje": "Sin market_analysis en state"}

    # ─── ANTI-ALUCINACIÓN (lote 1 · T14): un finding se acepta si su ítem existe en la
    # fuente determinista del fan-out (`market_input.items` por `item_numero`) o en los
    # ítems del parser; solo los findings SIN correlato documental pasan por el cotejo de
    # rubro (`coincide_objeto`, por raíces + hiperónimos, contra objeto + ítems OCDS +
    # ítems del parser). Antes el filtro léxico crudo contra el nombre del proyecto
    # descartaba los findings del propio parser (1225090, 1225266, 1225379, 1225392) y
    # abortaba TODA la persistencia.
    ocds_state = state.get("ocds") or {}
    tender = ocds_state.get("tender") or {}
    objeto_contrato = " ".join(
        str(x) for x in (tender.get("description"), tender.get("title")) if x
    ).upper()
    _mi = state.get("market_input") or {}
    _items_mi = [it for it in ((_mi.get("items") if isinstance(_mi, dict) else None) or []) if isinstance(it, dict)]
    _raw = state.get("parser_raw_consolidated") or {}
    _items_parser = [it for it in (_raw.get("items_consolidados") or []) if isinstance(it, dict)]
    _nums_conocidos = {str(it.get("item_numero") or it.get("numero") or "").strip()
                       for it in _items_mi + _items_parser}
    _nums_conocidos.discard("")
    _descs_conocidas = [str(it.get("descripcion_corta") or it.get("item_descripcion") or it.get("descripcion") or "")
                        for it in _items_mi + _items_parser]
    _descs_ocds = [str(it.get("description") or "") for it in (tender.get("items") or []) if isinstance(it, dict)]
    _descs_ocds += [str((it.get("descripcion") if isinstance(it, dict) else "") or "")
                    for it in (state.get("convocatoria_items") or [])]
    findings_raw = mk.get("findings") or []
    findings = []
    findings_descartados: list[str] = []
    for f in findings_raw:
        if not isinstance(f, dict):
            continue
        desc = (f.get("item_descripcion") or "")
        num = str(f.get("item_numero") or "").strip()
        if num and num in _nums_conocidos:
            findings.append(f)
            continue
        if desc and any(coincide_objeto_detalle(desc, [d]).get("comunes") for d in _descs_conocidas if d):
            findings.append(f)
            continue
        if not desc or not objeto_contrato:
            findings.append(f)
            continue
        det = coincide_objeto_detalle(objeto_contrato, [desc])
        if not det.get("coincide"):
            det2 = coincide_objeto_detalle(desc, _descs_ocds + _descs_conocidas)
            if det2.get("coincide") and det2.get("comunes"):
                findings.append(f)
                continue
            findings_descartados.append(desc[:80])
            continue
        findings.append(f)
    if findings_descartados:
        try:
            print(json.dumps({
                "_vigia": True,
                "kind": "market_findings_descartados",
                "ocid": state.get("ocid"),
                "objeto_contrato": objeto_contrato[:100],
                "n_descartados": len(findings_descartados),
                "descripciones": findings_descartados[:5],
            }, ensure_ascii=False), flush=True)
        except Exception:
            pass
        state.setdefault("descartes", []).append({
            "donde": "persist_market_flags_as_banderas", "agente": "market_price_agent",
            "motivos": ["item_sin_correlato_documental_ni_rubro"],
            "evidencia": "; ".join(findings_descartados[:5])[:240]})
        if not findings:
            return {
                "persistidas": 0,
                "mensaje": (
                    "Todos los findings del market_price_agent fueron descartados: sus ítems no "
                    "existen en market_input/parser ni corresponden al rubro del objeto "
                    f"'{objeto_contrato[:80]}'. Posible alucinación del agente."
                ),
                "findings_descartados": findings_descartados,
            }

    veredicto_global = (mk.get("veredicto_global") or "").lower()
    sobreprecio_pct = mk.get("sobreprecio_pct")
    total_ofertado = mk.get("total_ofertado")
    total_mercado = mk.get("total_estimado_mercado")
    # Fallback: si el LLM no llenó sobreprecio_pct, computar del padre lote
    if sobreprecio_pct is None and total_ofertado and total_mercado:
        try:
            sobreprecio_pct = ((total_ofertado - total_mercado) / total_mercado) * 100
        except Exception:
            pass
    # Guardarraíl (T6/T14): un veredicto global `no_verificable` del mercado no produce
    # bandera de lote; un sobreprecio > 300 % con cobertura insuficiente tampoco.
    _lote_no_verificable = veredicto_global in ("no_verificable", "sin_dato")

    banderas_a_persistir: list[dict] = []

    # 1) Banderas por sub-ítem (sobreprecio + spec restrictiva)
    for f in findings:
        if not isinstance(f, dict):
            continue
        item_desc = (f.get("item_descripcion") or "")[:80]
        veredicto_item = (f.get("veredicto") or "").lower()
        if veredicto_item == "muy_elevado":
            banderas_a_persistir.append({
                "regla": "sobreprecio_muy_elevado",
                "severidad": "alta",
                "evidencia": (
                    f"Ítem '{item_desc}': precio ofertado {f.get('diff_pct',0):.1f}% "
                    f"por encima de la mediana de mercado."
                )[:500],
                "norma": "Art. 12 Reglamento Ley 32069 — valor referencial razonable",
            })
        elif veredicto_item == "elevado":
            banderas_a_persistir.append({
                "regla": "sobreprecio_elevado",
                "severidad": "media",
                "evidencia": (
                    f"Ítem '{item_desc}': precio ofertado {f.get('diff_pct',0):.1f}% "
                    f"por encima de la mediana de mercado."
                )[:500],
                "norma": "Art. 12 Reglamento Ley 32069 — valor referencial razonable",
            })
        if f.get("spec_restrictiva"):
            banderas_a_persistir.append({
                "regla": "spec_restrictiva",
                "severidad": "alta",
                "evidencia": (
                    f"Ítem '{item_desc}': {str(f.get('spec_restrictiva',''))[:300]}"
                )[:500],
                "norma": _norma(state, "competencia"),
            })

    # 2) Bandera de sobreprecio del LOTE completo (cuando hay padre OCDS
    #    con N sub-items y la suma de mercado vs ofertado da diferencia)
    # COBERTURA POR VALOR (lote 1 · T14): Σ(cantidad × precio) de los ítems con mediana
    # sobre Σ de todos los ítems; con 1 solo ítem la bandera de lote duplica la del ítem
    # (1225030: misma evidencia, doble score) → solo con n_items ≥ 2 y cobertura ≥ 0.7.
    # Si el mercado ya calculó `cobertura_valor` (R3) se respeta.
    _fi = [f for f in findings if isinstance(f, dict)]
    _cobertura_mercado = _cobertura_por_valor(_fi, mk)
    _n_items_lote = int(mk.get("n_items") or len(_fi) or 0)
    _lote_ok = (isinstance(sobreprecio_pct, (int, float)) and _n_items_lote >= 2
                and _cobertura_mercado >= 0.7 and not _lote_no_verificable
                and not (sobreprecio_pct > 300 and _cobertura_mercado < 0.9))
    if _lote_ok:
        # Los totales pueden venir None aunque el pct esté (el LLM no siempre
        # llena total_ofertado/total_mercado) → formatear S/. solo si son números.
        _has_montos = isinstance(total_ofertado, (int, float)) and isinstance(total_mercado, (int, float))
        _detalle = (
            f"precio ofertado total S/. {total_ofertado:,.2f} vs estimado de mercado S/. {total_mercado:,.2f} "
            if _has_montos else ""
        )
        if sobreprecio_pct >= 50:
            banderas_a_persistir.append({
                "regla": "sobreprecio_lote_muy_elevado",
                "severidad": "alta",
                "evidencia": (
                    f"Lote completo: {_detalle}({sobreprecio_pct:+.1f}% sobre el estimado de mercado)."
                )[:500],
                "norma": "Art. 12 Reglamento Ley 32069 — valor referencial razonable",
            })
        elif sobreprecio_pct >= 15:
            banderas_a_persistir.append({
                "regla": "sobreprecio_lote_elevado",
                "severidad": "media",
                "evidencia": (
                    f"Lote completo: {_detalle}({sobreprecio_pct:+.1f}% sobre el estimado de mercado)."
                )[:500],
                "norma": "Art. 12 Reglamento Ley 32069 — valor referencial razonable",
            })

    if not banderas_a_persistir:
        lim = _limpiar_banderas_agente(alerta_codigo, "market_price_agent", state)
        return {"persistidas": 0, "mensaje": "Sin hallazgos de sobreprecio o spec restrictiva en market_analysis", **lim}

    # Normalizar alerta_codigo
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
            tool_context.state["pending_market_flags"] = banderas_a_persistir
            return {
                "persistidas": 0,
                "skipped": True,
                "alerta_codigo": raw_codigo,
                "mensaje": "Alerta aún no creada. banderas quedan en state['pending_market_flags'].",
            }
        alerta_id = row[0]
        _fuente_oficial = f"https://contratacionesabiertas.oece.gob.pe/proceso/{state.get('ocid') or raw_codigo.replace('OECE-', '')}"

        # Idempotencia: borrar previas del mismo agente (solo las propias)
        cur.execute(
            "DELETE FROM banderas WHERE alerta_id=%s AND agente_origen='market_price_agent'",
            (alerta_id,),
        )
        cur.execute("SELECT score FROM alertas WHERE id=%s", (alerta_id,))
        cur_score = (cur.fetchone() or [0])[0] or 0

        persistidas = []
        descartadas = 0
        for b in banderas_a_persistir:
            b.setdefault("fuente_url", _fuente_oficial)
            if not _verificar_o_descartar(b, state, "persist_market_flags_as_banderas", "market_price_agent"):
                descartadas += 1
                continue
            _insert_bandera(cur, alerta_id, b["regla"], b["severidad"], b["evidencia"], b["norma"],
                            _fuente_oficial, "market_price_agent", b.get("verificacion"))
            persistidas.append(b)

        new_score, _ = _recalcular_score(cur, alerta_id, state)
        conn.commit()
        state.pop("pending_market_flags", None)
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
persist_market_flags_as_banderas_tool = FunctionTool(func=persist_market_flags_as_banderas)
