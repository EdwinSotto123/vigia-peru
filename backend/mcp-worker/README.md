# vigia-mcp (Cloudflare Workers)

Réplica en Workers del servidor MCP de `backend/mcp` (Cloud Run `vigia-mcp`). El de Python sigue igual;
este expone las mismas 3 tools read-only (`buscar_alertas`, `riesgo_convocatoria`,
`empresa_sancionada`) con los mismos nombres, descripciones, esquemas, SQL y salida al carácter.

- URL: `https://vigia-mcp.vigiaperu.workers.dev/mcp`
- Transporte: MCP Streamable HTTP **sin estado** (sin `Mcp-Session-Id` ni Durable Objects), sólo `POST /mcp`;
  respuestas en SSE como FastMCP. `GET`/`DELETE` → 405, `/mcp/` → 307 a `/mcp`, otra ruta → 404.
- Autenticación: **ninguna**, igual que Cloud Run (`--allow-unauthenticated`). Son datos públicos.

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
