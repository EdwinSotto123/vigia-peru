# Auditoría visual completa de Vigía

Hecha el 13 de noviembre de 2026 sobre producción. El dueño del producto rechazó el diseño («todo está apilado de arriba
abajo», «haces un degradado y ya crees que es diseño», en escritorio y en celular) y pidió auditar todo, no páginas
sueltas.

## Cómo se hizo

- **58 rutas en dos tamaños:** 116 capturas de página entera, a 1440 y 390 px, en modo día. Todas las listas, todas las
  fichas con sus pestañas principales, las páginas de apoyo y las de método.
- **Medidas por captura:** alto en pantallas, textos cortados con «…», textos de menos de 11,5 px, elementos con
  degradado, desborde y errores de consola.
- **Revisión captura por captura** en tres lotes, con una misma lista: primera pantalla, jerarquía, uso del ancho,
  tablas, comprensión del dato, tipografía, celular y cosas rotas.
- No se capturaron: las fichas de persona, de planilla y de plaza (su lista no dio un enlace en la captura), las páginas
  con sesión y el panel de administración.

## Las medidas

| | Escritorio | Celular |
|---|---|---|
| Alto medio de una página | 2,4 pantallas | 4,4 pantallas |
| Textos cortados con «…» por página | 8 | 14 |
| Textos de menos de 11,5 px por página | 24 | 23 |
| Elementos con degradado por página | 5 | 5 |
| Páginas con desborde a lo ancho | 0 | 1 (ficha de partido) |
| Páginas con errores de consola | 0 | 0 |

Las más largas en celular: portada (23,7 pantallas), ficha de entidad (10,6), ficha de partido (9,0), organización de
una entidad (8,8) y ficha de región (7,9).

## El diagnóstico

El problema no es el color. Son seis o siete piezas compartidas mal resueltas, que se repiten en todas las páginas.

| # | Pieza | Qué está mal | Dónde |
|---|---|---|---|
| 1 | Cabecera de página y de ficha | Una caja de 100 a 430 px con degradado, que se repite igual en cada pestaña y empuja el contenido fuera de la primera pantalla | Todas |
| 2 | Degradado como jerarquía | Cuatro capas: fondo de la pantalla, cabecera, tinte de cada caja y sombras de color. Tiñe hasta las primeras filas de una tabla, que parecen seleccionadas | Todas |
| 3 | Franja de cifras | Texto corrido en una línea, sin celdas, sin unidad ni periodo claros | Todas las listas y fichas |
| 4 | Pestañas | Hasta tres niveles con la misma forma de pastilla; no se distingue la madre de la hija. En celular se cortan sin indicio | Fichas, dictamen, método |
| 5 | Tabla | Columnas que dicen lo mismo en casi todas las filas; el dato que identifica la fila va gris y cortado; filas de 54 a 72 px; números sin alinear | Todas las listas |
| 6 | Tabla en celular | Pierde columnas sin avisar o se vuelve una pila de 5 a 8 renglones por fila | Todas las listas |
| 7 | Barra de filtros | Tres capas (barra segmentada, pastillas y desplegables) en dos o tres renglones. En celular son casi dos pantallas antes de la primera fila | Todas las listas |
| 8 | «Inicio» de una ficha | Una pila de tarjetas que repiten lo que ya está en las otras pestañas, en una columna estrecha y con el resto del ancho vacío | Entidad, región, partido |
| 9 | Información repetida | Las mismas cifras en la frase resumen, en la franja y en los contadores de pestaña; la lista de partidos en tres páginas; los bloques de apoyo hasta tres veces | Varias |
| 10 | Unidades y jerga | «S/ 407.8 mil M», «billones aparte», «+14», «PIM», «financiados en revisión» | Varias |

## Lo que estaba roto

| Qué | Dónde | Estado |
|---|---|---|
| La página de costos mostraba solo «No pudimos leer los costos ahora»: un fallo momentáneo de la API quedó guardado en caché como la página | `/app/cuanto-cuesta` | Corregido en el código: esa respuesta ya no se guarda |
| Comparar en celular: la segunda entidad queda fuera de la pantalla | `/app/comparar` | Pendiente |
| El título de un contrato menor es el objeto entero: 13 líneas en escritorio y 22 en celular | `/app/contratos/menor/[id]` | Pendiente |
| `?seccion=entidades` en el mapa de poder y `?vista=vivo` en un contrato no cambian de vista | `/app/poder`, ficha de contrato | Pendiente |
| Cifras que no cuadran en un mismo contrato: 5, 4 y 2 más 3 señales; puntaje 105 frente a 100 | Ficha y dictamen | Pendiente, pide revisar el dato |
| «Sin dato: el servicio no respondió» pintado como contenido | Ficha de partido | Pendiente |
| El mapa mental de la organización sale cortado por la izquierda | Organización de una entidad | Pendiente |
| Etiquetas del mapa encimadas («AncasHuánuco») | Partidos en el mapa | Pendiente |

## Lo corregido en la base (commit `5845cc71`)

Cada cambio está en la pieza compartida, así que aplica a todas las páginas que la usan.

- **Sin degradados.** Fondo de pantalla, cabecera y cajas quedan planos. La jerarquía la dan el borde, el tamaño y la
  posición; el color queda para el estado (riesgo, activo).
- **Cabecera de página compacta.** Sin caja: título de 22 px (antes 32) y una línea de bajada de 14 px.
- **Cifras en celdas.** Una caja con una celda por cifra: rótulo arriba, cifra y nota con su periodo. En celular, dos
  por fila.
- **Pestañas por nivel.** El primer nivel va subrayado; el segundo, en control segmentado. Ya no hay dos filas de
  pastillas iguales.
- **Menú lateral de una línea por ítem.** La pista de cada entrada pasa a la ayuda del enlace.
- **La lista de contratos abre por riesgo.** Antes abría con 25 convocatorias de ayer, sin ganador, sin monto y sin
  leer. Con una búsqueda de texto sigue abriendo por fecha.

## Lo que sigue, por pieza

1. **Tabla:** filas de 44 a 48 px; ocultar la columna que dice lo mismo en más del 80 % de las filas y decirlo una vez;
   columnas propias para entidad, proveedor y fecha; agrupar filas idénticas; números alineados con la unidad en el
   encabezado.
2. **Fila en celular:** tarjeta fija de tres renglones como máximo (título, entidad, y una fila de pares con el monto a
   la derecha), sin quitar la columna que da sentido a la página.
3. **Barra de filtros:** una fila de 40 px; en celular, buscador y un botón «Filtros» que abre una hoja.
4. **Cabecera de ficha:** en las pestañas internas, colapsada a nombre y pestañas; las banderas, como resumen de una
   línea que se despliega.
5. **«Inicio» de entidad, región y partido:** una pantalla con las cifras, las banderas, quién gobierna y tres
   hallazgos con su enlace; lo demás ya vive en sus pestañas.
6. **Ficha del contrato:** una sola cabecera para ficha y dictamen; quitar el interruptor «Ficha / Dictamen» y los
   bloques repetidos; título corto con el objeto completo en el cuerpo.
7. **Fusiones:** las tres listas de partidos en una; Apoyar, Aliados, Aportes y Cuánto cuesta en una página con
   pestañas; Financiar dentro de Auditoría en vivo.
8. **Portada:** bandas vacías y carruseles cortados; 15 pantallas en escritorio y 24 en celular.
9. **Lo roto** de la tabla de arriba.

El cintillo de aliados se queda en todas las páginas: es un pedido expreso del dueño del producto, aunque la revisión lo
marca como ruido en las pantallas de datos.
