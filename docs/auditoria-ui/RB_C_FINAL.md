# Auditoría de densidad de la UI: rb-c-final

Generado el 2026-10-11 09:09 UTC contra `http://localhost:3300`. Sesión admin: **no_necesaria**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta rb-c-final
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 7 de 7 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/entidad/20406325815`](#app-entidad-ficha) | 21 | sí | 9 | sí | 1394 | 21 % | 0 | nueva |
| [`/app/contratos/1256450`](#app-contrato-sin-leer) | 20 | sí | 7 | sí | 943 | 20 % | 0 | -211 |
| [`/app/partidos/partido-democratico-somos-peru?anio=2022`](#app-partido-ficha) | 19 | sí | 7 | sí | 2122 | 19 % | 0 | -180 |
| [`/app/convocatoria`](#app-convocatoria) | 19 | sí | 6 | sí | 2134 | 19 % | 0 | -127 |
| [`/app/contratos/1248872`](#app-contrato-leido) | 15 | sí | 7 | sí | 1385 | 15 % | 0 | -193 |
| [`/app/hallazgos`](#app-hallazgos) | 9 | sí | 3 | sí | 2096 | 9 % | 0 | -136 |
| [`/app/auditoria`](#app-auditoria) | 9 | sí | 6 | sí | 960 | 9 % | 0 | -157 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /entidad/20406325815
<a id="app-entidad-ficha"></a>

**1440 px:** puntaje 21, aprueba. Alto 1394 px, vacío inicial 21 %, 5431 caracteres (33.2 por 10.000 px²). Nota: ficha de una entidad.

![/entidad/20406325815 a 1440 px](img/rb-c-final/app-entidad-ficha-1440.jpg)

**390 px:** puntaje 9, aprueba. Alto 2036 px, vacío inicial 9 %, 5557 caracteres (73.6 por 10.000 px²). Nota: ficha de una entidad.

![/entidad/20406325815 a 390 px](img/rb-c-final/app-entidad-ficha-390.jpg)

### /app/contratos/1256450
<a id="app-contrato-sin-leer"></a>

**1440 px:** puntaje 20, aprueba. Alto 943 px, vacío inicial 20 %, 2737 caracteres (24.7 por 10.000 px²). Nota: ficha de un contrato sin leer.

![/app/contratos/1256450 a 1440 px](img/rb-c-final/app-contrato-sin-leer-1440.jpg)

**390 px:** puntaje 7, aprueba. Alto 2198 px, vacío inicial 7 %, 2737 caracteres (33.5 por 10.000 px²). Nota: ficha de un contrato sin leer.

![/app/contratos/1256450 a 390 px](img/rb-c-final/app-contrato-sin-leer-390.jpg)

### /app/partidos/partido-democratico-somos-peru?anio=2022
<a id="app-partido-ficha"></a>

**1440 px:** puntaje 19, aprueba. Alto 2122 px, vacío inicial 19 %, 3740 caracteres (15 por 10.000 px²).

![/app/partidos/partido-democratico-somos-peru?anio=2022 a 1440 px](img/rb-c-final/app-partido-ficha-1440.jpg)

**390 px:** puntaje 7, aprueba. Alto 2943 px, vacío inicial 7 %, 3740 caracteres (34 por 10.000 px²).

![/app/partidos/partido-democratico-somos-peru?anio=2022 a 390 px](img/rb-c-final/app-partido-ficha-390.jpg)

### /app/convocatoria
<a id="app-convocatoria"></a>

**1440 px:** puntaje 19, aprueba. Alto 2134 px, vacío inicial 19 %, 8476 caracteres (33.8 por 10.000 px²).

![/app/convocatoria a 1440 px](img/rb-c-final/app-convocatoria-1440.jpg)

**390 px:** puntaje 6, aprueba. Alto 3632 px, vacío inicial 6 %, 8750 caracteres (64.3 por 10.000 px²).

![/app/convocatoria a 390 px](img/rb-c-final/app-convocatoria-390.jpg)

### /app/contratos/1248872
<a id="app-contrato-leido"></a>

**1440 px:** puntaje 15, aprueba. Alto 1385 px, vacío inicial 15 %, 3920 caracteres (24.1 por 10.000 px²). Nota: ficha de un contrato leído.

![/app/contratos/1248872 a 1440 px](img/rb-c-final/app-contrato-leido-1440.jpg)

**390 px:** puntaje 7, aprueba. Alto 3003 px, vacío inicial 7 %, 3920 caracteres (34.9 por 10.000 px²). Nota: ficha de un contrato leído.

![/app/contratos/1248872 a 390 px](img/rb-c-final/app-contrato-leido-390.jpg)

### /app/hallazgos
<a id="app-hallazgos"></a>

**1440 px:** puntaje 9, aprueba. Alto 2096 px, vacío inicial 9 %, 10315 caracteres (41.9 por 10.000 px²).

![/app/hallazgos a 1440 px](img/rb-c-final/app-hallazgos-1440.jpg)

**390 px:** puntaje 3, aprueba. Alto 3074 px, vacío inicial 3 %, 10315 caracteres (89.7 por 10.000 px²).

![/app/hallazgos a 390 px](img/rb-c-final/app-hallazgos-390.jpg)

### /app/auditoria
<a id="app-auditoria"></a>

**1440 px:** puntaje 9, aprueba. Alto 960 px, vacío inicial 9 %, 3442 caracteres (30.6 por 10.000 px²).

![/app/auditoria a 1440 px](img/rb-c-final/app-auditoria-1440.jpg)

**390 px:** puntaje 6, aprueba. Alto 1490 px, vacío inicial 6 %, 3372 caracteres (61.6 por 10.000 px²).

![/app/auditoria a 390 px](img/rb-c-final/app-auditoria-390.jpg)
