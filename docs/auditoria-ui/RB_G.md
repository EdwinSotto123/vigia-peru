# Auditoría de densidad de la UI: rb-g

Generado el 2026-10-11 13:27 UTC contra `http://localhost:3321`. Sesión admin: **no_necesaria**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta rb-g
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 1 de 1 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/app/aliados/aportes`](#app-aliados-aportes) | 24 | sí | 10 | sí | 1005 | 24 % | 0 | nueva |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /app/aliados/aportes
<a id="app-aliados-aportes"></a>

**1440 px:** puntaje 24, aprueba. Alto 1005 px, vacío inicial 24 %, 1231 caracteres (10.4 por 10.000 px²).

![/app/aliados/aportes a 1440 px](img/rb-g/app-aliados-aportes-1440.jpg)

**390 px:** puntaje 10, aprueba. Alto 1634 px, vacío inicial 10 %, 1231 caracteres (20.4 por 10.000 px²).

![/app/aliados/aportes a 390 px](img/rb-g/app-aliados-aportes-390.jpg)
