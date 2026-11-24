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


# Reglas que se apoyan en el MISMO hecho: «Único postor con oferta alta» y «Oferta igual al valor referencial» salen de
# la misma oferta (la del ganador, igual o casi igual al referencial). Las dos se muestran (dicen cosas distintas: poca
# competencia y posible filtración), pero en el puntaje la de menor peso suma la mitad: antes ese precio contaba dos
# veces y 1228227 llegaba a 100 con dos señales de precio (pedido del usuario del 2026-11-05).
# Lo mismo con una sanción vigente: la ven la regla de la base (`proveedor_sancionado_osce`) y la señal del expediente
# (`sancion_vigente_oece`), y una sola sanción sumaba dos veces 35 (auditoría 2026-11-13).
_MISMO_HECHO_PUNTAJE: tuple[tuple[str, str], ...] = (("unico_postor_alto", "oferta_igual_valor_referencial"),
                                                     ("unica_oferta_valida", "oferta_igual_valor_referencial"),
                                                     ("proveedor_sancionado_osce", "sancion_vigente_oece"))


# ── El RUC nuevo del ganador es UN hecho ──────────────────────────────
# 2026-2543-197 (2026-11-24): que HAMUQ FARMA inició actividades el 6-dic-2024 (615 días a la buena pro) salió en tres
# banderas: la regla `ruc_ganador_muy_nuevo` (alta), la web «empresa recién fundada con alto volumen contractual»
# (`antecedente_proveedor_web`, alta) y el juicio `capacidad_operativa_cuestionable` (media) apoyado solo en esa fecha
# y el monto; con dos notas de prensa de la entidad, el puntaje llegó a 100. Queda la regla más específica (la
# determinista; entre las dos de edad, `ruc_ultra_nuevo`); las otras no se publican si no traen otro hecho.
_RUC_NUEVO = ("ruc_ultra_nuevo", "ruc_ganador_muy_nuevo")
_RE_EDAD_EMPRESA = re.compile(
    r"reci[eé]n\s+(?:fundad|cread|constituid)|inici[oó]\s+(?:sus\s+)?actividades|inicio\s+de\s+(?:sus\s+)?actividades|"
    r"fecha\s+de\s+(?:inicio|constituci[oó]n|alta)|antig[uü]edad|empresa\s+(?:nueva|joven)|nueva\s+empresa|"
    r"reciente\s+(?:creaci[oó]n|constituci[oó]n)|(?:cread|constituid|fundad)a\s+(?:el|en|hace)", re.I)
# Lo que la web puede decir ADEMÁS de la edad: eso sí es otro hecho y la bandera se queda.
_RE_OTRO_HECHO_WEB = re.compile(
    r"sanci[oó]n|sancionad|inhabilit|impedid|fraude|denuncia|fiscal[ií]a|investigad|procesad|penalidad|multa|"
    r"incumpl|resoluci[oó]n\s+del?\s+contrato|lavado|corrupci|falsa|adulterad", re.I)
# La capacidad operativa con base propia (no solo «empresa nueva + monto alto»): datos que la edad no dice.
_RE_BASE_PROPIA_CAPACIDAD = re.compile(
    r"trabajador|planilla|persona\s+natural|domicilio|vivienda|capital\s+social|no\s+habido|"
    r"sin\s+(?:registro\s+sanitario|local|almac[eé]n|planta|licencia)|subcontrat", re.I)
_RE_RUC_EN_TEXTO = re.compile(r"\bRUC\s*:?\s*(\d{11})\b", re.I)


def ruc_de_bandera(b: dict) -> str | None:
    """RUC del ganador del que trata la bandera: `ganador_ruc` (en la bandera o, ya leída de la base, en
    `verificacion`); si no, el «RUC …» de la evidencia."""
    if not isinstance(b, dict):
        return None
    ver = b.get("verificacion") if isinstance(b.get("verificacion"), dict) else {}
    r = b.get("ganador_ruc") or ver.get("ganador_ruc")
    if r:
        return str(r)
    m = _RE_RUC_EN_TEXTO.search(str(b.get("evidencia") or ""))
    return m.group(1) if m else None


def _es_del_ganador(b: dict) -> bool:
    """`ruc_ultra_nuevo` también evalúa a los postores que perdieron: solo cuenta la del adjudicatario."""
    if b.get("regla") != "ruc_ultra_nuevo":
        return True
    if b.get("postor_ruc") and not b.get("ganador_ruc"):
        return False
    return bool(b.get("ganador_ruc")) or "adjudicatario" in str(b.get("evidencia") or "").lower() \
        or b.get("severidad") == "alta"


def mismo_hecho_que(b: dict, banderas: list[dict]) -> str | None:
    """La regla de `banderas` que ya cuenta el hecho de `b` (el RUC nuevo del mismo ganador), o None si `b` dice algo
    más. Sin RUC en alguna de las dos se asume el mismo ganador (la investigación web es de uno solo)."""
    if not isinstance(b, dict):
        return None
    regla = b.get("regla")
    if regla not in ("ruc_ganador_muy_nuevo", "antecedente_proveedor_web", "capacidad_operativa_cuestionable"):
        return None
    rb = ruc_de_bandera(b)
    anclas = [o for o in banderas if isinstance(o, dict) and o is not b and o.get("regla") in _RUC_NUEVO
              and _es_del_ganador(o) and (not rb or not ruc_de_bandera(o) or ruc_de_bandera(o) == rb)]
    if regla == "ruc_ganador_muy_nuevo":
        return next((o["regla"] for o in anclas if o["regla"] == "ruc_ultra_nuevo"), None)
    if not anclas:
        return None
    ancla = min(anclas, key=lambda o: _RUC_NUEVO.index(o["regla"]))["regla"]
    texto = str(b.get("evidencia") or "")
    if regla == "antecedente_proveedor_web":
        titulo = str(b.get("titulo") or texto.split(":", 1)[0])
        if _RE_EDAD_EMPRESA.search(titulo) and not _RE_OTRO_HECHO_WEB.search(texto):
            return ancla
        return None
    return None if _RE_BASE_PROPIA_CAPACIDAD.search(texto) else ancla


def sin_mismo_hecho(banderas: list[dict], state: dict | None, donde: str, contexto: list[dict] | None = None) -> list[dict]:
    """`banderas` sin las que repiten un hecho ya contado por otra (de la misma lista o de `contexto`, las que la
    alerta ya tiene). Cada una que sale queda en state['descartes'] con la regla que la cubre."""
    universo = list(banderas) + [c for c in (contexto or []) if isinstance(c, dict)]
    out = []
    for b in banderas:
        ancla = mismo_hecho_que(b, universo)
        if not ancla:
            out.append(b)
            continue
        if isinstance(state, dict):
            state.setdefault("descartes", []).append({
                "donde": donde, "agente": b.get("agente_origen"), "regla": b.get("regla"),
                "motivo": f"mismo_hecho_que_{ancla}", "evidencia": str(b.get("evidencia") or "")[:240]})
    return out


# Reglas que hablan de UN proveedor ganador: cada bandera dice de cuál (`ganador_ruc`). Las que pueden ser de un postor
# que perdió (`ruc_ultra_nuevo`, `firmante_con_empresa_rnp`) traen `postor_ruc` en ese caso.
REGLAS_DE_PROVEEDOR = frozenset({
    "proveedor_sancionado_osce", "ruc_ganador_muy_nuevo", "ruc_ultra_nuevo", "ciiu_vs_objeto", "rubro_ciiu_incongruente",
    "concentracion_entidad", "firmante_vinculado_ganador", "testaferro_multi_ruc", "personal_clave_vinculado",
    "directa_recurrente", "lobby_visits_pre_convocatoria", "fraccionamiento", "firmante_con_empresa_rnp",
    "capacidad_operativa_cuestionable", "conflicto_interes_funcionario_empresa", "antecedente_proveedor_web",
    "cobertura_prensa_adversa", "vinculo_red_personas", "sancion_vigente_oece", "sancion_historica_oece",
    "penalidades_oece_historicas",
})


def con_ganador_principal(banderas: list[dict], state: dict) -> list[dict]:
    """Pone `ganador_ruc` (el ganador que investigó el análisis) a las banderas de proveedor que no lo traen: las de
    juicio y las señales del expediente (`add_contextual_flag`) salen de ese ganador."""
    principal = ruc_ganador_principal(state)
    for b in banderas:
        if (principal and isinstance(b, dict) and not b.get("ganador_ruc") and not b.get("postor_ruc")
                and (b.get("regla") in REGLAS_DE_PROVEEDOR or b.get("_source") == "orchestrator_paso_7.7")):
            b["ganador_ruc"] = principal
    return banderas


def proveedor_ruc_alerta(ocid: str, state: dict, cur) -> tuple[str | None, bool]:
    """(RUC para `alertas.proveedor_ruc`, decidido). Es el ganador principal (`ganador_principal`: mayor monto
    adjudicado, empate por RUC), no la primera oferta ganadora de un `LIMIT 1` sin orden (2026-2543-197 guardó a HAMUQ,
    tercera por monto; 1220581 a JEMAR, cuya buena pro se reemplazó). La columna es CHAR(11) con FK a `empresas`: un
    consorcio (código del SEACE, sin RUC) queda en NULL —la API lo nombra por CONOSCE— y un ganador que sólo trae
    CONOSCE se da de alta en `empresas` con su razón social. `decidido` = se sabe quién ganó (pisa el valor anterior)."""
    from tools.compliance_rules import ganador_principal
    g = ganador_principal(ocid, state, cur)
    if not g or not g.get("ruc"):
        return None, False
    ruc = str(g["ruc"]).strip()
    if not re.fullmatch(r"\d{11}", ruc):
        return None, True
    cur.execute("SELECT 1 FROM empresas WHERE ruc=%s", (ruc,))
    if cur.fetchone():
        return ruc, True
    if g.get("nombre"):
        cur.execute("INSERT INTO empresas (ruc, razon_social) VALUES (%s, %s) ON CONFLICT (ruc) DO NOTHING",
                    (ruc, str(g["nombre"])[:200]))
        return ruc, True
    return None, True


def ruc_ganador_principal(state: dict) -> str | None:
    """RUC del ganador que investigó el análisis (el del expediente; si no, el de la red de personas o la web)."""
    st = state if isinstance(state, dict) else {}
    cands = [(st.get("expediente_proveedor") or {}).get("ruc") if isinstance(st.get("expediente_proveedor"), dict) else None,
             ((st.get("person_network_context") or {}).get("ganador") or {}).get("ruc")
             if isinstance(st.get("person_network_context"), dict) else None]
    web = _safe_parse_json(st.get("web_research")) if not isinstance(st.get("web_research"), dict) else st["web_research"]
    if isinstance(web, dict) and isinstance(web.get("empresa"), dict):
        cands.append(web["empresa"].get("ruc"))
    return next((str(c) for c in cands if c and re.fullmatch(r"\d{11}", str(c))), None)


def puntaje_de(banderas: list[dict]) -> int:
    """min(100, Σ peso) de las banderas que puntúan, con el mismo hecho contado una vez y media (no dos). Una bandera
    que repite el RUC nuevo de otra (`mismo_hecho_que`) no suma, aunque haya quedado en la base de una corrida vieja."""
    banderas = [b for b in banderas if not mismo_hecho_que(b, banderas)]
    pesos = [(b.get("regla"), _peso(b.get("agente_origen"), b.get("severidad"))) for b in banderas if b.get("puntua", True)]
    total = float(sum(p for _, p in pesos))
    for a, b in _MISMO_HECHO_PUNTAJE:
        pa = max((p for r, p in pesos if r == a), default=0)
        pb = max((p for r, p in pesos if r == b), default=0)
        if pa and pb:
            total -= min(pa, pb) / 2
    return min(int(round(total)), 100)


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


# Dedupe de banderas: una bandera cuya (alerta_id, regla, evidencia) ya existe en la alerta NO se
# vuelve a insertar — ni dentro del mismo lote (el NOT EXISTS ve las filas insertadas antes en la
# misma transacción) ni contra filas previas (otro agente u otra corrida). Producción llegó a tener
# 12 filas duplicadas exactas. La comparación usa la MISMA expresión que el índice único de la
# migración 27 (md5 de la evidencia, NULL = ''), y `ON CONFLICT DO NOTHING` (sin target, válido
# aunque la migración aún no esté aplicada) cubre la carrera entre dos corridas concurrentes una
# vez que el índice existe. Se mantienen los 8 parámetros posicionales en el mismo orden.
_INSERT_BANDERA_SQL = """INSERT INTO banderas (alerta_id, regla, severidad, evidencia, norma,
                                 fuente_url, agente_origen, verificacion, puntua, regla_version, identidad)
           SELECT v.alerta_id, v.regla, v.severidad, v.evidencia, v.norma,
                  v.fuente_url, v.agente_origen, v.verificacion, v.puntua, v.regla_version, v.identidad
             FROM (SELECT %s::uuid AS alerta_id, %s::text AS regla, %s::text AS severidad,
                          %s::text AS evidencia, %s::text AS norma, %s::text AS fuente_url,
                          %s::text AS agente_origen, %s::jsonb AS verificacion,
                          %s::boolean AS puntua, %s::text AS regla_version, %s::text AS identidad) v
            WHERE NOT EXISTS (
                  SELECT 1 FROM banderas b
                   WHERE b.alerta_id = v.alerta_id AND b.regla = v.regla
                     AND md5(coalesce(b.evidencia::text, '')) = md5(coalesce(v.evidencia, '')))
           ON CONFLICT DO NOTHING"""


def _insert_bandera(cur, alerta_id, regla, severidad, evidencia, norma, fuente_url,
                    agente_origen, verificacion, puntua: bool = True, regla_version: str | None = None,
                    identidad: str | None = None, ganador_ruc: str | None = None) -> None:
    # La evidencia se guarda sin DNI ni RUC de persona natural (310 banderas lo llevaban en PROD el 2026-11-13: la API
    # los tapa al publicar, pero no tienen por qué quedar escritos).
    try:
        from tools.verify import sin_datos_personales
        evidencia = sin_datos_personales(evidencia or "")
    except Exception:  # noqa: BLE001
        pass
    # De qué ganador trata la bandera (con varios ganadores, la alerta nombra a uno: 2026-2543-197 tiene 8). Va en
    # `verificacion` (la única columna JSON de la bandera); un RUC de persona natural no se escribe.
    if ganador_ruc and re.fullmatch(r"\d{11}", str(ganador_ruc)):
        verificacion = dict(verificacion or {})
        if str(ganador_ruc).startswith("10"):
            verificacion["ganador_persona_natural"] = True
        else:
            verificacion["ganador_ruc"] = str(ganador_ruc)
    cur.execute(
        _INSERT_BANDERA_SQL,
        (alerta_id, (regla or "sin_regla")[:80], severidad if severidad in ("alta", "media", "baja") else "media",
         (evidencia or "")[:500], (norma or "")[:300], (fuente_url or None),
         agente_origen, json.dumps(verificacion or {}, ensure_ascii=False, default=str),
         bool(puntua), regla_version, identidad),
    )


def _leer_banderas(cur, alerta_id) -> list[dict]:
    cur.execute(
        "SELECT regla, severidad, evidencia, norma, fuente_url, agente_origen, verificacion, puntua "
        "FROM banderas WHERE alerta_id=%s ORDER BY CASE severidad WHEN 'alta' THEN 1 "
        "WHEN 'media' THEN 2 ELSE 3 END, id", (alerta_id,))
    out = []
    for r in cur.fetchall():
        ver = r[6]
        if isinstance(ver, str):
            ver = _safe_parse_json(ver)
        out.append({"regla": r[0], "severidad": r[1], "evidencia": r[2], "norma": r[3],
                    "fuente_url": r[4], "agente_origen": r[5], "verificacion": ver,
                    "puntua": True if r[7] is None else bool(r[7]),
                    "ganador_ruc": (ver or {}).get("ganador_ruc") if isinstance(ver, dict) else None})
    return out


def _recalcular_score(cur, alerta_id, state=None) -> tuple[int, list[dict]]:
    """score = min(100, Σ peso(agente, severidad)) sobre TODAS las banderas de la alerta (`puntaje_de`: el mismo hecho
    de dos reglas cuenta una vez y media).
    Actualiza `alertas.score` y `reglas_disparadas`; deja state['banderas'] con la
    lista completa (todos los agentes) y devuelve (score, banderas)."""
    banderas = _leer_banderas(cur, alerta_id)
    # Los hechos neutros (puntua=false) se muestran pero no suman: no son riesgo, son contexto.
    score = puntaje_de(banderas)
    # Sólo las reglas que puntúan: un hecho de contexto (puntua=false, p. ej. «Contratación Directa» o la prensa de la
    # entidad) no es una regla disparada (2026-11-24). Van aparte en `compliance_resumen_det.reglas_contexto`.
    reglas = sorted({b["regla"] for b in banderas if b.get("regla") and b.get("puntua", True)})
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
                          "regla": flag.get("regla"),
                          "motivos": [m for m in res.get("motivos", []) if not m.startswith(("ruc:", "dni:"))
                                      or m.endswith("no_respaldado")][:6]},
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
