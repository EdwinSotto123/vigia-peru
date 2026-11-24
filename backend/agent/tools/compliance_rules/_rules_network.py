"""compliance_rules._rules_network — reglas de red/relaciones: concentración, firmantes, testaferros."""

from tools._core import *  # noqa: F401,F403
from tools.compliance_rules._base import _as_tool, _fecha_convocatoria_state, _ganador_ocds, _ganador_ruc, _norm_razon_cr, _norma_state, _perfil_reglas, _postores_parser, _regla_omitida, _sin_tildes, _to_date, ganadores_evaluables, ganadores_para_regla  # noqa: F401
from tools.privacidad import tapar_nombre
from tools.fuentes import proceso_oece  # noqa: E402


def check_concentracion_entidad_rule(ocid: str, tool_context: ToolContext,
                                     reglas_activas: frozenset[str] | None = None,
                                     topes_uit: dict | None = None) -> dict:
    """Concentración con la entidad: el ganador (o un integrante del consorcio ganador) tiene ≥ 3 buenas pro con la
    entidad contratante y son ≥ 40 % de su historial, sin contar este proceso.

    Cuenta en el CONOSCE (conosce_adjudicaciones: todas las buenas pro del SEACE, también como consorciado vía
    conosce_consorcios), no en `convocatorias` (sólo los procesos que Vigía ingirió) ni en lo que dijo web_research.
    Prueba de oro 2026-11-04: con la base propia se omitían 4 de 6 (7 de 7 procesos con el Ejército, 1229450; un
    consorciado con 4 de 5 con el Gobierno Regional de Piura, 1230947).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia y el conteo por ganador o consorciado.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("concentracion_entidad", reglas)
    if om:
        return om
    state = tool_context.state
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT c.codigo, c.entidad_ruc::text, (SELECT nombre FROM entidades e WHERE e.ruc = c.entidad_ruc) "
                    "FROM convocatorias c WHERE c.ocid = %s", (ocid,))
        row = cur.fetchone() or (None, None, None)
        codigo, entidad_ruc, entidad_nombre = row[0], (row[1] or "").strip() or None, row[2] or ""
        ganadores = ganadores_evaluables(ocid, state, cur)
        if not ganadores or not entidad_ruc:
            return {"regla": "concentracion_entidad", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin proveedor adjudicado identificable o sin entidad"}
        conteos = []
        for g in ganadores:
            cur.execute(
                """WITH h AS (
                       SELECT a.codigo_convocatoria AS cod, a.entidad_ruc AS ent FROM conosce_adjudicaciones a
                        WHERE a.ruc_proveedor = %s
                       UNION
                       SELECT a.codigo_convocatoria, a.entidad_ruc FROM conosce_consorcios m
                         JOIN conosce_adjudicaciones a ON a.ruc_proveedor = m.ruc_consorcio
                        WHERE m.ruc_miembro = %s)
                   SELECT count(DISTINCT (cod, ent)), count(DISTINCT cod) FILTER (WHERE ent = %s)
                     FROM h WHERE NOT (cod = %s AND ent = %s)""",
                (g["ruc"], g["ruc"], entidad_ruc, codigo or "", entidad_ruc))
            n_total, n_misma = cur.fetchone() or (0, 0)
            n_total, n_misma = int(n_total or 0), int(n_misma or 0)
            conteos.append({**g, "n_total": n_total, "n_misma": n_misma,
                            "pct": round(n_misma / n_total * 100, 1) if n_total else 0.0})
    finally:
        conn.close()

    disparan = [c for c in conteos if c["n_misma"] >= 3 and c["pct"] >= 40]
    principal = max(conteos, key=lambda c: (c["n_misma"] >= 3 and c["pct"] >= 40, c["pct"], c["n_misma"]))
    result = {
        "regla": "concentracion_entidad",
        "proveedor_ruc": principal["ruc"],
        "n_contratos_misma_entidad": principal["n_misma"],
        "n_total_contratos_en_base": principal["n_total"],
        "pct_concentracion": principal["pct"],
        "por_ganador": [{k: c[k] for k in ("ruc", "consorcio", "n_misma", "n_total", "pct")} for c in conteos],
        "estado": "hallado" if any(c["n_total"] for c in conteos) else "sin_dato",
        "_nota_alcance": "Buenas pro del CONOSCE (todo el SEACE), también como integrante de consorcios; sin este proceso.",
        "triggered": False,
    }
    if disparan:
        c = max(disparan, key=lambda x: (x["pct"], x["n_misma"]))
        quien = (f"{c['nombre'] or 'El proveedor'} (RUC {c['ruc']})" if not c.get("consorcio") else
                 f"{c['nombre'] or 'Un integrante'} (RUC {c['ruc']}), integrante de {c['consorcio']},")
        nombre = tapar_nombre(quien) if str(c["ruc"]).startswith("10") else quien
        result.update({
            "triggered": True,
            "ganador_ruc": c["ruc"],
            "severidad": "media",
            "evidencia": (
                f"{nombre} tiene {c['n_misma']} buenas pro con {entidad_nombre or 'esta entidad'} de {c['n_total']} "
                f"en su historial del CONOSCE ({c['pct']:.0f} %), sin contar este proceso. Patrón de concentración con un "
                f"solo comprador público (umbral: 3 o más y 40 % o más)."
            ),
            "norma": "Heurística — concentración cliente público debilita la competencia natural",
            "fuente_url": proceso_oece(ocid),
        })
        tool_context.state.setdefault("pending_flags", []).append(result)
    return result

def _nombre_norm(s) -> str:
    return " ".join(_sin_tildes(str(s or "")).upper().replace(",", " ").split())


def _firmantes_del_ganador(state: dict) -> set[str]:
    """Nombres de los firmantes que el parser atribuye a la empresa ganadora (firman el contrato por ella)."""
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    _ruc, nombre = _ganador_ocds(ocds)
    gan = _norm_razon_cr(nombre or "")
    if not gan:
        return set()
    da = _safe_parse_json(state.get("document_analysis")) or {}
    out = set()
    for f in (da.get("firmantes_consolidados") or da.get("firmantes") or []) if isinstance(da, dict) else []:
        if isinstance(f, dict) and _norm_razon_cr(str(f.get("entidad") or "")) == gan:
            n = _nombre_norm(f.get("nombre_completo") or f.get("nombre"))
            if n:
                out.add(n)
    return out


def _url_plausible(url: str) -> bool:
    """Una URL que puede existir: http(s), con dominio, y si es de un gobierno, del Perú (el modelo escribió
    «e-consultaruc.sunat.gob.cr» en la prueba de oro, 1228871)."""
    m = re.match(r"https?://([^/\s:]+)", url or "", re.I)
    if not m or "." not in m.group(1):
        return False
    host = m.group(1).lower()
    return not (("gob." in host or "sunat" in host or "osce" in host or "seace" in host) and not host.endswith(".pe"))


def _cruce_nombra_al_ganador(c: dict, state: dict) -> bool:
    """¿El cruce nombra a alguien del ganador (una persona, no sólo la razón social) o su RUC? Un firmante con
    cargo público y empresa PROPIA no es un vínculo con el proveedor (1228871: el modelo lo marcó «cargo público
    compartido» con persona_proveedor = la razón social del ganador y el RUC de otra empresa)."""
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    rucs: set[str] = set()
    ruc_g, nombre_g = _ganador_ocds(ocds)
    if ruc_g:
        rucs.add(ruc_g)
    texto = json.dumps([c.get("evidencia"), c.get("descripcion"), c.get("persona_proveedor")], ensure_ascii=False, default=str)
    if any(r and r in texto for r in rucs):
        return True
    pp = str(c.get("persona_proveedor") or "").strip()
    if not pp:
        return False
    gan = _norm_razon_cr(nombre_g or "")
    # Sólo la razón social (o una empresa: S.A.C., E.I.R.L.…) no es una persona del ganador.
    if gan and (_norm_razon_cr(pp) == gan or gan in _norm_razon_cr(pp)):
        return False
    return not re.search(r"\b(s\.?\s?a\.?\s?c|s\.?\s?a|e\.?\s?i\.?\s?r\.?\s?l|s\.?\s?r\.?\s?l|s\.?\s?c\.?\s?r\.?\s?l|consorcio)\b\.?", pp, re.I)


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
    del_ganador = _firmantes_del_ganador(tool_context.state)
    relevantes, no_verificables = [], []
    for c in cruces:
        if not isinstance(c, dict):
            continue
        # Quien firma el contrato POR el ganador es, por definición, persona del ganador: no es un vínculo
        # entidad-proveedor (1225299: el apoderado de la ganadora "coincidía" consigo mismo).
        if _nombre_norm(c.get("firmante")) in del_ganador:
            continue
        if not c.get("tipo_relacion") or c.get("tipo_relacion") == "sin_relacion":
            continue
        if c.get("severidad") not in ("alta", "media"):
            continue
        fuente = str(c.get("fuente_url") or "").strip()
        conf = str(c.get("confianza_match") or c.get("confianza") or "").strip().lower()
        nombra = _cruce_nombra_al_ganador(c, tool_context.state)
        if _url_plausible(fuente) and conf == "alta" and nombra:
            relevantes.append(c)
        else:
            falta = []
            if not _url_plausible(fuente):
                falta.append("fuente_url")
            if not nombra:
                falta.append("sin_persona_del_ganador")
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
    """C9 — La misma persona detrás de varias empresas ganadoras.

    Un socio o representante legal del ganador (persona natural) figura con ese mismo papel en otras dos o más empresas
    que ganaron buenas pro en los últimos 12 meses. Cambios del 2026-11-16, tras el contrato 1250529 (el «documento» de
    la evidencia era el RUC de la empresa matriz del ganador):
      · sólo personas naturales (documento nacional): un accionista que es empresa es un grupo empresarial, no una persona;
      · sólo socios y representantes legales, y sólo quien figura en 6 empresas o menos (un director profesional de un
        grupo grande figura en decenas);
      · «ganaron» se mide en las buenas pro del CONOSCE, no en los contratos que Vigía analizó;
      · la evidencia nombra a las empresas con su RUC y NO lleva el documento de la persona.
    Grave sólo si alguna de esas empresas ganó en la misma entidad de este contrato.

    Fuente: rnp_conformacion_juridica + conosce_adjudicaciones. Norma: impedimentos para contratar (heurística).
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("testaferro_multi_ruc", reglas)
    if om:
        return om
    state = tool_context.state
    conn = _pg()
    try:
        cur = conn.cursor()
        # Con varios ganadores, cada uno con RUC 20 (el principal primero), no uno cualquiera.
        candidatos = [r for r, _n in ganadores_para_regla(ocid, state, cur) if re.fullmatch(r"20\d{9}", r)]
        if not candidatos:
            return {"regla": "testaferro_multi_ruc", "triggered": False, "motivo": "el ganador no es una empresa con RUC 20"}
        # La entidad de este contrato, por su OCID tal como llega o sin el prefijo del OCDS.
        from tools.lecturas import ocid_corto
        cur.execute("SELECT c.entidad_ruc::text FROM convocatorias c WHERE c.ocid IN (%s, %s) LIMIT 1", (ocid, ocid_corto(ocid)))
        entidad_ruc = ((cur.fetchone() or [None])[0] or "").strip()
        mejor = None
        n_personas = 0
        for g_ruc in candidatos:
            cur.execute(
                """WITH gente AS (
                     SELECT DISTINCT r.numero_documento AS doc
                       FROM rnp_conformacion_juridica r
                      WHERE r.ruc_empresa = %s AND r.tipo_documento LIKE 'DOC. NACIONAL%%'
                        AND r.tipo_rol IN ('SOCIO_ACCIONISTA_TITULAR', 'REPRESENTANTE_LEGAL')
                   ), pocas AS (   -- quien figura en decenas de empresas no es el dueño de ninguna
                     SELECT r.numero_documento AS doc
                       FROM rnp_conformacion_juridica r JOIN gente g ON g.doc = r.numero_documento
                      WHERE r.tipo_rol IN ('SOCIO_ACCIONISTA_TITULAR', 'REPRESENTANTE_LEGAL')
                      GROUP BY 1 HAVING count(DISTINCT r.ruc_empresa) BETWEEN 3 AND 6
                   )
                   SELECT r.numero_documento, r.ruc_empresa::text, max(e.razon_social),
                          bool_or(r.tipo_rol = 'SOCIO_ACCIONISTA_TITULAR') AS socio,
                          count(DISTINCT a.codigo_convocatoria)::int, sum(a.monto_adjudicado)::float,
                          bool_or(a.entidad_ruc::text = %s) AS misma_entidad
                     FROM rnp_conformacion_juridica r
                     JOIN pocas p ON p.doc = r.numero_documento
                     JOIN conosce_adjudicaciones a ON a.ruc_proveedor = r.ruc_empresa AND a.monto_adjudicado > 0
                                                  AND a.fecha_buenapro >= current_date - 365
                     LEFT JOIN empresas e ON e.ruc = r.ruc_empresa
                    WHERE r.tipo_rol IN ('SOCIO_ACCIONISTA_TITULAR', 'REPRESENTANTE_LEGAL')
                      AND r.ruc_empresa <> %s AND r.ruc_empresa LIKE '20%%'
                    GROUP BY 1, 2""",
                (g_ruc, entidad_ruc, g_ruc),
            )
            por_persona: dict[str, list[dict]] = {}
            for doc, ruc, nombre, socio, procesos, monto, misma in cur.fetchall():
                por_persona.setdefault(doc, []).append({
                    "ruc": ruc, "nombre": nombre or ruc, "papel": "socio" if socio else "representante legal",
                    "procesos": int(procesos or 0), "monto": round(float(monto or 0), 2), "misma_entidad": bool(misma)})
            n_personas += len(por_persona)
            # Con el ganador son tres o más empresas ganadoras de la misma persona.
            casos_g = sorted((v for v in por_persona.values() if len(v) >= 2), key=lambda v: (-len(v), -sum(x["monto"] for x in v)))
            clave = (any(x["misma_entidad"] for x in casos_g[0]), len(casos_g[0])) if casos_g else None
            if casos_g and (mejor is None or clave > mejor[0]):
                mejor = (clave, g_ruc, casos_g)
        g_ruc, casos = (mejor[1], mejor[2]) if mejor else (candidatos[0], [])
        result = {
            "regla": "testaferro_multi_ruc",
            "n_ganadores_evaluados": len(candidatos),
            "n_personas_evaluadas": n_personas,
            "n_triggered": len(casos),
            # Sin el documento de la persona: sólo las empresas, que son públicas.
            "detalle": [{"otras_empresas": sorted(v, key=lambda x: -x["monto"])[:10]} for v in casos[:3]],
            "triggered": bool(casos),
        }
        if casos:
            otras = sorted(casos[0], key=lambda x: -x["monto"])
            misma = any(x["misma_entidad"] for x in otras)
            lista = "; ".join(f"{x['nombre']} (RUC {x['ruc']}, {x['procesos']} buena(s) pro por S/ {x['monto']:,.2f})" for x in otras[:5])
            result.update({
                "severidad": "alta" if misma else "media",
                "ganador_ruc": g_ruc,
                "evidencia": (
                    f"Un {otras[0]['papel']} del ganador (RUC {g_ruc}) figura también como socio o representante legal de "
                    f"{len(otras)} empresas más que ganaron buenas pro del Estado en los últimos 12 meses: {lista}"
                    + (f" y {len(otras) - 5} más" if len(otras) > 5 else "") + ". "
                    + ("Al menos una ganó en esta misma entidad. " if misma else "")
                    + "Varias empresas de una misma persona no son una falta: hay que revisar si compiten entre sí, si se "
                      "reparten las compras de una entidad o si alguna está impedida."
                ),
                "norma": "Heurística — " + _norma_state(tool_context.state)["impedimentos"],
                "fuente_url": f"https://apps.oece.gob.pe/perfilprov-ui/ficha/{g_ruc}",
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
    # Las partículas no son apellidos: «MARIA DE LA CRUZ PEREZ» y «JUAN DE LA CRUZ ROJAS» compartían tres «palabras»
    # (DE, LA, CRUZ) y la regla los daba por la misma persona, en severidad alta (auditoría 2026-11-13).
    particulas = {"DE", "DEL", "LA", "LAS", "LOS", "Y", "SAN", "SANTA", "VDA", "VIUDA"}
    for p, n in con_nombre:
        toks = set(n.split()) - particulas
        for cn, rol, origen in candidatos:
            ctoks = set(cn.split()) - particulas
            # Coincidencia exacta o de ≥3 palabras propias (dos apellidos + nombre): nunca por un apellido solo.
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
            "fuente_url": proceso_oece(ocid),
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
        # Con varios ganadores, cada uno (el principal primero); se informa el que más directas acumula.
        candidatos = ganadores_para_regla(ocid, state, cur)
        if not candidatos:
            return {"regla": "directa_recurrente", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin proveedor adjudicado identificable"}
        mejor = None
        for prov_ruc, prov_nombre in candidatos:
            if fecha:
                cur.execute(
                    """SELECT DISTINCT c.ocid, c.entidad_ruc, c.fecha_convocatoria, c.cuantia_referencial
                         FROM convocatorias c
                         LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                         LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                        WHERE c.ocid<>%s AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)
                          AND (c.tipo_contratacion = 'directa'
                               OR UPPER(COALESCE(c.tipo_proceso, c.modalidad, '')) LIKE '%%DIRECTA%%')
                          AND c.fecha_convocatoria BETWEEN %s::date - INTERVAL '12 months' AND %s::date""",
                    (prov_ruc, ocid, prov_ruc, fecha, fecha))
            else:
                cur.execute(
                    """SELECT DISTINCT c.ocid, c.entidad_ruc, c.fecha_convocatoria, c.cuantia_referencial
                         FROM convocatorias c
                         LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                         LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                        WHERE c.ocid<>%s AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)
                          AND (c.tipo_contratacion = 'directa'
                               OR UPPER(COALESCE(c.tipo_proceso, c.modalidad, '')) LIKE '%%DIRECTA%%')
                          AND c.fecha_convocatoria >= NOW() - INTERVAL '12 months'""",
                    (prov_ruc, ocid, prov_ruc))
            filas = cur.fetchall()
            if mejor is None or len(filas) > len(mejor[2]):
                mejor = (prov_ruc, prov_nombre, filas)
        prov_ruc, prov_nombre, rows = mejor
    finally:
        conn.close()
    procesos = [{"ocid": r[0], "entidad_ruc": r[1], "fecha": str(r[2])[:10], "cuantia": float(r[3] or 0)}
                for r in rows]
    result = {"regla": "directa_recurrente", "proveedor_ruc": prov_ruc, "n_ganadores_evaluados": len(candidatos),
              "n_directas_12m": len(procesos),
              "procesos": procesos[:10], "estado": "hallado" if procesos else "sin_dato",
              "_nota_alcance": "Conteos sobre procesos ingestados en la base de Vigía.", "triggered": False}
    if len(procesos) >= 3:
        result.update({
            "triggered": True, "severidad": "media", "ganador_ruc": prov_ruc,
            "evidencia": (f"{prov_nombre or 'El proveedor'} (RUC {prov_ruc}) acumula {len(procesos)} contrataciones "
                          f"directas en los 12 meses previos ({', '.join(p['ocid'] for p in procesos[:4])}), "
                          f"además de la presente. Recurrencia en procedimientos no competitivos."),
            "norma": "Art. 27 TUO Ley 30225 / Art. 55 Ley 32069 — carácter excepcional de la contratación directa",
            "fuente_url": proceso_oece(ocid),
        })
        state.setdefault("pending_flags", []).append(result)
    return result

def check_lobby_visits_rule(ocid: str, tool_context: ToolContext,
                            reglas_activas: frozenset[str] | None = None,
                            topes_uit: dict | None = None) -> dict:
    """Evalúa lobby pre-convocatoria — socios, representantes o el titular (RUC 10) del ganador, de cada integrante
    del consorcio ganador o de otro postor que visitaron a la ENTIDAD CONTRATANTE en los 180 días previos a la
    convocatoria. Ganador → alta (bandera); sólo otros postores → media (sin bandera).

    Cruza `visitas_entidades` × `rnp_conformacion_juridica` con el mapeo `visita_entidad_ruc` (todos los nombres con que
    el registro de visitas llama a la entidad: el mismo de la pestaña Visitas, migraciones 186/197). Antes exigía el
    nombre exacto de la entidad y que el ganador estuviera en `postores`/`empresas` de la base propia: no veía a los
    consorciados, a los RUC 10 ni a las variantes del nombre (prueba de oro 2026-11-04: 8 omisiones en 3 redes).
    Fuente: Registro de Visitas en Línea (Ley 28024 — Gestión de Intereses).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        dict con triggered, evidencia, visitas[], severidad.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("lobby_visits_pre_convocatoria", reglas)
    if om:
        return om
    state = tool_context.state
    conn = _pg()
    try:
        cur = conn.cursor()
        if not _table_exists(cur, "visitas_entidades"):
            return {"regla": "lobby_visits_pre_convocatoria", "triggered": False,
                    "dataset_no_disponible": True,
                    "hint": "Cargar dataset visitas con backend/scripts/load_visitas_entidades.py"}
        cur.execute("SELECT c.entidad_ruc::text, c.fecha_convocatoria, (SELECT nombre FROM entidades e WHERE e.ruc = c.entidad_ruc) "
                    "FROM convocatorias c WHERE c.ocid = %s", (ocid,))
        row = cur.fetchone() or (None, None, None)
        entidad_ruc, entidad_nombre = (row[0] or "").strip() or None, row[2] or "la entidad"
        fconv = _fecha_convocatoria_state(state) or _to_date(row[1])
        if not entidad_ruc or not fconv:
            return {"regla": "lobby_visits_pre_convocatoria", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin entidad o sin fecha de convocatoria"}
        ganadores = ganadores_evaluables(ocid, state, cur)
        rucs_g = sorted({g["ruc"] for g in ganadores})
        rucs_o = sorted({r for p in _postores_parser(state) if not p.get("es_ganador")
                         for r in [p.get("ruc"), *(p.get("integrantes_ruc") or [])] if r and len(r) == 11} - set(rucs_g))
        if not rucs_g and not rucs_o:
            return {"regla": "lobby_visits_pre_convocatoria", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin RUC del ganador ni de otros postores"}
        cur.execute(
            """WITH g AS (SELECT unnest(%s::text[]) AS ruc, true AS ganador
                          UNION SELECT unnest(%s::text[]), false),
                    p AS (SELECT g.ruc, g.ganador, r.numero_documento AS dni, r.nombre, r.tipo_rol AS rol
                            FROM g JOIN rnp_conformacion_juridica r ON r.ruc_empresa = g.ruc::char(11)
                           WHERE r.numero_documento ~ '^[0-9]{8}$'
                          UNION
                          SELECT g.ruc, g.ganador, substr(g.ruc, 3, 8), NULL, 'TITULAR' FROM g WHERE g.ruc LIKE '10%%')
               SELECT DISTINCT ON (v.id, p.ruc) p.ruc, p.ganador, COALESCE(p.nombre, v.visitante), p.rol,
                      v.funcionario_cargo, v.funcionario_area, v.fecha_visita, v.motivo,
                      visita_decisor(v.funcionario_cargo, v.funcionario_area)
                 FROM p
                 JOIN visitas_entidades v ON v.numero_documento = p.dni
                                         AND v.fecha_visita BETWEEN %s::date - 180 AND %s::date
                 JOIN visita_entidad_ruc m ON m.entidad_visitada = v.entidad_visitada AND m.ruc = %s
                ORDER BY v.id, p.ruc
                LIMIT 80""",
            (rucs_g, rucs_o, fconv, fconv, entidad_ruc))
        filas = cur.fetchall()
    finally:
        conn.close()
    por_ruc = {g["ruc"]: g for g in ganadores}
    visitas = []
    for ruc, gan, nombre, rol, cargo, area, fecha, motivo, decisor in sorted(filas, key=lambda f: (not f[1], f[6])):
        g = por_ruc.get(ruc) or {}
        visitas.append({
            "visitante": tapar_nombre(nombre) if nombre else "persona del postor",
            "rol_en_empresa": (rol or "").replace("_", " ").lower() or None,
            "ruc_empresa": ruc, "empresa": (tapar_nombre(g.get("nombre")) if ruc.startswith("10") else g.get("nombre")) or f"RUC {ruc}",
            "consorcio": g.get("consorcio"), "empresa_ganadora": bool(gan),
            "cargo_funcionario": cargo, "area_funcionario": area, "decisor": bool(decisor),
            "fecha_visita": fecha.isoformat() if hasattr(fecha, "isoformat") else str(fecha),
            "dias_antes_convocatoria": (fconv - fecha).days if hasattr(fecha, "year") else None,
            "motivo": (motivo or "")[:120],
        })
    ganadoras = [v for v in visitas if v["empresa_ganadora"]]
    result = {
        "regla": "lobby_visits_pre_convocatoria",
        "triggered": bool(ganadoras),
        "estado": "hallado",
        "fecha_convocatoria": str(fconv),
        "n_visitas_total": len(visitas),
        "n_visitas_de_ganador": len(ganadoras),
        "visitas": visitas[:25],
        "fuente_url": "https://visitas.servicios.gob.pe/consultas",
    }
    if ganadoras:
        v0 = sorted(ganadoras, key=lambda v: (not v["decisor"], v["fecha_visita"]))[0]
        quien = (f"{v0['empresa']}, integrante del consorcio ganador {v0['consorcio']}" if v0.get("consorcio")
                 else f"{v0['empresa']} (ganador)")
        otras = len(ganadoras) - 1
        result.update({
            "ganador_ruc": v0.get("ruc_empresa"),
            "severidad": "alta" if v0.get("decisor") else "media",
            "evidencia": (
                f"{v0['visitante']} ({v0['rol_en_empresa'] or 'persona vinculada'} de {quien}) visitó {entidad_nombre} el "
                f"{v0['fecha_visita']}, {v0['dias_antes_convocatoria']} días antes de la convocatoria del {fconv}"
                + (f", para reunirse con {v0['cargo_funcionario']}" if v0.get("cargo_funcionario") else "")
                + (f" ({v0['area_funcionario']})" if v0.get("area_funcionario") else "")
                + (f"; motivo: «{v0['motivo']}»" if v0.get("motivo") else "") + "."
                + (f" Otras {otras} visitas de la gente del ganador en los 180 días previos." if otras > 0 else "")
                + " Una visita no prueba un acuerdo: es un hecho registrado que el dictamen debe consignar."
            ),
            "norma": "Ley 28024 (Gestión de Intereses) — registro de visitas obligatorio para detectar lobby.",
        })
        state.setdefault("pending_flags", []).append(result)
    elif visitas:
        result["severidad"] = "media"
        result["evidencia"] = (f"{len(visitas)} visitas de socios o representantes de otros postores (no el ganador) a la "
                               f"entidad en los 180 días previos a la convocatoria.")
    return result


check_concentracion_entidad_rule_tool = _as_tool(check_concentracion_entidad_rule)
check_recurrencia_firmante_rule_tool = _as_tool(check_recurrencia_firmante_rule)
check_testaferro_multi_ruc_rule_tool = _as_tool(check_testaferro_multi_ruc_rule)
check_lobby_visits_rule_tool = _as_tool(check_lobby_visits_rule)
check_personal_clave_vinculado_rule_tool = _as_tool(check_personal_clave_vinculado_rule)
check_directa_recurrente_rule_tool = _as_tool(check_directa_recurrente_rule)
