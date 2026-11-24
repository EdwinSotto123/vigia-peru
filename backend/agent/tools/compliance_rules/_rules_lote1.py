"""compliance_rules._rules_lote1 — reglas deterministas del lote 1 (plan 2026-09-15 · T12 + extras)."""

from tools._core import *  # noqa: F401,F403
from tools.compliance_rules._base import _as_tool, _es_comparacion_precios, _es_subasta, _f, _fecha_convocatoria_state, _ganador_ocds, _montos_ocds, _norm_razon_cr, _norma_state, _perfil_reglas, _postores_parser, _procurement_method, _regla_omitida, _sin_tildes, _to_date, honorario_fijo, postores_acta, ratio_vs_referencial  # noqa: F401
from tools.compliance_rules._object_matching import coincide_objeto  # noqa: F401
from tools.fuentes import proceso_oece  # noqa: E402


_ESTADOS_INVALIDOS = ("descalific", "no admit", "inadmit", "no valid", "invalid", "no invit",
                      "rechaz", "excluid", "no califica", "desestim")


def _oferta_invalida(p: dict) -> bool:
    # El parser escribe "no_admitido" / "no-admitido": sin normalizar no casaba con "no admit" y una oferta no
    # admitida contaba como válida (1223907: oferta_mas_barata_no_gana disparó por una no admitida).
    e = re.sub(r"[_\-]+", " ", _sin_tildes(str(p.get("estado") or "")).lower())
    return any(k in e for k in _ESTADOS_INVALIDOS)


_RE_CUANTIA_RESERVADA = re.compile(
    r"(no\s+(se\s+)?(dar|dara|dará|da)\s+a\s+conocer|sin\s+dar\s+a\s+conocer|cuant[ií]a\s+(reservada|no\s+publicada)|"
    r"no\s+se\s+(revela|publica|difunde)\s+(el\s+)?(valor|la\s+cuant))", re.I)


def _cuantia_reservada(state: dict) -> bool:
    """True si las bases declaran que la cuantía/valor referencial no se dio a conocer.
    Fuentes: flag del parser (`cuantia_reservada`, R4) > resúmenes/texto en state."""
    raw = (state or {}).get("parser_raw_consolidated") or {}
    da = _safe_parse_json((state or {}).get("document_analysis")) or {}
    for src in (raw, da):
        v = src.get("cuantia_reservada")
        if isinstance(v, bool):
            return v
    textos = []
    for r in (raw.get("resumenes") or []):
        if isinstance(r, dict):
            textos.append(str(r.get("resumen") or ""))
    textos.append(str(raw.get("resumen_ejecutivo") or da.get("resumen_ejecutivo") or ""))
    for it in (raw.get("items_consolidados") or []):
        if isinstance(it, dict):
            textos.append(str(it.get("texto_literal") or "")[:3000])
    # El lote deja en state['documentos_texto'] sólo los metadatos: el texto se lee por sha256 (tools/verify.py).
    try:
        from tools.verify import textos_documentos
        textos.extend(t[:20000] for t in textos_documentos(state or {}).values())
    except Exception:  # noqa: BLE001
        pass
    return any(_RE_CUANTIA_RESERVADA.search(t) for t in textos if t)

# ─── Reglas deterministas del lote 1 (plan 2026-09-15 · T12 + extras) ───────────
#
# Todas leen `parser_raw_consolidated` (postores[] / postores_consolidados[] / ofertas[] /
# lista_invitados[] / contrato — R4 garantiza montos; el código tolera que aún no existan
# y devuelve `sin_dato`), `state["ocds"]` y `person_network_context`. Corren en todos los
# perfiles (activas por defecto; se desactivan con `-<regla>` en `reglas_activas`).

def _vr_state(state: dict) -> float | None:
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    return _montos_ocds(ocds).get("referencial")


def _nombre_postor(p: dict) -> str:
    return (p.get("razon_social") or (f"RUC {p['ruc']}" if p.get("ruc") else "postor sin identificar"))[:80]


def _flag(state: dict, result: dict, severidad: str, evidencia: str, norma: str, fuente_url: str | None) -> dict:
    result.update({"triggered": True, "severidad": severidad, "evidencia": evidencia[:500],
                   "norma": norma, "fuente_url": fuente_url, "estado": "hallado"})
    state.setdefault("pending_flags", []).append(result)
    return result


def check_oferta_igual_valor_referencial_rule(ocid: str, tool_context: ToolContext,
                                              reglas_activas: frozenset[str] | None = None,
                                              topes_uit: dict | None = None) -> dict:
    """Una oferta (ganadora o no) coincide con el valor referencial al 0.1 %. ALTA si las
    bases declaran la cuantía reservada (1225030: oferta perdedora = VR al céntimo con
    "NO DAR A CONOCER LA CUANTÍA"); MEDIA si la cuantía era pública (1225392: ganador al
    100 % de la cuantía)."""
    om = _regla_omitida("oferta_igual_valor_referencial", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    vr = _vr_state(state)
    postores = [p for p in _postores_parser(state) if p.get("monto")]
    result = {"regla": "oferta_igual_valor_referencial", "triggered": False, "valor_referencial": vr,
              "n_ofertas_con_monto": len(postores)}
    if not vr or not postores:
        result.update({"estado": "sin_dato", "motivo": "sin valor referencial o sin montos de oferta en el expediente"})
        return result
    if honorario_fijo(state):
        result.update({"estado": "hallado", "motivo": "monto fijado por las bases (convenio o régimen especial, sin "
                                                      "oferta económica): la igualdad con la cuantía es por construcción"})
        return result
    # Misma base tributaria: una oferta exonerada del IGV (Ley 27037) igual a la cuantía sin IGV también coincide.
    hits, sin_igv = [], set()
    for p in postores:
        r, sin = ratio_vs_referencial(p["monto"], vr, state)
        if r is not None and abs(r - 1) <= 0.001:
            hits.append(p)
            if sin:
                sin_igv.add(id(p))
    result["coincidencias"] = [{"postor": _nombre_postor(p), "monto": p["monto"], "es_ganador": bool(p.get("es_ganador"))}
                               for p in hits]
    if not hits:
        result["estado"] = "hallado"
        return result
    reservada = _cuantia_reservada(state)
    result["cuantia_reservada"] = reservada
    p = sorted(hits, key=lambda x: (bool(x.get("es_ganador")),))[0]
    rol = "adjudicatario" if p.get("es_ganador") else "postor no ganador"
    ev = (f"La oferta de {_nombre_postor(p)} ({rol}) fue S/ {p['monto']:,.2f}, igual al valor referencial "
          f"(S/ {vr:,.2f}) con una diferencia ≤ 0.1 %. " if id(p) not in sin_igv else
          f"La oferta de {_nombre_postor(p)} ({rol}) fue S/ {p['monto']:,.2f} sin IGV, igual al valor referencial sin "
          f"IGV (S/ {vr:,.2f} / 1.18 = S/ {vr / 1.18:,.2f}) con una diferencia ≤ 0.1 %. ")
    if reservada:
        ev += ("Las bases declaran que la cuantía NO se dio a conocer: coincidir al céntimo con un valor "
               "reservado es una señal de riesgo de filtración del estudio de mercado u oferta de "
               "acompañamiento; requiere verificación.")
        sev = "alta"
    else:
        ev += ("La cuantía era pública; ofertar exactamente el referencial es una señal de riesgo de "
               "competencia aparente (precio ancla), no una irregularidad por sí sola.")
        sev = "media"
    if len(hits) > 1:
        ev += f" Otras ofertas iguales al referencial: {len(hits) - 1}."
    return _flag(state, result, sev, ev, _norma_state(state)["integridad"],
                 proceso_oece(ocid))


def check_ofertas_agrupadas_rule(ocid: str, tool_context: ToolContext,
                                 reglas_activas: frozenset[str] | None = None,
                                 topes_uit: dict | None = None) -> dict:
    """≥ 3 ofertas válidas con dispersión (max−min)/mediana < 1 % → MEDIA (1225266: 99 180 /
    99 270 / 99 320 bajo una cuantía "no revelada")."""
    om = _regla_omitida("ofertas_agrupadas", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    postores = [p for p in _postores_parser(state) if p.get("monto") and not _oferta_invalida(p)]
    result = {"regla": "ofertas_agrupadas", "triggered": False, "n_ofertas": len(postores)}
    if len(postores) < 3:
        result.update({"estado": "sin_dato" if len(postores) == 0 else "hallado",
                       "motivo": "se requieren ≥ 3 ofertas válidas con monto"})
        return result
    montos = sorted(p["monto"] for p in postores)
    mediana = montos[len(montos) // 2] if len(montos) % 2 else (montos[len(montos) // 2 - 1] + montos[len(montos) // 2]) / 2
    dispersion = (montos[-1] - montos[0]) / mediana * 100 if mediana else 0.0
    result.update({"dispersion_pct": round(dispersion, 2), "montos": montos, "estado": "hallado"})
    if dispersion >= 1.0:
        return result
    vr = _vr_state(state)
    reservada = _cuantia_reservada(state)
    result["cuantia_reservada"] = reservada
    ev = (f"{len(postores)} ofertas válidas agrupadas en una banda del {dispersion:.2f} % "
          f"(S/ {montos[0]:,.2f} a S/ {montos[-1]:,.2f}). ")
    if vr:
        ev += f"Todas entre el {montos[0] / vr * 100:.1f} % y el {montos[-1] / vr * 100:.1f} % del valor referencial (S/ {vr:,.2f}). "
    if reservada:
        ev += "Las bases declaran la cuantía no revelada. "
    ev += "Señal de riesgo de cotización coordinada o de filtración del valor; requiere verificación."
    return _flag(state, result, "media", ev, _norma_state(state)["integridad"],
                 proceso_oece(ocid))


def check_unica_oferta_valida_rule(ocid: str, tool_context: ToolContext,
                                   reglas_activas: frozenset[str] | None = None,
                                   topes_uit: dict | None = None) -> dict:
    """Con ≥ 2 ofertas, solo la ganadora resulta válida (las demás por encima de la cuantía
    en Comparación de Precios/SIE, o descalificadas/no admitidas) → MEDIA; ALTA si además el
    ganador ofertó ≥ 99 % de la cuantía (1225379: 65 000 de 65 100 con rivales a 68 500 y
    72 650; 1225392: 95 000 = cuantía con rivales a 97 960 y 99 940)."""
    om = _regla_omitida("unica_oferta_valida", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    vr = _vr_state(state)
    tipo = _procurement_method(state)
    tope_aplica = _es_comparacion_precios(tipo) or _es_subasta(tipo)
    postores = [p for p in _postores_parser(state) if p.get("monto") or p.get("estado")]
    result = {"regla": "unica_oferta_valida", "triggered": False, "n_postores": len(postores),
              "tipo_proceso": tipo or None}
    if len(postores) < 2:
        result.update({"estado": "sin_dato" if not postores else "hallado", "motivo": "se requieren ≥ 2 ofertas"})
        return result
    validas, invalidas = [], []
    for p in postores:
        motivo = None
        if _oferta_invalida(p):
            motivo = f"estado '{p.get('estado')}'"
        elif tope_aplica and vr and p.get("monto") and p["monto"] > vr * 1.0005:
            motivo = f"oferta S/ {p['monto']:,.2f} > cuantía S/ {vr:,.2f}"
        (invalidas if motivo else validas).append((p, motivo))
    result.update({"n_validas": len(validas), "n_invalidas": len(invalidas), "estado": "hallado",
                   "invalidas": [{"postor": _nombre_postor(p), "motivo": m} for p, m in invalidas]})
    if len(validas) != 1 or not invalidas:
        return result
    g, _ = validas[0]
    if not g.get("es_ganador"):
        return result
    pct = (g["monto"] / vr * 100) if (vr and g.get("monto")) else None
    sev = "alta" if (pct is not None and pct >= 99.0) else "media"
    ev = (f"De {len(postores)} ofertas, solo la del adjudicatario {_nombre_postor(g)} resultó válida"
          + (f" (S/ {g['monto']:,.2f}, {pct:.2f} % de la cuantía)" if pct is not None else "") + ". Las demás: "
          + "; ".join(f"{_nombre_postor(p)} — {m}" for p, m in invalidas[:4])
          + ". Señal de riesgo de competencia aparente (ofertas de acompañamiento); requiere verificación.")
    return _flag(state, result, sev, ev, _norma_state(state)["competencia"],
                 proceso_oece(ocid))


def _ruc_en_documentos(shas: set[str], ruc: str) -> bool:
    """¿Aparece el RUC en el texto guardado de alguno de esos documentos (documentos_texto)? Sin base o sin texto, no."""
    shas = {s for s in shas if s}
    if not shas or not ruc:
        return False
    try:
        conn = _pg()
    except Exception:  # noqa: BLE001
        return False
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM documentos_texto WHERE sha256 = ANY(%s) AND position(%s in texto) > 0 LIMIT 1", (list(shas), ruc))
        return cur.fetchone() is not None
    except Exception:  # noqa: BLE001
        return False
    finally:
        conn.close()


def check_ganador_no_invitado_rule(ocid: str, tool_context: ToolContext,
                                   reglas_activas: frozenset[str] | None = None,
                                   topes_uit: dict | None = None) -> dict:
    """Comparación de Precios (lista cerrada): el adjudicatario no figura entre los invitados
    publicados en las bases (1225379: 3 invitaciones, ganó un cuarto proveedor)."""
    om = _regla_omitida("ganador_no_invitado", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    raw = state.get("parser_raw_consolidated") or {}
    tipo = _procurement_method(state)
    result = {"regla": "ganador_no_invitado", "triggered": False, "tipo_proceso": tipo or None}
    if not _es_comparacion_precios(tipo):
        result.update({"estado": "sin_dato", "motivo": "solo aplica a Comparación de Precios"})
        return result
    invitados = raw.get("lista_invitados") or []
    inv_norm = []
    for i in invitados:
        if isinstance(i, dict):
            ruc = "".join(ch for ch in str(i.get("ruc") or "") if ch.isdigit())
            inv_norm.append((ruc if len(ruc) == 11 else None, _norm_razon_cr(i.get("razon_social") or i.get("nombre") or "")))
        elif i:
            s = str(i)
            ruc = "".join(ch for ch in s if ch.isdigit())
            inv_norm.append((ruc if len(ruc) == 11 else None, _norm_razon_cr(s)))
    result["n_invitados"] = len(inv_norm)
    if not inv_norm:
        result.update({"estado": "sin_dato", "motivo": "las bases no traen lista de invitados (o el parser no la extrajo)"})
        return result
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    g_ruc, g_nom = _ganador_ocds(ocds)
    if not g_ruc:
        for p in _postores_parser(state):
            if p.get("es_ganador"):
                g_ruc, g_nom = p.get("ruc"), p.get("razon_social")
                break
    if not g_ruc and not g_nom:
        result.update({"estado": "sin_dato", "motivo": "sin adjudicatario identificable"})
        return result
    g_nom_n = _norm_razon_cr(g_nom or "")
    g_tok = set(g_nom_n.split())

    def _match(ruc, nom):
        if g_ruc and ruc and ruc == g_ruc:
            return True
        if nom and g_nom_n and (nom == g_nom_n or (len(g_tok & set(nom.split())) >= 2 and len(g_tok) >= 2)):
            return True
        return False
    result["estado"] = "hallado"
    if any(_match(r, n) for r, n in inv_norm):
        return result
    # La lista la extrae un modelo y a veces sale incompleta (1226611: leyó 2 de los 4 invitados y el ganador era uno de los
    # que faltaron). Antes de alertar, el RUC del ganador se busca en el texto del mismo documento de invitaciones.
    shas = {str(e.get("documento_sha256") or "") for i in invitados if isinstance(i, dict)
            for e in ([i] + [x for x in (i.get("evidencia") or []) if isinstance(x, dict)]) if e.get("documento_sha256")}
    if g_ruc and _ruc_en_documentos(shas, g_ruc):
        result.update({"estado": "sin_dato", "motivo": "el ganador figura en el documento de invitaciones: la lista extraída estaba incompleta"})
        return result
    sev = "alta" if len(inv_norm) >= 3 else "media"
    ev = (f"El adjudicatario {g_nom or g_ruc} (RUC {g_ruc or 's/d'}) no aparece entre los {len(inv_norm)} proveedores "
          f"invitados que publican las bases de la Comparación de Precios (procedimiento de lista cerrada). "
          f"Señal de riesgo: verificar si existió una invitación adicional no publicada en el expediente.")
    return _flag(state, result, sev, ev, _norma_state(state)["comparacion_precios"],
                 proceso_oece(ocid))


_CARGOS_PUBLICOS = ("jefe", "gerente", "subgerente", "sub gerente", "oficial", "director", "responsable",
                    "residente", "inspector", "supervisor", "alcalde", "administraci", "abastecimiento",
                    "logistica", "adquisicion", "contrataciones", "presidente", "miembro", "comite",
                    "coordinador", "especialista", "asistente", "tesorer", "contador", "secretari")


def _firmantes_entidad(state: dict) -> list[dict]:
    """Firmantes del lado de la ENTIDAD (no del contratista) según parser: cargo público o
    entidad distinta del proveedor."""
    raw = state.get("parser_raw_consolidated") or {}
    da = _safe_parse_json(state.get("document_analysis")) or {}
    firm = raw.get("firmantes_consolidados") or raw.get("firmantes") or da.get("firmantes") or []
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    g_ruc, g_nom = _ganador_ocds(ocds)
    g_tok = set(_norm_razon_cr(g_nom or "").split())
    out = []
    for f in firm:
        if not isinstance(f, dict) or not (f.get("nombre_completo") or "").strip():
            continue
        cargo = _sin_tildes(str(f.get("cargo") or "")).lower()
        ent = _norm_razon_cr(f.get("entidad") or "")
        es_proveedor = bool(ent) and g_tok and len(g_tok & set(ent.split())) >= 2
        if es_proveedor and not any(c in cargo for c in _CARGOS_PUBLICOS):
            continue
        if any(k in cargo for k in ("representante legal", "apoderado", "titular", "contratista", "postor", "proveedor")) \
                and not any(c in cargo for c in ("residente", "inspector", "jefe", "gerente municipal", "oficial")):
            continue
        out.append(f)
    return out


REGLA_FIRMANTE_RNP_VERSION = "2"  # v1 (hasta 2026-10-11): sin lado ni DNI, daba MEDIA/ALTA por coincidencia de nombre

_ROLES_ENTIDAD = {"comite", "oec", "entidad", "area_usuaria", "aprobo", "elaboro"}
_ROLES_CONTRATISTA = {"contratista"}


def _lado_del_firmante(f: dict | None, g_tok: set[str]) -> str:
    """'entidad' | 'contratista' | 'indeterminado'. Manda el rol que el lector vio en el
    documento (`rol_en_documento`); la lista de cargos ya no decide (un gerente del
    contratista no es un funcionario de la entidad)."""
    if not f:
        return "indeterminado"
    rol = _sin_tildes(str(f.get("rol_en_documento") or "")).strip().lower()
    if rol in _ROLES_CONTRATISTA:
        return "contratista"
    if rol in _ROLES_ENTIDAD:
        return "entidad"
    ent = _norm_razon_cr(f.get("entidad") or "")
    if ent and g_tok and len(g_tok & set(ent.split())) >= 2:
        return "contratista"
    return "indeterminado"


def check_firmante_con_empresa_rnp_rule(ocid: str, tool_context: ToolContext,
                                        reglas_activas: frozenset[str] | None = None,
                                        topes_uit: dict | None = None) -> dict:
    """Firmante que figura en el RNP como socio/representante de una proveedora.

    v2: SOLO es señal (ALTA) si se cumplen las tres condiciones a la vez:
      1) la persona firma por la ENTIDAD según el rol visto en el documento;
      2) su identidad está confirmada por DNI (no por coincidencia de nombre);
      3) la empresa vinculada postula o gana ESTE proceso.
    Cualquier otro caso es contexto sin puntaje (`state['contexto_rnp']`), nunca bandera:
    estar en el RNP no es un hecho irregular por sí mismo."""
    om = _regla_omitida("firmante_con_empresa_rnp", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    pnc = state.get("person_network_context") or {}
    resultados = pnc.get("rnp_firmantes_resultados") or []
    result = {"regla": "firmante_con_empresa_rnp", "triggered": False, "n_firmantes_consultados": len(resultados),
              "regla_version": REGLA_FIRMANTE_RNP_VERSION}
    if not resultados:
        result.update({"estado": "sin_dato", "motivo": "sin cruce RNP de firmantes en person_network_context"})
        return result
    raw = state.get("parser_raw_consolidated") or {}
    da = _safe_parse_json(state.get("document_analysis")) or {}
    todos = raw.get("firmantes_consolidados") or raw.get("firmantes") or da.get("firmantes") or []
    firmantes = {_norm_razon_cr(f.get("nombre_completo")): f for f in todos
                 if isinstance(f, dict) and (f.get("nombre_completo") or "").strip()}
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    g_ruc, g_nom = _ganador_ocds(ocds)
    g_tok = set(_norm_razon_cr(g_nom or "").split())
    rucs_postores = {p["ruc"] for p in _postores_parser(state) if p.get("ruc")}
    for t in ((ocds.get("tender") or {}).get("tenderers") or []):
        r = "".join(ch for ch in str((t or {}).get("id") or "") if ch.isdigit())
        if len(r) == 11:
            rucs_postores.add(r)
    if g_ruc:
        rucs_postores.add(g_ruc)
    hallazgos = []
    for r in resultados:
        if not isinstance(r, dict):
            continue
        nombre = str(r.get("firmante") or "").strip()
        nn = _norm_razon_cr(nombre)
        f = firmantes.get(nn)
        lado = _lado_del_firmante(f, g_tok)
        identidad = r.get("identidad") or "solo_nombre"
        for e in (r.get("empresas") or []):
            if not isinstance(e, dict):
                continue
            score = float(e.get("match_score") or 0)
            exacto = str(r.get("match_por") or "") in ("nombre_exacto", "numero_documento_exacto")
            if not exacto and score < 0.95:
                continue
            ruc_e = str(e.get("ruc_empresa") or "")
            visto = str(e.get("nombre_visto") or "")
            # `nombre_visto` en el RNP es el nombre de la PERSONA, no la razón social.
            razon = None if _norm_razon_cr(visto) == nn else (visto or None)
            hallazgos.append({"firmante": nombre, "cargo": (f or {}).get("cargo"), "lado": lado,
                              "identidad": identidad, "ruc_empresa": ruc_e, "razon_social": razon,
                              "roles": e.get("roles"), "match_score": score,
                              "es_postora": ruc_e in rucs_postores, "es_ganadora": bool(g_ruc and ruc_e == g_ruc),
                              "vigencia_desde": e.get("fecha_inicio_vigencia")})
    result.update({"estado": "hallado", "n_hallazgos": len(hallazgos), "detalle": hallazgos[:6]})
    if not hallazgos:
        return result
    cumple = [h for h in hallazgos if h["lado"] == "entidad" and h["identidad"] == "dni_confirmada"
              and (h["es_postora"] or h["es_ganadora"])]
    if not cumple:
        # Contexto sin puntaje: se conserva para el revisor, no entra como bandera.
        state.setdefault("contexto_rnp", []).append({"regla": "firmante_vinculo_rnp", "detalle": hallazgos[:6]})
        result["motivo"] = "vínculo RNP sin lado de la entidad confirmado, sin DNI o sin relación con el proceso: contexto sin puntaje"
        return result
    h = cumple[0]
    empresa = h["razon_social"] or f"la empresa con RUC {h['ruc_empresa']}"
    ev = (f"Una persona identificada por DNI como firmante por la entidad"
          + (f" ({h['cargo']})" if h.get("cargo") else "") +
          f" figura en el RNP como {', '.join(h.get('roles') or ['socio/representante'])} de {empresa} "
          f"(RUC {h['ruc_empresa']}), que postula o gana este mismo proceso. El RNP no informa porcentaje de "
          "participación ni fecha de fin: dato para revisar, no una conclusión.")
    result["regla_version"] = REGLA_FIRMANTE_RNP_VERSION
    result["identidad"] = "dni_confirmada"
    result["ganador_ruc" if h["es_ganadora"] else "postor_ruc"] = h["ruc_empresa"]
    return _flag(state, result, "alta", ev, _norma_state(state)["impedimentos"] + " / Ley 27815 (Código de Ética)",
                 f"https://apps.oece.gob.pe/perfilprov-ui/ficha/{h['ruc_empresa']}")


_RE_AMPL_IMPROC = re.compile(r"(improcedente|denegad|no procede|desestim|infundad|no ha lugar)", re.I)
_RE_AMPL = re.compile(r"ampliaci[oó]n\s+de\s+plazo|ampliaci[oó]n\s+del\s+plazo", re.I)
_RE_PENAL = re.compile(r"penalidad(es)?\s+(por\s+mora|aplicad|impuest)|aplic\w+\s+(la\s+)?penalidad|resoluci[oó]n\s+(total|parcial)?\s*del\s+contrato|resuelve\s+el\s+contrato", re.I)


_RE_DOC_NO_EJECUCION = re.compile(
    r"\bbases\b|t[eé]rminos\s+de\s+referencia|\btdr\b|especificaci|resumen\s+ejecutivo|pliego|absoluci|consultas|"
    r"archivos?\s+del\s+contrato|^\s*contrato\b|proforma|requerimiento|expediente\s+t[eé]cnico|acta\s+de\s+(otorgamiento|buena)",
    re.I)
_RE_HECHO_CONSUMADO = re.compile(
    r"(se\s+)?(aplic[óo]|impus[oa]|descont[óo]|aplicaron|impusieron|descontaron)\b|penalidad(es)?\s+(aplicada|impuesta)|"
    r"declar[óo]\s+improcedente|declara\s+improcedente|improcedente\s+la\s+(solicitud|ampliaci)|"
    r"resolvi[óo]\s+(parcial|total)?\w*\s*el\s+contrato|resuelve\s+el\s+contrato|resoluci[óo]n\s+del\s+contrato\s+n",
    re.I)


def check_ampliacion_denegada_penalidad_rule(ocid: str, tool_context: ToolContext,
                                             reglas_activas: frozenset[str] | None = None,
                                             topes_uit: dict | None = None) -> dict:
    """Ejecución contractual observada (informativa, MEDIA): ampliación de plazo declarada
    improcedente, penalidad por mora aplicada o resolución del contrato. Fuente: bloque
    `contrato.ampliaciones_plazo[] / penalidades_aplicadas[]` (R4) o, en su defecto, los
    resúmenes de resoluciones/adendas del expediente (1225058: Res. OGA 506-2026)."""
    om = _regla_omitida("ampliacion_denegada_penalidad", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    raw = state.get("parser_raw_consolidated") or {}
    contrato = raw.get("contrato") if isinstance(raw.get("contrato"), dict) else {}
    cf = _safe_parse_json(state.get("contrato_final")) or {}
    result = {"regla": "ampliacion_denegada_penalidad", "triggered": False}
    hechos = []
    for src in (contrato, cf if isinstance(cf, dict) else {}):
        for a in (src.get("ampliaciones_plazo") or []):
            if not isinstance(a, dict):
                continue
            res = str(a.get("resultado") or a.get("resolucion") or "")
            if _RE_AMPL_IMPROC.search(res) or str(a.get("resultado") or "").lower() in ("improcedente", "denegada", "denegado"):
                hechos.append("ampliación de plazo" + (f" N° {a.get('n')}" if a.get("n") else "") + " declarada improcedente"
                              + (f" ({a.get('resolucion')})" if a.get("resolucion") and a.get("resolucion") != res else ""))
        for p in (src.get("penalidades_aplicadas") or []):
            if isinstance(p, dict):
                hechos.append("penalidad aplicada" + (f": {str(p.get('motivo') or p.get('tipo') or '')[:80]}" if (p.get("motivo") or p.get("tipo")) else "")
                              + (f" por S/ {float(p['monto']):,.2f}" if _f(p.get("monto")) else ""))
            elif p:
                hechos.append(f"penalidad aplicada: {str(p)[:80]}")
    fuente_doc = None
    if not hechos:
        for r in (raw.get("resumenes") or []):
            if not isinstance(r, dict):
                continue
            txt = str(r.get("resumen") or "")
            # Las bases, el TDR, el pliego de consultas y el contrato traen la cláusula de penalidad por mora y la de
            # resolución: describen lo que PODRÍA pasar, no una incidencia. Sólo cuentan los documentos de ejecución
            # y los hechos consumados (prueba de oro 2026-11-04: 8 falsas alarmas en las 4 redes, todas por bases,
            # «Resumen ejecutivo», pliego o «Archivos del contrato»).
            if _RE_DOC_NO_EJECUCION.search(str(r.get("documento") or "")) or not _RE_HECHO_CONSUMADO.search(txt):
                continue
            if _RE_AMPL.search(txt) and _RE_AMPL_IMPROC.search(txt):
                hechos.append("ampliación de plazo declarada improcedente según el documento "
                              f"'{str(r.get('documento') or '')[:60]}'")
                fuente_doc = r.get("documento")
            elif _RE_PENAL.search(txt):
                hechos.append(f"penalidad/resolución contractual según el documento '{str(r.get('documento') or '')[:60]}'")
                fuente_doc = r.get("documento")
    result.update({"estado": "hallado" if (contrato or cf or raw.get("resumenes")) else "sin_dato",
                   "hechos": hechos[:6]})
    if not hechos:
        return result
    ev = ("Ejecución contractual con incidencias documentadas en el expediente: " + "; ".join(hechos[:3]) +
          ". Es información de ejecución (no una irregularidad del proceso de selección): el dictamen debe "
          "consignarla con la fecha y la resolución que la sustenta.")
    result["documento"] = fuente_doc
    return _flag(state, result, "media", ev, _norma_state(state)["penalidades"],
                 proceso_oece(ocid))


def _apellidos(nombre: str) -> tuple[str, str] | None:
    """(ap_paterno, ap_materno) desde 'APELLIDO1 APELLIDO2 NOMBRES' o 'APELLIDOS, NOMBRES'."""
    s = _sin_tildes(str(nombre or "")).upper().strip()
    if "," in s:
        s = s.split(",", 1)[0]
    toks = [t for t in re.sub(r"[^A-Z ]", " ", s).split() if len(t) > 1 and t not in ("DE", "DEL", "LA", "LAS", "LOS", "Y")]
    if len(toks) < 3 and "," not in str(nombre or ""):
        return None
    if len(toks) < 2:
        return None
    return toks[0], toks[1]


def _socios_por_postor(state: dict) -> list[dict]:
    """[{ruc, razon_social, socios:[{nombre, dni}]}] para ganador + rivales (RNP)."""
    pnc = state.get("person_network_context") or {}
    out = []
    # Un integrante del consorcio ganador no es su rival: su gente ya está en la del ganador (`rnp_proveedor.integrantes`).
    _rnp_g = pnc.get("rnp_proveedor") if isinstance(pnc.get("rnp_proveedor"), dict) else {}
    integrantes = {str(i.get("ruc")) for i in (_rnp_g.get("integrantes") or []) if isinstance(i, dict)}
    for r in (pnc.get("socios_postores_rivales") or []):
        if isinstance(r, dict) and r.get("socios") and str(r.get("ruc_postor")) not in integrantes:
            out.append({"ruc": r.get("ruc_postor"), "razon_social": r.get("razon_social"),
                        "socios": [s for s in r["socios"] if isinstance(s, dict)]})
    rnp = pnc.get("rnp_proveedor") or {}
    if isinstance(rnp, dict):
        socios = []
        for grupo in ("socios", "representantes_legales", "organos_administracion"):
            for s in (rnp.get(grupo) or []):
                if isinstance(s, dict) and (s.get("nombre") or s.get("numero_documento") or s.get("dni")):
                    socios.append({"nombre": s.get("nombre"), "dni": s.get("numero_documento") or s.get("dni")})
        if socios:
            ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
            g_ruc, g_nom = _ganador_ocds(ocds)
            out.append({"ruc": rnp.get("ruc") or g_ruc, "razon_social": rnp.get("razon_social") or g_nom or "adjudicatario",
                        "socios": socios, "es_ganador": True})
    return out


def check_postores_vinculados_rnp_rule(ocid: str, tool_context: ToolContext,
                                       reglas_activas: frozenset[str] | None = None,
                                       topes_uit: dict | None = None) -> dict:
    """Socios/representantes de dos postores distintos con el MISMO DNI (alta) o con los dos
    apellidos completos iguales (media, "requiere verificación"; nunca por un solo
    apellido). Casos: Arias Oblitas en PROMAINGSA y MÉTRICA (1225062); Flórez García en
    Inversiones Puquin y Grifo Latino (1225416)."""
    om = _regla_omitida("postores_vinculados_rnp", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    postores = _socios_por_postor(state)
    # Sólo entre quienes presentaron oferta (acta leída o parser): los «rivales» del RNP salen de los participantes
    # registrados, y con una sola oferta no hay rivales (prueba de oro 2026-11-04: 1231217, 2026-2525-34 y 2026-2000-37,
    # tres falsas alarmas por socios comunes entre inscritos que nunca ofertaron).
    # La excepción: el GANADOR y otro inscrito con la MISMA persona (mismo DNI), aunque ese inscrito no ofertara (prueba
    # de oro de bienes: 1226228, 1226611, la empresa vinculada observó las bases o fue invitada y no se presentó).
    ofertas = [o for o in _postores_parser(state) if o.get("ruc") or o.get("razon_social")]
    rucs = {o["ruc"] for o in ofertas if o.get("ruc")} | {r for o in ofertas for r in (o.get("integrantes_ruc") or [])}
    noms = {_norm_razon_cr(o.get("razon_social") or "") for o in ofertas} - {""}

    def _oferto(x: dict) -> bool:
        # Sin el acta leída no se sabe quién ofertó: sólo el ganador cuenta. Antes, sin ofertas, TODOS los inscritos
        # pasaban por ofertantes (prueba de oro de servicios, 2026-2000-37: 41 inscritos, 4 pares entre empresas que no
        # se sabe si compitieron, y el ganador era un consorcio ajeno a todas).
        return bool(x.get("es_ganador") or (x.get("ruc") and x["ruc"] in rucs)
                    or _norm_razon_cr(x.get("razon_social") or "") in noms)
    result = {"regla": "postores_vinculados_rnp", "triggered": False, "n_postores_con_socios": len(postores),
              "solo_quienes_ofertaron": bool(ofertas)}
    if len(postores) < 2:
        result.update({"estado": "sin_dato", "motivo": "se requieren socios RNP de ≥ 2 postores"})
        return result
    pares = []
    for i, a in enumerate(postores):
        for b in postores[i + 1:]:
            if a.get("ruc") and a.get("ruc") == b.get("ruc"):
                continue
            ambos_ofertaron = _oferto(a) and _oferto(b)
            con_ganador = bool(a.get("es_ganador") or b.get("es_ganador"))
            if not ambos_ofertaron and not con_ganador:
                continue
            for sa in a["socios"]:
                for sb in b["socios"]:
                    da_, db_ = str(sa.get("dni") or "").strip(), str(sb.get("dni") or "").strip()
                    if da_ and db_ and da_ == db_ and len(da_) == 8:
                        pares.append({"tipo": "mismo_dni", "postor_a": a["razon_social"], "postor_b": b["razon_social"],
                                      "persona": sa.get("nombre") or sb.get("nombre")})
                        continue
                    apa, apb = _apellidos(sa.get("nombre")), _apellidos(sb.get("nombre"))
                    # Dos apellidos iguales: entre quienes ofertaron, o con el ganador cuando no se leyó el acta (1225062).
                    if apa and apb and apa == apb and (ambos_ofertaron or (con_ganador and not ofertas)):
                        pares.append({"tipo": "dos_apellidos", "postor_a": a["razon_social"], "postor_b": b["razon_social"],
                                      "apellidos": " ".join(apa), "persona_a": sa.get("nombre"), "persona_b": sb.get("nombre")})
    result.update({"estado": "hallado", "n_pares": len(pares), "detalle": pares[:6]})
    if not pares:
        return result
    pares.sort(key=lambda p: p["tipo"] != "mismo_dni")
    p = pares[0]
    if p["tipo"] == "mismo_dni":
        sev = "alta"
        ev = (f"Una misma persona ({p.get('persona')}) figura en el RNP como socio/representante de dos postores "
              f"rivales: {p['postor_a']} y {p['postor_b']}. Señal de riesgo de competencia simulada; requiere verificación.")
    else:
        sev = "media"
        ev = (f"Socios de dos postores rivales comparten los dos apellidos '{p['apellidos']}' según el RNP: "
              f"{p.get('persona_a')} ({p['postor_a']}) y {p.get('persona_b')} ({p['postor_b']}). Coincidencia de "
              f"apellidos: no acredita parentesco ni concertación; requiere verificación.")
    if len(pares) > 1:
        ev += f" Pares adicionales: {len(pares) - 1}."
    return _flag(state, result, sev, ev, _norma_state(state)["integridad"],
                 proceso_oece(ocid))


def check_oferta_mas_barata_no_gana_rule(ocid: str, tool_context: ToolContext,
                                         reglas_activas: frozenset[str] | None = None,
                                         topes_uit: dict | None = None) -> dict:
    """La oferta económica más baja admitida no es la ganadora y la diferencia es ≥ 5 % →
    MEDIA, con el factor que decidió si el parser trae `procedimiento_seleccion.
    puntajes_por_postor` (1225090: 597 510 perdió frente a 649 800 por garantía comercial)."""
    om = _regla_omitida("oferta_mas_barata_no_gana", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    postores = [p for p in _postores_parser(state) if p.get("monto") and not _oferta_invalida(p)]
    result = {"regla": "oferta_mas_barata_no_gana", "triggered": False, "n_ofertas_validas": len(postores)}
    # Subasta inversa: gana el menor precio tras los LANCES; el monto que el parser lee de cada postor suele ser
    # la oferta inicial, así que compararlos no dice nada (1225058: ganó el 1.º de la prelación por lances).
    if _es_subasta(_procurement_method(state)):
        result.update({"estado": "no_aplica", "motivo": "subasta inversa: la prelación sale de los lances, no de la oferta inicial"})
        return result
    ganador = next((p for p in postores if p.get("es_ganador")), None)
    if len(postores) < 2 or ganador is None:
        result.update({"estado": "sin_dato", "motivo": "se requieren ≥ 2 ofertas válidas con monto y ganador identificado"})
        return result
    if sum(1 for p in postores if p.get("es_ganador")) > 1:
        # Adjudicación por ítems o lotes: cada ganador compite en su ítem; comparar montos de ítems distintos no dice
        # nada (1230366: arroz contra frijoles).
        result.update({"estado": "no_aplica", "motivo": "varios adjudicatarios (por ítem o lote): no se comparan montos de ítems distintos"})
        return result
    barata = min(postores, key=lambda p: p["monto"])
    result["estado"] = "hallado"
    if barata is ganador or barata["monto"] >= ganador["monto"]:
        return result
    diff = (ganador["monto"] - barata["monto"]) / barata["monto"] * 100
    result.update({"oferta_mas_baja": barata["monto"], "oferta_ganadora": ganador["monto"], "diff_pct": round(diff, 2)})
    if diff < 5.0:
        return result
    raw = state.get("parser_raw_consolidated") or {}
    ps = raw.get("procedimiento_seleccion") if isinstance(raw.get("procedimiento_seleccion"), dict) else {}
    puntajes = ps.get("puntajes_por_postor") or raw.get("puntajes_por_postor") or []
    factor_txt = ""
    if isinstance(puntajes, list) and puntajes:
        def _busca(nombre):
            nn = _norm_razon_cr(nombre)
            for q in puntajes:
                if isinstance(q, dict) and _norm_razon_cr(q.get("postor") or q.get("razon_social") or "") == nn:
                    return q
            return None
        qg, qb = _busca(ganador["razon_social"]), _busca(barata["razon_social"])
        def _pts(q: dict) -> str | None:
            """«98 (económico 60, técnico 38)» con lo que haya; None si el acta no trae ningún puntaje (1250529 imprimía
            «ganador None (económico None, técnico None)»)."""
            partes = [f"{n} {q.get(k)}" for n, k in (("económico", "economico"), ("técnico", "tecnico")) if q.get(k) is not None]
            if q.get("total") is None and not partes:
                return None
            return (str(q.get("total")) if q.get("total") is not None else "sin total") + (f" ({', '.join(partes)})" if partes else "")
        if qg and qb and (_pts(qg) or _pts(qb)):
            factor_txt = f" Puntajes: ganador {_pts(qg) or 'sin dato'} vs {_pts(qb) or 'sin dato'}."
            fg, fb = qg.get("factores") or {}, qb.get("factores") or {}
            if isinstance(fg, dict) and isinstance(fb, dict):
                decisivos = [k for k in fg if _f(fg.get(k)) and (float(fg.get(k) or 0) > float(fb.get(k) or 0))]
                if decisivos:
                    factor_txt += f" Factores que decidieron: {', '.join(str(k) for k in decisivos[:3])}."
    ev = (f"La oferta más baja admitida fue la de {_nombre_postor(barata)} (S/ {barata['monto']:,.2f}); ganó "
          f"{_nombre_postor(ganador)} con S/ {ganador['monto']:,.2f} (+{diff:.1f} %).{factor_txt} No es irregular "
          f"cuando la evaluación pondera factores técnicos, pero es un dato que el dictamen debe explicar: qué "
          f"factor no económico decidió la adjudicación y si estaba en las bases.")
    return _flag(state, result, "media", ev, _norma_state(state)["competencia"],
                 proceso_oece(ocid))


def _digits(s) -> str:
    return "".join(ch for ch in str(s or "") if ch.isdigit())


def check_fecha_buena_pro_incoherente_rule(ocid: str, tool_context: ToolContext,
                                           reglas_activas: frozenset[str] | None = None,
                                           topes_uit: dict | None = None) -> dict:
    """Coherencia documental (MEDIA): el contrato cita una fecha de buena pro anterior a la
    convocatoria, o el número de la garantía difiere entre contrato y carta fianza. Solo si
    el parser trae ambos datos (1225090: "27 de mayo" en el contrato con convocatoria del
    15-jun; carta fianza 010674143 vs contrato 101674143)."""
    om = _regla_omitida("fecha_buena_pro_incoherente", _perfil_reglas(tool_context, reglas_activas), True)
    if om:
        return om
    state = tool_context.state
    raw = state.get("parser_raw_consolidated") or {}
    contrato = raw.get("contrato") if isinstance(raw.get("contrato"), dict) else {}
    cf = _safe_parse_json(state.get("contrato_final")) or {}
    cf = cf if isinstance(cf, dict) else {}
    result = {"regla": "fecha_buena_pro_incoherente", "triggered": False, "estado": "sin_dato"}
    fconv = _fecha_convocatoria_state(state)
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    fbp_ocds = _to_date(((ocds.get("awards") or [{}])[0] or {}).get("date"))
    hechos = []
    fbp_doc = None
    for src in (contrato, cf):
        for k in ("fecha_buena_pro_citada", "fecha_buena_pro", "fecha_adjudicacion"):
            d = _to_date(src.get(k))
            if d:
                fbp_doc = d
                break
        if fbp_doc:
            break
    if fbp_doc and fconv:
        result["estado"] = "hallado"
        result.update({"fecha_buena_pro_documento": str(fbp_doc), "fecha_convocatoria": str(fconv)})
        if fbp_doc < fconv:
            hechos.append(f"el contrato cita la buena pro el {fbp_doc:%d/%m/%Y}, antes de la convocatoria "
                          f"({fconv:%d/%m/%Y})" + (f"; el OCDS registra la buena pro el {fbp_ocds:%d/%m/%Y}" if fbp_ocds else ""))
    # El contrato firmado (OCDS contracts[].dateSigned) o su vigencia antes de la convocatoria (1228800: firmado el
    # 19-06 y convocado el 24-06). Con 1 día de gracia por zonas horarias del registro.
    if fconv:
        for c in (ocds.get("contracts") or []) if isinstance(ocds, dict) else []:
            if not isinstance(c, dict):
                continue
            firma = _to_date(c.get("dateSigned"))
            inicio = _to_date((c.get("period") or {}).get("startDate"))
            for etiqueta, d in (("se firmó", firma), ("empezó a regir", inicio)):
                if d and (fconv - d).days >= 2:
                    result["estado"] = "hallado"
                    result.setdefault("contrato_antes_de_convocatoria", []).append({"fecha": str(d), "que": etiqueta})
                    hechos.append(f"el contrato {etiqueta} el {d:%d/%m/%Y}, antes de la convocatoria registrada en el "
                                  f"SEACE ({fconv:%d/%m/%Y})")
                    break
            if result.get("contrato_antes_de_convocatoria"):
                break
    # Garantía: número en el contrato vs número en la carta fianza (documento aparte).
    num_contrato = None
    for src in (contrato, cf):
        g = src.get("garantia") or src.get("garantia_fiel_cumplimiento") or {}
        if isinstance(g, dict) and _digits(g.get("numero") or g.get("nro")):
            num_contrato = _digits(g.get("numero") or g.get("nro"))
            break
    num_carta = None
    for g in (raw.get("garantias") or raw.get("cartas_fianza") or []):
        if isinstance(g, dict) and _digits(g.get("numero") or g.get("nro")):
            num_carta = _digits(g.get("numero") or g.get("nro"))
            break
    if num_contrato and num_carta:
        result["estado"] = "hallado"
        result.update({"garantia_contrato": num_contrato, "garantia_carta": num_carta})
        if num_contrato != num_carta and num_contrato.lstrip("0") != num_carta.lstrip("0"):
            hechos.append(f"el número de la garantía difiere entre el contrato ({num_contrato}) y la carta fianza ({num_carta})")
    if not hechos:
        return result
    ev = ("Incoherencia documental en el expediente: " + "; ".join(hechos) +
          ". Puede ser un error material de la entidad; es un dato que un revisor preguntaría y el dictamen debe consignar.")
    return _flag(state, result, "media", ev, _norma_state(state)["transparencia"],
                 proceso_oece(ocid))


REGLAS_LOTE1 = {
    "oferta_igual_valor_referencial": check_oferta_igual_valor_referencial_rule,
    "ofertas_agrupadas": check_ofertas_agrupadas_rule,
    "unica_oferta_valida": check_unica_oferta_valida_rule,
    "ganador_no_invitado": check_ganador_no_invitado_rule,
    "firmante_con_empresa_rnp": check_firmante_con_empresa_rnp_rule,
    "ampliacion_denegada_penalidad": check_ampliacion_denegada_penalidad_rule,
    "postores_vinculados_rnp": check_postores_vinculados_rnp_rule,
    "oferta_mas_barata_no_gana": check_oferta_mas_barata_no_gana_rule,
    "fecha_buena_pro_incoherente": check_fecha_buena_pro_incoherente_rule,
}


def run_reglas_lote1(ocid: str, tool_context: ToolContext, force: bool = False) -> dict:
    """Corre las reglas deterministas del lote 1 una sola vez por corrida (idempotente:
    `state['reglas_lote1']`). Las banderas quedan en `pending_flags`; el resultado por regla
    en `state['reglas_lote1']` para la traza/UI."""
    state = tool_context.state
    ya = state.get("reglas_lote1")
    if isinstance(ya, dict) and ya.get("_ocid") == str(ocid) and not force:
        return ya
    out: dict = {"_ocid": str(ocid)}
    for nombre, fn in REGLAS_LOTE1.items():
        try:
            out[nombre] = fn(ocid, tool_context)
        except Exception as e:  # una regla nueva nunca tumba la corrida
            out[nombre] = {"regla": nombre, "triggered": False, "error": str(e)[:200]}
    # unico_postor_alto es regla dura: corre en la rama de compliance, EN PARALELO con el parser, y ahí solo ve
    # numberOfTenderers del OCDS (participantes, no ofertas). Con el acta ya leída se reevalúa con las ofertas
    # presentadas (1225299, 1226228: 4 registrados y 1 oferta). Sin duplicar la bandera.
    try:
        from tools.compliance_rules._base import n_participantes_parser
        from tools.compliance_rules._rules_bidder import check_unique_bidder_rule
        ya_flag = any(isinstance(f, dict) and f.get("regla") == "unico_postor_alto" for f in state.get("pending_flags") or [])
        if not ya_flag and n_participantes_parser(state):
            out["unico_postor_alto"] = check_unique_bidder_rule(ocid, tool_context)
    except Exception as e:  # noqa: BLE001
        out["unico_postor_alto"] = {"regla": "unico_postor_alto", "triggered": False, "error": str(e)[:200]}
    out["_disparadas"] = [k for k, v in out.items() if isinstance(v, dict) and v.get("triggered")]
    state["reglas_lote1"] = out
    return out
check_oferta_igual_valor_referencial_rule_tool = _as_tool(check_oferta_igual_valor_referencial_rule)
check_ofertas_agrupadas_rule_tool = _as_tool(check_ofertas_agrupadas_rule)
check_unica_oferta_valida_rule_tool = _as_tool(check_unica_oferta_valida_rule)
check_ganador_no_invitado_rule_tool = _as_tool(check_ganador_no_invitado_rule)
check_firmante_con_empresa_rnp_rule_tool = _as_tool(check_firmante_con_empresa_rnp_rule)
check_ampliacion_denegada_penalidad_rule_tool = _as_tool(check_ampliacion_denegada_penalidad_rule)
check_postores_vinculados_rnp_rule_tool = _as_tool(check_postores_vinculados_rnp_rule)
check_oferta_mas_barata_no_gana_rule_tool = _as_tool(check_oferta_mas_barata_no_gana_rule)
check_fecha_buena_pro_incoherente_rule_tool = _as_tool(check_fecha_buena_pro_incoherente_rule)
run_reglas_lote1_tool = FunctionTool(func=run_reglas_lote1)
