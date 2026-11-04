"""La red de obras (plan 2026-11-04, parte 3): la obra que ejecuta este contrato, desde la base.

`obra_contrato` (rol `ejecucion`, migración 160) enlaza el proceso con su obra en INFOBRAS (`obra_infobras`): avance físico
y financiero, paralización, ampliaciones, adicionales, controversias, informes de control y su supervisor. Por el CUI,
la inversión en Invierte.pe (`inversion_mef`): monto viable, costo actualizado y laudos. Del supervisor contra el
contratista, el mismo cruce que la red de consultoría (tools/consultoria.vinculo_supervisor_ejecutor).

Las banderas de la obra ya existen en el sistema de banderas (obra_*, inversion_*, migr. 160): aquí se juntan los hechos
para el dictamen y sólo se agrega la señal nueva, el supervisor vinculado al contratista.
"""
from __future__ import annotations

from tools._core import *  # noqa: F401,F403
from tools.consultoria import (URL_INFOBRAS, _COLS, _filas, _iso, _pct, senales_obra,
                               vinculo_supervisor_ejecutor)
from tools.privacidad import es_persona_natural, tapar_nombre


def obra_bd(ocid: str, ruc: str | None, conn=None) -> dict:
    corto = str(ocid or "").split("-")[-1] if str(ocid or "").startswith("ocds-") else str(ocid or "")
    propia = conn is None
    conn = conn or _pg()
    try:
        cur = conn.cursor()
        obras = _filas(cur, f"""SELECT {_COLS} FROM obra_contrato oc JOIN obra_infobras o ON o.codigo = oc.codigo
                                  WHERE oc.ocid = %s AND oc.rol = 'ejecucion' ORDER BY o.contrato_monto DESC NULLS LAST""",
                       (corto,))
        out: dict = {"enlazada": bool(obras), "obras": [], "senales": []}
        for o in obras[:3]:
            v = vinculo_supervisor_ejecutor(cur, o.get("supervisor_ruc") or "", o.get("ejecutor_ruc") or ruc or "")
            # De las reglas de la obra, sólo la del vínculo: las demás ya son banderas obra_* de Vigía.
            out["senales"].extend(s for s in senales_obra(o, v) if s["regla"] == "supervisor_vinculado_ejecutor")
            inv = _filas(cur, """SELECT nombre, estado, situacion, monto_viable::float AS monto_viable,
                                        costo_actualizado::float AS costo_actualizado, monto_laudo::float AS monto_laudo,
                                        devengado_acumulado::float AS devengado_acumulado, avance_fisico::float AS avance_fisico,
                                        expediente_tecnico, fecha_viabilidad
                                   FROM inversion_mef WHERE cui = %s LIMIT 1""", (o.get("cui"),)) if o.get("cui") else []
            i = inv[0] if inv else None
            if i:
                i = {k: _iso(x) for k, x in i.items()}
                i["sobrecosto_pct"] = round(100 * (i["costo_actualizado"] / i["monto_viable"] - 1), 1) \
                    if i.get("costo_actualizado") and i.get("monto_viable") else None
            for k in ("ejecutor_nombre", "supervisor_nombre"):
                if es_persona_natural(o.get(k.replace("_nombre", "_ruc"))) and o.get(k):
                    o[k] = tapar_nombre(o[k])
            out["obras"].append({**{k: _iso(x) for k, x in o.items()}, "vinculo_supervisor": v, "inversion": i,
                                 "supervision_pct_obra": _pct(o.get("supervision_monto"), o.get("contrato_monto")),
                                 "adicionales_pct": _pct(o.get("adicionales_monto"), o.get("contrato_monto")),
                                 "fuente_url": URL_INFOBRAS.format(o["codigo"])})
        out["banderas_obra"] = sorted({r["tipo"] for r in _filas(
            cur, """SELECT DISTINCT tipo FROM cruces_proveedor WHERE ocid = %s
                     AND (tipo LIKE 'obra\\_%%' OR tipo LIKE 'inversion\\_%%')""", (corto,))})
        if ruc:
            h = _filas(cur, """SELECT count(*)::int AS obras, count(*) FILTER (WHERE paralizada)::int AS paralizadas,
                                      count(*) FILTER (WHERE adicionales_monto > 0.15 * NULLIF(contrato_monto, 0))::int AS con_adicionales_altos,
                                      count(*) FILTER (WHERE financiero_pct - fisico_real >= 20)::int AS pagadas_sin_avance,
                                      count(*) FILTER (WHERE controversias > 0)::int AS con_controversias,
                                      COALESCE(sum(contrato_monto), 0)::float AS monto
                                 FROM obra_infobras WHERE ejecutor_ruc = %s""", (ruc,))[0]
            out["historial_contratista"] = {**h, "fuente": "INFOBRAS (Contraloría), todas las obras que ejecutó"}
        return out
    finally:
        if propia:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


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
    tool_context.state["obra_ejecucion"] = ob
    return {"enlazada": ob["enlazada"], "obras": len(ob["obras"]), "banderas_obra": ob["banderas_obra"],
            "senales": ob["senales"], "historial": ob.get("historial_contratista")}


query_obra_ejecucion_tool = FunctionTool(query_obra_ejecucion)
