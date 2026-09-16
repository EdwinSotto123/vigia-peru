"""Self-eval INLINE (track Arize) — el orquestador juzga sus propios outputs al
final de cada corrida con 4 evaluadores LLM-as-judge:

  · respaldo_de_bandera  (LLM, por bandera)  — ¿evidencia concreta y verificable?
  · cita_evidencia       (code, por bandera) — ¿cita norma + fuente_url?
  · plausibilidad_precio (LLM, por ítem)     — ¿el veredicto de mercado se sostiene?
  · tono_no_acusatorio   (LLM, dictamen)     — ¿señal de riesgo, no acusación?

Devuelve scores agregados + por-ítem. main.py los emite al stream (kind=eval),
los deja como atributos del span raíz en Phoenix y los mete en el resultado.
Unifica el juicio que antes corría offline en backend/scripts/evals_vigia.py.
"""
from __future__ import annotations

import concurrent.futures
import json
import os

from tools._core import (  # noqa: F401
    _gemini_client, _gemini_call_with_retry, _throttle_gemini, DEFAULT_GEMINI_MODEL,
)

# Los jueces LLM (respaldo, precio, tono, coherencia) son llamadas independientes a Gemini:
# corren a la vez en un pool de hilos (EVAL_CONCURRENCY, default 4) en vez de en serie.
# =1 → secuencial (rollback).
_EVAL_CONCURRENCY = max(1, int(os.getenv("EVAL_CONCURRENCY", "4") or 4))


def _judge_model() -> str:
    """Modelo de los jueces: `agents._shared.models._MODEL_JUDGE` (lo define el WS P;
    distinto del generador) → env GEMINI_MODEL_JUDGE → gemini-3.5-flash. Nunca el
    mismo tier que escribió el dictamen (auditoría §2.4)."""
    try:
        from agents._shared.models import _MODEL_JUDGE  # type: ignore
        if _MODEL_JUDGE:
            return str(_MODEL_JUDGE)
    except Exception:
        pass
    return os.getenv("GEMINI_MODEL_JUDGE", "gemini-3.5-flash")


# Umbrales de bloqueo (env). Si la self-eval detecta respaldo bajo, tono acusatorio o
# ítems incoherentes con el objeto, `debe_bloquear` devuelve (True, motivo) y el driver
# marca `alertas.estado='revision'` (no se publica).
_EVAL_MIN_RESPALDO = float(os.getenv("EVAL_MIN_RESPALDO", "0.6"))
_EVAL_MIN_CITA = float(os.getenv("EVAL_MIN_CITA", "0.8"))
_EVAL_MIN_PRECIO = float(os.getenv("EVAL_MIN_PRECIO", "0.5"))
_EVAL_BLOQUEA_TONO = os.getenv("EVAL_BLOQUEA_TONO", "1") != "0"
_EVAL_BLOQUEA_COHERENCIA = os.getenv("EVAL_BLOQUEA_COHERENCIA", "1") != "0"


def debe_bloquear(resultado_eval: dict) -> tuple[bool, str]:
    """Decide si el análisis debe quedar en `revision` en vez de publicarse.

    Bloquea cuando (cualquiera):
      · respaldo_de_bandera < EVAL_MIN_RESPALDO (default 0.6) con ≥ 2 banderas juzgadas;
      · tono_no_acusatorio == 'acusatorio' (EVAL_BLOQUEA_TONO);
      · coherencia_objeto_items == 'incoherente' (EVAL_BLOQUEA_COHERENCIA);
      · cita_evidencia < EVAL_MIN_CITA (default 0.8) con ≥ 3 banderas;
      · plausibilidad_precio < EVAL_MIN_PRECIO (default 0.5) con ≥ 3 ítems juzgados.
    Devuelve (bloquear, motivo legible). Con un resultado vacío/None → (False, "").
    """
    if not isinstance(resultado_eval, dict) or not resultado_eval:
        return False, ""

    def _ratio(k):
        d = resultado_eval.get(k) or {}
        n = int(d.get("n") or 0)
        return (int(d.get("ok") or 0) / n if n else None), n

    motivos: list[str] = []
    r, n = _ratio("respaldo")
    if r is not None and n >= 2 and r < _EVAL_MIN_RESPALDO:
        motivos.append(f"respaldo de banderas {r:.0%} < {_EVAL_MIN_RESPALDO:.0%} ({n} juzgadas)")
    if _EVAL_BLOQUEA_TONO and str(resultado_eval.get("tono") or "").lower() == "acusatorio":
        motivos.append("dictamen con tono acusatorio" +
                       (f": {str(resultado_eval.get('tono_reason'))[:120]}" if resultado_eval.get("tono_reason") else ""))
    if _EVAL_BLOQUEA_COHERENCIA and str(resultado_eval.get("coherencia") or "").lower() == "incoherente":
        motivos.append("ítems incoherentes con el objeto" +
                       (f": {str(resultado_eval.get('coherencia_reason'))[:120]}" if resultado_eval.get("coherencia_reason") else ""))
    r, n = _ratio("cita")
    if r is not None and n >= 3 and r < _EVAL_MIN_CITA:
        motivos.append(f"banderas sin norma/fuente {1 - r:.0%} ({n})")
    r, n = _ratio("precio")
    if r is not None and n >= 3 and r < _EVAL_MIN_PRECIO:
        motivos.append(f"veredictos de precio plausibles {r:.0%} < {_EVAL_MIN_PRECIO:.0%}")
    if motivos:
        return True, "; ".join(motivos)
    return False, ""


def _judge_array(prompt: str, n_expected: int, labels: list[str]) -> list[str]:
    """Un solo call: devuelve una lista de `n_expected` labels (∈ labels),
    alineada por índice. Robusto a fallos (rellena con labels[-1])."""
    from google.genai import types as gt
    client = _gemini_client()
    schema = gt.Schema(
        type=gt.Type.OBJECT,
        properties={"veredictos": gt.Schema(
            type=gt.Type.ARRAY,
            items=gt.Schema(type=gt.Type.STRING, enum=labels),
        )},
        required=["veredictos"],
    )
    cfg = gt.GenerateContentConfig(
        temperature=0.0, response_mime_type="application/json",
        response_schema=schema, http_options=gt.HttpOptions(timeout=60000),
    )
    try:
        with _throttle_gemini():
            resp = _gemini_call_with_retry(lambda: client.models.generate_content(
                model=_judge_model(), contents=[prompt], config=cfg))
        arr = (json.loads(resp.text or "{}") or {}).get("veredictos") or []
    except Exception:
        arr = []
    out = [str(x).strip() for x in arr][:n_expected]
    while len(out) < n_expected:
        out.append(labels[-1])
    return [(x if x in labels else labels[-1]) for x in out]


def _judge_array_reason(prompt: str, n_expected: int, labels: list[str]) -> list[dict]:
    """Como _judge_array pero cada elemento es {label, reason} — para que el
    dashboard muestre POR QUÉ cada ítem (bandera/precio) pasó o falló."""
    from google.genai import types as gt
    client = _gemini_client()
    schema = gt.Schema(
        type=gt.Type.OBJECT,
        properties={"veredictos": gt.Schema(
            type=gt.Type.ARRAY,
            items=gt.Schema(
                type=gt.Type.OBJECT,
                properties={
                    "label": gt.Schema(type=gt.Type.STRING, enum=labels),
                    "reason": gt.Schema(type=gt.Type.STRING),
                },
                required=["label", "reason"],
            ),
        )},
        required=["veredictos"],
    )
    cfg = gt.GenerateContentConfig(
        temperature=0.0, response_mime_type="application/json",
        response_schema=schema, http_options=gt.HttpOptions(timeout=60000),
    )
    try:
        with _throttle_gemini():
            resp = _gemini_call_with_retry(lambda: client.models.generate_content(
                model=_judge_model(), contents=[prompt], config=cfg))
        arr = (json.loads(resp.text or "{}") or {}).get("veredictos") or []
    except Exception:
        arr = []
    res: list[dict] = []
    for x in arr[:n_expected]:
        lab = str((x or {}).get("label", "")).strip()
        res.append({"label": lab if lab in labels else labels[-1],
                    "reason": str((x or {}).get("reason", ""))[:240]})
    while len(res) < n_expected:
        res.append({"label": labels[-1], "reason": ""})
    return res


def _judge_one(prompt: str, labels: list[str]) -> str:
    from google.genai import types as gt
    client = _gemini_client()
    schema = gt.Schema(
        type=gt.Type.OBJECT,
        properties={"label": gt.Schema(type=gt.Type.STRING, enum=labels)},
        required=["label"],
    )
    cfg = gt.GenerateContentConfig(
        temperature=0.0, response_mime_type="application/json",
        response_schema=schema, http_options=gt.HttpOptions(timeout=60000),
    )
    try:
        with _throttle_gemini():
            resp = _gemini_call_with_retry(lambda: client.models.generate_content(
                model=_judge_model(), contents=[prompt], config=cfg))
        lab = str((json.loads(resp.text or "{}") or {}).get("label", "")).strip()
        return lab if lab in labels else labels[-1]
    except Exception:
        return labels[-1]


def _judge_one_reason(prompt: str, labels: list[str]) -> tuple[str, str]:
    """Como _judge_one pero devuelve (label, reason) — para el dashboard rico."""
    from google.genai import types as gt
    client = _gemini_client()
    schema = gt.Schema(
        type=gt.Type.OBJECT,
        properties={
            "label": gt.Schema(type=gt.Type.STRING, enum=labels),
            "reason": gt.Schema(type=gt.Type.STRING),
        },
        required=["label", "reason"],
    )
    cfg = gt.GenerateContentConfig(
        temperature=0.0, response_mime_type="application/json",
        response_schema=schema, http_options=gt.HttpOptions(timeout=60000),
    )
    try:
        with _throttle_gemini():
            resp = _gemini_call_with_retry(lambda: client.models.generate_content(
                model=_judge_model(), contents=[prompt], config=cfg))
        d = json.loads(resp.text or "{}") or {}
        lab = str(d.get("label", "")).strip()
        return (lab if lab in labels else labels[-1], str(d.get("reason", ""))[:280])
    except Exception:
        return (labels[-1], "")


def _contexto_ocds(state: dict | None) -> dict:
    """Proyección mínima del OCDS para que el juez coteje RUC/montos/nombres."""
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    if not isinstance(ocds, dict):
        return {}
    tender = ocds.get("tender") or {}
    return {
        "entidad": (ocds.get("buyer") or {}).get("name"),
        "objeto": (tender.get("description") or tender.get("title") or "")[:240],
        "valor_referencial": tender.get("value"),
        "tipo_proceso": tender.get("procurementMethodDetails"),
        "numberOfTenderers": tender.get("numberOfTenderers"),
        "postores": [t.get("name") for t in (tender.get("tenderers") or []) if isinstance(t, dict)][:15],
        "adjudicaciones": [{"proveedores": [f"{s.get('name')} ({s.get('id')})" for s in (a.get("suppliers") or [])],
                            "valor": a.get("value"), "fecha": a.get("date")}
                           for a in (ocds.get("awards") or []) if isinstance(a, dict)][:10],
    }


def _contexto_bandera(b: dict, state: dict | None) -> dict:
    """Verificación determinista + citas literales del documento para UNA bandera
    (auditoría §2.4: el juez antes juzgaba la prosa sin ver la fuente)."""
    out: dict = {}
    ver = b.get("verificacion")
    if not ver and state:
        try:
            from tools import verify as _v
            ver = _v.verificar_bandera(dict(b), state)
        except Exception:
            ver = None
    if isinstance(ver, dict):
        out["verificacion_determinista"] = {"ok": ver.get("ok"), "motivos": (ver.get("motivos") or [])[:8]}
    if state:
        try:
            from tools import verify as _v
            ids = _v.extraer_identificadores(str(b.get("evidencia") or ""))
            citas = []
            for token in (ids["rucs"] + ids["dnis"])[:3]:
                hit = _v.buscar_en_documentos(state, token)
                if hit:
                    citas.append({"busca": token, "pagina": hit["pagina"], "cita": hit["cita"]})
            if citas:
                out["citas_documento"] = citas
        except Exception:
            pass
    return out


_DEGRADAR_MERCADO = os.getenv("EVAL_DEGRADA_MERCADO", "1") != "0"
_REGLAS_MERCADO_ITEM = ("sobreprecio_muy_elevado", "sobreprecio_elevado")
_REGLAS_MERCADO_LOTE = ("sobreprecio_lote_muy_elevado", "sobreprecio_lote_elevado")


def _codigo_alerta(state: dict) -> str:
    cod = str(state.get("alerta_codigo") or "").strip()
    if cod.startswith("ocds-"):
        cod = "OECE-" + cod.split("-")[-1]
    elif cod and not cod.startswith("OECE-") and cod.isdigit():
        cod = f"OECE-{cod}"
    return cod


def _desc_item(f: dict) -> str:
    return str(f.get("item_descripcion") or f.get("descripcion_corta") or f.get("item") or "").strip()


def degradar_mercado_implausible(per_precio: list, state: dict) -> dict:
    """Revisión lote 1: el juez `plausibilidad_precio` marcaba 'dudoso' (1225058: kg vs bolsa de
    5 kg → −84 %; 1225450: 100 gal de gasohol vs lote de 5 100 gal → +7 162 %) y nadie actuaba:
    la bandera de mercado seguía publicada y sumando score. Ahora, por cada ítem 'dudoso':
      · `market_analysis.findings[i].veredicto` → 'no_verificable' (se conserva
        `veredicto_original` y `motivo_no_verificable` con la razón del juez);
      · las banderas `sobreprecio_*` de ese ítem se ELIMINAN de la BD (no se publican) y, si
        había bandera de lote, también (el total del lote suma la mediana contaminada);
      · el score de la alerta se recalcula y todo queda en state['descartes'].
    Devuelve {items, banderas_eliminadas, score, error}. Nunca levanta."""
    res: dict = {"items": [], "banderas_eliminadas": [], "score": None, "error": None}
    dudosos = [p for p in (per_precio or []) if isinstance(p, dict) and p.get("plausible") is False and p.get("item")]
    if not dudosos or not isinstance(state, dict):
        return res
    motivos = {str(p["item"]).strip(): (p.get("reason") or "").strip() for p in dudosos}

    # 1) market_analysis en state: veredicto → no_verificable (el dictamen/API lo muestran así).
    ma = state.get("market_analysis")
    if isinstance(ma, str):
        try:
            ma = json.loads(ma)
        except Exception:
            ma = None
    if isinstance(ma, dict):
        for f in ma.get("findings") or []:
            if not isinstance(f, dict):
                continue
            d = _desc_item(f)
            if d in motivos:
                f["veredicto_original"] = f.get("veredicto")
                f["veredicto"] = "no_verificable"
                f["motivo_no_verificable"] = f"juez de plausibilidad de precio: {motivos[d] or 'comparación implausible'}"[:300]
                res["items"].append(d)
        if res["items"] and ma.get("sobreprecio_pct") is not None:
            ma["sobreprecio_pct_original"] = ma.get("sobreprecio_pct")
            ma["sobreprecio_pct"] = None
            ma["veredicto_global_original"] = ma.get("veredicto_global")
            ma["veredicto_global"] = "no_verificable"
            ma["motivo_no_verificable"] = "lote: incluye ítem(s) con comparación implausible según el juez de precio"
        state["market_analysis"] = ma
    if not res["items"]:
        res["items"] = list(motivos)

    for d in res["items"]:
        state.setdefault("descartes", []).append({
            "donde": "self_eval.plausibilidad_precio", "motivo": "juez_precio_implausible",
            "agente": "market_price_agent", "regla": "sobreprecio", "evidencia": d[:240],
            "detalle": motivos.get(d, "")[:240]})

    # 2) BD: quitar las banderas de mercado del ítem (y las de lote) y recalcular score.
    cod = _codigo_alerta(state)
    if not cod or not _DEGRADAR_MERCADO:
        return res
    try:
        from tools._core import _pg
        from tools import persistence as _pers
        conn = _pg()
        try:
            cur = conn.cursor()
            cur.execute("SELECT id FROM alertas WHERE codigo=%s", (cod,))
            row = cur.fetchone()
            if not row:
                return res
            alerta_id = row[0]
            cur.execute("SELECT id, regla, evidencia FROM banderas WHERE alerta_id=%s AND agente_origen='market_price_agent'",
                        (alerta_id,))
            filas = cur.fetchall()
            a_borrar = []
            for bid, regla, evidencia in filas:
                ev = str(evidencia or "")
                if regla in _REGLAS_MERCADO_LOTE:
                    a_borrar.append((bid, regla, ev))
                elif regla in _REGLAS_MERCADO_ITEM and any(f"Ítem '{d[:80]}'" in ev or f"'{d[:80]}'" in ev for d in res["items"]):
                    a_borrar.append((bid, regla, ev))
            for bid, regla, ev in a_borrar:
                cur.execute("DELETE FROM banderas WHERE id=%s", (bid,))
                res["banderas_eliminadas"].append({"regla": regla, "evidencia": ev[:200]})
                state.setdefault("descartes", []).append({
                    "donde": "self_eval.plausibilidad_precio", "motivo": "juez_precio_implausible",
                    "agente": "market_price_agent", "regla": regla, "evidencia": ev[:240],
                    "motivos": ["bandera retirada: el juez de precio marcó implausible la comparación"]})
            if a_borrar:
                score, banderas = _pers._recalcular_score(cur, alerta_id, state)
                res["score"] = score
            # `analisis_full.market_analysis` ya se persistió antes de la self-eval: se
            # reescribe con los veredictos degradados para que la UI/API lo muestren igual.
            if isinstance(ma, dict):
                cur.execute(
                    "UPDATE alertas SET analisis_full = COALESCE(analisis_full, '{}'::jsonb) || "
                    "jsonb_build_object('market_analysis', %s::jsonb) WHERE id=%s",
                    (json.dumps(ma, ensure_ascii=False, default=str), alerta_id))
            conn.commit()
        finally:
            conn.close()
    except Exception as e:  # la self-eval nunca tumba la corrida
        res["error"] = str(e)[:200]
        print(f"[self-eval] degradar_mercado_implausible falló: {res['error']}", flush=True)
    return res


def _correr_jueces(jueces: dict[str, tuple]) -> dict:
    """Corre los jueces LLM {nombre: (fn, args)} concurrentes (hasta EVAL_CONCURRENCY hilos;
    cada fn ya es robusta a fallos y devuelve un default). Devuelve {nombre: resultado}."""
    if not jueces:
        return {}
    if _EVAL_CONCURRENCY <= 1 or len(jueces) == 1:
        return {n: fn(*args) for n, (fn, args) in jueces.items()}
    res: dict = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(_EVAL_CONCURRENCY, len(jueces))) as ex:
        futs = {n: ex.submit(fn, *args) for n, (fn, args) in jueces.items()}
        for n, fut in futs.items():
            try:
                res[n] = fut.result()
            except Exception as e:  # no debería: cada juez captura sus excepciones
                print(f"[self-eval] juez {n} falló: {str(e)[:120]}", flush=True)
    return res


def run_inline_evals(banderas: list, market_findings: list, dictamen: str,
                     objeto: str = "", stages: dict | None = None,
                     news_research=None, firmantes=None, doc_item_descs=None,
                     state: dict | None = None) -> dict:
    """Corre 8 evaluadores LLM-as-judge / code sobre los outputs del análisis.
    ~4 llamadas Gemini (batched, EN PARALELO) + 4 evaluadores de código. Devuelve scores +
    razones + per-ítem, para que el dashboard muestre QUÉ evaluó y por qué.

    `state` (opcional, lo pasa main.py): da a los jueces el OCDS compacto, la
    verificación determinista de cada bandera y citas literales de
    `documentos_texto`, para que juzguen la CITA y no la prosa."""
    banderas = [b for b in (banderas or []) if isinstance(b, dict)]
    out = {
        "respaldo": {"ok": 0, "n": 0},
        "cita": {"ok": 0, "n": 0},
        "precio": {"ok": 0, "n": 0},
        "tono": None, "tono_reason": "",
        "coherencia": None, "coherencia_reason": "",
        "completitud": {"ok": 0, "n": 0, "faltantes": []},
        "cobertura_prensa": {"ok": 0, "n": 0, "estado": None},
        "firmantes": {"ok": 0, "n": 0, "placeholders": []},
        "per_bandera": [],
        "per_precio": [],
        "cita_detalle": [],
        "n_judge_calls": 0,
    }
    # {nombre: (fn_juez, args)} — se encolan y corren juntos en _correr_jueces.
    _jueces: dict[str, tuple] = {}
    bl: list = []
    fl: list = []

    # cita_evidencia (CODE, gratis): norma + fuente_url presentes.
    for b in banderas:
        norma = (b.get("norma") or "").strip()
        fuente = (b.get("fuente_url") or b.get("fuente") or "").strip()
        ok = len(norma) > 4 and len(fuente) > 4
        out["cita"]["n"] += 1
        out["cita"]["ok"] += 1 if ok else 0
        if not ok:
            falta = []
            if len(norma) <= 4: falta.append("norma")
            if len(fuente) <= 4: falta.append("fuente_url")
            out["cita_detalle"].append({"regla": b.get("regla"), "falta": falta})

    # respaldo_de_bandera (LLM, batched, máx 12).
    _max_band = int(os.getenv("EVAL_MAX_BANDERAS", "24"))
    bl = banderas[:_max_band]
    if bl:
        items = [{
            "i": i, "regla": b.get("regla"), "norma": b.get("norma"),
            "evidencia": (b.get("evidencia") or "")[:400],
            **_contexto_bandera(b, state),
        } for i, b in enumerate(bl)]
        ctx_ocds = _contexto_ocds(state)
        prompt = (
            "Eres un auditor de un sistema anti-corrupción. Para CADA bandera, decide "
            "si su EVIDENCIA está respaldada por datos verificables: cita RUC, monto, "
            "fecha, artículo o nombre que COINCIDEN con el CONTEXTO OCDS, con la "
            "`verificacion_determinista` (ok=true y motivos sin 'no_respaldado') o con "
            "las `citas_documento` (texto literal del expediente). Es 'no_respaldada' si "
            "es vaga/genérica, si contradice el contexto o si sus identificadores no "
            "aparecen en ninguna fuente.\n"
            "Devuelve `veredictos`: lista alineada por índice; cada elemento "
            "{label:'respaldada'|'no_respaldada', reason: 1 frase con el dato "
            "concreto que la respalda, o qué dato verificable le falta}.\n\n"
            f"CONTEXTO OCDS (fuente oficial):\n{json.dumps(ctx_ocds, ensure_ascii=False, default=str)}\n\n"
            f"BANDERAS:\n{json.dumps(items, ensure_ascii=False, default=str)}"
        )
        _jueces["respaldo"] = (_judge_array_reason, (prompt, len(bl), ["respaldada", "no_respaldada"]))

    # plausibilidad_precio (LLM, batched, máx 10 con precios observados).
    fl = [f for f in (market_findings or [])
          if isinstance(f, dict) and f.get("precios_observados")][:10]
    if fl:
        items = [{
            "i": i,
            "item": f.get("item_descripcion") or f.get("descripcion_corta"),
            "mediana": f.get("precio_mediana_mercado"),
            "ofertado": f.get("precio_unitario_ofertado") or f.get("precio_unitario_referencial"),
            "veredicto": f.get("veredicto"), "diff_pct": f.get("diff_pct"),
        } for i, f in enumerate(fl)]
        prompt = (
            "Eres un auditor de precios públicos. Para CADA ítem, decide si el VEREDICTO "
            "del agente se sostiene con los datos (mediana de mercado vs ofertado/"
            "referencial). Devuelve `veredictos`: lista alineada; cada elemento "
            "{label:'plausible'|'dudoso', reason: 1 frase de por qué (p.ej. "
            "'mediana S/.146 implausible para llanta de camión' o 'Δ coherente')}.\n\n"
            f"ITEMS:\n{json.dumps(items, ensure_ascii=False, default=str)}"
        )
        _jueces["precio"] = (_judge_array_reason, (prompt, len(fl), ["plausible", "dudoso"]))

    # tono_no_acusatorio (LLM, dictamen) — con razón.
    if dictamen and len(dictamen.strip()) > 100:
        prompt = (
            "Principio innegociable: NUNCA acusamos a nadie de un delito; solo "
            "describimos 'señales de riesgo' / 'patrones detectados' / 'contradice la "
            "opinión OECE'. Evalúa el DICTAMEN.\n"
            "label='ok' si usa lenguaje de señal/indicio sin afirmar culpabilidad; "
            "'acusatorio' si afirma directamente delito/corrupción de una persona.\n"
            "reason: cita la frase del dictamen que motivó tu veredicto.\n\n"
            f"DICTAMEN (primeros 7000 chars):\n{dictamen[:7000]}"
        )
        _jueces["tono"] = (_judge_one_reason, (prompt, ["ok", "acusatorio"]))

    # coherencia_objeto_items (LLM, con razón) — atrapa extracción contaminada /
    # sobre-extracción: ¿los ítems analizados pertenecen al objeto de la convocatoria?
    # SOLO ítems-producto reales (del desglose de mercado). NO las reglas de
    # banderas: son slugs internos ('ruc_extranjero', etc.) que dispararían un
    # falso 'incoherente' por no parecer productos.
    item_descs = [str((f.get("item_descripcion") or f.get("descripcion_corta")
                       or f.get("item") or "")).strip()
                  for f in (market_findings or []) if isinstance(f, dict)]
    # Incluir las descripciones REALES del document_analysis (no solo las del market,
    # que a veces vienen genéricas 'Bien o servicio del ítem X'). Atrapa 1221246:
    # objeto BALDOSAS vs ítems del documento LAPTOPS/PCs → incoherente.
    item_descs += [str(d).strip() for d in (doc_item_descs or [])]
    item_descs = [d for d in item_descs
                  if d and not d.lower().startswith("bien o servicio del")][:18]
    if (objeto or "").strip() and item_descs:
        prompt = (
            "Eres un auditor de contrataciones públicas. El OBJETO define QUÉ compra el "
            "Estado. Decide si los ÍTEMS analizados son COHERENTES con ese objeto "
            "(mismo rubro / familia de producto) o si hay ítems SIN relación con el "
            "objeto (señal de extracción contaminada o errónea — p. ej. 'carne de pollo' "
            "en una compra de 'acelerómetros').\n"
            "label='coherente' si todos los ítems encajan con el objeto; 'incoherente' "
            "si aparece al menos un ítem ajeno.\n"
            "reason: nombra el/los ítems ajenos si los hay, o confirma la coherencia.\n\n"
            f"OBJETO: {(objeto or '')[:240]}\n"
            f"ÍTEMS ANALIZADOS: {json.dumps(item_descs, ensure_ascii=False)}"
        )
        _jueces["coherencia"] = (_judge_one_reason, (prompt, ["coherente", "incoherente"]))

    # ── Jueces LLM en paralelo (pool de hilos) y volcado de resultados ──
    _res = _correr_jueces(_jueces)
    out["n_judge_calls"] += len(_jueces)
    if "respaldo" in _res:
        verds = _res["respaldo"]
        for i, b in enumerate(bl):
            ok = verds[i]["label"] == "respaldada"
            out["respaldo"]["n"] += 1
            out["respaldo"]["ok"] += 1 if ok else 0
            out["per_bandera"].append({"regla": b.get("regla"), "respaldada": ok,
                                       "reason": verds[i]["reason"]})
    if "precio" in _res:
        verds = _res["precio"]
        for i, f in enumerate(fl):
            ok = verds[i]["label"] == "plausible"
            out["precio"]["n"] += 1
            out["precio"]["ok"] += 1 if ok else 0
            out["per_precio"].append({
                "item": f.get("item_descripcion") or f.get("descripcion_corta"),
                "plausible": ok, "reason": verds[i]["reason"]})
        # Un veredicto 'dudoso' tiene consecuencia: la bandera de mercado del ítem no se publica.
        if state is not None and any(not p["plausible"] for p in out["per_precio"]):
            out["mercado_degradado"] = degradar_mercado_implausible(out["per_precio"], state)
    if "tono" in _res:
        out["tono"], out["tono_reason"] = _res["tono"]
    if "coherencia" in _res:
        out["coherencia"], out["coherencia_reason"] = _res["coherencia"]

    # completitud_analisis (CODE, gratis): ¿corrieron todas las etapas esperadas?
    stages = stages or {}
    etapas = [
        ("documentos", stages.get("docs")),
        ("mercado", stages.get("market")),
        ("red de personas", stages.get("red")),
        ("dictamen", stages.get("dictamen")),
        ("banderas", stages.get("banderas")),
    ]
    for nombre, presente in etapas:
        out["completitud"]["n"] += 1
        if presente:
            out["completitud"]["ok"] += 1
        else:
            out["completitud"]["faltantes"].append(nombre)

    # cobertura_prensa (CODE, gratis): ¿news_research trae contenido o un 'sin
    # menciones' válido? Atrapa el bug de news_research devolviendo "" (vacío).
    out["cobertura_prensa"]["n"] = 1
    nr = news_research
    if isinstance(nr, str):
        try:
            nr = json.loads(nr) if nr.strip() else {}
        except Exception:
            nr = {}
    if isinstance(nr, dict) and (nr.get("noticias")
                                 or nr.get("sin_menciones_relevantes") is True
                                 or (nr.get("resumen_ejecutivo") or nr.get("sintesis") or "").strip()):
        out["cobertura_prensa"]["ok"] = 1
        out["cobertura_prensa"]["estado"] = "con_noticias" if nr.get("noticias") else "sin_menciones"
    else:
        out["cobertura_prensa"]["estado"] = "vacio"

    # firmantes_plausibles (CODE, gratis): ¿hay firmantes con pinta de placeholder
    # (entidad genérica 'POSTOR N'/'Entidad Contratante' SIN DNI)? Keyea por entidad,
    # nunca por nombre solo. Atrapa la confabulación de firmantes del parser.
    import re as _re_f
    _fl = firmantes if isinstance(firmantes, list) else []

    def _ph(f):
        if not isinstance(f, dict):
            return True
        nombre = str(f.get("nombre") or f.get("nombre_completo") or "").strip()
        dni = str(f.get("dni") or "").strip()
        # Nombre placeholder literal de plantilla ("Nombre Firmante 1", "Firmante 2",
        # "<NOMBRE...>", "XXX"). El frontend renderiza "Nombre Firmante N" cuando el
        # nombre viene vacío → eso es lo que vio el usuario en 1221246.
        if _re_f.search(r"nombre\s*firmante|^firmante\s*\d|<.*>|^x{2,}$", nombre.lower()):
            return True
        if dni:
            return False  # con DNI → verificable, real
        # Sin DNI Y sin nombre → firmante no identificable (placeholder de hecho).
        if not nombre:
            return True
        ent = str(f.get("entidad") or "").strip().lower()
        if not ent:
            return False
        if _re_f.match(r"^(el|la)?\s*(postor|proveedor|contratista|licitante|adjudicatari)\b", ent):
            return True
        return ent in ("entidad contratante", "entidad", "la entidad", "el proveedor",
                       "proveedor", "postor", "el postor", "la empresa", "empresa")
    for f in _fl:
        out["firmantes"]["n"] += 1
        if _ph(f):
            out["firmantes"]["placeholders"].append(
                str(f.get("nombre") or f.get("nombre_completo") or "?"))
        else:
            out["firmantes"]["ok"] += 1

    return out
