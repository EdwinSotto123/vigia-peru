"""Consultas al RNP (Registro Nacional de Proveedores): empresas donde figura
una persona (por documento o nombre) y socios/representantes/órganos de
administración de una empresa por RUC."""

from tools._core import *  # noqa: F401,F403


def query_rnp_persona(query: str, tool_context: ToolContext) -> dict:
    """Busca una persona en el RNP por número de documento o por nombre.
    El nombre se normaliza (UPPER + sin tildes) antes del match. Devuelve
    TODAS las empresas (RUCs) donde figura, con su rol en cada una.

    Útil para:
      · Detectar testaferros (10+ empresas con misma persona).
      · Confirmar gerente/representante legal de una empresa sin scraping.
      · Cruzar firmantes de actas contra la red empresarial del adjudicatario.

    Args:
        query: número de documento (DNI/CE/pasaporte) O nombre completo.
               Si es 5+ chars de dígitos, se asume número de documento.
               Si tiene espacios o letras, se asume nombre.

    Returns:
        Diccionario con:
          - input_normalizado, match_por: 'numero_documento' | 'nombre'
          - n_empresas, n_roles_total
          - empresas: lista [{ruc_empresa, nombre_visto, roles[],
                              fecha_inicio_vigencia, forma_societaria}]
    """
    q = (query or "").strip()
    if not q:
        return {"error": "query vacía"}

    # Decidir si parece un número de documento o un nombre
    is_numdoc = q.replace("-", "").replace(" ", "").isdigit() and len(q) >= 5
    conn = _pg()
    try:
        cur = conn.cursor()
        if is_numdoc:
            cur.execute(
                """SELECT ruc_empresa, nombre_original, tipo_rol,
                          fecha_inicio_vigencia, forma_societaria, tipo_documento,
                          1.0::float, nombre
                     FROM rnp_conformacion_juridica
                    WHERE numero_documento=%s
                    ORDER BY ruc_empresa, tipo_rol""",
                (q.replace("-", "").replace(" ", ""),),
            )
            rows = cur.fetchall()  # Bug fix: faltaba esta línea — sin rows
            # asignado, el `for ... in rows` de abajo lanza NameError.
            match_por = "numero_documento_exacto"
            input_norm = q
        else:
            input_norm = _normalize_name_for_search(q)
            # Intento 1: match exacto (rápido, usa idx_rnp_nombre)
            cur.execute(
                """SELECT ruc_empresa, nombre_original, tipo_rol,
                          fecha_inicio_vigencia, forma_societaria, tipo_documento,
                          1.0::float, nombre
                     FROM rnp_conformacion_juridica
                    WHERE nombre=%s
                    ORDER BY ruc_empresa, tipo_rol""",
                (input_norm,),
            )
            rows_exact = cur.fetchall()
            if rows_exact:
                rows = rows_exact
                match_por = "nombre_exacto"
            else:
                # Intento 2: fuzzy trigram (usa idx_rnp_nombre_trgm GIN)
                cur.execute("SET pg_trgm.similarity_threshold = 0.55")
                cur.execute(
                    """SELECT ruc_empresa, nombre_original, tipo_rol,
                              fecha_inicio_vigencia, forma_societaria, tipo_documento,
                              similarity(nombre, %s)::float AS score, nombre
                         FROM rnp_conformacion_juridica
                        WHERE nombre %% %s
                        ORDER BY score DESC, ruc_empresa, tipo_rol
                        LIMIT 200""",
                    (input_norm, input_norm),
                )
                rows = cur.fetchall()
                match_por = "nombre_fuzzy"

        # Agrupar por RUC y consolidar roles, mantener mejor score por empresa
        empresas_map: dict = {}
        for ruc, nombre_orig, rol, fec, forma, tipo_doc, score, nombre_canonico in rows:
            fec_str = str(fec) if fec else None
            e = empresas_map.setdefault(ruc, {
                "ruc_empresa": ruc,
                "nombre_visto": nombre_orig,
                "nombre_normalizado_rnp": nombre_canonico,
                "roles": [],
                "fecha_inicio_vigencia": fec_str,
                "_fecha_es_futura": _annotate_future_date(fec_str),
                "forma_societaria": forma,
                "tipo_documento": tipo_doc,
                "match_score": round(float(score), 3),
            })
            if rol not in e["roles"]:
                e["roles"].append(rol)
            e["match_score"] = max(e["match_score"], round(float(score), 3))
        empresas = sorted(empresas_map.values(), key=lambda x: -x["match_score"])
        return {
            "input_normalizado": input_norm,
            "match_por": match_por,
            "n_empresas": len(empresas),
            "n_roles_total": len(rows),
            "_today": _today_iso(),
            "empresas": empresas,
        }
    except Exception as e:
        return {"error": f"db: {str(e)[:200]}"}
    finally:
        conn.close()

def query_rnp_empresa(ruc: str, tool_context: ToolContext) -> dict:
    """Devuelve socios + representantes legales + órganos de administración
    de una empresa según el RNP. Reemplaza al scraping SUNARP para descubrir
    la red humana detrás de un RUC.

    Args:
        ruc: RUC de la empresa (11 dígitos).

    Returns:
        Diccionario con:
          - ruc, forma_societaria
          - n_personas (únicas por numero_documento)
          - socios: lista [{numero_documento, tipo_documento, nombre, fecha_vigencia}]
          - representantes_legales: idem
          - organos_administracion: idem
    """
    r = (ruc or "").strip()
    if len(r) != 11 or not r.isdigit():
        # Caso esperado: RUC extranjero (no domiciliado). NO es un error
        # crítico — el orquestador debe continuar con el flujo.
        return {
            "found": False,
            "ruc_consultado": r,
            "razon": (
                f"RUC {r!r} no tiene formato peruano estándar (11 dígitos numéricos). "
                "Probablemente es un proveedor extranjero no domiciliado — el RNP "
                "solo contiene proveedores peruanos. ESTO ES ESPERADO, no es un "
                "error: CONTINUÁ con el siguiente paso del flujo."
            ),
            "n_personas": 0, "socios": [], "representantes_legales": [],
            "organos_administracion": [],
        }
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT numero_documento, tipo_documento, nombre_original,
                      tipo_rol, fecha_inicio_vigencia, forma_societaria
                 FROM rnp_conformacion_juridica
                WHERE ruc_empresa=%s
                ORDER BY tipo_rol, nombre""",
            (r,),
        )
        rows = cur.fetchall()
        socios: list = []
        repres: list = []
        organos: list = []
        forma_societaria = None
        personas_unicas = set()
        for num_doc, tipo_doc, nombre, rol, fec, forma in rows:
            forma_societaria = forma_societaria or forma
            personas_unicas.add(num_doc)
            fec_str = str(fec) if fec else None
            entry = {
                "numero_documento": num_doc,
                "tipo_documento": tipo_doc,
                "nombre": nombre,
                "fecha_inicio_vigencia": fec_str,
                "_fecha_es_futura": _annotate_future_date(fec_str),
            }
            if rol == "SOCIO_ACCIONISTA_TITULAR":
                socios.append(entry)
            elif rol == "REPRESENTANTE_LEGAL":
                repres.append(entry)
            elif rol == "ORGANO_ADMINISTRACION":
                organos.append(entry)
        return {
            "ruc": r,
            "forma_societaria": forma_societaria,
            "n_personas": len(personas_unicas),
            "n_filas": len(rows),
            "_today": _today_iso(),
            "socios": socios,
            "representantes_legales": repres,
            "organos_administracion": organos,
        }
    except Exception as e:
        return {"error": f"db: {str(e)[:200]}"}
    finally:
        conn.close()

# ── FunctionTool wrappers ──
query_rnp_persona_tool = FunctionTool(func=query_rnp_persona)
query_rnp_empresa_tool = FunctionTool(func=query_rnp_empresa)
