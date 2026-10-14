# Auditoría de densidad de la UI: linea-base

Generado el 2026-10-11 07:31 UTC contra `http://localhost:3300`. Sesión admin: **ok**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta linea-base
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 5 de 34 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [`/admin/revision/92a7c528-fca2-4068-bc48-0f2651641028`](#admin-revision-ficha) | 957 | no | 1 | sí | 2368 | 26 % | 6 |
| [`/app/aliados`](#app-aliados) | 951 | no | 184 | no | 1446 | 39 % | 2 |
| [`/app/financiar`](#app-financiar) | 776 | no | 3 | sí | 2491 | 18 % | 1 |
| [`/app/partidos`](#app-partidos) | 597 | no | 9 | sí | 2342 | 41 % | 1 |
| [`/app/mapa`](#app-mapa) | 336 | no | 29 | sí | 1602 | 31 % | 4 |
| [`/admin/cobertura`](#admin-cobertura) | 332 | no | 138 | no | 2531 | 14 % | 5 |
| [`/admin/pagos`](#admin-pagos) | 328 | no | 56 | no | 1084 | 44 % | 2 |
| [`/app/configuracion`](#app-configuracion) | 324 | no | 119 | no | 900 | 84 % | 1 |
| [`/app/mi-impacto`](#app-mi-impacto) | 311 | no | 56 | no | 900 | 82 % | 1 |
| [`/admin/clasificacion`](#admin-clasificacion) | 281 | no | 187 | no | 1255 | 23 % | 5 |
| [`/app/denuncias`](#app-denuncias) | 255 | no | 59 | no | 900 | 81 % | 1 |
| [`/app/contratos/1256450`](#app-contrato-sin-leer) | 231 | no | 6 | sí | 1039 | 43 % | 6 |
| [`/admin`](#admin-resumen) | 220 | no | 152 | no | 1459 | 28 % | 4 |
| [`/app/contratos/1248872`](#app-contrato-leido) | 208 | no | 7 | sí | 1336 | 35 % | 6 |
| [`/app/partidos/partido-democratico-somos-peru?anio=2022`](#app-partido-ficha) | 199 | no | 25 | sí | 2239 | 18 % | 3 |
| [`/admin/contribuciones`](#admin-contribuciones) | 194 | no | 103 | no | 900 | 42 % | 2 |
| [`/admin/equipo`](#admin-equipo) | 175 | no | 45 | no | 900 | 35 % | 2 |
| [`/app/auditoria`](#app-auditoria) | 166 | no | 18 | sí | 900 | 36 % | 4 |
| [`/app/convocatoria`](#app-convocatoria) | 146 | no | 6 | sí | 2206 | 20 % | 4 |
| [`/app/alertas`](#app-alertas) (pide cuenta) | 145 | no | 5 | sí | 2175 | 15 % | 4 |
| [`/app/hallazgos`](#app-hallazgos) | 145 | no | 5 | sí | 2175 | 15 % | 4 |
| [`/app/auditoria/1248872`](#app-auditoria-ficha) | 123 | no | 82 | no | 900 | 72 % | 3 |
| [`/admin/financiadores`](#admin-financiadores) | 114 | no | 48 | no | 900 | 28 % | 3 |
| [`/app/entidades`](#app-entidades) | 106 | no | 4 | sí | 1780 | 25 % | 2 |
| [`/app/financiar/21`](#app-financiar-zona) | 88 | no | 27 | sí | 900 | 46 % | 2 |
| [`/app/contratos`](#app-contratos) | 51 | sí | 1 | sí | 3832 | 12 % | 2 |
| [`/app/financiar/partido/partido-democratico-somos-peru?anio=2022`](#app-financiar-partido) | 42 | sí | 5 | sí | 1257 | 23 % | 1 |
| [`/app`](#app-inicio) | 10 | sí | 33 | no | 1616 | 10 % | 0 |
| [`/admin/bitacora`](#admin-bitacora) | 33 | no | 8 | sí | 1887 | 33 % | 0 |
| [`/app/financiar/entidad/20406325815`](#app-financiar-entidad) | 24 | sí | 7 | sí | 4911 | 24 % | 0 |
| [`/app/financiar/entidad`](#app-financiar-entidades) (pide cuenta) | 13 | sí | 19 | sí | 2535 | 13 % | 0 |
| [`/admin/analisis`](#admin-analisis) | 15 | sí | 1 | sí | 2297 | 15 % | 0 |
| [`/admin/procesamientos`](#admin-procesamientos) | 11 | no | 10 | no | 16613 | 1 % | 0 |
| [`/admin/revision`](#admin-revision) | 11 | no | 5 | sí | 5829 | 1 % | 0 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |
| vacío interno alto | 67 |
| poco texto en caja grande | 46 |
| tabla: filas muy altas | 4 |
| tabla: una sola fila | 1 |

Clases de Tailwind que más aparecen en las cajas ralas:

`py-3.5` (38), `p-3` (18), `gap-3` (12), `p-4` (11), `gap-px` (7), `py-3` (6), `py-10` (3), `gap-1.5` (2), `py-6` (2), `gap-2` (2)

Componentes con más cajas ralas:

| Archivo | Cajas ralas |
| --- | --- |
| `frontend/components/contratos/ContratoDetalle.tsx` | 8 |
| `frontend/app/(dashboard)/app/hallazgos/page.tsx` | 8 |
| `frontend/components/auditoria/EstadoAuditoria.tsx` | 7 |
| `frontend/app/(dashboard)/app/auditoria/page.tsx` | 6 |
| `frontend/app/(dashboard)/app/partidos/[clave]/page.tsx` | 5 |
| `frontend/app/(public)/aliado/[slug]/page.tsx` | 5 |
| `frontend/components/mapa/indicadoresMapa.tsx` | 5 |
| `frontend/app/(dashboard)/app/configuracion/page.tsx` | 5 |
| `frontend/app/(dashboard)/app/mi-impacto/page.tsx` | 5 |
| `frontend/app/(dashboard)/app/aliados/page.tsx` | 5 |
| `frontend/app/admin/page.tsx` | 5 |
| `frontend/app/admin/equipo/page.tsx` | 5 |

## Detalle por ruta

### /admin/revision/92a7c528-fca2-4068-bc48-0f2651641028
<a id="admin-revision-ficha"></a>

**1440 px:** puntaje 957, no aprueba. Alto 2368 px, vacío inicial 26 %, 14207 caracteres (52.9 por 10.000 px²).
Fallos: 4 cajas ralas > 40.000 px²; vacío inicial 26 %.

![/admin/revision/92a7c528-fca2-4068-bc48-0f2651641028 a 1440 px](img/linea-base/admin-revision-ficha-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `main#contenido-admin.p-4 > div.space-y-6 > details.group.rounded-2xl.border > div.space-y-6.border-t.border-line` | 1140x1178, 0 car., vacío 53 % |  |  |
| rala (poco texto en caja grande) | `div > div.mt-2 > ul.space-y-2 > li.rounded-xl.border.border-line` | 1100x181, 0 car., vacío 41 % |  |  |
| rala (vacío interno alto) | `div.overflow-hidden.rounded-2xl.border > div.px-3.py-4 > div.space-y-5 > dl.grid.gap-px.grid-cols-2` | 1092x111, 160 car., vacío 56 % | valor referencial S/ 47 mil presupuesto de la enti | frontend/components/convocatoria/sections/IdentidadDossier.tsx:146, frontend/app/(dashboard)/app/partidos/[clave]/page.tsx:44 |
| rala (poco texto en caja grande) | `div.space-y-5 > div.grid.gap-6 > aside.space-y-3 > div.rounded-2xl.border.border-line` | 300x201, 90 car., vacío 44 % | Datos del proceso | frontend/components/convocatoria/ResultadoView.tsx:293, frontend/components/contratos/ContratoDetalle.tsx:11 |
| rala (vacío interno alto) | `div.px-3.py-4 > div.space-y-5 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x109, 14 car., vacío 79 % | señal 1 1 alta |  |

**390 px:** puntaje 1, aprueba. Alto 4063 px, vacío inicial 1 %, 14207 caracteres (97.1 por 10.000 px²).

![/admin/revision/92a7c528-fca2-4068-bc48-0f2651641028 a 390 px](img/linea-base/admin-revision-ficha-390.jpg)

### /app/aliados
<a id="app-aliados"></a>

**1440 px:** puntaje 951, no aprueba. Alto 1446 px, vacío inicial 39 %, 3459 caracteres (20.4 por 10.000 px²).
Fallos: 2 cajas ralas > 40.000 px²; vacío inicial 39 %.

![/app/aliados a 1440 px](img/linea-base/app-aliados-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.transition-opacity.duration-rapido > div.space-y-4 > section.sobre-oscuro.relative.overflow-hidden > div.fondo-puntos.pointer-events-none.absolute` | 1092x793, 0 car., vacío 63 % |  |  |
| rala (vacío interno alto) | `section.sobre-oscuro.relative.overflow-hidden > div.relative.px-3.pb-6 > div.mx-auto.mt-8.max-w-5xl > ol.grid.grid-cols-3.items-end` | 1012x639, 262 car., vacío 57 % | Vigía Perú La propia plataforma 200 contratos fina | frontend/components/aliados/AliadoAbrir.tsx:167, frontend/components/aliados/RankingAliados.tsx:209 |

**390 px:** puntaje 184, no aprueba. Alto 1855 px, vacío inicial 10 %, 3316 caracteres (48.3 por 10.000 px²).
Fallos: 2 cajas ralas > 40.000 px².

![/app/aliados a 390 px](img/linea-base/app-aliados-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.transition-opacity.duration-rapido > div.space-y-4 > section.sobre-oscuro.relative.overflow-hidden > div.fondo-puntos.pointer-events-none.absolute` | 346x615, 0 car., vacío 49 % |  |  |
| rala (poco texto en caja grande) | `section.sobre-oscuro.relative.overflow-hidden > div.relative.px-3.pb-6 > div.mx-auto.mt-8.max-w-5xl > ol.grid.grid-cols-3.items-end` | 322x461, 113 car., vacío 46 % | Vigía Perú 200 contratos Ver quién es → 1 2 Puesto | frontend/components/aliados/AliadoAbrir.tsx:167, frontend/app/(public)/aliado/[slug]/page.tsx:49 |

### /app/financiar
<a id="app-financiar"></a>

**1440 px:** puntaje 776, no aprueba. Alto 2491 px, vacío inicial 18 %, 5368 caracteres (18.4 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/app/financiar a 1440 px](img/linea-base/app-financiar-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.relative > div.transition-opacity.duration-rapido > div.space-y-3 > div.overflow-clip.rounded-2xl.border` | 722x1671, 1218 car., vacío 63 % | Zona En cola ¿Qué es “en cola”? Costo ¿Qué es el c | frontend/components/financiar/ListaEntidades.tsx:41, frontend/components/financiar/ListaPartidos.tsx:53 |

**390 px:** puntaje 3, aprueba. Alto 4502 px, vacío inicial 3 %, 5368 caracteres (31.7 por 10.000 px²).

![/app/financiar a 390 px](img/linea-base/app-financiar-390.jpg)

### /app/partidos
<a id="app-partidos"></a>

**1440 px:** puntaje 597, no aprueba. Alto 2342 px, vacío inicial 41 %, 2864 caracteres (10.4 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 41 %.

![/app/partidos a 1440 px](img/linea-base/app-partidos-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `main#contenido.min-w-0.flex-1 > div.w-full.px-4.py-6 > section.space-y-4 > ol.divide-y.divide-line.overflow-hidden` | 1094x796, 1013 car., vacío 64 % | 1 Partido Democrático Somos Perú 206 gobiernos, 2, | frontend/app/(dashboard)/app/financiar/page.tsx:255 |

**390 px:** puntaje 9, aprueba. Alto 4019 px, vacío inicial 9 %, 2814 caracteres (18.7 por 10.000 px²).

![/app/partidos a 390 px](img/linea-base/app-partidos-390.jpg)

### /app/mapa
<a id="app-mapa"></a>

**1440 px:** puntaje 336, no aprueba. Alto 1602 px, vacío inicial 31 %, 6240 caracteres (33.2 por 10.000 px²).
Fallos: 4 cajas ralas > 40.000 px²; vacío inicial 31 %.

![/app/mapa a 1440 px](img/linea-base/app-mapa-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.relative.overflow-hidden.rounded-2xl > div.relative.grid.grid-cols-1 > aside.relative.z-mapa.hidden > div.flex.h-full.flex-col` | 459x680, 236 car., vacío 75 % | Ningún departamento abierto | frontend/components/RegionDetailPanel.tsx:74 |
| rala (poco texto en caja grande) | `div.space-y-4 > div > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 363x116, 45 car., vacío 66 % | leídos hoy 0 0 y 0 contratos nuevos del SEACE | frontend/components/auditoria/EstadoAuditoria.tsx:78, frontend/components/mapa/indicadoresMapa.tsx:62 |
| rala (poco texto en caja grande) | `div.space-y-4 > div > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 363x116, 45 car., vacío 65 % | contratos leídos 265 265 de 19,653 publicados | frontend/app/(dashboard)/app/configuracion/page.tsx:393, frontend/app/(dashboard)/app/financiar/page.tsx:527 |
| rala (poco texto en caja grande) | `div.space-y-4 > div > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 363x116, 85 car., vacío 41 % | de riesgo medio o alto ¿Qué se cuenta como riesgo  | frontend/components/mapa/indicadoresMapa.tsx:23, frontend/components/mapa/AlertasDeZona.tsx:31 |

**390 px:** puntaje 29, aprueba. Alto 1691 px, vacío inicial 6 %, 6257 caracteres (100.3 por 10.000 px²).

![/app/mapa a 390 px](img/linea-base/app-mapa-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.space-y-4 > div > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 346x109, 45 car., vacío 61 % | leídos hoy 0 0 y 0 contratos nuevos del SEACE | frontend/components/auditoria/EstadoAuditoria.tsx:78, frontend/components/mapa/indicadoresMapa.tsx:62 |

### /admin/cobertura
<a id="admin-cobertura"></a>

**1440 px:** puntaje 332, no aprueba. Alto 2531 px, vacío inicial 14 %, 13264 caracteres (46 por 10.000 px²).
Fallos: 5 cajas ralas > 40.000 px².

![/admin/cobertura a 1440 px](img/linea-base/admin-cobertura-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div#:R5ufnefj6:.mt-3 > div.space-y-3 > div.grid.gap-3 > section.overflow-hidden.rounded-2xl.border` | 565x155, 68 car., vacío 78 % | Descargados por noche | frontend/app/admin/cobertura/Progreso.tsx:83, frontend/app/(dashboard)/app/auditoria/page.tsx:50 |
| rala (poco texto en caja grande) | `details > div.mt-2 > div.grid.gap-3 > div.rounded-xl.border.border-line` | 565x193, 0 car., vacío 61 % |  |  |
| rala (poco texto en caja grande) | `details > div.mt-2 > div.grid.gap-3 > div.rounded-xl.border.border-line` | 565x193, 0 car., vacío 59 % |  |  |
| rala (poco texto en caja grande) | `details > div.mt-2 > div.grid.gap-3 > div.rounded-xl.border.border-line` | 565x193, 0 car., vacío 58 % |  |  |
| rala (poco texto en caja grande) | `details > div.mt-2 > div.grid.gap-3 > div.rounded-xl.border.border-line` | 565x193, 0 car., vacío 51 % |  |  |

**390 px:** puntaje 138, no aprueba. Alto 7287 px, vacío inicial 3 %, 13264 caracteres (49.5 por 10.000 px²).
Fallos: 5 cajas ralas > 40.000 px².

![/admin/cobertura a 390 px](img/linea-base/admin-cobertura-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `details > div.mt-2 > div.grid.gap-3 > div.rounded-xl.border.border-line` | 348x251, 0 car., vacío 40 % |  |  |
| rala (poco texto en caja grande) | `details > div.mt-2 > div.grid.gap-3 > div.rounded-xl.border.border-line` | 348x193, 0 car., vacío 41 % |  |  |
| rala (poco texto en caja grande) | `details > div.mt-2 > div.grid.gap-3 > div.rounded-xl.border.border-line` | 348x193, 0 car., vacío 37 % |  |  |
| rala (poco texto en caja grande) | `section.overflow-hidden.rounded-2xl.border > div.px-4.pb-4.pt-3 > div.space-y-2 > details.border.border-line.bg-paper` | 314x166, 106 car., vacío 47 % | El expediente lista el documento pero no trae el a | frontend/app/admin/cobertura/Progreso.tsx:33 |
| rala (poco texto en caja grande) | `details > div.mt-2 > div.grid.gap-3 > div.rounded-xl.border.border-line` | 348x193, 0 car., vacío 35 % |  |  |

### /admin/pagos
<a id="admin-pagos"></a>

**1440 px:** puntaje 328, no aprueba. Alto 1084 px, vacío inicial 44 %, 811 caracteres (7 por 10.000 px²).
Fallos: 2 cajas ralas > 40.000 px²; vacío inicial 44 %.

![/admin/pagos a 1440 px](img/linea-base/admin-pagos-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.space-y-8 > section.scroll-mt-24 > div#:r1:.mt-3 > div.rounded-2xl.border.border-line` | 1142x228, 117 car., vacío 86 % | Sin cuentas bancarias Agrega al menos una en soles | frontend/app/admin/pagos/page.tsx:134 |
| rala (poco texto en caja grande) | `section.scroll-mt-24 > div#:r2:.mt-3 > div.grid.gap-4 > div.rounded-2xl.border.border-line` | 563x193, 95 car., vacío 56 % | Correo de contacto para pagos Vacío: el financiado | frontend/app/admin/pagos/page.tsx:169 |

**390 px:** puntaje 56, no aprueba. Alto 1799 px, vacío inicial 10 %, 811 caracteres (13.6 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/admin/pagos a 390 px](img/linea-base/admin-pagos-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.space-y-8 > section.scroll-mt-24 > div#:r1:.mt-3 > div.rounded-2xl.border.border-line` | 348x228, 117 car., vacío 58 % | Sin cuentas bancarias Agrega al menos una en soles | frontend/app/admin/pagos/page.tsx:134 |

### /app/configuracion
<a id="app-configuracion"></a>

**1440 px:** puntaje 324, no aprueba. Alto 900 px, vacío inicial 84 %, 384 caracteres (3.6 por 10.000 px²). Nota: pide cuenta: se audita lo que ve alguien sin sesión.
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 84 %.

![/app/configuracion a 1440 px](img/linea-base/app-configuracion-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.flex.min-h-screen.flex-col > main#contenido.min-w-0.flex-1 > div.w-full.space-y-6.px-4 > div.flex.flex-col.items-center` | 1104x258, 146 car., vacío 84 % | Necesitas una cuenta Aquí se guardan tu perfil de  | frontend/app/(dashboard)/app/configuracion/page.tsx:93, frontend/app/(dashboard)/app/mi-impacto/page.tsx:653 |

**390 px:** puntaje 119, no aprueba. Alto 844 px, vacío inicial 60 %, 384 caracteres (12.4 por 10.000 px²). Nota: pide cuenta: se audita lo que ve alguien sin sesión.
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 60 %.

![/app/configuracion a 390 px](img/linea-base/app-configuracion-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.flex.min-h-screen.flex-col > main#contenido.min-w-0.flex-1 > div.w-full.space-y-6.px-4 > div.flex.flex-col.items-center` | 358x280, 146 car., vacío 59 % | Necesitas una cuenta Aquí se guardan tu perfil de  | frontend/app/(dashboard)/app/configuracion/page.tsx:93, frontend/app/(dashboard)/app/mi-impacto/page.tsx:653 |

### /app/mi-impacto
<a id="app-mi-impacto"></a>

**1440 px:** puntaje 311, no aprueba. Alto 900 px, vacío inicial 82 %, 479 caracteres (4.5 por 10.000 px²). Nota: pide cuenta: se audita lo que ve alguien sin sesión.
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 82 %.

![/app/mi-impacto a 1440 px](img/linea-base/app-mi-impacto-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.flex.min-h-screen.flex-col > main#contenido.min-w-0.flex-1 > div.w-full.space-y-6.px-4 > div.flex.flex-col.items-center` | 1104x258, 179 car., vacío 80 % | Mi impacto necesita una cuenta Sin cuenta puedes v | frontend/app/(dashboard)/app/mi-impacto/page.tsx:650, frontend/app/(public)/login/page.tsx:195 |

**390 px:** puntaje 56, no aprueba. Alto 844 px, vacío inicial 56 %, 479 caracteres (15.4 por 10.000 px²). Nota: pide cuenta: se audita lo que ve alguien sin sesión.
Fallos: vacío inicial 56 %.

![/app/mi-impacto a 390 px](img/linea-base/app-mi-impacto-390.jpg)

### /admin/clasificacion
<a id="admin-clasificacion"></a>

**1440 px:** puntaje 281, no aprueba. Alto 1255 px, vacío inicial 23 %, 2129 caracteres (15.6 por 10.000 px²).
Fallos: 2 cajas ralas > 40.000 px².

![/admin/clasificacion a 1440 px](img/linea-base/admin-clasificacion-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.space-y-10 > section.scroll-mt-24 > div#:R5ufnefj6:.mt-3 > div.rounded-2xl.border.border-line` | 1142x191, 309 car., vacío 57 % | Tipos Bienes Servicios Consultoría Obras Convenio  | frontend/app/(public)/page.tsx:195, frontend/lib/contratos.ts:253 |
| rala (poco texto en caja grande) | `main#contenido-admin.p-4 > div.space-y-10 > div.grid.gap-4 > section.overflow-hidden.rounded-2xl.border` | 563x199, 68 car., vacío 76 % | Por qué no se pueden procesar | frontend/app/admin/clasificacion/page.tsx:265 |
| rala (vacío interno alto) | `div#:Rdufnefj6:.mt-3 > div.space-y-3 > div.grid.gap-2.grid-cols-2 > div.group.relative.flex` | 219x120, 16 car., vacío 66 % | Contratos 19,653 | frontend/app/(dashboard)/app/aliados/page.tsx:29, frontend/app/(dashboard)/app/contratos/loading.tsx:4 |
| rala (vacío interno alto) | `div#:Rdufnefj6:.mt-3 > div.space-y-3 > div.grid.gap-2.grid-cols-2 > div.group.relative.flex` | 219x120, 18 car., vacío 65 % | Procesables 19,653 | frontend/app/admin/clasificacion/page.tsx:43 |
| rala (vacío interno alto) | `div#:Rdufnefj6:.mt-3 > div.space-y-3 > div.grid.gap-2.grid-cols-2 > div.group.relative.flex` | 219x120, 35 car., vacío 58 % | Clasificados 19,653 100 % del total | frontend/app/admin/clasificacion/page.tsx:191, frontend/app/admin/cobertura/page.tsx:128 |

**390 px:** puntaje 187, no aprueba. Alto 2015 px, vacío inicial 6 %, 2129 caracteres (31.4 por 10.000 px²).
Fallos: 7 cajas ralas > 40.000 px².

![/admin/clasificacion a 390 px](img/linea-base/admin-clasificacion-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.space-y-3 > div.space-y-2 > details.rounded-2xl.border.border-line > div.border-t.border-line.px-4` | 346x198, 0 car., vacío 46 % |  |  |
| rala (poco texto en caja grande) | `div.space-y-3 > div.space-y-2 > details.rounded-2xl.border.border-line > div.border-t.border-line.px-4` | 346x198, 0 car., vacío 44 % |  |  |
| rala (poco texto en caja grande) | `main#contenido-admin.p-4 > div.space-y-10 > div.grid.gap-4 > section.overflow-hidden.rounded-2xl.border` | 348x170, 68 car., vacío 46 % | Por qué no se pueden procesar | frontend/app/admin/clasificacion/page.tsx:265 |
| rala (poco texto en caja grande) | `div.space-y-3 > div.space-y-2 > details.rounded-2xl.border.border-line > div.border-t.border-line.px-4` | 346x172, 0 car., vacío 43 % |  |  |
| rala (poco texto en caja grande) | `div.space-y-3 > div.space-y-2 > details.rounded-2xl.border.border-line > div.border-t.border-line.px-4` | 346x172, 0 car., vacío 42 % |  |  |

### /app/denuncias
<a id="app-denuncias"></a>

**1440 px:** puntaje 255, no aprueba. Alto 900 px, vacío inicial 81 %, 675 caracteres (6.3 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 81 %.

![/app/denuncias a 1440 px](img/linea-base/app-denuncias-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.flex.min-h-screen.flex-col > main#contenido.min-w-0.flex-1 > div.w-full.px-4.py-6 > div.flex.flex-col.items-center` | 1104x199, 148 car., vacío 79 % | Todavía no hay denuncias de vecinos publicadas Cua | frontend/app/(dashboard)/app/denuncias/page.tsx:215, frontend/app/(dashboard)/app/mi-impacto/page.tsx:120 |

**390 px:** puntaje 59, no aprueba. Alto 844 px, vacío inicial 59 %, 675 caracteres (21.8 por 10.000 px²).
Fallos: vacío inicial 59 %.

![/app/denuncias a 390 px](img/linea-base/app-denuncias-390.jpg)

### /app/contratos/1256450
<a id="app-contrato-sin-leer"></a>

**1440 px:** puntaje 231, no aprueba. Alto 1039 px, vacío inicial 43 %, 1288 caracteres (10.6 por 10.000 px²). Nota: ficha de un contrato sin leer.
Fallos: 2 cajas ralas > 40.000 px²; vacío inicial 43 %.

![/app/contratos/1256450 a 1440 px](img/linea-base/app-contrato-sin-leer-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.flex.min-h-screen.flex-col > main#contenido.min-w-0.flex-1 > div.w-full.space-y-6.px-4 > dl.grid.gap-px.grid-cols-2` | 1094x111, 142 car., vacío 63 % | valor referencial Sin dato el registro no lo publi | frontend/components/contratos/ContratoDetalle.tsx:168, frontend/app/(dashboard)/app/financiar/[ubigeo]/page.tsx:204 |
| rala (poco texto en caja grande) | `div#:R97rrrufj6:-panel-resumen.pt-5 > div.grid.items-start.gap-6 > div.min-w-0 > section.rounded-2xl.border.border-line` | 710x94, 107 car., vacío 52 % | Lectura en preparación | frontend/components/contratos/ContratoDetalle.tsx:352, frontend/components/mapa/ZonaHubPanel.tsx:678 |
| rala (vacío interno alto) | `main#contenido.min-w-0.flex-1 > div.w-full.space-y-6.px-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x109, 17 car., vacío 76 % | postores Sin dato | frontend/app/admin/cobertura/Fuentes.tsx:23, frontend/components/contratos/ContratoDetalle.tsx:163 |
| rala (vacío interno alto) | `main#contenido.min-w-0.flex-1 > div.w-full.space-y-6.px-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x109, 30 car., vacío 64 % | monto adjudicado Sin adjudicar | frontend/components/contratos/ContratoDetalle.tsx:173, frontend/components/contratos/DetalleContrato.tsx:59 |
| rala (vacío interno alto) | `main#contenido.min-w-0.flex-1 > div.w-full.space-y-6.px-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x109, 40 car., vacío 60 % | convocatoria 9 oct. buena pro: sin fecha | frontend/app/(dashboard)/alerta/[id]/page.tsx:4, frontend/app/(dashboard)/app/configuracion/page.tsx:446 |

**390 px:** puntaje 6, aprueba. Alto 1579 px, vacío inicial 6 %, 1288 caracteres (22.2 por 10.000 px²). Nota: ficha de un contrato sin leer.

![/app/contratos/1256450 a 390 px](img/linea-base/app-contrato-sin-leer-390.jpg)

### /admin
<a id="admin-resumen"></a>

**1440 px:** puntaje 220, no aprueba. Alto 1459 px, vacío inicial 28 %, 4102 caracteres (25.6 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 28 %.

![/admin a 1440 px](img/linea-base/admin-resumen-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.grid.gap-8 > section.scroll-mt-24.min-w-0 > div#:R2dufefj6:.mt-3 > div.overflow-hidden.rounded-2xl.border` | 555x331, 175 car., vacío 66 % | Procesando 0 En cola 0 Esperando documentos 0 Con  | frontend/components/admin/procesamiento/tipos.ts:43, frontend/lib/auditoria.ts:258 |
| rala (vacío interno alto) | `section.scroll-mt-24 > div#:R9ufefj6:.mt-3 > div.grid.gap-2.grid-cols-2 > a.group.relative.flex` | 373x104, 38 car., vacío 68 % | Aportes por validar 0 nada por validar | frontend/app/admin/page.tsx:290 |
| rala (vacío interno alto) | `section.scroll-mt-24 > div#:R9ufefj6:.mt-3 > div.grid.gap-2.grid-cols-2 > a.group.relative.flex` | 373x104, 42 car., vacío 64 % | Descargas pendientes 0 0 atendidas en 24 h | frontend/app/admin/page.tsx:306, frontend/components/admin/procesamiento/PedidosDescarga.tsx:82 |
| rala (vacío interno alto) | `section.scroll-mt-24 > div#:r0:.mt-3 > div.grid.gap-2.grid-cols-2 > a.group.relative.flex` | 277x104, 35 car., vacío 62 % | Financiadores 1 1 oculto al público | frontend/app/(dashboard)/app/auditoria/page.tsx:17, frontend/app/admin/equipo/page.tsx:44 |

**390 px:** puntaje 152, no aprueba. Alto 2538 px, vacío inicial 26 %, 1606 caracteres (18.3 por 10.000 px²).
Fallos: 3 cajas ralas > 40.000 px²; vacío inicial 26 %.

![/admin a 390 px](img/linea-base/admin-resumen-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.grid.gap-8 > section.scroll-mt-24.min-w-0 > div#:R2dufefj6:.mt-3 > div.overflow-hidden.rounded-2xl.border` | 348x220, 108 car., vacío 58 % | La cola no llegó Reintenta desde el aviso de arrib | frontend/app/admin/page.tsx:374, frontend/app/admin/procesamientos/page.tsx:342 |
| rala (poco texto en caja grande) | `div.grid.gap-8 > section.scroll-mt-24.min-w-0 > div#:R1lufefj6:.mt-3 > div.overflow-hidden.rounded-2xl.border` | 348x163, 53 car., vacío 72 % | La lista no llegó Reintenta desde el aviso de arri | frontend/app/admin/page.tsx:474, frontend/app/admin/procesamientos/page.tsx:342 |
| rala (poco texto en caja grande) | `div.grid.gap-8 > section.scroll-mt-24.min-w-0 > div#:R1dufefj6:.mt-3 > div.overflow-hidden.rounded-2xl.border` | 348x163, 54 car., vacío 71 % | El estado no llegó Reintenta desde el aviso de arr | frontend/app/admin/page.tsx:335, frontend/app/admin/procesamientos/page.tsx:342 |

### /app/contratos/1248872
<a id="app-contrato-leido"></a>

**1440 px:** puntaje 208, no aprueba. Alto 1336 px, vacío inicial 35 %, 2261 caracteres (14.4 por 10.000 px²). Nota: ficha de un contrato leído.
Fallos: 2 cajas ralas > 40.000 px²; vacío inicial 35 %.

![/app/contratos/1248872 a 1440 px](img/linea-base/app-contrato-leido-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.flex.min-h-screen.flex-col > main#contenido.min-w-0.flex-1 > div.w-full.space-y-6.px-4 > dl.grid.gap-px.grid-cols-2` | 1094x111, 141 car., vacío 63 % | valor referencial Sin dato el registro no lo publi | frontend/components/contratos/ContratoDetalle.tsx:168, frontend/app/(dashboard)/app/financiar/[ubigeo]/page.tsx:204 |
| rala (vacío interno alto) | `main#contenido.min-w-0.flex-1 > div.w-full.space-y-6.px-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x109, 17 car., vacío 76 % | postores Sin dato | frontend/app/admin/cobertura/Fuentes.tsx:23, frontend/components/contratos/ContratoDetalle.tsx:163 |
| rala (poco texto en caja grande) | `div.min-w-0 > div.space-y-2 > section.rounded-2xl.border.bg-paper > dl.mt-3.grid.gap-2` | 668x79, 99 car., vacío 38 % | Mercado No se pudo comparar con el mercado (1 ítem | frontend/components/admin/ui/estados.ts:32, frontend/components/auditoria/ResultadoAnalisis.tsx:19 |
| rala (vacío interno alto) | `main#contenido.min-w-0.flex-1 > div.w-full.space-y-6.px-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x109, 30 car., vacío 64 % | monto adjudicado Sin adjudicar | frontend/components/contratos/ContratoDetalle.tsx:173, frontend/components/contratos/DetalleContrato.tsx:59 |
| rala (vacío interno alto) | `main#contenido.min-w-0.flex-1 > div.w-full.space-y-6.px-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x109, 39 car., vacío 61 % | convocatoria 11 set. buena pro: 11 set. | frontend/app/(dashboard)/alerta/[id]/page.tsx:4, frontend/app/(dashboard)/app/configuracion/page.tsx:446 |

**390 px:** puntaje 7, aprueba. Alto 2299 px, vacío inicial 7 %, 2261 caracteres (26.4 por 10.000 px²). Nota: ficha de un contrato leído.

![/app/contratos/1248872 a 390 px](img/linea-base/app-contrato-leido-390.jpg)

### /app/partidos/partido-democratico-somos-peru?anio=2022
<a id="app-partido-ficha"></a>

**1440 px:** puntaje 199, no aprueba. Alto 2239 px, vacío inicial 18 %, 4337 caracteres (16.5 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/app/partidos/partido-democratico-somos-peru?anio=2022 a 1440 px](img/linea-base/app-partido-ficha-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `section.space-y-3 > figure.space-y-3 > details.text-inkSoft > div.mt-2.max-h-72.overflow-auto` | 1094x288, 0 car., vacío 43 % |  |  |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x132, 36 car., vacío 69 % | ya leídos por Vigía 24 1 % del total | frontend/app/(dashboard)/app/partidos/[clave]/page.tsx:47 |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x132, 54 car., vacío 58 % | con señal para revisar 8 una señal no es una acusa | frontend/app/(dashboard)/app/financiar/partido/[clave]/page.tsx:75, frontend/app/(dashboard)/app/partidos/[clave]/page.tsx:48 |

**390 px:** puntaje 25, aprueba. Alto 3017 px, vacío inicial 9 %, 4337 caracteres (38.5 por 10.000 px²).

![/app/partidos/partido-democratico-somos-peru?anio=2022 a 390 px](img/linea-base/app-partido-ficha-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 173x160, 36 car., vacío 58 % | ya leídos por Vigía 24 1 % del total | frontend/app/(dashboard)/app/partidos/[clave]/page.tsx:47 |

### /admin/contribuciones
<a id="admin-contribuciones"></a>

**1440 px:** puntaje 194, no aprueba. Alto 900 px, vacío inicial 42 %, 259 caracteres (7.8 por 10.000 px²).
Fallos: 2 cajas ralas > 40.000 px²; vacío inicial 42 %.

![/admin/contribuciones a 1440 px](img/linea-base/admin-contribuciones-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `main#contenido-admin.p-4 > div.space-y-4 > div.grid.gap-4 > div.overflow-hidden.rounded-2xl.border` | 776x184, 102 car., vacío 79 % | No hay pagos por validar Cuando un financiador reg | frontend/app/admin/contribuciones/page.tsx:200 |
| rala (poco texto en caja grande) | `div.space-y-4 > div.grid.gap-4 > aside.scroll-mt-28 > div.rounded-2xl.border.border-dashed` | 360x184, 106 car., vacío 58 % | Elige un aporte Verás su comprobante, a quién pert | frontend/app/admin/contribuciones/page.tsx:210 |

**390 px:** puntaje 103, no aprueba. Alto 844 px, vacío inicial 25 %, 259 caracteres (12.6 por 10.000 px²).
Fallos: 2 cajas ralas > 40.000 px²; vacío inicial 25 %.

![/admin/contribuciones a 390 px](img/linea-base/admin-contribuciones-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `main#contenido-admin.p-4 > div.space-y-4 > div.grid.gap-4 > div.overflow-hidden.rounded-2xl.border` | 358x184, 102 car., vacío 59 % | No hay pagos por validar Cuando un financiador reg | frontend/app/admin/contribuciones/page.tsx:200 |
| rala (poco texto en caja grande) | `div.space-y-4 > div.grid.gap-4 > aside.scroll-mt-28 > div.rounded-2xl.border.border-dashed` | 358x184, 106 car., vacío 59 % | Elige un aporte Verás su comprobante, a quién pert | frontend/app/admin/contribuciones/page.tsx:210 |

### /admin/equipo
<a id="admin-equipo"></a>

**1440 px:** puntaje 175, no aprueba. Alto 900 px, vacío inicial 35 %, 739 caracteres (13.6 por 10.000 px²).
Fallos: 2 cajas ralas > 40.000 px²; vacío inicial 35 %; 1 tablas ralas.

![/admin/equipo a 1440 px](img/linea-base/admin-equipo-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `section.scroll-mt-24 > div#:r0:.mt-3 > div.grid.gap-3 > div.rounded-2xl.border.border-line` | 570x190, 144 car., vacío 70 % | Administrador Todo lo del revisor Validar y rechaz | frontend/app/admin/equipo/page.tsx:49, frontend/lib/admin-sesion.ts:59 |
| rala (vacío interno alto) | `div.space-y-8 > section.scroll-mt-24 > div#:r1:.mt-3 > div.overflow-hidden.rounded-2xl.border` | 1152x84, 136 car., vacío 56 % | Personas del equipo Persona Perfil Último ingreso  | frontend/app/admin/equipo/page.tsx:220, frontend/lib/admin-sesion.ts:59 |
| tabla (una sola fila) | `div.overflow-hidden.rounded-2xl.border > div.transition-opacity.duration-rapido > div.overflow-x-auto.hidden > table.w-full.text-sm` | 1 filas, 42 px por fila | Personas del equipo Persona Perfil Últim |  |

**390 px:** puntaje 45, no aprueba. Alto 956 px, vacío inicial 19 %, 739 caracteres (26.2 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/admin/equipo a 390 px](img/linea-base/admin-equipo-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.space-y-8 > section.scroll-mt-24 > div#:r1:.mt-3 > div.overflow-hidden.rounded-2xl.border` | 348x133, 67 car., vacío 56 % | <correo del admin> Perfil Administrador Principal | frontend/app/admin/equipo/page.tsx:78, frontend/components/agentes/AuditoriaDeAgentes.tsx:29 |

### /app/auditoria
<a id="app-auditoria"></a>

**1440 px:** puntaje 166, no aprueba. Alto 900 px, vacío inicial 36 %, 2152 caracteres (20.2 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 36 %.

![/app/auditoria a 1440 px](img/linea-base/app-auditoria-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.space-y-6 > section.space-y-2.5 > div.overflow-hidden.rounded-2xl.border > dl.grid.gap-px.bg-line` | 1102x116, 173 car., vacío 56 % | con dictamen publicado ¿Cómo se cuenta? 149 de 200 | frontend/components/auditoria/EstadoAuditoria.tsx:53, frontend/app/(dashboard)/app/contratos/page.tsx:180 |
| rala (vacío interno alto) | `section.space-y-2.5 > div.overflow-hidden.rounded-2xl.border > dl.grid.gap-px.bg-line > div.relative.flex.min-w-0` | 275x116, 27 car., vacío 70 % | leídos hoy 0 148 en 14 días | frontend/components/auditoria/EstadoAuditoria.tsx:78, frontend/components/mapa/indicadoresMapa.tsx:62 |
| rala (vacío interno alto) | `section.space-y-2.5 > div.overflow-hidden.rounded-2xl.border > dl.grid.gap-px.bg-line > div.relative.flex.min-w-0` | 275x116, 41 car., vacío 58 % | financiados en espera 0 ninguno esperando | frontend/components/auditoria/EstadoAuditoria.tsx:75, frontend/components/aliados/IdentidadAliado.tsx:194 |
| rala (vacío interno alto) | `section.space-y-2.5 > div.overflow-hidden.rounded-2xl.border > dl.grid.gap-px.bg-line > div.relative.flex.min-w-0` | 275x116, 40 car., vacío 57 % | financiados en revisión 51 de 200 leídos | frontend/components/alertas/EnRevision.tsx:51, frontend/components/auditoria/EstadoAuditoria.tsx:69 |

**390 px:** puntaje 18, aprueba. Alto 1286 px, vacío inicial 6 %, 2152 caracteres (45.8 por 10.000 px²).

![/app/auditoria a 390 px](img/linea-base/app-auditoria-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `section.space-y-2.5 > div.overflow-hidden.rounded-2xl.border > dl.grid.gap-px.bg-line > div.relative.flex.min-w-0` | 173x127, 27 car., vacío 56 % | leídos hoy 0 148 en 14 días | frontend/components/auditoria/EstadoAuditoria.tsx:78, frontend/components/mapa/indicadoresMapa.tsx:62 |

### /app/convocatoria
<a id="app-convocatoria"></a>

**1440 px:** puntaje 146, no aprueba. Alto 2206 px, vacío inicial 20 %, 8663 caracteres (33.4 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/app/convocatoria a 1440 px](img/linea-base/app-convocatoria-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `main#contenido.min-w-0.flex-1 > div.w-full.px-4.py-6 > div.space-y-5 > dl.grid.gap-px.grid-cols-2` | 1094x111, 158 car., vacío 59 % | análisis publicados 210 173 con señales riesgo alt | frontend/app/(dashboard)/app/convocatoria/page.tsx:87, frontend/app/(dashboard)/app/convocatoria/[id]/loading.tsx:6 |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-5 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x109, 32 car., vacío 64 % | riesgo alto 70 de 209 publicados | frontend/app/(dashboard)/app/contratos/page.tsx:209, frontend/app/(dashboard)/app/convocatoria/page.tsx:136 |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-5 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x109, 32 car., vacío 63 % | sin señales 36 de 209 publicados | frontend/app/(dashboard)/app/contratos/page.tsx:242, frontend/app/(dashboard)/app/convocatoria/page.tsx:143 |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-5 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x109, 39 car., vacío 57 % | análisis publicados 210 173 con señales | frontend/app/(dashboard)/app/convocatoria/page.tsx:87, frontend/app/(dashboard)/app/convocatoria/[id]/loading.tsx:6 |

**390 px:** puntaje 6, aprueba. Alto 3746 px, vacío inicial 6 %, 8937 caracteres (63.6 por 10.000 px²).

![/app/convocatoria a 390 px](img/linea-base/app-convocatoria-390.jpg)

### /app/alertas
<a id="app-alertas"></a>

**1440 px:** puntaje 145, no aprueba. Alto 2175 px, vacío inicial 15 %, 10315 caracteres (40.4 por 10.000 px²). Redirige a `/app/hallazgos`.
Fallos: 1 cajas ralas > 40.000 px².

![/app/alertas a 1440 px](img/linea-base/app-alertas-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `main#contenido.min-w-0.flex-1 > div.w-full.px-4.py-6 > div.space-y-5 > dl.grid.gap-px.grid-cols-2` | 1094x118, 169 car., vacío 56 % | señales publicadas 522 en 174 contratos señales al | frontend/app/(dashboard)/app/hallazgos/page.tsx:214, frontend/app/(public)/aliado/[slug]/page.tsx:170 |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-5 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x116, 32 car., vacío 66 % | señales altas 197 38 % del total | frontend/app/(dashboard)/app/hallazgos/page.tsx:217, frontend/components/convocatoria/sections/ConteoSenales.tsx:7 |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-5 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x116, 39 car., vacío 60 % | señales publicadas 522 en 174 contratos | frontend/app/(dashboard)/app/hallazgos/page.tsx:214, frontend/app/(public)/aliado/[slug]/page.tsx:170 |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-5 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x116, 47 car., vacío 56 % | contratos con dictamen 212 último leído 30 set. | frontend/app/(dashboard)/app/entidades/page.tsx:65, frontend/app/(dashboard)/app/hallazgos/page.tsx:230 |

**390 px:** puntaje 5, aprueba. Alto 3145 px, vacío inicial 5 %, 10315 caracteres (87.7 por 10.000 px²). Redirige a `/app/hallazgos`.

![/app/alertas a 390 px](img/linea-base/app-alertas-390.jpg)

### /app/hallazgos
<a id="app-hallazgos"></a>

**1440 px:** puntaje 145, no aprueba. Alto 2175 px, vacío inicial 15 %, 10315 caracteres (40.4 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/app/hallazgos a 1440 px](img/linea-base/app-hallazgos-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `main#contenido.min-w-0.flex-1 > div.w-full.px-4.py-6 > div.space-y-5 > dl.grid.gap-px.grid-cols-2` | 1094x118, 169 car., vacío 56 % | señales publicadas 522 en 174 contratos señales al | frontend/app/(dashboard)/app/hallazgos/page.tsx:214, frontend/app/(public)/aliado/[slug]/page.tsx:170 |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-5 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x116, 32 car., vacío 66 % | señales altas 197 38 % del total | frontend/app/(dashboard)/app/hallazgos/page.tsx:217, frontend/components/convocatoria/sections/ConteoSenales.tsx:7 |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-5 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x116, 39 car., vacío 60 % | señales publicadas 522 en 174 contratos | frontend/app/(dashboard)/app/hallazgos/page.tsx:214, frontend/app/(public)/aliado/[slug]/page.tsx:170 |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-5 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x116, 47 car., vacío 56 % | contratos con dictamen 212 último leído 30 set. | frontend/app/(dashboard)/app/entidades/page.tsx:65, frontend/app/(dashboard)/app/hallazgos/page.tsx:230 |

**390 px:** puntaje 5, aprueba. Alto 3145 px, vacío inicial 5 %, 10315 caracteres (87.7 por 10.000 px²).

![/app/hallazgos a 390 px](img/linea-base/app-hallazgos-390.jpg)

### /app/auditoria/1248872
<a id="app-auditoria-ficha"></a>

**1440 px:** puntaje 123, no aprueba. Alto 900 px, vacío inicial 72 %, 395 caracteres (3.7 por 10.000 px²). Nota: auditoría en vivo de un contrato.
Fallos: vacío inicial 72 %.

![/app/auditoria/1248872 a 1440 px](img/linea-base/app-auditoria-ficha-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `nav.mt-10.w-full.max-w-2xl > ul.grid.gap-3 > li > a.group.flex.items-center` | 330x78, 20 car., vacío 71 % | Mapa Elige tu región | frontend/app/(dashboard)/app/mapa/page.tsx:21, frontend/app/(dashboard)/app/page.tsx:32 |
| rala (vacío interno alto) | `nav.mt-10.w-full.max-w-2xl > ul.grid.gap-3 > li > a.group.flex.items-center` | 330x78, 24 car., vacío 68 % | Inicio Qué es Vigía Perú | frontend/app/not-found.tsx:28, frontend/app/(dashboard)/app/page.tsx:5 |
| rala (vacío interno alto) | `nav.mt-10.w-full.max-w-2xl > ul.grid.gap-3 > li > a.group.flex.items-center` | 330x78, 29 car., vacío 60 % | Señales Con norma y evidencia | frontend/app/not-found.tsx:27, frontend/app/(dashboard)/app/alertas/page.tsx:5 |

**390 px:** puntaje 82, no aprueba. Alto 947 px, vacío inicial 27 %, 389 caracteres (11.6 por 10.000 px²). Nota: auditoría en vivo de un contrato.
Fallos: vacío inicial 27 %.

![/app/auditoria/1248872 a 390 px](img/linea-base/app-auditoria-ficha-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `nav.mt-10.w-full.max-w-2xl > ul.grid.gap-3 > li > a.group.flex.items-center` | 348x78, 20 car., vacío 73 % | Mapa Elige tu región | frontend/app/(dashboard)/app/mapa/page.tsx:21, frontend/app/(dashboard)/app/page.tsx:32 |
| rala (vacío interno alto) | `nav.mt-10.w-full.max-w-2xl > ul.grid.gap-3 > li > a.group.flex.items-center` | 348x78, 24 car., vacío 69 % | Inicio Qué es Vigía Perú | frontend/app/not-found.tsx:28, frontend/app/(dashboard)/app/page.tsx:5 |
| rala (vacío interno alto) | `nav.mt-10.w-full.max-w-2xl > ul.grid.gap-3 > li > a.group.flex.items-center` | 348x78, 29 car., vacío 62 % | Señales Con norma y evidencia | frontend/app/not-found.tsx:27, frontend/app/(dashboard)/app/alertas/page.tsx:5 |

### /admin/financiadores
<a id="admin-financiadores"></a>

**1440 px:** puntaje 114, no aprueba. Alto 900 px, vacío inicial 28 %, 1442 caracteres (17.4 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 28 %; 1 tablas ralas.

![/admin/financiadores a 1440 px](img/linea-base/admin-financiadores-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div#:r0:.mt-3 > div.grid.gap-4 > aside.scroll-mt-28 > div.rounded-2xl.border.border-dashed` | 360x184, 105 car., vacío 60 % | Elige un financiador Verás lo que publicó en su pe | frontend/app/admin/financiadores/page.tsx:209 |
| rala (vacío interno alto) | `main#contenido-admin.p-4 > div.space-y-8 > div.grid.gap-2.grid-cols-2 > div.group.relative.flex` | 279x104, 25 car., vacío 65 % | Contratos financiados 200 | frontend/app/(dashboard)/app/mi-impacto/page.tsx:333, frontend/app/admin/financiadores/DetalleFinanciador.tsx:118 |
| rala (vacío interno alto) | `main#contenido-admin.p-4 > div.space-y-8 > div.grid.gap-2.grid-cols-2 > div.group.relative.flex` | 279x104, 37 car., vacío 60 % | Financiadores 4 3 visibles en público | frontend/app/(dashboard)/app/auditoria/page.tsx:17, frontend/app/admin/equipo/page.tsx:44 |
| tabla (filas muy altas) | `div.overflow-hidden.rounded-2xl.border > div.transition-opacity.duration-rapido > div.overflow-x-auto.hidden > table.w-full.text-sm` | 4 filas, 97 px por fila | Financiadores Financiador Contacto Aport |  |

**390 px:** puntaje 48, no aprueba. Alto 1930 px, vacío inicial 9 %, 1442 caracteres (22.3 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/admin/financiadores a 390 px](img/linea-base/admin-financiadores-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div#:r0:.mt-3 > div.grid.gap-4 > aside.scroll-mt-28 > div.rounded-2xl.border.border-dashed` | 348x184, 105 car., vacío 60 % | Elige un financiador Verás lo que publicó en su pe | frontend/app/admin/financiadores/page.tsx:209 |

### /app/entidades
<a id="app-entidades"></a>

**1440 px:** puntaje 106, no aprueba. Alto 1780 px, vacío inicial 25 %, 3044 caracteres (14.6 por 10.000 px²).
Fallos: 2 cajas ralas > 40.000 px²; vacío inicial 25 %.

![/app/entidades a 1440 px](img/linea-base/app-entidades-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `main#contenido.min-w-0.flex-1 > div.w-full.px-4.py-6 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 546x116, 63 car., vacío 70 % | adjudicado en contratos con dictamen S/ 93.0 M de  | frontend/app/(dashboard)/app/entidades/page.tsx:115 |
| rala (poco texto en caja grande) | `main#contenido.min-w-0.flex-1 > div.w-full.px-4.py-6 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 546x116, 84 car., vacío 58 % | entidades con dictamen publicado ¿Qué cuentan esta | frontend/app/(dashboard)/app/entidades/page.tsx:101, frontend/app/(dashboard)/app/denuncias/page.tsx:275 |

**390 px:** puntaje 4, aprueba. Alto 2304 px, vacío inicial 4 %, 3044 caracteres (35.5 por 10.000 px²).

![/app/entidades a 390 px](img/linea-base/app-entidades-390.jpg)

### /app/financiar/21
<a id="app-financiar-zona"></a>

**1440 px:** puntaje 88, no aprueba. Alto 900 px, vacío inicial 46 %, 2191 caracteres (20.6 por 10.000 px²).
Fallos: vacío inicial 46 %.

![/app/financiar/21 a 1440 px](img/linea-base/app-financiar-zona-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 275x116, 27 car., vacío 69 % | financiados 35 8.1 % de 430 | frontend/app/(dashboard)/app/aliados/page.tsx:85, frontend/app/(dashboard)/app/auditoria/page.tsx:152 |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 275x116, 39 car., vacío 62 % | financiados leídos 35 de 35 financiados | frontend/app/(dashboard)/app/aliados/page.tsx:212, frontend/app/(dashboard)/app/financiar/[ubigeo]/page.tsx:292 |

**390 px:** puntaje 27, aprueba. Alto 1536 px, vacío inicial 14 %, 2191 caracteres (38.8 por 10.000 px²).

![/app/financiar/21 a 390 px](img/linea-base/app-financiar-zona-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 173x132, 27 car., vacío 56 % | financiados 35 8.1 % de 430 | frontend/app/(dashboard)/app/aliados/page.tsx:85, frontend/app/(dashboard)/app/auditoria/page.tsx:152 |

### /app/contratos
<a id="app-contratos"></a>

**1440 px:** puntaje 51, aprueba. Alto 3832 px, vacío inicial 12 %, 14251 caracteres (31.7 por 10.000 px²).

![/app/contratos a 1440 px](img/linea-base/app-contratos-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `main#contenido.min-w-0.flex-1 > div.w-full.px-4.py-6 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x116, 31 car., vacío 62 % | leídos 265 de 19,653 publicados | frontend/app/(dashboard)/app/aliados/page.tsx:212, frontend/app/(dashboard)/app/auditoria/page.tsx:81 |
| rala (vacío interno alto) | `main#contenido.min-w-0.flex-1 > div.w-full.px-4.py-6 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x116, 38 car., vacío 62 % | con riesgo alto 70 de 212 con dictamen | frontend/app/(dashboard)/app/contratos/page.tsx:209, frontend/components/landing/EscalaDinero.tsx:33 |

**390 px:** puntaje 1, aprueba. Alto 6379 px, vacío inicial 1 %, 14251 caracteres (59.2 por 10.000 px²).

![/app/contratos a 390 px](img/linea-base/app-contratos-390.jpg)

### /app/financiar/partido/partido-democratico-somos-peru?anio=2022
<a id="app-financiar-partido"></a>

**1440 px:** puntaje 42, aprueba. Alto 1257 px, vacío inicial 23 %, 2608 caracteres (17.7 por 10.000 px²).

![/app/financiar/partido/partido-democratico-somos-peru?anio=2022 a 1440 px](img/linea-base/app-financiar-partido-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.w-full.px-4.py-6 > div.space-y-4 > dl.grid.gap-px.grid-cols-2 > div.relative.flex.min-w-0` | 272x126, 54 car., vacío 56 % | con señal para revisar 8 una señal no es una acusa | frontend/app/(dashboard)/app/financiar/partido/[clave]/page.tsx:75, frontend/app/(dashboard)/app/partidos/[clave]/page.tsx:48 |

**390 px:** puntaje 5, aprueba. Alto 2391 px, vacío inicial 5 %, 2608 caracteres (29.3 por 10.000 px²).

![/app/financiar/partido/partido-democratico-somos-peru?anio=2022 a 390 px](img/linea-base/app-financiar-partido-390.jpg)

### /app
<a id="app-inicio"></a>

**1440 px:** puntaje 10, aprueba. Alto 1616 px, vacío inicial 10 %, 4102 caracteres (21.6 por 10.000 px²).

![/app a 1440 px](img/linea-base/app-inicio-1440.jpg)

**390 px:** puntaje 33, no aprueba. Alto 2836 px, vacío inicial 9 %, 4077 caracteres (38.5 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/app a 390 px](img/linea-base/app-inicio-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.w-full.px-4.py-6 > div.grid.items-start.gap-5 > section.rounded-2xl.border.border-line > div.flex.flex-wrap.items-center` | 346x148, 44 car., vacío 47 % | Rankings | frontend/app/(dashboard)/app/page.tsx:7, frontend/components/dashboard/DashboardSidebar.tsx:100 |

### /admin/bitacora
<a id="admin-bitacora"></a>

**1440 px:** puntaje 33, no aprueba. Alto 1887 px, vacío inicial 33 %, 6054 caracteres (28.6 por 10.000 px²).
Fallos: vacío inicial 33 %.

![/admin/bitacora a 1440 px](img/linea-base/admin-bitacora-1440.jpg)

**390 px:** puntaje 8, aprueba. Alto 3210 px, vacío inicial 8 %, 6054 caracteres (53.4 por 10.000 px²).

![/admin/bitacora a 390 px](img/linea-base/admin-bitacora-390.jpg)

### /app/financiar/entidad/20406325815
<a id="app-financiar-entidad"></a>

**1440 px:** puntaje 24, aprueba. Alto 4911 px, vacío inicial 24 %, 17572 caracteres (30.5 por 10.000 px²).

![/app/financiar/entidad/20406325815 a 1440 px](img/linea-base/app-financiar-entidad-1440.jpg)

**390 px:** puntaje 7, aprueba. Alto 6781 px, vacío inicial 7 %, 17572 caracteres (68.7 por 10.000 px²).

![/app/financiar/entidad/20406325815 a 390 px](img/linea-base/app-financiar-entidad-390.jpg)

### /app/financiar/entidad
<a id="app-financiar-entidades"></a>

**1440 px:** puntaje 13, aprueba. Alto 2535 px, vacío inicial 13 %, 6831 caracteres (23 por 10.000 px²). Redirige a `/app/financiar?por=entidad`.

![/app/financiar/entidad a 1440 px](img/linea-base/app-financiar-entidades-1440.jpg)

**390 px:** puntaje 19, aprueba. Alto 5008 px, vacío inicial 2 %, 6831 caracteres (36.2 por 10.000 px²). Redirige a `/app/financiar?por=entidad`.

![/app/financiar/entidad a 390 px](img/linea-base/app-financiar-entidades-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.space-y-3 > div.overflow-clip.rounded-2xl.border > ul > li.border-b` | 346x84, 30 car., vacío 57 % | SEGURO SOCIAL DE SALUD Lima 49 |  |

### /admin/analisis
<a id="admin-analisis"></a>

**1440 px:** puntaje 15, aprueba. Alto 2297 px, vacío inicial 15 %, 8666 caracteres (33.3 por 10.000 px²).

![/admin/analisis a 1440 px](img/linea-base/admin-analisis-1440.jpg)

**390 px:** puntaje 1, aprueba. Alto 3716 px, vacío inicial 1 %, 8940 caracteres (67.5 por 10.000 px²).

![/admin/analisis a 390 px](img/linea-base/admin-analisis-390.jpg)

### /admin/procesamientos
<a id="admin-procesamientos"></a>

**1440 px:** puntaje 11, no aprueba. Alto 16613 px, vacío inicial 1 %, 62540 caracteres (31.8 por 10.000 px²).
Fallos: 1 tablas ralas.

![/admin/procesamientos a 1440 px](img/linea-base/admin-procesamientos-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| tabla (filas muy altas) | `section.scroll-mt-24.mt-6 > div#:Rpufnefj6:.mt-3 > section.mt-3.overflow-x-auto.rounded-2xl > table.w-full.text-sm` | 200 filas, 79 px por fila | Contratos en procesamiento Contrato Esta |  |

**390 px:** puntaje 10, no aprueba. Alto 18297 px, vacío inicial 0 %, 62493 caracteres (91.1 por 10.000 px²).
Fallos: 1 tablas ralas.

![/admin/procesamientos a 390 px](img/linea-base/admin-procesamientos-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| tabla (filas muy altas) | `section.scroll-mt-24.mt-6 > div#:Rpufnefj6:.mt-3 > section.mt-3.overflow-x-auto.rounded-2xl > table.w-full.text-sm` | 200 filas, 84 px por fila | Contratos en procesamiento Contrato Esta |  |

### /admin/revision
<a id="admin-revision"></a>

**1440 px:** puntaje 11, no aprueba. Alto 5829 px, vacío inicial 1 %, 49184 caracteres (72.3 por 10.000 px²).
Fallos: 1 tablas ralas.

![/admin/revision a 1440 px](img/linea-base/admin-revision-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| tabla (filas muy altas) | `div.overflow-hidden.rounded-2xl.border > div.transition-opacity.duration-rapido > div.overflow-x-auto.hidden > table.w-full.text-sm` | 53 filas, 102 px por fila | Alertas en revisión humana Contrato Enti |  |

**390 px:** puntaje 5, aprueba. Alto 21261 px, vacío inicial 5 %, 49184 caracteres (61.5 por 10.000 px²).

![/admin/revision a 390 px](img/linea-base/admin-revision-390.jpg)
