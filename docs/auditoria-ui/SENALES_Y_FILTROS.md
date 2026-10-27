# Señales, antecedentes y filtros: qué capturamos y dónde se puede buscar

Pedido del 2026-10-26: «organiza qué antecedentes y señales capturamos, para ver qué añadir en cada uno» (filtros de
planilla, empresas, entidades, menores…). Este documento es el inventario: qué sabe Vigía de cada cosa, de qué registro
sale y en qué lista se puede filtrar. Gravedad: **A** alta, **M** media, **B** baja.

## 1. Antecedentes del ganador de un contrato (cruces)

Catálogo: `frontend/lib/cruces.ts` (`TIPO_CRUCE`). Filas: `cruces_proveedor` (gravedad por fila); por contrato,
`casos_cruce` (tipos, n_alta, n_media); por empresa, `empresa_resumen` (tipos, cruces). Cada uno abre su evidencia en
la ficha del contrato (`backend/api/src/lib/evidencia.ts`).

| Grupo | Tipo (gravedad) | De dónde sale | Qué cita la ficha |
|---|---|---|---|
| Política | partido_gobernante (A): financió al partido que gobierna la entidad | ONPE, JNE | aportes o ventas a la campaña + quién gobernaba |
| | vendio_gobernante (M/B): vendió a la campaña del que gobierna | ONPE gastos de campaña | ventas a la campaña + quién gobernaba |
| | aporte, aporte_empresa (M/B), proveedor_campana (M/B), candidato (M), autoridad (A) | ONPE, JNE | registros con enlace a la fuente |
| En el proceso | socio_comun (A): la misma persona en otra empresa del proceso | RNP | las otras empresas, con su ficha y si ofertaron |
| | domicilio_compartido (A/M/B): mismo domicilio fiscal que otro participante | SUNAT + OCDS + CONOSCE | la dirección, las empresas de ahí, si la otra ofertó, cuántos procesos juntas |
| | unico_postor (A/M), otro_postor, visita_previa (A), socio_en_entidad (A), sancion_vigente (A) | OCDS, CONOSCE, visitas, RNP | lo de cada registro; el socio, con sus órdenes |
| | sobreprecio_extremo / _alto / sobreprecio (A/M/B) | ítems OCDS y CONOSCE | los ítems y las compras comparadas |
| Historial | sancion_definitiva / _temporal / _multa (A/M/B), penalidad (M) | Tribunal (OSCE), OECE | tabla de sanciones o penalidades |
| | adicional_sobre_tope / _alto / adicional (A/M/B) | CONOSCE contratos | el adicional |
| Patrón | fraccionamiento (A/M), recurrente_dominante / _frecuente / recurrente (A/M/B), proveedor_cautivo (M/B) | CONOSCE | los días y sus órdenes; los otros procesos; a quién le vende |
| SUNAT | recien_fundada_medio_ano / _un_ano / _dos_anos | SUNAT | alta, estado, actividad, quién está detrás |
| | dada_de_baja (M), suspendida (B), no_habida (M): estado de HOY | SUNAT | dicho como estado actual (la SUNAT no publica desde cuándo) |

## 2. Empresas (`empresa_resumen`, migraciones 109-120)

Hechos sin puntaje: estado y condición SUNAT, fecha de alta, actividad (CIIU), domicilio, departamento donde más vende,
objeto, adjudicaciones/contratos/órdenes (número y monto), datos dudosos, postulaciones y ganadas, entidades clientes,
primera y última venta, socios/representantes/directivos/vinculadas, visitas, inhabilitación vigente, todos sus
antecedentes (sección 1). En `empresas`: capital social, RNP vigente.

## 3. Personas contratadas por órdenes (RUC 10)

`persona_senal` → `persona_entidad.tipos/sev`. Catálogo `frontend/lib/personas.ts`.
- **A**: nepotismo (pariente declarado en la DJI de un funcionario de la entidad), candidato_gobierna, inhabilitado,
  tambien_planilla.
- **A/M/B**: autoridad_contratada.
- **M**: aporte_gobierna, apellidos_funcionario, funcionario_contratado, meses_seguidos, pago_alto.
- **M/B**: apellidos_autoridad. **B**: candidato, aporte, visita_previa, paso_a_planilla.

## 4. Planilla (Portal de Transparencia)

`planilla_persona.tipos/sev`. Catálogo `frontend/lib/planilla.ts`.
- **A**: tambien_ordenes, candidato_gobierna. **M**: brecha_cargo, apellidos_directivo. **M/B**: apellidos_autoridad.
- **B**: antes_locador, pago_extraordinario, es_autoridad.
- El nepotismo visto desde el funcionario (`dji_nepotismo`) sale en su ficha, nunca con la identidad del pariente.

## 5. Plazas CAS (SERVIR)

`servir_convocatoria`. **M**: pide_experiencia_propia, pide_poco, plazo_corto. **B**: ya_hay_locadores.

## 6. Compras menores (≤ 8 UIT) y órdenes

- Menores: `seace_menores` + `seace_proveedor_sunat`. Del proveedor: baja, suspensión, no habido, no hallado, menos de
  180 días de creado.
- Órdenes (CONOSCE): monto dudoso y su motivo, tipo de contratación, objeto, nepotismo del proveedor, fraccionamiento
  (`ordenes_fraccionadas`).

## 7. Entidades

Nepotismo (`dji_nepotismo`), captura y partido que gobierna (`poder_entidad`), informes de Contraloría (penal, civil,
administrativa) y casos de la Procuraduría, presupuesto del MEF, contratos con antecedentes del ganador
(`casos_cruce`), personas/planilla/plazas con señales.

## 8. Dato dudoso (`frontend/lib/datoDudoso.ts`)

Órdenes: igual_ruc, igual_numero, mayor_100m, tope_uit, persona_sin_proceso. Planilla: negativo, total_no_cuadra,
mes_1m, sueldo_100k. Contratos: referencial_simbolico, adjudicado_20x.

## 9. Captura de familiares (DJI de los decisores)

`dji_descargas` (ledger), `dji_vinculos` (parientes declarados, con su documento: NUNCA se publica), `dji_nepotismo`
(la señal). Se baja en rondas de GitLab CI (`backend/scripts/orquestar_dji.py`): universo de 32,172 declarantes con
nombre, en lotes de 10 nodos con tope de 150 min para que los artefactos suban.

## 10. Filtros por lista (2026-10-26)

Cada filtro vive en la URL, se ve como chip con su × y respeta a los demás; los de lista larga se escriben y se eligen.
Entre paréntesis, el parámetro.

| Lista | Antes | Agregado |
|---|---|---|
| Contratos | texto, región, mes, lectura, antecedentes, riesgo, tipo, etapa, entidad, partido, monto, operativo | **Quién ganó** (`ganadora`): de baja, suspendida o no habida hoy en la SUNAT; socio candidato, autoridad electa, su gente o la empresa aportó, vendió a una campaña (la fila lo dice en «Antecedentes»). **Calidad del dato** (`dudoso`) |
| Órdenes | texto, año, región, tipo | **Antecedentes** (`oant`): pariente de un funcionario, órdenes del mismo día que pasan 8 UIT. Entidad y proveedor ahora con su chip (antes quedaban activos e invisibles), persona o empresa (`oper`), estado (`oest`), cómo se contrató (`ocomo`), monto (`omonto`), posible error (`odud`). La fila marca nepotismo, fraccionamiento (con las órdenes del día) e inhabilitación al emitirse |
| Menores | texto, año, región (daba error 500), objeto, con requerimiento (dejaba pasar ~1,000 sin PDF) | **Antecedentes del proveedor** (`mant`, en el servidor y con conteo): de baja, suspendido, no habido, no hallado, menos de 6 meses, inhabilitado al firmar; consultoría y obra en objeto; persona o empresa (`mper`); monto con «cerca del tope de 8 UIT» (`mmonto`); entidad y proveedor con chip |
| Empresas | texto, antecedentes (con, grave, sin), tipo, objeto, departamento, inhabilitada, visitas, monto, actividad, vinculadas, entidad | Antecedente **medio**; visitas **a quienes le compraron**; antigüedad desde su alta SUNAT (`antiguedad`), a cuántas entidades vende (`clientes`), tasa de éxito (`exito`), año de su última venta (`ultima`), datos dudosos (`dudoso`). «Filtros» por secciones con conteos |
| Entidades | texto, clase (4), región, nepotismo; sin orden | Clase con 8 opciones (como la fila), **provincia** y **partido que gobierna** (buscables), captura (`captura`), **informes de Contraloría** por responsabilidad penal, civil o administrativa (`control`), planilla y plazas con señales, **orden** (dictamen, contratos, nombre) |
| Personas (órdenes) | texto, gravedad, señal, servicio, año | **Partido que gobernaba la entidad** (`gobierno`), monto (`monto`) y meses con órdenes (`meses`) por tramos |
| Planilla | texto, gravedad, señal, régimen, dato dudoso | Sueldo por tramos (`lsueldo`), oficina y cargo dentro de una entidad (`lofi`, `lcargo`, buscables), **declaró a un pariente locador** (`lpar`; el pariente nunca se muestra) |
| Plazas CAS | texto, con o sin señal, señal | Gravedad media y baja; **abiertas hoy** (`zabierta`), sueldo, experiencia pedida y vacantes por tramos. Se quitó `sueldo_alto`: no se calculaba desde la migración 95 |

Lo que se dejó afuera y por qué: un filtro que casi no distingue a nadie (en entidades, «ganador con antecedentes» es
el 93 %), datos que no existen (capital social, RNP vigente casi vacío: «Sin dato» no es 0), o conteos que costarían
recorrer millones de filas por pedido (tramos de personas y planilla en todo el país van sin número).

Índices para estos filtros: migraciones 143 (órdenes grandes por fecha, ganador por RUC) y 144 (tramos de personas).
