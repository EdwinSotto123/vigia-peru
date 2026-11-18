# Extracción de documentos: quién lee mejor cada cosa

Mediciones del 2026-11-16 sobre documentos reales de producción. Sin nombres ni RUC: sólo cuentas.

La pregunta que responde: ¿conviene leer con reglas de texto o con un modelo? La respuesta medida es que **depende del
documento**, y que **ninguna de las dos lecturas sola es fiable**: juntas detectan los errores de la otra.

## 1. Línea base: lo que hay hoy

`linea_base.py --ultimas`: los 105 casos de las pruebas de oro, contra su verdad escrita a mano (`datos_clave`).

| Dato | Fuente | Cobertura | Exactitud |
|---|---|---|---|
| Número de postores | Extractor genérico de los agentes | 96 % | **34 %** |
| Número de postores | Lector del acta (modelo) | 97 % | 94 % |
| Cuantía | Extractor genérico (`cuantia_total`) | 44 % | 98 % |
| Cuantía | Lector de bases (modelo) | 23 % | 96 % |
| Cuantía | Lector del acta (modelo) | 87 % | 100 % |
| Monto adjudicado | Extractor genérico (`contrato_final`) | 56 % | 92 % |
| Monto adjudicado | Lector del contrato (modelo) | 74 % | 90 % |

El lector de bases da la cuantía en pocos casos porque, con la Ley 32069, dos de cada tres bases de bienes y servicios
la reservan (numeral 53.4 del Reglamento): el monto no está en el documento.

## 2. Reportes que genera el SEACE: gana la regla

`comparar.py`: la misma pieza leída por la plantilla (`lector/plantillas.py`) y por GLM 5.3 flash (`lector/por_pieza.py`).
La mitad de la muestra son los reportes más largos, de varios ítems.

| Reporte | Reportes | Ítems | Ítems iguales | Costo del modelo por reporte |
|---|---|---|---|---|
| Presentación de ofertas | 150 | 283 | 100 % | US$ 0,0005 |
| Evaluación técnica | 153 | 484 | 99,2 % | US$ 0,0006 |
| Otorgamiento de buena pro | 148 | 601 | 85,9 % | US$ 0,0007 |

Quién se equivocó cuando difieren:

- **Evaluación (4 ítems):** 2 errores de la regla (dejó «Valido» pegado al nombre del postor cuando el PDF no trae el
  espacio; ya corregido y con su prueba) y 2 del modelo (marcó descalificado a un postor calificado; se saltó un ítem
  entero).
- **Otorgamiento (85 ítems en 11 reportes largos):** arbitrado con CONOSCE ítem por ítem, acertó la regla en todos los que
  se pudo arbitrar (monto 65 de 65, ganador 24 de 24, cuantía 12 de 12). El modelo corre los montos y los ganadores de un
  ítem a otro en tablas largas.

## 3. Bases, que son texto libre: gana el modelo

129 bases con las dos lecturas: el modelo sobre las secciones que tocan (generalidades, requisitos de calificación,
factores de evaluación) y las expresiones de `lector/secciones.py`. US$ 0,0015 por bases.

| Dato | Modelo | Regla |
|---|---|---|
| Cuantía pública, contra el registro | 86 de 86 iguales | 78 de 80 iguales |
| Cuantía reservada | 37, las mismas que la regla | 37 |
| Cuantía que sólo halló uno | 6 | 0 |
| Experiencia exigida en monto que sólo halló uno | 3 | 0 |
| Experiencia adicional en monto que sólo halló uno | 6 | 1 |
| Citas que están en el texto y traen el valor | 307 de 308 | no aplica |

En ningún caso el modelo dio como cuantía un monto de experiencia distinto del registro.

## 4. Lo que se decide con esto

1. Cada dato se lee dos veces por caminos independientes. Si coinciden, queda comprobado. Si no, queda en disputa: no
   se usa, sube al modelo grande y, si sigue sin acuerdo, a revisión de una persona.
2. Quién manda en cada tipo de documento lo dice la medición, no el gusto: en los reportes que genera el SEACE manda la
   plantilla y el modelo comprueba; en las bases manda el modelo y la regla, la cita y el registro comprueban.
3. El extractor genérico de los agentes no debe ser la fuente del número de postores.

## 5. Lo que falta medir

- Los documentos firmados (acta, cuadro de evaluación, contrato, garantía, adicionales): no tienen regla; ahí la segunda
  lectura será otro modelo o el registro.
- Los escaneados, con transcripción por visión.
- Una verdad escrita a mano por tipo de documento (el conjunto de oro de extracción), para medir también los casos en que
  las dos lecturas coinciden y las dos se equivocan.

## 6. Primer oro de extracción escrito a mano (2026-11-18)

La verdad de cada pieza la escribió quien la leyó entera, a ciegas de la lectura del modelo (`muestra_oro.py` imprime sólo
el texto; la lectura del modelo queda aparte, fuera del repositorio). Verdades en `oro/<lector>.json`; se califican con
`calificar_oro.py` (acierto, error, omisión, invento por dato). Muestra estable, mitad de piezas transcritas por visión.

| Lector (GLM 5.3 flash, m1) | Piezas | Datos | Exactitud | Lo que falló |
|---|---|---|---|---|
| Garantía | 12 | 118 | 93 % | una autorización de retención de una MYPE (Ley 32077) que no reconoció como garantía; un vencimiento calculado sumando 120 días cuando el escaneo era ilegible (un día corrido) |
| Modificación | 8 | 32 | 94 % | un adicional con deductivo vinculado: dio el NETO como monto y la incidencia ACUMULADA como la del adicional |

Además:

- **El clasificador de piezas se equivoca en las modificaciones:** en 5 de 8 el casillero del SEACE no era el documento
  (el contrato mismo, un memorando de presupuesto, adicionales archivados como «reducción» o «ampliación»). El lector lo
  corrigió en todos: dijo `es_del_tipo` = false en los dos que no eran modificaciones y la clase correcta en los otros.
  Para modificaciones, manda la clase del lector, no la del casillero.
- **Lo que se le enseñó (versión m2 de los dos lectores, `version` propia en `fichas_cortas.py`):** la retención como
  garantía (tipo «retencion»), la fecha de emisión de una prórroga, copiar el vencimiento y no calcularlo, y en un adicional
  con deductivo: monto = adicional, `monto_deductivo_vinculado` y `monto_neto` aparte, incidencia acumulada sólo en su campo.
  La tarea nocturna `tarea:piezas` relee con m2; después, `muestra_oro.py` toma la lectura más reciente de cada pieza y la
  misma muestra mide m2 contra la misma verdad.
- **Del comparador también se aprendió:** tres «errores» eran del comparador (formatos `prestaciones_accesorias`,
  `{sentido: aprueba}`) y uno de la verdad (la fecha de emisión de una prórroga es la de la fianza). Antes de culpar al
  lector, mirar cada diferencia.
