"""Lookup paralelo de N personas en una sola tool call — reemplaza el bucle
secuencial de 5 queries × N personas del orquestador, con filtro
anti-alucinación de ruido fuzzy sobre los resultados sin DNI exacto."""

from tools._core import *  # noqa: F401,F403
from tools.personas.rnp import query_rnp_persona
from tools.personas.electoral import query_jne_candidaturas, query_onpe_aportantes, query_pep
from tools.personas.visitas import query_visitas_de_persona


def batch_person_lookup(personas: list, tool_context: ToolContext) -> dict:
    """Consulta el perfil completo de N personas en paralelo. Reemplaza
    el bucle secuencial de 5 queries × N personas por una sola tool call.

    Por cada persona ejecuta en paralelo:
        - query_rnp_persona (empresas donde figura como socio/repr)
        - query_onpe_aportantes (aportes a partidos políticos)
        - query_jne_candidaturas (candidaturas electorales)
        - query_pep (Personas Expuestas Políticamente)
        - query_visitas_de_persona (Registro Único de Visitas Ley 28024)

    Args:
        personas: Lista de dicts con la forma
            [{"id": "<id_libre>", "dni": "12345678", "nombre": "JUAN PEREZ",
              "rol": "titular|socio|firmante|alcalde|gerente|..."}]
            Se requiere AL MENOS uno de `dni` o `nombre` por persona.

    Returns:
        dict con:
          · n_personas: int
          · resultados: dict[id → {rnp, onpe, jne, pep, visitas}]
          · resumen: lista de hallazgos relevantes por persona
          · duracion_ms: tiempo total en ms (debugging)
    """
    import time as _t
    t0 = _t.time()

    if not isinstance(personas, list) or not personas:
        return {"n_personas": 0, "resultados": {}, "resumen": [],
                "error": "personas debe ser una lista no vacía"}

    # Normaliza cada persona: usa dni si existe, sino nombre. Genera id si falta.
    def _input_for(p: dict) -> str:
        dni = (p.get("dni") or "").strip()
        if dni and dni.isdigit() and len(dni) == 8:
            return dni
        return (p.get("nombre") or "").strip().upper()

    tasks: list = []  # (id, persona, query_name, query_fn)
    QUERIES = [
        ("rnp",      query_rnp_persona),
        ("onpe",     query_onpe_aportantes),
        ("jne",      query_jne_candidaturas),
        ("pep",      query_pep),
        ("visitas",  query_visitas_de_persona),
    ]

    for i, p in enumerate(personas):
        pid = str(p.get("id") or i)
        inp = _input_for(p)
        if not inp:
            continue
        for qname, qfn in QUERIES:
            tasks.append((pid, p, qname, qfn, inp))

    resultados: dict = {}
    # Inicializa cada persona con su metadata
    for i, p in enumerate(personas):
        pid = str(p.get("id") or i)
        resultados[pid] = {
            "_meta": {
                "id": pid,
                "dni": p.get("dni"),
                "nombre": p.get("nombre"),
                "rol": p.get("rol"),
                "input_usado": _input_for(p),
            },
        }

    # Paralelización: 16 workers porque cada query es muy liviana (single SQL)
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        futs = {
            pool.submit(qfn, inp, tool_context): (pid, qname)
            for (pid, _p, qname, qfn, inp) in tasks
        }
        for fut in concurrent.futures.as_completed(futs):
            pid, qname = futs[fut]
            try:
                resultados[pid][qname] = fut.result()
            except Exception as e:
                resultados[pid][qname] = {"error": str(e)[:200], "found": False}

    # ─── FILTRO ANTI-ALUCINACIÓN: descartar ruido fuzzy de baja calidad ───
    #
    # Problema observado: si el LLM pasa nombres muy genéricos sin DNI
    # ("Juan Pérez García"), el fuzzy_trigram devuelve 30-50 resultados con
    # match_score 0.45-0.65 que son personas completamente distintas
    # (homónimos parciales). Esto se reportaba como "50 candidaturas" y el LLM
    # generaba banderas con severidad ALTA basándose en homónimos masivos.
    #
    # Regla:
    #   · Si la persona NO tiene DNI exacto, filtrar resultados con score < 0.75.
    #   · Si después del filtro hay >15 resultados, marcar confianza_match=baja
    #     y limitar a top 5 para no envenenar el context del LLM.
    #   · Calcular confianza_match por persona en {alta, media, baja}.

    HIGH_CONF_THRESHOLD = 0.75
    LOW_CONF_MAX_ITEMS = 5

    def _filter_fuzzy_noise(results: dict, has_dni: bool) -> dict:
        """Aplica el filtro de ruido fuzzy a una respuesta de query."""
        if has_dni or not isinstance(results, dict):
            return results
        # Si match_type=exacto_dni, ya es confiable
        if results.get("match_type") == "exacto_dni":
            return results
        for key in ("empresas", "aportes", "candidaturas", "registros", "visitas"):
            items = results.get(key)
            if not isinstance(items, list):
                continue
            filtered = [
                it for it in items
                if float(it.get("match_score") or 0) >= HIGH_CONF_THRESHOLD
            ]
            # Si después del filtro queda muy poco, dejamos top 5 ordenados
            if len(filtered) == 0 and items:
                filtered = sorted(
                    items, key=lambda x: -float(x.get("match_score") or 0)
                )[:LOW_CONF_MAX_ITEMS]
                results["_ruido_fuzzy_descartado"] = len(items) - len(filtered)
            else:
                results["_ruido_fuzzy_descartado"] = len(items) - len(filtered)
            results[key] = filtered
            # Recomputar n_*
            if key == "empresas":
                results["n_empresas"] = len(filtered)
            elif key == "aportes":
                results["n_aportes"] = len(filtered)
                results["monto_total"] = sum(
                    float(x.get("monto") or 0) for x in filtered)
            elif key == "candidaturas":
                results["n_candidaturas"] = len(filtered)
            elif key == "registros":
                results["n_registros"] = len(filtered)
            elif key == "visitas":
                results["n_visitas"] = len(filtered)
            results["found"] = len(filtered) > 0
        return results

    # Aplica filtro y calcula confianza por persona
    for pid, data in resultados.items():
        meta = data.get("_meta") or {}
        has_dni = bool(meta.get("dni"))
        if not has_dni:
            for qname in ("rnp", "onpe", "jne", "pep", "visitas"):
                if qname in data and isinstance(data[qname], dict):
                    data[qname] = _filter_fuzzy_noise(data[qname], has_dni=False)
        # Confianza global de la persona
        if has_dni:
            confianza = "alta"
        else:
            # Sin DNI: si TODOS los resultados quedaron filtrados a 0, no hay nada;
            # si hay al menos un match con score >= 0.85, confianza media;
            # si todos están entre 0.75-0.85, confianza baja.
            best_score = 0.0
            for qname in ("rnp", "onpe", "jne", "pep", "visitas"):
                q = data.get(qname) or {}
                for k in ("empresas", "aportes", "candidaturas", "registros", "visitas"):
                    for it in (q.get(k) or []):
                        s = float(it.get("match_score") or 0)
                        if s > best_score:
                            best_score = s
            if best_score >= 0.85:
                confianza = "media"
            elif best_score >= 0.75:
                confianza = "baja"
            else:
                confianza = "muy_baja"
        data["_confianza_match"] = confianza
        data["_meta"]["confianza_match"] = confianza

    # Construir resumen compacto: hallazgos más relevantes por persona
    resumen = []
    for pid, data in resultados.items():
        meta = data.get("_meta", {})
        confianza = data.get("_confianza_match", "muy_baja")
        # Skip personas sin DNI cuya confianza es muy baja — pura alucinación.
        if confianza == "muy_baja":
            continue
        hallazgos = []
        if data.get("rnp", {}).get("n_empresas", 0) > 0:
            hallazgos.append(f"{data['rnp']['n_empresas']} empresas en RNP")
        if data.get("onpe", {}).get("n_aportes", 0) > 0:
            o = data["onpe"]
            hallazgos.append(
                f"{o['n_aportes']} aportes ONPE (S/. {o.get('monto_total', 0):.0f})")
        if data.get("jne", {}).get("n_candidaturas", 0) > 0:
            hallazgos.append(f"{data['jne']['n_candidaturas']} candidaturas JNE")
        if data.get("pep", {}).get("n_registros", 0) > 0:
            hallazgos.append(f"PEP {data['pep']['n_registros']} registros")
        if data.get("visitas", {}).get("n_visitas", 0) > 0:
            hallazgos.append(f"{data['visitas']['n_visitas']} visitas a entidades")
        if hallazgos:
            resumen.append({
                "id": pid, "nombre": meta.get("nombre"),
                "dni": meta.get("dni"), "rol": meta.get("rol"),
                "confianza_match": confianza,
                "hallazgos": hallazgos,
                # Bandera explícita para que el LLM SEPA que sin DNI los hallazgos
                # son fuzzy y NO sirven para emitir banderas de severidad ALTA.
                "advertencia": (
                    "Sin DNI: hallazgos solo aproximados. NO emitir banderas alta "
                    "sin verificar el match exacto."
                ) if confianza in ("baja", "media") else None,
            })

    dur_ms = int((_t.time() - t0) * 1000)

    # Guarda en state para que sub-agentes posteriores puedan leerlo
    try:
        tool_context.state["batch_person_lookup_result"] = {
            "n_personas": len(personas),
            "resumen": resumen,
            "resultados_keys": list(resultados.keys()),
        }
    except Exception:
        pass

    return {
        "n_personas": len(personas),
        "n_queries_ejecutadas": len(tasks),
        "duracion_ms": dur_ms,
        "resumen": resumen,
        "resultados": resultados,
    }

# ── FunctionTool wrappers ──
batch_person_lookup_tool = FunctionTool(func=batch_person_lookup)
