# Arquitectura de Vigía

Cómo está hecho Vigía al 25 de noviembre de 2026: qué hace cada pieza, dónde corre, cómo pasa un contrato de la fuente
oficial al dictamen y cómo se despliega. Lo que corría antes en Google Cloud está al final, en
[Lo que quedó atrás](#lo-que-quedó-atrás). Para correrlo en tu máquina, mira el [README](README.md#correrlo-en-tu-máquina).

## Las piezas

Vigía corre en Cloudflare (la web, la API, el MCP, la captura de datos, los modelos y el OCR) y en AWS (los agentes y la
base de datos). Los productos de Gobserva viven en este mismo repositorio y comparten la web, la API y la base.

| Pieza | Qué hace | Dónde corre |
|---|---|---|
| `frontend` (Worker `vigia-web`) | El sitio de Vigía y de los productos de Gobserva, con Next.js 14 y OpenNext. Cada producto se sirve desde su subdominio de `gobserva.cloud`: vigia, salud, empleo, licitaciones, obras y car | Cloudflare Workers |
| `infrastructure/deploy/cloudflare/gobserva-redirect` (Worker `gobserva-redirect`) | La portada de `gobserva.cloud` | Cloudflare Workers |
| `backend/api` (Worker `vigia-api`) | La API con Hono, de lectura y escritura. Decide qué se publica y qué se tapa de las personas. Cuenta los límites por IP con un Durable Object (`Limitador`) | Cloudflare Workers, con Hyperdrive hacia la base |
| `backend/mcp-worker` (Worker `vigia-mcp`) | El conector MCP en `https://mcp.gobserva.cloud/mcp`. Se entra con la cuenta de Gobserva (OAuth) y los datos los pide a la API | Cloudflare Workers |
| `backend/scrapers-worker` (Worker `vigia-scrapers`) | La captura de datos públicos: los contratos del OECE cada día y las demás fuentes en su calendario, una corrida por fuente | Cloudflare Workflows |
| `backend/dispatcher-worker` (Worker `vigia-dispatcher`) | Cada 5 minutos toma la cola de análisis (`procesamientos`) y llama a la Lambda de la red que corresponde | Cloudflare Workers y Workflows |
| `backend/agent` | Los agentes que leen cada contrato, en Python, con Google ADK como librería. Una Lambda por red: bienes, servicios, obras, consultoría y directas | AWS Lambda, con imagen de contenedor |
| `backend/llm-worker` (Worker `vigia-llm`) | La única puerta a los modelos de lenguaje. Sólo deja pasar los modelos abiertos de su lista blanca | Cloudflare Workers AI |
| `backend/ocr-worker` (Worker `vigia-ocr`) | OCR abierto: Docling con RapidOCR y TableFormer | Cloudflare Containers |
| `backend/scripts` y `backend/lector` | La lectura previa de los documentos, la lectura por piezas, el análisis masivo y los reanálisis | Tareas de GitLab CI o una PC |
| PostgreSQL | Una sola base: contratos, señales, dictámenes, fuentes, cuentas y métricas | AWS RDS, sin acceso público |
| Archivos | Bases, actas, contratos, descargas crudas, fotos de denuncias y comprobantes | Cloudflare R2 |
| Cuentas | Firebase Authentication para Vigía. Amazon Cognito para Empleo, Licitaciones (con Obras) y Salud | Firebase y AWS |

Piezas más chicas:

| Pieza | Para qué |
|---|---|
| `backend/relay-worker` (`vigia-relay`) | Bajar del OECE y del SEACE, que filtran por la IP de salida. El Worker corre en Zúrich, donde sí responden |
| `backend/seace-zrh-worker` (`vigia-seace-zrh`) | Los reportes del SEACE con su expediente SIAF, también desde Zúrich |
| `backend/relay-lima` | Una salida con IP del Perú, por un túnel de Cloudflare, para las fuentes que sólo responden dentro del país |
| `backend/precios-worker` (`vigia-precios`) | Precios de referencia propios: tiendas en línea, combustibles y el mercado mayorista |
| `backend/precios-lab-worker` (`vigia-precios-lab`) | La investigación de precios del panel, con Crawl4AI en un contenedor |
| `backend/r2-sync-worker` (`vigia-r2-sync`) | Copia a R2 los buckets que quedaron en Google Cloud Storage |

## Cómo pasa un contrato de la fuente al dictamen

```text
  OECE (OCDS) y otras fuentes públicas
        │  algunas, por los relays de Zúrich y de Lima
        ▼
  vigia-scrapers ──────────▶ PostgreSQL: el registro de cada proceso
        │
        ▼
  R2: bases, actas y contratos (PDF, Word, Excel, ZIP, RAR)
        │
        ▼
  lectura previa: texto, OCR (vigia-ocr) y extracción ──▶ PostgreSQL
        │
        ▼
  dispatcher (la cola) o análisis masivo (GitLab CI)
        │
        ▼
  Lambda de la red ◀──────▶ vigia-llm (Workers AI)
        │  reglas, documentos, norma, mercado, prensa y web, red, dictamen
        ▼
  PostgreSQL: alerta, señales y dictamen
        │
        ▼
  vigia-api ──────▶ vigia-web y vigia-mcp
```

1. **Captura.** `vigia-scrapers` trae cada día, a las 6:00 de Lima, las convocatorias nuevas del OECE (estándar OCDS). En
   su calendario carga las demás fuentes: datos abiertos (PNDA), CONOSCE, MEF, JNE e Infogob, ONPE y el personal del
   Portal de Transparencia. Los documentos de cada proceso y lo crudo de cada descarga se guardan en R2. Las cargas más
   pesadas corren como tareas de GitLab CI: el RNP cada mes, las órdenes de cada entidad y el detalle de los contratos
   menores.
2. **Lectura previa.** Antes de analizar se lee el expediente entero (`backend/scripts/lectura_previa.py`): se abren los
   ZIP, RAR y Word, se saca el texto de cada página, las páginas escaneadas pasan por el OCR abierto (`vigia-ocr`) y un
   modelo ordena el texto en ítems, montos y bloques. Todo queda en la base. El análisis masivo sólo toma contratos cuya
   lectura previa quedó completa (tabla `lectura_previa`). Aparte, `backend/lector` lee los documentos por piezas
   (actas, contratos, bases) para las fichas y los precios.
3. **Agentes.** El `dispatcher` toma cada 5 minutos la cola `procesamientos`: los contratos financiados y los reanálisis
   pedidos desde el panel. El análisis masivo (`backend/scripts/masivo_agentes.py`) y los reanálisis por lote corren
   como tareas de GitLab CI, con un tope de gasto que se cuenta en la base. Todos llaman a la Lambda de la red del
   contrato. Ahí los pasos corren siempre en el mismo orden, fijado en el código (`backend/agent/deterministic.py`), no
   decidido por un modelo.
4. **Señales y dictamen.** Las 28 reglas corren en código, sin IA. Los agentes suman las suyas, y cada señal se coteja con
   el expediente y los registros antes de guardarse: si no se puede comprobar, se descarta. La norma sale del RAG
   normativo de la propia base, según la fecha de la convocatoria ([RAG_NORMATIVO_V2.md](docs/design/RAG_NORMATIVO_V2.md)).
   Al final, una autoevaluación revisa respaldo, citas, precios y tono. Si no pasa sus umbrales, el dictamen queda en
   revisión humana y no se publica hasta que alguien lo apruebe en el panel.
5. **Publicación.** Sólo la API publica, con una sola regla para todo lo que sale y lo que se tapa de las personas
   (`backend/api/src/lib/publicacion.ts` y `privacidad.ts`). La web la lee desde su servidor. Cada señal sale con su
   norma y su documento oficial.
6. **MCP.** `vigia-mcp` ofrece más de 50 herramientas de sólo lectura. Los datos de Vigía se los pide a la API por un
   service binding, así que rige la misma regla de privacidad. Se entra con una cuenta de Gobserva con el correo
   confirmado.

## Los modelos

- Sólo modelos abiertos, servidos por Workers AI a través de `vigia-llm` (`backend/llm-worker/wrangler.jsonc`).
- DeepSeek V4.1 Flash hace casi todo. GLM 5.3 atiende a los agentes de juicio más complejo: el redactor del dictamen, el
  analista legal y la red de personas.
- Si un modelo llega a su tope por minuto, el pedido pasa a otro modelo abierto (Gemma 4 o Qwen 3.8).
- Los vectores para buscar normas y documentos por sentido salen de bge-m3, también en Workers AI.
- El OCR es Docling, abierto, en un contenedor propio.
- Cada llamada anota su costo. Lo que cuesta leer los contratos se publica en `/metricas` (ver
  [OBSERVABILITY.md](OBSERVABILITY.md)).

## Dónde se guardan los datos

- **PostgreSQL 16 en AWS RDS**, con PostGIS (mapas), pgvector (búsqueda por sentido), pg_trgm y unaccent (búsqueda por
  nombre) y pg_cron (refrescos). Cada componente entra con su propio rol: la API, el panel, los agentes, el dispatcher,
  el MCP, la captura y el CI. El esquema son migraciones SQL numeradas en `backend/db/migrations/`.
- **Cloudflare R2**: los documentos de los expedientes, lo crudo de cada descarga, las fotos públicas, los comprobantes
  de los aportes (privados), la caché de páginas de la web y las evidencias del laboratorio de precios.
- **Fuera de la base**: el OAuth del MCP en KV (los tokens, como hash) y los contadores de límites en un Durable Object.
- **Secretos**: en los secretos de cada Worker y en AWS SSM Parameter Store. Nunca en el repositorio.

La base no es pública. Se llega así:

```text
Workers ──▶ Hyperdrive ──▶ túnel de Cloudflare ──▶ PgBouncer (EC2) ──▶ RDS
Lambdas de agentes, dentro de la VPC ──── TLS verificado ────────────▶ RDS
Una PC o el CI ──▶ Session Manager, por el mismo proxy ──────────────▶ RDS
```

## Cómo se despliega

- El repositorio de trabajo es privado, en GitLab, con su CI (`.gitlab-ci.yml`). Tiene dos ramas largas: `dev` y `main`.
- Cada push a `dev` o `main` que toca la API o la web corre tipos, pruebas y la guardia de estilo (`verificar:api`,
  `verificar:web`).
- Un push a `dev` despliega solo la API y la web de DEV, con su propia base. Ver [docs/DEV.md](docs/DEV.md).
- En `main`, los despliegues a producción son manuales, con el botón del pipeline: `deploy:api:prod`, `deploy:web:prod`
  y `deploy:agentes:prod`.
- Los agentes: `build:agente` arma la imagen (una base con las dependencias más una capa con `backend/agent`) y la sube
  a ECR. `deploy:agentes:prod` la pone en las cinco Lambdas. El CI entra a AWS con un token OIDC, sin llaves guardadas.
- Los demás Workers se despliegan desde una PC con `bash infrastructure/deploy/cloudflare/worker.sh <nombre>`, que sólo
  sube lo commiteado. Los que no están en ese script, con `npx wrangler deploy` desde su carpeta. Las migraciones de la
  base también se aplican desde una PC, por el túnel.
- Las tareas largas (análisis masivo, reanálisis, lectura por piezas, RNP, órdenes y contratos menores) son jobs de
  GitLab CI, manuales o con horario.
- **Espejo público.** `main` se publica en GitHub,
  [Gobserva-Cloud/vigia-peru](https://github.com/Gobserva-Cloud/vigia-peru), con
  `infrastructure/github/publicar_github.sh`: quita lo que no puede ser público, busca secretos y DNI antes de empujar y
  no reescribe lo ya publicado. El push directo a GitHub está desactivado. Allá `main` está protegida, las pruebas corren
  en cada PR y lo aprobado se integra en el repositorio de trabajo con la autoría de quien lo hizo
  ([CONTRIBUTING.md](CONTRIBUTING.md)).

## Lo que quedó atrás

Hasta octubre de 2026 Vigía corrió en Google Cloud: Cloud Run, Cloud SQL, Gemini en Vertex AI, Document AI, Vertex AI
Search, Cloud Storage y trazas en Arize. En octubre la base pasó a AWS RDS y la captura a Cloudflare. Desde el 4 de
noviembre los agentes corren en AWS Lambda, y desde el 10 de noviembre sólo con modelos abiertos. De Google queda Firebase
Authentication. El código viejo sigue en el repositorio y se elige por componente en `infrastructure/proveedores.env`
([docs/PROVEEDORES.md](docs/PROVEEDORES.md)). La versión del hackathon está en [docs/hackathon/](docs/hackathon/).
