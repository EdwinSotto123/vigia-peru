"""Expediente del proveedor desde la base de Vigía: lo que el agente antes buscaba afuera (SUNAT por decolecta, el
historial por la web) y lo que ya calculó Vigía (banderas). Plan 2026-11-04, parte 1.

  · SUNAT: `empresa_resumen` (la misma ficha de /empresa/<RUC>), `empresas` y `sunat_padron` (2,37 M de RUC 20). Un RUC 10
    no está en el padrón: para ése sigue decolecta (pipeline_phases.fase_proveedor).
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

        # 5. Banderas de Vigía: las del proveedor (por tipo) y las de este proceso.
        out["banderas"] = [_limpio(b) for b in _filas(cur, """
            SELECT tipo, severidad, count(*)::int AS n, count(DISTINCT ocid)::int AS procesos, max(fecha) AS ultima
              FROM cruces_proveedor WHERE ruc_empresa = %s GROUP BY 1, 2
             ORDER BY CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, 3 DESC""", (ruc,))]
        if ocid:
            corto = str(ocid).split("-")[-1]
            out["banderas_de_este_proceso"] = sorted({r["tipo"] for r in _filas(
                cur, "SELECT DISTINCT tipo FROM cruces_proveedor WHERE ruc_empresa = %s AND ocid = %s", (ruc, corto))})
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
            "fecha_inicio_actividades": s.get("fecha_inicio_actividades"), "edad_dias": s.get("edad_dias_al_contratar"),
            "_source": "padron_sunat_vigia"}


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
    if len(ruc) != 11 or not ruc.isdigit():
        return {"found": False, "ruc": ruc, "razon": "RUC sin formato peruano"}
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
    # Sólo cuenta como «en el padrón» si trae el estado o la fecha de inicio: una fila de `empresas` vacía (sólo el RNP)
    # no reemplaza a decolecta.
    s_ = exp.get("sunat") or {}
    sunat_ok = bool(s_.get("estado") or s_.get("fecha_inicio_actividades"))
    if sunat_ok:
        perfil = _perfil_sunat(ruc, exp)
        state.setdefault("sunat_profiles", {})[ruc] = perfil
        state["sunat_decolecta"] = perfil
    state.setdefault("oece_perfiles", {})[ruc] = oece = _perfil_oece(ruc, exp, state)
    h = exp["historial"]
    return {"ruc": ruc, "sunat_en_base": sunat_ok, "rnp": len(exp["rnp"]), "sanciones": len(exp["sanciones"]),
            "penalidades": exp["penalidades"].get("n"), "procesos": h["procesos"], "monto": h["monto"],
            "con_esta_entidad": h["con_esta_entidad"], "banderas": len(exp["banderas"]), "senales": oece["senales"]}


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
    lineas = ["**Lo que dicen los registros** (base de Vigía: padrón SUNAT, RNP, OECE y CONOSCE)", ""]
    s = exp.get("sunat")
    if s:
        edad = s.get("edad_dias_al_contratar")
        anos = f" ({edad // 365} años al contratar)" if isinstance(edad, int) and edad >= 365 else (
            f" ({edad} días al contratar)" if isinstance(edad, int) else "")
        partes = [x for x in (s.get("estado"), s.get("condicion")) if x]
        lineas.append(f"- **SUNAT:** {', '.join(partes) or 'el padrón de Vigía no trae su estado'}"
                      + (f"; inicio de actividades {s['fecha_inicio_actividades']}{anos}" if s.get("fecha_inicio_actividades") else "")
                      + (f"; actividad: {s['actividad'].strip().rstrip('.')}." if s.get("actividad") else "."))
    elif exp.get("persona_natural"):
        lineas.append("- **SUNAT:** persona natural con negocio; no está en el padrón de empresas de Vigía.")
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
