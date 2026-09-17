"""compliance_rules._rules_network — reglas de red/relaciones: concentración, firmantes, testaferros."""

from tools._core import *  # noqa: F401,F403
from tools.compliance_rules._base import _as_tool, _ganador_ruc, _norma_state, _perfil_reglas, _regla_omitida  # noqa: F401


def check_concentracion_entidad_rule(ocid: str, tool_context: ToolContext,
                                     reglas_activas: frozenset[str] | None = None,
                                     topes_uit: dict | None = None) -> dict:
    """Detecta si el proveedor adjudicado concentra contratos con la entidad
    contratante actual. Cuenta en `convocatorias` (BD propia: procesos ingestados
    del SEACE), NO en lo que `web_research` (LLM con grounding) "dijo haber visto"
    (hallazgo #8). Dispara con ≥3 contratos previos con la misma entidad Y ≥40 % de
    su historial en la BD; el alcance (solo procesos en la base de Vigía) queda
    explícito en la evidencia.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia, ocids_misma_entidad.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("concentracion_entidad", reglas)
    if om:
        return om
    state = tool_context.state
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT c.entidad_ruc, (SELECT nombre FROM entidades e WHERE e.ruc=c.entidad_ruc) "
            "FROM convocatorias c WHERE c.ocid=%s", (ocid,))
        row = cur.fetchone()
        entidad_ruc = (row and row[0]) or None
        entidad_nombre = (row and row[1]) or ""
        prov_ruc, prov_nombre = _ganador_ruc(ocid, state, cur)
        if not prov_ruc:
            return {"regla": "concentracion_entidad", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin proveedor adjudicado identificable"}
        cur.execute(
            """SELECT DISTINCT c.ocid, c.entidad_ruc, c.fecha_convocatoria, c.cuantia_referencial
                 FROM convocatorias c
                 LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                 LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                WHERE c.ocid<>%s AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)""",
            (prov_ruc, ocid, prov_ruc))
        rows = cur.fetchall()
    finally:
        conn.close()

    n_total = len(rows)
    misma = [r for r in rows if entidad_ruc and r[1] == entidad_ruc]
    n_misma = len(misma)
    pct = (n_misma / n_total * 100) if n_total else 0.0
    result = {
        "regla": "concentracion_entidad",
        "proveedor_ruc": prov_ruc,
        "n_contratos_misma_entidad": n_misma,
        "n_total_contratos_en_base": n_total,
        "pct_concentracion": round(pct, 1),
        "ocids_misma_entidad": [r[0] for r in misma][:10],
        "estado": "hallado" if n_total else "sin_dato",
        "_nota_alcance": "Conteos sobre procesos ingestados en la base de Vigía, no el universo SEACE.",
        "triggered": False,
    }
    if n_misma >= 3 and pct >= 40:
        result.update({
            "triggered": True,
            "severidad": "media",
            "evidencia": (
                f"{prov_nombre or 'El proveedor'} (RUC {prov_ruc}) registra {n_misma} procesos previos "
                f"con {entidad_nombre or 'esta entidad'} sobre {n_total} procesos suyos en la base de "
                f"Vigía ({pct:.0f}%). Procesos: {', '.join(result['ocids_misma_entidad'][:5])}. "
                f"Patrón de concentración con un solo comprador (alcance: base propia, no universo SEACE)."
            ),
            "norma": "Heurística — concentración cliente público debilita la competencia natural",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        tool_context.state.setdefault("pending_flags", []).append(result)
    return result

def check_recurrencia_firmante_rule(ocid: str, tool_context: ToolContext,
                                    reglas_activas: frozenset[str] | None = None,
                                    topes_uit: dict | None = None) -> dict:
    """Detecta si algún firmante de la entidad coincide con personas vinculadas
    al proveedor (gerente, socios). Usa el cruce_firmantes_ganador que pobló
    person_network_agent, pero SOLO promueve a bandera los cruces con
    `fuente_url` verificable (http) y `confianza_match == 'alta'` (hallazgo #8):
    el resto queda como `cruces_no_verificables` (no bandera).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia, cruces_no_verificables.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("firmante_vinculado_ganador", reglas)
    if om:
        return om
    person = _safe_parse_json(tool_context.state.get("person_network")) or {}
    cruces = person.get("cruce_firmantes_ganador") or []
    relevantes, no_verificables = [], []
    for c in cruces:
        if not isinstance(c, dict):
            continue
        if not c.get("tipo_relacion") or c.get("tipo_relacion") == "sin_relacion":
            continue
        if c.get("severidad") not in ("alta", "media"):
            continue
        fuente = str(c.get("fuente_url") or "").strip()
        conf = str(c.get("confianza_match") or c.get("confianza") or "").strip().lower()
        if fuente.startswith("http") and conf == "alta":
            relevantes.append(c)
        else:
            falta = []
            if not fuente.startswith("http"):
                falta.append("fuente_url")
            if conf != "alta":
                falta.append(f"confianza_match={conf or 'ausente'}")
            no_verificables.append({**c, "_no_verificable_por": falta})
    result = {
        "regla": "firmante_vinculado_ganador",
        "n_cruces_detectados": len(relevantes),
        "n_cruces_no_verificables": len(no_verificables),
        "detalle": relevantes[:5],
        "cruces_no_verificables": no_verificables[:5],
        "estado": "hallado" if relevantes else ("no_verificable" if no_verificables else "sin_dato"),
        "triggered": len(relevantes) > 0,
    }
    if relevantes:
        primero = relevantes[0]
        result.update({
            "severidad": primero.get("severidad", "media"),
            "evidencia": (
                f"Posible vínculo entre firmante '{primero.get('firmante')}' "
                f"({primero.get('cargo_firmante')}) y persona del proveedor "
                f"'{primero.get('persona_proveedor')}': "
                f"{primero.get('evidencia', primero.get('tipo_relacion'))} "
                f"(confianza alta, fuente: {primero.get('fuente_url')})"
            ),
            "norma": "Heurística — " + _norma_state(tool_context.state)["impedimentos"] + " / Ley 30057",
            "fuente_url": primero.get("fuente_url"),
        })
        tool_context.state.setdefault("pending_flags", []).append(result)
    return result

def check_testaferro_multi_ruc_rule(ocid: str, tool_context: ToolContext,
                                    reglas_activas: frozenset[str] | None = None,
                                    topes_uit: dict | None = None) -> dict:
    """C9 — Testaferro multi-RUC: detecta cuando el representante legal / socio /
    titular del ganador aparece como representante de ≥3 empresas distintas que
    también ganaron contratos del Estado. Patrón típico de testaferro.

    Fuente: cruza datos de `query_rnp_empresa` + alertas históricas en BD.
    Norma: Art. 50 TUO Ley 30225 (impedimentos) + Art. 11 inc. m (consorcio sin declarar).
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("testaferro_multi_ruc", reglas)
    if om:
        return om
    state = tool_context.state
    # `rnp_empresa_proveedor` no la escribe nadie: el RNP del ganador vive en
    # `person_network_context.rnp_proveedor` (personas.py) — informe 1225266 P6. Se
    # complementa con los DNI del perfil OECE del ganador (`oece_perfiles[ruc]`).
    pnc = state.get("person_network_context") or {}
    rnp_empresa = (state.get("rnp_empresa_proveedor") or pnc.get("rnp_proveedor")
                   or (pnc.get("rnp_empresa") if isinstance(pnc.get("rnp_empresa"), dict) else None) or {})
    socios = rnp_empresa.get("socios") or []
    representantes = rnp_empresa.get("representantes_legales") or []
    organos = rnp_empresa.get("organos_administracion") or []

    # Extraer todos los DNI/RUC de personas vinculadas al proveedor
    personas = set()
    for p in socios + representantes + organos:
        if isinstance(p, dict):
            doc = (p.get("numero_documento") or p.get("dni") or "").strip()
            if doc:
                personas.add(doc)
    g_ruc, _ = _ganador_ruc(ocid, state)
    perfil_oece = (state.get("oece_perfiles") or {}).get(g_ruc) or {} if g_ruc else {}
    for k in ("socios_dni", "representantes_dni", "organos_dni"):
        for d in (perfil_oece.get(k) or []):
            d = str(d).strip()
            if d.isdigit() and len(d) == 8:
                personas.add(d)

    if not personas:
        return {"regla": "testaferro_multi_ruc", "triggered": False,
                "motivo": "sin personas vinculadas en RNP del proveedor"}

    conn = _pg()
    try:
        cur = conn.cursor()
        # Por cada persona, contar cuántas empresas DISTINTAS donde aparece y han ganado contratos del Estado
        triggered_list = []
        for doc in personas:
            cur.execute(
                """SELECT COUNT(DISTINCT r.ruc_empresa) AS n_empresas,
                          ARRAY_AGG(DISTINCT r.ruc_empresa) AS rucs
                     FROM rnp_conformacion_juridica r
                     JOIN alertas a ON a.proveedor_ruc = r.ruc_empresa
                    WHERE r.numero_documento = %s
                      AND a.analizado_en >= NOW() - INTERVAL '12 months'""",
                (doc,),
            )
            row = cur.fetchone()
            if row and (row[0] or 0) >= 3:
                triggered_list.append({
                    "numero_documento": doc,
                    "n_empresas_ganadoras": int(row[0]),
                    "rucs_empresas": (row[1] or [])[:10],
                })

        result = {
            "regla": "testaferro_multi_ruc",
            "n_personas_evaluadas": len(personas),
            "n_triggered": len(triggered_list),
            "detalle": triggered_list,
            "triggered": len(triggered_list) > 0,
        }
        if triggered_list:
            principal = triggered_list[0]
            result.update({
                "severidad": "alta",
                "evidencia": (
                    f"Persona con documento {principal['numero_documento']} figura como representante "
                    f"de {principal['n_empresas_ganadoras']} empresas distintas que ganaron "
                    f"contratos del Estado en los últimos 12 meses. Patrón típico de testaferro multi-RUC."
                ),
                "norma": "Art. 50 TUO Ley 30225 — Impedimentos / Art. 11 inc. m (consorcio sin declarar)",
                "fuente_url": None,
            })
            state.setdefault("pending_flags", []).append(result)
        return result
    except Exception as e:
        return {"regla": "testaferro_multi_ruc", "triggered": False, "error": str(e)[:200]}
    finally:
        conn.close()


def check_personal_clave_vinculado_rule(ocid: str, tool_context: ToolContext,
                                        reglas_activas: frozenset[str] | None = None,
                                        topes_uit: dict | None = None) -> dict:
    """SERVICIOS — personal clave del TDR/propuesta (bloque `servicio.personal_clave[]`
    del parser) que coincide por nombre normalizado con firmantes/comité de la
    entidad o con funcionarios designados (entity_personnel). Si el bloque no trae
    nombres (solo perfiles exigidos) → `estado: sin_dato`.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, coincidencias[], severidad, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("personal_clave_vinculado", reglas)
    if om:
        return om
    state = tool_context.state
    raw = state.get("parser_raw_consolidated") or {}
    servicio = (raw.get("servicio") if isinstance(raw, dict) else None) or {}
    personal = [p for p in (servicio.get("personal_clave") or []) if isinstance(p, dict)]
    con_nombre = [(p, _normalize_persona(p.get("nombre") or p.get("nombre_completo") or ""))
                  for p in personal]
    con_nombre = [(p, n) for p, n in con_nombre if len(n.split()) >= 2]
    if not con_nombre:
        return {"regla": "personal_clave_vinculado", "triggered": False, "estado": "sin_dato",
                "n_personal_clave": len(personal),
                "motivo": "el bloque de personal clave no trae nombres (solo perfiles exigidos)"}

    doc = _safe_parse_json(state.get("document_analysis")) or {}
    candidatos: list[tuple[str, str, str]] = []   # (nombre_norm, rol, origen)
    for k in ("firmantes", "firmantes_consolidados", "comite_evaluacion"):
        for f in (doc.get(k) or (raw.get(k) if isinstance(raw, dict) else None) or []):
            if isinstance(f, dict):
                n = _normalize_persona(f.get("nombre") or f.get("nombre_completo") or "")
                if n:
                    candidatos.append((n, f.get("cargo") or k, "documento"))
    ep = _safe_parse_json(state.get("entity_personnel")) or {}
    for f in (ep.get("funcionarios_designados") or ep.get("funcionarios") or []):
        if isinstance(f, dict):
            n = _normalize_persona(f.get("nombre") or f.get("nombre_completo") or "")
            if n and (f.get("fuente_url") or f.get("fuente") or f.get("url")):
                candidatos.append((n, f.get("cargo") or "funcionario", "entity_personnel"))

    coincidencias = []
    for p, n in con_nombre:
        toks = set(n.split())
        for cn, rol, origen in candidatos:
            ctoks = set(cn.split())
            # Coincidencia exacta o de ≥3 tokens (dos apellidos + nombre): nunca por un apellido solo.
            if n == cn or len(toks & ctoks) >= 3:
                coincidencias.append({"personal_clave": p.get("nombre") or p.get("nombre_completo"),
                                      "cargo_propuesto": p.get("cargo"), "coincide_con": cn,
                                      "rol_en_entidad": rol, "origen": origen})
    result = {"regla": "personal_clave_vinculado", "n_personal_clave": len(personal),
              "coincidencias": coincidencias[:5], "estado": "hallado" if coincidencias else "sin_dato",
              "triggered": bool(coincidencias)}
    if coincidencias:
        c0 = coincidencias[0]
        result.update({
            "severidad": "alta",
            "evidencia": (f"El personal clave propuesto '{c0['personal_clave']}' ({c0['cargo_propuesto']}) "
                          f"coincide con '{c0['coincide_con']}' ({c0['rol_en_entidad']}) de la entidad "
                          f"contratante según {c0['origen']}."),
            "norma": "Art. 11 TUO Ley 30225 — impedimentos; Ley 27588 — incompatibilidades de funcionarios",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result


def check_directa_recurrente_rule(ocid: str, tool_context: ToolContext,
                                  reglas_activas: frozenset[str] | None = None,
                                  topes_uit: dict | None = None) -> dict:
    """OTROS — proveedor con ≥ 3 contrataciones directas (cualquier entidad) en los 12
    meses previos a la convocatoria, contadas en `convocatorias` (BD propia). MEDIA.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, n_directas_12m, procesos[], severidad, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("directa_recurrente", reglas)
    if om:
        return om
    state = tool_context.state
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT fecha_convocatoria, tipo_proceso FROM convocatorias WHERE ocid=%s", (ocid,))
        row = cur.fetchone()
        fecha = (row and row[0]) or None
        prov_ruc, prov_nombre = _ganador_ruc(ocid, state, cur)
        if not prov_ruc:
            return {"regla": "directa_recurrente", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin proveedor adjudicado identificable"}
        if fecha:
            cur.execute(
                """SELECT DISTINCT c.ocid, c.entidad_ruc, c.fecha_convocatoria, c.cuantia_referencial
                     FROM convocatorias c
                     LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                     LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                    WHERE c.ocid<>%s AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)
                      AND UPPER(COALESCE(c.tipo_proceso,'')) LIKE '%%DIRECTA%%'
                      AND c.fecha_convocatoria BETWEEN %s::date - INTERVAL '12 months' AND %s::date""",
                (prov_ruc, ocid, prov_ruc, fecha, fecha))
        else:
            cur.execute(
                """SELECT DISTINCT c.ocid, c.entidad_ruc, c.fecha_convocatoria, c.cuantia_referencial
                     FROM convocatorias c
                     LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                     LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                    WHERE c.ocid<>%s AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)
                      AND UPPER(COALESCE(c.tipo_proceso,'')) LIKE '%%DIRECTA%%'
                      AND c.fecha_convocatoria >= NOW() - INTERVAL '12 months'""",
                (prov_ruc, ocid, prov_ruc))
        rows = cur.fetchall()
    finally:
        conn.close()
    procesos = [{"ocid": r[0], "entidad_ruc": r[1], "fecha": str(r[2])[:10], "cuantia": float(r[3] or 0)}
                for r in rows]
    result = {"regla": "directa_recurrente", "proveedor_ruc": prov_ruc, "n_directas_12m": len(procesos),
              "procesos": procesos[:10], "estado": "hallado" if procesos else "sin_dato",
              "_nota_alcance": "Conteos sobre procesos ingestados en la base de Vigía.", "triggered": False}
    if len(procesos) >= 3:
        result.update({
            "triggered": True, "severidad": "media",
            "evidencia": (f"{prov_nombre or 'El proveedor'} (RUC {prov_ruc}) acumula {len(procesos)} contrataciones "
                          f"directas en los 12 meses previos ({', '.join(p['ocid'] for p in procesos[:4])}), "
                          f"además de la presente. Recurrencia en procedimientos no competitivos."),
            "norma": "Art. 27 TUO Ley 30225 / Art. 55 Ley 32069 — carácter excepcional de la contratación directa",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result

def check_lobby_visits_rule(ocid: str, tool_context: ToolContext,
                            reglas_activas: frozenset[str] | None = None,
                            topes_uit: dict | None = None) -> dict:
    """Evalúa lobby pre-convocatoria — socios/representantes del ganador o
    de cualquier postor que visitaron a la ENTIDAD CONTRATANTE en los 180 días
    previos a la fecha de convocatoria.

    Cruza `visitas_entidades` × `rnp_conformacion_juridica` × `convocatorias`.
    Fuente: Registro Único de Visitas (Ley 28024 — Gestión de Intereses).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        dict con triggered, evidencia, visitas[], severidad.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("lobby_visits_pre_convocatoria", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        if not _table_exists(cur, "visitas_entidades"):
            return {"regla": "lobby_visits_pre_convocatoria", "triggered": False,
                    "dataset_no_disponible": True,
                    "hint": "Cargar dataset visitas con backend/scripts/load_visitas_entidades.py"}

        cur.execute(
            """SELECT v.visitante, v.numero_documento, r.tipo_rol,
                      emp.razon_social, emp.ruc,
                      v.funcionario_nombre, v.funcionario_cargo,
                      v.fecha_visita, v.motivo, v.duracion_min,
                      c.fecha_convocatoria, e.nombre AS entidad_nombre,
                      o.ganadora
                 FROM convocatorias c
                 JOIN entidades  e   ON e.ruc = c.entidad_ruc
                 JOIN postores   p   ON p.ocid = c.ocid
                 JOIN ofertas    o   ON o.postor_id = p.id
                 JOIN empresas   emp ON emp.ruc = p.empresa_ruc
                 JOIN rnp_conformacion_juridica r ON r.ruc_empresa = emp.ruc
                 JOIN visitas_entidades v
                      ON v.numero_documento = r.numero_documento
                     AND v.entidad_visitada_norm = UPPER(unaccent(e.nombre))
                     AND c.fecha_convocatoria IS NOT NULL
                     AND v.fecha_visita BETWEEN
                           (c.fecha_convocatoria - INTERVAL '180 days')
                       AND  c.fecha_convocatoria
                WHERE c.ocid = %s
                ORDER BY o.ganadora DESC, v.fecha_visita""",
            (ocid,),
        )
        rows = cur.fetchall()
        visitas = [
            {
                "visitante": r[0], "dni": r[1], "rol_en_empresa": r[2],
                "empresa_postora": r[3], "ruc_empresa": r[4],
                "funcionario_visitado": r[5], "cargo_funcionario": r[6],
                "fecha_visita": r[7].isoformat() if r[7] else None,
                "motivo": r[8], "duracion_min": r[9],
                "fecha_convocatoria": r[10].isoformat() if r[10] else None,
                "entidad_contratante": r[11],
                "empresa_ganadora": bool(r[12]),
            }
            for r in rows
        ]
        ganadoras = [v for v in visitas if v["empresa_ganadora"]]
        result = {
            "regla": "lobby_visits_pre_convocatoria",
            "triggered": bool(visitas),
            "n_visitas_total": len(visitas),
            "n_visitas_de_ganador": len(ganadoras),
            "visitas": visitas[:25],
            "fuente_url": "https://www.gob.pe/registro-visitas",
        }
        if ganadoras:
            v0 = ganadoras[0]
            result.update({
                "severidad": "alta",
                "evidencia": (
                    f"{v0['empresa_postora']} (RUC {v0['ruc_empresa']}) — su "
                    f"{v0['rol_en_empresa']} {v0['visitante']} visitó al funcionario "
                    f"{v0['funcionario_visitado']} ({v0['cargo_funcionario']}) "
                    f"el {v0['fecha_visita']} en {v0['entidad_contratante']}, antes de "
                    f"la convocatoria del {v0['fecha_convocatoria']}. Esta empresa fue "
                    f"declarada ganadora."
                ),
                "norma": "Ley 28024 (Gestión de Intereses) — registro de visitas obligatorio para detectar lobby.",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        elif visitas:
            result["severidad"] = "media"
            result["evidencia"] = (
                f"{len(visitas)} visitas de socios/representantes de POSTORES (no ganador) "
                f"a la entidad contratante en los 180 días previos a la convocatoria."
            )
        return result
    finally:
        conn.close()
check_concentracion_entidad_rule_tool = _as_tool(check_concentracion_entidad_rule)
check_recurrencia_firmante_rule_tool = _as_tool(check_recurrencia_firmante_rule)
check_testaferro_multi_ruc_rule_tool = _as_tool(check_testaferro_multi_ruc_rule)
check_lobby_visits_rule_tool = _as_tool(check_lobby_visits_rule)
check_personal_clave_vinculado_rule_tool = _as_tool(check_personal_clave_vinculado_rule)
check_directa_recurrente_rule_tool = _as_tool(check_directa_recurrente_rule)
