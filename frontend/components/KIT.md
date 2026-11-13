# El kit de interfaz: qué componente va para cada cosa

Escrito el 12 de noviembre de 2026, al cerrar la unificación del kit (auditoría de producto, fase 4). La regla es una
sola: **un componente por trabajo en cada superficie.** Antes de escribir uno nuevo, búscalo aquí.

Hay tres superficies, y cada una tiene su carpeta. No se mezclan: la app cívica no importa del kit de Gobserva ni al
revés, salvo las primitivas de `ui/`, que son de todos.

| Superficie | Dónde vive | Para qué |
|---|---|---|
| Vigía (app cívica) | `patrones/`, `listado/`, `charts/`, `ui/` | Portada, `/app`, fichas e institucionales |
| Apps de Gobserva (Empleo, Licitaciones, Obras) | `gobserva/app/` y `gobserva/ui/` | Lo que va dentro de `/app` de cada producto, con los tokens `lienzo` y `caja` |
| Panel | `admin/ui/` | `/admin`, denso y sin modo día |

## Vigía

| Necesito | Uso | Archivo |
|---|---|---|
| El marco de una página | `Pagina`, `EncabezadoPagina`, `Migas`, `Seccion` | `patrones/Estructura.tsx`, `patrones/Migas.tsx` |
| Pestañas (con la URL) | `Pestanas`, `CabeceraPestana` | `patrones/Pestanas.tsx` |
| Una tabla | `Tabla` y sus `Celda*` | `listado/Tabla.tsx` |
| Una tabla que se filtra o pagina en el navegador | `TablaFiltrable`, `TablaPaginada` | `listado/Paginado.tsx` |
| Filtros, buscador y orden | `BarraFiltros`, `Listado`, `ZonaResultados` | `listado/` |
| Paginar por número de página | `Paginacion` | `ui/Paginacion.tsx` |
| Paginar por cursor (listas enormes) | `PaginacionCursor` | `ui/PaginacionCursor.tsx` |
| Qué números de página se dibujan | `paginasVisibles` | `lib/paginas.ts` |
| Un vacío o un error que ocupa la zona entera | `EstadoVacio`, `EstadoError`, `Cargando` | `patrones/Estados.tsx` |
| Un vacío de una línea dentro de un bloque | `VacioEnLinea` | `ui/VacioEnLinea.tsx` |
| Un esqueleto mientras carga | `Skeleton`, `TablaSkeleton` | `ui/Skeleton.tsx`, `listado/Tabla.tsx` |
| Un dato con su ícono | `Dato` | `ui/Dato.tsx` |
| Cifras grandes en fila | `Indicadores`, `CifrasEnFila` | `listado/Indicadores.tsx`, `ui/CifrasEnFila.tsx` |
| La gravedad de una señal o de un puntaje | `Severidad`, `PesoRiesgo` | `ui/Severidad.tsx`, `contratos/PesoRiesgo.tsx` |
| Las banderas de una ficha | `BanderasFicha` | `patrones/BanderasFicha.tsx` |
| Explicar un dato o un término | `Ayuda`, `AyudaTermino`, `AyudaPuntaje` | `patrones/` |
| De dónde sale un dato | `FuenteDato`, `EnlaceFuente` | `patrones/Estructura.tsx` |
| Un aviso de una línea con su acción | `Franja` | `patrones/Franja.tsx` |
| Una nota | `Nota` | `patrones/Estructura.tsx` |
| Un botón que navega, o uno que actúa | `EnlaceAccion`, `Button` | `ui/` |
| Un panel lateral o una hoja | `Panel`, `Revelar` | `ui/` |
| Una parte de un total | `BarraSegmentada`, `Medidor`, `CeldaBarra` | `charts/BarraSegmentada.tsx`, `listado/Tabla.tsx` |
| Una serie en el tiempo | `ColumnasAnio`, `LineaMeses`, `LineaHitos` | `charts/` |

Colores: siempre tokens (`globals.css`). La gravedad sale de `lib/severidad.ts` y las series de `colorSerie()`. Una
barra de «cuántos tienen indicio» va en tono neutro (`CeldaBarra tono="neutro"`): no es buena ni mala por ser grande.

## Apps de Gobserva

| Necesito | Uso | Archivo |
|---|---|---|
| El marco de la app y su navegación | `MarcoApp`, `NavApp`, `Vistas` | `gobserva/app/` |
| Una caja y el marco de una página | `Caja`, `Pagina` | `gobserva/app/Caja.tsx` |
| Una tabla (tarjetas en el celular) | `TablaDatos` | `gobserva/ui/TablaDatos.tsx` |
| Paginar | `Paginacion` | `gobserva/ui/Paginacion.tsx` |
| Vacío, error y carga | `EstadoVacio` y compañía | `gobserva/ui/Estados.tsx` |
| Una insignia (tipo, vence, señal) | `Insignia*` | `gobserva/ui/Insignia.tsx` |
| Filtros y buscador | `FiltroOpciones`, `BuscadorTexto`, `Desplegable` | `gobserva/ui/` |
| Avisos que aparecen y se van | `useAvisos` | `gobserva/ui/Avisos.tsx` |

Hasta el 12 de noviembre este kit vivía en `licitaciones-app/ui/`, aunque Empleo también lo usa.

## Panel

`admin/ui/` tiene su propio juego (`DataTable`, `StatCard`, `Pestanas`, `Badge`, `EmptyState`, `Skeleton`): es denso,
no tiene modo día y no se usa fuera de `/admin`.

## Lo que se retiró en la unificación

- 15 componentes que nadie importaba, y la dependencia `@gsap/react`.
- `ui/PaginacionNumerada`: sus dos usos pasaron a `ui/Paginacion`.
- La segunda copia de «qué páginas se dibujan»: queda `lib/paginas.ts`.
- El nombre `EstadoVacio` para el vacío en línea (había tres componentes con ese nombre): ahora es `VacioEnLinea`.
- El `Medidor` local de las alertas en revisión, que era otro gráfico: ahora es `MedidorUmbral`.
