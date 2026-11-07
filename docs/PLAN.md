# Plan: la app de Gobserva Licitaciones (inspirada en LicitaLAB)

Fecha: 2026-11-07. Estado: etapa 2 en producción. Bandeja en vivo, detalle, onboarding, seguimiento en la cuenta,
notificaciones y alertas desde la bandeja (ver «Estado de la etapa 2»).

## Qué se construye

Una app para proveedores del Estado peruano con estas piezas. LicitaLAB es la referencia de qué hace cada una; la marca,
los textos y el aspecto son de Gobserva.
- Bandeja de oportunidades con búsqueda y búsquedas guardadas.
- Detalle de cada proceso.
- Seguimiento de negocios.
- Calendario de plazos.
- Reportes de compradores, competidores, productos, precios y marcas.
- Asistente de IA sobre las bases.
- Notificaciones.
- Equipo con roles.

**Nombre.** El usuario pidió «Licita Lab». No se usa: es la marca de un competidor real (LicitaLAB), y publicarla en
nuestro dominio sería suplantarlo. La app es **Gobserva Licitaciones** y hereda el logo, los colores y la tipografía de
la portada.

## Stack detectado

- Next.js 14.2 (App Router), React 18 y TypeScript estricto.
- Tailwind con tokens en `app/globals.css`: colores RGB por variable, modo día y noche con `html[data-modo]`.
- lucide-react como único set de íconos, SWR y Firebase Auth (cuentas de Gobserva).
- API propia en Cloudflare Workers (`backend/api`, Hono y Postgres en RDS).
- Despliegue de la web por GitLab CI (`deploy:web:prod`) a Cloudflare.
- Sin prettier. La guardia de estilo es `npm run auditar:estilo`.
- Las pruebas usan `node --test`: Node 22.18 corre TypeScript sin herramientas extra.

## Rutas

En `licitaciones.gobserva.cloud`; en DEV llevan delante `/licitaciones`.

| Ruta | Qué es | Layout |
|---|---|---|
| `/` | Portada (relato, planes, MCP) | Sitio: cabecera y pie de visitantes |
| `/login` | Redirige a `/entrar` y conserva `next` | |
| `/entrar` | Entrar o crear cuenta | Sitio |
| `/app` | Redirige a `/app/bandeja` | App |
| `/app/bienvenida` | Onboarding en 4 pasos: qué vendes, dónde, qué contratos, cómo avisarte | Pantalla completa |
| `/app/bandeja` | Bandeja: búsqueda, filtros, orden, paginación, búsquedas guardadas, alerta y Excel, todo en la URL | App (`MarcoApp`) |
| `/app/oportunidad/[id]` | Detalle en pestañas (`?tab=`) | App |
| `/app/notificaciones` | Centro de notificaciones (`?ver=vence` o `?ver=alertas`) | App |
| `/cuenta?tab=…` | Inicio, Para ti, Seguimiento (tablero), Calendario, Mis alertas, Plan y pagos, Perfil | App |

Las pestañas del detalle son resumen, items, documentos, cronograma, analisis, notas, historial y postulacion.
`?tab=comentarios`, de los enlaces viejos, abre «notas».

Con la sesión abierta, `/oportunidades` y `/oportunidad/:ocid` llevan a la bandeja y al detalle de la app, con los
filtros traducidos (middleware). Para los visitantes siguen siendo las páginas públicas.

Con la sesión abierta, todo `/app/*` usa el marco de la app (`components/gobserva/app/MarcoApp.tsx`): barra lateral,
cabecera con buscador y pie. La cabecera de la portada nunca aparece ahí. Sin sesión, `/app/*` lleva a
`/entrar?next=…`.

## Contrato de datos

La UI nunca llama a la API directamente: pasa por `lib/licitaciones-app/fuente.ts`.

```ts
interface FuenteLicitaciones {
  nombre: "demo" | "gobserva";
  tomada: string | null; // fecha de la muestra (demo) o null (en vivo)
  buscar(f: FiltrosBandeja): Promise<ResultadoBandeja>; // filtra, ordena, pagina y cuenta facetas
  oportunidad(id: string): Promise<DetalleOportunidad | null>;
}
```

### Filtros

Viven en la URL: los parsea y serializa `lib/licitaciones-app/filtros.ts`.

| Parámetro | Valores | Por defecto |
|---|---|---|
| `q` | Texto: objeto, entidad, código o RUC | |
| `tipo` | Lista: bienes, servicios, obras, consultoria | |
| `region` | Lista de regiones | |
| `proc` | Procedimiento | |
| `min`, `max` | Valor referencial en soles | |
| `pub` | Publicado en los últimos 7, 15 o 30 días | 30 |
| `cons` | Consultas: abiertas, 3d, 7d o vencidas | |
| `senal` | `1`: sólo con señales de riesgo | |
| `orden` | recientes, valor_desc, valor_asc, vence o entidad | recientes |
| `pag` | Página | 1 |
| `tam` | 10, 20 o 50 por página | 20 |

### Tipos principales

Están en `lib/licitaciones-app/tipos.ts`.
- **`Oportunidad`.** Fila de la bandeja: id (OCID), código, objeto, tipo, procedimiento, valor, publicada,
  consultasHasta, entidad (RUC y nombre), región, número de ítems y señales.
- **`DetalleOportunidad`.** La fila más:
  - descripción e ítems (CUBSO, cantidad, unidad, valor);
  - documentos (enlaces oficiales) y cronograma;
  - el comprador (procesos, adjudicado sobre el referencial, postores, único postor, principales proveedores);
  - procesos parecidos ya adjudicados (precio unitario) y precios de referencia (P25, mediana y P75 por CUBSO);
  - enlaces al SEACE.
- **`Senal`.** Clave, nivel (alta, media o info), título y evidencia con cifras. Se calcula en
  `lib/licitaciones-app/senales.ts` a partir de datos reales:
  - **único postor:** el comprador adjudicó con un solo postor en X de Y procesos;
  - **concentración:** un proveedor se lleva Z % de lo adjudicado;
  - **adjudica cerca del tope:** lo adjudicado sobre el referencial es al menos 98 %;
  - **sin valor publicado;**
  - **ventana de consultas corta.**

  Son señales, nunca acusaciones.

### Adaptadores

- **`demo` (esta etapa).** `lib/licitaciones-app/fuente-demo.ts` filtra, ordena, pagina y cuenta facetas de verdad sobre
  una muestra real. La muestra salió de nuestra API el 7 nov 2026: 300 convocatorias abiertas y sus fichas, en
  `lib/licitaciones-app/datos/muestra.json`. Las personas naturales (RUC 10) salen sin RUC ni nombre.
- **`gobserva` (etapa siguiente).** Se elige con `LICITACIONES_FUENTE`. Usa `GET /licitaciones/oportunidades` y
  `GET /licitaciones/oportunidad/:ocid`, que ya existen. Para tener la bandeja completa, la API debe aceptar:
  - `tipo` y `region` como listas;
  - `proc`, `cons`, `senal` y los órdenes `valor_asc` y `entidad`;
  - páginas más allá de la 50.

  La UI no cambia.
- **Estado del usuario en el cliente.** Búsquedas guardadas, seguimiento, comentarios, checklist de postulación e
  historial: `lib/licitaciones-app/almacen.ts`. En demo, localStorage con try/catch. Después irá a la API de cuentas,
  que ya existe para guardados, líneas y alertas.

Lo que todavía no tenemos (catálogos electrónicos, marcas, precios unitarios de catálogo, equipo y roles, asistente) se
construye con datos de demostración y lleva el rótulo **Demostración**.

## Biblioteca

| Dónde | Qué |
|---|---|
| `app/globals.css` + `tailwind.config.ts` | Tokens: `lienzo`, `caja`, `shadow-caja`, la escala tipográfica y el acento `granate`. El color se reserva para urgencia y estado |
| `components/gobserva/app/` | Marco (`MarcoApp`, `NavApp`) y `Caja` (`Pagina`, `CabeceraPagina`, `Caja`, `VacioCaja`) |
| `components/licitaciones-app/ui/` | `TablaDatos`, `Paginacion`, `Insignia` (estado, vencimiento, tipo y señal), `Estados` (vacío, error y carga) |
| `components/licitaciones-app/bandeja/` | Barra de filtros, chips activos, búsquedas guardadas y filas |
| `components/licitaciones-app/detalle/` | Cabecera, pestañas y un archivo por pestaña |
| `lib/licitaciones-app/formato.ts` | Soles, números y fechas en es-PE, a la hora de Lima, y el vencimiento («vence hoy», «en 3 días») |
| `lib/licitaciones-app/useListaUrl.ts` | Lee y escribe los filtros en la URL. Cualquier cambio que no sea de página vuelve a la página 1 y el botón Atrás funciona. Usa transiciones: los resultados se atenúan y quedan con `aria-busy` mientras cargan |

## Supuestos

1. Sólo usamos datos propios de Gobserva, por nuestra API y con su token de build. No raspamos sitios de terceros.
2. La fecha de presentación de ofertas no viene en el OCDS. El cronograma muestra lo que sí viene (convocatoria y
   consultas) y enlaza al cronograma oficial del SEACE. No inventamos fechas.
3. Las señales salen de cifras reales del comprador y se redactan como señales.
4. La bandeja de esta etapa es una vista previa con la muestra del 7 nov 2026 y lo dice arriba. El resto de la app
   sigue con datos en vivo.
5. Las capturas de verificación se toman a 375, 768, 1280 y 1536 px, de día y de noche.

## Estado de la etapa 1 (2026-11-07)

Hecho y verificado:
- La bandeja: búsqueda con pausa, 7 filtros con conteos, chips, orden por select y por columna, 10/20/50 por página,
  paginación, búsquedas guardadas, estrella para seguir, resumen con enlaces a filtros y estados de carga, vacío y error.
- El detalle con sus 8 pestañas, cada una con estado vacío: comentarios validados, checklist, etapa, .ics del
  cronograma, copiar enlace y «Bandeja» que vuelve con los mismos filtros.
- Middleware: sin sesión, `/app/*` responde 307 a `/entrar?next=`. `/login` redirige a `/entrar`.
- Umbrales de las señales medidos sobre la muestra: 82 de 300 procesos con una señal de riesgo.
- Pruebas: 32 en `npm test` (filtros, fechas de Lima, señales, adaptador, almacén, paginación e .ics). `tsc`,
  `auditar:estilo` y `next build` en verde.
- Playwright con una cuenta desechable a 375, 768, 1280 y 1536, más 1280 de noche: sin desbordes ni errores de JS, y
  13 comprobaciones de uso. Entre ellas, que Atrás deshace un filtro y que la página 2 queda en la URL.

**Errores que encontraron las pruebas y se corrigieron:**
- Una fecha sin hora del OECE se corría un día.
- Un monto inválido se leía como 0.
- La casilla de un filtro no cambiaba hasta que respondía el servidor; ahora es optimista.
- El texto `sr-only` dentro de la tabla ensanchaba la página a 768 px.
- Las herramientas de la cabecera se salían a 375 px.

**Etapa 2,** en este orden: el adaptador en vivo (con los filtros nuevos en la API), Panel, Seguimiento (tablero con
responsables y etiquetas), Calendario, Reportes (compradores, competidores, productos, precios y marcas), Asistente
(simulado), Notificaciones, Equipo y roles, y Configuración. Todo con las mismas piezas.

## Estado de la etapa 2 (2026-11-07, noche)

En producción y probado de punta a punta con usuarios desechables:
- **Bandeja en vivo.** Adaptador `gobserva` contra `GET /licitaciones/bandeja`, una API nueva en
  `backend/api/src/lib/bandeja.ts`. Recibe:
  - varios tipos y regiones;
  - procedimiento y plazo de consultas;
  - cinco órdenes;
  - páginas sin tope;
  - facetas, y el comprador de cada fila para las señales.

  La muestra queda para desarrollo (`LICITACIONES_FUENTE`). El filtro «con señales» no se muestra en vivo porque las
  señales se calculan sólo para la página que se ve.
- **Onboarding** (`/app/bienvenida`). Cuatro pasos, con la validación de cada paso y palabras sugeridas. Cada palabra
  muestra cuántas oportunidades abiertas trae, en vivo. Al terminar crea la línea («Para ti»), la alerta y la búsqueda
  «Mi empresa». Quien crea su cuenta llega ahí. Sin perfil, la bandeja y el Inicio lo ofrecen.
- **Seguimiento coherente.** La estrella, la etapa y las notas escriben en la cuenta (`useSeguimiento`, la API de
  guardados): lo seguido aparece en el tablero, el calendario y las notificaciones. El navegador guarda sólo las
  búsquedas guardadas y el checklist, y la UI lo dice.
- **Notificaciones.** Campana en la cabecera y `/app/notificaciones`. Las fuentes son reales:
  - los plazos de lo seguido que vencen en 3 días, urgentes si vencen hoy o mañana;
  - lo nuevo de las alertas.

  Cada aviso lleva a donde actuar. Lo leído se guarda en el navegador. Los avisos breves confirman cada acción.
- **Alertas desde la bandeja.** «Crear alerta» guarda los filtros de la vista (`bandeja: 1`) y la API las corre como la
  bandeja (`filtrosBandejaAlerta` y `filasBandeja`). «Excel» descarga la misma búsqueda (con plan de pago).
- **Marco.** Al entrar se hace una carga entera con la marca de sesión puesta: así nunca queda el marco de visitantes
  alrededor de la app. La app no tiene pie. Bajo 400 px, el modo día y noche va en «Más».

**Lo que falta, o no se hace a propósito:**
- **Equipo y roles** y el **asistente de IA sobre las bases** no se construyeron. Sin cuentas compartidas en la base,
  serían pantallas simuladas.
- Las **búsquedas guardadas** y el **checklist** viven en el navegador. Llevarlos a la cuenta necesita una tabla nueva
  (migración) y su API.
- **Reportes de marcas y catálogo:** no tenemos esos datos. Mercado (compradores, ganadores y precios por palabra) es
  lo que hay en vivo.

## Verificación de cada etapa

- `npx tsc --noEmit -p .`
- `npm test` (lógica de filtros, orden, paginación, facetas, señales y formatos)
- `npm run auditar:estilo`
- `next build`
- Capturas con Playwright revisadas una por una, corrigiendo hasta que no quede nada mal.
