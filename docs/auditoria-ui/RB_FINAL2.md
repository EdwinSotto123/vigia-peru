# Auditoría de densidad de la UI: rb-final2

Generado el 2026-10-11 09:18 UTC contra `http://localhost:3300`. Sesión admin: **no_necesaria**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta rb-final2
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 4 de 4 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/app/mi-impacto`](#app-mi-impacto) | 22 | sí | 8 | sí | 1078 | 22 % | 0 | -289 |
| [`/app/configuracion`](#app-configuracion) | 18 | sí | 5 | sí | 992 | 18 % | 0 | -306 |
| [`/app/denuncias`](#app-denuncias) | 13 | sí | 0 | sí | 986 | 13 % | 0 | -242 |
| [`/app/auditoria`](#app-auditoria) | 9 | sí | 6 | sí | 960 | 9 % | 0 | -157 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /app/mi-impacto
<a id="app-mi-impacto"></a>

**1440 px:** puntaje 22, aprueba. Alto 1078 px, vacío inicial 22 %, 2209 caracteres (17.5 por 10.000 px²). Nota: pide cuenta: se audita lo que ve alguien sin sesión.

![/app/mi-impacto a 1440 px](img/rb-final2/app-mi-impacto-1440.jpg)

**390 px:** puntaje 8, aprueba. Alto 2271 px, vacío inicial 8 %, 2209 caracteres (26.2 por 10.000 px²). Nota: pide cuenta: se audita lo que ve alguien sin sesión.

![/app/mi-impacto a 390 px](img/rb-final2/app-mi-impacto-390.jpg)

### /app/configuracion
<a id="app-configuracion"></a>

**1440 px:** puntaje 18, aprueba. Alto 992 px, vacío inicial 18 %, 2534 caracteres (21.8 por 10.000 px²). Nota: pide cuenta: se audita lo que ve alguien sin sesión.

![/app/configuracion a 1440 px](img/rb-final2/app-configuracion-1440.jpg)

**390 px:** puntaje 5, aprueba. Alto 2280 px, vacío inicial 5 %, 2534 caracteres (29.9 por 10.000 px²). Nota: pide cuenta: se audita lo que ve alguien sin sesión.

![/app/configuracion a 390 px](img/rb-final2/app-configuracion-390.jpg)

### /app/denuncias
<a id="app-denuncias"></a>

**1440 px:** puntaje 13, aprueba. Alto 986 px, vacío inicial 13 %, 2144 caracteres (18.5 por 10.000 px²).

![/app/denuncias a 1440 px](img/rb-final2/app-denuncias-1440.jpg)

**390 px:** puntaje 0, aprueba. Alto 2036 px, vacío inicial 0 %, 2144 caracteres (28.4 por 10.000 px²).

![/app/denuncias a 390 px](img/rb-final2/app-denuncias-390.jpg)

### /app/auditoria
<a id="app-auditoria"></a>

**1440 px:** puntaje 9, aprueba. Alto 960 px, vacío inicial 9 %, 3442 caracteres (30.6 por 10.000 px²).

![/app/auditoria a 1440 px](img/rb-final2/app-auditoria-1440.jpg)

**390 px:** puntaje 6, aprueba. Alto 1490 px, vacío inicial 6 %, 3372 caracteres (61.6 por 10.000 px²).

![/app/auditoria a 390 px](img/rb-final2/app-auditoria-390.jpg)
