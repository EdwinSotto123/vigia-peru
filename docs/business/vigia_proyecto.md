# Vigía Perú — dossier del proyecto (para armar el Business Model Canvas)

> Documento vivo. Primera versión: 17 de septiembre de 2026. Puesto al día el 25 de noviembre de 2026 con la arquitectura
> de hoy. Cada cifra lleva su fecha y de dónde sale (el código del repositorio o un documento con fecha); lo que no se
> pudo comprobar dice «pendiente». La foto de métricas de septiembre queda en el §7, para comparar.
> Sitio: `https://vigia.gobserva.cloud`. Repositorio: `github.com/Gobserva-Cloud/vigia-peru` (PolyForm Noncommercial
> 1.0.0). Contacto: hello@gobserva.cloud.

---

## 1. Qué es, en una frase

**Vigía es una plataforma cívica de Gobserva que lee los contratos públicos del Perú con agentes de IA de modelos
abiertos, los cruza con registros oficiales y marca cuáles merecen una segunda mirada, con la norma y el documento detrás
de cada señal. Los resultados son públicos, y la lectura se sostiene con aportes de la gente, no con publicidad ni con la
venta de datos.**

**Titular actual (portada de vigia.gobserva.cloud, noviembre de 2026):**
> "Vigía by Gobserva: en qué se gasta el dinero de tu región"
> "Vigía lee los contratos del Estado peruano, los cruza con registros oficiales y te muestra cuáles merecen una segunda
> mirada, con la ley y la fuente para comprobarlo. Explora tu región, ayúdanos a seguir vigilando o denuncia una obra."
> Lema de Gobserva: *Lo de todos, a la vista de todos.*

**Origen:** nació como proyecto individual (Edwin Soto) para el **Google Cloud Rapid Agent Hackathon** (track de
observabilidad con **Arize**); el primer commit del repositorio es del 11 de junio de 2026. Siguió construyéndose después
de la entrega y hoy es un producto de **Gobserva** (`gobserva.cloud`), que en el mismo repositorio tiene también Salud,
Empleo, Licitaciones, Obras y Car. Entre octubre y noviembre de 2026 dejó Google Cloud: hoy corre en Cloudflare y AWS, y
sólo con modelos abiertos.

---

## 2. El problema

- La contratación pública peruana **ya es dato abierto**: el OECE publica cada convocatoria, cada buena pro, cada contrato
  y cada empresa sancionada. El problema nunca fue la falta de datos. Están repartidos en **una docena de portales que no
  se hablan entre sí** (SEACE y OECE, CONOSCE, Perú Compras, RNP, SUNAT, MEF, Contraloría, JNE, ONPE, datos abiertos), en
  **bases escaneadas de decenas de páginas y actas dentro de archivos RAR**, sin llaves comunes.
- El volumen: en 2025 hubo 58 925 procesos con buena pro y 3,87 millones de órdenes (medido el 28 de octubre de 2026,
  migración 206). En 2026, al 24 de noviembre, el Estado publicó **66 060 contratos por más de S/ 74 mil millones**
  (README).
- Leer **un solo** contrato a mano (verificar al ganador, revisar bases, cruzar sanciones, mapear la red societaria,
  comparar precios, citar la norma) le toma a un periodista o a un fiscal **días**. La vigilancia, como funciona hoy, es
  un acto manual que no escala.
- Consecuencia: la inmensa mayoría de los contratos del Estado **nunca los revisa nadie**.

## 3. La solución, en tres capas

| Capa | Qué hace | Estado hoy |
|---|---|---|
| **Máquina (IA)** | Agentes de IA leen el expediente (con OCR abierto), cruzan datos abiertos y emiten **señales de riesgo**, cada una con su fuente oficial y su norma citada. Nunca dice «esto es un delito»: dice «esto es una señal, y esta es la evidencia». | **En producción** para las cinco redes: bienes, servicios, obras, consultoría y contrataciones directas. Al 24 de noviembre de 2026 leyó **12 406 contratos de 2026** (README). |
| **Ciudadano** | Cualquiera denuncia una obra con **foto y ubicación** (`/reporte/nuevo`). Las denuncias de obra se publican; las de una entidad quedan en reserva. | **En producción.** |
| **Apoyo ciudadano** | Cualquiera aporta al **fondo común desde S/ 5**, una vez o cada mes, por Yape, Plin o tarjeta (Mercado Pago). Lo más grave se lee primero: quien aporta no elige qué contrato se lee. Cada aporte tiene un recibo público. | **En producción** desde el 29 de octubre de 2026 (`/app/apoyar`). Reemplazó al modelo de «S/ 3 por contrato». |

## 4. Cómo funciona el análisis, técnicamente (estado al 25 de noviembre de 2026)

1. **Cola real**: la API OCDS del OECE se ingiere cada día a las 6:00 de Lima, en todo el Perú, con Cloudflare Workflows
   (`vigia-scrapers`). Las demás fuentes entran en su propio calendario.
2. **Clasificación** por red: bienes, servicios, obras, consultoría y contrataciones directas. Cada red tiene su perfil
   de agentes y su propia función en AWS Lambda.
3. **Descarga de documentos**: bases, actas y contrato (PDF, Word, Excel, ZIP y RAR) a Cloudflare R2. El OECE y el SEACE
   filtran por la IP de salida: las descargas salen por un Worker que corre en Zúrich, y las fuentes que sólo responden
   dentro del país, por un relay con IP del Perú.
4. **Lectura previa**: antes de analizar se lee todo. El texto de cada documento, las páginas escaneadas con OCR abierto
   (Docling, en un contenedor de Cloudflare) y las tablas de ítems. Un contrato no se analiza hasta que sus documentos
   están completos; lo que falta queda anotado y se vuelve a pedir (README).
5. **Pipeline de agentes**, determinista: el orden lo fija el código, no un modelo. Reglas, documentos, norma, mercado,
   prensa y web, red de personas y dictamen. Corre en Python con **Google ADK 1.19 como librería**, en AWS Lambda.
6. **Modelos**: sólo **modelos abiertos**, servidos por Cloudflare Workers AI. **DeepSeek V4.1 Flash** hace casi todo y
   **GLM 5.3** atiende a los agentes de juicio más complejo (el dictamen, el análisis legal y la red de personas). Los
   vectores salen de bge-m3.
7. **28 reglas deterministas**, que no usan IA (lista en el README): un solo postor con una oferta cercana al valor
   referencial, RUC con meses de vida, proveedor sancionado, contratación directa sin causal, compras partidas para no
   licitar, plazos de convocatoria cortos, adicionales de obra acumulados, firmante de la entidad vinculado al ganador,
   visitas del ganador a la entidad antes de la convocatoria, y más. Cada una **enlazada a su norma**: la Ley 32069,
   vigente desde el 22 de abril de 2025, o el TUO de la Ley 30225 para lo anterior. Sobre las reglas, el análisis de
   mercado, el legal y el de la red de personas (socios, funcionarios, visitas y aportes de campaña) suman sus señales.
8. **Verificación antes de publicar**: cada señal se coteja con el expediente, el OCDS y los registros antes de guardarse.
   Si no se puede verificar, se descarta. Nunca se inventa un RUC, un monto ni una URL.
9. **Autoevaluación y revisión humana**: jueces con el mismo modelo abierto y chequeos en código revisan el respaldo de
   cada señal, sus citas, la plausibilidad del precio y el tono. Si algo no pasa el umbral, el dictamen queda en
   `revisión humana` y no sale a las listas públicas hasta que alguien del equipo lo apruebe.
10. **Costo por análisis**: unos **US$ 0,20** en promedio en modelos de lenguaje, y el OCR, menos de un décimo de centavo
    por página (README, noviembre de 2026). El gasto de cada día se publica en `/metricas`.
11. **Grounding legal**: el RAG normativo vive en la propia base desde el 15 de noviembre de 2026. Para la fecha de la
    convocatoria trae los artículos de la ley, el reglamento, las directivas y las bases estándar que regían ese día, y
    los criterios (opiniones del OECE, acuerdos de Sala Plena, precedentes) de su mismo régimen; los del régimen anterior
    salen marcados como tales. Busca por palabras y por sentido. Chroma Cloud queda de respaldo.

## 5. Recursos tecnológicos (stack completo)

### 5.1 Frontend
| Componente | Tecnología |
|---|---|
| Framework | Next.js 14.2 + React 18.3, TypeScript |
| Estilos | Tailwind CSS 3.4 |
| Mapa | d3-geo (el mapa del Perú por región) |
| Autenticación | Firebase Authentication (cuentas de Vigía) y Amazon Cognito (cuentas de Gobserva) |
| Hosting | Cloudflare Workers con OpenNext (`vigia-web`), con la caché de páginas en R2 |
| Dominios | `vigia.gobserva.cloud` y los subdominios de los productos de Gobserva; la portada `gobserva.cloud` es otro Worker |

### 5.2 API
| Componente | Tecnología |
|---|---|
| Framework | Hono 4 (TypeScript) en Cloudflare Workers (`vigia-api`) |
| Base | Por Hyperdrive, con pooling |
| Rol | Lectura y escritura. Una sola regla decide qué se publica y qué se tapa de las personas |
| Protección | Límites por IP con un Durable Object y captcha (Turnstile) en las escrituras públicas |

### 5.3 Motor de razonamiento (agentes de IA)
| Componente | Tecnología |
|---|---|
| Orquestación | Pipeline determinista en Python 3.12, con Google ADK 1.19 como librería |
| Modelos | DeepSeek V4.1 Flash y GLM 5.3, abiertos, en Cloudflare Workers AI, por el Worker `vigia-llm` (lista blanca de modelos) |
| OCR de documentos | Docling (RapidOCR + TableFormer), abierto, en Cloudflare Containers (`vigia-ocr`) |
| RAG legal | En la propia base: búsqueda por palabras y por vectores (bge-m3), por fecha y jerarquía. Chroma Cloud de respaldo |
| Servicios | 5 funciones de AWS Lambda, una por red: bienes, servicios, obras, consultoría y directas |
| Búsqueda web | Propia y sin claves (DuckDuckGo y Bing News) |
| Observabilidad | El costo de cada llamada, los libros de gasto en la base y la página pública `/metricas` ([OBSERVABILITY.md](../../OBSERVABILITY.md)) |

### 5.4 Orquestación operativa
| Componente | Tecnología |
|---|---|
| Dispatcher | Worker `vigia-dispatcher`: cada 5 minutos toma la cola de análisis, llama a la Lambda de cada red y reintenta lo que se corta |
| Captura | Worker `vigia-scrapers` con Cloudflare Workflows: una corrida por fuente, con su calendario |
| Análisis masivo | Tareas de GitLab CI que leen contratos en tandas, con un tope de gasto contado en la base |
| Salidas de red | Un Worker en Zúrich para el OECE y el SEACE, y un relay con IP del Perú para las fuentes que sólo responden dentro del país |

### 5.5 Datos
| Componente | Tecnología |
|---|---|
| Base de datos | **PostgreSQL 16 en AWS RDS**, privada, con PostGIS y pgvector. Su esquema son 426 migraciones SQL numeradas (al 25 de noviembre de 2026) |
| Archivos | Cloudflare R2: los documentos de los expedientes, las descargas crudas, las fotos de denuncias y los comprobantes (privados) |
| Secretos | Los secretos de cada Worker y AWS SSM Parameter Store. Ninguna credencial en el repositorio |

### 5.6 Infraestructura
Cloudflare: Workers, Workflows, Containers, Workers AI, R2, Hyperdrive, Durable Objects, KV y Turnstile. AWS: Lambda,
ECR, RDS, una instancia EC2 con PgBouncer, SSM y Cognito. De Google queda sólo Firebase Authentication. CI/CD: GitLab
(privado), con despliegues manuales a producción, y un espejo público en GitHub. El detalle está en
[ARQUITECTURA.md](../../ARQUITECTURA.md).

### 5.7 Terceros
Mercado Pago (aportes con tarjeta), Resend (correo), Chroma Cloud (respaldo del RAG legal), Firebase Authentication y
GitHub (el espejo público). Proyectos abiertos en los que se apoya: los modelos abiertos de Workers AI, Docling, Google ADK
y Crawl4AI.

## 6. Fuentes de datos (qué alimenta al sistema)

| Fuente | Qué aporta |
|---|---|
| **OECE y SEACE** (Contrataciones Abiertas, OCDS) | Convocatorias, contratos, montos, postores y documentos: la cola diaria |
| **CONOSCE** | Adjudicaciones por ítem y ofertas |
| **Perú Compras** | Órdenes de compra de catálogos |
| **RNP y Tribunal de Contrataciones** | Proveedores, socios y representantes, sanciones y resoluciones |
| **MEF** | Presupuesto y gasto de cada entidad |
| **SUNAT** | Estado y antigüedad de las empresas |
| **Contraloría y Procuraduría** | Informes de control y procesos |
| **JNE, Infogob y ONPE** | Autoridades, candidaturas, quién gobierna cada lugar y aportes de campaña |
| **Datos abiertos (PNDA)** | Visitas a entidades, planillas, declaraciones juradas y penalidades |

Fuente: la tabla de datos del README (noviembre de 2026). Algunas fuentes sólo responden a ciertas IPs: por eso las
salidas de red de §5.4. Más detalle en [docs/DATA.md](../DATA.md).

## 7. Métricas

### Hoy (24 de noviembre de 2026, README)

| Métrica | Valor |
|---|---|
| Contratos publicados por el Estado en 2026 | **66 060**, por más de S/ 74 mil millones |
| Contratos de 2026 que Vigía ya leyó | **12 406** |
| Leídos con riesgo medio o alto | **7 163** |
| Costo promedio por lectura | unos **US$ 0,20** en modelos; el OCR, menos de un décimo de centavo por página |
| Reglas deterministas | **28** |
| Herramientas del conector MCP | **más de 50** |

Otras cifras con fecha:

- Mantener Vigía encendida cuesta cerca de **S/ 1 200 al mes**, según el equipo (29 de octubre de 2026). Las facturas de
  AWS y Cloudflare de octubre de 2026 sumaron S/ 334, con AWS hoy cubierto por créditos
  (`backend/api/src/lib/vigilancia.ts`).
- Del 10 al 17 de noviembre de 2026, Cloudflare midió cerca de **US$ 3 480** de uso de Workers AI (migración 336).
- En una prueba de oro de 10 contratos leídos a mano, la configuración con modelos abiertos de entonces (GLM 5.3 Flash y
  GLM 5.3) obtuvo un **F1 de 0,90** (10 de noviembre de 2026, `infrastructure/deploy/aws/agentes.sh`).
- Las cifras al día de calidad y de costo están en [/metricas](https://vigia.gobserva.cloud/metricas).

### Primera foto (17 de septiembre de 2026, cuando Vigía corría en Google Cloud)

| Métrica | Valor |
|---|---|
| Convocatorias en la cola (todo el Perú) | 18 394 |
| Documentos vigentes en almacenamiento | 22 686 |
| Empresas indexadas (RNP/RUC) | 8 920 |
| Entidades públicas mapeadas | 2 121 |
| Contratos analizados de punta a punta | 20 (financiados por el propio Vigía como aporte semilla) |
| Alertas totales / publicadas / en revisión humana | 93 / 87 / 6 |
| Reportes ciudadanos | 6 |
| Contribuciones ciudadanas | 3, por S/ 75 |
| Cuentas de usuario registradas | 1 |
| Costo real por análisis | ≈ S/ 1 (US$ 0,25 a 0,30), con Gemini |

*(Traducción honesta: en dos meses el motor pasó de 20 contratos leídos a más de 12 mil. Lo que este documento todavía no
puede decir con cifras al día es la adopción: aportes, cuentas y usuarios del MCP. Pendiente: sacarlas del panel, con su
fecha.)*

## 8. Segmentos de usuario (ya productizados)

| Segmento | Lo que Vigía le da | Dónde |
|---|---|---|
| **Ciudadano** | Ver en qué se gasta en su región, leer un contrato y denunciar una obra con foto y ubicación | «Explora tu región», «Denuncia una obra» |
| **Periodista o investigador** | La historia del proceso, las señales con su norma y su evidencia, la red de la empresa y los patrones de una entidad o un proveedor | La ficha de cada contrato, «Patrones» y el conector MCP |
| **Fiscalía o Contraloría** | Las señales de un contrato como observaciones con condición, criterio, efecto y causa, y lo que la Contraloría ya observó | El conector MCP (`informe_control_contrato`, `informes_control`) |
| **Quien aporta** (persona, empresa u organización) | Un aporte al fondo común desde S/ 5, con recibo público y un lugar en el podio, que cuenta meses y no soles | «Ayúdanos a seguir vigilando» (`/app/apoyar`) |
| **Universidades, colectivos y desarrolladores** | El código abierto para uso no comercial y el conector MCP, gratis con una cuenta de correo confirmado | GitHub y `mcp.gobserva.cloud/mcp` |

Con cuenta: «Mi impacto», con el seguimiento de los aportes propios.

## 9. Postura ética y legal (no negociable, ya en el producto)

- **Nunca se acusa**: se dice «señal de riesgo», nunca «corrupto» ni «delito».
- **Toda señal cita su fuente oficial y su norma.** Si no hay evidencia verificable, no se publica.
- **Las personas, protegidas**: nunca se muestra un DNI, las personas naturales aparecen con un apellido tapado y un RUC
  10 nunca se muestra ni se busca. Los funcionarios en ejercicio y las empresas que le venden al Estado no se tapan.
- **Nadie elige qué contrato se lee**: lo más grave va primero y quien aporta no elige. Así el sistema no se puede usar
  para perseguir a alguien en particular.
- **Código abierto** bajo la PolyForm Noncommercial License 1.0.0: libre para uso personal, investigación, docencia,
  activismo e instituciones públicas; el uso comercial se conversa. Hasta el 24 de noviembre de 2026 el código se publicó
  bajo MIT, y las copias anteriores conservan esa licencia. Sin publicidad y sin venta de datos.
- **Modelos abiertos** y **cuentas claras**: lo que cuesta leer los contratos se publica.
- **Corte temporal legal correcto**: la Ley 32069 rige desde el 22 de abril de 2025; los contratos anteriores se evalúan
  con el TUO de la Ley 30225 vigente en su momento.

## 10. Estado del motor de detección (para «Actividades clave»)

- Captura diaria en Cloudflare Workflows; documentos a R2; salidas de red por Zúrich y por el Perú.
- Lectura previa de cada expediente, con OCR abierto, antes de analizarlo.
- Dispatcher que toma la cola cada 5 minutos, y análisis masivo en tandas con tope de gasto.
- Cinco redes de agentes en AWS Lambda, una por tipo de contratación.
- Panel de administración (`/admin`): la cola de revisión humana para publicar o descartar, los análisis en curso y los
  umbrales de la autoevaluación.
- Auditoría en vivo (`/app/auditoria`) y métricas públicas (`/metricas`).
- Conector MCP en `https://mcp.gobserva.cloud/mcp`.

## 11. Qué falta / hacia dónde va (roadmap)

- **Las apps de Empleo y Licitaciones** están «en construcción»: hoy se usan por sus páginas públicas y por el MCP.
- **Los planes de Gobserva** tienen los cobros en pausa desde el 24 de noviembre de 2026: toda cuenta con correo
  verificado tiene el acceso abierto mientras tanto.
- **Lo que viene**, según la portada de Gobserva: el monitoreo del Congreso, la historia de cada político y alertas por
  distrito.
- **Cuentas completas**: que los libros de gasto anoten todo lo que mide Workers AI (al 17 de noviembre de 2026 cubrían
  un 74 %).
- **Contraloría**: la carga automática de sus informes no llega por la captura en la nube (pendiente).
- **Adopción**: medir y publicar con fecha los aportes, las cuentas y el uso del MCP.

## 12. Equipo

Lo fundó **Edwin Soto** (Perú), autor del código según `CITATION.cff` y `LICENSE`, y se publica como **Gobserva**.
Pendiente de confirmar para este documento: quiénes forman hoy el equipo, el costo humano y si Gobserva ya tiene una
entidad legal (en septiembre de 2026 no la tenía).

---

## 13. Insumos directos para el Business Model Canvas

### Socios clave
- **Cloudflare**: la web, la API, el MCP, la captura de datos, los modelos (Workers AI), el OCR y los archivos.
- **AWS**: los agentes (Lambda) y la base de datos (RDS), hoy con créditos.
- **Proyectos abiertos**: los modelos abiertos de Workers AI, Docling, Google ADK y Crawl4AI.
- **Fuentes de datos abiertos del Estado peruano**: OECE y SEACE, CONOSCE, Perú Compras, RNP, MEF, SUNAT, Contraloría,
  Procuraduría, JNE, ONPE y la PNDA. No son socios formales, pero sin ellas el producto no existe.
- **Mercado Pago**: la pasarela de los aportes con tarjeta.
- (Potenciales, no formalizados aún) redacciones de investigación, ONG anticorrupción, universidades, y la Contraloría y
  la Fiscalía como usuarias.

### Actividades clave
- Mantener la captura diaria de contratos y documentos, y la lectura previa de cada expediente.
- Correr y mejorar las redes de agentes (reglas, RAG normativo, verificación, autoevaluación), con revisión humana de lo
  que el sistema no puede confirmar solo.
- Medir la calidad con pruebas de oro y publicar las métricas y los costos.
- Ampliar fuentes y cruces: nuevas fuentes, nuevas señales.
- Moderar denuncias y validar aportes.
- Mantener la infraestructura y su costo (Cloudflare, AWS, Workers AI).
- Comunicar resultados: mapa, dictámenes, conector MCP y redes.

### Recursos clave
- El **código de las redes de agentes** y las **28 reglas**, afinadas contra casos reales.
- Los **datos ya leídos**: 12 406 contratos de 2026 al 24 de noviembre, cada uno con su dictamen.
- Las **salidas de red** por Zúrich y por el Perú: sin ellas, el motor queda ciego para las fuentes que filtran por IP.
- La **marca y la confianza**: transparencia total, código abierto, costos publicados, resultados siempre públicos.
- El **conocimiento del dominio legal** (Ley 32069, TUO de la Ley 30225, criterios vinculantes), en las reglas y en el
  RAG normativo.

### Propuesta de valor
- **Para el ciudadano y quien aporta:** con un aporte desde S/ 5 sostienes que se lean contratos que nadie lee, lo más
  grave primero, y todo se publica.
- **Para el periodista o investigador:** un dictamen con la red societaria, las señales citadas y las fuentes oficiales,
  en minutos en vez de días.
- **Para el organismo de control:** observaciones ya armadas, con condición, criterio, efecto y causa, que ahorran semanas
  de cruce manual de portales.
- **Para quien usa un asistente de IA:** el conector MCP, gratis con una cuenta de correo confirmado.
- **Diferencial:** cada señal es verificable y citada, nunca una acusación gratuita; el motor es determinista y
  auditable; los modelos y el OCR son abiertos; el código, los resultados y los costos son públicos.

### Relación con los clientes/usuarios
- **Autoservicio total**: cualquiera usa el mapa, denuncia o aporta sin hablar con nadie.
- **Transparencia como relación**: cada aporte tiene un recibo público, y la calidad y los costos se ven en `/metricas`.
- **Reconocimiento**: un podio público que cuenta los meses de aporte.
- **Comunidad**: cuenta para ver «Mi impacto», y GitHub para avisar de errores, proponer fuentes y aportar código.

### Canales
- El sitio web (mapa, dictámenes, auditoría en vivo) como canal principal, y la portada de Gobserva como puerta.
- El **conector MCP** hacia asistentes de IA de terceros (redacciones, organismos de control, universidades).
- **GitHub** (código, issues y discusiones) y las redes de Gobserva.

### Segmentos de clientes
Ciudadano (denunciante), quien aporta, periodista o investigador, organismo de control (Fiscalía, Contraloría),
universidades y desarrolladores. Ver §8. **No hay, por diseño, un segmento «anunciante» ni «comprador de datos».**

### Fuentes de ingresos
- **Aportes ciudadanos al fondo común**, desde S/ 5, únicos o mensuales. Pendiente: lo recaudado, con fecha.
- **Aporte propio**: el capital semilla de Vigía, que se cuenta aparte de los aportes de la gente.
- **Planes de pago de Gobserva** (Empleo, Licitaciones): los cobros están en pausa desde el 24 de noviembre de 2026.
- Potenciales, no implementados: licencias para uso comercial del código y fondos de cooperación y de tecnología de interés
  público. **Nunca** publicidad ni venta de datos.

### Estructura de costos
- **Costo variable por contrato leído**: unos US$ 0,20 en modelos de lenguaje; el OCR, menos de un décimo de centavo por
  página (README, noviembre de 2026).
- **Lectura a escala**: del 10 al 17 de noviembre de 2026, Workers AI midió cerca de US$ 3 480 (migración 336).
- **Infraestructura fija**: cerca de S/ 1 200 al mes según el equipo (29 de octubre de 2026). Las facturas de AWS y
  Cloudflare de octubre sumaron S/ 334, con AWS cubierto por créditos.
- **Costo humano**: pendiente de confirmar.

---

## 14. Enlaces

- Vigía: `https://vigia.gobserva.cloud`
- Gobserva: `https://gobserva.cloud`
- Conector MCP: `https://mcp.gobserva.cloud/mcp`
- Métricas y transparencia: `https://vigia.gobserva.cloud/metricas`
- Auditoría en vivo: `https://vigia.gobserva.cloud/app/auditoria`
- Repositorio (PolyForm Noncommercial 1.0.0): `github.com/Gobserva-Cloud/vigia-peru`
- Contacto: hello@gobserva.cloud
- Documentación técnica: [ARQUITECTURA.md](../../ARQUITECTURA.md), [OBSERVABILITY.md](../../OBSERVABILITY.md) y el índice
  [docs/README.md](../README.md). La historia de la entrega al hackathon está en
  [docs/hackathon/SUBMISSION.md](../hackathon/SUBMISSION.md).
