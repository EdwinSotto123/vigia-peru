"""Tools del dominio: personas."""

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

def read_person_network_context(tool_context: ToolContext) -> dict:
    """Ensambla TODO el contexto que necesita el person_network_agent en una sola
    tool, leyendo del state y haciendo las queries que falten. Reemplaza la
    práctica anterior del orchestrator de pegar 4 bloques largos (RNP_PROVEEDOR,
    RNP_FIRMANTES_RESULTADOS, TODOS_POSTORES, DATOS_PERU) en el request — práctica
    que falla cuando hay muchos socios/firmantes/postores.

    Returns:
        dict con:
          - ganador: {ruc, razon_social, monto_ganado}
          - entidad_contratante: {ruc, nombre, region}
          - todos_postores: [{ruc, razon_social, es_ganador}]
          - firmantes_consolidados: lista del document_analysis
          - rnp_proveedor: query_rnp_empresa(ganador_ruc)
          - rnp_firmantes_resultados: [{firmante, rnp_resultados}] por firmante
          - datos_peru_por_persona: {nombre: {onpe, jne, pep, visitas}}
            para gerente + socios + firmantes
    """
    state = tool_context.state
    cache = state.get("person_network_context")
    if cache and isinstance(cache, dict):
        return cache

    ocds = state.get("ocds") or {}
    # state['ocds'] guarda el compiledRelease OCDS — los suppliers/postores
    # están en `parties[]` con su role. NO en `suppliers` (eso es del return
    # value de fetch_ocds_record, no del state).
    parties = ocds.get("parties") or []
    ganador_party = next(
        (p for p in parties if "supplier" in (p.get("roles") or [])),
        None,
    )
    ganador_ruc = ((ganador_party or {}).get("identifier") or {}).get("id")
    ganador_razon = (ganador_party or {}).get("name")

    todos_postores = [
        {"ruc": (p.get("identifier") or {}).get("id"),
         "razon_social": p.get("name"),
         "es_ganador": "supplier" in (p.get("roles") or [])}
        for p in parties
        if "tenderer" in (p.get("roles") or [])
    ]

    buyer_party = next(
        (p for p in parties if "buyer" in (p.get("roles") or [])),
        None,
    )
    buyer_ruc = None
    if buyer_party:
        for ai in buyer_party.get("additionalIdentifiers") or []:
            if ai.get("scheme") == "PE-RUC":
                buyer_ruc = ai.get("id")
                break
    buyer_nombre = (buyer_party or {}).get("name") or (ocds.get("buyer") or {}).get("name")
    buyer_region = ((buyer_party or {}).get("address") or {}).get("region")

    doc_analysis = state.get("document_analysis") or {}
    if isinstance(doc_analysis, str):
        doc_analysis = _safe_parse_json(doc_analysis) or {}
    firmantes_raw = doc_analysis.get("firmantes_consolidados") or doc_analysis.get("firmantes") or []

    # ANTI-ALUCINACIÓN: filtrar firmantes que parecen inventados por el parser.
    # Patrón observado en OCID 1212353: parser alucinó 'Juan Perez Quispe' con
    # dni=null, entidad='Entidad Contratante' (string genérico), capitalización
    # rara (Title Case en vez de UPPERCASE), fecha_firma anterior al proceso.
    # Si dni es null Y entidad es vacía/genérica → descartar el firmante para
    # evitar matching fuzzy con miles de personas reales con apellido común.
    firmantes = []
    for f in firmantes_raw:
        if not isinstance(f, dict):
            continue
        nombre = (f.get("nombre_completo") or "").strip()
        if not nombre:
            continue
        dni = (f.get("dni") or "").strip() or None
        entidad = (f.get("entidad") or "").strip().lower()
        es_generico = entidad in ("entidad contratante", "entidad", "comité", "comite", "")
        if dni is None and es_generico:
            f = dict(f)
            f["_descartado_anti_alucinacion"] = True
            f["_motivo"] = "sin DNI y con entidad genérica — posible alucinación del parser"
            firmantes.append(f)
            continue
        firmantes.append(f)
    firmantes_validos = [f for f in firmantes if not f.get("_descartado_anti_alucinacion")]

    rnp_proveedor = {}
    if ganador_ruc:
        try:
            rnp_proveedor = query_rnp_empresa(ruc=ganador_ruc, tool_context=tool_context)
        except Exception as e:
            rnp_proveedor = {"error": str(e)[:200]}

    personas_a_investigar = set()
    # Auto-incluir al ganador (proveedor) — clave especialmente cuando es
    # persona natural con negocio (RUC empieza con '10') y no aparece como
    # socio en RNP. Sin esto, datos_peru_por_persona quedaba vacío.
    if ganador_razon:
        personas_a_investigar.add(ganador_razon)
    # Si es persona natural, también queremos el DNI para queries por documento
    ganador_dni = None
    if ganador_ruc and len(str(ganador_ruc)) == 11 and str(ganador_ruc).startswith("10"):
        ganador_dni = str(ganador_ruc)[2:10]
        personas_a_investigar.add(ganador_dni)
    # Solo investigamos firmantes con DNI confirmado o entidad real — evita
    # gastar queries y contaminar el contexto con matches espurios de nombres
    # genéricos alucinados.
    for f in firmantes_validos:
        n = (f.get("nombre_completo") or "").strip()
        if n:
            personas_a_investigar.add(n)
        dni = (f.get("dni") or "").strip()
        if dni and dni.isdigit() and len(dni) == 8:
            personas_a_investigar.add(dni)
    # Socios + representantes legales + órgano de administración del proveedor
    for grupo_key in ("socios", "representantes_legales", "organos_administracion"):
        for p in rnp_proveedor.get(grupo_key, []) or []:
            n = (p.get("nombre_original") or p.get("nombre") or "").strip()
            if n:
                personas_a_investigar.add(n)
            ndoc = (p.get("numero_documento") or "").strip()
            if ndoc and ndoc.isdigit() and len(ndoc) == 8:
                personas_a_investigar.add(ndoc)
    # MIEMBROS DEL COMITÉ DE SELECCIÓN — funcionarios que firman la adjudicación.
    # Vienen del parser en state['document_analysis'].comite_evaluacion[] o en
    # parser_raw_consolidated. Mismo filtro anti-alucinación.
    comite_raw = doc_analysis.get("comite_evaluacion") or []
    raw_parser = state.get("parser_raw_consolidated") or {}
    if not comite_raw and raw_parser:
        comite_raw = raw_parser.get("comite_evaluacion") or []
    comite_validos = []
    for m in comite_raw:
        if not isinstance(m, dict):
            continue
        nombre = (m.get("nombre_completo") or m.get("nombre") or "").strip()
        if not nombre:
            continue
        dni = (m.get("dni") or "").strip() or None
        # Anti-alucinación: NO incluir miembros con dni=null y cargo genérico
        cargo = (m.get("cargo") or "").strip().lower()
        es_generico = cargo in ("miembro", "miembro suplente", "presidente", "")
        if dni is None and es_generico and "comité" in (m.get("nombre_completo") or "").lower():
            continue
        comite_validos.append(m)
        personas_a_investigar.add(nombre)
        if dni and dni.isdigit() and len(dni) == 8:
            personas_a_investigar.add(dni)

    # Paralelizar query_rnp_persona por cada firmante (8 workers).
    rnp_firmantes_resultados = []
    firmantes_con_nombre = [
        f for f in firmantes_validos if (f.get("nombre_completo") or "").strip()
    ]

    def _rnp_persona_firmante(f: dict) -> dict:
        nombre = (f.get("nombre_completo") or "").strip()
        try:
            r = query_rnp_persona(query=nombre, tool_context=tool_context)
            return {
                "firmante": nombre,
                "n_empresas": r.get("n_empresas", 0),
                "empresas": r.get("empresas", [])[:10],
                "match_por": r.get("match_por"),
            }
        except Exception as e:
            return {"firmante": nombre, "error": str(e)[:200]}

    if firmantes_con_nombre:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(_rnp_persona_firmante, f) for f in firmantes_con_nombre]
            for fut in concurrent.futures.as_completed(futures):
                try:
                    rnp_firmantes_resultados.append(fut.result(timeout=20))
                except Exception:
                    pass

    # Paralelización: hacer las 4 queries × N personas con ThreadPoolExecutor.
    # Cada query SQL tiene su propia conexión pg8000 (vía _pg() en cada tool),
    # así que es thread-safe. Esto reduce 30+ personas × 4 queries de ~60s
    # secuenciales a ~3-5s en paralelo. Antes era el bottleneck principal.
    def _investigar_persona(persona: str) -> tuple[str, dict]:
        try:
            onpe = query_onpe_aportantes(dni_o_nombre=persona, tool_context=tool_context)
            jne = query_jne_candidaturas(dni_o_nombre=persona, tool_context=tool_context)
            pep = query_pep(dni_o_nombre=persona, tool_context=tool_context)
            visitas = query_visitas_de_persona(dni_o_nombre=persona, tool_context=tool_context)
            return (persona, {
                "onpe": {"found": onpe.get("found"), "n_aportes": onpe.get("n_aportes", 0),
                         "aportes": onpe.get("aportes", [])[:5],
                         "match_type": onpe.get("match_type")},
                "jne": {"found": jne.get("found"), "n_candidaturas": jne.get("n_candidaturas", 0),
                        "candidaturas": jne.get("candidaturas", [])[:5],
                        "match_type": jne.get("match_type")},
                "pep": {"found": pep.get("found"),
                        "dataset_no_disponible": pep.get("dataset_no_disponible", False)},
                "visitas": {"found": visitas.get("found"), "n_visitas": visitas.get("n_visitas", 0),
                            "visitas": visitas.get("visitas", [])[:5],
                            "match_type": visitas.get("match_type")},
            })
        except Exception as e:
            return (persona, {"error": str(e)[:200]})

    datos_peru: dict = {}
    personas_lista = list(personas_a_investigar)[:30]  # hasta 30 personas
    if personas_lista:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(_investigar_persona, p): p for p in personas_lista}
            for fut in concurrent.futures.as_completed(futures):
                try:
                    persona, datos = fut.result(timeout=30)
                    datos_peru[persona] = datos
                except Exception as e:
                    persona = futures[fut]
                    datos_peru[persona] = {"error": f"timeout_or_error: {str(e)[:100]}"}

    firmantes_descartados = [
        {"nombre_completo": f.get("nombre_completo"),
         "motivo": f.get("_motivo", "descartado")}
        for f in firmantes if f.get("_descartado_anti_alucinacion")
    ]

    # CAPA 3 — FUNCIONARIOS DESIGNADOS de la entidad (no electos): leemos
    # state['entity_personnel'] que el `entity_personnel_agent` pobló con la
    # estructura administrativa real (Gerente Municipal, Gerente Logística,
    # Procurador, etc). Agregamos cada uno a personas_a_investigar.
    entity_personnel_state = state.get("entity_personnel")
    funcionarios_designados: list = []
    if isinstance(entity_personnel_state, str):
        entity_personnel_state = _safe_parse_json(entity_personnel_state) or {}
    if isinstance(entity_personnel_state, dict):
        for f in entity_personnel_state.get("funcionarios_designados") or []:
            nombre = (f.get("nombre_completo") or "").strip()
            if nombre and not any(x in nombre.upper() for x in ("EXAMPLE", "FUNCIONARIO X")):
                personas_a_investigar.add(nombre)
                funcionarios_designados.append(f)

    # AUTORIDADES ACTUALES de la entidad contratante — quién la dirige hoy.
    # Cruzamos por región/provincia con jne_candidaturas (electos 2022,
    # período 2023-2026) para detectar alcalde provincial/distrital,
    # gobernador regional y regidores. Los nombres se agregan a
    # personas_a_investigar para que se crucen con onpe/jne/pep/visitas.
    autoridades_entidad: dict = {}
    if buyer_nombre or buyer_region:
        try:
            autoridades_entidad = query_autoridades_entidad(
                entidad_nombre=buyer_nombre or "",
                region=buyer_region or "",
                tool_context=tool_context,
            )
            for key in ("alcalde_provincial_actual", "alcalde_distrital_actual",
                        "gobernador_regional_actual"):
                a = autoridades_entidad.get(key)
                if a and a.get("nombre"):
                    personas_a_investigar.add(a["nombre"])
            for r in autoridades_entidad.get("regidores_provinciales", []) or []:
                if r.get("nombre"):
                    personas_a_investigar.add(r["nombre"])
        except Exception:
            autoridades_entidad = {}

    # Derivar empresas vinculadas al titular para que el grafo de red del
    # frontend las renderice automáticamente. El sub-agente person_network_agent
    # a veces no las copia al campo `red_empresarial.empresas_mismo_titular`,
    # así que las generamos acá explícitamente desde query_rnp_persona del
    # titular + socios secundarios encontrados en cada empresa.
    empresas_titular_derivadas: list = []
    socios_secundarios_set: set = set()
    if ganador_dni:
        try:
            rnp_titular = query_rnp_persona(query=ganador_dni, tool_context=tool_context)
            for emp in rnp_titular.get("empresas", []) or []:
                ruc_emp = emp.get("ruc_empresa")
                if not ruc_emp or ruc_emp == ganador_ruc:
                    continue  # excluir el RUC propio del proveedor
                empresas_titular_derivadas.append({
                    "ruc": ruc_emp,
                    "razon_social": emp.get("nombre_visto") or emp.get("nombre_normalizado_rnp"),
                    "rol_del_gerente": ", ".join(emp.get("roles", []) or [])[:80] or "socio",
                    "forma_societaria": emp.get("forma_societaria"),
                    "fecha_inicio": emp.get("fecha_inicio_vigencia"),
                })
                # Investigar socios de esa empresa
                try:
                    socios_emp = query_rnp_empresa(ruc=ruc_emp, tool_context=tool_context)
                    for grupo in ("socios", "representantes_legales", "organos_administracion"):
                        for s in socios_emp.get(grupo) or []:
                            dni_s = (s.get("numero_documento") or "").strip()
                            nombre_s = (s.get("nombre") or "").strip().upper()
                            if dni_s == ganador_dni or nombre_s == (ganador_razon or "").upper():
                                continue  # excluir el titular mismo
                            if dni_s and dni_s not in socios_secundarios_set:
                                socios_secundarios_set.add(dni_s)
                                # Investigar al socio secundario también
                                if dni_s.isdigit() and len(dni_s) == 8:
                                    personas_a_investigar.add(dni_s)
                                personas_a_investigar.add(nombre_s)
                except Exception:
                    pass
        except Exception:
            pass

    # ─── ENRIQUECIMIENTO 1: socios de postores rivales (NO ganadores) ───
    #
    # Si algún socio de un postor rival es funcionario público activo o
    # candidato con cargo electo, eso es bandera ALTA — competencia simulada.
    # Caso real detectado en logs: Lázaro Gamboa Talaverano (Consejero Regional
    # Loreto 2023-2026) es accionista de PETRO CABALLOCOCHA S.A.C., postor no
    # ganador. Sin este enriquecimiento, ese hallazgo no era visible en grafo.
    socios_postores_rivales: list[dict] = []
    for postor in todos_postores:
        if postor.get("es_ganador"):
            continue
        ruc_postor = postor.get("ruc")
        if not ruc_postor:
            continue
        try:
            sp = query_rnp_empresa(ruc=ruc_postor, tool_context=tool_context)
        except Exception:
            sp = {}
        socios = []
        for grupo in ("socios", "representantes_legales", "organos_administracion"):
            for s in sp.get(grupo) or []:
                dni_s = (s.get("numero_documento") or "").strip()
                nombre_s = (s.get("nombre") or "").strip()
                if not (dni_s or nombre_s):
                    continue
                socios.append({
                    "nombre": nombre_s,
                    "dni": dni_s if dni_s and dni_s.isdigit() and len(dni_s) == 8 else None,
                    "rol_en_postor": grupo,
                })
        # Deduplicar por DNI/nombre
        seen = set()
        socios_uniq = []
        for s in socios:
            key = s.get("dni") or s.get("nombre", "").upper()
            if not key or key in seen:
                continue
            seen.add(key)
            socios_uniq.append(s)
        socios_postores_rivales.append({
            "ruc_postor": ruc_postor,
            "razon_social": postor.get("razon_social"),
            "socios": socios_uniq[:6],  # cap a 6 socios por postor
            "n_socios": len(socios_uniq),
        })

    # ─── ENRIQUECIMIENTO 2: confianza_match en funcionarios designados ───
    #
    # Cruza cada funcionario contra `batch_person_lookup_result.resumen`
    # (si el orquestador ya corrió el batch). Marca `confianza_match` y
    # `hallazgos_summary` para que el frontend muestre indicador visual.
    batch_res = state.get("batch_person_lookup_result") or {}
    resumen_por_nombre: dict = {}
    for entry in (batch_res.get("resumen") or []):
        nombre = (entry.get("nombre") or "").upper()
        if nombre:
            resumen_por_nombre[nombre] = entry
    funcionarios_designados_enriched = []
    for f in funcionarios_designados:
        nf = f.copy() if isinstance(f, dict) else {}
        nombre = (nf.get("nombre_completo") or nf.get("nombre") or "").upper()
        match = resumen_por_nombre.get(nombre)
        if match:
            nf["confianza_match"] = match.get("confianza_match", "media")
            nf["hallazgos_summary"] = match.get("hallazgos") or []
        else:
            nf["confianza_match"] = "sin_lookup"
        funcionarios_designados_enriched.append(nf)

    # ─── ENRIQUECIMIENTO 3: visitas inter-municipales detectadas ───
    #
    # Cuando un funcionario de la entidad contratante visitó otra entidad
    # representando a una municipalidad distinta, eso indica doble vinculación.
    # Caso real: Danilin Cardenas Torres (Secretaria General de Las Amazonas)
    # visitó OSIPTEL representando a Municipalidad Provincial de Alto Amazonas.
    visitas_inter_municipales: list[dict] = []
    entidad_actual_upper = (buyer_nombre or "").upper()
    # Iteramos sobre datos_peru que es el dict que ya construimos en este scope
    for nombre_pers, d in datos_peru.items():
        visitas_obj = (d or {}).get("visitas") or {}
        for v in (visitas_obj.get("visitas") or []):
            ent_visitante = (v.get("entidad_visitante") or "").upper()
            ent_visitada = (v.get("entidad_visitada") or "").upper()
            # Inter-municipal: la persona aparece vinculada a una entidad
            # distinta de la que figura como su empleadora actual
            if ent_visitante and entidad_actual_upper and \
               "MUNICIPALIDAD" in ent_visitante and \
               entidad_actual_upper not in ent_visitante:
                visitas_inter_municipales.append({
                    "persona": nombre_pers,
                    "entidad_visitada": v.get("entidad_visitada"),
                    "entidad_representada": v.get("entidad_visitante"),
                    "funcionario_anfitrion": v.get("funcionario"),
                    "fecha": v.get("fecha"),
                    "motivo": v.get("motivo"),
                })

    out = {
        # Anclaje temporal — fecha de hoy para que el LLM no marque fechas
        # del pasado reciente como "futuras" por desconocer la fecha actual.
        "_today": _today_iso(),
        "ganador": {"ruc": ganador_ruc, "razon_social": ganador_razon,
                    "dni_persona_natural": ganador_dni},
        "entidad_contratante": {
            "ruc": buyer_ruc,
            "nombre": buyer_nombre,
            "region": buyer_region,
        },
        "todos_postores": todos_postores,
        # NUEVO: socios de postores rivales con info estructurada
        "socios_postores_rivales": socios_postores_rivales,
        "firmantes_consolidados": firmantes_validos,
        "firmantes_descartados_por_alucinacion": firmantes_descartados,
        "comite_evaluacion": comite_validos,
        "rnp_proveedor": rnp_proveedor,
        "rnp_firmantes_resultados": rnp_firmantes_resultados,
        "datos_peru_por_persona": datos_peru,
        "n_personas_investigadas": len(datos_peru),
        "_anti_alucinacion_aplicada": bool(firmantes_descartados),
        "red_empresarial_derivada": {
            "empresas_mismo_titular": empresas_titular_derivadas,
            "n_empresas": len(empresas_titular_derivadas),
            "n_socios_secundarios": len(socios_secundarios_set),
        },
        "autoridades_entidad": autoridades_entidad,
        # NUEVO: funcionarios con confianza_match cruzada
        "funcionarios_designados": funcionarios_designados_enriched,
        "n_funcionarios_designados": len(funcionarios_designados_enriched),
        # NUEVO: visitas inter-municipales para visualizar doble vinculación
        "visitas_inter_municipales": visitas_inter_municipales,
        "n_visitas_inter_municipales": len(visitas_inter_municipales),
    }
    state["person_network_context"] = out
    return out

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

def detect_puerta_giratoria(dni_gerente: str, entidad_contratante_ruc: str,
                             tool_context: ToolContext) -> dict:
    """Cruza si el gerente del proveedor fue funcionario público en la MISMA
    entidad que ahora le adjudica un contrato — patrón "puerta giratoria"
    (revolving door). Usa: jne_candidaturas, peps, El Peruano si están cargados.

    Patrón típico de corrupción: funcionario de Municipalidad X renuncia hoy,
    abre EIRL la próxima semana, y a los 6 meses gana contrato con Municipalidad X.

    Args:
        dni_gerente: DNI del gerente del proveedor adjudicado.
        entidad_contratante_ruc: RUC de la entidad que adjudica.
    """
    indicios = []
    # PEPs (si tabla existe)
    pep_r = query_pep(dni_gerente, tool_context)
    if pep_r.get("found"):
        for p in pep_r.get("registros", []):
            indicios.append({
                "fuente": "PEPs",
                "cargo": p.get("cargo"),
                "entidad": p.get("entidad"),
                "año_desde": p.get("año_desde"),
                "año_hasta": p.get("año_hasta"),
            })
    # JNE — candidaturas (proxy de actividad política con la entidad)
    jne_r = query_jne_candidaturas(dni_gerente, tool_context)
    if jne_r.get("found"):
        for c in jne_r.get("candidaturas", []):
            indicios.append({
                "fuente": "JNE_candidatura",
                "cargo": c.get("cargo"),
                "partido": c.get("partido"),
                "año": c.get("año"),
                "region": c.get("region"),
            })

    return {
        "dni_evaluado": dni_gerente,
        "entidad_contratante_ruc": entidad_contratante_ruc,
        "n_indicios": len(indicios),
        "indicios": indicios,
        "patron_detectado": len(indicios) > 0,
        "severidad": "alta" if len(indicios) >= 2 else ("media" if indicios else "ninguna"),
        "hint": "Si patron_detectado=true, generá bandera explícita en banderas_red. "
                "Severidad ALTA si hay ≥2 cargos públicos previos en la misma región/entidad.",
    }

def scrape_jne_hoja_vida(dni: str, tool_context: ToolContext) -> dict:
    """Llama al microservicio `vigia-scraper` (Playwright + Chromium) que
    busca al candidato en la Plataforma Electoral del JNE y devuelve sus
    candidaturas registradas + texto de declaración jurada.

    Usar para personas que sospechás candidato/funcionario y NO aparecen en
    el dataset `jne_candidaturas` (porque aún no se cargó o son recientes).

    Args:
        dni: DNI peruano (8 dígitos numéricos).

    Returns:
        dict del scraper con `found`, `n_resultados`, `resultados`.
    """
    url = os.getenv("VIGIA_SCRAPER_URL", "https://vigia-scraper-36169102688.us-central1.run.app")
    if not url:
        return {"ok": False, "error": "VIGIA_SCRAPER_URL no configurada"}
    if not (dni or "").strip().isdigit() or len(dni.strip()) != 8:
        return {"ok": False, "error": "dni inválido (8 dígitos)", "dni": dni}
    try:
        r = requests.post(
            f"{url.rstrip('/')}/jne_hoja_vida",
            json={"dni": dni.strip()},
            timeout=45,
        )
        if r.status_code == 200:
            return r.json()
        return {"ok": False, "error": f"scraper_http_{r.status_code}",
                "detail": r.text[:300]}
    except Exception as e:
        return {"ok": False, "error": "scraper_unreachable", "detail": str(e)[:200]}

def detect_aporte_a_partido_del_alcalde(dni_gerente: str, ocid: str,
                                         tool_context: ToolContext) -> dict:
    """Detecta si el gerente del proveedor aportó al partido del alcalde/gobernador
    que firmó la convocatoria. Cruza: ONPE aportantes + autoridad de la entidad.

    Args:
        dni_gerente: DNI del gerente del proveedor.
        ocid: OCID de la convocatoria (para inferir entidad y autoridad).
    """
    # Aportes del gerente vía ONPE
    aportes = query_onpe_aportantes(dni_gerente, tool_context)
    if not aportes.get("found"):
        return {
            "patron_detectado": False,
            "motivo": "no_aportes_onpe_registrados",
            "dataset_no_disponible": aportes.get("dataset_no_disponible", False),
        }

    partidos_aportados = set(aportes.get("partidos_distintos", []))
    # Autoridad de la entidad (de state si el orquestador ya lo extrajo,
    # sino se queda con el hallazgo crudo).
    state = tool_context.state
    autoridad_entidad = (state.get("autoridad_entidad") or {})
    partido_autoridad = autoridad_entidad.get("partido")

    if not partido_autoridad:
        return {
            "patron_detectado": False,
            "motivo": "partido_de_autoridad_no_identificado",
            "aportes_gerente": list(partidos_aportados),
            "hint": "El person_network_agent debe identificar al alcalde/gobernador "
                    "de la entidad contratante y su partido para activar este cruce.",
        }

    coincide = any(
        _normalize_persona(p) == _normalize_persona(partido_autoridad)
        for p in partidos_aportados
    )
    return {
        "dni_evaluado": dni_gerente,
        "ocid": ocid,
        "partidos_aportados_por_gerente": list(partidos_aportados),
        "partido_de_autoridad_actual": partido_autoridad,
        "patron_detectado": coincide,
        "severidad": "alta" if coincide else "ninguna",
        "evidencia": (
            f"El gerente aportó al partido '{partido_autoridad}' que también es el "
            f"partido del alcalde/gobernador firmante. Conflicto directo."
        ) if coincide else None,
    }

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

def batch_person_lookup(personas: list, tool_context: ToolContext) -> dict:
    """Consulta el perfil completo de N personas en paralelo. Reemplaza
    el bucle secuencial de 5 queries × N personas por una sola tool call.

    Por cada persona ejecuta en paralelo:
        - query_rnp_persona (empresas donde figura como socio/repr)
        - query_onpe_aportantes (aportes a partidos políticos)
        - query_jne_candidaturas (candidaturas electorales)
        - query_pep (Personas Expuestas Políticamente)
        - query_visitas_de_persona (Registro Único de Visitas Ley 28024)

    Args:
        personas: Lista de dicts con la forma
            [{"id": "<id_libre>", "dni": "12345678", "nombre": "JUAN PEREZ",
              "rol": "titular|socio|firmante|alcalde|gerente|..."}]
            Se requiere AL MENOS uno de `dni` o `nombre` por persona.

    Returns:
        dict con:
          · n_personas: int
          · resultados: dict[id → {rnp, onpe, jne, pep, visitas}]
          · resumen: lista de hallazgos relevantes por persona
          · duracion_ms: tiempo total en ms (debugging)
    """
    import time as _t
    t0 = _t.time()

    if not isinstance(personas, list) or not personas:
        return {"n_personas": 0, "resultados": {}, "resumen": [],
                "error": "personas debe ser una lista no vacía"}

    # Normaliza cada persona: usa dni si existe, sino nombre. Genera id si falta.
    def _input_for(p: dict) -> str:
        dni = (p.get("dni") or "").strip()
        if dni and dni.isdigit() and len(dni) == 8:
            return dni
        return (p.get("nombre") or "").strip().upper()

    tasks: list = []  # (id, persona, query_name, query_fn)
    QUERIES = [
        ("rnp",      query_rnp_persona),
        ("onpe",     query_onpe_aportantes),
        ("jne",      query_jne_candidaturas),
        ("pep",      query_pep),
        ("visitas",  query_visitas_de_persona),
    ]

    for i, p in enumerate(personas):
        pid = str(p.get("id") or i)
        inp = _input_for(p)
        if not inp:
            continue
        for qname, qfn in QUERIES:
            tasks.append((pid, p, qname, qfn, inp))

    resultados: dict = {}
    # Inicializa cada persona con su metadata
    for i, p in enumerate(personas):
        pid = str(p.get("id") or i)
        resultados[pid] = {
            "_meta": {
                "id": pid,
                "dni": p.get("dni"),
                "nombre": p.get("nombre"),
                "rol": p.get("rol"),
                "input_usado": _input_for(p),
            },
        }

    # Paralelización: 16 workers porque cada query es muy liviana (single SQL)
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        futs = {
            pool.submit(qfn, inp, tool_context): (pid, qname)
            for (pid, _p, qname, qfn, inp) in tasks
        }
        for fut in concurrent.futures.as_completed(futs):
            pid, qname = futs[fut]
            try:
                resultados[pid][qname] = fut.result()
            except Exception as e:
                resultados[pid][qname] = {"error": str(e)[:200], "found": False}

    # ─── FILTRO ANTI-ALUCINACIÓN: descartar ruido fuzzy de baja calidad ───
    #
    # Problema observado: si el LLM pasa nombres muy genéricos sin DNI
    # ("Juan Pérez García"), el fuzzy_trigram devuelve 30-50 resultados con
    # match_score 0.45-0.65 que son personas completamente distintas
    # (homónimos parciales). Esto se reportaba como "50 candidaturas" y el LLM
    # generaba banderas con severidad ALTA basándose en homónimos masivos.
    #
    # Regla:
    #   · Si la persona NO tiene DNI exacto, filtrar resultados con score < 0.75.
    #   · Si después del filtro hay >15 resultados, marcar confianza_match=baja
    #     y limitar a top 5 para no envenenar el context del LLM.
    #   · Calcular confianza_match por persona en {alta, media, baja}.

    HIGH_CONF_THRESHOLD = 0.75
    LOW_CONF_MAX_ITEMS = 5

    def _filter_fuzzy_noise(results: dict, has_dni: bool) -> dict:
        """Aplica el filtro de ruido fuzzy a una respuesta de query."""
        if has_dni or not isinstance(results, dict):
            return results
        # Si match_type=exacto_dni, ya es confiable
        if results.get("match_type") == "exacto_dni":
            return results
        for key in ("empresas", "aportes", "candidaturas", "registros", "visitas"):
            items = results.get(key)
            if not isinstance(items, list):
                continue
            filtered = [
                it for it in items
                if float(it.get("match_score") or 0) >= HIGH_CONF_THRESHOLD
            ]
            # Si después del filtro queda muy poco, dejamos top 5 ordenados
            if len(filtered) == 0 and items:
                filtered = sorted(
                    items, key=lambda x: -float(x.get("match_score") or 0)
                )[:LOW_CONF_MAX_ITEMS]
                results["_ruido_fuzzy_descartado"] = len(items) - len(filtered)
            else:
                results["_ruido_fuzzy_descartado"] = len(items) - len(filtered)
            results[key] = filtered
            # Recomputar n_*
            if key == "empresas":
                results["n_empresas"] = len(filtered)
            elif key == "aportes":
                results["n_aportes"] = len(filtered)
                results["monto_total"] = sum(
                    float(x.get("monto") or 0) for x in filtered)
            elif key == "candidaturas":
                results["n_candidaturas"] = len(filtered)
            elif key == "registros":
                results["n_registros"] = len(filtered)
            elif key == "visitas":
                results["n_visitas"] = len(filtered)
            results["found"] = len(filtered) > 0
        return results

    # Aplica filtro y calcula confianza por persona
    for pid, data in resultados.items():
        meta = data.get("_meta") or {}
        has_dni = bool(meta.get("dni"))
        if not has_dni:
            for qname in ("rnp", "onpe", "jne", "pep", "visitas"):
                if qname in data and isinstance(data[qname], dict):
                    data[qname] = _filter_fuzzy_noise(data[qname], has_dni=False)
        # Confianza global de la persona
        if has_dni:
            confianza = "alta"
        else:
            # Sin DNI: si TODOS los resultados quedaron filtrados a 0, no hay nada;
            # si hay al menos un match con score >= 0.85, confianza media;
            # si todos están entre 0.75-0.85, confianza baja.
            best_score = 0.0
            for qname in ("rnp", "onpe", "jne", "pep", "visitas"):
                q = data.get(qname) or {}
                for k in ("empresas", "aportes", "candidaturas", "registros", "visitas"):
                    for it in (q.get(k) or []):
                        s = float(it.get("match_score") or 0)
                        if s > best_score:
                            best_score = s
            if best_score >= 0.85:
                confianza = "media"
            elif best_score >= 0.75:
                confianza = "baja"
            else:
                confianza = "muy_baja"
        data["_confianza_match"] = confianza
        data["_meta"]["confianza_match"] = confianza

    # Construir resumen compacto: hallazgos más relevantes por persona
    resumen = []
    for pid, data in resultados.items():
        meta = data.get("_meta", {})
        confianza = data.get("_confianza_match", "muy_baja")
        # Skip personas sin DNI cuya confianza es muy baja — pura alucinación.
        if confianza == "muy_baja":
            continue
        hallazgos = []
        if data.get("rnp", {}).get("n_empresas", 0) > 0:
            hallazgos.append(f"{data['rnp']['n_empresas']} empresas en RNP")
        if data.get("onpe", {}).get("n_aportes", 0) > 0:
            o = data["onpe"]
            hallazgos.append(
                f"{o['n_aportes']} aportes ONPE (S/. {o.get('monto_total', 0):.0f})")
        if data.get("jne", {}).get("n_candidaturas", 0) > 0:
            hallazgos.append(f"{data['jne']['n_candidaturas']} candidaturas JNE")
        if data.get("pep", {}).get("n_registros", 0) > 0:
            hallazgos.append(f"PEP {data['pep']['n_registros']} registros")
        if data.get("visitas", {}).get("n_visitas", 0) > 0:
            hallazgos.append(f"{data['visitas']['n_visitas']} visitas a entidades")
        if hallazgos:
            resumen.append({
                "id": pid, "nombre": meta.get("nombre"),
                "dni": meta.get("dni"), "rol": meta.get("rol"),
                "confianza_match": confianza,
                "hallazgos": hallazgos,
                # Bandera explícita para que el LLM SEPA que sin DNI los hallazgos
                # son fuzzy y NO sirven para emitir banderas de severidad ALTA.
                "advertencia": (
                    "Sin DNI: hallazgos solo aproximados. NO emitir banderas alta "
                    "sin verificar el match exacto."
                ) if confianza in ("baja", "media") else None,
            })

    dur_ms = int((_t.time() - t0) * 1000)

    # Guarda en state para que sub-agentes posteriores puedan leerlo
    try:
        tool_context.state["batch_person_lookup_result"] = {
            "n_personas": len(personas),
            "resumen": resumen,
            "resultados_keys": list(resultados.keys()),
        }
    except Exception:
        pass

    return {
        "n_personas": len(personas),
        "n_queries_ejecutadas": len(tasks),
        "duracion_ms": dur_ms,
        "resumen": resumen,
        "resultados": resultados,
    }

# ── FunctionTool wrappers ──
query_visitas_de_persona_tool = FunctionTool(func=query_visitas_de_persona)
query_autoridades_entidad_tool = FunctionTool(func=query_autoridades_entidad)
read_person_network_context_tool = FunctionTool(func=read_person_network_context)
query_rnp_persona_tool = FunctionTool(func=query_rnp_persona)
query_rnp_empresa_tool = FunctionTool(func=query_rnp_empresa)
query_onpe_aportantes_tool = FunctionTool(func=query_onpe_aportantes)
query_jne_candidaturas_tool = FunctionTool(func=query_jne_candidaturas)
query_pep_tool = FunctionTool(func=query_pep)
batch_person_lookup_tool = FunctionTool(func=batch_person_lookup)
detect_puerta_giratoria_tool = FunctionTool(func=detect_puerta_giratoria)
detect_aporte_a_partido_del_alcalde_tool = FunctionTool(func=detect_aporte_a_partido_del_alcalde)
scrape_jne_hoja_vida_tool = FunctionTool(func=scrape_jne_hoja_vida)
