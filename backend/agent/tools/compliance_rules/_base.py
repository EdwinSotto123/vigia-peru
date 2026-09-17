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


def _postores_parser(state: dict) -> list[dict]:
    """Postores con montos desde el parser (tolerante a las claves nuevas de R4):
    `parser_raw_consolidated.postores[]` > `postores_consolidados[]` > `document_analysis.
    postores_extraidos[]`, completados con `ofertas[]` (postor, monto, orden) si existen.
    Cada entrada: {ruc, razon_social, monto, es_ganador, puntaje, estado, orden}."""
    raw = (state or {}).get("parser_raw_consolidated") or {}
    da = _safe_parse_json((state or {}).get("document_analysis")) or {}
    fuentes = [raw.get("postores"), raw.get("postores_consolidados"), da.get("postores_extraidos")]
    base = next((f for f in fuentes if isinstance(f, list) and f), [])
    out: list[dict] = []
    for p in base:
        if not isinstance(p, dict):
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
