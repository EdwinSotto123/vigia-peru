# Auditoría de densidad de la UI: rb-h

Generado el 2026-10-11 13:26 UTC contra `http://localhost:3320`. Sesión admin: **no_necesaria**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta rb-h
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 1 de 1 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/app/partidos`](#app-partidos) | 21 | sí | 9 | sí | 1823 | 21 % | 0 | -576 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /app/partidos
<a id="app-partidos"></a>

**1440 px:** puntaje 21, aprueba. Alto 1823 px, vacío inicial 21 %, 3100 caracteres (14.5 por 10.000 px²).

![/app/partidos a 1440 px](img/rb-h/app-partidos-1440.jpg)

**390 px:** puntaje 9, aprueba. Alto 2867 px, vacío inicial 9 %, 3573 caracteres (33.4 por 10.000 px²).

![/app/partidos a 390 px](img/rb-h/app-partidos-390.jpg)
