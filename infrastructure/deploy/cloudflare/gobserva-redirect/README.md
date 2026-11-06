# gobserva.cloud: la portada de Gobserva

Vigía es un producto de Gobserva. El dominio `gobserva.cloud` (comprado en IONOS) sirve a Vigía en
`vigia.gobserva.cloud`, y este Worker (`gobserva-redirect`, el nombre quedó del principio) es la raíz:

- **Desde el 2026-11-01, la portada de Gobserva** (`worker.js`; el HTML llega completo y el JavaScript sólo anima): para
  que «gobserva» y «gobserva cloud» tengan una página que los buscadores puedan mostrar, y la puerta de entrada a los
  productos. Lleva los datos estructurados de la organización (`https://gobserva.cloud/#organizacion`, el mismo `@id` que
  usa Vigía en `frontend/app/layout.tsx`), su `robots.txt`, su `sitemap.xml` y la clave de IndexNow.
- **El radar cívico** (2026-11-01, pedido del usuario: «un layout más complejo, más tecnológico, colores verdes,
  animaciones, mensajes; recuerda que es el punto de entrada»; después: «ordénalo mejor y haz un botón de día y noche»):
  la portada es un instrumento de observación.
  - **Noche y día.** Noche es el modo de siempre: negro verdoso `#030B07` con la cuadrícula de un visor; verde fósforo
    `#3DFF8A` es la señal y rojo `#FF5A4D` la alerta (lo que se pierde, la sentencia firme, el riesgo alto, las regiones
    con más casos). Día es papel verde claro `#EDF4EF` con tinta de bosque `#087A3B`, sin neón ni brillos (como el modo
    día de Vigía), con contraste de 4.5:1 o más para todo lo que es texto. Los dos son variables de `:root` y de
    `:root[data-modo="dia"]` en el CSS de `worker.js`; también cambian el barrido del radar (`--mezcla`: screen de
    noche, multiply de día) y los halos (`--halo`, `--luz`: apagados de día). Cada institución conserva su luz
    (Procuraduría roja, Contraloría ámbar, OECE verde); el lima `#D4FF3F` queda para la marca y el botón de entrar.
  - **El botón Día | Noche** (cabecera; `publico/interfaz.js`): guarda la elección en este navegador (`localStorage`,
    `gobserva-modo`, como `vigia-modo` en Vigía) y avisa con el evento `gobserva:modo` (portada.js vuelve a pintar el
    mapa). Antes de pintar, un script en línea (`MODO_INICIAL` en `worker.js`) pone `data-modo` con lo guardado; si
    nunca se eligió, noche. Es el único script en línea: la CSP lo deja correr por su hash, que el Worker calcula al
    primer pedido (`cabeceras()`), así que cambiar el script no rompe nada. El cambio hace un fundido corto (View
    Transitions) si nadie pidió menos movimiento.
  - **Letras:** Archivo (títulos anchos con `font-stretch` y texto), JetBrains Mono (la consola y los rótulos, la misma
    del logo) y Doto, de puntos, para las cifras.
  - **El orden.** Arriba: el logo, el eslogan y la entrada a Vigía; la **consola**, que escribe lo que Gobserva lee y
    después cada región que muestra el radar; y el **instrumento**, un solo marco con los canales (Corrupción, Control,
    Compras), el visor del radar y la lectura de la región. Desde 80rem, el texto y la consola a la izquierda (la consola
    llega al ras del instrumento) y el instrumento a la derecha; de 48 a 80rem, el texto y la consola arriba y el
    instrumento entero debajo; en el teléfono, uno debajo del otro. El instrumento se acomoda a su propio ancho
    (container queries): ancho, el visor y la lectura van lado a lado; angosto, la lectura va debajo. Luego la **cinta**
    con las cifras del país y las seis secciones, numeradas en el orden de `SECCIONES` (el número va en el título y en el
    índice de la cabecera, que marca la que se está leyendo):

    | N.º | Sección | Qué tiene |
    |-----|---------|-----------|
    | 01 | Lo que el radar detecta | Cuatro paneles de instrumentos, cada uno con la luz y el nombre de su institución en la cabecera (tabla de abajo) |
    | 02 | Cómo funciona | Cuatro etapas parejas (Observa, Conecta, Señala, Tú decides) sobre un riel por el que corren paquetes |
    | 03 | Para quién | Ciudadanía, periodismo y control, con lo que cada uno hace con la evidencia (`PUBLICOS`) |
    | 04 | Elige por dónde entrar | Vigía en línea (con sus seis accesos) y los monitores en preparación, de borde punteado (`PROXIMOS`) |
    | 05 | Seis reglas | `PRINCIPIOS` |
    | 06 | Diez fuentes | `FUENTES`, con la luz de las tres que mide el radar |

    | Panel | Qué muestra | De dónde sale |
    |-------|-------------|---------------|
    | Contraloría | 100 cuadros, 13 en rojo: lo que se pierde de cada 100 soles; S/ 24,268 millones y S/ 8,963 millones en inversión | Estimación para 2023 (`CONTRALORIA` en `worker.js`: cambiarla a mano cuando publique la siguiente) |
    | OECE | Procesos de compra por año desde 2016 | API de Vigía: `/v1/contratos/resumen` de cada año |
    | Vigía | Una aguja en un pajar: mil cuadros (100 x 10; 50 x 20 en pantallas angostas) con los pocos leídos a fondo este año | El resumen del año (`porRiesgo`, la misma cuenta de la portada de Vigía) |
    | Procuraduría | Las diez regiones con más casos en trámite y, dentro de cada barra, los que tienen sentencia firme; debajo, las 25 regiones en una tabla | `/v1/corrupcion/region/NN` |

  - **Animaciones** (`publico/animaciones.js`, sólo con JavaScript y sin movimiento reducido: la clase `.anima` en
    `<html>`): el visor se enciende al abrir; cada bloque con `data-anima` recibe `.visible` al entrar en pantalla, el
    panel lo recorre una línea de luz y lo de adentro se arma en escalones (`steps()`, como píxeles); las cifras con
    `data-contar` cuentan desde cero; la consola escribe; la cinta y los paquetes corren mientras se ven. El botón
    «Pausar animación» del radar (`aria-pressed`) pone `.pausado` y detiene todo lo que se mueve, el recorrido y la
    consola. El botón de día y noche y el índice (`interfaz.js`) andan también con movimiento reducido. Sin JavaScript
    todo se ve quieto y completo, de noche; los paneles no salen si la API no respondió.
- **El radar** (`publico/portada.js` y el CSS de `worker.js`): el Perú en una malla de píxeles verdes (una sola rampa
  para las tres métricas, más brillo con más casos) y la lupa de Gobserva, con su retícula, que lo recorre. Encima, la
  retícula del radar (`RETICULA` en `worker.js`: anillos y rumbos cada 5° con `pathLength="360"`) y un barrido de CSS
  que gira cada `--periodo` (6 s) con `mix-blend-mode: screen`, así aclara los puntos que pasa. Las tres regiones con
  más de la métrica elegida son ecos rojos que se encienden cuando el barrido pasa por su rumbo (portada.js calcula el
  retraso con el `currentTime` de la animación del barrido). Abajo a la derecha, las coordenadas de la lupa en grados y
  minutos. Los canales de arriba (Corrupción, Control, Compras) eligen qué muestra, con la cifra del país. Con el mouse,
  la lupa sigue al puntero; sin tocarla, recorre sola las regiones; con el teclado, las flechas cambian de región. Cada
  región elegida sale como el evento `gobserva:region`, que escribe la consola. Piezas:
  - `mapa/generar_mapa.py` → `publico/mapa-peru.js`: la malla (58 x 85 celdas, 2,257 píxeles) de los límites de
    `frontend/public/peru-departments.json`, con `geo` (la esquina noroeste y el tamaño de la celda en grados) para las
    coordenadas. El Callao, más chico que una celda, se queda con 3.
  - Al cambiar `portada.js`, `animaciones.js`, `interfaz.js` o la malla, subir `VERSION_JS` en `worker.js`: Cloudflare
    guarda los scripts un día en el navegador.
  - Las cifras: el Worker las pide a la API de Vigía (`VIGIA_API_URL` en `wrangler.jsonc`; la API lo atiende porque
    `gobserva.cloud` está en `WORKERS_PROPIOS`), son unos 40 pedidos (el plan gratis de Workers admite 50 por visita) y
    quedan en la caché de Cloudflare (`CACHE_REGIONES`, hoy `regiones-v2`: cambiarle el nombre si cambia la forma de los
    datos), que se renueva cada 6 horas en segundo plano. Si la API no responde, la página sale igual, con el mapa y un
    enlace a Vigía.
  - Los rótulos siguen `docs/CORRUPCION.md`: la Procuraduría y la Contraloría nunca se suman.
- **La marca** (logo con la lupa en la «o», eslogan, colores y cómo usarlos): [`marca/README.md`](marca/README.md). El
  logo y la ilustración van en línea desde `marca.js`; favicon, `logo.png`, `og.png` y el logo para descargar están en
  `publico/`, que Cloudflare sirve antes de llegar al Worker (`assets` en `wrangler.jsonc`, encabezados en
  `publico/_headers`). Todo eso lo escribe `marca/generar_marca.py`: no editarlo a mano (`--og` rehace sólo `og.png`, que
  dibuja el mapa en la pantalla del radar, como la portada).
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
volver a aplicar lo de la zona: `CLOUDFLARE_API_TOKEN=… GOBSERVA_PRUEBA=… python proteger_zona.py estado` (o `todo`).

## Plan Business (desde 2026-11-06)

`proteger_zona.py` usa lo que trae el plan (cada parte se aplica sola: `python proteger_zona.py <parte>`):

| Parte | Qué |
|-------|-----|
| `waf` | 11 reglas propias (tope 100, con regex). Bloquea métodos raros y escáneres (lista + regex). Saltos: buscadores verificados, nuestros Workers (`cf.worker.upstream_zone`), MCP y medios (programas: sin SBFM, BIC ni nivel de seguridad), Anthropic en el MCP (sin límite por IP; el MCP cuenta por cuenta), vistas previas, IndexNow y scripts propios, y navegadores de prueba con la cabecera secreta `x-gobserva-prueba`. Siguen las de entrenamiento de IA, scripts y redes de nubes |
| `bots` | Super Bot Fight Mode: «seguro automatizado» → desafío; «probablemente automatizado» libre (también marca personas y un desafío rompe los `fetch` del navegador); sin detecciones por JS (CSP con hash en la portada) |
| `administradas` | Reglas administradas de Cloudflare (todas) + OWASP nivel 1, umbral 60, desafío, sólo GET/HEAD de los sitios (el texto libre del MCP, del chat y de los archivos subidos daría falsos positivos) |
| `limite` | 5 reglas, por visitante con NAT (`cf.unique_visitor_id`): 30 404 por minuto → bloqueo 1 h; OAuth del MCP y POST de la web, 30 por minuto; ráfaga de 150 en 10 s; 600 páginas o `/v1` en 10 min → desafío; MCP fuera de Anthropic, 300 por minuto. Calibradas con 72 h de tráfico (lo máximo de una persona: ~210 páginas en 10 min) |
| `paginas` | Páginas propias de bloqueo, límite, desafío, modo ataque y errores 5xx/1xxx (`paginas_error.py` → `errores/*.html` → R2 `vigia-peru-reportes/errores/`, servidas por medios.gobserva.cloud). Cloudflare guarda una copia: tras cambiarlas, subirlas, purgar y volver a correr `paginas` |
| `ajustes`, `cache` | HTTP/3, 0-RTT, Early Hints, Brotli, Polish sin pérdida + WebP, Smart Tiered Cache y un día en el borde para medios (R2) |
| `escudo` | Page Shield: scripts, conexiones y cookies de cada página; aviso por correo si aparece un dominio nuevo |
| `salud` | 8 chequeos cada minuto desde Sudamérica y el este de EE. UU. (los 5 sitios por `/robots.txt`, el MCP, medios y la API con su base por `/health`) y avisos por correo: un sitio cae o vuelve, ataque DDoS HTTP, pico de eventos del WAF |
| `sala` | Sala de espera de vigia.gobserva.cloud (600 nuevos por minuto, 2 000 activos), creada APAGADA. Prender sólo ante una avalancha anunciada: `proteger_zona.py sala on`; en Business no hay respuestas JSON en la cola |

Probar PROD con un navegador sin cabeza: mandar `x-gobserva-prueba` sólo a los dominios de gobserva.cloud (en
Playwright con `context.route`, no con `extra_http_headers`, que la manda también a Google Fonts). Sin ella, Super Bot
Fight Mode responde «Just a moment…».
