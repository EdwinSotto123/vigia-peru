# Gobserva Salud

Verificar establecimientos de salud y médicos del Perú con fuentes oficiales: `salud.gobserva.cloud`.
Abierto y gratuito, sin cuenta. Desde el 2026-11-20.

## Qué responde

| Pregunta del ciudadano | Con qué se responde | Qué NO se afirma |
|---|---|---|
| ¿Esta clínica está registrada y activa? | RENIPRESS (SUSALUD): estado, categoría, historial de estados | Nada que RENIPRESS no diga; lo que dice es declaración jurada de la IPRESS |
| ¿Puede hacer cirugías (estéticas)? | Detalle de RENIPRESS: unidad de centro quirúrgico (UPSS), especialidades (cirugía plástica), cartera de servicios; producción quirúrgica declarada; normas (RAG) | RENIPRESS no autoriza procedimientos uno por uno: se dice qué está registrado y qué no |
| ¿Tiene sanciones? | Registro de Sanciones de SUSALUD: sanciones **firmes** con resolución, infracción, multa en UIT y estado judicial | Nunca «no tiene sanciones»: «no figura en el registro revisado el …» (SUSALUD retira las antiguas tras ≥ 1 año) |
| ¿Tiene denuncias? | Reporte anonimizado de consultas y denuncias ante SUSALUD, por año | Una denuncia no es una sanción ni un hecho comprobado |
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
| Normas de salud | gob.pe / El Peruano / MINSA / CMP, en `norma` con `materia = 'salud'` | fichas por artículo | `backend/scripts/cargar_normas.py` |

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

Topes del asistente (`TOPES_ASISTENTE_SALUD`): Turnstile en cada pregunta, 4 por minuto y 25 al día por conexión, 1 500
al día en total, bloqueo automático de 24 h ante ráfagas; modelo abierto por vigia-llm (sin Claude); no guarda
conversaciones.

## Operación

- Carga a mano desde la PC (mismo código del Worker): `python backend/scripts/susalud_cargar.py prod <tipo> <archivo>`
  (`renipress`, `sanciones`, `denuncias`, `recursos`, `cirugias`, `detalle <n>`, `refrescar`).
- En el Worker: `POST /correr {"fuente":"susalud"}` o `{"fuente":"susalud_detalle","paso":1200}`.
- `salud_refrescar()` une sanciones e IPRESS y rehace `salud_indicador` (segundos); la corren las dos cargas.
- Una ficha abierta sin detalle (o con uno de más de 30 días) queda en `salud_detalle_pedido` y se lee primero.

## Pendiente

- Completar el detalle de las 36 mil IPRESS (a ~1 200 por noche, un mes; prioriza sancionadas, privadas con
  internamiento, categorías II-III y lo que la gente abre).
- Reclamos ante las IPRESS (XLSX anuales de 25 MB) y «Medidas» adoptadas: se pueden sumar como «reclamo» por IPRESS.
- INDECOPI (sanciones de protección al consumidor a clínicas) y DIGEMID (establecimientos farmacéuticos), si hay
  descarga abierta.
- Alertas: avisar si una clínica seguida cambia de estado o recibe una sanción (las tablas ya guardan los cambios).
