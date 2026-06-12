# Vigía Perú — Cómo funciona la solución

> Documento de visión técnica para entender **qué hace** Vigía Perú, **cómo fluyen los
> datos** y **cómo está construido**. Para el detalle de infraestructura ver
> [`ARQUITECTURA.md`](ARQUITECTURA.md); para el dataset local, [`DATASET_MAP.md`](DATASET_MAP.md);
> para la visión de producto, [`proyecto/proyecto.md`](proyecto/proyecto.md).

---

## 1. El problema en una frase

En el Perú la corrupción en contrataciones públicas **ya es dato público** (SEACE, OECE,
SUNAT, INFOBRAS, ONPE…), pero está **ilegible**: PDFs de 80 páginas escaneados, repartidos
en una docena de portales que no se cruzan entre sí. Revisar **un** contrato sospechoso le
toma días a un periodista. Hay miles cada mes.

**Vigía Perú** baja ese costo a **≈ 1 sol y ≈ 3 minutos por contrato**: un sistema de
agentes de IA lee el expediente, cruza los datos abiertos, y emite **señales de riesgo**
—nunca acusaciones— cada una **enlazada a su fuente oficial**.

---

## 2. Las tres capas

```
┌──────────────────────────────────────────────────────────────────────────┐
│  CAPA MÁQUINA            CAPA CIUDADANA           CAPA DE CONVERGENCIA      │
│  ───────────────         ────────────────         ──────────────────────   │
│  11 agentes de IA        Reporte ciudadano        Alerta automática (🟡)   │
│  leen contratos del      con foto + GPS de         + reporte ciudadano (🔴) │
│  Estado, cruzan datos    una obra paralizada       sobre la MISMA obra      │
│  abiertos y emiten       o anómala.                = caso ROJO (⬛)         │
│  alertas de riesgo.                                listo para periodista     │
│                                                    o fiscal.                 │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                  Mapa interactivo del Perú con pines
                  🟡 alerta  ·  🔴 reporte  ·  ⬛ convergencia
```

El MVP implementa **la capa máquina completa** + el **formulario ciudadano**
+ el **mapa**, sobre una región piloto.

---

## 3. Flujo de datos end-to-end (análisis de un contrato)

Lo que ocurre cuando alguien pega un código de convocatoria (OCID / código SEACE / RUC) y
pulsa **Analizar**:

```
 USUARIO                FRONTEND (Next.js)            ORQUESTADOR ADK (Cloud Run)
 ───────                ──────────────────            ───────────────────────────
 pega un código ───────► POST /analyze ──────────────► Runner ADK arranca el
                         (stream NDJSON)                coordinador (Gemini 2.5)
                              ▲                                │
                              │  eventos en vivo              ▼
                              │  (tool_call, transfer,   ┌─────────────────────────┐
                              │   hallazgos, evals)      │  PIPELINE DE 11 AGENTES │
                              │                          │  (ver §4)               │
                              └──────────────────────────┤                         │
                                                         └───────────┬─────────────┘
                                                                     │
                            ┌────────────────────────────────────────┼───────────────┐
                            ▼                    ▼                     ▼               ▼
                      OECE/SEACE           Document AI            Vertex AI        SUNAT
                      (OCDS + PDFs)        (OCR de PDFs)          Search (RAG      (RUC, vía
                      vía relay Lima                              721 opiniones    apis.net.pe)
                                                                  OECE)
                                                                     │
                                                                     ▼
                                                         Cloud SQL (PostgreSQL+PostGIS)
                                                         alerta + banderas + análisis
                                                                     │
 ve el dossier ◄──────── GET /alertas/:id/full ◄─────────  API liviana (Hono/TS, cache)
```

Paso a paso:

1. **Ingesta OCDS.** El orquestador trae el registro del contrato (objeto, entidad,
   postores, ganador, documentos) desde **Contrataciones Abiertas del OECE** en formato
   OCDS. Como los portales `.gob.pe` bloquean IPs de la nube, las descargas pasan por un
   **relay residencial en Lima**.
2. **Reglas duras (compliance).** Se evalúan reglas codificables: único postor al 100% del
   valor referencial, contratación directa, proveedor sancionado/inhabilitado, etc. Cada
   bandera cita su norma (Ley 32069 / Ley 30225) y una **opinión normativa del OECE**.
3. **Lectura de documentos.** Se descargan los PDFs del expediente (bases, acta de buena
   pro, contrato). **Document AI** hace OCR del documento completo y el texto se manda a
   Gemini en **una sola llamada** por documento (ver §5). De ahí salen los ítems, el
   requerimiento técnico, montos y firmantes.
4. **Precio vs mercado.** Cada ítem se tasa contra precios reales de mercado (fan-out de
   búsquedas) para estimar sobreprecio.
5. **Red empresarial y personas.** Se arma la red de socios/representantes del proveedor
   ganador y se buscan vínculos con funcionarios; se revisa cobertura periodística.
6. **Soporte legal (RAG).** El analista legal consulta las **721 opiniones del OECE**
   indexadas en **Vertex AI Search** y aterriza cada hallazgo en su fundamento normativo.
7. **Persistencia con checkpoint.** Antes del dictamen final se persiste el análisis
   (idempotente) en Cloud SQL — si el run se corta, el dossier **no queda vacío**.
8. **Dictamen.** El redactor sintetiza todo en un dictamen periodístico (señales de riesgo,
   lecturas alternativas, próximos pasos, fuentes citadas).
9. **Lectura barata.** El frontend lee el dossier ya persistido desde una **API liviana con
   cache** (Hono/TS) — las vistas posteriores **no** vuelven a tocar al orquestador.

---

## 4. La arquitectura de agentes (11 agentes ADK)

Construida sobre el **Agent Development Kit (ADK) de Google**. Un coordinador delega en
sub-agentes especializados; cada uno corre sobre **Gemini 2.5** (Pro para razonamiento,
Flash para extracción rápida) vía **Vertex AI (endpoint global)**.

```
                          ┌────────────────────────┐
                          │   ORQUESTADOR / Coord.  │  ← decide el orden, delega,
                          │   (Vigía Core)          │    consolida, persiste
                          └───────────┬─────────────┘
        ┌──────────────┬─────────────┼──────────────┬───────────────┬─────────────┐
        ▼              ▼             ▼              ▼               ▼             ▼
   compliance    document_       document_       market_        web_         person_
   (reglas       parser          legal_analyst   analyst        research     network
   duras)        (OCR+items)     (RAG OECE)      (precios)      (perfil)     (socios)
        ▼              ▼             ▼              ▼               ▼             ▼
   political_    news_          citizen_         report_        evaluador    (+ tools de
   financing     research       reports          writer         (self-eval)   persistencia)
   (ONPE)        (prensa)       (pines rojos)    (dictamen)
```

Cada agente vive como carpeta en `agents/<nombre>/` con su `prompt.py` + `config.py`.
Todos comparten un header de **reglas universales** (`_shared/instructions.py`): nunca
inventar datos, "no encontrado" es respuesta válida, toda señal de riesgo necesita fuente
verificable, procesar TODOS los ítems.

---

## 5. Lectura de documentos: Document AI + Gemini

El cuello de botella histórico eran los PDFs pesados (bases de 60-90 páginas). El flujo
actual:

```
PDF (cualquier tamaño)
   │
   ▼  Document AI OCR  (modo imageless, en chunks de ≤30 págs — límite de la API)
   │
   ├── chunk 1 (30 págs) → texto
   ├── chunk 2 (30 págs) → texto      ──►  CONCATENAR  ──►  documento completo (texto)
   └── chunk N           → texto
   │
   ▼  UNA sola llamada a Gemini 2.5 sobre el TEXTO  (no imagen por imagen)
   │
   ▼  ítems · requerimiento técnico · montos · firmantes · banderas
   (si Document AI falla → fallback: render de páginas + Gemini Vision)
```

Optimizaciones recientes (junio 2026):
- **Caché de parseo por URL**: un mismo documento no se OCR'ea/parsea dos veces en el
  mismo run (Document AI y Gemini son caros).
- **Dedup semántico de ítems**: el mismo ítem numerado distinto en dos documentos
  (`"2"` vs `"02"`, `"1.0"` vs `"01"`) ya **no** se duplica — se deduplica por
  descripción + cantidad, no por número. Eso evita que el market agent tase el doble.

---

## 6. Observabilidad y autoevaluación

Pilar del track de observabilidad (**Arize**) y columna vertebral de la confianza en el sistema:

- **OpenInference** instrumenta el **Runner de ADK** (ciclo + cada `transfer_to_agent`
  entre los 11 agentes) y **cada llamada a Gemini**. Todo se exporta a **Arize AX** y a
  **Arize Phoenix** (proyecto `vigia-peru`): un **árbol completo de spans por OCID**, con
  tokens, costo, latencia y prompt/respuesta de cada paso.
- **Self-eval inline**: al cierre de cada análisis corren **6 evaluadores** (4 LLM-as-judge
  + 2 deterministas): respaldo de bandera, cita de evidencia, plausibilidad de precio,
  coherencia objeto↔ítems, tono no acusatorio y completitud del pipeline.

---

## 7. Persistencia y datos

- **Cloud SQL (PostgreSQL + PostGIS)** — ciclo de vida del proceso, alertas, banderas, red
  empresarial, pines geográficos. El checkpoint de persistencia corre **antes** del
  dictamen para sobrevivir a timeouts.
- **Dataset local SEACE/OECE** — snapshot 2026 (~2.5 M filas) para análisis con **DuckDB**.
- **Lectura ≠ escritura**: una **API liviana (Hono/TS)** con cache y gzip sirve los
  dossiers ya analizados; el orquestador (caro) solo corre análisis **nuevos**.

---

## 8. Reglas innegociables (legal + ético)

1. **No acusamos a nadie** — decimos "señal de riesgo" / "patrón detectado".
2. **No publicamos datos personales de ciudadanos** — reportes anónimos por defecto.
3. **No reemplazamos a Contraloría/Fiscalía/periodismo** — detectamos y priorizamos.
4. **Reportes ciudadanos**: 2 reportes independientes en ≤30 días para "confirmado"; sin
   foto no se publica.
5. **Sin publicidad ni venta de datos** — open source, sin fines de lucro.
6. **Cada bandera roja enlaza a evidencia oficial** (URL SEACE/OECE/MEF, código de
   contrato, número de opinión OECE). Sin link verificable, no se publica.

---

## 9. Stack en una tabla

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 14 + React + Tailwind (Cloud Run) |
| Mapa | Leaflet + OpenStreetMap |
| API de lectura | Hono / TypeScript (Cloud Run) + cache + gzip |
| Orquestador | Python + ADK + functions-framework (Cloud Run, `maxScale=5`) |
| IA | Gemini 2.5 Pro + Flash vía **Vertex AI (global)** |
| OCR | **Document AI** (per-use, imageless) |
| RAG legal | **Vertex AI Search** (721 opiniones OECE) |
| DB | Cloud SQL (PostgreSQL + PostGIS); DuckDB para análisis local |
| Observabilidad | OpenInference → Arize AX + Phoenix Cloud |
| Secretos | Secret Manager (sin claves en texto plano) |
| Ingesta protegida | Relay residencial en Lima (FastAPI) para portales `.gob.pe` |

---

## 10. El número que importa

Cada análisis completo de un contrato del Estado cuesta **≈ 1 sol** (≈ US$0.30) y tarda
**≈ 3 minutos**. Cuando vigilar al Estado cuesta lo mismo que un café, la vigilancia deja
de ser un acto heroico y aislado y se vuelve algo que **cualquiera puede hacer, a escala.**

---

*Última actualización: 2026-06-11.*
