"""Tools del dominio: market."""

from tools._core import *  # noqa: F401,F403

def list_items_for_pricing(ocid: str, tool_context: ToolContext) -> dict:
    """Lista los items de la convocatoria que necesitan validación de precio.

    Args:
        ocid: OCID de la convocatoria que ya está en BD.

    Returns:
        Diccionario con items (lista con numero, descripcion, cantidad, unidad,
        precio_unitario_referencial, cuantia_total_item) y cuantia_total.
    """
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT numero_item, descripcion, cantidad, unidad,
                      precio_unit_ref, cuantia_referencial
                 FROM convocatoria_items WHERE ocid=%s ORDER BY numero_item""",
            (ocid,),
        )
        items = [
            {"numero": r[0], "descripcion": r[1], "cantidad": float(r[2] or 0),
             "unidad": r[3], "precio_unitario_referencial": float(r[4] or 0),
             "cuantia_total_item": float(r[5] or 0)}
            for r in cur.fetchall()
        ]
        return {"ocid": ocid, "n_items": len(items),
                "cuantia_total": sum(it["cuantia_total_item"] for it in items),
                "items": items}
    finally:
        conn.close()

def build_market_input(ocid: str, tool_context: ToolContext) -> dict:
    """Ensambla MECÁNICAMENTE el input que el market_price_agent necesita.

    Combina:
      - Items del SQL (cantidad, unidad, precio_unitario_referencial, cuantia)
      - items_consolidados del state['document_analysis'] (con requerimiento_tecnico_detallado,
        marca_o_modelo_exigido, certificaciones_exigidas, padre_ocds_item)
      - Sub-items desglosados por el parser que tengan distinto número (ej. 2.1, 2.2)

    Esto evita que el LLM orquestador tenga que ensamblar a mano y se olvide
    del requerimiento. La idea es que el LLM solo llame esta tool y pase el
    JSON resultante TAL CUAL al market_price_agent.

    Args:
        ocid: OCID de la convocatoria.

    Returns:
        Diccionario con `items` (lista lista para el market) + `tiene_requerimiento`
        + estadísticas. La lista incluye:
          numero, descripcion_corta, cantidad, unidad,
          precio_unitario_referencial, precio_unitario_ofertado,
          requerimiento_tecnico_detallado, marca_o_modelo_exigido,
          certificaciones_exigidas, padre_ocds_item.
    """
    state = tool_context.state

    # Items del SQL (vienen del OCDS)
    sql_items_by_num: dict = {}
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT numero_item, descripcion, cantidad, unidad,
                      precio_unit_ref, cuantia_referencial, cubso
                 FROM convocatoria_items WHERE ocid=%s ORDER BY numero_item""",
            (ocid,),
        )
        for r in cur.fetchall():
            num = str(r[0]) if r[0] is not None else ""
            sql_items_by_num[num] = {
                "numero": num,
                "descripcion_corta": (r[1] or "")[:300],
                "cantidad": float(r[2] or 0),
                "unidad": r[3] or "UND",
                "precio_unitario_referencial": float(r[4] or 0) if r[4] else None,
                "cuantia_referencial_item": float(r[5] or 0) if r[5] else None,
                "cubso": (str(r[6]).strip() if len(r) > 6 and r[6] else None),
            }
        # Ofertas ganadoras por número de ítem
        cur.execute(
            """SELECT i.numero_item, o.monto_ofertado
                 FROM convocatoria_items i
                 JOIN ofertas o ON o.item_id=i.id AND o.ganadora
                WHERE i.ocid=%s""", (ocid,),
        )
        ofertas_by_num = {str(r[0]): float(r[1] or 0) for r in cur.fetchall()}
    finally:
        conn.close()

    # items_consolidados del document_parser. PRIORIDAD:
    #   1. state['parser_raw_consolidated'] (escrito por la tool directamente,
    #      con TODOS los items extraídos del PDF — independiente de qué
    #      resuma el agente en su respuesta).
    #   2. state['document_analysis'] (output_key del agente, puede tener
    #      menos items si el LLM resumió).
    raw = state.get("parser_raw_consolidated") or {}
    parser_items = raw.get("items_consolidados") or []

    # También leer items del output del agente document_parser (LLM).
    # PRIORIDAD: si el LLM desglosó MÁS items que la tool (típico cuando una
    # tabla del DOCX no fue parseada como tabla por la tool pero el LLM sí
    # vio los N sub-items), usar los del LLM.
    doc_llm = _safe_parse_json(state.get("document_analysis")) or {}
    llm_items = doc_llm.get("items_consolidados") or []

    def _sum_req(its):
        return sum(len(str(it.get("requerimiento_tecnico_detallado") or ""))
                   for it in its if isinstance(it, dict))
    # Preferir los items del LLM si desglosó MÁS items, o si —a igual número— traen
    # MÁS requerimiento técnico. El agente enriquece `requerimiento_tecnico_detallado`
    # (resumen narrativo de las Bases) que la extracción RAW de la tool no tiene; sin
    # esto, build_market_input se quedaba con el raw sin requerimiento aunque el LLM
    # SÍ lo había extraído (bug 1221137: los 827 chars del ítem 'CPU' nunca llegaban).
    if len(llm_items) > len(parser_items) or (
        llm_items and len(llm_items) == len(parser_items)
        and _sum_req(llm_items) > _sum_req(parser_items)
    ):
        parser_items = llm_items

    # Indexar parser_items por número
    parser_by_num: dict = {}
    for pi in parser_items:
        if not isinstance(pi, dict):
            continue
        num = str(pi.get("numero") or "")
        if not num:
            continue
        # COLISIÓN de número: el parser a veces numera con el MISMO número tanto
        # el título-objeto (sin requerimiento) como el ítem real (con el
        # requerimiento extraído de las Bases). Con last-wins se perdía el
        # requerimiento real (bug 1221137: el ítem "CPU" con 827 chars lo pisaba
        # el título-objeto con 0). Nos quedamos con el ítem MÁS informativo.
        prev = parser_by_num.get(num)
        if prev is not None:
            prev_req = len(str(prev.get("requerimiento_tecnico_detallado") or ""))
            new_req = len(str(pi.get("requerimiento_tecnico_detallado") or ""))
            if new_req <= prev_req:
                continue
        parser_by_num[num] = pi

    # MERGE: empezamos por los SQL items y enriquecemos. Si el parser desglosó
    # en sub-items (ej. 2.1, 2.2), los agregamos como entradas adicionales.
    items_finales: list[dict] = []
    nums_vistos: set = set()

    # Heurística para detectar si el parser_item "1" es el LOTE PADRE o un
    # PRODUCTO FÍSICO incorrectamente numerado:
    #   · Si la descripción del SQL contiene palabras de agregación (LOTE,
    #     PAQUETE, CANASTA, BIENES DE, AYUDA HUMANITARIA, etc) Y el parser
    #     tiene un item con el mismo número y descripción específica → es
    #     producto físico que estaba colisionando.
    AGGREGATOR_KEYWORDS = ("LOTE", "PAQUETE", "CANASTA", "BIENES DE", "KIT DE",
                            "KIT ", "CONJUNTO", "GLOBAL", "BIENES Y SERVICIOS",
                            "AYUDA HUMANITARIA", "INSUMOS DIVERSOS", "ALIMENTOS DIVERSOS",
                            "MATERIALES DE", "EQUIPAMIENTO", "MOBILIARIO DE")
    parser_items_con_padre = {
        n for n, pi in parser_by_num.items()
        if pi.get("padre_ocds_item")
    }

    def _parser_item1_es_producto_fisico(parser_it: dict, sql_descr: str,
                                          n_sql_items: int, n_parser_items: int) -> bool:
        """True si el parser_item con número igual al SQL parece ser un PRODUCTO
        FÍSICO erróneamente numerado como el padre (no un lote agregador).
        Casos cubiertos:
          1. Parser declara explícitamente padre_ocds_item en otros items (rescue clásico).
          2. SQL tiene 1 solo item agregador (con keyword LOTE/BIENES DE) y parser
             tiene N≥2 items SIN padre declarado pero el auto-link los conectará.
             En este caso, el item con numero="1" del parser TAMBIÉN es producto físico.
        """
        if not parser_it:
            return False
        # Solo aplica si el parser numeró como "1" y declara padre_ocds_item null
        if parser_it.get("padre_ocds_item"):
            return False
        descr_parser = (parser_it.get("descripcion_corta") or "").upper()
        descr_sql = (sql_descr or "").upper()
        # Si la descripción del parser contiene palabras de agregación, ES lote.
        if any(kw in descr_parser for kw in AGGREGATOR_KEYWORDS):
            return False
        # Si el parser_item tiene ~la misma descripción que el ítem OCDS, ES el
        # OBJETO/AGREGADOR (el padre), NO un producto perdido. Sin esto, un lote
        # como "ADQUISICIÓN DE LLANTAS PARA..." (sin keyword) se "rescataba" como
        # un sub-ítem fantasma "1.0" que luego se preciaba → doble conteo del lote.
        import difflib as _dl
        if descr_parser and descr_sql and (
            descr_parser[:35] == descr_sql[:35]
            or _dl.SequenceMatcher(None, descr_parser[:120], descr_sql[:120]).ratio() >= 0.75
        ):
            return False
        # Caso 1: hay otros sub-items con padre explícito → claramente lote.
        if parser_items_con_padre:
            if any(kw in descr_sql for kw in AGGREGATOR_KEYWORDS):
                return True
            return False
        # Caso 2: SQL tiene 1 solo item y el parser desglosó N≥2 productos sin
        # padre declarado → el auto-link conectará los demás al "1", pero el item
        # "1" del parser quedaría absorbido en el padre. Lo "rescatamos" como
        # sub-item "1.0" para que SÍ se precie.
        #
        # La señal es ESTRUCTURAL (1 ítem OCDS + N≥2 productos del parser), NO
        # depende de keywords: si el OCDS trae un solo renglón y el parser
        # encontró 2+ productos físicos distintos, ese renglón ES el lote.
        # (bug 1221190: "UNIFORMES" no estaba en AGGREGATOR_KEYWORDS, así que
        # BLUSA —el parser-item "1"— se absorbía en el padre y nunca se preciaba;
        # quedaban 4/5 ítems con precio. La keyword es señal suficiente, no
        # necesaria.)
        if n_sql_items == 1 and n_parser_items >= 2:
            return True
        return False

    for num, sql_it in sql_items_by_num.items():
        merged = dict(sql_it)
        # El SQL item ES por definición un ítem padre OCDS — nunca puede tener
        # `padre_ocds_item`. Lo dejamos null explícitamente.
        merged["padre_ocds_item"] = None
        # Mergear con parser SOLO si el parser item NO declara padre distinto.
        # Si el parser numeró "1"=ARROZ con padre_ocds_item="1", ese ARROZ NO
        # es lo mismo que el OCDS#1 ("CANASTAS GLOBALES") — son entidades
        # distintas (padre vs hijo). Mezclarlas hereda padre erróneamente y
        # rompe la distribución de precio.
        parser_it = parser_by_num.get(num)
        parser_it_es_subitem = parser_it and parser_it.get("padre_ocds_item")

        # NUEVO: heurística para detectar parser_item "1" que es PRODUCTO FÍSICO
        # erróneamente numerado como el padre (bug observado en OCID 1212841:
        # CAMAS PLEGABLES se perdía porque el parser le dio numero="1" y la
        # función lo confundía con el lote agregador OCDS).
        parser_it_es_producto_perdido = (
            parser_it
            and not parser_it_es_subitem
            and _parser_item1_es_producto_fisico(
                parser_it,
                sql_it.get("descripcion_corta", ""),
                len(sql_items_by_num),
                len(parser_by_num),
            )
        )
        if parser_it_es_producto_perdido:
            # Adoptar el parser_item como SUB-ITEM del lote OCDS — preservamos
            # el contenido en lugar de mergearlo destructivamente con el SQL
            # item (que es el lote agregador).
            items_finales.append({
                "numero": f"{num}.0",  # "1.0" para indicar primer sub-item rescatado
                "padre_ocds_item": num,
                "descripcion_corta": parser_it.get("descripcion_corta") or "",
                "cantidad": parser_it.get("cantidad"),
                "unidad": parser_it.get("unidad") or "UND",
                "precio_unitario_referencial": parser_it.get("precio_unitario_referencial"),
                "precio_unitario_ofertado": _market_to_num(parser_it.get("precio_unitario_ofertado")),
                "origen_precio": (parser_it.get("origen_precio") or "parser") if _market_to_num(parser_it.get("precio_unitario_ofertado")) else None,
                "marca_ofertada": parser_it.get("marca_ofertada"),
                "requerimiento_tecnico_detallado": parser_it.get("requerimiento_tecnico_detallado"),
                "marca_o_modelo_exigido": parser_it.get("marca_o_modelo_exigido"),
                "certificaciones_exigidas": parser_it.get("certificaciones_exigidas") or [],
                "auto_linked_padre": True,
                "renumerado_desde": num,
                "_rescue_reason": "parser_numero_colisiona_con_padre_lote",
            })
            # El SQL item (lote padre) sigue su flujo normal abajo
            items_finales.append(merged)
            nums_vistos.add(num)  # marcar visto: este número ya fue procesado
            continue

        if parser_it and not parser_it_es_subitem:
            for k in (
                "requerimiento_tecnico_detallado",
                "marca_o_modelo_exigido",
                "certificaciones_exigidas",
            ):
                v = parser_it.get(k)
                if v not in (None, "", []):
                    merged[k] = v
            if parser_it.get("descripcion_corta") and len(parser_it["descripcion_corta"]) > len(merged.get("descripcion_corta", "")):
                merged["descripcion_corta"] = parser_it["descripcion_corta"]
            # R4: precio pactado (contrato/OC) ya cruzado por el parser en el ítem consolidado.
            pu_parser = _market_to_num(parser_it.get("precio_unitario_ofertado"))
            if pu_parser:
                merged["precio_unitario_ofertado"] = pu_parser
                merged["origen_precio"] = parser_it.get("origen_precio") or "parser"
            if parser_it.get("marca_ofertada"):
                merged["marca_ofertada"] = parser_it.get("marca_ofertada")
        if not merged.get("precio_unitario_ofertado"):
            merged["precio_unitario_ofertado"] = (
                ofertas_by_num.get(num) / max(merged.get("cantidad") or 1, 1)
                if ofertas_by_num.get(num) else None
            )
            merged["origen_precio"] = "oferta_ganadora_bd" if merged["precio_unitario_ofertado"] else None
        items_finales.append(merged)
        # Solo marcamos como visto si NO había un parser sub-item con ese mismo
        # número — porque ese parser item necesita entrar al loop de sub-items.
        if not parser_it_es_subitem:
            nums_vistos.add(num)

    # Auto-link: si el OCDS reporta UN SOLO ítem global y el parser sacó N
    # sub-items físicos sin `padre_ocds_item` declarado, los adoptamos como
    # hijos de ese único ítem padre OCDS. Patrón típico: "1 Unidad CANASTAS
    # DE ALIMENTOS" en OCDS, pero el requerimiento detalla 12 productos
    # (lenteja, aceite, arroz, azúcar…). Sin este auto-link los sub-items
    # quedaban huérfanos y se descartaban.
    sql_item_nums = list(sql_items_by_num.keys())
    huérfanos_para_auto_link: list = []
    if len(sql_item_nums) == 1:
        unico_padre = sql_item_nums[0]
        for num, pi in parser_by_num.items():
            if num in nums_vistos:
                continue
            if pi.get("padre_ocds_item"):
                continue  # ya tiene padre declarado
            huérfanos_para_auto_link.append((num, pi, unico_padre))

    # Agregar sub-items del parser que no están en el OCDS (desgloses)
    # Contador para renumerar cuando el parser usa números que colisionan con
    # padres OCDS (ej. parser "1"=ARROZ con padre="1" vs SQL "1"=CANASTAS).
    sub_idx_by_padre: dict[str, int] = {}
    for num, pi in parser_by_num.items():
        if num in nums_vistos:
            continue
        padre = pi.get("padre_ocds_item")
        auto_linked = False
        if not padre and len(sql_item_nums) == 1:
            padre = sql_item_nums[0]
            auto_linked = True
        if not padre:
            continue
        # Renumerar si el numero del sub-item coincide con el numero del padre
        # OCDS (caso típico: el parser usó "1", "2", "3"… para sub-items de un
        # OCDS que también tiene un ítem "1").
        numero_final = num
        if str(num) == str(padre) or num in sql_items_by_num:
            sub_idx_by_padre[str(padre)] = sub_idx_by_padre.get(str(padre), 0) + 1
            numero_final = f"{padre}.{sub_idx_by_padre[str(padre)]}"
        items_finales.append({
            "numero": numero_final,
            "padre_ocds_item": padre,
            "descripcion_corta": pi.get("descripcion_corta") or "",
            "cantidad": pi.get("cantidad"),
            "unidad": pi.get("unidad") or "UND",
            "precio_unitario_referencial": pi.get("precio_unitario_referencial"),
            "precio_unitario_ofertado": _market_to_num(pi.get("precio_unitario_ofertado")),
            "origen_precio": (pi.get("origen_precio") or "parser") if _market_to_num(pi.get("precio_unitario_ofertado")) else None,
            "marca_ofertada": pi.get("marca_ofertada"),
            "requerimiento_tecnico_detallado": pi.get("requerimiento_tecnico_detallado"),
            "marca_o_modelo_exigido": pi.get("marca_o_modelo_exigido"),
            "certificaciones_exigidas": pi.get("certificaciones_exigidas") or [],
            "auto_linked_padre": auto_linked,
            "renumerado_desde": num if numero_final != num else None,
        })
        nums_vistos.add(num)

    # ── PADRE OCDS + SUB-ITEMS HETEROGÉNEOS ────────────────────────
    # Cuando el OCDS reporta UN ítem global (ej. "CANASTA DE ALIMENTOS"
    # cuantia=98390, cantidad=1) y el parser desglosa N sub-items
    # (Arroz 28 sacos, Atún 1300 latas, Lentejas 33 bolsas…), NO
    # distribuimos el precio por cantidad — los productos son heterogéneos
    # (un saco 50kg no vale lo mismo que una lata 140gr) y la distribución
    # uniforme produce números absurdos. En su lugar:
    #   · Mantenemos el padre en el output como "fila lote" con la
    #     cuantía total del OCDS (referencia para el frontend).
    #   · Los sub-items quedan SIN `precio_unitario_referencial`. El
    #     market_price_agent debe llenar `precio_mediana_mercado` para
    #     cada uno; la suma `Σ cantidad × mediana` se compara después
    #     contra la cuantía del padre.

    def _normalize_id(x):
        if x is None:
            return ""
        s = str(x).strip().lstrip("0") or "0"
        return s

    subs_by_padre: dict[str, list[dict]] = {}
    for it in items_finales:
        padre = it.get("padre_ocds_item")
        if padre:
            subs_by_padre.setdefault(_normalize_id(padre), []).append(it)

    # ── Padre que ES un producto (no un lote) ─────────────────────
    # 1225450: el OCDS registró UN ítem "DIESEL B5 S-50" (5 000 gal) y el parser colgó GASOHOL
    # (100 gal) como hijo → el diésel (98 % del valor) se degradaba a "padre lote", se sacaba
    # del array y el lote (S/ 139 950) se comparaba contra 100 gal de gasohol (+7 162 %).
    # Regla: el ítem OCDS es un PRODUCTO (se precia y sus "hijos" pasan a ser hermanos) si
    #   · su descripción no trae palabras de agregación (LOTE, PAQUETE, CANASTA…),
    #   · coincide (raíz de palabras / coincide_objeto) con el producto del parser que se le
    #     fusionó con el mismo número, y
    #   · NINGÚN hijo coincide con él (si los hijos son "llanta A / llanta B" bajo "LLANTAS",
    #     o "diésel + gasohol" bajo "COMBUSTIBLE DIÉSEL Y GASOHOL", sigue siendo lote).
    padres_producto: set[str] = set()
    for it in items_finales:
        n_norm = _normalize_id(it.get("numero"))
        if it.get("padre_ocds_item") or n_norm not in subs_by_padre:
            continue
        descr_sql = (it.get("descripcion_corta") or "")
        if any(kw in descr_sql.upper() for kw in AGGREGATOR_KEYWORDS):
            continue
        p_it = parser_by_num.get(str(it.get("numero"))) or {}
        if p_it.get("padre_ocds_item"):
            continue
        descr_parser = p_it.get("descripcion_corta") or ""
        if not descr_parser or not _coincide_objeto(descr_sql, [descr_parser]):
            continue
        hijos = subs_by_padre[n_norm]
        if any(_coincide_objeto(descr_sql, [h.get("descripcion_corta") or ""]) for h in hijos):
            continue
        padres_producto.add(n_norm)
        it["es_producto_ocds"] = True
        it["_nota_lote"] = ("El OCDS registró un solo ítem; el parser encontró además "
                            f"{len(hijos)} producto(s) distinto(s) que se precian como hermanos.")
        for h in hijos:
            h["hermano_de_ocds_item"] = it.get("numero")
            h["padre_ocds_item"] = None
            h["cubso"] = h.get("cubso") or it.get("cubso")
    for n_norm in padres_producto:
        subs_by_padre.pop(n_norm, None)
    # Sub-ítems heredan el CUBSO del padre (para el ancla regional).
    for it in items_finales:
        p = it.get("padre_ocds_item")
        if p and not it.get("cubso"):
            it["cubso"] = (sql_items_by_num.get(str(p)) or {}).get("cubso")

    skipped_padres: set[str] = set()
    distributions_applied: list[dict] = []  # vacío — sin distribución
    padres_info: list[dict] = []
    items_para_market: list[dict] = []

    for it in items_finales:
        n_norm = _normalize_id(it.get("numero"))
        if n_norm in subs_by_padre and not it.get("padre_ocds_item"):
            # Es padre con sub-items: lo SACAMOS del array que va al market
            # (porque confunde al LLM cuando recibe padre + hijos juntos) y lo
            # guardamos en `padre_lote` para que el frontend lo muestre como
            # banner del lote.
            cuantia = (
                it.get("cuantia_referencial_item")
                or ((it.get("precio_unitario_referencial") or 0) * (it.get("cantidad") or 1))
                or 0
            )
            padres_info.append({
                "numero": it.get("numero"),
                "descripcion": (it.get("descripcion_corta") or "")[:200],
                "cuantia_total": float(cuantia or 0),
                "cantidad": it.get("cantidad"),
                "unidad": it.get("unidad") or "Unidad",
                "n_subitems": len(subs_by_padre[n_norm]),
            })
            skipped_padres.add(n_norm)
            continue
        items_para_market.append(it)
    items_finales = items_para_market

    # ── Precio OFERTADO por ítem (nunca el referencial etiquetado como ofertado) ──
    # Prioridad: parser R4 (`precio_unitario_ofertado`/`origen_precio`) > `items_contratados[]`
    # (R4) > ítems del contrato/OC en `items_otros_documentos` (hoy llegan con el precio pactado en
    # `precio_unitario_referencial`, 1225416/1225450) > oferta ganadora en BD > awards[].items[]
    # del OCDS > prorrateo del contrato cuando todos los ítems comparten unidad de medida.
    em = _safe_parse_json(state.get("estudio_mercado")) or {}
    cf = _safe_parse_json(state.get("contrato_final")) or {}
    ocds_state = state.get("ocds") or {}
    contratados = _items_contratados_del_state(state, doc_llm)
    award_items = _award_items_ocds(ocds_state)
    cuantia_referencial_total = sum((v.get("cuantia_referencial_item") or 0) for v in sql_items_by_num.values())
    _enriquecer_precio_ofertado(items_finales, contratados, ofertas_by_num, award_items, cf, sql_items_by_num)

    # ── Sin truncado ─────────────────────────────────────────────────
    # El `document_parser_agent` extrae a campos discretos (marca_o_modelo,
    # certificaciones, valores_tecnicos_clave, garantia, requisitos_postor,
    # subitems, etc.) y `requerimiento_tecnico_detallado` es un resumen
    # narrativo denso (300-1000 chars). No truncamos: si algo viene grande
    # es bug del parser y el fix es ahí, no acá.

    # Stats
    n_con_req = sum(
        1 for it in items_finales
        if it.get("requerimiento_tecnico_detallado")
        and len(str(it.get("requerimiento_tecnico_detallado"))) > 80
    )

    n_con_precio_distribuido = sum(
        1 for it in items_finales if it.get("precio_estimado_por_distribucion")
    )
    n_auto_linked = sum(1 for it in items_finales if it.get("auto_linked_padre"))

    mensaje_base = (
        "Estos son los ítems con su requerimiento técnico detallado "
        "extraído de las Bases Administrativas. Usa `requerimiento_tecnico_detallado` "
        "como contexto principal para construir queries específicas; NO te bases solo "
        "en `descripcion_corta`."
        if n_con_req > 0 else
        "No hay requerimiento técnico detallado disponible para estos ítems (las Bases "
        "podrían no detallarlo, ser escaneadas, o el ítem del OCDS no enlazó con el de las "
        "Bases). Trabaja con descripcion_corta y declara `estado: 'no_verificable'` en los "
        "findings cuyo producto hallado no pueda contrastarse con el requerimiento."
    )
    mensaje_lote = ""
    if padres_info:
        p = padres_info[0]
        mensaje_lote = (
            f" Estos {p['n_subitems']} sub-ítems pertenecen a un LOTE OCDS de S/. "
            f"{(p.get('cuantia_total') or 0):,.2f} TOTAL (monto del lote completo; el ítem padre "
            f"no se incluye abajo porque sus sub-ítems lo componen). Reporta precios observados "
            f"por cada sub-ítem; la suma cantidad × mediana y la comparación contra el lote las "
            f"calcula el código, no tú."
        )

    # ── Anclas de precio OFICIALES (ruteo incremental) ──
    # Además de las búsquedas web, el market_agent recibe el valor referencial del
    # estudio de mercado (Resumen Ejecutivo) y el precio FINAL del contrato (Orden
    # de Compra). Permite comparar contra lo pagado, no solo contra el referencial.
    mensaje_ancla = ""
    if em.get("valor_referencial") or em.get("comparacion_precio_historico"):
        mensaje_ancla += (
            f"\n\n📊 ESTUDIO DE MERCADO OFICIAL (Resumen Ejecutivo): valor referencial="
            f"{em.get('valor_referencial')} {em.get('moneda') or ''}. Comparación histórica: "
            f"{em.get('comparacion_precio_historico') or '—'}. Usá esto como ANCLA: si tus "
            f"precios web difieren mucho del referencial oficial, explicá por qué."
        )
    if cf.get("precio_final_total"):
        mensaje_ancla += (
            f"\n\n💵 PRECIO FINAL CONTRATADO (Orden de Compra): {cf.get('precio_final_total')} "
            f"{cf.get('moneda') or ''}. Compará el precio FINAL contra tu mediana de mercado, "
            f"no solo contra el referencial."
        )
    precio_final_vs_ref = None
    try:
        _vr, _pf = em.get("valor_referencial"), cf.get("precio_final_total")
        if _vr and _pf and float(_vr) > 0:
            precio_final_vs_ref = round((float(_pf) - float(_vr)) / float(_vr) * 100, 1)
    except Exception:
        precio_final_vs_ref = None

    # Cuantía referencial del proceso (fallback explícito, nunca se etiqueta como "ofertado").
    if not cuantia_referencial_total:
        try:
            cuantia_referencial_total = float(((ocds_state.get("tender") or {}).get("value") or {}).get("amount") or 0)
        except (TypeError, ValueError):
            cuantia_referencial_total = 0.0
    if precio_final_vs_ref is None and cf.get("precio_final_total") and cuantia_referencial_total:
        try:
            precio_final_vs_ref = round((float(cf["precio_final_total"]) - cuantia_referencial_total)
                                        / cuantia_referencial_total * 100, 1)
        except (TypeError, ValueError):
            precio_final_vs_ref = None
    total_ofertado, total_ofertado_base = _total_ofertado_proceso(items_finales, contratados, cf, ocds_state,
                                                                  cuantia_referencial_total)

    out = {
        "ocid": ocid,
        "items": items_finales,
        "n_items": len(items_finales),
        "n_items_con_requerimiento_extraido": n_con_req,
        "n_items_con_precio_distribuido": n_con_precio_distribuido,
        "n_items_con_precio_ofertado": sum(1 for it in items_finales if it.get("precio_unitario_ofertado")),
        "n_padres_excluidos": len(skipped_padres),
        "n_padres_producto": len(padres_producto),
        "n_auto_linked": n_auto_linked,
        "distributions_applied": distributions_applied,
        "padres_info": padres_info,
        "padre_lote": padres_info[0] if padres_info else None,
        "cuantia_referencial_total": cuantia_referencial_total or None,
        "total_ofertado": total_ofertado,
        "total_ofertado_base": total_ofertado_base,
        "total_ofertado_es_referencial": total_ofertado_base == "referencial",
        "items_contratados": contratados[:40],
        "tiene_requerimiento": n_con_req > 0,
        "estudio_mercado": em or None,
        "contrato_final": cf or None,
        "precio_final_vs_referencial": precio_final_vs_ref,
        "mensaje_para_market_agent": mensaje_base + mensaje_lote + mensaje_ancla,
    }
    return out


# ── Helpers de precio ofertado / contratado (lote 1 · T6) ─────────────
_DOCS_PRECIO_CONTRATO_RE = re.compile(r"contrat|orden\s+de\s+compra|orden\s+de\s+servicio|buena\s+pro|cuadro\s+comparativo|propuesta|oferta", re.IGNORECASE)


def _items_contratados_del_state(state: dict, doc_llm: dict | None = None) -> list[dict]:
    """`items_contratados[]` del parser (R4: descripcion, cantidad, unidad, precio_unitario_contratado,
    marca_ofertada). Fallback: ítems de `items_otros_documentos` cuyo `_documento` es contrato/OC/
    acta (llegan con el precio pactado en `precio_unitario_referencial`)."""
    raw = state.get("parser_raw_consolidated") or {}
    out: list[dict] = []
    fuentes = []
    for src in (raw, doc_llm or {}):
        if isinstance(src, dict):
            fuentes.append(src.get("items_contratados") or [])
    for lista in fuentes:
        for it in lista:
            if not isinstance(it, dict):
                continue
            pu = _market_to_num(it.get("precio_unitario_contratado") or it.get("precio_unitario_ofertado"))
            if not pu:
                continue
            out.append({"descripcion": (it.get("descripcion") or it.get("descripcion_corta") or "")[:300],
                        "cantidad": _market_to_num(it.get("cantidad") or it.get("cantidad_contratada")),
                        "unidad": it.get("unidad"), "precio_unitario_contratado": pu,
                        "marca_ofertada": it.get("marca_ofertada"), "origen": "items_contratados",
                        "documento": it.get("_documento") or it.get("documento")})
        if out:
            return out
    for it in (raw.get("items_otros_documentos") or []):
        if not isinstance(it, dict):
            continue
        doc = str(it.get("_documento") or "")
        if not _DOCS_PRECIO_CONTRATO_RE.search(doc):
            continue
        pu = _market_to_num(it.get("precio_unitario_contratado") or it.get("precio_unitario_ofertado")
                            or it.get("precio_unitario_referencial"))
        if not pu:
            continue
        out.append({"descripcion": (it.get("descripcion_corta") or it.get("descripcion") or "")[:300],
                    "cantidad": _market_to_num(it.get("cantidad")), "unidad": it.get("unidad"),
                    "precio_unitario_contratado": pu, "marca_ofertada": it.get("marca_ofertada") or it.get("marca_o_modelo_exigido"),
                    "origen": "items_otros_documentos", "documento": doc[:120]})
    return out


def _award_items_ocds(ocds: dict) -> dict[str, float]:
    """{numero_item (position o id): precio unitario adjudicado} desde awards[].items[].totalValue."""
    out: dict[str, float] = {}
    for a in (ocds.get("awards") or []):
        if not isinstance(a, dict):
            continue
        for ai in (a.get("items") or []):
            if not isinstance(ai, dict):
                continue
            try:
                qty = float(ai.get("quantity") or 0)
                amt = float(((ai.get("totalValue") or {}).get("amount")) or 0)
            except (TypeError, ValueError):
                continue
            if qty > 0 and amt > 0:
                for k in (ai.get("position"), ai.get("id")):
                    if k is not None and str(k) not in out:
                        out[str(k)] = round(amt / qty, 4)
    return out


def _match_contratado(it: dict, contratados: list[dict]) -> dict | None:
    """Ítem contratado que corresponde al ítem del mercado: solape de raíces ≥ 0.5 y cantidad
    coincidente (±1 %) o, si no hay cantidad, mejor solape ≥ 0.6."""
    descr = it.get("descripcion_corta") or it.get("descripcion") or ""
    cant = it.get("cantidad")
    mejor, mejor_s = None, 0.0
    for c in contratados:
        s = _solape_raices(descr, c.get("descripcion") or "")
        if s < 0.5:
            continue
        cc = c.get("cantidad")
        misma_cant = bool(cant and cc and abs(float(cant) - float(cc)) / max(float(cant), 1e-9) <= 0.01)
        score = s + (0.5 if misma_cant else 0.0)
        if score > mejor_s:
            mejor, mejor_s = c, score
    if mejor is None:
        return None
    cc = mejor.get("cantidad")
    if cant and cc and abs(float(cant) - float(cc)) / max(float(cant), 1e-9) > 0.01 and mejor_s < 1.1:
        return None
    return mejor


def _enriquecer_precio_ofertado(items: list[dict], contratados: list[dict], ofertas_by_num: dict,
                                award_items: dict, cf: dict, sql_items_by_num: dict) -> None:
    for it in items:
        origen_prev = it.get("origen_precio")
        if it.get("precio_unitario_ofertado") and origen_prev != "oferta_ganadora_bd":
            it["origen_precio"] = origen_prev or "parser"
            continue
        num = str(it.get("numero") or "")
        # El precio por producto del contrato/OC manda sobre la oferta de la BD (awards / cantidad
        # del ítem OCDS): en un lote de 2 productos bajo un ítem OCDS esa división no es el precio real.
        c = _match_contratado(it, contratados) if contratados else None
        if c:
            it["precio_unitario_ofertado"] = c["precio_unitario_contratado"]
            it["origen_precio"] = "contrato" if c.get("origen") == "items_contratados" else "contrato_items_otros_documentos"
            if c.get("marca_ofertada") and not it.get("marca_ofertada"):
                it["marca_ofertada"] = c["marca_ofertada"]
            continue
        if it.get("precio_unitario_ofertado"):
            continue   # oferta ganadora de la BD (ya asignada en el merge) sin contrato que la corrija
        cant = it.get("cantidad") or 0
        if ofertas_by_num.get(num) and cant:
            it["precio_unitario_ofertado"] = round(ofertas_by_num[num] / cant, 4)
            it["origen_precio"] = "oferta_ganadora_bd"
            continue
        if not it.get("padre_ocds_item") and not it.get("hermano_de_ocds_item") and award_items.get(num):
            it["precio_unitario_ofertado"] = award_items[num]
            it["origen_precio"] = "ocds_award_item"
            continue
        it.setdefault("precio_unitario_ofertado", None)
        it.setdefault("origen_precio", None)
    # Prorrateo del contrato: todos los ítems sin precio comparten la MISMA unidad de medida
    # (gal, kg, m…; nunca UND) y hay precio final → precio único = total / Σ cantidades. Es lo
    # que hizo el contrato 1225450 (121 839 / 5 100 gal = 23.89 en ambos ítems).
    sin_precio = [it for it in items if not it.get("precio_unitario_ofertado")]
    if sin_precio and len(sin_precio) == len(items):
        total = _market_to_num(cf.get("precio_final_total")) if isinstance(cf, dict) else None
        dims = {(_unidad_canon(it.get("unidad"), item=True) or (None, None))[0] for it in items}
        cants = [float(it.get("cantidad") or 0) for it in items]
        if total and len(dims) == 1 and (dims & set(_UNIDADES_MEDIDA)) and all(c > 0 for c in cants):
            pu = round(total / sum(cants), 4)
            for it in items:
                it["precio_unitario_ofertado"] = pu
                it["origen_precio"] = "prorrateo_contrato_misma_unidad"


def _total_ofertado_proceso(items: list[dict], contratados: list[dict], cf: dict, ocds: dict,
                            cuantia_referencial_total: float | None) -> tuple[float | None, str | None]:
    """(total, base): contrato (precio_final_total) > Σ items_contratados > awards[].value (OCDS) >
    Σ ofertado_i × cantidad_i (todos los ítems con precio) > cuantía referencial (`referencial`)."""
    total = _market_to_num(cf.get("precio_final_total")) if isinstance(cf, dict) else None
    if total:
        return total, "contrato"
    if contratados and all(c.get("cantidad") for c in contratados):
        s = sum(c["precio_unitario_contratado"] * float(c["cantidad"]) for c in contratados)
        if s > 0:
            return round(s, 2), "contrato_items"
    for a in (ocds.get("awards") or []):
        if isinstance(a, dict):
            amt = _market_to_num(((a.get("value") or {}).get("amount")))
            if amt:
                return amt, "adjudicado"
    for c in (ocds.get("contracts") or []):
        if isinstance(c, dict):
            amt = _market_to_num(((c.get("value") or {}).get("amount")))
            if amt:
                return amt, "contratado_ocds"
    if items and all(it.get("precio_unitario_ofertado") and isinstance(it.get("cantidad"), (int, float)) for it in items):
        s = sum(float(it["precio_unitario_ofertado"]) * float(it["cantidad"]) for it in items)
        if s > 0:
            return round(s, 2), "ofertado_items"
    if cuantia_referencial_total:
        return float(cuantia_referencial_total), "referencial"
    return None, None

def record_market_finding(
    item_numero: int, item_descripcion: str,
    precio_ofertado: float, precio_mediana_mercado: float,
    fuentes_consultadas: str, veredicto: str, nota: str,
    tool_context: ToolContext,
) -> dict:
    """Registra un hallazgo de validación de precio para un ítem específico.
    El agente debe llamar esta tool una vez por cada ítem después de buscar
    precios con google_search.

    Args:
        item_numero: Número del ítem según la convocatoria.
        item_descripcion: Descripción corta del ítem.
        precio_ofertado: Precio unitario ofertado (S/.).
        precio_mediana_mercado: Precio mediano que encontraste en el mercado (S/.).
        fuentes_consultadas: Lista de fuentes consultadas, separadas por ' · '.
        veredicto: Uno de 'alineado', 'elevado', 'muy_elevado', 'barato', 'sin_datos'.
        nota: Comentario explicando el veredicto.

    Returns:
        Diccionario con el hallazgo registrado y diferencia_pct calculada.
    """
    if precio_mediana_mercado > 0:
        diff_pct = (precio_ofertado - precio_mediana_mercado) / precio_mediana_mercado * 100
    else:
        diff_pct = 0.0
    finding = {
        "item_numero": item_numero,
        "item_descripcion": item_descripcion,
        "precio_ofertado": precio_ofertado,
        "precio_mediana_mercado": precio_mediana_mercado,
        "diferencia_pct": round(diff_pct, 2),
        "fuentes_consultadas": fuentes_consultadas,
        "veredicto": veredicto,
        "nota": nota,
    }
    tool_context.state.setdefault("market_findings", []).append(finding)
    return {"recorded": True, "finding": finding,
            "n_findings_so_far": len(tool_context.state["market_findings"])}

def read_market_input(tool_context: ToolContext) -> dict:
    """Devuelve los items consolidados con su requerimiento técnico, listo para
    que el market_price_agent valide precios. Self-contained: si ya hay cache
    en state, lo retorna; si no, ejecuta `build_market_input` con el OCID del
    state['ocds'] y cachea el resultado.

    Esta tool reemplaza la práctica anterior del orchestrator de pegar el JSON
    grande de items en el request del market_price_agent — operación que el
    LLM falla cuando el JSON es voluminoso (deja el placeholder literal).

    Returns:
        dict con `items[]`, `tiene_requerimiento`, `mensaje_para_market_agent`,
        `n_items` y el resto del payload que produce `build_market_input`.
        Si no hay OCDS en state, retorna {error: ...}.
    """
    state = tool_context.state
    cache = state.get("market_input")
    if cache and isinstance(cache, dict) and cache.get("items"):
        return cache
    ocds = state.get("ocds") or {}
    ocid_raw = ocds.get("ocid") or state.get("ocid")
    if not ocid_raw:
        return {"error": "no hay OCDS en state — ejecuta fetch_ocds_record primero",
                "items": []}
    # Normalizar al formato corto que usa SQL — bug detectado 2026-05-24
    ocid = _short_ocid(ocid_raw)
    result = build_market_input(ocid=ocid, tool_context=tool_context)
    state["market_input"] = result
    return result


# ════════════════════════════════════════════════════════════════════
# ANÁLISIS DE MERCADO POR ESTRATEGIA (perfil del pipeline)
# ════════════════════════════════════════════════════════════════════
# `analizar_mercado(state, estrategia)` es la única entrada. Cuatro estrategias
# (AUDITORIA_ORQUESTADOR §4.2 / §6.3-3):
#   · goods_retail     — bienes: precios unitarios en marketplaces peruanos vía Gemini +
#                        google_search. Las URLs salen SOLO de `grounding_metadata.
#                        grounding_chunks` (el modelo no escribe URLs); mediana / Δ % /
#                        veredicto se calculan en código.
#   · historico_seace  — servicios / consultoría: comparación contra convocatorias similares
#                        de la BD propia (CUBSO + objeto normalizado con unaccent + pg_trgm,
#                        24 meses) y tarifa mensual / por entregable implícita del bloque
#                        `servicio` del parser.
#   · presupuesto_obra — obras: partidas del expediente técnico (bloque `obra`) vs
#                        presupuesto total, GG/utilidad, adicionales acumulados, y obras
#                        similares en la BD; INFOBRAS queda como validación pendiente.
#   · cotizaciones     — directa / convenio / otros: cotizaciones del expediente (bloque
#                        `sustento_directa`) vs monto adjudicado; cotizante = ganador;
#                        cotizantes vinculados vía person_network.
# Todas escriben `state["market_analysis"]` (formato que consumen
# `persist_market_flags_as_banderas` y el frontend), publican las URLs reales en
# `state["grounding_urls"]`, registran descartes/recortes y devuelven `sin_dato` explícito
# cuando no hay base de comparación. Nunca inventan referencias.

ESTRATEGIAS = ("goods_retail", "historico_seace", "presupuesto_obra", "cotizaciones")

# Modelo de los workers de precio atado al tier por defecto (AUDITORIA §6.4-3).
MARKET_WORKER_MODEL = os.getenv("MARKET_WORKER_MODEL") or DEFAULT_GEMINI_MODEL
# Ítems por worker (chico: cada worker hace las búsquedas de verdad para sus ítems).
MARKET_CHUNK_SIZE = int(os.getenv("MARKET_CHUNK_SIZE", "3"))
MARKET_MAX_WORKERS = int(os.getenv("MARKET_MAX_WORKERS", "8"))
# Segundo pase: re-precia los ítems que quedaron sin precio con grounding en la 1ª ronda.
MARKET_RETRY = os.getenv("MARKET_RETRY", "1") == "1"
# Timeout total del fan-out: lo que no llegó se registra como recorte (no bloquea la corrida).
MARKET_TIMEOUT_S = int(os.getenv("MARKET_TIMEOUT_S", "300"))
# Precios (con URL real) necesarios para emitir un veredicto elevado/muy_elevado/barato.
MARKET_MIN_PRECIOS = int(os.getenv("MARKET_MIN_PRECIOS", "3"))
# Tipo de cambio para precios observados en USD (se declara en cada precio convertido).
MARKET_USD_PEN = float(os.getenv("MARKET_USD_PEN", "3.75"))
# Histórico SEACE: ventana, mínimo de comparables para veredicto y similitud trigram mínima.
MARKET_HIST_MESES = int(os.getenv("MARKET_HIST_MESES", "24"))
MARKET_HIST_MIN_N = int(os.getenv("MARKET_HIST_MIN_N", "5"))
MARKET_HIST_SIM = float(os.getenv("MARKET_HIST_SIM", "0.30"))
MARKET_HIST_LIMIT = int(os.getenv("MARKET_HIST_LIMIT", "60"))
# El histórico compara MONTOS TOTALES de contratos de objeto similar sin normalizar por alcance
# (n° de guardias, meses, m²…): la posición vs p25/p50/p75 es INFORMATIVA. Solo emite veredicto
# (→ bandera sobreprecio_*) si se habilita explícitamente; por defecto `sin_dato` con motivo
# `comparacion_no_normalizada` (verificado 2026-09-15: un servicio de vigilancia hospitalaria de
# S/ 1.3M daba +385 % vs la mediana de 60 "similares" — no es señal, es escala).
MARKET_HIST_VEREDICTO = os.getenv("MARKET_HIST_VEREDICTO", "0") == "1"
# Umbrales de veredicto (Δ % contra la mediana).
MARKET_UMBRAL_ELEVADO = 15.0
MARKET_UMBRAL_MUY_ELEVADO = 50.0
# Demasiados ítems para priciar TODOS con búsqueda real (cada worker = 1 llamada Gemini +
# google_search): por encima de este umbral, los ítems de MENOR valor (fuera del top N por
# `_valor_item`) se ESTIMAN con el conocimiento previo del modelo, sin buscar — más rápido/barato.
# Nunca cuenta como "respaldado": no puede mover sobreprecio_pct/veredicto_global ni cobertura
# (ver `_worker_estimacion_llm`, guarda en campos `*_estimacion_ia` separados de los de grounding).
MARKET_ESTIMACION_DESDE = int(os.getenv("MARKET_ESTIMACION_DESDE", "20"))
MARKET_CHUNK_SIZE_ESTIMACION = int(os.getenv("MARKET_CHUNK_SIZE_ESTIMACION", "10"))

OECE_PROCESO_URL = "https://contratacionesabiertas.oece.gob.pe/proceso/{ocid}"


class _StateCtx:
    """ToolContext mínimo para reutilizar tools que solo usan `.state`."""
    __slots__ = ("state",)

    def __init__(self, state: dict):
        self.state = state


# ── Registro en state (recortes / descartes / grounding) ─────────────
def _registrar_descarte(state: dict, donde: str, motivo: str, detalle: str = "") -> None:
    state.setdefault("descartes", []).append({"donde": donde, "motivo": motivo, "detalle": str(detalle)[:300]})


def _registrar_recorte(state: dict, donde: str, limite, omitido) -> None:
    state.setdefault("recortes", []).append({"donde": donde, "limite": limite, "omitido": omitido})


def _publicar_grounding(state: dict, fuentes: list[dict]) -> None:
    """Publica URLs REALES en `state["grounding_urls"]` (lista de str, sin duplicados) y el
    detalle {uri, titulo, dominio, origen} en `state["market_grounding"]`."""
    urls = state.setdefault("grounding_urls", [])
    if not isinstance(urls, list):
        urls = state["grounding_urls"] = list(urls) if isinstance(urls, (set, tuple)) else []
    det = state.setdefault("market_grounding", [])
    vistos = set(urls)
    for f in fuentes:
        u = (f or {}).get("uri")
        if not u or u in vistos:
            continue
        vistos.add(u)
        urls.append(u)
        det.append({"uri": u, "titulo": f.get("titulo"), "dominio": f.get("dominio"), "origen": f.get("origen", "grounding")})


# ── Aritmética (todo en código, nada en el LLM) ──────────────────────
def _mediana(vals: list[float]) -> float | None:
    v = sorted(x for x in vals if isinstance(x, (int, float)))
    if not v:
        return None
    n = len(v)
    return float(v[n // 2]) if n % 2 else float((v[n // 2 - 1] + v[n // 2]) / 2)


def _percentil(vals: list[float], p: float) -> float | None:
    v = sorted(x for x in vals if isinstance(x, (int, float)))
    if not v:
        return None
    if len(v) == 1:
        return float(v[0])
    k = (len(v) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return float(v[lo] + (v[hi] - v[lo]) * (k - lo))


def _diff_pct(valor, mediana) -> float | None:
    try:
        if valor is None or mediana is None or float(mediana) <= 0:
            return None
        return round((float(valor) - float(mediana)) / float(mediana) * 100, 2)
    except (TypeError, ValueError):
        return None


def _veredicto(diff_pct) -> str:
    """|Δ| < 15 alineado · 15 ≤ Δ < 50 elevado · Δ ≥ 50 muy_elevado · Δ ≤ −15 barato."""
    if not isinstance(diff_pct, (int, float)):
        return "sin_dato"
    if diff_pct >= MARKET_UMBRAL_MUY_ELEVADO:
        return "muy_elevado"
    if diff_pct >= MARKET_UMBRAL_ELEVADO:
        return "elevado"
    if diff_pct <= -MARKET_UMBRAL_ELEVADO:
        return "barato"
    return "alineado"


def _filtrar_outliers(precios: list[float], factor: float = 5.0) -> tuple[list[float], list[float]]:
    """Descarta precios fuera de [mediana/factor, mediana×factor] (otro producto u otra
    unidad). Devuelve (conservados, descartados)."""
    if len(precios) < 3:
        return list(precios), []
    med = _mediana(precios)
    keep = [p for p in precios if med / factor <= p <= med * factor]
    drop = [p for p in precios if p not in keep]
    return keep, drop


def _market_to_num(x):
    """Coerce un precio a float. Acepta números y strings tipo 'S/ 1,200.50',
    '1.200,50', '120 soles'. Devuelve None si no es un número positivo."""
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return float(x) if x > 0 else None
    if not isinstance(x, str):
        return None
    s = x.strip().lower()
    for tok in ("s/.", "s/", "soles", "sol", "pen", "us$", "usd", "$"):
        s = s.replace(tok, "")
    s = s.replace(" ", "")
    if "," in s and "." in s:
        # 1.200,50 (europeo) vs 1,200.50 (anglo): el último separador es el decimal
        s = (s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".")
             else s.replace(",", ""))
    elif "," in s:
        dec = s.split(",")[-1]
        s = s.replace(",", "." if len(dec) <= 2 else "")
    s = re.sub(r"[^0-9.]", "", s)
    if not s or s == ".":
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v > 0 else None


def _norm_num(x) -> str:
    s = str(x if x is not None else "").strip()
    return s.lstrip("0") or "0" if s else ""


def _finding_vacio(it: dict, motivo: str, comentario: str) -> dict:
    return {
        "item_numero": it.get("numero"),
        "item_descripcion": (it.get("descripcion_corta") or it.get("descripcion") or "")[:300],
        "cantidad": it.get("cantidad"), "unidad": it.get("unidad"),
        "precio_unitario_referencial": it.get("precio_unitario_referencial"),
        "precio_unitario_ofertado": it.get("precio_unitario_ofertado"),
        "origen_precio_ofertado": it.get("origen_precio"),
        "precios_observados": [], "proveedores_potenciales": [],
        "caracteristicas_solicitadas_clave": [],
        "precio_mediana_mercado": None, "rango_min": None, "rango_max": None, "n_precios": 0,
        "n_precios_normalizados": 0,
        "diff_pct": None, "diff_base": None, "veredicto": "sin_dato",
        "es_estimacion": True, "motivo_estimacion": motivo,
        "estado": "sin_dato", "evidencia": [], "spec_restrictiva": None,
        "referencias_internas": [], "ancla_regional": {"estado": "sin_dato", "motivo": "no_consultada"},
        "comentario": comentario,
    }


# ════════════════════════════════════════════════════════════════════
# OBJETO ↔ ÍTEMS (raíces de palabras) · UNIDADES · ANCLA REGIONAL
# ════════════════════════════════════════════════════════════════════
# Correcciones del lote 1 (docs/design/revision_contratos): el ítem OCDS que coincide con un
# producto del parser NO se degrada a "padre lote" (1225450: DIESEL absorbido y comparado
# contra 100 gal de gasohol → +7 162 %); los precios observados se normalizan a la unidad del
# ítem antes de mediana/outliers (1225058 kg vs bolsa de 5 kg; 1225062 rollo de 400 m²; 1225266
# pieza de 3 m vs 4 m y riel de otro espesor); `total_ofertado` sale del contrato/OC, nunca de la
# cuantía referencial etiquetada como "ofertado" (1225416); y antes del retail se consulta la BD
# propia por CUBSO/unidad/región (1225030: VR de Cusco S/ 85–155/m³ ya estaban en `convocatorias`).

_OBJ_STOP = {
    "para", "de", "la", "el", "y", "del", "con", "en", "por", "los", "las", "un", "una", "al", "a", "e", "o",
    "adquisicion", "contratacion", "suministro", "compra", "servicio", "servicios", "proyecto", "obra",
    "meta", "municipalidad", "distrital", "provincial", "regional", "gobierno", "mejoramiento",
    "ampliacion", "construccion", "creacion", "instalacion", "sistema", "distrito", "provincia",
    "departamento", "region", "cui", "item", "lote", "paquete", "segun", "tipo", "cantidad", "unidad",
    "und", "pulgadas", "pulg", "plan", "programa", "ejecucion", "mantenimiento", "recuperacion",
    "reposicion", "puesto", "obra", "almacen", "entidad", "sede", "nuevo", "nueva", "anio", "fiscal",
    "in", "cm", "mm", "kg", "gal", "m2", "m3", "und", "unid", "pza", "bolsa", "saco", "rollo",
}
# Comodines: objetos genéricos que no dicen qué se compra (todo ítem "coincide").
_OBJ_COMODINES = ("bien", "material", "insumo", "producto", "articulo", "mercader", "equipamient", "divers")
# Hiperónimo → raíces de hipónimos frecuentes en compras públicas.
_OBJ_SINONIMOS = {
    "geosintet": ("geomall", "geotext", "geomembr", "geocel", "geodren", "geored"),
    "perfil": ("parant", "riel", "perfil", "canal", "omega", "angul", "esquiner"),
    "drywall": ("parant", "riel", "placa", "plancha", "yeso"),
    "combust": ("diesel", "gasohol", "gasolin", "petrol", "biodiesel", "glp", "gnv"),
    "aliment": ("arroz", "azucar", "aceit", "leche", "atun", "fideo", "lentej", "frijol", "menestr",
                "harin", "avena", "conserv", "quinua", "sal", "galleta"),
    "agregad": ("piedr", "arena", "hormig", "grava", "afirm", "confit", "ripio"),
    "ferret": ("clavo", "alambr", "tornill", "pintur", "tubo", "cement", "fierro", "acero"),
    "util": ("papel", "lapic", "cuadern", "boligr", "archiv", "folder", "tinta", "toner"),
    "comput": ("laptop", "computador", "cpu", "monitor", "impresor", "teclad", "mouse", "servidor", "tablet"),
    "equip": ("laptop", "computador", "monitor", "impresor", "estacion", "gps", "camara", "dron"),
    "topograf": ("estacion", "nivel", "gps", "prisma", "tripod", "mira"),
    "medicament": ("tablet", "ampoll", "jarab", "capsul", "inyect"),
    "reactiv": ("kit", "antiglobul", "suero", "control", "reactiv", "calibr"),
    "inmunohemat": ("kit", "antiglobul", "suero", "reactiv", "tarjet", "gel"),
    "vehicul": ("camion", "camionet", "volquet", "motocicl", "automov", "minibus", "omnibus"),
    "llanta": ("neumat", "llanta"),
    "uniform": ("blusa", "pantalon", "camisa", "polo", "casaca", "chaleco", "zapato", "gorra"),
    "vestuar": ("blusa", "pantalon", "camisa", "polo", "casaca", "chaleco", "zapato", "gorra"),
    "mobiliar": ("escritor", "silla", "mesa", "estant", "archivador", "carpeta"),
}
_OBJ_SUFIJOS = ("erias", "eria", "icas", "icos", "ica", "ico", "ales", "al", "es", "s", "a", "o", "e")


def _sin_tildes(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn")


def _raiz(tok: str) -> str:
    """Raíz muy simple (es): minúsculas sin tildes y hasta 2 sufijos frecuentes recortados."""
    t = _sin_tildes(tok).lower()
    for _ in range(2):
        for suf in _OBJ_SUFIJOS:
            if t.endswith(suf) and len(t) - len(suf) >= 4:
                t = t[: -len(suf)]
                break
    return t


def _raices(texto: str) -> set[str]:
    """Raíces de las palabras significativas: alfabéticas ≥ 3 letras (sin stopwords) y números de
    ≥ 2 dígitos (calibres, medidas: "10", "12", "50")."""
    out: set[str] = set()
    for tok in re.split(r"[^0-9a-záéíóúñü]+", _sin_tildes(texto or "").lower()):
        if not tok:
            continue
        if tok.isdigit():
            if len(tok) >= 2:
                out.add(tok)
            continue
        if len(tok) < 3 or tok in _OBJ_STOP or not tok.isalpha():
            continue
        out.add(_raiz(tok))
    return out


def _raices_coinciden(a: str, b: str) -> bool:
    if a.isdigit() or b.isdigit():
        return a == b
    if len(a) >= 5 and len(b) >= 5:
        return a[:5] == b[:5]
    return a == b


def _solape_raices(item_texto: str, otro_texto: str) -> float:
    """Fracción de raíces del ítem presentes en `otro_texto` (0..1)."""
    ri, ro = _raices(item_texto), _raices(otro_texto)
    if not ri or not ro:
        return 0.0
    n = sum(1 for a in ri if any(_raices_coinciden(a, b) for b in ro))
    return n / len(ri)


def _coincide_objeto_fallback(objeto: str, items) -> bool:
    """Fallback local de `coincide_objeto` (R1 la define en compliance_rules): raíz de palabras +
    sinónimos/hiperónimos + comodines. `items`: str o dict con descripcion/descripcion_corta."""
    ro = _raices(objeto)
    if not ro:
        return True
    if any(r.startswith(c) for r in ro for c in _OBJ_COMODINES):
        return True
    for it in items or []:
        texto = it if isinstance(it, str) else " ".join(
            str(it.get(k) or "") for k in ("descripcion_corta", "descripcion", "item_descripcion")) if isinstance(it, dict) else str(it)
        ri = _raices(texto)
        if not ri:
            continue
        if any(_raices_coinciden(a, b) for a in ro for b in ri):
            return True
        for hiper, hipos in _OBJ_SINONIMOS.items():
            if any(_pref(a, hiper) for a in ro) and any(_pref(b, h) for b in ri for h in hipos):
                return True
            if any(_pref(b, hiper) for b in ri) and any(_pref(a, h) for a in ro for h in hipos):
                return True
    return False


def _pref(raiz: str, patron: str) -> bool:
    """`raiz` (ya reducida) comparte prefijo con `patron` (hiperónimo/hipónimo del mapa)."""
    p = _raiz(patron)
    if raiz == p:
        return True
    n = min(len(raiz), len(p), 5)
    return n >= 4 and raiz[:n] == p[:n]


def _coincide_objeto(objeto: str, items) -> bool:
    """Usa `tools.compliance_rules.coincide_objeto` si existe (helper único de R1); si no, el
    fallback por raíces de este módulo."""
    textos = []
    for it in items or []:
        if isinstance(it, dict):
            textos.append(" ".join(str(it.get(k) or "") for k in ("descripcion_corta", "descripcion", "item_descripcion")).strip())
        elif it:
            textos.append(str(it))
    try:
        from tools.compliance_rules import coincide_objeto as _co  # import perezoso (R1)
    except Exception:
        _co = None
    if _co is not None:
        try:
            return bool(_co(objeto, textos))
        except Exception:
            pass
    return _coincide_objeto_fallback(objeto, textos)


# ── Unidades: dimensión y factor a la unidad base (kg · l · m · m2 · m3) ──
_DIM_UNIDADES: dict[str, tuple[str, float]] = {}
for _alias, _dim, _f in (
    ("kg kgs kilo kilos kilogramo kilogramos", "masa", 1.0),
    ("g gr grs gramo gramos", "masa", 0.001),
    ("tn ton tm tonelada toneladas", "masa", 1000.0),
    ("l lt lts litro litros", "volumen", 1.0),
    ("ml mililitro mililitros cc", "volumen", 0.001),
    ("gal galon galones", "volumen", 3.785),
    ("m mt mts metro metros ml", "longitud", 1.0),   # "ml" solo como unidad del ÍTEM (metro lineal)
    ("cm centimetro centimetros", "longitud", 0.01),
    ("m2 m² metro_cuadrado metros_cuadrados", "area", 1.0),
    ("m3 m³ metro_cubico metros_cubicos", "volumen_solido", 1.0),
):
    for _a in _alias.split():
        _DIM_UNIDADES.setdefault(_a, (_dim, _f))
_DIM_UNIDADES["ml"] = ("volumen", 0.001)   # en precios observados "ml" es mililitro
_CONTENEDORES = {
    "und", "unidad", "unidades", "unid", "u", "pieza", "piezas", "pza", "pzas", "bolsa", "bolsas", "saco",
    "sacos", "rollo", "rollos", "caja", "cajas", "paquete", "paquetes", "lata", "latas", "balde", "baldes",
    "cilindro", "cilindros", "bidon", "bidones", "botella", "botellas", "frasco", "frascos", "galonera",
    "galoneras", "juego", "juegos", "kit", "kits", "par", "pares", "plancha", "planchas", "barra", "barras",
    "tubo", "tubos", "envase", "envases", "display", "pack", "sobre", "sobres", "frasco", "tarro", "tarros",
    "cono", "conos", "pliego", "pliegos", "resma", "resmas", "cartucho", "cartuchos", "bulto", "bultos",
}
_UNIDADES_MEDIDA = ("masa", "volumen", "longitud", "area", "volumen_solido")


def _unidad_canon(u, *, item: bool = False) -> tuple[str, float] | None:
    """('masa', 1.0) para "KG"; ('unidad', 1.0) para envases/piezas; None si no se reconoce.
    Con `item=True`, "ML"/"metro lineal" es METRO LINEAL (convención SEACE), no mililitro."""
    s = _sin_tildes(str(u or "")).lower().strip().strip(".").replace("  ", " ")
    if not s:
        return None
    if item and s in ("ml", "metro lineal", "metros lineales", "m.l", "m.l."):
        return ("longitud", 1.0)
    s = s.replace("metros cuadrados", "m2").replace("metro cuadrado", "m2").replace("metros cubicos", "m3") \
         .replace("metro cubico", "m3").replace("metros lineales", "m").replace("metro lineal", "m") \
         .replace("kilogramos", "kg").replace("kilogramo", "kg").replace("galones", "gal").replace("galon", "gal")
    if s in _DIM_UNIDADES:
        return _DIM_UNIDADES[s]
    primero = re.split(r"[\s/()]+", s)[0]
    if primero in _DIM_UNIDADES:
        return _DIM_UNIDADES[primero]
    if primero in _CONTENEDORES or s in _CONTENEDORES:
        return ("unidad", 1.0)
    return None


_NUM = r"(\d+(?:[.,]\d+)?)"
_RE_MASA = re.compile(_NUM + r"\s*(kg|kgs|kilos?|kilogramos?|gr|grs|g|gramos?|tn|ton|toneladas?)(?![a-z])")
_RE_VOL = re.compile(_NUM + r"\s*(ml|mililitros?|lts?|litros?|l|gal|galon(?:es)?)(?![a-z])")
_RE_AREA = re.compile(_NUM + r"\s*(m2|m²|metros? cuadrados?)(?![a-z])")
_RE_VOL3 = re.compile(_NUM + r"\s*(m3|m³|metros? cubicos?)(?![a-z])")
_RE_LONG = re.compile(_NUM + r"\s*(mts?|metros?|m)(?![a-z0-9²³])")
_RE_DIM2 = re.compile(_NUM + r"\s*(?:mts?|metros?|m)?\s*[x×]\s*" + _NUM + r"\s*(?:mts?|metros?|m)(?![a-z0-9²³])")
_RE_ESPESOR = re.compile(r"(\d+[.,]\d+)\s*mm(?![a-z])")


def _num_es(s: str) -> float | None:
    try:
        s = s.replace(",", ".") if s.count(",") == 1 and len(s.split(",")[-1]) <= 2 else s.replace(",", "")
        v = float(s)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def _presentacion(texto: str) -> dict:
    """Contenido declarado en un texto ("bolsa 5 kg", "rollo 4 m x 100 m", "parante x 3 m",
    "bidón 20 l"), en unidades base por dimensión. `longitud` solo si hay UNA longitud distinta."""
    t = _sin_tildes(texto or "").lower()
    out: dict = {}
    for rx, dim in ((_RE_MASA, "masa"), (_RE_VOL, "volumen"), (_RE_AREA, "area"), (_RE_VOL3, "volumen_solido")):
        for m in rx.finditer(t):
            v = _num_es(m.group(1))
            u = _DIM_UNIDADES.get(m.group(2))
            if v and u and dim not in out:
                out[dim] = v * u[1]
    dims = []
    for m in _RE_DIM2.finditer(t):
        a, b = _num_es(m.group(1)), _num_es(m.group(2))
        if a and b:
            dims.append((a, b))
    if dims and "area" not in out:
        out["area"] = dims[0][0] * dims[0][1]
        out["area_de_dimensiones"] = True
    longs = []
    for m in _RE_LONG.finditer(t):
        v = _num_es(m.group(1))
        if v and v not in longs:
            longs.append(v)
    if longs:
        out["longitudes"] = longs
        if len(longs) == 1:
            out["longitud"] = longs[0]
    return out


def _espesor_mm(texto: str) -> float | None:
    """Espesor/calibre declarado ("0.90 mm", "0,45mm"); solo valores con decimales y ≤ 3 mm."""
    vals = [_num_es(m.group(1)) for m in _RE_ESPESOR.finditer(_sin_tildes(texto or "").lower())]
    vals = [v for v in vals if v and v <= 3.0]
    return min(vals) if vals else None


def _contexto_unidad_item(it: dict) -> dict:
    descr = it.get("descripcion_corta") or it.get("descripcion") or ""
    canon = _unidad_canon(it.get("unidad"), item=True)
    return {
        "unidad": it.get("unidad"),
        "dim": canon[0] if canon else None,
        "factor": canon[1] if canon else 1.0,
        "presentacion": _presentacion(descr),
        "espesor_mm": _espesor_mm(descr),
    }


def _normalizar_precio_observado(precio: float, unidad_obs: str | None, producto_obs: str | None, ctx: dict) -> tuple[float | None, dict]:
    """Lleva un precio observado a la unidad del ítem. Devuelve (precio_normalizado | None si se
    descarta, info). Reglas:
      · misma_unidad / conversion_unidad: el precio viene "por kg", "por litro", "por galón"…
      · precio_por_presentacion: el precio es por envase/rollo/pieza con contenido declarado
        (bolsa 5 kg, rollo 4 m x 100 m, bidón 20 l) → precio / contenido.
      · prorrateo_<dim>: ítem por pieza con medida propia (parante de 4.00 m) vs pieza observada
        de otra medida (3 m) → precio × 4/3; <dim>_por_unidad_de_medida si el precio es por metro/kg.
      · espesor_distinto: calibre declarado en ambos lados y difiere > 20 % → descartado.
      · asumida_misma_unidad: sin presentación detectable → se asume la unidad del ítem (no cuenta
        como precio "normalizado" para el guardarraíl)."""
    info = {"precio_original": round(float(precio), 4), "unidad_observada": (unidad_obs or "")[:60] or None,
            "regla": "asumida_misma_unidad", "factor": 1.0}
    dim, f_item = ctx.get("dim"), ctx.get("factor") or 1.0
    texto = f"{unidad_obs or ''} {producto_obs or ''}"
    esp_i, esp_o = ctx.get("espesor_mm"), _espesor_mm(texto)
    if esp_i and esp_o and abs(esp_o - esp_i) / esp_i > 0.20:
        info.update({"regla": "espesor_distinto", "descartar": True,
                     "detalle": f"espesor observado {esp_o} mm vs exigido {esp_i} mm"})
        return None, info
    canon_obs = _unidad_canon(unidad_obs)
    pres_obs = _presentacion(texto)

    def _ok(factor: float, regla: str, **extra):
        info.update({"regla": regla, "factor": round(factor, 6), **extra})
        return round(float(precio) * factor, 4), info

    if dim in _UNIDADES_MEDIDA:
        if canon_obs and canon_obs[0] == dim:
            factor = f_item / canon_obs[1]
            return _ok(factor, "misma_unidad" if abs(factor - 1.0) < 1e-9 else "conversion_unidad")
        contenido = pres_obs.get(dim)
        if contenido:
            return _ok(f_item / contenido, "precio_por_presentacion", contenido_observado=contenido)
        return float(precio), info
    if dim == "unidad":
        pres_item = ctx.get("presentacion") or {}
        for d in ("longitud", "masa", "volumen", "area", "volumen_solido"):
            ci = pres_item.get(d)
            if not ci:
                continue
            if canon_obs and canon_obs[0] == d:
                return _ok(ci / canon_obs[1], f"{d}_por_unidad_de_medida", contenido_item=ci)
            co = pres_obs.get(d)
            if co:
                if abs(co - ci) / ci < 0.02:
                    return _ok(1.0, "misma_presentacion", contenido_item=ci, contenido_observado=co)
                return _ok(ci / co, f"prorrateo_{d}", contenido_item=ci, contenido_observado=co)
        return float(precio), info
    return float(precio), info


# ── Ancla regional: precios unitarios de la BD propia (CUBSO / unidad / departamento) ──
MARKET_ANCLA_MESES = int(os.getenv("MARKET_ANCLA_MESES", "24"))
MARKET_ANCLA_MIN_REGION = int(os.getenv("MARKET_ANCLA_MIN_REGION", "2"))
MARKET_ANCLA_MIN_PAIS = int(os.getenv("MARKET_ANCLA_MIN_PAIS", "3"))
MARKET_ANCLA_MARGEN = float(os.getenv("MARKET_ANCLA_MARGEN", "0.15"))
MARKET_ANCLA_SOLAPE = float(os.getenv("MARKET_ANCLA_SOLAPE", "0.5"))
MARKET_ANCLA_LIMIT = int(os.getenv("MARKET_ANCLA_LIMIT", "80"))
# Guardarraíl: Δ implausible sin base suficiente → no_verificable (1225450: +7 162 %).
MARKET_DELTA_IMPLAUSIBLE = float(os.getenv("MARKET_DELTA_IMPLAUSIBLE", "300"))
MARKET_COBERTURA_LOTE = float(os.getenv("MARKET_COBERTURA_LOTE", "0.7"))


def _consultar_referencias_internas(ocid: str, cubsos: list[str], descripcion: str, *, meses: int = MARKET_ANCLA_MESES,
                                    limit: int = MARKET_ANCLA_LIMIT) -> list[dict]:
    """Ítems de otras convocatorias de BIENES en la BD propia con el mismo CUBSO o su clase (8
    dígitos) en los últimos `meses`, con precio unitario implícito (totalValue/quantity) del VR
    y, si existe, del award. Ordena: mismo departamento (ubigeo) → mismo CUBSO → similitud."""
    if not ocid or not (cubsos or descripcion):
        return []
    clases = sorted({c[:8] for c in cubsos if len(c) >= 8})
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM pg_extension WHERE extname='pg_trgm'")
        tiene_trgm = cur.fetchone() is not None
        cur.execute("SELECT 1 FROM pg_extension WHERE extname='unaccent'")
        tiene_unaccent = cur.fetchone() is not None
        norm = "unaccent(lower(%s))" if tiene_unaccent else "lower(%s)"
        col_descr = "it->>'description'"
        sim_expr = f"similarity({norm.replace('%s', col_descr)}, {norm})" if tiene_trgm else "0.0"
        sql = f"""
            WITH me AS (SELECT left(ubigeo, 2) AS dpto FROM convocatorias WHERE ocid = %s)
            SELECT c.ocid, c.entidad_ruc, e.nombre, c.objeto, c.fecha_convocatoria, c.region, left(c.ubigeo, 2),
                   c.modalidad, c.etapa,
                   it->>'description', it->>'quantity', it->'unit'->>'name', it->'classification'->>'id',
                   it->'totalValue'->>'amount',
                   (SELECT ai->'totalValue'->>'amount'
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.ocds_payload->'awards') = 'array'
                                                     THEN c.ocds_payload->'awards' ELSE '[]'::jsonb END) a,
                           jsonb_array_elements(CASE WHEN jsonb_typeof(a->'items') = 'array'
                                                     THEN a->'items' ELSE '[]'::jsonb END) ai
                     WHERE ai->>'id' = it->>'id' LIMIT 1),
                   {sim_expr},
                   (left(c.ubigeo, 2) IS NOT NULL AND left(c.ubigeo, 2) = (SELECT dpto FROM me)),
                   (it->'classification'->>'id' = ANY(%s))
              FROM convocatorias c
              LEFT JOIN entidades e ON e.ruc = c.entidad_ruc,
                   jsonb_array_elements(CASE WHEN jsonb_typeof(c.ocds_payload->'tender'->'items') = 'array'
                                             THEN c.ocds_payload->'tender'->'items' ELSE '[]'::jsonb END) it
             WHERE c.ocid <> %s
               AND (c.categoria = 'goods' OR c.tipo_contratacion = 'bienes')
               AND COALESCE(c.etapa, '') NOT IN ('nula', 'cancelada')
               AND c.fecha_convocatoria >= (CURRENT_DATE - make_interval(months => %s))
               AND (it->'classification'->>'id' = ANY(%s) OR left(it->'classification'->>'id', 8) = ANY(%s))
               AND (it->>'quantity') ~ '^[0-9]+([.][0-9]+)?$' AND (it->>'quantity')::numeric > 0
               AND (it->'totalValue'->>'amount') ~ '^[0-9]+([.][0-9]+)?$'
               AND (it->'totalValue'->>'amount')::numeric > 0
             ORDER BY 16 DESC, 17 DESC, 15 DESC
             LIMIT %s"""
        params = [ocid] + ([descripcion] if tiene_trgm else []) + [cubsos or [""], ocid, meses, cubsos or [""],
                                                                     clases or [""], limit]
        cur.execute(sql, params)
        out, vistos = [], set()
        for r in cur.fetchall():
            (r_ocid, ent_ruc, ent_nombre, objeto, fecha, region, dpto, modalidad, etapa, descr, qty, unidad,
             cubso, total_ref, total_adj, sim, misma_region, mismo_cubso) = r
            k = (r_ocid, (descr or "")[:80])
            if k in vistos:
                continue
            vistos.add(k)
            try:
                qty_f, ref_f = float(qty), float(total_ref)
            except (TypeError, ValueError):
                continue
            adj_f = None
            try:
                adj_f = float(total_adj) if total_adj else None
            except (TypeError, ValueError):
                adj_f = None
            out.append({
                "ocid": r_ocid, "entidad_ruc": ent_ruc, "entidad": ent_nombre, "objeto": (objeto or "")[:200],
                "descripcion": (descr or "")[:200], "cantidad": qty_f, "unidad": unidad, "cubso": cubso,
                "fecha_convocatoria": fecha.isoformat() if fecha else None, "region": region, "departamento_ubigeo": dpto,
                "modalidad": modalidad, "etapa": etapa,
                "precio_unitario_referencial": round(ref_f / qty_f, 4),
                "precio_unitario_adjudicado": round(adj_f / qty_f, 4) if adj_f else None,
                "sim": round(float(sim or 0), 3), "misma_region": bool(misma_region), "mismo_cubso": bool(mismo_cubso),
                "url": OECE_PROCESO_URL.format(ocid=r_ocid),
            })
        return out
    finally:
        conn.close()


def _ancla_regional_item(it: dict, refs: list[dict], base_val, ctx: dict) -> tuple[dict, list[dict]]:
    """Filtra las referencias internas al mismo bien (CUBSO exacto o solape de raíces ≥ umbral) y
    misma dimensión de unidad (convirtiendo factor), y decide el ámbito: departamento (≥ 2) →
    país (≥ 3) → insuficiente. Devuelve (ancla, referencias_usables)."""
    descr = it.get("descripcion_corta") or it.get("descripcion") or ""
    dim, f_item = ctx.get("dim"), ctx.get("factor") or 1.0
    usables = []
    for r in refs:
        cu = _unidad_canon(r.get("unidad"), item=True)
        if dim in _UNIDADES_MEDIDA:
            if not cu or cu[0] != dim:
                continue
            conv = f_item / cu[1]
        else:
            if cu and cu[0] in _UNIDADES_MEDIDA:
                continue
            conv = 1.0
        solape = _solape_raices(descr, r.get("descripcion") or "")
        if not (r.get("mismo_cubso") or solape >= MARKET_ANCLA_SOLAPE):
            continue
        pu = r.get("precio_unitario_adjudicado") or r.get("precio_unitario_referencial")
        if not pu:
            continue
        usables.append({**r, "solape_raices": round(solape, 2),
                        "precio_unitario": round(pu * conv, 4),
                        "precio_base": "adjudicado" if r.get("precio_unitario_adjudicado") else "referencial"})
    # Outliers de la BD (cantidad = 1 para un lote, unidad mal registrada): fuera de [med/5, med×5].
    keep, drop = _filtrar_outliers([r["precio_unitario"] for r in usables])
    n_outliers = len(drop)
    usables = [r for r in usables if r["precio_unitario"] in keep] if drop else usables
    region = [r for r in usables if r.get("misma_region")]
    if len(region) >= MARKET_ANCLA_MIN_REGION:
        grupo, ambito = region, "departamento"
    elif len(usables) >= MARKET_ANCLA_MIN_PAIS:
        grupo, ambito = usables, "nacional"
    else:
        return ({"estado": "insuficiente", "ambito": None, "n": len(usables), "n_region": len(region),
                 "n_outliers": n_outliers, "motivo": "menos_referencias_internas_que_el_minimo"}, usables)
    vals = [r["precio_unitario"] for r in grupo]
    p_min, p_max, med = min(vals), max(vals), _mediana(vals)
    lo, hi = p_min * (1 - MARKET_ANCLA_MARGEN), p_max * (1 + MARKET_ANCLA_MARGEN)
    diff = _diff_pct(base_val, med)
    if base_val is None:
        pos = "sin_base"
    elif lo <= float(base_val) <= hi:
        pos = "dentro_rango"
    elif float(base_val) > hi:
        pos = "sobre_rango"
    else:
        pos = "bajo_rango"
    return ({"estado": "hallado", "ambito": ambito, "n": len(grupo), "n_region": len(region), "n_outliers": n_outliers,
             "rango_min": round(p_min, 2), "rango_max": round(p_max, 2), "mediana": round(med, 2),
             "margen": MARKET_ANCLA_MARGEN, "posicion": pos, "diff_vs_mediana_pct": diff,
             "veredicto_regional": ("alineado_regional" if pos == "dentro_rango" else _veredicto(diff) if diff is not None else "sin_dato"),
             "ocids": [r["ocid"] for r in grupo][:12]}, usables)


# ── goods_retail: worker Gemini + google_search con atribución por grounding ──
# El modelo responde en PROSA de una línea por precio (no JSON): con salida JSON /
# response_schema Gemini NO adjunta `grounding_chunks` (verificado 2026-09-15 con
# gemini-3.6-flash y 2.5-flash en Vertex global: chunks=0). Con prosa, cada línea es un
# `grounding_support` con sus `grounding_chunk_indices` → URL real por precio.
_LINEA_PRECIO_RE = re.compile(
    r"^\W*(?:í|i)tem\s*(?P<num>[\w.\-/]+)\s*:\s*el producto\s*[\"“«']?(?P<producto>.+?)[\"”»']?\s*"
    r"se ofrece a\s*(?P<moneda>S/\.?|PEN|USD|US\$|\$)\s*(?P<precio>\d[\d.,]*)"
    r"(?:\s*por\s+(?P<unidad>.+?))?(?:\s+en\s+(?P<tienda>.+?))?[.\s]*$",
    re.IGNORECASE,
)
_LINEA_SIN_RE = re.compile(r"^\W*(?:í|i)tem\s*(?P<num>[\w.\-/]+)\s*:\s*sin precios observados", re.IGNORECASE)
_LINEA_COMENT_RE = re.compile(r"^\W*comentario\s+(?:í|i)tem\s*(?P<num>[\w.\-/]+)\s*:\s*(?P<texto>.+)$", re.IGNORECASE)

_MARKET_WORKER_INSTRUCCIONES = """
Busca en marketplaces y tiendas del Perú (y solo si no hay oferta peruana, en catálogos
internacionales) el precio de venta de cada ítem, usando marca/modelo/especificaciones
LITERALES del requerimiento. Prioriza productos que cumplan las características exigidas;
si el producto hallado difiere (otra medida, otro modelo), dilo en el comentario.

FORMATO DE RESPUESTA (obligatorio): prosa en líneas independientes, UNA oración por precio,
sin tablas, sin JSON, sin viñetas, sin negritas:
Ítem <numero>: el producto "<título del producto tal como aparece en la página>" se ofrece a S/ <precio> por <unidad> en <nombre de la tienda>.

Reglas:
· Solo precios que viste en los resultados de búsqueda; nada de memoria ni estimaciones.
· Hasta 8 líneas por ítem. Si encontraste menos de 3, reporta las que haya (no completes).
· Precio unitario en soles. Si la página muestra dólares, escribe "USD <precio>" en vez de "S/".
· En "por <unidad>" escribe la PRESENTACIÓN real del precio, con contenido o medida: "por kg",
  "por bolsa de 5 kg", "por saco de 50 kg", "por galón", "por bidón de 20 l", "por m2",
  "por rollo de 4 m x 100 m", "por pieza de 3 m", "por unidad". Si el título no trae el contenido
  neto o las dimensiones (largo, espesor), agrégalos al título tal como los muestra la página.
· Usa el `numero` del ítem tal cual (incluye sub-ítems como 2.1).
· Si no encontraste precios para un ítem escribe exactamente: Ítem <numero>: sin precios observados.
· Cierra cada ítem con una línea: Comentario ítem <numero>: <1-2 oraciones factuales sobre la
  comparabilidad de lo hallado con el requerimiento (medida, modelo, presentación, mayorista/retail)>.
· No escribas URLs: las fuentes se toman de los resultados de búsqueda automáticamente.
"""


def _spans_grounding(text: str, gm) -> list[tuple[int, int, list[int]]]:
    """[(start_char, end_char, [chunk_idx…])] a partir de `grounding_supports` (offsets en
    BYTES UTF-8 según la API) convertidos a offsets de caracteres."""
    spans = []
    if not gm or not getattr(gm, "grounding_supports", None):
        return spans
    b = text.encode("utf-8")
    for s in gm.grounding_supports:
        seg = getattr(s, "segment", None)
        if seg is None:
            continue
        sb = seg.start_index or 0
        eb = seg.end_index if seg.end_index is not None else len(b)
        try:
            sc = len(b[:sb].decode("utf-8", errors="ignore"))
            ec = len(b[:eb].decode("utf-8", errors="ignore"))
        except Exception:
            continue
        idx = [int(i) for i in (s.grounding_chunk_indices or [])]
        # Respaldo: si los offsets no calzan, buscar el texto del segmento.
        if seg.text and text[sc:ec].strip() != seg.text.strip():
            pos = text.find(seg.text.strip())
            if pos >= 0:
                sc, ec = pos, pos + len(seg.text.strip())
        spans.append((sc, ec, idx))
    return spans


def _chunks_grounding(gm) -> list[dict]:
    out = []
    for c in (getattr(gm, "grounding_chunks", None) or []):
        w = getattr(c, "web", None)
        if w is None or not getattr(w, "uri", None):
            out.append({"uri": None, "titulo": None, "dominio": None})
            continue
        out.append({"uri": w.uri, "titulo": getattr(w, "title", None), "dominio": getattr(w, "domain", None)})
    return out


def _parsear_worker(text: str, gm, items_chunk: list) -> dict:
    """Parsea la prosa del worker línea a línea y le asigna a cada precio las URLs de los
    chunks de grounding cuyo soporte cubre esa línea. Sin soporte → descarte."""
    chunks = _chunks_grounding(gm)
    spans = _spans_grounding(text, gm)
    nums_validos = {_norm_num(it.get("numero")) for it in items_chunk}
    precios, comentarios, sin_precios, descartes = [], {}, set(), []
    pos = 0
    for raw in text.splitlines():
        start = text.find(raw, pos)
        if start < 0:
            start = pos
        end = start + len(raw)
        pos = end
        linea = raw.strip()
        if not linea:
            continue
        m = _LINEA_COMENT_RE.match(linea)
        if m:
            comentarios[_norm_num(m.group("num"))] = m.group("texto").strip()[:800]
            continue
        m = _LINEA_SIN_RE.match(linea)
        if m:
            sin_precios.add(_norm_num(m.group("num")))
            continue
        m = _LINEA_PRECIO_RE.match(linea)
        if not m:
            if len(linea) > 20:
                descartes.append({"motivo": "linea_no_parseable", "detalle": linea[:160]})
            continue
        num = _norm_num(m.group("num"))
        if num not in nums_validos:
            descartes.append({"motivo": "item_no_solicitado", "detalle": linea[:160]})
            continue
        precio = _market_to_num(m.group("precio"))
        if precio is None:
            descartes.append({"motivo": "precio_no_numerico", "detalle": linea[:160]})
            continue
        moneda = "USD" if m.group("moneda").upper().replace(".", "") in ("USD", "US$", "$") else "PEN"
        idxs: list[int] = []
        for sc, ec, idx in spans:
            if sc < end and ec > start:   # solape del soporte con la línea
                idxs.extend(i for i in idx if i not in idxs)
        fuentes = [chunks[i] for i in idxs if 0 <= i < len(chunks) and chunks[i].get("uri")]
        if not fuentes:
            descartes.append({"motivo": "precio_sin_grounding", "detalle": linea[:160]})
            continue
        precios.append({
            "item_numero": num,
            "producto": m.group("producto").strip()[:300],
            "precio": precio,
            "moneda_origen": moneda,
            "unidad": (m.group("unidad") or "Unidad").strip()[:60],
            "proveedor": (m.group("tienda") or fuentes[0].get("dominio") or "").strip()[:200] or None,
            "fuentes": fuentes,
        })
    return {"precios": precios, "comentarios": comentarios, "sin_precios": sin_precios,
            "descartes": descartes, "chunks": [c for c in chunks if c.get("uri")],
            "n_soportes": len(spans)}


def _worker_goods_retail(items_chunk: list, objeto: str, idx: int, contexto: str = "") -> dict:
    """Worker: precia ~3 ítems con UNA llamada Gemini + google_search (grounding)."""
    from google.genai import types
    items_min = []
    for it in items_chunk:
        items_min.append({
            "numero": it.get("numero"),
            "descripcion_corta": (it.get("descripcion_corta") or "")[:300],
            "cantidad": it.get("cantidad"), "unidad": it.get("unidad"),
            "marca_o_modelo_exigido": it.get("marca_o_modelo_exigido"),
            "certificaciones_exigidas": (it.get("certificaciones_exigidas") or [])[:6],
            "requerimiento_tecnico_detallado": (str(it.get("requerimiento_tecnico_detallado") or ""))[:1500] or None,
        })
    prompt = (
        "Eres un analista de precios de mercado peruano. Tu herramienta es Google Search "
        "(grounding en vivo).\n\n"
        f"OBJETO DEL CONTRATO: {objeto[:300]}\n"
        "Cada ítem de abajo pertenece a ese objeto: no busques productos de otro rubro.\n"
        f"{(contexto or '')[:400]}\n\n"
        f"ÍTEMS A PRECIAR ({len(items_chunk)}):\n{json.dumps(items_min, ensure_ascii=False)}\n"
        f"{_MARKET_WORKER_INSTRUCCIONES}"
    )
    client = _gemini_client()
    cfg = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())],
        temperature=0.2,
        max_output_tokens=8192,
    )

    # Sin _throttle_gemini(): el semáforo global (2) serializaría los workers. La
    # concurrencia la acota el ThreadPool; los 429 los maneja el retry exponencial.
    def _call():
        return client.models.generate_content(model=MARKET_WORKER_MODEL, contents=prompt, config=cfg)

    resp = _gemini_call_with_retry(_call)
    text = getattr(resp, "text", "") or ""
    gm = None
    try:
        gm = resp.candidates[0].grounding_metadata
    except Exception:
        gm = None
    out = _parsear_worker(text, gm, items_chunk)
    out["idx"] = idx
    out["queries"] = list(getattr(gm, "web_search_queries", None) or []) if gm else []
    out["raw_len"] = len(text)
    try:
        um = resp.usage_metadata
        out["tokens"] = {"prompt": um.prompt_token_count, "salida": um.candidates_token_count,
                         "pensamiento": getattr(um, "thoughts_token_count", None)}
    except Exception:
        pass
    return out


def _fanout_goods_retail(items: list, objeto: str, state: dict, contexto: str = "") -> tuple[list, dict, set, list, int]:
    """Lanza los workers. Devuelve (precios, comentarios, sin_precios, chunks, n_chunks)."""
    lotes = [items[i:i + MARKET_CHUNK_SIZE] for i in range(0, len(items), MARKET_CHUNK_SIZE)]
    precios, comentarios, sin_precios, chunks = [], {}, set(), []
    errores = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=MARKET_MAX_WORKERS) as ex:
        futs = [ex.submit(_worker_goods_retail, ch, objeto, i, contexto) for i, ch in enumerate(lotes)]
        try:
            for fut in concurrent.futures.as_completed(futs, timeout=MARKET_TIMEOUT_S):
                try:
                    r = fut.result()
                except Exception as e:
                    errores += 1
                    _registrar_descarte(state, "market.goods_retail.worker", "error_worker", str(e)[:200])
                    continue
                precios.extend(r.get("precios") or [])
                comentarios.update(r.get("comentarios") or {})
                sin_precios |= set(r.get("sin_precios") or ())
                chunks.extend(r.get("chunks") or [])
                for d in r.get("descartes") or []:
                    _registrar_descarte(state, "market.goods_retail.linea", d["motivo"], d["detalle"])
                state.setdefault("market_queries", []).extend(r.get("queries") or [])
        except concurrent.futures.TimeoutError:
            pend = sum(1 for f in futs if not f.done())
            _registrar_recorte(state, "market.goods_retail.fanout_timeout", MARKET_TIMEOUT_S, pend)
            for f in futs:
                f.cancel()
    if errores:
        _registrar_recorte(state, "market.goods_retail.workers_con_error", len(lotes), errores)
    return precios, comentarios, sin_precios, chunks, len(lotes)


# ── Estimación IA (sin grounding) para el resto del lote cuando hay demasiados ítems ──
# No es una búsqueda: el modelo da una cifra desde su conocimiento previo. Se usa SOLO para
# los ítems de menor valor cuando el requerimiento tiene más de MARKET_ESTIMACION_DESDE ítems
# (priciar los 90 con google_search sería lento y caro). Las cifras quedan en campos
# `*_estimacion_ia` que NINGÚN consumidor existente lee — no pueden alimentar sobreprecio_pct,
# veredicto_global, cobertura_mercado ni banderas (`persist_market_flags_as_banderas` solo
# dispara con veredicto_item en {elevado, muy_elevado}, que estos findings nunca tienen).
_LINEA_ESTIMADO_RE = re.compile(
    r"^\W*(?:í|i)tem\s*(?P<num>[\w.\-/]+)\s*:\s*estimado\s*(?P<moneda>S/\.?|PEN|USD|US\$|\$)\s*(?P<precio>\d[\d.,]*)"
    r"\s*por\s+(?P<unidad>.+?)\s*·\s*confianza\s*(?P<confianza>alta|media|baja)\s*·\s*(?P<justif>.+?)[.\s]*$",
    re.IGNORECASE,
)
_LINEA_ESTIMADO_SIN_RE = re.compile(r"^\W*(?:í|i)tem\s*(?P<num>[\w.\-/]+)\s*:\s*sin estimaci(?:ó|o)n confiable", re.IGNORECASE)

_ESTIMACION_INSTRUCCIONES = """
NO tienes búsqueda web en esta tarea: usa tu conocimiento GENERAL y PREVIO de precios de
mercado en Perú para dar una ESTIMACIÓN aproximada de cada ítem — no una cifra verificada.

FORMATO DE RESPUESTA (obligatorio): prosa en líneas independientes, sin tablas, sin JSON:
Ítem <numero>: ESTIMADO S/ <precio unitario> por <unidad/presentación> · confianza <alta|media|baja> · <por qué, 1 frase>

Reglas:
· Es una ESTIMACIÓN desde tu conocimiento previo, NO una búsqueda en vivo: sé honesto en la
  confianza (usa "baja" si el precio depende mucho de marca/modelo/región que no conoces con certeza).
· Si el ítem es demasiado específico/técnico para estimar con algún fundamento, escribe
  exactamente: Ítem <numero>: sin estimación confiable.
· Nunca inventes una tienda, URL o cifra "de una fuente": esto no es una búsqueda, es tu estimación.
· Precio unitario en soles. Si prefieres razonar en dólares, escribe "USD <precio>" en vez de "S/".
· Usa el `numero` del ítem tal cual (incluye sub-ítems como 2.1).
"""


def _parsear_worker_estimacion(text: str, items_chunk: list) -> dict:
    nums_validos = {_norm_num(it.get("numero")) for it in items_chunk}
    estimaciones: dict[str, dict] = {}
    sin_estimacion: set[str] = set()
    descartes: list[dict] = []
    for raw in text.splitlines():
        linea = raw.strip()
        if not linea:
            continue
        m = _LINEA_ESTIMADO_SIN_RE.match(linea)
        if m:
            sin_estimacion.add(_norm_num(m.group("num")))
            continue
        m = _LINEA_ESTIMADO_RE.match(linea)
        if not m:
            if len(linea) > 20:
                descartes.append({"motivo": "linea_no_parseable_estimacion", "detalle": linea[:160]})
            continue
        num = _norm_num(m.group("num"))
        if num not in nums_validos:
            descartes.append({"motivo": "item_no_solicitado", "detalle": linea[:160]})
            continue
        precio = _market_to_num(m.group("precio"))
        if precio is None:
            continue
        moneda = "USD" if m.group("moneda").upper().replace(".", "") in ("USD", "US$", "$") else "PEN"
        valor = precio * MARKET_USD_PEN if moneda == "USD" else precio
        estimaciones[num] = {
            "precio_estimado": round(valor, 2),
            "unidad": (m.group("unidad") or "Unidad").strip()[:60],
            "confianza": m.group("confianza").lower(),
            "justificacion": m.group("justif").strip()[:300],
        }
    return {"estimaciones": estimaciones, "sin_estimacion": sin_estimacion, "descartes": descartes}


def _worker_estimacion_llm(items_chunk: list, objeto: str, idx: int, contexto: str = "") -> dict:
    """Worker: ESTIMA ~10 ítems con una llamada Gemini SIN google_search — usa el conocimiento
    previo del modelo. Para el resto del lote cuando hay demasiados ítems para priciar todos
    con búsqueda real (ver `_worker_goods_retail`, que sí busca)."""
    from google.genai import types
    items_min = []
    for it in items_chunk:
        items_min.append({
            "numero": it.get("numero"),
            "descripcion_corta": (it.get("descripcion_corta") or "")[:300],
            "cantidad": it.get("cantidad"), "unidad": it.get("unidad"),
            "marca_o_modelo_exigido": it.get("marca_o_modelo_exigido"),
        })
    prompt = (
        "Eres un analista de precios de mercado peruano.\n\n"
        f"OBJETO DEL CONTRATO: {objeto[:300]}\n"
        "Cada ítem de abajo pertenece a ese objeto: no estimes productos de otro rubro.\n"
        f"{(contexto or '')[:400]}\n\n"
        f"ÍTEMS A ESTIMAR ({len(items_chunk)}):\n{json.dumps(items_min, ensure_ascii=False)}\n"
        f"{_ESTIMACION_INSTRUCCIONES}"
    )
    client = _gemini_client()
    cfg = types.GenerateContentConfig(temperature=0.3, max_output_tokens=4096)

    def _call():
        return client.models.generate_content(model=MARKET_WORKER_MODEL, contents=prompt, config=cfg)

    resp = _gemini_call_with_retry(_call)
    text = getattr(resp, "text", "") or ""
    out = _parsear_worker_estimacion(text, items_chunk)
    out["idx"] = idx
    try:
        um = resp.usage_metadata
        out["tokens"] = {"prompt": um.prompt_token_count, "salida": um.candidates_token_count}
    except Exception:
        pass
    return out


def _fanout_estimacion_llm(items: list, objeto: str, state: dict, contexto: str = "") -> tuple[dict, set, int]:
    """Como `_fanout_goods_retail` pero SIN búsqueda. Devuelve (estimaciones_por_numero,
    sin_estimacion, n_chunks)."""
    if not items:
        return {}, set(), 0
    lotes = [items[i:i + MARKET_CHUNK_SIZE_ESTIMACION] for i in range(0, len(items), MARKET_CHUNK_SIZE_ESTIMACION)]
    estimaciones: dict[str, dict] = {}
    sin_estimacion: set[str] = set()
    errores = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=MARKET_MAX_WORKERS) as ex:
        futs = [ex.submit(_worker_estimacion_llm, ch, objeto, i, contexto) for i, ch in enumerate(lotes)]
        try:
            for fut in concurrent.futures.as_completed(futs, timeout=MARKET_TIMEOUT_S):
                try:
                    r = fut.result()
                except Exception as e:
                    errores += 1
                    _registrar_descarte(state, "market.estimacion_llm.worker", "error_worker", str(e)[:200])
                    continue
                estimaciones.update(r.get("estimaciones") or {})
                sin_estimacion |= set(r.get("sin_estimacion") or ())
                for d in r.get("descartes") or []:
                    _registrar_descarte(state, "market.estimacion_llm.linea", d["motivo"], d["detalle"])
        except concurrent.futures.TimeoutError:
            pend = sum(1 for f in futs if not f.done())
            _registrar_recorte(state, "market.estimacion_llm.fanout_timeout", MARKET_TIMEOUT_S, pend)
            for f in futs:
                f.cancel()
    if errores:
        _registrar_recorte(state, "market.estimacion_llm.workers_con_error", len(lotes), errores)
    return estimaciones, sin_estimacion, len(lotes)


def _contexto_entrega(ocds: dict, state: dict) -> str:
    """Región/lugar de entrega para el worker (1225030: comparables de Lima para piedra puesta
    en obra en Cusco). Se toma del buyer del OCDS y de `condiciones_entrega` del parser."""
    region, localidad = None, None
    for p in (ocds.get("parties") or []):
        if isinstance(p, dict) and ("buyer" in (p.get("roles") or []) or "procuringEntity" in (p.get("roles") or [])):
            addr = p.get("address") or {}
            region, localidad = addr.get("region"), addr.get("locality")
            break
    raw = state.get("parser_raw_consolidated") or {}
    lugar = None
    for src in (raw, _safe_parse_json(state.get("document_analysis")) or {}):
        ce = src.get("condiciones_entrega") if isinstance(src, dict) else None
        if isinstance(ce, dict) and ce.get("lugar_entrega"):
            lugar = str(ce["lugar_entrega"])[:160]
            break
    partes = []
    if region or localidad:
        partes.append(f"REGIÓN DE LA ENTIDAD: {', '.join(x for x in (localidad, region) if x)}")
    if lugar:
        partes.append(f"LUGAR DE ENTREGA: {lugar}")
    if partes:
        partes.append("Prioriza precios de esa región (o nacionales) e indica si el precio incluye transporte/puesto en obra.")
    return " · ".join(partes)


def _valor_item(it: dict, f: dict | None = None) -> float | None:
    """Valor del ítem para la cobertura por VALOR: ofertado × cantidad > referencial × cantidad >
    cuantía referencial del ítem > mediana de mercado × cantidad (si se preció)."""
    cant = it.get("cantidad")
    if not isinstance(cant, (int, float)) or cant <= 0:
        return _market_to_num(it.get("cuantia_referencial_item"))
    for k in ("precio_unitario_ofertado", "precio_unitario_referencial"):
        v = _market_to_num(it.get(k))
        if v:
            return v * float(cant)
    v = _market_to_num(it.get("cuantia_referencial_item"))
    if v:
        return v
    if f and isinstance(f.get("precio_mediana_mercado"), (int, float)):
        return float(f["precio_mediana_mercado"]) * float(cant)
    return None


def _mercado_goods_retail(state: dict) -> dict:
    mi = state.get("market_input")
    if not (isinstance(mi, dict) and mi.get("items")):
        mi = read_market_input(tool_context=_StateCtx(state))
    items = [it for it in ((mi or {}).get("items") or []) if isinstance(it, dict)]
    if not items:
        return {"estado": "sin_dato", "motivo": "sin_items_para_preciar", "findings": [],
                "observaciones_clave": ["Sin ítems con cantidad/unidad para comparar contra mercado."]}

    ocds = state.get("ocds") or {}
    tender = ocds.get("tender") or {}
    objeto = tender.get("description") or tender.get("title") or ""
    ocid = _short_ocid(ocds.get("ocid") or state.get("ocid") or mi.get("ocid") or "")
    padre_lote = mi.get("padre_lote") if isinstance(mi.get("padre_lote"), dict) else None
    cubsos_record = _cubsos_del_record(ocds)

    contexto = _contexto_entrega(ocds, state)

    # Demasiados ítems para priciar TODOS con búsqueda real: se prioriza el fan-out grounded
    # a los MARKET_ESTIMACION_DESDE ítems de mayor valor (los que más pesan en el total); el
    # resto se ESTIMA con el conocimiento previo del modelo (ver `_fanout_estimacion_llm`).
    items_grounded, items_estimar = items, []
    if len(items) > MARKET_ESTIMACION_DESDE:
        ordenados = sorted(items, key=lambda it: _valor_item(it) or 0, reverse=True)
        items_grounded = ordenados[:MARKET_ESTIMACION_DESDE]
        items_estimar = ordenados[MARKET_ESTIMACION_DESDE:]
        _registrar_recorte(state, "market.goods_retail.estimacion_por_volumen", MARKET_ESTIMACION_DESDE, len(items_estimar))

    precios, comentarios, sin_precios, chunks, n_chunks = _fanout_goods_retail(items_grounded, objeto, state, contexto)

    # 2º pase: ítems sin ningún precio con grounding (solo entre los enviados a búsqueda real).
    n_retry = 0
    if MARKET_RETRY:
        con_precio = {p["item_numero"] for p in precios}
        faltan = [it for it in items_grounded if _norm_num(it.get("numero")) not in con_precio]
        if faltan:
            p2, c2, s2, ch2, n2 = _fanout_goods_retail(faltan, objeto, state, contexto)
            n_retry = len({p["item_numero"] for p in p2})
            precios += p2
            for k, v in c2.items():
                comentarios.setdefault(k, v)
            sin_precios |= s2
            chunks += ch2
            n_chunks += n2

    _publicar_grounding(state, chunks)

    # Ítems de menor valor fuera del presupuesto de búsqueda: estimación IA (sin grounding),
    # nunca cuenta como respaldo (ver nota en la rama `elif estimacion:` más abajo).
    estimaciones_llm: dict[str, dict] = {}
    if items_estimar:
        estimaciones_llm, _sin_estimacion_llm, _n_chunks_estimacion = _fanout_estimacion_llm(
            items_estimar, objeto, state, contexto)

    findings: list[dict] = []
    por_item: dict[str, list[dict]] = {}
    for p in precios:
        por_item.setdefault(p["item_numero"], []).append(p)

    # Ancla regional (BD propia) por ítem: una consulta por CUBSO/descripción; falla → sin ancla.
    cache_refs: dict[tuple, list[dict]] = {}

    def _refs_para(it: dict) -> list[dict]:
        cubsos = [c for c in ([it.get("cubso")] + cubsos_record) if c]
        descr = it.get("descripcion_corta") or ""
        key = (tuple(sorted(set(cubsos))), descr[:80])
        if key in cache_refs:
            return cache_refs[key]
        try:
            refs = _consultar_referencias_internas(ocid, sorted(set(cubsos)), descr) if ocid else []
        except Exception as e:
            _registrar_descarte(state, "market.goods_retail.ancla_regional", "error_bd", f"{type(e).__name__}: {str(e)[:160]}")
            refs = []
        cache_refs[key] = refs
        return refs

    for it in items:
        num = _norm_num(it.get("numero"))
        ctx = _contexto_unidad_item(it)
        base_val, base = None, None
        if _market_to_num(it.get("precio_unitario_ofertado")):
            base_val, base = float(it["precio_unitario_ofertado"]), "ofertado"
        elif _market_to_num(it.get("precio_unitario_referencial")):
            base_val, base = float(it["precio_unitario_referencial"]), "referencial"
        ancla, refs_usables = _ancla_regional_item(it, _refs_para(it), base_val, ctx)
        if refs_usables:
            _publicar_grounding(state, [{"uri": r["url"], "titulo": f"SEACE {r['ocid']}",
                                         "dominio": "contratacionesabiertas.oece.gob.pe", "origen": "bd_convocatorias"}
                                        for r in refs_usables])
        refs_pub = [{k: r.get(k) for k in ("ocid", "entidad", "entidad_ruc", "descripcion", "cantidad", "unidad", "cubso",
                                            "fecha_convocatoria", "region", "etapa", "precio_unitario_referencial",
                                            "precio_unitario_adjudicado", "precio_unitario", "precio_base", "misma_region",
                                            "mismo_cubso", "solape_raices", "url")} for r in refs_usables][:12]
        oferta_vs_ref = _diff_pct(it.get("precio_unitario_ofertado"), it.get("precio_unitario_referencial"))
        nota_base = ("La oferta coincide con el valor referencial (±3 %): la señal apunta al estudio de mercado "
                     "de la entidad, no a la oferta." if isinstance(oferta_vs_ref, (int, float)) and abs(oferta_vs_ref) <= 3 else None)

        obs = por_item.get(num) or []
        if not obs:
            estimacion = estimaciones_llm.get(num)
            motivo = "sin_precios_en_mercado" if num in sin_precios else "sin_precio_con_fuente_verificable"
            f = _finding_vacio(it, motivo, comentarios.get(num) or "Sin precios observados con fuente verificable en esta corrida.")
            f.update({"referencias_internas": refs_pub, "ancla_regional": ancla, "unidad_normalizacion": ctx.get("dim"),
                      "oferta_vs_referencial_pct": oferta_vs_ref, "nota_base": nota_base})
            # Sin retail pero con ancla regional decisiva → veredicto por la BD propia.
            if ancla.get("estado") == "hallado" and base_val is not None:
                # La tabla del dictamen muestra `precio_mediana_mercado`: sin retail, la mediana visible
                # es la regional (marcada con `fuente_mediana`) para que veredicto y tabla no se contradigan.
                f.update({"precio_mediana_regional": ancla.get("mediana"), "veredicto": ancla["veredicto_regional"],
                          "precio_mediana_mercado": ancla.get("mediana"), "fuente_mediana": "ancla_regional",
                          "rango_min": ancla.get("rango_min"), "rango_max": ancla.get("rango_max"),
                          "n_referencias_internas": ancla.get("n"),
                          "veredicto_retail": "sin_dato", "diff_pct": ancla.get("diff_vs_mediana_pct"),
                          "diff_base": base, "diff_fuente": "ancla_regional", "estado": "hallado",
                          "es_estimacion": False, "motivo_estimacion": None,
                          "precio_mediana_comparacion": ancla.get("mediana"),
                          "evidencia": [{"url": r["url"], "cita": f"{r['descripcion'][:150]} · S/ {r['precio_unitario']:.2f}/{it.get('unidad') or 'u'} ({r['precio_base']})"[:240]}
                                        for r in refs_usables][:20],
                          "comentario": (f"Sin precios retail con fuente; {ancla['n']} referencia(s) interna(s) "
                                         f"({ancla['ambito']}) en la BD SEACE propia: rango S/ {ancla['rango_min']:,.2f}-{ancla['rango_max']:,.2f} "
                                         f"por {it.get('unidad') or 'unidad'}; el precio {base} queda {ancla['posicion'].replace('_', ' ')}.")})
            # Ítem fuera del presupuesto de búsqueda (lote grande): estimación IA desde
            # conocimiento previo, SIN grounding. Va en campos `*_estimacion_ia` propios —
            # nunca toca precio_mediana_mercado/diff_pct/veredicto, así que jamás puede
            # alimentar sobreprecio_pct, cobertura_mercado ni una bandera de sobreprecio
            # (persist_market_flags_as_banderas solo dispara con veredicto en
            # {elevado, muy_elevado}, que este finding no tiene).
            elif estimacion:
                diff_est = _diff_pct(base_val, estimacion["precio_estimado"]) if base_val is not None else None
                f.update({"estado": "estimado_ia", "motivo_estimacion": "estimado_por_ia_sin_busqueda",
                          "precio_estimado_ia": estimacion["precio_estimado"],
                          "unidad_estimacion_ia": estimacion["unidad"],
                          "confianza_estimacion_ia": estimacion["confianza"],
                          "diff_pct_estimacion_ia": diff_est,
                          "comentario": (f"Sin precio verificado con fuente (fuera del presupuesto de búsqueda de este "
                                         f"lote). El modelo ESTIMÓ S/ {estimacion['precio_estimado']:.2f} por "
                                         f"{estimacion['unidad']} desde su conocimiento previo — confianza "
                                         f"{estimacion['confianza']}, NO es una búsqueda en vivo ni evidencia "
                                         f"verificada: {estimacion['justificacion']}")})
            findings.append(f)
            continue

        precios_obs, descartados = [], []
        for p in obs:
            valor = p["precio"] * MARKET_USD_PEN if p["moneda_origen"] == "USD" else p["precio"]
            f0 = p["fuentes"][0]
            norm, info = _normalizar_precio_observado(valor, p.get("unidad"), p.get("producto"), ctx)
            fila = {
                "producto": p["producto"], "precio": round(norm, 2) if norm is not None else None,
                "precio_publicado": round(valor, 2), "unidad": p["unidad"],
                "unidad_item": it.get("unidad"), "normalizacion": info,
                "url": f0["uri"], "fecha": None, "proveedor": p["proveedor"],
                "moneda_origen": p["moneda_origen"],
                "tipo_cambio_aplicado": MARKET_USD_PEN if p["moneda_origen"] == "USD" else None,
                "titulo_fuente": f0.get("titulo"), "dominio": f0.get("dominio"),
                "urls_adicionales": [x["uri"] for x in p["fuentes"][1:]],
                # compat frontend (columna `valor`)
                "valor": round(norm, 2) if norm is not None else None,
            }
            if norm is None:
                descartados.append(fila)
                _registrar_descarte(state, f"market.goods_retail.item_{num}", info.get("regla") or "no_normalizable",
                                    f"{p['producto'][:80]} · {info.get('detalle') or ''}")
                continue
            precios_obs.append(fila)
        valores = [x["precio"] for x in precios_obs]
        keep, drop = _filtrar_outliers(valores)
        if drop:
            _registrar_descarte(state, f"market.goods_retail.item_{num}", "outlier",
                                f"{len(drop)} precio(s) (ya normalizados a {it.get('unidad')}) fuera de [mediana/5, mediana×5]: {drop[:5]}")
        mediana = _mediana(keep)
        n = len(keep)
        n_norm = sum(1 for x in precios_obs if x["precio"] in keep and (x["normalizacion"] or {}).get("regla") != "asumida_misma_unidad")
        diff_retail = _diff_pct(base_val, mediana) if n >= MARKET_MIN_PRECIOS else None
        veredicto_retail = _veredicto(diff_retail) if diff_retail is not None else "sin_dato"
        motivo = None
        if n < MARKET_MIN_PRECIOS:
            motivo = "precios_insuficientes"
        elif base_val is None:
            motivo = "sin_precio_ofertado_ni_referencial"

        # Combinación retail + ancla regional.
        veredicto, diff, diff_fuente, med_comparacion = veredicto_retail, diff_retail, "retail", mediana
        if ancla.get("estado") == "hallado" and base_val is not None:
            vr = ancla["veredicto_regional"]
            if ancla.get("posicion") == "dentro_rango":
                veredicto, diff_fuente = "alineado_regional", "ancla_regional"
                med_comparacion = ancla.get("mediana")
                motivo = None
            elif veredicto_retail == "sin_dato":
                veredicto, diff, diff_fuente = vr, ancla.get("diff_vs_mediana_pct"), "ancla_regional"
                med_comparacion = ancla.get("mediana")
                motivo = None
            else:
                ancla["concuerda_con_retail"] = (vr == veredicto_retail)
        # Guardarraíl: Δ implausible sin precios con unidad confirmada → no_verificable.
        if (isinstance(diff, (int, float)) and diff > MARKET_DELTA_IMPLAUSIBLE
                and n_norm < MARKET_MIN_PRECIOS and diff_fuente == "retail"):
            veredicto, motivo = "no_verificable", "delta_implausible_sin_unidad_confirmada"
            _registrar_descarte(state, f"market.goods_retail.item_{num}", "delta_implausible",
                                f"Δ {diff:+.0f} % con {n_norm} precio(s) de unidad confirmada (< {MARKET_MIN_PRECIOS})")
        proveedores = []
        vistos = set()
        for x in precios_obs:
            k = (x.get("proveedor") or x.get("dominio") or "").lower()
            if k and k not in vistos:
                vistos.add(k)
                proveedores.append({"nombre": x.get("proveedor") or x.get("dominio"), "url": x["url"]})
        findings.append({
            "item_numero": it.get("numero"),
            "item_descripcion": (it.get("descripcion_corta") or "")[:300],
            "cantidad": it.get("cantidad"), "unidad": it.get("unidad"),
            "unidad_normalizacion": ctx.get("dim"),
            "precio_unitario_referencial": it.get("precio_unitario_referencial"),
            "precio_unitario_ofertado": it.get("precio_unitario_ofertado"),
            "origen_precio_ofertado": it.get("origen_precio"),
            "oferta_vs_referencial_pct": oferta_vs_ref, "nota_base": nota_base,
            "precios_observados": precios_obs,
            "precios_descartados": descartados[:10],
            "proveedores_potenciales": proveedores[:6],
            "caracteristicas_solicitadas_clave": [],
            "precio_mediana_mercado": round(mediana, 2) if mediana is not None else None,
            "fuente_mediana": "retail",
            "precio_mediana_regional": ancla.get("mediana") if ancla.get("estado") == "hallado" else None,
            "n_referencias_internas": ancla.get("n") if ancla.get("estado") == "hallado" else 0,
            "precio_mediana_comparacion": round(med_comparacion, 2) if isinstance(med_comparacion, (int, float)) else None,
            "rango_min": round(min(keep), 2) if keep else None,
            "rango_max": round(max(keep), 2) if keep else None,
            "n_precios": n, "n_precios_normalizados": n_norm,
            "diff_pct": diff, "diff_base": base if diff is not None else None,
            "diff_fuente": diff_fuente if (diff is not None or veredicto == "alineado_regional") else None,
            "diff_pct_retail": diff_retail, "veredicto_retail": veredicto_retail,
            "veredicto": veredicto,
            "es_estimacion": veredicto in ("sin_dato", "no_verificable"),
            "motivo_estimacion": motivo,
            "estado": "hallado" if veredicto != "no_verificable" else "no_verificable",
            "evidencia": ([{"url": x["url"], "cita": f"{x['producto'][:150]} · S/ {x['precio']:.2f}/{it.get('unidad') or 'u'}"[:240]} for x in precios_obs]
                          + [{"url": r["url"], "cita": f"SEACE {r['ocid']}: {r['descripcion'][:120]} · S/ {r['precio_unitario']:.2f} ({r['precio_base']})"[:240]}
                             for r in refs_usables])[:20],
            "referencias_internas": refs_pub,
            "ancla_regional": ancla,
            "spec_restrictiva": None,   # lo evalúa document_legal_analyst (vector marca_unica / specs_convergentes)
            "comentario": comentarios.get(num) or "",
        })

    # ── Totales (código) ──────────────────────────────────────────
    # Cobertura por VALOR: Σ valor de los ítems respaldados / Σ valor de todos (1225450: 100 gal de
    # gasohol sobre 5 100 gal → 1.4 %, no "1/1 = 100 %"). Respaldado = mediana con ≥ MIN precios
    # (retail) o ancla regional decisiva.
    n_total = len(items)
    by_num = {_norm_num(it.get("numero")): it for it in items}
    con_mediana = [f for f in findings if isinstance(f.get("precio_mediana_comparacion"), (int, float))
                   or isinstance(f.get("precio_mediana_mercado"), (int, float))]
    # Respaldado: mediana con ≥ MIN precios (o ancla regional) y sin guardarraíl disparado. Un ítem
    # sin precio base propio (lote tipo canasta) igual aporta su mediana × cantidad al total.
    respaldados = [f for f in findings if f.get("veredicto") != "no_verificable"
                   and isinstance(f.get("precio_mediana_comparacion") or f.get("precio_mediana_mercado"), (int, float))
                   and (f.get("n_precios", 0) >= MARKET_MIN_PRECIOS or (f.get("ancla_regional") or {}).get("estado") == "hallado")]
    valores_all = {_norm_num(f.get("item_numero")): _valor_item(by_num.get(_norm_num(f.get("item_numero")), {}), f) for f in findings}
    resp_nums = {_norm_num(f.get("item_numero")) for f in respaldados}
    suma_all = sum(v for v in valores_all.values() if v)
    suma_resp = sum(v for k, v in valores_all.items() if v and k in resp_nums)
    cobertura_conteo = (len(respaldados) / n_total) if n_total else 0.0
    if suma_all > 0 and all(v for v in valores_all.values()):
        cobertura = suma_resp / suma_all
    elif suma_all > 0:
        cobertura = min(suma_resp / suma_all, cobertura_conteo)
    else:
        cobertura = cobertura_conteo

    def _med(f):
        return float(f.get("precio_mediana_comparacion") or f.get("precio_mediana_mercado"))
    total_mercado_resp = sum(_med(f) * f["cantidad"] for f in respaldados if isinstance(f.get("cantidad"), (int, float)))

    total_ofertado = mi.get("total_ofertado")
    total_ofertado_base = mi.get("total_ofertado_base")
    if not isinstance(total_ofertado, (int, float)):
        if padre_lote and isinstance(padre_lote.get("cuantia_total"), (int, float)):
            total_ofertado, total_ofertado_base = float(padre_lote["cuantia_total"]), "referencial"
        else:
            total_ofertado, total_ofertado_base = None, None
    es_referencial = total_ofertado_base == "referencial"

    # Base ofertada sobre los MISMOS ítems que el total de mercado (1225090: 3 de 4 ítems de
    # mercado contra el lote completo → +156 % ficticio).
    ofert_resp = [(by_num.get(_norm_num(f.get("item_numero")), {}).get("precio_unitario_ofertado"), f.get("cantidad")) for f in respaldados]
    lote_base = None
    total_ofertado_resp = None
    if respaldados and all(_market_to_num(p) and isinstance(c, (int, float)) for p, c in ofert_resp):
        total_ofertado_resp = sum(float(p) * float(c) for p, c in ofert_resp)
        lote_base = "ofertado_items"
    elif total_ofertado and not es_referencial and suma_all > 0 and all(v for v in valores_all.values()):
        total_ofertado_resp = float(total_ofertado) * (suma_resp / suma_all)
        lote_base = "contrato_prorrateado" if cobertura < 0.999 else total_ofertado_base
    elif total_ofertado and cobertura >= 0.999:
        total_ofertado_resp, lote_base = float(total_ofertado), total_ofertado_base

    sobreprecio_pct = None
    estimado_vs_mercado_pct = None
    veredicto_global = "sin_dato"
    lote = {"aplica": n_total >= 2, "n_items": n_total, "n_respaldados": len(respaldados),
            "cobertura_valor": round(cobertura, 3), "cobertura_conteo": round(cobertura_conteo, 3),
            "base": lote_base, "total_ofertado_respaldados": round(total_ofertado_resp, 2) if total_ofertado_resp else None,
            "total_mercado_respaldados": round(total_mercado_resp, 2) if total_mercado_resp else None, "motivo": None}
    if n_total < 2:
        lote["motivo"] = "un_solo_item_sin_bandera_de_lote"
        veredicto_global = findings[0].get("veredicto") if findings else "sin_dato"
    elif not respaldados:
        lote["motivo"] = "sin_items_respaldados"
    elif cobertura < MARKET_COBERTURA_LOTE:
        lote["motivo"] = f"cobertura_por_valor_insuficiente ({cobertura*100:.0f} % < {MARKET_COBERTURA_LOTE*100:.0f} %)"
        veredicto_global = "cobertura_parcial"
    elif not (total_ofertado_resp and total_mercado_resp):
        lote["motivo"] = "sin_base_ofertada_comparable_por_item"
        veredicto_global = "cobertura_parcial"
    else:
        delta = _diff_pct(total_ofertado_resp, total_mercado_resp)
        if lote_base == "referencial":
            # Solo hay cuantía estimada: nunca "sobreprecio ofertado"; señal informativa aparte.
            estimado_vs_mercado_pct = delta
            veredicto_global = "estimado_sobre_mercado" if (delta is not None and delta >= MARKET_UMBRAL_ELEVADO) else _veredicto(delta)
            lote["motivo"] = "solo_cuantia_referencial_disponible"
        else:
            sobreprecio_pct = delta
            veredicto_global = _veredicto(delta)
            n_norm_resp = sum(f.get("n_precios_normalizados", 0) for f in respaldados) + sum(
                1 for f in respaldados if (f.get("ancla_regional") or {}).get("estado") == "hallado")
            if delta is not None and delta > MARKET_DELTA_IMPLAUSIBLE and (cobertura < MARKET_COBERTURA_LOTE or n_norm_resp < MARKET_MIN_PRECIOS):
                veredicto_global, sobreprecio_pct = "no_verificable", None
                lote["motivo"] = f"delta_implausible ({delta:+.0f} %) sin cobertura/unidades confirmadas"
                _registrar_descarte(state, "market.goods_retail.lote", "delta_implausible", lote["motivo"])
            # Ancla regional: si todos los respaldados están alineados regionalmente, el lote no es señal.
            elif all(f.get("veredicto") == "alineado_regional" for f in respaldados) and veredicto_global in ("elevado", "muy_elevado"):
                veredicto_global = "alineado_regional"
                lote["motivo"] = "items_alineados_con_referencias_regionales"
                lote["delta_retail_pct"] = delta
                sobreprecio_pct = None

    obs = [f"Preciados {len(con_mediana)}/{n_total} ítems; {len(respaldados)} respaldado(s) (≥{MARKET_MIN_PRECIOS} precios "
           f"con fuente de grounding normalizados a la unidad del ítem, o ancla regional) · cobertura por valor "
           f"{cobertura*100:.0f} % vía {n_chunks} worker(s)."]
    if n_retry:
        obs.append(f"2º pase recuperó {n_retry} ítem(s).")
    n_estimados_ia = sum(1 for f in findings if f.get("precio_estimado_ia") is not None)
    if items_estimar:
        obs.append(f"Lote con {n_total} ítems (> {MARKET_ESTIMACION_DESDE}): {len(items_estimar)} de menor valor no "
                    f"entraron a la búsqueda real; {n_estimados_ia} recibieron una ESTIMACIÓN del modelo (conocimiento "
                    f"previo, sin grounding) — informativa, no cuenta como respaldo ni mueve sobreprecio_pct.")
    n_ancla = sum(1 for f in findings if (f.get("ancla_regional") or {}).get("estado") == "hallado")
    if n_ancla:
        obs.append(f"{n_ancla} ítem(s) con ancla regional en la BD SEACE propia (referencias_internas).")
    if total_ofertado_base:
        obs.append(f"Total ofertado tomado de: {total_ofertado_base}" + (" (cuantía referencial, no precio ofertado)." if es_referencial else "."))
    if n_total < 2:
        obs.append("Un solo ítem: no se emite bandera de lote (misma evidencia que la bandera por ítem).")
    elif lote.get("motivo"):
        obs.append(f"Lote: {lote['motivo']}.")
    obs.append("Mediana, rango, Δ% y veredicto calculados en código; URLs tomadas exclusivamente de grounding_metadata y de la BD propia.")
    return {
        "estado": "hallado" if con_mediana else "sin_dato",
        "findings": findings,
        "total_ofertado": total_ofertado,
        "total_ofertado_base": total_ofertado_base,
        "total_ofertado_es_referencial": es_referencial,
        "cuantia_referencial_total": mi.get("cuantia_referencial_total"),
        # Solo se publica cuando el Δ de lote es válido (≥ 2 ítems, cobertura por valor ≥ 0.7, base
        # ofertada real): así ningún consumidor recalcula un "sobreprecio" desde totales no comparables
        # (un solo ítem, cuantía referencial, cobertura parcial). El detalle queda en `lote`.
        "total_estimado_mercado": (round(total_mercado_resp, 2) if (total_mercado_resp and sobreprecio_pct is not None) else None),
        "sobreprecio_pct": sobreprecio_pct,
        "estimado_vs_mercado_pct": estimado_vs_mercado_pct,
        "veredicto_global": veredicto_global,
        "cobertura_mercado": round(cobertura, 3),
        "cobertura_conteo": round(cobertura_conteo, 3),
        "lote": lote,
        "n_items": n_total, "n_con_mediana": len(con_mediana), "n_respaldados": len(respaldados),
        "n_items_estimados_ia": n_estimados_ia,
        "n_chunks": n_chunks,
        "confianza_global": ("alta" if cobertura >= 0.8 else "media" if cobertura >= 0.5 else "baja"),
        "requerimiento_disponible_para_analisis": bool(mi.get("tiene_requerimiento")),
        "valor_referencial_oficial": ((mi or {}).get("estudio_mercado") or {}).get("valor_referencial"),
        "precio_final_contrato": ((mi or {}).get("contrato_final") or {}).get("precio_final_total"),
        "precio_final_vs_referencial": (mi or {}).get("precio_final_vs_referencial"),
        "observaciones_clave": obs,
        "grounding_urls": [c["uri"] for c in chunks if c.get("uri")],
        "_modo": "sharded_fanout_grounded",
    }


# ── Histórico SEACE (BD propia) ──────────────────────────────────────
def _cubsos_del_record(ocds: dict) -> list[str]:
    ids: list[str] = []
    for it in ((ocds.get("tender") or {}).get("items") or []):
        if not isinstance(it, dict):
            continue
        for c in [it.get("classification")] + list(it.get("additionalClassifications") or []):
            cid = str((c or {}).get("id") or "").strip()
            if cid and cid not in ids:
                ids.append(cid)
    return ids


def _monto_del_record(ocds: dict, state: dict) -> tuple[float | None, str | None]:
    """(monto, base): adjudicado (awards) > contratado (contracts) > referencial (tender.value /
    convocatoria). None si el valor no es público (p.ej. hasTenderInformationProtectedByLaw)."""
    def _amt(v):
        try:
            a = float((v or {}).get("amount") or 0)
            return a if a > 0 else None
        except (TypeError, ValueError):
            return None
    for a in ocds.get("awards") or []:
        if isinstance(a, dict) and _amt(a.get("value")):
            return _amt(a.get("value")), "adjudicado"
    for c in ocds.get("contracts") or []:
        if isinstance(c, dict) and _amt(c.get("value")):
            return _amt(c.get("value")), "contratado"
    t = ocds.get("tender") or {}
    if _amt(t.get("value")):
        return _amt(t.get("value")), "referencial"
    cf = _safe_parse_json(state.get("contrato_final")) or {}
    if cf.get("precio_final_total"):
        try:
            return float(cf["precio_final_total"]), "contratado"
        except (TypeError, ValueError):
            pass
    em = _safe_parse_json(state.get("estudio_mercado")) or {}
    if em.get("valor_referencial"):
        try:
            return float(em["valor_referencial"]), "referencial"
        except (TypeError, ValueError):
            pass
    return None, None


def _entidad_ruc_del_record(ocds: dict) -> str | None:
    for p in ocds.get("parties") or []:
        if not isinstance(p, dict):
            continue
        roles = p.get("roles") or []
        if "buyer" in roles or "procuringEntity" in roles:
            for ai in p.get("additionalIdentifiers") or []:
                if (ai or {}).get("scheme") == "PE-RUC":
                    m = re.search(r"(\d{11})$", str(ai.get("id") or ""))
                    if m:
                        return m.group(1)
            ident = p.get("identifier") or {}
            if ident.get("scheme") == "PE-RUC":
                m = re.search(r"(\d{11})$", str(ident.get("id") or ""))
                if m:
                    return m.group(1)
    return None


def _comparables_convocatorias(ocid: str, cubsos: list[str], objeto: str, tipos: tuple[str, ...],
                               *, meses: int = MARKET_HIST_MESES, sim_min: float = MARKET_HIST_SIM,
                               limit: int = MARKET_HIST_LIMIT) -> list[dict]:
    """Convocatorias similares en la BD propia: mismo CUBSO (o clase UNSPSC) u objeto similar
    (unaccent + pg_trgm), últimos `meses`, con cuantía > 0. Determinista, sin LLM."""
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM pg_extension WHERE extname='pg_trgm'")
        tiene_trgm = cur.fetchone() is not None
        cur.execute("SELECT 1 FROM pg_extension WHERE extname='unaccent'")
        tiene_unaccent = cur.fetchone() is not None
        norm = "unaccent(lower(%s))" if tiene_unaccent else "lower(%s)"
        sim_expr = f"similarity({norm.replace('%s', 'c.objeto')}, {norm})" if tiene_trgm else "0.0"
        clases = sorted({c[:8] for c in cubsos if len(c) >= 8})
        sql = f"""
            WITH base AS (
              SELECT c.ocid, c.entidad_ruc, e.nombre AS entidad, c.objeto, c.cuantia_referencial,
                     c.fecha_convocatoria, c.modalidad, c.etapa, c.tipo_contratacion, c.region,
                     {sim_expr} AS sim,
                     EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(c.ocds_payload->'tender'->'items','[]'::jsonb)) it
                             WHERE it->'classification'->>'id' = ANY(%s)
                                OR left(it->'classification'->>'id', 8) = ANY(%s)) AS mismo_cubso
                FROM convocatorias c LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
               WHERE c.ocid <> %s AND c.tipo_contratacion = ANY(%s) AND c.cuantia_referencial > 0
                 AND c.fecha_convocatoria >= (CURRENT_DATE - make_interval(months => %s))
            )
            SELECT ocid, entidad_ruc, entidad, objeto, cuantia_referencial, fecha_convocatoria, modalidad,
                   etapa, tipo_contratacion, region, sim, mismo_cubso
              FROM base WHERE (mismo_cubso AND sim >= %s) OR sim >= %s
             ORDER BY (CASE WHEN mismo_cubso THEN 0.25 ELSE 0 END) + sim DESC LIMIT %s"""
        # Mismo CUBSO con objeto poco similar (mitad del umbral) sigue siendo otro servicio.
        params = ([objeto] if tiene_trgm else []) + [cubsos or [""], clases or [""], ocid, list(tipos), meses,
                                                     sim_min / 2, sim_min, limit]
        cur.execute(sql, params)
        cols = ["ocid", "entidad_ruc", "entidad", "objeto", "cuantia_referencial", "fecha_convocatoria",
                "modalidad", "etapa", "tipo_contratacion", "region", "sim", "mismo_cubso"]
        out = []
        for r in cur.fetchall():
            d = dict(zip(cols, r))
            d["cuantia_referencial"] = float(d["cuantia_referencial"] or 0)
            d["fecha_convocatoria"] = d["fecha_convocatoria"].isoformat() if d.get("fecha_convocatoria") else None
            d["sim"] = round(float(d["sim"] or 0), 3)
            d["url"] = OECE_PROCESO_URL.format(ocid=d["ocid"])
            out.append(d)
        return out
    finally:
        conn.close()


def _finding_historico(objeto: str, item_numero: str, monto, base: str | None, comparables: list[dict],
                       cantidad=1.0, unidad="Contrato", min_n: int = MARKET_HIST_MIN_N) -> dict:
    """Un finding (formato frontend) con la distribución de comparables como precios observados."""
    vals = [c["cuantia_referencial"] for c in comparables if c.get("cuantia_referencial")]
    p25, p50, p75 = _percentil(vals, .25), _percentil(vals, .5), _percentil(vals, .75)
    n = len(vals)
    diff_info = _diff_pct(monto, p50) if (n >= min_n and monto) else None
    posicion = None
    if diff_info is not None:
        posicion = ("sobre_p75" if monto > p75 else "bajo_p25" if monto < p25 else "entre_p25_p75")
    diff = diff_info if MARKET_HIST_VEREDICTO else None
    veredicto = _veredicto(diff) if diff is not None else "sin_dato"
    motivo = None
    if not monto:
        motivo = "monto_no_publico"
    elif n < min_n:
        motivo = "comparables_insuficientes"
    elif not MARKET_HIST_VEREDICTO:
        motivo = "comparacion_no_normalizada"
    obs = [{
        "producto": (c.get("objeto") or "")[:300], "precio": c["cuantia_referencial"], "unidad": "contrato",
        "url": c["url"], "fecha": c.get("fecha_convocatoria"), "proveedor": c.get("entidad") or c.get("entidad_ruc"),
        "moneda_origen": "PEN", "titulo_fuente": f"SEACE {c['ocid']}", "dominio": "contratacionesabiertas.oece.gob.pe",
        "similitud_objeto": c.get("sim"), "mismo_cubso": bool(c.get("mismo_cubso")),
        "misma_entidad": bool(c.get("misma_entidad")), "valor": c["cuantia_referencial"],
    } for c in comparables]
    return {
        "item_numero": item_numero, "item_descripcion": objeto[:300],
        "cantidad": cantidad, "unidad": unidad,
        "precio_unitario_referencial": monto if base == "referencial" else None,
        "precio_unitario_ofertado": monto if base in ("adjudicado", "contratado") else None,
        "precios_observados": obs,
        "proveedores_potenciales": [],
        "caracteristicas_solicitadas_clave": [],
        "precio_mediana_mercado": round(p50, 2) if p50 is not None else None,
        "rango_min": round(p25, 2) if p25 is not None else None,
        "rango_max": round(p75, 2) if p75 is not None else None,
        "n_precios": n, "percentiles": {"p25": p25, "p50": p50, "p75": p75},
        "diff_vs_p50_pct": diff_info, "posicion_historica": posicion,
        "diff_pct": diff, "diff_base": base if diff is not None else None,
        "veredicto": veredicto, "es_estimacion": veredicto == "sin_dato", "motivo_estimacion": motivo,
        "estado": "hallado" if n else "sin_dato",
        "evidencia": [{"url": c["url"], "cita": f"{(c.get('objeto') or '')[:160]} · S/ {c['cuantia_referencial']:,.2f}"[:240]} for c in comparables][:20],
        "spec_restrictiva": None,
        "comentario": ((f"{n} convocatoria(s) comparable(s) en {MARKET_HIST_MESES} meses (BD SEACE propia); "
                        f"rango p25–p75 S/ {p25:,.2f} – {p75:,.2f}."
                        + (f" El monto ({base}) queda {posicion.replace('_', ' ')} ({diff_info:+.1f}% vs p50); "
                           f"referencia de escala, no normalizada por alcance." if posicion else ""))
                       if n else "Sin convocatorias comparables por CUBSO u objeto en la BD propia."),
    }


def _mercado_historico_seace(state: dict) -> dict:
    ocds = state.get("ocds") or {}
    ocid = _short_ocid(ocds.get("ocid") or state.get("ocid") or "")
    tender = ocds.get("tender") or {}
    objeto = tender.get("description") or tender.get("title") or ""
    cubsos = _cubsos_del_record(ocds)
    monto, base = _monto_del_record(ocds, state)
    entidad_ruc = _entidad_ruc_del_record(ocds)
    tipos = ("servicios", "consultoria")

    comparables = _comparables_convocatorias(ocid, cubsos, objeto, tipos) if (ocid and (cubsos or objeto)) else []
    for c in comparables:
        c["misma_entidad"] = bool(entidad_ruc and c.get("entidad_ruc") == entidad_ruc)
    _publicar_grounding(state, [{"uri": c["url"], "titulo": f"SEACE {c['ocid']}", "dominio": "contratacionesabiertas.oece.gob.pe",
                                 "origen": "bd_convocatorias"} for c in comparables])

    finding = _finding_historico(objeto, "1", monto, base, comparables)

    # Tarifas implícitas del bloque `servicio` del parser (lo produce D; si falta → sin_dato).
    raw = state.get("parser_raw_consolidated") or {}
    srv = raw.get("servicio") if isinstance(raw.get("servicio"), dict) else None
    ind: dict = {"estado": "sin_dato", "motivo": "sin_bloque_servicio_del_parser"} if not srv else {"estado": "hallado"}
    if srv:
        plazo = srv.get("plazo_total_dias")
        personal = [p for p in (srv.get("personal_clave") or []) if isinstance(p, dict)]
        entregables = [e for e in (srv.get("entregables") or []) if isinstance(e, dict)]
        ind.update({"plazo_dias": plazo, "n_personal_clave": len(personal), "n_entregables": len(entregables),
                    "tarifas_declaradas": [t for t in (srv.get("tarifas") or []) if isinstance(t, dict)][:20]})
        try:
            meses = float(plazo) / 30.0 if plazo else None
        except (TypeError, ValueError):
            meses = None
        ind["costo_mensual_implicito"] = round(monto / meses, 2) if (monto and meses) else None
        ind["costo_mensual_por_persona"] = (round(monto / meses / len(personal), 2)
                                            if (monto and meses and personal) else None)
        ind["costo_por_entregable"] = round(monto / len(entregables), 2) if (monto and entregables) else None
        if ind["costo_mensual_implicito"] is None and ind["costo_por_entregable"] is None:
            ind["estado"] = "sin_dato"
            ind["motivo"] = "monto_no_publico" if not monto else "sin_plazo_ni_entregables_en_tdr"
    # Comparación de tarifa mensual contra comparables: solo posible si estos traen plazo (no
    # lo guardamos en `convocatorias`) → se declara.
    ind["comparacion_tarifa_mensual"] = {"estado": "sin_dato", "motivo": "comparables_sin_plazo_en_bd"}

    misma_ent = [c for c in comparables if c.get("misma_entidad")]
    n = len(comparables)
    obs = [f"Histórico SEACE: {n} comparable(s) ({sum(1 for c in comparables if c.get('mismo_cubso'))} por CUBSO, "
           f"{len(misma_ent)} de la misma entidad) en {MARKET_HIST_MESES} meses."]
    if monto is None:
        obs.append("El monto del proceso no es público (valor referencial reservado o sin award): no se calculó Δ%.")
    elif n < MARKET_HIST_MIN_N:
        obs.append(f"Menos de {MARKET_HIST_MIN_N} comparables: no se emite veredicto.")
    return {
        "estado": finding["estado"],
        "findings": [finding],
        "monto_base": monto, "monto_base_tipo": base,
        "cubsos": cubsos, "entidad_ruc": entidad_ruc,
        "comparables_misma_entidad": misma_ent[:10],
        "indicadores_servicio": ind,
        "total_ofertado": monto if base in ("adjudicado", "contratado") else None,
        "total_estimado_mercado": finding["precio_mediana_mercado"],
        "sobreprecio_pct": finding["diff_pct"],
        "veredicto_global": finding["veredicto"],
        "cobertura_mercado": 1.0 if finding["veredicto"] != "sin_dato" else 0.0,
        "n_items": 1, "n_con_mediana": 1 if finding["precio_mediana_mercado"] is not None else 0,
        "confianza_global": ("alta" if n >= 2 * MARKET_HIST_MIN_N else "media" if n >= MARKET_HIST_MIN_N else "baja"),
        "observaciones_clave": obs,
        "grounding_urls": [c["url"] for c in comparables],
        "_modo": "historico_seace",
    }


# ── Presupuesto de obra ──────────────────────────────────────────────
def _mercado_presupuesto_obra(state: dict) -> dict:
    ocds = state.get("ocds") or {}
    ocid = _short_ocid(ocds.get("ocid") or state.get("ocid") or "")
    tender = ocds.get("tender") or {}
    objeto = tender.get("description") or tender.get("title") or ""
    cubsos = _cubsos_del_record(ocds)
    monto, base = _monto_del_record(ocds, state)
    entidad_ruc = _entidad_ruc_del_record(ocds)

    raw = state.get("parser_raw_consolidated") or {}
    obra = raw.get("obra") if isinstance(raw.get("obra"), dict) else None
    et = (obra or {}).get("expediente_tecnico") if obra else None
    et = et if isinstance(et, dict) else None

    presupuesto: dict = {"estado": "sin_dato", "motivo": "sin_bloque_obra_del_parser"} if not et else {"estado": "hallado"}
    if et:
        partidas = [p for p in (et.get("partidas") or []) if isinstance(p, dict)]
        suma, inconsistentes = 0.0, []
        for p in partidas:
            parcial = _market_to_num(p.get("parcial"))
            met, pu = _market_to_num(p.get("metrado")), _market_to_num(p.get("precio_unitario"))
            calc = (met * pu) if (met and pu) else None
            if parcial is None and calc is not None:
                parcial = calc
            if parcial is not None:
                suma += parcial
            if parcial and calc and abs(parcial - calc) / max(calc, 1e-9) > 0.01:
                inconsistentes.append({"codigo": p.get("codigo"), "parcial": parcial, "metrado_x_pu": round(calc, 2)})
        total = _market_to_num(et.get("presupuesto_total"))
        gg, ut = _market_to_num(et.get("gastos_generales_pct")), _market_to_num(et.get("utilidad_pct"))
        presupuesto.update({
            "presupuesto_total": total, "n_partidas": len(partidas),
            "suma_partidas": round(suma, 2) if partidas else None,
            "diff_suma_vs_total_pct": _diff_pct(suma, total) if (partidas and total) else None,
            "partidas_inconsistentes": inconsistentes[:20],
            "gastos_generales_pct": gg, "utilidad_pct": ut,
            "gg_mas_utilidad_pct": (gg or 0) + (ut or 0) if (gg is not None or ut is not None) else None,
            "plazo_dias": et.get("plazo_dias"),
            "area_m2": _market_to_num(et.get("area_m2") or et.get("metrado_total_m2")),
        })
        presupuesto["monto_por_m2"] = (round((total or monto) / presupuesto["area_m2"], 2)
                                       if presupuesto["area_m2"] and (total or monto) else None)
        if presupuesto["monto_por_m2"] is None:
            presupuesto["monto_por_m2_estado"] = "sin_dato"
        adicionales = [a for a in ((obra or {}).get("adicionales") or []) if isinstance(a, dict)]
        ampliaciones = [a for a in ((obra or {}).get("ampliaciones_plazo") or []) if isinstance(a, dict)]
        suma_adic = sum(_market_to_num(a.get("monto")) or 0 for a in adicionales)
        ref = total or monto
        presupuesto["adicionales"] = {
            "n": len(adicionales), "monto_acumulado": round(suma_adic, 2) if adicionales else None,
            "pct_acumulado": round(suma_adic / ref * 100, 2) if (adicionales and ref) else None,
            "n_ampliaciones_plazo": len(ampliaciones),
        }

    comparables = _comparables_convocatorias(ocid, cubsos, objeto, ("obras",)) if (ocid and (cubsos or objeto)) else []
    for c in comparables:
        c["misma_entidad"] = bool(entidad_ruc and c.get("entidad_ruc") == entidad_ruc)
    _publicar_grounding(state, [{"uri": c["url"], "titulo": f"SEACE {c['ocid']}", "dominio": "contratacionesabiertas.oece.gob.pe",
                                 "origen": "bd_convocatorias"} for c in comparables])
    monto_cmp = monto or (presupuesto.get("presupuesto_total") if et else None)
    finding = _finding_historico(objeto, "1", monto_cmp, base or ("referencial" if monto_cmp else None), comparables, unidad="Obra")

    vp = state.setdefault("validaciones_pendientes", [])
    if isinstance(vp, list) and "infobras_avance" not in vp:
        vp.append("infobras_avance")

    obs = [f"Obras similares en BD SEACE: {len(comparables)} en {MARKET_HIST_MESES} meses.",
           "Avance físico/financiero (INFOBRAS) no integrado: validación pendiente explícita."]
    if presupuesto.get("estado") == "sin_dato":
        obs.append("Sin bloque `obra` del parser: no se contrastaron partidas ni GG/utilidad.")
    return {
        "estado": "hallado" if (et or comparables) else "sin_dato",
        "findings": [finding],
        "monto_base": monto, "monto_base_tipo": base,
        "presupuesto": presupuesto,
        "cubsos": cubsos, "entidad_ruc": entidad_ruc,
        "total_ofertado": monto if base in ("adjudicado", "contratado") else None,
        "total_estimado_mercado": finding["precio_mediana_mercado"],
        "sobreprecio_pct": finding["diff_pct"],
        "veredicto_global": finding["veredicto"],
        "cobertura_mercado": 1.0 if finding["veredicto"] != "sin_dato" else 0.0,
        "n_items": 1, "n_con_mediana": 1 if finding["precio_mediana_mercado"] is not None else 0,
        "confianza_global": ("media" if len(comparables) >= MARKET_HIST_MIN_N else "baja"),
        "validaciones_pendientes": ["infobras_avance"],
        "observaciones_clave": obs,
        "grounding_urls": [c["url"] for c in comparables],
        "_modo": "presupuesto_obra",
    }


# ── Cotizaciones del expediente (directa / convenio / otros) ─────────
def _rucs_vinculados_person_network(state: dict) -> tuple[set[str], str]:
    """RUCs de empresas vinculadas al ganador según person_network. (rucs, estado)."""
    pn = _safe_parse_json(state.get("person_network"))
    if not isinstance(pn, dict) or not pn:
        return set(), "no_verificable"
    rucs: set[str] = set()
    pp = pn.get("persona_principal") or {}
    for grupo in (pp.get("otras_empresas_vinculadas") or [], pp.get("otros_cargos_actuales") or []):
        for e in grupo:
            if isinstance(e, dict) and re.fullmatch(r"\d{11}", str(e.get("ruc") or "")):
                rucs.add(str(e["ruc"]))
    red = pn.get("red_empresarial") or {}
    for grupo in (red.get("empresas_misma_direccion") or [], red.get("empresas_mismo_titular") or []):
        for e in grupo:
            if isinstance(e, dict) and re.fullmatch(r"\d{11}", str(e.get("ruc") or "")):
                rucs.add(str(e["ruc"]))
    for lz in pn.get("lazos_entre_postores") or []:
        if isinstance(lz, dict) and lz.get("tipo_vinculo") not in (None, "sin_vinculo"):
            for k in ("postor_a", "postor_b"):
                r = str(((lz.get(k) or {}).get("ruc")) or "")
                if re.fullmatch(r"\d{11}", r):
                    rucs.add(r)
    return rucs, "hallado"


def _ganador_del_record(ocds: dict) -> tuple[str | None, str | None]:
    for a in ocds.get("awards") or []:
        if not isinstance(a, dict):
            continue
        for s in a.get("suppliers") or []:
            if isinstance(s, dict):
                m = re.search(r"(\d{11})$", str(s.get("id") or ""))
                return (m.group(1) if m else None), (s.get("name") or None)
    return None, None


def _mercado_cotizaciones(state: dict) -> dict:
    import difflib
    ocds = state.get("ocds") or {}
    ocid = _short_ocid(ocds.get("ocid") or state.get("ocid") or "")
    tender = ocds.get("tender") or {}
    objeto = tender.get("description") or tender.get("title") or ""
    monto, base = _monto_del_record(ocds, state)
    ganador_ruc, ganador_nombre = _ganador_del_record(ocds)

    raw = state.get("parser_raw_consolidated") or {}
    sd = raw.get("sustento_directa") if isinstance(raw.get("sustento_directa"), dict) else None
    em = _safe_parse_json(state.get("estudio_mercado")) or {}
    cots = [c for c in ((sd or {}).get("cotizaciones") or []) if isinstance(c, dict)]
    doc_sha = (sd or {}).get("documento_sha256") if sd else None

    cot_val = []
    for c in cots:
        m = _market_to_num(c.get("monto"))
        if m:
            cot_val.append({"proveedor": (c.get("proveedor") or "")[:200], "ruc": str(c.get("ruc") or "") or None,
                            "monto": m, "pagina": c.get("pagina"), "documento_sha256": c.get("documento_sha256") or doc_sha})
    n = len(cot_val)
    montos = [c["monto"] for c in cot_val]

    # Cotizante = ganador (RUC exacto o razón social muy similar).
    def _sim(a, b):
        return difflib.SequenceMatcher(None, _normalize_name_for_search(a or ""), _normalize_name_for_search(b or "")).ratio()
    cot_ganador, idx_ganador = None, None
    for i, c in enumerate(cot_val):
        if ganador_ruc and c.get("ruc") == ganador_ruc:
            cot_ganador, idx_ganador = {**c, "match": "ruc"}, i
            break
        if ganador_nombre and c.get("proveedor") and _sim(c["proveedor"], ganador_nombre) >= 0.85:
            cot_ganador, idx_ganador = {**c, "match": "razon_social"}, i
            break
    minimo = min(montos) if montos else None
    ganador_es_el_mas_barato = (cot_ganador is not None and minimo is not None and cot_ganador["monto"] <= minimo + 1e-6)

    # La base de comparación son las OTRAS cotizaciones (la del ganador es el propio monto):
    # ¿se adjudicó por encima de lo que cotizaron los demás?
    otras = [c["monto"] for i, c in enumerate(cot_val) if i != idx_ganador]
    mediana = _mediana(otras) if otras else _mediana(montos)
    n_otras = len(otras)
    diff_med = _diff_pct(monto, mediana) if (monto and n_otras >= 2) else None
    diff_min = _diff_pct(monto, min(otras)) if (monto and otras) else None
    veredicto = _veredicto(diff_med) if diff_med is not None else "sin_dato"
    motivo = None
    if not sd:
        motivo = "sin_bloque_sustento_directa_del_parser"
    elif n == 0:
        motivo = "sin_cotizaciones_en_expediente"
    elif not monto:
        motivo = "monto_adjudicado_no_publico"
    elif n_otras < 2:
        motivo = "menos_de_dos_cotizaciones_de_terceros"

    # Cotizantes vinculados entre sí o con el ganador (person_network).
    rucs_vinc, estado_vinc = _rucs_vinculados_person_network(state)
    vinculados = [c for c in cot_val if c.get("ruc") and c["ruc"] in rucs_vinc and c["ruc"] != ganador_ruc]

    evidencia = []
    for c in cot_val:
        evidencia.append({"documento": c.get("documento_sha256"), "pagina": c.get("pagina"),
                          "cita": f"Cotización {c['proveedor'] or c.get('ruc') or 's/n'}: S/ {c['monto']:,.2f}"[:240]})
    obs_precios = [{"producto": objeto[:300], "precio": c["monto"], "unidad": "cotización", "url": None, "fecha": None,
                    "proveedor": c["proveedor"] or c.get("ruc"), "moneda_origen": "PEN", "valor": c["monto"],
                    "ruc": c.get("ruc"), "es_ganador": (i == idx_ganador)}
                   for i, c in enumerate(cot_val)]
    finding = {
        "item_numero": "1", "item_descripcion": objeto[:300], "cantidad": 1, "unidad": "Contrato",
        "precio_unitario_referencial": _market_to_num(em.get("valor_referencial")),
        "precio_unitario_ofertado": monto if base in ("adjudicado", "contratado") else None,
        "precios_observados": obs_precios, "proveedores_potenciales": [],
        "caracteristicas_solicitadas_clave": [],
        "precio_mediana_mercado": round(mediana, 2) if mediana is not None else None,
        "rango_min": round(minimo, 2) if minimo is not None else None,
        "rango_max": round(max(montos), 2) if montos else None,
        "n_precios": n, "n_cotizaciones_terceros": n_otras,
        "diff_pct": diff_med, "diff_base": base if diff_med is not None else None,
        "diff_vs_cotizacion_minima_pct": diff_min,
        "veredicto": veredicto, "es_estimacion": veredicto == "sin_dato", "motivo_estimacion": motivo,
        "estado": "hallado" if n else "sin_dato", "evidencia": evidencia[:20], "spec_restrictiva": None,
        "comentario": (f"{n} cotización(es) en el expediente de sustento ({n_otras} de terceros); "
                       f"mediana de terceros S/ {mediana:,.2f}." if n
                       else "El expediente parseado no trae cotizaciones (o el parser no produjo el bloque sustento_directa)."),
    }

    # Histórico de directas del mismo objeto como referencia adicional (BD propia).
    cubsos = _cubsos_del_record(ocds)
    comparables = _comparables_convocatorias(ocid, cubsos, objeto, ("directa", "convenio", "bienes", "servicios", "consultoria"),
                                             limit=20) if (ocid and (cubsos or objeto)) else []
    _publicar_grounding(state, [{"uri": c["url"], "titulo": f"SEACE {c['ocid']}", "dominio": "contratacionesabiertas.oece.gob.pe",
                                 "origen": "bd_convocatorias"} for c in comparables])
    hist = _finding_historico(objeto, "1.h", monto, base, comparables, unidad="Contrato (histórico)")
    hist["item_descripcion"] = f"Histórico SEACE: {objeto[:240]}"

    obs = [f"Cotizaciones del expediente: {n}; cotizante ganador identificado: {'sí' if cot_ganador else 'no'}"
           f"{' (es la más barata)' if ganador_es_el_mas_barato else ''}."]
    if estado_vinc == "no_verificable":
        obs.append("Vínculos entre cotizantes: no verificable (sin person_network en esta corrida).")
    elif vinculados:
        obs.append(f"{len(vinculados)} cotizante(s) con RUC vinculado al ganador según person_network.")
    if motivo:
        obs.append(f"Sin veredicto: {motivo}.")
    return {
        "estado": finding["estado"],
        "findings": [finding, hist],
        "monto_base": monto, "monto_base_tipo": base,
        "ganador": {"ruc": ganador_ruc, "nombre": ganador_nombre},
        "cotizaciones": cot_val,
        "cotizante_ganador": cot_ganador,
        "ganador_es_el_mas_barato": ganador_es_el_mas_barato if cot_ganador else None,
        "cotizantes_vinculados": {"estado": estado_vinc, "items": vinculados},
        "causal": {"articulo": (sd or {}).get("causal_articulo") or em.get("causal_articulo"),
                   "texto": ((sd or {}).get("causal_texto") or em.get("causal_texto") or "")[:600] or None},
        "total_ofertado": monto if base in ("adjudicado", "contratado") else None,
        "total_estimado_mercado": finding["precio_mediana_mercado"],
        "sobreprecio_pct": diff_med,
        "veredicto_global": veredicto,
        "cobertura_mercado": 1.0 if veredicto != "sin_dato" else 0.0,
        "n_items": 1, "n_con_mediana": 1 if mediana is not None else 0,
        "confianza_global": ("alta" if n >= 3 else "media" if n == 2 else "baja"),
        "observaciones_clave": obs,
        "grounding_urls": [c["url"] for c in comparables],
        "_modo": "cotizaciones",
    }


# ── Entrada única ────────────────────────────────────────────────────
_ESTRATEGIA_FN = {
    "goods_retail": _mercado_goods_retail,
    "historico_seace": _mercado_historico_seace,
    "presupuesto_obra": _mercado_presupuesto_obra,
    "cotizaciones": _mercado_cotizaciones,
}


def analizar_mercado(state: dict, estrategia: str) -> dict:
    """Análisis de mercado según la estrategia del perfil. Escribe `state["market_analysis"]`
    (formato que consumen persist_market_flags_as_banderas y el frontend), publica las URLs
    reales en `state["grounding_urls"]`, registra `recortes`/`descartes` y devuelve un resumen.

    estrategia: "goods_retail" | "historico_seace" | "presupuesto_obra" | "cotizaciones".
    Nunca inventa referencias: sin base de comparación → `estado: "sin_dato"` explícito.
    """
    state.setdefault("grounding_urls", [])
    state.setdefault("descartes", [])
    state.setdefault("recortes", [])
    fn = _ESTRATEGIA_FN.get(estrategia)
    if fn is None:
        res = {"error": "estrategia_desconocida", "estrategia": estrategia, "validas": list(ESTRATEGIAS)}
        state["market_analysis"] = {"estado": "sin_dato", "estrategia": estrategia, "findings": [],
                                    "veredicto_global": "sin_dato", "observaciones_clave": [res["error"]]}
        return res
    t0 = time.time()
    try:
        out = fn(state)
    except Exception as e:
        _registrar_descarte(state, f"market.{estrategia}", "error", f"{type(e).__name__}: {str(e)[:200]}")
        out = {"estado": "sin_dato", "findings": [], "veredicto_global": "sin_dato",
               "observaciones_clave": [f"Análisis de mercado falló: {type(e).__name__}: {str(e)[:160]}"],
               "error": f"{type(e).__name__}: {str(e)[:200]}"}
    out["estrategia"] = estrategia
    out.setdefault("veredicto_global", "sin_dato")
    out.setdefault("findings", [])
    out["segundos"] = round(time.time() - t0, 1)
    out["n_descartes"] = len([d for d in state.get("descartes") or [] if str(d.get("donde", "")).startswith("market.")])
    state["market_analysis"] = out
    findings = out.get("findings") or []
    return {
        "ok": "error" not in out,
        "estrategia": estrategia,
        "estado": out.get("estado"),
        "n_items": len(findings),
        "n_con_mediana": sum(1 for f in findings if isinstance(f.get("precio_mediana_comparacion") or f.get("precio_mediana_mercado"), (int, float))),
        "veredicto_global": out.get("veredicto_global"),
        "sobreprecio_pct": out.get("sobreprecio_pct"),
        "cobertura": out.get("cobertura_mercado"),
        "n_grounding_urls": len(out.get("grounding_urls") or []),
        "n_descartes": out["n_descartes"],
        "segundos": out["segundos"],
        **({"error": out["error"]} if out.get("error") else {}),
    }


def analizar_mercado_por_estrategia(estrategia: str, tool_context: ToolContext) -> dict:
    """Tool: corre `analizar_mercado` sobre el state de la sesión.

    Args:
        estrategia: goods_retail | historico_seace | presupuesto_obra | cotizaciones.

    Returns:
        Resumen {ok, estrategia, estado, n_items, n_con_mediana, veredicto_global, ...}.
    """
    return analizar_mercado(tool_context.state, estrategia)


def analyze_market_sharded(ocid: str, tool_context: ToolContext) -> dict:
    """Compat: precia los ítems de la convocatoria (estrategia `goods_retail`). Equivale a
    `analizar_mercado(state, "goods_retail")`; el driver por perfil llama a esa función.

    Args:
        ocid: OCID o código corto de la convocatoria.

    Returns:
        Resumen {ok, n_items, n_con_mediana, cobertura, veredicto_global}.
    """
    state = tool_context.state
    if not (isinstance(state.get("market_input"), dict) and state["market_input"].get("items")):
        read_market_input(tool_context=tool_context)
    return analizar_mercado(state, "goods_retail")


# ── FunctionTool wrappers ──
list_items_for_pricing_tool = FunctionTool(func=list_items_for_pricing)
build_market_input_tool = FunctionTool(func=build_market_input)
record_market_finding_tool = FunctionTool(func=record_market_finding)
read_market_input_tool = FunctionTool(func=read_market_input)
analyze_market_sharded_tool = FunctionTool(func=analyze_market_sharded)
analizar_mercado_por_estrategia_tool = FunctionTool(func=analizar_mercado_por_estrategia)
