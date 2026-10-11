# Qué puede hacer Moda para la campaña (verificado el 11 de octubre de 2026)

Pruebas reales hechas con el conector de Moda, plan Pro, y con el pipeline local de audio. Cada fila dice si se **verificó con una prueba**, cómo se hace y qué límite tiene. Lo que no se probó está marcado así, no se afirma.

Lienzos de prueba (equipo `simplia.store`, carpeta `Vigía Perú/Campañas/_pruebas`):

- Video 9:16, audio, movimiento y subtítulos: https://moda.app/canvas/6a729fac-5747-4a07-90b2-8e9671b8a762
- Imagen 4:5 con texto editable: https://moda.app/canvas/8a4fd401-6dcd-4551-997b-b7ba84694f8a

## Resumen en cinco líneas

1. **Moda no genera audio ni video.** Genera imágenes (24 modelos) dentro de un lienzo editable y las anima con claves de movimiento. La voz y la música se hacen fuera y se mezclan con `ffmpeg`.
2. **El audio sí puede viajar dentro de una exportación de Moda** con un truco verificado: un mp4 «portador» con la mezcla como pista de audio, colocado como video sin silenciar. Para un video completo es más simple y exacto mezclar con `ffmpeg` después (recomendado).
3. **Las transiciones entre escenas no existen en la exportación de secuencia** (cortes secos, según la guía de Moda): se hacen dentro de cada página (fundidos, barridos, empujes).
4. **Subtítulos palabra por palabra:** un solo texto con la receta `recipe-fade-word`; verificado cuadro a cuadro.
5. **Mejor relación calidad y precio para fotos cinematográficas:** `flux-2-pro` (3 créditos por imagen). Para escenas con atmósfera y tiro de cámara más expresivo: `nano-banana-pro` (14).

## Tabla de capacidades

| Capacidad | Verificado | Cómo | Límite |
|---|---|---|---|
| Lienzo de video vertical 1080 x 1920 | Sí | `canvas_create(category='animation', width=1080, height=1920)`. Cada **página es una escena** con su propia duración | El movimiento solo funciona en lienzos `animation`; en otros se descarta |
| Generar imagen con IA dentro del diseño | Sí | `canvas_edit_image` sobre un rectángulo ya creado: `{kind:'generate', model, prompt, aspect_ratio:'9:16'}` | Hace falta un nodo existente; el texto y el logo se dejan como capas editables. Una imagen generada puede traer rótulos ilegibles: se evita en el prompt |
| Relaciones de aspecto | Sí (9:16 y 4:5) | `aspect_ratio` en la operación | 1:1 y 16:9 no se probaron |
| Empuje lento de cámara (Ken Burns) | Sí | `t.tween(foto, 'scale', [1, 1.14], {durationMs: 8000, easing: 'easeInOut'})` sobre un rectángulo más grande que la página | La escala se ancla en el centro |
| Paralaje por capas | Sí (bruma lima que cruza) | Capas separadas con `t.tween(capa, 'x', [..])` a distinta velocidad | Sin recortes de la imagen en primer plano: para un paralaje real hay que generar capas separadas |
| Texto que aparece palabra por palabra | **Sí, verificado cuadro a cuadro** | Un solo nodo de texto y `t.recipe(nodo, 'recipe-fade-word', {at: 300})` (usa el preajuste `text-kinetic`) | El ritmo lo fija `speed` en palabras por segundo: se calcula con `palabras_por_segundo` de `marcas.json` |
| Texto con otras revelaciones | Documentado, no probado | `recipe-reveal-word`, `recipe-typewriter`, `recipe-scale-word`, `recipe-rise-line` | Los preajustes de texto no se aplican a un nodo creado en la misma llamada: va en una segunda llamada |
| Entradas y salidas | Sí (`opacity-fade-in`, `scale-in`, `tween`) | `t.effect(nodo, 'opacity-fade-in', {startMs, durationMs})`, `recipe-rise`, `recipe-pop-in`, `recipe-slide-in` | Una pista anima un solo nodo; para varios, `t.stagger` |
| Duración de cada escena | Sí | `motion.page('p_a', {durationMs: 8000}, ...)`. Una página sin movimiento dura **5 s** por defecto | Tope de 600 s por película (30 fps) |
| Exportar mp4 de una escena | Sí | `export(format='mp4', page=1, fps=30)` | Un archivo por página; mp4 de 1080 x 1920 h264 con audio aac (si hay portador) |
| Exportar toda la película en un mp4 | Sí | `export(format='mp4', scope='sequence')`: unió una página de 8 s y otra de 5 s en 13 s | Cortes secos entre páginas; las páginas estáticas duran 5 s si no se les da movimiento y duración |
| Transiciones entre páginas | **No existen en la secuencia** (guía de Moda: «Play Seq, hard cuts») | Se hacen dentro de la página: fundido a negro al final (`t.tween(velo, 'opacity', ...)`), barrido o empuje del siguiente plano al inicio | No probé la costura entre páginas con inspección de cuadros |
| **Audio dentro de la exportación de Moda** | **Sí, con un portador** | 1) `ffmpeg`: mp4 negro de 64 x 64 con la mezcla como audio. 2) `upload(filename)` mint link, `curl -X PUT` del archivo, `upload(storage_key)`. 3) `<video src="file_..." width="64" height="64">` sin `muted`, y `t.video(nodo, {startMs: 0})`. 4) Exportar: el mp4 llevó una pista aac y un tono de 440 Hz medido con FFT | El portador dura lo que su clip: un portador por página. Con varias páginas son varios archivos |
| Pistas de audio en la línea de tiempo (Main Edit) | **No disponible en este conector** | El experto de Moda lo niega para el conector (solo pistas visuales); la guía de exportación sugiere que `scope='main_edit'` mezcla pistas de audio, pero no hay verbo para crearlas | Hacerlo en la app de Moda (a mano) o con `ffmpeg` |
| Subir audio o video | Sí | `upload(filename)` devuelve un enlace; se sube con `curl -X PUT --data-binary @archivo`, y `upload(storage_key=...)` lo confirma y da un `file_...` | El enlace dura 10 minutos |
| Descargar una exportación | Sí | El enlace firmado de `export` se baja con `curl` **tal cual, sin cambiar el nombre del archivo** (el nombre incluye `w0`) | Caduca: re-exportar si vence |
| Subtítulos grabados en el video | Sí | Capas de texto sobre un velo oscuro; el velo evita perder legibilidad sobre una foto clara | Dentro de las zonas seguras de TikTok (x 120 a 840, y 252 a 1742; un anuncio reserva desde y 1400) |
| Marca (kit de Vigía Perú) | Sí | `canvas_create(brand_kit_id='bk_4JSX8X5P448WGACY8CH2PGA9Q0')` | El kit lleva colores y fuentes; el logo se sube aparte |
| Texto dentro de una imagen generada | Parcial | `ideogram-v4` escribió bien «CADA CONTRATO / TIENE UN PUEBLO ESPERANDO», pero **añadió un tercer texto inventado**. Un prompt largo con «PERU» fue rechazado por política de contenido | No se confía en el texto generado: el texto de marca va siempre como capa editable |

## Modelos de imagen: la prueba

Mismo prompt para los cinco: *cinematic documentary photograph, Peruvian Andean village, a dirt road at dusk, a child walking to school, warm ochre light, shallow depth of field, film grain* (9:16). Después, una segunda tanda con escenas de la campaña (posta de noche, aula con goteras, joven con celular en una plaza, manos con un contrato).

| Modelo | Créditos por imagen* | Calidad en la prueba | Recomendado para |
|---|---|---|---|
| `flux-2-pro` | **3** | Fotorrealista y cinematográfico: nieve en el cerro, luz de dorado a azul, posta de noche con una sola ventana encendida, grano creíble | **Plano base de casi todas las escenas** (paisajes, pueblos, edificios) |
| `nano-banana-pro` | 14 | La más atmosférica y con mejor sentido de cámara (niña vista de espaldas, aula con goteras y charco) | Escenas clave de emoción: los planos que se recuerdan |
| `seedream-v5-pro` | 7 | Muy nítida, rostros y manos buenos (primer plano de un niño; joven con celular); algo «de banco de fotos» | Retratos y primeros planos de personas |
| `gpt-image-2` | 27 | Cálida pero con aire de ilustración digital; el papel del contrato salió con texto falso en inglés | No se recomienda: caro y menos creíble |
| `ideogram-v4` | 1 a 2 | Buen texto grande en español, pero lo adornó con letras sobrantes | Solo carteles tipográficos, y revisando cada letra |

\* Los créditos se midieron leyendo `credits_remaining` (la cotización con `quote=true` no devuelve el precio por imagen, solo el saldo) antes y después de cada generación. **Es una medición aproximada**: la cuenta es de un equipo y otros procesos generaban imágenes en paralelo. Saldo al empezar las pruebas: 5.691 créditos.

**Coherencia entre escenas.** Los modelos no recuerdan el personaje entre imágenes. Para que una serie se vea de una sola película: mismo bloque de estilo en todos los prompts (lente, grano, paleta «carbón profundo con un acento cálido»), misma hora del día, misma región, y una sola dirección de color final aplicada en Moda con el velo oscuro y el destello lima. Los personajes se evitan de frente: de espaldas, en perfil, en plano cerrado de manos o de zapatos, que es también lo más seguro frente a rostros inventados.

## Lo que hay que saber antes de producir

- **Moda no genera audio ni video.** No existe voz, música ni efectos dentro de Moda por este conector.
- **Zonas seguras de TikTok** en 1080 x 1920: texto dentro de x 120 a 840 e y 252 a 1742.
- **Las páginas cambian de identificador** tras cada `canvas_apply_markup` (`p_a` sigue valiendo como alias). Usa siempre los identificadores que devuelve la última escritura.
- **El diseño y el movimiento van en dos llamadas.** Los preajustes de texto y algunos efectos se saltan sobre nodos creados en la misma llamada.
- **Las exportaciones estáticas (png, pdf) de páginas con video o animación salen en blanco o congeladas.** Para movimiento: mp4 o gif.

## Flujo recomendado (TikTok)

`guion JSON -> generar_voz.py -> duraciones por escena (marcas.json) -> escenas en Moda con esas duraciones -> export mp4 silencioso (secuencia) -> mezclar.py -> verificación con ffprobe`

Los scripts y el paso a paso están en [`backend/scripts/campana/README.md`](../../backend/scripts/campana/README.md).
