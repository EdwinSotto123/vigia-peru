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


def _es_ruc(v) -> bool:
    s = str(v or "").strip()
    return len(s) == 11 and s.isdigit()


def _ids(*valores) -> list[str]:
    """Identificadores sin vacíos ni repetidos; cada valor puede ser uno solo o una lista."""
    out: list[str] = []
    for v in valores:
        for x in (v if isinstance(v, (list, tuple, set)) else [v]):
            x = str(x or "").strip()
            if x and x not in out:
                out.append(x)
    return out


def _integrantes(cur, *ids) -> list[str]:
    """Cada identificador (un RUC, el código de un consorcio en el SEACE) y, de los que son consorcios, sus integrantes."""
    todos = _ids(*ids)
    if not todos:
        return []
    m = [r["ruc_miembro"] for r in _filas(cur, "SELECT DISTINCT ruc_miembro FROM conosce_consorcios WHERE ruc_consorcio = ANY(%s)",
                                         (todos,)) if r.get("ruc_miembro")]
    return sorted({*todos, *m})


def contraparte_obra(cur, codigo, rol: str) -> list[str]:
    """Con qué ganador calzó el OTRO contrato de la misma obra (`rol`: 'ejecucion' o 'supervision'), según obra_contrato.
    INFOBRAS publica al consorcio que ejecuta con su código «C000…» o sin nada: por ahí no se llega a sus integrantes;
    por el proceso que ganó, sí (el código del consorcio en el SEACE, que CONOSCE abre en sus integrantes)."""
    return [r["ruc"] for r in _filas(cur, "SELECT DISTINCT ruc FROM obra_contrato WHERE codigo = %s AND rol = %s", (codigo, rol))
            if r.get("ruc")]


def vinculo_supervisor_ejecutor(cur, supervisor, ejecutor) -> dict:
    """Qué une al supervisor con el ejecutor (los dos expandidos a sus consorciados). Sin documentos ni nombres en claro.
    Cada lado puede ser un identificador o varios (el de INFOBRAS, el ganador del proceso, el del enlace con la obra)."""
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


def _avance_posible(v) -> bool:
    return v is not None and 0 <= v <= 100.5


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
        # «Existe paralización = Sí» también queda en una obra que después siguió o terminó: el texto dice cuál es el caso.
        estado = str(o.get("estado") or "").strip()
        sigue = not estado or estado.lower().startswith("paraliz")
        s.append({"regla": "supervision_obra_paralizada", "severidad": "media", "norma": NORMA_SUPERVISION, "fuente_url": url,
                  "evidencia": (f"«{nombre}» figura paralizada en INFOBRAS" if sigue else
                                f"«{nombre}» registra una paralización en INFOBRAS y hoy figura «{estado}»")
                               + (f" ({o['dias_paralizada']} días)" if o.get("dias_paralizada") else "")
                               + (f": {o['causal_paralizacion']}" if o.get("causal_paralizacion") else "") + "."})
    fis, fin, prog = o.get("fisico_real"), o.get("financiero_pct"), o.get("fisico_prog")
    # Un dato imposible de INFOBRAS (avance de 1.700 %, adicionales de 300 veces el contrato) no dispara nada: los mismos
    # límites que obra_dudoso() (migración 160).
    if not _avance_posible(fis):
        fis = None
    if not _avance_posible(prog):
        prog = None
    if fin is not None and not 0 <= fin <= 300:
        fin = None
    # Con la obra físicamente terminada (95 % o más), pagar más del 100 % son adicionales o reajustes ya ejecutados, no
    # «pago sin obra» (como obra_pagado_sin_avance en la migración 160).
    if fis is not None and fin is not None and fin - fis >= 20 and fis < 95:
        s.append({"regla": "supervision_pagado_sin_avance", "severidad": "media", "norma": NORMA_SUPERVISION, "fuente_url": url,
                  "evidencia": f"En «{nombre}» se pagó el {fin:.0f} % y el avance físico es {fis:.0f} %: "
                               f"{fin - fis:.0f} puntos pagados sin obra que los respalde, con la supervisión en curso."})
    if fis is not None and prog is not None and prog - fis >= 25:
        s.append({"regla": "supervision_avance_rezagado", "severidad": "baja", "norma": NORMA_SUPERVISION, "fuente_url": url,
                  "evidencia": f"«{nombre}» lleva {fis:.0f} % de avance físico contra {prog:.0f} % programado."})
    p_adic = _pct(o.get("adicionales_monto"), o.get("contrato_monto"))
    if p_adic is not None and 15 <= p_adic <= 300:
        s.append({"regla": "supervision_adicionales_altos", "severidad": "media", "norma": NORMA_SUPERVISION, "fuente_url": url,
                  "evidencia": f"«{nombre}» tiene {o.get('adicionales_n') or 0} adicional(es) por el {p_adic:.0f} % del contrato "
                               f"de obra (el 15 % es el tope sin autorización de la Contraloría), aprobados con esta supervisión."})
    p_sup = _pct(o.get("supervision_monto"), o.get("contrato_monto"))
    if p_sup is not None and p_sup > 15:
        s.append({"regla": "supervision_costo_atipico", "severidad": "media", "norma": NORMA_SUPERVISION, "fuente_url": url,
                  "evidencia": f"La supervisión de «{nombre}» cuesta el {p_sup:.1f} % del contrato de obra; lo habitual es "
                               f"entre 3 % y 10 %."})
    return s


# Las mismas cuentas que las señales de arriba, para el historial (sin datos imposibles ni obras ya terminadas).
SQL_ADICIONALES_ALTOS = "adicionales_monto > 0.15 * NULLIF(contrato_monto, 0) AND adicionales_monto <= 3 * contrato_monto"
SQL_PAGADA_SIN_AVANCE = ("financiero_pct - fisico_real >= 20 AND fisico_real >= 0 AND fisico_real < 95 "
                         "AND financiero_pct <= 300")
HISTORIAL_SIN_DATO = {"estado": "sin_dato", "motivo": ("el ganador es un consorcio sin RUC propio y el CONOSCE todavía no publica "
                                                      "sus integrantes: no se pudo buscar su historial en INFOBRAS")}


def historial_de(quienes: list[str], uno: str, varios: str) -> dict:
    """De quién es el historial: de la empresa o, en un consorcio, de sus integrantes sumados."""
    if len(quienes) > 1:
        return {"integrantes": len(quienes),
                "fuente": f"INFOBRAS (Contraloría), todas las obras que {varios} los {len(quienes)} integrantes del consorcio"}
    return {"fuente": f"INFOBRAS (Contraloría), todas las obras que {uno}"}


def sin_ruc_de_persona(o: dict) -> None:
    """El ejecutor o el supervisor que es una persona natural (RUC 10): un apellido tapado y sin su RUC (lleva el DNI)."""
    for rol in ("ejecutor", "supervisor"):
        if es_persona_natural(o.get(f"{rol}_ruc")):
            if o.get(f"{rol}_nombre"):
                o[f"{rol}_nombre"] = tapar_nombre(o[f"{rol}_nombre"])
            o[f"{rol}_ruc"] = None
            o[f"{rol}_persona_natural"] = True
    if es_persona_natural(o.get("ruc_contrato")):
        o["ruc_contrato"] = None


def supervision_bd(ocid: str, ruc_ganador: str | None, conn=None) -> dict:
    # El código corto como está en `convocatorias.ocid`: «2026-10404-12» en los procesos de 2026 (no su último tramo).
    corto = _short_ocid(str(ocid or ""))
    propia = conn is None
    conn = conn or _pg()
    try:
        cur = conn.cursor()
        obras = _filas(cur, f"""SELECT {_COLS}, oc.ruc AS ruc_contrato FROM obra_contrato oc JOIN obra_infobras o ON o.codigo = oc.codigo
                                  WHERE oc.ocid = %s AND oc.rol = 'supervision' ORDER BY o.contrato_monto DESC NULLS LAST""",
                       (corto,))
        out: dict = {"enlazada": bool(obras), "obras": [], "senales": []}
        # Sin ganador en el OCDS, o con el código de un consorcio (no es un RUC): el RUC del enlace con la obra.
        ruc_proceso = ruc_ganador
        if not _es_ruc(ruc_ganador):
            ruc_ganador = next((o.get("ruc_contrato") for o in obras if o.get("ruc_contrato")), None) or ruc_ganador
        out["ruc_contrato"] = ruc_ganador
        for o in obras[:5]:
            # El supervisor: el que registra INFOBRAS, el ganador de este proceso (un consorcio, por su código) y el del
            # enlace. El ejecutor: el de INFOBRAS y el ganador del proceso de obras de esa misma obra.
            v = vinculo_supervisor_ejecutor(cur, [o.get("supervisor_ruc"), ruc_proceso, o.get("ruc_contrato")],
                                            [o.get("ejecutor_ruc"), *contraparte_obra(cur, o["codigo"], "ejecucion")])
            sen = senales_obra(o, v)
            sin_ruc_de_persona(o)
            out["obras"].append({**{k: _iso(x) for k, x in o.items()}, "vinculo": v,
                                 "supervision_pct_obra": _pct(o.get("supervision_monto"), o.get("contrato_monto")),
                                 "adicionales_pct": _pct(o.get("adicionales_monto"), o.get("contrato_monto")),
                                 "fuente_url": URL_INFOBRAS.format(o["codigo"])})
            out["senales"].extend(sen)
        # El historial: por el RUC o, si ganó un consorcio (INFOBRAS no conoce su código del SEACE), por sus integrantes.
        quienes = [x for x in _integrantes(cur, ruc_proceso, ruc_ganador) if _es_ruc(x)]
        if quienes:
            h = _filas(cur, f"""SELECT count(*)::int AS obras, count(*) FILTER (WHERE paralizada)::int AS paralizadas,
                                      count(*) FILTER (WHERE {SQL_ADICIONALES_ALTOS})::int AS con_adicionales_altos,
                                      count(*) FILTER (WHERE {SQL_PAGADA_SIN_AVANCE})::int AS pagadas_sin_avance,
                                      COALESCE(sum(supervision_monto), 0)::float AS monto_supervision
                                 FROM obra_infobras WHERE supervisor_ruc = ANY(%s)""", (quienes,))[0]
            out["historial_supervisor"] = {**h, **historial_de(quienes, "supervisó", "supervisaron")}
        elif ruc_proceso or ruc_ganador:
            out["historial_supervisor"] = dict(HISTORIAL_SIN_DATO)
        if es_persona_natural(out.get("ruc_contrato")):
            out["_ruc_contrato"], out["ruc_contrato"] = out["ruc_contrato"], None
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
    # El RUC de una persona natural no queda en el bloque (va al dictamen y a la ficha): sólo vuelve al orquestador, que
    # lo necesita para pedir el expediente cuando el OCDS no trae ganador.
    ruc_contrato = sup.pop("_ruc_contrato", None) or sup.get("ruc_contrato")
    tool_context.state["supervision_obra"] = sup
    return {"enlazada": sup["enlazada"], "ruc_contrato": ruc_contrato, "obras": len(sup["obras"]), "senales": sup["senales"],
            "historial": sup.get("historial_supervisor")}


query_supervision_obra_tool = FunctionTool(query_supervision_obra)
