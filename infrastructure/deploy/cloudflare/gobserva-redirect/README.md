# gobserva.cloud → vigia.gobserva.cloud

Vigía es un producto de Gobserva. El dominio `gobserva.cloud` (comprado en IONOS) sirve a Vigía en
`vigia.gobserva.cloud`, y la raíz (y `www`) redirige ahí con este Worker.

## Pasos

1. **Zona en Cloudflare.** Agregar `gobserva.cloud` a la cuenta (plan Free). Cloudflare da dos nameservers.
2. **Correo de IONOS.** Antes de cambiar los nameservers, la zona de Cloudflare debe tener los registros del correo,
   todos **sin proxy** (nube gris):

   | Tipo  | Nombre               | Valor                                   |
   |-------|----------------------|-----------------------------------------|
   | MX    | @                    | mx00.ionos.com (prioridad 10)           |
   | MX    | @                    | mx01.ionos.com (prioridad 10)           |
   | TXT   | @                    | `v=spf1 include:_spf-us.ionos.com ~all` |
   | CNAME | _dmarc               | dmarc.ionos.com                         |
   | CNAME | autodiscover         | adsredir.ionos.info                     |
   | CNAME | s1-ionos._domainkey  | s1.dkim.ionos.com                       |
   | CNAME | s2-ionos._domainkey  | s2.dkim.ionos.com                       |

3. **Nameservers en IONOS.** Dominios y SSL → gobserva.cloud → Nameservers → servidores propios: los dos de Cloudflare.
4. **Vigía en el subdominio.** Con la zona activa: custom domain `vigia.gobserva.cloud` en el Worker `vigia-web`
   (`frontend/wrangler.jsonc`, `routes` con `custom_domain: true`) y `npx wrangler deploy` aquí para la redirección.
5. **El sitio sabe su dominio.** `NEXT_PUBLIC_SITE_URL=https://vigia.gobserva.cloud` en el job `deploy:web:prod` de
   `.gitlab-ci.yml` (enlaces para compartir, imágenes OG). La API ya acepta ese origen (`ALLOWED_ORIGINS`).

`vigia-web.vigiaperu.workers.dev` sigue funcionando: los enlaces viejos no se rompen.

## Estado (2026-10-29)

- Zona `gobserva.cloud` creada en Cloudflare (id `1324ec9688788a6080a56e529bd5fe53`), con los 7 registros del correo.
  Nameservers: `ainsley.ns.cloudflare.com` y `syeef.ns.cloudflare.com` (los mismos de simplia.store). DNSSEC apagado en IONOS.
- `vigia.gobserva.cloud` es custom domain de `vigia-web`, creado por la API (`PUT /accounts/:id/workers/domains`), NO
  en `frontend/wrangler.jsonc`: así el deploy del CI no necesita permisos sobre la zona. Si un deploy lo borrara,
  volver a crearlo con esa llamada.
- `gobserva-redirect` desplegado con `gobserva.cloud` y `www.gobserva.cloud`.
- Nameservers cambiados en IONOS a mano (el MCP de IONOS no tiene herramienta para eso); zona activa el 2026-10-29
  23:51 (Lima). `NEXT_PUBLIC_SITE_URL=https://vigia.gobserva.cloud` en `deploy:web:prod` desde el commit 5130e37.
- También dependen del dominio: el widget de Turnstile «Vigía Perú — formularios públicos» (lista de dominios) y los
  dominios autorizados de Firebase Auth (proyecto `simplia-project`, para el ingreso con Google del admin). Ambos ya
  incluyen `vigia.gobserva.cloud`. Un dominio nuevo para Vigía tiene que sumarse en los dos, en `ALLOWED_ORIGINS` y en
  `WORKERS_PROPIOS` (backend/api/wrangler.jsonc: si no, la API limita a la web como si fuera un solo visitante).

## Protección contra abuso (2026-10-30)

Todo el tráfico de internet pasa por la zona: `frontend/worker-prod.js` redirige `vigia-web.vigiaperu.workers.dev` a
`vigia.gobserva.cloud` (en *.workers.dev no hay WAF ni nada de lo que sigue). Por capas:

| Dónde | Qué |
|-------|-----|
| Zona (`proteger_zona.py`) | HTTPS siempre, TLS ≥ 1.2, HSTS; bloqueo de rastreadores de entrenamiento de IA (`ai_training` + regla por nombre); bloqueo de rutas de escáneres; desafío a clientes de scripts (los bots verificados pasan); 100 pedidos cada 10 s por IP fuera de `/_next/` |
| `frontend/app/robots.ts` | Los rastreadores de entrenamiento no entran; nadie recorre las listas de `/app` con filtros |
| `frontend/worker-prod.js` | 300 páginas por minuto por IP (una IPv6 por su /64), sin contar los prefetch de Next |
| `backend/api/src/lib/antibots.ts` | La API no tiene zona: 120 lecturas y 30 búsquedas por minuto por IP; 10 escrituras por minuto y ruta, con Turnstile. Lo que piden nuestros Workers (cabecera `CF-Worker`, que Cloudflare no deja falsificar) no cuenta |
| `backend/mcp-worker/src/index.ts` | El MCP es abierto (datos públicos, solo lectura): 120 llamadas por minuto por IP, alto porque los clientes de IA alojados comparten IPs |

Los límites por IP de la API y de la web los cuenta un Durable Object por clave (`backend/api/src/workers/limitador.ts`):
los bindings de Rate Limiting de Workers cuentan en cada máquina y, con el placement en us-east-2, dejaban pasar casi todo
(600 pedidos en 9 s sin un 429).

Los buscadores (Googlebot, Bingbot), las vistas previas de enlaces (WhatsApp, Telegram, Facebook) y los asistentes que
abren una página porque una persona lo pidió (ChatGPT-User, Claude-User, Perplexity) siguen entrando. Para revisar o
volver a aplicar lo de la zona: `CLOUDFLARE_API_TOKEN=… python proteger_zona.py estado` (o `todo`).
