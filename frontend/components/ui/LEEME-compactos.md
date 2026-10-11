# Componentes compactos (refactor de densidad, octubre 2026)

Úsalos en vez de cajas altas con poco texto. La herramienta `frontend/scripts/auditoria-ui/` mide el resultado.

- **`CifrasEnFila`** (`components/ui/CifrasEnFila.tsx`): 1 a 4 cifras en una fila de unos 48 px, con filetes entre cifras y sin una caja por cifra. Props por cifra: `valor` (null = "Sin dato"), `etiqueta`, `contexto`, `ayuda`, `tono`, `href`, `marca`; props de la franja: `items`, `pie`, `className`. `CifrasEnFilaSkeleton` es su esqueleto.
- **`Indicadores`** (`components/listado/Indicadores.tsx`) ya delega en `CifrasEnFila`: mismas props de siempre, así que no hay que migrar sus llamadas.
- **`EstadoVacio`** (`components/ui/EstadoVacio.tsx`): ícono chico + una frase + un enlace opcional. `variante="franja"` (una línea, sin caja) o `"compacta"` (filete a la izquierda, máx. ~72 px). Nunca una caja alta.
- **Regla:** ninguna caja con borde o fondo mayor de 40.000 px² con menos de 120 caracteres ni con más de 55 % de vacío interno. Primer viewport con menos de 25 % de vacío.
- Cifras importantes arriba; las secundarias, a un clic (`<details>` o ⓘ).
- Repetir la medición: `node frontend/scripts/auditoria-ui/auditar.mjs --solo <rutas>` (ver su README).
