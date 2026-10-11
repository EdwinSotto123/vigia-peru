# Auditoría de densidad de la UI: admin-e

Generado el 2026-10-11 12:15 UTC contra `http://localhost:3300`. Sesión admin: **ok**.

Repetir esta auditoría:

```bash
node frontend/scripts/auditoria-ui/auditar.mjs --rutas app,admin --salida docs/auditoria-ui --etiqueta admin-e
```

## Cómo se lee

- **Puntaje de desperdicio** = suma del área desperdiciada de cajas ralas, huecos fuera de separadores y min-height forzada (en miles de px²), más el vacío del primer viewport en puntos porcentuales, más 10 por tabla rala. Más bajo es mejor.
- **Aprueba** una ruta si, en los dos anchos: 0 cajas ralas de más de 40.000 px², vacío del primer viewport menor a 25 %, 0 huecos de más de 72 px (salvo separadores de sección), 0 bloques con min-height forzada y poco contenido, y 0 tablas ralas.
- **Caja rala:** borde, fondo o sombra, al menos 160x72 px, con área de 40.000 px² o más y menos de 120 caracteres sin medios que la llenen, o con más de 55 % de vacío interno.

**Resultado:** 1 de 1 rutas aprueban.

## Resumen por ruta (peor primero)

| Ruta | Puntaje 1440 | Aprueba 1440 | Alto 1440 (px) | Vacío inicial 1440 | Cajas ralas 1440 | Cambio de puntaje |
| --- | --- | --- | --- | --- | --- | --- |
| [`/admin/revision/92a7c528-fca2-4068-bc48-0f2651641028`](#admin-revision-ficha) | 19 | sí | 1180 | 19 % | 0 | -938 |

## Causas más repetidas

| Causa | Veces |
| --- | --- |

## Detalle por ruta

### /admin/revision/92a7c528-fca2-4068-bc48-0f2651641028
<a id="admin-revision-ficha"></a>

**1440 px:** puntaje 19, aprueba. Alto 1180 px, vacío inicial 19 %, 2673 caracteres (21 por 10.000 px²).

![/admin/revision/92a7c528-fca2-4068-bc48-0f2651641028 a 1440 px](img/admin-e/admin-revision-ficha-1440.jpg)
