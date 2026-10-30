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
- Falta: los nameservers en IONOS (el MCP de IONOS no tiene herramienta para eso) y, con la zona activa,
  `NEXT_PUBLIC_SITE_URL` (paso 5).
