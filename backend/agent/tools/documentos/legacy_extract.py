"""Parser legacy (tool del LlmAgent, por URL, sin caché entre corridas): llamada Gemini
sobre un PDF (o PDF sintético de páginas de texto) con layout híbrido texto+Vision."""

from tools._core import *  # noqa: F401,F403
from tools.costo_llm import etiquetas
from ._base import PARSE_CALL_TIMEOUT_MS
from .pdf_utils import _analyze_pdf_layout, _render_pdf_pages_to_png
from .schema import _parser_schema
from .extractor import _finish_reason


def _paginas_a_pdf_sintetico(paginas: list[dict]) -> bytes | None:
    """Páginas de texto ({texto}) → PDF sintético (una página A4 por entrada) para el
    pipeline legacy de parse_document_pdf."""
    try:
        import fitz
    except Exception:
        return None
    out = fitz.open()
    try:
        for p in paginas:
            page = out.new_page(width=595, height=842)
            try:
                page.insert_textbox(fitz.Rect(36, 36, 559, 806), str(p.get("texto") or "")[:6000],
                                    fontsize=9, fontname="helv")
            except Exception:
                pass
        if len(out) == 0:
            return None
        return out.tobytes()
    finally:
        out.close()


def _parse_single_pdf_with_gemini(blob: bytes, source_label: str) -> dict:
    """Procesa un PDF (bytes) con Gemini. Devuelve dict con extracción
    o {"error": ...}.

    Estrategia híbrida:
      1. Analiza la layout del PDF con PyMuPDF.
      2. Si hay páginas con texto < 300 chars + imagen cubriendo > 25% del área
         (típico cuando el REQUERIMIENTO está rasterizado como imagen embebida),
         renderiza esas páginas a PNG 160 DPI y se las pasa a Gemini como
         `image/png` parts adicionales junto con el PDF.
      3. Gemini hace OCR visual de alta calidad sobre los PNGs y combina con el
         texto extraíble del resto del PDF.
    """
    from google.genai import types as gtypes
    client = _gemini_client()

    # ── Análisis layout ─────────────────────────────────────────────
    layout = _analyze_pdf_layout(blob)

    # ── Document AI OCR (per-use): texto del shard en UNA llamada barata.
    #    Si funciona, a Gemini le pasamos el TEXTO (no PNGs rasterizados) →
    #    menos tokens, más rápido, mejor extracción. Si falla o no está
    #    configurado, caemos al render histórico de PNGs (sin romper nada). ──
    docai_text: str | None = None
    try:
        from tools.docai import extract_text_docai
        docai_text = extract_text_docai(blob)
    except Exception as _e:
        print(f"[docai] caller error ({type(_e).__name__}: {str(_e)[:160]})", flush=True)
        docai_text = None
    print(
        f"[docai] {source_label[:55]} → "
        + (f"TEXTO {len(docai_text):,} chars (Gemini sobre texto)" if docai_text
           else "None → fallback render+Gemini Vision"),
        flush=True,
    )

    # Con texto OCR no hace falta rasterizar páginas (el OCR ya cubre las
    # rasterizadas). Sin texto OCR → render como antes.
    pages_to_render = [] if docai_text else (layout.get("needs_render_pages") or [])[:_MAX_RENDER_PAGES]
    rendered: list[tuple[int, bytes]] = []
    if pages_to_render:
        rendered = _render_pdf_pages_to_png(blob, pages_to_render, dpi=160)
    schema = _parser_schema(None)
    _cfg_extra = {}
    _t = os.getenv("PARSER_TEMPERATURE", "").strip()
    if _t:
        try:
            _cfg_extra["temperature"] = float(_t)
        except ValueError:
            pass
    config = gtypes.GenerateContentConfig(
        **_cfg_extra,
        response_mime_type="application/json",
        response_schema=schema, max_output_tokens=65535,
        http_options=gtypes.HttpOptions(timeout=PARSE_CALL_TIMEOUT_MS),  # techo por-llamada
        labels=etiquetas("extractor_legado"),
        system_instruction=(
            "Sos un extractor experto en documentos del Sistema Electrónico de "
            "Contrataciones del Estado (SEACE) del Perú y del Organismo Especializado "
            "para las Contrataciones Eficientes del Estado (OECE / ex-OSCE). "
            "Procesás Bases Administrativas, Términos de Referencia (TDR), "
            "Especificaciones Técnicas (EETT), Expedientes Técnicos, Actas de Buena "
            "Pro, Contratos y Propuestas Económicas.\n"
            "\n"
            "ENTRADA: vas a recibir UN PDF en `application/pdf`. ADEMÁS, en muchos "
            "casos vas a recibir entre 1 y 30 imágenes PNG ADICIONALES. Esas imágenes "
            "son RENDERS A 160 DPI de páginas específicas del MISMO PDF cuyo "
            "contenido está rasterizado como imagen embebida (típico en bases del "
            "OECE — la sección REQUERIMIENTO viene casi siempre como imagen pegada en "
            "un PDF, NO como texto). El prompt del usuario te indica el número de "
            "página al que corresponde cada PNG. DEBÉS combinar el texto extraíble "
            "del PDF con el contenido de las imágenes para reconstruir la información "
            "completa. SIN las imágenes el REQUERIMIENTO no se ve.\n"
            "\n"
            "MISIÓN CRÍTICA: localizar la sección 'REQUERIMIENTO' (también llamada "
            "'Términos de Referencia', 'Especificaciones Técnicas', 'Características "
            "Técnicas del Bien', 'Características Técnicas del Servicio', 'Alcance "
            "del Servicio' o 'Características de la Obra') y EXTRAERLA A CAMPOS "
            "ESTRUCTURADOS — no transcribir, no perder información, no truncar.\n"
            "\n"
            "⚠ ANTI-ALUCINACIÓN — REGLA CRÍTICA DE INTEGRIDAD:\n"
            "  · NUNCA INVENTES contenido. Si no podés leer claramente el texto del\n"
            "    PDF (porque está mal rasterizado, las imágenes adjuntas no son\n"
            "    legibles, o el PDF aparenta estar dañado), respondé:\n"
            "      contiene_requerimiento=false\n"
            "      items=[]\n"
            "      resumen='No se pudo extraer información legible del documento'\n"
            "    NO completes con un caso 'genérico' o 'plantilla' (ej. servicio de\n"
            "    limpieza, kit de útiles, broca traumatológica) basado en tu memoria\n"
            "    de bases administrativas peruanas. Si NO está EN EL DOCUMENTO,\n"
            "    NO existe.\n"
            "  · El OBJETO DEL CONTRATO viene en el OCDS (entregado por la entidad)\n"
            "    y debe coincidir con lo que extraés del PDF. Si tu extracción\n"
            "    discrepa radicalmente del objeto OCDS (ej. OCDS dice 'codeína\n"
            "    fosfato' pero el PDF según vos habla de 'limpieza'), prioritariamente\n"
            "    revisá si te equivocaste leyendo el PDF — probablemente el PDF\n"
            "    SÍ habla de codeína y vos lo malinterpretaste.\n"
            "\n"
            "\n"
            "REGLAS DE EXTRACCIÓN ESTRUCTURADA (no perder NADA relevante):\n"
            "  · Sos un EXTRACTOR ESTRUCTURADO. Tu trabajo es leer el documento y\n"
            "    volcar TODA la información relevante a CAMPOS DISCRETOS. Cada dato\n"
            "    tiene su lugar específico en el schema:\n"
            "      - Marca/modelo →  `marca_o_modelo_exigido` (string)\n"
            "      - Normas técnicas →  `certificaciones_exigidas` (lista corta)\n"
            "      - Valores numéricos (potencia, capacidad, año, peso, alcance)\n"
            "        →  `valores_tecnicos_clave` (objeto con campos numéricos discretos)\n"
            "      - Garantía →  `garantia` (objeto: meses, horas, alcance)\n"
            "      - Plazo y lugar de entrega →  `condiciones_entrega` (objeto)\n"
            "      - Requisitos al postor (experiencia mínima en soles, años,\n"
            "        certificaciones del postor como 'concesionario MTC', infra)\n"
            "        →  `requisitos_postor` (objeto)\n"
            "      - Penalidades (causal + % + base de cálculo)\n"
            "        →  `penalidades` (lista de objetos)\n"
            "      - Si el ítem es un PAQUETE/LOTE/CANASTA con N productos\n"
            "        adentro (típico en bases de alimentos, kits escolares)\n"
            "        →  `subitems` (lista anidada, NO uses sub-numeración\n"
            "        en items[] para esto; usá esta lista)\n"
            "      - El requerimiento del ítem, LITERAL (sin resumir, ≤ 4000 chars)\n"
            "        →  `texto_literal` + `texto_literal_paginas` + `evidencia` [{pagina, cita}]\n"
            "\n"
            "  · La spec técnica va en CAMPOS DISCRETOS y, además, copiada LITERAL en\n"
            "    `texto_literal` (hasta 4000 chars por ítem). NO resumas ni reescribas.\n"
            "  · EVIDENCIA: cada ítem/postor/firmante/comité/motivo lleva `evidencia`\n"
            "    [{pagina, cita}] con la página del marcador ⟦p.N⟧ y una cita textual.\n"
            "\n"
            "  · NO inventés especificaciones que no estén en el PDF/imágenes. Si un\n"
            "    campo no aparece, dejalo null.\n"
            "\n"
            "  · Asociás cada bloque de requerimiento con su NÚMERO DE ÍTEM "
            "(Ítem 1, Ítem 2, etc.). Si el documento tiene un solo ítem global, todo "
            "el REQUERIMIENTO se asocia a ese ítem.\n"
            "  · Si en el PDF figuran TABLAS de ítems (frecuente en bases para "
            "alimentos, uniformes, medicamentos, útiles), cada FILA de la tabla suele "
            "ser un ítem independiente — extraé un objeto en `items[]` por cada fila.\n"
            "  · NO inventás especificaciones que no estén en el PDF/imágenes.\n"
            "  · Si el documento NO contiene la sección REQUERIMIENTO (ej. es solo un "
            "acta o un contrato), dejá `contiene_requerimiento=false` y "
            "`texto_literal=null` en cada ítem.\n"
            "  · Detectás marcas/modelos explícitos que aparezcan en el documento, "
            "y por separado las certificaciones/normas técnicas (MTC, Euro, Tier, "
            "ISO, NTP, DIGESA, SENASA, ASTM, EPA, etc.). Copiá los strings LITERALES "
            "del PDF — no traduzcas, no normalices, no completes con tu memoria.\n"
            "  · Identificás 'red flags' documentales: especificaciones que restringen "
            "competencia (marca única sin 'o similar', certificación atípica, plazos "
            "ultra-cortos, experiencia desproporcionada, lotes empaquetados sin "
            "justificación).\n"
            "\n"
            "EXTRACCIÓN OBLIGATORIA (CRÍTICO PARA EL PIPELINE INVESTIGATIVO):\n"
            "\n"
            "  · `firmantes`: TODA persona que firma el documento al pie. Suele estar\n"
            "    en la última página con título, nombre, cargo y firma. Capturá nombre\n"
            "    completo, DNI (si aparece), cargo institucional, rol respecto al\n"
            "    documento (aprobador / evaluador / presidente_comite / representante_proveedor /\n"
            "    testigo) y entidad. ESPECIALMENTE en actas de buena pro y contratos.\n"
            "    Este dato es lo que cruzaremos con el gerente del proveedor para\n"
            "    detectar parentezco o cargo previo compartido.\n"
            "\n"
            "  · `comite_evaluacion`: composición del Comité de Selección / Comisión\n"
            "    Evaluadora si el documento lo lista. Capturá nombre, cargo, rol\n"
            "    (presidente/miembro_titular/miembro_suplente/secretario) y certificación\n"
            "    SICAN si se menciona.\n"
            "\n"
            "  · `motivos_adjudicacion`: si es Acta de Buena Pro o Reporte, para CADA\n"
            "    postor ganador documentá: por qué ganó (criterio_decisivo: 'menor\n"
            "    precio', 'único postor admitido', 'mejor calificación técnica', 'sorteo'),\n"
            "    posición en ranking, observaciones del comité (descalificaciones de\n"
            "    otros postores, ajustes de precio, etc.), competidores_descalificados\n"
            "    con razones específicas.\n"
            "\n"
            "  · `lugar_fecha_acta`: lugar, fecha y hora de emisión cuando aplique.\n"
            "\n"
            "🚨 BASES ADMINISTRATIVAS ≠ ACTA DE BUENA PRO 🚨\n"
            "Las BASES ADMINISTRATIVAS se publican ANTES de la convocatoria. NO\n"
            "tienen ni firmantes del comité, ni motivos de adjudicación, ni acta\n"
            "de buena pro. Esos datos solo existen en documentos posteriores:\n"
            "Acta de Buena Pro, Contrato firmado, Cuadro de Evaluación.\n"
            "Si el documento que estás procesando es BASES ADMINISTRATIVAS o\n"
            "TÉRMINOS DE REFERENCIA, dejá `firmantes=[]`, `motivos_adjudicacion=[]`,\n"
            "`comite_evaluacion=[]`, `lugar_fecha_acta=null`. NO inventes un\n"
            "comité de selección, ni un Presidente del Comité, ni una fecha de\n"
            "firma — eso es alucinación.\n"
            "\n"
            "Si el documento NO es un acta / reporte / contrato (ej. son bases\n"
            "administrativas puras), dejá `firmantes=[]`, `motivos_adjudicacion=[]`,\n"
            "`comite_evaluacion=[]`, `lugar_fecha_acta=null`. NO inventes nombres,\n"
            "cargos, RUCs, entidades, lugares ni fechas. JAMÁS uses placeholders\n"
            "tipo 'LUGAR_ACTA_EXAMPLE', 'FIRMANTE_ACTA_EXAMPLE', 'CARGO_EXAMPLE',\n"
            "'POSTOR_1_EXAMPLE', 'ENTIDAD_CONTRATANTE_EXAMPLE', '12345678901',\n"
            "'Nombre Apellido', 'Funcionario X', 'Juan Perez Quispe', 'Juan Pérez',\n"
            "ni cualquier valor genérico — son alucinaciones. Si el dato no está\n"
            "en el PDF, el campo va vacío/null. PREFERÍ campo vacío a campo\n"
            "inventado.\n"
            "\n"
            "REGLA DURA — VALIDACIÓN DE FIRMANTE:\n"
            "Para emitir un objeto en `firmantes[]` DEBÉS tener AL MENOS UNO de:\n"
            "  (a) DNI explícito del firmante (8 dígitos visibles en el PDF), o\n"
            "  (b) Nombre de la entidad REAL del firmante (no 'Entidad\n"
            "      Contratante' literal, sino 'Municipalidad de X', 'Ministerio\n"
            "      de Y', con nombre concreto que aparece en el PDF), o\n"
            "  (c) Imagen/firma escaneada visible al pie del documento que\n"
            "      acompañe un nombre legible.\n"
            "Si NINGUNA de las tres se cumple, el firmante NO va al output.\n"
            "\n"
            "Devolvé SOLO JSON conforme al schema, sin markdown, sin fences."
        ),
    )

    # ── Armado de parts ─────────────────────────────────────────────
    docai_note = ""
    if docai_text:
        # CON Document AI: mandamos SOLO el texto OCR del documento completo
        # (sin el PDF ni PNGs) → 1 llamada Gemini lean. Cap 1M chars ≈ 250K
        # tokens (cubre ~330 págs; entra de sobra en el contexto de Gemini 2.5).
        parts: list = [gtypes.Part.from_text(text=(
            "═══ TEXTO OCR DEL DOCUMENTO COMPLETO (Google Document AI, alta fidelidad) ═══\n"
            + docai_text[:1000000]
        ))]
        docai_note = (
            "ARRIBA está el TEXTO OCR COMPLETO del documento entero, extraído por "
            "Google Document AI (incluye tablas y páginas que estaban rasterizadas "
            "como imagen). Es la ÚNICA fuente — extraé de ahí TODOS los ítems, "
            "especificaciones técnicas y banderas. Procesá el documento completo.\n\n"
        )
    else:
        # SIN Document AI (fallback): PDF + PNGs renderizados (Gemini Vision).
        parts = [gtypes.Part.from_bytes(data=blob, mime_type="application/pdf")]
    render_note = ""
    if rendered:
        pages_human = ", ".join(str(i + 1) for i, _ in rendered)
        render_note = (
            f"ADJUNTO {len(rendered)} imágenes PNG a 160 DPI correspondientes a las "
            f"páginas {pages_human} del PDF (en ese mismo orden). Esas páginas tienen "
            f"el contenido RASTERIZADO COMO IMAGEN dentro del PDF (no texto extraíble), "
            f"por eso te las paso por separado. Hacé OCR visual sobre ellas y "
            f"transcribí palabra por palabra cualquier especificación técnica, tabla "
            f"de ítems, listado de marcas, certificación, plazo o requisito que "
            f"contengan. Lo más probable es que el REQUERIMIENTO completo viva "
            f"acá.\n\n"
        )
        for idx, png in rendered:
            parts.append(gtypes.Part.from_bytes(data=png, mime_type="image/png"))

    layout_note = ""
    if layout and not layout.get("error"):
        layout_note = (
            f"Layout detectado por PyMuPDF: {layout['n_pages']} páginas, "
            f"{layout['total_text_chars']:,} chars de texto extraíble, "
            f"{len(layout.get('low_text_pages') or [])} páginas con < 300 chars "
            f"de texto, {len(layout.get('needs_render_pages') or [])} páginas "
            f"rasterizadas (con contenido en imagen).\n\n"
        )

    prompt = (
        f"PDF a procesar: {source_label}.\n\n"
        f"{layout_note}"
        f"{docai_note}"
        f"{render_note}"
        "Hacé esto, en este orden:\n"
        "\n"
        "PASO 1 — Identificá el tipo de documento (Bases Administrativas, TDR, EETT, "
        "Acta de Buena Pro, Contrato, Propuesta, etc.) y completá `tipo_documento_detectado`.\n"
        "\n"
        "PASO 2 — BUSCÁ la sección REQUERIMIENTO. Suele estar en el Capítulo III de las "
        "Bases Estándar del OECE, titulada 'REQUERIMIENTO' o 'TÉRMINOS DE REFERENCIA' o "
        "'ESPECIFICACIONES TÉCNICAS'. Si la encontrás (sea como texto del PDF o como "
        "contenido OCR de las imágenes adjuntas), marcá `contiene_requerimiento=true`.\n"
        "\n"
        "PASO 3 — Para CADA ítem del proceso (1, 2, 3... — si hay tabla de ítems en\n"
        "el documento o en las imágenes, cada fila es un ítem) extraé toda la info\n"
        "del REQUERIMIENTO técnico en CAMPOS DISCRETOS del schema:\n"
        "\n"
        "  IDENTIFICACIÓN:\n"
        "  · `numero` (string): '1', '1.1', '2', etc.\n"
        "  · `padre_ocds_item`: null si es ítem root del OCDS; el número del padre\n"
        "    si es un sub-ítem dentro de un ítem compuesto.\n"
        "  · `descripcion_corta` (≤200 chars): TÍTULO del ítem tal como aparece en\n"
        "    el documento (no inventes una más corta).\n"
        "  · `cantidad`, `unidad`, `precio_unitario_referencial`, `cuantia_referencial_item`.\n"
        "\n"
        "  MARCA Y NORMAS (copia LITERAL del documento, NO uses ejemplos de memoria):\n"
        "  · `marca_o_modelo_exigido` (string corto): texto exacto del documento si\n"
        "    el ítem exige una marca/modelo. 'sin marca' si el ítem es genérico.\n"
        "    Null si la sección no menciona requisito de marca.\n"
        "  · `certificaciones_exigidas` (lista corta): solo los códigos de norma\n"
        "    LITERALES del documento (cada string como aparece).\n"
        "\n"
        "  VALORES NUMÉRICOS CLAVE (objeto `valores_tecnicos_clave`):\n"
        "    Llená SOLO los campos que aparecen en el documento; resto null:\n"
        "      potencia_min_hp / potencia_min_kw / capacidad_volumen ('1.0 m3') /\n"
        "      capacidad_carga_ton / peso_operativo_ton / alcance_m /\n"
        "      ano_fabricacion_min / estado ('nueva sin uso') /\n"
        "      presentacion (para consumibles: 'saco 50kg', 'lata 140g') /\n"
        "      color / material.\n"
        "\n"
        "  GARANTÍA (objeto `garantia`):\n"
        "      meses (int) / horas (int — maquinaria) / alcance ('comercial', 'fábrica').\n"
        "\n"
        "  ENTREGA (objeto `condiciones_entrega`):\n"
        "      plazo_dias_calendario / lugar_entrega / modalidad ('única', 'parcial').\n"
        "\n"
        "  REQUISITOS AL POSTOR (objeto `requisitos_postor`):\n"
        "      experiencia_minima_soles / anos_experiencia_min /\n"
        "      n_contratos_similares / certificaciones_postor (ej. 'concesionario MTC',\n"
        "      'representante oficial de marca') / infraestructura_exigida /\n"
        "      personal_clave.\n"
        "\n"
        "  PENALIDADES (lista `penalidades`):\n"
        "      [{causal, monto_o_porcentaje, base_calculo}, ...].\n"
        "      Ej. {causal: 'mora en entrega', monto_o_porcentaje: '0.10%',\n"
        "           base_calculo: 'sobre monto del bien por cada día'}.\n"
        "\n"
        "  SUB-ÍTEMS — si el ítem es un PAQUETE/LOTE/CANASTA con varios productos:\n"
        "      `subitems`: [{descripcion, cantidad, unidad, presentacion, specs_clave},...]\n"
        "      Ej. para 'CANASTA DE ALIMENTOS':\n"
        "        [{descripcion: 'Arroz superior', cantidad: 2, unidad: 'BOLSA',\n"
        "          presentacion: '1kg', specs_clave: 'grano largo, taquillado'}, ...]\n"
        "\n"
        "  REQUERIMIENTO LITERAL (`texto_literal`, ≤ 4000 chars):\n"
        "    Extracto copiado tal cual del documento con las especificaciones del ítem\n"
        "    (marca, normas, dimensiones, garantía, plazo, requisitos del postor). NO es\n"
        "    resumen: no reescribas, no completes con tu memoria. Anotá en\n"
        "    `texto_literal_paginas` las páginas (⟦p.N⟧) que abarca y en `evidencia`\n"
        "    una cita textual con su página. Si el documento no tiene requerimiento\n"
        "    para el ítem, null.\n"
        "\n"
        "PASO 4 — Identificá `postores` (RUC, razón social, monto, ganador) si el PDF/imágenes los "
        "mencionan (típicamente en actas y propuestas).\n"
        "\n"
        "PASO 5 — `fundamento_legal` (lista de artículos citados textualmente por el\n"
        "documento: 'Art. 55.1.b Ley 32069', 'Art. 2 TUO Ley 30225', 'D.S. 009-2025-EF\n"
        "Art. 12', etc.). Solo LO QUE EL DOCUMENTO CITA — no interpretes si están bien\n"
        "invocados o no. Eso lo evalúa `document_legal_analyst_agent` aparte.\n"
        "\n"
        "PASO 5.5 — SEGÚN EL TIPO DE DOCUMENTO, llená UNO de estos objetos (o ninguno):\n"
        "  · Si es RESUMEN EJECUTIVO o 'Informe que sustenta' (justifica una directa o\n"
        "    comparación de precios) → completá `estudio_mercado` (valor referencial,\n"
        "    comparación de precio histórico LITERAL, causal/artículo invocado, texto de\n"
        "    la causal, proveedores evaluados, descalificaciones). Es el 'POR QUÉ' del proceso.\n"
        "  · Si es ORDEN DE COMPRA / CONTRATO firmado ('Archivos del contrato') →\n"
        "    completá `contrato_final` (precio FINAL total + moneda, cronograma de\n"
        "    entregas, penalidades, forma de pago, RUC del proveedor). Es lo REALMENTE pagado.\n"
        "  · En CUALQUIER OTRO documento (Bases, acta, presentación, cuadros) → dejá\n"
        "    AMBOS objetos en null. NO inventes; copiá montos/causales LITERALES del PDF.\n"
        "\n"
        "PASO 6 — `cuantia_total`, `fuente_financiamiento`, `modalidad` (suma alzada / precios "
        "unitarios / esquema mixto / tarifas) y `resumen` (3-4 líneas).\n"
        "\n"
        "REGLAS FINALES:\n"
        "  · Sos EXTRACTOR puro: extraés HECHOS del documento. NO emitís juicios\n"
        "    legales ni banderas de riesgo — eso lo hace `document_legal_analyst_agent`\n"
        "    sobre tu output. Si tu extracción es buena (campos discretos completos,\n"
        "    frases textuales preservadas, sin invención), el analyst hace su trabajo\n"
        "    sin problema.\n"
        "  · Si el documento NO es una base / TDR / EETT, `contiene_requerimiento=false` y "
        "los requerimientos por ítem quedan en null.\n"
        "  · Devolvé SOLO JSON. SIN markdown, SIN fences, SIN texto antes ni después."
    )
    parts.append(gtypes.Part.from_text(text=prompt))

    try:
        with _throttle_gemini():
            resp = _gemini_call_with_retry(
                lambda: client.models.generate_content(
                    model=DEFAULT_GEMINI_MODEL, contents=parts, config=config,
                ),
            )
        text = (resp.text or "").strip()
        data = _safe_parse_json(text)
        if not isinstance(data, dict) or not data:
            return {"error": f"non-json response: {text[:200]}"}
        if "MAX_TOKENS" in _finish_reason(resp).upper():
            data["_truncado"] = True
        for _it in (data.get("items") or []):
            if isinstance(_it, dict) and _it.get("texto_literal") and not _it.get("requerimiento_tecnico_detallado"):
                _it["requerimiento_tecnico_detallado"] = _it["texto_literal"]
        data["_size_bytes"] = len(blob)
        data["_source"] = source_label
        data["_pdf_layout"] = {
            "n_pages": layout.get("n_pages"),
            "rendered_pages_1based": [i + 1 for i, _ in rendered],
            "total_text_chars": layout.get("total_text_chars"),
            "es_pdf_completamente_escaneado": layout.get("es_pdf_completamente_escaneado"),
        }
        # LOGGING DE ORIGEN POR-PDF (caza-contaminación): qué documento produjo
        # qué ítems. Si un run de acelerómetros loguea 'CARNE DE RES', el source
        # apunta al PDF/URL cruzado → confirma fetch-chain vs parser.
        try:
            _it = data.get("items") or []
            _first = str((_it[0] if _it else {}).get("descripcion_corta") or "")[:90]
            print(f"[parser-src] src={source_label} · bytes={len(blob)} · "
                  f"n_items={len(_it)} · first='{_first}'", flush=True)
        except Exception:
            pass
        return data
    except Exception as e:
        return {"error": f"gemini failed: {str(e)[:150]}", "_source": source_label}
