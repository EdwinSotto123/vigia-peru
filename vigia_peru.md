# Vigía Perú

*Qué es, cómo funciona y de dónde saca lo que dice.*

---

## El problema

El Estado peruano **ya publica** todos sus contratos. Están ahí, en el SEACE, en
formato abierto, gratis, al alcance de cualquiera.

El problema nunca fue el acceso. Es que **nadie los lee**.

Son más de 18 000 expedientes solo en el período que Vigía tiene descargado, de
25 regiones, cada uno con sus bases, sus términos de referencia, sus actas, sus
cuadros comparativos y su contrato. Leer uno con atención —cruzar el precio
ofertado contra el mercado, revisar si el proveedor tiene sanción vigente,
mirar quién firmó el acta y si tiene relación con quién ganó— toma horas de una
persona que sepa hacerlo. Nadie tiene ese tiempo multiplicado por dieciocho mil.

Así que los contratos públicos son, en la práctica, secretos por volumen.

## La idea

Vigía descarga esos expedientes y hace que **un equipo de agentes de IA los lea
de verdad**: no que los resuma, sino que los audite contra la norma vigente,
contra precios reales de mercado y contra los registros públicos del Estado.

Cuando encuentra algo, publica una **señal de riesgo**: qué regla se disparó,
qué artículo de la ley la sostiene, qué dice la opinión del OECE al respecto, y
el enlace al documento oficial con el número de página exacto.

Nunca una acusación. Una señal es un indicio para volver a la fuente.

## Cómo funciona, en tres pasos

**1. Se descarga todo.** Un lote nocturno trae los expedientes nuevos del SEACE
y los documentos asociados, y los guarda versionados.

**2. Alguien financia una lectura.** Leer un contrato cuesta S/ 3 de cómputo e
IA. Cualquiera puede pagarlo: una persona, un colectivo, una empresa.

**3. Los agentes leen y publican.** El resultado es público siempre — incluso
si señala a quien pagó.

> **El que paga no elige qué se audita.** Los contratos salen de la cola por
> antigüedad, en una consulta SQL. El pipeline nunca recibe el nombre de quien
> financió: no puede favorecerlo ni perjudicarlo porque literalmente no lo sabe.

---

## Los agentes

Son **diez**, cada uno especialista en una cosa. No conversan entre ellos: cada
uno recibe lo que necesita, hace su trabajo y deja su resultado escrito para el
siguiente.

Corren en **tres carriles paralelos**, porque leer el expediente, investigar al
proveedor y consultar la norma son tareas independientes.

### Carril 1 — El expediente

| Agente | Qué hace |
|---|---|
| **Reglas de contratación** | Aplica las reglas duras del motor: único postor, proveedor sancionado, proceso no competitivo. Es el primero y el más rápido: no emite juicio, solo verifica hechos. |
| **Lectura del expediente** | Abre todos los documentos del proceso —bases, términos de referencia, actas, cuadros comparativos, contrato, adendas, incluso los ZIP— y extrae su contenido estructurado, guardando de qué página salió cada dato. |
| **Análisis legal** | Lee lo que extrajo el anterior y busca defectos normativos: plazos fuera de ley, requisitos que direccionan hacia un proveedor, sustentos de contratación directa que no sustentan nada. Cada bandera que emite tiene que venir con su evidencia. |
| **Precios de mercado** | Toma los ítems con su especificación técnica (marca, modelo, certificaciones) y busca precios reales en el mercado peruano, en vivo. Compara lo ofertado contra la mediana encontrada. |

### Carril 2 — El proveedor

| Agente | Qué hace |
|---|---|
| **Investigación de la empresa** | Busca en prensa y registros públicos todo sobre el proveedor adjudicado: su situación en SUNAT, sus otros contratos, su historial. |
| **Prensa** | Arma una línea de tiempo de menciones periodísticas sobre el proveedor, su gerente, la entidad contratante y el objeto del contrato. |
| **Funcionarios de la entidad** | Descubre quién manda de verdad en la entidad: gerentes designados, asesor legal, procurador, jefe de control interno. No aparecen en los registros electorales porque no son elegidos, son designados. |

### Carril 3 — La síntesis

| Agente | Qué hace |
|---|---|
| **Red de personas** | El más delicado. Investiga a las personas detrás del proveedor —gerente, socios, representantes— y las cruza contra los firmantes del acta, las autoridades de la zona, los aportes políticos y las declaraciones juradas de intereses. Tiene el umbral de evidencia más alto de todos: un parentesco sin documento no se publica. |
| **Cumplimiento extendido** | Corre un segundo bloque de reglas que solo tienen sentido cuando ya está todo lo demás: doce verificaciones deterministas más dos que requieren juicio. |
| **Dictamen** | Junta todo y escribe el informe final: qué se encontró, con qué artículo de ley, con qué opinión del OECE, y declarando explícitamente lo que **no** prueba. |

Al final, cuatro **jueces automáticos** revisan el trabajo antes de publicarlo
—ver más abajo.

---

## El orquestador: una historia que vale contar

La primera versión tenía un **agente orquestador**: un LLM que decidía a qué
especialista llamar, en qué orden, y cuándo dar el análisis por terminado.

No funcionó. **Se rendía antes de terminar.** Declaraba el trabajo completo
cuando faltaban agentes por correr, y el resultado era un dictamen al que le
faltaba, por ejemplo, toda la red de personas — sin que nada avisara.

Hoy la orquestación **corre en código, no en un modelo**. La secuencia es fija y
garantiza que todos los agentes corran siempre. El orquestador-LLM sigue en el
repositorio, pero apagado.

Es una decisión que va a contramano de la moda, y es deliberada: en una
herramienta cuya credibilidad depende de la completitud, un paso que "a veces se
saltea" no es un detalle de implementación, es un defecto fatal.

---

## De dónde sale lo que decimos

Nada de lo que Vigía afirma sale del modelo. Todo sale de una fuente oficial que
se puede abrir.

### Los contratos

**SEACE / OECE**, vía su API de datos abiertos (estándar OCDS). Es el origen de
todo: las convocatorias, los montos, las entidades, las fechas, los postores.

### Los registros del Estado

Ocho canales de ingesta automática que se actualizan solos:

| Fuente | Qué aporta |
|---|---|
| **Proveedores sancionados (OECE)** | Quién está inhabilitado para contratar con el Estado, y hasta cuándo. |
| **Registro de visitas** | Quién entró a qué entidad pública y a ver a quién. |
| **Declaraciones juradas de intereses** | Qué empresas y parentescos declaró un funcionario. Es la llave para detectar la puerta giratoria. |
| **Datasets OECE** | Ofertantes, consorcios, obras. |
| **Presupuesto (MEF)** | Cuánto tiene asignado cada pliego y cuánto ejecutó. |
| **Aportes de campaña (ONPE / Claridad)** | Quién financió a qué candidato. |
| **Autoridades (JNE / Infogob)** | Quién fue electo y quién se candidateó, con su historial. |
| **Personal de entidades** | Los designados, que no aparecen en ningún registro electoral. |

### La norma

Cuatro bibliotecas legales que los agentes consultan como quien consulta un
código anotado:

- **Normas vigentes** — Ley 32069 y su reglamento, bases estándar.
- **Normas históricas** — la ley anterior (30225) y su reglamento, porque un
  contrato de 2023 se juzga con la ley de 2023, no con la de hoy.
- **Criterios vinculantes** — acuerdos de Sala Plena y opiniones de la
  Dirección Técnico Normativa del OECE.
- **Control** — directivas de la Contraloría.

Los artículos están segmentados uno por uno, así que cuando el dictamen cita
"Art. 5 Ley 32069 — principio de competencia", ese artículo existe y se puede
abrir.

### El mercado

Búsqueda en vivo de precios reales peruanos para los ítems del contrato. Cuando
no se encuentran suficientes precios, el sistema **lo dice** y marca el veredicto
como estimación — nunca lo disfraza de medición.

---

## Cómo nos controlamos a nosotros mismos

Antes de publicar, cada análisis pasa por **cuatro jueces automáticos**:

| Juez | Qué pregunta |
|---|---|
| **Respaldo de la bandera** | ¿La evidencia es concreta y verificable, o es una afirmación suelta? |
| **Cita de evidencia** | ¿Trae la norma y el enlace a la fuente? *(esta la verifica el código, no un modelo)* |
| **Plausibilidad del precio** | ¿El veredicto de mercado se sostiene? |
| **Tono no acusatorio** | ¿Esto es una señal de riesgo o se convirtió en una acusación? |

**Si no pasan el umbral, el análisis no se publica.** Queda en "revisión
humana", y eso también se muestra públicamente: hoy hay doce análisis
terminados esperando que una persona los mire. Que existan a la vista es parte
del argumento — un sistema que solo muestra sus aciertos no es auditable.

---

## Lo que Vigía **no** hace

- **No acusa a nadie.** Publica señales con norma citada y documento adjunto.
  La conclusión la saca quien lee.
- **No deja elegir qué se audita.** Ni siquiera a quien paga. Ni a nosotros.
- **No cuenta en soles.** El reconocimiento a quien financia se mide en
  contratos leídos: trescientos vecinos que financian 300 contratos pesan
  exactamente lo mismo que una empresa que financia 300.
- **No esconde a quien financia.** Y si el análisis que alguien pagó lo señala a
  él, se publica igual.
- **No inventa datos.** Cuando una fuente no responde, la interfaz lo dice en
  vez de rellenar el hueco con algo plausible.
- **No expone datos personales.** El DNI y el apellido de personas naturales van
  tapados y se revelan solo a propósito. Las empresas y los funcionarios
  públicos no se censuran: son el sujeto del escrutinio.

---

## En una línea

**Los contratos públicos del Perú ya son públicos. Vigía hace que además sean
leídos.**
