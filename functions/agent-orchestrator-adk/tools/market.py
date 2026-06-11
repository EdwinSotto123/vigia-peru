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
                      precio_unit_ref, cuantia_referencial
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
    if len(llm_items) > len(parser_items):
        parser_items = llm_items

    # Indexar parser_items por número
    parser_by_num: dict = {}
    for pi in parser_items:
        if not isinstance(pi, dict):
            continue
        num = str(pi.get("numero") or "")
        if not num:
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
                "precio_unitario_ofertado": None,
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
        merged["precio_unitario_ofertado"] = (
            ofertas_by_num.get(num) / max(merged.get("cantidad") or 1, 1)
            if ofertas_by_num.get(num) else None
        )
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
            "precio_unitario_ofertado": None,
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
        "extraído de las Bases Administrativas. Usá `requerimiento_tecnico_detallado` "
        "como contexto principal para construir queries específicas; NO te bases solo "
        "en `descripcion_corta`."
        if n_con_req > 0 else
        "No se pudo extraer requerimiento técnico detallado de las Bases (posiblemente "
        "el PDF era escaneado o el parser falló). Trabajá con descripcion_corta y marcá "
        "tus findings como es_estimacion=true con motivo_estimacion='requerimiento_no_disponible'."
    )
    mensaje_lote = ""
    if padres_info:
        p = padres_info[0]
        mensaje_lote = (
            f" Estos {p['n_subitems']} sub-ítems pertenecen a un LOTE OCDS de S/. "
            f"{(p.get('cuantia_total') or 0):,.2f} TOTAL (este es el monto OFERTADO por el "
            f"postor adjudicado para todo el lote — el ítem padre no se incluye "
            f"abajo porque sus sub-ítems lo componen). Para cada sub-ítem emití "
            f"1 finding con su `precio_mediana_mercado` y su `cantidad`. EN EL JSON "
            f"DE SALIDA llená `total_ofertado={p['cuantia_total']:.2f}` y "
            f"`total_estimado_mercado` = suma(cantidad × mediana_mercado) de cada "
            f"sub-ítem. Calculá `sobreprecio_pct = (total_ofertado - total_estimado_mercado) / "
            f"total_estimado_mercado * 100` y `veredicto_global` ('alineado' si |Δ|<15, "
            f"'elevado' si 15-50, 'muy_elevado' si ≥50, 'barato' si Δ≤-15). En el "
            f"`comentario_global` explicá la comparación contra el lote total."
        )

    out = {
        "ocid": ocid,
        "items": items_finales,
        "n_items": len(items_finales),
        "n_items_con_requerimiento_extraido": n_con_req,
        "n_items_con_precio_distribuido": n_con_precio_distribuido,
        "n_padres_excluidos": len(skipped_padres),
        "n_auto_linked": n_auto_linked,
        "distributions_applied": distributions_applied,
        "padres_info": padres_info,
        "padre_lote": padres_info[0] if padres_info else None,
        "tiene_requerimiento": n_con_req > 0,
        "mensaje_para_market_agent": mensaje_base + mensaje_lote,
    }
    return out

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
        return {"error": "no hay OCDS en state — ejecutá fetch_ocds_record primero",
                "items": []}
    # Normalizar al formato corto que usa SQL — bug detectado 2026-05-24
    ocid = _short_ocid(ocid_raw)
    result = build_market_input(ocid=ocid, tool_context=tool_context)
    state["market_input"] = result
    return result

# ════════════════════════════════════════════════════════════════════
# FAN-OUT de precios de mercado — reemplaza al market_price_agent monolítico
# ════════════════════════════════════════════════════════════════════
# Problema: un solo agente con 80+ ítems × "mínimo 8 búsquedas c/u" = cientos de
# tool-calls en un turno → tope de iteraciones/tokens → solo preciaba ~6 ítems.
# Solución: partir en chunks de ~10 y preciar EN PARALELO con N llamadas Gemini
# + google_search (grounding). Cada worker ve solo sus ~10 ítems → sí alcanza.

MARKET_WORKER_MODEL = os.getenv("MARKET_WORKER_MODEL", "gemini-2.5-flash")
# Ítems por worker. Más chico = cada worker hace las ~6 búsquedas/ítem de verdad
# (con 5 ítems el Flash sólo alcanzaba a preciar ~2 y dejaba el resto en null).
MARKET_CHUNK_SIZE = int(os.getenv("MARKET_CHUNK_SIZE", "3"))
MARKET_MAX_WORKERS = int(os.getenv("MARKET_MAX_WORKERS", "8"))
# Segundo pase: re-precia los ítems que quedaron sin mediana en la 1ª ronda.
MARKET_RETRY = os.getenv("MARKET_RETRY", "1") == "1"
# Timeout total del fan-out: si algún worker se cuelga, devolvemos lo que haya
# (no bloqueamos el análisis entero).
MARKET_TIMEOUT_S = int(os.getenv("MARKET_TIMEOUT_S", "300"))

_MARKET_WORKER_RULES = """
REGLAS (aplicá a CADA ítem de tu lote):
1. Hacé MÍNIMO 6 búsquedas Google por ítem, priorizando mercado peruano:
   site:mercadolibre.com.pe, site:plazavea.com.pe, site:tottus.com.pe,
   site:sodimac.com.pe, site:promart.pe, más "<producto> precio mayorista Perú".
   Usá marca/modelo/specs LITERALES del requerimiento; no busques genérico.
2. PRECIO MAYORISTA POR VOLUMEN: si cantidad 20-99 aplicá -10% al retail; 100-499 -20%;
   500-1999 -25%; ≥2000 -30%. Antes de aplicar el factor, intentá precio mayorista REAL.
3. Cada precio observado DEBE tener `url` real y navegable. Sin URL, el precio NO va.
   Mínimo 3 precios de fuentes distintas (o confianza 'media'/'baja' si hay 1-2).
4. precio_mediana_mercado = mediana NUMÉRICA de los precios observados (OBLIGATORIO
   llenarlo con un número si hay ≥1 precio; null solo si no encontraste ninguno).
5. diff_pct = (ofertado o referencial − mediana)/mediana × 100.
   veredicto: |Δ|<15 'alineado' · 15≤Δ<50 'elevado' · Δ≥50 'muy_elevado' ·
   Δ≤-15 'barato' · sin precios fiables 'estimacion'.
6. spec_restrictiva: si exige UNA marca/cert atípica que reduce competencia, anotalo; si no, null.
7. NO inventes precios ni URLs. Si no encontrás nada, precios_observados=[],
   precio_mediana_mercado=null, veredicto='estimacion', y explicalo en comentario.

FORMATO POR FINDING (un objeto por ítem, usando su `numero` como item_numero):
{
 "item_numero": "<numero del ítem>", "item_descripcion": "<descripcion_corta>",
 "cantidad": <num>, "unidad": "<unidad>",
 "precio_unitario_referencial": <num|null>, "precio_unitario_ofertado": <num|null>,
 "precios_observados": [{"valor": <num>, "url": "<url>", "proveedor": "<nombre>",
                          "producto_titulo": "<modelo>", "tipo": "marketplace|distribuidor"}],
 "proveedores_potenciales": [{"nombre": "<x>", "url": "<x>"}],
 "caracteristicas_solicitadas_clave": ["<spec1>", "<spec2>"],
 "precio_mediana_mercado": <num|null>, "rango_min": <num|null>, "rango_max": <num|null>,
 "diff_pct": <num|null>, "veredicto": "<alineado|elevado|muy_elevado|barato|estimacion>",
 "es_estimacion": <bool>, "motivo_estimacion": <str|null>,
 "spec_restrictiva": <str|null>, "comentario": "<2-4 líneas factuales>"
}
"""


def _price_market_chunk(items_chunk: list, objeto: str, idx: int) -> dict:
    """Worker: precia ~10 ítems con UNA llamada Gemini + google_search."""
    from google.genai import types
    items_json = json.dumps(items_chunk, ensure_ascii=False)
    prompt = (
        "Sos un analista de precios de mercado peruano. Tu herramienta es Google "
        "Search (grounding en vivo).\n\n"
        f"OBJETO DEL CONTRATO: {objeto[:300]}\n"
        "⚠ Cada item_descripcion DEBE corresponder a ese objeto. NO inventes "
        "productos de otros rubros (no copies ejemplos de máquinas/vehículos).\n\n"
        f"ÍTEMS A PRECIAR EN ESTE LOTE ({len(items_chunk)}):\n{items_json}\n"
        f"{_MARKET_WORKER_RULES}\n"
        "Devolvé SOLO JSON puro (sin fences, sin texto extra): "
        '{"findings": [ ...un objeto por cada ítem del lote... ]}'
    )
    client = _gemini_client()
    cfg = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())],
        temperature=0.2,
        max_output_tokens=32768,
    )

    # NO usamos _throttle_gemini() acá: ese semáforo global es de tamaño 2 y, al
    # sostenerlo durante toda la llamada grounded (1-2 min), serializaría los
    # workers y mataría el paralelismo. La concurrencia ya está acotada por el
    # ThreadPool (MARKET_MAX_WORKERS); los 429 los maneja el retry exponencial.
    def _call():
        return client.models.generate_content(
            model=MARKET_WORKER_MODEL, contents=prompt, config=cfg
        )

    resp = _gemini_call_with_retry(_call)
    data = _safe_parse_json(getattr(resp, "text", "") or "")
    findings = data.get("findings") if isinstance(data, dict) else None
    return {"idx": idx, "findings": findings or []}


def _market_to_num(x):
    """Coerce un precio a float. Acepta números y strings tipo 'S/ 1,200.50',
    '1.200,50', '120 soles'. Devuelve None si no es un número positivo."""
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return float(x) if x > 0 else None
    if not isinstance(x, str):
        return None
    import re
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


def _market_median(f) -> float | None:
    return _market_to_num(f.get("precio_mediana_mercado")) if isinstance(f, dict) else None


def _run_market_fanout(items_to_price: list, objeto: str) -> tuple:
    """Lanza el fan-out de workers sobre items_to_price. Devuelve
    (findings, n_chunks, errores, timeouts)."""
    chunks = [items_to_price[i:i + MARKET_CHUNK_SIZE]
              for i in range(0, len(items_to_price), MARKET_CHUNK_SIZE)]
    found: list = []
    errores = 0
    timeouts = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=MARKET_MAX_WORKERS) as ex:
        futs = [ex.submit(_price_market_chunk, ch, objeto, i) for i, ch in enumerate(chunks)]
        try:
            for fut in concurrent.futures.as_completed(futs, timeout=MARKET_TIMEOUT_S):
                try:
                    found.extend(fut.result().get("findings") or [])
                except Exception as e:
                    errores += 1
                    print(json.dumps({"market_shard_error": str(e)[:200]}), flush=True)
        except concurrent.futures.TimeoutError:
            timeouts = sum(1 for f in futs if not f.done())
            print(json.dumps({"market_fanout_timeout": True, "chunks_pendientes": timeouts}), flush=True)
    return found, len(chunks), errores, timeouts


def analyze_market_sharded(ocid: str, tool_context: ToolContext) -> dict:
    """Precia los ítems de la convocatoria en PARALELO (fan-out). Parte la lista
    en chunks de ~10 y lanza N workers Gemini + google_search a la vez, luego
    mergea los findings y recalcula totales + cobertura. Reemplaza al
    market_price_agent (que se saturaba con 80+ ítems y solo preciaba ~6).
    Escribe el resultado en state['market_analysis'] con el MISMO formato que
    consumían el frontend y persist_market_flags_as_banderas.

    Args:
        ocid: OCID o código corto de la convocatoria.

    Returns:
        Resumen {n_items, n_chunks, n_con_mediana, cobertura, veredicto_global}.
    """
    state = tool_context.state
    mi = state.get("market_input")
    if not (isinstance(mi, dict) and mi.get("items")):
        mi = read_market_input(tool_context=tool_context)  # self-contained
    items = (mi or {}).get("items") or []
    if not items:
        return {"error": "no_market_input",
                "hint": "Ejecutá fetch_ocds_record/build_market_input primero."}

    ocds = state.get("ocds") or {}
    tender = ocds.get("tender") or {}
    objeto = tender.get("title") or tender.get("description") or ""
    padre_lote = mi.get("padre_lote") if isinstance(mi.get("padre_lote"), dict) else None
    tiene_req = bool(mi.get("tiene_requerimiento"))

    # ── 1ª ronda: fan-out sobre todos los ítems ──
    all_findings, n_chunks, errores, timeouts = _run_market_fanout(items, objeto)

    # ── 2º pase: re-precia los ítems que quedaron sin mediana numérica ──
    n_retry_recuperados = 0
    if MARKET_RETRY:
        priced = {str(f.get("item_numero")) for f in all_findings if _market_median(f) is not None}
        faltantes = [it for it in items if str(it.get("numero")) not in priced]
        if faltantes:
            extra, n_ch2, e2, t2 = _run_market_fanout(faltantes, objeto)
            errores += e2; timeouts += t2; n_chunks += n_ch2
            by_num = {str(f.get("item_numero")): f for f in extra
                      if isinstance(f, dict) and _market_median(f) is not None}
            for num, f in by_num.items():
                replaced = False
                for i, ex_f in enumerate(all_findings):
                    if isinstance(ex_f, dict) and str(ex_f.get("item_numero")) == num:
                        if _market_median(ex_f) is None:
                            all_findings[i] = f
                            n_retry_recuperados += 1
                        replaced = True
                        break
                if not replaced:
                    all_findings.append(f)
                    n_retry_recuperados += 1

    # Normalizá la mediana a número (el modelo a veces la devuelve como string
    # tipo 'S/ 1,200.50'): así no descartamos ítems que SÍ tienen precio.
    for f in all_findings:
        if isinstance(f, dict):
            m = _market_median(f)
            if m is not None:
                f["precio_mediana_mercado"] = m

    # Totales + cobertura (misma lógica que el guard del frontend/persist)
    n_total = len(items)
    con_mediana = [f for f in all_findings
                   if isinstance(f, dict) and isinstance(f.get("precio_mediana_mercado"), (int, float))]
    n_con_mediana = len(con_mediana)
    cobertura = (n_con_mediana / n_total) if n_total else 0.0
    total_mercado = 0.0
    for f in con_mediana:
        cant = f.get("cantidad")
        if isinstance(cant, (int, float)):
            total_mercado += f["precio_mediana_mercado"] * cant
    total_ofertado = (float(padre_lote["cuantia_total"])
                      if padre_lote and isinstance(padre_lote.get("cuantia_total"), (int, float))
                      else None)

    sobreprecio_pct = None
    veredicto_global = "cobertura_parcial"
    if cobertura >= 0.7 and total_ofertado and total_mercado:
        sobreprecio_pct = (total_ofertado - total_mercado) / total_mercado * 100
        veredicto_global = ("muy_elevado" if sobreprecio_pct >= 50 else
                            "elevado" if sobreprecio_pct >= 15 else
                            "barato" if sobreprecio_pct <= -15 else "alineado")

    market_analysis = {
        "findings": all_findings,
        "total_ofertado": total_ofertado,
        "total_estimado_mercado": round(total_mercado, 2) if total_mercado else None,
        "sobreprecio_pct": round(sobreprecio_pct, 2) if isinstance(sobreprecio_pct, (int, float)) else None,
        "veredicto_global": veredicto_global,
        "cobertura_mercado": round(cobertura, 3),
        "n_items": n_total,
        "n_con_mediana": n_con_mediana,
        "n_chunks": n_chunks,
        "confianza_global": ("alta" if cobertura >= 0.8 else "media" if cobertura >= 0.5 else "baja"),
        "requerimiento_disponible_para_analisis": tiene_req,
        "observaciones_clave": (
            [f"Preciados {n_con_mediana}/{n_total} ítems con mediana de mercado "
             f"(cobertura {cobertura*100:.0f}%) vía fan-out de {n_chunks} workers paralelos "
             f"(chunk={MARKET_CHUNK_SIZE})."]
            + ([f"2º pase recuperó {n_retry_recuperados} ítem(s) sin precio en la 1ª ronda."]
               if n_retry_recuperados else [])
            + ([f"{errores} chunk(s) fallaron y se omitieron."] if errores else [])
            + ([f"{timeouts} chunk(s) excedieron el timeout de {MARKET_TIMEOUT_S}s."] if timeouts else [])
        ),
        "_modo": "sharded_fanout",
    }
    state["market_analysis"] = market_analysis
    return {"ok": True, "n_items": n_total, "n_chunks": n_chunks,
            "n_con_mediana": n_con_mediana, "cobertura": round(cobertura, 3),
            "n_retry_recuperados": n_retry_recuperados,
            "veredicto_global": veredicto_global, "errores_chunks": errores}


# ── FunctionTool wrappers ──
list_items_for_pricing_tool = FunctionTool(func=list_items_for_pricing)
build_market_input_tool = FunctionTool(func=build_market_input)
record_market_finding_tool = FunctionTool(func=record_market_finding)
read_market_input_tool = FunctionTool(func=read_market_input)
analyze_market_sharded_tool = FunctionTool(func=analyze_market_sharded)
