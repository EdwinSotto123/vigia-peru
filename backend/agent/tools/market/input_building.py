"""Tools del dominio: market."""

from tools._core import *  # noqa: F401,F403
from .normalizar import (_UNIDADES_MEDIDA, _coincide_objeto, _market_to_num,
    _solape_raices, _unidad_canon)

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


