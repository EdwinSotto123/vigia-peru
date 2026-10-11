# Auditoría de densidad de la UI: final

Generado el 2026-10-11 13:34 UTC contra `http://localhost:3300`. Sesión admin: **ok**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta final
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 27 de 40 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/admin`](#admin-resumen) | 719 | no | 1040 | no | 1010 | 79 % | 4 | +820 |
| [`/admin/analisis`](#admin-analisis) | 804 | no | 1 | sí | 1077 | 74 % | 1 | +789 |
| [`/app/alertas`](#app-alertas) (pide cuenta) | 793 | no | 3 | sí | 900 | 88 % | 1 | +648 |
| [`/app/mi-impacto`](#app-mi-impacto) | 261 | no | 8 | sí | 900 | 90 % | 1 | -50 |
| [`/admin/pagos`](#admin-pagos) | sin dato | sin dato | 124 | no |  |  |  | -204 |
| [`/app/auditoria/1248872`](#app-auditoria-ficha) | 123 | no | 82 | no | 900 | 72 % | 3 | +0 |
| [`/app/convocatoria`](#app-convocatoria) | 57 | no | 6 | sí | 1987 | 57 % | 0 | -89 |
| [`/app/financiar/entidad/20406325815`](#app-financiar-entidad) | 25 | no | 6 | sí | 4847 | 25 % | 0 | +1 |
| [`/app/financiar/partido/partido-democratico-somos-peru?anio=2022`](#app-financiar-partido) | 24 | sí | 4 | sí | 1176 | 24 % | 0 | -18 |
| [`/app/aliados`](#app-aliados) | 24 | sí | 2 | sí | 954 | 24 % | 0 | -927 |
| [`/reporte/nuevo?modo=entidad`](#app-reporte-entidad) | 24 | sí | 8 | sí | 998 | 24 % | 0 | nueva |
| [`/app/entidades`](#app-entidades) | 22 | sí | 4 | sí | 1453 | 22 % | 0 | -84 |
| [`/reporte/nuevo`](#app-reporte) | 22 | sí | 11 | sí | 1055 | 22 % | 0 | nueva |
| [`/entidad/20406325815`](#app-entidad-ficha) | 21 | sí | 9 | sí | 1394 | 21 % | 0 | nueva |
| [`/app/financiar/21`](#app-financiar-zona) | 20 | sí | 12 | sí | 1158 | 20 % | 0 | -68 |
| [`/app/partidos/partido-democratico-somos-peru?anio=2022`](#app-partido-ficha) | 19 | sí | 7 | sí | 2122 | 19 % | 0 | -180 |
| [`/admin/revision/92a7c528-fca2-4068-bc48-0f2651641028`](#admin-revision-ficha) | 19 | sí | 4 | sí | 1180 | 19 % | 0 | -938 |
| [`/app/configuracion`](#app-configuracion) | 18 | sí | 5 | sí | 992 | 18 % | 0 | -306 |
| [`/admin/clasificacion`](#admin-clasificacion) | 17 | sí | 8 | sí | 1096 | 17 % | 0 | -264 |
| [`/admin/equipo`](#admin-equipo) | 17 | sí | 10 | sí | 921 | 17 % | 0 | -158 |
| [`/admin/cobertura`](#admin-cobertura) | 16 | sí | 16 | no | 2200 | 16 % | 0 | -316 |
| [`/app/contratos/1248872`](#app-contrato-leido) | 15 | sí | 7 | sí | 1385 | 15 % | 0 | -193 |
| [`/app/contratos/2026-747-22`](#app-contrato-sin-leer) | 14 | sí | 8 | sí | 976 | 14 % | 0 | -217 |
| [`/app/denuncias`](#app-denuncias) | 13 | sí | 0 | sí | 986 | 13 % | 0 | -242 |
| [`/app/partidos`](#app-partidos) | 11 | sí | 1 | sí | 2059 | 11 % | 0 | -586 |
| [`/app`](#app-inicio) | 10 | sí | 7 | sí | 1616 | 10 % | 0 | -23 |
| [`/app/financiar?por=partido&anio=2022`](#app-financiar-por-partido) | 10 | sí | 0 | sí | 2599 | 10 % | 0 | nueva |
| [`/app/financiar?por=partido&anio=2022&region=15`](#app-financiar-por-partido-region) | 10 | sí | 0 | sí | 2599 | 10 % | 0 | nueva |
| [`/app/contratos`](#app-contratos) | 9 | sí | 1 | sí | 3753 | 9 % | 0 | -42 |
| [`/app/hallazgos`](#app-hallazgos) | 9 | sí | 3 | sí | 2096 | 9 % | 0 | -136 |
| [`/app/auditoria`](#app-auditoria) | 9 | sí | 6 | sí | 960 | 9 % | 0 | -157 |
| [`/app/financiar`](#app-financiar) | 8 | sí | 2 | sí | 1854 | 8 % | 0 | -768 |
| [`/admin/bitacora`](#admin-bitacora) | 4 | sí | 8 | sí | 1140 | 4 % | 0 | -25 |
| [`/app/financiar/entidad`](#app-financiar-entidades) (pide cuenta) | 5 | sí | 2 | sí | 1906 | 5 % | 0 | -14 |
| [`/app/financiar?por=entidad`](#app-financiar-por-entidad) | 5 | sí | 2 | sí | 1906 | 5 % | 0 | nueva |
| [`/admin/revision`](#admin-revision) | 0 | sí | 5 | sí | 1745 | 0 % | 0 | -6 |
| [`/app/mapa`](#app-mapa) | sin dato | sin dato | 4 | sí |  |  |  | -332 |
| [`/admin/financiadores`](#admin-financiadores) | sin dato | sin dato | sin dato | sin dato |  |  |  | -114 |
| [`/admin/contribuciones`](#admin-contribuciones) | sin dato | sin dato | sin dato | sin dato |  |  |  | -194 |
| [`/admin/procesamientos`](#admin-procesamientos) | sin dato | sin dato | 0 | sí |  |  |  | -11 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |
| vacío interno alto | 23 |
| poco texto en caja grande | 13 |

Clases de Tailwind que más aparecen en las cajas ralas:

`gap-2` (17), `py-3` (17), `p-4` (7), `gap-3` (6), `p-5` (1), `py-2.5` (1)

Componentes con más cajas ralas:

| Archivo | Cajas ralas |
| --- | --- |
| `frontend/components/admin/ui/Skeleton.tsx` | 9 |
| `frontend/components/patrones/Estados.tsx` | 9 |
| `frontend/app/(dashboard)/app/page.tsx` | 4 |
| `frontend/app/not-found.tsx` | 4 |
| `frontend/app/(dashboard)/app/mapa/page.tsx` | 2 |
| `frontend/app/(dashboard)/app/alertas/page.tsx` | 2 |
| `frontend/app/(dashboard)/app/configuracion/page.tsx` | 1 |
| `frontend/app/(dashboard)/app/mi-impacto/page.tsx` | 1 |
| `frontend/app/admin/cobertura/page.tsx` | 1 |
| `frontend/app/admin/contribuciones/page.tsx` | 1 |

## Detalle por ruta

### /admin
<a id="admin-resumen"></a>

**1440 px:** puntaje 719, no aprueba. Alto 1010 px, vacío inicial 79 %, 201 caracteres (1.9 por 10.000 px²).
Fallos: 4 cajas ralas > 40.000 px²; vacío inicial 79 %.

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.min-w-0.space-y-5 > section.scroll-mt-24.min-w-0 > div#:R6dufefj6:.mt-2 > div.overflow-hidden.rounded-2xl.border` | 561x370, 50 car., vacío 91 % | Cargando… Contando los que esperan financiamiento… | frontend/components/admin/ui/Skeleton.tsx:6, frontend/components/patrones/Estados.tsx:100 |
| rala (poco texto en caja grande) | `div.grid.items-start.gap-5 > section.scroll-mt-24.min-w-0 > div#:R1dufefj6:.mt-2 > div.overflow-hidden.rounded-2xl.border` | 561x276, 9 car., vacío 97 % | Cargando… | frontend/components/admin/ui/Skeleton.tsx:6, frontend/components/patrones/Estados.tsx:100 |
| rala (poco texto en caja grande) | `div.grid.items-start.gap-5 > section.scroll-mt-24.min-w-0 > div#:R2hufefj6:.mt-2 > div.overflow-hidden.rounded-2xl.border` | 561x276, 9 car., vacío 97 % | Cargando… | frontend/components/admin/ui/Skeleton.tsx:6, frontend/components/patrones/Estados.tsx:100 |
| rala (poco texto en caja grande) | `div.grid.items-start.gap-5 > section.scroll-mt-24.min-w-0 > div#:R1hufefj6:.mt-2 > div.overflow-hidden.rounded-2xl.border` | 561x276, 9 car., vacío 97 % | Cargando… | frontend/components/admin/ui/Skeleton.tsx:6, frontend/components/patrones/Estados.tsx:100 |

**390 px:** puntaje 1040, no aprueba. Alto 2199 px, vacío inicial 68 %, 201 caracteres (2.7 por 10.000 px²).
Fallos: 4 cajas ralas > 40.000 px²; vacío inicial 68 %.

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.min-w-0.space-y-5 > section.scroll-mt-24.min-w-0 > div#:R6dufefj6:.mt-2 > div.overflow-hidden.rounded-2xl.border` | 348x490, 50 car., vacío 89 % | Cargando… Contando los que esperan financiamiento… | frontend/components/admin/ui/Skeleton.tsx:6, frontend/components/patrones/Estados.tsx:100 |
| rala (poco texto en caja grande) | `div.grid.items-start.gap-5 > section.scroll-mt-24.min-w-0 > div#:R1dufefj6:.mt-2 > div.overflow-hidden.rounded-2xl.border` | 348x376, 9 car., vacío 97 % | Cargando… | frontend/components/admin/ui/Skeleton.tsx:6, frontend/components/patrones/Estados.tsx:100 |
| rala (poco texto en caja grande) | `div.grid.items-start.gap-5 > section.scroll-mt-24.min-w-0 > div#:R2hufefj6:.mt-2 > div.overflow-hidden.rounded-2xl.border` | 348x376, 9 car., vacío 96 % | Cargando… | frontend/components/admin/ui/Skeleton.tsx:6, frontend/components/patrones/Estados.tsx:100 |
| rala (poco texto en caja grande) | `div.grid.items-start.gap-5 > section.scroll-mt-24.min-w-0 > div#:R1hufefj6:.mt-2 > div.overflow-hidden.rounded-2xl.border` | 348x376, 9 car., vacío 96 % | Cargando… | frontend/components/admin/ui/Skeleton.tsx:6, frontend/components/patrones/Estados.tsx:100 |
| rala (vacío interno alto) | `div.overflow-hidden.rounded-2xl.border > div > div.divide-y.divide-line > div.flex.flex-col.gap-2` | 346x75, 0 car., vacío 100 % |  |  |

### /admin/analisis
<a id="admin-analisis"></a>

**1440 px:** puntaje 804, no aprueba. Alto 1077 px, vacío inicial 74 %, 690 caracteres (6 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 74 %.

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.space-y-6 > div.space-y-6 > section.space-y-3 > div.overflow-hidden.rounded-2xl.border` | 1142x639, 0 car., vacío 100 % |  |  |

**390 px:** puntaje 1, aprueba. Alto 3716 px, vacío inicial 1 %, 8915 caracteres (67.3 por 10.000 px²).

### /app/alertas
<a id="app-alertas"></a>

**1440 px:** puntaje 793, no aprueba. Alto 900 px, vacío inicial 88 %, 385 caracteres (3.6 por 10.000 px²). Redirige a `/app/hallazgos`.
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 88 %.

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `main#contenido.min-w-0.flex-1 > div.w-full.px-4.py-6 > div.space-y-5 > div.overflow-hidden.rounded-2xl.border` | 1104x639, 0 car., vacío 100 % |  |  |

**390 px:** puntaje 3, aprueba. Alto 3074 px, vacío inicial 3 %, 10319 caracteres (89.8 por 10.000 px²). Redirige a `/app/hallazgos`.

### /app/mi-impacto
<a id="app-mi-impacto"></a>

**1440 px:** puntaje 261, no aprueba. Alto 900 px, vacío inicial 90 %, 322 caracteres (3 por 10.000 px²). Nota: pide cuenta: se audita lo que ve alguien sin sesión.
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 90 %.

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.flex.min-h-screen.flex-col > main#contenido.min-w-0.flex-1 > div.w-full.space-y-6.px-4 > div.rounded-2xl.border.border-line` | 1104x164, 19 car., vacío 95 % | Cargando tu cuenta… | frontend/app/(dashboard)/app/configuracion/page.tsx:91, frontend/app/(dashboard)/app/mi-impacto/page.tsx:61 |

**390 px:** puntaje 8, aprueba. Alto 2271 px, vacío inicial 8 %, 2209 caracteres (26.2 por 10.000 px²). Nota: pide cuenta: se audita lo que ve alguien sin sesión.

### /admin/pagos
<a id="admin-pagos"></a>

**390 px:** puntaje 124, no aprueba. Alto 844 px, vacío inicial 79 %, 9 caracteres (1.3 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 79 %.

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.fondo-intencion.flex.min-h-screen > div.min-w-0.flex-1 > main#contenido-admin.p-4 > div.rounded-2xl.border.border-line` | 358x144, 9 car., vacío 87 % | Cargando… | frontend/components/admin/ui/Skeleton.tsx:6, frontend/components/patrones/Estados.tsx:100 |

### /app/auditoria/1248872
<a id="app-auditoria-ficha"></a>

**1440 px:** puntaje 123, no aprueba. Alto 900 px, vacío inicial 72 %, 395 caracteres (3.7 por 10.000 px²). Nota: auditoría en vivo de un contrato.
Fallos: vacío inicial 72 %.

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `nav.mt-10.w-full.max-w-2xl > ul.grid.gap-3 > li > a.group.flex.items-center` | 330x78, 20 car., vacío 71 % | Mapa Elige tu región | frontend/app/(dashboard)/app/mapa/page.tsx:21, frontend/app/(dashboard)/app/page.tsx:32 |
| rala (vacío interno alto) | `nav.mt-10.w-full.max-w-2xl > ul.grid.gap-3 > li > a.group.flex.items-center` | 330x78, 24 car., vacío 68 % | Inicio Qué es Vigía Perú | frontend/app/not-found.tsx:28, frontend/app/(dashboard)/app/page.tsx:5 |
| rala (vacío interno alto) | `nav.mt-10.w-full.max-w-2xl > ul.grid.gap-3 > li > a.group.flex.items-center` | 330x78, 29 car., vacío 60 % | Señales Con norma y evidencia | frontend/app/not-found.tsx:27, frontend/app/(dashboard)/app/alertas/page.tsx:5 |

**390 px:** puntaje 82, no aprueba. Alto 947 px, vacío inicial 27 %, 389 caracteres (11.6 por 10.000 px²). Nota: auditoría en vivo de un contrato.
Fallos: vacío inicial 27 %.

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `nav.mt-10.w-full.max-w-2xl > ul.grid.gap-3 > li > a.group.flex.items-center` | 348x78, 20 car., vacío 73 % | Mapa Elige tu región | frontend/app/(dashboard)/app/mapa/page.tsx:21, frontend/app/(dashboard)/app/page.tsx:32 |
| rala (vacío interno alto) | `nav.mt-10.w-full.max-w-2xl > ul.grid.gap-3 > li > a.group.flex.items-center` | 348x78, 24 car., vacío 69 % | Inicio Qué es Vigía Perú | frontend/app/not-found.tsx:28, frontend/app/(dashboard)/app/page.tsx:5 |
| rala (vacío interno alto) | `nav.mt-10.w-full.max-w-2xl > ul.grid.gap-3 > li > a.group.flex.items-center` | 348x78, 29 car., vacío 62 % | Señales Con norma y evidencia | frontend/app/not-found.tsx:27, frontend/app/(dashboard)/app/alertas/page.tsx:5 |

### /app/convocatoria
<a id="app-convocatoria"></a>

**1440 px:** puntaje 57, no aprueba. Alto 1987 px, vacío inicial 57 %, 8729 caracteres (39 por 10.000 px²).
Fallos: vacío inicial 57 %.

**390 px:** puntaje 6, aprueba. Alto 3632 px, vacío inicial 6 %, 8729 caracteres (64.1 por 10.000 px²).

### /app/financiar/entidad/20406325815
<a id="app-financiar-entidad"></a>

**1440 px:** puntaje 25, no aprueba. Alto 4847 px, vacío inicial 25 %, 17572 caracteres (30.9 por 10.000 px²).
Fallos: vacío inicial 25 %.

**390 px:** puntaje 6, aprueba. Alto 6714 px, vacío inicial 6 %, 17572 caracteres (69.4 por 10.000 px²).

### /app/financiar/partido/partido-democratico-somos-peru?anio=2022
<a id="app-financiar-partido"></a>

**1440 px:** puntaje 24, aprueba. Alto 1176 px, vacío inicial 24 %, 2608 caracteres (18.9 por 10.000 px²).

**390 px:** puntaje 4, aprueba. Alto 2309 px, vacío inicial 4 %, 2608 caracteres (30.4 por 10.000 px²).

### /app/aliados
<a id="app-aliados"></a>

**1440 px:** puntaje 24, aprueba. Alto 954 px, vacío inicial 24 %, 3816 caracteres (34.1 por 10.000 px²).

**390 px:** puntaje 2, aprueba. Alto 1931 px, vacío inicial 2 %, 3816 caracteres (53.3 por 10.000 px²).

### /reporte/nuevo?modo=entidad
<a id="app-reporte-entidad"></a>

**1440 px:** puntaje 24, aprueba. Alto 998 px, vacío inicial 24 %, 1573 caracteres (13.4 por 10.000 px²). Nota: formulario de denuncia a una entidad.

**390 px:** puntaje 8, aprueba. Alto 983 px, vacío inicial 8 %, 1573 caracteres (44.3 por 10.000 px²). Nota: formulario de denuncia a una entidad.

### /app/entidades
<a id="app-entidades"></a>

**1440 px:** puntaje 22, aprueba. Alto 1453 px, vacío inicial 22 %, 3044 caracteres (17.8 por 10.000 px²).

**390 px:** puntaje 4, aprueba. Alto 2000 px, vacío inicial 4 %, 3044 caracteres (41.1 por 10.000 px²).

### /reporte/nuevo
<a id="app-reporte"></a>

**1440 px:** puntaje 22, aprueba. Alto 1055 px, vacío inicial 22 %, 1829 caracteres (14.8 por 10.000 px²). Nota: formulario de denuncia de obra, tres columnas.

**390 px:** puntaje 11, aprueba. Alto 1139 px, vacío inicial 11 %, 1829 caracteres (44.1 por 10.000 px²). Nota: formulario de denuncia de obra, tres columnas.

### /entidad/20406325815
<a id="app-entidad-ficha"></a>

**1440 px:** puntaje 21, aprueba. Alto 1394 px, vacío inicial 21 %, 5431 caracteres (33.2 por 10.000 px²). Nota: ficha de una entidad.

**390 px:** puntaje 9, aprueba. Alto 2036 px, vacío inicial 9 %, 5557 caracteres (73.6 por 10.000 px²). Nota: ficha de una entidad.

### /app/financiar/21
<a id="app-financiar-zona"></a>

**1440 px:** puntaje 20, aprueba. Alto 1158 px, vacío inicial 20 %, 3333 caracteres (24.5 por 10.000 px²).

**390 px:** puntaje 12, aprueba. Alto 2183 px, vacío inicial 12 %, 2933 caracteres (36.2 por 10.000 px²).

### /app/partidos/partido-democratico-somos-peru?anio=2022
<a id="app-partido-ficha"></a>

**1440 px:** puntaje 19, aprueba. Alto 2122 px, vacío inicial 19 %, 3309 caracteres (13.3 por 10.000 px²).

**390 px:** puntaje 7, aprueba. Alto 2943 px, vacío inicial 7 %, 3309 caracteres (30.1 por 10.000 px²).

### /admin/revision/92a7c528-fca2-4068-bc48-0f2651641028
<a id="admin-revision-ficha"></a>

**1440 px:** puntaje 19, aprueba. Alto 1180 px, vacío inicial 19 %, 2673 caracteres (21 por 10.000 px²).

**390 px:** puntaje 4, aprueba. Alto 2313 px, vacío inicial 4 %, 2673 caracteres (33.5 por 10.000 px²).

### /app/configuracion
<a id="app-configuracion"></a>

**1440 px:** puntaje 18, aprueba. Alto 992 px, vacío inicial 18 %, 2534 caracteres (21.8 por 10.000 px²). Nota: pide cuenta: se audita lo que ve alguien sin sesión.

**390 px:** puntaje 5, aprueba. Alto 2280 px, vacío inicial 5 %, 2534 caracteres (29.9 por 10.000 px²). Nota: pide cuenta: se audita lo que ve alguien sin sesión.

### /admin/clasificacion
<a id="admin-clasificacion"></a>

**1440 px:** puntaje 17, aprueba. Alto 1096 px, vacío inicial 17 %, 1545 caracteres (13.2 por 10.000 px²).

**390 px:** puntaje 8, aprueba. Alto 1707 px, vacío inicial 8 %, 1545 caracteres (27.5 por 10.000 px²).

### /admin/equipo
<a id="admin-equipo"></a>

**1440 px:** puntaje 17, aprueba. Alto 921 px, vacío inicial 17 %, 2071 caracteres (21.4 por 10.000 px²).

**390 px:** puntaje 10, aprueba. Alto 2290 px, vacío inicial 10 %, 2071 caracteres (26.2 por 10.000 px²).

### /admin/cobertura
<a id="admin-cobertura"></a>

**1440 px:** puntaje 16, aprueba. Alto 2200 px, vacío inicial 16 %, 10606 caracteres (42.6 por 10.000 px²).

**390 px:** puntaje 16, no aprueba. Alto 6941 px, vacío inicial 1 %, 10606 caracteres (41.6 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div#:Rdufnefj6:.mt-2 > div.space-y-3 > div.divide-y.divide-line.rounded-2xl > div.py-2.5` | 314x138, 109 car., vacío 35 % | En proceso 0 financiados: en cola, leyéndose o esp | frontend/app/admin/cobertura/page.tsx:130, frontend/app/admin/contribuciones/page.tsx:43 |

### /app/contratos/1248872
<a id="app-contrato-leido"></a>

**1440 px:** puntaje 15, aprueba. Alto 1385 px, vacío inicial 15 %, 3920 caracteres (24.1 por 10.000 px²). Nota: ficha de un contrato leído.

**390 px:** puntaje 7, aprueba. Alto 3003 px, vacío inicial 7 %, 3920 caracteres (34.9 por 10.000 px²). Nota: ficha de un contrato leído.

### /app/contratos/2026-747-22
<a id="app-contrato-sin-leer"></a>

**1440 px:** puntaje 14, aprueba. Alto 976 px, vacío inicial 14 %, 3017 caracteres (26.3 por 10.000 px²). Nota: ficha de un contrato sin leer.

**390 px:** puntaje 8, aprueba. Alto 2393 px, vacío inicial 8 %, 3017 caracteres (33.9 por 10.000 px²). Nota: ficha de un contrato sin leer.

### /app/denuncias
<a id="app-denuncias"></a>

**1440 px:** puntaje 13, aprueba. Alto 986 px, vacío inicial 13 %, 2144 caracteres (18.5 por 10.000 px²).

**390 px:** puntaje 0, aprueba. Alto 2036 px, vacío inicial 0 %, 2144 caracteres (28.4 por 10.000 px²).

### /app/partidos
<a id="app-partidos"></a>

**1440 px:** puntaje 11, aprueba. Alto 2059 px, vacío inicial 11 %, 2864 caracteres (11.8 por 10.000 px²).

**390 px:** puntaje 1, aprueba. Alto 3766 px, vacío inicial 1 %, 2814 caracteres (19.9 por 10.000 px²).

### /app
<a id="app-inicio"></a>

**1440 px:** puntaje 10, aprueba. Alto 1616 px, vacío inicial 10 %, 4138 caracteres (21.8 por 10.000 px²).

**390 px:** puntaje 7, aprueba. Alto 2789 px, vacío inicial 7 %, 4113 caracteres (39.5 por 10.000 px²).

### /app/financiar?por=partido&anio=2022
<a id="app-financiar-por-partido"></a>

**1440 px:** puntaje 10, aprueba. Alto 2599 px, vacío inicial 10 %, 7458 caracteres (24.4 por 10.000 px²).

**390 px:** puntaje 0, aprueba. Alto 4564 px, vacío inicial 0 %, 7458 caracteres (43.5 por 10.000 px²).

### /app/financiar?por=partido&anio=2022&region=15
<a id="app-financiar-por-partido-region"></a>

**1440 px:** puntaje 10, aprueba. Alto 2599 px, vacío inicial 10 %, 7458 caracteres (24.4 por 10.000 px²).

**390 px:** puntaje 0, aprueba. Alto 4564 px, vacío inicial 0 %, 7458 caracteres (43.5 por 10.000 px²).

### /app/contratos
<a id="app-contratos"></a>

**1440 px:** puntaje 9, aprueba. Alto 3753 px, vacío inicial 9 %, 13942 caracteres (31.6 por 10.000 px²).

**390 px:** puntaje 1, aprueba. Alto 6300 px, vacío inicial 1 %, 13942 caracteres (58.7 por 10.000 px²).

### /app/hallazgos
<a id="app-hallazgos"></a>

**1440 px:** puntaje 9, aprueba. Alto 2096 px, vacío inicial 9 %, 10319 caracteres (41.9 por 10.000 px²).

**390 px:** puntaje 3, aprueba. Alto 3074 px, vacío inicial 3 %, 10319 caracteres (89.8 por 10.000 px²).

### /app/auditoria
<a id="app-auditoria"></a>

**1440 px:** puntaje 9, aprueba. Alto 960 px, vacío inicial 9 %, 3442 caracteres (30.6 por 10.000 px²).

**390 px:** puntaje 6, aprueba. Alto 1490 px, vacío inicial 6 %, 3372 caracteres (61.6 por 10.000 px²).

### /app/financiar
<a id="app-financiar"></a>

**1440 px:** puntaje 8, aprueba. Alto 1854 px, vacío inicial 8 %, 5368 caracteres (24.7 por 10.000 px²).

**390 px:** puntaje 2, aprueba. Alto 4133 px, vacío inicial 2 %, 5368 caracteres (34.6 por 10.000 px²).

### /admin/bitacora
<a id="admin-bitacora"></a>

**1440 px:** puntaje 4, aprueba. Alto 1140 px, vacío inicial 4 %, 6054 caracteres (49.4 por 10.000 px²).

**390 px:** puntaje 8, aprueba. Alto 3138 px, vacío inicial 8 %, 6054 caracteres (54.8 por 10.000 px²).

### /app/financiar/entidad
<a id="app-financiar-entidades"></a>

**1440 px:** puntaje 5, aprueba. Alto 1906 px, vacío inicial 5 %, 7131 caracteres (31.9 por 10.000 px²). Redirige a `/app/financiar?por=entidad`.

**390 px:** puntaje 2, aprueba. Alto 4797 px, vacío inicial 2 %, 7131 caracteres (39.5 por 10.000 px²). Redirige a `/app/financiar?por=entidad`.

### /app/financiar?por=entidad
<a id="app-financiar-por-entidad"></a>

**1440 px:** puntaje 5, aprueba. Alto 1906 px, vacío inicial 5 %, 7131 caracteres (31.9 por 10.000 px²).

**390 px:** puntaje 2, aprueba. Alto 4797 px, vacío inicial 2 %, 7131 caracteres (39.5 por 10.000 px²).

### /admin/revision
<a id="admin-revision"></a>

**1440 px:** puntaje 0, aprueba. Alto 1745 px, vacío inicial 0 %, 24677 caracteres (126.8 por 10.000 px²).

**390 px:** puntaje 5, aprueba. Alto 8459 px, vacío inicial 5 %, 24677 caracteres (78.9 por 10.000 px²).

### /app/mapa
<a id="app-mapa"></a>

**390 px:** puntaje 4, aprueba. Alto 1603 px, vacío inicial 4 %, 6762 caracteres (114.5 por 10.000 px²).

### /admin/financiadores
<a id="admin-financiadores"></a>

### /admin/contribuciones
<a id="admin-contribuciones"></a>

### /admin/procesamientos
<a id="admin-procesamientos"></a>

**390 px:** puntaje 0, aprueba. Alto 13722 px, vacío inicial 0 %, 29556 caracteres (57.7 por 10.000 px²).
