"""Helpers compartidos del dominio persistence: score, verificación de banderas,
inserción/lectura en BD, montos y limpieza idempotente por agente. Usados por
`alert_flags`, `doc_flags`, `market_flags` y `analysis_outputs` (2+ de esos
módulos referencian cada símbolo de aquí — ver el grafo de referencias del
monolito original antes del split)."""

from tools._core import *  # noqa: F401,F403
import hashlib as _hashlib
from tools import verify as _verify
from tools.compliance_rules import (norma_aplicable as _norma_aplicable, _fecha_convocatoria_state,
                                    _monto_adjudicado_ocds, _montos_ocds)

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


def _norma_slug(s: str) -> str:
    import unicodedata
    s = "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn")
    return s.lower().strip()


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


def _limpiar_banderas_agente(alerta_codigo: str, agente: str, state: dict) -> dict:
    """Idempotencia cuando un agente corrió y NO produjo banderas: borra las suyas de la corrida
    anterior y recalcula el score (sin esto quedaban banderas obsoletas — 1225416: sobreprecio de
    lote +17 % de una corrida vieja con un mercado nuevo en +0.6 %)."""
    raw_codigo = (alerta_codigo or "").strip()
    if raw_codigo.startswith("ocds-"):
        raw_codigo = "OECE-" + _short_ocid(raw_codigo)
    if raw_codigo and not raw_codigo.startswith("OECE-") and raw_codigo.isdigit():
        raw_codigo = f"OECE-{raw_codigo}"
    try:
        conn = _pg()
    except Exception as e:  # noqa: BLE001
        return {"limpiadas": 0, "error": str(e)[:120]}
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM alertas WHERE codigo=%s", (raw_codigo,))
        row = cur.fetchone()
        if not row:
            return {"limpiadas": 0}
        cur.execute("DELETE FROM banderas WHERE alerta_id=%s AND agente_origen=%s", (row[0], agente))
        n = cur.rowcount
        if n:
            _recalcular_score(cur, row[0], state)
        conn.commit()
        return {"limpiadas": int(n or 0)}
    except Exception as e:  # noqa: BLE001
        return {"limpiadas": 0, "error": str(e)[:120]}
    finally:
        conn.close()
