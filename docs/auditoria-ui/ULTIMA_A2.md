# Auditoría de densidad de la UI: ultima-a2

Generado el 2026-10-11 08:01 UTC contra `http://localhost:3310`. Sesión admin: **no_necesaria**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta ultima-a2
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 2 de 5 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Puntaje 390 | Aprueba 390 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [`/app/financiar/21`](#app-financiar-zona) | 68 | no | 11 | sí | 1179 | 42 % | 1 | -20 |
| [`/app/financiar/entidad/20406325815`](#app-financiar-entidad) | 47 | no | 10 | sí | 4847 | 21 % | 1 | +23 |
| [`/app/financiar/partido/partido-democratico-somos-peru?anio=2022`](#app-financiar-partido) | 47 | no | 7 | sí | 1263 | 21 % | 1 | +5 |
| [`/app/aliados`](#app-aliados) | 24 | sí | 2 | sí | 954 | 24 % | 0 | -927 |
| [`/app/financiar/entidad`](#app-financiar-entidades) (pide cuenta) | 5 | sí | 1 | sí | 1898 | 5 % | 0 | -14 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |
| poco texto en caja grande | 3 |

Clases de Tailwind que más aparecen en las cajas ralas:

`pt-5` (3)

Componentes con más cajas ralas:

| Archivo | Cajas ralas |
| --- | --- |
| `frontend/components/admin/ui/estados.ts` | 3 |
| `frontend/components/financiar/PaymentMethods.tsx` | 3 |

## Detalle por ruta

### /app/financiar/21
<a id="app-financiar-zona"></a>

**1440 px:** puntaje 68, no aprueba. Alto 1179 px, vacío inicial 42 %, 2591 caracteres (18.7 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px²; vacío inicial 42 %.

![/app/financiar/21 a 1440 px](img/ultima-a2/app-financiar-zona-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.grid.gap-8 > section#aportar.order-first.w-full.max-w-2xl > form.rounded-2xl.border.border-line > fieldset.mt-6.min-w-0.border-t` | 390x118, 56 car., vacío 56 % | ¿CÓMO PAGAS? Yape Plin Transferencia Aceptamos yap | frontend/components/admin/ui/estados.ts:31, frontend/components/financiar/PaymentMethods.tsx:106 |

**390 px:** puntaje 11, aprueba. Alto 1862 px, vacío inicial 11 %, 2591 caracteres (37.6 por 10.000 px²).

![/app/financiar/21 a 390 px](img/ultima-a2/app-financiar-zona-390.jpg)

### /app/financiar/entidad/20406325815
<a id="app-financiar-entidad"></a>

**1440 px:** puntaje 47, no aprueba. Alto 4847 px, vacío inicial 21 %, 18027 caracteres (31.7 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/app/financiar/entidad/20406325815 a 1440 px](img/ultima-a2/app-financiar-entidad-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.grid.gap-8 > section#aportar.order-first.w-full.max-w-2xl > form.rounded-2xl.border.border-line > fieldset.mt-6.min-w-0.border-t` | 390x118, 56 car., vacío 56 % | ¿CÓMO PAGAS? Yape Plin Transferencia Aceptamos yap | frontend/components/admin/ui/estados.ts:31, frontend/components/financiar/PaymentMethods.tsx:106 |

**390 px:** puntaje 10, aprueba. Alto 7225 px, vacío inicial 10 %, 18027 caracteres (66.1 por 10.000 px²).

![/app/financiar/entidad/20406325815 a 390 px](img/ultima-a2/app-financiar-entidad-390.jpg)

### /app/financiar/partido/partido-democratico-somos-peru?anio=2022
<a id="app-financiar-partido"></a>

**1440 px:** puntaje 47, no aprueba. Alto 1263 px, vacío inicial 21 %, 3086 caracteres (20.8 por 10.000 px²).
Fallos: 1 cajas ralas > 40.000 px².

![/app/financiar/partido/partido-democratico-somos-peru?anio=2022 a 1440 px](img/ultima-a2/app-financiar-partido-1440.jpg)

| Tipo | Selector | Medidas | Texto | Componente probable |
| --- | --- | --- | --- | --- |
| rala (poco texto en caja grande) | `div.grid.gap-8 > section#aportar.order-first.w-full.max-w-2xl > form.rounded-2xl.border.border-line > fieldset.mt-6.min-w-0.border-t` | 390x118, 56 car., vacío 56 % | ¿CÓMO PAGAS? Yape Plin Transferencia Aceptamos yap | frontend/components/admin/ui/estados.ts:31, frontend/components/financiar/PaymentMethods.tsx:106 |

**390 px:** puntaje 7, aprueba. Alto 2805 px, vacío inicial 7 %, 3086 caracteres (29.5 por 10.000 px²).

![/app/financiar/partido/partido-democratico-somos-peru?anio=2022 a 390 px](img/ultima-a2/app-financiar-partido-390.jpg)

### /app/aliados
<a id="app-aliados"></a>

**1440 px:** puntaje 24, aprueba. Alto 954 px, vacío inicial 24 %, 3816 caracteres (34.1 por 10.000 px²).

![/app/aliados a 1440 px](img/ultima-a2/app-aliados-1440.jpg)

**390 px:** puntaje 2, aprueba. Alto 1884 px, vacío inicial 2 %, 3816 caracteres (54.7 por 10.000 px²).

![/app/aliados a 390 px](img/ultima-a2/app-aliados-390.jpg)

### /app/financiar/entidad
<a id="app-financiar-entidades"></a>

**1440 px:** puntaje 5, aprueba. Alto 1898 px, vacío inicial 5 %, 6856 caracteres (30.8 por 10.000 px²). Redirige a `/app/financiar?por=entidad`.

![/app/financiar/entidad a 1440 px](img/ultima-a2/app-financiar-entidades-1440.jpg)

**390 px:** puntaje 1, aprueba. Alto 4600 px, vacío inicial 1 %, 6856 caracteres (39.6 por 10.000 px²). Redirige a `/app/financiar?por=entidad`.

![/app/financiar/entidad a 390 px](img/ultima-a2/app-financiar-entidades-390.jpg)
