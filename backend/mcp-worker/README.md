# vigia-mcp

El servidor MCP de Gobserva: **https://mcp.gobserva.cloud/mcp**. Conecta Vigía y las apps de Gobserva a cualquier
asistente que hable MCP (como conector personalizado, en una app de escritorio o desde la línea de comandos).

Es el Worker `vigia-mcp`, en Cloudflare Workers. El código vigente está en `src/v2`.

## Quién puede usarlo

- **Gratis con una cuenta de Gobserva con el correo confirmado.** Los cobros están en pausa desde el 24 de noviembre
  de 2026: la API le da el acceso abierto a toda cuenta con el correo verificado (`cobrosEnPausa`, en
  `backend/api/src/lib/gobservaPlanes.ts`). Si falta confirmar el correo, la herramienta lo dice.
- **Cada llamada a una herramienta pide una cuenta conectada** (`src/v2/acceso.ts`). Sin cuenta responden
  `initialize`, `tools/list`, los recursos y los prompts.
- **Las de Gobserva Salud son abiertas:** verificar un establecimiento o un médico no pide cuenta.
- **Créditos:** cada plan trae créditos al mes, también el acceso abierto (`limites.mcp`). Cada llamada que sale bien
  descuenta lo que pesa su herramienta (`PESOS` en `src/v2/cupos.ts`): 0 la cuenta y `mi_cupo`, 1 las búsquedas y
  fichas, 3 los análisis, 10 `consultar_datos` y `documentos_zip`. Topes internos: la quinta parte del mes en un día,
  un tope de filas por día y 60 llamadas por minuto. El contador vive en el Durable Object `Limitador` de `vigia-api`.

## Direcciones

| Ruta | Qué trae |
|---|---|
| `/mcp` | todas las herramientas, las guías y los prompts de Vigía |
| `/mcp/empleo` | plazas CAS, `estado_fuentes` y `mi_cupo` |
| `/mcp/licitaciones` (y `/mcp/obras`) | licitaciones, menores, obras, mercado, contratos, empresas, entidades y documentos |
| `/mcp/salud` | las herramientas de Gobserva Salud, abiertas |

Cada ruta tiene su nombre e instrucciones (`src/v2/servidor.ts`, `src/v2/guias.ts`). El OAuth es uno solo: el recurso
es `/mcp`. Un cliente que pide el token para su ruta (RFC 8707) encuentra los metadatos en
`/.well-known/oauth-protected-resource/<ruta>`, y `traducirRecurso` (`src/v2/index.ts`) lo pasa a `/mcp`.

## Herramientas

52 al 25 de noviembre de 2026: las de `src/v2/herramientas` (contratos, control, actores, entidad, datos, cuenta y
salud) más las 7 de productos (`src/gobserva.ts` y `src/obras.ts`: plazas CAS, licitaciones, mercado, proyectos de
inversión y obras). Cada una lleva `title` y sus anotaciones de lectura o escritura.

- **Casi todo por la API** (`src/v2/api.ts`, service binding `API`): así la regla de privacidad es una sola
  (`publicar()` en la API: sin DNI, un apellido tapado, sin RUC 10).
- **Las 7 de productos** consultan la base directo, por `HYPERDRIVE` con el rol `vigia_mcp`.
- **Recursos** (`vigia://guia/…`) y **prompts** de investigación, sólo en `/mcp`.

## Cuentas y OAuth

- `src/v2/oauth.ts`, con `@cloudflare/workers-oauth-provider`: el Worker es servidor de autorización y de recursos.
  Acepta Client ID Metadata Documents y, de respaldo, registro dinámico. PKCE S256 y tokens de refresco que rotan.
- En `/authorize` la persona entra con su cuenta de Gobserva: la de su app (AWS Cognito, `src/v2/cognito.ts`) o la de
  Vigía (Firebase). Sus datos de sesión quedan cifrados en `OAUTH_KV`.
- El plan se relee en cada refresco (cada hora) y, si no alcanza, al momento (con un minuto de memoria por cuenta).
- **Autenticación perezosa** (`src/v2/index.ts`): una herramienta que pide cuenta, llamada sin token, recibe `401` con
  `WWW-Authenticate: Bearer … resource_metadata=…`, y el cliente ofrece conectar.
- Transporte: Streamable HTTP sin estado. Sólo `POST`; `GET` y `DELETE` responden 405.

## El servidor de antes

`https://vigia-mcp.vigiaperu.workers.dev/mcp` (`src/index.ts`, `src/herramientas.ts`). Desde el 8 de noviembre de 2026
ya no responde herramientas: las lista y, al llamarlas, dice que el MCP se mudó a `mcp.gobserva.cloud`.

## Bindings, variables y secretos (`wrangler.jsonc`)

| Nombre | Tipo | Para qué |
|---|---|---|
| `API` | service binding a `vigia-api` | las herramientas de `src/v2` |
| `LIMITADOR` | Durable Object `Limitador` de `vigia-api` | créditos y topes |
| `OAUTH_KV` | KV | clientes, autorizaciones y tokens del OAuth |
| `HYPERDRIVE` | Hyperdrive, rol `vigia_mcp` | las 7 herramientas de productos |

Variables: `MCP_URL`, `VIGIA_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID`,
`COGNITO_GOBSERVA` (los mismos grupos que la API) y `ENTORNO`.

Secretos (`npx wrangler secret put`, en cada entorno):

- `FIREBASE_API_KEY`: la clave web de Firebase, fuera del repo.
- `MCP_INTERNO_TOKEN`: la cabecera `x-vigia-interno` con que el chat del panel entra como cuenta del equipo.

## Probar

```bash
cd backend/mcp-worker
npm ci
npm run typecheck
npm run build        # wrangler deploy --dry-run --outdir .wrangler-dist (no despliega)
npm run dev          # http://127.0.0.1:8812/mcp
```

`scripts/probar_herramientas.ts` corre cada herramienta de `src/v2` contra la API de producción, sin pasar por el
OAuth (las instrucciones están en el archivo). Pide `GOBSERVA_PRUEBA` en el entorno.

En DEV: `bash infrastructure/deploy/dev.sh mcp` despliega la copia de trabajo en `vigia-mcp-dev`
(`https://vigia-mcp-dev.vigiaperu.workers.dev/mcp`), contra `vigia-api-dev`.

## Desplegar

`bash infrastructure/deploy/cloudflare/worker.sh mcp`. Se niega si la carpeta tiene cambios sin commitear.
