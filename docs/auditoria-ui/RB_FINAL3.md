# Auditoría de densidad de la UI: rb-final3

Generado el 2026-10-11 09:20 UTC contra `http://localhost:3300`. Sesión admin: **no_necesaria**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta rb-final3
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 3 de 3 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/app/mapa`](#app-mapa) | 13 | sí | 4 | sí | 1484 | 13 % | 0 | -323 |
| [`/app`](#app-inicio) | 10 | sí | 7 | sí | 1616 | 10 % | 0 | -23 |
| [`/app/hallazgos`](#app-hallazgos) | 9 | sí | 3 | sí | 2096 | 9 % | 0 | -136 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /app/mapa
<a id="app-mapa"></a>

**1440 px:** puntaje 13, aprueba. Alto 1484 px, vacío inicial 13 %, 6711 caracteres (38.5 por 10.000 px²).

![/app/mapa a 1440 px](img/rb-final3/app-mapa-1440.jpg)

**390 px:** puntaje 4, aprueba. Alto 1603 px, vacío inicial 4 %, 6728 caracteres (114 por 10.000 px²).

![/app/mapa a 390 px](img/rb-final3/app-mapa-390.jpg)

### /app
<a id="app-inicio"></a>

**1440 px:** puntaje 10, aprueba. Alto 1616 px, vacío inicial 10 %, 4138 caracteres (21.8 por 10.000 px²).

![/app a 1440 px](img/rb-final3/app-inicio-1440.jpg)

**390 px:** puntaje 7, aprueba. Alto 2789 px, vacío inicial 7 %, 4113 caracteres (39.5 por 10.000 px²).

![/app a 390 px](img/rb-final3/app-inicio-390.jpg)

### /app/hallazgos
<a id="app-hallazgos"></a>

**1440 px:** puntaje 9, aprueba. Alto 2096 px, vacío inicial 9 %, 10315 caracteres (41.9 por 10.000 px²).

![/app/hallazgos a 1440 px](img/rb-final3/app-hallazgos-1440.jpg)

**390 px:** puntaje 3, aprueba. Alto 3074 px, vacío inicial 3 %, 10315 caracteres (89.7 por 10.000 px²).

![/app/hallazgos a 390 px](img/rb-final3/app-hallazgos-390.jpg)
