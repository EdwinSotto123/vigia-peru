# Auditoría de densidad de la UI: ref-c

Generado el 2026-10-11 08:20 UTC contra `http://localhost:3300`. Sesión admin: **no_necesaria**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta ref-c
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 1 de 3 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- |
| [`/app/contratos/1256450`](#app-contrato-sin-leer) | 37 | no | 900 | 37 % | 0 | -194 |
| [`/app/contratos/1248872`](#app-contrato-leido) | 28 | no | 1051 | 28 % | 0 | -180 |
| [`/app/hallazgos`](#app-hallazgos) | 9 | sí | 2096 | 9 % | 0 | -136 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /app/contratos/1256450
<a id="app-contrato-sin-leer"></a>

**1440 px:** puntaje 37, no aprueba. Alto 900 px, vacío inicial 37 %, 1898 caracteres (17.8 por 10.000 px²). Nota: ficha de un contrato sin leer.
Fallos: vacío inicial 37 %.

![/app/contratos/1256450 a 1440 px](img/ref-c/app-contrato-sin-leer-1440.jpg)

### /app/contratos/1248872
<a id="app-contrato-leido"></a>

**1440 px:** puntaje 28, no aprueba. Alto 1051 px, vacío inicial 28 %, 2261 caracteres (18.3 por 10.000 px²). Nota: ficha de un contrato leído.
Fallos: vacío inicial 28 %.

![/app/contratos/1248872 a 1440 px](img/ref-c/app-contrato-leido-1440.jpg)

### /app/hallazgos
<a id="app-hallazgos"></a>

**1440 px:** puntaje 9, aprueba. Alto 2096 px, vacío inicial 9 %, 10315 caracteres (41.9 por 10.000 px²).

![/app/hallazgos a 1440 px](img/ref-c/app-hallazgos-1440.jpg)
