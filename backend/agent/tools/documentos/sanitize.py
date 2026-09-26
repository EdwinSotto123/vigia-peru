"""Capa 2 (LLM único de sanitización): produce la lista canónica de productos a partir
de los ítems crudos del parseo — el LLM solo decide (fundir/descartar), nunca genera."""

from tools._core import *  # noqa: F401,F403


# ── Capa 2 (LLM único de sanitización) ─────────────────────────────────────
# Esta herramienta es la ÚNICA responsable de producir la lista canónica de productos
# a partir de los items crudos que dejó el parseo (que pueden tener duplicados por OCR
# ruidoso, el mismo bien numerado distinto en dos documentos ['001' vs '1'], o el
# título del contrato colándose como ítem). NO usa thresholds/regex/lookalike — el
# LLM JUZZGA el listado completo con su propio criterio. Es la capa de sanitización
# (capa 2) de la arquitectura por capas que pidió el usuario; el parseo es la capa 1.

_CAMPOS_SOLO_REQUERIMIENTO = ("marca_o_modelo_exigido", "precio_unitario_referencial", "cuantia_referencial_item",
                              "certificaciones_exigidas", "requisitos_postor", "texto_literal",
                              "requerimiento_tecnico_detallado", "texto_literal_paginas")


def sanitize_items_with_llm(raw_items, objeto: str = "", tool_context=None) -> list:
    """Recibe los items CRUDOS acumulados de TODOS los documentos parseados de un
    contrato, más el objeto del OCDS. Devuelve la LISTA CANÓNICA ÚNICA de productos.

    Diseño: el LLM SOLO DECIDE (no genera). Devuelve los ÍNDICES a fundir/descartar
    (NO reconstruye items). El merge de campos lo hace el código sobre los crudos
    originales. Esto garantiza:
      - Cobertura perfecta: cada item de la salida corresponde a uno (o varios) del input.
      - Sin alucinaciones: el LLM no puede inventar items nuevos (no genera contenido).
      - Campos preservados tal cual: numero, descripcion_corta, cantidad, requerimiento,
        marca, certificaciones, padre_ocds_item — todo del input crudo.

    Acciones del LLM:
      - Normaliza `numero` ('001'→'1', '02'→'2', '1.0'→'1') → campo `num_normalizado`.
      - Grupos de índices a fundir (mismo bien físico descrito distinto).
      - Índices a descartar (cabecera del contrato repetida como ítem).
    Robusto: si el LLM falla, devuelve los items crudos sin cambios (fail-safe)."""
    items = [it for it in (raw_items or []) if isinstance(it, dict)]
    if len(items) <= 1:
        return items
    try:
        from google.genai import types as gtypes
        # Catálogo MINIMAL para no inflar el prompt. El LLM solo decide, no genera.
        catalogo = [{"i": i, "num": str(it.get("numero") or "")[:20],
                     "desc": str(it.get("descripcion_corta") or it.get("descripcion") or "")[:200],
                     "cant": it.get("cantidad"), "und": str(it.get("unidad") or "")[:20]}
                    for i, it in enumerate(items)]
        schema = gtypes.Schema(
            type=gtypes.Type.OBJECT,
            properties={
                "num_normalizado": gtypes.Schema(
                    type=gtypes.Type.ARRAY,
                    description="Para cada item de entrada, su `numero` canónico (sin ceros a la izquierda ni sub-decimal .0). Mismo orden que la entrada.",
                    items=gtypes.Schema(type=gtypes.Type.STRING),
                ),
                "grupos_fundir": gtypes.Schema(
                    type=gtypes.Type.ARRAY,
                    description="Cada sub-lista = índices que son EL MISMO bien físico y deben fundirse en uno solo. Solo grupos de >=2 elementos (los ítems únicos no van).",
                    items=gtypes.Schema(type=gtypes.Type.ARRAY, items=gtypes.Schema(type=gtypes.Type.INTEGER)),
                ),
                "indices_descartar": gtypes.Schema(
                    type=gtypes.Type.ARRAY,
                    description="Índices a descartar (típicamente el TÍTULO/OBJETO del contrato repetido como ítem, sin specs técnicas reales).",
                    items=gtypes.Schema(type=gtypes.Type.INTEGER),
                ),
            },
            required=["num_normalizado", "grupos_fundir", "indices_descartar"],
        )
        prompt = (
            f"OBJETO del contrato (referencia, NO para filtrar): '{(objeto or '')[:300]}'\n\n"
            f"ITEMS CRUDOS extraídos de VARIOS documentos del mismo proceso (Bases, "
            f"Acta, Cuadro, Contrato, etc.). Cada item tiene un índice 0..N-1. Problemas típicos:\n"
            f"  • Mismo bien numerado distinto en dos documentos ('001' y '1', '02' y '2', '1.0' y '1')\n"
            f"  • Descripciones distintas del MISMO bien por OCR ruidoso\n"
            f"  • El TÍTULO/OBJETO del contrato repetido como ítem sin specs técnicas reales\n\n"
            f"Tu tarea: DECIDE (NO generes items, NO modifiques descripciones). Devuelve:\n"
            f"1. `num_normalizado`: array (mismo orden que la entrada) con cada `numero` canónico. "
            f"Ej: '001' → '1', '02' → '2', '1.0' → '1', '01' → '1'. Conserva string vacío si vacío.\n"
            f"2. `grupos_fundir`: array de arrays de índices que son EL MISMO bien físico (descripción "
            f"distinta por OCR pero mismo producto). Solo grupos de >=2. Conserva la cantidad canónica.\n"
            f"3. `indices_descartar`: índices a descartar (típicamente el TÍTULO/OBJETO del contrato "
            f"repetido como ítem, sin specs reales; o un ítem que sea claramente cabecera).\n\n"
            f"REGLAS:\n"
            f"• Items con `requerimiento_tecnico_detallado` largo (>40 chars) NO se descartan (son items reales).\n"
            f"• Items con descripción MUY PARECIDA al objeto del contrato Y sin specs SÍ se descartan (cabecera).\n"
            f"• Items con numero distinto (después de normalizar) son bienes DISTINTOS, NO se funden.\n"
            f"• Items con numero igual pero descripción distinta (por OCR) SÍ se funden (mismo bien).\n"
            f"• Conserva el mayor `requerimiento_tecnico_detallado` entre los del grupo a fundir.\n\n"
            f"INPUT ({len(catalogo)} items):\n{json.dumps(catalogo, ensure_ascii=False)}"
        )
        sys_inst = (
            "Sos un consolidador de ítems de contrataciones públicas peruanas (SEACE/OECE). "
            "Tu única tarea es DECIDIR (no generar items): normalizar numeros, "
            "identificar grupos a fundir (mismo bien físico), e índices a descartar "
            "(típicamente el título del contrato repetido). Devolvé SOLO JSON conforme "
            "al schema, sin markdown, sin fences, sin texto adicional."
        )
        model = os.getenv("SANITIZE_ITEMS_MODEL", DEFAULT_GEMINI_MODEL)
        cfg = gtypes.GenerateContentConfig(
            temperature=0.0, top_p=0.1, response_mime_type="application/json",
            response_schema=schema, max_output_tokens=8192,
            http_options=gtypes.HttpOptions(timeout=60000),
            system_instruction=sys_inst,
            # Decidir índices a fundir/descartar es mecánico: sin razonamiento.
            thinking_config=thinking_crudo("sanitize", model, "minimal"),
        )
        client = _gemini_client()
        with _throttle_gemini():
            resp = _gemini_call_with_retry(
                lambda: client.models.generate_content(model=model, contents=[gtypes.Part.from_text(text=prompt)], config=cfg))
        data = _safe_parse_json((resp.text or "").strip()) or {}
        if not isinstance(data, dict):
            print(f"[sanitize-items] LLM no devolvió un objeto JSON válido → conservo crudos (fail-safe)", flush=True)
            return items
        # Cobertura / validación: cada índice 0..N-1 debe aparecer EXACTAMENTE una vez
        # entre los grupos de fundir + los índices a descartar + los items individuales
        # (los que no estén en ningún grupo ni descartados quedan como ítems únicos).
        nums = data.get("num_normalizado") or []
        grupos = [g for g in (data.get("grupos_fundir") or []) if isinstance(g, list)]
        descartar = set(i for i in (data.get("indices_descartar") or []) if isinstance(i, int))
        if not isinstance(nums, list) or len(nums) != len(items):
            print(f"[sanitize-items] LLM devolvió num_normalizado con tamaño {len(nums) if isinstance(nums,list) else '?'} != {len(items)} → conservo crudos (fail-safe)", flush=True)
            return items
        # Aplicar normalización del numero a los crudos
        for it, n in zip(items, nums):
            if isinstance(n, str):
                it["numero"] = n.strip()
        # Validar cobertura: cada índice aparece 1 vez entre (grupos × N) + descartar
        coverage_vistos: set = set()
        for g in grupos:
            for i in g:
                if isinstance(i, int) and 0 <= i < len(items): coverage_vistos.add(i)
        coverage_vistos.update(descartar)
        # Los demás índices (los que NO están en grupo ni descartados) son ítems únicos
        # restantes — los representamos como grupos de 1 elemento para unificar el merge
        for i in range(len(items)):
            if i not in coverage_vistos:
                grupos.append([i])
        # Validación final: cada índice exactamente una vez
        flat = [i for g in grupos for i in g if isinstance(i, int)]
        if sorted(flat) != list(range(len(items))) or len(flat) != len(set(flat)):
            print(f"[sanitize-items] LLM cobertura inválida ({len(set(flat))}/{len(items)}) → conservo crudos (fail-safe)", flush=True)
            return items
        # MERGE de los grupos (el código decide, no el LLM). El item con el
        # `requerimiento_tecnico_detallado` más largo es la base; los demás solo
        # COMPLETAN campos vacíos (no sobreescriben lo que ya está).
        out: list[dict] = []
        for g in grupos:
            grp = [items[i] for i in g if 0 <= i < len(items)]
            if not grp: continue
            if any(i in descartar for i in g): continue  # descartar explícito
            # base = ítem de REQUERIMIENTO con el texto más largo; los de contratación (OC/acta)
            # solo aportan marca/precio OFERTADOS, nunca `marca_o_modelo_exigido` ni referencial.
            grp.sort(key=lambda x: (x.get("_etapa") == "contratacion",
                                    -len(str(x.get("requerimiento_tecnico_detallado") or ""))))
            base = dict(grp[0])
            for other in grp[1:]:
                de_contratacion = other.get("_etapa") == "contratacion"
                for k, v in other.items():
                    if de_contratacion and k in _CAMPOS_SOLO_REQUERIMIENTO:
                        continue
                    if base.get(k) in (None, "", [], {}, 0) and v not in (None, "", [], {}, 0):
                        base[k] = v
            out.append(base)
        descartados_n = len(descartar)
        fundidos_n = len(items) - len(out) - descartados_n
        print(f"[sanitize-items] {len(items)}→{len(out)} items canónicos · {descartados_n} descartados · {fundidos_n} fundidos", flush=True)
        return out
    except Exception as e:
        print(f"[sanitize-items] LLM falló ({type(e).__name__}: {str(e)[:160]}) → conservo crudos (fail-safe)", flush=True)
        return items
