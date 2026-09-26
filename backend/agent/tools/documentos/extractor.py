"""Extracción estructurada sobre el texto OCR (llamada Gemini con schema), con
reintento por rango de páginas cuando el JSON llega truncado."""

from tools._core import *  # noqa: F401,F403
from ._base import PARSE_CALL_TIMEOUT_MS, PARSE_MAX_CHARS_POR_LLAMADA, PARSE_UNIT_WORKERS
from .schema import _parser_schema, secciones_para_documento, _schema_solo, descartes_de_este_hilo


# ── Extracción estructurada sobre el texto (con reintento por rango de páginas) ────────
_SYSTEM_LOTE = (
    "Sos un extractor experto en documentos del Sistema Electrónico de Contrataciones del Estado "
    "(SEACE) del Perú y del OECE (ex-OSCE): Bases Administrativas/Integradas, Términos de Referencia "
    "(TDR), Especificaciones Técnicas (EETT), Expedientes Técnicos, Resúmenes Ejecutivos e informes "
    "que sustentan una contratación directa, Actas de Buena Pro, Cuadros de evaluación, Contratos, "
    "Órdenes de compra/servicio, Adendas y Propuestas.\n\n"
    "ENTRADA: el TEXTO OCR del documento completo. Cada página empieza con un marcador ⟦p.N⟧ (N = número "
    "de página). Si el documento es un paquete (ZIP/RAR), cada archivo interno empieza con ⟦archivo: nombre⟧ "
    "y la numeración de páginas es continua a lo largo de todos los archivos.\n\n"
    "SALIDA: SOLO JSON conforme al schema. Sos un EXTRACTOR PURO: volcás HECHOS del documento a campos "
    "discretos. NO emitís juicios legales ni banderas de riesgo (eso lo hace otro agente sobre tu output).\n\n"
    "REGLAS DE INTEGRIDAD (innegociables):\n"
    "  · NUNCA inventes contenido. Si un dato no está en el texto, el campo va null / lista vacía. Preferí "
    "campo vacío a campo inventado. JAMÁS uses placeholders ni ejemplos de memoria (marcas, RUC, nombres, "
    "normas, cifras) que no aparezcan literalmente en el texto.\n"
    "  · EVIDENCIA OBLIGATORIA: cada ítem, postor, firmante, miembro de comité, motivo de adjudicación, "
    "estudio de mercado, contrato final y bloque del perfil lleva `evidencia: [{pagina, cita}]` con la "
    "página del marcador ⟦p.N⟧ donde aparece y una cita textual copiada tal cual (≤ 240 chars). Sin "
    "evidencia el dato no se persiste; con evidencia falsa (cita que no está en esa página) el dato se "
    "descarta y se cuenta como alucinación.\n"
    "  · `texto_literal` de cada ítem es un EXTRACTO LITERAL (copiado, sin resumir ni reescribir) del "
    "requerimiento técnico de ese ítem, hasta 4000 chars, con `texto_literal_paginas` = páginas que abarca. "
    "El resumen legible lo hace otro agente: vos no resumís.\n"
    "  · Copiá marcas, normas, cifras y nombres LITERALES del texto — no traduzcas, no normalices, no completes.\n"
    "  · PÁGINA = el número N del marcador ⟦p.N⟧ bajo el que está el texto que citás (índice real del archivo). "
    "NUNCA uses el número impreso al pie de la hoja (folio 'Página 22 de 69'): si lo ves, ponelo en `folio`.\n"
    "  · ETAPA DEL DOCUMENTO — precios y marcas van en el campo de SU etapa:\n"
    "      – BASES / INTEGRADAS / TDR / EETT / EXPEDIENTE / RESUMEN EJECUTIVO (requerimiento): "
    "`precio_unitario_referencial`, `cuantia_referencial_item`, `marca_o_modelo_exigido`. La marca exigida SOLO "
    "si el requerimiento dice literalmente 'marca', 'modelo', 'o equivalente' u 'o similar' junto a un nombre "
    "comercial; códigos de parte o accesorios con nombre propio NO son una marca exigida (van en texto_literal). "
    "`marca_ofertada`, `precio_unitario_ofertado` y `precio_unitario_contratado` quedan null.\n"
    "      – PROPUESTA / ACTA / CUADRO DE EVALUACIÓN: `precio_unitario_ofertado` y `marca_ofertada`; "
    "`precio_unitario_referencial` y `marca_o_modelo_exigido` null (aunque el acta repita el valor referencial: "
    "ese va en `cuantia_referencial_item`).\n"
    "      – CONTRATO / ORDEN DE COMPRA O SERVICIO / ADENDA: `precio_unitario_contratado`, `subtotal_contratado` y "
    "`marca_ofertada`; `precio_unitario_referencial` y `marca_o_modelo_exigido` null. La OC repite las EETT: eso "
    "NO la convierte en requerimiento (`contiene_requerimiento=false`).\n"
    "  · POSTORES: en reportes de propuestas, actas, cuadros y Formato 11 listá a TODOS los postores (ganador y "
    "perdedores) con su RUC, `monto_oferta` (sección 'precio de la oferta' / 'orden de prelación'), `puntaje`, "
    "`orden_prelacion` y `estado` (admitido / no_admitido / descalificado / desierto / participante_sin_oferta). "
    "Los proveedores INVITADOS (Comparación de Precios: formato de invitación / anexo) van en `invitados`, no en "
    "`postores`, salvo que además hayan ofertado.\n"
    "  · BASES / TDR / EETT / RESUMEN EJECUTIVO son PRE-adjudicación: NO tienen comité, motivos de adjudicación ni "
    "acta. En esos documentos dejá `comite_evaluacion=[]`, `motivos_adjudicacion=[]`, `lugar_fecha_acta=null`. "
    "Sí podés listar en `firmantes` a quienes FIRMAN el requerimiento/EETT (residente, inspector, área usuaria, "
    "jefe que aprueba) con `rol_en_documento='area_usuaria'` si su nombre y cargo son visibles (sellos/firmas). "
    "Comité, OEC, motivos y acta solo en ACTAS / CUADROS DE EVALUACIÓN / CONTRATOS.\n"
    "  · EVALUACIÓN Y CONSULTAS (`procedimiento_seleccion`): en bases/integradas volcá los factores de evaluación "
    "con su puntaje máximo; en actas/cuadros los puntajes por postor y factor; en el pliego de absolución cada "
    "consulta/observación (quién la hizo, tema, si se acogió y qué cambió en las bases); en bases integradas las "
    "modificaciones respecto de las bases originales y a pedido de quién.\n"
    "  · EJECUCIÓN (`ejecucion_contractual`): en adendas, resoluciones y cartas posteriores al contrato volcá "
    "ampliaciones de plazo (días pedidos, quién, resultado procedente/improcedente, acto que resuelve), penalidades "
    "aplicadas, adendas y entregas (prevista/real). Null en bases, actas de buena pro y OC originales.\n"
    "  · FIRMANTE válido solo si hay (a) DNI visible, o (b) entidad REAL con nombre concreto, o (c) firma "
    "legible al pie con nombre. Plantillas/proformas ('POSTOR 1', 'EL CONTRATISTA', 'Juan Pérez') → no van.\n"
    "  · El OBJETO del contrato viene del OCDS y debe coincidir con lo que extraés. Si tu extracción "
    "discrepa radicalmente, revisá tu lectura del texto.\n"
    "  · Si el texto es ilegible o está vacío: contiene_requerimiento=false, items=[], resumen='No se pudo "
    "extraer información legible del documento'.\n"
)


def _prompt_lote(label: str, bloque: str | None, ocds_ctx: dict, rango: tuple[int, int] | None,
                 tipo_hint: str | None) -> str:
    objeto = str(ocds_ctx.get("objeto") or "")[:600]
    entidad = str(ocds_ctx.get("entidad") or "")[:200]
    items_ocds = ocds_ctx.get("items") or []
    items_txt = "\n".join(f"  - ítem {i + 1}: {str(it)[:200]}" for i, it in enumerate(items_ocds[:40]))
    rango_txt = (f"Este texto cubre SOLO las páginas {rango[0]}-{rango[1]} del documento (extracción por rango: "
                 "extraé todo lo que haya en estas páginas; lo demás lo cubren otras llamadas).\n") if rango else ""
    bloque_txt = ""
    if bloque == "servicio":
        bloque_txt = ("BLOQUE `servicio` (perfil SERVICIOS/CONSULTORÍA): si el documento describe el servicio (TDR/Bases), "
                      "completá alcance (literal), actividades, entregables con plazo y % de pago, plazo total, personal "
                      "clave (cargo, profesión, años, dedicación), experiencia exigida al postor, tarifas (concepto/unidad/precio), "
                      "penalidades, si se permite subcontratar, forma de pago y lugar. Cada entregable/personal/tarifa con su página.\n")
    elif bloque == "obra":
        bloque_txt = ("BLOQUE `obra` (perfil OBRAS): expediente técnico (memoria literal, presupuesto total, partidas con "
                      "metrado/unidad/precio/parcial, GG % y utilidad %, plazo, cronograma), requisitos de residente y supervisor, "
                      "garantía de fiel cumplimiento, adelantos; y si es adenda/valorización: adicionales (n, monto, % acumulado, "
                      "motivo, resolución), ampliaciones de plazo y valorizaciones. Cada partida/adicional con su página.\n")
    elif bloque == "sustento_directa":
        bloque_txt = ("BLOQUE `sustento_directa` (perfil OTROS: directa/convenio/consultoría por causal): causal invocada "
                      "(artículo y texto LITERAL), informe técnico e informe legal (número, fecha, firmante), acto aprobatorio "
                      "(tipo, número, fecha), cotizaciones (proveedor, RUC, monto, fecha), justificación de proveedor único, fecha "
                      "de publicación en SEACE; para convenios: entidades parte, objeto, aportes, vigencia.\n")
    return (
        f"DOCUMENTO: {label}\n"
        + (f"Tipo declarado en SEACE: {tipo_hint}\n" if tipo_hint else "")
        + f"CONTEXTO OCDS — entidad: {entidad} · objeto: {objeto}\n"
        + (f"Ítems del OCDS (referencia para numerar; NO para inventar):\n{items_txt}\n" if items_txt else "")
        + rango_txt
        + "\nHacé esto, en orden:\n"
        "PASO 1 — `tipo_documento_detectado` por el contenido; `contiene_requerimiento` si hay sección REQUERIMIENTO / "
        "TDR / EETT / expediente técnico con detalle.\n"
        "PASO 2 — `items[]`: un objeto por ítem del proceso (cada fila de una tabla de ítems es un ítem; si el OCDS "
        "tiene 1 ítem que agrupa varios productos, sub-numerá 1.1, 1.2 con `padre_ocds_item`='1' y conservá el padre). "
        "Para cada ítem: campos discretos (cantidad, unidad, precio SEGÚN LA ETAPA del documento —referencial en bases, "
        "ofertado en propuesta/acta, contratado en contrato/OC—, marca exigida SOLO en bases y SOLO si el texto dice "
        "'marca'/'modelo'/'o equivalente', marca ofertada en OC/contrato/propuesta, normas, valores técnicos, garantía, "
        "entrega con tipo de días, requisitos del postor, penalidades, subitems) + `texto_literal` (extracto literal "
        "≤ 4000 chars) + `texto_literal_paginas` + `evidencia`.\n"
        "PASO 3 — `postores` (TODOS, con monto/puntaje/orden/estado) e `invitados` si el documento los lista; "
        "`comite_evaluacion`, `motivos_adjudicacion`, `lugar_fecha_acta` SOLO si es acta/cuadro/contrato; `firmantes` "
        "en actas/cuadros/contratos y, en bases, quienes firman el requerimiento (rol area_usuaria). Todo con evidencia y página.\n"
        "PASO 4 — `fundamento_legal`: normas citadas literalmente por el documento. `cuantia_reservada` si las bases dicen "
        "que el valor referencial no se publica.\n"
        "PASO 5 — `estudio_mercado` SOLO si es Resumen Ejecutivo / informe de sustento; `contrato_final` SOLO si es "
        "contrato / orden de compra o servicio firmado; `procedimiento_seleccion` si hay factores de evaluación, puntajes, "
        "consultas absueltas o modificaciones de la integración; `ejecucion_contractual` SOLO en documentos posteriores al "
        "contrato (adendas, resoluciones de ampliación, penalidades, entregas). En cualquier otro caso van null.\n"
        + (f"PASO 6 — {bloque_txt}" if bloque_txt else "")
        + "PASO FINAL — `cuantia_total`, `fuente_financiamiento`, `modalidad` y `resumen` (3-4 líneas del documento REAL).\n"
        "Devolvé SOLO JSON. Sin markdown, sin fences, sin texto antes ni después."
    )


def _finish_reason(resp) -> str:
    try:
        return str(resp.candidates[0].finish_reason or "")
    except Exception:
        return ""


def _llamar_extractor(texto: str, label: str, bloque: str | None, ocds_ctx: dict,
                      rango: tuple[int, int] | None, tipo_hint: str | None) -> tuple[dict, bool, dict]:
    """Una llamada Gemini sobre `texto`. Devuelve (data, truncado, uso)."""
    from google.genai import types as gtypes
    client = _gemini_client()
    model = os.getenv("PARSER_MODEL", DEFAULT_GEMINI_MODEL)
    cfg_kwargs = dict(
        response_mime_type="application/json",
        response_schema=_parser_schema(bloque, secciones_para_documento(label, tipo_hint)),
        max_output_tokens=65535,
        http_options=gtypes.HttpOptions(timeout=PARSE_CALL_TIMEOUT_MS),
        system_instruction=_SYSTEM_LOTE,
    )
    # Sin thinking_config el modelo pensaba en MEDIUM: 0,97 M tokens de razonamiento en
    # septiembre, cobrados como salida y comiéndose el tope de 65 k (más cortes por MAX_TOKENS).
    tc = thinking_crudo("extractor", model, "low")
    if tc is not None:
        cfg_kwargs["thinking_config"] = tc
    temp = os.getenv("PARSER_TEMPERATURE", "").strip()
    if temp:
        try:
            cfg_kwargs["temperature"] = float(temp)
        except ValueError:
            pass
    config = gtypes.GenerateContentConfig(**cfg_kwargs)
    parts = [
        gtypes.Part.from_text(text="═══ TEXTO OCR DEL DOCUMENTO (marcadores ⟦p.N⟧ por página) ═══\n" + texto),
        gtypes.Part.from_text(text=_prompt_lote(label, bloque, ocds_ctx, rango, tipo_hint)),
    ]
    descartados = descartes_de_este_hilo()
    t0 = time.monotonic()
    with _throttle_gemini():
        resp = _gemini_call_with_retry(lambda: client.models.generate_content(
            model=model, contents=parts, config=config))
    dt = time.monotonic() - t0
    raw_text = (resp.text or "").strip()
    fr = _finish_reason(resp)
    truncado = "MAX_TOKENS" in fr.upper()
    try:
        data = json.loads(raw_text)
    except Exception:
        data = _safe_parse_json(raw_text)
        truncado = True  # solo se pudo recuperar cerrando llaves → hubo corte
    if not isinstance(data, dict):
        data = {}
    # 2.ª pasada: los bloques que no cupieron en el schema (límite de Gemini) se piden aparte
    # sobre el mismo texto y se fusionan. Cuesta una llamada extra solo en documentos de
    # contrato/acta con perfil no-bienes.
    if descartados:
        try:
            cfg2 = dict(cfg_kwargs)
            cfg2["response_schema"] = _schema_solo(descartados, bloque)
            cfg2["max_output_tokens"] = 16384
            parts2 = [parts[0], gtypes.Part.from_text(text=(
                f"Del TEXTO OCR anterior extraé SOLO los bloques {descartados} (documento: {label}; "
                f"tipo declarado: {tipo_hint or 'desconocido'}). Si el documento no contiene ese bloque, devolvé null. "
                "Cada dato con `evidencia` (página y cita literal). Devolvé SOLO JSON."))]
            with _throttle_gemini():
                resp2 = _gemini_call_with_retry(lambda: client.models.generate_content(
                    model=model, contents=parts2, config=gtypes.GenerateContentConfig(**cfg2)))
            d2 = _safe_parse_json((resp2.text or "").strip()) or {}
            if isinstance(d2, dict):
                for k in descartados:
                    if d2.get(k) is not None and data.get(k) in (None, {}, []):
                        data[k] = d2[k]
            um2 = getattr(resp2, "usage_metadata", None)
            if um2:
                dt += 0.0
                data.setdefault("_uso_segunda_pasada", {"tokens_prompt": int(getattr(um2, "prompt_token_count", 0) or 0),
                                                       "tokens_output": int(getattr(um2, "candidates_token_count", 0) or 0),
                                                       "bloques": descartados})
        except Exception as e:  # noqa: BLE001 — la 2.ª pasada nunca tumba la extracción principal
            print(f"[lote] 2.ª pasada ({descartados}) falló: {str(e)[:120]}", flush=True)
    um = getattr(resp, "usage_metadata", None)
    uso = {"modelo": model, "segundos": round(dt, 1), "finish_reason": fr,
           "tokens_prompt": int(getattr(um, "prompt_token_count", 0) or 0) if um else 0,
           "tokens_output": int(getattr(um, "candidates_token_count", 0) or 0) if um else 0,
           "tokens_thoughts": int(getattr(um, "thoughts_token_count", 0) or 0) if um else 0}
    print(f"[lote-llm] {label[:50]} rango={rango} · {len(texto):,} chars → {uso['tokens_output']} tok out · "
          f"{dt:.0f}s · {fr}{' · TRUNCADO' if truncado else ''}", flush=True)
    return data, truncado, uso


def _merge_extraccion(a, b):
    """Fusión recursiva de dos extracciones (de rangos/llamadas distintas del MISMO doc):
    listas → concatenación con dedupe exacto; dicts → unión campo a campo; escalares →
    el primero no vacío."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = _merge_extraccion(a.get(k), v) if k in a else v
        return out
    if isinstance(a, list) and isinstance(b, list):
        out = list(a)
        seen = {json.dumps(x, sort_keys=True, default=str) for x in a}
        for x in b:
            key = json.dumps(x, sort_keys=True, default=str)
            if key not in seen:
                out.append(x)
                seen.add(key)
        return out
    if a in (None, "", [], {}):
        return b
    return a


def _texto_rango(paginas: list[dict], a: int, b: int) -> str:
    partes = []
    cur = None
    multi = len({p.get("archivo") for p in paginas}) > 1
    for p in paginas:
        if a <= p["n"] <= b:
            if multi and p.get("archivo") != cur:
                cur = p.get("archivo")
                partes.append(f"⟦archivo: {cur}⟧")
            partes.append(f"⟦p.{p['n']}⟧\n{p.get('texto') or ''}")
    return "\n".join(partes)


def _extraer_rango(paginas: list[dict], a: int, b: int, label: str, bloque: str | None, ocds_ctx: dict,
                   tipo_hint: str | None, recortes: list[dict], usos: list[dict], depth: int = 0,
                   rango_explicito: bool = False) -> dict:
    """Extrae las páginas [a, b]. Si el JSON llega truncado (MAX_TOKENS) y el rango tiene más
    de una página, se parte en dos y se re-pide cada mitad (hasta depth 2); si aun así se
    trunca, se registra el recorte y se devuelve lo recuperado con `_truncado=True`."""
    texto = _texto_rango(paginas, a, b)
    data, truncado, uso = _llamar_extractor(texto, label, bloque, ocds_ctx, (a, b) if rango_explicito else None, tipo_hint)
    usos.append({**uso, "rango": [a, b]})
    if not truncado:
        return data
    if b > a and depth < 2:
        mid = (a + b) // 2
        print(f"[lote] JSON truncado en págs {a}-{b} → re-pido {a}-{mid} y {mid + 1}-{b}", flush=True)
        left = _extraer_rango(paginas, a, mid, label, bloque, ocds_ctx, tipo_hint, recortes, usos, depth + 1, True)
        right = _extraer_rango(paginas, mid + 1, b, label, bloque, ocds_ctx, tipo_hint, recortes, usos, depth + 1, True)
        merged = _merge_extraccion(left, right)
        merged["_truncado"] = bool(left.get("_truncado") or right.get("_truncado"))
        return merged
    recortes.append({"donde": f"extraccion:{label[:80]}", "limite": "max_output_tokens=65535",
                     "omitido": f"páginas {a}-{b}: JSON truncado tras {depth} subdivisiones; se conserva lo recuperado"})
    data["_truncado"] = True
    return data


def _extraer_documento(tx: dict, label: str, bloque: str | None, ocds_ctx: dict, tipo_hint: str | None) -> dict:
    """Extracción estructurada de TODO el documento: se parte por páginas en llamadas de ≤
    PARSE_MAX_CHARS_POR_LLAMADA chars (nada se omite) y se fusiona. Devuelve la extracción con
    `_recortes`, `_usos` (tokens/tiempos por llamada) y `_truncado`."""
    paginas = tx["paginas"]
    recortes: list[dict] = []
    usos: list[dict] = []
    if not paginas:
        return {"_truncado": True, "_recortes": [{"donde": f"extraccion:{label[:80]}", "limite": "sin_texto", "omitido": label}],
                "_usos": [], "items": [], "resumen": "Documento sin texto extraíble"}
    # Rangos por chars
    rangos: list[tuple[int, int]] = []
    a = paginas[0]["n"]
    acc = 0
    for p in paginas:
        if acc + p["chars"] > PARSE_MAX_CHARS_POR_LLAMADA and acc > 0:
            rangos.append((a, p["n"] - 1))
            a = p["n"]
            acc = 0
        acc += p["chars"]
    rangos.append((a, paginas[-1]["n"]))
    if len(rangos) > 1:
        print(f"[lote] {label[:60]}: {tx['chars']:,} chars → {len(rangos)} llamadas por rango de páginas", flush=True)
    result: dict = {}
    if len(rangos) > 1 and PARSE_UNIT_WORKERS > 1:
        # Rangos de un mismo documento largo: llamadas independientes → en paralelo, fusión en
        # el orden de las páginas (los recortes/usos de cada rango se agregan tras el join).
        partes: list[dict | None] = [None] * len(rangos)
        recs: list[list] = [[] for _ in rangos]
        usos_r: list[list] = [[] for _ in rangos]
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(PARSE_UNIT_WORKERS, len(rangos))) as ex:
            futs = {ex.submit(_extraer_rango, paginas, ra, rb, label, bloque, ocds_ctx, tipo_hint,
                              recs[i], usos_r[i], 0, True): i for i, (ra, rb) in enumerate(rangos)}
            for fut in concurrent.futures.as_completed(futs):
                i = futs[fut]
                try:
                    partes[i] = fut.result()
                except Exception as e:
                    ra, rb = rangos[i]
                    recs[i].append({"donde": f"extraccion:{label[:80]}", "limite": "error_llamada",
                                    "omitido": f"páginas {ra}-{rb}: {type(e).__name__}: {str(e)[:120]}"})
                    partes[i] = {"_truncado": True}
        for i, parte in enumerate(partes):
            recortes.extend(recs[i])
            usos.extend(usos_r[i])
            result = _merge_extraccion(result, parte) if result else (parte or {})
    else:
        for i, (ra, rb) in enumerate(rangos):
            parte = _extraer_rango(paginas, ra, rb, label, bloque, ocds_ctx, tipo_hint, recortes, usos,
                                   rango_explicito=len(rangos) > 1)
            result = _merge_extraccion(result, parte) if result else parte
    result["_truncado"] = bool(result.get("_truncado")) or any(r.get("limite", "").startswith("max_output") for r in recortes)
    result["_recortes"] = recortes
    result["_usos"] = usos
    return result
