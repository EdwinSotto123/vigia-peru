# Vigía: el sitio

El sitio de Vigía y de los productos de Gobserva. Next.js 14 (App Router), React 18, TypeScript estricto y Tailwind.
Corre en Cloudflare Workers con OpenNext: es el Worker `vigia-web`, con el dominio público `vigia.gobserva.cloud`.

## Qué sirve

- **Vigía**: la portada, la app (`/app`), las fichas de contratos, entidades y empresas, y el panel (`/admin`).
- **Los productos de Gobserva** (empleo, licitaciones, obras, salud y car), como rutas del mismo sitio. Cada uno tiene
  su subdominio (`salud.gobserva.cloud`, `car.gobserva.cloud`…): `middleware.ts` lo reescribe a su ruta
  (`app/(gobserva)/salud`…) según `lib/gobserva.ts`.
- La portada de `gobserva.cloud` no vive aquí: es el Worker `gobserva-redirect`
  (`infrastructure/deploy/cloudflare/gobserva-redirect/`).

Los datos salen de la API (`backend/api`, Hono en Workers). El servidor de la web le pide directo; el navegador le pide
por `/v1` del mismo dominio y `worker-prod.js` lo reenvía, porque la API sólo atiende a nuestros Workers.

## Cómo correrlo

```bash
cd frontend
npm install
npx next dev -p 3100
```

Abre <http://localhost:3100>. Sin más, las páginas salen sin datos: la API de producción rechaza a `next dev`. Hay dos
formas de tener datos.

**Con una API local.** Levanta `backend/api` (`npm run dev`, puerto 8080, con su `.env`) y apunta la web a ella:

```bash
VIGIA_API_URL=http://localhost:8080 npx next dev -p 3100
```

**Con los datos de producción, sólo lectura.** Hace falta el encabezado del build: `scripts/fetch-build.cjs` manda
`x-vigia-build` con `VIGIA_BUILD_TOKEN` a `VIGIA_API_URL`, y la API deja leer.

```bash
VIGIA_BUILD_TOKEN=<el secreto> \
VIGIA_API_URL=https://vigia-api.vigiaperu.workers.dev \
NODE_OPTIONS="--require ./scripts/fetch-build.cjs" \
npx next dev -p 3100
```

`VIGIA_BUILD_TOKEN` es secreto: es una variable enmascarada del CI de GitLab. No la escribas en un archivo del repo ni
en un comando que quede guardado. Sólo vale para lo que pide el servidor: lo que pide el navegador (`/v1`) va sin el
encabezado, así que las listas que se cargan en el navegador salen vacías.

En `next dev` las subidas de archivos no andan: en Workers van a R2 por binding (`lib/gcs.ts`), y fuera de Workers
queda el camino viejo de Cloud Storage, que ya no responde.

## Pruebas

```bash
npx tsc --noEmit -p .
npm test                 # node --test (Node 22.18 corre TypeScript)
npm run auditar:estilo   # la guardia de estilo: node scripts/auditar-estilo.mjs
npm run auditar:limite   # un Server Component que usa una función de un módulo «use client»
```

GitLab corre las cuatro en el job `verificar:web` con cada push a `main` o `dev` que toque `frontend/`.

## Desplegar

- **Producción**: push a `main` en GitLab y ▶ en el job `deploy:web:prod`, que es manual. Arma el Worker con
  `npm run cf:build` (con `fetch-build.cjs`, para prerenderizar con datos) y lo sube con `opennextjs-cloudflare deploy`.
  Ese job fija `NEXT_PUBLIC_SITE_URL=https://vigia.gobserva.cloud`.
- **DEV**: un push a `dev` despliega solo `vigia-web-dev` (`deploy:web:dev`). Para probar la copia de trabajo sin
  commitear: `bash infrastructure/deploy/dev.sh web` (`docs/DEV.md`).
- Bindings, variables y secretos del Worker: [`CLOUDFLARE.md`](CLOUDFLARE.md).

## Estructura

```
frontend/
├── app/
│   ├── (public)/        portada, ingreso, aliados, impacto y auditoría en vivo
│   ├── (dashboard)/     la app de Vigía (/app), fichas, metodología, preguntas
│   ├── (gobserva)/      los productos: empleo, licitaciones, obras, salud y car
│   ├── admin/           el panel, con sesión
│   └── api/             rutas del servidor: agentes, subidas, panel y MEF
├── components/          piezas por tema; las comunes, en components/KIT.md
├── lib/                 lógica, cliente de la API, cuentas y datos de cada producto
├── middleware.ts        subdominios de Gobserva y protección de /admin
├── worker-prod.js       entrada del Worker en producción: dominio, límites y /v1
├── worker-dev.js        entrada en DEV: usuario y clave, noindex y franja DEV
├── worker-comun.js      lo que comparten las dos entradas
├── wrangler.jsonc       el Worker vigia-web y su entorno dev
└── scripts/             fetch-build.cjs, guardias de estilo y auditoría de la UI
```

Cuentas: Vigía usa Firebase Auth (`lib/firebase.ts`); cada app de Gobserva tiene su grupo de AWS Cognito
(`lib/cognito.ts`, `infrastructure/aws/cognito_gobserva.py`).

Diseño: `DESIGN_SYSTEM.md`, `DIRECCION.md`, `PRODUCT.md` y `components/KIT.md`.

## La app de Gobserva Licitaciones

La app para proveedores (licitaciones.gobserva.cloud con sesión) está documentada en `docs/PLAN.md`: rutas, contrato de
datos, decisiones y estado. Lo esencial:

- `lib/licitaciones-app/`: la lógica pura, probada con `npm test`:
  - filtros en la URL, fechas de Lima y señales;
  - adaptadores de datos (`fuente-gobserva` en vivo y `fuente-demo` con la muestra);
  - onboarding, notificaciones e .ics.
- `components/licitaciones-app/`: la bandeja, el detalle, los menores, el mercado, el onboarding, las notificaciones y
  el seguimiento.
- `components/gobserva/ui/`: las piezas comunes (`TablaDatos`, `Paginacion`, `Insignia`, `Estados`, `Desplegable` y
  `Avisos`).
- `components/gobserva/app/`: el marco (`MarcoApp`, `NavApp`) y las piezas de página (`Caja`, `CabeceraPagina`).
- En desarrollo la bandeja usa la muestra (`LICITACIONES_FUENTE=demo`, por defecto fuera de producción). Para probar con
  datos en vivo, `LICITACIONES_FUENTE=gobserva` y una API alcanzable.

Antes de publicar: las pruebas de arriba y `npx next build`.
