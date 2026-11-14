"""Expediente del proveedor desde la base de Vigía: lo que el agente antes buscaba afuera (SUNAT por decolecta, el
historial por la web) y lo que ya calculó Vigía (banderas). Plan 2026-11-04, parte 1.

  · SUNAT: `empresa_resumen` (la misma ficha de /empresa/<RUC>), `empresas` y `sunat_padron` (2,37 M de RUC 20: en
    2026 no hay un solo ganador con RUC 20 fuera del padrón).
  · Persona natural (RUC 10): no está en el padrón de empresas. Su ficha sale de lo que Vigía ya calculó con sus
    órdenes, las declaraciones juradas de intereses, la planilla, el JNE, la ONPE y las visitas (`persona_entidad`,
    `persona_senal`). Ningún servicio externo.
  · RNP: socios, representantes y directivos (`rnp_conformacion_juridica`), con el nombre con un apellido tapado y sin
    su documento.
  · Sanciones del OECE (`osce_sancionados`) y penalidades (`penalidades`).
  · Historial: las buenas pro del CONOSCE (`conosce_adjudicaciones`), también como socio de un consorcio
    (`conosce_consorcios`).
  · Banderas de Vigía (`cruces_proveedor`), las del proveedor y las de este proceso.

`query_expediente_proveedor` deja el expediente en `state["expediente_proveedor"]` y, con las mismas claves que las
consultas en vivo, el perfil SUNAT (`sunat_profiles`, `sunat_decolecta`) y el del OECE (`oece_perfiles`): las reglas,
`compliance_extended` y el dictamen siguen igual.
"""
from __future__ import annotations

from datetime import date

from tools._core import *  # noqa: F401,F403
from tools.privacidad import es_persona_natural, tapar_nombre

_MAX_RNP = 30
_MAX_PROCESOS = 8

# Las señales de `persona_senal` en una frase. Sin el detalle: ahí van nombres de parientes y de terceros.
_SENAL_PERSONA = {
    "tambien_planilla": "figura en la planilla de la entidad mientras cobra por órdenes de servicio",
    "nepotismo": "tiene un pariente declarado entre los funcionarios de la entidad",
    "nepotismo_gobierno": "tiene un pariente declarado en el mismo nivel de gobierno",
    "funcionario_contratado": "declaró un cargo público en la entidad y además cobra por órdenes",
    "autoridad_contratada": "es o fue autoridad elegida y cobra por órdenes",
    "financio_campana": "aportó a la campaña de quien gobierna la entidad",
    "aporte_gobierna": "aportó al partido que gobierna la entidad",
    "candidato_gobierna": "fue candidato del partido que gobierna la entidad",
    "inhabilitado": "recibió órdenes con una sanción del OECE vigente",
    "al_borde_del_tope": "recibe órdenes justo por debajo del tope de las compras menores",
    "meses_seguidos": "encadena órdenes mes a mes, como si fuera un puesto fijo",
    "pago_alto": "cobra por órdenes más que lo usual en la entidad",
    "visita_previa": "visitó la entidad antes de su primera orden",
    "socio_proveedor": "es socio o representante de una empresa proveedora del Estado",
    "apellidos_funcionario": "comparte los dos apellidos con un funcionario designado de la entidad",
    "apellidos_autoridad": "comparte los dos apellidos con una autoridad de la entidad",
    "familia_estado": "tiene familiares declarados que trabajan en el Estado",
    "paso_a_planilla": "pasó de órdenes de servicio a la planilla",
    "candidato": "fue candidato en una elección",
    "aporte": "aportó a una organización política",
}
# El nombre legible de las señales que más se repiten (para la ficha; lo demás sale con sus palabras).
_ETIQUETA_SENAL = {
    "unico_postor_alto": "único postor con oferta alta", "unica_oferta_valida": "única oferta válida",
    "oferta_igual_valor_referencial": "oferta igual al valor referencial", "concentracion_entidad": "proveedor que concentra las compras",
    "lobby_visits_pre_convocatoria": "visitas a la entidad antes de la convocatoria", "red_flag_documental": "requisitos dirigidos en las bases",
    "postores_vinculados_rnp": "postores vinculados entre sí", "tipo_proceso_vs_monto": "procedimiento que no corresponde al monto",
    "fraccionamiento": "posible fraccionamiento", "sancion_historica_oece": "proveedores con sanciones previas",
    "penalidades_oece_historicas": "proveedores con penalidades previas", "ruc_ganador_muy_nuevo": "ganadores recién creados",
    "fecha_buena_pro_incoherente": "fechas de buena pro incoherentes", "inconsistencia_doc_vs_ocds": "documentos que no cuadran con el registro",
    "plazo_convocatoria_minimo": "plazos de convocatoria mínimos",
}


def _senal(regla) -> str:
    return _ETIQUETA_SENAL.get(str(regla), str(regla).replace("_", " "))


_PESO = {"alta": 0, "media": 1, "baja": 2}
# Las que hablan de un vínculo de la persona con ESTA entidad o con quien la gobierna: sólo ésas son bandera del
# contrato. El resto (cobra más que lo usual, es socio de una empresa) queda como hecho en la ficha.
_SENAL_FUERTE = {"tambien_planilla", "nepotismo", "nepotismo_gobierno", "funcionario_contratado", "autoridad_contratada",
                 "financio_campana", "aporte_gobierna", "candidato_gobierna", "inhabilitado", "visita_previa"}


def _persona_bd(conn, ruc: str, entidad_ruc: str | None) -> dict | None:
    """La persona natural en `persona_entidad` y `persona_senal`. None si la base no deja leerlas (permiso) o no hay
    nada: el expediente sigue sin ese bloque."""
    cur = conn.cursor()
    try:
        filas = _filas(cur, """SELECT entidad_ruc, entidad, servicio, ordenes, meses, monto::float AS monto, primera, ultima
                                 FROM persona_entidad WHERE ruc = %s ORDER BY monto DESC NULLS LAST""", (ruc,))
        senales = _filas(cur, """SELECT tipo, severidad, entidad_ruc FROM persona_senal WHERE ruc = %s""", (ruc,))
    except Exception:  # noqa: BLE001 — es la última consulta del expediente: deshacerla no pierde nada
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        return None
    if not filas and not senales:
        return None
    misma = next((f for f in filas if entidad_ruc and f["entidad_ruc"] == entidad_ruc), None)
    primeras = [f["primera"] for f in filas if f.get("primera")]
    ultimas = [f["ultima"] for f in filas if f.get("ultima")]
    por_tipo: dict[str, dict] = {}
    for s in senales:
        d = por_tipo.setdefault(s["tipo"], {"tipo": s["tipo"], "severidad": s["severidad"], "entidades": set(),
                                            "con_esta_entidad": False})
        d["entidades"].add(s["entidad_ruc"])
        if entidad_ruc and s["entidad_ruc"] == entidad_ruc:
            d["con_esta_entidad"] = True
            d["severidad"] = s["severidad"]
        elif not d["con_esta_entidad"] and _PESO.get(s["severidad"], 3) < _PESO.get(d["severidad"], 3):
            d["severidad"] = s["severidad"]
    lista = [{"tipo": d["tipo"], "severidad": d["severidad"], "con_esta_entidad": d["con_esta_entidad"],
              "entidades": len(d["entidades"]), "que": _SENAL_PERSONA.get(d["tipo"], d["tipo"].replace("_", " "))}
             for d in por_tipo.values()]
    lista.sort(key=lambda d: (not d["con_esta_entidad"], _PESO.get(d["severidad"], 3), d["tipo"]))
    return {
        "ordenes": sum(f.get("ordenes") or 0 for f in filas),
        "monto": round(sum(f.get("monto") or 0 for f in filas), 2),
        "entidades": len(filas),
        "primera": _iso(min(primeras)) if primeras else None,
        "ultima": _iso(max(ultimas)) if ultimas else None,
        "servicio": next((f["servicio"] for f in filas if f.get("servicio")), None),
        "con_esta_entidad": ({"ordenes": misma.get("ordenes") or 0, "meses": misma.get("meses") or 0,
                              "monto": round(misma.get("monto") or 0, 2), "primera": _iso(misma.get("primera")),
                              "ultima": _iso(misma.get("ultima"))} if misma else None),
        "principales_entidades": [{"entidad": f["entidad"], "ordenes": f.get("ordenes") or 0,
                                   "monto": round(f.get("monto") or 0, 2)} for f in filas[:5]],
        "senales": lista,
        "fuente": "base de Vigía: órdenes de compra y de servicio, declaraciones juradas de intereses, planilla, JNE, "
                  "ONPE y registro de visitas",
    }


def senales_de_persona(ruc: str, exp: dict) -> list[dict]:
    """Las señales de la persona CON ESTA ENTIDAD, de severidad alta o media, como una sola bandera del contrato."""
    p = exp.get("persona") or {}
    fuertes = [s for s in p.get("senales") or [] if s.get("con_esta_entidad") and s.get("severidad") in ("alta", "media")
               and s.get("tipo") in _SENAL_FUERTE]
    if not fuertes:
        return []
    sev = "alta" if any(s["severidad"] == "alta" for s in fuertes) else "media"
    misma = p.get("con_esta_entidad") or {}
    cola = (f" Con esta entidad suma {misma['ordenes']} orden(es) por S/ {misma['monto']:,.2f} entre "
            f"{misma.get('primera')} y {misma.get('ultima')}." if misma.get("ordenes") else "")
    return [{"regla": "persona_contratada_senales", "severidad": sev,
             "norma": "Ley General de Contrataciones Públicas — impedimentos para contratar y conflicto de intereses",
             "evidencia": ("El ganador es una persona natural y los registros de Vigía (órdenes, declaraciones juradas "
                           "de intereses, planilla, JNE, ONPE y visitas) dicen que, con esta misma entidad, "
                           + "; ".join(s["que"] for s in fuertes) + "." + cola
                           + " Es un indicio para revisar, no una conclusión.")}]


def _filas(cur, sql: str, params: tuple) -> list[dict]:
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _iso(v):
    return v.isoformat() if isinstance(v, date) else v


def _num(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _limpio(d: dict) -> dict:
    return {k: (_iso(v) if isinstance(v, date) else (_num(v) if hasattr(v, "as_integer_ratio") and not isinstance(v, (int, bool)) else v))
            for k, v in d.items()}


def expediente_proveedor_bd(ruc: str, entidad_ruc: str | None = None, ocid: str | None = None,
                            fecha_ref: date | None = None, conn=None) -> dict:
    """El expediente del proveedor, sólo de la base. Sin red: se puede probar contra DEV."""
    ruc = (ruc or "").strip().replace("PE-RUC-", "")
    propia = conn is None
    conn = conn or _pg()
    try:
        cur = conn.cursor()
        out: dict = {"ruc": ruc, "persona_natural": es_persona_natural(ruc), "fuente": "base de Vigía"}

        # 1. SUNAT: la ficha de empresa (RUC 20) y el padrón.
        ficha = _filas(cur, """SELECT nombre AS razon_social, estado_sunat, fecha_alta, actividad, departamento,
                                      socios, representantes, directivos, inhabilitada, inhabilitada_hasta
                                 FROM empresa_resumen WHERE ruc = %s""", (ruc,))
        padron = _filas(cur, "SELECT razon_social, estado, condicion, ubigeo FROM sunat_padron WHERE ruc = %s", (ruc,))
        emp = _filas(cur, """SELECT razon_social, estado_sunat, fecha_alta_ruc, actividad_economica, rnp_vigente
                               FROM empresas WHERE ruc = %s""", (ruc,))
        f, p, e = (ficha or [{}])[0], (padron or [{}])[0], (emp or [{}])[0]
        if f or p or any(v for v in e.values()):
            fecha_alta = f.get("fecha_alta") or e.get("fecha_alta_ruc")
            ref = fecha_ref or date.today()
            out["sunat"] = {
                "razon_social": f.get("razon_social") or p.get("razon_social") or e.get("razon_social"),
                "estado": p.get("estado") or f.get("estado_sunat") or e.get("estado_sunat"),
                "condicion": p.get("condicion"),
                "fecha_inicio_actividades": _iso(fecha_alta),
                "edad_dias_al_contratar": (ref - fecha_alta).days if fecha_alta else None,
                "actividad": f.get("actividad") or e.get("actividad_economica"),
                "departamento": f.get("departamento"),
                "ubigeo": p.get("ubigeo"),
                "rnp_vigente": e.get("rnp_vigente"),
                "inhabilitada": f.get("inhabilitada"),
                "inhabilitada_hasta": _iso(f.get("inhabilitada_hasta")),
            }

        # 2. RNP: quiénes son (sin documento, con un apellido tapado).
        rnp = _filas(cur, """SELECT tipo_rol, nombre, fecha_inicio_vigencia, forma_societaria
                               FROM rnp_conformacion_juridica WHERE ruc_empresa = %s
                              ORDER BY tipo_rol, fecha_inicio_vigencia DESC NULLS LAST LIMIT %s""", (ruc, _MAX_RNP))
        vistos: set[tuple] = set()
        out["rnp"] = []
        for r in rnp:
            fila = {"rol": r["tipo_rol"], "nombre": tapar_nombre(r["nombre"]), "desde": _iso(r["fecha_inicio_vigencia"]),
                    "forma_societaria": r["forma_societaria"]}
            if (fila["rol"], fila["nombre"]) not in vistos:
                vistos.add((fila["rol"], fila["nombre"]))
                out["rnp"].append(fila)
        out["_nombres_crudos"] = sorted({r["nombre"] for r in rnp if r.get("nombre")})

        # 3. Sanciones y penalidades.
        out["sanciones"] = [_limpio(s) for s in _filas(cur, """
            SELECT tipo, resolucion, fecha_resolucion, fecha_desde, fecha_hasta, left(infraccion, 220) AS infraccion, estado,
                   monto_multa_soles, verificacion_pago
              FROM osce_sancionados WHERE ruc = %s ORDER BY fecha_desde DESC NULLS LAST LIMIT 20""", (ruc,))]
        pen = _filas(cur, """SELECT count(*)::int AS n, sum(monto)::float AS monto, count(DISTINCT entidad_contratante)::int AS entidades,
                                    min(fecha) AS desde, max(fecha) AS hasta
                               FROM penalidades WHERE empresa_ruc = %s""", (ruc,))[0]
        pen_ult = _filas(cur, """SELECT entidad_contratante AS entidad, fecha, monto::float AS monto, tipo_penalidad AS tipo
                                   FROM penalidades WHERE empresa_ruc = %s ORDER BY fecha DESC NULLS LAST LIMIT 5""", (ruc,))
        out["penalidades"] = {**_limpio(pen), "ultimas": [_limpio(x) for x in pen_ult]}

        # 4. Historial en el CONOSCE: solo y como socio de consorcio, por proceso (la tabla es por ítem).
        consorcios = [r["ruc_consorcio"] for r in _filas(cur, """SELECT DISTINCT ruc_consorcio FROM conosce_consorcios
                                                                 WHERE ruc_miembro = %s""", (ruc,))]
        rucs = [ruc, *consorcios]
        procesos = _filas(cur, """
            SELECT codigo_convocatoria, max(entidad) AS entidad, max(entidad_ruc) AS entidad_ruc, max(objeto) AS objeto,
                   left(max(descripcion_proceso), 140) AS descripcion, sum(monto_adjudicado)::float AS monto,
                   min(fecha_buenapro) AS fecha_buena_pro, bool_or(ruc_proveedor <> %s) AS en_consorcio
              FROM conosce_adjudicaciones WHERE ruc_proveedor = ANY(%s)
             GROUP BY 1 ORDER BY min(fecha_buenapro) DESC NULLS LAST""", (ruc, rucs))
        misma = [x for x in procesos if entidad_ruc and x["entidad_ruc"] == entidad_ruc]
        por_entidad: dict[str, dict] = {}
        for x in procesos:
            k = x["entidad_ruc"] or x["entidad"] or "?"
            d = por_entidad.setdefault(k, {"entidad": x["entidad"], "entidad_ruc": x["entidad_ruc"], "procesos": 0, "monto": 0.0})
            d["procesos"] += 1
            d["monto"] += x["monto"] or 0
        fechas = [x["fecha_buena_pro"] for x in procesos if x["fecha_buena_pro"]]
        out["historial"] = {
            "procesos": len(procesos),
            "monto": round(sum(x["monto"] or 0 for x in procesos), 2),
            "en_consorcio": sum(1 for x in procesos if x["en_consorcio"]),
            "entidades": len(por_entidad),
            "primera": _iso(min(fechas)) if fechas else None,
            "ultima": _iso(max(fechas)) if fechas else None,
            "con_esta_entidad": {"procesos": len(misma), "monto": round(sum(x["monto"] or 0 for x in misma), 2)},
            "principales_entidades": sorted(por_entidad.values(), key=lambda d: -d["monto"])[:5],
            "ultimos": [_limpio(x) for x in procesos[:_MAX_PROCESOS]],
            "fuente": "CONOSCE (OECE), buenas pro por proceso",
        }

        # 4b. La antigüedad con la fecha más antigua que hay: la «fecha de alta» del padrón a veces es una reactivación
        #     (4,4 % de las empresas la tienen DESPUÉS de su primera buena pro; THOR CONTRATISTAS figura de 2025 y gana
        #     desde 2018). Si el CONOSCE o el RNP la contradicen, manda la más antigua y queda anotado.
        s = out.get("sunat")
        if s:
            fechas = {"SUNAT": s.get("fecha_inicio_actividades"), "primera buena pro": out["historial"].get("primera"),
                      "RNP": min((r["desde"] for r in out["rnp"] if r.get("desde")), default=None)}
            validas = {k: date.fromisoformat(str(v)[:10]) for k, v in fechas.items() if v}
            if validas:
                fuente, mas_antigua = min(validas.items(), key=lambda kv: kv[1])
                if fuente != "SUNAT" and fechas["SUNAT"]:
                    s["fecha_inicio_dudosa"] = (f"La fecha de inicio del padrón ({fechas['SUNAT']}) es posterior a su "
                                                f"{fuente} ({mas_antigua.isoformat()}): la antigüedad se cuenta desde ésta.")
                s["fecha_inicio_efectiva"] = mas_antigua.isoformat()
                s["edad_dias_al_contratar"] = ((fecha_ref or date.today()) - mas_antigua).days

        # 5. Banderas de Vigía: las del proveedor (por tipo) y las de este proceso.
        out["banderas"] = [_limpio(b) for b in _filas(cur, """
            SELECT tipo, severidad, count(*)::int AS n, count(DISTINCT ocid)::int AS procesos, max(fecha) AS ultima
              FROM cruces_proveedor WHERE ruc_empresa = %s GROUP BY 1, 2
             ORDER BY CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, 3 DESC""", (ruc,))]
        if ocid:
            corto = str(ocid).split("-")[-1]
            out["banderas_de_este_proceso"] = sorted({r["tipo"] for r in _filas(
                cur, "SELECT DISTINCT tipo FROM cruces_proveedor WHERE ruc_empresa = %s AND ocid = %s", (ruc, corto))})

        # 5b. Lo que se repite (migración 276): postores de relleno del proveedor y patrones de los agentes en este
        #     proveedor y en esta entidad. Un contrato raro puede ser un error; el mismo hecho repetido es un modo de trabajar.
        try:
            rell = _filas(cur, """SELECT acompanante, juntos, entidades, postulo, gano, vinculo FROM postor_acompanante
                                   WHERE ruc_ganador = %s AND fuerte ORDER BY juntos DESC LIMIT 5""", (ruc,))
            pats = _filas(cur, """SELECT alcance, regla, casos, leidos, entidades, tasa::float AS tasa, tasa_pais::float AS tasa_pais
                                    FROM patron_agentes WHERE (alcance = 'proveedor' AND ruc = %s) OR (alcance = 'entidad' AND ruc = %s)
                                   ORDER BY alcance, casos DESC LIMIT 12""", (ruc, entidad_ruc or ""))
            if rell:
                out["postores_de_relleno"] = [_limpio(x) for x in rell]
            if pats:
                out["patrones"] = [_limpio(x) for x in pats]
        except Exception:  # noqa: BLE001 — sin esas tablas o sin permiso, el expediente sigue
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass

        # 6. Persona natural: lo que Vigía ya sabe de ella (va al final: si falla, lo anterior queda).
        if out["persona_natural"]:
            persona = _persona_bd(conn, ruc, entidad_ruc)
            if persona:
                out["persona"] = persona
        return out
    finally:
        if propia:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


def _perfil_sunat(ruc: str, exp: dict) -> dict:
    """El expediente con las claves de `query_sunat_decolecta` (lo que leen web_research y las reglas)."""
    s = exp["sunat"]
    return {"ruc": ruc, "razon_social": s.get("razon_social"), "tipo": None, "estado": s.get("estado"),
            "condicion": s.get("condicion"), "departamento": s.get("departamento"), "ubigeo": s.get("ubigeo"),
            "ciiu_principal": s.get("actividad"), "actividades_economicas": [s["actividad"]] if s.get("actividad") else [],
            "fecha_inicio_actividades": s.get("fecha_inicio_efectiva") or s.get("fecha_inicio_actividades"),
            "edad_dias": s.get("edad_dias_al_contratar"), "fecha_inicio_dudosa": s.get("fecha_inicio_dudosa"),
            "_source": "padron_sunat_vigia"}


def _perfil_persona(ruc: str, exp: dict) -> dict:
    """El perfil de una persona natural con lo que hay en la base. No lleva estado ni fecha de inicio: el padrón de
    empresas no la tiene y no se inventa; su antigüedad es la de su trato con el Estado."""
    p, h = exp.get("persona") or {}, exp.get("historial") or {}
    fechas = [f for f in (p.get("primera"), h.get("primera")) if f]
    return {"ruc": ruc, "tipo": "PERSONA NATURAL", "estado": None, "condicion": None,
            "fecha_inicio_actividades": None, "edad_dias": None,
            "contrata_con_el_estado_desde": min(fechas) if fechas else None,
            "ordenes": p.get("ordenes"), "buenas_pro": h.get("procesos"),
            "nota": ("Persona natural: su estado tributario no está en el padrón de empresas de Vigía. No es un dato "
                     "faltante del análisis ni una señal: se juzga por su trayectoria con el Estado y sus señales."),
            "_source": "base_vigia"}


def resumen_para_agentes(exp: dict) -> dict:
    """El expediente en corto, para inyectarlo a los agentes que investigan: lo que YA se sabe por registros."""
    if not exp:
        return {}
    if exp.get("consorcio"):
        return {"consorcio": exp.get("nombre"), "fuente": "base de Vigía",
                "integrantes": [{"nombre": e.get("nombre"), "ruc": None if e.get("persona_natural") else e.get("ruc"),
                                 **resumen_para_agentes({**e, "consorcio": False})} for e in exp.get("integrantes") or []]}
    h, pen, s = exp.get("historial") or {}, exp.get("penalidades") or {}, exp.get("sunat") or {}
    out = {
        "fuente": "base de Vigía (padrón SUNAT, RNP, OECE, CONOSCE)",
        "persona_natural": bool(exp.get("persona_natural")),
        "sunat": {k: s.get(k) for k in ("estado", "condicion", "fecha_inicio_efectiva", "actividad") if s.get(k)},
        "rnp": [f"{r.get('rol')}: {r.get('nombre')}" for r in (exp.get("rnp") or [])[:8]],
        "sanciones_oece": len(exp.get("sanciones") or []),
        "penalidades": {"n": pen.get("n") or 0, "monto": pen.get("monto")},
        "contratos_con_el_estado": {"procesos": h.get("procesos") or 0, "monto": h.get("monto"), "entidades": h.get("entidades"),
                                    "primera": h.get("primera"), "ultima": h.get("ultima"),
                                    "con_esta_entidad": h.get("con_esta_entidad"),
                                    "principales_entidades": [e.get("entidad") for e in (h.get("principales_entidades") or [])[:3]]},
        "banderas_previas": [f"{b.get('tipo')} ({b.get('severidad')}, {b.get('n')})" for b in (exp.get("banderas") or [])[:8]],
        "postores_de_relleno": exp.get("postores_de_relleno") or [],
        "patrones_que_se_repiten": exp.get("patrones") or [],
    }
    p = exp.get("persona")
    if p:
        out["ordenes_con_el_estado"] = {k: p.get(k) for k in ("ordenes", "monto", "entidades", "primera", "ultima", "con_esta_entidad")}
        out["senales_de_la_persona"] = [s_["que"] + (" (con esta entidad)" if s_.get("con_esta_entidad") else "")
                                        for s_ in (p.get("senales") or [])[:8]]
    return out


def _sancion_oece(s: dict, fecha_ref: date | None) -> dict:
    """Una fila de `osce_sancionados` con las claves del OECE, juzgada a la fecha de la buena pro (no a hoy: el `estado`
    del registro es el de hoy). Una sanción que empezó después no cuenta; una definitiva rige desde que empieza."""
    d = {"tipoSancion": s.get("tipo"), "nroRes": s.get("resolucion"), "infraccion": s.get("infraccion"),
         "monto": s.get("monto_multa_soles"), "fechaInicio": s.get("fecha_desde"), "fechaFin": s.get("fecha_hasta"),
         "estado": s.get("estado"), "indPago": s.get("verificacion_pago")}
    ref = fecha_ref or date.today()
    try:
        desde = date.fromisoformat(str(s.get("fecha_desde"))[:10]) if s.get("fecha_desde") else None
    except ValueError:
        desde = None
    if desde and desde > ref:
        d["vigente"] = False
    elif s.get("tipo") == "definitivo":
        d["vigente"] = True
    elif s.get("tipo") == "temporal" and s.get("fecha_hasta"):
        d.pop("estado")  # que decida fechaFin contra la buena pro
    return d


def _perfil_oece(ruc: str, exp: dict, state: dict) -> dict:
    """El expediente con las claves de `query_oece_perfil`, con las señales del mismo clasificador."""
    from tools.sunat import _fecha_buena_pro_state, clasificar_sanciones_oece
    fecha_ref = _fecha_buena_pro_state(state)
    sanciones = [_sancion_oece(s, fecha_ref) for s in exp.get("sanciones") or []]
    pen = exp.get("penalidades") or {}
    penalidades = pen.get("ultimas") or []
    senales, clas = clasificar_sanciones_oece(ruc, sanciones, [], [], [], penalidades, None, None, fecha_ref, state)
    # El clasificador cuenta la lista que recibe (las 5 últimas): la cuenta y la severidad van con el total.
    n_pen = pen.get("n") or 0
    if n_pen:
        senales = [s for s in senales if s.get("regla") != "penalidades_oece_historicas"]
        senales.append({
            "regla": "penalidades_oece_historicas", "severidad": "media" if n_pen >= 3 else "baja",
            "norma": "Reglamento — penalidades en la ejecución contractual (antecedente OECE)",
            "evidencia": (f"El OECE registra {n_pen} penalidad(es) aplicada(s) al RUC {ruc} en contratos anteriores, en "
                          f"{pen.get('entidades') or 0} entidad(es), por S/ {pen.get('monto') or 0:,.2f} entre "
                          f"{pen.get('desde')} y {pen.get('hasta')}. Antecedente de ejecución contractual, no impedimento.")})
    return {"ruc": ruc, "razon_social": (exp.get("sunat") or {}).get("razon_social"),
            "estado": (exp.get("sunat") or {}).get("estado"), "condicion": (exp.get("sunat") or {}).get("condicion"),
            "es_apto_contratar": None, "es_habilitado": None,
            "n_sanciones": len(sanciones), "n_sanciones_vigentes": clas["n_vigentes"], "n_sanciones_historicas": clas["n_historicas"],
            "n_inhabilitaciones_judiciales": 0, "n_inhabilitaciones_administrativas": 0,
            "n_penalidades": exp.get("penalidades", {}).get("n") or 0, "n_medidas_cautelares": 0,
            "sanciones": sanciones[:10], "sanciones_detalle": clas["detalle"][:10], "penalidades": penalidades,
            "fecha_referencia_vigencia": str(fecha_ref) if fecha_ref else None, "senales": senales,
            "fuente_url": f"https://apps.oece.gob.pe/perfilprov-ui/ficha/{ruc}", "_source": "osce_sancionados_vigia"}


def query_expediente_proveedor(ruc: str, tool_context: ToolContext, entidad_ruc: str | None = None,
                               ocid: str | None = None) -> dict:
    """Expediente del proveedor ganador desde la base de Vigía: SUNAT (RUC 20), RNP, sanciones, penalidades, historial
    de buenas pro y banderas. Deja el perfil SUNAT y el del OECE en el state con las claves de siempre.

    Args:
        ruc: RUC del proveedor.
        entidad_ruc: RUC de la entidad contratante (para «con esta entidad»).
        ocid: el proceso (para sus banderas).
    """
    state = tool_context.state
    ruc = (ruc or "").strip().replace("PE-RUC-", "")
    if not (len(ruc) == 11 and ruc.isdigit()):
        # Un consorcio figura en el OCDS con su código del SEACE (p. ej. 1816604), no con un RUC: sus integrantes
        # están en conosce_consorcios.
        return _expediente_consorcio(ruc, tool_context, entidad_ruc, ocid)
    from tools.sunat import _fecha_buena_pro_state
    try:
        exp = expediente_proveedor_bd(ruc, entidad_ruc, ocid, _fecha_buena_pro_state(state))
    except Exception as e:  # noqa: BLE001 — sin base: el pipeline sigue con las consultas en vivo
        return {"error": f"base no disponible: {str(e)[:160]}", "ruc": ruc}
    # Los nombres en claro quedan sólo en `_nombres_tapar` (no se persiste): con ellos fase_dictamen tapa el texto.
    crudos = exp.pop("_nombres_crudos", [])
    if es_persona_natural(ruc) and (exp.get("sunat") or {}).get("razon_social"):
        crudos.append(exp["sunat"]["razon_social"])
    state["_nombres_tapar"] = sorted({*state.get("_nombres_tapar", []), *crudos})
    state["expediente_proveedor"] = exp
    state["expediente_resumen"] = resumen_para_agentes(exp)
    # Sólo cuenta como «en el padrón» si trae el estado o la fecha de inicio (una fila de `empresas` vacía, sólo con el
    # RNP, no es un perfil). Lo que no está en la base no se busca afuera: una persona natural lleva su propio perfil.
    s_ = exp.get("sunat") or {}
    sunat_ok = bool(s_.get("estado") or s_.get("fecha_inicio_actividades"))
    if sunat_ok:
        perfil = _perfil_sunat(ruc, exp)
        state.setdefault("sunat_profiles", {})[ruc] = perfil
        state["sunat_decolecta"] = perfil
    elif exp.get("persona_natural"):
        state["sunat_decolecta"] = _perfil_persona(ruc, exp)
    state.setdefault("oece_perfiles", {})[ruc] = oece = _perfil_oece(ruc, exp, state)
    oece["senales"] = [*oece["senales"], *senales_de_persona(ruc, exp)]
    h = exp["historial"]
    return {"ruc": ruc, "sunat_en_base": sunat_ok, "rnp": len(exp["rnp"]), "sanciones": len(exp["sanciones"]),
            "penalidades": exp["penalidades"].get("n"), "procesos": h["procesos"], "monto": h["monto"],
            "con_esta_entidad": h["con_esta_entidad"], "banderas": len(exp["banderas"]), "senales": oece["senales"]}


_MAX_INTEGRANTES = 5


def integrantes_consorcio(codigo: str, conn=None) -> list[dict]:
    propia = conn is None
    conn = conn or _pg()
    try:
        return _filas(conn.cursor(), """SELECT DISTINCT ruc_miembro AS ruc, max(consorcio) OVER () AS consorcio, miembro AS nombre
                                          FROM conosce_consorcios WHERE ruc_consorcio = %s""", (codigo,))
    finally:
        if propia:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


def _expediente_consorcio(codigo: str, tool_context: ToolContext, entidad_ruc: str | None, ocid: str | None) -> dict:
    """El expediente de un consorcio: el de cada integrante (hasta 5), y sus señales juntas (una sanción de un
    consorciado pesa sobre el consorcio)."""
    state = tool_context.state
    if not codigo:
        return {"found": False, "ruc": codigo, "razon": "sin ganador"}
    from tools.sunat import _fecha_buena_pro_state
    try:
        miembros = integrantes_consorcio(codigo)
        miembros = [m for m in miembros if m.get("ruc") and len(m["ruc"]) == 11 and m["ruc"].isdigit()][:_MAX_INTEGRANTES]
        if not miembros:
            return {"found": False, "ruc": codigo, "razon": "RUC sin formato peruano y sin integrantes conocidos"}
        ref = _fecha_buena_pro_state(state)
        integrantes = [expediente_proveedor_bd(m["ruc"], entidad_ruc, ocid, ref) for m in miembros]
    except Exception as e:  # noqa: BLE001
        return {"error": f"base no disponible: {str(e)[:160]}", "ruc": codigo}
    crudos: list[str] = []
    senales: list[dict] = []
    for m, e in zip(miembros, integrantes):
        crudos += e.pop("_nombres_crudos", [])
        if es_persona_natural(m["ruc"]):
            crudos.append(m.get("nombre") or "")
        e["nombre"] = tapar_nombre(m.get("nombre")) if es_persona_natural(m["ruc"]) else m.get("nombre")
        # El perfil SUNAT de cada consorciado, con la fecha de inicio efectiva: lo leen las reglas de RUC nuevo y de
        # giro (ganadores_evaluables), que evalúan a cada integrante.
        s_ = e.get("sunat") or {}
        if s_.get("estado") or s_.get("fecha_inicio_actividades"):
            state.setdefault("sunat_profiles", {})[m["ruc"]] = _perfil_sunat(m["ruc"], e)
        for sn in _perfil_oece(m["ruc"], e, state)["senales"]:
            _id = "" if es_persona_natural(m["ruc"]) else f" (RUC {m['ruc']})"
            senales.append({**sn, "evidencia": f"Integrante {e['nombre']}{_id}: {sn.get('evidencia', '')}"[:600]})
    exp = {"ruc": codigo, "consorcio": True, "nombre": miembros[0].get("consorcio"), "persona_natural": False,
           "fuente": "base de Vigía", "integrantes": integrantes}
    state["_nombres_tapar"] = sorted({*state.get("_nombres_tapar", []), *[c for c in crudos if c]})
    state["expediente_proveedor"] = exp
    state["expediente_resumen"] = resumen_para_agentes(exp)
    # El perfil del consorcio es el de sus integrantes: sin esto, el «perfil SUNAT» que recibían los agentes era un
    # aviso de «RUC sin formato peruano, proveedor no domiciliado» (47 de 105 contratos; 2 dictámenes lo publicaron).
    state["sunat_decolecta"] = {
        "consorcio": True, "nombre": exp.get("nombre"), "_source": "padron_sunat_vigia",
        "nota": "El ganador es un consorcio: no tiene RUC propio. Su perfil es el de cada integrante. No es un proveedor "
                "no domiciliado.",
        "integrantes": [({**_perfil_sunat(m["ruc"], e), "razon_social": e.get("nombre")}
                         if (e.get("sunat") or {}).get("estado") or (e.get("sunat") or {}).get("fecha_inicio_actividades")
                         else {"nombre": e.get("nombre"), "tipo": "PERSONA NATURAL" if e.get("persona_natural") else None})
                        for m, e in zip(miembros, integrantes)]}
    for it in state["sunat_decolecta"]["integrantes"]:
        if str(it.get("ruc") or "").startswith("10"):
            it.pop("ruc", None)
    state.setdefault("oece_perfiles", {})[codigo] = {"ruc": codigo, "senales": senales, "_source": "osce_sancionados_vigia",
                                                     "n_sanciones": sum(len(e.get("sanciones") or []) for e in integrantes)}
    return {"ruc": codigo, "consorcio": True, "integrantes": len(integrantes), "sunat_en_base": False,
            "procesos": [e["historial"]["procesos"] for e in integrantes], "senales": senales}


def _soles(x) -> str:
    x = float(x or 0)
    return f"S/ {x / 1e6:,.2f} millones" if x >= 1e6 else f"S/ {x:,.2f}"


_ROL = {"REPRESENTANTE_LEGAL": "representante legal", "SOCIO_ACCIONISTA_TITULAR": "socio",
        "ORGANO_ADMINISTRACION": "órgano de administración"}


def ficha_md(exp: dict | None) -> str:
    """Los hechos del expediente como un bloque de markdown, para la sección «Antecedentes del proveedor»: lo escribe el
    código, no el modelo (las cifras salen de la base tal cual)."""
    if not exp:
        return ""
    if exp.get("consorcio"):
        partes = [f"**Lo que dicen los registros** (base de Vigía: padrón SUNAT, RNP, OECE y CONOSCE) del "
                  f"{exp.get('nombre') or 'consorcio'}, con {len(exp.get('integrantes') or [])} integrante(s):", ""]
        for e in exp.get("integrantes") or []:
            cuerpo = ficha_md({**e, "consorcio": False}).split("\n")[2:]  # sin su propio título
            partes.append(f"**{e.get('nombre') or 'Integrante'}**"
                          + ("" if e.get("persona_natural") or es_persona_natural(e.get("ruc")) else f" (RUC {e.get('ruc')})"))
            partes += [ln for ln in cuerpo if ln.strip()] + [""]
        return "\n".join(partes)
    lineas = ["**Lo que dicen los registros** (base de Vigía: padrón SUNAT, RNP, OECE y CONOSCE)", ""]
    s = exp.get("sunat")
    if s and exp.get("persona_natural") and not (s.get("estado") or s.get("fecha_inicio_actividades")):
        s = None
    if s:
        edad = s.get("edad_dias_al_contratar")
        anos = f" ({edad // 365} años al contratar)" if isinstance(edad, int) and edad >= 365 else (
            f" ({edad} días al contratar)" if isinstance(edad, int) else "")
        partes = [x for x in (s.get("estado"), s.get("condicion")) if x]
        lineas.append(f"- **SUNAT:** {', '.join(partes) or 'el padrón de Vigía no trae su estado'}"
                      + (f"; inicio de actividades {s['fecha_inicio_actividades']}{anos}" if s.get("fecha_inicio_actividades") else "")
                      + (f"; actividad: {s['actividad'].strip().rstrip('.')}." if s.get("actividad") else "."))
        if s.get("fecha_inicio_dudosa"):
            lineas.append(f"- **Antigüedad:** {s['fecha_inicio_dudosa']}")
    elif exp.get("persona_natural"):
        lineas.append("- **Tipo de proveedor:** persona natural (su estado tributario no figura en el padrón de empresas).")
    for x in (exp.get("postores_de_relleno") or [])[:3]:
        lineas.append(f"- **Postor que lo acompaña:** {x.get('acompanante')} se presentó en {x.get('juntos')} procesos que ganó este "
                      f"proveedor y ganó {x.get('gano')} de sus {x.get('postulo')} postulaciones"
                      + (", y comparten socio o representante." if x.get("vinculo") else "."))
    for x in [y for y in exp.get("patrones") or [] if y.get("alcance") == "entidad"][:3]:
        lineas.append(f"- **Patrón de la entidad:** la señal «{_senal(x.get('regla'))}» está en {x.get('casos')} de sus "
                      f"{x.get('leidos')} contratos leídos ({round((x.get('tasa') or 0) * 100)} %; en el país, {round((x.get('tasa_pais') or 0) * 100)} %).")
    for x in [y for y in exp.get("patrones") or [] if y.get("alcance") == "proveedor"][:3]:
        lineas.append(f"- **Patrón del proveedor:** la señal «{_senal(x.get('regla'))}» se repite en {x.get('casos')} de sus "
                      f"contratos leídos, en {x.get('entidades')} entidades.")
    p = exp.get("persona") or {}
    if p.get("ordenes"):
        misma_p = p.get("con_esta_entidad") or {}
        lineas.append(f"- **Órdenes con el Estado:** {p['ordenes']} por {_soles(p['monto'])} en {p['entidades']} entidad(es), "
                      f"de {p.get('primera')} a {p.get('ultima')}"
                      + (f"; con esta entidad, {misma_p['ordenes']} por {_soles(misma_p['monto'])} en {misma_p['meses']} mes(es)."
                         if misma_p.get("ordenes") else "; ninguna con esta entidad."))
    if p.get("senales"):
        con = [s["que"] for s in p["senales"] if s.get("con_esta_entidad")]
        otras = [s["que"] for s in p["senales"] if not s.get("con_esta_entidad")]
        if con:
            lineas.append("- **Señales con esta entidad** (declaraciones juradas, planilla, JNE, ONPE, visitas): "
                          + "; ".join(con) + ".")
        if otras:
            lineas.append("- **Señales con otras entidades:** " + "; ".join(otras[:6])
                          + (f" y {len(otras) - 6} más" if len(otras) > 6 else "") + ".")
    rnp = exp.get("rnp") or []
    if rnp:
        por_rol: dict[str, list[str]] = {}
        for r in rnp:
            por_rol.setdefault(_ROL.get(r["rol"], (r["rol"] or "").lower().replace("_", " ")), []).append(
                r["nombre"] + (f" (desde {r['desde']})" if r.get("desde") else ""))
        lineas.append("- **RNP:** " + "; ".join(f"{rol}: {', '.join(v[:4])}" + (f" y {len(v) - 4} más" if len(v) > 4 else "")
                                              for rol, v in por_rol.items()) + ".")
    sanc = exp.get("sanciones") or []
    if sanc:
        det = "; ".join(f"{x.get('tipo') or 'sanción'} desde {x.get('fecha_desde') or '?'}"
                        + (f" hasta {x['fecha_hasta']}" if x.get("fecha_hasta") else "")
                        + (f", {str(x['estado']).lower()} hoy" if x.get("estado") else "") for x in sanc[:3])
        lineas.append(f"- **Sanciones del OECE:** {len(sanc)} registrada(s): {det}"
                      + (f" y {len(sanc) - 3} más" if len(sanc) > 3 else "") + ".")
    else:
        lineas.append("- **Sanciones del OECE:** ninguna registrada.")
    pen = exp.get("penalidades") or {}
    if pen.get("n"):
        lineas.append(f"- **Penalidades:** {pen['n']} en {pen.get('entidades') or 0} entidad(es), por {_soles(pen.get('monto'))}, "
                      f"entre {pen.get('desde')} y {pen.get('hasta')}.")
    h = exp.get("historial") or {}
    if h.get("procesos"):
        misma = h.get("con_esta_entidad") or {}
        princ = ", ".join(f"{e['entidad']} ({e['procesos']})" for e in (h.get("principales_entidades") or [])[:3])
        lineas.append(f"- **Contratos con el Estado (CONOSCE):** {h['procesos']} buenas pro por {_soles(h['monto'])} en "
                      f"{h['entidades']} entidad(es), de {h.get('primera')} a {h.get('ultima')}"
                      + (f"; {h['en_consorcio']} en consorcio" if h.get("en_consorcio") else "")
                      + (f"; con esta entidad, {misma['procesos']} por {_soles(misma['monto'])}" if misma.get("procesos") else
                         "; ninguna antes con esta entidad")
                      + (f". Principales: {princ}." if princ else "."))
    else:
        lineas.append("- **Contratos con el Estado (CONOSCE):** ninguna buena pro registrada.")
    ban = exp.get("banderas") or []
    if ban:
        por_tipo: dict[str, dict[str, int]] = {}
        for b in ban:
            por_tipo.setdefault(b["tipo"], {})[b["severidad"]] = b["n"]
        orden = sorted(por_tipo.items(), key=lambda kv: (-kv[1].get("alta", 0), -sum(kv[1].values())))
        lineas.append("- **Banderas de Vigía del proveedor:** " + "; ".join(
            f"{t.replace('_', ' ')} ({', '.join(f'{n} {sev}' for sev, n in sorted(sv.items(), key=lambda x: ['alta', 'media', 'baja'].index(x[0]) if x[0] in ('alta', 'media', 'baja') else 3))})"
            for t, sv in orden[:8]) + ".")
    return "\n".join(lineas) + "\n"


def insertar_ficha(md: str, exp: dict | None) -> str:
    """Pone `ficha_md` al comienzo de la sección «Antecedentes del proveedor» (o antes de «Personas clave», o al final)."""
    bloque = ficha_md(exp)
    if not bloque or not md or "Lo que dicen los registros" in md:
        return md
    import re as _re
    m = _re.search(r"^#{1,4}[^\n]*Antecedentes del proveedor[^\n]*\n", md, _re.MULTILINE)
    if m:
        return md[:m.end()] + "\n" + bloque + "\n" + md[m.end():]
    m = _re.search(r"^#{1,4}[^\n]*Personas clave[^\n]*\n", md, _re.MULTILINE)
    if m:
        return md[:m.start()] + "## Antecedentes del proveedor\n\n" + bloque + "\n" + md[m.start():]
    return md.rstrip() + "\n\n## Antecedentes del proveedor\n\n" + bloque


query_expediente_proveedor_tool = FunctionTool(query_expediente_proveedor)
