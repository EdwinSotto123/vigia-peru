# Revisión del contrato <OCID> — <objeto corto>

## 0. Ficha
Entidad · tipo/etapa · monto · proveedor · documentos (n, formatos) · duración del análisis · costo · score · estado.

## 1. Documentos vs. lo extraído (revisión manual del expediente)
Por documento: qué es (bases, propuesta, acta, contrato…), qué dice de verdad (ítems, cantidades, precios, plazos, firmantes, comité, postores, requisitos), y qué extrajo Vigía (`texto/*.extraccion.json`, `alerta.json → document_analysis/parser_raw_consolidated`). Tabla: dato · en el documento · extraído · ✓/✗ · comentario. Citas con página (⟦p.N⟧ en `texto/*.txt`).

## 2. Traza y razonamiento
Orden real de fases (`procesamiento.json → eventos`), warns/errores, `descartes`, `recortes`, `validaciones_pendientes`, qué agente aportó qué, qué se omitió y por qué, tiempos por fase, tokens/costo (`llm_metrics`). ¿Hubo información que existía en los documentos y no llegó al dictamen? ¿Algo inventado (nombres, RUC, montos, URLs, normas) que no esté en documentos/OCDS/grounding?

## 3. Resultado final que ve el usuario
`dictamen.md` y `banderas.json`: cada señal → ¿verdadero positivo / falso positivo / discutible? con la evidencia del documento. Señales que faltaron (falsos negativos) con evidencia. Mercado: ¿comparables razonables? Lenguaje: "señal de riesgo", sin acusaciones, sin datos personales de particulares. Legibilidad para periodista/fiscal. Verificación (`verificacion_dictamen`, `banderas[].verificacion`).

## 4. Puntos débiles del código (con archivo:línea) y mejoras propuestas
Priorizadas: impacto (alto/medio/bajo) · esfuerzo (S/M/L) · archivo:línea · qué cambiar exactamente. Distinguir: parser/OCR · selección de documentos · reglas de compliance · legal · mercado · investigación web/red · verify · dictamen · UX de resultados.

## 5. Veredicto en 5 líneas
