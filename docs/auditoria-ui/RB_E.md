# Auditoría de densidad de la UI: rb-e

Generado el 2026-10-11 09:03 UTC contra `http://localhost:3320`. Sesión admin: **no_necesaria**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta rb-e
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 2 de 2 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [`/reporte/nuevo?modo=entidad`](#app-reporte-entidad) | 24 | sí | 8 | sí | 998 | 24 % | 0 |
| [`/reporte/nuevo`](#app-reporte) | 22 | sí | 11 | sí | 1055 | 22 % | 0 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /reporte/nuevo?modo=entidad
<a id="app-reporte-entidad"></a>

**1440 px:** puntaje 24, aprueba. Alto 998 px, vacío inicial 24 %, 1703 caracteres (14.5 por 10.000 px²). Nota: formulario de denuncia a una entidad.

![/reporte/nuevo?modo=entidad a 1440 px](img/rb-e/app-reporte-entidad-1440.jpg)

**390 px:** puntaje 8, aprueba. Alto 983 px, vacío inicial 8 %, 1703 caracteres (48 por 10.000 px²). Nota: formulario de denuncia a una entidad.

![/reporte/nuevo?modo=entidad a 390 px](img/rb-e/app-reporte-entidad-390.jpg)

### /reporte/nuevo
<a id="app-reporte"></a>

**1440 px:** puntaje 22, aprueba. Alto 1055 px, vacío inicial 22 %, 2163 caracteres (17.5 por 10.000 px²). Nota: formulario de denuncia de obra, tres columnas.

![/reporte/nuevo a 1440 px](img/rb-e/app-reporte-1440.jpg)

**390 px:** puntaje 11, aprueba. Alto 1139 px, vacío inicial 11 %, 2163 caracteres (52.2 por 10.000 px²). Nota: formulario de denuncia de obra, tres columnas.

![/reporte/nuevo a 390 px](img/rb-e/app-reporte-390.jpg)
