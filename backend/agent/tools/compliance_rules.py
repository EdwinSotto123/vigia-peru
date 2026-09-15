"""Tools del dominio: compliance_rules.

Reglas deterministas de cumplimiento. Desde el WS V (plan 2026-09-15) TODAS las
reglas `check_*_rule` aceptan dos kwargs opcionales que el driver pasa desde el
perfil (`agents/_shared/profiles.py`):

    reglas_activas: frozenset[str] | None   # nombres de reglas habilitadas; None = todas
    topes_uit:      dict | None             # topes por tipo de proceso; None = defaults

Como los FunctionTool de ADK no pueden declarar `frozenset`, los wrappers `*_tool`
exponen solo `(ocid, tool_context)` y leen el perfil de `state['reglas_activas']` /
`state['topes_uit']` si el driver los dejó ahí (ver `_as_tool`).
"""

from tools._core import *  # noqa: F401,F403
from tools.legal import query_legal_rag
from tools import verify as _verify

# Claves aceptadas en `topes_uit` (todas opcionales; default = comportamiento anterior):
#   uit / uit_soles                          → valor de la UIT en soles (5350)
#   comparacion_precios / comparacion_precios_max → tope superior de CP (15 UIT)
#   adjudicacion_simplificada / adjudicacion_simplificada_max / licitacion_publica
#                                            → tope superior de AS = mínimo de LP (400 UIT;
#                                              obras: 1800)
_TOPES_DEFAULT = {"uit_soles": 5350.0, "comparacion_precios_max": 15.0,
                  "adjudicacion_simplificada_max": 400.0}


def _tope(topes: dict | None, default: float, *claves: str) -> float:
    for k in claves:
        if isinstance(topes, dict) and topes.get(k) is not None:
            try:
                return float(topes[k])
            except (TypeError, ValueError):
                continue
    return default


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


def _regla_omitida(nombre: str, reglas: frozenset | None) -> dict | None:
    """Si el perfil no activa `nombre`, devuelve el resultado neutro (sin bandera)."""
    if reglas is not None and nombre not in reglas:
        return {"regla": nombre, "triggered": False, "omitida": True,
                "estado": "sin_dato", "motivo": "regla no activa en el perfil"}
    return None


def _as_tool(fn):
    """FunctionTool con firma simple `(ocid, tool_context)`: ADK no sabe declarar
    `frozenset[str] | None`, y los sub-agentes LLM no deben elegir el perfil."""
    def _w(ocid: str, tool_context: ToolContext) -> dict:
        return fn(ocid, tool_context)
    _w.__name__ = fn.__name__
    _w.__qualname__ = fn.__qualname__
    _w.__doc__ = fn.__doc__
    return FunctionTool(func=_w)


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
            "norma": "Art. 27 Reglamento Ley 32069 — competencia mínima",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        tool_context.state.setdefault("pending_flags", []).append(result)
    elif n_postores == 1:
        result["motivo"] = "un solo postor pero oferta < 95% del referencial (o sin porcentaje)"
    return result

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
                "norma": "Art. 50 TUO Ley N° 30225 — impedimentos para contratar",
                "fuente_url": "https://apps.osce.gob.pe/perfilprov-ui/inhabilitado.xhtml",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

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
        cur.execute("SELECT tipo_proceso FROM convocatorias WHERE ocid=%s", (ocid,))
        row = cur.fetchone()
        if not row or not row[0]:
            return {"regla": "procedimiento_no_competitivo", "triggered": False, "tipo_proceso": None}
        tipo = row[0]
        u = tipo.upper()
        no_competitive = any(t in u for t in ("NO COMPETITIVO", "DIRECTA", "EXONER", "EMERGEN"))
        result = {
            "regla": "procedimiento_no_competitivo",
            "tipo_proceso": tipo,
            "triggered": no_competitive,
        }
        if no_competitive:
            result.update({
                "severidad": "media",
                "evidencia": f"Tipo de proceso: {tipo} · invocó causal de excepción que limita la competencia abierta",
                "norma": "Art. 55.1 Ley 32069 — supuestos de selección no competitiva",
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

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
            "SELECT tipo_proceso, fecha_convocatoria, fecha_buena_pro, cuantia_referencial "
            "FROM convocatorias WHERE ocid=%s", (ocid,),
        )
        row = cur.fetchone()
        if not row:
            return {"regla": "plazo_convocatoria_minimo", "triggered": False, "motivo": "convocatoria no encontrada"}
        tipo, fconv, fbp, cuantia = row
        if not fconv or not fbp:
            return {"regla": "plazo_convocatoria_minimo", "triggered": False, "motivo": "sin fechas"}
        delta_dias = (fbp - fconv).days
        tipo_norm = (tipo or "").upper()

        # Mínimos legales referenciales (Reglamento Ley 32069):
        #   - Subasta Inversa Electrónica: 8 días hábiles ≈ 12 calendarios
        #   - Adjudicación Simplificada: 8 días calendarios
        #   - Concurso Público / Licitación Pública: 22 días calendarios
        #   - Comparación de Precios: 5 días calendarios
        #   - Contratación Directa: sin plazo mínimo (excepcional)
        minimo = None
        if "LICITACION" in tipo_norm or "CONCURSO" in tipo_norm:
            minimo = 22
        elif "SUBASTA" in tipo_norm:
            minimo = 12
        elif "ADJUDICACION SIMPLIFICADA" in tipo_norm or "AS-" in tipo_norm:
            minimo = 8
        elif "COMPARACION" in tipo_norm:
            minimo = 5
        elif "DIRECTA" in tipo_norm:
            minimo = 0
        result = {
            "regla": "plazo_convocatoria_minimo",
            "tipo_proceso": tipo,
            "dias_efectivos": delta_dias,
            "dias_minimo": minimo,
            "triggered": False,
        }
        if minimo is not None and minimo > 0 and delta_dias < minimo:
            result.update({
                "triggered": True,
                "severidad": "alta",
                "evidencia": (
                    f"Plazo entre convocatoria ({fconv}) y buena pro ({fbp}) es de "
                    f"{delta_dias} días — debajo del mínimo legal de {minimo} días "
                    f"para {tipo}."
                ),
                "norma": "Art. 53 Reglamento Ley 32069 — plazos mínimos según tipo de proceso",
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
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT tipo_proceso, cuantia_referencial FROM convocatorias WHERE ocid=%s",
            (ocid,),
        )
        row = cur.fetchone()
        if not row:
            return {"regla": "tipo_proceso_vs_monto", "triggered": False, "motivo": "convocatoria no encontrada"}
        tipo, cuantia = row
        if not tipo or not cuantia:
            return {"regla": "tipo_proceso_vs_monto", "triggered": False, "motivo": "sin datos"}
        tipo_norm = (tipo or "").upper()
        cuantia_f = float(cuantia)
        # Topes del perfil (Anexo IV LCE, en UIT). Defaults = bienes/servicios:
        #   CP ≤ 15 UIT · AS ≤ 400 UIT (obras: 1800, lo pasa el perfil en `topes_uit`)
        #   LP > 400 UIT bienes/servicios o > 1800 UIT obras
        UIT = _tope(topes, _TOPES_DEFAULT["uit_soles"], "uit_soles", "uit")
        tope_cp = _tope(topes, _TOPES_DEFAULT["comparacion_precios_max"],
                        "comparacion_precios_max", "comparacion_precios")
        tope_as = _tope(topes, _TOPES_DEFAULT["adjudicacion_simplificada_max"],
                        "adjudicacion_simplificada_max", "adjudicacion_simplificada",
                        "licitacion_publica")
        en_uit = cuantia_f / UIT
        result = {
            "regla": "tipo_proceso_vs_monto",
            "tipo_proceso": tipo,
            "cuantia_soles": cuantia_f,
            "cuantia_uit": round(en_uit, 1),
            "topes_uit": {"uit_soles": UIT, "comparacion_precios_max": tope_cp,
                          "adjudicacion_simplificada_max": tope_as},
            "triggered": False,
        }
        if ("COMPARACION" in tipo_norm or "CP-" in tipo_norm) and en_uit > tope_cp:
            result.update({
                "triggered": True,
                "severidad": "alta",
                "evidencia": (
                    f"Tipo 'Comparación de Precios' usado con monto {cuantia_f:.2f} soles "
                    f"({en_uit:.1f} UIT) — excede el tope de {tope_cp:g} UIT para CP. "
                    f"Debería haber ido por Adjudicación Simplificada o Licitación Pública."
                ),
                "norma": "Anexo IV TUO Ley 30225 / Ley 32069 — tipos de procedimiento según monto",
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        elif ("ADJUDICACION SIMPLIFICADA" in tipo_norm or "AS-" in tipo_norm) and en_uit > tope_as:
            result.update({
                "triggered": True,
                "severidad": "alta",
                "evidencia": (
                    f"Tipo 'Adjudicación Simplificada' usado con monto {cuantia_f:.2f} soles "
                    f"({en_uit:.1f} UIT) — excede el tope de {tope_as:g} UIT para AS según el "
                    f"tipo de contratación. Debería haber ido por Licitación Pública."
                ),
                "norma": "Anexo IV TUO Ley 30225 / Ley 32069",
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

def _identificar_causal_directa(fundamento_textos: list[str], objeto_contrato: str = "") -> dict:
    """Identifica qué causal del Art. 27 / Art. 55 invocó la entidad para una
    Contratación Directa. Retorna {causal_letra, descripcion, evidencia_text,
    requiere_acto_resolutivo, match_score}.

    Si ninguna causal coincide, retorna {causal_letra: None, ...}.
    """
    import re as _re
    corpus = " ".join(str(t) for t in (fundamento_textos or []))[:10000]
    corpus_lower = corpus.lower()

    for letra, pattern, descripcion, requiere_resol in _CAUSALES_DIRECTA:
        m = _re.search(pattern, corpus_lower, _re.IGNORECASE)
        if m:
            return {
                "causal_letra": letra,
                "descripcion": descripcion,
                "evidencia_text": corpus[max(0, m.start()-50):m.end()+100],
                "requiere_acto_resolutivo": requiere_resol,
                "match": True,
            }
    return {"causal_letra": None, "descripcion": None, "evidencia_text": None,
            "requiere_acto_resolutivo": False, "match": False}

_ACTO_PATTERNS = [
    ("D.S.",    r"((?:D\.\s?S\.|Decreto\s+Supremo)\s*N[°º\.\s]*\s*\d{1,4}\s*-\s*\d{4}(?:-[A-Z]+)?)", "Decreto Supremo"),
    ("D.U.",    r"((?:D\.\s?U\.|Decreto\s+de\s+Urgencia)\s*N[°º\.\s]*\s*\d{1,4}\s*-\s*\d{4})", "Decreto de Urgencia"),
    ("RM",      r"((?:R\.\s?M\.|Resoluci[oó]n\s+Ministerial)\s*N[°º\.\s]*\s*\d{1,5}\s*-\s*\d{4}(?:-[\w/]+)?)", "Resolución Ministerial"),
    ("RVM",     r"((?:R\.\s?V\.\s?M\.|Resoluci[oó]n\s+Viceministerial)\s*N[°º\.\s]*\s*\d{1,5}\s*-\s*\d{4}(?:-[\w/]+)?)", "Resolución Viceministerial"),
    ("RJ",      r"((?:R\.\s?J\.|Resoluci[oó]n\s+Jefatural)\s*N[°º\.\s]*\s*\d{1,5}\s*-\s*\d{4}(?:-[\w/]+)?)", "Resolución Jefatural"),
    ("RA",      r"((?:R\.\s?A\.|Resoluci[oó]n\s+de\s+Alcald[ií]a|Resoluci[oó]n\s+Ejecutiva\s+Regional|Resoluci[oó]n\s+Gerencial(?:\s+General)?|Resoluci[oó]n\s+Directoral|Resoluci[oó]n\s+de\s+Gerencia\s+General)\s*N[°º\.\s]*\s*\d{1,5}\s*-\s*\d{4}(?:-[\w/]+)?)", "Resolución de la entidad"),
    ("ACUERDO", r"(Acuerdo\s+(?:Regional|Municipal|de\s+Concejo|de\s+Consejo\s+Regional)\s+N[°º\.\s]*\s*\d{1,5}\s*-\s*\d{4}(?:-[\w/]+)?)", "Acuerdo Regional/Municipal"),
    ("ORD",     r"(Ordenanza\s+(?:Regional|Municipal)\s+N[°º\.\s]*\s*\d{1,5}\s*-\s*\d{4}(?:-[\w/]+)?)", "Ordenanza"),
]
_FECHA_CERCANA_RE = r"(\d{1,2}\s+de\s+\w+\s+(?:del?\s+)?\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4})"


def _buscar_acto_resolutivo(state: dict) -> dict:
    """Busca el acto resolutivo (D.S., D.U., R.M., acuerdo regional, resolución de
    alcaldía/gerencia, ordenanza) que sustenta una causal de Contratación Directa.

    Orden de búsqueda (hallazgo #5 de la auditoría):
      1. TEXTO COMPLETO de los documentos (`documentos_texto` por sha256 en state) →
         devuelve `documento_sha256`, `pagina` y `cita` literal.
      2. Bloques tipados del parser: `estudio_mercado.causal_articulo/causal_texto`,
         `sustento_directa.acto_aprobatorio` (bloque del perfil OTROS).
      3. Resúmenes del parser (fundamento_legal, motivos, requerimientos) — fuente
         DÉBIL: si SOLO hubo resúmenes y no se encontró, `solo_resumenes=true` y la
         regla degrada la bandera a MEDIA con `requiere_verificacion`.

    Retorna {encontrado, tipo, numero, fecha_proxima, fragmento/cita, fuente,
             documento_sha256, pagina, texto_completo_disponible, solo_resumenes}.
    """
    import re as _re

    # 1) Texto completo por sha256 (tabla documentos_texto del WS D)
    textos = _verify.textos_documentos(state)
    texto_completo = bool(textos)
    for _tipo, pattern, descripcion in _ACTO_PATTERNS:
        hit = _verify.buscar_en_documentos(state, _re.compile(pattern, _re.IGNORECASE))
        if hit:
            fecha_m = _re.search(_FECHA_CERCANA_RE, hit["cita"])
            return {
                "encontrado": True, "tipo": descripcion, "numero": hit["match"],
                "fecha_proxima": fecha_m.group(1) if fecha_m else None,
                "fragmento": hit["cita"], "cita": hit["cita"],
                "fuente": "documentos_texto", "documento_sha256": hit["sha256"],
                "pagina": hit["pagina"], "texto_completo_disponible": True,
                "solo_resumenes": False,
            }

    # 2) Bloques tipados del parser (estudio de mercado / sustento de la directa)
    raw = state.get("parser_raw_consolidated") or {}
    doc_analysis = state.get("document_analysis")
    if isinstance(doc_analysis, str):
        doc_analysis = _safe_parse_json(doc_analysis) or {}
    em = _safe_parse_json(state.get("estudio_mercado")) or {}
    tipados: list[str] = []
    for src in (em, (raw.get("sustento_directa") if isinstance(raw, dict) else None) or {},
                (doc_analysis or {}).get("sustento_directa") or {}):
        if not isinstance(src, dict):
            continue
        for k in ("causal_articulo", "causal_texto", "acto_aprobatorio", "informe_tecnico",
                  "informe_legal", "acto_resolutivo"):
            v = src.get(k)
            if isinstance(v, str):
                tipados.append(v)
            elif isinstance(v, dict):
                tipados.append(" ".join(str(x) for x in v.values() if x))
    corpus_tipado = "\n".join(tipados)
    for _tipo, pattern, descripcion in _ACTO_PATTERNS:
        m = _re.search(pattern, corpus_tipado, _re.IGNORECASE)
        if m:
            frag = corpus_tipado[max(0, m.start() - 100):m.end() + 200]
            fecha_m = _re.search(_FECHA_CERCANA_RE, frag)
            return {"encontrado": True, "tipo": descripcion, "numero": m.group(1),
                    "fecha_proxima": fecha_m.group(1) if fecha_m else None,
                    "fragmento": frag.strip()[:400], "cita": frag.strip()[:240],
                    "fuente": "parser_bloque_tipado", "documento_sha256": None, "pagina": None,
                    "texto_completo_disponible": texto_completo, "solo_resumenes": not texto_completo}

    # 3) Resúmenes del parser (fuente débil)
    texts: list[str] = []
    for src in (raw if isinstance(raw, dict) else {}, doc_analysis or {}):
        for k in ("fundamento_legal", "motivos_adjudicacion", "lugar_fecha_acta",
                  "raw_text_excerpt", "considerandos"):
            v = src.get(k)
            if isinstance(v, str):
                texts.append(v)
            elif isinstance(v, list):
                texts.extend(str(x) for x in v)
        for it in (src.get("items") or src.get("items_consolidados") or []):
            if isinstance(it, dict):
                for k in ("requerimiento_tecnico_detallado", "texto_literal"):
                    v = it.get(k)
                    if isinstance(v, str):
                        texts.append(v)
    corpus = "\n".join(texts)
    if not corpus.strip() and not texto_completo and not corpus_tipado.strip():
        return {"encontrado": False, "motivo": "documentos sin texto parseable",
                "texto_completo_disponible": False, "solo_resumenes": True}
    for _tipo, pattern, descripcion in _ACTO_PATTERNS:
        m = _re.search(pattern, corpus, _re.IGNORECASE)
        if m:
            frag = corpus[max(0, m.start() - 100):m.end() + 200]
            fecha_m = _re.search(_FECHA_CERCANA_RE, frag)
            return {"encontrado": True, "tipo": descripcion, "numero": m.group(1),
                    "fecha_proxima": fecha_m.group(1) if fecha_m else None,
                    "fragmento": frag.strip()[:400], "cita": frag.strip()[:240],
                    "fuente": "parser_resumen", "documento_sha256": None, "pagina": None,
                    "texto_completo_disponible": texto_completo, "solo_resumenes": not texto_completo}
    return {"encontrado": False,
            "motivo": ("ningún acto resolutivo identificado en el texto completo de los documentos"
                       if texto_completo else
                       "ningún acto resolutivo en los resúmenes del parser (sin texto completo disponible)"),
            "texto_completo_disponible": texto_completo, "solo_resumenes": not texto_completo,
            "documentos_revisados": len(textos)}

def check_directa_fundamento_rule(ocid: str, tool_context: ToolContext,
                                  reglas_activas: frozenset[str] | None = None,
                                  topes_uit: dict | None = None) -> dict:
    """Si el tipo de proceso es Contratación Directa, verifica que la causal
    legal del Art. 27 TUO Ley 30225 / Art. 55 Ley 32069 esté:
      1. IDENTIFICADA (cuál de las letras a/b/c/.../k se invoca).
      2. ACREDITADA con acto resolutivo (D.S., D.U., resolución, acuerdo) si
         la causal lo exige (emergencia, desabastecimiento).

    Lee state['document_analysis'].fundamento_legal + parser_raw_consolidated.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con causal_invocada, acto_resolutivo, triggered, severidad,
        evidencia, norma.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("directa_sin_fundamento", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT tipo_proceso, objeto FROM convocatorias WHERE ocid=%s", (ocid,))
        row = cur.fetchone()
        if not row or not row[0]:
            return {"regla": "directa_sin_fundamento", "triggered": False}
        tipo, objeto = row[0], (row[1] or "")
        if "DIRECTA" not in (tipo or "").upper() and "EXONERA" not in (tipo or "").upper():
            return {"regla": "directa_sin_fundamento", "triggered": False,
                    "motivo": "no es contratación directa"}

        state = tool_context.state

        # 1. Extraer fundamento_legal del document_analysis
        doc = _safe_parse_json(state.get("document_analysis"))
        fund = (doc or {}).get("fundamento_legal") or []
        # También considerar el parser_raw_consolidated como fallback
        raw = state.get("parser_raw_consolidated") or {}
        if not fund and raw.get("fundamento_legal"):
            fund = raw["fundamento_legal"]

        # 2. Identificar causal específica
        causal = _identificar_causal_directa(fund, objeto)
        # Mantener compatibilidad con la heurística vieja: si el regex no
        # encontró una causal pero el texto menciona keywords legales,
        # consideramos que SÍ hay una causal vaga (no triggera bandera).
        tiene_keyword_legal = any(
            "55" in str(f) or "EMERGENCIA" in str(f).upper() or
            "EXONERA" in str(f).upper() or "D.S." in str(f) or
            "DECRETO SUPREMO" in str(f).upper()
            for f in fund
        )

        # 3. Buscar acto resolutivo si la causal lo requiere
        acto = None
        if causal["match"] and causal["requiere_acto_resolutivo"]:
            acto = _buscar_acto_resolutivo(state)

        # Persistir hallazgos en state para que el dictamen los cite
        state["causal_directa_invocada"] = causal
        if acto is not None:
            state["acto_resolutivo_directa"] = acto

        result = {
            "regla": "directa_sin_fundamento",
            "tipo_proceso": tipo,
            "fundamento_legal_documentado": fund,
            "causal_invocada": causal,
            "acto_resolutivo": acto,
            "triggered": False,
        }

        # Decidir si triggea bandera y con qué severidad
        if not causal["match"] and not tiene_keyword_legal:
            # No identificamos causal ni hay keywords legales → bandera ALTA
            result.update({
                "triggered": True,
                "severidad": "alta",
                "evidencia": (
                    f"Tipo de proceso '{tipo}' sin causal legal claramente "
                    f"identificable del Art. 27 TUO Ley 30225 / Art. 55 Ley 32069. "
                    f"Fundamento extraído del documento: "
                    f"{fund if fund else 'ninguno'}"
                ),
                "norma": "Art. 27 TUO Ley 30225 / Art. 55.1 Ley 32069 — causales "
                         "de selección no competitiva deben estar acreditadas",
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        elif causal["match"] and causal["requiere_acto_resolutivo"] and acto and not acto.get("encontrado"):
            # Identificamos causal de emergencia/desabastecimiento pero NO se encuentra
            # el acto resolutivo que la declara. ALTA solo si se revisó el TEXTO COMPLETO
            # de los documentos; si solo hubo resúmenes del parser → MEDIA con
            # `requiere_verificacion` (hallazgo #5: el acto puede estar en el PDF y no
            # en el resumen).
            solo_resumenes = bool(acto.get("solo_resumenes"))
            result.update({
                "triggered": True,
                "severidad": "media" if solo_resumenes else "alta",
                "requiere_verificacion": solo_resumenes,
                "regla": "directa_emergencia_sin_acto_resolutivo",
                "evidencia": (
                    f"La Contratación Directa invocó causal '{causal['descripcion']}' "
                    f"(Art. 27 lit. {causal['causal_letra']}), pero no se identifica "
                    + ("en el texto completo de los documentos publicados "
                       if not solo_resumenes else
                       "en los resúmenes disponibles de los documentos (texto completo no disponible: "
                       "requiere verificación manual del expediente) ")
                    + "el acto resolutivo que declara la situación (D.S./D.U./Resolución/Acuerdo "
                    "Regional). Sin acto resolutivo acreditable, la causal carece de sustento legal."
                ),
                "norma": "Art. 27.1 lit. a) TUO Ley 30225 — la situación de emergencia "
                         "debe estar acreditada por declaratoria oficial",
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        elif not causal["match"] and tiene_keyword_legal:
            # Keywords legales presentes pero sin causal específica → bandera MEDIA
            result.update({
                "triggered": True,
                "severidad": "media",
                "regla": "directa_causal_imprecisa",
                "evidencia": (
                    f"Tipo de proceso '{tipo}' menciona referencias legales pero no "
                    f"identifica la causal específica del Art. 27/55. Fundamento "
                    f"detectado: {fund}"
                ),
                "norma": "Art. 27 TUO Ley 30225 / Art. 55.1 Ley 32069",
                "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
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
                "norma": "Heurística — Art. 50 TUO Ley 30225 (impedimentos)",
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
        sunat = (tool_context.state.get("sunat_profiles") or {}).get(ruc) or {}
        ciiu = (sunat.get("ciiu_principal") or "").lower()
        activs = sunat.get("actividades_economicas") or []
        if not ciiu and not activs:
            return {"regla": "ciiu_vs_objeto", "triggered": False, "motivo": "sin CIIU disponible"}

        objeto_low = (objeto or "").lower()
        # Heurística simple: si CIIU contiene "textil/calzado/restaurant/cosmetic"
        # y el objeto es algo muy distinto (computadora, médico, vehículo, asfalto, etc.)
        # Keywords ESPECÍFICAS por rubro. Se sacaron los términos ambiguos que
        # producían categorías falsas ("mayor"/"menor" → alimentos por "venta al por
        # mayor"; "obra"/"materiales" → construcción en cualquier objeto).
        objeto_keywords = {
            "computer": ["computadora", "informatica", "software", "tecnologia", "laptop", "impresora"],
            "construccion": ["construccion", "ferreteria", "cemento", "agregados", "edificacion", "asfalto"],
            "alimentos": ["alimento", "comestible", "bebida", "viveres", "carne", "lacteo", "abarrote"],
            "vehiculos": ["vehiculo", "maquinaria", "motor", "transporte", "camion", "volquete"],
            "salud": ["medico", "farmaceutico", "hospital", "salud", "medicamento", "insumo medico"],
            "textil": ["textil", "calzado", "ropa", "uniforme", "confeccion"],
        }
        ciiu_full = (ciiu + " " + " ".join(str(a) for a in activs)).lower()
        # Detectar categoría del objeto
        cat_objeto = None
        for cat, kws in objeto_keywords.items():
            if any(kw in objeto_low for kw in kws):
                cat_objeto = cat; break
        # Detectar categoría del CIIU
        cat_ciiu = None
        for cat, kws in objeto_keywords.items():
            if any(kw in ciiu_full for kw in kws):
                cat_ciiu = cat; break

        result = {
            "regla": "ciiu_vs_objeto",
            "objeto_categoria": cat_objeto,
            "ciiu_categoria": cat_ciiu,
            "ciiu_principal": sunat.get("ciiu_principal"),
            "actividades": activs,
            "triggered": False,
        }
        if cat_objeto and cat_ciiu and cat_objeto != cat_ciiu:
            result.update({
                "triggered": True,
                "severidad": "media",
                "evidencia": (
                    f"{razon} (RUC {ruc}) tiene CIIU principal en rubro '{cat_ciiu}' "
                    f"pero el contrato adjudicado es de '{cat_objeto}'. Verificar "
                    f"capacidad técnica real del proveedor."
                ),
                "norma": "Heurística — coherencia rubro empresa vs objeto del contrato",
                "fuente_url": f"https://sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc={ruc}",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

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


def check_concentracion_entidad_rule(ocid: str, tool_context: ToolContext,
                                     reglas_activas: frozenset[str] | None = None,
                                     topes_uit: dict | None = None) -> dict:
    """Detecta si el proveedor adjudicado concentra contratos con la entidad
    contratante actual. Cuenta en `convocatorias` (BD propia: procesos ingestados
    del SEACE), NO en lo que `web_research` (LLM con grounding) "dijo haber visto"
    (hallazgo #8). Dispara con ≥3 contratos previos con la misma entidad Y ≥40 % de
    su historial en la BD; el alcance (solo procesos en la base de Vigía) queda
    explícito en la evidencia.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con triggered, severidad, evidencia, ocids_misma_entidad.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("concentracion_entidad", reglas)
    if om:
        return om
    state = tool_context.state
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT c.entidad_ruc, (SELECT nombre FROM entidades e WHERE e.ruc=c.entidad_ruc) "
            "FROM convocatorias c WHERE c.ocid=%s", (ocid,))
        row = cur.fetchone()
        entidad_ruc = (row and row[0]) or None
        entidad_nombre = (row and row[1]) or ""
        prov_ruc, prov_nombre = _ganador_ruc(ocid, state, cur)
        if not prov_ruc:
            return {"regla": "concentracion_entidad", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin proveedor adjudicado identificable"}
        cur.execute(
            """SELECT DISTINCT c.ocid, c.entidad_ruc, c.fecha_convocatoria, c.cuantia_referencial
                 FROM convocatorias c
                 LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                 LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                WHERE c.ocid<>%s AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)""",
            (prov_ruc, ocid, prov_ruc))
        rows = cur.fetchall()
    finally:
        conn.close()

    n_total = len(rows)
    misma = [r for r in rows if entidad_ruc and r[1] == entidad_ruc]
    n_misma = len(misma)
    pct = (n_misma / n_total * 100) if n_total else 0.0
    result = {
        "regla": "concentracion_entidad",
        "proveedor_ruc": prov_ruc,
        "n_contratos_misma_entidad": n_misma,
        "n_total_contratos_en_base": n_total,
        "pct_concentracion": round(pct, 1),
        "ocids_misma_entidad": [r[0] for r in misma][:10],
        "estado": "hallado" if n_total else "sin_dato",
        "_nota_alcance": "Conteos sobre procesos ingestados en la base de Vigía, no el universo SEACE.",
        "triggered": False,
    }
    if n_misma >= 3 and pct >= 40:
        result.update({
            "triggered": True,
            "severidad": "media",
            "evidencia": (
                f"{prov_nombre or 'El proveedor'} (RUC {prov_ruc}) registra {n_misma} procesos previos "
                f"con {entidad_nombre or 'esta entidad'} sobre {n_total} procesos suyos en la base de "
                f"Vigía ({pct:.0f}%). Procesos: {', '.join(result['ocids_misma_entidad'][:5])}. "
                f"Patrón de concentración con un solo comprador (alcance: base propia, no universo SEACE)."
            ),
            "norma": "Heurística — concentración cliente público debilita la competencia natural",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        tool_context.state.setdefault("pending_flags", []).append(result)
    return result

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
    relevantes, no_verificables = [], []
    for c in cruces:
        if not isinstance(c, dict):
            continue
        if not c.get("tipo_relacion") or c.get("tipo_relacion") == "sin_relacion":
            continue
        if c.get("severidad") not in ("alta", "media"):
            continue
        fuente = str(c.get("fuente_url") or "").strip()
        conf = str(c.get("confianza_match") or c.get("confianza") or "").strip().lower()
        if fuente.startswith("http") and conf == "alta":
            relevantes.append(c)
        else:
            falta = []
            if not fuente.startswith("http"):
                falta.append("fuente_url")
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
            "norma": "Heurística — Art. 50 TUO Ley 30225 / Ley 30057 — impedimentos por vínculo personal",
            "fuente_url": primero.get("fuente_url"),
        })
        tool_context.state.setdefault("pending_flags", []).append(result)
    return result

def check_testaferro_multi_ruc_rule(ocid: str, tool_context: ToolContext,
                                    reglas_activas: frozenset[str] | None = None,
                                    topes_uit: dict | None = None) -> dict:
    """C9 — Testaferro multi-RUC: detecta cuando el representante legal / socio /
    titular del ganador aparece como representante de ≥3 empresas distintas que
    también ganaron contratos del Estado. Patrón típico de testaferro.

    Fuente: cruza datos de `query_rnp_empresa` + alertas históricas en BD.
    Norma: Art. 50 TUO Ley 30225 (impedimentos) + Art. 11 inc. m (consorcio sin declarar).
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("testaferro_multi_ruc", reglas)
    if om:
        return om
    state = tool_context.state
    rnp_empresa = state.get("rnp_empresa_proveedor") or {}
    socios = rnp_empresa.get("socios") or []
    representantes = rnp_empresa.get("representantes_legales") or []
    organos = rnp_empresa.get("organos_administracion") or []

    # Extraer todos los DNI/RUC de personas vinculadas al proveedor
    personas = set()
    for p in socios + representantes + organos:
        if isinstance(p, dict):
            doc = (p.get("numero_documento") or "").strip()
            if doc:
                personas.add(doc)

    if not personas:
        return {"regla": "testaferro_multi_ruc", "triggered": False,
                "motivo": "sin personas vinculadas en RNP del proveedor"}

    conn = _pg()
    try:
        cur = conn.cursor()
        # Por cada persona, contar cuántas empresas DISTINTAS donde aparece y han ganado contratos del Estado
        triggered_list = []
        for doc in personas:
            cur.execute(
                """SELECT COUNT(DISTINCT r.ruc_empresa) AS n_empresas,
                          ARRAY_AGG(DISTINCT r.ruc_empresa) AS rucs
                     FROM rnp_conformacion_juridica r
                     JOIN alertas a ON a.proveedor_ruc = r.ruc_empresa
                    WHERE r.numero_documento = %s
                      AND a.analizado_en >= NOW() - INTERVAL '12 months'""",
                (doc,),
            )
            row = cur.fetchone()
            if row and (row[0] or 0) >= 3:
                triggered_list.append({
                    "numero_documento": doc,
                    "n_empresas_ganadoras": int(row[0]),
                    "rucs_empresas": (row[1] or [])[:10],
                })

        result = {
            "regla": "testaferro_multi_ruc",
            "n_personas_evaluadas": len(personas),
            "n_triggered": len(triggered_list),
            "detalle": triggered_list,
            "triggered": len(triggered_list) > 0,
        }
        if triggered_list:
            principal = triggered_list[0]
            result.update({
                "severidad": "alta",
                "evidencia": (
                    f"Persona con documento {principal['numero_documento']} figura como representante "
                    f"de {principal['n_empresas_ganadoras']} empresas distintas que ganaron "
                    f"contratos del Estado en los últimos 12 meses. Patrón típico de testaferro multi-RUC."
                ),
                "norma": "Art. 50 TUO Ley 30225 — Impedimentos / Art. 11 inc. m (consorcio sin declarar)",
                "fuente_url": None,
            })
            state.setdefault("pending_flags", []).append(result)
        return result
    except Exception as e:
        return {"regla": "testaferro_multi_ruc", "triggered": False, "error": str(e)[:200]}
    finally:
        conn.close()

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
    UIT_2026 = 5150
    UMBRAL = 8 * UIT_2026  # ~S/. 41,200

    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT e.ruc, e.razon_social, SUM(o.monto_ofertado) AS monto,
                      c.fecha_buena_pro
                 FROM postores p
                 JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                 JOIN empresas e ON e.ruc=p.empresa_ruc
                 LEFT JOIN convocatorias c ON c.ocid=p.ocid
                WHERE p.ocid=%s
                GROUP BY e.ruc, e.razon_social, c.fecha_buena_pro""",
            (ocid,),
        )
        ganadores = cur.fetchall()
        if not ganadores:
            return {"regla": "ruc_ultra_nuevo", "triggered": False, "motivo": "sin ganadores"}

        from datetime import datetime, date
        triggered_list = []
        for ruc, razon, monto, fbp in ganadores:
            monto_f = float(monto or 0)
            if monto_f < UMBRAL:
                continue
            profile = sunat_profiles.get(ruc) or {}
            fecha_inicio = profile.get("fecha_inicio_actividades")
            if not fecha_inicio:
                continue
            try:
                d_inicio = datetime.strptime(str(fecha_inicio)[:10], "%Y-%m-%d").date()
                d_ref = fbp if isinstance(fbp, date) else date.today()
                if isinstance(d_ref, str):
                    d_ref = datetime.strptime(d_ref[:10], "%Y-%m-%d").date()
                edad_dias_a_bp = (d_ref - d_inicio).days
            except Exception:
                continue
            if 0 <= edad_dias_a_bp < 90:
                triggered_list.append({
                    "ruc": ruc, "razon_social": razon,
                    "monto": monto_f,
                    "edad_dias_a_buena_pro": edad_dias_a_bp,
                    "fecha_inicio_ruc": str(fecha_inicio),
                    "fecha_buena_pro": str(d_ref),
                })

        result = {"regla": "ruc_ultra_nuevo", "n_evaluados": len(ganadores),
                  "n_triggered": len(triggered_list), "detalle": triggered_list,
                  "triggered": len(triggered_list) > 0}
        if triggered_list:
            p = triggered_list[0]
            result.update({
                "severidad": "alta",
                "evidencia": (
                    f"{p['razon_social']} (RUC {p['ruc']}) tiene "
                    f"{p['edad_dias_a_buena_pro']} días desde alta de RUC al momento de "
                    f"la buena pro ({p.get('fecha_buena_pro')}). Monto adjudicado S/. {(p.get('monto') or 0):,.2f}. "
                    f"Empresa creada EN VENTANA DE 90 DÍAS antes del contrato → patrón clásico de empresa de papel."
                ),
                "norma": "Art. 50 lit. d TUO Ley 30225 + Opinión OECE 056-2023",
                "fuente_url": f"https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc={p['ruc']}",
            })
            state.setdefault("pending_flags", []).append(result)
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
                "norma": "Art. 2 TUO Ley 30225 — Principio de Competencia Efectiva",
                "fuente_url": None,
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        return result
    finally:
        conn.close()

def check_inconsistencia_doc_vs_ocds_rule(ocid: str, tool_context: ToolContext,
                                          reglas_activas: frozenset[str] | None = None,
                                          topes_uit: dict | None = None) -> dict:
    """C12 — Inconsistencia documento ↔ OCDS: el monto/items extraídos del PDF
    por el `document_parser_agent` difieren del OCDS publicado por OECE. Indica:
    (a) manipulación del acta, (b) error de publicación, o (c) el OCDS no
    refleja la realidad documental.

    Norma: principio de transparencia (Art. 2 TUO) + Art. 64 — publicidad de actos.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("inconsistencia_doc_vs_ocds", reglas)
    if om:
        return om
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    doc = _safe_parse_json(state.get("document_analysis")) or {}
    if not ocds or not doc:
        return {"regla": "inconsistencia_doc_vs_ocds", "triggered": False,
                "motivo": "sin datos suficientes (OCDS o document_analysis vacío)"}

    tender = ocds.get("tender") or {}
    val = tender.get("value") or {}
    cuantia_ocds = float(val.get("amount") or 0)
    cuantia_doc = float(doc.get("cuantia_total") or 0)

    n_items_ocds = len(tender.get("items") or [])
    items_doc = doc.get("items_consolidados") or []
    n_items_doc = len(items_doc)
    # Solo ÍTEMS RAÍZ para comparar conteos: el parser desglosa sub-ítems
    # (`padre_ocds_item` ≠ null, `subitems`, `es_subitem`) que el OCDS nunca lista;
    # compararlos disparaba "items_count_distinto" por diseño (auditoría §2.1).
    items_raiz = [it for it in items_doc if isinstance(it, dict)
                  and not it.get("padre_ocds_item") and not it.get("es_subitem")
                  and not it.get("padre")]
    n_items_raiz = len(items_raiz)

    inconsistencias = []
    if cuantia_ocds > 0 and cuantia_doc > 0:
        diff_pct = abs(cuantia_ocds - cuantia_doc) / max(cuantia_ocds, 1) * 100
        if diff_pct > 5:
            inconsistencias.append({
                "tipo": "cuantia_distinta",
                "ocds": cuantia_ocds, "documento": cuantia_doc,
                "diff_pct": round(diff_pct, 1),
            })
    if n_items_ocds > 0 and n_items_raiz > 0 and n_items_ocds != n_items_raiz:
        inconsistencias.append({
            "tipo": "items_count_distinto",
            "n_items_ocds": n_items_ocds, "n_items_documento": n_items_raiz,
            "n_items_documento_con_subitems": n_items_doc,
        })

    # INCONGRUENCIA OBJETO ↔ DOCUMENTO: compara el PRODUCTO del objeto convocado
    # (la parte antes de META/PROYECTO/CUI) contra lo que el parser extrajo de los
    # documentos (descripciones de ítems). CERO solape de tokens de producto = el
    # Bases adjunto NO corresponde al objeto (Bases mal adjuntado, plantilla reusada,
    # expediente incongruente). NO depende de items OCDS (que suelen venir vacíos).
    # Detecta el caso 1221246: objeto "BALDOSAS DE FIBRA MINERAL" con Bases de laptops/PCs.
    import re as _re_inc
    _STOP = {"adquisicion", "adquisición", "servicio", "servicios", "contratacion",
             "contratación", "para", "por", "con", "del", "las", "los", "meta", "proyecto",
             "mejoramiento", "mantenimiento", "bien", "bienes", "obra", "obras", "general",
             "generales", "sede", "central", "unidad", "mediante", "modalidad", "proceso",
             "seleccion", "selección", "compra", "suministro", "item", "items", "equipo", "equipos"}

    def _tok_prod(txt):
        txt = _re_inc.sub(r"[^a-záéíóúñ0-9 ]", " ", (txt or "").lower())
        # singular simple (laptops→laptop, equipos→equipo) para no marcar incongruencia
        # por número gramatical.
        return {(w[:-1] if w.endswith("s") and len(w) > 4 else w)
                for w in txt.split() if len(w) > 3 and w not in _STOP}
    # `tender.description` es el PRODUCTO ("ADQUISICIÓN DE BALDOSAS…"); `tender.title`
    # suele ser el CÓDIGO del proceso ("COMPRE-COMPRE-73-…") → preferir description.
    objeto = tender.get("description") or doc.get("objeto") or tender.get("title") or ""
    objeto_prod = _re_inc.split(r"\b(meta|proyecto|con cui|cui\s*n)\b", objeto, maxsplit=1, flags=_re_inc.I)[0]
    doc_descs = [str(it.get("descripcion_corta") or "") for it in items_doc if isinstance(it, dict)]
    doc_items_txt = " ".join(doc_descs)
    # Si los ítems del doc son PLACEHOLDERS genéricos (parser no extrajo el producto
    # real: 'BIEN/SERVICIO PRINCIPAL 1', 'COMPONENTE A', 'Bien o servicio del ítem X'),
    # NO es una incongruencia de rubro → no flaggear (evita falso positivo).
    _gen = _re_inc.compile(r"bien\s*/?\s*servicio|bien o servicio|componente\s+[ab]\b|principal\s*\d|<.*>|gen[eé]ric", _re_inc.I)
    doc_es_generico = bool(doc_descs) and all(_gen.search(d) for d in doc_descs if d)
    obj_tok, doc_tok = _tok_prod(objeto_prod), _tok_prod(doc_items_txt)
    if obj_tok and doc_tok and not (obj_tok & doc_tok) and not doc_es_generico:
        inconsistencias.append({
            "tipo": "objeto_no_corresponde_documento",
            "objeto_producto": objeto_prod.strip()[:90],
            "doc_items": doc_items_txt[:90],
            "doc_resumen": (doc.get("resumen_ejecutivo") or "")[:120],
        })

    # EXTRACCIÓN FALLIDA: el parser corrió sobre un documento pero NO extrajo el
    # producto real. Dos variantes: (a) produjo ítems pero TODOS vacíos o genéricos
    # ('BIEN/SERVICIO PRINCIPAL 1', 'Bien o servicio del ítem X'); (b) NO produjo
    # NINGÚN ítem (items_consolidados == []) pese a haber procesado el documento
    # (resumen/tipo/requerimiento presentes). Distinto de la incongruencia (rubro
    # distinto): acá no hay rubro, hay placeholders o vacío → el análisis del
    # documento no es confiable (caso 1221246: Bases ilegible/escaneada/plantilla).
    _descs_reales = [d for d in doc_descs if d and d.strip()]
    _doc_procesado = (bool((doc.get("resumen_ejecutivo") or "").strip())
                      or bool(doc.get("tipo_documento"))
                      or doc.get("requerimiento_disponible") is not None)
    _items_inservibles = bool(items_doc) and (not _descs_reales or doc_es_generico)
    _sin_items_pese_a_doc = (n_items_doc == 0 and _doc_procesado)
    if _items_inservibles or _sin_items_pese_a_doc:
        inconsistencias.append({
            "tipo": "extraccion_documento_fallida",
            "n_items": n_items_doc,
            "doc_resumen": (doc.get("resumen_ejecutivo") or "")[:120],
        })

    result = {
        "regla": "inconsistencia_doc_vs_ocds",
        "cuantia_ocds": cuantia_ocds,
        "cuantia_documento": cuantia_doc,
        "n_items_ocds": n_items_ocds,
        "n_items_documento": n_items_doc,
        "inconsistencias": inconsistencias,
        "triggered": len(inconsistencias) > 0,
    }
    if inconsistencias:
        # Priorizar la incongruencia de OBJETO (la más grave) si está presente.
        _prio = ["objeto_no_corresponde_documento", "extraccion_documento_fallida",
                 "cuantia_distinta", "items_count_distinto"]
        primera = min(inconsistencias,
                      key=lambda i: _prio.index(i["tipo"]) if i["tipo"] in _prio else 99)
        severidad = "media"
        if primera["tipo"] == "objeto_no_corresponde_documento":
            severidad = "alta"
            result["regla"] = "objeto_no_corresponde_documento"
            ev = (f"El objeto convocado ('{primera.get('objeto_producto')}') NO corresponde al "
                  f"contenido de los documentos del expediente, que describen un rubro distinto "
                  f"('{primera.get('doc_items') or primera.get('doc_resumen')}'). Posible Bases mal "
                  f"adjuntado, plantilla reusada o expediente incongruente — la evaluación técnica "
                  f"y de precio del proceso queda comprometida.")
        elif primera["tipo"] == "extraccion_documento_fallida":
            result["regla"] = "extraccion_documento_fallida"
            _ni = primera.get("n_items") or 0
            _det = (f"{_ni} ítem(s) extraídos, todos vacíos o genéricos" if _ni
                    else "no se extrajo ningún ítem usable del documento procesado")
            ev = (f"El parser no logró extraer el detalle real de los documentos del expediente "
                  f"({_det}). El Bases podría estar mal adjuntado, ser una plantilla o estar "
                  f"ilegible/escaneado → el análisis técnico y de precio de este proceso NO es "
                  f"confiable y debe revisarse manualmente.")
        elif primera["tipo"] == "cuantia_distinta":
            ev = (f"Discrepancia de cuantía: OCDS publica S/. {(primera.get('ocds') or 0):,.2f} "
                  f"pero el documento del expediente indica S/. {(primera.get('documento') or 0):,.2f} "
                  f"({primera.get('diff_pct')}% de diferencia). Discrepancia entre el registro OCDS y el "
                  f"expediente documental; requiere verificación manual (puede ser un acta parcial, "
                  f"un ítem desierto o una publicación desactualizada).")
        else:
            ev = (f"OCDS lista {primera['n_items_ocds']} ítems pero el documento "
                  f"tiene {primera['n_items_documento']} ítems raíz. Discrepancia entre el registro OCDS y "
                  f"el expediente documental; requiere verificación manual.")
        result.update({
            "severidad": severidad,
            "evidencia": ev,
            "norma": "Art. 2 TUO Ley 30225 — Principio de Transparencia",
            "fuente_url": None,
        })
        state.setdefault("pending_flags", []).append(result)
    return result

def evaluate_normative_compliance(ocid: str, tool_context: ToolContext) -> dict:
    """Cruza TODAS las banderas detectadas (compliance + parser + market + person)
    contra el RAG legal de 723 opiniones OECE. Para cada bandera, devuelve la
    opinión OECE más relevante (num_opinion, link, snippet, score). Esto es lo
    que la UI muestra en la sección 'Cumplimiento Normativo'.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con `evaluaciones`: lista de {bandera, opinion_oece}.
    """
    state = tool_context.state
    # Acumular hallazgos de todas las fuentes
    hallazgos: list[dict] = []

    # 1) Banderas duras del compliance (pending_flags). Solo las que superan la
    #    verificación determinista: una bandera con RUC/monto no respaldado no debe
    #    "fundamentarse" con una opinión OECE (auditoría #3).
    for b in state.get("pending_flags") or []:
        if not isinstance(b, dict):
            continue
        ver = b.get("verificacion")
        if not isinstance(ver, dict):
            try:
                ver = _verify.verificar_bandera(b, state)
            except Exception:
                ver = {"ok": True}
        if ver.get("ok") is False:
            continue
        hallazgos.append({
            "fuente": "compliance_rule",
            "titulo": b.get("regla", "regla"),
            "descripcion": b.get("evidencia", ""),
            "severidad": b.get("severidad", "media"),
        })

    # 2) Red flags documentales: emitidos por document_legal_analyst_agent
    #    (fallback al campo legacy del document_analysis si todavía lo trae)
    legal = _safe_parse_json(state.get("legal_analysis"))
    red_flags_doc = (legal or {}).get("red_flags_documentales") or []
    if not red_flags_doc:
        doc = _safe_parse_json(state.get("document_analysis"))
        red_flags_doc = (doc or {}).get("red_flags_documentales") or []
    for f in red_flags_doc:
        if isinstance(f, dict):
            hallazgos.append({
                "fuente": "legal_analyst_red_flag",
                "titulo": (f.get("descripcion") or "")[:80],
                "descripcion": f.get("descripcion", ""),
                "severidad": f.get("severidad", "media"),
            })
        elif isinstance(f, str):
            hallazgos.append({
                "fuente": "legal_analyst_red_flag",
                "titulo": f[:80],
                "descripcion": f,
                "severidad": "media",
            })

    # 3) Hallazgos de market_price (spec restrictiva, sobreprecio)
    mk = _safe_parse_json(state.get("market_analysis"))
    for finding in (mk or {}).get("findings") or []:
        if finding.get("spec_restrictiva"):
            hallazgos.append({
                "fuente": "market_spec_restrictiva",
                "titulo": "Especificación restrictiva",
                "descripcion": finding.get("spec_restrictiva", ""),
                "severidad": "alta",
            })
        if finding.get("veredicto") in ("elevado", "muy_elevado"):
            hallazgos.append({
                "fuente": "market_sobreprecio",
                "titulo": f"Sobreprecio ítem {finding.get('item_numero')}",
                "descripcion": (finding.get("comentario") or "")[:300],
                "severidad": "alta" if finding.get("veredicto") == "muy_elevado" else "media",
            })

    # 4) Cruce firmantes ↔ ganador
    pn = _safe_parse_json(state.get("person_network"))
    for c in (pn or {}).get("cruce_firmantes_ganador") or []:
        if c.get("tipo_relacion") and c.get("tipo_relacion") != "sin_relacion":
            hallazgos.append({
                "fuente": "person_cruce",
                "titulo": f"Vínculo firmante↔ganador: {c.get('tipo_relacion')}",
                "descripcion": c.get("evidencia", ""),
                "severidad": c.get("severidad", "media"),
            })

    # Dedupe (misma fuente+título) y prioridad por severidad. Ya NO se corta a 10:
    # el tope es RAG_MAX_HALLAZGOS (default 60) y, si se supera, el recorte queda
    # registrado en state['recortes'] (auditoría 6.1-4).
    _vistos: set = set()
    _dedup: list[dict] = []
    for h in hallazgos:
        k = (h.get("fuente"), (h.get("titulo") or "")[:80], (h.get("descripcion") or "")[:120])
        if k in _vistos:
            continue
        _vistos.add(k)
        _dedup.append(h)
    _sev = {"alta": 0, "media": 1, "baja": 2}
    _dedup.sort(key=lambda h: _sev.get(str(h.get("severidad")), 3))
    _max = int(os.getenv("RAG_MAX_HALLAZGOS", "60"))
    if len(_dedup) > _max:
        state.setdefault("recortes", []).append({
            "donde": "evaluate_normative_compliance", "limite": _max,
            "omitido": len(_dedup) - _max,
            "detalle": "hallazgos de menor severidad sin cruce RAG"})
    hallazgos = _dedup[:_max]

    evaluaciones = []
    for h in hallazgos:
        question = f"{h['titulo']}: {h['descripcion']}"
        try:
            rag_resp = query_legal_rag(question, tool_context)
            matches = rag_resp.get("matches") or []
            opinion = matches[0] if matches else None
        except Exception:
            opinion = None
        evaluaciones.append({
            "hallazgo": h,
            "opinion_oece": opinion,
        })

    out = {
        "ocid": ocid,
        "n_hallazgos_evaluados": len(evaluaciones),
        "n_hallazgos_totales": len(_dedup),
        "truncado": len(_dedup) > _max,
        "evaluaciones": evaluaciones,
    }
    tool_context.state["normative_compliance"] = out
    return out


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
    for p, n in con_nombre:
        toks = set(n.split())
        for cn, rol, origen in candidatos:
            ctoks = set(cn.split())
            # Coincidencia exacta o de ≥3 tokens (dos apellidos + nombre): nunca por un apellido solo.
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
        prov_ruc, prov_nombre = _ganador_ruc(ocid, state, cur)
        if not prov_ruc:
            return {"regla": "directa_recurrente", "triggered": False, "estado": "sin_dato",
                    "motivo": "sin proveedor adjudicado identificable"}
        if fecha:
            cur.execute(
                """SELECT DISTINCT c.ocid, c.entidad_ruc, c.fecha_convocatoria, c.cuantia_referencial
                     FROM convocatorias c
                     LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                     LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                    WHERE c.ocid<>%s AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)
                      AND UPPER(COALESCE(c.tipo_proceso,'')) LIKE '%%DIRECTA%%'
                      AND c.fecha_convocatoria BETWEEN %s::date - INTERVAL '12 months' AND %s::date""",
                (prov_ruc, ocid, prov_ruc, fecha, fecha))
        else:
            cur.execute(
                """SELECT DISTINCT c.ocid, c.entidad_ruc, c.fecha_convocatoria, c.cuantia_referencial
                     FROM convocatorias c
                     LEFT JOIN postores p ON p.ocid=c.ocid AND p.empresa_ruc=%s
                     LEFT JOIN ofertas o ON o.postor_id=p.id AND o.ganadora
                    WHERE c.ocid<>%s AND (c.proveedor_ruc=%s OR o.id IS NOT NULL)
                      AND UPPER(COALESCE(c.tipo_proceso,'')) LIKE '%%DIRECTA%%'
                      AND c.fecha_convocatoria >= NOW() - INTERVAL '12 months'""",
                (prov_ruc, ocid, prov_ruc))
        rows = cur.fetchall()
    finally:
        conn.close()
    procesos = [{"ocid": r[0], "entidad_ruc": r[1], "fecha": str(r[2])[:10], "cuantia": float(r[3] or 0)}
                for r in rows]
    result = {"regla": "directa_recurrente", "proveedor_ruc": prov_ruc, "n_directas_12m": len(procesos),
              "procesos": procesos[:10], "estado": "hallado" if procesos else "sin_dato",
              "_nota_alcance": "Conteos sobre procesos ingestados en la base de Vigía.", "triggered": False}
    if len(procesos) >= 3:
        result.update({
            "triggered": True, "severidad": "media",
            "evidencia": (f"{prov_nombre or 'El proveedor'} (RUC {prov_ruc}) acumula {len(procesos)} contrataciones "
                          f"directas en los 12 meses previos ({', '.join(p['ocid'] for p in procesos[:4])}), "
                          f"además de la presente. Recurrencia en procedimientos no competitivos."),
            "norma": "Art. 27 TUO Ley 30225 / Art. 55 Ley 32069 — carácter excepcional de la contratación directa",
            "fuente_url": f"https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}",
        })
        state.setdefault("pending_flags", []).append(result)
    return result

def check_lobby_visits_rule(ocid: str, tool_context: ToolContext,
                            reglas_activas: frozenset[str] | None = None,
                            topes_uit: dict | None = None) -> dict:
    """Evalúa lobby pre-convocatoria — socios/representantes del ganador o
    de cualquier postor que visitaron a la ENTIDAD CONTRATANTE en los 180 días
    previos a la fecha de convocatoria.

    Cruza `visitas_entidades` × `rnp_conformacion_juridica` × `convocatorias`.
    Fuente: Registro Único de Visitas (Ley 28024 — Gestión de Intereses).

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        dict con triggered, evidencia, visitas[], severidad.
    """
    reglas = _perfil_reglas(tool_context, reglas_activas)
    om = _regla_omitida("lobby_visits_pre_convocatoria", reglas)
    if om:
        return om
    conn = _pg()
    try:
        cur = conn.cursor()
        if not _table_exists(cur, "visitas_entidades"):
            return {"regla": "lobby_visits_pre_convocatoria", "triggered": False,
                    "dataset_no_disponible": True,
                    "hint": "Cargar dataset visitas con backend/scripts/load_visitas_entidades.py"}

        cur.execute(
            """SELECT v.visitante, v.numero_documento, r.tipo_rol,
                      emp.razon_social, emp.ruc,
                      v.funcionario_nombre, v.funcionario_cargo,
                      v.fecha_visita, v.motivo, v.duracion_min,
                      c.fecha_convocatoria, e.nombre AS entidad_nombre,
                      o.ganadora
                 FROM convocatorias c
                 JOIN entidades  e   ON e.ruc = c.entidad_ruc
                 JOIN postores   p   ON p.ocid = c.ocid
                 JOIN ofertas    o   ON o.postor_id = p.id
                 JOIN empresas   emp ON emp.ruc = p.empresa_ruc
                 JOIN rnp_conformacion_juridica r ON r.ruc_empresa = emp.ruc
                 JOIN visitas_entidades v
                      ON v.numero_documento = r.numero_documento
                     AND v.entidad_visitada_norm = UPPER(unaccent(e.nombre))
                     AND c.fecha_convocatoria IS NOT NULL
                     AND v.fecha_visita BETWEEN
                           (c.fecha_convocatoria - INTERVAL '180 days')
                       AND  c.fecha_convocatoria
                WHERE c.ocid = %s
                ORDER BY o.ganadora DESC, v.fecha_visita""",
            (ocid,),
        )
        rows = cur.fetchall()
        visitas = [
            {
                "visitante": r[0], "dni": r[1], "rol_en_empresa": r[2],
                "empresa_postora": r[3], "ruc_empresa": r[4],
                "funcionario_visitado": r[5], "cargo_funcionario": r[6],
                "fecha_visita": r[7].isoformat() if r[7] else None,
                "motivo": r[8], "duracion_min": r[9],
                "fecha_convocatoria": r[10].isoformat() if r[10] else None,
                "entidad_contratante": r[11],
                "empresa_ganadora": bool(r[12]),
            }
            for r in rows
        ]
        ganadoras = [v for v in visitas if v["empresa_ganadora"]]
        result = {
            "regla": "lobby_visits_pre_convocatoria",
            "triggered": bool(visitas),
            "n_visitas_total": len(visitas),
            "n_visitas_de_ganador": len(ganadoras),
            "visitas": visitas[:25],
            "fuente_url": "https://www.gob.pe/registro-visitas",
        }
        if ganadoras:
            v0 = ganadoras[0]
            result.update({
                "severidad": "alta",
                "evidencia": (
                    f"{v0['empresa_postora']} (RUC {v0['ruc_empresa']}) — su "
                    f"{v0['rol_en_empresa']} {v0['visitante']} visitó al funcionario "
                    f"{v0['funcionario_visitado']} ({v0['cargo_funcionario']}) "
                    f"el {v0['fecha_visita']} en {v0['entidad_contratante']}, antes de "
                    f"la convocatoria del {v0['fecha_convocatoria']}. Esta empresa fue "
                    f"declarada ganadora."
                ),
                "norma": "Ley 28024 (Gestión de Intereses) — registro de visitas obligatorio para detectar lobby.",
            })
            tool_context.state.setdefault("pending_flags", []).append(result)
        elif visitas:
            result["severidad"] = "media"
            result["evidencia"] = (
                f"{len(visitas)} visitas de socios/representantes de POSTORES (no ganador) "
                f"a la entidad contratante en los 180 días previos a la convocatoria."
            )
        return result
    finally:
        conn.close()

def detect_estado_real(ocid: str, tool_context: ToolContext) -> dict:
    """Detecta el estado REAL de una convocatoria cruzando OCDS contra los
    documentos del expediente. Sirve para identificar inconsistencias del tipo:
    'hay archivo de Buena Pro pero el OCDS dice convocatoria abierta'.

    Args:
        ocid: OCID OCDS (ej. 'ocds-dgv273-seacev3-1185504') o codigo corto.

    Returns:
        dict con:
          · estado_ocds: 'convocatoria_abierta' | 'adjudicada' | 'contrato_firmado' | 'desconocido'
          · estado_documentos: 'convocatoria' | 'buena_pro' | 'contrato' | 'cancelada'
          · estado_inconsistente: bool — true si OCDS y documentos no coinciden
          · n_postores_oferentes: int
          · n_awards: int
          · n_contracts: int
          · documentos_clave: lista de docs que sugieren estado (buena_pro, contrato, etc.)
          · evidencia: descripción human-readable
    """
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}

    # Si no tenemos OCDS, fallback a Cloud SQL
    if not ocds:
        conn = None
        try:
            conn = _pg()
            cur = conn.cursor()
            cur.execute("SELECT ocds_payload FROM convocatorias WHERE ocid = %s OR ocid LIKE %s LIMIT 1",
                        (ocid, f"%{ocid}"))
            row = cur.fetchone()
            if row and row[0]:
                ocds = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        except Exception as e:
            return {"error": f"no_ocds_disponible: {e}"}
        finally:
            if conn:
                conn.close()

    tender = ocds.get("tender") or {}
    awards = ocds.get("awards") or []
    contracts = ocds.get("contracts") or []
    documents = (tender.get("documents") or []) + sum(
        ((c.get("documents") or []) for c in contracts), []
    )
    tenderers = tender.get("tenderers") or []
    n_postores = len(tenderers) or int(tender.get("numberOfTenderers") or 0)

    # Estado OCDS
    if contracts:
        estado_ocds = "contrato_firmado"
    elif awards:
        estado_ocds = "adjudicada"
    elif tender:
        estado_ocds = "convocatoria_abierta"
    else:
        estado_ocds = "desconocido"

    # Detectar estado por documentos
    documentos_clave = []
    has_buena_pro = False
    has_contrato_doc = False
    has_cancelacion = False
    for d in documents:
        title = (d.get("title") or "").lower()
        dtype = (d.get("documentType") or "").lower()
        if (("buena" in title and "pro" in title) or
            "otorgamiento" in title or
            "awardnotice" in dtype):
            has_buena_pro = True
            documentos_clave.append({"tipo": "buena_pro", "titulo": d.get("title"), "fecha": d.get("datePublished"), "url": d.get("url")})
        elif ("contrato" in title and ("firmado" in title or "suscrito" in title)) or \
             "contractsigned" in dtype:
            has_contrato_doc = True
            documentos_clave.append({"tipo": "contrato_firmado", "titulo": d.get("title"), "fecha": d.get("datePublished"), "url": d.get("url")})
        elif "nulidad" in title or "cancelacion" in title or "cancelación" in title or "desierta" in title:
            has_cancelacion = True
            documentos_clave.append({"tipo": "cancelada", "titulo": d.get("title"), "fecha": d.get("datePublished"), "url": d.get("url")})

    if has_cancelacion:
        estado_documentos = "cancelada"
    elif has_contrato_doc:
        estado_documentos = "contrato"
    elif has_buena_pro:
        estado_documentos = "buena_pro"
    else:
        estado_documentos = "convocatoria"

    # Inconsistencia: OCDS dice convocatoria_abierta pero hay buena pro/contrato en docs
    estado_inconsistente = (
        (estado_ocds == "convocatoria_abierta" and estado_documentos in ("buena_pro", "contrato"))
        or
        (estado_ocds == "adjudicada" and estado_documentos == "contrato" and not contracts)
    )

    evidencia = (
        f"OCDS={estado_ocds} ({len(awards)} awards, {len(contracts)} contratos); "
        f"docs sugieren={estado_documentos}; postores={n_postores}; "
        f"docs_clave={len(documentos_clave)}"
    )
    if estado_inconsistente:
        evidencia += " · ⚠ INCONSISTENCIA: documentos publicados son posteriores al estado OCDS."

    return {
        "estado_ocds": estado_ocds,
        "estado_documentos": estado_documentos,
        "estado_inconsistente": estado_inconsistente,
        "n_postores_oferentes": n_postores,
        "n_awards": len(awards),
        "n_contracts": len(contracts),
        "documentos_clave": documentos_clave[:5],
        "evidencia": evidencia,
    }

def analyze_postores_pattern(ocid: str, tool_context: ToolContext) -> dict:
    """Analiza patrones sospechosos entre los postores que participaron en la
    convocatoria — útil cuando NO hay ganador (convocatoria abierta) o cuando
    querés evaluar si los perdedores fueron 'figurantes' de un cartel.

    Para cada postor analiza:
      · n_apariciones_base_vigia (apariciones del RUC en NUESTRA base de alertas;
        NO es su historial real en SEACE — ausencia = desconocido, no cero)
      · direccion_compartida (con otros postores del mismo proceso)
      · co_ocurrencia_en_base_vigia (OCIDs en que aparece junto a otros postores
        del proceso, SOLO dentro de los procesos ya analizados por Vigía)

    Args:
        ocid: OCID o codigo corto.

    Returns:
        dict con `postores: [{ruc, razon_social, sospechas: [...], score}]`
        + `patrones_red` (resumen agregado).
    """
    state = tool_context.state
    ocds = state.get("ocds") or state.get("ocds_preloaded") or {}
    if not ocds:
        return {"error": "no_ocds_disponible"}

    tender = ocds.get("tender") or {}
    parties = ocds.get("parties") or []
    tenderers_raw = tender.get("tenderers") or []

    # Extraer RUC + razón social de cada postor
    postores: list[dict] = []
    for t in tenderers_raw:
        pid = t.get("id") or ""
        ruc = pid.replace("PE-RUC-", "") if pid.startswith("PE-RUC-") else None
        nombre = t.get("name") or ""
        # Buscar más info en parties
        party = next((p for p in parties if p.get("id") == pid), None)
        direccion = None
        if party:
            addr = party.get("address") or {}
            direccion = ", ".join(filter(None, [
                addr.get("streetAddress"), addr.get("locality"), addr.get("region")
            ]))
        if ruc:
            postores.append({"ruc": ruc, "razon_social": nombre, "direccion": direccion})

    if not postores:
        return {"postores": [], "patrones_red": {}, "evidencia": "Sin postores en OCDS."}

    # Analizar cada postor contra Cloud SQL (RNP + alertas + convocatorias previas)
    conn = None
    try:
        conn = _pg()
        cur = conn.cursor()
        rucs = [p["ruc"] for p in postores]
        # Edad de RUC (vía SUNAT pública si la tenemos en BD; sino N/A)
        # n_otros_contratos: contar apariciones del RUC en alertas/convocatorias
        cur.execute(
            """SELECT proveedor_ruc, COUNT(*) AS n
                 FROM alertas
                WHERE proveedor_ruc = ANY(%s)
                GROUP BY proveedor_ruc""",
            (rucs,),
        )
        contratos_por_ruc = {r[0]: int(r[1]) for r in cur.fetchall()}

        # Co-ocurrencia: pares de postores que aparecen juntos en otros procesos
        # Usamos `convocatorias` o `postores` table — si no existe, omitimos.
        co_ocurrencia: dict = {}
        try:
            # Heurística: postores en común en convocatorias del proveedor adjudicado
            # (si la tabla `postores` o similar existe en BD).
            cur.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name='postores'"
            )
            cols_postores = {r[0] for r in cur.fetchall()}
            if "ocid" in cols_postores and "empresa_ruc" in cols_postores:
                # Buscar OCIDs donde participan ≥2 de los RUCs analizados
                cur.execute(
                    """SELECT empresa_ruc, ARRAY_AGG(DISTINCT ocid) AS ocids
                         FROM postores
                        WHERE empresa_ruc = ANY(%s)
                        GROUP BY empresa_ruc""",
                    (rucs,),
                )
                ruc_to_ocids = {r[0]: set(r[1] or []) for r in cur.fetchall()}
                # Calcular intersecciones pair-wise
                for i, a in enumerate(rucs):
                    for b in rucs[i + 1:]:
                        common = ruc_to_ocids.get(a, set()) & ruc_to_ocids.get(b, set())
                        if common:
                            # Guardamos los OCIDs reales (no solo el conteo) para
                            # poder mostrarlos/linkearlos en la UI como evidencia.
                            co_ocurrencia[f"{a}↔{b}"] = sorted(common)
        except Exception:
            pass

    except Exception as e:
        contratos_por_ruc = {}
        co_ocurrencia = {}
    finally:
        if conn:
            conn.close()

    # Direcciones repetidas entre postores del mismo proceso (señal cartel)
    dir_map: dict = {}
    for p in postores:
        if p.get("direccion"):
            dir_map.setdefault(p["direccion"].lower().strip(), []).append(p["ruc"])
    direcciones_compartidas = {k: v for k, v in dir_map.items() if len(v) > 1}

    # Score y sospechas por postor.
    # ⚠ HONESTIDAD: `contratos_por_ruc` cuenta apariciones del RUC en NUESTRA
    # base de alertas (procesos ya analizados por Vigía), NO su historial real
    # en el SEACE. Una empresa ausente de nuestra base tiene historial
    # DESCONOCIDO, no cero. Por eso NO emitimos "sin_historial_contractual"
    # como bandera: sería un falso positivo contra contratistas legítimos
    # (ej. un proveedor con 20 contratos reales aparecería como "sin historial").
    for p in postores:
        sospechas = []
        score = 0
        ruc = p["ruc"]
        n_apariciones = contratos_por_ruc.get(ruc, 0)
        # Dirección compartida con otro postor del MISMO proceso (señal válida).
        if p.get("direccion") and p["direccion"].lower().strip() in direcciones_compartidas:
            sospechas.append("direccion_compartida_con_otro_postor")
            score += 35
        # Co-ocurrencia con otros postores — SOLO dentro de la base de Vigía.
        ocids_co = sorted({o for k, v in co_ocurrencia.items() if ruc in k for o in v})
        if ocids_co:
            sospechas.append(f"co_ocurrencia_en_base_vigia:{len(ocids_co)}")
            score += min(len(ocids_co) * 5, 30)

        # Informativo (no bandera): apariciones en la base de Vigía.
        p["n_apariciones_base_vigia"] = n_apariciones
        p["ocids_co_ocurrencia"] = ocids_co
        p["sospechas"] = sospechas
        p["score_sospecha"] = min(score, 100)

    # Ordenar por score descendente
    postores.sort(key=lambda x: x["score_sospecha"], reverse=True)

    # Patrones agregados
    patrones = {
        "n_postores_total": len(postores),
        "n_con_direccion_compartida": sum(1 for p in postores if any("direccion_compartida" in s for s in p["sospechas"])),
        "n_con_co_ocurrencia": sum(1 for p in postores if any(s.startswith("co_ocurrencia") for s in p["sospechas"])),
        "direcciones_repetidas": {k: v for k, v in direcciones_compartidas.items()},
        "pares_co_ocurrentes": co_ocurrencia,  # {par: [ocids]} — dentro de la base de Vigía
        "_nota_alcance": ("Conteos y co-ocurrencias son SOLO sobre procesos ya "
                          "analizados por Vigía, no el universo completo del SEACE."),
    }

    result = {
        "postores": postores[:15],  # Top 15 más sospechosos
        "patrones_red": patrones,
        "evidencia": f"Analizados {len(postores)} postores · "
                     f"{len(direcciones_compartidas)} direcciones compartidas · "
                     f"{len(co_ocurrencia)} pares con co-ocurrencia en la base de Vigía.",
    }
    # Persistir en state para que el adapter lo expose a la UI
    state["analisis_postores"] = result
    return result

def _detect_estado_real_persist(ocid: str, tool_context: ToolContext) -> dict:
    """Wrapper que persiste el resultado en state para que la UI lo lea."""
    r = detect_estado_real(ocid, tool_context)
    tool_context.state["estado_real"] = r
    return r

# ── FunctionTool wrappers ──
# Las reglas se exponen con firma simple (ocid, tool_context); el perfil (reglas_activas,
# topes_uit) llega por kwargs desde el driver o por state['reglas_activas'/'topes_uit'].
check_unique_bidder_rule_tool = _as_tool(check_unique_bidder_rule)
check_sanctioned_provider_rule_tool = _as_tool(check_sanctioned_provider_rule)
check_non_competitive_process_rule_tool = _as_tool(check_non_competitive_process_rule)
check_plazo_convocatoria_rule_tool = _as_tool(check_plazo_convocatoria_rule)
check_tipo_proceso_vs_monto_rule_tool = _as_tool(check_tipo_proceso_vs_monto_rule)
check_directa_fundamento_rule_tool = _as_tool(check_directa_fundamento_rule)
check_edad_ruc_ganador_rule_tool = _as_tool(check_edad_ruc_ganador_rule)
check_ciiu_vs_objeto_rule_tool = _as_tool(check_ciiu_vs_objeto_rule)
check_concentracion_entidad_rule_tool = _as_tool(check_concentracion_entidad_rule)
check_recurrencia_firmante_rule_tool = _as_tool(check_recurrencia_firmante_rule)
check_testaferro_multi_ruc_rule_tool = _as_tool(check_testaferro_multi_ruc_rule)
check_ruc_ultra_nuevo_rule_tool = _as_tool(check_ruc_ultra_nuevo_rule)
check_postor_unico_mayoritario_rule_tool = _as_tool(check_postor_unico_mayoritario_rule)
check_inconsistencia_doc_vs_ocds_rule_tool = _as_tool(check_inconsistencia_doc_vs_ocds_rule)
check_lobby_visits_rule_tool = _as_tool(check_lobby_visits_rule)
check_adicional_acumulado_rule_tool = _as_tool(check_adicional_acumulado_rule)
check_personal_clave_vinculado_rule_tool = _as_tool(check_personal_clave_vinculado_rule)
check_fraccionamiento_rule_tool = _as_tool(check_fraccionamiento_rule)
check_directa_recurrente_rule_tool = _as_tool(check_directa_recurrente_rule)

# Reglas disponibles por nombre (para que el driver/perfil las itere sin importar cada una).
REGLAS_POR_NOMBRE = {
    "unico_postor_alto": check_unique_bidder_rule,
    "proveedor_sancionado_osce": check_sanctioned_provider_rule,
    "procedimiento_no_competitivo": check_non_competitive_process_rule,
    "plazo_convocatoria_minimo": check_plazo_convocatoria_rule,
    "tipo_proceso_vs_monto": check_tipo_proceso_vs_monto_rule,
    "directa_sin_fundamento": check_directa_fundamento_rule,
    "ruc_ganador_muy_nuevo": check_edad_ruc_ganador_rule,
    "ciiu_vs_objeto": check_ciiu_vs_objeto_rule,
    "concentracion_entidad": check_concentracion_entidad_rule,
    "firmante_vinculado_ganador": check_recurrencia_firmante_rule,
    "testaferro_multi_ruc": check_testaferro_multi_ruc_rule,
    "ruc_ultra_nuevo": check_ruc_ultra_nuevo_rule,
    "postor_unico_mayoritario": check_postor_unico_mayoritario_rule,
    "inconsistencia_doc_vs_ocds": check_inconsistencia_doc_vs_ocds_rule,
    "lobby_visits_pre_convocatoria": check_lobby_visits_rule,
    "adicional_acumulado": check_adicional_acumulado_rule,
    "personal_clave_vinculado": check_personal_clave_vinculado_rule,
    "fraccionamiento": check_fraccionamiento_rule,
    "directa_recurrente": check_directa_recurrente_rule,
}
evaluate_normative_compliance_tool = FunctionTool(func=evaluate_normative_compliance)
detect_estado_real_tool = FunctionTool(func=_detect_estado_real_persist)
analyze_postores_pattern_tool = FunctionTool(func=analyze_postores_pattern)
