"""RUC (validación/corrección/cruce con OCDS) y fusión de postores/ofertas/firmantes —
usado tanto por el parser en lote como por el legacy."""

from tools._core import *  # noqa: F401,F403
from ._base import _norm_razon


_RUC_PESOS = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)


def _solo_digitos(ruc) -> str:
    return re.sub(r"\D", "", str(ruc or ""))


def ruc_valido(ruc) -> bool:
    """RUC peruano de 11 dígitos con dígito verificador (módulo 11, pesos 5432765432).
    Un RUC mal leído por el OCR (un dígito cambiado) NO pasa y, por tanto, no crea un postor
    fantasma (1225090: 'DIAGNOSTICA PERUANA B.A.C.' 20501867286 como tercer postor)."""
    r = _solo_digitos(ruc)
    if len(r) != 11 or r[:2] not in ("10", "15", "16", "17", "20"):
        return False
    s = sum(int(d) * w for d, w in zip(r[:10], _RUC_PESOS))
    c = 11 - (s % 11)
    c = {10: 0, 11: 1}.get(c, c)
    return c == int(r[10])


def _corregir_ruc(ruc, candidatos) -> str | None:
    """Si `ruc` (leído por OCR) difiere en UN solo dígito de un RUC válido conocido (OCDS
    tenderers/suppliers), devuelve el conocido; si no, None."""
    r = _solo_digitos(ruc)
    if len(r) != 11:
        return None
    for c in candidatos or ():
        c = _solo_digitos(c)
        if len(c) == 11 and sum(1 for a, b in zip(r, c) if a != b) == 1:
            return c
    return None


def _rucs_ocds(state: dict) -> dict[str, str]:
    """{ruc: nombre} de tender.tenderers, parties[tenderer|supplier] y awards[].suppliers."""
    out: dict[str, str] = {}
    cr = (state or {}).get("ocds") or {}
    tender = cr.get("tender") or {}
    for t in (tender.get("tenderers") or []):
        if isinstance(t, dict):
            rid = _solo_digitos(str(t.get("id") or "").replace("PE-RUC-", ""))
            if len(rid) == 11:
                out.setdefault(rid, str(t.get("name") or ""))
    for pty in (cr.get("parties") or []):
        if not isinstance(pty, dict):
            continue
        roles = pty.get("roles") or []
        if any(r in roles for r in ("tenderer", "supplier")):
            ident = pty.get("identifier") or {}
            if ident.get("scheme") == "PE-RUC":
                rid = _solo_digitos(ident.get("id"))
                if len(rid) == 11:
                    out.setdefault(rid, str(pty.get("name") or ""))
    for a in (cr.get("awards") or []):
        for sup in ((a or {}).get("suppliers") or []):
            if isinstance(sup, dict):
                rid = _solo_digitos(str(sup.get("id") or "").replace("PE-RUC-", ""))
                if len(rid) == 11:
                    out.setdefault(rid, str(sup.get("name") or ""))
    return out


def _ganadores_ocds(state: dict) -> set[str]:
    cr = (state or {}).get("ocds") or {}
    out: set[str] = set()
    for a in (cr.get("awards") or []):
        if not isinstance(a, dict):
            continue
        if str(a.get("status") or "active").lower() in ("cancelled", "unsuccessful"):
            continue
        for sup in (a.get("suppliers") or []):
            if isinstance(sup, dict):
                rid = _solo_digitos(str(sup.get("id") or "").replace("PE-RUC-", ""))
                if len(rid) == 11:
                    out.add(rid)
    for pty in (cr.get("parties") or []):
        if isinstance(pty, dict) and "supplier" in (pty.get("roles") or []):
            rid = _solo_digitos((pty.get("identifier") or {}).get("id"))
            if len(rid) == 11:
                out.add(rid)
    return out


def _mismo_nombre(a: str, b: str) -> bool:
    """Razón social comparable: mismo conjunto de tokens ('ABEL CARPIO COBOS' == 'CARPIO COBOS
    ABEL'), o similitud ≥ 0.9 tras normalizar ('DIAGNOSTICA PERUANA B.A.C.' ~ '... S.A.C.')."""
    import difflib
    na, nb = _norm_razon(a), _norm_razon(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    _sufijos = {"SAC", "SA", "SRL", "EIRL", "SCRL", "SOCIEDAD", "ANONIMA", "CERRADA", "EMPRESA", "INDIVIDUAL",
                "RESPONSABILIDAD", "LIMITADA", "BAC", "COMERCIAL", "DE", "DEL", "LA", "EL", "Y", "E"}
    ta = {t for t in na.split() if t not in _sufijos and len(t) > 1}
    tb = {t for t in nb.split() if t not in _sufijos and len(t) > 1}
    if ta and tb and ta == tb:
        return True
    return difflib.SequenceMatcher(None, na, nb).ratio() >= 0.9


_CAMPOS_OFERTA = ("monto_oferta", "es_ganador", "puntaje", "estado", "orden_prelacion", "item")


def _pagina_principal(obj: dict) -> int | None:
    """Página de la primera evidencia verificada (o de la primera, si ninguna lo está)."""
    evs = [e for e in (obj.get("evidencia") or []) if isinstance(e, dict)]
    for e in evs:
        if e.get("verificada") and e.get("pagina") is not None:
            return e["pagina"]
    for e in evs:
        if e.get("pagina") is not None:
            return e["pagina"]
    return None


def _fusionar_postor(lista: list[dict], p: dict, es_adjudicacion: bool, sha: str | None,
                     rucs_conocidos: dict[str, str] | None = None) -> dict | None:
    """Incorpora el postor `p` a `lista` FUSIONANDO por RUC (válido) o por razón social
    normalizada. Nunca descarta: el mismo RUC visto antes (reporte de propuestas sin montos)
    se COMPLETA con `monto_oferta`/`es_ganador`/`puntaje`/`estado` del acta/cuadro; si el
    nuevo dato viene de un documento de adjudicación y el previo no, el del acta manda.
    RUC inválido (dígito verificador) → se intenta corregir contra los RUC del OCDS (1 dígito
    de diferencia); si no se puede, se guarda en `ruc_ocr` y el postor se fusiona por nombre.
    Devuelve la entrada consolidada (o None si `p` no tiene ni RUC ni nombre)."""
    if not isinstance(p, dict):
        return None
    nombre = str(p.get("razon_social") or "").strip()
    ruc_raw = _solo_digitos(p.get("ruc"))
    ruc = ruc_raw if ruc_valido(ruc_raw) else None
    ruc_ocr = None
    if ruc_raw and not ruc:
        fix = _corregir_ruc(ruc_raw, list((rucs_conocidos or {}).keys()))
        if fix:
            ruc, ruc_ocr = fix, ruc_raw
        else:
            ruc_ocr = ruc_raw
    if not ruc and not nombre:
        return None
    prev = None
    if ruc:
        prev = next((q for q in lista if q.get("ruc") == ruc), None)
    if prev is None and nombre:
        prev = next((q for q in lista if _mismo_nombre(q.get("razon_social"), nombre)), None)
    nuevo = {k: v for k, v in p.items() if k not in ("ruc",)}
    nuevo["ruc"] = ruc
    if ruc_ocr:
        nuevo["ruc_ocr"] = ruc_ocr
    if ruc and rucs_conocidos and rucs_conocidos.get(ruc):
        nuevo["razon_social_ocds"] = rucs_conocidos[ruc]
    nuevo["_fuente_adjudicacion"] = bool(es_adjudicacion)
    nuevo["fuentes"] = [sha] if sha else []
    if sha and not nuevo.get("documento_sha256"):
        nuevo["documento_sha256"] = sha
    nuevo["pagina"] = _pagina_principal(p)
    if prev is None:
        lista.append(nuevo)
        return nuevo
    # ── fusión ──
    if ruc and not prev.get("ruc"):
        prev["ruc"] = ruc
    if ruc_ocr and not prev.get("ruc_ocr") and prev.get("ruc") != ruc_ocr:
        prev["ruc_ocr"] = ruc_ocr
    if nuevo.get("razon_social_ocds") and not prev.get("razon_social_ocds"):
        prev["razon_social_ocds"] = nuevo["razon_social_ocds"]
    manda_nuevo = es_adjudicacion and not prev.get("_fuente_adjudicacion")
    for k in _CAMPOS_OFERTA:
        v = nuevo.get(k)
        if v in (None, "", [], {}):
            continue
        if prev.get(k) in (None, "", [], {}) or (manda_nuevo and k != "item"):
            prev[k] = v
    if manda_nuevo:
        prev["_fuente_adjudicacion"] = True
        if sha:
            prev["documento_sha256"] = sha
            prev["pagina"] = nuevo.get("pagina") if nuevo.get("pagina") is not None else prev.get("pagina")
    elif prev.get("pagina") is None and nuevo.get("pagina") is not None:
        prev["pagina"] = nuevo["pagina"]
    if sha and sha not in prev.setdefault("fuentes", []):
        prev["fuentes"].append(sha)
    ev_prev = prev.get("evidencia") or []
    prev["evidencia"] = ev_prev + [e for e in (nuevo.get("evidencia") or []) if e not in ev_prev]
    for k, v in nuevo.items():
        if k in ("evidencia", "fuentes", "_fuente_adjudicacion", "ruc", "ruc_ocr", "pagina", "documento_sha256"):
            continue
        if prev.get(k) in (None, "", [], {}) and v not in (None, "", [], {}):
            prev[k] = v
    return prev


def _ofertas_desde_postores(postores: list[dict]) -> list[dict]:
    """`ofertas[]` completas {postor, ruc, monto, orden, es_ganador, estado, fuente, pagina}
    ordenadas por orden de prelación (si el acta lo trae) o por monto ascendente."""
    con_monto = [p for p in postores if isinstance(p, dict) and isinstance(p.get("monto_oferta"), (int, float))
                 and p["monto_oferta"] > 0]
    def _k(p):
        o = p.get("orden_prelacion")
        return (0, float(o)) if isinstance(o, (int, float)) else (1, float(p["monto_oferta"]))
    out = []
    for i, p in enumerate(sorted(con_monto, key=_k), start=1):
        out.append({"postor": p.get("razon_social"), "ruc": p.get("ruc"), "monto": float(p["monto_oferta"]),
                    "orden": int(p["orden_prelacion"]) if isinstance(p.get("orden_prelacion"), (int, float)) else i,
                    "es_ganador": bool(p.get("es_ganador")) if p.get("es_ganador") is not None else None,
                    "estado": p.get("estado"), "fuente": p.get("documento_sha256"), "pagina": p.get("pagina")})
    return out


def _mismo_firmante(a: dict, b: dict) -> bool:
    """'YHONY E. QUISPE CANAZA' y 'Yhony Edwin Quispe Canaza' son la misma persona: los
    tokens largos (≥ 3 letras) de uno están contenidos en el otro y comparten ≥ 2."""
    na = [t for t in _norm_razon(a.get("nombre_completo")).split() if len(t) >= 3]
    nb = [t for t in _norm_razon(b.get("nombre_completo")).split() if len(t) >= 3]
    if not na or not nb:
        return False
    sa, sb = set(na), set(nb)
    inter = sa & sb
    if len(inter) < 2:
        return False
    return sa <= sb or sb <= sa or len(inter) >= 3
