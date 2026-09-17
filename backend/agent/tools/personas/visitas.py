"""Registro Único de Visitas (Ley 28024): historial de visitas de una persona
a entidades públicas."""

from tools._core import *  # noqa: F401,F403


def query_visitas_de_persona(dni_o_nombre: str, tool_context: ToolContext) -> dict:
    """Devuelve historial de visitas registradas (Ley 28024) de una persona a
    entidades públicas. Útil para el person_network_agent al investigar a un
    socio, representante legal, o funcionario.

    Args:
        dni_o_nombre: DNI (8 dígitos) o nombre completo de la persona.

    Returns:
        dict con visitas[], frecuencia_anormal_pares[], entidades_visitadas[].
    """
    conn = _pg()
    try:
        cur = conn.cursor()
        if not _table_exists(cur, "visitas_entidades"):
            return {"found": False, "dataset_no_disponible": True}

        q = (dni_o_nombre or "").strip()
        match_type = None
        if q.isdigit() and len(q) == 8:
            cur.execute(
                """SELECT visitante, numero_documento, entidad_visitada, tipo_entidad_visitante,
                          entidad_visitante, funcionario_nombre, funcionario_cargo,
                          fecha_visita, motivo, duracion_min, 1.0::float
                     FROM visitas_entidades
                    WHERE numero_documento = %s
                    ORDER BY fecha_visita DESC LIMIT 50""",
                (q,),
            )
            match_type = "exacto_dni"
        else:
            qn = _normalize_persona(q)
            cur.execute("SET pg_trgm.similarity_threshold = 0.45")
            cur.execute(
                """SELECT visitante, numero_documento, entidad_visitada, tipo_entidad_visitante,
                          entidad_visitante, funcionario_nombre, funcionario_cargo,
                          fecha_visita, motivo, duracion_min,
                          similarity(visitante_norm, %s)::float
                     FROM visitas_entidades
                    WHERE visitante_norm %% %s
                    ORDER BY 11 DESC, fecha_visita DESC LIMIT 50""",
                (qn, qn),
            )
            match_type = "fuzzy_trigram"
        visitas = [
            {"visitante": r[0], "dni": r[1], "entidad_visitada": r[2],
             "tipo_visitante": r[3], "entidad_visitante": r[4],
             "funcionario": r[5], "cargo_funcionario": r[6],
             "fecha": r[7].isoformat() if r[7] else None,
             "motivo": r[8], "duracion_min": r[9],
             "match_score": round(float(r[10]), 3)}
            for r in cur.fetchall()
        ]
        entidades = sorted({v["entidad_visitada"] for v in visitas})
        # Frecuencia anormal local: pares (funcionario, entidad) con ≥3 visitas
        from collections import Counter
        pares = Counter((v["funcionario"], v["entidad_visitada"]) for v in visitas
                        if v["funcionario"])
        anormales = [
            {"funcionario": k[0], "entidad": k[1], "n_visitas": n}
            for k, n in pares.most_common() if n >= 3
        ]
        return {
            "found": bool(visitas),
            "match_type": match_type,
            "n_visitas": len(visitas),
            "visitas": visitas,
            "entidades_visitadas": entidades,
            "frecuencia_anormal_pares": anormales,
            "fuente_url": "https://www.gob.pe/registro-visitas",
        }
    finally:
        conn.close()

# ── FunctionTool wrappers ──
query_visitas_de_persona_tool = FunctionTool(func=query_visitas_de_persona)
