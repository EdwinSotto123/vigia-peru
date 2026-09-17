"""compliance_rules._rules_provider — reglas de proveedor: sancionado, RUC/CIIU, antigüedad."""

from tools._core import *  # noqa: F401,F403
from tools.compliance_rules._base import _as_tool, _ganador_ocds, _monto_adjudicado_ocds, _montos_ocds, _norma_state, _perfil_reglas, _postores_parser, _regla_omitida, _sin_tildes, _to_date  # noqa: F401


def check_sanctioned_provider_rule(ocid: str, tool_context: ToolContext,
                                   reglas_activas: frozenset[str] | None = None,
                                   topes_uit: dict | None = None) -> dict:
    """Evalúa C4 + C7 — proveedor adjudicado con sanción OSCE vigente o
    con SOCIOS/representantes sancionados (inhabilitado vía consorcio).

    Cruza contra `osce_sancionados_vigentes` (3,899 sanciones activas a hoy:
    1,101 definitivas + 2,078 temporales + 720 multas con suspensión cautelar).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia y listas:
          - empresas_sancionadas_directas[]
          - empresas_con_socios_sancionados[] (C7 — inhabilitado vía consorcio)
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("proveedor_sancionado_osce", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        if not _table_exists(cur, "osce_sancionados"):
            return {"regla": "proveedor_sancionado_osce", "triggered": False,
                    "dataset_no_disponible": True}

        cur.execute(
            """SELECT e.razon_social, e.ruc,
                      s.tipo, s.periodo, s.fecha_hasta, s.resolucion,
                      LEFT(s.infraccion, 200) AS infraccion_short
                 FROM postores p
                 JOIN ofertas o   ON o.postor_id = p.id AND o.ganadora
                 JOIN empresas e  ON e.ruc = p.empresa_ruc
                 JOIN osce_sancionados_vigentes s ON s.ruc = e.ruc
                WHERE p.ocid = %s""",
            (ocid,),
        )
        directas = [
            {"razon_social": r[0], "ruc": r[1], "tipo": r[2],
             "periodo": r[3], "vence": r[4].isoformat() if r[4] else "DEFINITIVO",
             "resolucion": r[5], "infraccion": r[6]}
            for r in cur.fetchall()
        ]

        socios_sancionados = []
        if _table_exists(cur, "rnp_conformacion_juridica"):
            cur.execute(
                """SELECT e.razon_social, e.ruc,
                          s.razon_social, s.ruc,
                          r.tipo_rol,
                          s.tipo, s.fecha_hasta, s.resolucion
                     FROM postores p
                     JOIN ofertas o  ON o.postor_id = p.id AND o.ganadora
                     JOIN empresas e ON e.ruc = p.empresa_ruc
                     JOIN rnp_conformacion_juridica r ON r.ruc_empresa = e.ruc
                     JOIN osce_sancionados_vigentes s
                          ON (s.es_persona_natural = TRUE AND SUBSTRING(s.ruc FROM 3 FOR 8) = r.numero_documento)
                    WHERE p.ocid = %s""",
                (ocid,),
            )
            socios_sancionados = [
                {"empresa_ganadora": r[0], "ruc_empresa": r[1],
                 "socio_sancionado": r[2], "ruc_socio": r[3],
                 "rol_en_empresa": r[4], "tipo_sancion": r[5],
                 "vence": r[6].isoformat() if r[6] else "DEFINITIVO",
                 "resolucion": r[7]}
                for r in cur.fetchall()
            ]

        triggered = bool(directas or socios_sancionados)
        result = {
            "regla": "proveedor_sancionado_osce",
            "triggered": triggered,
            "n_directas": len(directas),
            "n_socios_sancionados": len(socios_sancionados),
            "empresas_sancionadas_directas": directas,
            "empresas_con_socios_sancionados": socios_sancionados,
        }
        if triggered:
            if directas:
                principal = directas[0]
                ev = (f"{principal['razon_social']} — sanción {principal['tipo']} VIGENTE "
                      f"(vence {principal['vence']}, resolución {principal['resolucion']})")
            else:
                principal = socios_sancionados[0]
                ev = (f"{principal['empresa_ganadora']} es ganadora; su {principal['rol_en_empresa']} "
                      f"{principal['socio_sancionado']} (RUC {principal['ruc_socio']}) tiene sanción "
                      f"{principal['tipo_sancion']} VIGENTE — patrón 'inhabilitado vía consorcio' (C7).")
            result.update({
                "severidad": "alta",
                "evidencia": ev,
                "norma": _norma_state(tool_context.state)["impedimentos"],
                "fuente_url": "https://apps.osce.gob.pe/perfilprov-ui/inhabilitado.xhtml",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

def check_edad_ruc_ganador_rule(ocid: str, tool_context: ToolContext,
                                reglas_activas: frozenset[str] | None = None,
                                topes_uit: dict | None = None) -> dict:
    """Evalúa si el proveedor adjudicado tiene un RUC muy reciente (<2 años)
    para un contrato de monto considerable (>S/. 100K). Lee del state los
    perfiles SUNAT cargados por query_sunat_decolecta.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("ruc_ganador_muy_nuevo", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT e.ruc, e.razon_social, SUM(o.monto_ofertado) as monto_total
                 FROM postores p
                 JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                 JOIN empresas e ON e.ruc=p.empresa_ruc
                WHERE p.ocid=%s GROUP BY e.ruc, e.razon_social""",
            (ocid,),
        )
        ganadores = cur.fetchall()
        if not ganadores:
            return {"regla": "ruc_ganador_muy_nuevo", "triggered": False, "motivo": "sin ganadores en BD"}

        sunat_profiles = tool_context.state.get("sunat_profiles") or {}
        triggered_list = []
        from datetime import date
        for ruc, razon, monto in ganadores:
            monto_f = float(monto or 0)
            if monto_f < 100000:
                continue
            profile = sunat_profiles.get(ruc) or {}
            fecha_inicio = profile.get("fecha_inicio_actividades")
            edad_dias = profile.get("edad_dias")
            if not edad_dias and fecha_inicio:
                try:
                    from datetime import datetime
                    d = datetime.strptime(str(fecha_inicio)[:10], "%Y-%m-%d").date()
                    edad_dias = (date.today() - d).days
                except Exception:
                    edad_dias = None
            if edad_dias is not None and edad_dias < 730:  # < 2 años
                triggered_list.append({
                    "ruc": ruc,
                    "razon_social": razon,
                    "monto": monto_f,
                    "edad_dias": edad_dias,
                    "edad_meses": round(edad_dias / 30, 1),
                    "fecha_inicio": fecha_inicio,
                })
        result = {
            "regla": "ruc_ganador_muy_nuevo",
            "n_ganadores_evaluados": len(ganadores),
            "n_triggered": len(triggered_list),
            "detalle": triggered_list,
            "triggered": len(triggered_list) > 0,
        }
        if triggered_list:
            principal = triggered_list[0]
            result.update({
                "severidad": "alta",
                "evidencia": (
                    f"{principal['razon_social']} (RUC {principal['ruc']}) tiene "
                    f"{principal['edad_meses']} meses de antigüedad y recibe contrato por "
                    f"S/. {(principal.get('monto') or 0):,.2f}. Patrón típico de empresa creada para ganar contrato."
                ),
                "norma": "Heurística — " + _norma_state(tool_context.state)["impedimentos"],
                "fuente_url": f"https://sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc={principal['ruc']}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

def check_ciiu_vs_objeto_rule(ocid: str, tool_context: ToolContext,
                              reglas_activas: frozenset[str] | None = None,
                              topes_uit: dict | None = None) -> dict:
    """Verifica que el CIIU principal del proveedor sea coherente con el objeto
    del contrato. Si el CIIU es 'venta de textiles' y el contrato es 'compra de
    equipos médicos', es señal de proveedor improvisado o testaferro.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("ciiu_vs_objeto", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT c.objeto, e.ruc, e.razon_social
                 FROM convocatorias c
                 JOIN postores p ON p.ocid=c.ocid
                 JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                 JOIN empresas e ON e.ruc=p.empresa_ruc
                WHERE c.ocid=%s LIMIT 1""", (ocid,),
        )
        row = cur.fetchone()
        if not row:
            return {"regla": "ciiu_vs_objeto", "triggered": False, "motivo": "sin datos"}
        objeto, ruc, razon = row
        # Ítems del OCDS (descripción del producto real; el `objeto` suele ser el nombre
        # del proyecto: "…CARRETERA PAUCARTAMBO…" no dice "estación total").
        cur.execute("SELECT descripcion FROM convocatoria_items WHERE ocid=%s", (ocid,))
        descs_ocds = [r[0] for r in cur.fetchall() if r and r[0]]
    finally:
        conn.close()
    state = tool_context.state
    sunat = (state.get("sunat_profiles") or {}).get(ruc) or {}
    ciiu = (sunat.get("ciiu_principal") or "").lower()
    activs = sunat.get("actividades_economicas") or []
    if not ciiu and not activs:
        return {"regla": "ciiu_vs_objeto", "triggered": False, "estado": "sin_dato", "motivo": "sin CIIU disponible"}

    raw = state.get("parser_raw_consolidated") or {}
    descs_parser = [str(it.get("descripcion_corta") or "") for it in (raw.get("items_consolidados") or [])
                    if isinstance(it, dict)]
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    tender = ocds.get("tender") or {}
    descs_tender = [str(it.get("description") or "") for it in (tender.get("items") or []) if isinstance(it, dict)]
    texto_objeto = " ".join([objeto or "", tender.get("description") or ""] + descs_ocds + descs_tender + descs_parser)
    cat_objeto = _categoria_objeto(texto_objeto)
    ciiu_full = (ciiu + " " + " ".join(str(a) for a in activs)).lower()
    cat_ciiu = _categoria_ciiu(ciiu_full)

    result = {
        "regla": "ciiu_vs_objeto",
        "objeto_categoria": cat_objeto,
        "ciiu_categoria": cat_ciiu,
        "ciiu_principal": sunat.get("ciiu_principal"),
        "actividades": activs,
        "estado": "hallado" if (cat_objeto and cat_ciiu) else "sin_dato",
        "triggered": False,
    }
    if cat_objeto and cat_ciiu and not _categorias_compatibles(cat_objeto, cat_ciiu):
        result.update({
            "triggered": True,
            "severidad": "media",
            "evidencia": (
                f"{razon} (RUC {ruc}) declara ante SUNAT la actividad '{(sunat.get('ciiu_principal') or ciiu_full)[:80]}' "
                f"(rubro '{cat_ciiu}') mientras el objeto contratado es de '{cat_objeto}'. Señal de riesgo: "
                f"verificar la capacidad técnica y operativa real del proveedor para este rubro."
            ),
            "norma": "Heurística — coherencia rubro empresa vs objeto del contrato",
            "fuente_url": f"https://sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc={ruc}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result


# Categorías de objeto/CIIU (lote 1 · T11). Keywords específicas; se evita "mayor/menor/obra".
_CATEGORIAS_OBJETO: dict[str, tuple[str, ...]] = {
    "combustible": ("combustible", "diesel", "gasohol", "gasolina", "petroleo", "hidrocarburo", "glp", "gnv", "lubricante"),
    "alimentos": ("alimento", "comestible", "bebida", "viveres", "carne", "lacteo", "abarrote", "arroz", "azucar",
                  "aceite", "leche", "menestra", "harina", "quinua", "avena", "pollo", "huevo", "conserva", "racion",
                  "desayuno", "almuerzo", "canasta", "panaderia", "fideo"),
    "construccion": ("construccion", "ferreteria", "cemento", "agregado", "edificacion", "asfalto", "ladrillo",
                     "fierro", "acero", "drywall", "perfileria", "perfil ", "parante", "riel", "gavion", "piedra",
                     "arena", "hormigon", "geosintetico", "geomalla", "geotextil", "tuberia", "madera", "calamina",
                     "pintura", "poste", "concreto", "sanitario", "electrico"),
    "informatica": ("computadora", "informatica", "software", "tecnologia", "laptop", "impresora", "servidor",
                    "licencia", "monitor", "proyector", "tablet", "router", "switch", "scanner", "computo"),
    "equipos": ("equipo topografico", "topograf", "estacion total", "prisma", "tripode", "gps", "gnss",
                "instrumento", "medicion", "laboratorio", "analizador", "balanza", "microscopio", "equipamiento",
                "maquina", "generador", "compresor", "bomba", "motobomba", "soldadora", "electrobomba"),
    "vehiculos": ("vehiculo", "maquinaria", "camion", "volquete", "camioneta", "motocicleta", "ambulancia",
                  "excavadora", "cargador frontal", "retroexcavadora", "tractor", "cisterna", "llanta", "neumatico",
                  "repuesto"),
    "salud": ("medico", "farmaceutico", "hospital", "salud", "medicamento", "insumo medico", "reactivo",
              "inmunohematolog", "laboratorio clinico", "dispositivo medico", "jeringa", "vacuna", "odontolog"),
    "textil": ("textil", "calzado", "ropa", "uniforme", "confeccion", "vestuario", "prenda", "chompa", "buzo",
               "frazada", "colcha", "zapato", "zapatilla"),
    "mobiliario": ("mobiliario", "mueble", "silla", "escritorio", "carpeta", "estante", "armario", "pupitre"),
    "agropecuario": ("agropecuario", "agricola", "semilla", "fertilizante", "abono", "planton", "alevino",
                     "ganado", "vacuno", "ovino", "alpaca", "cuy", "pasto", "insecticida", "veterinari", "pecuari"),
    "limpieza": ("limpieza", "detergente", "lejia", "desinfectante", "papel higienico", "jabon", "escoba"),
    "oficina": ("utiles de oficina", "papeleria", "utiles de escritorio", "toner", "tinta", "impresion", "papel bond"),
    "seguridad": ("seguridad", "epp", "casco", "chaleco", "extintor", "camara de vigilancia", "vigilancia"),
}
# CIIU (texto de SUNAT/decolecta) → categoría. El CIIU habla en términos de "venta al por
# mayor/menor de …", "fabricación de …", "alquiler de …".
_CATEGORIAS_CIIU: dict[str, tuple[str, ...]] = {
    "combustible": ("combustible", "hidrocarburo", "estacion de servicio", "grifo", "lubricante", "gas licuado"),
    "alimentos": ("aliment", "bebida", "abarrote", "restaurant", "comida", "panader", "carne", "lacteo", "agroindustri"),
    "construccion": ("construccion", "ferreter", "material de construccion", "materiales de construccion", "pintura",
                     "vidrio", "metalic", "cemento", "hormigon", "edific", "acabado", "obras de ingenieria"),
    "informatica": ("informatic", "software", "computador", "ordenador", "tecnologia de la informacion", "programacion",
                    "equipo de computo"),
    "equipos": ("maquinaria", "equipo", "instrumento", "aparato", "electrico", "electronic", "optic", "precision"),
    "vehiculos": ("vehiculo", "automotor", "automovil", "camion", "motocicleta", "repuesto", "transporte", "llanta"),
    "salud": ("farmac", "medic", "hospital", "salud", "laboratorio", "odontolog", "clinic", "dental"),
    "textil": ("textil", "calzado", "prenda", "confeccion", "ropa", "vestir", "cuero"),
    "mobiliario": ("mueble", "mobiliario", "carpinter"),
    "agropecuario": ("agricol", "agropecuari", "ganader", "pecuari", "cultivo", "cria de", "veterinari", "silvicultura"),
    "limpieza": ("limpieza", "jabon", "detergente", "aseo"),
    "oficina": ("papeler", "utiles", "libreria", "imprenta", "impresion", "articulos de oficina"),
    "seguridad": ("seguridad", "vigilancia", "investigacion y seguridad"),
    "alquiler": ("alquiler", "arrendamiento", "arriendo", "leasing"),
    "servicios": ("consultor", "asesor", "contabil", "juridic", "arquitectura", "ingenieria", "publicidad",
                  "actividades de oficina", "servicios administrativos", "enseñanza", "educacion", "inmobiliari"),
    "comercio_general": ("otros productos", "productos diversos", "no especializ", "diversos", "otros tipos",
                         "n.c.p", "ncp", "otras actividades de venta", "bazar"),
}
# Pares compatibles (además de la igualdad): el CIIU "equipos" cubre instrumentos de salud
# y computo; "construccion" cubre "equipos" de obra; el comercio general cubre todo.
_CATEGORIAS_COMPATIBLES = {
    ("equipos", "informatica"), ("equipos", "salud"), ("equipos", "construccion"), ("equipos", "vehiculos"),
    ("equipos", "seguridad"), ("construccion", "seguridad"), ("construccion", "mobiliario"),
    ("salud", "limpieza"), ("oficina", "informatica"), ("oficina", "mobiliario"), ("alimentos", "agropecuario"),
    ("agropecuario", "combustible"), ("vehiculos", "combustible"), ("textil", "seguridad"),
}


def _categoria_objeto(texto: str) -> str | None:
    t = _sin_tildes(texto or "").lower()
    puntajes = {cat: sum(1 for kw in kws if kw in t) for cat, kws in _CATEGORIAS_OBJETO.items()}
    best = max(puntajes.items(), key=lambda kv: kv[1]) if puntajes else (None, 0)
    return best[0] if best[1] > 0 else None


def _categoria_ciiu(texto: str) -> str | None:
    t = _sin_tildes(texto or "").lower()
    # "alquiler de …" domina: un CIIU de alquiler no acredita venta del bien (1225392).
    if any(kw in t for kw in _CATEGORIAS_CIIU["alquiler"]) and not any(kw in t for kw in ("venta", "comercio")):
        return "alquiler"
    puntajes = {cat: sum(1 for kw in kws if kw in t) for cat, kws in _CATEGORIAS_CIIU.items() if cat != "alquiler"}
    best = max(puntajes.items(), key=lambda kv: kv[1]) if puntajes else (None, 0)
    return best[0] if best[1] > 0 else None


def _categorias_compatibles(cat_objeto: str, cat_ciiu: str) -> bool:
    if cat_objeto == cat_ciiu:
        return True
    if cat_ciiu == "comercio_general":
        return True
    if cat_ciiu in ("alquiler", "servicios"):
        return False
    return (cat_objeto, cat_ciiu) in _CATEGORIAS_COMPATIBLES or (cat_ciiu, cat_objeto) in _CATEGORIAS_COMPATIBLES

def check_ruc_ultra_nuevo_rule(ocid: str, tool_context: ToolContext,
                               reglas_activas: frozenset[str] | None = None,
                               topes_uit: dict | None = None) -> dict:
    """C10 — RUC ultra-nuevo: el proveedor adjudicado tiene RUC con
    `fecha_inicio_actividades` < 90 días antes de la buena pro y el monto ≥ 8 UIT
    (~S/. 41,200 con UIT 2026 = S/. 5,150). Patrón típico de empresa creada
    expressamente para ganar el contrato (puente, lavado o evasión).

    Refina `check_edad_ruc_ganador_rule` que solo dispara a > 2 años / > S/. 100K;
    esta detecta el caso más extremo y temprano.

    Norma: Art. 50 lit. d TUO Ley 30225 + Opinión OECE 056-2023 (empresa de papel).
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("ruc_ultra_nuevo", reglas)
    if om:
        return om
    state = tool_context.state
    sunat_profiles = state.get("sunat_profiles") or {}
    UIT_2026 = 5500
    UMBRAL = 8 * UIT_2026  # S/ 44 000 (contrataciones menores quedan fuera de la ley)

    # Lote 1 · T11: la regla evalúa a TODOS los postores (informe 1225266: el rival
    # ER & CO tenía RNP de 10 meses y `n_evaluados: 1`). Ganador → alta; perdedor → media.
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT e.ruc, e.razon_social,
                      SUM(o.monto_ofertado) FILTER (WHERE o.ganadora) AS monto_ganado,
                      BOOL_OR(o.ganadora) AS es_ganador, c.fecha_buena_pro, c.cuantia_referencial
                 FROM postores p
                 JOIN ofertas o ON o.postor_id=p.id
                 JOIN empresas e ON e.ruc=p.empresa_ruc
                 LEFT JOIN convocatorias c ON c.ocid=p.ocid
                WHERE p.ocid=%s
                GROUP BY e.ruc, e.razon_social, c.fecha_buena_pro, c.cuantia_referencial""",
            (ocid,),
        )
        filas = cur.fetchall()
    finally:
        conn.close()

    postores: dict[str, dict] = {}
    fbp_bd, cuantia_bd = None, None
    for ruc, razon, monto, es_g, fbp, cuantia in filas:
        fbp_bd, cuantia_bd = fbp_bd or fbp, cuantia_bd or cuantia
        postores[ruc] = {"ruc": ruc, "razon_social": razon, "es_ganador": bool(es_g),
                         "monto": float(monto or 0) or None}
    # Postores del OCDS y del parser (con monto ofertado si el acta lo trae).
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    for t in ((ocds.get("tender") or {}).get("tenderers") or []):
        r = "".join(ch for ch in str((t or {}).get("id") or "") if ch.isdigit())
        if len(r) == 11 and r not in postores:
            postores[r] = {"ruc": r, "razon_social": (t or {}).get("name") or f"RUC {r}",
                           "es_ganador": False, "monto": None}
    for p in _postores_parser(state):
        r = p.get("ruc")
        if not r:
            continue
        d = postores.setdefault(r, {"ruc": r, "razon_social": p.get("razon_social") or f"RUC {r}",
                                    "es_ganador": bool(p.get("es_ganador")), "monto": None})
        if p.get("es_ganador"):
            d["es_ganador"] = True
        if d.get("monto") is None and p.get("monto"):
            d["monto"] = p["monto"]
    g_ruc, _ = _ganador_ocds(ocds)
    if g_ruc and g_ruc in postores:
        postores[g_ruc]["es_ganador"] = True
    if not postores:
        return {"regla": "ruc_ultra_nuevo", "triggered": False, "estado": "sin_dato", "motivo": "sin postores"}

    referencial = float(cuantia_bd or 0) or (_montos_ocds(ocds).get("referencial") or 0)
    adjudicado, _src = _monto_adjudicado_ocds(ocds)
    fbp = _to_date(fbp_bd) or _to_date(((ocds.get("awards") or [{}])[0] or {}).get("date")) or _dt.date.today()

    triggered_list = []
    n_evaluados = 0
    for ruc, d in postores.items():
        monto_f = d.get("monto") or (adjudicado if d["es_ganador"] else None) or referencial or 0
        if monto_f < UMBRAL:
            continue
        profile = sunat_profiles.get(ruc) or {}
        fecha_inicio = profile.get("fecha_inicio_actividades")
        if not fecha_inicio:
            continue
        d_inicio = _to_date(fecha_inicio)
        if not d_inicio:
            continue
        n_evaluados += 1
        edad_dias_a_bp = (fbp - d_inicio).days
        if 0 <= edad_dias_a_bp < 90:
            triggered_list.append({
                "ruc": ruc, "razon_social": d["razon_social"], "es_ganador": d["es_ganador"],
                "monto": monto_f, "edad_dias_a_buena_pro": edad_dias_a_bp,
                "fecha_inicio_ruc": str(fecha_inicio), "fecha_buena_pro": str(fbp),
            })

    triggered_list.sort(key=lambda x: (not x["es_ganador"], x["edad_dias_a_buena_pro"]))
    result = {"regla": "ruc_ultra_nuevo", "n_postores": len(postores), "n_evaluados": n_evaluados,
              "n_triggered": len(triggered_list), "detalle": triggered_list,
              "triggered": len(triggered_list) > 0}
    if triggered_list:
        p = triggered_list[0]
        norma = _norma_state(state)
        if p["es_ganador"]:
            sev = "alta"
            ev = (f"{p['razon_social']} (RUC {p['ruc']}), adjudicatario, tenía {p['edad_dias_a_buena_pro']} días "
                  f"desde el alta del RUC a la fecha de la buena pro ({p['fecha_buena_pro']}); monto S/ "
                  f"{(p.get('monto') or 0):,.2f}. Señal de riesgo: empresa constituida en la ventana de 90 días "
                  f"previa a la adjudicación.")
        else:
            sev = "media"
            ev = (f"El postor no ganador {p['razon_social']} (RUC {p['ruc']}) tenía {p['edad_dias_a_buena_pro']} "
                  f"días desde el alta del RUC a la fecha de la buena pro ({p['fecha_buena_pro']}). Señal de "
                  f"riesgo de competencia aparente (postor de acompañamiento); requiere verificación.")
        result.update({
            "severidad": sev, "evidencia": ev,
            "norma": norma["impedimentos"] + " + Opinión OECE 056-2023",
            "fuente_url": f"https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc={p['ruc']}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result
check_sanctioned_provider_rule_tool = _as_tool(check_sanctioned_provider_rule)
check_edad_ruc_ganador_rule_tool = _as_tool(check_edad_ruc_ganador_rule)
check_ciiu_vs_objeto_rule_tool = _as_tool(check_ciiu_vs_objeto_rule)
check_ruc_ultra_nuevo_rule_tool = _as_tool(check_ruc_ultra_nuevo_rule)
