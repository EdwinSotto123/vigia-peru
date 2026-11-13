"""La red de obras (plan 2026-11-04, parte 3): la obra que ejecuta este contrato, desde la base.

`obra_contrato` (rol `ejecucion`, migración 160) enlaza el proceso con su obra en INFOBRAS (`obra_infobras`): avance físico
y financiero, paralización, ampliaciones, adicionales, controversias, informes de control y su supervisor. Por el CUI,
la inversión en Invierte.pe (`inversion_mef`): monto viable, costo actualizado y laudos. Del supervisor contra el
contratista, el mismo cruce que la red de consultoría (tools/consultoria.vinculo_supervisor_ejecutor).

Las banderas de la obra ya existen en el sistema de banderas (obra_*, inversion_*, migr. 160): aquí se juntan los hechos
para el dictamen y sólo se agrega la señal nueva, el supervisor vinculado al contratista.

Un proceso de 2026 casi nunca tiene todavía su obra en INFOBRAS (la entidad la registra al empezar a ejecutar): lo que sí
tiene desde la convocatoria es su CUI (`contrato_cui`), y por él la inversión en Invierte.pe (`inversiones`).
"""
from __future__ import annotations

from tools._core import *  # noqa: F401,F403
from tools.consultoria import (HISTORIAL_SIN_DATO, SQL_ADICIONALES_ALTOS, SQL_PAGADA_SIN_AVANCE, URL_INFOBRAS, _COLS, _es_ruc,
                               _filas, _integrantes, _iso, _pct, contraparte_obra, historial_de, senales_obra,
                               sin_ruc_de_persona, vinculo_supervisor_ejecutor)
from tools.privacidad import es_persona_natural

URL_INVIERTE = "https://ofi5.mef.gob.pe/ssi/Ssi/Index?codigo={}&tipo=2"

_COLS_INVERSION = """i.cui, left(i.nombre, 200) AS nombre, i.estado, i.situacion, i.monto_viable::float AS monto_viable,
                     i.costo_actualizado::float AS costo_actualizado, i.monto_laudo::float AS monto_laudo,
                     i.devengado_acumulado::float AS devengado_acumulado, i.avance_fisico::float AS avance_fisico,
                     i.expediente_tecnico, i.fecha_viabilidad"""


def _inversion(i: dict) -> dict:
    """La inversión como va al dictamen: con su sobrecosto (costo actualizado contra el viable) y su enlace."""
    i = {k: _iso(x) for k, x in i.items()}
    viable, actual = i.get("monto_viable"), i.get("costo_actualizado")
    # Un costo de más de 1.000 veces el viable es un dato imposible (inversion_dudoso, migración 160): no se calcula.
    i["sobrecosto_pct"] = round(100 * (actual / viable - 1), 1) if actual and viable and actual <= 1000 * viable else None
    if i.get("cui"):
        i["fuente_url"] = URL_INVIERTE.format(str(i["cui"]).strip())
    return i


def obra_bd(ocid: str, ruc: str | None, conn=None) -> dict:
    # El código corto como está en `convocatorias.ocid`: «2026-10404-12» en los procesos de 2026 (no su último tramo).
    corto = _short_ocid(str(ocid or ""))
    propia = conn is None
    conn = conn or _pg()
    try:
        cur = conn.cursor()
        obras = _filas(cur, f"""SELECT {_COLS}, oc.ruc AS ruc_contrato FROM obra_contrato oc JOIN obra_infobras o ON o.codigo = oc.codigo
                                  WHERE oc.ocid = %s AND oc.rol = 'ejecucion' ORDER BY o.contrato_monto DESC NULLS LAST""",
                       (corto,))
        out: dict = {"enlazada": bool(obras), "obras": [], "senales": []}
        # Sin ganador en el OCDS, o con el código de un consorcio (no es un RUC): el RUC del enlace con la obra.
        ruc_proceso = ruc
        if not _es_ruc(ruc):
            ruc = next((o.get("ruc_contrato") for o in obras if o.get("ruc_contrato")), None) or ruc
        out["ruc_contrato"] = ruc
        for o in obras[:3]:
            # El contratista: el que registra INFOBRAS (a un consorcio le pone «C000…», que no abre en nadie), el ganador
            # de este proceso (el código del consorcio en el SEACE, que CONOSCE abre en sus integrantes) y el del enlace.
            # El supervisor: el de INFOBRAS y el ganador del proceso de supervisión de esa misma obra.
            v = vinculo_supervisor_ejecutor(cur, [o.get("supervisor_ruc"), *contraparte_obra(cur, o["codigo"], "supervision")],
                                            [o.get("ejecutor_ruc"), ruc_proceso, o.get("ruc_contrato")])
            # De las reglas de la obra, sólo la del vínculo: las demás ya son banderas obra_* de Vigía.
            out["senales"].extend(s for s in senales_obra(o, v) if s["regla"] == "supervisor_vinculado_ejecutor")
            inv = _filas(cur, f"SELECT {_COLS_INVERSION} FROM inversion_mef i WHERE i.cui = %s LIMIT 1", (o.get("cui"),)) \
                if o.get("cui") else []
            sin_ruc_de_persona(o)
            out["obras"].append({**{k: _iso(x) for k, x in o.items()}, "vinculo_supervisor": v,
                                 "inversion": _inversion(inv[0]) if inv else None,
                                 "supervision_pct_obra": _pct(o.get("supervision_monto"), o.get("contrato_monto")),
                                 "adicionales_pct": _pct(o.get("adicionales_monto"), o.get("contrato_monto")),
                                 "fuente_url": URL_INFOBRAS.format(o["codigo"])})
        # La inversión por el CUI del PROCESO (contrato_cui): está desde la convocatoria, con o sin obra en INFOBRAS.
        out["inversiones"] = [
            _inversion(i) for i in _filas(cur, f"""SELECT {_COLS_INVERSION}, k.origen AS origen_cui
                                                    FROM contrato_cui k JOIN inversion_mef i ON i.cui = k.cui AND NOT i.retirada
                                                   WHERE k.ocid = %s ORDER BY i.costo_actualizado DESC NULLS LAST LIMIT 3""",
                                          (corto,))]
        out["banderas_obra"] = sorted({r["tipo"] for r in _filas(
            cur, """SELECT DISTINCT tipo FROM cruces_proveedor WHERE ocid = %s
                     AND (tipo LIKE 'obra\\_%%' OR tipo LIKE 'inversion\\_%%')""", (corto,))})
        # El historial: por el RUC o, si ganó un consorcio (INFOBRAS no conoce su código del SEACE), por sus integrantes.
        quienes = [x for x in _integrantes(cur, ruc_proceso, ruc) if _es_ruc(x)]
        if quienes:
            h = _filas(cur, f"""SELECT count(*)::int AS obras, count(*) FILTER (WHERE paralizada)::int AS paralizadas,
                                      count(*) FILTER (WHERE {SQL_ADICIONALES_ALTOS})::int AS con_adicionales_altos,
                                      count(*) FILTER (WHERE {SQL_PAGADA_SIN_AVANCE})::int AS pagadas_sin_avance,
                                      count(*) FILTER (WHERE controversias > 0)::int AS con_controversias,
                                      COALESCE(sum(contrato_monto), 0)::float AS monto
                                 FROM obra_infobras WHERE ejecutor_ruc = ANY(%s)""", (quienes,))[0]
            out["historial_contratista"] = {**h, **historial_de(quienes, "ejecutó", "ejecutaron")}
        elif ruc_proceso or ruc:
            out["historial_contratista"] = dict(HISTORIAL_SIN_DATO)
        if es_persona_natural(out.get("ruc_contrato")):
            out["_ruc_contrato"], out["ruc_contrato"] = out["ruc_contrato"], None
        return out
    finally:
        if propia:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


def _avance_ya_cruzado(state) -> None:
    """La obra está enlazada y trae su avance: «INFOBRAS no disponible» deja de ser una validación pendiente (la pone la
    clasificación al empezar y la estrategia de mercado, que corre antes de este cruce)."""
    vp = state.get("validaciones_pendientes")
    if isinstance(vp, list) and "infobras_avance" in vp:
        state["validaciones_pendientes"] = [v for v in vp if v != "infobras_avance"]
    ma = state.get("market_analysis")
    if isinstance(ma, dict) and "infobras_avance" in (ma.get("validaciones_pendientes") or []):
        ma = dict(ma)
        ma["validaciones_pendientes"] = [v for v in ma["validaciones_pendientes"] if v != "infobras_avance"]
        ma["observaciones_clave"] = [x for x in (ma.get("observaciones_clave") or []) if "INFOBRAS" not in str(x)] + [
            "Avance físico y financiero de la obra: cruzado con INFOBRAS (bloque `obra_ejecucion`)."]
        state["market_analysis"] = ma


def query_obra_ejecucion(ocid: str, tool_context: ToolContext, ruc: str | None = None) -> dict:
    """Obra: la obra que ejecuta este contrato en INFOBRAS, su inversión en Invierte.pe, su supervisor y el vínculo de
    éste con el contratista, las banderas de obra de Vigía y el historial del contratista.

    Args:
        ocid: el proceso de la obra.
        ruc: RUC del contratista ganador.
    """
    try:
        ob = obra_bd(ocid, ruc)
    except Exception as e:  # noqa: BLE001
        return {"error": f"base no disponible: {str(e)[:160]}"}
    # El RUC de una persona natural no queda en el bloque (va al dictamen y a la ficha): sólo vuelve al orquestador, que
    # lo necesita para pedir el expediente cuando el OCDS no trae ganador.
    ruc_contrato = ob.pop("_ruc_contrato", None) or ob.get("ruc_contrato")
    tool_context.state["obra_ejecucion"] = ob
    if any(o.get("fisico_real") is not None or o.get("financiero_pct") is not None for o in ob["obras"]):
        _avance_ya_cruzado(tool_context.state)
    return {"enlazada": ob["enlazada"], "ruc_contrato": ruc_contrato, "obras": len(ob["obras"]),
            "inversiones": len(ob.get("inversiones") or []), "banderas_obra": ob["banderas_obra"],
            "senales": ob["senales"], "historial": ob.get("historial_contratista")}


query_obra_ejecucion_tool = FunctionTool(query_obra_ejecucion)
