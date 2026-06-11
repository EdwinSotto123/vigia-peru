"""Tools del dominio: sunat."""

from tools._core import *  # noqa: F401,F403

def query_sunat_decolecta(ruc: str, tool_context: ToolContext) -> dict:
    """Consulta el endpoint de decolecta para obtener datos SUNAT del RUC.
    Esta tool es PREFERIBLE a hacer scraping de SUNAT vía Google Search.
    Cubre: razón social, tipo, condición, estado, dirección, ubigeo, CIIU,
    fecha de inicio de actividades, sistema de emisión, comercio exterior.

    Args:
        ruc: RUC peruano de 11 dígitos (string).

    Returns:
        Diccionario con la respuesta normalizada o {"error": ...}.
        Ejemplo:
          {
            "ruc": "20100028698",
            "razon_social": "FERREYROS S.A.",
            "tipo": "SOCIEDAD ANONIMA",
            "estado": "ACTIVO",
            "condicion": "HABIDO",
            "direccion": "...",
            "departamento": "LIMA", "provincia": "LIMA", "distrito": "MIRAFLORES",
            "ciiu_principal": "5190 - VENTA AL POR MAYOR DE OTROS PRODUCTOS",
            "fecha_inicio_actividades": "1925-07-15",
            "edad_dias": 36900,
            "_source": "decolecta",
          }
    """
    ruc = (ruc or "").strip().replace("PE-RUC-", "")
    if len(ruc) != 11 or not ruc.isdigit():
        # Esperado para proveedores extranjeros. NO es error fatal.
        return {
            "found": False,
            "ruc_consultado": ruc,
            "razon": (
                f"RUC {ruc!r} no tiene formato peruano estándar (11 dígitos). "
                "Típicamente significa proveedor NO DOMICILIADO en Perú. SUNAT "
                "no tiene este tipo de RUC en su registro. CONTINUÁ con el flujo: "
                "delegá web_research_agent para investigar la empresa en fuentes "
                "internacionales."
            ),
        }
    if not DECOLECTA_API_KEY:
        return {"error": "DECOLECTA_API_KEY no configurada en el entorno del Cloud Run",
                "hint": "gcloud run services update agent-orchestrator-adk --region us-central1 --update-env-vars DECOLECTA_API_KEY=sk_xxxx"}
    # IMPORTANTE: usar `/sunat/ruc/full` en lugar de `/sunat/ruc`. El endpoint
    # básico solo trae razon_social/estado/condicion/ubigeo — devuelve
    # `tipo=null, ciiu=null` aunque el RUC esté activo. `/full` agrega:
    # `tipo` (PERSONA NATURAL CON NEGOCIO / SOCIEDAD ANÓNIMA / etc),
    # `actividad_economica` (CIIU descriptivo), `numero_trabajadores`,
    # `tipo_facturacion`, `tipo_contabilidad`, `comercio_exterior`.
    # Bug detectado 2026-05-25 en OCID 1212841 — el agente reportaba "perfil
    # SUNAT anómalamente escueto" cuando la API SÍ tenía los datos.
    try:
        r = requests.get(
            f"{DECOLECTA_BASE}/sunat/ruc/full",
            params={"numero": ruc},
            headers={"Authorization": f"Bearer {DECOLECTA_API_KEY}",
                     "Accept": "application/json"},
            timeout=15,
        )
        # Fallback al endpoint básico si /full no existe o falla (plan free)
        if r.status_code in (404, 403):
            r = requests.get(
                f"{DECOLECTA_BASE}/sunat/ruc",
                params={"numero": ruc},
                headers={"Authorization": f"Bearer {DECOLECTA_API_KEY}",
                         "Accept": "application/json"},
                timeout=15,
            )
    except Exception as e:
        return {"error": f"network: {str(e)[:200]}"}
    if r.status_code == 401 or r.status_code == 403:
        return {"error": f"HTTP {r.status_code} — API key inválida o sin créditos",
                "body": r.text[:200]}
    if r.status_code == 404:
        return {"error": "ruc_not_found", "ruc": ruc}
    if r.status_code != 200:
        return {"error": f"HTTP {r.status_code}", "body": r.text[:200]}
    try:
        data = r.json() or {}
    except Exception:
        return {"error": "non-json response", "body": r.text[:200]}

    # Decolecta normaliza algunos campos; nosotros emparejamos a la forma que
    # consume el web_research_agent.
    fecha_inicio = (
        data.get("fecha_inicio_actividades")
        or data.get("fecha_inscripcion")
        or data.get("registration_date")
    )
    edad_dias = None
    if fecha_inicio:
        try:
            from datetime import datetime, date
            d = datetime.strptime(fecha_inicio[:10], "%Y-%m-%d").date()
            edad_dias = (date.today() - d).days
        except Exception:
            pass

    out = {
        "ruc": data.get("ruc") or ruc,
        "razon_social": data.get("razon_social") or data.get("nombre"),
        "tipo": data.get("tipo_contribuyente") or data.get("tipo"),
        "estado": data.get("estado") or data.get("estado_contribuyente"),
        "condicion": data.get("condicion") or data.get("condicion_domicilio"),
        "direccion": data.get("direccion") or data.get("domicilio_fiscal"),
        "departamento": data.get("departamento") or data.get("ubigeo_departamento"),
        "provincia": data.get("provincia") or data.get("ubigeo_provincia"),
        "distrito": data.get("distrito") or data.get("ubigeo_distrito"),
        "ubigeo": data.get("ubigeo"),
        "ciiu_principal": data.get("actividad_economica") or data.get("ciiu"),
        "actividades_economicas": data.get("actividades_economicas") or [],
        "sistema_emision": data.get("sistema_emision_comprobante") or data.get("sistema_emision"),
        "sistema_contabilidad": data.get("sistema_contabilidad"),
        "comercio_exterior": data.get("comercio_exterior") or data.get("actividad_comercio_exterior"),
        "fecha_inicio_actividades": fecha_inicio,
        "edad_dias": edad_dias,
        "_source": "decolecta",
        "_raw_keys": list(data.keys()),
    }
    # Guardar en state para que el report_writer pueda acceder al perfil
    tool_context.state.setdefault("sunat_profiles", {})[ruc] = out
    return out

def read_sunat_profile(tool_context: ToolContext) -> dict:
    """Devuelve el perfil SUNAT (decolecta) del proveedor ganador. Self-contained:
    si está cacheado en state, lo retorna; si no, lo consulta via
    `query_sunat_decolecta` con el RUC del ganador (state['ocds']) y lo cachea.

    Args:
        (sin args) — usa el RUC del ganador del OCID actual.

    Returns:
        dict con el JSON crudo de decolecta o {error: ...} si no hay ganador.
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
    dl_base = os.getenv("LOCAL_DOWNLOADER_URL", "").strip()
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
    `query_sunat_decolecta` (si hay cuota) o universidadperu.

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

    _NORMA = "Art. 50 TUO Ley 30225 (impedimentos para contratar)"
    senales = []
    # "No apto / no habilitado" es una acusación ALTA. El booleano esApto/esHab
    # del OECE llega a veces inconsistente (=false sin NINGÚN impedimento real).
    # Para NO acusar en falso: solo lo emitimos si hay un impedimento concreto
    # en la MISMA respuesta OECE que lo corrobore (sanción / inhabilitación /
    # medida cautelar). Si dice "no apto" con listas vacías → dato contradictorio
    # → no se emite la bandera (preferimos no acusar antes que acusar mal).
    _impedimentos = bool(sanciones or inh_jud or inh_adm or med_caut)
    if es_apto is False and _impedimentos:
        _det = []
        if sanciones:          _det.append(f"{len(sanciones)} sanción(es)")
        if inh_jud or inh_adm: _det.append(f"{len(inh_jud) + len(inh_adm)} inhabilitación(es)")
        if med_caut:           _det.append(f"{len(med_caut)} medida(s) cautelar(es)")
        senales.append({"regla": "proveedor_no_apto_contratar", "severidad": "alta", "norma": _NORMA,
                        "evidencia": f"OECE marca al proveedor RUC {ruc} como NO apto para contratar, corroborado por: {', '.join(_det)}."})
    if es_hab is False and _impedimentos:
        senales.append({"regla": "proveedor_no_habilitado_rnp", "severidad": "alta", "norma": _NORMA,
                        "evidencia": f"OECE marca al proveedor RUC {ruc} como NO habilitado en el RNP, con impedimentos registrados."})
    if inh_jud:
        senales.append({"regla": "inhabilitacion_judicial_vigente", "severidad": "alta", "norma": _NORMA,
                        "evidencia": f"OECE reporta {len(inh_jud)} inhabilitación(es) judicial(es) vigente(s) para el RUC {ruc}."})
    if inh_adm:
        senales.append({"regla": "inhabilitacion_administrativa_vigente", "severidad": "alta", "norma": _NORMA,
                        "evidencia": f"OECE reporta {len(inh_adm)} inhabilitación(es) administrativa(s) para el RUC {ruc}."})
    if sanciones:
        senales.append({"regla": "sancion_vigente_oece", "severidad": "alta", "norma": _NORMA,
                        "evidencia": f"OECE reporta {len(sanciones)} sanción(es) para el RUC {ruc}."})

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
        "n_inhabilitaciones_judiciales": len(inh_jud),
        "n_inhabilitaciones_administrativas": len(inh_adm),
        "n_penalidades": len(penalidades),
        "n_medidas_cautelares": len(med_caut),
        "sanciones": sanciones[:10],
        "inhabilitaciones_judiciales": inh_jud[:10],
        "inhabilitaciones_administrativas": inh_adm[:10],
        "senales": senales,
        "fuente_url": f"https://apps.oece.gob.pe/perfilprov-ui/ficha/{ruc}",
        "_source": "oece_perfilprov",
    }
    tool_context.state.setdefault("oece_perfiles", {})[ruc] = out
    return out


_MESES_ES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}


def _up_slug(razon: str) -> str:
    """Deriva el slug de universidadperu desde la razón social (best-effort)."""
    import unicodedata
    s = unicodedata.normalize("NFD", razon or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"\b(e\.?i\.?r\.?l|s\.?a\.?c|s\.?r\.?l(tda)?|s\.?a\.?a|s\.?a|s\.?c\.?r\.?l)\.?\b", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return re.sub(r"-+", "-", s)


def _fetch_text_via_downloader(url: str):
    """Trae el BODY (texto/HTML) de una URL vía el downloader local (IP PE +
    headers de navegador → pasa anti-bots que rechazan UAs mínimos). Fallback
    directo si no hay downloader."""
    dl_base = os.getenv("LOCAL_DOWNLOADER_URL", "").strip()
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
    """Fallback para EDAD del RUC (fecha de alta) y CIIU cuando decolecta no
    tiene cuota. Scrapea universidadperu.com (vía downloader) usando un slug
    derivado de la razón social, y VERIFICA que el RUC de la página coincida
    con el pedido (si no, descarta — nunca devuelve data de otra empresa).
    Cobertura PARCIAL: el slug acierta para muchas empresas, no todas.

    Args:
        ruc: RUC peruano de 11 dígitos.
        razon_social: razón social (del OCDS) — se usa para armar el slug.

    Returns:
        dict con fecha_inicio_actividades, edad_dias, ciiu, tipo, estado_domicilio,
        o {found: false} si el slug no resolvió o el RUC no coincide.
    """
    ruc = (ruc or "").strip().replace("PE-RUC-", "")
    if len(ruc) != 11 or not ruc.isdigit() or not razon_social:
        return {"found": False, "razon": "RUC inválido o sin razón social para derivar slug."}
    slug = _up_slug(razon_social)
    if not slug:
        return {"found": False, "razon": "no se pudo derivar slug de la razón social."}
    html = _fetch_text_via_downloader(f"https://www.universidadperu.com/empresas/{slug}.php")
    if not html:
        return {"found": False, "slug": slug, "razon": "página no encontrada (slug no resolvió) o fetch falló."}

    # VERIFICACIÓN DE RUC: el slug puede caer en otra empresa de nombre similar.
    rucs_en_pag = re.findall(r"\b(\d{11})\b", html)
    if ruc not in rucs_en_pag:
        return {"found": False, "slug": slug,
                "razon": f"el slug resolvió a otra empresa (RUC {ruc} no está en la página). Descartado por seguridad."}

    def _campo(label):
        m = re.search(re.escape(label) + r"\s*</[^>]+>\s*<[^>]+>\s*([^<]{1,80})", html)
        return m.group(1).strip() if m else None

    fecha_txt = _campo("Fecha Inicio Actividades")  # ej. "30 / Diciembre / 2023"
    fecha_iso, edad_dias = None, None
    if fecha_txt:
        m = re.match(r"(\d{1,2})\s*/\s*([A-Za-zÁÉÍÓÚáéíóú]+)\s*/\s*(\d{4})", fecha_txt)
        if m:
            import unicodedata
            mes = "".join(c for c in unicodedata.normalize("NFD", m.group(2).lower())
                          if unicodedata.category(c) != "Mn")
            mm = _MESES_ES.get(mes)
            if mm:
                try:
                    from datetime import date
                    d = date(int(m.group(3)), mm, int(m.group(1)))
                    fecha_iso = d.isoformat()
                    edad_dias = (date.today() - d).days
                except Exception:
                    pass

    out = {
        "found": True,
        "ruc": ruc,
        "fecha_inicio_actividades": fecha_iso or fecha_txt,
        "edad_dias": edad_dias,
        "ciiu": _campo("CIIU"),
        "tipo": _campo("Tipo Empresa"),
        "estado_domicilio": _campo("Estado Domicilio"),
        "fuente_url": f"https://www.universidadperu.com/empresas/{slug}.php",
        "_source": "universidadperu",
    }
    # Cachear edad en el perfil de state si existe
    prof = tool_context.state.setdefault("sunat_profiles", {}).setdefault(ruc, {})
    if edad_dias is not None:
        prof.setdefault("edad_dias", edad_dias)
        prof.setdefault("fecha_inicio_actividades", fecha_iso)
    return out


# ── FunctionTool wrappers ──
read_sunat_profile_tool = FunctionTool(func=read_sunat_profile)
query_sunat_decolecta_tool = FunctionTool(func=query_sunat_decolecta)
query_oece_perfil_tool = FunctionTool(func=query_oece_perfil)
query_edad_ciiu_web_tool = FunctionTool(func=query_edad_ciiu_web)
