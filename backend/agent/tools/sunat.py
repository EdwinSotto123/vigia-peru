"""Tools del dominio: sunat."""

from tools._core import *  # noqa: F401,F403
from tools._core import downloader_base
from datetime import date



def _perfil_de_la_base(ruc: str, tool_context: ToolContext) -> dict:
    """El perfil del RUC con lo que hay en la base de Vigía (padrón de la SUNAT, RNP, CONOSCE). Sin red."""
    state = tool_context.state
    cache = (state.get("sunat_profiles") or {}).get(ruc)
    if isinstance(cache, dict) and cache and not cache.get("error"):
        return cache
    from tools.expediente import _perfil_persona, _perfil_sunat, expediente_proveedor_bd
    try:
        exp = expediente_proveedor_bd(ruc, None, None, _fecha_buena_pro_state(state))
    except Exception as e:  # noqa: BLE001
        return {"found": False, "ruc": ruc, "razon": f"la base no respondió: {str(e)[:120]}", "_source": "base_vigia"}
    s_ = exp.get("sunat") or {}
    if s_.get("estado") or s_.get("fecha_inicio_actividades"):
        perfil = _perfil_sunat(ruc, exp)
        state.setdefault("sunat_profiles", {})[ruc] = perfil
        return perfil
    if exp.get("persona_natural"):
        return _perfil_persona(ruc, exp)
    return {"found": False, "ruc": ruc, "razon": "El RUC no figura en el padrón de la SUNAT que tiene Vigía.",
            "_source": "base_vigia"}


def query_sunat_decolecta(ruc: str, tool_context: ToolContext) -> dict:
    """Perfil SUNAT del RUC desde la base de Vigía (padrón de la SUNAT, RNP y CONOSCE). No consulta ningún servicio
    externo: el nombre de la herramienta es histórico.

    Args:
        ruc: RUC peruano de 11 dígitos (string).

    Returns:
        Diccionario con razón social, estado, condición, actividad, fecha de inicio y edad en días al contratar; para
        una persona natural, su trayectoria con el Estado; {"found": false} si no figura.
    """
    ruc = (ruc or "").strip().replace("PE-RUC-", "")
    if len(ruc) != 11 or not ruc.isdigit():
        return {
            "found": False,
            "ruc_consultado": ruc,
            "razon": (
                f"RUC {ruc!r} no tiene formato peruano estándar (11 dígitos). Típicamente es un proveedor no "
                "domiciliado en el Perú o un consorcio. Continúa con el flujo."
            ),
        }
    return _perfil_de_la_base(ruc, tool_context)


def read_sunat_profile(tool_context: ToolContext) -> dict:
    """Devuelve el perfil SUNAT del proveedor ganador, de la base de Vigía. Self-contained:
    si está cacheado en state, lo retorna; si no, lo lee de la base con el RUC del ganador (state['ocds']).

    Args:
        (sin args) — usa el RUC del ganador del OCID actual.

    Returns:
        dict con el perfil o {error: ...} si no hay ganador.
    """
    state = tool_context.state
    cache = state.get("sunat_decolecta")
    if cache and isinstance(cache, dict) and not cache.get("error"):
        return cache
    ocds = state.get("ocds") or {}
    # OCDS guarda los suppliers en `parties[]` con role 'supplier' (NO en
    # `suppliers` — eso es el return value de fetch_ocds_record, no el state).
    parties = ocds.get("parties") or []
    supplier_party = next(
        (p for p in parties if "supplier" in (p.get("roles") or [])),
        None,
    )
    ruc = None
    if supplier_party:
        ident = supplier_party.get("identifier") or {}
        ruc = ident.get("id") if ident.get("scheme") == "PE-RUC" else None
        if not ruc:
            # Fallback: party.id puede ser 'PE-RUC-XXXXXXXX'
            ruc = (supplier_party.get("id") or "").replace("PE-RUC-", "") or None
    if not ruc:
        return {"error": "no hay supplier con RUC en OCDS parties[]", "ruc": None}
    result = query_sunat_decolecta(ruc=ruc, tool_context=tool_context)
    state["sunat_decolecta"] = result
    return result

_OECE_EAP = "https://eap.oece.gob.pe"


def _oece_fetch_json(url: str):
    """GET una URL de OECE y devuelve el JSON. Usa el downloader local (IP
    residencial PE) si está configurado — OECE bloquea las IPs de Cloud Run con
    403. Fallback a GET directo (suele fallar desde GCP)."""
    dl_base = downloader_base()
    if dl_base:
        try:
            r = requests.post(
                f"{dl_base.rstrip('/')}/fetch",
                json={"url": url},
                headers={"X-Vigia-Token": os.getenv("LOCAL_DOWNLOADER_TOKEN", "")},
                timeout=60,
            )
            if r.status_code == 200:
                data = r.json() or {}
                if data.get("ok") and data.get("body"):
                    return _safe_parse_json(data["body"])
        except Exception:
            pass
    try:
        r = requests.get(url, headers=BROWSER, timeout=30)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None


def query_oece_perfil(ruc: str, tool_context: ToolContext) -> dict:
    """Perfil de proveedor del OECE — reemplaza/complementa decolecta cuando su
    cuota se agota. Trae (gratis, sin cuota, IP-PE vía downloader): estado SUNAT,
    conformación (DNIs de socios/representantes/órganos), ANTECEDENTES (sanciones,
    inhabilitaciones judiciales/administrativas, penalidades, medidas cautelares)
    y la APTITUD para contratar (esAptoContratar / esHabilitado).

    ⚠ Edad del RUC (fecha de alta) y CIIU NO vienen en OECE — para esos usá
    `query_sunat_decolecta` (padrón en la base de Vigía).

    Args:
        ruc: RUC peruano de 11 dígitos.

    Returns:
        dict con estado SUNAT + sanciones/inhabilitaciones + es_apto_contratar +
        socios + `senales` (banderas sugeridas para add_contextual_flag).
    """
    ruc = (ruc or "").strip().replace("PE-RUC-", "")
    if len(ruc) != 11 or not ruc.isdigit():
        return {"found": False, "ruc_consultado": ruc,
                "razon": "RUC sin formato peruano (11 dígitos) — posible proveedor no domiciliado."}

    cns = _oece_fetch_json(f"{_OECE_EAP}/ficha-proveedor-cns/1.0/ficha/{ruc}") or {}
    bus = _oece_fetch_json(f"{_OECE_EAP}/perfilprov-bus/1.0/ficha/{ruc}") or {}
    if not cns and not bus:
        return {"error": "oece_unreachable",
                "hint": "El downloader local debe estar prendido (OECE bloquea Cloud Run con 403)."}

    ds = cns.get("datosSunat") or {}
    conf = cns.get("conformacion") or {}
    ant = cns.get("antecedentes") or {}
    prov = bus.get("proveedorT01") or {}

    def _dnis(s):
        if isinstance(s, str):
            return [x for x in (p.strip() for p in s.split(",")) if x]
        if isinstance(s, list):
            return [str(x) for x in s if x]
        return []

    es_apto = prov.get("esAptoContratar")
    es_hab = prov.get("esHabilitado")
    sanciones = ant.get("sanciones") or []
    inh_jud = ant.get("inhsJudicial") or []
    inh_adm = ant.get("inhsAdministrativa") or []
    penalidades = ant.get("penalidades") or []
    med_caut = ant.get("medidasCautelares") or []

    fecha_ref = _fecha_buena_pro_state(tool_context.state)
    senales, sanciones_clasificadas = clasificar_sanciones_oece(ruc, sanciones, inh_jud, inh_adm,
                                                              med_caut, penalidades, es_apto, es_hab,
                                                              fecha_ref, tool_context.state)

    out = {
        "ruc": ruc,
        "razon_social": ds.get("razon") or prov.get("nomRzsProv"),
        "tipo": ds.get("tipoEmpresa"),
        "estado": ds.get("estado"),
        "condicion": ds.get("condicion"),
        "departamento": ds.get("departamento"),
        "provincia": ds.get("provincia"),
        "distrito": ds.get("distrito"),
        "es_apto_contratar": es_apto,
        "es_habilitado": es_hab,
        "emails": prov.get("emails") or [],
        "telefonos": prov.get("telefonos") or [],
        "socios_dni": _dnis(conf.get("listaDniSocios")),
        "representantes_dni": _dnis(conf.get("listaDniRepresentantes")),
        "organos_dni": _dnis(conf.get("listaDniOrganos")),
        "n_sanciones": len(sanciones),
        "n_sanciones_vigentes": sanciones_clasificadas["n_vigentes"],
        "n_sanciones_historicas": sanciones_clasificadas["n_historicas"],
        "n_inhabilitaciones_judiciales": len(inh_jud),
        "n_inhabilitaciones_administrativas": len(inh_adm),
        "n_penalidades": len(penalidades),
        "n_medidas_cautelares": len(med_caut),
        "sanciones": sanciones[:10],
        "sanciones_detalle": sanciones_clasificadas["detalle"][:10],
        "inhabilitaciones_judiciales": inh_jud[:10],
        "inhabilitaciones_administrativas": inh_adm[:10],
        "penalidades": penalidades[:10],
        "fecha_referencia_vigencia": str(fecha_ref) if fecha_ref else None,
        "senales": senales,
        "fuente_url": f"https://apps.oece.gob.pe/perfilprov-ui/ficha/{ruc}",
        "_source": "oece_perfilprov",
    }
    tool_context.state.setdefault("oece_perfiles", {})[ruc] = out
    return out



def _cuantas(n: int, una: str, varias: str) -> str:
    """«1 sanción», «2 sanciones»: la evidencia la lee una persona, no «sanción(es)»."""
    return f"{n} {una if n == 1 else varias}"

# ─── Clasificación de antecedentes OECE (lote 1 · T10 + penalidades) ────────────
#
# Antes: cualquier elemento de `sanciones` → `sancion_vigente_oece` ALTA, aunque fuera una
# multa ya pagada y el proveedor estuviera apto (1225058: multa de S/ 5 500, `vigente=false`,
# `esAptoContratar=true`). Ahora: solo es "vigente" si el propio registro lo dice (`vigente`
# true, `fechaFin` posterior a la buena pro, `estado` VIGENTE, o inhabilitación sin fecha fin);
# lo demás es `sancion_historica_oece` (baja). Las penalidades son ejecución contractual
# histórica: `penalidades_oece_historicas` baja (1-2) / media (≥ 3; 1225090 traía 3 y el
# dictamen decía 0).

def _fecha_buena_pro_state(state: dict):
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    for a in (ocds.get("awards") or []):
        d = str((a or {}).get("date") or "")[:10]
        try:
            return _dt.date.fromisoformat(d)
        except ValueError:
            continue
    return None


def _parse_fecha_oece(v):
    s = str(v or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            return _dt.datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return None


def _get_ci(d: dict, *claves):
    """Primer valor no vacío de `d` para cualquiera de las claves (insensible a mayúsculas)."""
    if not isinstance(d, dict):
        return None
    low = {str(k).lower(): v for k, v in d.items()}
    for k in claves:
        v = low.get(k.lower())
        if v not in (None, "", [], {}):
            return v
    return None


def _norma_impedimentos(state: dict) -> str:
    try:
        from tools.compliance_rules import norma_aplicable, _fecha_convocatoria_state
        return norma_aplicable(_fecha_convocatoria_state(state or {}))["impedimentos"]
    except Exception:
        return "Art. 30 Ley 32069 — impedimentos para contratar"


def _sancion_es_vigente(s: dict, fecha_ref) -> tuple[bool, str]:
    """(vigente, motivo) para una sanción OECE a la fecha de referencia (buena pro; hoy si
    no hay). Tolerante a los nombres de campo del OECE (vigente / indVigente / estado /
    fechaFin / fechaHasta / indPago / descripcion / tipoSancion)."""
    fecha_ref = fecha_ref or _dt.date.today()
    v = _get_ci(s, "vigente", "indVigente", "esVigente", "flagVigente")
    if isinstance(v, bool):
        return v, "campo vigente"
    if isinstance(v, str) and v.strip().upper() in ("S", "SI", "SÍ", "TRUE", "1", "N", "NO", "FALSE", "0"):
        return v.strip().upper() in ("S", "SI", "SÍ", "TRUE", "1"), "campo vigente"
    estado = str(_get_ci(s, "estado", "estadoSancion", "situacion") or "").upper()
    if "VIGENTE" in estado and "NO VIGENTE" not in estado:
        return True, "estado VIGENTE"
    if any(k in estado for k in ("NO VIGENTE", "CUMPLID", "PAGAD", "CANCELAD", "LEVANTAD", "VENCID", "CONCLUID")):
        return False, f"estado {estado[:30]}"
    fin = _parse_fecha_oece(_get_ci(s, "fechaFin", "fechaHasta", "fecha_fin", "fechaTermino", "fechaVencimiento"))
    if fin:
        return fin >= fecha_ref, f"fechaFin {fin} vs {fecha_ref}"
    pago = str(_get_ci(s, "indPago", "pagado", "pago", "estadoPago") or "").upper()
    tipo = str(_get_ci(s, "descripcion", "tipoSancion", "tipo", "sancion") or "").upper()
    if "MULTA" in tipo and pago in ("S", "SI", "SÍ", "TRUE", "1", "PAGADO", "PAGADA", "CANCELADO"):
        return False, "multa pagada"
    if "INHABILIT" in tipo and not fin:
        return True, "inhabilitación sin fecha fin"
    if "MULTA" in tipo:
        return False, "multa sin indicador de vigencia (se trata como histórica)"
    return False, "sin indicador de vigencia (se trata como histórica)"


def clasificar_sanciones_oece(ruc: str, sanciones: list, inh_jud: list, inh_adm: list, med_caut: list,
                              penalidades: list, es_apto, es_hab, fecha_ref, state: dict | None = None) -> tuple[list, dict]:
    """Señales (para `add_contextual_flag`) + detalle clasificado de las sanciones."""
    norma = _norma_impedimentos(state or {})
    senales: list[dict] = []
    detalle: list[dict] = []
    vigentes, historicas = [], []
    for s in (sanciones or []):
        if not isinstance(s, dict):
            continue
        vig, motivo = _sancion_es_vigente(s, fecha_ref)
        d = {"vigente": vig, "motivo_vigencia": motivo,
             "tipo": _get_ci(s, "descripcion", "tipoSancion", "tipo", "sancion"),
             "resolucion": _get_ci(s, "nroRes", "resolucion", "numeroResolucion", "nroResolucion"),
             "infraccion": (str(_get_ci(s, "infraccion", "motivo", "causal", "descripcionInfraccion") or ""))[:160],
             "monto": _get_ci(s, "monto", "montoMulta", "importe"),
             "fecha_inicio": _get_ci(s, "fechaInicio", "fechaDesde", "fecha_inicio"),
             "fecha_fin": _get_ci(s, "fechaFin", "fechaHasta", "fecha_fin"),
             "pago": _get_ci(s, "indPago", "pagado", "estadoPago")}
        detalle.append(d)
        (vigentes if vig else historicas).append(d)

    _impedimentos = bool(vigentes or inh_jud or inh_adm or med_caut)
    if es_apto is False and _impedimentos:
        _det = []
        if vigentes:           _det.append(_cuantas(len(vigentes), "sanción vigente", "sanciones vigentes"))
        if inh_jud or inh_adm: _det.append(_cuantas(len(inh_jud) + len(inh_adm), "inhabilitación", "inhabilitaciones"))
        if med_caut:           _det.append(_cuantas(len(med_caut), "medida cautelar", "medidas cautelares"))
        senales.append({"regla": "proveedor_no_apto_contratar", "severidad": "alta", "norma": norma,
                        "evidencia": f"OECE marca al proveedor RUC {ruc} como NO apto para contratar, corroborado por: {', '.join(_det)}."})
    if es_hab is False and _impedimentos:
        senales.append({"regla": "proveedor_no_habilitado_rnp", "severidad": "alta", "norma": norma,
                        "evidencia": f"OECE marca al proveedor RUC {ruc} como NO habilitado en el RNP, con impedimentos registrados."})
    if inh_jud:
        senales.append({"regla": "inhabilitacion_judicial_vigente", "severidad": "alta", "norma": norma,
                        "evidencia": f"OECE reporta {len(inh_jud)} inhabilitación(es) judicial(es) vigente(s) para el RUC {ruc}."})
    if inh_adm:
        senales.append({"regla": "inhabilitacion_administrativa_vigente", "severidad": "alta", "norma": norma,
                        "evidencia": f"OECE reporta {len(inh_adm)} inhabilitación(es) administrativa(s) para el RUC {ruc}."})

    def _desc(d: dict) -> str:
        partes = [str(d.get("tipo") or "sanción")]
        if d.get("resolucion"):
            partes.append(f"Res. {d['resolucion']}")
        if d.get("infraccion"):
            partes.append(f"motivo: {d['infraccion'][:100]}")
        if d.get("monto"):
            partes.append(f"S/ {d['monto']}")
        if d.get("fecha_fin"):
            partes.append(f"hasta {d['fecha_fin']}")
        return "; ".join(partes)

    if vigentes:
        ref_txt = f" a la fecha de la buena pro ({fecha_ref})" if fecha_ref else ""
        senales.append({"regla": "sancion_vigente_oece", "severidad": "alta", "norma": norma,
                        "evidencia": (f"OECE reporta {_cuantas(len(vigentes), 'sanción vigente', 'sanciones vigentes')}{ref_txt} para el RUC {ruc}: "
                                      f"{_desc(vigentes[0])}.")[:500]})
    if historicas:
        senales.append({"regla": "sancion_historica_oece", "severidad": "baja", "norma": norma,
                        "evidencia": (f"Antecedente (no vigente): OECE registra {_cuantas(len(historicas), 'sanción histórica', 'sanciones históricas')} "
                                      f"para el RUC {ruc}: {_desc(historicas[0])} ({historicas[0].get('motivo_vigencia')}). "
                                      f"No es impedimento para contratar; es un antecedente de cumplimiento a considerar.")[:500]})
    n_pen = len(penalidades or [])
    if n_pen:
        pen0 = penalidades[0] if isinstance(penalidades[0], dict) else {}
        det_pen = _get_ci(pen0, "descripcion", "tipoPenalidad", "tipo", "motivo") or ""
        ent_pen = _get_ci(pen0, "entidad", "nombreEntidad", "razonEntidad") or ""
        senales.append({"regla": "penalidades_oece_historicas", "severidad": "media" if n_pen >= 3 else "baja",
                        "norma": "Reglamento — penalidades en la ejecución contractual (antecedente OECE)",
                        "evidencia": (f"OECE registra {n_pen} penalidad(es) aplicada(s) al RUC {ruc} en contratos anteriores"
                                      + (f" (p. ej. {str(det_pen)[:80]}" + (f", {str(ent_pen)[:60]}" if ent_pen else "") + ")" if det_pen else "")
                                      + ". Antecedente de ejecución contractual, no impedimento.")[:500]})
    return senales, {"n_vigentes": len(vigentes), "n_historicas": len(historicas), "detalle": detalle}


def _fetch_text_via_downloader(url: str):
    """Trae el BODY (texto/HTML) de una URL vía el downloader local (IP PE +
    headers de navegador → pasa anti-bots que rechazan UAs mínimos). Fallback
    directo si no hay downloader."""
    dl_base = downloader_base()
    if dl_base:
        try:
            r = requests.post(
                f"{dl_base.rstrip('/')}/fetch",
                json={"url": url},
                headers={"X-Vigia-Token": os.getenv("LOCAL_DOWNLOADER_TOKEN", "")},
                timeout=60,
            )
            if r.status_code == 200:
                data = r.json() or {}
                if data.get("ok") and data.get("body"):
                    return data["body"]
        except Exception:
            pass
    try:
        r = requests.get(url, headers=BROWSER, timeout=30)
        if r.status_code == 200:
            return r.text
    except Exception:
        pass
    return None


def query_edad_ciiu_web(ruc: str, razon_social: str, tool_context: ToolContext) -> dict:
    """Edad del RUC y actividad desde la base de Vigía. No consulta la web: el nombre es histórico.

    Args:
        ruc: RUC peruano de 11 dígitos.
        razon_social: razón social (no se usa).

    Returns:
        dict con fecha_inicio_actividades, edad_dias y ciiu, o {found: false}.
    """
    ruc = (ruc or "").strip().replace("PE-RUC-", "")
    if len(ruc) != 11 or not ruc.isdigit():
        return {"found": False, "razon": "RUC inválido."}
    p = _perfil_de_la_base(ruc, tool_context)
    if p.get("found") is False:
        return p
    return {"found": True, "ruc": ruc, "fecha_inicio_actividades": p.get("fecha_inicio_actividades"),
            "edad_dias": p.get("edad_dias"), "ciiu": p.get("ciiu_principal"), "tipo": p.get("tipo"),
            "_source": p.get("_source")}


# ── FunctionTool wrappers ──
read_sunat_profile_tool = FunctionTool(func=read_sunat_profile)
query_sunat_decolecta_tool = FunctionTool(func=query_sunat_decolecta)
query_oece_perfil_tool = FunctionTool(func=query_oece_perfil)
query_edad_ciiu_web_tool = FunctionTool(func=query_edad_ciiu_web)
