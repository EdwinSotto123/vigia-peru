# Empresas y su puntaje de antecedentes

Cada empresa (RUC 20) que **ganó, postuló o recibió órdenes** del Estado desde 2018 tiene su ficha: lo que le
adjudicaron y le compraron, a qué entidades, en qué procesos compitió, quién está detrás (RNP), las visitas de su gente
a entidades públicas y su **puntaje de antecedentes** (0 a 100). Las personas naturales que le venden al Estado (RUC 10)
no están acá: van en «Personas contratadas» ([PERSONAS.md](PERSONAS.md)) con sus reglas de privacidad.

En la web: `/app/empresas` (directorio con buscador por nombre o RUC y filtros) y `/empresa/<RUC>` (la ficha, con
pestañas Inicio, Contratos, Órdenes, Clientes, Postulaciones, Antecedentes, Socios y Visitas). El ganador de cada
contrato enlaza a su ficha, y el buscador de la cabecera también encuentra empresas.

## Filtros de la ficha

Cada lista tiene buscador y filtros con cuántos registros tiene cada opción, y se ordena por fecha o por monto:

| Pestaña | Filtros | Dónde se filtra |
|---|---|---|
| Contratos | banderas (inhabilitada al ganar, sancionada antes o después, con antecedentes, posible error de carga, sin banderas), año, entidad, tipo de proceso (en familias), rubro, región, sola o en consorcio | API |
| Órdenes | año, entidad, tipo, región, estado, posible error de carga | API |
| Postulaciones | resultado, año, entidad, quién le ganó, rubro | API |
| Clientes, Visitas, Empresas vinculadas | región, qué le dio, entidad visitada, quién fue, qué pasó después, puntaje, papel en común… | en la página (`TablaFiltrable`) |
| Antecedentes | tipo y gravedad | en el servidor de la web |

La lista de empresas filtra además por lo que recibió (desde S/ 100 mil hasta S/ 100 millones), cómo le vende al
Estado (contratos, consorcio, sólo órdenes, sólo postula), empresas vinculadas y por entidad: la ficha de cada entidad
enlaza a «Sus proveedores» (`/app/empresas?entidad=<RUC>`).

Las sanciones de cada contrato se miden contra la fecha de su buena pro: **inhabilitada al ganar** (una inhabilitación
temporal o definitiva cubría esa fecha), **sancionada antes** (ya cumplida, con la fecha en que terminó la última) o
**sancionada después**.

Órdenes (migraciones 110 y 111): la página por fecha lee una ventana por el índice `(ruc_contratista, fecha_emision)` y
el total sale de `empresa_orden_anual`; el estado, el tipo, el texto y el monto dudoso se filtran sobre la versión más
nueva de cada orden (un archivo mensual puede repetirla con otro estado). Mismo rango que el resumen: emitidas desde 2018.

## De dónde sale

| Qué | Fuente | Tabla |
|---|---|---|
| Contratos (ítems adjudicados), sola o en consorcio | OECE, CONOSCE: adjudicaciones y consorcios | `conosce_adjudicaciones`, `conosce_consorcios` |
| Órdenes de compra y de servicio | OECE, CONOSCE: órdenes | `conosce_ordenes` → `empresa_orden_anual` |
| Postulaciones | OECE, CONOSCE: postores | `conosce_postores` |
| Socios, representantes y directivos | Registro Nacional de Proveedores (conformación jurídica) | `rnp_conformacion_juridica` |
| Visitas | Registros de visitas de las entidades | `visitas_entidades` → `empresa_visita` |
| Antecedentes | Los cruces de proveedores (migraciones 48 en adelante) | `cruces_proveedor` |
| Inhabilitación vigente | Tribunal de Contrataciones del Estado | `osce_sancionados` |
| Razón social, estado y domicilio | SUNAT (cuando está), si no el nombre de CONOSCE | `empresas` |

Todo queda en `empresa_resumen` (una fila por empresa), migración 109.

## Cómo se cuenta

- **Contratos sola**: los procesos en que la empresa es la ganadora; el monto en soles. **En consorcio**: aparte, con el
  monto de todo el consorcio (no se sabe la parte de cada integrante): no se suma al de la empresa.
- **Posible error de carga**: un proceso cuya adjudicación más grande es 20 veces el valor referencial de todo el
  proceso y pasa S/ 1 M, o con un referencial de S/ 1 o menos y más de S/ 100 mil (la regla de los contratos, migración
  102); y las órdenes con monto dudoso (migración 98). Se muestran tal como vinieron, con su bandera, y **no se suman**:
  cada total dice cuánto quedó aparte.
- **Órdenes**: en soles, sin las anuladas, cada orden una vez (la del archivo mensual más nuevo).
- **Postulaciones**: los procesos en que fue postor (sola o en un consorcio) y en cuántos de ellos ganó.
- **Visitas**: las de un socio, representante o directivo (por su DNI en el RNP) o de alguien que dijo venir de la
  empresa (el nombre, si es de una sola empresa). `entidad_ruc`: si la entidad visitada le adjudicó o le compró algo;
  la ficha dice además qué le dio después de la visita y cuántos días después.
- **Empresas vinculadas**: otras empresas con un mismo socio, representante o directivo en el RNP.

## El puntaje de antecedentes

No es una acusación: dice cuánto pesa lo que otros registros públicos dicen de la empresa, para saber qué revisar
primero. Cada antecedente suma puntos según su gravedad (`empresa_puntaje_regla`), los antecedentes se juntan en grupos
y **cada grupo tiene un tope** (`empresa_puntaje_grupo`): diez penalidades no pesan lo que una inhabilitación. El total
llega como máximo a 100. La misma venta o aporte no cuenta dos veces (si ya está como «partido que gobierna», la
genérica no suma).

| Grupo | Tope | Antecedentes (grave / para revisar / leve) |
|---|---|---|
| Ganó estando inhabilitada | 40 | `sancion_vigente` 40 / 20 / 10 |
| Sanciones del Tribunal | 24 | `sancion` 12 / 6 / 2 |
| Penalidades | 12 | `penalidad` 4 / 3 / 1 |
| Vínculo con el partido que gobierna la entidad | 30 | `partido_gobernante` 15 / 8 / 3, `vendio_gobernante` 10 / 6 / 2 |
| Autoridades y candidatos | 20 | `autoridad` 15 / 8 / 3, `candidato` 6 / 4 / 1 |
| Aportes y ventas a campañas | 8 | `aporte` y `aporte_empresa` 4 / 3 / 1, `proveedor_campana` 3 / 2 / 1 |
| Postores relacionados | 25 | `socio_comun` y `otro_postor` 10 / 5 / 2 |
| Visitas antes de la buena pro | 16 | `visita_previa` 10 / 4 / 1 |
| Órdenes partidas | 15 | `fraccionamiento` 6 / 3 / 1 |
| Precios altos | 15 | `sobreprecio` 6 / 3 / 1 |
| Adicionales y prórrogas | 8 | `adicional` 4 / 2 / 1 |
| Proveedor frecuente | 4 | `recurrente` 2 / 1 / 0 |

Niveles: **50 o más**, muchos antecedentes; **20 a 49**, para revisar; **1 a 19**, pocos; **0**, sin antecedentes.
Cambiar un peso o un tope es un `UPDATE` en esas dos tablas y un `refrescar_empresas()`: la web lee las reglas de la API
(`GET /empresas/reglas`) y las muestra en «¿Cómo se calcula?».

## Privacidad

La razón social y el RUC de una empresa son públicos y se buscan. Sus socios, representantes, directivos, visitantes y
los funcionarios visitados son personas: la API los devuelve bajo `socios` y `visitas` (papeles que `publicar()`
reconoce) con un apellido tapado y **nunca con su documento**; no se buscan por nombre. Ver [PRIVACIDAD.md](PRIVACIDAD.md).

## Refresco

Dos funciones, cada una por debajo de los 10 minutos de Hyperdrive, que el Worker de scrapers corre después de los
casos cruzados (`refrescarCasosCruce` en `backend/scrapers-worker/src/fuentes/comun.ts`):

1. `refrescar_empresa_ordenes()`: las órdenes a RUC 20 desde 2018, agrupadas por empresa, entidad y año.
2. `refrescar_empresas()`: el resumen, el puntaje y las visitas.

A mano: `SELECT refrescar_empresa_ordenes(); SELECT refrescar_empresas();` como `vigia_jobs`.

## API

```
GET /empresas?q=&nivel=alto|medio|bajo|sin|con&tipo=<cruce>&departamento=&objeto=&inhabilitada=si&visitas=si&orden=&page=&size=
GET /empresas/reglas
GET /empresas/:ruc
GET /empresas/:ruc/contratos?q=&anio=&entidad=&como=sola|consorcio&page=&size=
GET /empresas/:ruc/ordenes?q=&anio=&entidad=&tipo=compra|servicio&dudosa=si&page=&size=
GET /empresas/:ruc/clientes
GET /empresas/:ruc/postulaciones?q=&resultado=gano|perdio&page=&size=
GET /empresas/:ruc/antecedentes
GET /empresas/:ruc/socios
GET /empresas/:ruc/visitas
```
