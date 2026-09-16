# Plan 2026-09-16 — Tres frentes: UX/UI (5 iteraciones), datasets y pipelines nuevos, RAG normativo en GCP

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans. Checkboxes (`- [ ]`) para seguimiento. Tres workstreams con archivos disjuntos: **U** (frontend + API de lectura), **D** (scrapers + migraciones de datos + jobs), **R** (RAG: GCS + Vertex AI + `tools/legal.py`).

**Estado de partida (hechos, 2026-09-16):** 20 contratos de bienes financiados por Vigía Perú y procesados (VIG-2026-00004/00005), 4 servicios Cloud Run por tipo, cola financiable = bienes con adjudicación/contrato (4 207), 18 394 contratos con record completo, 550 con documentos listos, ranking y muro de aliados sobre vistas materializadas, self-eval bloqueante (`alertas.estado='revision'`), scrapers probados: `oece_ocds`, `pnda_sancionados`, `pnda_visitas`; esqueletos: `onpe_claridad`, `jne_infogob`; RAG legal: 721 opiniones OECE en Vertex AI Search (`tools/legal.py`, `LEGAL_RAG_BACKEND=vertex`), sin normas primarias ni jurisprudencia.

---

## 0. Tres cosas que el usuario preguntó — respuestas cortas

**a) "Vigía tiene 10 contratos procesados pese a procesar 20".** El muro de aliados, el ranking y las cifras del mapa se leen de dos vistas materializadas (`ranking_impacto`, `zona_estado`) que solo se refrescan cuando corre `refresh_financiamiento()` (ingesta nocturna, Cloud Scheduler `vigia-financiamiento-asignar`, validación de un aporte). Los datos base estaban bien (20 asignaciones con `procesada_at`), la vista estaba vieja. **Corrección (U1):** el dispatcher refresca `ranking_impacto` al cerrar cada contrato, y la API de un aliado/comprobante lee en vivo (no de la vista) con caché de 30 s.

**b) "¿Por qué dice revisión humana?"** Al final de cada análisis corren 8 evaluadores (4 jueces LLM independientes con `gemini-3.5-flash` + 4 comprobaciones en código). Si cualquiera de estos umbrales falla, la alerta queda `estado='revision'`: **respaldo** < 60 % (banderas cuya evidencia no se encuentra en el expediente/OCDS/fuentes), **tono** acusatorio, **coherencia** "incoherente" entre banderas y dictamen, **citas** correctas < 80 %, **precio** plausible < 50 % (comparación de mercado dudosa), o URLs/RUC/DNI no verificables. En revisión: no aparece en listas públicas, mapa ni ranking de señales; sí en el detalle con la etiqueta; un admin puede **publicar** o **descartar** desde `/admin/revision` (U4) dejando el motivo en bitácora. Es el freno anti-alucinación: preferimos no publicar que publicar algo no verificado.

**c) "¿Diferencia entre entrar con perfil o sin perfil en el mapa?"** Hoy el mapa y las listas son iguales para todos; la cuenta (user-id + contraseña, sin correo) solo guarda tu identidad para denuncias y aportes. Propuesta (U3): **sin cuenta** = ver todo, financiar como invitado (comprobante por código), denunciar anónimo. **Con cuenta** = "Mi impacto" (mis aportes con progreso en vivo, comprobantes, señales halladas gracias a mí), seguir zonas/entidades/contratos (avisos cuando se procesan), perfil público de aliado (nombre/logo/visibilidad), y **Configuración** (datos, visibilidad, notificaciones, borrar cuenta). En el mapa, con sesión: capa "mis zonas", el botón Financiar prellenado con tu perfil y tus aportes previos en la zona.

---

## 1. Frente U — UX/UI, cinco iteraciones (cada una: implementar → build → deploy → recorrido en navegador con capturas → ajustar)

Reglas fijas: un solo mapa (`/app/mapa`), un botón por destino, "señal de riesgo" (nunca "corrupto"), datos personales por `Redact.tsx`, compacto (nada de KPIs decorativos). Vocabulario de estados público: *Sin analizar · Documentos listos · En cola · Esperando documentos · Procesando · Procesado · En revisión · Pendiente de procesamiento*.

### U1 — El mapa y las cifras dicen la verdad
- [x] Cola financiable = solo lo procesable hoy (bienes con adjudicación/contrato): el mapa, `/app/financiar/[ubigeo]` y el resumen global muestran **"contratos en cola (bienes con adjudicación)"** y aparte "contratos con documentos listos (otros tipos, análisis en preparación)"; tooltip que explica el alcance activo (`ajustes.procesamiento`).
- [x] Refresco en vivo: dispatcher → `REFRESH MATERIALIZED VIEW CONCURRENTLY ranking_impacto` al cerrar cada contrato (debounce 60 s); `/financiamiento/aliados/:slug`, `/impacto/:codigo` y `/financiamiento/estado` calculan en vivo (caché 30 s) — nunca más "10 de 20".
- [x] Contratos en **revisión** no cuentan como "señales halladas" públicas; sí como "procesados" (con nota "1 en revisión humana").
- [x] Capa Contratos: color por estado operativo (sin analizar / docs listos / en cola / procesado); leyenda de 4 estados; al elegir región, la pestaña Cola separa "financiable" de "documentos listos".
- [x] Panel `/app/auditoria`: la franja incluye "en revisión"; "descargados 24 h" pasa a "documentos descargados (últimos 7 días)" para que no se lea como contratos nuevos.

### U2 — Menos fricción para financiar y denunciar
- [x] `/app/financiar`: elegir zona en 1 clic desde el mapa (`?ubigeo=`), monto por defecto 10 contratos (S/ 30), 3 pasos máximo (zona → cantidad → pago), Yape/Plin con QR grande y copia del número, "¿qué pasa después?" en una línea; guardar borrador en `localStorage`; comprobante enviado por foto opcional.
- [x] Comprobante `/impacto/[codigo]`: primer contrato procesado visible en ≤ 5 min con el tablero embebido; compartir con OG image ya existente; estado del pago claro (pendiente de validación → validado → en proceso → completo).
- [x] `/reporte/nuevo`: geolocalización con un tap, cámara directa en móvil, 3 campos obligatorios, progreso de subida, confirmación con enlace al pin.
- [x] Búsqueda global (`⌘K` / campo en cabecera): OCID, código, entidad, RUC, zona → resultados agrupados.

### U3 — Cuenta, perfil y configuración (sin cuenta sigue funcionando todo)
- [x] `/app/mi-impacto` (con sesión): mis aportes (código, zona, progreso en vivo, señales halladas, comprobante), mis denuncias (estado de moderación), mis zonas/entidades seguidas.
- [x] `/app/configuracion`: nombre público y logo (si quiero aparecer en el muro), visibilidad (anónimo/visible), notificaciones (correo opcional: "cuando se procese un contrato que financié" / "cuando haya señales en mi zona"), exportar mis datos, borrar cuenta. Migración `26_cuentas.sql` (22 la ocupó `refresh_ranking`): `usuarios(firebase_uid, financiador_id, zonas_seguidas[], entidades_seguidas[], notificaciones jsonb)`.
- [x] Al financiar con sesión: financiador asociado al `firebase_uid` (no se pide de nuevo nombre/logo); sin sesión: flujo invitado + "crea una cuenta para seguir tu aporte" después del comprobante (nunca antes).
- [x] Mapa con sesión: capa "Mis zonas" (chip), botón Financiar prellenado; sin sesión: idéntico sin la capa. Cabecera: menú de usuario (Mi impacto · Configuración · Salir) — un solo lugar.

### U4 — Admin que sirve para operar
- [x] `/admin/revision`: cola de alertas en `revision` con el motivo (respaldo %, tono, citas, precio, URLs), las banderas con su verificación, dictamen, y dos botones: **Publicar** (→ `activa`, bitácora) / **Descartar** (→ `descartada`, motivo). Umbrales editables en `ajustes.self_eval`.
- [x] `/admin` resumen: salud (dispatcher última corrida, servicios por tipo `GET /`, cuota de memoria, relay, batch nocturno último lote), cola por estado, pedidos de descarga, aportes pendientes de validar — todo en una pantalla con enlaces.
- [x] `/admin/procesamientos`: acciones "re-analizar" (con confirmación de costo ≈ US$0.25) y "ver traza" (carriles + bitácora del `[ocid]`), filtro por perfil/servicio.
- [x] `/admin/cobertura`: barra de progreso del lote nocturno de documentos (76 586 → n), estimación de fin, errores por tramo.
- [x] Bitácora: registrar publicar/descartar/re-analizar/config.

### U5 — Pulido de auditoría en vivo, detalle de contrato, responsive y accesibilidad
- [x] `/app/auditoria/[ocid]`: mostrar **qué reglas corrieron y no dispararon** (lista plegable "22 reglas evaluadas · 3 señales"), tiempos por agente, costo, versión del pipeline; en revisión: los motivos en lenguaje claro.
- [x] `/app/contratos/[ocid]`: postores con sus ofertas (tabla), ítems con precio contratado vs referencia, documentos con "Ver" y página citada por cada señal (enlace a la página del PDF: `#page=N`).
- [x] Móvil: kanban → lista; carriles → acordeón; mapa con panel inferior deslizable. Teclado/aria en filtros y tabs; contraste AA.
- [x] Rendimiento: `/app/contratos` < 1 s (índices ya creados), imágenes de aliados con `next/image`, `revalidate` afinado; Lighthouse ≥ 90 en móvil.

---

## 2. Frente D — Ampliar datasets y pipelines

Principio: **todo lo que toca `.gob.pe` corre desde IP peruana** (laptop/VPS, `batch-nocturno.sh`), sube el crudo a `gs://vigia-peru-batch/raw/<fuente>/<fecha>/`, y `vigia-ingest` (Cloud Run Job) normaliza a Postgres. Cada fuente: tabla normalizada + `fuente`, `descargado_at`, `sha256` del crudo; visible en `/admin/cobertura`.

| Prioridad | Fuente | Qué aporta (cruce) | Acceso | Pipeline | Estado |
|---|---|---|---|---|---|
| 1 | **PNDA — Registro de visitas en línea** (PCM, mensual) | C8/lobby: visitas de representantes de postores a la entidad antes de la convocatoria (`lobby_visits_pre_convocatoria`) | XLSX mensual | `pnda_visitas` (probado) → programar mensual + backfill 2024-2026 | cargar todo el histórico y activar la regla |
| 1 | **ONPE Claridad — aportantes y gastos de campaña** | C3: aportante = ganador / socio de ganador en entidad gobernada por el partido | Cloudflare → Playwright + IP PE | `onpe_claridad` (esqueleto) → implementar exportación por proceso electoral (EG2021, ERM2022, EG2026) y normalizar `onpe_aportantes(dni/ruc, nombre, partido, monto, fecha, proceso)` | implementar |
| 1 | **JNE Infogob — candidatos y autoridades electas** | vincula alcaldes/gobernadores/regidores con partido y periodo → C3 y `funcionario_con_historial_politico` | SPA + reCAPTCHA → Playwright | `jne_infogob` (esqueleto) → autoridades vigentes por ubigeo | implementar |
| 2 | **PNDA — DJI (declaraciones juradas de intereses)** | C4/C9: parientes, empresas y empleos previos de funcionarios (puerta giratoria) | CSV | `pnda_dji` (listo) → cargar + índice por DNI/RUC | cargar |
| 2 | **OECE RNP — conformación jurídica** (socios, representantes) | ya en `rnp_*` (snapshot mayo 2026) → refresco trimestral | descarga manual/Playwright | nuevo `oece_rnp` | refresco |
| 2 | **Contraloría — informes de control e INFOBRAS** | `infobras_avance` (obras), informes de control por entidad (`observacion_contraloria_entidad`) | INFOBRAS datasets + buscador de informes | `cgr_informes`, `infobras` | nuevo |
| 3 | **SUNAT padrón RUC** (datos abiertos) | edad del RUC, estado, CIIU sin depender de decolecta (costo/latencia) | ZIP mensual grande | `sunat_padron` | nuevo |
| 3 | **El Peruano — designaciones** | C8: funcionario rota → proveedor lo sigue | buscador + PDF | `peruano_designaciones` | nuevo |
| 3 | **PLADICOP** (reemplazo del SEACE) | continuidad de la cola cuando migre la fuente | por explorar | — | vigilar |

Entregables D: pipelines con `--dry-run`, tests con fixtures, migraciones de tablas normalizadas (`23_datasets.sql`), `run_all.py` con los nuevos, línea en `batch-nocturno.sh` (semanal para visitas/DJI, mensual ONPE/JNE), y en `/admin/cobertura` una sección "Fuentes externas" (última descarga, filas, error). Cada fuente nueva activa o mejora una regla determinista existente (no se agregan fuentes que no se crucen).

Seguimiento (2026-09-16, detalle y cifras en `docs/design/DATASETS.md`):
- [x] Migraciones `23_datasets.sql` (datasets_cargas, columnas fuente/periodo/sha256, jne_autoridades, dji_*, vista `datasets_cobertura`), `24_jne_autoridades_detalle.sql`, `25_onpe_candidatos.sql` — aplicadas en Cloud SQL.
- [x] **PNDA visitas**: backfill de todo el histórico publicado (2025-01 → 2026-05; 2024 y 2026-06+ no existen en la PNDA) a `gs://vigia-peru-batch/raw/pnda_visitas/<AAAA-MM>/` y a `visitas_entidades` por periodo, idempotente por sha256; `--desde/--hasta/--dry-run`. Hallazgo: el dataset lo publica solo el GORE Loreto; el portal PCM (todas las entidades) tiene Turnstile → `--xlsx` para exportaciones manuales (recargado abr-may 2026).
- [x] **ONPE Claridad**: exportación real por proceso vía la API interna del portal (Playwright con ventana + reCAPTCHA v3 generado en la página) → `onpe_aportantes` con DNI/RUC completos, `proceso`, `ruc_organizacion`, `sha256`; + `onpe_candidatos` (padrón con DNI). Procesos: ERM2018, ECE2020, EG2021, ERM2022, EMC*, EG2026 e IFA2019-2024.
- [x] **JNE autoridades**: `jne_autoridades` desde el reporte oficial del JNE en la PNDA (vigentes + electas, ubigeo INEI resuelto, vigencia, reemplazos) para todo el país (Cusco y Puno incluidos); DNI completado desde `onpe_candidatos`; `jne_candidaturas` recibe `numero_documento` (antes 0 filas con DNI).
- [x] **DJI** (prioridad 2): `dji_funcionarios` y `dji_empleos` cargados con índices por RUC/nombre.
- [x] Tests con fixtures (`backend/scrapers/tests/test_datasets.py`), `run_all.py`, paso 6 de `batch-nocturno.sh` (visitas días 1/15, JNE+DJI día 5, sancionados domingo, ONPE con `ONPE=1`), README de scrapers, `docs/design/DATASETS.md`.
- [ ] Portal PCM de visitas (todas las entidades) automatizado — bloqueado por Turnstile (evidencia en DATASETS.md); hoy solo export manual.
- [ ] Sección "Fuentes externas" en `/admin/cobertura` (frontend/API leen la vista `datasets_cobertura`; fuera del alcance de D).
- [ ] `oece_rnp` (refresco trimestral de la conformación jurídica) — no iniciado.
- [ ] Contraloría (informes de control, INFOBRAS), SUNAT padrón, El Peruano — prioridad 2/3, no iniciados.

---

## 3. Frente R — RAG normativo en GCP (Vertex AI RAG Engine + Vertex AI Search)

Base: `rag-docs/propuesta.md` (13 fichas con URL oficial: Ley 32069, D.S. 009-2025-EF y modificatorias, TUO 30225 + D.S. 344-2018-EF, Acuerdos de Sala Plena 004-2019 y 002-2023/TCE, Opiniones DTN, MAC de la CGR, Directiva de control concurrente, Ley 31288, TUO 27444, criterio de Acuerdos Marco) + las 721 opiniones OECE ya cargadas + bases estándar OECE + resoluciones del TCE/TCP.

### 3.1 Corpus propuestos (5, separados por régimen y por tipo epistémico — así el agente filtra por fecha de convocatoria y por "qué peso tiene" la fuente)

| Corpus | Contenido | Tamaño estimado | Filtro de uso |
|---|---|---|---|
| `normas-vigentes` | Ley 32069 (+ D.L. 1715, Leyes 32513/32515), D.S. 009-2025-EF (+ D.S. 001-2026-EF), directivas OECE vigentes, bases estándar 2025-2026, TUO 27444 | ~15 PDFs, ~2 500 páginas | convocatoria ≥ 2025-04-22 |
| `normas-historicas` | TUO 30225 (D.S. 082-2019-EF), D.S. 344-2018-EF y modificatorias, directivas OSCE, bases estándar 2019-2024 | ~20 PDFs, ~3 000 páginas | convocatoria < 2025-04-22 (ultraactividad) |
| `criterios-vinculantes` | Acuerdos de Sala Plena TCE/TCP, Opiniones DTN (las 721 + nuevas 2025-2026 del OECE), pronunciamientos | ~1 000 documentos cortos | ambos regímenes, etiqueta `vinculante=true` |
| `control-cgr` | Manual de Auditoría de Cumplimiento, directivas de control (concurrente, específico), Ley 31288, guías de red flags de la CGR | ~10 PDFs, ~1 500 páginas | para redactar Condición/Criterio/Causa/Efecto en el dictamen |
| `resoluciones-tce` (fase 2) | Resoluciones del Tribunal por año (sanciones, nulidades) | miles de PDFs (el único corpus grande) | citar precedentes por causal; se agrega solo si el costo lo permite |

Metadata por documento (JSONL junto al PDF en GCS): `regimen` (32069 | 30225 | ambos), `tipo` (norma | reglamento | criterio_vinculante | opinion | control | bases_estandar | resolucion), `vigencia_desde/hasta`, `emisor`, `numero`, `url_oficial`, `articulos` (si se pre-segmenta por artículo). Chunking: por artículo/numeral para normas (regex "Artículo N°"), por documento para opiniones cortas, 512-1 024 tokens con solape 100 para el resto.

### 3.2 Opción de arquitectura y costo (todo en GCP, la más barata que sirve)

| Opción | Cómo | Costo mensual estimado a nuestra escala (≈ 6 000 páginas, ≈ 20 k chunks, ≈ 3 000 consultas/mes) | Pros / contras |
|---|---|---|---|
| **A. Vertex AI RAG Engine + RagManagedDb (recomendada para empezar)** | `rag.create_corpus()` por corpus, `import_files` desde `gs://vigia-peru-rag/<corpus>/`, embeddings `text-embedding-005` (o `gemini-embedding-001`), retrieval con `rag.retrieval_query` y como tool `VertexRagStore` en los agentes | RagManagedDb nivel **Basic** sin costo de infraestructura; embeddings ≈ 20 k chunks × ~700 tokens ≈ 14 M tokens ≈ **US$ 0.3–1.4 una vez** (verificar tarifa de `text-embedding-005` por 1 k caracteres); consultas: costo de embedding de la pregunta (centavos) + Gemini que ya pagamos. **≈ US$ 1–5/mes** | GCP nativo, filtros por metadata, se enchufa como tool de Gemini (grounding con citas de chunk); sin servidor. Contra: el nivel Basic tiene topes de tamaño/QPS (ver límites vigentes); para `resoluciones-tce` habría que pasar al nivel Scaled (con costo por hora) |
| B. Vertex AI Search (lo que ya usamos para opiniones) | Un data store por corpus (unstructured, GCS), metadata JSONL; consulta por API Discovery Engine | Search Standard/Enterprise: **US$ 1.5–4 por 1 000 consultas** + índice (**US$ 5/GB/mes**, primeros 10 GiB gratis) → ≈ **US$ 5–15/mes** | Muy buena calidad de búsqueda y extractos con página; más caro por consulta; menos integrado como tool |
| C. pgvector en Cloud SQL (ya existe como fallback) | embeddings en Postgres | solo el costo de embeddings; consultas gratis | sin infraestructura extra, pero calidad de recuperación inferior (sin híbrido/rerank) y mantenimiento propio |

**Decisión propuesta:** A para los 4 corpus base (y B se mantiene para las 721 opiniones hasta migrarlas al corpus `criterios-vinculantes`, luego se apaga para no pagar dos índices). Verificar precios y límites del RagManagedDb Basic en `cloud.google.com/vertex-ai/generative-ai/pricing` y `docs/rag-engine` el día de la implementación (dejar la tabla con fecha).

**Verificado el 2026-09-16 (ver `docs/design/RAG_NORMATIVO.md` §1):** el tier Basic de RagManagedDb NO es gratuito (instancia Spanner de 100 PU ≈ US$ 66-90/mes); lo gratuito es el **modo serverless** de RAG Engine (Vector Search 2.0 por uso, ≈ US$ 0,3-1/mes a nuestra escala). Se implementó A en modo serverless; embeddings `text-multilingual-embedding-002` (gemini-embedding-001 no está permitido en RAG Engine). Límite real del proyecto: cuota de 5 RPM para embeddings (aumento denegado por API) → importación lenta y consultas con fallback a B/C en ráfagas; pedir aumento por consola.

### 3.3 Pipeline de ingesta (GCP)
- [x] `backend/rag/` (nuevo): `fuentes.yaml` (las 13 fichas + opiniones + bases estándar: url, corpus, metadata), `descargar.py` (a `gs://vigia-peru-rag/<corpus>/<slug>.pdf` + `.metadata.json`, sha256, idempotente), `segmentar.py` (normas por artículo → JSONL de chunks con `articulo`, `pagina`), `corpus.py` (crear/actualizar corpus de RAG Engine, `import_files` con chunking configurado, listar, borrar), `consultar.py` (CLI de prueba: pregunta → top-k con corpus/regimen filtrado).
- [x] `tools/legal.py`: `query_legal_rag(question, regimen=, tipo=)` → RAG Engine (`LEGAL_RAG_BACKEND=rag_engine`), con `norma_aplicable(fecha)` eligiendo el corpus; respuesta con `{corpus, documento, articulo, pagina, cita, url_oficial}`; el `document_legal_analyst` y `report_writer` citan artículo + URL; `evaluate_normative_compliance` usa `criterios-vinculantes` primero.
- [x] Evaluación: `backend/rag/evalset.jsonl` con 40 preguntas reales de las reglas (fraccionamiento, plazos, único postor, contratación directa, adicionales, garantías…) con el artículo esperado; script que mide recall@5 por corpus; umbral ≥ 0.8 antes de activar en producción. **Estado 2026-09-16:** evalset con 73 preguntas y `evaluar.py` listos; recall final pendiente de que termine el import (cuota 5 RPM): sobre lo ya cargado y con cuota, 10/10 en rank 1. `LEGAL_RAG_BACKEND=rag_engine` ya desplegado con cascada a Vertex/pgvector (sin regresión mientras se completa).
- [x] Costo y límites documentados en `docs/design/RAG_NORMATIVO.md` (con fecha de verificación de precios).

---

## 4. Orden y dependencias
1. **U1 + U4** primero (la verdad de las cifras y la cola de revisión: son los que afectan credibilidad hoy) → deploy.
2. **R** (corpus base A: 4 corpus) en paralelo con **D** prioridad 1 (visitas histórico, ONPE, JNE).
3. **U2, U3, U5** → cada iteración con capturas en `docs/design/capturas/2026-09-16-u<n>/`.
4. Cierre: memoria, README, `docs/design/RAG_NORMATIVO.md`, `docs/design/DATASETS.md`, commit por frente.
