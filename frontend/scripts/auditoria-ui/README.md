# Auditoría de densidad de la UI

Mide, pantalla por pantalla, cuánto espacio se desperdicia en la app interna (`/app/**`) y en el panel
(`/admin/**`): **cajas grandes con poco texto, huecos verticales, bloques con altura mínima forzada, vacío en la
primera pantalla y tablas ralas**. Usa el CLI [`agent-browser`](https://github.com/vercel-labs/agent-browser)
(Chrome por CDP, sin Playwright) para abrir cada ruta en escritorio (1440x900) y móvil (390x844).

## Repetir la auditoría

```bash
# 1. Un frontend corriendo (el mismo código que quieres medir). Sin tocar el :3000 de nadie:
cd frontend
NEXT_DIST_DIR=.next-auditoria \
VIGIA_API_URL=https://vigia-api.vigiaperu.workers.dev \
NEXT_PUBLIC_VIGIA_API_URL=https://vigia-api.vigiaperu.workers.dev \
npx next dev -p 3300

# 2. Auditar todo y comparar con la línea base
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta ultima
```

Sale `docs/auditoria-ui/ULTIMA.md` (informe), `datos/ultima/*.json` (una medición por ruta y ancho) y
`img/ultima/*.jpg` (capturas de página completa).

| Opción | Qué hace |
| --- | --- |
| `--rutas app,admin` | Grupos o ids de ruta. Por defecto los dos grupos. |
| `--solo app-mapa,admin-pagos` | Solo esas rutas (ids en `rutas.mjs`). Sirve para iterar rápido sobre lo que refactorizas. |
| `--etiqueta nombre` | Subcarpeta de salida y nombre del informe. `linea-base` escribe `LINEA_BASE.md`. |
| `--comparar etiqueta` | Compara el puntaje con otra etiqueta (por defecto `linea-base`; `ninguna` lo desactiva). |
| `--salida carpeta` | Carpeta de salida (por defecto `docs/auditoria-ui`). |
| `--base url` | Dónde corre el frontend (por defecto `http://localhost:3300`). |
| `--anchos 1440` | Solo un ancho (`1440` o `390`). |
| `--sin-captura` | No guarda imágenes (más rápido). |
| `--espera 1800` | Milisegundos de espera tras abrir cada ruta. |

## Qué se mide

La medición corre **dentro de la página** (`medir.js`) y solo cuenta el contenido de `<main>`: el menú lateral y
la cabecera no entran.

- **Caja rala:** elemento con borde, fondo o sombra, de al menos 160x72 px, con
  - área de 40.000 px² o más, menos de 120 caracteres y sin medios (imagen, gráfico, campos) que la llenen, o
  - más de 55 % de **vacío interno** (área sin texto ni medios, a 8 px de resolución con un margen de 12 px).
  Si una caja rala contiene otra rala de tamaño parecido, se reporta solo la más interna.
- **Hueco vertical:** más de 72 px entre dos hermanos apilados. Los **separadores de sección** (entre
  `section`, `header`, `footer`, `h1` a `h3`, o hijos directos de `main`) se marcan como exentos y no cuentan.
- **min-height forzada:** bloque cuya `min-height` (160 px o más) es la que manda y cuyo contenido llena menos de
  la mitad.
- **Vacío del primer viewport:** porcentaje del primer viewport de `<main>` que queda a más de 32 px de cualquier
  texto o medio (rejilla de 24 px). El relleno normal de una tarjeta no cuenta como vacío.
- **Tablas ralas:** una sola fila, o filas de más de 72 px en promedio.

### Puntaje de desperdicio (más bajo es mejor)

`puntaje = Σ área desperdiciada de ralas, huecos y min-h (en miles de px²) + vacío inicial (en puntos %) + 10 por tabla rala`

### Aprobado por ruta (en los dos anchos)

1. 0 cajas ralas de más de 40.000 px².
2. Vacío del primer viewport menor a 25 %.
3. 0 huecos de más de 72 px fuera de separadores de sección.
4. 0 bloques con min-height forzada y poco contenido (desperdicio de 40.000 px² o más).
5. 0 tablas ralas.

Los umbrales están en `auditar.mjs` (`UMBRALES`). Si cambias uno, vuelve a medir la línea base.

## Archivos

| Archivo | Para qué |
| --- | --- |
| `auditar.mjs` | Orquestador: abre, mide, captura, puntúa y escribe el informe. |
| `medir.js` | Medición dentro de la página (se inyecta con `agent-browser eval`). |
| `rutas.mjs` | Lista de rutas y anchos. Los ids reales (contrato, entidad, partido) se piden a la API. |
| `sesion-admin.mjs` | Firma la cookie de sesión admin local igual que `lib/admin-sesion.ts`. |

## Para /admin

El panel pide sesión. La herramienta firma una cookie HS256 con `ADMIN_SESSION_SECRET` de `frontend/.env.local`
(gitignored) y la pasa al navegador por stdin, no por argumentos. **La llave y la cookie nunca se imprimen ni se
guardan.** Sin esa llave, las rutas de `/admin` se miden tal como las ve alguien sin sesión (la pantalla de
ingreso). Esa cookie vale también contra producción si `.env.local` trae la llave de producción: trátala como
una credencial.

## Trampas conocidas

- **No uses tuberías** con `agent-browser` (`| tail`, `| head`): el proceso en segundo plano hereda la tubería y el
  comando no termina. La herramienta redirige a archivos. Si el navegador se queda colgado:
  `agent-browser close --all` y, si hace falta, `taskkill /F /IM agent-browser-win32-x64.exe` en Windows.
- En `next dev` la primera visita a cada ruta compila (hasta 20 s). La herramienta precalienta antes de medir.
- Los datos salen de la API pública en vivo: dos corridas pueden diferir si cambian los datos.
- Rutas que piden cuenta (`/app/mi-impacto`, `/app/configuracion`) se miden con lo que ve alguien sin sesión.
