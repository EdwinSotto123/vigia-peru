"""compliance_rules._rules_montos — reglas de plazos, montos/tipo de proceso y fraccionamiento."""

from tools._core import *  # noqa: F401,F403
from tools.compliance_rules._base import _as_tool, _es_comparacion_precios, _fecha_convocatoria_state, _ganador_ruc, _montos_ocds, _norma_state, _perfil_reglas, _perfil_topes, _procurement_method, _regla_omitida, _sin_tildes, _to_date, norma_aplicable  # noqa: F401


# Claves aceptadas en `topes_uit` (todas opcionales; default = comportamiento anterior):
#   uit / uit_soles                          → valor de la UIT en soles (5350)
#   comparacion_precios / comparacion_precios_max → tope superior de CP (15 UIT)
#   adjudicacion_simplificada / adjudicacion_simplificada_max / licitacion_publica
#                                            → tope superior de AS = mínimo de LP (400 UIT;
#                                              obras: 1800)
_TOPES_DEFAULT = {"uit_soles": 5350.0, "comparacion_precios_max": 15.0,
                  "adjudicacion_simplificada_max": 400.0}

# Ley 32069 (procesos desde 22-abr-2025) — topes en SOLES, no en UIT (lote 1 · T11):
#   · art. 14 Ley 32513 (Presupuesto 2026): LP/CP bienes-servicios ≥ S/ 485 000; por debajo,
#     Licitación/Concurso Público ABREVIADO. Obras: LP ≥ S/ 5 000 000.
#   · Reglamento D.S. 009-2025-EF: Comparación de Precios hasta S/ 100 000 (bienes/servicios
#     de disponibilidad inmediata; las bases estándar 2026 lo repiten: "cuantía hasta S/ 100 000").
#   · UIT 2026 = S/ 5 500 (contrataciones menores ≤ 8 UIT = S/ 44 000, fuera de la ley).
# Sobrescribibles desde `topes_uit` del perfil con las mismas claves.
_TOPES_LEY_32069 = {"uit_soles": 5500.0, "comparacion_precios_max_soles": 100000.0,
                    "licitacion_publica_min_soles": 485000.0, "obras_licitacion_min_soles": 5000000.0}


def _tope(topes: dict | None, default: float, *claves: str) -> float:
    for k in claves:
        if isinstance(topes, dict) and topes.get(k) is not None:
            try:
                return float(topes[k])
            except (TypeError, ValueError):
                continue
    return default

def check_plazo_convocatoria_rule(ocid: str, tool_context: ToolContext,
                                  reglas_activas: frozenset[str] | None = None,
                                  topes_uit: dict | None = None) -> dict:
    """Evalúa si el plazo entre publicación de convocatoria y buena pro
    cumple el mínimo legal según tipo de proceso.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia, norma.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("plazo_convocatoria_minimo", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT COALESCE(tipo_proceso, modalidad), fecha_convocatoria, fecha_buena_pro, cuantia_referencial "
            "FROM convocatorias WHERE ocid=%s", (ocid,),
        )
        row = cur.fetchone()
        if not row:
            return {"regla": "plazo_convocatoria_minimo", "triggered": False, "motivo": "convocatoria no encontrada"}
        tipo, fconv, fbp, cuantia = row
        tipo = _procurement_method(tool_context.state, tipo)
        fconv, fbp = _to_date(fconv), _to_date(fbp)
        if not fconv or not fbp:
            return {"regla": "plazo_convocatoria_minimo", "triggered": False, "motivo": "sin fechas"}
        delta_dias = (fbp - fconv).days
        # Los plazos legales se cuentan en DÍAS HÁBILES entre la convocatoria y la presentación de
        # ofertas; aquí solo tenemos la buena pro (posterior), así que la ventana medida es MAYOR
        # que la legal: si aun así es corta, la señal es sólida. Se cuenta lunes-viernes (sin
        # feriados: por eso hay un margen de 2 días antes de marcar "alta").
        habiles = sum(1 for i in range(delta_dias) if (fconv + _dt.timedelta(days=i + 1)).weekday() < 5)
        tipo_norm = _sin_tildes(tipo or "").upper()

        # Mínimos referenciales en días hábiles entre convocatoria y presentación de ofertas
        # (Reglamento Ley 32069 / valores del régimen anterior cuando coinciden):
        #   Licitación / Concurso Público 22 · Subasta Inversa Electrónica 8 · Adjudicación
        #   Simplificada 8 (bienes/servicios) · Comparación de Precios 3 · Directa: sin mínimo.
        minimo = None
        if ("LICITACION" in tipo_norm or "CONCURSO" in tipo_norm) and "ABREVIAD" in tipo_norm:
            minimo = 8          # LPA / CPA (Ley 32069): plazos abreviados
        elif "LICITACION" in tipo_norm or "CONCURSO" in tipo_norm:
            minimo = 22
        elif "SUBASTA" in tipo_norm:
            minimo = 8
        elif "ADJUDICACION SIMPLIFICADA" in tipo_norm or "AS-" in tipo_norm:
            minimo = 8
        elif "COMPARACION" in tipo_norm:
            minimo = 3
        elif "DIRECTA" in tipo_norm:
            minimo = 0
        result = {
            "regla": "plazo_convocatoria_minimo",
            "tipo_proceso": tipo,
            "dias_efectivos": delta_dias,
            "dias_habiles": habiles,
            "dias_minimo_habiles": minimo,
            "triggered": False,
        }
        if minimo is not None and minimo > 0 and habiles < minimo:
            claro = habiles <= minimo - 2          # margen por feriados no contados
            result.update({
                "triggered": True,
                "severidad": "alta" if claro else "media",
                "requiere_verificacion": not claro,
                "evidencia": (
                    f"Entre la convocatoria ({fconv}) y la buena pro ({fbp}) pasaron {habiles} días hábiles "
                    f"({delta_dias} calendario) — por debajo del mínimo referencial de {minimo} días hábiles "
                    f"para {tipo}" + ("" if claro else " (margen de feriados: verificar el cronograma de las bases)") + "."
                ),
                "norma": _norma_state(tool_context.state).get("plazos", "Reglamento Ley 32069 — plazos mínimos del procedimiento de selección"),
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

def check_tipo_proceso_vs_monto_rule(ocid: str, tool_context: ToolContext,
                                     reglas_activas: frozenset[str] | None = None,
                                     topes_uit: dict | None = None) -> dict:
    """Verifica que el tipo de proceso elegido corresponda al monto referencial.
    Por ejemplo, una contratación de S/. 5M debería ir por Licitación Pública,
    no por Adjudicación Simplificada o Comparación de Precios.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia, norma.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("tipo_proceso_vs_monto", reglas)
    if om:
        return om
    topes = _perfil_topes(tool_context, topes_uit)
    state = tool_context.state
    conn = _pg()
    try:
        cur = conn.cursor()
        # `tipo_proceso` NULL en el 99.6 % de las filas → COALESCE con `modalidad` y, sobre
        # todo, `procurementMethodDetails` del OCDS en state (lote 1 · T11).
        cur.execute(
            "SELECT COALESCE(tipo_proceso, modalidad), cuantia_referencial, fecha_convocatoria "
            "FROM convocatorias WHERE ocid=%s",
            (ocid,),
        )
        row = cur.fetchone()
    finally:
        conn.close()
    tipo_bd, cuantia, fconv_bd = row if row else (None, None, None)
    tipo = _procurement_method(state, tipo_bd)
    if not cuantia:
        cuantia = _montos_ocds(state.get("ocds") or state.get("ocds_preloaded") or {}).get("referencial")
    if not tipo or tipo.strip().lower() == "desconocido" or not cuantia:
        return {"regla": "tipo_proceso_vs_monto", "triggered": False, "estado": "sin_dato",
                "motivo": "sin tipo de procedimiento o cuantía (BD/OCDS)"}
    tipo_norm = _sin_tildes(tipo).upper()
    cuantia_f = float(cuantia)
    norma = norma_aplicable(_fecha_convocatoria_state(state) or fconv_bd)
    es_obras = str(((state.get("perfil") or {}).get("nombre")) or state.get("pipeline_profile") or "").lower() == "obras" \
        or _tope(topes, 0.0, "licitacion_publica") >= 1000
    fuente = f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"
    result = {"regla": "tipo_proceso_vs_monto", "tipo_proceso": tipo, "cuantia_soles": cuantia_f,
              "regimen": norma["regimen"], "triggered": False}

    if norma["regimen"] == "ley_32069":
        # Topes en SOLES (Ley 32069 art. 54 + art. 14 Ley 32513, Presupuesto 2026; Reglamento
        # D.S. 009-2025-EF para la comparación de precios). UIT 2026 = S/ 5 500.
        #   · Comparación de precios (bienes/servicios de disponibilidad inmediata): ≤ S/ 100 000
        #   · Licitación / Concurso Público abreviados (bienes/servicios): < S/ 485 000
        #   · Licitación / Concurso Público (bienes/servicios): ≥ S/ 485 000
        #   · Obras: LP ≥ S/ 5 000 000; LPA por debajo
        #   · Contrataciones menores (excluidas de la ley): ≤ 8 UIT = S/ 44 000
        t = dict(_TOPES_LEY_32069)
        for k in t:
            t[k] = _tope(topes, t[k], k)
        tope_cp = t["comparacion_precios_max_soles"]
        tope_lp = t["obras_licitacion_min_soles"] if es_obras else t["licitacion_publica_min_soles"]
        result["topes_soles"] = {"comparacion_precios_max": tope_cp, "licitacion_publica_min": tope_lp,
                                 "uit_soles": t["uit_soles"], "menores_max": 8 * t["uit_soles"]}
        es_cp = _es_comparacion_precios(tipo_norm)
        es_abreviado = ("ABREVIAD" in tipo_norm or "LPA" in tipo_norm.split("-") or "CPA" in tipo_norm.split("-")
                        or "ADJUDICACION SIMPLIFICADA" in tipo_norm or tipo_norm.startswith("AS-"))
        if es_cp and cuantia_f > tope_cp:
            result.update({
                "triggered": True, "severidad": "alta",
                "evidencia": (f"Comparación de Precios con cuantía S/ {cuantia_f:,.2f}, por encima del tope "
                              f"de S/ {tope_cp:,.0f} que fija el Reglamento para ese procedimiento "
                              f"({norma['ley']}). Correspondía un procedimiento abreviado."),
                "norma": norma["procedimientos"], "fuente_url": fuente})
            state.setdefault("pending_flags", []).append(result)
        elif es_abreviado and cuantia_f >= tope_lp:
            result.update({
                "triggered": True, "severidad": "alta",
                "evidencia": (f"Procedimiento abreviado ({tipo}) con cuantía S/ {cuantia_f:,.2f}, igual o mayor al "
                              f"umbral de S/ {tope_lp:,.0f} desde el que corresponde Licitación/Concurso Público "
                              f"(art. 14 Ley 32513)."),
                "norma": norma["procedimientos"], "fuente_url": fuente})
            state.setdefault("pending_flags", []).append(result)
        elif es_cp and cuantia_f >= 0.95 * tope_cp:
            # Informativa (baja): la cuantía se fijó al borde del tope de la comparación de
            # precios (99.6 % en 1225062, 99.7 % en 1225266, 95 % en 1225392). No es
            # irregular por sí sola; sí es dato para el lector.
            pct = cuantia_f / tope_cp * 100
            sub = {"regla": "cuantia_al_limite_del_tope", "triggered": True, "severidad": "baja",
                   "evidencia": (f"La cuantía (S/ {cuantia_f:,.2f}) equivale al {pct:.1f} % del tope de la "
                                 f"Comparación de Precios (S/ {tope_cp:,.0f}). Observación informativa: el "
                                 f"procedimiento se dimensionó al límite del umbral."),
                   "norma": norma["procedimientos"], "fuente_url": fuente}
            result["sub_regla"] = sub
            state.setdefault("pending_flags", []).append(sub)
        return result

    # Régimen TUO Ley 30225: topes en UIT del perfil (Anexo IV). Defaults bienes/servicios:
    #   CP ≤ 15 UIT · AS ≤ 400 UIT (obras 1 800) · LP por encima. UIT 2025 = S/ 5 350.
    UIT = _tope(topes, _TOPES_DEFAULT["uit_soles"], "uit_soles", "uit")
    tope_cp = _tope(topes, _TOPES_DEFAULT["comparacion_precios_max"],
                    "comparacion_precios_max", "comparacion_precios")
    tope_as = _tope(topes, _TOPES_DEFAULT["adjudicacion_simplificada_max"],
                    "adjudicacion_simplificada_max", "adjudicacion_simplificada",
                    "licitacion_publica")
    en_uit = cuantia_f / UIT
    result.update({"cuantia_uit": round(en_uit, 1),
                   "topes_uit": {"uit_soles": UIT, "comparacion_precios_max": tope_cp,
                                 "adjudicacion_simplificada_max": tope_as}})
    if _es_comparacion_precios(tipo_norm) and en_uit > tope_cp:
        result.update({
            "triggered": True, "severidad": "alta",
            "evidencia": (f"Tipo 'Comparación de Precios' usado con monto {cuantia_f:.2f} soles "
                          f"({en_uit:.1f} UIT) — excede el tope de {tope_cp:g} UIT para CP. "
                          f"Debería haber ido por Adjudicación Simplificada o Licitación Pública."),
            "norma": norma["procedimientos"], "fuente_url": fuente})
        state.setdefault("pending_flags", []).append(result)
    elif ("ADJUDICACION SIMPLIFICADA" in tipo_norm or tipo_norm.startswith("AS-")) and en_uit > tope_as:
        result.update({
            "triggered": True, "severidad": "alta",
            "evidencia": (f"Tipo 'Adjudicación Simplificada' usado con monto {cuantia_f:.2f} soles "
                          f"({en_uit:.1f} UIT) — excede el tope de {tope_as:g} UIT para AS según el "
                          f"tipo de contratación. Debería haber ido por Licitación Pública."),
            "norma": norma["procedimientos"], "fuente_url": fuente})
        state.setdefault("pending_flags", []).append(result)
    return result


def _tokens_objeto(txt: str) -> set[str]:
    import re as _re
    _STOP = {"adquisicion", "adquisición", "servicio", "servicios", "contratacion", "contratación",
             "para", "por", "con", "del", "las", "los", "meta", "proyecto", "mejoramiento",
             "mantenimiento", "bien", "bienes", "obra", "obras", "general", "generales", "sede",
             "central", "unidad", "mediante", "modalidad", "proceso", "seleccion", "selección",
             "compra", "suministro", "item", "items", "equipo", "equipos", "municipalidad",
             "distrital", "provincial", "gobierno", "regional", "entidad"}
    txt = _re.sub(r"[^a-záéíóúñ0-9 ]", " ", (txt or "").lower())
    return {w for w in txt.split() if len(w) > 3 and w not in _STOP}


# ─── Reglas nuevas por perfil (WS V · Task V3) ─────────────────────────────

def check_adicional_acumulado_rule(ocid: str, tool_context: ToolContext,
                                   reglas_activas: frozenset[str] | None = None,
                                   topes_uit: dict | None = None) -> dict:
    """OBRAS — adicionales acumulados. Fuentes (en orden): bloque `obra.adicionales[]`
    del parser (pct_acumulado o montos vs presupuesto), `contracts[].value` vs
    `awards[].value` del OCDS (el contrato vigente supera lo adjudicado) y docs
    `contractAmendment`/`contracts[].amendments[]`. MEDIA si el acumulado supera
    15 % (tope sin autorización) y ALTA si supera 50 % (tope máximo con CGR). Si
    solo hay enmiendas sin monto → `estado: no_verificable` (sin bandera).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, pct_acumulado, fuente, n_adendas, severidad, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("adicional_acumulado", reglas)
    if om:
        return om
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    raw = state.get("parser_raw_consolidated") or {}
    obra = (raw.get("obra") if isinstance(raw, dict) else None) or {}
    pct, fuente, detalle = None, None, {}

    adicionales = obra.get("adicionales") or []
    if isinstance(adicionales, list) and adicionales:
        pcts = [a.get("pct_acumulado") for a in adicionales if isinstance(a, dict)
                and isinstance(a.get("pct_acumulado"), (int, float))]
        montos = [float(a.get("monto") or 0) for a in adicionales if isinstance(a, dict)]
        presupuesto = ((obra.get("expediente_tecnico") or {}).get("presupuesto_total")
                       or obra.get("presupuesto_total"))
        if pcts:
            pct, fuente = float(max(pcts)), "parser_obra_adicionales"
        elif montos and presupuesto:
            try:
                pct, fuente = sum(montos) / float(presupuesto) * 100, "parser_obra_adicionales"
            except (TypeError, ValueError, ZeroDivisionError):
                pct = None
        detalle = {"n_adicionales": len(adicionales),
                   "resoluciones": [a.get("resolucion") for a in adicionales if isinstance(a, dict)][:5]}

    if pct is None:
        adj = sum(float(((a.get("value") or {}).get("amount")) or 0)
                  for a in (ocds.get("awards") or []) if isinstance(a, dict))
        con = sum(float(((c.get("value") or {}).get("amount")) or 0)
                  for c in (ocds.get("contracts") or []) if isinstance(c, dict))
        if adj > 0 and con > 0 and con > adj:
            pct, fuente = (con - adj) / adj * 100, "ocds_contract_vs_award"
            detalle = {"monto_adjudicado": adj, "monto_contrato": con}

    n_amend_docs = 0
    for c in (ocds.get("contracts") or []):
        if not isinstance(c, dict):
            continue
        n_amend_docs += len(c.get("amendments") or [])
        n_amend_docs += sum(1 for d in (c.get("documents") or [])
                            if isinstance(d, dict) and str(d.get("documentType") or "").lower() == "contractamendment")
    result = {"regla": "adicional_acumulado", "pct_acumulado": round(pct, 1) if pct is not None else None,
              "fuente": fuente, "n_adendas_ocds": n_amend_docs, "detalle": detalle,
              "estado": "hallado" if pct is not None else ("no_verificable" if n_amend_docs else "sin_dato"),
              "triggered": False}
    if pct is not None and pct > 15:
        sev = "alta" if pct > 50 else "media"
        result.update({
            "triggered": True, "severidad": sev,
            "evidencia": (f"Adicionales de obra acumulados: {pct:.1f}% del monto contractual "
                          f"(fuente: {fuente}; {n_amend_docs} adenda(s) en el OCDS). "
                          + ("Supera el 50% máximo autorizable." if pct > 50 else
                             "Supera el 15% que la entidad puede aprobar sin autorización previa de la CGR.")),
            "norma": "Art. 34 TUO Ley 30225 / Art. 205 Reglamento — prestaciones adicionales de obra (15% / 50%)",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result


def check_fraccionamiento_rule(ocid: str, tool_context: ToolContext,
                               reglas_activas: frozenset[str] | None = None,
                               topes_uit: dict | None = None) -> dict:
    """Fraccionamiento: misma entidad + mismo proveedor + objeto similar (solape de
    tokens ≥ 0.5) en una ventana de ±90 días, contando en `convocatorias` (BD propia).
    MEDIA; ALTA si además la suma de los procesos supera el tope de la modalidad
    usada (p. ej. varias CP que juntas exceden 15 UIT).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, procesos_relacionados[], severidad, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("fraccionamiento", reglas)
    if om:
        return om
    topes = _perfil_topes(tool_context, topes_uit)
    state = tool_context.state
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT entidad_ruc, objeto, fecha_convocatoria, cuantia_referencial, tipo_proceso "
                    "FROM convocatorias WHERE ocid=%s", (ocid,))
        row = cur.fetchone()
        if not row or not row[0] or not row[2]:
            return {"regla": "fraccionamiento", "triggered": False, "estado": "sin_dato",
                    "motivo": "convocatoria sin entidad/fecha en BD"}
        entidad_ruc, objeto, fecha, cuantia, tipo = row
        prov_ruc, prov_nombre = _ganador_ruc(ocid, state, cur)
        if not prov_ruc:
            return {"regla": "fraccionamiento", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin proveedor adjudicado identificable"}
        cur.execute(
            """SELECT DISTINCT c.ocid, c.objeto, c.fecha_convocatoria, c.cuantia_referencial, c.tipo_proceso
                 FROM convocatorias c
                 LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                 LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                WHERE c.ocid<>%s AND c.entidad_ruc=%s
                  AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)
                  AND c.fecha_convocatoria BETWEEN %s::date - INTERVAL '90 days' AND %s::date + INTERVAL '90 days'""",
            (prov_ruc, ocid, entidad_ruc, prov_ruc, fecha, fecha))
        rows = cur.fetchall()
    finally:
        conn.close()

    base = _tokens_objeto(objeto or "")
    relacionados = []
    for r in rows:
        toks = _tokens_objeto(r[1] or "")
        if not base or not toks:
            continue
        sim = len(base & toks) / len(base | toks)
        if sim >= 0.5:
            relacionados.append({"ocid": r[0], "objeto": (r[1] or "")[:120],
                                 "fecha": str(r[2])[:10], "cuantia": float(r[3] or 0),
                                 "tipo_proceso": r[4], "similitud": round(sim, 2)})
    result = {"regla": "fraccionamiento", "proveedor_ruc": prov_ruc,
              "procesos_relacionados": relacionados[:10], "estado": "hallado" if relacionados else "sin_dato",
              "_nota_alcance": "Conteos sobre procesos ingestados en la base de Vigía.", "triggered": False}
    if relacionados:
        suma = float(cuantia or 0) + sum(r["cuantia"] for r in relacionados)
        UIT = _tope(topes, _TOPES_DEFAULT["uit_soles"], "uit_soles", "uit")
        tipo_u = (tipo or "").upper()
        tope = None
        if "COMPARACION" in tipo_u or "CP-" in tipo_u:
            tope = _tope(topes, _TOPES_DEFAULT["comparacion_precios_max"], "comparacion_precios_max", "comparacion_precios")
        elif "ADJUDICACION SIMPLIFICADA" in tipo_u or "AS-" in tipo_u:
            tope = _tope(topes, _TOPES_DEFAULT["adjudicacion_simplificada_max"],
                         "adjudicacion_simplificada_max", "adjudicacion_simplificada", "licitacion_publica")
        elif "DIRECTA" in tipo_u or "MENOR" in tipo_u:
            tope = 8.0
        excede = tope is not None and (suma / UIT) > tope
        result.update({
            "triggered": True, "severidad": "alta" if excede else "media",
            "suma_soles": round(suma, 2), "suma_uit": round(suma / UIT, 1), "tope_uit_modalidad": tope,
            "evidencia": (f"{prov_nombre or 'El proveedor'} (RUC {prov_ruc}) obtuvo {len(relacionados)} proceso(s) "
                          f"adicional(es) de objeto similar con la misma entidad en ±90 días "
                          f"({', '.join(r['ocid'] for r in relacionados[:4])}); suma S/ {suma:,.2f} "
                          f"({suma / UIT:.1f} UIT)"
                          + (f", por encima del tope de {tope:g} UIT de la modalidad '{tipo}'." if excede else ".")),
            "norma": "Art. 20 TUO Ley 30225 / Art. 36 Ley 32069 — prohibición de fraccionamiento",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result
check_plazo_convocatoria_rule_tool = _as_tool(check_plazo_convocatoria_rule)
check_tipo_proceso_vs_monto_rule_tool = _as_tool(check_tipo_proceso_vs_monto_rule)
check_adicional_acumulado_rule_tool = _as_tool(check_adicional_acumulado_rule)
check_fraccionamiento_rule_tool = _as_tool(check_fraccionamiento_rule)
