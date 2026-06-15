"""Self-eval INLINE (track Arize) — el orquestador juzga sus propios outputs al
final de cada corrida con 4 evaluadores LLM-as-judge:

  · respaldo_de_bandera  (LLM, por bandera)  — ¿evidencia concreta y verificable?
  · cita_evidencia       (code, por bandera) — ¿cita norma + fuente_url?
  · plausibilidad_precio (LLM, por ítem)     — ¿el veredicto de mercado se sostiene?
  · tono_no_acusatorio   (LLM, dictamen)     — ¿señal de riesgo, no acusación?

Devuelve scores agregados + por-ítem. main.py los emite al stream (kind=eval),
los deja como atributos del span raíz en Phoenix y los mete en el resultado.
Unifica el juicio que antes corría offline en scripts/evals_vigia.py.
"""
from __future__ import annotations

import json

from tools._core import (  # noqa: F401
    _gemini_client, _gemini_call_with_retry, _throttle_gemini, DEFAULT_GEMINI_MODEL,
)


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
                model=DEFAULT_GEMINI_MODEL, contents=[prompt], config=cfg))
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
                model=DEFAULT_GEMINI_MODEL, contents=[prompt], config=cfg))
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
                model=DEFAULT_GEMINI_MODEL, contents=[prompt], config=cfg))
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
                model=DEFAULT_GEMINI_MODEL, contents=[prompt], config=cfg))
        d = json.loads(resp.text or "{}") or {}
        lab = str(d.get("label", "")).strip()
        return (lab if lab in labels else labels[-1], str(d.get("reason", ""))[:280])
    except Exception:
        return (labels[-1], "")


def run_inline_evals(banderas: list, market_findings: list, dictamen: str,
                     objeto: str = "", stages: dict | None = None,
                     news_research=None, firmantes=None, doc_item_descs=None) -> dict:
    """Corre 6 evaluadores LLM-as-judge / code sobre los outputs del análisis.
    ~4 llamadas Gemini (batched) + 2 evaluadores de código. Devuelve scores +
    razones + per-ítem, para que el dashboard muestre QUÉ evaluó y por qué."""
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
    bl = banderas[:12]
    if bl:
        items = [{
            "i": i, "regla": b.get("regla"), "norma": b.get("norma"),
            "evidencia": (b.get("evidencia") or "")[:400],
        } for i, b in enumerate(bl)]
        prompt = (
            "Eres un auditor de un sistema anti-corrupción. Para CADA bandera, decide "
            "si su EVIDENCIA es concreta y verificable (cita datos específicos: RUC, "
            "monto, fecha, artículo, nombre) o si es vaga/genérica/posible invención.\n"
            "Devuelve `veredictos`: lista alineada por índice; cada elemento "
            "{label:'respaldada'|'no_respaldada', reason: 1 frase con el dato "
            "concreto que la respalda, o qué dato verificable le falta}.\n\n"
            f"BANDERAS:\n{json.dumps(items, ensure_ascii=False)}"
        )
        verds = _judge_array_reason(prompt, len(bl), ["respaldada", "no_respaldada"])
        out["n_judge_calls"] += 1
        for i, b in enumerate(bl):
            ok = verds[i]["label"] == "respaldada"
            out["respaldo"]["n"] += 1
            out["respaldo"]["ok"] += 1 if ok else 0
            out["per_bandera"].append({"regla": b.get("regla"), "respaldada": ok,
                                       "reason": verds[i]["reason"]})

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
        verds = _judge_array_reason(prompt, len(fl), ["plausible", "dudoso"])
        out["n_judge_calls"] += 1
        for i, f in enumerate(fl):
            ok = verds[i]["label"] == "plausible"
            out["precio"]["n"] += 1
            out["precio"]["ok"] += 1 if ok else 0
            out["per_precio"].append({
                "item": f.get("item_descripcion") or f.get("descripcion_corta"),
                "plausible": ok, "reason": verds[i]["reason"]})

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
        out["tono"], out["tono_reason"] = _judge_one_reason(prompt, ["ok", "acusatorio"])
        out["n_judge_calls"] += 1

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
        out["coherencia"], out["coherencia_reason"] = _judge_one_reason(
            prompt, ["coherente", "incoherente"])
        out["n_judge_calls"] += 1

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
