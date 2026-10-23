# Plan de mejora visual y de mantenibilidad del frontend

Pedido del usuario (2026-10-22): «mejoremos la visual: mejores colores, jerarquía… Primero verificar del código qué
malas prácticas tiene y cómo ordenarlo mejor; después verificar la visualización con e2e y capturas, armar un plan y
validar que las correcciones que te di no se repitan (" · ", sólo texto plano, textos libres sobre vacío…)».

Dos fuentes:

- **El recorrido visual** (`frontend/e2e/visual/recorrer.py`, con agent-browser de Vercel Labs): 21 páginas clave ×
  escritorio y celular × día y noche = 84 capturas de producción, con chequeos automáticos en cada una
  (`frontend/e2e/visual/chequeos.js`).
- **La auditoría del código** de `app/`, `components/` y `lib/` (559 archivos).

## 1. Lo que encontró el recorrido (producción, 2026-10-22)

| Regla | Resultado | Dónde falla |
|---|---|---|
| Sin «·» ni «•» como separador | **0 de 84** fallan | — (sólo quedan en `/admin`, fuera del recorrido) |
| Sin desborde horizontal | **0 de 84** | — |
| Ruta de navegación (Migas) | **24 de 84** sin ella | contratos, señales, denuncias, financiar, aliados, auditoría |
| Lista de 10+ filas con buscador | 12 de 84 sin él | denuncias (25), aliados «Últimos aportes» (16), portada (12 y 16) |
| Sin texto suelto fuera de tarjeta | 16 de 84 | contrato (nota de privacidad), partidos, auditoría, portada |
| Sin color fijo en estilos | 16 de 84 | mapa (leyenda), contratos, partidos (barras), portada |
| Contraste ≥ 4,5:1 | 42 de 84 bajo | pistas de la barra lateral de día (4,4:1), portada (1,8:1), aliados |
| Errores de consola / controles sin nombre | 0 de 84 | — |
| **Tamaños de letra** | **47 distintos** | casi todo entre 12 y 14 px |

Lo que se ve en las capturas: los títulos de sección son casi del tamaño del texto (15 px en negrita, o etiquetas de 11
px en mayúscula como «QUÉ PUEDES HACER»), así que una página entera se lee al mismo nivel; el color es casi sólo verde
(lima de noche) y el acento por intención (explorar azul, alertas rojo) aparece en unas pocas páginas; hay tarjetas
enteras para decir «Sin dato».

## 2. Lo que encontró la auditoría del código

| Indicador | Valor |
|---|---|
| Tamaños `text-[Npx]` arbitrarios | 2 054 usos, 36 valores (más 11 de Tailwind: 47) |
| El kit contra DESIGN_SYSTEM.md | h1 28–32 px (pide 30–36), h2 20 (22–26), h3 15 (17–18) |
| Encabezados del mismo nivel con estilos distintos | h2: 55 estilos en 108; h3: 47 en 90 |
| Severidad | 5 vocabularios («Señal alta», «Riesgo alto», «Alta», «Grave», «Severidad alta»), 5 copias del mapa de color, 8 del orden (2 invertidos), 12 lugares la pintan con `Badge` sin ícono |
| Helpers copiados | `uno()` ×11, `txt()` ×9, clase `ACCION` ×11, número en círculo ×10, `NoSePudoLeer` ×8, `CAMPO` ×8 |
| Archivos de más de 800 líneas | 5 (SeccionesEmpresa 1 144, lib/contratos 898, MapaWrapper 826, ZonaHubPanel 822, DirectorioGobiernos 821) |
| Colores fijos | unos 110 hex problemáticos (mapas, grafos, partidos, denuncias); `textil-*` y `warm*` sin versión de día |
| Tarjetas | 16 combinaciones de clases; 8 radios distintos |
| `any` | 346 en 74 archivos |
| Bugs de paso | `hoySancion` usa la hora UTC (no Lima); la leyenda de RelationshipGraph describe colores que no dibuja. (`formatMonto(0)` = «Sin dato» NO es un bug: el OCDS publica 0 cuando no hay valor referencial) |

## 3. El plan

Cada fase termina con el recorrido visual en DEV (antes y después) y sus capturas, y sólo pasa a producción si los
chequeos no empeoran.

### Fase A: que las reglas no se vuelvan a romper (guardia)

1. `frontend/scripts/auditar-estilo.mjs` (corre en `npm run auditar:estilo`): falla si en el código nuevo aparece un
   «·» en texto visible, un hex en `className`, un `text-[Npx]` fuera de la escala, una lista `.slice(0, N)` sin «ver
   más», o una página de `app/` sin `Migas`.
2. `frontend/e2e/visual/recorrer.py` como prueba de regresión visual: las 84 capturas y el informe por regla.

### Fase B: jerarquía (el mayor cambio visible)

1. **Escala tipográfica como tokens** en `tailwind.config.ts`, con su interlínea:

   | Token | Tamaño | Uso |
   |---|---|---|
   | `text-titulo` | 32 px | h1 de la página |
   | `text-seccion` | 21 px | h2: cada bloque de una página |
   | `text-bloque` | 17 px | h3: el título de una tarjeta |
   | `text-cuerpo` | 15 px | texto corrido |
   | `text-dato` | 14 px | valores en tablas y fichas |
   | `text-meta` | 13 px | metadatos, ayudas |
   | `text-rotulo` | 12 px | rótulos de datos, chips |
   | `text-micro` | 11 px | lo mínimo (nunca menos) |

2. **El kit primero**: `EncabezadoPagina`, `Seccion`, `BloqueDetalle`, `CabeceraPestana`, `Tabla`, `CifrasEnFila`,
   `DatosClave` con esos tokens; un `TituloSeccion` (h2 + bajada + acción) para los bloques que hoy usan una etiqueta en
   mayúscula como título.
3. **Codemod** de los 2 054 `text-[Npx]` a la escala (12,5 → 13; 13,5 y 14,5 → 14; 11,5 → 12; menos de 11 → 11), por
   carpetas, con capturas. Meta: de 47 tamaños a 8.
4. **Ritmo**: más aire entre secciones que dentro de ellas (`space-y-8` entre bloques de una página, `space-y-3` dentro
   de una tarjeta).

### Fase C: color con propósito

1. **Acento por intención en toda página**, no sólo en algunas: la barra del encabezado, el subrayado de la pestaña
   activa y el punto de cada título de sección toman el color de su sección (explorar, alertas, participar).
2. **Familias de antecedentes con color propio** (sanciones, política y campañas, competencia, compras), validadas para
   daltonismo: así una ficha se lee de un vistazo. Nunca sólo el color: cada una con su ícono y su nombre.
3. **Superficies**: de día, más diferencia entre el fondo de la página y las tarjetas; una sola familia de tarjeta
   (`Tarjeta` en reposo, hundida e interactiva) en vez de 16 combinaciones.
4. **Contraste**: `mute` de día a 4,6:1 o más (las pistas de la barra lateral quedan en 4,4); los textos de 9 a 10,5 px
   suben a 11; la portada (1,8:1).
5. **Sin colores fijos**: `textil-*`, `warm*`, mapas y grafos leen las variables (con su versión de día); la leyenda de
   RelationshipGraph usa los colores que dibuja.

### Fase D: estructura (lo que pidió el usuario y quedó suelto)

1. `Migas` en las 6 listas que no la tienen.
2. Buscador en las listas largas que no lo tienen (denuncias, aportes de aliados).
3. Los textos sueltos van a una tarjeta, un `Aviso` o una `Ayuda` (nota de privacidad del contrato, explicación de
   partidos, auditoría).
4. Las tarjetas que sólo dicen «Sin dato» pasan a una línea de estado vacío.
5. «—» como valor vacío → «Sin dato» (34 lugares), como pide §10.2.

### Fase E: mantenibilidad

1. `lib/severidad.ts` única: un tipo, un orden, un vocabulario por contexto, `<Severidad>` (con ícono) en vez de los 12
   `Badge`; `lib/fuentes.ts` con el nombre de cada fuente; `lib/formato.ts` con `txt`, `num`, `uno`, `porcentaje` y
   `tituloNatural`.
2. Piezas del kit: `ListaNumerada`/`TarjetaSenal`, `Campo`, `Barra`, un solo `EstadoVacio`, `NoSePudoLeer`, una sola
   función de clases de botón.
3. Partir los 5 archivos de más de 800 líneas (SeccionesEmpresa en `components/empresas/secciones/`, CrucesProveedor,
   ContratoDetalle, MapaWrapper, ZonaHubPanel).
4. Borrar código muerto (mocks, `region-coords`, `severidadColor`) y corregir DESIGN_SYSTEM.md (§0–§6 aún hablan de
   granate y Montserrat).

## 4. Criterios de aceptación (los mide el recorrido)

- 0 separadores, 0 desbordes, 0 errores de consola (como hoy).
- Migas en el 100 % de las páginas de `app/` salvo la portada y el Inicio.
- 100 % de las listas de 10+ filas con buscador.
- 0 colores fijos en estilos en línea.
- 0 textos bajo 4,5:1 (3:1 si es grande).
- 8 tamaños de letra o menos.
- 0 párrafos largos sueltos fuera de una tarjeta (salvo la bajada del encabezado).

## 5. Avance (2026-10-22)

Hecho y medido por la guardia (`npm run auditar:estilo`, todo en 0 salvo lo que se dice):

- **A, guardia:** 8 reglas: separador, hexEnClase, tamanoLibre, paginaSinMigas, recorteMudo, rayaVacia («—» como valor),
  tamanoTailwind (561 → 148, sólo puede bajar: quedan títulos de la portada con prefijo `sm:` y `text-xl`+) y
  escalaEnCn (la escala de `tailwind.config.ts` = la que conoce `cn()`). El recorrido suma «no cargó» (sale con 1),
  jerarquía de títulos (h1 ≥ 26 px, h2 ≥ 18, h3 ≥ 15) y texto bajo 11 px.
- **B, jerarquía:** escala de 11 tokens; 2 054 `text-[Npx]` y 413 tamaños de Tailwind pasados a la escala (con la misma
  interlínea, `scripts/escala-tailwind.mjs`); los títulos de bloque en `text-bloque` display negrita (también los del
  Inicio de entidad, partido y región, que eran de 15 px). **Bug encontrado:** `tailwind-merge` no conocía la escala y
  `cn("text-meta text-mute")` borraba el tamaño; `lib/utils.ts` le pasa `ESCALA_LETRA`.
- **C, color:** acento por intención también en Empresas, Personas contratadas y Noticia; de día el fondo de la página
  (`--fondo`, #EFF3F2) se separa de las tarjetas blancas (`--paper`); los 4 hex de clase pasan a tokens (`sobreMaiz`,
  `anil`, `anilTexto`, `crimsonTexto`); pistas de la barra lateral y el podio de aliados con contraste AA; la leyenda
  de RelationshipGraph sale del mismo `styleEdge` que dibuja.
- **D, estructura:** Migas en las 14 páginas que no la tenían; `Nota` (nota al pie en su caja) en los textos sueltos
  (privacidad, gobiernos por partido, portada); `SinDato` de una línea en los bloques del Inicio y sin tarjeta de
  presupuesto vacía; «—» como valor → «Sin dato» / «Ninguno» (y la regla que lo vigila); recortes de lista con su «y N
  más» o la marca `recorte:`.
- **E, mantenibilidad:** orden de severidad único (`RANGO_SEVERIDAD`, `peorSeveridad` en `lib/severidad.ts`, antes 8
  copias, 2 al revés); `uno`/`txt`/`txtONumero` en `lib/utils.ts` (17 copias); `FichaNoLeida` (7 copias, todas con
  Migas); `CLASE_ACCION_LISTA` (11 copias); `SeccionesEmpresa.tsx` (1 147 líneas) partido en
  `components/empresas/secciones/` (8 archivos); `hoySancion` con la fecha de Lima; código muerto borrado
  (`region-coords`, `formatAmount`/`formatDate` de `lib/oece.ts`, `severidadColor`).

**El recorrido, antes (producción) y después (DEV), 84 vistas:**

| Regla | Antes | Después |
|---|---|---|
| Separadores, desbordes, errores de consola, controles sin nombre | 0 | 0 |
| Sin Migas | 24 | 0 |
| Lista larga sin buscador | 12 | 0 |
| Texto suelto fuera de tarjeta | 16 | 0 |
| Títulos más chicos que su nivel | (sin medir) | 0 |
| Texto bajo 11 px | (sin medir) | 0 |
| Contraste bajo | 42 | 2 (el «1» del podio de la portada, decorativo: el chequeo mide contra el punto más intenso del degradado) |
| Color fijo en estilo en línea | 16 | 12 (paleta de partidos, leyenda del mapa, pin de contrato: siguiente vuelta) |
| Tamaños de letra distintos | 47 | 32 |

Arreglos que salieron del propio recorrido: `mute` de día a #586764 (sobre el fondo con el tinte de la sección daba
4,3:1); el encabezado de Partidos con `encabezado-color` (tenía un degradado lima propio); «Con riesgo alto» de la
portada con `alertaBanda`; el contador de la pestaña activa; los h2/h3 de la ficha de contrato y del dossier.

Segunda vuelta (commits 191d64a, 2610c80): paleta de organizaciones por modo validada para daltonismo (antes confundía verde y rojo con deuteranopía); pines del mapa con tokens del tema; barra del navegador al nuevo fondo. Y en la ficha de planilla, «Cobros al Estado, mes a mes» marca con ◆ los meses con órdenes de servicio (conecta planilla con OECE/CONOSCE).

Queda para la siguiente vuelta: los hex de mapas y grafos (y `textil-*`/`warm*`) con versión de día; familias de
antecedentes con color validado para daltonismo; partir MapaWrapper, ZonaHubPanel, DirectorioGobiernos y lib/contratos;
los 148 tamaños de Tailwind con prefijo; los 346 `any`.
