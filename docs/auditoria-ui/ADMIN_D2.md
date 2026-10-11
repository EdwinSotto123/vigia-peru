# Auditoría de densidad de la UI: admin-d2

Generado el 2026-10-11 11:42 UTC contra `http://localhost:3300`. Sesión admin: **rechazada**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta admin-d2
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 1 de 6 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/admin/cobertura`](#admin-cobertura) | 174 | no | 2 | sí | 2282 | 19 % | 3 | -158 |
| [`/admin`](#admin-resumen) | 80 | no | 10 | sí | 1293 | 23 % | 1 | -140 |
| [`/admin/revision/92a7c528-fca2-4068-bc48-0f2651641028`](#admin-revision-ficha) | 41 | no | 34 | no | 1180 | 23 % | 1 | -916 |
| [`/admin/contribuciones`](#admin-contribuciones) | 35 | no | 3 | sí | 1191 | 25 % | 0 | -159 |
| [`/admin/equipo`](#admin-equipo) | 26 | no | 11 | sí | 900 | 26 % | 0 | -149 |
| [`/admin/revision`](#admin-revision) | 0 | sí | 5 | sí | 1745 | 0 % | 0 | -6 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |
| vacío interno alto | 4 |
| poco texto en caja grande | 2 |
| tabla: filas muy altas | 1 |

Clases de Tailwind que más aparecen en las cajas ralas:

`gap-y-0.5` (2), `p-3.5` (2)

Componentes con más cajas ralas:

| Archivo | Cajas ralas |
| --- | --- |
| `frontend/app/admin/cobertura/Progreso.tsx` | 3 |
| `frontend/app/(dashboard)/app/auditoria/[ocid]/page.tsx` | 2 |
| `frontend/app/(dashboard)/app/contratos/page.tsx` | 2 |
| `frontend/app/(public)/aliado/[slug]/page.tsx` | 1 |
| `frontend/app/admin/page.tsx` | 1 |
| `frontend/app/(dashboard)/app/aliados/page.tsx` | 1 |

## Detalle por ruta

### /admin/cobertura
<a id="admin-cobertura"></a>

**1440 px:** puntaje 174, no aprueba. Alto 2282 px, vacío inicial 19 %, 10652 caracteres (41.2 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/admin/cobertura a 1440 px](img/admin-d2/admin-cobertura-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `section.scroll-mt-24 > div#:R5ufnefj6:.mt-2 > div.space-y-3 > div.divide-y.divide-line.rounded-2xl` | 1142x160, 238 car., vacío 60 % | Faltan 59,079 documentos, de 15,705 contratos Ritm | frontend/app/(public)/aliado/[slug]/page.tsx:114, frontend/app/admin/cobertura/Progreso.tsx:72 |
| rala (vacío interno alto) | `div.py-2.5 > div > dl.grid.grid-cols-2.gap-x-4 > div.relative.grid.min-w-0` | 269x138, 46 car., vacío 65 % | En lotes abiertos 0 documentos esperando turno | frontend/app/admin/cobertura/Progreso.tsx:79 |
| rala (vacío interno alto) | `div.py-2.5 > div > dl.grid.grid-cols-2.gap-x-4 > div.relative.grid.min-w-0` | 269x138, 46 car., vacío 60 % | Ritmo 303 / noche noches con descargas, 7 días | frontend/app/admin/cobertura/Progreso.tsx:76 |

**390 px:** puntaje 2, aprueba. Alto 6953 px, vacío inicial 2 %, 10652 caracteres (41.7 por 10.000 px²).

![/admin/cobertura a 390 px](img/admin-d2/admin-cobertura-390.jpg)

### /admin
<a id="admin-resumen"></a>

**1440 px:** puntaje 80, no aprueba. Alto 1293 px, vacío inicial 23 %, 2865 caracteres (20.3 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/admin a 1440 px](img/admin-d2/admin-resumen-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (vacío interno alto) | `div.grid.items-start.gap-5 > section.scroll-mt-24.min-w-0 > div#:R2dufefj6:.mt-2 > div.overflow-hidden.rounded-2xl.border` | 561x171, 145 car., vacío 59 % | Procesados ya tienen su análisis 200 En revisión h | frontend/app/admin/page.tsx:559, frontend/app/(dashboard)/app/aliados/page.tsx:104 |

**390 px:** puntaje 10, aprueba. Alto 2631 px, vacío inicial 10 %, 2865 caracteres (31.4 por 10.000 px²).

![/admin a 390 px](img/admin-d2/admin-resumen-390.jpg)

### /admin/revision/92a7c528-fca2-4068-bc48-0f2651641028
<a id="admin-revision-ficha"></a>

**1440 px:** puntaje 41, no aprueba. Alto 1180 px, vacío inicial 23 %, 2616 caracteres (20.5 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/admin/revision/92a7c528-fca2-4068-bc48-0f2651641028 a 1440 px](img/admin-d2/admin-revision-ficha-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `main#contenido-admin.p-4 > div.grid.gap-4 > aside.space-y-3 > section.rounded-2xl.border.border-line` | 280x149, 99 car., vacío 42 % | DEL CONTRATO | frontend/app/(dashboard)/app/auditoria/[ocid]/page.tsx:16, frontend/app/(dashboard)/app/contratos/page.tsx:17 |

**390 px:** puntaje 34, no aprueba. Alto 2226 px, vacío inicial 6 %, 2616 caracteres (34.2 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/admin/revision/92a7c528-fca2-4068-bc48-0f2651641028 a 390 px](img/admin-d2/admin-revision-ficha-390.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `main#contenido-admin.p-4 > div.grid.gap-4 > aside.space-y-3 > section.rounded-2xl.border.border-line` | 348x149, 99 car., vacío 54 % | DEL CONTRATO | frontend/app/(dashboard)/app/auditoria/[ocid]/page.tsx:16, frontend/app/(dashboard)/app/contratos/page.tsx:17 |

### /admin/contribuciones
<a id="admin-contribuciones"></a>

**1440 px:** puntaje 35, no aprueba. Alto 1191 px, vacío inicial 25 %, 2970 caracteres (23.1 por 10.000 px²).
Fallos: vacío inicial 25 %; 1 tablas ralas.

![/admin/contribuciones a 1440 px](img/admin-d2/admin-contribuciones-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| tabla (filas muy altas) | `div.overflow-hidden.rounded-2xl.border > div.transition-opacity.duration-rapido > div.overflow-x-auto.hidden > table.w-full.text-sm` | 12 filas, 75 px por fila | Aportes Aporte Zona Contratos leídos Mon |  |

**390 px:** puntaje 3, aprueba. Alto 3294 px, vacío inicial 3 %, 2970 caracteres (25.4 por 10.000 px²).

![/admin/contribuciones a 390 px](img/admin-d2/admin-contribuciones-390.jpg)

### /admin/equipo
<a id="admin-equipo"></a>

**1440 px:** puntaje 26, no aprueba. Alto 900 px, vacío inicial 26 %, 1222 caracteres (19.8 por 10.000 px²).
Fallos: vacío inicial 26 %.

![/admin/equipo a 1440 px](img/admin-d2/admin-equipo-1440.jpg)

**390 px:** puntaje 11, aprueba. Alto 1402 px, vacío inicial 11 %, 1222 caracteres (27.1 por 10.000 px²).

![/admin/equipo a 390 px](img/admin-d2/admin-equipo-390.jpg)

### /admin/revision
<a id="admin-revision"></a>

**1440 px:** puntaje 0, aprueba. Alto 1745 px, vacío inicial 0 %, 24677 caracteres (126.8 por 10.000 px²).

![/admin/revision a 1440 px](img/admin-d2/admin-revision-1440.jpg)

**390 px:** puntaje 5, aprueba. Alto 8459 px, vacío inicial 5 %, 24677 caracteres (78.9 por 10.000 px²).

![/admin/revision a 390 px](img/admin-d2/admin-revision-390.jpg)
