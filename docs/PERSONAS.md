# Personas contratadas, planilla y plazas CAS

Vigía vigila cómo el Estado contrata **personas**, no sólo empresas. Tres fuentes oficiales, tres maneras de entrar:

| Cómo entra | Fuente | Tabla | Carga |
|---|---|---|---|
| Por **órdenes de servicio** de hasta 8 UIT, sin concurso (locadores, asesores, choferes…) | OECE, CONOSCE: órdenes de compra y de servicio (persona natural = RUC 10) | `conosce_ordenes` → `persona_orden_anual`, `persona_senal`, `persona_entidad` (migración 91) | `conosce_ordenes` de vigia-scrapers, los sábados |
| En **planilla** (CAS, 276, 728, funcionarios, Ley Servir) | Portal de Transparencia Estándar de cada entidad, rubro Personal | `planilla_pte` → `planilla_persona`, `cargo_referencia` (migración 92) | `pte_personal` de vigia-scrapers, el día 20 |
| Por **concurso CAS** | SERVIR Talento Perú, ofertas laborales | `servir_convocatoria` (migración 93) | `backend/scripts/cargar_servir_convocatorias.py`, semanal, desde una PC en el Perú (SERVIR da 403 a Cloudflare) |

En la web: `/app/personas` (tres pestañas: por órdenes, en planilla, plazas CAS), la ficha de cada persona
(`/app/personas/<código>`) y las pestañas «Personas contratadas», «Planilla» y «Plazas CAS» de cada entidad; la de
personas también en cada partido (lo que contrataron sus gobiernos) y un bloque en el Inicio de la entidad, el partido
y la región.

## Las señales

Son **indicios para revisar**. Ninguna prueba un delito ni un parentesco; la web lo dice en cada lista.

**Por órdenes** (`persona_senal`, por persona y entidad):

| Señal | Gravedad | Qué dice |
|---|---|---|
| `candidato_gobierna` | alta | fue candidato (JNE) del partido que gobernaba la entidad cuando le dieron las órdenes |
| `autoridad_contratada` | alta / media / baja | es autoridad electa en funciones: alta si del mismo gobierno (LOM art. 11), media si alcalde o gobernador de otro |
| `inhabilitado` | alta | recibió órdenes durante una inhabilitación del Tribunal de Contrataciones |
| `tambien_planilla` | alta | recibe órdenes de una entidad en cuya planilla figura ese mes (migración 92) |
| `aporte_gobierna` | media | aportó (ONPE) al partido que gobernaba la entidad |
| `apellidos_autoridad` | media / baja | tiene los dos apellidos de una autoridad del gobierno de la entidad (baja si son comunes) |
| `apellidos_funcionario` | media | tiene los dos apellidos, poco comunes, de un declarante de la DJI de la misma entidad |
| `funcionario_contratado` | media | declaró (DJI) trabajar en la entidad el año en que ella le dio órdenes |
| `meses_seguidos` | media | órdenes en 10 o más meses de un mismo año: un puesto permanente pagado como locación |
| `pago_alto` | media | cobra por mes 2,5 veces o más la mediana de su tipo de servicio en la entidad (y más de S/ 6,000) |
| `candidato`, `aporte` | baja | candidato o aportante de otro partido |
| `visita_previa` | baja | visitó la entidad en los 180 días antes de su primera orden del año |
| `paso_a_planilla` | baja | después de sus órdenes entró a la planilla de la entidad |

**En planilla** (`planilla_persona`): `tambien_ordenes` (alta), `candidato_gobierna` (alta), `brecha_cargo` (media:
el sueldo, doble o más que la mediana de su mismo cargo en la entidad, y a lo más 10 con ese cargo ganan tanto: si son
más, es otro nivel de la escala), `apellidos_autoridad`, `apellidos_directivo`
(media: los apellidos, poco comunes, de un gerente o director de la misma planilla), `antes_locador` y
`pago_extraordinario` (baja: S/ 20,000 o más fuera del sueldo, el triple o más; suele ser una liquidación o un bono).

El sueldo (`base`, migración 98) es remuneraciones + honorarios; lo demás del mes (otros beneficios, gratificación,
incentivo) va en `extra`. El total del mes no sirve para comparar: el 2026-08 un analista del Banco de la Nación
figuraba con S/ 183,172 (S/ 5,500 de remuneración y S/ 177,672 de otros beneficios, así en el CSV del PTE).

La lista es la del último mes que publicó cada entidad (migración 100): quienes trabajan hoy. La historia (desde
2025-01) cuenta los meses de cada persona, desde cuándo está y lo que cruza meses (`tambien_ordenes`,
`antes_locador`).

**Montos dudosos de CONOSCE** (migración 98): `limpiar_montos_ordenes(anio, mes)`, después de cargar cada mes, pasa a
`monto_dudoso` (y deja `monto` en NULL) los que no se pueden creer: más de S/ 100 M, igual al RUC o al número de la
orden, más de 20 veces el tope de una orden "hasta N UIT", o más de S/ 1 M a un RUC 10 en "Otras contrataciones". La
ficha los muestra tachados y no los suma. Ejemplo: la O/S 106-2026 de la Municipalidad Distrital de Huarochirí a una
persona natural trae S/ 45,006,800 en el archivo oficial de CONOSCE (2026-06).

**Plazas CAS** (`servir_convocatoria`): `pide_experiencia_propia` (pide experiencia en la misma entidad),
`pide_poco` (S/ 6,000 o más sin pedir título ni grado), `plazo_corto` (3 días o menos), `ya_hay_locadores` (la entidad
ya pagaba ese servicio por órdenes a 1 a 3 personas). `sueldo_alto` está apagado (migración 95): los tipos de servicio
son demasiado amplios para comparar sueldos de plazas.

**Cómo se cruza**: por el DNI del RUC 10 cuando la otra fuente lo trae (JNE parcial, ONPE, JNE autoridades, visitas,
sanciones); si no, por el nombre completo y el departamento (el detalle dice `por: nombre`). La planilla no trae DNI:
todo lo suyo es por nombre dentro de la misma entidad. Los apellidos se comparan sólo si la pareja es poco común
(`frecuencia`: cuántas personas contratadas la llevan).

**El tipo de servicio** (`servicio_persona`) sale de las palabras de la descripción de la orden más grande de cada año
(CONOSCE no lo trae). «Por mes» es lo cobrado en el año dividido entre los meses con alguna orden.

## Lo que no se puede saber

El **título** (SUNEDU se consulta de a un DNI y con captcha), la **edad** (RENIEC no es público) ni los **términos de
referencia** de las órdenes pequeñas (no se publican). Por eso Vigía no puede decir si alguien cumple el perfil: compara
lo que cobra con lo que se paga por lo mismo y cruza registros.

## Privacidad

La regla de siempre (docs/PRIVACIDAD.md): nunca un DNI ni un RUC 10 (sale como `10·ref·…`), un apellido tapado (el
materno), las autoridades electas completas. La ficha se abre por un **código al azar** (`persona_codigo`), nunca por
RUC. No se busca por nombre. La planilla sale de la API ya con el apellido materno tapado. La ficha no se indexa.

## Operación

- Las órdenes: tras cada carga de `conosce_ordenes` se rehacen, desde 6 meses antes del primer mes cargado,
  `refrescar_fraccionamiento(desde)` y `refrescar_personas_ordenes(desde)`; después `refrescar_personas_senales(desde)`
  (sólo las personas con órdenes desde ese año, migración 94) y, en otro paso, `refrescar_personas_resumen()` (las cifras
  de cada alcance). Cada uno en su sentencia: Hyperdrive corta a los ~10 min.
- La historia (2018-2024): `POST /correr {"fuente":"conosce_ordenes","desde":"2018-01","hasta":"2024-12","relleno":true}`
  no rehace nada al final; después, desde la PC y fuera de Hyperdrive: `refrescar_fraccionamiento(NULL)`,
  `refrescar_personas_ordenes(NULL)`, `refrescar_personas_senales(NULL)`, `refrescar_personas_resumen()` y la cadena de
  los cruces. El 2026-10-21 se cargó así (y el disco de la base pasó a 50 GB).
- Rendimiento: `entidad_gobierno` es una vista con expresiones regulares; cruzada en vivo con millones de filas, el
  planificador la recalculaba por fila. Las funciones la materializan antes (`_eg`).
- La planilla: `POST /correr {"fuente":"pte_personal"}` (los dos meses anteriores; `desde`/`hasta` AAAA-MM para otros,
  sin volver a bajar lo que ya está; `forzar` sí). Busca el id de cada entidad en el PTE la primera vez
  (`pte_entidad`), recorre además el directorio del PTE (`pte_directorio`, migración 99: 2 344 entidades, muchas UGEL,
  redes de salud y hospitales que CONOSCE nombra distinto) y baja cada mes en CSV.
- Las plazas: `python backend/scripts/cargar_servir_convocatorias.py --entorno prod` (primero `--seco --paginas 3`).
