# Los documentos de un proceso en el SEACE: qué hay y qué trae cada uno

Catálogo de los tipos de documento que publica el SEACE por cada procedimiento, hecho leyendo documentos reales de la base
de producción y midiendo sobre todo el texto guardado. Es la base de los lectores de `backend/lector`: cada tipo tiene su
lector y su lista de datos. Medido el 2026-11-16; las cifras cambian con cada carga.

Por qué existe: el 2026-11-16 un monto de «experiencia adicional del postor» se publicó como la cuantía de un proceso. La
causa de fondo era que se leían documentos sin saber qué tipo eran ni en qué parte estaba cada dato.

## 1. El casillero no es el tipo

El SEACE ordena los archivos en casilleros (`documentos_gcs.titulo`). Son 127 658 archivos de 19 285 procesos. Pero:

- Un ZIP de «Documentos de otorgamiento de buena pro» trae dos documentos distintos: el **reporte** que genera el sistema y
  el **acta** que firma el comité.
- Un ZIP de «Documentos de calificación y evaluación» trae el reporte de evaluación técnica y el cuadro firmado.
- En «Informe que sustenta la declaratoria de desierto» hay informes y también actas.
- En «Nulidad» y «Resumen ejecutivo» aparecen informes de otra cosa (un adelanto, un informe de resultados).
- En «Pliego de absolución» muchas entidades suben además las bases integradas.
- En «Bases» vienen también presupuestos en Excel y fichas técnicas.

Por eso la unidad es la **pieza**: un PDF, suelto o dentro de un ZIP, con su tipo (`documento_pieza`, migración 325). El tipo
sale, en este orden, de la plantilla, del nombre del archivo dentro del ZIP, del título o el fondo del texto y, lo último,
del casillero (`backend/lector/tipos.py`). El nombre de un PDF suelto no se usa: repite el casillero.

En una muestra de 5 000 documentos (6 670 piezas) quedó sin tipo una pieza.

## 2. Los tipos

| Tipo | Qué es | Quién lo emite | Cómo se lee |
|---|---|---|---|
| `reporte_presentacion` | Presentación de ofertas o expresión de interés | El SEACE | Plantilla, sin modelo |
| `reporte_evaluacion` | Reporte de evaluación técnica | El SEACE | Plantilla, sin modelo |
| `reporte_otorgamiento` | Reporte de otorgamiento de buena pro | El SEACE | Plantilla, sin modelo |
| `reporte_desempate` | Reporte del desempate | El SEACE | Plantilla, sin modelo |
| `acta_no_formulacion` | Acta de no formulación de consultas y observaciones | El SEACE | Plantilla, sin modelo |
| `bases`, `bases_integradas` | Bases del procedimiento | La entidad, sobre el modelo estándar | Por secciones; cuantía y experiencia sin modelo |
| `pliego_absolucion` | Pliego de absolución de consultas y observaciones | El comité o los evaluadores | Modelo |
| `acta_buena_pro` | Acta de admisión, calificación, evaluación y otorgamiento | El comité, firmada | Modelo; visión si es escaneo |
| `cuadro_evaluacion` | Cuadro de evaluación técnica o económica | El comité, firmado | Modelo; visión si es escaneo |
| `contrato`, `orden`, `adenda` | Contrato, orden de compra o servicio, adenda | La entidad y el contratista | Modelo; visión si es escaneo |
| `garantia` | Carta fianza o póliza de caución | Un banco o una aseguradora | Modelo |
| `adicional`, `reduccion`, `ampliacion_plazo` | Resolución que aprueba o deniega | La entidad | Modelo |
| `resolucion_contrato`, `nulidad` | Resolución o carta | La entidad o el contratista | Modelo |
| `informe_desierto` | Informe que sustenta el desierto | El área de contrataciones | Modelo |
| `resumen_ejecutivo` | Indagación de mercado o informe de resultados | El área de contrataciones | Modelo |
| `presupuesto`, `ficha_tecnica`, `otro` | Anexos | Varios | No se leen todavía |

## 3. Los reportes que genera el SEACE

Salen del sistema, no de un escáner: en 22 mil páginas ninguna estaba escaneada y todas traen las mismas etiquetas en el
mismo orden. Se leen sin modelo (`backend/lector/plantillas.py`) y son la fuente más fiable después del registro.

Cosas que hay que saber de su texto (como lo entrega PyMuPDF):

- Los valores van **antes** de sus etiquetas («Adjudicado» y debajo «Resultado»).
- La hoja siguiente de un reporte largo repite la cabecera pero **no** el título, y un ítem puede quedar partido entre dos
  hojas. Se juntan los cuerpos de las hojas y después se lee.
- El pie trae el DNI del usuario del SEACE que generó el reporte. **No se lee ni se guarda.**
- Unas 180 páginas de evaluación y 260 de otorgamiento pasaron por OCR y perdieron el orden (las columnas quedaron
  separadas con «|»). No se adivinan: quedan para un lector con modelo.

### Presentación de ofertas

Por ítem: quién presentó (nombre y RUC, o el código que el SEACE da a un consorcio), fecha, forma y **hora con segundos**.

- El primer ítem de cada hoja trae su encabezado completo; los siguientes vienen compactos (descripción, número y «RUC /
  Código»).
- Un ítem sin ofertas trae «No presentaron propuesta al ítem» y tres guiones.
- Medido: 7 600 reportes, 8 280 ítems, 21 610 ofertas, ninguna línea sin calzar.

### Evaluación técnica

Por ítem y postor: estado del registro de la propuesta, **admitida o no admitida**, **puntaje técnico** y **calificada o
descalificada**. Trae el nombre del postor, no su RUC.

- Este dato no está en ningún registro que Vigía tenga: es la única fuente de la admisión y la calificación por postor.
- A veces el registro queda pegado al final del nombre («… S.A.C. Valido»).
- Un ítem al que nadie postuló trae una sola línea que lo dice.
- Medido: 5 838 reportes, 6 633 ítems, 17 392 filas: 10 869 calificadas, 3 594 admitidas pero descalificadas y 2 929 no
  admitidas. El número de evaluados coincide con el de ofertas presentadas en 6 096 de 6 097 ítems.

### Otorgamiento de buena pro

Por ítem: resultado, cuantía («Valor Referencial» en el reporte, también con la Ley 32069), unidad, cantidad solicitada,
cantidad desierta y, si se adjudicó, a quién y por cuánto. En un consorcio, la primera fila es el consorcio y las
siguientes sus integrantes con su RUC.

- Resultados vistos: adjudicado (6 997 ítems), «Monto mayor al valor…» (140) y desierto (132).
- Monedas: «S/», «S/.» y «$/.» (dólares, 93 ítems).
- Las cantidades grandes vienen en notación científica («1.561305E7»).
- Medido: 6 307 reportes; 1,2 % deja líneas sin calzar (ítems cortados por tres hojas). Esas lecturas quedan `parcial` y no
  dan hechos comprobados.

### Desempate

Por ítem: postor, orden de prelación, puntaje total con bonificación, puntaje técnico, si es mype y si es empresa integrada
por personas con discapacidad. El postor que quedó fuera del orden trae sólo el puntaje técnico.

### Acta de no formulación de consultas

Una página: nadie formuló consultas ni observaciones. Es un dato del proceso (sin consultas), no un vacío.

### Cuánto coinciden con el registro oficial

| Dato | Coincidencia con CONOSCE |
|---|---|
| Nomenclatura del reporte y la del proceso | 7 900 de 7 904 |
| Cuantía por ítem | 99,4 %; en la misma moneda, 99,96 % (el registro guarda en soles los procesos en dólares) |
| Ganador (mismo código, o por los integrantes del consorcio) | 99,1 % |
| Monto adjudicado, en soles | 99,1 % |
| Número de postores por ítem | 94 % (los consorcios llevan otro código en el registro) |

Las diferencias de ganador (63 ítems) y los 23 ítems que el reporte da como «monto mayor» y el registro como adjudicados
no son errores de lectura: son dos fuentes que dicen cosas distintas, y eso es materia de revisión.

## 4. Las bases

Son el documento más largo (114 a 123 páginas en promedio) y el más peligroso de leer, porque traen muchos montos que no
son la cuantía. Su armazón es la misma en todos los procedimientos (`backend/lector/secciones.py` la reconoce en 712 de 713
bases con texto):

| Parte | Qué trae | Qué se lee de ahí |
|---|---|---|
| Sección general | Texto fijo que la entidad no puede tocar. Trae topes legales («cuando la cuantía adjudicada sea igual o menor a S/ 480 000,00…», «S/ 5 000 000,00» en obras) | **Nada** |
| Específica, capítulo I | Entidad, objeto, **cuantía de la contratación**, expediente, fuente de financiamiento | Cuantía, o que está reservada |
| Específica, capítulo II | Cronograma, contenido de las ofertas, requisitos para perfeccionar el contrato | Adelantos, forma de pago |
| Específica, capítulo III | Requerimiento y, dentro, los **requisitos de calificación** (capacidad legal, experiencia del postor en la especialidad, capacidad técnica y profesional) | Experiencia exigida, personal clave, plazo |
| Específica, capítulo IV | **Factores de evaluación** (precio, experiencia adicional, mejoras, integridad) | Puntajes; experiencia adicional |
| Proforma del contrato | Cláusulas del contrato que se firmará | Penalidades, garantías |
| Anexos | Formatos de declaración jurada | Nada |

### La cuantía

Con la Ley 32069 las bases dicen «cuantía de la contratación» (250 de 250 bases recientes por objeto); «valor referencial»
quedó en 2 de 250 bases de bienes, 18 de servicios y 64 de obras.

- **La entidad puede reservarla.** «La entidad contratante ha determinado no dar a conocer la cuantía de la contratación»
  (numeral 53.4 del Reglamento). En bienes y servicios la reservan cerca de dos de cada tres bases con texto; en obras,
  casi ninguna. En esas bases el monto no existe y cualquier «cuantía» que se lea de ahí es otra cosa.
- Cuando es pública: «La cuantía de la contratación asciende a la suma de S/ …». Coincide con el registro en 69 de 69
  bases de servicios y en 96 % de las de obras.
- En obras a veces el apartado es sólo la tabla de costos (costo directo, gastos generales, utilidad, IGV): la cuantía es
  el total, nunca un renglón.
- En obras puede traer límite inferior y superior, y otra tabla sin IGV para proveedores con el beneficio de la Amazonía.
- Algunas bases de bienes no traen el apartado.

### La experiencia

Hay dos, y no son lo mismo:

| Dato | Dónde está | Cómo se redacta |
|---|---|---|
| **Experiencia exigida** (requisito de calificación) | Capítulo III, «Experiencia del postor en la especialidad» | «El postor debe acreditar un monto facturado acumulado equivalente a S/ …, durante los diez años anteriores…»; en obras, «…equivalente a una vez la cuantía de la contratación» |
| **Experiencia adicional** (factor de evaluación) | Capítulo IV | El mismo giro, con un monto mayor, a cambio de puntaje |

- Suele haber una segunda cifra rebajada para micro y pequeñas empresas.
- Puede pedirse por ítem.
- El monto puede ir sólo en letras y después entre paréntesis, sin la «a» o sin el símbolo de la moneda.
- La plantilla sin llenar («[CONSIGNAR EL MONTO DE FACTURACIÓN…]») no es un dato.
- En 25 % de las bases de servicios hay un monto de experiencia adicional y la cuantía está reservada. Ese es el terreno
  exacto del error del 2026-11-16.
- En muchas bases el capítulo III remite a otro archivo (los términos de referencia o el expediente): ahí la experiencia
  no está en esta pieza.

Una de cada cinco bases está escaneada (menos de la mitad de sus páginas tiene texto).

## 5. Los documentos firmados

### Acta de buena pro y cuadro de evaluación

El acta («Acta de admisión, calificación, evaluación de ofertas y otorgamiento de la buena pro») cuenta el procedimiento:

1. Quiénes forman el comité (presidente y miembros, titulares o suplentes) y con qué documento se les designó.
2. Los participantes registrados y las ofertas presentadas.
3. La admisión: una tabla con cada documento obligatorio y, por postor, «sí cumple», «no cumple» o «no corresponde», y el
   resultado («admitida» o «no admitida») con sus motivos.
4. La calificación y la evaluación, con puntajes y orden de prelación.
5. El otorgamiento.

Lo propio del acta, que no está en los reportes: **los motivos** de cada no admisión o descalificación, los montos
ofertados y el comité. El 63 % de las actas y el 61 % de los cuadros están escaneados.

### Contrato

Por cláusulas: objeto, monto, forma de pago, plazo, garantías, adelantos, penalidades, solución de controversias, domicilios
y firmantes. A veces en ese casillero hay una orden de compra o el contrato de otro proceso. La mayoría está escaneada
(firmado a mano): en la muestra, cuatro de cada cinco contratos no tienen texto guardado.

### Garantía

Una o dos páginas: emisor (banco o aseguradora), número, monto, qué garantiza (fiel cumplimiento, adelanto), a favor de
quién, por cuenta de quién (los integrantes si es un consorcio) y vigencia con fecha de inicio y de vencimiento.

### Adicional, reducción y ampliación

Una resolución: visto, considerando y «se resuelve». Lo que importa está en el primer artículo de lo resuelto: qué se
aprueba o deniega (el verbo decide el dato), el número de la prestación, el monto, la incidencia sobre el contrato original
en porcentaje, los días y el contratista. En el casillero de adicionales hay también reducciones de prestaciones.

### Resolución del contrato y nulidad

Resolución o carta notarial: quién resuelve (la entidad o el contratista), la causal y las fechas de los requerimientos
previos. En estos casilleros hay documentos de otros asuntos.

### Informe de desierto

Informe del área de contrataciones: cuántos participantes se registraron, cuántos presentaron oferta y por qué quedó
desierto (nadie ofertó, ninguna oferta válida).

## 6. Cuánto está escaneado

El texto guardado (`documentos_texto`) existe sólo para 52 700 archivos: lo escriben los agentes al analizar un proceso. De
los que tienen texto:

| Documento | Escaneado |
|---|---|
| Reportes que genera el SEACE | 0 % |
| Acta de buena pro | 63 % |
| Cuadro de evaluación | 61 % |
| Bases | Cerca de 20 % |
| Contrato | Cerca de 80 % sin texto |

## 7. Lo que falta leer

- Las contrataciones directas: sólo un proceso tiene sus documentos guardados.
- Las compras menores (requerimiento y orden): tienen sus propios lectores; falta pasarlos a este esquema.
- Los escaneados, viéndolos como imagen: confirmar que su forma es la de los que tienen texto.
- Los términos de referencia y el expediente técnico cuando vienen en un archivo aparte.
