# Auditoría de densidad de la UI: color

Generado el 2026-10-11 13:34 UTC contra `http://localhost:3320`. Sesión admin: **no_necesaria**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta color
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 8 de 8 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/app/mapa`](#app-mapa) | 15 | sí | 7 | sí | 1521 | 15 % | 0 | -321 |
| [`/app/contratos/1248872`](#app-contrato-leido) | 15 | sí | 13 | sí | 1385 | 15 % | 0 | -193 |
| [`/app/hallazgos`](#app-hallazgos) | 13 | sí | 6 | sí | 2133 | 13 % | 0 | -132 |
| [`/app/denuncias`](#app-denuncias) | 13 | sí | 1 | sí | 1020 | 13 % | 0 | -242 |
| [`/app/auditoria`](#app-auditoria) | 12 | sí | 5 | sí | 1003 | 12 % | 0 | -154 |
| [`/app`](#app-inicio) | 10 | sí | 7 | sí | 1616 | 10 % | 0 | -23 |
| [`/app/contratos`](#app-contratos) | 10 | sí | 2 | sí | 3790 | 10 % | 0 | -41 |
| [`/app/financiar`](#app-financiar) | 10 | sí | 3 | sí | 1891 | 10 % | 0 | -766 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /app/mapa
<a id="app-mapa"></a>

**1440 px:** puntaje 15, aprueba. Alto 1521 px, vacío inicial 15 %, 6745 caracteres (37.8 por 10.000 px²).

**390 px:** puntaje 7, aprueba. Alto 1656 px, vacío inicial 7 %, 6762 caracteres (110.8 por 10.000 px²).

### /app/contratos/1248872
<a id="app-contrato-leido"></a>

**1440 px:** puntaje 15, aprueba. Alto 1385 px, vacío inicial 15 %, 3920 caracteres (24.1 por 10.000 px²). Nota: ficha de un contrato leído.

**390 px:** puntaje 13, aprueba. Alto 3119 px, vacío inicial 13 %, 3920 caracteres (33.6 por 10.000 px²). Nota: ficha de un contrato leído.

### /app/hallazgos
<a id="app-hallazgos"></a>

**1440 px:** puntaje 13, aprueba. Alto 2133 px, vacío inicial 13 %, 10316 caracteres (41.2 por 10.000 px²).

**390 px:** puntaje 6, aprueba. Alto 3117 px, vacío inicial 6 %, 10316 caracteres (88.5 por 10.000 px²).

### /app/denuncias
<a id="app-denuncias"></a>

**1440 px:** puntaje 13, aprueba. Alto 1020 px, vacío inicial 13 %, 2144 caracteres (17.9 por 10.000 px²).

**390 px:** puntaje 1, aprueba. Alto 2070 px, vacío inicial 1 %, 2144 caracteres (27.9 por 10.000 px²).

### /app/auditoria
<a id="app-auditoria"></a>

**1440 px:** puntaje 12, aprueba. Alto 1003 px, vacío inicial 12 %, 3442 caracteres (29.2 por 10.000 px²).

**390 px:** puntaje 5, aprueba. Alto 1540 px, vacío inicial 5 %, 3372 caracteres (59.5 por 10.000 px²).

### /app
<a id="app-inicio"></a>

**1440 px:** puntaje 10, aprueba. Alto 1616 px, vacío inicial 10 %, 4138 caracteres (21.8 por 10.000 px²).

**390 px:** puntaje 7, aprueba. Alto 2789 px, vacío inicial 7 %, 4113 caracteres (39.5 por 10.000 px²).

### /app/contratos
<a id="app-contratos"></a>

**1440 px:** puntaje 10, aprueba. Alto 3790 px, vacío inicial 10 %, 13942 caracteres (31.3 por 10.000 px²).

**390 px:** puntaje 2, aprueba. Alto 6370 px, vacío inicial 2 %, 13942 caracteres (58 por 10.000 px²).

### /app/financiar
<a id="app-financiar"></a>

**1440 px:** puntaje 10, aprueba. Alto 1891 px, vacío inicial 10 %, 5368 caracteres (24.2 por 10.000 px²).

**390 px:** puntaje 3, aprueba. Alto 4214 px, vacío inicial 3 %, 5368 caracteres (33.9 por 10.000 px²).
