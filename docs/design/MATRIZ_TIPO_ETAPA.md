# Matriz tipo × etapa × agentes

Qué agentes del pipeline corren para cada contrato del SEACE según **qué es** (tipo de
contratación) y **en qué punto está** (etapa). Lo implementa `backend/core/clasificacion.py`;
se persiste en `convocatorias` (migración 13) y lo respetan el dispatcher
(`backend/dispatcher/main.py`) y el orquestador (`backend/agent/deterministic.py`).

Principios:

- **Nunca se inventa.** Si a un agente le faltan datos, se omite y el hueco queda en
  `validaciones_pendientes`; el dictamen las lista al final bajo "Validaciones pendientes".
- **Lo no soportado no se cobra.** `procesable = false` saca el contrato de `cola_auditoria`
  (no entra a la asignación FIFO de aportes) y, si ya estaba asignado, el dispatcher lo deja en
  `pendiente_de_procesamiento` sin llamar al orquestador.
- **La clasificación no cambia el orden.** La asignación sigue siendo FIFO
  (`asignar_contribucion`); la matriz solo decide qué agentes corren.
- **Compatibilidad.** Sin `clasificacion` en el body del orquestador corren los 10 agentes
  (análisis a demanda del admin, idéntico al flujo anterior).

## 1. Hechos medidos que definen las reglas (2026-09-15, 18 413 releases jun→sep 2026)

| Dato | Valor |
|---|---|
| `tender.status` | **siempre null** (18 413 / 18 413) → la etapa no puede salir de ahí |
| `tag` del release | `planning,tender` 9 030 · `+award` 4 234 · `+award,contract` 5 033 · `+implementation` 29 · `compiled` 86 (records que persistió el orquestador) |
| `tender.items[].statusDetails` | CONVOCADO 6 785 · CONTRATADO 5 472 · CONSENTIDO 3 333 · **DESIERTO 2 253** · ADJUDICADO 1 254 · **NULO 594** · **CANCELADO 220** · APELADO 158 · RETROTRAIDO_POR_RESOLUCION 105 · SUSPENDIDO 61 · PENDIENTE_DE_REGISTRO_DE_EFECTO 29 · NO_SUSCRIPCION_CONTRATO 12 · CONVOCADO_POR_REINICIO 3 |
| Release recortado (`ocds_payload`) | guarda `ocid,id,date,tag,buyer,tender` — **sin `awards`, `contracts` ni `parties`** |
| Record completo (`/record/<ocid>`) | trae `awards[].suppliers[].id = PE-RUC-…`, `contracts[]`, `parties` (roles buyer/supplier); `awards[].status` y `contracts[].status` vienen null |
| Documentos | todos los releases traen `tender.documents` con `documentType` (biddingDocuments 39 114 · awardNotice 11 669 · clarifications 10 894 · evaluationReports 10 352) |
| Ítems | todos traen `quantity` + `unit.name`; `classification` CUBSO en el 81 % |
| Releases solo-`planning` | **ninguno**: SEACE publica planning+tender juntos |

Consecuencias: la etapa se deriva de **objetos del record → tags → `statusDetails` de ítems**
(en ese orden de confianza); desierta/nula/cancelada solo son visibles en `statusDetails`; el
RUC del proveedor solo se conoce con el record completo (el orquestador lo trae al analizar).

## 2. Derivación

### Tipo (`tipo_contratacion`)

`mainProcurementCategory` + `procurementMethodDetails` (+ título/descripción). La modalidad
manda cuando cambia el régimen o la naturaleza:

| Regla (sin tildes, minúsculas) | Tipo |
|---|---|
| modalidad contiene `contratacion directa` | `directa` |
| modalidad empieza por `convenio`, o contiene `regimen especial` / `contratacion internacional` | `convenio` |
| modalidad contiene `consultoria` (Concurso Público para Consultoría) **o** título/descripción contiene `consultoria de obra` | `consultoria` |
| categoría `goods` / `services` / `works` | `bienes` / `servicios` / `obras` |
| ninguna | `otro` → no procesable (`tipo_no_soportado`) |

Modalidades no listadas (Procedimiento Especial de Contratación, Adjudicación Selectiva,
Homologación, Contrato Marco…) caen en el tipo de su categoría: el análisis es el mismo.

### Etapa (`etapa`)

Primera regla que aplica, de arriba abajo:

| # | Condición | Etapa |
|---|---|---|
| 0 | marcado nulo en `dataset/nulos/*.xlsx` (columna `codigoconvocatoria`) | `nula` |
| 1 | algún `contracts[].status = terminated` | `finalizada` |
| 2 | tag `implementation` **o** `contracts[].implementation` con `transactions`/`milestones` | `en_ejecucion` |
| 3 | `contracts[]` no vacío **o** tag `contract` **o** algún ítem `CONTRATADO` | `contratada` |
| 4 | `awards[]` con status ≠ unsuccessful/cancelled **o** tag `award` **o** algún ítem `ADJUDICADO` / `CONSENTIDO` / `APELADO` | `adjudicada` |
| 5 | `tender.status = cancelled` | `cancelada` |
| 6 | `tender.status = unsuccessful` **o** hay awards y todos son unsuccessful | `desierta` |
| 7 | **todos** los ítems en {DESIERTO, NULO, CANCELADO, NO_SUSCRIPCION_CONTRATO…} | `nula` si alguno NULO; si no `cancelada` si alguno CANCELADO/NO_SUSCRIPCION; si no `desierta` |
| 8 | tag `tender` **o** `tender.items` / `tenderPeriod` / `datePublished` | `convocada` (incluye SUSPENDIDO, RETROTRAIDO, CONVOCADO_POR_REINICIO, PENDIENTE_DE_REGISTRO_DE_EFECTO) |
| 9 | tag `planning` **o** bloque `planning` | `planificacion` → no procesable (`etapa_planificacion`) |
| 10 | nada de lo anterior | `desconocida` → no procesable (`etapa_desconocida`) |

Procesos **parciales** (p. ej. `CONTRATADO|DESIERTO`): manda el ítem más avanzado; el
análisis cubre lo adjudicado y el compliance ve el ítem desierto en el OCDS.

### Otros campos

- `modalidad`: `procurementMethodDetails` tal cual.
- `proveedor_ruc`: `awards[].suppliers[].id` (`PE-RUC-…`) del award activo, o party con rol
  `supplier`. NULL en releases recortados.
- `clasificado_at`: momento de la última clasificación (la ingesta la refresca en cada release
  nuevo; la etapa avanza con el tiempo).

## 3. Matriz tipo × etapa → agentes

Agentes (orden del pipeline): `compliance`, `document_parser`, `document_legal_analyst`,
`market`, `web_research`, `news_research`, `entity_personnel`, `person_network`,
`compliance_extended`, `report_writer`.

| tipo \ etapa | planificacion | convocada | adjudicada | contratada · en_ejecucion · finalizada | desierta · cancelada · nula |
|---|---|---|---|---|---|
| **bienes** | PENDIENTE | compliance · document_parser · document_legal_analyst · **market** · entity_personnel · report_writer | + web_research · news_research · person_network · compliance_extended (los 10) | los 10 | compliance · report_writer (breve) |
| **servicios** | PENDIENTE | compliance · document_parser · document_legal_analyst · entity_personnel · report_writer (**sin market**: no hay precio unitario comparable) | + web_research · news_research · person_network · compliance_extended | igual (sin market) | compliance · report_writer (breve) |
| **consultoria** | PENDIENTE | igual que servicios | igual que servicios | igual que servicios | igual |
| **obras** | PENDIENTE | igual que servicios (**sin market**: el mercado de obras es el expediente técnico, no soportado) | igual que servicios | igual + `validaciones_pendientes: [infobras_avance]` | igual |
| **convenio · directa** | PENDIENTE | compliance (causal art. 27) · document_parser · document_legal_analyst · report_writer | + person_network · web_research · news_research | los 10 (market se omite solo si no hay ítems físicos) | compliance · report_writer (breve) |
| **otro / desconocida** | PENDIENTE DE PROCESAMIENTO (`procesable=false`, motivo `tipo_no_soportado` / `etapa_desconocida`) | | | | |

`MATRIZ[(tipo, etapa)]` en `clasificacion.py` cubre las 54 combinaciones soportadas
(6 tipos × 9 etapas). El test `test_matriz_cubre_todo_tipo_x_etapa_soportado` lo garantiza.

### Datos requeridos por agente (si faltan → se omite + validación pendiente)

| Agente | Requiere | Código en `validaciones_pendientes` |
|---|---|---|
| `market` | ≥ 1 ítem con `quantity > 0`, `unit.name` y físico (categoría goods, o clasificación CUBSO/UNSPSC con segmento < 70) | `market_sin_items_fisicos` |
| `document_parser` (+ `document_legal_analyst`, que analiza lo que el parser extrajo) | ≥ 1 documento `biddingDocuments` / `awardNotice` / `contractSigned` con URL (en tender, awards o contracts) | `sin_documentos_descargables` |
| `web_research` · `news_research` · `person_network` · `compliance_extended` | RUC del proveedor. **Solo se verifica con record completo** (clave `awards` presente): con release recortado en etapa post-adjudicación el orquestador lo resuelve al traer el record, no se omite a ciegas | `proveedor_sin_ruc` |
| `entity_personnel` | RUC de la entidad (party buyer, o `convocatorias.entidad_ruc` como pista) | `entidad_sin_ruc` |
| obras contratada+ | avance físico INFOBRAS (no disponible hoy): no omite agentes, solo se declara | `infobras_avance` |

`compliance` y `report_writer` están en toda combinación procesable: el primero crea la alerta
sobre la que persiste todo lo demás; sin el segundo la corrida deja una alerta sin dictamen
legible (por eso también va en las etapas negativas de convenio/directa, como dictamen breve).

## 4. Qué queda PENDIENTE y por qué

| Situación | Tratamiento | Por qué |
|---|---|---|
| `planificacion` | `procesable=false`, `etapa_planificacion` | Sin bases ni postores no hay nada que analizar; se reclasifica cuando llegue el release `tender`. Hoy no ocurre en datos reales (SEACE publica planning+tender juntos). |
| `otro` (sin categoría ni modalidad) | `procesable=false`, `tipo_no_soportado` | Único caso real: un registro interno `ocds-vigia-01/…` con solo `fundamento_legal`. |
| `desconocida` | `procesable=false`, `etapa_desconocida` | Payload sin tender/tags/ítems. |
| obras en ejecución | `infobras_avance` | INFOBRAS no está integrado; el dictamen lo declara en vez de suponer el avance. |
| market en servicios/obras/consultoría | no está en la matriz | Sin precio unitario comparable (servicios) o mercado = expediente técnico (obras). |
| convenio contratado sin ítems físicos | `market_sin_items_fisicos` | 490 casos reales: convenios de servicios (`unit = Servicio`). |

## 5. Flujo en producción

1. **Ingesta** (`backend/scrapers/oece_ocds`, y `backend/batch/ingestar` cuando exista):
   `normalize_release` llama a `clasificar(release, entidad_ruc_hint=ruc)` sobre el release
   completo y el upsert escribe las 9 columnas. En cada release nuevo la clasificación se
   **reemplaza** (la etapa avanza); `proveedor_ruc` no se pisa con NULL.
2. **Reclasificación masiva**: `python -m backend.core.clasificacion --reclasificar [--dry-run]`
   (lotes de 1 000 con `UPDATE … FROM (VALUES …)`, cursor de servidor; cruza
   `dataset/nulos/*.xlsx`).
3. **Dispatcher**: tras `reclamar_procesamientos`, lee la clasificación; `procesable=false` →
   `procesamientos.estado = 'pendiente_de_procesamiento'` (motivo en `error`, sin consumir
   intento, sin orquestador). Si procesable, el body al orquestador lleva
   `clasificacion: {tipo, etapa, agentes, validaciones_pendientes}`.
4. **Orquestador** (`agent/main.py` → `initial_state["agentes_permitidos"]`;
   `deterministic.permitido(state, nombre)` en cada agente). Los omitidos emiten
   `{"kind":"phase","name":"<agente>","msg":"omitido: no aplica a <tipo>/<etapa>"}` (el tablero
   avanza la fase igual). `evaluate_normative_compliance`, `persist_alert_from_flags` y los
   `persist_analysis_outputs` corren siempre (son del driver). El `report_writer` recibe las
   validaciones pendientes en su mensaje y cierra con "## Validaciones pendientes"; en etapas
   negativas se le pide dictamen breve.
5. **Admin**: `GET /admin/clasificacion/resumen` → celdas tipo × etapa × procesable, totales,
   motivos y validaciones más frecuentes. `GET /admin/procesamientos?estado=pendiente_de_procesamiento`.

## 6. Distribución real tras reclasificar (Cloud SQL, 2026-09-15, 18 413 convocatorias)

Por tipo: bienes 7 770 · servicios 5 240 · obras 3 313 · consultoria 1 148 · convenio 923 ·
directa 18 · otro 1.
Por etapa: convocada 6 069 · contratada 5 086 · adjudicada 4 397 · desierta 2 095 · nula 535 ·
cancelada 201 · en_ejecucion 29 · desconocida 1.
**Procesables: 18 412 · pendientes de procesamiento: 1** (`tipo_no_soportado`).
Validaciones pendientes: `infobras_avance` 739 · `market_sin_items_fisicos` 493 ·
`proveedor_sin_ruc` 6. `cola_auditoria`: 18 353 → 18 352.

| n | tipo | etapa | | n | tipo | etapa |
|---|---|---|---|---|---|---|
| 2 401 | bienes | contratada | | 176 | consultoria | contratada |
| 2 307 | bienes | convocada | | 164 | convenio | adjudicada |
| 1 954 | servicios | convocada | | 155 | bienes | nula |
| 1 712 | bienes | adjudicada | | 134 | consultoria | desierta |
| 1 277 | servicios | adjudicada | | 132 | convenio | convocada |
| 1 178 | servicios | contratada | | 107 | servicios | nula |
| 1 154 | obras | convocada | | 98 | servicios | cancelada |
| 1 102 | bienes | desierta | | 76 | bienes | cancelada |
| 976 | obras | adjudicada | | 47 | consultoria | nula |
| 739 | obras | contratada | | 27 | convenio | desierta |
| 617 | servicios | desierta | | 17 | bienes | en_ejecucion |
| 579 | convenio | contratada | | 13 | directa | contratada |
| 522 | consultoria | convocada | | 12 | obras | cancelada |
| 263 | consultoria | adjudicada | | 9 · 9 · 9 | convenio cancelada · convenio nula · servicios en_ejecucion |
| 217 | obras | nula | | 6 · 5 · 3 · 1 | consultoria cancelada · directa adjudicada · convenio en_ejecucion · otro desconocida (PENDIENTE) |
| 215 | obras | desierta | | | | |

Lectura: el 15 % de los procesos de 90 días terminó desierto/nulo/cancelado (compliance +
dictamen breve: se analiza la causal, no se gasta en investigación de proveedor); el 52 % ya
tiene proveedor (adjudicada+), donde sí corre la investigación completa.

## 7. Fixtures de test (`backend/core/tests/fixtures/`)

Releases reales de `convocatorias.ocds_payload` (2 bienes convocada, bienes contratada,
servicios adjudicada, obras contratada, consultoría, convenio, directa, desierta, nula,
cancelada, en ejecución) y 2 records completos bajados de `/record/<ocid>` (bienes contratada,
servicios adjudicada). `release_planning_only.json` es la única sintética (derivada de un
release real, tag solo `planning`), porque la etapa existe en el vocabulario pero SEACE no
publica ese release. Cada fixture declara su origen en `_fixture`.
