# Gobserva Salud

Verificar establecimientos de salud, médicos y medicamentos del Perú con fuentes oficiales: `salud.gobserva.cloud`.
Abierto y gratuito: todo se ve sin cuenta. Desde el 2026-11-20; medicamentos, panel lateral y cuenta gratis desde el
2026-11-21.

## Qué responde

| Pregunta del ciudadano | Con qué se responde | Qué NO se afirma |
|---|---|---|
| ¿Esta clínica está registrada y activa? | RENIPRESS (SUSALUD): estado, categoría, historial de estados | Nada que RENIPRESS no diga; lo que dice es declaración jurada de la IPRESS |
| ¿Puede hacer cirugías (estéticas)? | Detalle de RENIPRESS: unidad de centro quirúrgico (UPSS), especialidades (cirugía plástica), cartera de servicios; producción quirúrgica declarada; normas (RAG) | RENIPRESS no autoriza procedimientos uno por uno: se dice qué está registrado y qué no |
| ¿Tiene sanciones? | Registro de Sanciones de SUSALUD: sanciones **firmes** con resolución, infracción, multa en UIT y estado judicial | Nunca «no tiene sanciones»: «no figura en el registro revisado el …» (SUSALUD retira las antiguas tras ≥ 1 año) |
| ¿Tiene denuncias? | Reporte anonimizado de consultas y denuncias ante SUSALUD, por año | Una denuncia no es una sanción ni un hecho comprobado |
| ¿Este medicamento tiene una alerta? ¿Cuánto cuesta? | Alertas DIGEMID (con el texto de su PDF: lote y registro sanitario) e Indicador de precios del Observatorio de DIGEMID (mediana por unidad en farmacias y boticas privadas, por mes) | Una alerta de un lote no dice que todo el producto esté observado; el precio no es el de hoy ni el de una farmacia |
| ¿Este médico está habilitado? | Pasos para verificarlo en «Conoce a tu médico» del CMP y en SUNEDU; en qué IPRESS figura su colegiatura como responsable (RENIPRESS) | La habilitación sólo la dice el CMP; la sanción de una clínica no es del médico |

Cuatro clases de hecho, siempre con su rótulo y nunca mezcladas: **sanción firme**, **denuncia**, **reclamo** y
**registro administrativo** (`CLASES_DE_HECHO` en `frontend/lib/gobserva-salud.ts`; `verificar()` en
`backend/api/src/lib/gobservaSalud.ts` redacta cada chequeo con su fuente y su fecha, y lo usan la web, el MCP y el
asistente).

## Fuentes (verificadas el 2026-11-20 desde el Perú)

| Fuente | Dónde | Formato | Carga |
|---|---|---|---|
| RENIPRESS | Datos abiertos de SUSALUD (DKAN): `datos.susalud.gob.pe`, `api/3/action/package_show` | CSV ~19 MB, 36 mil IPRESS | `susalud`, viernes |
| Detalle por IPRESS | Consulta pública por código de RENIPRESS (`app20.susalud.gob.pe:8080/registro-renipress-webapp`): sesión de la página + `ipress.htm?action=cargarIpress` | JSON | `susalud_detalle`, 03:40 diario, ~1 200 por corrida |
| Registro de Sanciones | gob.pe, informes y publicaciones 455207 (XLSX que se reemplaza con cada actualización) | XLSX | `susalud`, viernes |
| Consultas y denuncias | Datos abiertos de SUSALUD, un CSV por año (anonimizado) | CSV | `susalud`, año en curso y anterior |
| Recursos (Consulta A) | Datos abiertos de SUSALUD, un CSV por mes | CSV | el último mes |
| Intervenciones quirúrgicas (Consulta H) | Datos abiertos de SUSALUD, un CSV por mes | CSV | los últimos 13 meses |
| Normas de salud | gob.pe / El Peruano / MINSA / CMP, en `norma` con `materia = 'salud'`: 19 normas, 1 311 artículos (lote 9 de `normas_fichas.py`) | fichas por artículo | `backend/scripts/cargar_normas.py` |

**No se leen de forma automática** (y por qué):

- **Colegio Médico del Perú, «Conoce a tu médico»** (`conoceatumedico.cmp.org.pe`): pide cuenta, reCAPTCHA v3, cifra la
  consulta y aplica una espera de 30 s entre fichas. Es un control de acceso deliberado: no se elude. La web lleva al
  ciudadano con los pasos y el número de colegiatura.
- **SUNEDU, Registro Nacional de Grados y Títulos**: captcha. Sólo enlace y pasos.
- **Licencias municipales**: no hay un registro nacional abierto. Se muestra lo que la IPRESS **declaró** en RENIPRESS
  (licencia municipal, compatibilidad de uso, con o sin adjunto).
- **INDECOPI («Mira a quién le compras»)**: consulta en línea sin descarga abierta encontrada; pendiente.

Trampas de las fuentes:

- El diccionario de RENIPRESS dice NORTE = longitud y ESTE = latitud; los datos vienen al revés del diccionario
  (NORTE = latitud). `coordenadas()` valida contra la caja del Perú y da vuelta si hace falta; 13 mil IPRESS no traen
  ubicación.
- La consulta por código responde 429 con más de un pedido a la vez: un hilo, ~1 pedido por segundo, espera ante 429.
- En el Registro de Sanciones el código de IPRESS viene sin ceros (`9123`); unas 50 de 2 604 sanciones con código traen otro
  nombre (casi todas razón social contra nombre comercial): se unen por el código y la ficha dice a nombre de quién se
  registró (`enlace = codigo_otro_nombre`). Sin código, sólo si hay UNA IPRESS con el mismo nombre en el departamento.
- Los CSV traen saltos de línea dentro de campos entre comillas; un Worker (128 MB) no puede armar RENIPRESS entero en
  memoria: `registrosCsv()` lee de a un registro desde los bytes.

## Datos personales

- Ninguna tabla de Salud guarda nombres ni documentos de personas. El JSON de RENIPRESS trae nombre y DNI del director
  médico y del representante legal: `filaDetalle()` (lista blanca) sólo deja colegio, número de colegiatura y RNE.
- Propietario: sólo RUC 20 (persona jurídica o entidad). Un RUC 10 no se guarda (lleva el DNI).
- No se busca a personas por nombre. Un número de colegiatura sólo dice en qué IPRESS figura como responsable.
- Los teléfonos que parecen celulares personales los tapa `publicar()` como en todo Vigía.
- «Estoy en un establecimiento» (`/cerca`, botón en la portada, el buscador y el mapa): la ubicación de quien busca se
  manda redondeada a 3 decimales (~110 m) y por POST (`/salud/cerca`), porque el registro de pedidos anota la URL con su
  query y no el cuerpo. Sin caché ni memoria; la distancia exacta y el orden final se calculan en el teléfono. En el mapa
  la ubicación no sale del teléfono. Nunca se dice «estás en tal clínica»: el GPS se desvía adentro de un edificio y la
  ubicación de cada IPRESS la declaró ella misma (un tercio no la declaró).

## Arquitectura (sobre lo que ya existía)

```
SUSALUD (datos abiertos, gob.pe, RENIPRESS)
   │  vigia-scrapers (Workflows): susalud (viernes) · susalud_detalle (03:40)   ← relay de Lima si no responde directo
   ▼
RDS Postgres: salud_ipress · salud_ipress_detalle · salud_ipress_cambio · salud_sancion · salud_infraccion ·
              salud_denuncia_anual · salud_recursos · salud_cirugia_mes · salud_indicador (salud_refrescar()) ·
              norma/norma_fragmento (materia 'salud', buscar_norma_salud())
   ▼
vigia-api /salud/* (Hono en Workers, caché de borde) ──► vigia-web: app/(gobserva)/salud (salud.gobserva.cloud)
   │                                                 ──► vigia-mcp: /mcp/salud (abierto, 6 herramientas)
   └─ POST /salud/asistente ── correrChat (vigia-llm, modelo abierto) ── herramientas de /mcp/salud
```

- Trazabilidad: cada archivo en `datasets_cargas` (sha256, URL, fecha, filas), el crudo en R2
  (`raw/susalud/<clave>/`), cada IPRESS con `primera_vez`, `visto_at`, `cambio_at` y su historia campo por campo en
  `salud_ipress_cambio`. La web muestra la fecha de cada dato y el enlace a la fuente oficial.
- Deduplicación: IPRESS por código único (el último gana dentro de un archivo, y se anota); sanciones por una huella de
  los campos que las identifican (las filas idénticas se numeran); denuncias por institución y año (el archivo de un año
  reemplaza ese año).
- Reutiliza de Vigía: lo que se sabe del RUC del propietario (SUNAT, contratos con el Estado, informes de control de la
  entidad pública), el kit de diseño, el motor del asistente (`correrChat`), el MCP v2, Turnstile y los topes por IP.

## Para la persona de a pie

- **Ficha, «Para atenderte aquí»** (`components/salud/ficha/ResumenAtencion.tsx`), arriba de la verificación: la frase de
  la verificación; qué servicios declaró en RENIPRESS (emergencia, hospitalización, partos, centro quirúrgico, cuidados
  intensivos, laboratorio, imágenes, farmacia, rehabilitación, diálisis, teleconsulta), cada uno como «Sí», «No lo
  declaró», «Suspendido» o «Sin dato todavía» (`atencion.ts`); su personal declarado a SUSALUD el último mes (cuántos
  médicos, enfermeras, obstetras…: nunca quién está hoy); «¿Te pueden atender aquí?» (`TeAtiendenAqui.tsx`), que busca
  lo que la persona escribe con sus palabras en lo que declaró; y dos preguntas listas para el asistente.
- **Necesidades** (`frontend/lib/salud-necesidades.ts`): «dientes», «embarazo y parto», «mi hijo tiene fiebre» → los
  comienzos de palabra con que RENIPRESS lo nombra («ODONTOLOG», «CENTRO OBSTETRICO», «PEDIATR»). Se compara por
  comienzo de palabra, sin tildes: «PARTO» no encuentra «Departamento».
- **Cerca de ti** (`/cerca`, `?necesidad=dientes`): con una necesidad, `POST /salud/cerca` recibe esos términos (sólo
  `[A-Z ]`) y devuelve las activas más cercanas que lo declararon, con lo que coincidió y cuántas de la zona ya tienen su
  detalle leído (la cobertura se dice en pantalla). La portada tiene un botón por necesidad.
- Lo que nunca se dice: «aquí no te atienden» (sólo «no lo declaró», y que se pregunte) ni «hay cupo» (lo declarado no
  dice si hoy hay un especialista de turno: «llama antes»).

## Agente de IA: decisión sobre Google ADK, RAG y MCP

- **MCP: sí.** `https://mcp.gobserva.cloud/mcp/salud`, abierto (sin cuenta ni plan, con el tope por conexión). Las mismas
  herramientas sirven al asistente de la web y a cualquier asistente externo (Claude, ChatGPT, Cursor). Es la pieza que
  hace que la respuesta sea la misma en todos lados.
- **RAG: sí, acotado a normas.** Las preguntas «¿puede…?», «¿qué categoría necesita…?», «¿qué es una sanción firme?» se
  responden con la norma y el artículo (`buscar_norma_salud`, híbrido palabras + vector bge-m3, separado del RAG de
  contrataciones). Los hechos de una IPRESS NO se sacan de un RAG: salen de las tablas, con su fecha.
- **Google ADK: evaluado, no para este asistente.** Vigía ya corre ADK en Lambdas para el análisis de contratos (11
  agentes, minutos por expediente). Una pregunta ciudadana es otra cosa: 1 a 4 llamadas a herramientas y respuesta en
  segundos. El motor `correrChat` (Worker, sin arranque en frío, streaming NDJSON, revisión automática de enlaces y
  montos) ya hace eso con las herramientas del MCP; una Lambda con ADK sumaría arranque en frío, otra imagen y otro costo
  sin mejorar la verificación. Si más adelante se quiere un **informe** de una red de clínicas (varias IPRESS, sus
  empresas, sus contratos con el Estado), ese sí es un trabajo para un agente ADK como los de contratos.

Topes del asistente (`TOPES_ASISTENTE_SALUD`; Turnstile es el widget de siempre, ahora con el dominio `gobserva.cloud`, que cubre todos los subdominios —el plan admite 10 dominios—): Turnstile en cada pregunta, 4 por minuto y 25 al día por conexión, 1 500
al día en total, bloqueo automático de 24 h ante ráfagas; modelo abierto por vigia-llm (sin Claude); no guarda
conversaciones.

## La app y la cuenta (2026-11-21)

- **Panel lateral para todos** (`PRODUCTOS_APP_ABIERTA` en `frontend/lib/gobserva.ts`): Salud usa el marco de app de
  Empleo y Licitaciones (`MarcoApp`, `NavApp`) con o sin sesión: Inicio, Mis guardados y Asistente; «Verificar»
  (establecimientos, médicos, medicamentos); «Explorar» (cerca de mí, mapa, alertas, sanciones, cambios, fuentes). En el
  celular, una barra abajo con Inicio, Clínicas, Médicos, Medicinas y «Más». La portada no redirige con sesión.
- **Medicamentos** (`/medicamentos`, `/medicamento/[codigo]`, `/alertas`; migración 441; fuente `digemid` del Worker,
  diaria): un buscador por nombre, principio activo, registro sanitario o lote; primero si una alerta lo nombra, después
  los productos con su precio típico por unidad y, en la ficha, los que tienen el mismo principio activo del más barato
  al más caro. DIGEMID responde al agente «Gobserva/1.0» (rechaza el de curl) y pide bajar el ritmo con los PDF: uno cada
  6 segundos y, ante un 429, esperas de 30 s a 2 min.
- **Cuenta gratis** (migración 442; `routes/saludCuenta.ts`): su propio grupo de Cognito («gobserva-salud», como Empleo
  y Licitaciones), correo y contraseña con código. Sólo sirve para guardar establecimientos, colegiaturas y medicamentos
  («Guardar» en cada ficha) y ver lo nuevo desde que se guardó en «Mis guardados» (`/cuenta`): una sanción firme
  emitida después, un cambio en RENIPRESS o una alerta de DIGEMID sobre su registro sanitario. Sin planes ni pagos:
  tabla propia (`salud_guardado`), aparte de `gobserva_guardados`. Tope de 300 por cuenta.

## Operación

- Carga a mano desde la PC (mismo código del Worker): `python backend/scripts/susalud_cargar.py prod <tipo> <archivo>`
  (`renipress`, `sanciones`, `denuncias`, `recursos`, `cirugias`, `detalle <n>`, `refrescar`).
- En el Worker: `POST /correr {"fuente":"susalud"}` o `{"fuente":"susalud_detalle","paso":1200}`.
- `salud_refrescar()` une sanciones e IPRESS y rehace `salud_indicador` (segundos); la corren las dos cargas.
- Una ficha abierta sin detalle (o con uno de más de 30 días) queda en `salud_detalle_pedido` y se lee primero.

## Pendiente

El inventario completo de fuentes (lo que se lee, lo probado, lo que queda manual, cómo cerrar cada brecha y la
ampliación a medicamentos, infraestructura, epidemiología, cobertura y fiscalización) está en
[`docs/salud/datos.md`](salud/datos.md).

- **REPROS** (Registro de Sanciones de los Profesionales de la Salud, R.S. N.° 006-2021-SUSALUD/S): el 2026-11-20 no se
  encontró; el 2026-11-21 sí: buscador público sin captcha y exportación a Excel en
  `app9.susalud.gob.pe:8081/wb-consulta-repros/` (78 sanciones vigentes). Es la etapa 1 de `docs/salud/datos.md`;
  hasta que se lea, no se muestra ninguna sanción a un médico.
- Normas del corpus que no entraron por falta de texto oficial con capa de texto: D. Leg. 559 (Ley del Trabajo
  Médico) y la Ley 15173 completa; la NTS 021 y la NTS 101 salen de escaneos con OCR (sin sus anexos).

- Completar el detalle de las 36 mil IPRESS (a ~1 200 por noche, un mes; prioriza sancionadas, privadas con
  internamiento, categorías II-III y lo que la gente abre).
- Reclamos ante las IPRESS (XLSX anuales de 25 MB) y «Medidas» adoptadas: se pueden sumar como «reclamo» por IPRESS.
- INDECOPI (sanciones de protección al consumidor a clínicas) y DIGEMID (establecimientos farmacéuticos), si hay
  descarga abierta.
- Avisos por correo de lo guardado (hoy lo nuevo se marca en «Mis guardados»): una tarea diaria que cruce
  `salud_guardado` con `salud_sancion`, `salud_ipress_cambio` y `salud_alerta` y mande un resumen (el correo de Cognito
  tiene tope de 50 al día: haría falta SES fuera del sandbox).

## Orden y memoria (2026-11-22, auditoría de UX/UI)

- **Menú por lo que se verifica**: Inicio, Guardados y vistos, Asistente; «Clínicas» (buscar, cerca de mí, mapa,
  sanciones), «Médicos» (por colegiatura) y «Medicinas» (verificar, alertas de DIGEMID). Los mismos nombres que la barra
  de abajo del celular. «Cambios» y «Fuentes» quedan en el pie y en la página de fuentes.
- **Un encabezado por clase de página**: la franja (título de 22 px, cuánto hay y un ⓘ) en listas y herramientas; la
  placa con figura sólo en la portada y en las fichas. La barra de filtros de las listas (`BarraFiltros`) pregunta como la
  gente («Dónde», «Qué es», «Del Estado o privado») y «Aplicar» es el único botón lleno.
- **Ficha de establecimiento**: seis pestañas (antes diez) y dos acciones a la vista («Cómo llegar», «Guardar») con el
  resto en «Más». La historia de estados de RENIPRESS se lee como una línea de tiempo, sin los códigos internos.
- **Ficha de medicamento**: una línea responde «¿es confiable?» (alertas sobre su registro, sobre su marca o ninguna), las
  alertas van primero y hay un campo para el lote de la caja. En la búsqueda, las presentaciones de un producto van en
  una fila con su rango de precio.
- **Lo que viste hace poco** (`lib/salud-vistos.ts`): las últimas 12 fichas abiertas, sólo en el dispositivo
  (localStorage), en la portada, en /buscar y en «Guardados y vistos», con «Borrar». No se guarda lo que se escribe en
  los buscadores. Un «Guardar» sin cuenta se completa solo al volver con la cuenta creada.
- **No encontrado y error** propios de Salud (antes caían en el 404 de Vigía); la colegiatura sin respuesta de las fuentes
  igual muestra el número y el botón al CMP.
