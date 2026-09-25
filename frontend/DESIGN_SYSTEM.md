# Sistema de diseño — Vigía Perú

> Versión 1.0 · 2026-09-25 · Alcance: todo lo que ve el ciudadano (landing, `/app/*`,
> financiar, aliados, informes) y, por herencia de tokens, el panel `/admin`.
>
> Este documento es la fuente de verdad visual. Si el código y este documento no
> coinciden, uno de los dos tiene un bug: se arregla el que esté mal, no se deja
> la diferencia.

---

## 0. La decisión que abre este documento

**Vigía vuelve a su propia identidad: la llamita, la lupa y los colores del Perú.**

Hasta septiembre de 2026 la interfaz hablaba en violeta (`heroViolet #4F3D96`) y
verde (`heroGreen #2FA84C`), mientras el logo —el que ya circula, el de la
cabecera de los PDF, el de las redes— es otra cosa: **VIGIA** en granate, con la
**G** convertida en una **lupa tejida en manta andina** que enmarca una **llama
blanca**. Dos identidades en paralelo se leen como dos productos. El dueño del
producto lo decidió el 2026-09-25: la interfaz se alinea al logo.

Qué cambia y qué no:

| Cambia | No cambia |
|---|---|
| Color de marca: violeta → **granate del logo** | La propuesta de valor y el orden del relato de la landing |
| Acento sobre fondos oscuros: verde → **maíz** (oro andino) | La semántica de severidad (rojo · ámbar · gris) y de estado (verde = positivo) |
| Títulos: serif → **Montserrat**, la geométrica del logotipo | Inter para el texto corrido, JetBrains Mono para códigos |
| Neutros fríos → **neutros apenas cálidos** (tierra, no beige) | El blanco como fondo principal |
| Sin mascota → **la llamita** como guía de estados | Ningún dato inventado, nunca |

Lo que este documento reemplaza: la línea "Paleta comprometida: heroViolet / heroGreen"
de `PRODUCT.md` y el apartado *OWN-WORLD* de `DIRECCION.md` en lo que toca al color.
El resto de ambos documentos sigue vigente.

---

## 1. Estrategia de marca (antes de dibujar nada)

| Pregunta | Respuesta de Vigía |
|---|---|
| **Categoría** | Tecnología cívica de vigilancia de compras públicas. |
| **Audiencia** | El vecino que quiere saber qué pasa con la plata de su distrito (en el celular, en la calle), y el periodista o fiscalizador que necesita la prueba. |
| **Función** | Leer contratos del Estado con agentes, cruzarlos con registros públicos y publicar **señales** con la norma y el documento que las respaldan. |
| **Promesa emocional** | *Alguien está mirando, y te muestra lo que ve.* Calma y vigilancia, no alarma. |
| **Posición cultural** | Profundamente peruana: andina en el símbolo, nacional en el alcance (25 regiones), sobria en el tono. |
| **Nivel de confianza** | Máximo. El producto acusa de opacidad al Estado: un dato inventado o un tono sensacionalista en su propia interfaz lo destruye. |
| **Mundo visual** | Textil andino (manta, tocapu, rombos escalonados), papel limpio, granate del logo, oro del maíz. |
| **Metáfora** | **La llama vigía.** La llama camina alerta, con la cabeza alta y la oreja parada: observa. La **lupa** es el acto de revisar. Juntas: *mirar con atención lo que es de todos.* |
| **Qué evitar** | Rojo de alarma como color de marca · íconos de policía, martillos de juez o sirenas · gradientes "IA" violeta-azul · folclor de postal (sombreros, zampoñas) · la llama como chiste o disfrazada. |

**Una frase para decidir:** si un elemento no ayuda a *ver con claridad lo que es
de todos*, no entra.

---

## 2. La llamita

### 2.1 Qué es

La silueta blanca de la llama del logo, vectorizada desde el isotipo original
(`public/assets/logo/lupa-llama.webp`) — no es un dibujo nuevo: es **la misma
llama**, con su ojo, sus dos orejas y su paso alerta. Vive en
`components/marca/Llamita.tsx` como un `<path>` de ~1 KB (100 vértices), así que
se colorea con `currentColor`, escala sin perder nitidez y pesa nada.

### 2.2 Variantes

| Variante | Componente | Uso |
|---|---|---|
| **Silueta** | `<Llamita />` | Estados vacíos, carga, 404, ilustraciones pequeñas, favicon alternativo. Color: `granate` sobre claro, `paper` o `maiz` sobre oscuro. |
| **Isotipo** | `<Isotipo />` | La marca compacta: disco granate + llama blanca + **anillo textil** + mango de lupa. Cabecera, pie, avatar de redes, favicon. |
| **Firma** | `<Marca />` | Isotipo + "Vigía Perú" en Montserrat. Cabecera y pie. |

### 2.3 Cuándo aparece

La llamita **acompaña**, no decora. Aparece donde el usuario necesita que alguien
le hable:

- **Vacío** — "Todavía no hay contratos leídos en esta zona." La llama mira hacia el texto.
- **Carga larga** (> 1 s) — la llama camina en su sitio (animación de 2 pasos, se detiene con `prefers-reduced-motion`).
- **No encontrado / error** — la llama con la lupa; el texto dice qué pasó y qué hacer.
- **Confirmación** — tras financiar o enviar un reporte.

**Nunca** aparece junto a una señal de riesgo, un nombre, una entidad o un
proveedor: la llama no señala a nadie. **Principio: la llamita vigila; la
evidencia acusa (o no).**

### 2.4 Reglas de construcción

- Tamaño mínimo: **16 px** de alto la silueta; **24 px** el isotipo (por debajo, el anillo textil se vuelve ruido: usar la silueta).
- Área de respeto: la mitad del ancho de la llama alrededor.
- Siempre mirando **a la derecha** (hacia adelante, hacia el contenido). No se espeja.
- Un solo color por silueta. Sin contornos, sombras, degradados ni accesorios.
- Máximo **una** llamita por pantalla.
- Decorativa → `aria-hidden`. Cuando es la marca → `role="img"` + `aria-label="Vigía Perú"`.

---

## 3. Color

### 3.1 Jerarquía de tokens

```
Marca (valor)            → Semántico (propósito)          → Componente (uso)
granate #711C30          → acción primaria, marca, foco   → Button "primario", enlace activo
maiz #F0B83C             → acento sobre oscuro            → cifra destacada en sección oscura
rust #A81E12 (+Texto)    → severidad alta                 → Badge "Señal alta"
```

En los componentes **sólo se usan tokens de Tailwind** (`bg-granate`,
`text-mossTexto`…). Un `#hex` suelto en un `.tsx` es un bug de revisión.

### 3.2 Marca — granate (del logo)

Muestreado de las letras del logotipo (`#711C30`) y del disco del isotipo (`#651121`).

| Token | Hex | Uso | Contraste como texto (paper / paperSoft / paperDeep) |
|---|---|---|---|
| `granate-50` | `#FBF3F5` | fondos de selección muy suaves | — |
| `granate-soft` (100) | `#F6E4E8` | fondo de chips y badges de marca | granate sobre él: **8.99** |
| `granate-200` | `#EBC3CC` | bordes de marca, texto sobre oscuro | sobre granate **6.91**, sobre ink **10.92** |
| `granate-300` | `#D896A5` | ilustración, gráficos | — |
| `granate-400` | `#B85A71` | sólo texto ≥ 24 px o UI (3:1) | 4.43 / 4.08 / 3.75 |
| `granate-500` | `#8E2A45` | hover sobre claro | 8.18 / 7.54 / 6.92 |
| `granate` (600, DEFAULT) | `#711C30` | **marca, acción primaria, enlaces, foco** | **10.99 / 10.12 / 9.29** |
| `granate-deep` (800) | `#4A1020` | hover de botones, secciones oscuras de marca | paper sobre él: **15.15** |
| `granate-900` | `#340B16` | fondo de pie oscuro | — |

Botón primario: `bg-granate text-paper` = **10.99:1**. Foco: anillo `granate`
sobre claro (10.99:1, el piso de UI es 3:1) y `maiz` sobre oscuro (9.61:1).

### 3.3 Acento — maíz (oro andino)

`maiz #F0B83C` · `maiz-soft #FDF3DC`. Es el color que **brilla sobre lo oscuro**:
cifras protagonistas en secciones `bg-ink` o `bg-granate-deep`, el subrayado de un
enlace en el pie, la palabra "Perú" de la firma sobre oscuro.

| Sobre | granate | granate-deep | ink |
|---|---|---|---|
| `maiz` | 6.08 | 8.39 | **9.61** |

**Nunca como texto sobre blanco** (≈ 1.9:1). Sobre claro, el acento es `granate`.
`maiz-soft` sirve de fondo con texto `granate` (9.96) o `ink` (15.73).

### 3.4 Textil — paleta decorativa (del anillo de la lupa)

Muestreada por k-means del anillo tejido del isotipo. **Sólo decoración**: la
franja textil, la ilustración y las series categóricas de gráficos. Nunca
significan estado.

| Token | Hex | Nombre |
|---|---|---|
| `textil-ladrillo` | `#843022` | ladrillo |
| `textil-achiote` | `#B7462A` | achiote |
| `textil-ocre` | `#C47F3E` | ocre |
| `textil-maiz` | `#E2A460` | maíz del tejido |
| `textil-tierra` | `#95612C` | tierra |
| `textil-anil` | `#2D3E6F` | añil |
| `textil-verde` | `#3E7B4F` | verde andino |

Orden para series categóricas (máx. 6): añil, achiote, verde, ocre, granate, tierra.

### 3.5 Rojo Perú — sólo la bandera

`rojoPeru #D91023`. Existe **únicamente** para la franja bicolor (rojo-blanco-rojo)
del pie y del sello "Hecho en Perú". No es un color de interfaz: rojo significa
*riesgo* en este producto, y la marca no puede parecer una alarma.

### 3.6 Neutros — papel y tinta, apenas cálidos

| Token | Hex | Uso |
|---|---|---|
| `paper` | `#FFFFFF` | fondo principal |
| `paperSoft` | `#F8F5F3` | superficies (tarjetas en reposo, filas alternas) |
| `paperDeep` | `#F0EBE8` | hundidos (inputs, barras de filtros) |
| `paperEdge` | `#E3DCD8` | bordes sutiles |
| `line` | `#E9E3DF` | bordes por defecto |
| `ink` | `#1E191B` | texto principal y secciones oscuras (17.35 sobre paper) |
| `inkSoft` | `#463D41` | texto secundario (10.48) |
| `mute` | `#6B6166` | texto terciario (5.95 / 5.49 / **5.03**: pasa en los tres fondos) |

Cálidos por una razón: el negro frío azulado peleaba con el granate. Son grises
tierra con 2–4 % de rojo, **no beige**: el fondo sigue siendo blanco.

### 3.7 Semántica — severidad y estado (sin cambios)

Los colores que dicen **qué encontró el análisis**. Se conservan intactos porque
de ellos depende la credibilidad (ΔE validado entre alta y media ≥ 18).

| Significado | Relleno / punto | Texto (AA en los 3 fondos) |
|---|---|---|
| Señal **alta** | `rust #A81E12` | `rust` (7.34 / 6.77 / 6.21) |
| Señal **media** | `amber #BE7B26` · `amber-soft` | `amberTexto #8A5A15` (5.91 / 5.44 / 5.00) |
| Señal **baja** / sin dato | `mute` · `paperDeep` | `inkSoft` |
| **Positivo** / verificado / publicado | `moss #3F7D43` | `mossTexto #2F6B36` (6.41 / 5.90 / 5.42) |
| **Error** de sistema | `crimson #CF3A2C` · `crimson-soft` | `crimsonTexto #8F2318` |

**Tres canales, siempre:** color + ícono + palabra ("Señal alta"). Nunca color solo.
**La marca no es severidad:** un botón granate jamás comunica riesgo, y una señal
nunca se pinta con granate.

### 3.8 Superficies oscuras

Dos fondos oscuros, con propósito distinto:

- `bg-ink` — secciones de **dato** (cifras de la landing, pie). Acento `maiz`.
- `bg-granate-deep` — momentos de **marca** (cierre de la landing, llamado a financiar). Texto `paper`, acento `maiz`.

Texto secundario sobre oscuro: `text-paper/75` (≥ 6:1). Nada por debajo de `/60`.

### 3.9 Mapas y escalas

El coroplético usa una rampa **añil** (el azul del tejido, `components/mapa/escala.ts`):
`#8DA2DE → #6480CB → #4360B0 → #314781 → #202D54`. **No es granate a propósito**:
los puntos de señal son rojos (`rust`) y un rojo sobre fondo rojizo se pierde; añil
y rojo son tonos opuestos, así que el punto se separa por matiz y no sólo por
brillo. Claro 2.51:1 contra blanco, oscuro 13.42:1, escalones adyacentes ≥ 1.50;
el nombre de cada zona invierte su tinta según el fondo. Sin dato = gris neutro
con trama, nunca un escalón más. La leyenda siempre dice qué mide y de qué fecha
es el dato.

---

## 4. Tipografía

| Rol | Fuente | Pesos | Token |
|---|---|---|---|
| **Display y títulos** | **Montserrat** (la geométrica del logotipo) | 600 · 700 · 800 | `font-display` |
| Texto | Inter | 400 · 500 · 600 | `font-sans` (por defecto) |
| Códigos, RUC, OCID, montos en tabla | JetBrains Mono | 400 · 500 | `font-mono` |

Las tres vienen de `next/font` (autoalojadas, `display: swap`). El serif queda
retirado de la interfaz; el token `font-serif` sólo sobrevive si un texto largo
de dictamen lo pide explícitamente.

### Escala

| Paso | Tamaño / interlínea | Uso |
|---|---|---|
| `display` | 40–56 px / 1.05, `tracking-tight`, 800 | titular del hero |
| `h1` | 30–36 px / 1.15, 700 | título de página |
| `h2` | 22–26 px / 1.2, 700 | sección |
| `h3` | 17–18 px / 1.3, 600 | tarjeta, bloque |
| `body` | 15–16 px / 1.6 | texto corrido (máx. 68 caracteres de ancho) |
| `small` | 13–14 px / 1.5 | metadatos, ayudas |
| `caption` | 11–12 px / 1.4, 500–600 | etiquetas de datos (en mayúsculas sólo si son 1–3 palabras) |

Reglas:

- **Mayúscula inicial**, no Title Case: "Contratos leídos", no "Contratos Leídos".
- Cifras que se comparan: `tabular-nums`.
- Titulares con `text-balance`; párrafos con `text-pretty`.
- `…` (no `...`), comillas « » o “ ”, espacio fino no separable entre número y unidad: `S/ 45 000`, `12 %`.
- Nada de kicker sobre el título ("CONTRATOS" encima de "Todos los contratos").

---

## 5. Espacio, grilla y forma

- Base **4 px**. Escala usada: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96.
- Contenedor: `max-w-6xl` (texto y tablas), `max-w-7xl` (landing). Márgenes laterales `px-4 sm:px-6 lg:px-10`.
- Breakpoints de Tailwind (`sm 640 · md 768 · lg 1024 · xl 1280`). **Se diseña primero a 360 px.**
- Densidad (de `DIRECCION.md`): volumen = **tabla**; objeto con identidad (zona, aliado, dossier) = **tarjeta**.

### Forma (un solo sistema)

| Elemento | Radio |
|---|---|
| Tarjetas, paneles, diálogos | `rounded-2xl` (16 px) |
| Inputs, selects, áreas de texto | `rounded-xl` (12 px) |
| Botones, chips, badges, píldoras de estado | `rounded-full` (la píldora es el gesto de acción del sitio) |
| Imágenes dentro de tarjeta | `rounded-xl` |

### Elevación

Una tarjeta en reposo **no tiene sombra**: borde `line` sobre `paper`. Sombra sólo
para lo que flota: `shadow-card` (hover de tarjeta clickeable), `shadow-dialog`
(diálogos y paneles laterales). Sombras teñidas del tono de la superficie, nunca
negro puro.

---

## 6. Motivo textil — la franja

`components/marca/FranjaTextil.tsx`: una banda de **rombos escalonados** (tocapu)
en la paleta textil, dibujada como patrón SVG repetible (no una imagen).

| Alto | Dónde |
|---|---|
| 4 px | borde superior de la cabecera (la firma del sitio) |
| 8 px | separador entre la landing y el pie; tope de tarjetas de marca (aliado, confirmación) |
| 12–16 px | cierre de secciones de marca en la landing |

Reglas: **una franja por pantalla visible** además de la de la cabecera; nunca
detrás de texto; nunca en tablas, formularios ni informes (el informe es evidencia,
no decoración). `aria-hidden`.

---

## 7. Iconografía

- **lucide-react** (ya en el proyecto), `strokeWidth` 2, tamaños 14 · 16 · 20 · 24.
- Íconos de severidad fijos: alta `AlertTriangle`, media `AlertCircle`, baja `Info`, positivo `CheckCircle2`.
- Íconos decorativos → `aria-hidden`. Botón sólo-ícono → `aria-label`.
- La lupa de la marca **no** es un ícono de búsqueda: el buscador usa `Search` de lucide.

---

## 8. Movimiento

- Duraciones: 120 ms (hover), 200 ms (paneles), 300 ms (entradas). Easing `ease-out` al entrar, `ease-in` al salir.
- Sólo `transform` y `opacity`. Nunca `transition: all`.
- **`prefers-reduced-motion`**: sin desplazamientos, sin la llama caminando, sin contadores animados.
- Sin cascadas de entrada en las páginas de producto (`/app/*`): el usuario entra a una tarea. La coreografía (GSAP) vive sólo en la landing.
- **Nunca `opacity: 0` en el HTML del servidor**: si el JS falla, el contenido tiene que verse.

---

## 9. Estructura del código y reutilización

### 9.1 Carpetas

```
frontend/
  lib/
    formato.ts        ← ÚNICO lugar para formatear dinero, números, fechas, plurales
    severidad.ts      ← severidad → color + ícono + palabra
  components/
    marca/            ← identidad: Llamita, Isotipo, Marca, FranjaTextil
    ui/               ← primitivas sin dominio: Button, Badge, Card, Campo, Pestanas, Panel, Skeleton…
    patrones/         ← composiciones reutilizables del producto: EncabezadoPagina, Seccion,
                        Cifra, EstadoVacio, EstadoError, Cargando, FuenteDato…
    <dominio>/        ← contratos/, convocatoria/, alertas/, financiar/, aliados/, mapa/, landing/…
                        componentes que conocen el dato de ese dominio
  app/                ← páginas: componen patrones y dominio, no definen estilos propios
```

Una página **no** define colores, radios ni tipografías: compone. Si una página
necesita un estilo que no existe, ese estilo se crea en `ui/` o `patrones/` y se
documenta aquí.

### 9.2 Reglas

1. **Tokens, no valores.** Ni `#hex`, ni `text-[#…]`, ni `rounded-[13px]` en componentes de producto.
2. **Un formateador.** Todo monto, fecha y conteo pasa por `lib/formato.ts`. Cinco formatos de soles en la misma columna (auditoría 2026-09-24) es exactamente lo que esto evita.
3. **Server por defecto.** `"use client"` sólo en la hoja que tiene estado o eventos.
4. **Nunca pasar una función de un Server Component a un Client Component** (rompió producción dos veces; ni `tsc` ni `next build` lo detectan). Sólo datos planos y JSX.
5. **≤ 800 líneas por archivo.** Un archivo que crece se parte en piezas con nombre.
6. **Nombres en español**, consistentes con el dominio: `Cifra`, `EstadoVacio`, `FilaContrato`.
7. **Un componente, un propósito.** Variantes por props (`variante`, `tamano`, `tono`), no copias.
8. **Datos personales** siempre por `components/Redact.tsx` (vidrio revelable al clic).

---

## 10. Presentación de la información

Esta es la parte que más pesa: el producto *es* la información. Principio rector
de `PRODUCT.md`: **la evidencia es el producto**.

### 10.1 Una palabra, una definición

La auditoría de coherencia (2026-09-24) encontró la misma palabra contando cosas
distintas en páginas vecinas. Desde ahora:

| Palabra | Significa exactamente | Nunca significa |
|---|---|---|
| **Contratos publicados** | convocatorias del SEACE en la base (18 393) | — |
| **Leídos** | contratos cuyo análisis terminó, por cualquier vía | sólo los financiados; sólo los publicados |
| **Con dictamen publicado** | leídos cuya alerta está publicada | "leídos" |
| **Financiados** | contratos asignados a un aporte | "leídos" |
| **Con señales** | contratos con **al menos una señal publicada** | "puntaje ≥ 40" |
| **Peso del riesgo** (alto · medio · bajo) | tramo del puntaje, **sólo** si hay señales | "sin señales" |
| **Sin señales** | leídos y publicados sin ninguna señal | un check verde sobre un contrato con señal |
| **En revisión** | alertas frenadas para revisión humana (todas) | — ; si se cuentan sólo las financiadas: "financiados en revisión" |
| **En cola** | contratos que esperan financiamiento para leerse | contratos ya leídos |

Si una cifra aparece en dos páginas con la misma palabra, **es el mismo número**.

### 10.2 Cómo se muestra una cifra

- **Siempre con denominador o contexto**: "53 de 100 financiados leídos", no "53".
- **Siempre con su fuente y su fecha** cuando viene de un registro externo: "SEACE · actualizado el 14 de setiembre".
- **Cero es un dato**; **sin dato es otra cosa**: "0 señales" ≠ "Sin dato". Sin dato se escribe "Sin dato", en `mute`, nunca un guion mudo en una cifra protagonista.
- Nada de métrica heroica (número gigante + etiqueta chica) como estructura de página.

### 10.3 Formatos (`lib/formato.ts`)

| Qué | Formato | Ejemplo |
|---|---|---|
| Soles en texto | `S/` + miles con coma, sin decimales ≥ 1 000 | `S/ 45,000` |
| Soles compactos (tarjeta, mapa) | un solo estilo: `mil` y `M` en palabras | `S/ 1.3 M`, `S/ 885 mil` |
| Soles en tabla | sin compactar, `tabular-nums`, alineados a la derecha | `S/ 262,389` |
| Números | `es-PE`: `18,393` | — |
| Porcentajes | entero + espacio fino: `12 %` | — |
| Fechas | `24 de setiembre de 2026`; en tablas `24 set. 2026`; año siempre si no es el actual | — |
| Relativo | sólo < 7 días: "hace 3 h", "ayer"; después, la fecha | — |
| "Hoy" | día de **Lima** (America/Lima), no UTC | — |
| Plurales | `plural(n, "contrato", "contratos")` | "1 contrato", "2 contratos" |

En una misma columna o tarjeta, **un solo formato**.

### 10.4 Severidad y señales

- Una señal se presenta como **patrón + norma + evidencia + fuente**, nunca como adjetivo sobre una persona.
- Etiqueta completa: `[ícono] Señal alta`. Nunca "Corrupción", "Irregular", "Sospechoso".
- El puntaje (0–100) nunca aparece sin las señales que lo explican.
- Una alerta **en revisión** muestra "En revisión" y **nada más**: sin puntaje, sin señales, sin montos cuestionados.

### 10.5 Estados

Toda vista con datos resuelve los cinco:

| Estado | Cómo |
|---|---|
| **Cargando** | esqueleto con la forma del contenido (`Skeleton`); si pasa 1 s, la llamita caminando |
| **Vacío** | `EstadoVacio`: llamita + qué falta + qué hacer ("Financia la lectura de esta zona") |
| **Error** | `EstadoError`: qué pasó en palabras + reintentar; el detalle técnico plegado |
| **Parcial** | se dice qué falta ("Mostrando 200 de 1 204") |
| **Lleno** | el contenido |

### 10.6 Privacidad

DNI y el último apellido de personas **privadas** van en vidrio esmerilado,
revelables sólo con clic o teclado (nunca con hover). Empresas y funcionarios
públicos no se tapan. Nunca se muestra el DNI en claro en un listado.

### 10.7 Densidad: el dato primero, la explicación a un clic

Vigía es una herramienta de datos, no un blog. Cada vista muestra **resultado y
estado**; el "qué significa", el "por qué" y el "cómo se calcula" están a un clic.

| Pieza | Regla |
|---|---|
| Página | `Pagina` (ancho completo, alineada a la izquierda). Nada de `mx-auto max-w-*` por página |
| Bajada del título | **Una** oración, ≤ 140 caracteres. Lo demás va en `ayuda` (ⓘ al final de la bajada; sin bajada, junto al título) |
| Descripción de sección | Una línea o nada; lo demás en `ayuda` de `Seccion` |
| Explicaciones, metodología, avisos | `Ayuda` (ⓘ → flotante) junto a la cifra, la columna o el título que explican. Nunca un párrafo abierto encima del dato |
| Aviso inevitable | Una línea + ⓘ ("1 contrato ya no figura en el OECE ⓘ") |
| Fila o tarjeta de lista | Identidad corta + cifra + estado (chip). Título del contrato en **1 línea** en escritorio (`truncate`, texto completo en `title`) y 2 en celular (`line-clamp-2`). Evidencia o descripción: 1 línea |
| Detalle de un ítem | `Revelar` (panel lateral) o su página. Nunca todo desplegado en la lista |
| Cifras de cabecera | Una línea de datos: "226 de 226 señales · 73 de 97 contratos · última lectura hace 21 h" |
| Motivos, razones, categorías | Chips, con el valor dentro ("Evidencia insuficiente 50 %"); la frase completa en el detalle |
| Centrado | Sólo estados vacíos, 404 y confirmaciones. Una vista de datos se alinea a la izquierda y usa el ancho (tabla o grid) |
| Medida de línea (`max-w-[70ch]`) | Sólo en prosa: dictamen, preguntas frecuentes, noticia |

**Cómo se mide:** en una vista de datos, ningún bloque de texto visible por defecto
supera ~2 líneas (≈ 180 caracteres), salvo el título del objeto en su propia página
y la prosa del dictamen. `Ayuda` lleva texto o `<span className="block">`, nunca
`<p>`/`<div>` (puede ir dentro de una oración).

---

## 11. Catálogo de componentes

### 11.1 Marca (`components/marca/`)

| Componente | Props | Notas |
|---|---|---|
| `Llamita` | `className`, `titulo?`, `caminando?` | `currentColor`; sin `titulo` es decorativa (`aria-hidden`); `caminando` sólo en `Cargando` |
| `Isotipo` | `tamano` (px), `className` | disco granate + llama + anillo textil + mango; < 24 px usar `Llamita` |
| `Marca` | `tono` (`claro`/`oscuro`), `tamano`, `nota?`, `isotipo?` | isotipo + "Vigía Perú"; "Perú" en `granate` (claro) o `maiz` (oscuro) |
| `FranjaTextil` | `alto` (4/8/12/16), `className` | patrón SVG de rombos escalonados; `aria-hidden` |
| `FranjaBandera` | `className` | rojo-blanco-rojo, 3 px; sólo en el pie |

### 11.2 Primitivas (`components/ui/`)

| Componente | Variantes |
|---|---|
| `Button` | `<button>`: `primary` (granate) · `secondary` (borde) · `ghost` · `ink` · `oscuro` (sobre ink/granate: paper con texto granate) · `full`; 40 px de alto |
| `EnlaceAccion` | la misma píldora cuando la acción NAVEGA (`<Link>`; `#ancla` → `<a>`): `primario` · `secundario` · `fantasma` · `oscuro` · `contornoOscuro`; `tamano` `sm` (40 px, producto) · `md` (48) · `lg` (52, portada); `flecha`. `claseAccion()` da las mismas clases a un `<a>` externo |
| `Badge` | `variant`: `marca` · `amber` · `crimson` · `ink` · `neutral`. Etiqueta, no severidad |
| `Severidad` | la severidad de una señal: `score` o `bandera`; `formato` `pastilla` · `linea` · `punto`; siempre color + ícono + palabra |
| `Cifras` | fila de cifras comparables con su contexto |
| `Paginacion` | "Mostrando X–Y de Z" + páginas; por enlaces (`href`) o por estado (`onChange`) |
| `Panel` | `<dialog>` nativo; `posicion` `lateral` · `centro` · `hoja` (desde abajo en el celular) |
| `Revelar` | un disparador que abre un `Panel` con `detalle` ya armado (ReactNode, nunca una función) |
| `Tooltip` / `Popover` | (`Flotante.tsx`) ayuda breve; nunca la única vía a un dato |
| `Skeleton` | forma del contenido; nunca `opacity: 0` inicial |
| `PulseDot` | punto "en vivo"; quieto con movimiento reducido |

Pendientes de extraer (hoy cada vista los arma con clases; al tocarlos, extraer aquí):
`Card` (`interactiva`, `acento` con franja textil), `Campo` (label visible, ayuda,
error en línea, `autocomplete`/`inputMode`), `Pestanas` (`role="tablist"`, flechas).

### 11.3 Patrones (`components/patrones/`)

| Patrón | Qué resuelve |
|---|---|
| `Pagina` | contenedor de toda página de la app: ancho completo, alineado a la izquierda (`ancho="lectura"` sólo para prosa) |
| `EncabezadoPagina` | título (h1) + bajada de una oración + `ayuda` (ⓘ) + acciones; sin kicker |
| `Ayuda` | ⓘ que abre la explicación en un flotante (§10.7); texto o `<span className="block">` |
| `Seccion` | h2 + una línea opcional + `ayuda` + contenido, espaciado vertical fijo |
| `Cifra` | número + etiqueta + contexto obligatorio (denominador o fuente) |
| `EstadoVacio` | llamita + título + texto + acción |
| `EstadoError` | mensaje en palabras + reintentar + detalle plegado |
| `Cargando` | esqueleto; a 1 s, llamita caminando |
| `FuenteDato` | "Fuente: SEACE · 14 set. 2026" con enlace al registro |

---

## 12. Voz y contenido

- **Tuteo**, español peruano, registro llano. "Financia la lectura", no "Financie".
- Voz activa y concreta: "Vigía leyó 53 contratos", no "Se han procesado 53 registros".
- Términos del producto (no se adornan): **señal**, **dictamen**, **convocatoria**, **expediente**, **entidad**, **proveedor**, **aliado**, **zona**.
- **Nunca acusar**: "Señal alta: oferta igual al valor referencial" — no "Contrato sospechoso".
- Sin jerga técnica en la vista del ciudadano (agentes, pipeline, OCID largos, JSON) salvo en "Cómo se hizo", plegado.
- Sin notas internas ("todavía no se lee", "en construcción"): si algo no funciona, no se muestra como si funcionara, y tampoco se explica la cocina.
- Botones con verbo específico: "Financiar la lectura de Lima", no "Continuar".
- Errores con salida: qué pasó + qué hacer.

---

## 13. Accesibilidad (piso, no meta)

- **WCAG 2.2 AA**: texto 4.5:1, texto grande y UI 3:1 (todas las combinaciones de §3 están medidas).
- Foco visible en todo: `focus-visible:ring-2 ring-granate ring-offset-2` sobre claro, `ring-maiz` sobre oscuro.
- Enlace "Saltar al contenido" en cada layout.
- `lang="es-PE"`; un solo `h1` por página; jerarquía de títulos sin saltos.
- Objetivos táctiles ≥ 24 × 24 px (≥ 44 en acciones principales en el celular).
- Todo lo que se hace con el mouse se hace con el teclado — el mapa incluido (lista alternativa de zonas).
- Color nunca solo (severidad con ícono y palabra).
- `aria-live="polite"` en avisos, resultados de filtros y confirmaciones.
- Formularios: label visible, error junto al campo, `autocomplete`, sin bloquear pegar.

---

## 14. Plantillas de página

| Plantilla | Estructura |
|---|---|
| **Landing** | Cabecera (franja 4 px) → hero con la llamita/isotipo y la promesa → relato aprobado → cierre en `granate-deep` → pie con franja bandera |
| **Listado** (`/app/contratos`, entidades, hallazgos) | `EncabezadoPagina` → filtros (chips con conteo) → tabla densa → paginación → `EstadoVacio` si no hay resultados |
| **Detalle** (contrato, informe) | Encabezado con identidad del objeto → veredicto en palabras + señales → evidencia y fuentes → "Cómo se hizo" plegado |
| **Conversión** (financiar, aliados, impacto) | una pregunta por pantalla, cifras con denominador, confirmación con la llamita |
| **Estados de sistema** (404, error, mantenimiento) | llamita con lupa + qué pasó + a dónde ir |

---

## 15. Plan de migración (esta iteración)

1. **Tokens**: `granate`, `maiz`, `textil-*`, `rojoPeru`, neutros cálidos y `font-display` (Montserrat) en `tailwind.config.ts` + `app/layout.tsx`.
2. **Renombre mecánico**: `heroViolet` → `granate`, `heroGreen` → `maiz`, `heroGreenTexto` → `granate`, `font-serif` → `font-display`. Los tokens viejos se eliminan (un alias que miente sobre su color es una trampa).
3. **Revisión de contraste**: todo `text-maiz` sobre fondo claro pasa a `text-granate` (el verde viejo servía en claro como texto grande; el maíz no).
4. **Marca**: `Llamita`, `Isotipo`, `Marca`, `FranjaTextil`, `FranjaBandera` en `components/marca/`.
5. **Patrones**: `EstadoVacio`, `EstadoError`, `Cargando`, `Cifra`, `EncabezadoPagina`, `FuenteDato` en `components/patrones/` y `lib/formato.ts`.
6. **Aplicación por superficie** (en paralelo): chrome (cabecera, pie, navegación), landing, listados y mapa, informe y contrato, financiar/aliados/impacto, estados de sistema.
7. **Verificación**: `tsc`, build de producción, capturas a 1440 y 390 px, contraste y teclado.

### Checklist de revisión (cada PR)

- [ ] Sólo tokens; ningún `#hex` ni valor arbitrario de color/radio.
- [ ] Montos, fechas y conteos por `lib/formato.ts`.
- [ ] Cada cifra con contexto (denominador o fuente) y la palabra correcta de §10.1.
- [ ] Los cinco estados resueltos.
- [ ] Severidad con color + ícono + palabra.
- [ ] Foco visible, teclado, un `h1`, contraste AA.
- [ ] Sin notas internas ni jerga en la vista del ciudadano.
- [ ] La llamita: ≤ 1 por pantalla, nunca junto a una señal o una persona.
- [ ] ≤ 800 líneas por archivo; ninguna función de server a client.

---

## 16. Sí / No

| Sí | No |
|---|---|
| Granate para marca y acción | Granate para decir "riesgo" |
| Maíz para brillar sobre oscuro | Maíz como texto sobre blanco |
| Franja textil como firma, una por pantalla | Textil de fondo detrás de texto o en informes |
| La llamita acompaña vacíos, esperas y errores | La llamita al lado de una señal o de un nombre |
| "Señal alta" con ícono | Sólo un punto rojo |
| "53 de 100 financiados" | "53" suelto |
| "Sin dato" | Un cero inventado |
| Montserrat en títulos, Inter en texto | Una tercera familia "para variar" |
| Rojo Perú en la franja de la bandera | Rojo Perú en botones o alertas |
