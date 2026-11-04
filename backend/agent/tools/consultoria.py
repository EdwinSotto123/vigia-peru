"""La red de consultoría (plan 2026-11-04, parte 3): la supervisión de obra contra lo que pasó en la obra, desde la base.

Una consultoría de supervisión se enlaza a su obra por `obra_contrato` (rol `supervision`, migración 160; 1.171 hoy, todas
consultorías). De la obra, en INFOBRAS (`obra_infobras`): el ejecutor, el monto, el avance físico y financiero, la
paralización, las ampliaciones, los adicionales y los informes de control. Y del supervisor contra el ejecutor:
personas en común en el RNP (por documento, que no sale de aquí), consorcios en común y el mismo domicilio fiscal.

Las señales son reglas fijas sobre esos hechos (no las elige el modelo) y van al sistema de banderas por
`flags_from_senales`. Si el proceso no está enlazado a una obra, queda su historial como supervisor.
"""
from __future__ import annotations

from tools._core import *  # noqa: F401,F403
from tools.privacidad import es_persona_natural, tapar_nombre

NORMA_SUPERVISION = ("Ley 32069 y su reglamento: el supervisor vela directa y permanentemente por la correcta ejecución "
                     "técnica, económica y administrativa de la obra y del contrato")
URL_INFOBRAS = "https://infobras.contraloria.gob.pe/InfobrasWeb/Mapa/Sumario?ObraId={}"

_COLS = """o.codigo, o.cui, left(o.nombre, 200) AS nombre, o.estado, o.entidad_nombre, o.ejecutor_ruc, o.ejecutor_nombre,
           o.contrato_monto::float AS contrato_monto, o.supervisor_ruc, o.supervisor_nombre,
           o.supervision_monto::float AS supervision_monto, o.supervision_inicio, o.supervision_fin, o.fecha_inicio,
           o.fecha_fin_prog, o.plazo_dias, o.fisico_prog::float AS fisico_prog, o.fisico_real::float AS fisico_real,
           o.financiero_pct::float AS financiero_pct, o.paralizada, left(o.causal_paralizacion, 200) AS causal_paralizacion,
           o.dias_paralizada, o.dias_ampliacion, o.controversias, o.adicionales_n, o.adicionales_monto::float AS adicionales_monto,
           o.adic_sup_n, o.adic_sup_monto::float AS adic_sup_monto, o.informes_control, o.avance_fecha"""


def _filas(cur, sql: str, params: tuple) -> list[dict]:
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


def _integrantes(cur, ruc: str) -> list[str]:
    """El RUC y, si es un consorcio, sus integrantes."""
    if not ruc:
        return []
    m = [r["ruc_miembro"] for r in _filas(cur, "SELECT DISTINCT ruc_miembro FROM conosce_consorcios WHERE ruc_consorcio = %s", (ruc,))]
    return sorted({ruc, *m})


def vinculo_supervisor_ejecutor(cur, supervisor: str, ejecutor: str) -> dict:
    """Qué une al supervisor con el ejecutor (los dos expandidos a sus consorciados). Sin documentos ni nombres en claro."""
    sup, eje = _integrantes(cur, supervisor), _integrantes(cur, ejecutor)
    out = {"mismo_ruc": bool(set(sup) & set(eje)), "personas_comunes": [], "consorcios_comunes": [], "mismo_domicilio": False}
    if not sup or not eje:
        return out
    out["personas_comunes"] = [
        {"nombre": tapar_nombre(r["nombre"]), "rol_en_supervisor": r["rol_a"], "rol_en_ejecutor": r["rol_b"]}
        for r in _filas(cur, """
            SELECT DISTINCT a.nombre, a.tipo_rol AS rol_a, b.tipo_rol AS rol_b
              FROM rnp_conformacion_juridica a
              JOIN rnp_conformacion_juridica b ON b.numero_documento = a.numero_documento
             WHERE a.ruc_empresa = ANY(%s) AND b.ruc_empresa = ANY(%s) AND a.ruc_empresa <> b.ruc_empresa
               AND a.numero_documento IS NOT NULL AND a.numero_documento <> ''
             LIMIT 10""", (sup, eje))]
    out["consorcios_comunes"] = [r["ruc_consorcio"] for r in _filas(cur, """
        SELECT a.ruc_consorcio FROM conosce_consorcios a JOIN conosce_consorcios b ON b.ruc_consorcio = a.ruc_consorcio
         WHERE a.ruc_miembro = ANY(%s) AND b.ruc_miembro = ANY(%s) AND a.ruc_miembro <> b.ruc_miembro
         GROUP BY 1 LIMIT 10""", (sup, eje))]
    dom = _filas(cur, """SELECT count(DISTINCT p.ruc) AS n FROM sunat_padron p
                          WHERE p.ruc = ANY(%s) AND p.domicilio IS NOT NULL AND length(p.domicilio) > 12
                            AND p.domicilio IN (SELECT domicilio FROM sunat_padron WHERE ruc = ANY(%s))""", (sup, eje))
    out["mismo_domicilio"] = bool(dom and dom[0]["n"])
    return out


def _pct(a, b):
    try:
        return round(100 * float(a) / float(b), 1) if a is not None and b else None
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def senales_obra(o: dict, vinculo: dict | None) -> list[dict]:
    """Reglas fijas sobre una obra supervisada (los mismos umbrales que las banderas de obras de Vigía cuando existen)."""
    s: list[dict] = []
    url = URL_INFOBRAS.format(o["codigo"])
    nombre = (o.get("nombre") or "la obra")[:120]
    if vinculo:
        partes = []
        if vinculo.get("mismo_ruc"):
            partes.append("el supervisor y el ejecutor son la misma empresa o comparten consorciado")
        if vinculo.get("personas_comunes"):
            p = vinculo["personas_comunes"][0]
            partes.append(f"{len(vinculo['personas_comunes'])} persona(s) en común en el RNP (p. ej. {p['nombre']}, "
                          f"{str(p['rol_en_supervisor']).lower().replace('_', ' ')} en el supervisor y "
                          f"{str(p['rol_en_ejecutor']).lower().replace('_', ' ')} en el ejecutor)")
        if vinculo.get("consorcios_comunes"):
            partes.append(f"formaron juntos {len(vinculo['consorcios_comunes'])} consorcio(s)")
        if vinculo.get("mismo_domicilio"):
            partes.append("tienen el mismo domicilio fiscal en SUNAT")
        if partes:
            s.append({"regla": "supervisor_vinculado_ejecutor", "severidad": "alta", "norma": NORMA_SUPERVISION,
                      "fuente_url": url,
                      "evidencia": f"En «{nombre}» (INFOBRAS {o['codigo']}): " + "; ".join(partes) + "."})
    if o.get("paralizada") or (o.get("dias_paralizada") or 0) >= 90:
        s.append({"regla": "supervision_obra_paralizada", "severidad": "media", "norma": NORMA_SUPERVISION, "fuente_url": url,
                  "evidencia": f"«{nombre}» figura paralizada en INFOBRAS"
                               + (f" ({o['dias_paralizada']} días)" if o.get("dias_paralizada") else "")
                               + (f": {o['causal_paralizacion']}" if o.get("causal_paralizacion") else "") + "."})
    fis, fin, prog = o.get("fisico_real"), o.get("financiero_pct"), o.get("fisico_prog")
    if fis is not None and fin is not None and fin - fis >= 20:
        s.append({"regla": "supervision_pagado_sin_avance", "severidad": "media", "norma": NORMA_SUPERVISION, "fuente_url": url,
                  "evidencia": f"En «{nombre}» se pagó el {fin:.0f} % y el avance físico es {fis:.0f} %: "
                               f"{fin - fis:.0f} puntos pagados sin obra que los respalde, con la supervisión en curso."})
    if fis is not None and prog is not None and prog - fis >= 25:
        s.append({"regla": "supervision_avance_rezagado", "severidad": "baja", "norma": NORMA_SUPERVISION, "fuente_url": url,
                  "evidencia": f"«{nombre}» lleva {fis:.0f} % de avance físico contra {prog:.0f} % programado."})
    p_adic = _pct(o.get("adicionales_monto"), o.get("contrato_monto"))
    if p_adic is not None and p_adic >= 15:
        s.append({"regla": "supervision_adicionales_altos", "severidad": "media", "norma": NORMA_SUPERVISION, "fuente_url": url,
                  "evidencia": f"«{nombre}» tiene {o.get('adicionales_n') or 0} adicional(es) por el {p_adic:.0f} % del contrato "
                               f"de obra (el 15 % es el tope sin autorización de la Contraloría), aprobados con esta supervisión."})
    p_sup = _pct(o.get("supervision_monto"), o.get("contrato_monto"))
    if p_sup is not None and p_sup > 15:
        s.append({"regla": "supervision_costo_atipico", "severidad": "media", "norma": NORMA_SUPERVISION, "fuente_url": url,
                  "evidencia": f"La supervisión de «{nombre}» cuesta el {p_sup:.1f} % del contrato de obra; lo habitual es "
                               f"entre 3 % y 10 %."})
    return s


def supervision_bd(ocid: str, ruc_ganador: str | None, conn=None) -> dict:
    corto = str(ocid or "").split("-")[-1] if str(ocid or "").startswith("ocds-") else str(ocid or "")
    propia = conn is None
    conn = conn or _pg()
    try:
        cur = conn.cursor()
        obras = _filas(cur, f"""SELECT {_COLS}, oc.ruc AS ruc_contrato FROM obra_contrato oc JOIN obra_infobras o ON o.codigo = oc.codigo
                                  WHERE oc.ocid = %s AND oc.rol = 'supervision' ORDER BY o.contrato_monto DESC NULLS LAST""",
                       (corto,))
        out: dict = {"enlazada": bool(obras), "obras": [], "senales": []}
        # Sin ganador en el OCDS (procesos viejos): el RUC del enlace con la obra.
        ruc_ganador = ruc_ganador or next((o.get("ruc_contrato") for o in obras if o.get("ruc_contrato")), None)
        out["ruc_contrato"] = ruc_ganador
        for o in obras[:5]:
            v = vinculo_supervisor_ejecutor(cur, o.get("supervisor_ruc") or ruc_ganador or "", o.get("ejecutor_ruc") or "")
            sen = senales_obra(o, v)
            for k in ("ejecutor_nombre", "supervisor_nombre"):
                ruc_k = o.get(k.replace("_nombre", "_ruc"))
                if es_persona_natural(ruc_k) and o.get(k):
                    o[k] = tapar_nombre(o[k])
            out["obras"].append({**{k: _iso(x) for k, x in o.items()}, "vinculo": v,
                                 "supervision_pct_obra": _pct(o.get("supervision_monto"), o.get("contrato_monto")),
                                 "adicionales_pct": _pct(o.get("adicionales_monto"), o.get("contrato_monto")),
                                 "fuente_url": URL_INFOBRAS.format(o["codigo"])})
            out["senales"].extend(sen)
        if ruc_ganador:
            h = _filas(cur, """SELECT count(*)::int AS obras, count(*) FILTER (WHERE paralizada)::int AS paralizadas,
                                      count(*) FILTER (WHERE adicionales_monto > 0.15 * NULLIF(contrato_monto, 0))::int AS con_adicionales_altos,
                                      count(*) FILTER (WHERE financiero_pct - fisico_real >= 20)::int AS pagadas_sin_avance,
                                      COALESCE(sum(supervision_monto), 0)::float AS monto_supervision
                                 FROM obra_infobras WHERE supervisor_ruc = %s""", (ruc_ganador,))[0]
            out["historial_supervisor"] = {**h, "fuente": "INFOBRAS (Contraloría), todas las obras que supervisó"}
        return out
    finally:
        if propia:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


def query_supervision_obra(ocid: str, tool_context: ToolContext, ruc: str | None = None) -> dict:
    """Consultoría de supervisión: la obra que supervisa (INFOBRAS), qué la une con el ejecutor y las señales de la
    supervisión; y el historial del consultor como supervisor.

    Args:
        ocid: el proceso de la consultoría.
        ruc: RUC del consultor ganador.
    """
    try:
        sup = supervision_bd(ocid, ruc)
    except Exception as e:  # noqa: BLE001
        return {"error": f"base no disponible: {str(e)[:160]}"}
    tool_context.state["supervision_obra"] = sup
    return {"enlazada": sup["enlazada"], "ruc_contrato": sup.get("ruc_contrato"), "obras": len(sup["obras"]), "senales": sup["senales"],
            "historial": sup.get("historial_supervisor")}


query_supervision_obra_tool = FunctionTool(query_supervision_obra)
