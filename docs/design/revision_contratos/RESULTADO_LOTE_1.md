# Resultado de las correcciones — lote 1 (VIG-2026-00004, Cusco) y lote 2 (VIG-2026-00005, Puno)

Fecha: 2026-09-16 · Código: `d444c37` → `00e7394` · Plan: `docs/superpowers/plans/2026-09-15-correcciones-lote-1.md`.
"Antes" = lo que publicó Vigía en la primera corrida (revisado a mano en `docs/design/revision_contratos/<ocid>.md`).
"Después" = segunda corrida con las correcciones, mismos documentos (OCR cacheado).

## Lote 1 · 10 contratos de bienes (Cusco), señal por señal

| OCID | Antes (revisión manual) | Después | Veredicto |
|---|---|---|---|
| 1225030 piedra 10–12" | sobreprecio +89.7 % (FP: comparables genéricos vs VR regionales) · sobreprecio de lote (duplicado) · **FN**: oferta perdedora = VR al céntimo | `oferta_igual_valor_referencial` (alta) | FP eliminados por ancla regional + regla de lote; FN recuperado. Pendiente: ofertas gemelas (Δ 1.04 %, umbral 1 %). |
| 1225058 arroz | sanción "vigente" (FP: multa pagada) · cuantía vs referencial (FP) · "marca exigida" inventada · **FN**: ampliación improcedente + penalidad, oficial de compra con 2 E.I.R.L. en RNP | `sancion_historica_oece` (baja) · `ampliacion_denegada_penalidad` · `firmante_con_empresa_rnp` · `oferta_mas_barata_no_gana` · `antecedente_proveedor_web` · `cobertura_prensa_adversa` | 3 FP fuera, 2 FN recuperados. |
| 1225062 geosintéticos | objeto ≠ documento (FP) · **FN**: specs calcadas de TriAx TX160, socios Arias Oblitas en dos postores, VR al 99.6 % del tope | `red_flag_documental` (specs de catálogo, alta) · `postores_vinculados_rnp` · `cuantia_al_limite_del_tope` | FP fuera; los 3 FN recuperados. |
| 1225090 reactivos | 0 señales; 3 "indicios" falsos en prosa · **FN**: oferta 8 % más barata perdió por factor garantía, 3 penalidades OECE | `oferta_mas_barata_no_gana` · `penalidades_oece_historicas` · `sobreprecio_elevado` (+41 % con P.U. del contrato) · `cobertura_prensa_adversa` → **revisión humana** | FN recuperados; el self-eval lo manda a revisión (correcto: hay prensa no verificada). Pendiente: bases integradas modificadas a pedido (bloque `procedimiento_seleccion`). |
| 1225256 diésel contingencia | cuantía vs referencial (FP) · **FN**: Res. 326-2026 por incumplimiento (URL inventada) | `antecedente_proveedor_web` (resolución de contrato previa, URL verificada) | FP fuera, FN recuperado. `plazo_convocatoria_minimo` (11 d calendario / 9 hábiles) dejó de disparar con el conteo en días hábiles. |
| 1225266 perfilería | objeto ≠ documento (FP) · marca TUPEMESA "exigida" (FP) · sobreprecio ítems (FP: 3 m vs 4 m) · **FN**: 3 ofertas dentro de 0.14 %, oficial de compra socia de una S.R.L. | `ofertas_agrupadas` · `firmante_con_empresa_rnp` · `cuantia_al_limite_del_tope` | 3 FP fuera, 2 FN recuperados. |
| 1225379 postes | 0 señales · **FN**: ganador no invitado (lista cerrada), otras ofertas sobre la cuantía, OEC en carpeta fiscal, precios unitarios +49–72 % | `ganador_no_invitado` · `unica_oferta_valida` · `firmante_con_empresa_rnp` · `sobreprecio_muy_elevado` · 2 `red_flag_documental` → **revisión humana** | 4 FN recuperados. |
| 1225392 estación total | 0 señales (score 0) pese a EETT Leica, única oferta válida, funcionario en RNP, sobreprecio +41 % descartado | `red_flag_documental` (EETT Leica) · `unica_oferta_valida` · `firmante_con_empresa_rnp` · `oferta_igual_valor_referencial` · 2 `sobreprecio_elevado` + lote · `cuantia_al_limite_del_tope` · `ciiu_vs_objeto` | Todos los FN recuperados. |
| 1225416 combustible | cuantía vs referencial (FP) · sobreprecio de lote con el estimado como "ofertado" (FP) · **FN**: Flórez García en dos postores rivales | `postores_vinculados_rnp` · `firmante_con_empresa_rnp` | 2 FP fuera, FN recuperado; el mercado ahora da +0.6 % con el precio del contrato (sin bandera). |
| 1225450 combustible | cuantía vs referencial (FP) · sobreprecio +7 162 % (FP flagrante) · **FN**: gerente municipal socio de una S.A.C. en RNP | `firmante_con_empresa_rnp` | 2 FP fuera, FN recuperado. |

**Balance:** 10 FP eliminados de 10 identificados; 17 FN recuperados de 21; nada inventado (`verificacion_dictamen.degradado = false` en los 10; DNI enmascarados; URLs gob.pe verificadas por HEAD). Tiempo por contrato con OCR cacheado: 130–210 s; costo US$ 0.18–0.32.

## Lote 2 · 10 contratos de bienes (Puno), primera corrida ya con las correcciones

| OCID | Señales | Estado |
|---|---|---|
| 1224840 cemento | penalidades y sanción OECE históricas (bajas) | activa, score 16 |
| 1224847 piedra chancada | ninguna | activa, score 0 |
| 1225287 asfalto | CIIU incongruente · firmante con empresa en RNP | activa, 36 |
| 1225407 grass sintético | postores vinculados por RNP (alta) · única oferta válida (alta) · firmante RNP · oferta = VR | activa, 100 |
| 1225468 barras de construcción | prensa adversa (2) · postores vinculados RNP · sanción/penalidades históricas · firmante RNP | **revisión humana**, 100 |
| 1225513 equipamiento médico | postores vinculados RNP (alta) · 2 señales documentales · firmante RNP | activa, 90 |
| 1225562 ventanas | 2 antecedentes web del proveedor · CIIU · firmante RNP · sobreprecio ítem | **revisión humana**, 72 |
| 1225595 tractor agrícola | oferta = VR (alta) · CIIU | activa, 53 |
| 1225596 tractor agrícola | oferta = VR (alta) · prensa adversa (2) · sanción histórica | activa, 67 |
| 1225884 módulos de seguridad | firmante RNP (alta) · ampliación denegada + penalidad · prensa adversa | **revisión humana**, 65 |

Los contratos en **revisión** no aparecen en las listas públicas hasta que una persona los confirme (self-eval bloqueante: respaldo < 60 % o prensa no verificable).

## Qué falta (siguiente iteración)
- Revisión manual del lote 2 (mismo protocolo) para medir la tasa de FP de las reglas nuevas, en especial `firmante_con_empresa_rnp` (aparece en 12 de 20: verificar que el match por nombre ≥ 0.95 no confunda homónimos) y `oferta_igual_valor_referencial` (distinguir VR publicado vs no publicado).
- `procedimiento_seleccion` (bases integradas modificadas a pedido, factores de evaluación) solo entra en actas/bases integradas por el presupuesto de tamaño del schema; medir cobertura.
- Score: con 9 reglas nuevas muchos contratos llegan al tope 100; recalibrar pesos por regla (hoy solo por agente × severidad).
