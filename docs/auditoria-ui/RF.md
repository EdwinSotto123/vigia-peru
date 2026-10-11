# Auditoría de densidad de la UI: rf

Generado el 2026-10-11 08:57 UTC contra `http://localhost:3311`. Sesión admin: **no_necesaria**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta rf
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 3 de 3 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/app/financiar?por=partido&anio=2022`](#app-financiar-por-partido) | 10 | sí | 0 | sí | 2599 | 10 % | 0 | nueva |
| [`/app/financiar?por=partido&anio=2022&region=15`](#app-financiar-por-partido-region) | 10 | sí | 0 | sí | 2599 | 10 % | 0 | nueva |
| [`/app/financiar?por=entidad`](#app-financiar-por-entidad) | 5 | sí | 2 | sí | 1906 | 5 % | 0 | nueva |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /app/financiar?por=partido&anio=2022
<a id="app-financiar-por-partido"></a>

**1440 px:** puntaje 10, aprueba. Alto 2599 px, vacío inicial 10 %, 7458 caracteres (24.4 por 10.000 px²).

![/app/financiar?por=partido&anio=2022 a 1440 px](img/rf/app-financiar-por-partido-1440.jpg)

**390 px:** puntaje 0, aprueba. Alto 4564 px, vacío inicial 0 %, 7458 caracteres (43.5 por 10.000 px²).

![/app/financiar?por=partido&anio=2022 a 390 px](img/rf/app-financiar-por-partido-390.jpg)

### /app/financiar?por=partido&anio=2022&region=15
<a id="app-financiar-por-partido-region"></a>

**1440 px:** puntaje 10, aprueba. Alto 2599 px, vacío inicial 10 %, 7458 caracteres (24.4 por 10.000 px²).

![/app/financiar?por=partido&anio=2022&region=15 a 1440 px](img/rf/app-financiar-por-partido-region-1440.jpg)

**390 px:** puntaje 0, aprueba. Alto 4564 px, vacío inicial 0 %, 7458 caracteres (43.5 por 10.000 px²).

![/app/financiar?por=partido&anio=2022&region=15 a 390 px](img/rf/app-financiar-por-partido-region-390.jpg)

### /app/financiar?por=entidad
<a id="app-financiar-por-entidad"></a>

**1440 px:** puntaje 5, aprueba. Alto 1906 px, vacío inicial 5 %, 7131 caracteres (31.9 por 10.000 px²).

![/app/financiar?por=entidad a 1440 px](img/rf/app-financiar-por-entidad-1440.jpg)

**390 px:** puntaje 2, aprueba. Alto 4797 px, vacío inicial 2 %, 7131 caracteres (39.5 por 10.000 px²).

![/app/financiar?por=entidad a 390 px](img/rf/app-financiar-por-entidad-390.jpg)
