# Datos de Gobserva Salud

Qué fuentes leemos, cuáles probamos, qué falta, qué queda manual y por qué, y cómo cerrar cada brecha sin romper nada.
Revisado el **21 de noviembre de 2026**, desde una conexión peruana, con pedidos HTTP simples (HEAD, las primeras líneas o
el diccionario de cada archivo). No se resolvió ningún captcha ni se creó ninguna cuenta.

Complementa a [`docs/SALUD.md`](../SALUD.md), donde están la arquitectura, la privacidad y la operación.

¿Una ficha dice «Todavía no leímos el detalle de este establecimiento en RENIPRESS», «Sin dato» o «No figura»? Qué
significa cada aviso, por qué sale, cuántas fichas lo tienen y cómo se cierra: [§8](#8-lo-que-falta-en-cada-ficha-y-por-qué).

## Índice

1. [Lo que ya leemos](#1-lo-que-ya-leemos)
2. [Lo que probamos y no se lee solo](#2-lo-que-probamos-y-no-se-lee-solo)
3. [Vías nuevas encontradas el 21-11-2026](#3-vías-nuevas-encontradas-el-21-11-2026)
4. [Lo que queda manual y por qué](#4-lo-que-queda-manual-y-por-qué)
5. [Cómo cerrar la brecha sin romper nada](#5-cómo-cerrar-la-brecha-sin-romper-nada)
6. [Ampliación: cinco frentes nuevos](#6-ampliación-cinco-frentes-nuevos)
7. [Plan por etapas](#7-plan-por-etapas)
8. [Lo que falta en cada ficha y por qué](#8-lo-que-falta-en-cada-ficha-y-por-qué)

---

## 1. Lo que ya leemos

| Fuente | URL | Formato y frecuencia | Lo que extraemos | Carga |
|---|---|---|---|---|
| **RENIPRESS** (registro de establecimientos, SUSALUD) | `http://datos.susalud.gob.pe/api/3/action/package_show?id=…` (DKAN); copia mensual en datosabiertos.gob.pe | CSV de ~19 MB, mensual (último día hábil). Licencia ODC-PDDL / ODC-BY | 36 mil IPRESS: nombre, categoría, sector, estado, dirección, teléfono, horario, RUC (sólo 20), coordenadas | Worker `susalud`, viernes |
| **Detalle por IPRESS** (consulta pública de RENIPRESS) | `app20.susalud.gob.pe:8080/registro-renipress-webapp`: sesión de la página y `ipress.htm?action=cargarIpress` | JSON, uno por pedido | UPSS con su estado, especialidades, cartera de servicios, UPS, suspendidas, telesalud, documentos declarados (licencia municipal…), categorización y colegiatura del responsable. Nombre y DNI del director y del representante **se descartan** (lista blanca `filaDetalle`) | Worker `susalud_detalle`, 03:40, ~1 200 por noche, un hilo, ~1 pedido/s |
| **Registro de Sanciones** (SUSALUD) | gob.pe, informes y publicaciones 455207 | XLSX que se reemplaza con cada actualización | Sanciones firmes a IPRESS, IAFAS y UGIPRESS: tipo, multa en UIT, gravedad, infracción, resolución, fecha, proceso judicial | Worker `susalud`, viernes |
| **Consultas y denuncias** (SUSALUD, anonimizado) | DKAN de SUSALUD | CSV anual | Denuncias y consultas por institución y año (sin personas) | Worker `susalud` |
| **Consulta A: recursos de salud** | `datos.susalud.gob.pe/dataset/consulta-recursos-de-salud-2026` | CSV mensual, un mes de rezago (octubre subió el 17-11-2026). ODC-BY | Consultorios, camas, médicos (total, SERUMS, residentes), enfermeras, obstetras, farmacéuticos, ambulancias. **Sólo reportan ~5 300 IPRESS** (584 privadas) | el último mes |
| **Consulta H: intervenciones quirúrgicas** | DKAN de SUSALUD | CSV mensual | Cirugías mayores, menores, suspendidas, programadas y de emergencia por IPRESS | los últimos 13 meses |
| **Normas de salud** | gob.pe, El Peruano, MINSA, CMP | Fichas por artículo | 19 normas, 1 311 artículos, para el asistente | `backend/scripts/cargar_normas.py` |

## 2. Lo que probamos y no se lee solo

| Fuente | URL | Qué la frena | Lo que hacemos hoy |
|---|---|---|---|
| **Colegio Médico del Perú**, «Conoce a tu médico» | `conoceatumedico.cmp.org.pe` | Cuenta, reCAPTCHA v3, consulta cifrada y espera de 30 s entre fichas: un control de acceso puesto a propósito | Enlace guiado con el número de colegiatura |
| **CMP**, Registro Nacional de Especialistas y recertificación | `cmp.org.pe/sistcere-medicos-recertificados/` | Sólo un tablero de Power BI, sin descarga | Nada |
| **SUNEDU**, grados y títulos | `enlinea.sunedu.gob.pe` | Captcha. En datosabiertos.gob.pe (3 677 conjuntos revisados) no hay grados y títulos | Enlace guiado |
| **Colegio de Enfermeros** (CEP) | `cep.org.pe/validar/` | Captcha de imagen | Enlace guiado |
| **Colegio de Nutricionistas** (CNP) | `app.cnp.org.pe/sanu/externo/consultacolegiado.aspx` | Captcha | Enlace guiado |
| **Colegio Químico Farmacéutico** (CQFP), habilidad | `cqfgo.appcqfp.pe/usuario/buscar.xhtml` | reCAPTCHA | Enlace guiado (sus sancionados sí, ver §3) |
| **Detalle de IPRESS en bloque** | DKAN de SUSALUD y datosabiertos.gob.pe | No existe: el CSV mensual de RENIPRESS **no trae** UPSS, cartera, especialidades ni documentos | Seguimos uno por uno (§1); van 12 991 de 36 226 leídas (§8) |
| **INFORHUS** (personal de salud del MINSA) | `minsa.gob.pe/reunis/?op=3&niv=9` | Sólo tableros agregados de Power BI | Nada |
| **AIRHSP** (MEF) | `fs.datosabiertos.mef.gob.pe/datastorefiles/PERSONALSP_2026.csv` | Agregado: una cifra, no personas | No sirve para verificar a nadie |
| **Licencias municipales** | — | No hay un registro nacional abierto | Mostramos lo que la IPRESS **declaró** en RENIPRESS |
| **INDECOPI** («Mira a quién le compras») | — | Consulta en línea sin descarga abierta | Pendiente |

## 3. Vías nuevas encontradas el 21-11-2026

La pregunta era si lo bloqueado por captcha existe en otra URL, mensual o semanal. Para el CMP y SUNEDU, **no** (ver §4).
Pero apareció lo siguiente:

| Dato | Vía | URL | Formato | Personas | Qué hacer |
|---|---|---|---|---|---|
| **REPROS**: sanciones de los colegios a profesionales de la salud (R.S. 006-2021-SUSALUD/S) | Buscador público **sin captcha** y botón «Exportar excel» (un GET sin token) | `app9.susalud.gob.pe:8081/wb-consulta-repros/consulta.htm` y `…/exportarExcelList.htm` (todos los filtros vacíos) | XLS de 7 columnas: nombre, colegio y sede, colegiatura, tipo de sanción, número y fecha de resolución, estado. Se actualiza cuando un colegio informa (plazo: 10 días hábiles desde que la sanción queda firme) | Nombre y colegiatura; la R.S. 000165-2026 (17-09-2026) suma el documento de identidad a lo publicado | **Leerlo** (etapa 1). Hoy son 78 sanciones vigentes: CMP 63, odontólogos 6, psicólogos 5, enfermeros 4. Es la pieza que faltaba: la sanción a un médico |
| **Consulta J: programación asistencial** (SUSALUD) | DKAN | `datos.susalud.gob.pe/api/3/action/package_show?id=consulta-j-programaci%C3%B3n-asistencial-2026` | CSV mensual, ODC-BY | No | Por IPRESS y por colegio profesional, los profesionales y las horas programadas por servicio: «¿hay especialista y cuántas horas?» |
| **Consultas B a I** (producción, morbilidad, emergencia, hospitalización, partos, vigilancia) | DKAN (192 conjuntos) | `datos.susalud.gob.pe/dataset` | CSV mensual, ODC-BY | No | Para la ficha y los indicadores por territorio (§6) |
| **SERUMS adjudicados** (MINSA) | gob.pe | `gob.pe/institucion/minsa/informes-publicaciones/8594910` | XLSX, dos procesos al año (2026-II: 14-09-2026) | Nombres, sin DNI ni colegiatura | Sólo la cuenta por establecimiento (trae el código RENIPRESS). Sin nombres |
| **Padrón electoral del CMP** | Archivo del sitio del CMP | `cmp.org.pe/wp-content/uploads/2024/03/BBDD_PadronElectoral_20240223_paginaweb.xlsx` (57 054 hábiles al 23-02-2024) | XLSX, sólo cuando hay elecciones | N.° CMP, apellidos, nombres, consejo regional | **No usar por ahora**: se publicó con fin electoral y reusarlo para otra cosa choca con el principio de finalidad de la Ley 29733. Pedir revisión legal o el padrón por la Ley 27806 |
| **Odontólogos, obstetras, psicólogos, tecnólogos médicos** | Buscadores sin captcha (formulario simple) | `siga.ccdp.org.pe/consultas_web/consulta_colegiado.asp`, `consulta.colegiodeobstetras.pe`, `cpsp.pe/busquedas/busqueda_colegiados.html`, `ctmperu.org.pe/busqueda-de-colegiado/` | Una consulta por vez | Nombres | Sólo **a pedido** de quien verifica, por número de colegiatura y nunca recorriéndolos enteros (§5) |
| **Sancionados del CQFP** | PDF público | `cqfp.pe/registro-nacional-de-sancionados/` | PDF de una página (21-08-2026) | Nombre y colegiatura | Leer con REPROS: misma forma |

## 4. Lo que queda manual y por qué

- **Habilidad al día de un médico (CMP) y su especialidad (RNE).** No existe en otra URL. La consulta del CMP tiene captcha,
  cifrado y espera **a propósito**: es la decisión del colegio sobre cómo se consulta su padrón, y saltarla sería tomar sin
  permiso lo que no publicó. Queda el **enlace guiado** (los pasos y el número de colegiatura listos) hasta tener una vía
  formal.
- **Grados y títulos (SUNEDU).** Su servicio de interoperabilidad (`opConsultarRNGT` en PIDE) es sólo para entidades
  públicas del Poder Ejecutivo; Gobserva no califica. Enlace guiado.
- **Enfermeros, nutricionistas y la habilidad del CQFP.** Captcha. Enlace guiado.
- **UPSS, cartera y especialidades de las 36 mil IPRESS.** Sólo se leen de a una, con el límite que pone SUSALUD (más de un
  pedido a la vez responde 429). A ~1 200 por noche, las activas quedan leídas hacia el 6 de diciembre de 2026 y todas
  hacia el 11; primero van las que la gente abre. Cifras y cómo acelerarlo: §8.1.
- **Lo que no tiene descarga** (registro sanitario de medicamentos, retiro del mercado, establecimientos farmacéuticos,
  inspecciones de DIGEMID): formularios web sin exportación, varios detrás de un desafío de Cloudflare o reCAPTCHA. Enlace
  guiado o pedido formal.

## 5. Cómo cerrar la brecha sin romper nada

**Lo que no hacemos.** No resolvemos captchas (ni con servicios que los resuelven), no creamos cuentas a nombre de nadie,
no usamos el DNI de un usuario para consultar por él, no cambiamos de IP ni nos hacemos pasar por un navegador para
saltar un bloqueo, y no recorremos un buscador entero aunque no tenga captcha. Además del riesgo legal (la Ley 30096 de
delitos informáticos sanciona el acceso indebido), un producto que exige reglas al Estado no puede saltarse las de otros.

**Lo que sí hacemos, en orden:**

1. **Buscar el archivo antes que la página.** Casi todo lo útil de esta revisión salió de una descarga que ya existía
   (REPROS, Consulta J, la API de WordPress de DIGEMID, el ZIP de precios). Primero el portal de datos abiertos, después
   el DKAN o la API del sitio y recién al final la consulta web.
2. **Pedirlo por la Ley 27806 de acceso a la información pública** (`gob.pe/20399-solicitar-acceso-a-la-informacion-publica`,
   10 días hábiles). Los colegios profesionales también están obligados (Res. 003683-2023-JUS/TTAIP, que cita al Tribunal
   Constitucional, Exp. 01448-2013-PHD/TC). Pedidos concretos, sin datos personales:
   - **CMP**: el padrón de hábiles con número de colegiatura, consejo regional y RNE, sin DNI.
   - **SUSALUD**: la exportación del detalle de RENIPRESS (UPSS, cartera, especialidades, documentos), sin los DNI del
     director y del representante; y si publicará las colegiaturas por IPRESS que ya recibe en la Consulta J.
   - **CEP, CNP, CQFP**: el padrón de hábiles por colegiatura.
   - **MINSA**: INFORHUS agregado por IPRESS.
3. **Convenio** con el CMP (y después con los demás colegios): una consulta por colegiatura, a pedido, con su permiso y su
   límite. Es la vía estable para «¿está habilitado hoy?».
4. **Vigilar lo que viene.** El RENACSS (repositorio nacional de carteras de servicios, R.M. 625-2026/MINSA) debe estar
   listo hacia enero de 2027; si es público, reemplaza la lectura de uno en uno. El padrón del CMP 2026 se puede vigilar
   con la API de medios de su sitio (`cmp.org.pe/wp-json/wp/v2/media?search=padron`), sin usarlo hasta tener la revisión
   legal.
5. **Cuando sólo hay consulta web sin captcha**, leer **a pedido** del ciudadano (una consulta cuando alguien verifica a un
   profesional por su colegiatura), identificarnos con un User-Agent honesto, respetar robots.txt y los límites (un pedido
   a la vez, pausa ante 429) y guardar sólo lo necesario.
6. **Privacidad, siempre igual que hoy**: nunca DNI, nunca un RUC 10, nunca búsqueda de personas por nombre. Del REPROS se
   guarda colegio, colegiatura, sanción, resolución, fecha y estado: se muestra en la ficha de una colegiatura, no en una
   lista de nombres.

## 6. Ampliación: cinco frentes nuevos

Las fuentes de cada frente, con lo que se pudo confirmar el 21-11-2026. «Sí» en captcha quiere decir que no se usa.

### 6.1 Medicamentos y alertas sanitarias (prioridad muy alta)

| Fuente | Qué trae | URL | Formato y frecuencia | Captcha | Personas |
|---|---|---|---|---|---|
| **Alertas DIGEMID** | 1 732 alertas: 890 de falsificados, 410 de control de calidad, 416 de seguridad, 219 de modificaciones; cada una con su PDF (producto, lote, vencimiento, lugar). Última: N.° 142-2026, del 19-11-2026 | `digemid.minsa.gob.pe/webDigemid/wp-json/wp/v2/posts?categories=34` y los PDF en `/Archivos/Alertas/` | JSON y PDF, continua | No | Nombre y dirección de boticas intervenidas (se muestra el establecimiento, no personas) |
| **Alertas de dispositivos médicos** (Notiseguridad) | 44 notas y 25 acciones de seguridad en campo. Última: 12-10-2026 | `…/wp-json/wp/v2/posts?categories=24` | JSON, continua | No | No |
| **Indicador de precios** (con datos del Observatorio) | 15 481 productos con registro sanitario, titular, fabricante, país, principio activo, cuántos establecimientos reportan y precio medio, mediano y moda | `digemid.minsa.gob.pe/Archivos/Indicadores/TendenciaCentral/FT_202609.zip` | ZIP con un Excel por mes, 2017-01 a 2026-09 | No | No |
| Retiro del mercado | Por registro sanitario, lote y motivo | `digemid.minsa.gob.pe/ConsultasWeb/RetiroProductoMercado/ConsultaRetiro.aspx` | Formulario, sin exportación | No | No |
| Registro sanitario (consulta) | Productos farmacéuticos y dispositivos | `digemid.minsa.gob.pe/rsProductosFarmaceuticos/`, `/rsDispositivos/` | Sólo web | **Sí** (desafío de Cloudflare; reCAPTCHA v3) | — |
| Establecimientos farmacéuticos | Registro, RUC, razón social, dirección, categoría y situación | `serviciosweb-digemid.minsa.gob.pe/Consultas/Establecimientos` | Formulario, sin exportación masiva | No | **Sí** (el director técnico con DNI): sólo a pedido y sin esa pestaña |

El registro sanitario completo no tiene descarga; el ZIP de precios hace de catálogo parcial (15 mil productos con su
registro y titular) para cruzar con las alertas: «¿este producto o este lote tiene una alerta?».

### 6.2 Infraestructura sanitaria (prioridad muy alta)

| Fuente | Qué trae | URL | Formato y frecuencia | Captcha | Personas |
|---|---|---|---|---|---|
| RENIPRESS (ya se lee) | Categoría y estado de 36 246 IPRESS (27 017 activas). Ya incluye 1 277 laboratorios de patología clínica y 443 centros de diagnóstico por imágenes | §1 | CSV mensual | No | No |
| Consulta A (ya se lee) | Camas, consultorios, personal, ambulancias por IPRESS (39 744 camas en ~5 330 IPRESS, octubre 2026) | §1 | CSV mensual | No | No |
| Consultas B a J de SUSALUD | Producción, emergencia, hospitalización, partos, programación | `datos.susalud.gob.pe/dataset` | CSV mensual | No | No |
| Diagnóstico de brechas del MINSA | Infraestructura y equipamiento 2024-2026 | `minsa.gob.pe/Recursos/OTRANS/08Proyectos/2022/Diagnostico-Infraestructura-Sector-Salud-2024-2026.pdf` | PDF | No | No |
| Indicadores de brecha del MEF | Formato 4-A de Salud | `ofi5.mef.gob.pe/brechas/Index/Consulta` | PDF y consulta web | No | No |
| Obras de PRONIS | Proyectos de infraestructura | `obrasalud.pronis.gob.pe` | Sólo web | No | No |

Las obras de salud ya están en **Gobserva Obras** e **Infobras** por su código único de inversión (CUI): la brecha por
territorio se arma cruzando RENIPRESS y la Consulta A con lo que ya tenemos en Obras. Bancos de sangre (PRONAHEBAS) y
equipamiento por establecimiento: **no se encontró** un directorio abierto.

### 6.3 Vigilancia epidemiológica (prioridad alta)

| Fuente | Qué trae | URL | Formato y frecuencia | Captcha | Personas |
|---|---|---|---|---|---|
| **Dengue del CDC** en datos abiertos | Un caso por fila: ubigeo, año, semana, diagnóstico, edad y sexo. **2000 a 2025** (no trae 2026). Hermanos: malaria, IRA, EDA, leishmaniosis, zoonosis | `datosabiertos.gob.pe/dataset/vigilancia-epidemiológica-de-dengue` | CSV de 118 MB (21-10-2026). ODC-BY | No | Sin nombre ni DNI, pero con edad, sexo y localidad: **sólo agregados** por distrito y semana |
| Sala situacional del CDC | Dengue y otros daños por departamento y distrito, semana 44 de 2026 | `dge.gob.pe/portal/docs/vigilancia/sala/2026/SE44/dengue.pdf` | PDF semanal | No | No |
| Alertas y avisos epidemiológicos | Alerta AE-CDC N.° 010-2026 (06-11-2026); boletín SE 37 | `dge.gob.pe/portalnuevo/informacion-publica/avisos-y-alertas-epidemiologicas/` | PDF con listado | No | No |
| SINADEF (defunciones) | Edad, sexo, distrito, fecha y causas por CIE-10 | `datosabiertos.gob.pe/dataset/información-de-fallecidos-del-sistema-informático-nacional-de-defunciones-sinadef-ministerio` | El archivo está en drive.minsa.gob.pe, **bloqueado por Cloudflare** a pedidos automáticos | Bloqueo | Microdato sensible: sólo agregados |

El 2026 del dengue sólo está en PDF y en un tablero: se publica la serie histórica (2000-2025) y, para el año en curso,
el enlace a la sala situacional de la semana con su fecha. Si el CSV de 2026 aparece, entra solo.

### 6.4 Cobertura y servicios (prioridad alta)

| Fuente | Qué trae | URL | Formato y frecuencia | Captcha | Personas |
|---|---|---|---|---|---|
| **Afiliados al aseguramiento universal** (SUSALUD) | Por distrito: quintil, población, porcentaje con seguro y afiliados de SIS, EsSalud, EPS, Fuerzas Armadas y otros | `datos.susalud.gob.pe/dataset/consulta-afiliacion` | XLSX (julio 2026). PDDL | No | No |
| **Afiliados SIS activos** | Por establecimiento de adscripción, ubigeo, edad, sexo y plan | `datosabiertos.gob.pe/dataset/datos-de-afiliados-al-seguro-integral-de-salud-en-estado-activo-sis` | ZIP mensual (2026-10). ODC-BY | No | No |
| Atenciones SIS | Por establecimiento, servicio, sexo, edad y mes | `datosabiertos.gob.pe/dataset/datos-de-atenciones-realizadas-los-asegurados-sis` | ZIP semestral (último: 2025-II) | No | No |
| Prestaciones de las EPS | Mensuales | `datosabiertos.gob.pe/dataset/prestaciones-de-salud-liquidadas-por-las-entidades-prestadoras-de-salud-iafas-eps` | CSV mensual (2026-09) | No | No |
| EsSalud | Consulta externa e inmunización **2015-2022**; población asegurada al IV trimestre 2023 | `datosabiertos.gob.pe/dataset/atenciones-en-consulta-externa-essalud` | CSV/XLSX | No | No |

EsSalud está desactualizado: se muestra con su fecha o no se muestra. No se encontró una lista de privadas con convenio
SIS.

### 6.5 Calidad y fiscalización

| Fuente | Qué trae | URL | Formato y frecuencia | Captcha | Personas |
|---|---|---|---|---|---|
| **REPROS** | Sanciones a profesionales (§3) | §3 | XLS | No | Ver §3 y §5 |
| **Sanciones DICER de DIGEMID** | Al menos 292: expediente, resolución, fecha, razón social, PDF (al 01-09-2026) | `digemid.minsa.gob.pe/webDigemid/establecimientos/resoluciones-de-sancion-dicer/` | HTML y PDF | No | Razón social (algunas llevan nombre de persona: se muestran sólo empresas) |
| **INACAL, laboratorios acreditados** | Clínicos (ISO 15189, 05-11-2026) y de ensayo (19-11-2026) | `inacal.gob.pe/acreditacion/categoria/acreditados` | PDF | No | No |
| Reclamos y medidas (SUSALUD) | Reclamos por IPRESS con su servicio, causa y resultado; las «medidas» **no son sanciones** | `datos.susalud.gob.pe/dataset/reclamos`, `/medidas` | XLSX anual 2021-2026. **Licencia no declarada** | No | No |
| Inspecciones DIGEMID | Farmacias, boticas, droguerías y laboratorios, conforme o no conforme, desde 2018 | `digemid.minsa.gob.pe/ConsultasWeb/Inspecciones/ConsultaInspecciones.aspx` | Formulario, sin exportación | No | No |
| Sanciones por no reportar precios | Establecimientos | `digemid.minsa.gob.pe/webDigemid/establecimientos-sancionados/` | Sólo un tablero de Looker Studio | — | — |

Sin fuente abierta encontrada: acreditaciones de establecimientos de salud, laboratorios autorizados por el INS,
autorizaciones de DIGESA para establecimientos de salud (sus consultas son de alimentos y juguetes) y fiscalización
municipal (sólo Miraflores, 2018).

**Una advertencia de lectura**: muchos reclamos pueden indicar mejor registro, no peor servicio. Si entran, entran como
«reclamo», nunca sumados a las sanciones, como ya se hace con las denuncias.

## 7. Plan por etapas

Cada etapa sale entera (fuente, carga, API, página y verificación en producción) antes de la siguiente.

| Etapa | Qué | Fuente | Por qué primero |
|---|---|---|---|
| **1** | **Sanciones a profesionales** en la ficha de una colegiatura (`/medico/[colegiatura]`) | REPROS (y los sancionados del CQFP) | Es lo que la gente más pregunta («¿mi médico tiene una sanción?») y lo único que faltaba de «Verificar médicos». XLS pequeño, sin captcha, público por norma |
| **2** | **Medicamentos**: «¿este producto o lote tiene una alerta?», alertas recientes, precios de referencia | Alertas DIGEMID (API de WordPress), dispositivos, ZIP de precios | Valor ciudadano muy alto, fuentes limpias y diarias |
| **3** | **Lo que atiende cada IPRESS**: horas programadas por servicio y colegio, producción y emergencia | Consultas J y B a I | Responde «¿hay especialista?» mejor que la cartera declarada |
| **4** | **Tu distrito**: cobertura de seguro, afiliados SIS, establecimientos y brecha | Afiliación AUS, SIS, RENIPRESS, Consulta A, Obras | Agregados por territorio, sin personas |
| **5** | **Vigilancia**: dengue por distrito y semana (serie), alertas y salas del CDC | Datos abiertos del CDC y sus PDF | Serie histórica abierta; el año en curso, enlazado |
| **6** | **Fiscalización**: sanciones DICER, laboratorios acreditados, reclamos | DIGEMID, INACAL, SUSALUD | Completa la ficha de farmacias y laboratorios |
| En paralelo | Pedidos por la Ley 27806 (§5) y vigilar RENACSS y el padrón del CMP | CMP, SUSALUD, colegios, MINSA | Son las únicas vías para habilidad al día, RNE y el detalle en bloque |

**Lo que no se pudo confirmar** (y se revisa antes de cada etapa): si el detalle de cada ficha del REPROS ya muestra el
documento de identidad tras la R.S. 165-2026; los campos que devuelven los buscadores de odontólogos, psicólogos y
tecnólogos; si el Observatorio de precios en línea tiene captcha; el archivo de SINADEF; un directorio de bancos de
sangre; si el RENACSS será público.

## 8. Lo que falta en cada ficha y por qué

Cada aviso de «falta» que ve una persona en la ficha de un establecimiento, de dónde sale y cuántas fichas lo tienen. Las
cifras salen de la base de producción el **21-11-2026 a las 13:00** (consulta de sólo lectura).

Hay cuatro clases de hueco, y no se dicen igual:

| Clase | Qué quiere decir | Cómo lo dice la ficha |
|---|---|---|
| **Todavía no leído** | El dato existe en RENIPRESS, pero aún no lo leímos de esa IPRESS | «Todavía no leímos…», «Sin dato» |
| **No declarado** | Lo leímos y la IPRESS no lo declaró en RENIPRESS | «No declarada», «No figura», «No figura ninguna especialidad» |
| **No reporta** | La fuente sólo trae a las IPRESS que le informan (recursos, cirugías) | «No figura en los datos de recursos de SUSALUD» |
| **No hay registro** | La fuente no la nombra (sanciones, denuncias): no es lo mismo que «no tiene» | «No figura en el Registro de Sanciones…» |

### 8.1 «Todavía no leímos el detalle de este establecimiento en RENIPRESS»

Hasta el 21-11-2026 el aviso decía «Estamos pidiendo a RENIPRESS el detalle de este establecimiento… ya lo pedimos y
aparecerá aquí cuando lo leamos».

**Qué falta.** La ficha se arma con dos lecturas de RENIPRESS:

1. El **archivo mensual** (CSV), que trae las 36 226 IPRESS de una vez: nombre, categoría, estado, dirección, teléfono,
   horario y coordenadas.
2. El **detalle de cada IPRESS** (UPSS y UPS, especialidades, cartera de servicios, documentos declarados, responsable de
   la atención, historia de estados y RUC del propietario). No existe en bloque (§2): se lee de a una en la consulta
   pública, con el Worker `susalud_detalle`.

Mientras la segunda lectura no llega, la ficha muestra:

| Dónde | Qué se ve |
|---|---|
| Pestañas Servicios, Documentos y Verificación | El aviso, con el enlace a la consulta oficial de esa IPRESS |
| Pestaña Historial, «Historia de estados» | El aviso |
| Pestaña Para atenderte | «Todavía no leímos sus servicios…»; el buscador «¿Te pueden atender aquí?» no tiene en qué buscar |
| Lo esencial | 3 o 4 casillas en vez de 6 o 7: faltan centro quirúrgico, licencia municipal y responsable |
| Pestaña Fuentes | «Pedido a RENIPRESS: todavía no lo leemos» |
| Pestaña Empresa y sedes | No aparece: el RUC del propietario viene en el detalle |
| Cerca de mí, por necesidad | «Eso no prueba que no lo atiendan: de muchos todavía no leemos sus servicios» |
| `/medico/[colegiatura]` | Busca la colegiatura sólo entre las IPRESS leídas (lo dice: «de los 12 991 cuyo detalle revisamos») |

**Cuánto falta.**

| | Total | Leídas | Falta |
|---|---|---|---|
| IPRESS en el registro | 36 226 | 12 991 (35,9 %) | 23 230 nunca intentadas, más 5 que la consulta dice que «no existen» |
| Activas | 27 000 | 9 110 (33,7 %) | **17 890** |
| Con sanciones firmes | 724 | 724 | 0 |
| Privadas con internamiento | 694 | 694 | 0 |
| Categorías II y III (hospitales, institutos) | 781 | 781 | 0 |
| Sin categoría | 8 586 | 8 583 | 3 |
| **Activas de categoría I** | 17 885 sin leer | | I-1: 8 517, I-2: 5 592, I-3: 3 597, I-4: 179 |

Lo que falta es casi todo **primer nivel**: puestos de salud, consultorios y centros de salud. Es justo donde más gente se
atiende, así que el aviso se ve seguido.

**Por qué falta.**

- **No hay descarga.** SUSALUD no publica el detalle en bloque (§2). La consulta pública es la única vía sin captcha.
- **RENIPRESS sólo contesta desde el Perú**, y limita a un pedido a la vez: con 3 hilos respondió 429 al tercer pedido. El
  Worker lo pide por el relay de Lima, que se comparte con otras fuentes; por eso corre de madrugada (03:40, `calendario.ts`)
  y lee unas 1 200 por noche, a ~1 pedido por segundo.
- **Ritmo real.** El 20-11 se hizo el relleno inicial desde una PC en el Perú (11 793 leídas). El 21-11, la primera corrida
  nocturna leyó 1 198.
- **Cuando alguien abre una ficha sin detalle** (o con uno de más de 30 días), la API anota un pedido
  (`salud_pedir_detalle`), y la corrida siguiente lo lee antes que todo lo demás. Hoy hay 4 pedidos esperando; el más viejo
  es de las 12:37. La espera va de 1 a 24 horas, según la hora en que se abrió: por eso el aviso dice «suele estar aquí al
  día siguiente».
- **No se lee en el momento** en que alguien abre la ficha porque la API corre fuera del Perú: tendría que pasar por el relay
  de Lima a cualquier hora y en paralelo con otros pedidos, que es lo que hace saltar el 429.
- **El orden perdió noches.** En `pendientes()` (`susalud_detalle.ts`), `(i.categoria ~ '^(II|III)') DESC` da NULL cuando la
  IPRESS no tiene categoría, y PostgreSQL pone los NULL **primero** en un orden descendente. Así, las 8 583 sin categoría
  (servicios médicos de apoyo, muchos inactivos) pasaron antes que las activas de categoría I. Para el primer recorrido ya
  no cambia nada, porque sólo quedan 3 sin categoría y las activas van primero. Pero se repetirá en el refresco de cada 30
  días.

**Proyección sin cambiar nada.** Con 1 200 por noche desde el 22-11:

- las activas quedan leídas hacia el **6-12-2026** (15 noches);
- todas, hacia el **11-12-2026** (20 noches);
- desde el **20-12-2026** empieza el refresco de las primeras 11 793.

**Cómo cerrarlo sin romper nada**, de lo más rápido a lo más estructural:

1. **Terminar el primer recorrido ya**, al mismo ritmo de un pedido por segundo, sólo que por más tiempo. Hay dos formas:
   - una corrida desde una PC en el Perú, como la del 20-11: `node scripts/susalud_local.ts detalle 23230 1`, un hilo,
     unas 10 horas;
   - subir el `paso` de la corrida nocturna de 1 200 a 6 000 (el tope del código) durante 4 noches.

   El código ya espera 30, 60 y 120 segundos ante un 429 y corta la tanda si sigue: no insiste.
2. **Leer los pedidos cada hora.** Sumar a la corrida horaria (la de `documentos`) una tanda chica de `susalud_detalle` que lea
   **sólo** `salud_detalle_pedido`, con un tope de 20. La espera baja de hasta 24 horas a menos de una. La carga es mínima:
   hoy son 4 pedidos al día.
3. **Corregir el orden**: `(… ) IS TRUE DESC` en vez de `(… ) DESC`, o `DESC NULLS LAST`, en `pendientes()`.
4. **De fondo**: el pedido por la Ley 27806 de la exportación del detalle (§5.2) y el RENACSS, si es público (§5.4).
   Cualquiera de los dos reemplaza la lectura de a una.

### 8.2 Leído, pero vacío: lo que la IPRESS no declaró

RENIPRESS es una **declaración jurada** de cada IPRESS (art. 7 de la R.S. 004-2021-SUSALUD/S). Si un campo viene vacío, la
IPRESS no lo declaró: no quiere decir que no lo tenga. Por eso la ficha dice «no declaró» y nunca «no tiene».

Cuántas lo tienen vacío, entre las **9 110 activas ya leídas**:

| Campo | Vacío | Cómo se ve |
|---|---|---|
| Especialidades | 4 300 (47 %) | «No figura ninguna especialidad en RENIPRESS (consultado el …)» |
| Cartera de servicios | 4 143 (45 %) | La sección no aparece |
| Ningún documento declarado | 5 260 (58 %) | «No figura ningún documento declarado en RENIPRESS…» |
| Licencia municipal declarada | 6 659 (73 %) | Casilla «Licencia municipal: No declarada» |
| Colegiatura del responsable | 1 041 (11 %) | Casilla «Responsable: No figura» |
| Unidades (ni UPSS ni UPS) | 10 | «No figura ninguna unidad asistencial…» |

De las 12 991 leídas, 9 760 no traen RNE (registro de especialista). Es normal: no todo responsable es especialista, y la
mitad ni siquiera es médico (§8.6).

**Cómo cerrarlo.** No hay nada que leer: es lo que la IPRESS declaró. Que lo declare es tarea de la supervisión de SUSALUD.
Lo nuestro es decirlo bien, con «No declarada» y no «Sin dato» (corregido el 21-11, §8.6). La licencia en sí la da la
municipalidad, y no hay un registro nacional abierto (§2).

### 8.3 Lo que falta en el archivo mensual de RENIPRESS

| Campo | Vacío (todas / activas) | Por qué | Qué se ve |
|---|---|---|---|
| Categoría | 8 586 / 4 912 | RENIPRESS no categoriza los servicios médicos de apoyo (2 852 de las activas) ni muchos consultorios sin internamiento (1 984) | «Sin categoría» |
| Coordenadas | 13 166 / 6 960 | La IPRESS no declaró su ubicación. Son casi todas privadas: 6 664 privadas frente a 267 públicas | No salen en el mapa ni en «Cerca de mí» |
| Teléfono | 1 019 / 761 | No lo declaró | No aparece el teléfono |
| Dirección | 408 | No la declaró | Sólo distrito y provincia |
| Inicio de actividad | 1 121 | RENIPRESS trae 1900-01-01 | No se muestra |
| Horario | 217 / 29 | No lo declaró | No se muestra |

**Cómo cerrarlo.** Las coordenadas son el hueco que más pesa: casi 7 mil activas que «Cerca de mí» no encuentra. Lo que
**no** hay que hacer es geocodificar la dirección, porque un alfiler mal puesto engaña más que ninguno. Lo que sí:

- mostrar en «Cerca de mí» las IPRESS sin ubicación del mismo distrito (`ubigeo`), en una lista aparte que lo diga;
- pedirle a SUSALUD, por la vía del §5, que exija la ubicación al registrar una IPRESS.

### 8.4 Sólo de quien reporta: recursos, cirugías y denuncias

| Fuente | Cuántas IPRESS trae | Qué ve el resto |
|---|---|---|
| **Consulta A**: recursos (octubre de 2026) | 5 327 de 27 000 activas (20 %): 4 734 de 9 772 públicas (48 %) y **584 de 16 996 privadas (3 %)**. De las filas, 2 056 traen 0 médicos o ninguno | «No figura en los datos de recursos de SUSALUD… No todas las IPRESS los informan cada mes» |
| **Consulta H**: cirugías (10-2025 a 10-2026) | 6 069 | «No figuran cirugías declaradas en los datos de SUSALUD» |
| **Consultas y denuncias** (2019 a 2026) | 7 092 | «No figura en los datos de consultas y denuncias de SUSALUD»: nadie denunció **o** no se registró a su nombre |

**Por qué.** Las Consultas A y H se arman con lo que cada IPRESS informa a SUSALUD por su sistema de reportes. Las públicas
informan más; las privadas, casi nunca. No es un error de lectura: el archivo no las trae.

**Cómo cerrarlo.**

- Probar la **Consulta J** (programación asistencial, etapa 3 del §7) y medir antes cuántas IPRESS privadas trae. Si son
  más, responde «¿hay especialista y cuántas horas?» para más fichas que la Consulta A.
- Mientras, la ficha dice «no figura en los datos» y nunca muestra un cero.

### 8.5 Sanciones que no llegan a ninguna ficha

De **2 996** sanciones vigentes en el registro, 2 605 están unidas a una IPRESS:

- 2 586 por su código;
- 18 por su código, aunque el registro le pone otro nombre;
- 1 sólo por su nombre.

Quedan **391 sin unir**:

| Grupo | Cuántas | ¿Es un hueco? |
|---|---|---|
| IAFAS (aseguradoras) | 200 | No: no son establecimientos y no tienen ficha |
| UGIPRESS | 3 | No: son gestoras, no establecimientos |
| IPRESS con «SIN CÓDIGO ÚNICO» | **188** | **Sí** |

Las 188 salen en `/sanciones`, pero en ninguna ficha. Una ficha cuya casilla dice «Sanciones firmes: Ninguna» podría ser
de una de ellas.

**Cómo cerrarlo.**

1. Unirlas por el **RUC**: el detalle trae el RUC 20 del propietario de 9 254 IPRESS, y se compara con el nombre y el
   distrito de la sanción.
2. Lo que no quede seguro va a una lista de revisión a mano. Nunca se une sólo por el nombre: hay cadenas con decenas de
   sedes con el mismo nombre.
3. Mientras, la casilla podría decir «Ninguna unida a este código» en vez de «Ninguna». Es una decisión pendiente.

### 8.6 Lo que se corrigió al revisar esto (21-11-2026)

- **El responsable salía como «CMP» aunque no fuera médico.** De las 12 991 IPRESS leídas, **6 565** registran un
  responsable de otro colegio:

  | Colegio | Responsables |
  |---|---|
  | Odontológico | 1 969 |
  | Enfermeros | 1 130 |
  | Obstetras | 966 |
  | Tecnólogo Médico | 898 |
  | Técnicos de enfermería, sin colegio | 661 |
  | Biólogos | 425 |
  | Otros | el resto |

  La casilla decía «Responsable médico: CMP 1234» y enlazaba a `/medico/1234`, que busca en el Colegio Médico: es decir,
  a **otra persona**. Ahora:
  - dice «CMP 1234» sólo si el colegio es el Médico;
  - si no, muestra la profesión («Odontología», «Enfermería»…) y lleva a la pestaña Verificación;
  - los enlaces a `/medico` de Documentos, Verificación y Para atenderte siguen la misma regla.

  Código: `esColegioMedico` y `profesionResponsable` en `components/salud/ficha/piezas.tsx`.
- **«Colegio Tecnólogo Médico» salía como «Colegio Médico del Perú»**, porque la API buscaba «MEDICO» primero (898 fichas).
  Además, `/medico/[colegiatura]` los incluía en su búsqueda (`ILIKE '%MEDICO%'`). Corregido en `tituloColegio`, en el
  filtro de `/salud/medico` (`'COLEGIO M_DICO DEL PER%'`) y en su prueba.
- **«Sin dato» donde había un dato.** Una licencia que la IPRESS no declaró se veía igual que un detalle no leído. Ahora
  dice «No declarada», y el responsable sin colegiatura dice «No figura».
- **El aviso no decía cuándo.** Ahora dice que RENIPRESS se consulta de madrugada y que el detalle suele estar al día
  siguiente.

### 8.7 El historial de cambios, todavía vacío

`salud_ipress_cambio` tiene **0 filas**. Por eso `/cambios` dice «Todavía no hay cambios registrados» y el Historial de cada
ficha dice «No registramos cambios en RENIPRESS desde…».

Un cambio sale de comparar dos lecturas, y todavía hay una sola:

- un solo archivo mensual, `RENIPRESS_2026_v8.csv`, cargado el 20-11;
- ningún detalle se volvió a leer todavía.

Los primeros cambios llegan:

- con el **próximo archivo mensual** (el último día hábil de noviembre; el Worker `susalud` lo carga el viernes siguiente,
  hacia el **4-12-2026**);
- con el **refresco del detalle** de cada 30 días, desde el **20-12-2026**.

No hay nada que cerrar: es el tiempo que necesita una comparación.
