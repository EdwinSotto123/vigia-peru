"""compliance_rules._rules_bidder — reglas de postor único / proceso no competitivo."""

from tools._core import *  # noqa: F401,F403
from tools.compliance_rules._base import _as_tool, _norma_state, _perfil_reglas, _procurement_method, _regla_omitida, _sin_tildes  # noqa: F401


def _n_postores_ocds(ocds: dict) -> int | None:
    """Número de postores según el OCDS: numberOfTenderers > tender.tenderers >
    parties[role=tenderer]. None si el registro no lo informa."""
    if not isinstance(ocds, dict):
        return None
    tender = ocds.get("tender") or {}
    n = tender.get("numberOfTenderers")
    try:
        if n is not None and int(n) > 0:
            return int(n)
    except (TypeError, ValueError):
        pass
    tenderers = tender.get("tenderers") or []
    if tenderers:
        return len({(t.get("id") or t.get("name")) for t in tenderers if isinstance(t, dict)}) or len(tenderers)
    parties = [p for p in (ocds.get("parties") or [])
               if isinstance(p, dict) and "tenderer" in (p.get("roles") or [])]
    if parties:
        return len(parties)
    return None


def check_unique_bidder_rule(ocid: str, tool_context: ToolContext,
                             reglas_activas: frozenset[str] | None = None,
                             topes_uit: dict | None = None) -> dict:
    """Evalúa la regla C2 — único postor con oferta ≥ 95% del valor referencial.

    Postores: `tender.numberOfTenderers` / `tender.tenderers` / `parties[role=tenderer]`
    del OCDS; si el OCDS no lo informa, `ofertas` de la BD SOLO si registra ofertas
    no ganadoras (ganadora=false: el registro incluyó a todos los postores). Sin dato
    de postores → `estado: sin_dato` y NO se emite bandera (antes `ofertas` solo
    tenía ganadores y la regla disparaba siempre que hubiera award: falso positivo).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered (bool), estado, n_postores, pct_ganador,
        severidad, evidencia, norma.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("unico_postor_alto", reglas)
    if om:
        return om
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    n_postores = _n_postores_ocds(ocds)
    fuente_n = "ocds" if n_postores is not None else None

    pct = None
    conn = _pg()
    try:
        cur = conn.cursor()
        if n_postores is None:
            cur.execute(
                """SELECT COUNT(DISTINCT p.empresa_ruc),
                          COUNT(*) FILTER (WHERE NOT o.ganadora)
                     FROM postores p JOIN ofertas o ON o.postor_id=p.id
                    WHERE p.ocid=%s""", (ocid,))
            n_bd, n_no_ganadoras = cur.fetchone() or (0, 0)
            if n_bd and n_no_ganadoras:
                n_postores, fuente_n = int(n_bd), "ofertas_bd"
        cur.execute(
            """SELECT ROUND(AVG(o.porcentaje_referencial)::numeric, 2)
                 FROM ofertas o JOIN convocatoria_items i ON i.id=o.item_id
                WHERE i.ocid=%s AND o.ganadora""", (ocid,))
        row = cur.fetchone()
        pct = float(row[0]) if row and row[0] is not None else None
    finally:
        conn.close()

    if pct is None:
        tender = ocds.get("tender") or {}
        ref = (tender.get("value") or {}).get("amount")
        adj = sum(float(((a.get("value") or {}).get("amount")) or 0)
                  for a in (ocds.get("awards") or []) if isinstance(a, dict))
        try:
            if ref and adj:
                pct = round(adj / float(ref) * 100, 2)
        except (TypeError, ValueError, ZeroDivisionError):
            pct = None

    result = {
        "regla": "unico_postor_alto",
        "n_postores": n_postores,
        "fuente_n_postores": fuente_n,
        "pct_ganador_vs_referencial": pct,
        "triggered": False,
        "estado": "sin_dato" if n_postores is None else "hallado",
    }
    if n_postores is None:
        result["motivo"] = "el OCDS no informa numberOfTenderers/tenderers y la BD no registra ofertas no ganadoras"
        return result
    if n_postores == 1 and pct is not None and pct >= 95:
        result.update({
            "triggered": True, "severidad": "alta",
            "evidencia": (f"Un solo postor registrado ({fuente_n}: numberOfTenderers/tenderers) y "
                          f"oferta ganadora al {pct}% del valor referencial."),
            "norma": _norma_state(state)["competencia"],
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        tool_context.state.setdefault("pending_flags", []).append(result)
    elif n_postores == 1:
        result["motivo"] = "un solo postor pero oferta < 95% del referencial (o sin porcentaje)"
    return result

def check_non_competitive_process_rule(ocid: str, tool_context: ToolContext,
                                       reglas_activas: frozenset[str] | None = None,
                                       topes_uit: dict | None = None) -> dict:
    """Evalúa la regla C8 — el tipo de proceso es no competitivo (contratación
    directa, exoneración, situación de emergencia) y por tanto reduce
    competencia legalmente.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, tipo_proceso detectado, evidencia.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("procedimiento_no_competitivo", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        # `tipo_proceso` está NULL en el 99.6 % de `convocatorias` (la ingesta llena
        # `modalidad`); el OCDS del state trae `procurementMethodDetails` (lote 1 · T11).
        cur.execute("SELECT COALESCE(tipo_proceso, modalidad) FROM convocatorias WHERE ocid=%s", (ocid,))
        row = cur.fetchone()
        tipo = _procurement_method(tool_context.state, (row or [None])[0])
        if not tipo or tipo.strip().lower() == "desconocido":
            return {"regla": "procedimiento_no_competitivo", "triggered": False, "tipo_proceso": None}
        u = _sin_tildes(tipo).upper()
        no_competitive = any(t in u for t in ("NO COMPETITIVO", "DIRECTA", "EXONER", "EMERGEN"))
        result = {
            "regla": "procedimiento_no_competitivo",
            "tipo_proceso": tipo,
            "triggered": no_competitive,
        }
        if no_competitive:
            result.update({
                "severidad": "media",
                "evidencia": f"Tipo de proceso: {tipo}. Invocó una causal de excepción que limita la competencia abierta.",
                "norma": "Art. 55.1 Ley 32069 — supuestos de selección no competitiva",
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

def check_postor_unico_mayoritario_rule(ocid: str, tool_context: ToolContext,
                                        reglas_activas: frozenset[str] | None = None,
                                        topes_uit: dict | None = None) -> dict:
    """C11 — Postor único en ≥70% de ítems (refina C2). `check_unique_bidder_rule`
    solo dispara si 100% de ítems tienen 1 postor; esta detecta el caso donde
    HAY varios postores nominales pero la mayoría de ítems se adjudicó sin
    competencia efectiva (postores que solo concursaron por 1 ítem cada uno).

    Norma: Art. 2 TUO Ley 30225 — Principio de Competencia Efectiva.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("postor_unico_mayoritario", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT i.numero_item, COUNT(DISTINCT o.postor_id) AS n_postores
                 FROM convocatoria_items i
                 LEFT JOIN ofertas o ON o.item_id = i.id
                WHERE i.ocid = %s
                GROUP BY i.numero_item""",
            (ocid,),
        )
        items = cur.fetchall()
        if not items:
            return {"regla": "postor_unico_mayoritario", "triggered": False,
                    "motivo": "sin items en BD"}

        n_total = len(items)
        n_unicos = sum(1 for _, n in items if (n or 0) == 1)
        pct = (n_unicos / n_total) * 100 if n_total else 0

        result = {"regla": "postor_unico_mayoritario",
                  "n_items": n_total, "n_items_un_solo_postor": n_unicos,
                  "pct_items_sin_competencia": round(pct, 1),
                  "triggered": pct >= 70 and n_unicos < n_total}
        if result["triggered"]:
            result.update({
                "severidad": "alta",
                "evidencia": (
                    f"{n_unicos} de {n_total} ítems ({pct:.0f}%) fueron adjudicados con "
                    f"UN solo postor admitido. Aunque el proceso global registra varios postores, "
                    f"la mayoría de ítems se otorgaron sin competencia efectiva — patrón de "
                    f"segmentación que evade la regla del 100%."
                ),
                "norma": _norma_state(tool_context.state)["competencia"],
                "fuente_url": None,
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()


# ── FunctionTool wrappers ──
# Las reglas se exponen con firma simple (ocid, tool_context); el perfil (reglas_activas,
# topes_uit) llega por kwargs desde el driver o por state['reglas_activas'/'topes_uit'].
check_unique_bidder_rule_tool = _as_tool(check_unique_bidder_rule)
check_non_competitive_process_rule_tool = _as_tool(check_non_competitive_process_rule)
check_postor_unico_mayoritario_rule_tool = _as_tool(check_postor_unico_mayoritario_rule)
