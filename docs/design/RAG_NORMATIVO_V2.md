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

## 6. Lo que falta cargar (fuentes por descargar)

El portal gob.pe rechaza clientes automáticos desde fuera del Perú. Hay que bajarlas desde una IP peruana (o a mano) y
dejarlas como fichas `.json` en una carpeta; `cargar_normas.py <destino> carpeta <dir>` las carga y
`cargar_normas.py <destino> vectores` las indexa. Formato de la ficha: cabecera de `backend/scripts/cargar_normas.py`.

| Prioridad | Fuente | Dónde | Por qué |
|---|---|---|---|
| 1 | Opiniones de la DTN del OECE de 2025 y 2026 (Ley 32069) | gob.pe, institución OECE, «Informes y publicaciones», tipo opinión | hoy sólo hay 34 del régimen vigente |
| 1 | Acuerdos de Sala Plena y precedentes del Tribunal de 2025-2026 | gob.pe/oece, Tribunal de Contrataciones Públicas | criterios vinculantes del régimen nuevo: hay 1 |
| 2 | Directivas del OECE vigentes (bases estándar ya están): requerimiento, expediente, catálogos, PAC | gob.pe/oece, «Normas legales» | hoy hay 2 directivas |
| 2 | Tabla de concordancias Ley 30225 ↔ Ley 32069 (artículo viejo → artículo nuevo) | publicación del OECE o del MEF | permite convertir una opinión vieja en su artículo vigente |
| 2 | Modificatorias del reglamento posteriores al 09-01-2026 y Ley de Presupuesto 2027 | El Peruano | los topes por cuantía cambian cada año |
| 3 | Resoluciones del Tribunal sobre direccionamiento, requisitos de calificación y marcas (2025-2026) | buscador de resoluciones del Tribunal | ejemplos resueltos para el analista |
| 3 | Informes de control de la Contraloría por tipo de hallazgo | ya hay parte en `rag_fragmento` (informe_control) | criterio de auditoría |

## 7. Pendiente de diseño

- Versiones de un mismo artículo dentro del régimen (un artículo modificado en 2026): hoy se guarda el texto consolidado;
  con `vigencia_desde` y `vigencia_hasta` por fragmento se podría servir el texto que regía en cada fecha.
- Etiquetas de tema por fragmento (`temas`), para filtrar antes de buscar.
- Usar la tabla de concordancias para devolver, junto a un `criterio_anterior`, el artículo vigente equivalente.
