"""Ensamblaje del contexto completo de red de personas para el
person_network_agent: cruza RNP, electoral (ONPE/JNE/PEP/autoridades) y
visitas para el ganador, sus socios, firmantes, comité y funcionarios
designados de la entidad. Orquesta las consultas de `rnp`, `electoral` y
`visitas` — no las duplica."""

from tools._core import *  # noqa: F401,F403
from tools.personas.rnp import query_rnp_empresa, query_rnp_persona
from tools.personas.electoral import (query_autoridades_entidad, query_jne_candidaturas,
                                      query_onpe_aportantes, query_pep)
from tools.personas.visitas import query_visitas_de_persona


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

# ── FunctionTool wrappers ──
read_person_network_context_tool = FunctionTool(func=read_person_network_context)
