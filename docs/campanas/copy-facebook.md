# Facebook: cuatro publicaciones para "Cada contrato tiene un pueblo esperando"

Cada publicación es una imagen vertical (1080 x 1350, 4:5) con muy poco texto dentro, más el copy de la publicación. Las imágenes con personas o lugares recreados dicen `Imagen ilustrativa creada con IA.` en el copy.

**Prefijo de estilo para los prompts de imagen (se pega al inicio de cada uno).**
`Cinematic documentary photograph, 4:5 vertical, 35mm lens, natural light, shallow depth of field, fine film grain, deep charcoal shadows with warm earth tones (ochre, adobe, dusty red), one tiny glowing lime-green (#D4FF3F) dot in a far corner like a distant watching eye, photorealistic, credible Peruvian setting, fictional people only, no text, no logos, no watermark, no flags.`

**Reglas.** Sin acusaciones ni nombres. La donación se hace solo desde el sitio (`/app/financiar`): ningún número, cuenta ni QR. Las cifras son de la API pública del 11 de octubre de 2026: 19.653 contratos publicados en 2026, 265 leídos a fondo, 4.006 que ya se pueden financiar, S/ 3 por lectura. Se releen el día de publicar.

---

## F1. Lo que no sale en las noticias

**Fase:** importar. **Emoción:** empatía. **Objetivo:** que la persona se pregunte qué se contrató para su pueblo.

**Titular.** *Una posta sin medicinas no sale en las noticias.*

**Copy de la publicación.**

```text
Una posta sin medicinas no sale en las noticias.
Una escuela sin techo, tampoco.

Lo que cuesta que el dinero público no llegue se paga en cosas de todos los días: caminar más, esperar más, resignarse.

Cada contrato del Estado tiene un lugar y unas personas esperando. Y casi nadie los lee.

En Vigía Perú puedes ver qué se contrata en tu región, con la fuente a un clic. Ver es gratis.

¿Sabes qué se contrató para tu pueblo?
https://vigia-web.vigiaperu.workers.dev/app/mapa

Imagen ilustrativa creada con IA.
#VigíaPerú #TransparenciaPerú
```

**CTA.** Mira tu región: `https://vigia-web.vigiaperu.workers.dev/app/mapa`

**Texto dentro de la imagen (máximo 8 palabras).** `¿Qué se contrató para tu pueblo?`

**Concepto de imagen.** Una posta de noche en un pueblo andino: una sola ventana encendida, una camilla vacía visible por la puerta abierta, el camino de tierra vacío. En la esquina superior derecha, un destello lima como un ojo lejano. Espacio libre en el tercio superior para el texto.

**Prompt.** Prefijo de estilo, más: `A small rural health post at night in a high Andean village, a single warm window lit, an empty gurney visible through the open door, an empty dirt road in the foreground, cold blue dusk sky with stars, quiet and lonely mood, empty space in the upper third of the frame`

**Variante cuadrada (1080 x 1080).** Mismo prompt recortado al centro de la posta, sin el camino, para el carrusel de la página.

**Texto alternativo.** Una posta médica rural de noche en los Andes, con una sola ventana iluminada y una camilla vacía visible por la puerta abierta. Imagen ilustrativa creada con IA.

---

## F2. Un mapa con tu pueblo adentro

**Fase:** descubrir. **Emoción:** curiosidad. **Objetivo:** que la persona abra el mapa y busque su región.

**Titular.** *El Perú, hecho de puntos. Uno es tu pueblo.*

**Copy de la publicación.**

```text
El Perú, hecho de puntos. Cada punto es un lugar donde se firman contratos con dinero de todos.

Este mapa te muestra tres cosas de tu región: quién la gobierna, cuánto dinero se contrata y qué tanto de eso ya fue leído a fondo.

Hoy se vigila poco: de 19.653 contratos publicados este año, hemos leído 265. Los demás esperan.

Busca tu región. Toca tu distrito. Mira qué se contrata ahí.
https://vigia-web.vigiaperu.workers.dev/app/mapa

#VigíaPerú #MapaDelPerú #Transparencia
```

**CTA.** Busca tu región: `https://vigia-web.vigiaperu.workers.dev/app/mapa`

**Texto dentro de la imagen (máximo 8 palabras).** `Busca tu pueblo en el mapa.`

**Concepto de imagen.** El mapa del Perú hecho de puntos lima sobre carbón profundo, con una región encendida más fuerte y la costa, la sierra y la selva con densidades distintas. En una esquina, el ojo de puntos. Esta pieza es la excepción al estilo fotográfico: es una imagen de puntos, hecha en Moda con formas editables (no se genera con un modelo de imagen).

**Prompt (solo si se quiere una textura de fondo generada).** `Very dark charcoal background (#0B0F0F) with a subtle fine grain texture and a faint topographic contour pattern, no text, no map, no logos, large empty central area`. Sobre eso se dibuja el mapa de puntos como forma vectorial (geometría de `frontend/public/assets/mapa/portada-departamentos.v1.json`).

**Variante cuadrada (1080 x 1080).** El mapa centrado con la región encendida.

**Texto alternativo.** El mapa del Perú dibujado con puntos de color lima sobre fondo oscuro; una región está más iluminada que las demás. Texto: Busca tu pueblo en el mapa.

---

## F3. De la indignación a la pregunta

**Fase:** actuar. **Emoción:** poder. **Objetivo:** convertir la indignación en una acción concreta: preguntar con datos o reportar con foto.

**Titular.** *Tu indignación, con un lugar donde ir.*

**Copy de la publicación.**

```text
Ves una obra parada en tu barrio y no sabes qué pasó. Te indignas. Y se te pasa.

Hay otra manera: preguntar con datos.

Entra a Vigía Perú, busca tu distrito y mira qué contratos hay. Si alguno ya fue leído, verás sus señales y la norma en que se apoyan. Una señal no acusa a nadie: es un motivo para revisar.

Y si ves una obra detenida, súbela con foto y ubicación. Puede ser anónima. Con dos reportes independientes del mismo lugar, se confirma.

Imagen ilustrativa creada con IA.
https://vigia-web.vigiaperu.workers.dev/reporte/nuevo

#VigíaPerú #ParticipaciónCiudadana
```

**CTA.** Reporta una obra: `https://vigia-web.vigiaperu.workers.dev/reporte/nuevo`

**Texto dentro de la imagen (máximo 8 palabras).** `No te indignes en silencio. Pregunta.`

**Concepto de imagen.** Una persona de espaldas frente a una construcción de concreto detenida (varillas, andamios, sin trabajadores) al atardecer, con el celular en la mano. El destello lima del ojo se refleja en la pantalla del celular. Espacio libre en el cielo para el texto.

**Prompt.** Prefijo de estilo, más: `A fictional young person seen from behind holding a smartphone, standing in front of a half-built concrete structure with exposed rebar and empty scaffolding in a Peruvian town at golden hour, no workers visible, dust in the air, a faint lime-green glow reflected on the phone screen, empty sky in the upper third`

**Variante cuadrada (1080 x 1080).** Recorte al centro con la persona y la estructura.

**Texto alternativo.** Una persona de espaldas sostiene un celular frente a una construcción de concreto sin terminar, con varillas y andamios vacíos, al atardecer. Imagen ilustrativa creada con IA.

---

## F4. Tu sol cuenta

**Fase:** sostener. **Emoción:** pertenencia. **Objetivo:** invitar a aportar o a sumar capacidades, con claridad sobre qué compra el aporte.

**Titular.** *Con S/ 3, un contrato deja de esperar.*

**Copy de la publicación.**

```text
Vigía Perú no vende publicidad ni vende tus datos. Se sostiene con aportes pequeños.

S/ 3 pagan que un contrato sea leído a fondo y que el resultado sea público. Quien aporta no elige qué se lee, y se publica incluso si el resultado lo señala.

Hoy 4.006 contratos ya pueden financiarse y esperan lectura.

También hacen falta manos: si trabajas en datos, derecho, periodismo o diseño, abre un tema en nuestro repositorio abierto.

Aporta: https://vigia-web.vigiaperu.workers.dev/app/financiar
Súmate: https://github.com/EdwinSotto123/vigia-peru

#VigíaPerú #ApoyaLoQueVigila
```

**CTA.** Aporta o súmate: `https://vigia-web.vigiaperu.workers.dev/app/financiar`

**Texto dentro de la imagen (máximo 8 palabras).** `Tu sol cuenta.`

**Concepto de imagen.** Tres monedas de un sol sobre una mesa de madera clara con luz de ventana; al fondo, desenfocado, el mapa del Perú de puntos en una pantalla. Un destello lima se refleja en una moneda. Espacio libre abajo para el texto.

**Prompt.** Prefijo de estilo, más: `Macro photograph of three Peruvian one-sol coins on a light wooden table in soft window light, a blurred dark screen in the background showing a dotted map of Peru in lime-green, a tiny lime reflection on one coin, empty space in the lower third`

**Variante cuadrada (1080 x 1080).** Las tres monedas centradas con el mapa de fondo.

**Texto alternativo.** Tres monedas de un sol sobre una mesa de madera; al fondo, una pantalla desenfocada con un mapa del Perú hecho de puntos verdes. Texto: Tu sol cuenta.

---

## Verificado

Comprobado el 11 de octubre de 2026 con `curl`, la API pública y lectura del código de `frontend/`.

- **Enlaces con respuesta 200:** `vigia-web.vigiaperu.workers.dev`, `/app/mapa`, `/app/financiar`, `/reporte/nuevo` y `github.com/EdwinSotto123/vigia-peru`.
- **19.653 publicados y 265 leídos:** `GET /contratos/resumen` (`total` 19.653; `sin_analizar` 19.388; 19.653 menos 19.388 son 265).
- **4.006 financiables y S/ 3 por lectura:** `GET /financiamiento/estado` (`colaGlobal` 4.006; `tarifa.precioPen` 3).
- **El mapa muestra quién gobierna, cuánto se contrata y qué tanto se vigila:** el explorador de `components/partidos/PartidosExplorador.tsx` y la portada, con las tres lecturas.
- **Se ven las señales con la norma citada:** `components/contratos/DetalleContrato.tsx` ("cada señal lleva su norma citada y la página del documento").
- **Reporte con foto y ubicación, anónimo, confirmado con dos o más reportes independientes del mismo lugar:** `components/Footer.tsx`, `components/landing/Participar.tsx` y `app/(dashboard)/preguntas/page.tsx`.
- **Quien aporta no elige qué se lee y se publica aunque lo señale:** `components/landing/Aliados.tsx` y `components/landing/PodioPortada.tsx`.
- **Sin publicidad ni venta de datos, código abierto:** principios del `README.md` y licencia MIT del repositorio (confirmada en la API de GitHub); el repositorio tiene la sección de temas habilitada (`has_issues` verdadero).
- **Largo del copy:** cada publicación está entre 300 y 700 caracteres (se midió con un script).

**No verificado.** Que la ventana de aporte funcione de punta a punta para una persona nueva (no se creó un aporte real para no ensuciar los datos); que la frase "Ver es gratis" valga para todas las pantallas (vale para el mapa, los contratos y las señales públicas). La calidad visual de las imágenes: se juzga al generarlas, no en este documento.

---

## Producción (Moda)

Producido el 11 de octubre de 2026 en Moda, con el kit de marca `Vigía Perú` (`bk_4JSX8X5P448WGACY8CH2PGA9Q0`) enlazado a cada lienzo. Carpeta de Moda: `Vigía Perú / Campaña Pueblo Esperando / Facebook`. Cada pieza es una página de 1080 x 1350 (4:5) con capas editables: foto, velos de degradado, ojo de puntos de Vigía hecho con elipses, titular en Space Grotesk, aviso y dirección web, y la franja de aguayo al pie. Se descartó una variante cuadrada porque la composición vertical no ganaba nada recortada.

**Modelo elegido: `nano-banana-pro`.** Se compararon `flux-2-pro` y `nano-banana-pro` con el mismo prompt (F1). Flux dio una escena legible pero con un punto verde literal de aspecto artificial; nano-banana-pro respetó la composición (camilla vista por la puerta, cielo vacío arriba) y se ve como una fotografía documental. Las tres fotos se mejoraron con `upscale` x2 (de 928 x 1152 a 1856 x 2304) para que el PNG final no pierda nitidez.

**Créditos de Moda gastados:** unos 164 de 5.620 (siete operaciones de imagen: dos de comparación en F1, tres de generación en F3 y F4, tres de ampliación). El mapa de F2 no usa imagen generada.

| Pieza | Lienzo (editor) | Archivo final | Foto original sin texto | Estado |
|---|---|---|---|---|
| F1 | https://moda.app/canvas/94e460ed-5632-4bd0-aa2b-581a79bae1ac | `facebook/pueblo-esperando/F1_lo-que-no-sale-en-las-noticias_1080x1350@2x.png` | `assets/facebook/F1_posta_de_noche_original_2x.png` | Terminada |
| F2 | https://moda.app/canvas/1890c171-3563-4f0a-af6c-d84102e6bc9c | `facebook/pueblo-esperando/F2_un-mapa-con-tu-pueblo-adentro_1080x1350@2x.png` | No aplica (vectorial) | Terminada |
| F3 | https://moda.app/canvas/d78073e3-72a7-405a-a5c0-51ebb96aad0a | `facebook/pueblo-esperando/F3_de-la-indignacion-a-la-pregunta_1080x1350@2x.png` | `assets/facebook/F3_obra_detenida_original_2x.png` | Terminada |
| F4 | https://moda.app/canvas/cf3bf379-dfd9-4eda-88c6-d97ca071434b | `facebook/pueblo-esperando/F4_tu-sol-cuenta_1080x1350@2x.png` | `assets/facebook/F4_tres_soles_original_2x.png` | Terminada |

Los archivos están en `C:\Users\usuario\Desktop\PROYECTOS\campanas-vigia\` (fuera del repositorio por su peso). Las exportaciones son de 2160 x 2700 px.

### Prompts finales y cambios respecto al copy

- **F1.** Prompt tal como está arriba, con `nano-banana-pro` y relación 4:5. Texto dentro de la imagen: *¿Qué se contrató para tu pueblo?* (sin cambios). Lleva el aviso `Imagen ilustrativa creada con IA. No es un caso real.`
- **F2.** Sin modelo de imagen: el Perú son 1.972 puntos calculados a partir de `frontend/public/assets/mapa/portada-departamentos.v1.json` (rejilla hexagonal). La opacidad de cada punto sale de cuántos contratos tiene su región en la API del 11 de octubre, de modo que el dibujo no inventa nada. El punto marcado "tu pueblo" es solo un recurso visual y no corresponde a ningún lugar real. Texto dentro de la imagen: *Busca tu pueblo en el mapa.* y una línea de contexto: *Cada punto es un lugar donde se firman contratos.*
- **F3.** Cambio de prompt: la primera versión mostraba a una persona que parecía un menor de edad con un celular junto a una obra, y se descartó. El prompt final pide una mujer adulta, de espaldas y de cuerpo entero: `A fictional adult woman in her thirties seen from behind, wearing a simple work jacket, holding a smartphone, standing in a dirt street in front of a half-built concrete structure with exposed rebar and empty wooden scaffolding in a Peruvian highland town at golden hour, no workers visible, light dust in the air, a faint lime-green glow reflected on the phone screen`. Texto dentro de la imagen: *No te indignes en silencio. Pregunta.* (sin cambios). Lleva el aviso de imagen ilustrativa.
- **F4.** Cambio de prompt: las monedas van en el tercio superior y central para dejar el pie libre para el texto. Texto dentro de la imagen: *Tu sol cuenta.* más la línea *Con S/ 3, un contrato deja de esperar.*, que es el titular del copy. La moneda es la de un sol peruano, sin números de cuenta ni QR.

### Observaciones antes de publicar

- La dirección web de las piezas es la raíz del sitio (`vigia-web.vigiaperu.workers.dev`); el enlace exacto de cada publicación (mapa, reporte, aportes) va en el texto del post, como está arriba.
- Las cifras del copy se leyeron el 11 de octubre: vuelve a leerlas el día de publicar. F2 y F4 no llevan cifras dentro de la imagen, salvo "S/ 3" en F4, que sale de la tarifa vigente.
- Las fotos son generadas por IA. En F1 y F3 aparecen una posta y una obra recreadas, no lugares reales; el aviso está dentro de la imagen y también en el copy.
- Una foto generada puede traer detalles raros (manos, letreros). Se revisaron a tamaño completo y a unos 400 px de ancho: sin texto ilegible ni manos deformes. En F4 la moneda muestra el valor "1 sol", que es parte de la moneda real.
- Contraste: el titular sobre las fotos queda sobre un degradado oscuro (blanco y lima sobre carbón, por encima de 4,5 a 1).
