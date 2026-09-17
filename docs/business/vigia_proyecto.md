# Vigía Perú — dossier del proyecto (para armar el Business Model Canvas)

> Documento vivo, 2026-09-17. Todas las cifras marcadas como "real" salen de una consulta a
> producción el día de hoy (Cloud SQL `vigia-db`, código del repo) — no son estimaciones.
> Repo: `github.com/EdwinSotto123/vigia-peru` (MIT, código abierto) · Demo:
> `https://vigia-peru-frontend-36169102688.us-central1.run.app`.

---

## 1. Qué es, en una frase

**Vigía Perú es una plataforma cívica sin fines de lucro que usa IA para auditar contratos
públicos del Perú y hace que cualquiera pueda financiar, por S/ 3, que un contrato específico
sea leído y publicado con evidencia — en vez de que la vigilancia dependa de un puñado de
periodistas y auditores sobrecargados.**

**Titular actual (landing, en vivo):**
> "El Estado publica todos sus contratos. Nadie tiene capacidad de leerlos."
> "Once agentes de IA leen cada contrato público, cruzan 14 portales del Estado y marcan cada
> señal de riesgo con su norma y su evidencia oficial. Leer un contrato cuesta S/ 3. Elige una
> zona y financia su auditoría; los resultados son públicos, siempre."
> Badge: *Plataforma cívica · sin fines de lucro · Perú*

**Origen:** nació como proyecto individual (Edwin Soto) para el **Google Cloud Rapid Agent
Hackathon** (categoría/track de observabilidad con **Arize**), y siguió construyéndose después
de la entrega hacia una plataforma operativa real con financiamiento ciudadano.

---

## 2. El problema

- La contratación pública peruana **ya es dato abierto**: SEACE/OECE publica cada convocatoria,
  cada buena pro, cada contrato y cada empresa sancionada. El problema nunca fue la falta de
  datos — es que están repartidos en **~14 portales `.gob.pe` que no se hablan entre sí**
  (SEACE, OECE/OCDS, SUNAT, RNP, INFOBRAS, ONPE, JNE, MEF, Contraloría/DJI, El Peruano…), en
  **PDF escaneados de 30-90 páginas**, sin llaves comunes.
- Leer **un solo** contrato sospechoso a mano — verificar al ganador, revisar bases, cruzar
  sanciones, mapear la red societaria, comparar precios, citar la norma — le toma a un
  periodista o fiscal **días**. Hay **miles de contratos nuevos cada mes**. La vigilancia, como
  funciona hoy, es un acto manual, heroico, que no escala.
- Consecuencia: la inmensa mayoría de los contratos del Estado **nunca los revisa nadie**.

## 3. La solución — tres capas

| Capa | Qué hace | Estado hoy |
|---|---|---|
| 🟡 **Máquina (IA)** | Un pipeline de agentes de IA lee el expediente (OCR), cruza datos abiertos, y emite **señales de riesgo** — cada una con su fuente oficial y su norma citada. Nunca dice "esto es un delito"; dice "esto es una señal de riesgo, y esta es la evidencia". | **En producción.** Bienes con adjudicación/contrato: activo end-to-end. Servicios/obras/otros: documentos ya se descargan y clasifican; el análisis completo está desplegado (4 servicios Cloud Run) pero el interruptor de qué tipos se procesan es configurable desde `/admin/clasificacion` — hoy centrado en bienes. |
| 🔴 **Ciudadano** | Cualquiera reporta una obra paralizada/fantasma/con sobreprecio con **foto + geolocalización**, anónimo por defecto. Dos reportes independientes del mismo punto en 30 días lo confirman. | **En producción** (`/reporte/nuevo`), moderación manual. |
| 💰 **Financiamiento ciudadano** | Cualquiera elige una zona del mapa y **financia su auditoría** (S/ 3 por contrato: cubre procesamiento + infraestructura/datos + reserva para expedientes pesados). El resultado siempre se publica, sin importar a quién señale. | **En producción** (`/app/financiar`), Yape/Plin. |

Cuando una alerta automática y una denuncia ciudadana apuntan a la **misma obra**, el caso se
vuelve un caso convergente — evidencia lista para un periodista o un organismo de control.

## 4. Cómo funciona el análisis, técnicamente (estado actual, 2026-09-17)

1. **Cola real**: la API OCDS del OECE se ingiere a diario (`oece_ocds`) — hoy **18 394
   convocatorias** en la cola, con ubigeo distrital, en todo el Perú.
2. **Clasificación** por tipo (bienes/servicios/obras/otros) y etapa (convocatoria → buena
   pro → contrato) para saber qué se puede analizar ya.
3. **Descarga de documentos**: un batch nocturno (en un host con IP peruana — el WAF del OECE
   bloquea IPs de nube) baja bases, buena pro y contrato; retención de 90 días en
   `gs://vigia-peru-documentos`; hoy **22 686 documentos vigentes**.
4. **Pipeline de agentes** (determinista, no un LLM "decidiendo" el orden): compliance (reglas
   duras) en paralelo con [parser de documentos (OCR vía Document AI) → analista legal (RAG) en
   paralelo con analista de mercado] → [perfil del proveedor → web/prensa/red de personas en
   paralelo] → red de personas → compliance extendido → **dictamen final** → **autoevaluación**.
   Marketing lo describe como "11 agentes de IA" (11 roles especializados en ese grafo); por
   dentro corre como **4 servicios Cloud Run** (uno por tipo de contratación: bienes, servicios,
   obras, otros), mismo código, perfil distinto.
5. **Modelos**: **Gemini 3.6-flash** (razonamiento principal, con *thinking*), **Gemini
   3.5-flash-lite** (extracción rápida), **Gemini 3.5-flash** (juez de autoevaluación) — todo
   vía Vertex AI / Google ADK 1.19.
6. **Más de 25 reglas y cruces deterministas** activos (único postor al 100% del valor
   referencial, RUC recién creado, proveedor sancionado, contratación directa sin sustento,
   fraccionamiento, adicional acumulado, vínculos societarios vía RNP, "puerta giratoria"
   funcionario↔empresa vía declaraciones juradas de intereses, aportante de campaña ganador de
   la entidad que gobierna su partido, visitas de lobby previas a la convocatoria, plazos de
   convocatoria por debajo del mínimo legal, y más), cada una **enlazada a su norma** (Ley 32069
   vigente desde 2025-04-22, o TUO 30225 para lo anterior).
7. **Verificación antes de publicar**: cada señal se coteja contra el expediente/OCDS/SUNAT/RNP
   antes de guardarse; si no se puede verificar, se descarta (nunca se inventa un RUC, un monto,
   una URL).
8. **Autoevaluación / revisión humana**: 4 jueces LLM + 4 chequeos en código (respaldo de
   evidencia, tono no acusatorio, coherencia, cobertura, precisión de citas, plausibilidad del
   precio). Si algo falla el umbral, la alerta queda en `revisión humana` — no sale a las
   listas públicas hasta que un admin la confirme. Hoy: **93 alertas totales, 87 publicadas,
   6 en revisión**.
9. **Costo real por análisis**: ≈ **S/ 1 (US$ 0,25-0,30)**, 3-9 minutos.
10. **Grounding legal**: 4 corpus en **Vertex AI RAG Engine** (normas vigentes — Ley 32069/D.S.
    009-2025-EF —, normas históricas — TUO 30225/D.S. 344-2018-EF —, criterios vinculantes —
    721 opiniones OECE + acuerdos de Sala Plena del Tribunal —, y control gubernamental de la
    Contraloría), enrutados automáticamente por la fecha de convocatoria del contrato.

## 5. Recursos tecnológicos (stack completo)

### 5.1 Frontend
| Componente | Tecnología |
|---|---|
| Framework | Next.js 14.2.5 + React 18.3.1, TypeScript |
| Estilos | Tailwind CSS 3.4.6 |
| Mapa | Leaflet + OpenStreetMap (mapa interactivo único de todo el Perú) |
| Autenticación | Firebase Authentication (cuenta opcional: user-id + contraseña, sin correo obligatorio) |
| Hosting | Cloud Run (`vigia-peru-frontend`) |

### 5.2 API de lectura
| Componente | Tecnología |
|---|---|
| Framework | Hono 4.6 (TypeScript) sobre Node ≥20 |
| Rol | Sirve dossiers/listas/mapa ya analizados con caché — nunca dispara el pipeline caro en una lectura |
| Hosting | Cloud Run (`vigia-peru-api`) |

### 5.3 Motor de razonamiento (agentes de IA)
| Componente | Tecnología |
|---|---|
| Orquestación | Google **Agent Development Kit (ADK) 1.19**, `google-genai 1.52` |
| Modelos | **Gemini 3.6-flash** (razonamiento), **3.5-flash-lite** (extracción), **3.5-flash** (juez) — Vertex AI |
| OCR de documentos | **Document AI** (modo sin imagen, en bloques de 30 páginas) |
| RAG legal | **Vertex AI RAG Engine** (4 corpus, modo serverless) + **Vertex AI Search** (fallback, 721 opiniones OECE) + pgvector (último fallback) |
| Servicios | 4 en Cloud Run — `agent-orchestrator-adk` (bienes), `agente-servicios`, `agente-obras`, `agente-otros` |
| Runtime | Python 3.12, FastAPI/Functions Framework |
| Observabilidad de agentes | **Arize AX / Phoenix** + OpenInference + OpenTelemetry (traza cada llamada a Gemini, cada herramienta, costo y latencia) |

### 5.4 Orquestación operativa
| Componente | Tecnología |
|---|---|
| Dispatcher | Cloud Run Job (`vigia-dispatcher`) — enruta cada contrato al servicio correcto por tipo, reintentos, refresca vistas al terminar |
| Ingesta batch | Cloud Run Job (`vigia-ingest`) — sube lo que el batch nocturno descarga a Cloud SQL |
| Scrapers de datasets externos | 6 Cloud Run Jobs + Cloud Scheduler (PNDA/MEF, sin bloqueo de nube) + 2 que corren desde IP peruana (VPS de Lima o laptop) por WAF/Cloudflare |
| Batch nocturno SEACE | Corre desde IP peruana (laptop/VPS) — el WAF del OECE bloquea IPs de nube |

### 5.5 Datos
| Componente | Tecnología |
|---|---|
| Base de datos | **Cloud SQL para PostgreSQL 16** (+ PostGIS) — 58 tablas: contratos, alertas, banderas, red societaria, financiamiento, cuentas, datasets externos |
| Almacenamiento de documentos | Cloud Storage: `vigia-peru-documentos` (documentos con retención 90 días, signed URLs para preview), `vigia-peru-batch` (crudos de scrapers/SEACE), `vigia-peru-rag` (corpus legal), `vigia-peru-reportes` |
| Secretos | Secret Manager (ninguna credencial en texto plano en el orquestador) |

### 5.6 Infraestructura / GCP
Cloud Run (servicios + jobs) · Cloud Scheduler · Cloud Build + Artifact Registry · Cloud SQL ·
Cloud Storage · Vertex AI (Gemini, RAG Engine, embeddings) · Vertex AI Search (Discovery
Engine) · Document AI · Secret Manager · Cloud Logging/Monitoring/Trace · Firebase
(Authentication) · Cloud Quotas.

### 5.7 Terceros
Arize AX/Phoenix (observabilidad de IA) · decolecta/apis.net.pe (API sobre SUNAT) · Playwright
(scraping con navegador) · GitHub (código, MIT).

## 6. Fuentes de datos (qué alimenta al sistema)

| Fuente | Qué aporta | Acceso |
|---|---|---|
| **OECE — API OCDS** | Convocatorias, buena pro, contratos, ítems, postores — la cola en tiempo real | API REST, solo desde IP peruana |
| **OECE/SEACE — documentos** | Bases, buena pro, contrato (PDF) | Portal, solo desde IP peruana |
| **SUNAT** (vía decolecta) | Antigüedad y estado del RUC del ganador | API con token |
| **RNP (OECE)** | Socios y representantes legales de cada empresa — detecta vínculos societarios | Snapshot |
| **PNDA (datos abiertos del Perú)** | Proveedores sancionados, registro de visitas a entidades, declaraciones juradas de intereses (DJI: parientes y empleos previos de funcionarios), otros datasets OECE | API abierta, ✅ desde GCP |
| **ONPE Claridad** | Aportantes de campaña (para detectar donante-que-luego-gana-contratos-de-esa-gestión) | Playwright + IP peruana (Cloudflare) |
| **JNE** | Autoridades electas vigentes por distrito (partido, periodo) | PNDA (reporte oficial) |
| **MEF** | Presupuesto y ejecución por entidad | API abierta (hoy con un problema técnico del lado del MEF, ver §9) |
| **INFOBRAS / Contraloría** | Avance físico de obras (cruce pendiente) | pendiente |
| **El Peruano** | Designaciones de funcionarios (cruce pendiente) | pendiente |

## 7. Métricas actuales (reales, 2026-09-17)

| Métrica | Valor |
|---|---|
| Convocatorias en la cola (todo el Perú) | **18 394** |
| Documentos vigentes en almacenamiento | **22 686** |
| Empresas indexadas (RNP/RUC) | **8 920** |
| Entidades públicas mapeadas | **2 121** |
| Contratos analizados end-to-end | **20** (financiados por el propio Vigía Perú como aporte semilla) |
| Alertas totales / publicadas / en revisión humana | **93 / 87 / 6** |
| Reportes ciudadanos | **6** |
| Financiadores (aliados) registrados | **2** (Vigía Perú como aporte institucional + 1 de prueba) |
| Contribuciones ciudadanas | **3** — S/ 75 (S/ 60 procesadas, S/ 15 pendiente de validar) |
| Costo real por análisis | **≈ S/ 1 (US$ 0,25-0,30)**, 3-9 min |
| Precio al público por contrato financiado | **S/ 3** (S/1 procesamiento + S/1 infraestructura/datos + S/1 reserva para expedientes pesados) |
| Cuentas de usuario registradas | **1** |

*(Traducción honesta: el motor funciona y está probado a fondo — 10+10 contratos auditados
manualmente contra el expediente real —, pero la adopción ciudadana recién empieza: 3 aportes,
1 cuenta. Es una plataforma técnicamente madura en etapa de tracción muy temprana.)*

## 8. Segmentos de usuario (ya productizados en la propia landing)

| Segmento | Lo que Vigía le da | CTA en el producto |
|---|---|---|
| **Ciudadano** | Reporta lo que ve (foto + ubicación); el sistema cruza su reporte con contratos del Estado | "Denunciar una obra" |
| **Periodista** | Un dossier completo (red de personas, señales con norma citada, fuentes oficiales) en minutos en vez de meses | "Ver la auditoría en vivo" |
| **Fiscalía / Contraloría** | Cola priorizada por riesgo, con evidencia pre-armada, para iniciar una investigación formal | "Acceso institucional" |
| **Donante / aliado** (ciudadano, empresa u organización) | Elige una zona, financia su auditoría por S/ 3/contrato, aparece en el muro de aliados con su impacto medido (contratos procesados, señales halladas) | "Financiar una auditoría" |

Con cuenta (opcional): "Mi impacto" (seguimiento de los aportes propios), seguir
zonas/entidades, perfil público de aliado. Sin cuenta: todo funciona igual, como invitado.

## 9. Postura ética y legal (no negociable, ya encodeado en el producto)

- **Nunca se acusa**: vocabulario obligatorio "señal de riesgo", nunca "corrupto" ni "delito".
- **Toda señal cita su fuente oficial y su norma** — si no hay evidencia verificable, no se
  publica (mejor no publicar que publicar algo no verificado).
- **Datos personales de personas naturales redactados** (DNI enmascarado, revelable al clic) —
  empresas y funcionarios públicos en ejercicio de función no se censuran.
- **Nadie elige qué contrato se analiza** (cola FIFO por financiamiento) — así el sistema no se
  puede usar para perseguir a alguien en particular.
- **Código abierto (MIT)**, sin publicidad, sin venta de datos.
- **Corte temporal legal correcto**: Ley 32069 rige desde 2025-04-22; contratos anteriores se
  evalúan con el TUO 30225 vigente en su momento (ultraactividad de la norma).

## 10. Estado del motor de detección (para "Actividades clave")

- Batch nocturno de descarga (laptop/VPS, IP peruana) → GCS → ingesta a Cloud SQL.
- Dispatcher que enruta cada contrato al servicio correcto, reintentos, refresco de vistas.
- 4 servicios de análisis (uno por tipo de contratación).
- Panel de administración (`/admin`): salud del sistema, cola de revisión humana con
  publicar/descartar, progreso del batch, cobertura de fuentes externas, configuración de qué
  tipos/etapas están activos.
- Auditoría en vivo pública (`/app/auditoria/[ocid]`): se ve el pipeline corriendo, con carriles
  por agente, bitácora y el resultado final.

## 11. Qué falta / hacia dónde va (roadmap)

- Activar el análisis completo también para servicios/obras/otros (hoy solo bienes procesa de
  punta a punta; los demás ya descargan y clasifican documentos).
- Arreglar la fuente del MEF (su API de datos abiertos cambió/quedó rota — no es un problema de
  Vigía, hay que encontrar el endpoint nuevo).
- Cruce INFOBRAS (obras fantasma / avance vs presupuesto ejecutado) y El Peruano (funcionario
  que rota hacia la empresa que luego gana contratos).
- Cobertura nacional con ingesta diaria ya corriendo (hoy la cola ya es de todo el Perú; el
  análisis financiado se concentró en Cusco/Puno como pilotos).
- Moderación formal de denuncias ciudadanas (dos reportes independientes en 30 días confirman
  un pin) y flujo de entrega a periodistas/Contraloría/Fiscalía.
- Servidor **MCP** (ya construido) para que una redacción o un organismo de control conecte
  Vigía a su propio asistente de IA como fuente de datos, no solo como app web.
- Medios de pago: hoy Yape/Plin manual; falta una pasarela automática (p. ej. Mercado Pago).

## 12. Equipo

Proyecto individual de **Edwin Soto** (Perú), nacido en el Google Cloud Rapid Agent Hackathon
(track Arize). Sin equipo formal ni entidad legal constituida a la fecha de este documento —
relevante para el bloque de Socios/Estructura de costos del canvas (hoy no hay nómina; el costo
es 100% infraestructura + APIs de IA).

---

## 13. Insumos directos para el Business Model Canvas

### 🤝 Socios clave
- **Google Cloud / Vertex AI** — toda la infraestructura de cómputo e IA corre ahí (créditos de
  hackathon hoy; costo real en producción a futuro).
- **Arize AI** — observabilidad y evaluación de los agentes (partner del hackathon).
- **Fuentes de datos abiertos del Estado peruano** — OECE/SEACE, PNDA, ONPE, JNE, MEF, SUNAT (no
  son socios formales, pero son una dependencia crítica sin la cual el producto no existe).
- **decolecta/apis.net.pe** — proveedor del acceso API a SUNAT.
- (Potenciales, no formalizados aún) medios de comunicación / redacciones de investigación,
  ONG anticorrupción, la propia Contraloría/Fiscalía como usuarios institucionales.

### 🔑 Actividades clave
- Mantener la ingesta diaria de la cola de contratos (todo el Perú) y el batch nocturno de
  documentos.
- Correr y mejorar el pipeline de agentes de IA (reglas, RAG legal, verificación,
  autoevaluación) — incluye la revisión humana de lo que el sistema no puede confirmar solo.
- Ampliar datasets y cruces (nuevas fuentes → nuevas señales de riesgo).
- Moderar denuncias ciudadanas y solicitudes de financiamiento.
- Mantener la infraestructura (deploys, costos de Cloud Run/Gemini, cuotas).
- Comunicar resultados (mapa público, muro de aliados, dossiers).

### 🏗️ Recursos clave
- El **código del pipeline de agentes** (el activo técnico central) y las **~25+ reglas de
  detección** ya afinadas contra casos reales.
- Los **datos ya indexados**: 18 394 convocatorias, 8 920 empresas, 2 121 entidades, corpus
  legal (RAG) de normas + 721 opiniones OECE.
- El **acceso desde IP peruana** (VPS de Lima / laptop) — sin esto, el motor queda ciego para
  las fuentes que bloquean IPs de nube.
- La **marca y confianza** (transparencia total, código abierto, resultados siempre públicos).
- El **conocimiento del dominio legal** (Ley 32069/TUO 30225, criterios vinculantes) encodeado
  en reglas y prompts.

### 💎 Propuesta de valor
- **Para el ciudadano/donante:** por S/ 3 (menos que un café) financias que un contrato de tu
  zona sea leído y publicado con evidencia, y ves el resultado en minutos, siempre público.
- **Para el periodista/investigador:** un dossier completo con red societaria, señales citadas
  y fuentes oficiales, en minutos en vez de días.
- **Para el organismo de control (Fiscalía/Contraloría):** una cola ya priorizada por riesgo,
  con evidencia pre-armada, que ahorra semanas de cruce manual de portales.
- **Diferencial:** cada señal es verificable y citada (nunca una acusación gratuita); el motor
  es determinista y auditable, no una caja negra; todo el código y los resultados son públicos.

### 🤗 Relación con los clientes/usuarios
- **Autoservicio total**: cualquiera usa el mapa, denuncia o financia sin hablar con nadie.
- **Transparencia como relación**: cada aporte tiene un código de seguimiento y un "impacto"
  medible (contratos procesados, señales halladas) visible públicamente.
- **Reconocimiento**: los aliados/donantes aparecen en un muro público con su logo y ranking.
- **Comunidad cívica**: cuenta opcional para seguir zonas/entidades y ver el propio impacto en
  el tiempo ("Mi impacto").

### 📡 Canales
- El sitio web público (mapa, dossiers, muro de aliados) como canal principal.
- Redes sociales y prensa (potencial, aún no formalizado) para difundir hallazgos.
- El servidor **MCP** como canal técnico hacia asistentes de IA de terceros (redacciones,
  organismos de control).
- Boca a boca / periodismo de datos (el propio hackathon y GitHub como vitrina inicial).

### 👥 Segmentos de clientes
Ciudadano (denunciante) · Donante/aliado (financia auditorías) · Periodista/investigador ·
Organismo de control (Fiscalía, Contraloría) — ver tabla completa en §8. **No hay, por diseño,
un segmento "anunciante" ni "comprador de datos"** — el modelo excluye monetización de datos.

### 💰 Fuentes de ingresos
- **Donaciones ciudadanas dirigidas** (S/ 3 por contrato, elegido por zona) — el único ingreso
  activo hoy: S/ 75 recaudados en 3 aportes.
- **Aporte institucional propio** (Vigía Perú financiando contratos como "aporte semilla" para
  demostrar el modelo — no es ingreso externo, es autofinanciamiento).
- Potenciales, no implementados: donaciones de empresas/ONG como aliados recurrentes,
  financiamiento institucional (cooperación, fondos de transparencia), **nunca** publicidad ni
  venta de datos (posición explícita del proyecto).

### 💸 Estructura de costos
- **Costo variable por contrato analizado**: ≈ S/ 1 (US$ 0,25-0,30) — llamadas a Gemini/Document
  AI, la mayor parte del costo marginal.
- **Infraestructura fija**: Cloud Run (servicios + jobs), Cloud SQL, Cloud Storage, Vertex AI
  RAG Engine — hoy optimizado para costo mínimo (modo serverless, sin recursos con costo fijo
  por hora salvo lo estrictamente necesario).
- **Infraestructura de datos**: mantener el VPS/host con IP peruana para las fuentes que
  bloquean IPs de nube (SEACE/OECE, ONPE).
- **Costo humano**: hoy un solo desarrollador, sin nómina formal.
- Sin costos de adquisición de usuarios (marketing) todavía — crecimiento orgánico/hackathon.

---

## 14. Enlaces

- Demo en vivo: `https://vigia-peru-frontend-36169102688.us-central1.run.app`
- Repositorio (MIT): `github.com/EdwinSotto123/vigia-peru`
- Observabilidad (Arize Phoenix): proyecto `vigia-peru`
- Documentación técnica interna: `docs/design/` (arquitectura, RAG, datasets, cuentas),
  `backend/cloud_functions/README.md` (scrapers en la nube), `docs/hackathon/SUBMISSION.md`
  (historia original de la entrega al hackathon).
