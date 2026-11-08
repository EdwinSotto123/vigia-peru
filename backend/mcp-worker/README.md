# vigia-mcp (Cloudflare Workers)

Dos servidores MCP en el mismo Worker (`src/index.ts` elige por host):

## v2: `https://mcp.gobserva.cloud/mcp` (`src/v2`, desde 2026-11-06)

**Desde 2026-11-08 el MCP es de los planes de pago** (el usuario: «el MCP debe ser activo para gente con plan activo»).
Toda llamada a una herramienta pide cuenta conectada y un plan vigente (`src/v2/acceso.ts`, `tienePlanPara` en
`entorno.ts`): las de plazas CAS, el plan de Empleo; las de licitaciones, obras y mercado, el de Licitaciones (trae Obras);
las de Vigía, cualquier plan. Sin plan, `/authorize` no conecta (página «El MCP viene con los planes de pago», 402) y una
herramienta responde dónde se adquiere. El plan se relee en cada refresh (cada hora) y, si no alcanza, al momento (un
minuto de memoria por cuenta): quien acaba de contratar no tiene que reconectar. Se entra con la cuenta de la app donde
está el plan (AWS Cognito, `src/v2/cognito.ts`, `COGNITO_GOBSERVA` en `wrangler.jsonc`, los mismos grupos de la API) o,
plegada, con la de Vigía (Firebase) si tiene un plan (cortesía por uid desde el panel: `POST /admin/gobserva/cortesia`
con `uid`). initialize, tools/list, los recursos y los prompts siguen abiertos.

**Una dirección por producto (2026-11-08):** `/mcp/empleo` (plazas CAS, `estado_fuentes` y `mi_cupo`) y
`/mcp/licitaciones` (alias `/mcp/obras`: licitaciones, menores, obras, mercado, compradores y competidores, documentos),
cada una con su nombre e instrucciones (`servidor.ts` → `perfilDeRuta`, `herramientasDe`; `guias.ts`); `/mcp` sigue con
todas, las guías y los prompts de Vigía. El OAuth es uno: el recurso es `/mcp` y la librería acepta su token en las
subrutas; si el cliente manda `resource=…/mcp/empleo`, la página de autorización marca la cuenta de Empleo.

**Créditos (2026-11-08):** cada plan trae créditos al mes (`limites.mcp` en backend/api/src/lib/gobservaPlanes.ts: Empleo
Alertas 300, Institucional 5 000; Licitaciones Inicia 1 500, Crece 5 000, Pro 15 000) y cada llamada que sale bien descuenta
lo que pesa su herramienta (`PESOS` en `src/v2/cupos.ts`: 0 lo de la cuenta y `mi_cupo`, 1 búsquedas y fichas, 3 análisis,
10 `consultar_datos` y `documentos_zip`). Topes internos: la quinta parte del mes por día, filas por día (el doble de los
créditos, al menos 2 000) y 60 llamadas por minuto. El contador es una suma por mes y por día en el Durable Object
`Limitador` de vigia-api (`creditos`/`gastar`, clave `mcp2|u|<uid>|creditos`); la API manda los topes con los planes
(`GET /gobserva/cuenta/planes` → `mcp`) y la cuenta muestra el uso (`GET /gobserva/cuenta/mcp`). Con el 10 % o menos, la
respuesta trae un aviso de lo que queda.

El MCP para conectar Vigía a claude.ai (conector personalizado), Claude Desktop, el celular, Cowork y Claude Code
(`claude mcp add --transport http vigia https://mcp.gobserva.cloud/mcp`). En DEV: `https://vigia-mcp-dev.vigiaperu.workers.dev/mcp`
(`bash infrastructure/deploy/dev.sh mcp`).

- **Todo por la API** (`src/v2/api.ts`, service binding `API` → vigia-api): sin SQL propio de Vigía, así la regla de
  privacidad es una sola (`publicar()`: sin DNI, un apellido tapado, sin RUC 10). El pedido sale nuevo, sin
  `cf-connecting-ip`, y la API lo trata como interno.
- **26 herramientas** (`src/v2/herramientas`): buscar, buscar_contratos, ficha_contrato, dictamen, compras_menores, ordenes,
  senales, estado_fuentes, ficha_empresa, ficha_entidad, proveedores_de_entidad, partido; con cuenta: red_empresa,
  historia, persona_publica, consultar_datos, seguir, dejar_de_seguir, mis_seguimientos; y las 7 de Gobserva (las de
  siempre, `src/gobserva.ts` y `src/obras.ts`). Cada una con `title` y `readOnlyHint`/`destructiveHint`.
- **Recursos** (`vigia://guia/…`: cómo usar, puntaje, privacidad, fuentes, señales, catálogo de cifras) y **prompts**
  (investigar_proveedor, revisar_entidad, explicar_contrato, comparar_entidades, seguir_al_partido, panorama_region).
- **OAuth** (`src/v2/oauth.ts`, `@cloudflare/workers-oauth-provider`): el Worker es servidor de autorización y recurso.
  Client ID Metadata Document (lo que usa Claude) y registro dinámico de respaldo, PKCE S256, refresh que rota. En
  `/authorize` la persona entra con su cuenta de Gobserva (Firebase: correo o Google) y permite; las props (cifradas en
  `OAUTH_KV`) guardan su uid, su token de refresco de Firebase y sus planes, que se releen en cada refresh.
- **Autenticación perezosa** (`src/v2/index.ts`): sin token responden initialize, tools/list y las herramientas abiertas;
  una que pide cuenta recibe `401` con `WWW-Authenticate: Bearer … resource_metadata=…` antes del SDK, y Claude muestra
  «Conectar» y reintenta.
- **Cupos** (`src/v2/cupos.ts`, Durable Object `Limitador` de vigia-api): todo claude.ai llega desde 160.79.104.0/21,
  así que no se cuenta por IP: con cuenta, por persona (300/día gratis, 3 000 con plan; consultar_datos 50/1 000); sin
  cuenta, un tope total para Anthropic (600/min) y 60/min por IP para el resto.
- **WAF de gobserva.cloud**: las reglas de clientes sin navegador, redes de nube, rastreadores de IA y el límite por IP
  excluyen `mcp.gobserva.cloud` (el plan Free no admite una regla más). Firebase: `mcp.gobserva.cloud` y el host de DEV
  están en los dominios autorizados (para «Entrar con Google»).
- Secreto: `FIREBASE_API_KEY` (wrangler secret put, en cada entorno). KV: `vigia-mcp-oauth` y `vigia-mcp-oauth-dev`.

## El de siempre: `https://vigia-mcp.vigiaperu.workers.dev/mcp`

Réplica en Workers del servidor MCP de `backend/mcp` (Cloud Run `vigia-mcp`). El de Python sigue igual;
este expone las mismas 3 tools read-only (`buscar_alertas`, `riesgo_convocatoria`,
`empresa_sancionada`) con los mismos nombres, descripciones, esquemas, SQL y salida al carácter.

- URL: `https://vigia-mcp.vigiaperu.workers.dev/mcp`
- **Herramientas de Gobserva (2026-11-01, `src/gobserva.ts`)**: además de las 3 de Vigía, las de los productos de pago
  (gratis durante la beta, anunciadas en empleo.gobserva.cloud y licitaciones.gobserva.cloud):
  - `buscar_plazas_cas(texto, region, sueldo_min, sin_experiencia, limite)`: plazas CAS abiertas hoy (`servir_convocatoria`).
  - `ficha_plaza_cas(aviso)`: requisitos, sueldo frente a otras entidades (p25/mediana/p75) y señales.
  - `buscar_licitaciones(texto, region, tipo, dias, limite)`: convocatorias recientes (`convocatorias` + `entidades`).
  - `mercado_rubro(rubro, meses)`: agregados de CONOSCE por la función `gobserva_mercado_rubro()` (migración 227,
    SECURITY DEFINER: el rol `vigia_mcp` no lee `conosce_adjudicaciones`, que trae personas naturales).
  Las palabras se buscan sin tildes con una expresión por palabra (sólo letras y cifras de lo escrito). Responden con un
  único TextContent JSON (no imitan a FastMCP: no existen en el servidor de Python). Permisos: migración 226.
- El borde de workers.dev bloquea el agente «Python-urllib» (403); los clientes MCP reales (httpx, node, Claude, ChatGPT)
  pasan. Para probar con urllib, mandar otro User-Agent.
- Transporte: MCP Streamable HTTP **sin estado** (sin `Mcp-Session-Id` ni Durable Objects), sólo `POST /mcp`;
  respuestas en SSE como FastMCP. `GET`/`DELETE` → 405, `/mcp/` → 307 a `/mcp`, otra ruta → 404.
- Autenticación: **ninguna**, igual que Cloud Run (`--allow-unauthenticated`). **Desde 2026-11-08 ya no responde
  herramientas**: lista las de siempre y, al llamarlas, dice que el MCP se mudó a `https://mcp.gobserva.cloud/mcp` y
  viene con los planes de pago.

## Bindings, variables y secretos

| Nombre | Tipo | Uso |
|---|---|---|
| `HYPERDRIVE` | Hyperdrive | Postgres `vigia` con el rol `vigia_mcp`. En `wrangler.jsonc` va `PENDIENTE_HYPERDRIVE_MCP`: reemplazar por el id real. |

No hay variables ni secretos del Worker: la clave de `vigia_mcp` vive sólo en la config de Hyperdrive.

```bash
npx wrangler hyperdrive create vigia-mcp \
  --connection-string="postgres://vigia_mcp:<clave>@<host>:5432/vigia" \
  --caching-disabled   # sin caché, como Cloud Run: una alerta que pasa a revisión deja de verse al instante
```

Hyperdrive agrupa conexiones en modo transacción (lo que hacía PgBouncer): el Worker abre un cliente
`pg` por llamada de tool y lo cierra con `ctx.waitUntil`; sólo hay consultas sueltas en autocommit.

## Desarrollo local

`wrangler dev` no usa Hyperdrive real: toma la conexión de una variable de entorno (nunca al repo).

```bash
npm install
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://<usuario>:<clave>@localhost:55432/vigia?sslmode=disable"
npm run dev          # http://127.0.0.1:8812/mcp
npm run typecheck
npm run build        # wrangler deploy --dry-run --outdir .wrangler-dist
```

## Prueba de paridad con el servidor Python

```bash
# 1) MCP de Python (venv con backend/mcp/requirements.txt) contra la misma base (variables PG*), en 127.0.0.1:8811
python scripts/mcp_python_local.py
# 2) el Worker en 8812 (npm run dev) y 3) la comparación
npm run paridad
```

`scripts/paridad.mjs` usa el cliente oficial del SDK contra ambos y compara el resultado JSON-RPC crudo
de cada llamada (listados, 3 tools con argumentos válidos, inválidos y de borde, tool inexistente, rutas HTTP).

## Diferencias conocidas con Cloud Run

- Sin sesiones: no hay stream `GET` ni `DELETE`; los clientes MCP lo toleran (ninguna tool usa sesión).
- `serverInfo.version` es `1.0.0`; FastMCP publica la versión del paquete `mcp` instalado.
- Descripciones: se replican tal como las publica Python 3.12 (la imagen), con la sangría del docstring.
- Errores: los de validación imitan a pydantic 2.13 (la URL de ayuda lleva esa versión) y los de Postgres
  salen con el formato de pg8000; los de conexión a la base tienen otro texto.
- Enteros de más de 2^53 en los argumentos pierden precisión al parsear el JSON.

## Cambiar de proyecto

Nada que cambiar. La base llega por Hyperdrive (`vigia-mcp`) y el túnel `vigia-db`, que sigue a la VM de PgBouncer donde esté (`infrastructure/deploy/gcp/pgbouncer.sh crear` en el proyecto nuevo). Guía: `infrastructure/deploy/gcp/migracion/README.md`.
