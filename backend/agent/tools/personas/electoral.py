"""Consultas a datasets electorales/políticos: autoridades electas actuales
(JNE, por región/provincia/distrito), aportes ONPE, candidaturas JNE y PEPs
(Personas Expuestas Políticamente — UIF SBS). Cada función es una consulta
independiente sobre una sola tabla; no dependen entre sí."""

from tools._core import *  # noqa: F401,F403


def query_autoridades_entidad(entidad_nombre: str, region: str,
                                tool_context: ToolContext) -> dict:
    """Devuelve autoridades electas (alcaldes, regidores, gobernador) ACTUALES
    de una entidad contratante. Cruza `jne_candidaturas` (electos 2022 con
    período 2023-2026) por región + cargo + match parcial del nombre de la
    entidad.

    Permite al orchestrator saber QUIÉN manejará la entidad contratante hoy
    (alcalde firmante, regidores votantes), para después cruzarlos con la
    red del proveedor.

    Args:
        entidad_nombre: nombre LITERAL de la entidad (ej.
                        "MUNICIPALIDAD PROVINCIAL DE TUMBES").
        region: región del buyer (ej. "TUMBES"). Acepta UPPER o Title Case.

    Returns:
        dict con:
          · alcalde_actual: {nombre, partido, año, region, provincia}
          · regidores_actuales: [{nombre, partido}]
          · gobernador_regional: si la región tiene gobernador electo registrado
          · n_autoridades: total
          · _fuente: 'jne_candidaturas'
    """
    if not entidad_nombre and not region:
        return {"error": "se requiere entidad_nombre o region"}

    conn = _pg()
    try:
        cur = conn.cursor()
        if not _table_exists(cur, "jne_candidaturas"):
            return {"dataset_no_disponible": True}

        region_norm = _normalize_persona(region or "")
        entidad_upper = (entidad_nombre or "").upper()

        # Heurística: extraer provincia/distrito del nombre de la entidad
        provincia = None
        distrito = None
        if "PROVINCIAL DE " in entidad_upper:
            provincia = entidad_upper.split("PROVINCIAL DE ", 1)[1].split(",")[0].strip()
        if "DISTRITAL DE " in entidad_upper:
            distrito = entidad_upper.split("DISTRITAL DE ", 1)[1].split(",")[0].strip()

        out: dict = {
            "entidad_consultada": entidad_nombre,
            "region": region,
            "provincia_detectada": provincia,
            "distrito_detectado": distrito,
            "_fuente": "jne_candidaturas",
        }

        # Buscar alcalde provincial actual (período 2023-2026, electos en 2022)
        if provincia:
            cur.execute(
                """SELECT nombre_original, partido, año, region, provincia, fuente_url
                     FROM jne_candidaturas
                    WHERE resultado='electo' AND año=2022
                      AND cargo LIKE %s
                      AND (UPPER(provincia)=%s OR UPPER(region)=%s)
                    ORDER BY año DESC LIMIT 5""",
                ("%ALCALDE%PROVINC%", provincia, region_norm),
            )
            rows = cur.fetchall()
            if rows:
                out["alcalde_provincial_actual"] = {
                    "nombre": rows[0][0], "partido": rows[0][1], "año_eleccion": rows[0][2],
                    "region": rows[0][3], "provincia": rows[0][4],
                    "periodo": "2023-2026", "fuente_url": rows[0][5],
                }

        # Alcalde distrital
        if distrito:
            cur.execute(
                """SELECT nombre_original, partido, año, region, distrito, fuente_url
                     FROM jne_candidaturas
                    WHERE resultado='electo' AND año=2022
                      AND cargo LIKE %s
                      AND UPPER(distrito)=%s
                    ORDER BY año DESC LIMIT 5""",
                ("%ALCALDE%DISTRIT%", distrito),
            )
            rows = cur.fetchall()
            if rows:
                out["alcalde_distrital_actual"] = {
                    "nombre": rows[0][0], "partido": rows[0][1], "año_eleccion": rows[0][2],
                    "region": rows[0][3], "distrito": rows[0][4],
                    "periodo": "2023-2026", "fuente_url": rows[0][5],
                }

        # Gobernador regional
        if region_norm:
            cur.execute(
                """SELECT nombre_original, partido, año, region, fuente_url
                     FROM jne_candidaturas
                    WHERE resultado='electo' AND año=2022
                      AND cargo LIKE %s
                      AND UPPER(region)=%s
                    ORDER BY año DESC LIMIT 1""",
                ("%GOBERNADOR%REGIONAL%", region_norm),
            )
            row = cur.fetchone()
            if row:
                out["gobernador_regional_actual"] = {
                    "nombre": row[0], "partido": row[1], "año_eleccion": row[2],
                    "region": row[3], "periodo": "2023-2026", "fuente_url": row[4],
                }

        # Regidores provinciales (top 10)
        if provincia:
            cur.execute(
                """SELECT nombre_original, partido, fuente_url
                     FROM jne_candidaturas
                    WHERE resultado='electo' AND año=2022
                      AND cargo LIKE %s
                      AND UPPER(provincia)=%s
                    ORDER BY numero_lista LIMIT 10""",
                ("%REGIDOR%PROVINC%", provincia),
            )
            regidores = [
                {"nombre": r[0], "partido": r[1], "fuente_url": r[2]}
                for r in cur.fetchall()
            ]
            if regidores:
                out["regidores_provinciales"] = regidores

        # Count total
        n_aut = sum([
            1 if out.get("alcalde_provincial_actual") else 0,
            1 if out.get("alcalde_distrital_actual") else 0,
            1 if out.get("gobernador_regional_actual") else 0,
            len(out.get("regidores_provinciales") or []),
        ])
        out["n_autoridades_encontradas"] = n_aut
        return out
    finally:
        conn.close()

def query_onpe_aportantes(dni_o_nombre: str, tool_context: ToolContext) -> dict:
    """Consulta la tabla `onpe_aportantes` (financiamiento político ONPE Claridad)
    para encontrar si una persona aportó económicamente a algún partido político.

    Schema esperado:
        onpe_aportantes(numero_documento, nombre, partido, año, monto, fuente)

    Args:
        dni_o_nombre: DNI (8 dígitos) o nombre completo del aportante a buscar.

    Returns:
        dict con:
          · found: bool
          · n_aportes: int
          · aportes: [{partido, año, monto, ...}]
          · partidos_distintos: [...]
          · monto_total: float
          · dataset_no_disponible: true si la tabla no existe aún
    """
    conn = _pg()
    try:
        cur = conn.cursor()
        if not _table_exists(cur, "onpe_aportantes"):
            return {
                "found": False, "dataset_no_disponible": True,
                "hint": "Cargar dataset ONPE Aportantes en tabla `onpe_aportantes`. "
                        "Source: https://www.datosabiertos.gob.pe/dataset/aportantes-onpe",
            }
        q = (dni_o_nombre or "").strip()
        match_type = None
        if q.isdigit() and len(q) == 8:
            cur.execute(
                """SELECT numero_documento, nombre, partido, año, monto, fuente, 1.0::float
                     FROM onpe_aportantes
                    WHERE numero_documento = %s
                    ORDER BY año DESC, monto DESC LIMIT 50""",
                (q,),
            )
            match_type = "exacto_dni"
        else:
            qn = _normalize_persona(q)
            cur.execute("SET pg_trgm.similarity_threshold = 0.45")
            cur.execute(
                """SELECT numero_documento, nombre, partido, año, monto, fuente,
                          similarity(nombre, %s)::float AS score
                     FROM onpe_aportantes
                    WHERE nombre %% %s
                    ORDER BY score DESC, año DESC, monto DESC LIMIT 50""",
                (qn, qn),
            )
            match_type = "fuzzy_trigram"
        rows = cur.fetchall()
        aportes = [
            {"numero_documento": r[0], "nombre": r[1], "partido": r[2],
             "año": r[3], "monto": float(r[4] or 0), "fuente": r[5],
             "match_score": round(float(r[6]), 3)}
            for r in rows
        ]
        partidos = sorted(set(a["partido"] for a in aportes if a.get("partido")))
        monto_total = sum(a["monto"] for a in aportes)
        return {
            "found": len(aportes) > 0,
            "match_type": match_type,
            "n_aportes": len(aportes),
            "aportes": aportes[:20],
            "partidos_distintos": partidos,
            "monto_total": monto_total,
            "query": q,
        }
    finally:
        conn.close()

def query_jne_candidaturas(dni_o_nombre: str, tool_context: ToolContext) -> dict:
    """Consulta la tabla `jne_candidaturas` (candidatos a elecciones según JNE).

    Schema esperado:
        jne_candidaturas(numero_documento, nombre, partido, año, cargo,
                         resultado, region, fuente_url)

    Args:
        dni_o_nombre: DNI o nombre del candidato.
    """
    conn = _pg()
    try:
        cur = conn.cursor()
        if not _table_exists(cur, "jne_candidaturas"):
            return {
                "found": False, "dataset_no_disponible": True,
                "hint": "Cargar dataset JNE Candidaturas en tabla `jne_candidaturas`. "
                        "Source: PNDA-JNE via CKAN o plataforma electoral JNE.",
            }
        q = (dni_o_nombre or "").strip()
        match_type = None
        if q.isdigit() and len(q) == 8:
            cur.execute(
                """SELECT numero_documento, nombre, partido, año, cargo, resultado, region, fuente_url, 1.0::float
                     FROM jne_candidaturas WHERE numero_documento = %s
                    ORDER BY año DESC LIMIT 50""",
                (q,),
            )
            match_type = "exacto_dni"
        else:
            qn = _normalize_persona(q)
            cur.execute("SET pg_trgm.similarity_threshold = 0.45")
            cur.execute(
                """SELECT numero_documento, nombre, partido, año, cargo, resultado, region, fuente_url,
                          similarity(nombre, %s)::float AS score
                     FROM jne_candidaturas WHERE nombre %% %s
                    ORDER BY score DESC, año DESC LIMIT 50""",
                (qn, qn),
            )
            match_type = "fuzzy_trigram"
        rows = cur.fetchall()
        cand = [
            {"numero_documento": r[0], "nombre": r[1], "partido": r[2], "año": r[3],
             "cargo": r[4], "resultado": r[5], "region": r[6], "fuente_url": r[7],
             "match_score": round(float(r[8]), 3)}
            for r in rows
        ]
        return {
            "found": len(cand) > 0,
            "match_type": match_type,
            "n_candidaturas": len(cand),
            "candidaturas": cand[:20],
            "partidos_distintos": sorted(set(c["partido"] for c in cand if c.get("partido"))),
            "query": q,
        }
    finally:
        conn.close()

def query_pep(dni_o_nombre: str, tool_context: ToolContext) -> dict:
    """Consulta la tabla `peps` (Personas Expuestas Políticamente — UIF SBS).

    Schema esperado:
        peps(numero_documento, nombre, cargo, entidad, año_desde, año_hasta, fuente_url)
    """
    conn = _pg()
    try:
        cur = conn.cursor()
        if not _table_exists(cur, "peps"):
            return {
                "found": False, "dataset_no_disponible": True,
                "hint": "Cargar dataset PEPs en tabla `peps`. Source: UIF SBS.",
            }
        q = (dni_o_nombre or "").strip()
        match_type = None
        if q.isdigit() and len(q) == 8:
            cur.execute(
                """SELECT numero_documento, nombre, cargo, entidad, año_desde, año_hasta, fuente_url, 1.0::float
                     FROM peps WHERE numero_documento = %s ORDER BY año_desde DESC LIMIT 30""",
                (q,),
            )
            match_type = "exacto_dni"
        else:
            qn = _normalize_persona(q)
            cur.execute("SET pg_trgm.similarity_threshold = 0.45")
            # Usar `nombre_norm` (UPPER sin tildes) para el match — el campo
            # `nombre` puede venir en mixed case con tildes y rompe similarity.
            cur.execute(
                """SELECT numero_documento, nombre, cargo, entidad, año_desde, año_hasta, fuente_url,
                          similarity(COALESCE(nombre_norm, UPPER(nombre)), %s)::float
                     FROM peps
                    WHERE COALESCE(nombre_norm, UPPER(nombre)) %% %s
                    ORDER BY 8 DESC, año_desde DESC LIMIT 30""",
                (qn, qn),
            )
            match_type = "fuzzy_trigram"
        rows = cur.fetchall()
        peps = [
            {"numero_documento": r[0], "nombre": r[1], "cargo": r[2], "entidad": r[3],
             "año_desde": r[4], "año_hasta": r[5], "fuente_url": r[6],
             "match_score": round(float(r[7]), 3)}
            for r in rows
        ]
        return {
            "found": len(peps) > 0,
            "match_type": match_type,
            "n_registros": len(peps),
            "registros": peps[:15],
            "query": q,
        }
    finally:
        conn.close()

# ── FunctionTool wrappers ──
query_autoridades_entidad_tool = FunctionTool(func=query_autoridades_entidad)
query_onpe_aportantes_tool = FunctionTool(func=query_onpe_aportantes)
query_jne_candidaturas_tool = FunctionTool(func=query_jne_candidaturas)
query_pep_tool = FunctionTool(func=query_pep)
