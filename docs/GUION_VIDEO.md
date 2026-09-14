# GUION_VIDEO.md — Vigía Perú · Kit de pitch

Documento de pitch para el video de submission y la presentación en vivo. Contiene:

1. **Guion de 3 minutos** (el oficial para el video) — palabra por palabra + qué se ve.
2. **Versión extendida de ~5 minutos** (por si hay más tiempo o para una demo en vivo).
3. **Pitch escrito en prosa** (para el texto del submission, redes, o leerlo de corrido).
4. **Q&A anticipado del jurado** (preguntas probables + respuestas firmes).
5. **Hoja de datos** (números y nombres exactos que no debes equivocar).
6. **Checklist de grabación** y notas de entrega.

> **Tono:** cercano, firme, sin tecnicismos al inicio. ~150 palabras/min.
> **Regla de oro:** el hook engancha en 15-18 s, la demo es el corazón, el cierre deja una idea.
>
> 💎 **Caso recomendado para la demo:** el análisis ya corrido en [`PITCH.md`](PITCH.md) —
> OCID `ocds-dgv273-seacev3-1203402` (GORE Ayacucho, reactivos de colesterol). Es ideal: único
> postor al 100% del valor referencial, proveedor con inhabilitación previa por documentos
> falsos, 17 observaciones de DIGEMID y mención en fiscalía anticorrupción — **todo con cita
> legal del OECE**. Tenlo cacheado y/o abierto como respaldo.

---

# 1) Guion de 3 minutos (oficial)

| Bloque | Tiempo | Qué pasa |
|---|---|---|
| 1. Hook | 0:00 – 0:18 | La pregunta que detiene el scroll |
| 2. El problema | 0:18 – 0:45 | La corrupción es pública pero ilegible |
| 3. Qué es Vigía | 0:45 – 1:10 | Las tres capas, una frase cada una |
| 4. **Demo en vivo** | 1:10 – 2:18 | Pegar el código → dossier completo |
| 5. Cómo funciona | 2:18 – 2:42 | 11 agentes · Google Cloud · Arize |
| 6. El costo + cierre | 2:42 – 3:00 | Un sol. La idea que queda. |

### 1. Hook — 0:00 a 0:18
> **"¿Se puede salvar a un país de la corrupción… con un sol?"**
>
> *(pausa de un segundo)*
>
> "En el Perú, investigar **un solo** contrato del Estado sospechoso le toma **tres días** a un
> periodista. Hay **miles** cada mes. Nosotros lo hacemos en **tres minutos** — y cuesta **un sol**."

*(Pantalla: la pregunta en grande sobre el mapa del Perú con pines. Luego el "~S/.1" destacándose.)*

### 2. El problema — 0:18 a 0:45
> "Y acá está lo paradójico: la corrupción en el Perú **no está escondida**. Cada licitación,
> cada contrato, cada empresa inhabilitada **ya es dato público** en SEACE y OECE.
>
> El problema es que es **ilegible**: PDFs de 80 páginas escaneados, repartidos en una docena de
> portales del Estado que no se hablan entre sí. La información existe. Nadie tiene el tiempo —ni
> la plata— para leerla."

*(Pantalla: un PDF de bases haciendo scroll rápido; logos de SEACE, SUNAT, INFOBRAS, OECE dispersos.)*

### 3. Qué es Vigía Perú — 0:45 a 1:10
> "Vigía Perú baja ese costo a casi cero. Funciona en tres capas:
>
> Una **capa máquina**: once agentes de IA leen los contratos del Estado, cruzan los datos
> abiertos y emiten **señales de riesgo**.
>
> Una **capa ciudadana**: cualquiera reporta una obra paralizada con una foto y su ubicación.
>
> Y una **capa de convergencia**: cuando una alerta automática coincide con un reporte ciudadano
> sobre la misma obra, el caso se pone **rojo** — listo para un periodista o un fiscal."

*(Pantalla: el mapa con pines amarillos, rojos y un pin negro de convergencia, haciendo zoom.)*

### 4. DEMO EN VIVO — 1:10 a 2:18  ⭐ *(el corazón del video)*
> "Veámoslo con un caso real. Pego el código de una convocatoria de Ayacucho — compra de
> reactivos médicos…"

1. **Pegar el código** → clic en analizar.
   > "…y el orquestador despierta a los once agentes."
2. **Pipeline en vivo** (las líneas de actividad apareciendo).
   > "Uno extrae el documento con OCR, otro valida el RUC del proveedor en SUNAT, otro arma la
   > red de empresas detrás del ganador, otro consulta la base legal del OECE."
3. **Llega el dossier.** Scroll mostrando:
   - **Las banderas de riesgo.**
     > "Acá están las señales. Esta compra tuvo **un único postor que ofertó el 100% del valor
     > referencial**. Y el proveedor ya había sido **inhabilitado por presentar documentos
     > falsos**, tiene **17 observaciones de DIGEMID**, y fue **mencionado en una investigación de
     > la fiscalía anticorrupción**."
   - **Una bandera con su cita legal.**
     > "Y esto es lo clave: cada bandera **enlaza a su fuente oficial** — la opinión normativa del
     > OECE, el código del contrato. **No acusamos a nadie. Mostramos señales con su evidencia.**
     > Esa diferencia lo es todo."
   - El **grafo de relaciones** y el **veredicto**.

> ⚠️ *Respaldo:* si la red/cuota falla en vivo, ten el dossier de `PITCH.md` abierto en otra pestaña.

### 5. Cómo funciona — 2:18 a 2:42
> "Por dentro: un sistema **multiagente sobre el Agent Development Kit de Google**, con **Gemini
> 2.5** en **Vertex AI**. Los documentos pesados pasan por **Document AI** —los leemos completos
> en una sola llamada— y las 721 opiniones legales del OECE viven en **Vertex AI Search**.
>
> Y todo —cada decisión de cada agente— es **observable en Arize**: cada llamada, cada
> transferencia, cada veredicto es una traza que auditamos y evaluamos."

*(Pantalla: el panel de Arize/Phoenix con el árbol de spans del análisis recién corrido.)*

### 6. El costo + cierre — 2:42 a 3:00
> "Medimos el costo real de ese análisis completo: **alrededor de un sol.**
>
> Cuando vigilar al Estado cuesta lo mismo que un café, la vigilancia deja de ser un acto heroico
> y aislado… y se vuelve algo que **cualquiera puede hacer, a escala.**
>
> **Vigía Perú. La corrupción ya es pública. Ahora también es legible."**

*(Pantalla: "~S/.1 por análisis" en grande, luego el logo de Vigía Perú y la URL de la demo.)*

---

# 2) Versión extendida (~5 minutos)

Misma columna vertebral, con tres profundizaciones. Úsala si tienes más tiempo o en demo en vivo.

**(a) Tras "Qué es Vigía" — agrega el porqué de la confianza (≈20 s):**
> "Pero detectar no basta: hay que poder **confiar** en lo que la IA dice. Por eso cada análisis
> se **autoevalúa** con seis jueces —¿la bandera tiene respaldo?, ¿cita la norma?, ¿el sobreprecio
> se sostiene?, ¿el tono nunca acusa de delito?— y todo el razonamiento queda **trazado en
> Arize**. Si un agente alucina, se ve."

**(b) En la demo — profundiza dos hallazgos más (≈30 s):**
- Abre el **grafo de la red empresarial**: "Acá vemos al titular-gerente y las empresas
  vinculadas; buscamos socios compartidos, mismos domicilios, patrones de consorcio."
- Abre la **validación de precios**: "Cada ítem se tasa contra la mediana real de mercado para
  estimar sobreprecio — no opinamos, comparamos."
- Abre la **traza en Arize**: "Este es el árbol completo: 12 llamadas a Gemini, 245 mil tokens,
  con su costo y latencia. Esto es lo que nos deja optimizar y auditar."

**(c) Tras "Cómo funciona" — agrega resiliencia + MCP (≈30 s):**
> "Dos detalles de ingeniería que nos costó resolver: los portales del Estado **bloquean las IPs
> de la nube**, así que montamos un **relay residencial en Lima** para leer los datos desde una
> IP peruana. Y exponemos todo por un **servidor MCP**: un periodista puede preguntarle a su
> propio asistente de IA *'dame las alertas rojas de Áncash'* y recibirlas con su evidencia —
> Vigía como **fuente de datos**, no solo como app."

---

# 3) Pitch escrito (prosa, para texto/redes)

> **Vigía Perú — vigilancia anticorrupción al precio de un café.**
>
> En el Perú, cada contrato del Estado ya es público; el problema es que es ilegible. Revisar uno
> a fondo —verificar al ganador, leer las bases, cruzar sanciones, mapear la red de empresas,
> comparar precios y citar la ley— le toma días a un periodista. Hay miles cada mes.
>
> Vigía Perú es una plataforma cívica donde **once agentes de inteligencia artificial** (sobre el
> Agent Development Kit de Google y Gemini 2.5 en Vertex AI) hacen ese trabajo en **tres minutos
> por aproximadamente un sol**. Leen los expedientes con **Document AI**, los cruzan con datos
> abiertos (SEACE/OECE, SUNAT, INFOBRAS, ONPE), aterrizan cada hallazgo en las **721 opiniones
> legales del OECE** vía Vertex AI Search, y emiten **señales de riesgo — nunca acusaciones —
> cada una enlazada a su fuente oficial**.
>
> Una capa ciudadana suma reportes con foto y geolocalización; cuando una alerta automática
> converge con un reporte ciudadano sobre la misma obra, el caso queda listo para un periodista o
> un fiscal. Todo el razonamiento de los agentes es **observable y evaluable en Arize**, con
> autoevaluación inline en cada corrida.
>
> Cuando vigilar al Estado cuesta lo mismo que un café, la vigilancia deja de ser un acto heroico
> y aislado y se vuelve algo que **cualquiera puede hacer, a escala.** Open source, sin fines de
> lucro. La corrupción ya es pública; Vigía la hace legible.

---

# 4) Q&A anticipado del jurado

**¿Por qué Arize / qué aporta la observabilidad?**
> Un sistema de 11 agentes es una caja negra: no sabes por qué tardó, por qué falló o si alucinó.
> Con OpenInference instrumentamos el Runner de ADK y cada llamada a Gemini, y exportamos a Arize
> AX y Phoenix. Cada análisis es un árbol de spans con tokens, costo y latencia. **Usamos esas
> trazas para encontrar y arreglar bugs reales** —p. ej. detectamos que el mismo PDF se OCR'eaba
> dos veces y que un ítem se tasaba doble— y para evaluar calidad con 6 jueces inline. Sin Arize
> no podríamos afirmar que el sistema es confiable.

**¿No es esto difamación / cómo evitan acusar a inocentes?**
> Regla #1, innegociable y codificada en los prompts y guardrails: decimos **"señal de riesgo"**,
> nunca "delito". Cada bandera **enlaza a su fuente oficial** (código SEACE, registro SUNAT,
> opinión OECE). Si no hay link verificable, no se publica. Y siempre mostramos **lecturas
> alternativas** (explicaciones benignas). No reemplazamos a la Contraloría ni a la Fiscalía:
> detectamos y priorizamos; la investigación formal la hacen ellos.

**¿De dónde sale el "un sol"?**
> Lo medimos: ≈12 llamadas a Gemini y ≈245 mil tokens por análisis completo, ≈ US$0.30 ≈ 1 sol.
> Se muestra en vivo en el dashboard. El OCR es per-use de Document AI sobre las páginas reales.

**¿Por qué Gemini/Vertex y no otra cosa?**
> Gemini 2.5 (Flash + Flash-Lite) por contexto largo (un expediente OCR de 180 mil caracteres
> entra en una sola llamada) y costo. Vertex AI **endpoint global** porque las regiones
> individuales nos daban 429 agresivos; el global enruta entre regiones y dejó completar los
> expedientes pesados.

**¿Escala a nivel nacional?**
> El pipeline es por-contrato y paralelizable (instancias aisladas en Cloud Run). El MVP cubre
> una región piloto con los cruces C1 (edad de RUC) y C2 (único postor). Escalar es ingesta
> diaria + activar los cruces restantes; la arquitectura ya lo soporta.

**¿Qué datos usan y es legal?**
> Solo **data pública**: contrataciones (SEACE/OECE en formato OCDS), SUNAT, INFOBRAS, ONPE, MEF.
> No publicamos datos personales de ciudadanos (reportes anónimos); solo aparecen funcionarios en
> ejercicio y empresas que contratan con el Estado, cuya data es pública por ley.

**¿Qué fue lo más difícil?**
> Tres cosas: (1) los portales `.gob.pe` bloquean IPs de nube → relay residencial en Lima; (2) los
> expedientes pesados rompían el límite de tiempo → Document AI + 1 llamada Gemini + Vertex global;
> (3) confiabilidad → reglas anti-alucinación universales, checkpoint de persistencia y 6 jueces.

---

# 5) Hoja de datos (no equivocar)

| Dato | Valor exacto |
|---|---|
| Agentes | **11** (coordinador + 10 especialistas) + 1 evaluador |
| Modelos | **Gemini 2.5 Flash** (principal) + **Flash-Lite** (extracción), vía **Vertex AI global** |
| OCR | **Document AI** (imageless, chunks de 30 págs, 1 llamada Gemini/doc) |
| RAG legal | **Vertex AI Search**, **721 opiniones del OECE** |
| Observabilidad | **OpenInference → Arize AX + Phoenix**; **6 evaluadores** inline (4 LLM-judge + 2 deterministas) |
| Costo | **≈ 1 sol (US$0.30)** por análisis · **≈ 12** llamadas Gemini · **≈ 245K** tokens |
| Tiempo | **≈ 3 minutos** por análisis |
| Cruces MVP | **C1** (edad de RUC < 90 días) · **C2** (único postor al ~100% del valor referencial) |
| Datos | SEACE/OECE (OCDS, ~2.5M filas) · SUNAT · INFOBRAS · ONPE · MEF |
| Infra | Cloud Run · Cloud SQL (PostgreSQL+PostGIS) · Document AI · Vertex AI · Secret Manager · relay Lima · MCP server |
| Repo | github.com/EdwinSotto123/vigia-peru · MIT · open source |
| Caso demo | `ocds-dgv273-seacev3-1203402` (GORE Ayacucho, reactivos de colesterol) |

---

# 6) Checklist de grabación + notas de entrega

**Checklist:**
- [ ] Corre el caso `…-1203402` (Ayacucho) un rato antes para que quede cacheado y cargue al instante.
- [ ] Dossier de `PITCH.md` abierto en otra pestaña como respaldo (por si falla red/cuota).
- [ ] Panel de Arize/Phoenix del análisis abierto y listo.
- [ ] El mapa carga con pines en la pantalla de inicio.
- [ ] Audio limpio · pantalla 1080p · cursor visible.
- [ ] Cronometra: el hook **no pasa de 18 segundos**; la demo es lo que más pesa.

**Notas de entrega:**
- El hook es una **pregunta** — déjala respirar un segundo antes de seguir.
- En la demo, **narra lo que el jurado ve**; no leas specs técnicas de corrido.
- La frase legal ("no acusamos, mostramos señales con su evidencia") te mantiene serio y creíble
  — dila mirando a cámara.
- Menciona **Arize** explícitamente al mostrar la traza (es track de observabilidad).
- Cierra con el costo. El número **"un sol"** es lo que se recuerda.
