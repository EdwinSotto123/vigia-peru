# Plan: la app de Gobserva Licitaciones (inspirada en LicitaLAB)

Fecha: 2026-11-07. Estado: etapa 2 en producción. Bandeja en vivo, detalle, onboarding como entrevista en un chat,
seguimiento en la cuenta, notificaciones y alertas desde la bandeja (ver «Estado de la etapa 2»). La misma app existe
también para Gobserva Empleo (ver «La app de Gobserva Empleo»).

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
| `/app/bienvenida` | Onboarding como entrevista en un chat: seis preguntas que se tocan (rubro, palabras, tipos, regiones, tamaño, avisos), cada una se puede cambiar, y el perfil al lado con cuántas calzan hoy | Pantalla completa |
| `/app/bandeja` | Bandeja: búsqueda, filtros, orden, paginación, búsquedas guardadas, alerta y Excel, todo en la URL | App (`MarcoApp`) |
| `/app/oportunidad/[id]` | Detalle en pestañas (`?tab=`) | App |
| `/app/notificaciones` | Centro de notificaciones (`?ver=vence` o `?ver=alertas`) | App |
| `/app/menores` | Contratos menores abiertos: buscar, tipo y región (varios), cuándo cierran, orden y página en la URL | App |
| `/app/menor/[id]` | Un contrato menor: seguir con su etapa, requerimiento, cotizar en el SEACE, qué se compra, precios pagados antes, cómo cotizar y el comprador (`?volver=` conserva los filtros) | App |
| `/app/mercado` | Un rubro en 12 meses: cifras, mes a mes, regiones, quién compra, quién gana y las últimas adjudicaciones | App |
| `/cuenta?tab=…` | Inicio, Para ti, Seguimiento (tablero), Calendario, Mis alertas, Plan y pagos, Perfil | App |

Las pestañas del detalle son resumen, items, documentos, cronograma, analisis, asistente, notas, historial y postulacion.
`?tab=comentarios`, de los enlaces viejos, abre «notas».

Con la sesión abierta, `/oportunidades`, `/oportunidad/:ocid`, `/menores`, `/menor/:id` y `/mercado` llevan a sus
páginas de la app, con los filtros traducidos (middleware). Para los visitantes siguen siendo las páginas públicas.

Con la sesión abierta, todo `/app/*` usa el marco de la app (`components/gobserva/app/MarcoApp.tsx`): barra lateral,
cabecera con buscador, sin pie. La cabecera y el pie de la portada nunca aparecen ahí. Sin sesión, `/app/*` lleva a
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
- **Onboarding como entrevista** (`/app/bienvenida`, `components/licitaciones-app/onboarding/Entrevista.tsx`). El
  asistente pregunta de a una, con «escribiendo…» entre preguntas: rubro (12 rubros o texto libre), palabras clave (se
  tocan, se suman escribiendo, y cada una dice cuántas hay abiertas hoy), tipos, regiones, tamaño y avisos. Cada
  respuesta tiene «Cambiar» y vuelve al cierre. Al lado (desde lg) el perfil se arma con cuántas convocatorias calzan; en
  el celular, ese número va junto al avance. El cierre muestra tres que calzan, deja nombrar el perfil y crea la línea
  («Para ti»), la alerta y la búsqueda «Mi empresa». Los conteos salen de `GET /licitaciones/bandeja/calce` (cada
  palabra, el total y el vistazo en UNA consulta: una por palabra hacía saltar el límite por IP). Las piezas del chat son
  de todos los productos: `components/gobserva/app/chat/Chat.tsx`. Quien crea su cuenta llega ahí.
- **Seguimiento coherente.** La estrella (licitaciones y contratos menores), la etapa y las notas escriben en la cuenta
  (`useSeguimiento`, la API de guardados): lo seguido aparece en el tablero, el calendario y las notificaciones.
- **Búsquedas guardadas y checklist en la cuenta** (migración 266: `gobserva_busquedas`, `gobserva_checklist`; rutas
  `/busquedas` y `/checklist`). Ya no queda nada en el navegador salvo qué notificaciones leíste. La baja de la cuenta
  borra también sus líneas, búsquedas y checklist. La migración está aplicada en PROD y en DEV.
- **Asistente del proceso** (pestaña «Asistente», `POST /gobserva/cuenta/asistente`, `lib/asistente.ts`). Responde
  en tus palabras con los datos de la ficha: ítems, plazos (comparados con la fecha de hoy), el comprador, precios de
  compras parecidas y señales. Usa Haiku 5.5 por vigia-llm. Lo que está sólo en las bases (requisitos, experiencia,
  ofertas) lo dice y manda al SEACE. No lee el PDF: de las 5.150 convocatorias abiertas, ninguna tiene el texto de sus
  documentos indexado. Indexar las bases de lo abierto es el paso siguiente para que responda sobre requisitos.
- **Contratos menores y Mercado** con la misma estructura que la bandeja. La lista en la URL es una sola pieza
  (`crearListaUrl`), y `BuscadorTexto` y `FiltroOpciones` son comunes. La API de menores acepta varios tipos y
  regiones.
- **Notificaciones.** Campana en la cabecera y `/app/notificaciones`. Las fuentes son reales:
  - los plazos de lo seguido que vencen en 3 días, urgentes si vencen hoy o mañana;
  - lo nuevo de las alertas.

  Cada aviso lleva a donde actuar. Lo leído se guarda en el navegador. Los avisos breves confirman cada acción.
- **Alertas desde la bandeja.** «Crear alerta» guarda los filtros de la vista (`bandeja: 1`) y la API las corre como la
  bandeja (`filtrosBandejaAlerta` y `filasBandeja`). «Excel» descarga la misma búsqueda (con plan de pago).
- **Ficha del contrato menor en la app** (`/app/menor/[id]`), con la misma estructura que el detalle de un proceso:
  cabecera con acciones, cuatro cifras (cierre con cuánto falta, consultas, publicación, ítems) y cajas. En el
  seguimiento, el fin de consultas que cae en el mismo minuto que el cierre queda sólo como cierre.
- **Plan y pagos** en cajas: tu plan con su uso, tus suscripciones (cancelar la renovación), la tabla que compara los
  planes con los límites del catálogo y «Tu plan» marcado, y tus pagos con su recibo. Mis alertas, los avisos del
  dispositivo y Perfil usan las mismas cajas.
- **Tablero.** Las cinco etapas entran a la vista desde 1280 px; en el celular y la tableta las columnas se deslizan.
  La tabla de menores usa anchos fijos (`TablaDatos fija`) para que «Cierra» nunca quede escondida.
- **Marco.** Al entrar se hace una carga entera con la marca de sesión puesta: así nunca queda el marco de visitantes
  alrededor de la app. La app no tiene pie. Bajo 400 px, el modo día y noche va en «Más».

**Lo que falta, o no se hace a propósito:**
- **Equipo y roles** no se construyeron: hacen falta cuentas compartidas en la base (equipos, miembros, invitaciones
  y un seguimiento por equipo). Sin eso serían pantallas simuladas.
- **El asistente no lee las bases en PDF** de lo abierto. Hay que bajar e indexar sus documentos (documentos_texto y el
  RAG de la migración 258). Hoy responde con la ficha y lo dice.
- **Reportes de marcas y catálogo:** no tenemos esos datos. Mercado (compradores, ganadores y precios por palabra) es
  lo que hay en vivo.

## La app de Gobserva Empleo (2026-11-07)

`empleo.gobserva.cloud`, con el mismo marco (`MarcoApp`, `NavApp` con su barra: Inicio, Para ti, Plazas, Licitaciones,
Postulaciones, Calendario, Notificaciones, Mis alertas). El producto de la app va en el contexto (`useProductoApp`): el
seguimiento, la campana y las notificaciones leen de qué producto son.

| Ruta | Qué es |
|---|---|
| `/app/bienvenida` | La entrevista de Empleo (`components/empleo-app/Entrevista.tsx`): qué trabajo buscas (12 áreas o texto), palabras, estudios, experiencia, dónde, sueldo mínimo y avisos. Guarda la búsqueda «Mi perfil» y la alerta |
| `/app/para-ti` | Las plazas abiertas que calzan con el perfil (`GET /empleo/calce`): filtro por palabra, orden y página en la URL; cada una con su estrella |
| `/app/plazas` | La lista con los filtros de la portada (texto, región, estudios, sueldo, experiencia, cierre), chips que se quitan, orden, alerta y Excel |
| `/app/plaza/[aviso]` | La ficha: guardar con su etapa, postular, SERVIR, cuatro cifras, «¿Cumples?», lo que pagan otras, lo que nadie te dice, cómo postular (`?volver=` conserva los filtros) |
| `/app/notificaciones` | Las plazas guardadas que cierran pronto y lo nuevo de tus alertas |
| `/cuenta?tab=…` | Inicio (`InicioEmpleo`), Postulaciones (el tablero: guardada, postulé, entrevista, me eligieron, descartada), Calendario (.ics), Mis alertas, Plan y pagos, Perfil |

Con la sesión abierta, `/plazas` y `/plaza/:aviso` llevan a la app (los filtros pasan tal cual) y `/para-ti` a
`/app/para-ti`. Quien crea su cuenta en Empleo llega a la entrevista.

API: `GET /empleo/calce` (palabras del perfil, sugeridas que sólo se cuentan, región, estudios, sueldo y experiencia;
total, conteo por palabra y la página de plazas) y `GET /gobserva/cuenta/seguimiento?producto=empleo` (las plazas
guardadas con su sueldo, su región y los plazos «Abre la postulación» y «Cierra la postulación», el último día a las
23:59 de Lima). Sin migraciones: el perfil es una búsqueda guardada (migración 266) y las etapas usan los estados que
los guardados ya tenían.

## Cuentas separadas por app (2026-11-07, AWS Cognito)

Antes, Empleo, Licitaciones y Obras compartían una cuenta (el Firebase de Vigía): el mismo correo y contraseña servían
en las tres, el perfil era uno solo y «Borrar mi cuenta» en una borraba las tres. Ahora cada app tiene su propio grupo
de usuarios en Cognito (`infrastructure/aws/cognito_gobserva.py`, us-east-2): **Empleo** y **Licitaciones** (Obras usa la
de Licitaciones: es una sola suscripción). Una cuenta de una app no entra a la otra; el mismo correo puede tener una
cuenta en cada una, con otra contraseña. Vigía y su MCP siguen con Firebase.

- **Web:** `lib/cognito.ts` habla directo con Cognito (sin SDK) y guarda la sesión de cada app aparte;
  `components/auth/AuthProvider.tsx` la usa en los sitios de las apps (`lib/apps-gobserva.ts → appDelSitio`). Crear la
  cuenta pide confirmar el correo con un código de 6 dígitos; «¿La olvidaste?» manda otro código; la contraseña se
  cambia en Perfil (pide la de ahora); «Borrar esta cuenta» borra sólo la de esa app. Dentro de `/app` sin sesión, a
  entrar con la vuelta.
- **API:** `lib/cognito.ts` verifica el token (firma con el JWKS del grupo, emisor, cliente, `token_use: id`) y
  `lib/cuentasApps.ts` deja a cada cuenta sólo en su app (403 `otra_app`: el producto del pedido, por `?producto=`, el
  cuerpo o la ruta, tiene que ser el de la cuenta). `COGNITO_GOBSERVA` en wrangler.jsonc; `GOBSERVA_CUENTAS_VIGIA`
  dice qué puede una cuenta de Firebase en `/gobserva/cuenta` (`planes`: sólo leer sus planes, para el MCP).
- **Correos:** los manda Cognito (COGNITO_DEFAULT, hasta 50 al día) mientras SES siga en sandbox. Entrar con Google no
  está en las apps: hace falta un cliente de Google para Cognito.
- **Cuentas de antes:** la única activa se pasó al grupo de su app con sus datos (mismo correo, uid nuevo); elige su
  contraseña con «¿La olvidaste?».

## Verificación de cada etapa

- `npx tsc --noEmit -p .`
- `npm test` (lógica de filtros, orden, paginación, facetas, señales y formatos)
- `npm run auditar:estilo`
- `next build`
- Capturas con Playwright revisadas una por una, corrigiendo hasta que no quede nada mal.
