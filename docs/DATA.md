# Datos de Vigía

Todo lo que muestra Vigía es información pública del Estado peruano. Aquí está de dónde sale cada dato, con qué se carga
y dónde queda. Qué señales se arman con ellos: [`DATOS_Y_SENALES.md`](DATOS_Y_SENALES.md).

> **Los datos crudos no están en este repositorio.** Son pesados y algunos traen datos personales: el RNP, por ejemplo,
> tiene los nombres y documentos de socios y representantes. Publicarlos rompería la regla de no exponer datos de
> personas (`PRIVACIDAD.md`). Aquí se documentan las fuentes oficiales para que puedas bajarlos tú.

## Dónde viven

- **La base**: PostgreSQL en AWS RDS, privada. El esquema son las migraciones numeradas de `backend/db/migrations/`.
  Las tareas entran por un túnel de Session Manager (`infrastructure/aws/tunel_rds.py`); los Workers, por Hyperdrive.
- **Los archivos**: Cloudflare R2. Los crudos de cada carga en `vigia-peru-crudos`, los documentos de los expedientes en
  `vigia-peru-batch` y lo público (fotos, páginas de error) en `vigia-peru-reportes`.
- **La captura**: el Worker `vigia-scrapers` con Workflows de Cloudflare, un archivo por fuente en
  `backend/scrapers-worker/src/fuentes/` y los horarios en `src/calendario.ts`. Lo que no entra ahí son scripts de
  `backend/scripts/` (`cargar_*.py`), que corren desde la PC o como tareas de GitLab CI (`tarea:*` en `.gitlab-ci.yml`).
- Varios portales del Estado bloquean las IPs de nube: esas fuentes salen por Lima (el relay de `backend/relay-lima`).

## Fuentes

### Contratación pública

| Fuente | Qué trae | Con qué se carga |
|---|---|---|
| OECE, Contrataciones Abiertas (API OCDS) | Procesos, contratos, postores, ganadores y documentos | `oece_ocds.ts`, `oece_historico.ts` y `oece_directas.ts` |
| CONOSCE (OECE) | Adjudicaciones por ítem, postores, contratos y órdenes de compra y servicio | `conosce.ts` y `conosce_ordenes.ts` |
| SEACE | Contratos menores (hasta 8 UIT) y cotizaciones abiertas | `seace_menores.ts` y `seace_cotizaciones.ts` |
| SEACE, documentos | Bases, actas y contratos de cada expediente, a R2 | `documentos.ts` |
| Perú Compras | Órdenes de los catálogos electrónicos, con ítems y precios | `backend/scripts/cargar_perucompras.py` |
| OECE en la PNDA | Entidades, sancionados del Tribunal, penalidades y otros datasets | `oece_entidades.ts`, `pnda_sancionados.ts`, `osce_penalidades.ts` y `pnda_oece.ts` |
| OECE, fichas de proveedores | Si una empresa sancionada está apta y habilitada hoy | `oece_fichas.ts` |
| RNP (OECE) | Socios, representantes y órganos de administración de los proveedores, cada mes | `backend/scripts/cargar_rnp.py` (`tarea:rnp`) |
| Tribunal de Contrataciones | Resoluciones de apelación, unidas a su contrato | `backend/scripts/tribunal_cargar.py` |

### Empresas, presupuesto y obras

| Fuente | Qué trae | Con qué se carga |
|---|---|---|
| SUNAT | El padrón reducido de RUC: estado y antigüedad de cada empresa | `sunat_padron.ts` |
| MEF | Presupuesto y ejecución del gasto, también de organismos descentralizados y empresas municipales | `mef_presupuesto.ts` y `mef_opds_etes.ts` |
| Invierte.pe (MEF) | Las inversiones activas | `invierte_pe.ts` |
| INFOBRAS (Contraloría) | Las obras públicas y su avance | `infobras.ts` |

### Control, política y personas

| Fuente | Qué trae | Con qué se carga |
|---|---|---|
| Contraloría | Informes de control y sus observaciones | `contraloria_informes.ts` |
| Contraloría, vía PNDA | Declaraciones juradas de intereses | `pnda_dji.ts` |
| Procuraduría Anticorrupción | Casos en trámite por sede, del boletín mensual | `backend/scripts/cargar_ppedc_boletin.py` |
| JNE | Autoridades vigentes y electas por ubigeo | `jne_infogob.ts` |
| ONPE, Claridad | Aportes a partidos, candidatos y gastos de campaña | `onpe_claridad.ts` y `onpe_gastos.ts` |
| PCM, vía PNDA, y Congreso | Visitas a entidades públicas | `pnda_visitas.ts` y `congreso_visitas.ts` |
| Portal de Transparencia Estándar | Personal de cada entidad | `pte_personal.ts` |

### Productos de Gobserva

| Fuente | Qué trae | Con qué se carga |
|---|---|---|
| SERVIR, Talento Perú | Plazas CAS y prácticas | `servir_convocatorias.ts` y `servir_practicas.ts` |
| SUSALUD | Establecimientos de salud (RENIPRESS), su detalle y sanciones | `susalud.ts` y `susalud_detalle.ts` |
| DIGEMID | Medicamentos y alertas | `digemid.ts` y `digemid_extraer.ts` |
| MTC | Las listas de locales autorizados de Gobserva Car | `mtc_car.ts` |

Los archivos `.ts` están en `backend/scrapers-worker/src/fuentes/`; la tabla de cada uno, en su primer comentario.

## La norma que citan los agentes

Cada señal cita la norma que aplica. La ley, el reglamento, las directivas y las opiniones del OECE están indexadas en
Chroma y, desde la migración 284, también en la base (`norma` y `norma_fragmento`), con su régimen y sus fechas de
vigencia; las carga `backend/scripts/cargar_normas.py`. El agente legal las busca desde `backend/agent/tools/legal.py`
(`LEGAL_RAG_BACKEND` elige dónde). Ya no se usa Vertex AI Search.

## Las llaves de cruce

| Llave | Qué une |
|---|---|
| OCID y código de convocatoria | Un proceso a lo largo de su vida: convocatoria, postores, buena pro, contrato y órdenes |
| RUC 20 | Una entidad o una empresa en todas las fuentes |
| CUI | Una inversión pública (Invierte.pe, INFOBRAS) |
| Ubigeo | Un departamento, una provincia o un distrito |

El DNI se usa sólo por dentro para cruzar personas. Nunca sale por la API ni por el MCP, y un RUC 10 nunca se muestra
(`PRIVACIDAD.md`).

## Cómo bajar los datos tú

- **OECE y CONOSCE**: datos abiertos de la contratación (planes, convocatorias, adjudicaciones, contratos y órdenes) y
  la API OCDS por proceso. El mapa de las tablas de CONOSCE está en [`DATASET_MAP.md`](DATASET_MAP.md).
- **Plataforma Nacional de Datos Abiertos (PNDA)**: visitas, sancionados, declaraciones juradas y datasets del OECE.
- **SUNAT**: el padrón reducido de RUC.
- **MEF**: Consulta Amigable y datos abiertos del presupuesto.
- **ONPE, JNE, Contraloría e INFOBRAS**: finanzas políticas, autoridades, control y obras.
