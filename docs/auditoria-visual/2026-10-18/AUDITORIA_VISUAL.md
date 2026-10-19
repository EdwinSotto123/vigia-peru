# Auditoría visual de Vigía Perú

**18 de octubre de 2026** · producción (`https://vigia-web.vigiaperu.workers.dev`, versión `a264d979`, commit `9a5bf65`) · PC 1440×900 y celular 390×844.

## Cómo se hizo

- **Capturas automáticas.** `auditar.py` (Playwright con Chrome) abre 19 páginas en PC y en celular y captura la primera pantalla y la página completa.
- **Chequeos automáticos.** El mismo script mide, en cada página (resultados en `metricas.json`):
  - desborde horizontal;
  - texto de menos de 12 px;
  - botones y enlaces de menos de 32 px;
  - títulos cortados con «…»;
  - imágenes sin descripción o rotas;
  - errores de JavaScript;
  - cuánto del primer pantallazo tiene contenido.
- **Portada con scroll.** Sus secciones aparecen recién al llegar a ellas, así que también se recorrió bajando como una persona (`portada_con_scroll.py`).
- **Revisión a mano.** Se miró cada captura, y cada cifra rara se comparó con la base de datos.

Repetir:

```bash
python docs/auditoria-visual/2026-10-18/auditar.py https://vigia-web.vigiaperu.workers.dev docs/auditoria-visual/2026-10-18/img metricas.json
python docs/auditoria-visual/2026-10-18/portada_con_scroll.py https://vigia-web.vigiaperu.workers.dev carpeta_salida
```

## Resumen

**Lo que está bien:**
- **Estructura:** ninguna página se desborda a lo ancho en el celular y no hay errores de JavaScript (19 páginas × 2 tamaños).
- **Estilo coherente:** fondo oscuro, lima para la acción y rojo/ámbar para la severidad.
- **Listas:** son densas y se leen bien.
- **Fuentes:** la ficha y el dictamen dicen de dónde sale cada dato, y los chips de severidad se entienden sin leer la ayuda.

**Lo que más pesa:** tres cosas.
1. **Datos que se ven mal:** títulos con `\n` literal, aportes de prueba publicados, logos rotos y montos que se contradicen dentro de un mismo contrato.
2. **El celular:** en Mapa, Contratos y la ficha, lo importante queda debajo de la primera pantalla.
3. **Palabras distintas para lo mismo.**

### Las 10 mejoras con más impacto

| # | Prioridad | Qué pasa | Dónde | Propuesta | Esfuerzo |
|---|---|---|---|---|---|
| 1 | P1 | **366 contratos con `\n` literal en el objeto** (se ve «PANEL LED \nPARA LA UNIVERSIDAD…») | Inicio, Auditoría en vivo, listas | Limpiarlo al cargar (`scrapers-worker/src/fuentes/oece_ocds.ts`). Corregir lo ya cargado con un `UPDATE … replace(objeto, '\n', ' ')`. En la web, que `limpiarObjeto` (`components/contratos/recortar.ts`) también lo quite. | S |
| 2 | P1 | **Aportes de prueba en público** («…(prueba final de seguridad)», «…(prueba de red cerrada)»: 4 de 19). **Logos rotos** en «Últimos aportes»: apuntan al frontend de Cloud Run, que está apagado. | Financiar, portada, Aliados | Quitar el paréntesis de `mensaje_publico` en esos 4 aportes. Guardar el logo como ruta relativa (`/assets/logo/…`), no con el dominio de Cloud Run. | S |
| 3 | P1 | **Un mismo contrato dice tres cosas** (1228810): el dictamen pone «Riesgo alto» con «2 señales medias»; en vivo pone «5 señales de riesgo (3 altas, 2 medias)» y debajo «1 señal». | Dictamen, Lectura en vivo, lista de Contratos («5 señales») | Usar un solo conteo: las señales cotejadas. Las no verificables van aparte, con su nombre («3 de precio no verificables»). El puntaje tiene que salir de lo mismo que se muestra. | M |
| 4 | P1 | **Montos inflados que quedan:** Señales y la ficha de la entidad muestran 1228396 en **S/ 3,816,214** (suman la buena pro reemplazada). La ficha del contrato ya dice S/ 2,277,032. | Señales, Entidad | Calcular el monto de alertas y de entidades con las adjudicaciones vigentes, la misma regla de la ficha (`adjudicacionesVigentes`). | M |
| 5 | P1 | **En el celular lo importante queda abajo:** el mapa empieza a ~1,000 px, el primer contrato a ~790 px y el título de la ficha ocupa 6 líneas en mayúsculas. | Mapa, Contratos, Ficha | Los filtros, en un botón «Filtros (n)» que abre una hoja, y las cifras en una fila compacta. En el celular, el título en tamaño normal y sin mayúsculas sostenidas. | M |
| 6 | P1 | **Podio de Aliados roto en el celular:** el botón «Ocupa este puesto» se sale por la izquierda y tapa el «2». | Aliados, portada | Revisar el posicionamiento del botón en `components/aliados/Podio.tsx` por debajo de `sm` (que no sea absoluto). | S |
| 7 | P2 | **Las cifras de Contratos no siguen al filtro de riesgo:** con «Riesgo: Alto» arriba dice 310 / 310 / 310 y la lista «1–50 de 74». | Contratos | Que las 4 cifras cuenten con todos los filtros, y que no se repita tres veces el mismo número. | S |
| 8 | P2 | **Vocabulario:** <ul><li>«señal alta» (Inicio) vs «riesgo alto» (Contratos) para el mismo 74;</li><li>«Riesgo medio o alto» 3 veces en el mapa (Pintar por, Ver solo y capa de puntos);</li><li>«Ganadores en otros registros» en la entidad vs «Antecedentes del ganador» en el resto;</li><li>«← Auditoría en vivo» en la vista En vivo vs «← Contratos» en las otras.</li></ul> | Varias | Glosario único (ver más abajo). | S |
| 9 | P2 | **Títulos del SEACE en MAYÚSCULAS** en encabezados y listas: cansan y se cortan antes. | Ficha, Dictamen, Entidad, Contratos, Auditoría | Usar `tituloNatural` (`lib/landing.ts`, ya se usa en Inicio) en encabezados y filas, con el original en el tooltip. | S |
| 10 | P2 | **Mapa con 4 filas de controles** antes del mapa en PC (pintar por, ver solo, mes, capas y 5 desplegables). | Mapa | «Pintar por» y la región a la vista; el resto, en un panel «Filtros (n)» con los activos como chips. Juntar «Ver solo» con los filtros nuevos. | M |

S = menos de medio día · M = 1–2 días.

### Otras mejoras (P3, pulido)

- **Nombres de región sin tilde.**
  - Ranking del mapa y Denuncias dicen «Junin», «Ancash», «Huanuco», «Apurimac».
  - El mapa y Partidos dicen «Junín» y «Áncash».
  - Corregir la tabla `zonas`, o normalizar los nombres en la API.
- **Formato de números:**
  - Partidos escribe «51,0 %» con coma decimal; el resto del sitio usa punto («1.8 %»).
  - «S/ 1.2 mil M» en la escala del mapa y en Denuncias se lee raro. Propuesta: «S/ 1,200 M» en escalas y tablas, y dejar «mil M» sólo para titulares.
- **Portada:**
  - Las banderas de Colombia, Chile, México y Paraguay se ven como rectángulos grises.
  - La tira de cifras se corta a la derecha en PC (la quinta tarjeta asoma a medias).
  - El intersticial «Vigía mira. Alguien lo hace posible.» ocupa una pantalla entera, con texto gris de bajo contraste.
- **Cuando el único aliado es la propia plataforma** (portada «Lo hacen posible: Vigía Perú»; Aliados con «Vigía Perú, la propia plataforma» en el puesto 1), se lee como autoaplauso. Propuesta: mientras no haya aliados externos, mostrar «Todavía nadie más financió lecturas: sé el primero» en vez del podio.
- **Partidos repite los períodos dos veces:** tarjetas «2014 mandato 2015 a 2018…» arriba y el selector «2015 a 2018 / 2019 a 2022 / 2023 a 2026» debajo. Dejar sólo el selector.
- **Vistas del contrato:**
  - El selector «Ficha · Dictamen · Lectura en vivo» queda arriba del «← Contratos», con ~60 px de aire.
  - Mejor: «← Contratos» y el selector en una misma fila.
  - Que las tres vistas compartan el mismo encabezado: hoy cada una ordena distinto el código, la entidad, el lugar y quién ganó.
- **Lectura en vivo:** modelo, tokens, costo y versión de reglas están en la columna principal. Es transparencia útil, pero ruido para el ciudadano: moverlo a «Cómo se hizo».
- **Señales:**
  - Un mismo contrato ocupa varias filas seguidas (3 de 1228396 y 4 de 1228227). Ofrecer «agrupar por contrato».
  - «Financiados en revisión 74» vs «Leído, en revisión humana 76» en Contratos. Son dos definiciones distintas: decirlo en la ayuda, o usar la misma.
- **Inicio:** en «Lo último que se leyó» unos títulos van en mayúsculas y otros no. Pasarlos todos por `tituloNatural`.
- **Texto chico:** la ficha (95 elementos), Lectura en vivo (100) y el mapa (54) usan 11 px en etiquetas y fechas. Mínimo 12 px en el celular.
- **Puntos de distrito del mapa de región:** 108 objetivos táctiles de menos de 32 px en el celular. Dar más área de toque, o abrir la lista de distritos al tocar la provincia.
- **Mapa:** «0 leídos hoy · 0 contratos nuevos del SEACE» se ve como algo roto mientras la lectura está pausada. Mejor «Última lectura: hace 6 días».

### Glosario propuesto (una palabra por idea)

| Idea | Usar | Dejar de usar |
|---|---|---|
| Resultado de la lectura de un contrato | **Riesgo** alto / medio / bajo | «señal alta» para el contrato |
| Una regla que disparó | **Señal** (alta / media / baja) | — |
| Lo que dicen otros registros del ganador | **Antecedentes del ganador** | «cruces», «ganadores en otros registros» |
| Contratos que Vigía terminó de leer | **Leídos** (publicados o en revisión) | «con dictamen» como cifra aparte, salvo en Señales |
| Contratos que esperan financiamiento | **En cola** | «esperando lectura» y «en cola» mezclados |

### Falsos positivos de los chequeos automáticos

- **«Botones sin nombre»** (36 en el dictamen, 19 en Partidos y 8 en Preguntas): son opciones de menús y acordeones cerrados. El texto existe, sólo que está oculto mientras el menú no se abre.
- **«Títulos cortados»** en las listas: es intencional, porque el título completo está en el panel o en la ficha. Pasa a problema sólo junto con las mayúsculas (punto 9).

## Página por página

Cada par: PC a la izquierda, celular a la derecha (primera pantalla). Las capturas `*-completa.jpg` en `img/` muestran la página entera.

### Portada `/`

<img src="img/portada-pc.jpg" width="640"> <img src="img/portada-movil.jpg" width="200">

- El hero es claro: pregunta, propuesta y dos acciones.
- «Lo hacen posible: Vigía Perú» es la propia plataforma.
- En la cabecera compiten dos botones lima: «Aliados» y «Financiar una auditoría».
- La página es muy larga: 14,509 px en PC y 20,834 px (~25 pantallas) en el celular.

<img src="img/portada-pc-intersticial.jpg" width="420"> <img src="img/portada-pc-cifras.jpg" width="420"> <img src="img/portada-pc-banderas.jpg" width="420"> <img src="img/portada-pc-aportes.jpg" width="420">

Intersticial de pantalla completa · tira de cifras cortada a la derecha · banderas grises · cinta de aportes, todos de «Vigía Perú».

### Inicio `/app`

<img src="img/inicio-pc.jpg" width="640"> <img src="img/inicio-movil.jpg" width="200">

- «Lo último que se leyó» muestra el `\n` literal («PANEL LED \nPARA…») y mezcla títulos en mayúsculas y en tipo título.
- Dice «74 con señal alta» donde Contratos dice «74 con riesgo alto».

### Mapa `/app/mapa`

<img src="img/mapa-pc.jpg" width="640"> <img src="img/mapa-movil.jpg" width="200">

<img src="img/mapa-region-pc.jpg" width="640"> <img src="img/mapa-region-movil.jpg" width="200">

- En el celular el mapa no aparece en la primera pantalla: cifras, 6 filas de controles y leyenda van antes.
- «Riesgo medio o alto» aparece 3 veces con tres funciones distintas.
- La escala usa «mil M».
- «0 leídos hoy».
- En la región, los puntos de distrito son muy chicos para el dedo.

### Contratos `/app/contratos`

<img src="img/contratos-pc.jpg" width="640"> <img src="img/contratos-movil.jpg" width="200">

<img src="img/contratos-filtrados-pc.jpg" width="640"> <img src="img/contratos-filtrados-movil.jpg" width="200">

- En el celular el primer contrato aparece a ~790 px.
- Con filtros, las cifras de arriba no siguen al riesgo (310/310/310 vs 74).
- En el orden por defecto (más recientes), muchas filas dicen «Sin dato» y «—», porque son convocatorias del día sin leer. Se ve vacío al entrar.

### Ficha del contrato `/app/contratos/1228396`

<img src="img/ficha-pc.jpg" width="640"> <img src="img/ficha-movil.jpg" width="200">

- El aviso «La buena pro pasó a otro postor» y los antecedentes quedan arriba, bien visibles.
- El título en mayúsculas ocupa 3 líneas en PC y 6 en el celular.
- El selector de vistas está separado del «volver».

### Dictamen `/app/contratos/1228810?vista=dictamen`

<img src="img/dictamen-pc.jpg" width="640"> <img src="img/dictamen-movil.jpg" width="200">

- Dice «Riesgo alto», pero el resumen sólo trae «2 señales medias».
- El encabezado no se parece al de la ficha.

### Lectura en vivo `/app/contratos/1228810?vista=vivo`

<img src="img/en-vivo-pc.jpg" width="640"> <img src="img/en-vivo-movil.jpg" width="200">

- Dice «5 señales de riesgo (3 altas)», y debajo «25 reglas evaluadas, 1 señal».
- El «volver» va a Auditoría en vivo, no a Contratos.
- Los datos técnicos (modelo, tokens, costo) están en la columna principal.

### Señales `/app/hallazgos`

<img src="img/senales-pc.jpg" width="640"> <img src="img/senales-movil.jpg" width="200">

- Es la lista mejor resuelta: severidad, regla, evidencia y cotejo.
- El monto de 1228396 sale inflado (S/ 3,816,214).
- Un mismo contrato ocupa varias filas seguidas.

### Entidades y ficha de entidad

<img src="img/entidades-pc.jpg" width="640"> <img src="img/entidades-movil.jpg" width="200">

<img src="img/entidad-pc.jpg" width="640"> <img src="img/entidad-movil.jpg" width="200">

- En la ficha de entidad:
  - el título en mayúsculas ocupa 5 líneas en el celular;
  - la pestaña todavía dice «Ganadores en otros registros»;
  - el adjudicado de 1228396 sale inflado;
  - hay títulos con «¿» donde la fuente tenía una raya.
- Varias entidades figuran con tipo «Sin clasificar» o «Tipo no declarado».

### Partidos `/app/partidos`

<img src="img/partidos-pc.jpg" width="640"> <img src="img/partidos-movil.jpg" width="200">

- Los períodos aparecen dos veces.
- Los votos usan coma decimal.
- En el celular la tabla empieza a ~900 px.

### Financiar `/app/financiar`

<img src="img/financiar-pc.jpg" width="640"> <img src="img/financiar-movil.jpg" width="200">

- En «Últimos aportes»: logos rotos y mensajes «(prueba …)».

### Auditoría en vivo `/app/auditoria`

<img src="img/auditoria-pc.jpg" width="640"> <img src="img/auditoria-movil.jpg" width="200">

- Hay un `\n` literal en la lista.
- Mezcla títulos en mayúsculas y en tipo oración.

### Aliados `/app/aliados`

<img src="img/aliados-pc.jpg" width="640"> <img src="img/aliados-movil.jpg" width="200">

- El podio se rompe en el celular.
- El puesto 1 es la propia plataforma.

### Denunciar, Denuncias y Preguntas

<img src="img/denunciar-pc.jpg" width="640"> <img src="img/denunciar-movil.jpg" width="200">

<img src="img/denuncias-pc.jpg" width="640"> <img src="img/denuncias-movil.jpg" width="200">

<img src="img/preguntas-pc.jpg" width="640"> <img src="img/preguntas-movil.jpg" width="200">

- **Denunciar:** el formulario en 3 pasos se entiende. En el celular, la cámara («Tomar foto ahora») queda a mano.
- **Denuncias:** las regiones van sin tilde y los montos en «mil M».
- **Preguntas:** está bien. Faltan preguntas sobre los antecedentes del ganador, la buena pro que pasa a otro postor y qué significa «en revisión».

## Métricas automáticas

| Página | Alto PC / celular (px) | Pantallas en celular | Texto < 12 px (PC / cel.) | Toques < 32 px (cel.) | Títulos cortados con «…» (cel.) | Primer pantallazo con contenido (PC / cel.) |
| --- | --- | --- | --- | --- | --- | --- |
| portada | 14,509 / 20,834 | 24.7 | 42 / 37 | 25 | 6 | 31 % / 59 % |
| inicio | 1,690 / 2,816 | 3.3 | 19 / 18 | 2 | 19 | 59 % / 45 % |
| mapa | 1,605 / 1,870 | 2.2 | 54 / 32 | 8 | 6 | 55 % / 44 % |
| mapa-region | 1,645 / 1,944 | 2.3 | 55 / 55 | 108 | 7 | 45 % / 45 % |
| contratos | 3,742 / 7,681 | 9.1 | 66 / 16 | 5 | 38 | 67 % / 41 % |
| contratos-filtrados | 4,580 / 8,687 | 10.3 | 66 / 16 | 8 | 47 | 63 % / 38 % |
| ficha | 2,645 / 4,465 | 5.3 | 95 / 95 | 13 | 3 | 45 % / 44 % |
| dictamen | 1,234 / 2,100 | 2.5 | 37 / 37 | 26 | 3 | 41 % / 52 % |
| en-vivo | 1,345 / 2,317 | 2.7 | 101 / 100 | 6 | 1 | 49 % / 39 % |
| senales | 2,133 / 3,117 | 3.7 | 41 / 16 | 4 | 26 | 62 % / 47 % |
| entidades | 1,490 / 2,043 | 2.4 | 36 / 36 | 4 | 21 | 67 % / 54 % |
| entidad | 949 / 1,500 | 1.8 | 16 / 16 | 8 | 1 | 56 % / 39 % |
| partidos | 1,823 / 2,867 | 3.4 | 17 / 17 | 22 | 37 | 56 % / 42 % |
| financiar | 2,499 / 4,869 | 5.8 | 16 / 16 | 47 | 8 | 61 % / 46 % |
| auditoria | 988 / 1,550 | 1.8 | 16 / 16 | 8 | 1 | 50 % / 36 % |
| aliados | 1,209 / 1,822 | 2.2 | 21 / 22 | 8 | 1 | 42 % / 42 % |
| denunciar | 1,089 / 1,206 | 1.4 | 24 / 20 | 5 | 3 | 58 % / 46 % |
| denuncias | 1,020 / 2,052 | 2.4 | 16 / 16 | 20 | 1 | 59 % / 53 % |
| preguntas | 900 / 1,540 | 1.8 | 16 / 16 | 8 | 1 | 41 % / 63 % |

Las 38 capturas tienen **0 px de desborde horizontal** y **0 errores de JavaScript**. La portada se mide sin scroll, porque sus secciones aparecen al llegar a ellas; recorrida con scroll, sólo su segunda pantalla en PC queda casi vacía (el intersticial).

## Orden sugerido

1. **Datos visibles (1 día):** puntos 1, 2, 4 y 6, y los nombres sin tilde. Son errores que cualquiera nota y le quitan credibilidad al dato.
2. **Una sola cifra por idea (1–2 días):** puntos 3, 7 y 8, y el glosario.
3. **Celular y jerarquía (2 días):** puntos 5, 9 y 10, el encabezado único de las vistas del contrato y el texto mínimo de 12 px.
4. **Pulido:** portada (banderas, cifras, intersticial, aliados), Partidos, Lectura en vivo, Preguntas.
