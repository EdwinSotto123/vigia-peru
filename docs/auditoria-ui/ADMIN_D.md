# Auditoría de densidad de la UI: admin-d

Generado el 2026-10-11 09:35 UTC contra `http://localhost:3300`. Sesión admin: **ok**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta admin-d
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 6 de 12 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/admin/cobertura`](#admin-cobertura) | 75 | no | 25 | no | 2282 | 18 % | 2 | -257 |
| [`/admin`](#admin-resumen) | 72 | no | 36 | no | 1293 | 24 % | 1 | -148 |
| [`/admin/contribuciones`](#admin-contribuciones) | 46 | no | 15 | sí | 900 | 46 % | 0 | -148 |
| [`/admin/equipo`](#admin-equipo) | 40 | no | 17 | sí | 900 | 40 % | 0 | -135 |
| [`/admin/revision/92a7c528-fca2-4068-bc48-0f2651641028`](#admin-revision-ficha) | 27 | no | 2 | sí | 1208 | 27 % | 0 | -930 |
| [`/admin/pagos`](#admin-pagos) | 23 | sí | 8 | sí | 900 | 23 % | 0 | -305 |
| [`/admin/financiadores`](#admin-financiadores) | 20 | sí | 9 | sí | 900 | 20 % | 0 | -94 |
| [`/admin/revision`](#admin-revision) | 18 | no | 4 | sí | 3995 | 8 % | 0 | +7 |
| [`/admin/clasificacion`](#admin-clasificacion) | 17 | sí | 8 | sí | 1096 | 17 % | 0 | -264 |
| [`/admin/analisis`](#admin-analisis) | 15 | sí | 1 | sí | 2297 | 15 % | 0 | +0 |
| [`/admin/bitacora`](#admin-bitacora) | 4 | sí | 8 | sí | 1140 | 4 % | 0 | -25 |
| [`/admin/procesamientos`](#admin-procesamientos) | 0 | sí | 0 | sí | 3496 | 0 % | 0 | -11 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |
| poco texto en caja grande | 4 |
| vacío interno alto | 1 |
| tabla: filas muy altas | 1 |

Clases de Tailwind que más aparecen en las cajas ralas:

`gap-y-0.5` (1)

Componentes con más cajas ralas:

| Archivo | Cajas ralas |
| --- | --- |
| `frontend/app/admin/cobertura/Progreso.tsx` | 3 |
| `frontend/app/(dashboard)/app/auditoria/page.tsx` | 3 |
| `frontend/app/(dashboard)/app/aliados/page.tsx` | 2 |

## Detalle por ruta

### /admin/cobertura
<a id="admin-cobertura"></a>

**1440 px:** puntaje 75, no aprueba. Alto 2282 px, vacío inicial 18 %, 10721 caracteres (41.5 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/admin/cobertura a 1440 px](img/admin-d/admin-cobertura-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div#:R5ufnefj6:.mt-2 > div.space-y-3 > div.grid.items-start.gap-3 > section.overflow-hidden.rounded-2xl.border` | 565x97, 68 car., vacío 66 % | Descargados por noche | frontend/app/admin/cobertura/Progreso.tsx:90, frontend/app/(dashboard)/app/auditoria/page.tsx:51 |
| rala (vacío interno alto) | `div.py-2.5 > div > dl.grid.grid-cols-2.gap-x-4 > div.relative.grid.min-w-0` | 269x138, 75 car., vacío 57 % | En lotes abiertos 0 documentos esperando su turno  | frontend/app/admin/cobertura/Progreso.tsx:79 |

**390 px:** puntaje 25, no aprueba. Alto 7079 px, vacío inicial 1 %, 10721 caracteres (41.2 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/admin/cobertura a 390 px](img/admin-d/admin-cobertura-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `section.overflow-hidden.rounded-2xl.border > div.px-4.pb-3.pt-2.5 > div.space-y-2 > details.border.border-line.bg-paper` | 314x162, 106 car., vacío 47 % | El expediente lista el documento pero no trae el a | frontend/app/admin/cobertura/Progreso.tsx:33 |

### /admin
<a id="admin-resumen"></a>

**1440 px:** puntaje 72, no aprueba. Alto 1293 px, vacío inicial 24 %, 2812 caracteres (20 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/admin a 1440 px](img/admin-d/admin-resumen-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.grid.items-start.gap-5 > section.scroll-mt-24.min-w-0 > div#:R2dufefj6:.mt-2 > div.overflow-hidden.rounded-2xl.border` | 561x142, 92 car., vacío 60 % | Procesados 200 En revisión humana 53 4,006 contrat | frontend/app/(dashboard)/app/aliados/page.tsx:104, frontend/app/(dashboard)/app/auditoria/page.tsx:8 |

**390 px:** puntaje 36, no aprueba. Alto 2585 px, vacío inicial 10 %, 2812 caracteres (31.4 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/admin a 390 px](img/admin-d/admin-resumen-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.grid.items-start.gap-5 > section.scroll-mt-24.min-w-0 > div#:R2dufefj6:.mt-2 > div.overflow-hidden.rounded-2xl.border` | 348x160, 92 car., vacío 47 % | Procesados 200 En revisión humana 53 4,006 contrat | frontend/app/(dashboard)/app/aliados/page.tsx:104, frontend/app/(dashboard)/app/auditoria/page.tsx:8 |

### /admin/contribuciones
<a id="admin-contribuciones"></a>

**1440 px:** puntaje 46, no aprueba. Alto 900 px, vacío inicial 46 %, 155 caracteres (6.6 por 10.000 px²).
Fallos: vacío inicial 46 %.

![/admin/contribuciones a 1440 px](img/admin-d/admin-contribuciones-1440.jpg)

**390 px:** puntaje 15, aprueba. Alto 844 px, vacío inicial 15 %, 155 caracteres (15.1 por 10.000 px²).

![/admin/contribuciones a 390 px](img/admin-d/admin-contribuciones-390.jpg)

### /admin/equipo
<a id="admin-equipo"></a>

**1440 px:** puntaje 40, no aprueba. Alto 900 px, vacío inicial 40 %, 615 caracteres (14.1 por 10.000 px²).
Fallos: vacío inicial 40 %.

![/admin/equipo a 1440 px](img/admin-d/admin-equipo-1440.jpg)

**390 px:** puntaje 17, aprueba. Alto 844 px, vacío inicial 17 %, 615 caracteres (25.6 por 10.000 px²).

![/admin/equipo a 390 px](img/admin-d/admin-equipo-390.jpg)

### /admin/revision/92a7c528-fca2-4068-bc48-0f2651641028
<a id="admin-revision-ficha"></a>

**1440 px:** puntaje 27, no aprueba. Alto 1208 px, vacío inicial 27 %, 2604 caracteres (19.9 por 10.000 px²).
Fallos: vacío inicial 27 %.

![/admin/revision/92a7c528-fca2-4068-bc48-0f2651641028 a 1440 px](img/admin-d/admin-revision-ficha-1440.jpg)

**390 px:** puntaje 2, aprueba. Alto 2119 px, vacío inicial 2 %, 2604 caracteres (36 por 10.000 px²).

![/admin/revision/92a7c528-fca2-4068-bc48-0f2651641028 a 390 px](img/admin-d/admin-revision-ficha-390.jpg)

### /admin/pagos
<a id="admin-pagos"></a>

**1440 px:** puntaje 23, aprueba. Alto 900 px, vacío inicial 23 %, 1002 caracteres (10.7 por 10.000 px²).

![/admin/pagos a 1440 px](img/admin-d/admin-pagos-1440.jpg)

**390 px:** puntaje 8, aprueba. Alto 1626 px, vacío inicial 8 %, 1002 caracteres (18.9 por 10.000 px²).

![/admin/pagos a 390 px](img/admin-d/admin-pagos-390.jpg)

### /admin/financiadores
<a id="admin-financiadores"></a>

**1440 px:** puntaje 20, aprueba. Alto 900 px, vacío inicial 20 %, 1382 caracteres (23.3 por 10.000 px²).

![/admin/financiadores a 1440 px](img/admin-d/admin-financiadores-1440.jpg)

**390 px:** puntaje 9, aprueba. Alto 1701 px, vacío inicial 9 %, 1382 caracteres (24.7 por 10.000 px²).

![/admin/financiadores a 390 px](img/admin-d/admin-financiadores-390.jpg)

### /admin/revision
<a id="admin-revision"></a>

**1440 px:** puntaje 18, no aprueba. Alto 3995 px, vacío inicial 8 %, 24927 caracteres (53.9 por 10.000 px²).
Fallos: 1 tablas ralas.

![/admin/revision a 1440 px](img/admin-d/admin-revision-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| tabla (filas muy altas) | `div.overflow-hidden.rounded-2xl.border > div.transition-opacity.duration-rapido > div.overflow-x-auto.hidden > table.w-full.text-sm` | 25 filas, 143 px por fila | Alertas en revisión humana Contrato Enti |  |

**390 px:** puntaje 4, aprueba. Alto 8459 px, vacío inicial 4 %, 24927 caracteres (79.7 por 10.000 px²).

![/admin/revision a 390 px](img/admin-d/admin-revision-390.jpg)

### /admin/clasificacion
<a id="admin-clasificacion"></a>

**1440 px:** puntaje 17, aprueba. Alto 1096 px, vacío inicial 17 %, 1545 caracteres (13.2 por 10.000 px²).

![/admin/clasificacion a 1440 px](img/admin-d/admin-clasificacion-1440.jpg)

**390 px:** puntaje 8, aprueba. Alto 1689 px, vacío inicial 8 %, 1545 caracteres (27.9 por 10.000 px²).

![/admin/clasificacion a 390 px](img/admin-d/admin-clasificacion-390.jpg)

### /admin/analisis
<a id="admin-analisis"></a>

**1440 px:** puntaje 15, aprueba. Alto 2297 px, vacío inicial 15 %, 8666 caracteres (33.3 por 10.000 px²).

![/admin/analisis a 1440 px](img/admin-d/admin-analisis-1440.jpg)

**390 px:** puntaje 1, aprueba. Alto 3716 px, vacío inicial 1 %, 8940 caracteres (67.5 por 10.000 px²).

![/admin/analisis a 390 px](img/admin-d/admin-analisis-390.jpg)

### /admin/bitacora
<a id="admin-bitacora"></a>

**1440 px:** puntaje 4, aprueba. Alto 1140 px, vacío inicial 4 %, 6054 caracteres (49.4 por 10.000 px²).

![/admin/bitacora a 1440 px](img/admin-d/admin-bitacora-1440.jpg)

**390 px:** puntaje 8, aprueba. Alto 3138 px, vacío inicial 8 %, 6054 caracteres (54.8 por 10.000 px²).

![/admin/bitacora a 390 px](img/admin-d/admin-bitacora-390.jpg)

### /admin/procesamientos
<a id="admin-procesamientos"></a>

**1440 px:** puntaje 0, aprueba. Alto 3496 px, vacío inicial 0 %, 29603 caracteres (73.5 por 10.000 px²).

![/admin/procesamientos a 1440 px](img/admin-d/admin-procesamientos-1440.jpg)

**390 px:** puntaje 0, aprueba. Alto 13722 px, vacío inicial 0 %, 29556 caracteres (57.7 por 10.000 px²).

![/admin/procesamientos a 390 px](img/admin-d/admin-procesamientos-390.jpg)
