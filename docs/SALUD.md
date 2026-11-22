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
- Alertas de DIGEMID: el Worker `digemid` lee las nuevas, guarda el texto de su PDF y pasa su tabla a
  `salud_alerta_producto` (producto, presentación, lote, registro, titular, fabricante, vencimiento) con un modelo
  abierto; cada valor tiene que estar escrito en el PDF. Detalle en [`docs/salud/datos.md`](salud/datos.md#61-medicamentos-y-alertas-sanitarias-prioridad-muy-alta).

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

## Para atenderse: seguro, 24 horas y el derecho a la emergencia (2026-11-22)

Pedido: «que sea útil para una persona de a pie que quiera atenderse». Lo primero que esa persona pregunta es con qué
seguro la atienden, y ninguna página lo decía.

- **Con qué seguro** (`frontend/lib/salud-seguros.ts`, `SEGUROS_SQL` en la API): por la institución que declaró en
  RENIPRESS. MINSA y gobiernos regionales: con SIS gratis (gob.pe/8970, gob.pe/32985); EsSalud: sus asegurados, en el
  centro asignado (gob.pe/277); Sanidades: su personal y familiares; privado: pagando o con un seguro privado o EPS. Un
  convenio puntual no está en RENIPRESS: siempre se dice «pregunta».
- **24 horas** (`ES_24H` en la API y `atiende24` en la web, el mismo patrón): el horario es texto libre; cuenta «24
  HORAS», «00:00 - 24:00», «24x7», no «8:00 - 24:00». 1 355 activos lo declaran (22-11-2026).
- **Dónde se ve:** «Cerca de mí» pregunta «¿Qué seguro tienes?» (SIS, EsSalud, privado o EPS, no tengo) y «Sólo los que
  atienden 24 horas», con una guía corta por seguro y su enlace a gob.pe (`?seguro=&h24=1`); la lista tiene el filtro
  «Con qué seguro» (en vez de «Del Estado o privado») y «Atiende 24 horas»; cada fila dice «Con SIS», «EsSalud»,
  «Sanidad» o «Privado»; la ficha abre «Para atenderte» con «Con qué seguro te atienden».
- **El derecho a la emergencia:** en una emergencia o un parto, cualquier establecimiento, público o privado, tiene que
  atender, con o sin seguro, mientras haya grave riesgo; el pago se ve después (Ley 26842, artículos 3 y 39, modificados
  por la Ley 27604; artículo 15.1 a). Va en el aviso de emergencia de todas las páginas, en la ficha y al elegir
  «Emergencia» en «Cerca de mí».

## Auditoría de todas las páginas (2026-11-22, noche)

Pedido: «ORDENALO MEJOR… MEJORA TODO, AUDITA TODO, ITERA». Una auditoría visual de las 21 páginas en 390 y 1280 px
(capturas en el scratchpad) y dos vueltas de arreglos:

- **Nada suelto:** «Verifica un medicamento» pone el catálogo, las alertas recientes y «Cómo verificar» en pestañas;
  cada bloque tiene su sección con título. La ficha de una clínica separa «Sanciones firmes» y «Denuncias» en
  subpestañas; la denuncia va dentro de su nota y en «Más», no suelta.
- **Páginas más cortas en el celular:** sanciones de una clínica 6,9 a 4,3 pantallas (detalle plegado, 6 por página);
  /alertas 6,7 a 3,4 (cada tabla tras «Ver los N productos»); /fuentes 7 a 3,6 (cada fuente plegable, lo técnico
  aparte). Sin columnas «No lo dice» cuando el PDF no trae lotes ni registros.
- **Errores:** la ficha de una clínica se iba de lado (428 px a 390); el campo del lote se aplastaba; la paginación
  terminaba en una página falsa (2 000 de 2 700); las denuncias decían «Sin dato» con 950 al lado y una fecha futura.
- **El buscador de medicamentos** busca en la forma y la presentación, entiende «1G», muestra lo más parecido con la
  marca si nada tiene todas las palabras, y busca las alertas por el nombre (CEFALOGEN tenía 4 alertas y salía «ninguna»).
- **Coherencia:** un buscador por página (la barra de arriba lo oculta donde la página tiene el suyo), el menú de
  abajo marca el grupo de la página, la foto se llama siempre «Toma una foto de la caja», textos de ejemplo que entran
  en el celular, insignias debajo del título (no encima), concentraciones legibles (0.003 es 0.3 %).

## El catálogo de medicamentos y los dibujos (2026-11-22)

Pedido: «QUE SEA TIPO MARKETPLACE, donde se muestre cuadros en PIXEL ART los medicamentos, filtrado… otras secciones es
solo texto plano».

- **Catálogo** (`/medicamentos`): sin búsqueda se hojean los 11 332 productos (los más vendidos primero); con búsqueda,
  lo que coincide. Cada producto es una tarjeta (`components/salud/medicamentos/Catalogo.tsx`) con el dibujo de su
  forma, el precio típico por unidad, cuántas farmacias lo reportan, si es genérico y cuántas alertas nombran su
  registro. Arriba, un riel de formas con su dibujo y su cuenta, «Genéricos / De marca» y el orden (más vendidos,
  menor precio, de la A a la Z). Todo es un enlace: `?forma=jarabe&tipo=generico&orden=precio`.
- **Las formas en diez grupos** (tabletas, cápsulas, jarabes, inyectables, cremas, gotas, sobres, inhaladores, óvulos,
  otros): `FORMA_GRUPO_SQL` en la API y `lib/salud-formas.ts` en la web, con el mismo orden de reglas.
- **Los dibujos** (`frontend/scripts/pixel/arte_medicinas.py`, 18 x 16, se generan con `python arte.py`): uno por
  forma y tres lugares (hospital, posta, consultorio). Van en el catálogo, en la ficha del medicamento (grande), en las
  filas de establecimientos (por su clasificación; laboratorio, dientes, ojos, imágenes y rehabilitación usan sus
  íconos), en las listas de alertas y en «Productos y lotes» (por el texto del producto).
- La ficha del medicamento muestra «Mismo principio activo» como tarjetas, con «Más barato que este».
- **La entrada** (sin búsqueda, según la maqueta del usuario): el titular «Verifica un medicamento» con las cifras y
  una ilustración de píxeles (la caja, el blíster y el escudo con el visto, `escudoCheck`), la tarjeta de búsqueda
  con dos pestañas (texto, y foto: `?modo=foto`), «¿Qué puedes verificar?» (registro, lote, vencimiento), las alertas
  recientes en una línea cada una y la franja de fuentes; debajo, «Explora el catálogo». La insignia dice «Con datos
  oficiales de DIGEMID», no «herramienta oficial»: Gobserva no es una entidad del Estado.

## La foto de la caja (2026-11-22)

Pedido: «ALGO TIPO: TOMA FOTO». En «Verifica un medicamento», «Toma una foto de la caja» abre la cámara de atrás del
celular (en la computadora, el selector de archivos):

1. La web achica la foto a 1 600 px en JPEG (`components/salud/medicamentos/FotoCaja.tsx`) y la manda a
   `POST /v1/salud/medicamentos/foto` con Turnstile; topes por conexión (6 por minuto, 40 al día, 3 000 en total) y un
   tope de 1 MB sólo para esa ruta (`app.ts`).
2. Un modelo abierto con visión (DeepSeek v4.1 flash en vigia-llm, `backend/api/src/lib/fotoCaja.ts`) lee el registro
   sanitario, el lote, el vencimiento, el nombre y el titular. Cada dato pasa por la forma del buscador (`registroDe`,
   `pareceLote`) o se descarta; una foto que no es de un medicamento se rechaza. **La foto no se guarda ni se registra.**
3. La persona revisa y corrige lo leído y verifica: `/medicamentos?q=<registro>&lote=<lote>`. La API busca los dos
   (`loteCaja`, `loteEnAlertas`, `coincideLote`) y la página da un veredicto: el lote está en la tabla de una alerta
   (rojo, con el producto), aparece en el texto de un PDF (rojo, revisar), hay alertas del registro pero de otros lotes
   (ámbar) o ninguno figura (verde, con la fecha de lo revisado; nunca «es seguro»).

Probado con cajas sintéticas contra el modelo real (registro, lote, vencimiento, nombre y titular exactos en 2-3 s) y
con una captura de pantalla (rechazada: no es un medicamento).

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

## Cacería de errores de medicamentos (2026-11-22)

Lo que decía algo falso o atribuía mal, y cómo quedó:

- **Veredicto del validador.** La lista de alertas salía de `/alertas`, que busca sólo texto, y un registro con alerta (en la lista `registros`, no en el texto) daba «no figura». Ahora la lista y el veredicto salen de la misma búsqueda de la API, paginada (`apag`, 10 por página).
- **Rojo sólo con certeza.** Un registro hallado es rojo; un lote hallado sólo en el texto de la alerta (no en su tabla) es ámbar y pide revisar el PDF. Un lote de menos de 5 caracteres se busca sólo en la tabla; los demás, con límite de palabra (`\m…\M`), y el nombre, desde el inicio de palabra (omeprazol no trae esomeprazol).
- **Marca.** `palabrasMarca()` toma todas las palabras de la marca, sin forma ni principio activo («DOLO NEUROPRESS», no «DOLO», que también es Dolo-Neurobión). Un producto que se llama como su principio activo es genérico: no se le atribuyen cajas de otros laboratorios, sólo las alertas de seguridad o modificación del principio activo.
- **Ficha.** Las alertas de seguridad van aparte y cuentan en la pestaña (le aplican); las de falsificados o calidad de la marca van como «cajas que usan el nombre», con sus lotes y vencimientos, y no cuentan. Si hay más de 30, un enlace lleva a todas en el validador. Un registro sin alertas de una marca con falsificaciones lo avisa también en el validador (`falsificadasMarca`).
- **Cuentas.** «Está en N alertas» cuenta alertas distintas, no filas. Los equivalentes ya no se cuentan a sí mismos. La portada dice «presentaciones con precio». La tarjeta del catálogo muestra el mismo precio que la ficha; el rango va aparte.
- **Datos.** Las gotas orales van con los líquidos orales (API y web). Los vencimientos mal leídos del PDF («04 20028») no se muestran (`vencimientoValido`).
- **Texto.** Plurales («1 unidades», «las 1 farmacias», «1 productos»), el punto doble de «S.A..» y las frases de precio cuando no hay precio.
- **Tipos de alerta.** DIGEMID publica retiros de lotes o productos bajo «falsificado» o «seguridad». La API los corrige al leer (`TIPO_ALERTA_SQL`, por título y motivo; cambian 22 de 1 732) y la base guarda el tipo original. «Falsificado» se rotula «falsificado o ilegal», porque incluye ventas sin registro sanitario por redes sociales.
- **Portada y fuentes.** Los establecimientos con sanción se cuentan sólo entre los activos, igual que la lista a la que llevan. En /fuentes se muestra la carga del periodo más nuevo de cada fuente, no la última cargada. Las denuncias del año en curso se marcan como parciales: el archivo de SUSALUD llega por partes. Para saber hasta qué mes llegan hay que guardar el mes en la carga; está pendiente.
- **Clínicas.** El centro quirúrgico se mira también en las UPS cuando RENIPRESS no trae las UPSS, y cuentan las cirugías reportadas: el Hospital de Apoyo de Cusco y otros grandes decían «sin centro quirúrgico». El primer nivel ya no recibe «revisa» por no tenerlo. Un establecimiento cerrado o dado de baja muestra un aviso rojo en vez de «te atienden», y la lista no le pone 24 horas ni seguro. Los celulares se tapan también tras «,» o «/», o con 51 o 01 delante (`sinCelulares` en la API). Las 24 horas reconocen «00:00 - 23:59» y «8:00 - 8:00», pero no «8:00 - 8:00 PM». «Ver las denuncias» abre su pestaña. La búsqueda por colegiatura usa sólo el Colegio Médico, como /medico. Otras sedes muestra el total, no el tope de 40.
