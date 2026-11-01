# gobserva.cloud: la portada de Gobserva

Vigía es un producto de Gobserva. El dominio `gobserva.cloud` (comprado en IONOS) sirve a Vigía en
`vigia.gobserva.cloud`, y este Worker (`gobserva-redirect`, el nombre quedó del principio) es la raíz:

- **Desde el 2026-11-01, la portada de Gobserva** (`worker.js`; el HTML llega completo y el JavaScript sólo anima): para
  que «gobserva» y «gobserva cloud» tengan una página que los buscadores puedan mostrar. Lleva los datos estructurados de
  la organización (`https://gobserva.cloud/#organizacion`, el mismo `@id` que usa Vigía en `frontend/app/layout.tsx`), su
  `robots.txt`, su `sitemap.xml` y la clave de IndexNow. Secciones: portada con el logo, el eslogan y el mapa; la
  presentación en cinco capítulos; Vigía; Próximamente; los seis principios y las diez fuentes.
- **La presentación** (2026-11-01, pedido del usuario: «es la presentación: gráficas, datos, propuestas, valor»), del
  problema a quién lo usa:

  | Capítulo | Qué muestra | De dónde sale |
  |----------|-------------|---------------|
  | 01 El problema | 100 cuadros, 13 en óxido: lo que se pierde de cada 100 soles; S/ 24,268 millones y S/ 8,963 millones en inversión | Estimación de la Contraloría para 2023 (`CONTRALORIA` en `worker.js`: cambiarla a mano cuando publique la siguiente) |
  | 02 La escala | Procesos de compra por año desde 2016 y mil cuadros con los pocos que se leen a fondo | API de Vigía: `/v1/contratos/resumen` por año y el de este año (`porRiesgo`, la misma cuenta de su portada) |
  | 03 Dónde | Las diez regiones con más casos en trámite y, dentro de cada barra, los que tienen sentencia firme | Procuraduría, por la API (`/v1/corrupcion/region/NN`) |
  | 04 Cómo funciona | Las diez instituciones entran, la lupa cruza y salen las señales (`SENALES`, las que Vigía ya marca) | Texto |
  | 05 Para quién | Ciudadanía, periodismo y control, con lo que cada uno hace con la evidencia (`PUBLICOS`) | Texto |

  Las animaciones las arma `publico/animaciones.js`: cada bloque con `data-anima` recibe `.visible` al entrar en pantalla
  y el CSS lo enciende en escalones (`steps()`, como píxeles); las cifras con `data-contar` cuentan desde cero; el flujo
  del capítulo 04 sólo se mueve mientras se ve. Sin JavaScript o con movimiento reducido no se pone la clase `.anima` y
  todo se ve quieto y completo. Los capítulos 02 y 03 no salen si la API no respondió.
- **El diseño** (tercera versión, 2026-11-01, pedido del usuario: «no tiene colores, falta píxeles, letras demasiado
  grandes», con las skills impeccable *colorize* y better-typography, halladas con find-skills):
  - **Color con significado.** Cada institución tiene el suyo en el mapa, las cifras, la ficha y las fuentes: Procuraduría
    óxido `#FF5A4D`, Contraloría ámbar `#FFB020`, OECE lima `#D4FF3F` (los tokens rust, amber y lima de Vigía). Los
    productos que vienen tienen el suyo: Congreso violeta, Políticos cian, Obras naranja, Alertas rosa. Cada color lleva
    su versión oscura en el modo claro, con contraste de 4.5:1 sobre el fondo.
  - **Píxeles.** Los íconos se dibujan píxel a píxel en `pixeles.js` (12 x 12; también el ojo de puntos de Vigía).
    Las tarjetas y los botones tienen esquinas en escalón (clase `esq`), el fondo lleva la trama de puntos de Vigía y la
    cabecera, su línea de puntos lima.
  - **Letras.** Space Grotesk para los títulos (de 22 a 28 px), Inter para el texto (16 px) y Doto, una letra de puntos
    como el ojo de Vigía, para el titular y las cifras. Silkscreen sólo en los rótulos de estado («En vivo», «En
    preparación»).
  - **Próximamente.** Los monitores que vienen (Congreso, historia de políticos, obras, alertas): `PROXIMOS` en
    `worker.js`, cada uno con lo que Vigía ya lee de él.
- **El mapa de la portada** (desde el 2026-11-01): el Perú en una malla de píxeles, en la identidad Píxel de Vigía, y la
  lupa de Gobserva que lo recorre. Al abrir, los píxeles se encienden en ola desde Lima; cada métrica pinta con su rampa
  (Corrupción en óxido, Control en ámbar, Compras en lima), y las tres tarjetas de arriba son el selector, con la cifra
  del país. Con el mouse sigue al puntero y agranda los puntos; la región que toca se enciende, a
  su lado salen sus cifras y la ficha cuenta lo que registran la Procuraduría Anticorrupción (casos en trámite y con
  sentencia firme), la Contraloría (informes con presunta responsabilidad, que no es una condena) y la OECE (procesos de
  compra desde 2015). Sin tocarla, recorre sola las regiones; con el teclado, las flechas cambian de región. Piezas:
  - `mapa/generar_mapa.py` → `publico/mapa-peru.js`: la malla (58 x 85 celdas, 2,257 píxeles) de los límites de
    `frontend/public/peru-departments.json`. El Callao, más chico que una celda, se queda con 3.
  - `publico/portada.js`: la lupa, el recorrido, el teclado y la ficha (sin dependencias). Al cambiarlo, al cambiar
    `animaciones.js` o al regenerar la malla, subir `VERSION_JS` en `worker.js`: Cloudflare guarda los scripts un día en
    el navegador.
  - Las cifras: el Worker las pide a la API de Vigía (`VIGIA_API_URL` en `wrangler.jsonc`; la API lo atiende porque
    `gobserva.cloud` está en `WORKERS_PROPIOS`), son unos 40 pedidos (el plan gratis de Workers admite 50 por visita) y
    quedan en la caché de Cloudflare (`CACHE_REGIONES`, hoy `regiones-v2`: cambiarle el nombre si cambia la forma de los
    datos), que se renueva cada 6 horas en segundo plano. Si la API no responde, la página sale igual, con el mapa y un
    enlace a Vigía.
  - Los rótulos siguen `docs/CORRUPCION.md`: la Procuraduría y la Contraloría nunca se suman.
- **La marca** (logo con la lupa en la «o», eslogan, colores y cómo usarlos): [`marca/README.md`](marca/README.md). El
  logo y la ilustración van en línea desde `marca.js`; favicon, `logo.png`, `og.png` y el logo para descargar están en
  `publico/`, que Cloudflare sirve antes de llegar al Worker (`assets` en `wrangler.jsonc`, encabezados en
  `publico/_headers`). Todo eso lo escribe `marca/generar_marca.py`: no editarlo a mano.
- `www.gobserva.cloud` → 301 a `gobserva.cloud`; cualquier otra ruta → 302 a la misma en `vigia.gobserva.cloud` (los
  enlaces viejos siguen andando; 302 porque un 301 queda guardado en el navegador). Antes (29 al 31-oct) la raíz
  redirigía entera a Vigía.
- Al cambiar el texto: subir `ACTUALIZADA` en `worker.js`, `npx wrangler deploy` aquí y avisar a IndexNow:
  `curl "https://api.indexnow.org/indexnow?url=https%3A%2F%2Fgobserva.cloud%2F&key=<CLAVE_INDEXNOW>"`.

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
| Zona (`proteger_zona.py`) | HTTPS siempre, TLS ≥ 1.2, HSTS; los buscadores verificados (Googlebot, Bingbot…) pasan primero; bloqueo de rastreadores de entrenamiento de IA por nombre (el `ai_training=block` de Cloudflare quedó apagado el 2026-10-30: bloqueaba a Googlebot y a Bingbot y corre antes que las reglas propias); bloqueo de rutas de escáneres; desafío a clientes de scripts y a lo que llega desde redes de nubes y hosting (los bots verificados pasan); 100 pedidos cada 10 s por IP fuera de `/_next/` (sólo bloqueo: el plan Free no permite desafío ahí) |
| `frontend/app/robots.ts` | Los rastreadores de entrenamiento no entran; nadie recorre páginas con consulta (filtros, pestañas, paginación); el sitemap |
| `frontend/worker-prod.js` | 300 páginas por minuto por IP (una IPv6 por su /64), sin contar los prefetch de Next; reenvía `/v1/…` a la API con la IP del visitante (`x-vigia-ip`); trampa: un enlace escondido (`app/layout.tsx`) a `/app/indice-completo`, prohibido en `robots.txt`, veta una hora a la IP que lo pide |
| `backend/api/src/lib/antibots.ts` | La API sólo atiende a nuestros Workers (`cerradaAlPublico`, antes de su caché): el navegador le pide por la web (`/v1`, detrás de todo lo anterior). Directo sólo `/`, `/health`, `/livez`, el token del panel y el del build del CI (`x-vigia-build` = `BUILD_TOKEN`, `frontend/scripts/fetch-build.cjs`); `API_PUBLICA=si` la reabre sin desplegar. 120 lecturas y 30 búsquedas por minuto por IP; 10 escrituras por minuto y ruta, con Turnstile |
| `backend/mcp-worker/src/index.ts` | El MCP es abierto (datos públicos, solo lectura): 120 llamadas por minuto por IP, alto porque los clientes de IA alojados comparten IPs |

Los límites por IP de la API y de la web los cuenta un Durable Object por clave (`backend/api/src/workers/limitador.ts`):
los bindings de Rate Limiting de Workers cuentan en cada máquina y, con el placement en us-east-2, dejaban pasar casi todo
(600 pedidos en 9 s sin un 429).

Los buscadores (Googlebot, Bingbot), las vistas previas de enlaces (WhatsApp, Telegram, Facebook) y los asistentes que
abren una página porque una persona lo pidió (ChatGPT-User, Claude-User, Perplexity) siguen entrando. Para revisar o
volver a aplicar lo de la zona: `CLOUDFLARE_API_TOKEN=… python proteger_zona.py estado` (o `todo`).
