# Auditoría de densidad de la UI: color-admin

Generado el 2026-10-11 13:35 UTC contra `http://localhost:3320`. Sesión admin: **ok**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta color-admin
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 1 de 1 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- |
| [`/admin`](#admin-resumen) | 18 | sí | 1208 | 18 % | 0 | -202 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /admin
<a id="admin-resumen"></a>

**1440 px:** puntaje 18, aprueba. Alto 1208 px, vacío inicial 18 %, 2844 caracteres (21.8 por 10.000 px²).

![/admin a 1440 px](img/color-admin/admin-resumen-1440.jpg)
