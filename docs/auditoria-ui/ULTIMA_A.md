# Auditoría de densidad de la UI: ultima-a

Generado el 2026-10-11 08:08 UTC contra `http://localhost:3310`. Sesión admin: **no_necesaria**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta ultima-a
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 8 de 8 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/app/aliados`](#app-aliados) | 24 | sí | 2 | sí | 954 | 24 % | 0 | -927 |
| [`/app/entidades`](#app-entidades) | 22 | sí | 4 | sí | 1453 | 22 % | 0 | -84 |
| [`/app/financiar/entidad/20406325815`](#app-financiar-entidad) | 21 | sí | 10 | sí | 4847 | 21 % | 0 | -3 |
| [`/app/financiar/partido/partido-democratico-somos-peru?anio=2022`](#app-financiar-partido) | 21 | sí | 7 | sí | 1229 | 21 % | 0 | -21 |
| [`/app/financiar/21`](#app-financiar-zona) | 20 | sí | 13 | sí | 1158 | 20 % | 0 | -68 |
| [`/app/partidos`](#app-partidos) | 11 | sí | 1 | sí | 2059 | 11 % | 0 | -586 |
| [`/app/financiar`](#app-financiar) | 8 | sí | 2 | sí | 1854 | 8 % | 0 | -768 |
| [`/app/financiar/entidad`](#app-financiar-entidades) (pide cuenta) | 5 | sí | 1 | sí | 1898 | 5 % | 0 | -14 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /app/aliados
<a id="app-aliados"></a>

**1440 px:** puntaje 24, aprueba. Alto 954 px, vacío inicial 24 %, 3816 caracteres (34.1 por 10.000 px²).

![/app/aliados a 1440 px](img/ultima-a/app-aliados-1440.jpg)

**390 px:** puntaje 2, aprueba. Alto 1931 px, vacío inicial 2 %, 3816 caracteres (53.3 por 10.000 px²).

![/app/aliados a 390 px](img/ultima-a/app-aliados-390.jpg)

### /app/entidades
<a id="app-entidades"></a>

**1440 px:** puntaje 22, aprueba. Alto 1453 px, vacío inicial 22 %, 3044 caracteres (17.8 por 10.000 px²).

![/app/entidades a 1440 px](img/ultima-a/app-entidades-1440.jpg)

**390 px:** puntaje 4, aprueba. Alto 2000 px, vacío inicial 4 %, 3044 caracteres (41.1 por 10.000 px²).

![/app/entidades a 390 px](img/ultima-a/app-entidades-390.jpg)

### /app/financiar/entidad/20406325815
<a id="app-financiar-entidad"></a>

**1440 px:** puntaje 21, aprueba. Alto 4847 px, vacío inicial 21 %, 18027 caracteres (31.7 por 10.000 px²).

![/app/financiar/entidad/20406325815 a 1440 px](img/ultima-a/app-financiar-entidad-1440.jpg)

**390 px:** puntaje 10, aprueba. Alto 7283 px, vacío inicial 10 %, 18027 caracteres (65.6 por 10.000 px²).

![/app/financiar/entidad/20406325815 a 390 px](img/ultima-a/app-financiar-entidad-390.jpg)

### /app/financiar/partido/partido-democratico-somos-peru?anio=2022
<a id="app-financiar-partido"></a>

**1440 px:** puntaje 21, aprueba. Alto 1229 px, vacío inicial 21 %, 3086 caracteres (21.4 por 10.000 px²).

![/app/financiar/partido/partido-democratico-somos-peru?anio=2022 a 1440 px](img/ultima-a/app-financiar-partido-1440.jpg)

**390 px:** puntaje 7, aprueba. Alto 2833 px, vacío inicial 7 %, 3086 caracteres (29.2 por 10.000 px²).

![/app/financiar/partido/partido-democratico-somos-peru?anio=2022 a 390 px](img/ultima-a/app-financiar-partido-390.jpg)

### /app/financiar/21
<a id="app-financiar-zona"></a>

**1440 px:** puntaje 20, aprueba. Alto 1158 px, vacío inicial 20 %, 3333 caracteres (24.5 por 10.000 px²).

![/app/financiar/21 a 1440 px](img/ultima-a/app-financiar-zona-1440.jpg)

**390 px:** puntaje 13, aprueba. Alto 2693 px, vacío inicial 13 %, 3333 caracteres (33.2 por 10.000 px²).

![/app/financiar/21 a 390 px](img/ultima-a/app-financiar-zona-390.jpg)

### /app/partidos
<a id="app-partidos"></a>

**1440 px:** puntaje 11, aprueba. Alto 2059 px, vacío inicial 11 %, 2864 caracteres (11.8 por 10.000 px²).

![/app/partidos a 1440 px](img/ultima-a/app-partidos-1440.jpg)

**390 px:** puntaje 1, aprueba. Alto 3766 px, vacío inicial 1 %, 2814 caracteres (19.9 por 10.000 px²).

![/app/partidos a 390 px](img/ultima-a/app-partidos-390.jpg)

### /app/financiar
<a id="app-financiar"></a>

**1440 px:** puntaje 8, aprueba. Alto 1854 px, vacío inicial 8 %, 5368 caracteres (24.7 por 10.000 px²).

![/app/financiar a 1440 px](img/ultima-a/app-financiar-1440.jpg)

**390 px:** puntaje 2, aprueba. Alto 4133 px, vacío inicial 2 %, 5368 caracteres (34.6 por 10.000 px²).

![/app/financiar a 390 px](img/ultima-a/app-financiar-390.jpg)

### /app/financiar/entidad
<a id="app-financiar-entidades"></a>

**1440 px:** puntaje 5, aprueba. Alto 1898 px, vacío inicial 5 %, 6856 caracteres (30.8 por 10.000 px²). Redirige a `/app/financiar?por=entidad`.

![/app/financiar/entidad a 1440 px](img/ultima-a/app-financiar-entidades-1440.jpg)

**390 px:** puntaje 1, aprueba. Alto 4639 px, vacío inicial 1 %, 6856 caracteres (39.3 por 10.000 px²). Redirige a `/app/financiar?por=entidad`.

![/app/financiar/entidad a 390 px](img/ultima-a/app-financiar-entidades-390.jpg)
