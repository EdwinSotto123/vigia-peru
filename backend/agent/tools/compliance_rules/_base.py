"""compliance_rules._base — helpers compartidos: perfil/reglas activas, norma aplicable, montos y postores OCDS."""

from tools._core import *  # noqa: F401,F403


def _perfil_reglas(tool_context, reglas_activas):
    """reglas_activas explícito > state['reglas_activas'] > None (todas)."""
    if reglas_activas is not None:
        return frozenset(reglas_activas)
    try:
        v = tool_context.state.get("reglas_activas")
    except Exception:
        v = None
    if isinstance(v, (list, tuple, set, frozenset)):
        return frozenset(str(x) for x in v)
    return None


def _perfil_topes(tool_context, topes_uit):
    if topes_uit is not None:
        return topes_uit
    try:
        v = tool_context.state.get("topes_uit")
    except Exception:
        v = None
    return v if isinstance(v, dict) else None


def _regla_omitida(nombre: str, reglas: frozenset | None, activa_por_defecto: bool = False) -> dict | None:
    """Si el perfil no activa `nombre`, devuelve el resultado neutro (sin bandera).

    `activa_por_defecto=True` (reglas del lote 1, 2026-09-15): la regla corre aunque el
    perfil no la liste — solo se omite si el perfil la desactiva explícitamente con el
    prefijo `-` (p. ej. `-ofertas_agrupadas`) en `reglas_activas`."""
    if reglas is None:
        return None
    if activa_por_defecto:
        if f"-{nombre}" in reglas:
            return {"regla": nombre, "triggered": False, "omitida": True,
                    "estado": "sin_dato", "motivo": "regla desactivada explícitamente en el perfil"}
        return None
    if nombre not in reglas:
        return {"regla": nombre, "triggered": False, "omitida": True,
                "estado": "sin_dato", "motivo": "regla no activa en el perfil"}
    return None


# ─── Régimen normativo aplicable (lote 1 · T3) ──────────────────────────────
#
# Procesos convocados desde el 22-abr-2025 se rigen por la Ley 32069 y su Reglamento
# (D.S. 009-2025-EF); antes, por el TUO de la Ley 30225 (D.S. 082-2019-EF). Citar el TUO
# derogado en un expediente 2026 resta credibilidad ante un fiscal (informes 1225062,
# 1225256, 1225266, 1225416, 1225450).
_INICIO_LEY_32069 = _dt.date(2025, 4, 22)

_NORMAS = {
    "ley_32069": {
        "regimen": "ley_32069",
        "ley": "Ley N° 32069",
        "reglamento": "D.S. N° 009-2025-EF",
        "principios": "Art. 5 Ley 32069 — principios de competencia, transparencia e integridad",
        "transparencia": "Art. 5 Ley 32069 — principio de transparencia y publicidad",
        "competencia": "Art. 5 Ley 32069 — principio de competencia",
        "integridad": "Art. 5 Ley 32069 — principio de integridad",
        "impedimentos": "Art. 30 Ley 32069 — impedimentos para contratar",
        "sanciones": "Art. 30 lit. Ley 32069 — impedimentos derivados de sanciones / Reglamento D.S. 009-2025-EF",
        "procedimientos": "Art. 54 Ley 32069 y art. 14 Ley 32513 (Presupuesto 2026) — procedimientos según cuantía",
        "comparacion_precios": "Reglamento D.S. 009-2025-EF — comparación de precios (lista de invitados, oferta ≤ cuantía)",
        "penalidades": "Reglamento D.S. 009-2025-EF — penalidad por mora y ampliación de plazo",
    },
    "tuo_30225": {
        "regimen": "tuo_30225",
        "ley": "TUO Ley N° 30225",
        "reglamento": "D.S. N° 344-2018-EF",
        "principios": "Art. 2 TUO Ley 30225 — principios de libertad de concurrencia y transparencia",
        "transparencia": "Art. 2 TUO Ley 30225 — principio de transparencia",
        "competencia": "Art. 2 TUO Ley 30225 — principio de competencia",
        "integridad": "Art. 2 TUO Ley 30225 — principio de integridad",
        "impedimentos": "Art. 11 TUO Ley 30225 — impedimentos para contratar",
        "sanciones": "Art. 50 TUO Ley 30225 — infracciones y sanciones",
        "procedimientos": "Anexo IV TUO Ley 30225 — procedimientos según monto",
        "comparacion_precios": "Art. 22 TUO Ley 30225 — comparación de precios",
        "penalidades": "Arts. 158-162 Reglamento TUO Ley 30225 — penalidades y ampliación de plazo",
    },
}


def _to_date(v) -> "_dt.date | None":
    if v is None:
        return None
    if isinstance(v, _dt.datetime):
        return v.date()
    if isinstance(v, _dt.date):
        return v
    s = str(v).strip()
    try:
        return _dt.date.fromisoformat(s[:10])
    except ValueError:
        pass
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        try:
            return _dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None


def norma_aplicable(fecha_convocatoria=None) -> dict:
    """Régimen normativo por fecha de convocatoria (helper único del plan 2026-09-15).
    Sin fecha → se asume el régimen vigente (Ley 32069)."""
    f = _to_date(fecha_convocatoria)
    if f is not None and f < _INICIO_LEY_32069:
        return dict(_NORMAS["tuo_30225"])
    return dict(_NORMAS["ley_32069"])


def _fecha_convocatoria_state(state: dict):
    """Fecha de convocatoria desde el OCDS del state (tenderPeriod.startDate > datePublished > date)."""
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    tender = ocds.get("tender") or {}
    for v in ((tender.get("tenderPeriod") or {}).get("startDate"), tender.get("datePublished"),
              ocds.get("date")):
        d = _to_date(v)
        if d:
            return d
    return None


def _norma_state(state: dict) -> dict:
    return norma_aplicable(_fecha_convocatoria_state(state))


def _procurement_method(state: dict, tipo_bd: str | None = None) -> str:
    """Nombre del procedimiento: OCDS `tender.procurementMethodDetails` > valor de BD
    (COALESCE(tipo_proceso, modalidad)) > ''."""
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    tender = ocds.get("tender") or {}
    pmd = tender.get("procurementMethodDetails") or tender.get("procurementMethod")
    return str(pmd or tipo_bd or "").strip()


def _es_subasta(tipo: str) -> bool:
    u = _sin_tildes(tipo or "").upper()
    return "SUBASTA" in u or "SIE" == u.strip() or u.startswith("SIE-")


def _es_comparacion_precios(tipo: str) -> bool:
    u = _sin_tildes(tipo or "").upper()
    return "COMPARACION" in u or u.startswith("CP-") or u.startswith("COMPRE")


def _montos_ocds(ocds: dict) -> dict:
    """Montos publicados en el OCDS: referencial (tender.value), adjudicados (awards[].value)
    y contratados (contracts[].value)."""
    ocds = ocds or {}
    tender = ocds.get("tender") or {}

    def _amt(node):
        try:
            v = float(((node or {}).get("value") or {}).get("amount") or 0)
        except (TypeError, ValueError):
            v = 0.0
        return v if v > 0 else None

    referencial = _amt(tender)
    awards = [a for a in (_amt(a) for a in (ocds.get("awards") or []) if isinstance(a, dict)) if a]
    contracts = [c for c in (_amt(c) for c in (ocds.get("contracts") or []) if isinstance(c, dict)) if c]
    return {"referencial": referencial, "awards": awards, "contracts": contracts,
            "suma_awards": sum(awards) if awards else None,
            "suma_contracts": sum(contracts) if contracts else None}


def _monto_adjudicado_ocds(ocds: dict):
    """Monto adjudicado/contratado: contracts > awards > None (T8)."""
    m = _montos_ocds(ocds)
    if m["suma_contracts"]:
        return m["suma_contracts"], "contracts"
    if m["suma_awards"]:
        return m["suma_awards"], "awards"
    return None, None


def _ganador_ocds(ocds: dict) -> tuple[str | None, str | None]:
    for a in ((ocds or {}).get("awards") or []):
        for sup in (a.get("suppliers") or []):
            pid = str(sup.get("id") or "")
            digits = "".join(ch for ch in pid if ch.isdigit())
            if len(digits) == 11:
                return digits, sup.get("name")
    return None, None


def _f(v):
    try:
        x = float(v)
        return x if x > 0 else None
    except (TypeError, ValueError):
        return None


def _norm_razon_cr(s: str) -> str:
    s = _sin_tildes(str(s or "")).upper()
    s = re.sub(r"\b(S\.?A\.?C\.?|S\.?R\.?L\.?(TDA)?|E\.?I\.?R\.?L\.?|S\.?A\.?A?\.?|S\.?C\.?R\.?L\.?)\b", " ", s)
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", s).split())


def _sin_oferta(estado) -> bool:
    """`participante_sin_oferta`, "no presentó oferta", "sin propuesta"…: registrado sin ofertar."""
    e = " ".join(_sin_tildes(str(estado or "")).lower().replace("_", " ").replace("-", " ").split())
    return any(k in e for k in ("sin oferta", "no presento", "no oferto", "sin propuesta", "solo registro", "registrado sin"))


_RE_FUERA = re.compile(r"descalific|rechaz|no\s+admit|inadmit|no\s+cumpl|no\s+alcanz|puntaje\s+t[eé]cnico\s+m[ií]nimo|"
                       r"puntaje\s+m[ií]nimo|excluid|desestim|no\s+coincid|inconsistenc|no\s+v[aá]lid", re.I)
_RE_NO_FUERA = re.compile(r"no\s+(fue|qued[oó]|resulta)\s+(descalific|rechaz|excluid)|sin\s+ser\s+descalific", re.I)


def _quedo_fuera(motivo) -> bool:
    """El motivo dice que la oferta quedó fuera (rechazo económico, bajo el mínimo técnico), no sólo que perdió puntos
    («Bonificación MYPE no otorgada…; no fue descalificado», 1226255)."""
    t = str(motivo or "").strip()
    return bool(t) and bool(_RE_FUERA.search(t)) and not _RE_NO_FUERA.search(t)


def postores_acta(state: dict) -> list[dict] | None:
    """Los postores del acta de buena pro según el lector de Vigía (`lecturas_documentos.acta`, Haiku 5.5 leyendo el
    PDF; tools/lecturas.py), con las claves de `_postores_parser`. None si no hay acta leída.

    El lector lista SÓLO a quienes presentaron oferta (no a los registrados), con admitida/calificada y el motivo. Es
    más fiable que el parser genérico: en la prueba de oro de las 4 redes (2026-11-04) el parser sumaba postores que no
    existían (una «oferta» de S/ 30 000 tomada de otro documento, 1232065) y perdía los montos de los perdedores
    (1228861: un rival ofertó el 100 % de la cuantía), y el OCDS cuenta participantes, no ofertas (1227458: 6
    registrados, una sola oferta)."""
    acta = (((state or {}).get("lecturas_documentos") or {}).get("acta") or {}).get("salida") or {}
    if not isinstance(acta, dict) or acta.get("es_buena_pro") is False:
        return None
    post = [p for p in (acta.get("postores") or []) if isinstance(p, dict)]
    if not post:
        return None
    out = []
    for p in post:
        ruc = "".join(ch for ch in str(p.get("ruc") or "") if ch.isdigit())
        if p.get("admitida") is False:
            estado = "no admitido"
        elif p.get("calificada") is False:
            estado = "descalificado"
        elif not p.get("ganador") and _quedo_fuera(p.get("motivo_fuera")):
            # Admitida y calificada, pero quedó fuera después: oferta económica rechazada o bajo el puntaje técnico
            # mínimo (1228202: «el 90 % y 10 % del monto no coinciden»; 1230915: 60 puntos de 70). El lector deja
            # calificada=true y lo dice en motivo_fuera.
            estado = "descalificado"
        elif p.get("ganador"):
            estado = "adjudicado"
        else:
            estado = "valido"
        out.append({"ruc": ruc if len(ruc) == 11 else None, "razon_social": str(p.get("nombre") or "").strip(),
                    "monto": _f(p.get("monto_ofertado")), "es_ganador": bool(p.get("ganador")),
                    "puntaje": p.get("puntaje"), "estado": estado, "orden": None,
                    "motivo": (str(p.get("motivo_fuera"))[:300] if p.get("motivo_fuera") else None),
                    "integrantes_ruc": [r for r in (p.get("integrantes_ruc") or []) if isinstance(r, str)],
                    "fuente": "acta"})
    return out


def n_participantes_parser(state: dict) -> tuple[int, int] | None:
    """(participantes registrados, ofertas presentadas) según el acta leída o el parser, si distingue a los que no
    ofertaron."""
    acta = postores_acta(state)
    if acta:
        ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
        n = (ocds.get("tender") or {}).get("numberOfTenderers") if isinstance(ocds, dict) else None
        try:
            n = int(n) if n is not None else None
        except (TypeError, ValueError):
            n = None
        return (max(n or 0, len(acta)), len(acta))
    raw = (state or {}).get("parser_raw_consolidated") or {}
    da = _safe_parse_json((state or {}).get("document_analysis")) or {}
    base = next((f for f in (raw.get("postores"), raw.get("postores_consolidados"), da.get("postores_extraidos"),
                             da.get("postores_consolidados")) if isinstance(f, list) and f), [])
    base = [p for p in base if isinstance(p, dict)]
    if not base or not any(p.get("estado") or p.get("estado_oferta") for p in base):
        return None
    sin = sum(1 for p in base if _sin_oferta(p.get("estado") or p.get("estado_oferta")))
    return len(base), len(base) - sin


def _postores_parser(state: dict) -> list[dict]:
    """Postores con montos: los del acta leída (`postores_acta`) si la hay; si no, desde el parser (tolerante a las claves nuevas de R4):
    `parser_raw_consolidated.postores[]` > `postores_consolidados[]` > `document_analysis.
    postores_extraidos[]`, completados con `ofertas[]` (postor, monto, orden) si existen.
    Cada entrada: {ruc, razon_social, monto, es_ganador, puntaje, estado, orden}."""
    acta = postores_acta(state)
    if acta:
        return acta
    raw = (state or {}).get("parser_raw_consolidated") or {}
    da = _safe_parse_json((state or {}).get("document_analysis")) or {}
    fuentes = [raw.get("postores"), raw.get("postores_consolidados"), da.get("postores_extraidos")]
    base = next((f for f in fuentes if isinstance(f, list) and f), [])
    out: list[dict] = []
    for p in base:
        if not isinstance(p, dict):
            continue
        # Quien se registró pero no ofertó no es postor: contaba como oferta "válida" (1226064: 17 registrados,
        # 3 ofertas, 1 admitida → única oferta válida no disparaba).
        if _sin_oferta(p.get("estado") or p.get("estado_oferta")):
            continue
        ruc = "".join(ch for ch in str(p.get("ruc") or "") if ch.isdigit())
        out.append({
            "ruc": ruc if len(ruc) == 11 else None,
            "razon_social": (p.get("razon_social") or p.get("nombre") or "").strip(),
            "monto": _f(p.get("monto_oferta") if p.get("monto_oferta") is not None else p.get("monto")),
            "es_ganador": p.get("es_ganador"),
            "puntaje": p.get("puntaje"),
            "estado": str(p.get("estado") or p.get("estado_oferta") or "").strip().lower() or None,
            "orden": p.get("orden") or p.get("orden_prelacion"),
        })
    # `ofertas[]` (R4): {postor|razon_social, ruc, monto, orden, estado} — completa montos.
    for o in (raw.get("ofertas") or []):
        if not isinstance(o, dict):
            continue
        monto = _f(o.get("monto") or o.get("monto_oferta"))
        if monto is None:
            continue
        ruc = "".join(ch for ch in str(o.get("ruc") or "") if ch.isdigit())
        nom = _norm_razon_cr(o.get("postor") or o.get("razon_social") or "")
        dest = None
        for p in out:
            if (ruc and p["ruc"] == ruc) or (nom and _norm_razon_cr(p["razon_social"]) == nom):
                dest = p
                break
        if dest is None:
            dest = {"ruc": ruc if len(ruc) == 11 else None, "razon_social": o.get("postor") or o.get("razon_social") or "",
                    "monto": None, "es_ganador": o.get("es_ganador"), "puntaje": o.get("puntaje"),
                    "estado": None, "orden": o.get("orden")}
            out.append(dest)
        if dest["monto"] is None:
            dest["monto"] = monto
        if dest["orden"] is None and o.get("orden") is not None:
            dest["orden"] = o.get("orden")
        if dest["estado"] is None and o.get("estado"):
            dest["estado"] = str(o.get("estado")).strip().lower()
    # Ganador: si el parser no lo marcó, cruzar con awards del OCDS.
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    g_ruc, g_nom = _ganador_ocds(ocds)
    if g_ruc and not any(p.get("es_ganador") for p in out):
        for p in out:
            if p["ruc"] == g_ruc or (g_nom and _norm_razon_cr(p["razon_social"]) == _norm_razon_cr(g_nom)):
                p["es_ganador"] = True
    return out


def _sin_tildes(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn")


def _as_tool(fn):
    """FunctionTool con firma simple `(ocid, tool_context)`: ADK no sabe declarar
    `frozenset[str] | None`, y los sub-agentes LLM no deben elegir el perfil."""
    def _w(ocid: str, tool_context: ToolContext) -> dict:
        return fn(ocid, tool_context)
    _w.__name__ = fn.__name__
    _w.__qualname__ = fn.__qualname__
    _w.__doc__ = fn.__doc__
    return FunctionTool(func=_w)

def _ganador_ruc(ocid: str, state: dict, cur=None) -> tuple[str | None, str | None]:
    """(ruc, razon_social) del ganador: BD (ofertas ganadora) → OCDS awards.suppliers."""
    ruc, nombre = None, None
    if cur is not None:
        try:
            cur.execute(
                """SELECT e.ruc, e.razon_social FROM postores p
                     JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                     JOIN empresas e ON e.ruc=p.empresa_ruc
                    WHERE p.ocid=%s LIMIT 1""", (ocid,))
            row = cur.fetchone()
            if row:
                ruc, nombre = row[0], row[1]
        except Exception:
            ruc = None
    if not ruc:
        ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
        for a in (ocds.get("awards") or []):
            for sup in (a.get("suppliers") or []):
                pid = str(sup.get("id") or "")
                digits = "".join(ch for ch in pid if ch.isdigit())
                if len(digits) == 11:
                    return digits, sup.get("name")
    return ruc, nombre


# ─── Prueba de oro de las redes (2026-11-04): IGV exonerado, honorario fijo y consorciados ───

_RE_EXONERADO_IGV = re.compile(
    r"ley\s*(n[°º.o]*\s*)?27037|amazon[ií]a.{0,80}\bigv\b|exonera\w*\s+(del\s+)?(pago\s+del\s+)?igv|"
    r"no\s+incluye\s+(el\s+)?igv|excluido\s+(el\s+)?igv|inafect\w*\s+(al|del)\s+igv", re.I)


def exonerado_igv(state: dict) -> bool:
    """True si los documentos dicen que la oferta va sin IGV (Ley 27037 de la Amazonía, «no incluye IGV»)."""
    textos = []
    lect = (state or {}).get("lecturas_documentos") or {}
    for k in ("acta", "contrato", "bases"):
        textos.append(json.dumps((lect.get(k) or {}).get("salida") or {}, ensure_ascii=False)[:20000])
    dt = (state or {}).get("documentos_texto") or {}
    if isinstance(dt, dict):
        for v in dt.values():
            if isinstance(v, dict) and isinstance(v.get("texto"), str):
                textos.append(v["texto"][:60000])
    return any(_RE_EXONERADO_IGV.search(t) for t in textos if t)


def ratio_vs_referencial(monto, vr, state: dict | None = None) -> tuple[float | None, bool]:
    """(monto / valor referencial, en la misma base tributaria) y si se comparó sin IGV.

    Un postor exonerado del IGV (Ley 27037) oferta sin IGV contra una cuantía publicada con IGV: 67 796,61 frente a
    80 000 es el 84,7 % literal, pero es 80 000 / 1,18 al céntimo (1226359, 1226546). Se compara sin IGV cuando la
    oferta por 1,18 cae a 0,1 % de la cuantía, o cuando los documentos dicen que la oferta va sin IGV y así queda entre
    el 90 % y el 110 %."""
    m, v = _f(monto), _f(vr)
    if not m or not v:
        return None, False
    r = m / v
    r_sin = m * 1.18 / v
    if abs(r - 1) > 0.001 and abs(r_sin - 1) <= 0.001:
        return r_sin, True
    if r < 0.9 and 0.9 <= r_sin <= 1.1 and state is not None and exonerado_igv(state):
        return r_sin, True
    return r, False


_RE_SIN_COMPETENCIA_PRECIO = re.compile(r"convenio|r[eé]g[ií]men\s+especial", re.I)


def honorario_fijo(state: dict) -> bool:
    """True si el monto lo fijaron las bases y no hubo oferta económica: un convenio o un régimen especial donde el
    acta trae varios candidatos evaluados por calificaciones o entrevista y sólo el adjudicatario tiene monto, igual a
    la cuantía (1228800, 1231429, 1232540: honorario de los TDR, terna de candidatos). Ahí el único «postor» del OCDS y
    la oferta igual al referencial son por construcción, no señales."""
    tipo = _procurement_method(state)
    if not _RE_SIN_COMPETENCIA_PRECIO.search(tipo or ""):
        return False
    acta = postores_acta(state) or []
    if len(acta) < 2:
        return False
    gan = [p for p in acta if p.get("es_ganador")]
    otros = [p for p in acta if not p.get("es_ganador")]
    if len(gan) != 1 or any(p.get("monto") for p in otros):
        return False
    ocds = (state or {}).get("ocds") or (state or {}).get("ocds_preloaded") or {}
    vr = _montos_ocds(ocds).get("referencial")
    m = gan[0].get("monto") or _monto_adjudicado_ocds(ocds)[0]
    return bool(vr and m and abs(float(m) - float(vr)) / float(vr) <= 0.001)


def ganadores_evaluables(ocid: str, state: dict, cur=None) -> list[dict]:
    """Quién ganó y, si es un consorcio, cada integrante (hasta 5): [{ruc, nombre, consorcio, monto, fecha_buena_pro}].

    Fuente: la buena pro del CONOSCE (conosce_adjudicaciones por código y entidad) con conosce_consorcios; sin ella, los
    suppliers del OCDS con RUC. Antes las reglas de proveedor partían de `postores`/`ofertas`/`empresas` de la base
    propia, donde un consorcio figura con su código del SEACE y no tiene fila en `empresas`: con un consorcio ganador no
    se evaluaba a nadie (prueba de oro 2026-11-04: RUC nuevo, giro SUNAT, concentración y visitas de un consorciado,
    9 omisiones). Se guarda en state["_ganadores_eval"]."""
    st = state if isinstance(state, dict) else {}
    ya = st.get("_ganadores_eval")
    if isinstance(ya, dict) and ya.get("ocid") == str(ocid):
        return ya["lista"]
    out: list[dict] = []
    conn = None
    try:
        if cur is None:
            conn = _pg()
            cur = conn.cursor()
        cur.execute("SELECT codigo, entidad_ruc::text FROM convocatorias WHERE ocid = %s", (str(ocid),))
        fila = cur.fetchone()
        if fila and fila[0]:
            cur.execute("""SELECT ruc_proveedor, max(proveedor), sum(monto_adjudicado)::float, min(fecha_buenapro)
                             FROM conosce_adjudicaciones
                            WHERE codigo_convocatoria = %s AND (%s::text IS NULL OR entidad_ruc::text = %s::text)
                            GROUP BY 1 ORDER BY 3 DESC NULLS LAST LIMIT 5""", (fila[0], fila[1], fila[1]))
            for ruc, nombre, monto, fbp in cur.fetchall():
                ruc = str(ruc or "").strip()
                if re.fullmatch(r"(10|15|17|20)\d{9}", ruc):
                    out.append({"ruc": ruc, "nombre": nombre, "consorcio": None, "monto": monto, "fecha_buena_pro": fbp})
                    continue
                cur.execute("""SELECT DISTINCT ruc_miembro, miembro FROM conosce_consorcios
                                WHERE ruc_consorcio = %s AND ruc_miembro ~ '^(10|15|17|20)[0-9]{9}$'
                                ORDER BY 1 LIMIT 5""", (ruc,))
                for mr, mn in cur.fetchall():
                    out.append({"ruc": mr, "nombre": mn, "consorcio": nombre or ruc, "monto": monto, "fecha_buena_pro": fbp})
    except Exception:  # noqa: BLE001 — sin base, el OCDS
        out = []
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
    if not out:
        ocds = st.get("ocds") or st.get("ocds_preloaded") or {}
        monto = _monto_adjudicado_ocds(ocds)[0] if isinstance(ocds, dict) else None
        fbp = _to_date(((ocds.get("awards") or [{}])[0] or {}).get("date")) if isinstance(ocds, dict) else None
        for a in (ocds.get("awards") or []) if isinstance(ocds, dict) else []:
            for sup in (a.get("suppliers") or []) if isinstance(a, dict) else []:
                d = "".join(ch for ch in str((sup or {}).get("id") or "") if ch.isdigit())
                if len(d) == 11 and not any(x["ruc"] == d for x in out):
                    out.append({"ruc": d, "nombre": (sup or {}).get("name"), "consorcio": None, "monto": monto,
                                "fecha_buena_pro": fbp})
    if isinstance(state, dict):
        state["_ganadores_eval"] = {"ocid": str(ocid), "lista": out}
    return out
