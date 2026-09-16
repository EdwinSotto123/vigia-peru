"""Tools del dominio: persistence.

Reglas de persistencia (WS V · auditoría #1, #2, §6.1-1, §6.2-5, §6.2-9):
  · Cada agente borra SOLO sus propias banderas (`agente_origen`) — nunca las de otros.
  · El `score` de la alerta se recalcula SIEMPRE con TODAS las banderas persistidas.
  · Toda bandera pasa por `verify.verificar_bandera` antes del INSERT; las que no
    superan la verificación (RUC/DNI/monto no respaldado) van a state['descartes'] y
    NO se persisten. El resultado queda en `banderas.verificacion` (JSONB).
  · `pending_doc_flags` y `pending_market_flags` (diferidas porque la alerta aún no
    existía) se consumen en `persist_analysis_outputs` y se limpian del state.
  · Un output de agente que no parsea como JSON se persiste como
    `{"estado": "sin_dato", "_parse_failed": true}` (no texto crudo) y se registra warn.
"""

from tools._core import *  # noqa: F401,F403
import hashlib as _hashlib
import time as _time
from tools import verify as _verify
from tools.compliance_rules import (norma_aplicable as _norma_aplicable, _fecha_convocatoria_state,
                                    _monto_adjudicado_ocds, _montos_ocds, coincide_objeto_detalle)

# Pesos de score por severidad según origen (los de compliance ya eran 35/18/8; los
# demás agentes 25/12/5). Se mantienen, pero ahora se suman sobre TODAS las banderas.
_PESOS = {"compliance_agent": {"alta": 35, "media": 18, "baja": 8}}
_PESOS_DEFAULT = {"alta": 25, "media": 12, "baja": 5}


def _peso(agente: str | None, severidad: str | None) -> int:
    return _PESOS.get(agente or "", _PESOS_DEFAULT).get(severidad or "", 5)


def _norma(state: dict, clave: str) -> str:
    """Norma citada según el régimen del proceso (Ley 32069 desde 22-abr-2025; antes TUO 30225)."""
    try:
        return _norma_aplicable(_fecha_convocatoria_state(state or {}))[clave]
    except Exception:
        return _norma_aplicable(None).get(clave, "")


# T13 (lote 1): NO hay `ALTER TABLE … IF NOT EXISTS` en el camino de persistencia. Aunque la
# columna exista, el ALTER pide ACCESS EXCLUSIVE sobre `banderas`/`alertas`, espera a que
# termine cualquier lectura abierta (API, dispatcher, otra corrida) y mientras espera bloquea
# a todos los lectores: era el hueco de 4 min del checkpoint (1225266). Las columnas
# `banderas.verificacion` (migración 18) y `alertas.analisis_full/dictamen_markdown/
# analizado_en` (07) y `alertas.monto_referencial` (21) se crean SOLO por migración.


def _insert_bandera(cur, alerta_id, regla, severidad, evidencia, norma, fuente_url,
                    agente_origen, verificacion) -> None:
    cur.execute(
        """INSERT INTO banderas (alerta_id, regla, severidad, evidencia, norma,
                                 fuente_url, agente_origen, verificacion)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)""",
        (alerta_id, (regla or "sin_regla")[:80], severidad if severidad in ("alta", "media", "baja") else "media",
         (evidencia or "")[:500], (norma or "")[:300], (fuente_url or None),
         agente_origen, json.dumps(verificacion or {}, ensure_ascii=False, default=str)),
    )


def _leer_banderas(cur, alerta_id) -> list[dict]:
    cur.execute(
        "SELECT regla, severidad, evidencia, norma, fuente_url, agente_origen, verificacion "
        "FROM banderas WHERE alerta_id=%s ORDER BY CASE severidad WHEN 'alta' THEN 1 "
        "WHEN 'media' THEN 2 ELSE 3 END, id", (alerta_id,))
    out = []
    for r in cur.fetchall():
        ver = r[6]
        if isinstance(ver, str):
            ver = _safe_parse_json(ver)
        out.append({"regla": r[0], "severidad": r[1], "evidencia": r[2], "norma": r[3],
                    "fuente_url": r[4], "agente_origen": r[5], "verificacion": ver})
    return out


def _recalcular_score(cur, alerta_id, state=None) -> tuple[int, list[dict]]:
    """score = min(100, Σ peso(agente, severidad)) sobre TODAS las banderas de la alerta.
    Actualiza `alertas.score` y `reglas_disparadas`; deja state['banderas'] con la
    lista completa (todos los agentes) y devuelve (score, banderas)."""
    banderas = _leer_banderas(cur, alerta_id)
    score = min(sum(_peso(b.get("agente_origen"), b.get("severidad")) for b in banderas), 100)
    reglas = sorted({b["regla"] for b in banderas if b.get("regla")})
    cur.execute("UPDATE alertas SET score=%s, reglas_disparadas=%s, updated_at=NOW() WHERE id=%s",
                (score, reglas, alerta_id))
    if state is not None:
        state["banderas"] = banderas
        state["score"] = score
    return score, banderas


def _verificar_o_descartar(flag: dict, state: dict, donde: str, agente: str) -> bool:
    """True si la bandera pasa la verificación determinista; si no, la registra en
    state['descartes'] y devuelve False."""
    try:
        res = _verify.verificar_bandera(flag, state)
    except Exception as e:  # la verificación nunca debe tumbar el persist
        res = {"ok": True, "motivos": [f"verificacion_error:{str(e)[:80]}"], "n_checks": 0}
        flag["verificacion"] = res
    if res.get("ok"):
        return True
    entry = {
        "donde": donde, "agente": agente, "regla": flag.get("regla"),
        "severidad": flag.get("severidad"),
        "evidencia": (str(flag.get("evidencia") or flag.get("descripcion") or ""))[:240],
        "motivos": [m for m in res.get("motivos", []) if m.endswith("no_respaldado")][:8],
    }
    descartes = state.setdefault("descartes", [])
    if not any(d.get("regla") == entry["regla"] and d.get("evidencia") == entry["evidencia"]
               for d in descartes if isinstance(d, dict)):
        descartes.append(entry)
    try:
        print(json.dumps({"_vigia": True, "kind": "bandera_descartada", "donde": donde,
                          "regla": flag.get("regla"), "motivos": res.get("motivos", [])[:6]},
                         ensure_ascii=False), flush=True)
    except Exception:
        pass
    return False


def _normalizar_red_flag(rf) -> tuple[str, str, str] | None:
    """(descr, severidad, norma) desde un red_flag del legal (str o dict)."""
    if isinstance(rf, str):
        return rf, "media", None
    if isinstance(rf, dict):
        descr = rf.get("descripcion") or rf.get("texto") or rf.get("evidencia") or str(rf)
        sev = (rf.get("severidad") or "media").lower()
        if sev not in ("alta", "media", "baja"):
            sev = "media"
        return descr, sev, (rf.get("norma_citada") or rf.get("norma"))
    return None


def _advisory_lock(cur, key_str: str) -> None:
    """Lock xact-scoped por OCID/código: serializa corridas concurrentes del MISMO
    proceso para que no se pisen el DELETE+INSERT de banderas (carrera real observada
    con runs solapados — una corrida borra las banderas de la otra). Se libera solo
    al commit/close de la transacción. Defensivo: si falla, NO rompe el persist
    (peor caso = comportamiento previo sin lock)."""
    try:
        k = int.from_bytes(_hashlib.blake2b((key_str or "vigia").encode("utf-8"),
                                            digest_size=8).digest(), "big", signed=True)
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (k,))
    except Exception:
        pass


def _montos_alerta(state: dict, cuantia_bd) -> tuple[float | None, float | None, str | None]:
    """(monto_adjudicado, monto_referencial, fuente) para `alertas` (lote 1 · T8).
    monto_adjudicado = contracts[].value > awards[].value > oferta ganadora del acta >
    referencial (marcado `fuente='referencial'`). Antes la columna guardaba el VR
    (741 750 en vez de 734 010 en 1225030; 1 100 900 en vez de 920 000 en 1225416)."""
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    referencial = _montos_ocds(ocds).get("referencial")
    try:
        if referencial is None and cuantia_bd:
            referencial = float(cuantia_bd)
    except (TypeError, ValueError):
        pass
    adjudicado, fuente = _monto_adjudicado_ocds(ocds)
    if adjudicado is None:
        try:
            from tools.compliance_rules import _postores_parser
            g = next((p for p in _postores_parser(state or {}) if p.get("es_ganador") and p.get("monto")), None)
            if g:
                adjudicado, fuente = float(g["monto"]), "acta_parser"
        except Exception:
            pass
    if adjudicado is None and referencial:
        adjudicado, fuente = referencial, "referencial"
    return adjudicado, referencial, fuente


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
        return {"alerta_codigo": None, "score": 0, "banderas_persistidas": 0,
                "mensaje": "Sin banderas — no se creó alerta"}
    # Verificación determinista ANTES de tocar la BD: lo no respaldado se descarta.
    banderas = [b for b in banderas
                if _verificar_o_descartar(b, state, "persist_alert_from_flags", "compliance_agent")]
    n_descartadas = len(_vistas) - len(banderas)
    if not banderas:
        return {"alerta_codigo": None, "score": 0, "banderas_persistidas": 0,
                "banderas_descartadas": n_descartadas,
                "mensaje": "Todas las banderas fueron descartadas por la verificación determinista"}
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
        return {"persistidas": 0, "mensaje": "Sin red_flags del legal_analyst en state"}

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
        return {"persistidas": 0, "mensaje": "Sin hallazgos de sobreprecio o spec restrictiva en market_analysis"}

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

def persist_analysis_outputs(alerta_codigo: str, tool_context: ToolContext) -> dict:
    """Persiste el análisis completo de los sub-agentes en Cloud SQL para
    que se pueda consultar el histórico de convocatorias analizadas. Guarda:
      · `market_analysis` (JSON estructurado del market_price_agent)
      · `document_analysis` (JSON estructurado del document_parser_agent)
      · `web_research` (JSON estructurado del web_research_agent)
      · `news_research` (JSON del news_research_agent — prensa peruana)
      · `person_network` (JSON del person_network_agent — gerente + red)
      · `final_dictamen` (markdown del report_writer_agent)
    Todo va a la columna `alertas.analisis_full` (JSONB) + columnas individuales.

    Args:
        alerta_codigo: Código de la alerta (ej. 'OECE-1203694') creada por
                       compliance_agent.

    Returns:
        Diccionario con `persisted`, `bytes_saved`, `alerta_codigo`.
    """
    state = tool_context.state
    warns: list[str] = []
    # Intenta parsear los outputs que vienen como JSON string del LLM
    def _try_parse(s, clave: str = "?"):
        if not s:
            return s
        if not isinstance(s, str):
            return s
        # 1. JSON directo
        try:
            return json.loads(s)
        except Exception:
            pass
        # 2. Limpiar fences markdown ```json ... ```
        s_clean = s.strip()
        if s_clean.startswith("```"):
            first_nl = s_clean.find("\n")
            if first_nl > 0:
                s_clean = s_clean[first_nl + 1:]
            if s_clean.endswith("```"):
                s_clean = s_clean[:-3].strip()
            try:
                return json.loads(s_clean)
            except Exception:
                pass
        # 3. Regex que busca el JSON externo (más codicioso)
        m = re.search(r"\{[\s\S]+\}", s)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
        # 4. Sin fallback a texto crudo (auditoría §6.2-9): un output que no parsea
        # es `sin_dato` explícito + warn; el texto libre no se persiste ni se muestra
        # como si fuera análisis.
        warns.append(f"{clave}: output del agente no parseable como JSON ({len(s)} chars) → sin_dato")
        state.setdefault("descartes", []).append({
            "donde": "persist_analysis_outputs", "agente": clave,
            "motivos": ["json_no_parseable"], "chars": len(s)})
        return {"estado": "sin_dato", "_parse_failed": True,
                "_motivo": "output del agente no parseable como JSON"}

    # document_analysis: combinar el output del agente (que puede tener resumen
    # narrativo) con el parser_raw_consolidated (que tiene la data completa
    # de cada PDF procesado: items, firmantes, motivos, comité). El raw gana
    # en data estructurada; el output del agente aporta el resumen ejecutivo.
    doc_from_agent = _try_parse(state.get("document_analysis"), "document_analysis") or {}
    doc_raw = state.get("parser_raw_consolidated") or {}
    if isinstance(doc_from_agent, dict) and doc_raw:
        # Mergeamos: si el agente NO tiene un campo o lo tiene vacío, usamos el del raw
        for k in ("items_consolidados", "postores_extraidos", "postores_consolidados",
                  "firmantes", "firmantes_consolidados", "comite_evaluacion",
                  "motivos_adjudicacion", "red_flags_documentales",
                  "red_flags_observadas", "fundamento_legal", "lugar_fecha_acta",
                  "documentos"):
            raw_v = doc_raw.get(k)
            agent_v = doc_from_agent.get(k)
            # Si el raw tiene más items, gana
            if isinstance(raw_v, list) and len(raw_v) > (len(agent_v) if isinstance(agent_v, list) else 0):
                # Para firmantes_consolidados ↔ firmantes, asegurar ambos keys
                doc_from_agent[k] = raw_v
                if k == "firmantes_consolidados" and not doc_from_agent.get("firmantes"):
                    doc_from_agent["firmantes"] = raw_v
                elif k == "red_flags_observadas" and not doc_from_agent.get("red_flags_documentales"):
                    doc_from_agent["red_flags_documentales"] = raw_v
            elif raw_v and not agent_v:
                doc_from_agent[k] = raw_v
        # Forzar campos críticos si están en raw
        if doc_raw.get("items_consolidados") and not doc_from_agent.get("items_consolidados"):
            doc_from_agent["items_consolidados"] = doc_raw["items_consolidados"]

    # Dedup FINAL de variantes del mismo bien sobre la lista que se va a persistir
    # (el agente suele listar 'EQUIPO DE FTIR' / 'Equipo FTIR' / 'Equipo de FTIR
    # Espectrofotómetro...' como ítems separados; el merge del parser no alcanza
    # porque el persist se queda con la lista —más larga— del agente).
    _final_doc = doc_from_agent or doc_raw
    if isinstance(_final_doc, dict):
        # GARANTÍA DETERMINISTA: el parser es extractor puro; NO debe llevar banderas.
        # Aunque el LLM del parser emita `red_flags_documentales` por hábito (con
        # alucinaciones tipo "Microsoft Office"/"ISO 19798"), las eliminamos del JSON
        # persistido. El análisis de riesgo legal vive SOLO en `legal_analysis`.
        _final_doc.pop("red_flags_documentales", None)
        _final_doc.pop("red_flags_observadas", None)
        # comité / motivos de adjudicación / acta: la AUTORIDAD es
        # `parser_raw_consolidated`, que ya viene GATED por tipo de documento (solo
        # acepta estos campos de actas/evaluaciones/contratos, NO de Bases/TDR). El
        # `document_analysis` del agente (LLM) puede re-inventarlos aunque el doc no
        # los tenga (proceso no competitivo) → los forzamos desde el raw gated.
        # Fix de raíz: no depende de blocklists de nombres ni de heurísticas de fecha.
        if isinstance(doc_raw, dict) and doc_raw:
            _final_doc["comite_evaluacion"] = doc_raw.get("comite_evaluacion") or []
            _final_doc["motivos_adjudicacion"] = doc_raw.get("motivos_adjudicacion") or []
            _final_doc["lugar_fecha_acta"] = doc_raw.get("lugar_fecha_acta")
        # SIN dedup fuzzy de ítems acá: los ítems ya vienen de la extracción única de la
        # Bases (parser_raw_consolidated, deduplicada por _item_key exacto). El viejo
        # `_merge_item_variants` (token-overlap) SOBRE-FUSIONABA productos legítimamente
        # distintos (ej. 'AMPLIFICADOR DE AUDIO' #1 vs 'AMPLIFICADOR DE AUDIO DE 600 W' #3
        # → 1) — se eliminó como parte de la simplificación del flujo de ítems.

        # Guard anti-placeholder de firmantes: el parser a veces invent a/templa
        # firmantes genéricos de una proforma ("POSTOR DOS E.I.R.L.", "Juan Perez"
        # con entidad "Entidad Contratante", sin DNI). Descartamos los que NO tienen
        # DNI Y tienen una ENTIDAD genérica de plantilla. Keyeamos por la ENTIDAD
        # (segura), nunca por el nombre solo — "Juan Perez" podría ser real. Los
        # firmantes con DNI o con entidad nombrada (empresa/GORE real) se mantienen.
        import re as _re_ph

        def _firmante_placeholder(f):
            if not isinstance(f, dict):
                return True
            if str(f.get("dni") or "").strip():
                return False  # con DNI → es real
            ent = str(f.get("entidad") or "").strip().lower()
            if not ent:
                return False  # sin entidad no es señal suficiente por sí sola
            if _re_ph.match(r"^(el|la)?\s*(postor|proveedor|contratista|licitante|adjudicatari)\b", ent):
                return True
            return ent in ("entidad contratante", "entidad", "la entidad", "el proveedor",
                           "proveedor", "postor", "el postor", "la empresa", "empresa")
        for _key in ("firmantes", "firmantes_consolidados"):
            _fl = _final_doc.get(_key)
            if isinstance(_fl, list) and _fl:
                _keep = [f for f in _fl if not _firmante_placeholder(f)]
                if len(_keep) < len(_fl):
                    print(f"[persist] firmantes placeholder descartados en {_key}: "
                          f"{len(_fl)}→{len(_keep)}", flush=True)
                _final_doc[_key] = _keep

    analisis = {
        "market_analysis":      _try_parse(state.get("market_analysis"), "market_analysis"),
        "document_analysis":    _final_doc,
        "web_research":         _try_parse(state.get("web_research"), "web_research"),
        "news_research":        _try_parse(state.get("news_research"), "news_research"),
        "person_network":       _try_parse(state.get("person_network"), "person_network"),
        # Pre-fetched data por persona — el frontend lo usa para mostrar
        # vinculaciones políticas (ONPE/JNE/PEP/visitas) de TODAS las personas
        # investigadas (titular + socios + familia + firmantes + comité),
        # no solo de persona_principal.
        "person_network_context": state.get("person_network_context"),
        # CAPA 3 — funcionarios designados de la entidad (gerentes municipales,
        # procurador, asesor legal, OCI). Output del entity_personnel_agent.
        "entity_personnel": _try_parse(state.get("entity_personnel"), "entity_personnel"),
        "normative_compliance": state.get("normative_compliance"),
        # WS V: trazabilidad de lo que NO entró al análisis y del control del dictamen.
        "recortes":             state.get("recortes") or [],
        "descartes":            state.get("descartes") or [],
        "validaciones_pendientes": state.get("validaciones_pendientes"),
        "verificacion_dictamen": state.get("verificacion_dictamen"),
        "perfil":               state.get("perfil") or state.get("pipeline_profile"),
        # `compliance_summary` se completa más abajo con el conteo REAL de banderas de la
        # alerta (lote 1 · T5): el texto del agente decía "0 banderas" porque se genera
        # antes de compliance_extended/mercado/legal.
        "compliance_summary":   state.get("compliance_result"),
        # T5: el análisis legal (agente más caro tras el dictamen) no se guardaba.
        "legal_analysis":       _try_parse(state.get("legal_analysis"), "legal_analysis"),
        "compliance_extended":  _try_parse(state.get("compliance_extended"), "compliance_extended"),
        "reglas_lote1":         state.get("reglas_lote1"),
        "montos_alerta":        state.get("montos_alerta"),
        "items_otros_documentos": (state.get("parser_raw_consolidated") or {}).get("items_otros_documentos"),
        # Causal de Contratación Directa (si aplica) + acto resolutivo encontrado
        "causal_directa_invocada": state.get("causal_directa_invocada"),
        "acto_resolutivo_directa": state.get("acto_resolutivo_directa"),
        # Fase 1+2 — estado real y patrones de postores (incluso si no hay ganador)
        "estado_real":          state.get("estado_real"),
        "analisis_postores":    state.get("analisis_postores"),
        # Bloques tipados por documento (ruteo incremental): estudio de mercado +
        # causal (Resumen Ejecutivo/Informe) y condiciones finales (Orden de Compra).
        "estudio_mercado":      _try_parse(state.get("estudio_mercado"), "estudio_mercado"),
        "contrato_final":       _try_parse(state.get("contrato_final"), "contrato_final"),
    }
    for w in warns:
        try:
            print(json.dumps({"_vigia": True, "kind": "warn", "donde": "persist_analysis_outputs",
                              "msg": w}, ensure_ascii=False), flush=True)
        except Exception:
            pass
    dictamen_md = state.get("final_dictamen") or ""
    _t0 = _time.monotonic()
    tiempos: dict[str, float] = {}

    # Normalizar el alerta_codigo: el LLM a veces pasa el OCID completo
    # (ej. 'ocds-dgv273-seacev3-1213010') en vez del código corto. Si detectamos
    # eso, lo convertimos a 'OECE-XXXXXXX'.
    raw_codigo = (alerta_codigo or "").strip()
    if raw_codigo.startswith("ocds-"):
        raw_codigo = "OECE-" + _short_ocid(raw_codigo)
    if raw_codigo and not raw_codigo.startswith("OECE-") and raw_codigo.isdigit():
        raw_codigo = f"OECE-{raw_codigo}"

    # Si no recibimos alerta_codigo o aún no existe la fila, derivamos uno
    # desde el OCID que el orquestador tiene en state. SIEMPRE persistimos
    # el análisis aunque no haya alerta formal de compliance.
    # IMPORTANTE: normalizar OCID al formato corto que usa convocatorias/alertas
    # (sin prefijo 'ocds-dgv273-seacev3-'). Bug detectado 2026-05-25 en OCID
    # 1212841: persist_analysis_outputs intentaba INSERT con ocid largo y la
    # FK alertas_ocid_fkey → convocatorias.ocid (que es corto) fallaba.
    ocid_raw = state.get("ocid") or ((state.get("ocds") or {}).get("ocid"))
    ocid = _short_ocid(ocid_raw) if ocid_raw else None
    if not raw_codigo and ocid:
        raw_codigo = f"OECE-{ocid}"

    conn = _pg()
    try:
        cur = conn.cursor()
        _advisory_lock(cur, raw_codigo)
        tiempos["lock_s"] = round(_time.monotonic() - _t0, 3)
        # T13: sin `ALTER TABLE … IF NOT EXISTS` aquí (ver nota al inicio del módulo): las
        # columnas analisis_full / dictamen_markdown / analizado_en existen por migración.
        cur.execute("SELECT id, codigo FROM alertas WHERE codigo=%s", (raw_codigo,))
        row = cur.fetchone()

        # Si la alerta no existe (compliance no creó banderas duras), creamos
        # una alerta-stub. Intentamos sacar datos de `convocatorias` PERO si esa
        # fila tampoco existe (porque register_convocatoria_in_db falló silen.),
        # fallback al OCDS del state. EL STUB SE CREA SIEMPRE QUE TENGAMOS OCID.
        _stub_created = False
        if not row and ocid:
            cur.execute(
                """SELECT entidad_ruc, region, fecha_buena_pro, objeto, cuantia_referencial,
                          (SELECT empresa_ruc FROM postores p
                             JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                            WHERE p.ocid=convocatorias.ocid LIMIT 1)
                     FROM convocatorias WHERE ocid=%s""",
                (ocid,),
            )
            conv = cur.fetchone()
            if conv:
                ent_ruc, region, fbp, objeto, cuantia, prov_ruc = conv
            else:
                # Fallback al OCDS en state (mejor algo que nada).
                ocds_state = state.get("ocds") or state.get("ocds_preloaded") or {}
                tender = ocds_state.get("tender") or {}
                buyer = next((p for p in (ocds_state.get("parties") or [])
                              if "buyer" in (p.get("roles") or [])), {})
                addr = (buyer.get("address") or {})
                # Mismo cuidado que en persist_alert_from_flags: entidad_ruc es
                # CHAR(11). Tomamos sólo dígitos del identifier (o del id) y
                # exigimos largo 11; cualquier otra cosa → None (evita 22001).
                _raw_ent_id = ((buyer.get("identifier") or {}).get("id")
                               or buyer.get("id") or "")
                _ent_digits = "".join(ch for ch in _raw_ent_id if ch.isdigit())
                ent_ruc = _ent_digits if len(_ent_digits) == 11 else None
                # Garantiza la fila padre (FK entidad_ruc→entidades) para no
                # disparar 23503 cuando register_convocatoria no corrió.
                if ent_ruc:
                    cur.execute(
                        "INSERT INTO entidades (ruc, nombre, tipo) VALUES (%s, %s, 'organismo_autonomo') "
                        "ON CONFLICT (ruc) DO NOTHING",
                        (ent_ruc, buyer.get("name") or ""),
                    )
                region = addr.get("region") or addr.get("department") or None
                fbp = None
                objeto = tender.get("description") or tender.get("title") or ""
                v = tender.get("value")
                cuantia = (v.get("amount") if isinstance(v, dict) else None)
                prov_ruc = None
            monto_adj, monto_ref, _fuente_monto = _montos_alerta(state, cuantia)
            if not prov_ruc:
                from tools.compliance_rules import _ganador_ocds
                prov_ruc, _ = _ganador_ocds(state.get("ocds") or state.get("ocds_preloaded") or {})
            cur.execute(
                """INSERT INTO alertas
                     (codigo, ocid, entidad_ruc, proveedor_ruc, monto_adjudicado, monto_referencial,
                      fecha_buena_pro, region, score, reglas_disparadas, estado,
                      objeto, codigo_convocatoria, fuente_url, analizado_en)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 0, '{}', 'activa',
                           %s, %s, %s, NOW())
                   ON CONFLICT (codigo) DO UPDATE SET analizado_en=NOW(),
                     monto_adjudicado=COALESCE(EXCLUDED.monto_adjudicado, alertas.monto_adjudicado),
                     monto_referencial=COALESCE(EXCLUDED.monto_referencial, alertas.monto_referencial),
                     updated_at=NOW()
                   RETURNING id""",
                (raw_codigo, ocid, ent_ruc, prov_ruc, monto_adj, monto_ref, fbp, region,
                 (objeto or "")[:500], ocid.split("-")[-1],
                 f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"),
            )
            state["montos_alerta"] = {"monto_adjudicado": monto_adj, "monto_referencial": monto_ref, "fuente": _fuente_monto}
            analisis["montos_alerta"] = state["montos_alerta"]
            _stub_created = True
            print(f"[persist_analysis] stub creado para {raw_codigo} (convocatoria_existia={conv is not None})")
        elif row:
            # Alerta ya creada por compliance: corregir monto_adjudicado/monto_referencial con
            # el OCDS del state (T8) sin tocar score ni banderas.
            monto_adj, monto_ref, _fuente_monto = _montos_alerta(state, None)
            if monto_adj or monto_ref:
                cur.execute("UPDATE alertas SET monto_adjudicado=COALESCE(%s, monto_adjudicado), "
                            "monto_referencial=COALESCE(%s, monto_referencial) WHERE id=%s",
                            (monto_adj, monto_ref, row[0]))
                state["montos_alerta"] = {"monto_adjudicado": monto_adj, "monto_referencial": monto_ref, "fuente": _fuente_monto}
                analisis["montos_alerta"] = state["montos_alerta"]
        tiempos["stub_s"] = round(_time.monotonic() - _t0, 3)

        # Banderas DIFERIDAS (skipeadas antes porque la alerta no existía):
        # pending_doc_flags (legal) y pending_market_flags (mercado; hallazgo #2: antes
        # nadie las consumía). Se verifican, se insertan con su agente de origen, se
        # recalcula el score con TODAS y se limpian del state (no se re-insertan en los
        # siguientes checkpoints).
        pending_doc = state.get("pending_doc_flags") or []
        pending_market = state.get("pending_market_flags") or []
        n_pending_inserted = 0
        n_pending_descartadas = 0
        _fuente_proc = f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"
        if pending_doc or pending_market:
            cur.execute("SELECT id FROM alertas WHERE codigo=%s", (raw_codigo,))
            r = cur.fetchone()
            if r:
                alerta_id = r[0]
                if pending_doc:
                    cur.execute("DELETE FROM banderas WHERE alerta_id=%s AND agente_origen IN "
                                "('document_parser_agent','document_legal_analyst_agent')", (alerta_id,))
                for rf in pending_doc:
                    norm = _normalizar_red_flag(rf)
                    if not norm:
                        continue
                    descr, sev, norma = norm
                    norma_final = (norma or _norma(state, "competencia"))[:300]
                    flag = {"regla": "red_flag_documental", "severidad": sev, "evidencia": descr[:500],
                            "norma": norma_final, "fuente_url": _fuente_proc}
                    if not _verificar_o_descartar(flag, state, "persist_analysis_outputs(pending_doc)",
                                                  "document_legal_analyst_agent"):
                        n_pending_descartadas += 1
                        continue
                    _insert_bandera(cur, alerta_id, "red_flag_documental", sev, descr, norma_final,
                                    _fuente_proc, "document_legal_analyst_agent", flag.get("verificacion"))
                    n_pending_inserted += 1
                if pending_market:
                    cur.execute("DELETE FROM banderas WHERE alerta_id=%s AND agente_origen='market_price_agent'",
                                (alerta_id,))
                for b in pending_market:
                    if not isinstance(b, dict):
                        continue
                    b.setdefault("fuente_url", _fuente_proc)
                    if not _verificar_o_descartar(b, state, "persist_analysis_outputs(pending_market)",
                                                  "market_price_agent"):
                        n_pending_descartadas += 1
                        continue
                    _insert_bandera(cur, alerta_id, b.get("regla"), b.get("severidad"), b.get("evidencia"),
                                    b.get("norma"), _fuente_proc, "market_price_agent", b.get("verificacion"))
                    n_pending_inserted += 1
                _recalcular_score(cur, alerta_id, state)
                state.pop("pending_doc_flags", None)
                state.pop("pending_market_flags", None)
        tiempos["pending_s"] = round(_time.monotonic() - _t0, 3)

        # Puente banderas de investigación → banderas (lote 1 · T14): `person_network.
        # banderas_red`, `web_research.banderas_sugeridas`, `news_research.banderas_prensa`
        # se persisten SOLO con evidencia + URL respaldada por grounding/fuente oficial +
        # confianza alta (R2 garantiza el schema). Antes no tenían camino a `banderas`
        # (1225062: parentesco entre postores rivales validado y nunca persistido).
        n_red_inserted, n_red_descartadas = 0, 0
        try:
            candidatas = _banderas_investigacion(state)
        except Exception as _e:
            candidatas = []
            warns.append(f"banderas_investigacion: {str(_e)[:120]}")
        cur.execute("SELECT id FROM alertas WHERE codigo=%s", (raw_codigo,))
        _r = cur.fetchone()
        if _r:
            alerta_id = _r[0]
            cur.execute("DELETE FROM banderas WHERE alerta_id=%s AND agente_origen IN "
                        "('person_network_agent','web_research_agent','news_research_agent')", (alerta_id,))
            for b in candidatas:
                if not _verificar_o_descartar(b, state, "persist_analysis_outputs(investigacion)", b["agente_origen"]):
                    n_red_descartadas += 1
                    continue
                _insert_bandera(cur, alerta_id, b["regla"], b["severidad"], b["evidencia"], b["norma"],
                                b["fuente_url"], b["agente_origen"], b.get("verificacion"))
                n_red_inserted += 1
            score_final, banderas_final = _recalcular_score(cur, alerta_id, state)
            # T5: `compliance_summary` con el conteo REAL (el texto del agente se conserva).
            _por_agente: dict[str, int] = {}
            for b in banderas_final:
                _por_agente[b.get("agente_origen") or "?"] = _por_agente.get(b.get("agente_origen") or "?", 0) + 1
            _texto_llm = state.get("compliance_result")
            _texto_llm = _texto_llm if isinstance(_texto_llm, str) else (json.dumps(_texto_llm, ensure_ascii=False, default=str) if _texto_llm else "")
            _cab = (f"RESULTADO DETERMINISTA (todas las fuentes): {len(banderas_final)} bandera(s) persistida(s) · "
                    f"score {score_final} · reglas: {', '.join(sorted({b.get('regla') or '' for b in banderas_final})) or 'ninguna'} · "
                    f"por agente: {', '.join(f'{k}={v}' for k, v in sorted(_por_agente.items())) or '—'}. "
                    f"El resumen del agente de compliance (abajo) se redactó antes de las reglas extendidas, "
                    f"el análisis legal y el mercado; prevalece el conteo determinista.")
            analisis["compliance_summary"] = _cab + ("\n\n" + _texto_llm if _texto_llm else "")
            analisis["compliance_resumen_det"] = {"n_banderas": len(banderas_final), "score": score_final,
                                                  "por_agente": _por_agente,
                                                  "reglas": sorted({b.get("regla") or "" for b in banderas_final})}
        tiempos["investigacion_s"] = round(_time.monotonic() - _t0, 3)
        analisis["descartes"] = state.get("descartes") or []
        blob = json.dumps(analisis, ensure_ascii=False, default=str)

        cur.execute(
            """UPDATE alertas
                  SET analisis_full = %s::jsonb,
                      dictamen_markdown = %s,
                      analizado_en = NOW(),
                      updated_at = NOW()
                WHERE codigo = %s""",
            (blob, dictamen_md, raw_codigo),
        )
        rows = cur.rowcount
        conn.commit()
        tiempos["total_s"] = round(_time.monotonic() - _t0, 3)
        if rows == 0:
            print(f"[persist_analysis] ⚠ UPDATE no matched: codigo={raw_codigo} ocid={ocid} stub_created={_stub_created}")
        else:
            print(f"[persist_analysis] ✓ persistido {raw_codigo} · bytes={len(blob)} · dictamen={len(dictamen_md)}")
        return {
            "persisted": rows > 0,
            "alerta_codigo": raw_codigo,
            "alerta_codigo_input": alerta_codigo,
            "stub_alerta_created": _stub_created,
            "doc_flags_diferidas_inserted": n_pending_inserted,
            "flags_diferidas_descartadas": n_pending_descartadas,
            "banderas_investigacion_inserted": n_red_inserted,
            "banderas_investigacion_descartadas": n_red_descartadas,
            "warns": warns,
            "rows_updated": rows,
            "bytes_saved": len(blob),
            "dictamen_chars": len(dictamen_md),
            "tiempos": tiempos,
        }
    except Exception as e:
        return {"persisted": False, "error": str(e)[:200], "alerta_codigo_input": alerta_codigo,
                "tiempos": tiempos}
    finally:
        conn.close()


_AGENTES_INVESTIGACION = (
    ("person_network", "banderas_red", "person_network_agent"),
    ("web_research", "banderas_sugeridas", "web_research_agent"),
    ("news_research", "banderas_prensa", "news_research_agent"),
)


def _url_respaldada(url: str, state: dict) -> bool:
    """URL con respaldo: redirect de grounding de Vertex, presente en state['grounding_urls'],
    o ficha canónica (OECE/SEACE/SUNAT). Las URLs de gob.pe escritas por el modelo NO cuentan
    (1225256: normas-legales/<id> inventados)."""
    u = str(url or "").strip().rstrip("/")
    if not u.startswith("http"):
        return False
    try:
        if _verify._es_redirect_grounding(u):
            return True
    except Exception:
        pass
    try:
        g = _verify._grounding_urls(state)
        if g and u in g:
            return True
    except Exception:
        pass
    try:
        host, _ = _verify._host_path(u)
        if host in getattr(_verify, "_CANONICAL_HOSTS", ()):
            return True
    except Exception:
        pass
    return False


def _banderas_investigacion(state: dict) -> list[dict]:
    """Candidatas a bandera desde los agentes de investigación. Exige: evidencia con cita,
    URL respaldada y confianza alta (o `estado` hallado con URL respaldada)."""
    out: list[dict] = []
    for clave, lista, agente in _AGENTES_INVESTIGACION:
        obj = _safe_parse_json(state.get(clave))
        if not isinstance(obj, dict):
            continue
        for b in (obj.get(lista) or []):
            if not isinstance(b, dict):
                continue
            conf = str(b.get("confianza") or b.get("confianza_match") or "").strip().lower()
            estado = str(b.get("estado") or "").strip().lower()
            if conf not in ("alta",) and estado not in ("hallado", "confirmado", "verificado"):
                continue
            if estado in ("no_verificable", "no_hallado", "sin_dato", "descartado"):
                continue
            evs = b.get("evidencia") or []
            if isinstance(evs, dict):
                evs = [evs]
            if isinstance(evs, str):
                evs = [{"cita": evs}]
            citas = [str(e.get("cita") or "") for e in evs if isinstance(e, dict) and str(e.get("cita") or "").strip()]
            urls = [str(e.get("url") or "") for e in evs if isinstance(e, dict) and e.get("url")]
            if b.get("fuente_url"):
                urls.append(str(b["fuente_url"]))
            url_ok = next((u for u in urls if _url_respaldada(u, state)), None)
            if not citas or not url_ok:
                continue
            sev = str(b.get("severidad") or "media").strip().lower()
            if sev not in ("alta", "media", "baja"):
                sev = "media"
            # Slug FIJO por agente (el frontend/verify enumeran reglas); el título libre queda en la evidencia.
            _SLUG_AGENTE = {"web_research": "antecedente_proveedor_web", "news_research": "cobertura_prensa_adversa",
                            "person_network": "vinculo_red_personas"}
            regla_libre = str(b.get("regla") or b.get("titulo") or b.get("nombre") or "").strip()
            regla = _SLUG_AGENTE.get(clave, f"{clave}_hallazgo")
            titulo = re.sub(r"\s+", " ", regla_libre)[:120]
            descr = str(b.get("descripcion") or b.get("detalle") or b.get("resumen") or b.get("titulo") or "")
            if titulo and titulo.lower() not in descr.lower():
                descr = f"{titulo}: {descr}" if descr else titulo
            texto = (descr + (f" Evidencia: {citas[0][:200]}" if citas else "")).strip()
            if not texto:
                continue
            out.append({"regla": regla, "severidad": sev, "evidencia": texto[:500],
                        "norma": str(b.get("norma") or b.get("norma_citada") or _norma(state, "integridad"))[:300],
                        "fuente_url": url_ok, "agente_origen": agente, "confianza": conf or estado})
    return out


def _norma_slug(s: str) -> str:
    import unicodedata
    s = "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn")
    return s.lower().strip()

# ── FunctionTool wrappers ──
persist_alert_from_flags_tool = FunctionTool(func=persist_alert_from_flags)
add_contextual_flag_tool = FunctionTool(func=add_contextual_flag)
persist_doc_flags_as_banderas_tool = FunctionTool(func=persist_doc_flags_as_banderas)
persist_market_flags_as_banderas_tool = FunctionTool(func=persist_market_flags_as_banderas)
persist_analysis_outputs_tool = FunctionTool(func=persist_analysis_outputs)
