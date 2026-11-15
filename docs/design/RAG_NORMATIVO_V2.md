# RAG normativo v2: por fecha, con jerarquía y en la base propia

Fecha: 2026-11-15. Reemplaza al RAG de Chroma Cloud descrito en `RAG_NORMATIVO.md` (queda como respaldo).

## 1. Qué fallaba (auditoría con datos)

Se hicieron al RAG anterior 12 preguntas típicas del analista legal con el régimen vigente (Ley 32069) y se midió con
el conjunto de 73 preguntas de `backend/rag/evalset.jsonl`:

| Hallazgo | Dato |
|---|---|
| Criterios de la ley anterior servidos como si fueran vigentes | 37 de 45 criterios devueltos; 21,1 % de todos los resultados |
| Lo primero que llega no es una norma | 1 de cada 5 preguntas |
| Opiniones viejas desplazan al artículo vigente | impedimentos: 4 opiniones de 2022 y ningún artículo de la ley |
| Búsqueda sólo por vectores | «artículo 45» o «fraccionamiento» no pesan como palabras |
| Sin jerarquía | una opinión compite de igual a igual con la ley |
| Corpus corto en lo nuevo | 34 opiniones de la Ley 32069, ninguna de 2026, ninguna resolución del Tribunal |

Efecto en el agente: cita opiniones de 2022-2024 en contratos de 2026 (1 a 3 por corrida de la prueba de oro) y razona
con la numeración de artículos del reglamento anterior.

## 2. Arquitectura

```
fuentes oficiales ──► cargar_normas.py ──► norma (catálogo)            ┐
(gob.pe, El Peruano)                      norma_fragmento (artículos)  ├─ Postgres (RDS)
                                          tsvector español + bge-m3    ┘
agente legal ──► tools/normas_rag.py ──► vigia-llm /v1/embeddings ──► buscar_norma(pregunta, vector, FECHA)
                 (fecha de convocatoria)                              palabras + vector, fusión por rango, jerarquía
```

**Base.** Postgres con `pgvector` (halfvec 1 024) y `tsvector` en español sin tildes: la misma que ya usa el RAG de
documentos (`rag_fragmento`). Sin servicios externos: el agente ya tiene conexión a la base.

**Unidad.** Un fragmento es un artículo (ley, reglamento), un numeral (directiva), una conclusión (opinión) o un acuerdo.
Cada uno guarda su número de artículo y su epígrafe, para citar «Art. 45 del D.S. 009-2025-EF» y no «un trozo».

**División por fecha.** Cada norma tiene `regimen` (32069 | 30225 | ambos), `vigencia_desde`, `vigencia_hasta` y
`fecha_emision`. La consulta recibe la fecha de la convocatoria y:

| Tipo | Regla |
|---|---|
| Ley, reglamento, directiva, bases estándar | sólo si son del régimen de esa fecha y regían ese día |
| Acuerdo, precedente, opinión del mismo régimen | sale como `criterio`, si ya existía ese día |
| Acuerdo u opinión de la otra ley | sale como `criterio_anterior`, con advertencia: sirve por analogía, sus artículos no son los vigentes |
| Norma de la otra ley | no sale |

**Algoritmo.** Búsqueda híbrida: los 60 mejores por palabras (`ts_rank_cd`, términos unidos con O) y los 60 mejores por
vector (coseno), fusionados por rango recíproco (RRF, k = 60). El puntaje se pondera por jerarquía (ley 1,30;
reglamento 1,25; acuerdo 1,10; opinión 1,00; bases estándar y directivas 0,90; control 0,80) y un criterio de la otra
ley vale la mitad. El agente recibe cupos: hasta 5 normas (2 de bases estándar como máximo), 3 criterios del régimen y
2 del régimen anterior, sin repetir artículo.

**Jerarquía.** 1 ley · 2 reglamento · 3 directiva y bases estándar · 4 acuerdo de Sala Plena y precedente · 5 opinión
y resolución · 6 control.

## 3. Resultado medido

Mismas 73 preguntas, 8 primeros resultados (`python -m backend.rag.evaluar_normas`):

| | Chroma | v2 |
|---|---|---|
| Trae el artículo esperado | 87,7 % | 93,2 % |
| MRR | 0,68 | 0,765 |
| Lo primero es una norma aplicable | 79,5 % | 100 % |
| Resultados de la ley equivocada sin advertir | 21,1 % | 0 % |

Corpus cargado: 7 450 fragmentos de 750 documentos (leyes y reglamentos de los dos regímenes, 9 bases estándar,
8 acuerdos, 723 opiniones, normas de control).

## 4. Cómo se evalúa al analista legal

| Conjunto | Qué mide | Dónde |
|---|---|---|
| `rag_normas` | recuperación: artículo esperado, orden, mezcla de regímenes | `backend/rag/evalset.jsonl`, `evaluar_normas.py` |
| `legal` | su regla (`red_flag_documental`) en los 70 contratos de las pruebas de oro, y cada cita: ¿existe?, ¿regía en la fecha? | `backend/scripts/golden_subir.py` |
| bienes, servicios, consultoría | todas las reglas | `backend/scripts/golden_eval.py` |

Todo queda en `golden_conjunto`, `golden_caso`, `golden_corrida` y `golden_resultado`, y se ve en el panel:
**/admin/golden** (conjuntos, corridas, detalle por contrato, casos y un probador de normas por fecha).

Línea base del analista legal (imagen b390f6b6): bienes F1 0,73 · servicios 0,67 · consultoría 0,40; 1 a 4 citas por
corrida de la otra ley o inexistentes.

## 5. Activación

`LEGAL_RAG_BACKEND=vigia` en la Lambda. Si la búsqueda falla o no trae nada, sigue la cascada anterior (Chroma).

Para sumar normas: dejar los archivos en la carpeta de descargas con su fila en el manifiesto,
`python backend/scripts/normas_fichas.py <descargas> <fichas>`, `cargar_normas.py prod carpeta <fichas>` y
`cargar_normas.py prod vectores`.

## 6. Unificación de las tres fuentes (2026-11-15)

Había tres trabajos sobre lo mismo: el RAG de Vigía (migración 284), una descarga parcial en `rag-legal-pe` (98 normas
planeadas, 74 con texto) y el paquete `docs/rag_legal_peru` (catálogo de 86 normas, 48 reglas, un esquema con artículos
versionados). Quedaron así:

| Del paquete o de la descarga | Dónde quedó |
|---|---|
| Catálogo de normas con estado y verificación (C confirmado, S secundaria, PV por verificar) | columnas `norma.estado`, `norma.verificacion`, `norma.catalogo_id` (migración 286) |
| Categorías A a G | `norma.materia`: contrataciones, control, presupuesto, administrativo, inversión, empleo público |
| Artículos versionados con `articulos_vigentes(fecha)` | `norma.version_de`: la otra versión es otra fila con su vigencia; la búsqueda sirve el texto de la fecha |
| 48 reglas de cumplimiento | tabla `norma_regla`, visible en /admin/golden, pestaña Normas, Reglas |
| Descargas de los dos agentes y de los cinco lotes | `backend/scripts/normas_fichas.py` las convierte en fichas por artículo; `cargar_normas.py … carpeta` las carga |

**Versiones por fecha.** El D.S. 001-2026-EF cambió 123 artículos del Reglamento desde el 14-01-2026. La base tenía sólo
el texto consolidado. Ahora `ds-009-2025-ef-anterior` guarda el texto anterior de cada artículo modificado (sale de la
columna izquierda del cuadro comparativo del OECE; el PDF oficial del texto original es un escaneo) con vigencia del
22-04-2025 al 13-01-2026 y `version_de = ds-009-2025-ef`. Cuando el agente pregunta por un proceso de 2025 y la búsqueda
trae un artículo modificado, `tools/normas_rag.py::texto_de_la_fecha` lo cambia por el texto que regía y lo marca
(«texto que regía hasta el 13-01-2026»). Lo mismo con las bases estándar: las de 2025 cierran el 13-01-2026 y las 19 de
la R.D. 0001-2026-EF/54.01 rigen desde el 14.

**Materia.** La búsqueda del analista legal no trae empleo público (CAS, planillas) salvo que se pida
(`buscar_norma(…, p_materias)`). Así el corpus de CAS y planillas vive en la misma base sin ensuciar los contratos.

**Regímenes especiales.** La Ley 31589 (obras paralizadas) y sus bases, la Reconstrucción con Cambios (D.S. 071-2018-PCM)
y Obras por Impuestos (Ley 29230) llevan materia `especial` y tampoco entran en la búsqueda general (migración 287): al
cargarlas sin esa marca la medición bajó de 93,2 % a 89 %, porque sus artículos se parecen a los de la ley general.

**Medición con el corpus ampliado** (73 preguntas, 8 primeros): acierto 93,2 %, MRR 0,769, norma primero 100 %, régimen
equivocado 0 %. Prueba de oro de bienes con la búsqueda nueva (imagen eaa6bf57): F1 0,93, y las 79 citas legales del
analista existen y regían en la fecha (antes, 1 a 4 por corrida eran de la otra ley o inexistentes).

**Corpus cargado** (PROD, 2026-11-15): 972 normas y criterios, 16 293 fragmentos (antes 750 y 7 450).

| Qué entró | Cuánto |
|---|---|
| Cuadro de impedimentos del artículo 30 de la Ley 32069 (texto de El Peruano del 24-06-2024) | 7 fragmentos |
| Reglamento, texto anterior al 14-01-2026 | 102 artículos |
| D.S. 001-2026-EF, D.S. 222-2026-EF, D.S. 072-2025-EF, fe de erratas del Reglamento | 4 |
| Leyes que modifican la Ley 32069: 32187, 32515, 32732, D.L. 1715 | 4 |
| Directivas del OECE vigentes (001 a 018 de 2025, 001-2026, lineamientos, código de ética del arbitraje) | 23 |
| Directivas y resoluciones de la DGA del MEF (EF/54.01) | 15 |
| Directivas de Perú Compras (fichas técnicas, encargo, homologación, compra corporativa, acuerdos marco) | 8 |
| Bases estándar de 2026 (19) y de la Ley 31589 (5) | 24 |
| Acuerdos de Sala Plena de 2021 a 2026 | 22 |
| Opiniones de la DTN de 2025 y 2026 (42 de la Ley 32069 y 33 de la anterior) | 75 |
| Control: Ley 27785, directivas de la Contraloría (INFOBRAS, Ley 31358, autorización previa) | 5 |
| Inversión: D.L. 1252, Directiva 001-2019-EF/63.01 y sus modificatorias, Ley 29230 | 9 |
| Empleo público: D.L. 1057 y reglamento, Ley 32563, Ley 30057 y reglamento, D.L. 276, 728, 1023, 1666, AIRHSP, SERVIR | 31 |

## 7. Lo que falta (para descargar a mano o con otro método)

Los agentes respetaron `robots.txt` y no saltaron ningún bloqueo. Esto quedó fuera:

| Prioridad | Qué | Por qué no se pudo | Dónde |
|---|---|---|---|
| 1 | Opiniones de la DTN: D000028 a D000103 de 2025 y D000001 a D000103 de 2026 | el listado sólo se recorre con `?sheet=`, que `robots.txt` prohíbe | gob.pe/institucion/oece/colecciones/66839 y 713, página por página a mano; o pedir el consolidado al OECE por transparencia |
| 1 | Reglamento D.S. 009-2025-EF, texto original completo | el PDF oficial es un escaneo de 196 páginas | necesita OCR; mientras tanto el cuadro comparativo cubre los 102 artículos que cambiaron |
| 2 | Acuerdos de Sala Plena de 2019 y 2020 | la colección 715 no los muestra en su primera página | gob.pe/institucion/oece/colecciones/715 (la base ya tiene el 004-2019) |
| 2 | Resoluciones del Tribunal sobre direccionamiento, calificación y marcas | no hay listado descargable | buscador de resoluciones del Tribunal |
| 2 | Tabla de concordancias Ley 30225 con Ley 32069 | no se encontró una oficial | si el OECE la publica; si no, se arma con las dos leyes |
| 2 | Anexos de mef.gob.pe (TUO de la Ley 29230, D.L. 1252 original, Ley 32513 con anexos) | el sitio responde con un desafío anti bot | descarga manual desde un navegador |
| 3 | R.C. 220-2025-CG (control de obras paralizadas) y sus 14 anexos; Ley 27674; Ley 30225 original | sólo existen escaneados | OCR |
| 3 | ROF del OECE (anexo del D.S. 067-2025-EF y texto integrado) | El Peruano publica sólo el decreto | gob.pe/oece |
| 3 | Leyes 27815 y 27806 | el archivo bajado no era la norma | SPIJ o El Peruano |

Datos que el catálogo traía mal y los textos corrigieron: el D.S. 328-2025-EF no es de obras (aprueba el Monto Único
Consolidado del D.L. 276); el D.L. 1440 es el Sistema Nacional de Presupuesto; el reglamento de la Ley 26771 es el
D.S. 021-2000-PCM, no el D.S. 018-2007-TR; el D.L. 1442 está derogado (lo reemplaza el D.L. 1666); la Ley 32513 es la
de Presupuesto 2026, no la de Endeudamiento.

### Pendientes del paquete que los textos cargados ya responden

| N.º | Pendiente | Respuesta con el texto oficial |
|---|---|---|
| 1 | Artículo de controversias de la Ley 32069 | art. 76 (mecanismos); junta de disputas 79 y 80; conciliación 81 y 82; arbitraje 83 y 84 |
| 3 | Procesos convocados antes del 22-04-2025 | Cuarta Disposición Complementaria Transitoria de la Ley: se rigen por las normas vigentes al convocar |
| 4 | Tope de la comparación de precios en el art. 95 | la comparación de precios está en los arts. 97 y 98; el tope de S/ 100 000 no aparece en el Reglamento ni en la Ley 32513: sigue abierto |
| 5 | Tope de S/ 79 000 000 para licitación de obras | no aparece en ninguna norma cargada; el art. 14 de la Ley 32513 fija licitación pública de obras desde S/ 5 000 000 |
| 6 | Factor F de la penalidad por mora | art. 120 del Reglamento: 0,40 en bienes y servicios; en obras depende del plazo (0,40 y 0,25 confirmados en el texto) |
| 8 | Artículo de fraccionamiento | art. 50 de la Ley (supuestos de fraccionamiento) |
| 9 | Vigencia del D.S. 222-2026-EF | cinco artículos, sin cláusula de vigencia: rige desde el día siguiente de su publicación (22-10-2026) |
| 11, 12 | Materia de las directivas del OECE | 004 registro de instituciones arbitrales; 008 gastos arbitrales; 009 recusación; 011 supervisión y 012 sanción de instituciones arbitrales; 013 multas; 014 vigilancia ciudadana; 015 casilla electrónica; 016 retención de multas |
| 13 | Acuerdos de Sala Plena de 2026 | existen 001, 004 y 005-2026/TCP; 002 y 003 no figuran en la colección |
| 15 | Bonificación a licenciados de las Fuerzas Armadas | Ley 29248: 10 % confirmado |
| 17 | Arts. 24 y 31 de la Ley 32513 | 24: incorporación del BET Fijo; 31: bono excepcional por única vez |
| 18 | Ley 32187 | confirmado: modifica disposiciones complementarias finales de la Ley 32069 |

Siguen abiertos: 2 (adecuación del Reglamento a la Ley 32732), 7 (artículo que exige el Cuadro Multianual), 14, 16, 19 y 20.

## 8. Pendiente de diseño

- Etiquetas de tema por fragmento (`temas`), para filtrar antes de buscar.
- Usar una tabla de concordancias para devolver, junto a un `criterio_anterior`, el artículo vigente equivalente.
- Enlazar cada `norma_regla` con la regla del agente que ya la cubre (`regla_vigia`) y medir cuántas quedan sin cubrir.
- Versión por fecha de la Ley 32069: hoy hay un solo texto (el consolidado, con notas que dicen desde cuándo rige cada
  cambio). Los cambios son pocos (art. 7.1 por la Ley 32515, art. 85.1 por el D.L. 1715, Ley 32732).
