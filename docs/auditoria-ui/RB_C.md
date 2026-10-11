# Auditoría de densidad de la UI: rb-c

Generado el 2026-10-11 09:02 UTC contra `http://localhost:3300`. Sesión admin: **no_necesaria**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta rb-c
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 2 de 2 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/app/contratos/1256450`](#app-contrato-sin-leer) | 20 | sí | 7 | sí | 943 | 20 % | 0 | -211 |
| [`/app/contratos/1248872`](#app-contrato-leido) | 15 | sí | 7 | sí | 1385 | 15 % | 0 | -193 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /app/contratos/1256450
<a id="app-contrato-sin-leer"></a>

**1440 px:** puntaje 20, aprueba. Alto 943 px, vacío inicial 20 %, 2737 caracteres (24.7 por 10.000 px²). Nota: ficha de un contrato sin leer.

![/app/contratos/1256450 a 1440 px](img/rb-c/app-contrato-sin-leer-1440.jpg)

**390 px:** puntaje 7, aprueba. Alto 2198 px, vacío inicial 7 %, 2737 caracteres (33.5 por 10.000 px²). Nota: ficha de un contrato sin leer.

![/app/contratos/1256450 a 390 px](img/rb-c/app-contrato-sin-leer-390.jpg)

### /app/contratos/1248872
<a id="app-contrato-leido"></a>

**1440 px:** puntaje 15, aprueba. Alto 1385 px, vacío inicial 15 %, 3920 caracteres (24.1 por 10.000 px²). Nota: ficha de un contrato leído.

![/app/contratos/1248872 a 1440 px](img/rb-c/app-contrato-leido-1440.jpg)

**390 px:** puntaje 7, aprueba. Alto 3003 px, vacío inicial 7 %, 3920 caracteres (34.9 por 10.000 px²). Nota: ficha de un contrato leído.

![/app/contratos/1248872 a 390 px](img/rb-c/app-contrato-leido-390.jpg)
