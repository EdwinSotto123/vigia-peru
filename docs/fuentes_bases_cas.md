# Fuentes de las bases CAS

De dónde salen las plazas, a qué sitios fuimos y por qué, cómo leemos cada uno, qué nos limitó y qué falta. Cifras de producción al 09/11/2026 10:26 (hora de Lima); la pasada de recolección sigue sumando. Los adaptadores de MTPE, SERNANP y PRONIED se sumaron después de esa medición.

## Resumen

| | Plazas |
|---|---|
| CAS, 276 y 728 abiertas hoy | 4 076 |
| En un sitio que ya sabemos leer | 2 593 (64 %) |
| Ya buscadas | 1 102 |
| Con sus bases encontradas | 714 |
| Con bases leídas | 554 |
| Con los pasos para postular | 506 |
| Con documentos a presentar | 539 |
| Con cronograma | 543 |
| Prácticas abiertas | 99 |

Documentos registrados: 1 625, de los cuales 1 363 tienen copia propia. GLM 5.3 flash leyó 490 por texto y 38 escaneos como imágenes; Haiku, 22.

## De dónde salen las plazas

Todas vienen de **Talento Perú**, la bolsa oficial de SERVIR. Nuestro scraper la lee cada mañana desde el Perú: su aplicativo (JSF) no responde fuera del país, así que pasa por el relay de Lima.

| Listado | URL | Cuándo |
|---|---|---|
| Ofertas laborales (CAS, 276, 728 y otros) | `https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml` | todos los días, 08:00 |
| Modalidades formativas (prácticas) | `https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/modalidades_formativas.xhtml` | todos los días, 09:00 |

Los otros dos listados de Talento Perú (contratación directa y cooperación laboral) existen pero hoy no los leemos.

### Por qué fuimos a esos sitios

SERVIR publica el aviso (puesto, sueldo, requisitos, fechas) pero **no guarda las bases**. Cada aviso trae el enlace que puso la entidad: su web, un aplicativo, una página de gob.pe, una carpeta de Drive o, a veces, nada o sólo Facebook. Las bases, el cronograma y los pasos para postular están detrás de ese enlace, así que el recolector sigue cada enlace hasta el PDF del proceso.

## El camino de una plaza

Corre de madrugada (cron cada 20 minutos) y cuando alguien abre la ficha de una plaza.

1. **El aviso llega de SERVIR**: número de proceso, puesto, entidad, fechas y el enlace de la entidad.
2. **Se elige cómo leer el sitio** por el dominio del enlace: una de las 92 claves de dominio con adaptador propio o, si no hay, el buscador genérico. Sin enlace, el sitio que hallamos para esa entidad.
3. **Se ubica el proceso** por número y año, o por puesto y fecha cuando la entidad numera distinto que SERVIR.
4. **Se bajan los PDF**: hasta 3 por plaza, 25 MB cada uno (35 MB por plaza). De las listas de resultados (aptos, puntajes, ganadores) sólo queda el enlace: tienen nombres y DNI.
5. **Se guarda una copia** de cada PDF en nuestro almacenamiento (R2).
6. **GLM 5.3 flash lo lee**: el texto o, si es un escaneo, las páginas como imágenes. Saca cómo postular, documentos, cronograma, evaluación y funciones.

## A dónde enlaza SERVIR

| Tipo de sitio | Abiertas | % | Con bases | Con cómo postular |
|---|---|---|---|---|
| Sitio con adaptador probado | 2 389 | 59 % | 617 | 469 |
| Entidad sin enlace, sitio ya hallado | 204 | 5 % | 7 | 7 |
| Web propia, buscador genérico | 859 | 21 % | 90 | 30 |
| Captcha | 233 | 6 % | 0 | 0 |
| Sin enlace o sólo Facebook | 391 | 10 % | 0 | 0 |

MTPE, SERNANP y PRONIED se sumaron después de esta medición: sus plazas todavía no están contadas en la fila «Sitio con adaptador probado».

## Sitios probados (65)

Cada uno probado contra la web real con plazas abiertas. «Probado en Cloudflare» = comprobado en producción con la plaza indicada. «Relay de Lima» = el sitio sólo responde desde el Perú.

### Nacionales

- **Poder Judicial (cortes superiores)**: `https://aplicativo.pj.gob.pe/psep/wfrmConvocatoriasV.aspx?TCon=C`
  - Acceso: relay de Lima. Ola 1.
  - Cómo lo leemos: Formulario ASP.NET: el combo de procesos por corte y los PDF fijos del repositorio (aviso, cronograma y bases).
  - Lo que limitó: No responde a Cloudflare.
  - Hoy: 409 abiertas, 153 con bases, 82 con cómo postular
- **MINJUS**: `https://convocatoria.minjus.gob.pe/convocatoria/public/index.xhtml`
  - Acceso: relay de Lima. Ola 1.
  - Cómo lo leemos: JSF con AJAX y un nonce por sesión; el proceso se reconoce por el título del puesto.
  - Lo que limitó: No responde a Cloudflare. Su numeración no es la de SERVIR.
  - Hoy: 77 abiertas, 65 con bases, 58 con cómo postular
- **MINEDU (sede central)**: `https://postulacioncas.minedu.gob.pe/PostulacionCas/Home`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: Tabla del aplicativo; bases y TDR por idReq. Se reconoce por título y código AIRHSP.
  - Lo que limitó: Su número no siempre es el de SERVIR.
  - Hoy: 36 abiertas, 2 con bases, 2 con cómo postular
- **MINEDU (enlaces a www)**: `https://postulacioncas.minedu.gob.pe/PostulacionCas/Home`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Los avisos que enlazan a www.minedu.gob.pe se resuelven en el mismo aplicativo de postulación.
  - Hoy: 20 abiertas, en cola
- **MINSA**: `https://convocatorias.minsa.gob.pe/convocatorias`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: Lista del aplicativo y descarga de bases por convocatoria.
  - Lo que limitó: Descarga sin «.pdf» en la dirección.
  - Hoy: 1 abiertas, 1 con bases, 0 con cómo postular
- **MIDIS**: `https://app.midis.gob.pe/Sis_Convocatoria/Convocatoria/Lista`
  - Acceso: relay de Lima. Ola 2.
  - Cómo lo leemos: SERVIR enlaza a gob.pe, pero publica en su aplicativo: lista pública en JSON (en proceso y concluidas), bases y comunicados.
  - Lo que limitó: No responde a Cloudflare. Se reconoce por el nombre de la entidad, no por el enlace.
  - Probado en Cloudflare: plaza 824338: bases, cómo postular y 8 etapas
  - Hoy: 8 abiertas, 7 con bases, 6 con cómo postular
- **JUNTOS**: `https://convocatoria.juntos.gob.pe`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: El mismo sistema que el MIDIS: lista en JSON y descarga de bases.
  - Hoy: 2 abiertas, 0 con bases, 0 con cómo postular
- **SUNAFIL**: `https://aplicativosweb2.sunafil.gob.pe/si.convocatoria/convocatoria`
  - Acceso: relay de Lima (TLS roto). Ola 1.
  - Cómo lo leemos: Aplicativo con la lista y los PDF del proceso.
  - Lo que limitó: TLS con cifrado viejo (AES128-SHA) que Cloudflare rechaza.
  - Hoy: 33 abiertas, 12 con bases, 12 con cómo postular
- **OECE**: `https://caspublico.oece.gob.pe`
  - Acceso: relay de Lima (TLS roto). Ola 2.
  - Cómo lo leemos: Lista por POST (año, estado) en JSON; las bases y el perfil están en un Drive privado que sólo baja por POST.
  - Lo que limitó: Cadena TLS incompleta. La descarga no acepta GET (405).
  - Probado en Cloudflare: plaza 824710: bases y perfil, cómo postular y 8 etapas
  - Hoy: 1 abiertas, 1 con bases, 1 con cómo postular
- **Provías Nacional**: `http://gis.proviasnac.gob.pe/convocatorias/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: ASP clásico: lista por año y estado, detalle del proceso y descarga por número de registro.
  - Lo que limitó: Sólo http, páginas en windows-1252 y la descarga llega como octet-stream. Se reconoce por el nombre de la entidad.
  - Probado en Cloudflare: plaza 825137: bases, cómo postular y 12 etapas
  - Hoy: 4 abiertas, 1 con bases, 1 con cómo postular
- **INS**: `https://www.ins.gob.pe/cas/consulta_cas/index.asp`
  - Acceso: relay de Lima. Ola 1.
  - Cómo lo leemos: Consulta ASP por año y número de convocatoria.
  - Lo que limitó: No responde a Cloudflare.
  - Hoy: 33 abiertas, 2 con bases, 1 con cómo postular
- **INABIF**: `https://www.inabif.gob.pe/portalweb/convocatoria_v3.php`
  - Acceso: relay de Lima. Ola 1.
  - Cómo lo leemos: Portal de convocatorias y la página de cada proceso.
  - Lo que limitó: No responde a Cloudflare.
  - Hoy: 45 abiertas, 6 con bases, 6 con cómo postular
- **INPE**: `https://www.inpe.gob.pe/convocatorias.html`
  - Acceso: relay de Lima. Ola 2.
  - Cómo lo leemos: Lista DOCman de 60 entradas; el mismo número se repite por oficina regional, así que elige por puesto, oficina y fecha.
  - Lo que limitó: No responde a Cloudflare. Descargas sin «.pdf» (file.html).
  - Probado en Cloudflare: plaza 825059: bases, cómo postular y 10 etapas
  - Hoy: 31 abiertas, 1 con bases, 1 con cómo postular
- **Indecopi**: `https://oportunidadeslaborales.indecopi.gob.pe`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Tabla CAS (o CAP para el 728) que lleva a la publicación de gob.pe con perfil, cronograma y bases.
  - Lo que limitó: El buscador genérico sólo acertaba 3 de cada 10.
  - Hoy: 25 abiertas, 6 con bases, 4 con cómo postular
- **SMV**: `https://www.smv.gob.pe/ServicioTrabajaConNosotros/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: ASP.NET en tres pasos: abrir, buscar y «Ver detalle» de la tarjeta con el número y el régimen.
  - Lo que limitó: Descargas por GUID sin extensión. El reCAPTCHA sólo protege el formulario para postular, no la búsqueda.
  - Probado en Cloudflare: plaza 823024: 7 documentos y bases leídas
  - Hoy: 14 abiertas, 1 con bases, 0 con cómo postular
- **PGE (Procuraduría)**: `https://convocas.pge.gob.pe/`
  - Acceso: relay de Lima. Ola 2.
  - Cómo lo leemos: Servicio JSON de la lista y las bases estándar vigentes; sólo la etapa inicial (las demás son resultados).
  - Lo que limitó: No responde a Cloudflare. El PDF viene dentro del visor en base64; la descarga directa vence en minutos. SERVIR numera distinto (142 es su 143).
  - Probado en Cloudflare: plaza 820232: bases, cómo postular y 7 etapas
  - Hoy: 13 abiertas, 1 con bases, 1 con cómo postular
- **ATU**: `https://transparencia.atu.gob.pe/PTE/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: El iframe del portal de transparencia y la lista CAS por POST; sólo las columnas Bases y Requisito de conocimiento.
  - Hoy: 12 abiertas, 0 con bases, 0 con cómo postular
- **COFOPRI**: `https://convocatorias.cofopri.gob.pe/convocatoriasCas/`
  - Acceso: relay de Lima (TLS roto). Ola 2.
  - Cómo lo leemos: Tres listas (vigentes, en proceso, concluidas); el «Ver aviso» trae las bases con el perfil.
  - Lo que limitó: El servidor manda sólo su certificado (cadena incompleta).
  - Probado en Cloudflare: plaza 824378: bases, cómo postular y 8 etapas
  - Hoy: 12 abiertas, 1 con bases, 1 con cómo postular
- **SUTRAN**: `http://www2.sutran.gob.pe/portal/index.php/convocatorias-cas-sutran2`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Una tabla con todos los CAS, bases y comunicados.
  - Lo que limitó: https roto en www2: se lee por http.
  - Hoy: 11 abiertas, 5 con bases, 3 con cómo postular
- **Osinergmin**: `https://www.osinergmin.gob.pe/seccion/institucional/oportunidades-laborales/convocatorias/convocatorias-cas`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: La lista es SharePoint armado en el navegador: el perfil tiene una ruta fija por código y las bases generales salen de la página CAS.
  - Lo que limitó: Sin JavaScript no hay lista; se usa la ruta fija y, si falta, la consulta anónima de SharePoint.
  - Hoy: 10 abiertas, en cola
- **MINEM**: `https://pad2.minem.gob.pe/ConvocaMinem_Portal`
  - Acceso: relay de Lima. Ola 2.
  - Cómo lo leemos: Búsqueda por POST con el número; devuelve JSON con los enlaces de Laserfiche.
  - Lo que limitó: No responde a Cloudflare. Los enlaces llevan un token que cambia en cada consulta (se baja en el momento y se guarda la copia).
  - Probado en Cloudflare: plaza 825315: bases, cómo postular y 11 etapas
  - Hoy: 10 abiertas, 1 con bases, 1 con cómo postular
- **SENAMHI**: `https://www.senamhi.gob.pe/?p=convocatorias`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Lista por POST (año y tipo); para números repetidos («2DA CAS») toma la fecha más cercana.
  - Lo que limitó: El buscador genérico no veía nada (la lista no está en la página).
  - Hoy: 12 abiertas, 7 con bases, 6 con cómo postular
- **MINAM**: `https://www.minam.gob.pe/convocatorias/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Lista en dos páginas; segundas rondas («061-II-2026») por fecha; sólo la sección Convocatoria.
  - Hoy: 9 abiertas, 0 con bases, 0 con cómo postular
- **PromPerú**: `https://cas.promperu.gob.pe/`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: ASP.NET con postback.
  - Hoy: 11 abiertas, 5 con bases, 5 con cómo postular
- **MTPE**: `https://convocatoriasmtpe.trabajo.gob.pe/convocatorias/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: API JSON por año (`POST /convocatoriasback/api/convocatoria/lista`); el `numConvoc` es el número de SERVIR y, si no calza, se empata por cargo y fecha. La `urlBases` del JSON apunta a `apptest`; se reescribe al visor público y `bajarPdf` pide el PDF en base64 a `/convocatoriasback/api/fileconvocatorias/buscar`. Se suman los comunicados que no son resultados.
  - Lo que limitó: El PDF no se baja por GET: viene dentro de un JSON en base64. Su lista de 2026 trae 65 procesos (47 vigentes, 4 desiertos, 11 culminados y 3 cancelados).
  - Hoy: 26 abiertas; adaptador probado contra el sitio el 09/11/2026 (bases de 518 KB).
- **SERNANP**: `https://www.sernanp.gob.pe/convocatorias/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: POST a `wp-ws.php` con `tp=1&an=0` (vigentes) o `tp=2&an=<año>` (concluidas). `fn_getlist(t,a,ls,0)` devuelve las sedes; se elige la del departamento de SERVIR y `fn_getdetail(t,a,ls,dt)` devuelve los documentos. Se queda con el grupo del puesto que calza con el título y descarta `EV. CURRICULAR`, `EV. CONOCIMIENTOS`, `RESULTADO FINAL` y los resultados.
  - Lo que limitó: La respuesta es un JSON que, a su vez, trae el HTML como string JSON (doble codificación); un mismo proceso mezcla sedes y puestos. El archivo llega con un `<script>alert(2026); </script>` y la ruta del PDF delante; `bajarPdf` lo recorta.
  - Hoy: adaptador probado contra el sitio el 09/11/2026 (bases de 552 KB).
- **PRONIED**: `https://convocatorias.pronied.gob.pe:9595/casPostulacion`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: La tabla de vigentes (`/casPostulacion`) y la de «En Proceso» (`/Home/En_Proceso`). El correlativo (`0036-2026`) es el número de SERVIR; si no, se empata por puesto y fecha. Sólo se toma el enlace `Postulacion/Descargar_base?idReq=…`; los enlaces de resultados no se tocan.
  - Lo que limitó: La tabla de «En Proceso» no trae fechas y sí enlaces de resultados. Su TLS es válido y responde directo.
  - Hoy: adaptador probado contra el sitio el 09/11/2026 (bases de 476 KB).

### Salud

- **INEN**: `https://plataforma.inen.sld.pe/sistemas/CAS/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Tabla que llega en JSON (con BOM) por año; la convocatoria trae perfil y cronograma, y las bases estándar del año.
  - Lo que limitó: Nunca el archivo de la última etapa (resultados).
  - Hoy: 37 abiertas, en cola
- **HR de Ayacucho**: `https://app.hrayacucho.gob.pe/sistema`
  - Acceso: relay de Lima (TLS roto). Ola 2.
  - Cómo lo leemos: Lista y archivos del proceso por su API; sólo bases y comunicados.
  - Lo que limitó: Certificado vencido.
  - Probado en Cloudflare: plaza 824007: 5 documentos y bases leídas, sin cómo postular
  - Hoy: 25 abiertas, 1 con bases, 0 con cómo postular
- **Red de Salud Huamanga**: `https://redsaludhuamanga.pe/convocatorias/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Una tabla grande de WordPress; sólo las columnas de bases, fe de erratas y comunicados; entre dos iguales gana la no anulada.
  - Lo que limitó: La página tarda ~6 s.
  - Hoy: 60 abiertas, en cola
- **Hospital Demarini (La Merced)** **(sin confirmar)**: `https://hdemarini.gob.pe/convocatorias-2026/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Botones por convocatoria («QUINTA CONVOCATORIA 2026»), por número u ordinal.
  - Lo que limitó: Sitio con spam inyectado y bases escaneadas. El lector dijo que las bases no son de la plaza probada; no está confirmado quién tiene razón.
  - Probado en Cloudflare: plaza 823822: el lector no lo confirmó
  - Hoy: 28 abiertas, 0 con bases, 0 con cómo postular
- **HR Hermilio Valdizán (Huánuco)**: `https://www.hrhvm.gob.pe`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Lista y detalle por etapas; sólo «Base y cronograma» y el perfil del puesto exacto.
  - Hoy: 16 abiertas, en cola
- **Hospital Daniel A. Carrión (Huancayo)**: `https://hdachyo.gob.pe/index.php/gestion/convocatoria-personal`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Una fila por proceso con enlaces a Drive; el 276 es el «Concurso de provisión abierto».
  - Lo que limitó: Tres hospitales con el mismo nombre en SERVIR: sólo el de Junín.
  - Hoy: 11 abiertas, 6 con bases, 5 con cómo postular
- **Red de Salud Otuzco**: `https://www.reddesaludotuzco.gob.pe`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Una tabla por convocatoria (CAS, plazo fijo, suplencia), por su título.
  - Hoy: 10 abiertas, en cola
- **Red de Salud Huaylas Norte** **(sin confirmar)**: `https://redsaludhuaylasnorte.gob.pe/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Adaptador listo, pero su web sólo tiene los CAS 001 y 002.
  - Lo que limitó: Los procesos de las muestras no están publicados.
  - Hoy: 10 abiertas, 0 con bases, 0 con cómo postular
- **DIRESA Huánuco**: `https://sistemas.diresahuanuco.gob.pe/Api/get_convocatoria.php?tipo=CAS`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: La página se arma en el navegador; la API real se encontró mirando la red con Playwright.
  - Hoy: 10 abiertas, en cola
- **Hospital de Ventanilla**: `https://hospitaldeventanilla.gob.pe/convocatorias-cas/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Tabla PHP; sólo bases y comunicados, sin las reconsideraciones.
  - Hoy: 8 abiertas, en cola
- **Hospital Dos de Mayo**: `https://www.hdosdemayo.gob.pe/Portal/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Una página por proceso; los enlaces traen «º» como código hex y el adaptador arma la dirección.
  - Hoy: 8 abiertas, en cola
- **DIRESA Callao**: `https://www.diresacallao.gob.pe/wdiresa/portal/ConcursoPlazas/`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: Página de concurso de plazas.
  - Hoy: 23 abiertas, 1 con bases, 1 con cómo postular
- **Red de Salud Cusco Sur**: `https://www.redsaludcuscosur.gob.pe/`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: API de WordPress (entradas de la categoría convocatorias) y archivos en Drive.
  - Hoy: 18 abiertas, 1 con bases, 1 con cómo postular
- **Red de Salud Tacna**: `https://www.redsaludtacna.gob.pe/convocatorias`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: Lista de convocatorias.
  - Hoy: 16 abiertas, 8 con bases, 7 con cómo postular

### Educación

- **UGEL 07**: `https://www.ugel07.gob.pe/convocatoria-cas/`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: Dos páginas: CAS y 276. En el 276 toma la ronda vigente.
  - Lo que limitó: El «276-NN» de SERVIR no es el número del proceso (una ronda por periodo).
  - Hoy: 124 abiertas, 2 con bases, 1 con cómo postular
- **UGEL 06**: `https://convocatorias.ugel06.gob.pe/convocatorias-cas`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: Portal de convocatorias CAS y de administración de personal.
  - Lo que limitó: Igual que la UGEL 07 en el 276.
  - Hoy: 76 abiertas, 5 con bases, 2 con cómo postular
- **UGEL 03**: `http://sistemas06.ugel03.gob.pe/sigepo`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: Sistema SIGEPO.
  - Hoy: 10 abiertas, 6 con bases, 6 con cómo postular
- **UGEL 02**: `https://www.ugel02.gob.pe/proc-cont-pers-admi-276`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: La página del proceso 276 con resolución, cronograma y reporte de plazas.
  - Lo que limitó: El 276 es una ronda, no un número.
  - Hoy: 19 abiertas, en cola
- **UGEL 04**: `http://38.187.4.52/grupo-convocatorias`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Su sistema está en una IP sin dominio; trae el reporte de plazas (XLSX) y la norma.
  - Lo que limitó: Sin bases propias del proceso: sólo plazas y la norma general.
  - Hoy: 11 abiertas, 0 con bases, 0 con cómo postular
- **UGEL Tacna**: `https://www.ugeltacna.gob.pe/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: La página del proceso enlaza una carpeta de Drive (plazas, fe de erratas, cronograma).
  - Hoy: 12 abiertas, en cola
- **UGEL Santa**: `https://ugelsanta.gob.pe/noticias/contrato-administrativo`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: Noticias de contrato CAS por año.
  - Hoy: 12 abiertas, 5 con bases, 5 con cómo postular
- **DRE Áncash**: `https://web.dreancash.gob.pe/api/front/page/convocatorias`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: API del portal; elige la convocatoria por número.
  - Lo que limitó: El enlace de SERVIR (share.google) apuntaba a otro id.
  - Hoy: 23 abiertas, en cola
- **DRE Cajamarca**: `https://www.educacioncajamarca.gob.pe`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: Lista de convocatorias con fecha.
  - Hoy: 34 abiertas, 1 con bases, 1 con cómo postular
- **UNAS (Tingo María)**: `https://portalweb.unas.edu.pe`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Página por proceso con la convocatoria y los anexos en Drive.
  - Hoy: 37 abiertas, 8 con bases, 0 con cómo postular
- **UNHEVAL**: `https://convocatoria.unheval.edu.pe`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Aplicativo con bases y resolución por proceso.
  - Lo que limitó: Bases escaneadas con las páginas JPEG comprimidas de nuevo (Flate): hubo que inflarlas para leerlas.
  - Probado en Cloudflare: plaza 824601: escaneo de 18 páginas leído, cómo postular y 11 etapas
  - Hoy: 9 abiertas, 1 con bases, 1 con cómo postular
- **UNICA**: `https://www.unica.edu.pe/`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: Micrositio de convocatorias.
  - Hoy: 20 abiertas, 1 con bases, 1 con cómo postular
- **UNAH**: `https://www.gob.pe/institucion/unah/informes-publicaciones/tipos/80-convocatorias-de-trabajo`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: Su web manda a gob.pe; se lee la lista de gob.pe.
  - Hoy: 27 abiertas, 27 con bases, 26 con cómo postular
- **Colegio Militar Bolognesi**: `https://uecmfbrrhh.blogspot.com/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Blogger por su feed JSON; la convocatoria es una imagen.
  - Lo que limitó: Sin PDF: la convocatoria se publica como imagen.
  - Hoy: 16 abiertas, en cola

### Regiones y municipios

- **Gobierno Regional de Cajamarca (2 aplicativos)**: `https://convocatoriasgrc.regioncajamarca.gob.pe/`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: Aplicativo regional para sus unidades (sede, UGEL, salud).
  - Hoy: 127 abiertas, 122 con bases, 111 con cómo postular
- **Gobierno Regional de Piura**: `https://convocatorias.regionpiura.gob.pe`
  - Acceso: relay de Lima (TLS roto). Ola 1.
  - Cómo lo leemos: Aplicativo regional.
  - Lo que limitó: Cadena TLS incompleta.
  - Hoy: 47 abiertas, 23 con bases, 12 con cómo postular
- **Gobierno Regional de Amazonas**: `https://convocatorias.regionamazonas.gob.pe/`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: API de su plataforma (gorea360).
  - Hoy: 101 abiertas, 1 con bases, 1 con cómo postular
- **DRTC Ayacucho**: `https://www.drtcayacucho.gob.pe/convocatoria.html`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Página fija; los nombres de archivo traen régimen, número y año.
  - Lo que limitó: Un comentario HTML escondía la fe de erratas de otro proceso.
  - Hoy: 12 abiertas, 3 con bases, 3 con cómo postular
- **Municipalidad de La Perla**: `https://www.munilaperla.gob.pe/convocatoria-cas`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Páginas CAS y 728.
  - Lo que limitó: Un enlace dentro de un comentario HTML se tragaba el de las bases (corregido para todos los sitios).
  - Hoy: 44 abiertas, 0 con bases, 0 con cómo postular
- **Municipalidad de Pachitea**: `https://munipachitea.gob.pe`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: La lista enlaza cada proceso con número romano (/728-vi-2026/); ahí están los «Descargar».
  - Lo que limitó: Sitio lento (3 a 7 s).
  - Hoy: 8 abiertas, en cola
- **Agua Cañete (EPS)**: `https://aguacanete.com/convocatorias`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Una tabla por concurso; sólo resolución, bases, formatos y comunicado.
  - Lo que limitó: Sólo muestra el concurso actual.
  - Hoy: 31 abiertas, en cola

### Formatos comunes

- **gob.pe (cualquier institución)**: `https://www.gob.pe/busquedas.json`
  - Acceso: directo. Ola 1.
  - Cómo lo leemos: La búsqueda pública de gob.pe por institución: primero el número, luego lo más reciente, el régimen y las palabras del puesto.
  - Lo que limitó: Varias entidades enlazan a gob.pe pero publican en otro lado (MIDIS, Provías).
  - Hoy: 455 abiertas, 114 con bases, 91 con cómo postular
- **Google Drive (carpetas y archivos)** **(sin confirmar)**: `https://drive.google.com/embeddedfolderview`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: La vista embebida lista una carpeta pública sin cuenta ni JavaScript; elige la subcarpeta por número, régimen y fecha.
  - Lo que limitó: La numeración de SERVIR y la de la carpeta no siempre coinciden. Cutervo: el lector no confirmó la plaza.
  - Probado en Cloudflare: plaza 822803: el lector no lo confirmó
  - Hoy: 12 abiertas, 1 con bases, 1 con cómo postular
- **Enlaces share.google**: `https://share.google/`
  - Acceso: directo. Ola 2.
  - Cómo lo leemos: Sigue la redirección y usa el adaptador del sitio de destino.
  - Hoy: 9 abiertas, en cola

## Lo que nos limitó

Cada sitio funciona al 100 % o al 0 %: cuando falla, es por una de estas razones.

- **No responden a Cloudflare.** El Poder Judicial, MINJUS, INS, INABIF, INPE, MIDIS, PGE y MINEM cuelgan o niegan los pedidos de servidores fuera del Perú. Qué hicimos: Pasan por el relay de Lima (tu PC, con un túnel de Cloudflare; sólo dominios gob.pe).
- **Certificados rotos.** Piura y COFOPRI mandan la cadena incompleta, SUNAFIL usa un cifrado viejo, la OECE no cierra su cadena y el HR de Ayacucho tiene el certificado vencido. Qué hicimos: El relay los tolera sólo para esos dominios.
- **Captcha y desafíos anti-bots.** El Ministerio Público (Radware) y la DRELM (Cloudflare, aun desde el Perú). Qué hicimos: Nada: no se salta un captcha ni se usa una cuenta.
- **Numeración distinta a SERVIR.** En las UGEL el «276-NN» de SERVIR es un correlativo propio: una ronda 276 por periodo (RVM 175-2026-MINEDU). MINJUS y la PGE (el 142 de SERVIR es su 143) también numeran distinto. Qué hicimos: Se elige por la ronda vigente a la fecha, por título o por número más fecha.
- **Listas armadas en el navegador.** DIRESA Huánuco, Osinergmin (SharePoint), MIDIS, SENAMHI y la OECE no traen la lista en el HTML. Qué hicimos: Se encontró la API que usa la página (a veces mirando la red con Playwright) y se consulta directo.
- **Descargas raras.** La OECE sólo baja por POST; la PGE trae el PDF dentro del visor; el MINEM firma sus enlaces con un token que cambia; Provías responde en windows-1252 y como binario genérico; el INPE y la SMV no ponen «.pdf». Qué hicimos: Cada caso tiene su regla; el PDF se confirma por sus primeros bytes y se guarda copia en el momento.
- **Bases escaneadas.** Muchas bases son fotos de papel sin texto; las de UNHEVAL guardan cada página comprimida dos veces. Qué hicimos: GLM 5.3 flash las lee como imágenes (hasta 24 páginas, de a 8); las de doble compresión se inflan antes.
- **PDF enormes.** Unas bases de 47 MB del Hospital Eleazar Guzmán Barrón agotaban la memoria del Worker y trabaron la cola varias horas. Qué hicimos: Tope de 25 MB por documento y 35 MB por plaza, descarga de a una, y una plaza que tumba el Worker espera 2, 4, 8… horas.
- **HTML roto o intervenido.** Un enlace dentro de un comentario se tragaba el de las bases (La Perla); enlaces con códigos hex (Dos de Mayo); spam inyectado (Demarini, UGEL Satipo). Qué hicimos: El lector de enlaces ignora los comentarios; los adaptadores leen sólo el bloque de contenido.

## Entidades sin enlace en SERVIR

Avisos sin enlace o sólo con Facebook. Cada entidad se buscó en gob.pe (`https://www.gob.pe/busquedas.json?contenido[]=instituciones&term=<nombre>`, su «Trabaja con nosotros» y el directorio `/estado`) y en su web, y el sitio se probó con una plaza abierta.

### Ya sabemos dónde publican (29)

| Entidad | Sitio | Hoy |
|---|---|---|
| PODER JUDICIAL | `https://aplicativo.pj.gob.pe/psep/wfrmConvocatoriasV.aspx?TCon=C` | 299 abiertas, 143 con bases, 73 con cómo postular |
| MINISTERIO DE EDUCACION | `https://postulacioncas.minedu.gob.pe/PostulacionCas/Home` | 58 abiertas, 2 con bases, 2 con cómo postular |
| PROGRAMA NACIONAL CUNA MAS | `http://extranet.cunamas.gob.pe/jobs` | 54 abiertas, en cola |
| UNIVERSIDAD NACIONAL TECNOLOGICA DE LIMA SUR - UNTELS | `https://www.untels.edu.pe/` | 32 abiertas, en cola |
| HOSPITAL HUARAL Y SERVICIOS BASICOS DE SALUD | `https://www.gob.pe/hhsbs` | 32 abiertas, en cola |
| CENTRO NACIONAL DE ESTIMACION, PREVENCION Y REDUCCION DEL RIESGO DE DESASTRES (CENEPRED) | `https://www.gob.pe/cenepred` | 20 abiertas, en cola |
| SERVICIO NACIONAL DE CERTIFICACION AMBIENTAL PARA LAS INVERSIONES SOSTENIBLES (SENACE) | `https://www.senace.gob.pe/contrataciones/vigentes/` | 19 abiertas, en cola |
| UNIVERSIDAD NACIONAL AGRARIA LA MOLINA | `http://agraria.lamolina.edu.pe/oficinas/administrativas/personal/personalunalm/index.php` | 17 abiertas, 4 con bases, 0 con cómo postular |
| SUPERINTENDENCIA NACIONAL DE MIGRACIONES - MIGRACIONES | `https://www.migraciones.gob.pe/oportunidades_laborales_2026/` | 14 abiertas, 3 con bases, 0 con cómo postular |
| UNIVERSIDAD NACIONAL DE BARRANCA | `https://www.gob.pe/unab` | 13 abiertas, en cola |
| MUNICIPALIDAD PROVINCIAL DE JULCAN | `https://www.gob.pe/munijulcan` | 13 abiertas, 1 con bases, 0 con cómo postular |
| DIRECCION SUB REGIONAL DE SALUD CUTERVO | `https://drive.google.com/drive/folders/1F4KwRUessgyP_eCvGtmGHv1plEOCeWm4` | 13 abiertas, 1 con bases, 1 con cómo postular |
| HOSPITAL DANIEL ALCIDES CARRION | `https://hdachyo.gob.pe/index.php/gestion/convocatoria-personal` | 12 abiertas, 6 con bases, 5 con cómo postular |
| UNIDAD DE GESTION EDUCATIVA LOCAL DE TUMBES | `https://www.gob.pe/ugeltumbes` | 11 abiertas, en cola |
| HOSPITAL REGIONAL ELEAZAR GUZMAN BARRON | `https://hegb.gob.pe/creacion/convocatorias.php` | 10 abiertas, 2 con bases, 0 con cómo postular |
| UNIDAD DE GESTION EDUCATIVA LOCAL SAN PABLO | `https://convocatoriasgrc.regioncajamarca.gob.pe/` | 6 abiertas, en cola |
| UNIDAD EJECUTORA SALUD CAJAMARCA | `https://convocatorias.regioncajamarca.gob.pe/` | 5 abiertas, 5 con bases, 5 con cómo postular |
| DIRECCION REGIONAL DE SALUD MOQUEGUA | `https://www.gob.pe/regionmoquegua-diresa` | 4 abiertas, en cola |
| JUNTA NACIONAL DE JUSTICIA | `https://www.gob.pe/jnj` | 3 abiertas, 1 con bases, 1 con cómo postular |
| UNIDAD EJECUTORA 405 RED DE SALUD ANGARAES | `https://www.gob.pe/rsa` | 3 abiertas, en cola |
| GOBIERNO REGIONAL DE UCAYALI | `https://www.gob.pe/regionucayali` | 2 abiertas, 2 con bases, 2 con cómo postular |
| MUNICIPALIDAD DISTR DE SANTA ROSA DE S | `https://www.gob.pe/munisantarosadesacco` | 2 abiertas, en cola |
| MUNICIPALIDAD DISTRITAL J.CRESPO Y CASTI | `https://www.gob.pe/munijosecrespoycastillo` | 2 abiertas, en cola |
| GOBIERNO REGIONAL AYACUCHO | `https://www.gob.pe/regionayacucho` | 1 abiertas, en cola |
| MICRO REGION ALTO HUALLAGA | `https://www.gob.pe/regionsanmartin-gtah` | 1 abiertas, en cola |
| MUNICIPALIDAD DISTRITAL DE LA ESPERANZA | `https://www.gob.pe/munilaesperanza` | 1 abiertas, en cola |
| UNIDAD EJECUTORA 009: LA LIBERTAD | `https://ddclalibertad.gob.pe/trabaja-con-nosotros/` | 1 abiertas, 1 con bases, 1 con cómo postular |
| UNIDAD EJECUTORA EDUCACION HUANTA | `https://ugelhuanta.gob.pe/portal/index.php/nuestros-servicios/contratos/contrato-cas` | 1 abiertas, en cola |
| UNIDAD EJECUTORA 303 EDUCACION PISCO | `https://www.gob.pe/ugelpisco` | 1 abiertas, en cola |

### No publican en ninguna web (27)

| Entidad | Abiertas | Lo que encontramos |
|---|---|---|
| MINISTERIO PUBLICO-GERENCIA GENERAL | 152 | Igual que MP Cusco: portal.mpfn.gob.pe/convoca tras captcha de Radware; no se intentó. |
| UNIDAD EJECUTORA 412 SALUD VIRU | 35 | gob.pe/uesaludviru sin publicaciones; la web que figura ahí (redsaludviru.com) no tiene convocatorias (parece no oficial). La GERESA La Libertad (diresalalibertad.gob.pe/pages/convocatorias.html, datos por Apps Script) sólo lista sus propias CAS 001-004-2026, no las de Virú. |
| RED DE SALUD SANTIAGO DE CHUCO | 19 | gob.pe/rissantiagodechuco sin publicaciones; sin web propia (sólo agregadores). |
| GERENCIA SUB REGIONAL CASTROVIRREYNA | 18 | gob.pe/regionhuancavelica-gsrc: última CAS de 2025. Su 'Trabaja con nosotros' (old.regionhuancavelica.gob.pe/convocatorias) está vacío. |
| UNIDAD EJECUTORA 415 SALUD PATAZ | 14 | gob.pe/rspataz existe pero sin ninguna publicación; no se halló web propia (sólo agregadores privados). Se presenta en mesa de partes de Tayabamba. |
| MINISTERIO PUBLICO - GERENCIA ADMINISTRATIVA DEL CUSCO | 14 | Su portal (https://portal.mpfn.gob.pe/convoca/convocatorias, 'Trabaja con nosotros' de gob.pe/mpfn) está tras el desafío anti-bots de Radware (captcha) y www.mpfn.gob.pe da 403: no se intentó. gob.pe/mpfn no publica CAS. |
| GERENCIA REGIONAL DE AGRICULTURA DEL GOBIERNO REGIONAL DE AREQUIPA | 12 | gob.pe/gerencia-regional-de-agricultura-arequipa-grag existe sin publicaciones; su web www.agroarequipa.gob.pe muestra 'Sitio en mantenimiento' (2026-11-09). |
| UNIDAD DE GESTION EDUCATIVA LOCAL DE PUTUMAYO | 8 | gob.pe/ugelputumayo sin convocatorias; ugelputumayo.pe no respondió. |
| UNIDAD EJECUTORA EDUCACION CHUPACA | 8 | gob.pe/ugelchupaca sin convocatorias; ugelchupaca.edu.pe no tiene sección de convocatorias. |
| UNIDAD EJECUTORA 402 "HOSPITAL REGIONAL JOSE ALFREDO MENDOZA OLAVARRIA" JAMO II - 2 | 5 | gob.pe/hrjt sólo tiene una publicación de 2025; no se halló web propia (hospitaljamo/hrjamo sin DNS; sólo agregadores). |
| MUNICIPALID PROVINCIAL TAYACAJA | 4 | Su 'Trabaja con nosotros' (munitayacaja.gob.pe/website/oportunidad_laboral/) da 404 y /website/convocatorias no tiene procesos; gob.pe/munitayacaja sin convocatorias. |
| EMPRESA REGIONAL DE SERVICIO PUBLICO DE ELECTRICIDAD ELECTRONORTEMEDIO SOCIEDAD ANONIMA - HIDRANDINA | 3 | Régimen 728. gob.pe/hidrandina (distriluz.com.pe/hidrandina redirige ahí) no publica convocatorias de personal; no se halló portal de empleo de Distriluz. |
| UNIDAD DE GESTION EDUCATIVA LOCAL DE BOLOGNESI | 3 | No tiene institución en gob.pe. Web propia https://www.ugelbolognesi.gob.pe/convocatorias sólo lista reasignación y contrato docente 2026; ningún proceso 276 administrativo (OFICINISTA I). |
| UNIDAD EJECUTORA 304 EDUCACION PALPA | 3 | gob.pe/ugelpalpa sin publicaciones; https://ugelpalpa.gob.pe/cas/ lo último es de 2024. Sólo Facebook (UgelPalpaOficial). |
| UNIDAD EJECUTORA DENOMINADA: EDUCACIÓN PUERTO BERMÚDEZ | 3 | gob.pe/ugelpuertobermudez sin publicaciones; sin web propia. |
| MUNICIPALIDAD DISTRITAL DE ILLIMO | 2 | gob.pe/muniillimo: sólo noticias de CAS 2025; www.muniillimo.gob.pe da 404. |
| UNIDAD DE GESTION EDUCATIVA LOCAL CARLOS FERMIN FITZCARRALD | 2 | gob.pe/ugelcarlosfitzcarrald: lo último es de 2025; sin web propia. |
| UNIDAD EJECUTORA DE SALUD GRAN CHIMU | 2 | gob.pe/risgranchimu sin publicaciones (su 'Trabaja con nosotros' apunta a SERVIR); redsaludgranchimu.pe no respondió. |
| MUNICIPALIDAD PROVINCIAL DE CANDARAVE | 1 | gob.pe/municandarave sin convocatorias; su web municandarave.gob.pe no respondió. |
| DIRECCION DE SALUD VIRGEN DE COCHARCAS - CHINCHEROS | 1 | gob.pe/regionapurimac-risvirgendecocharcas sin publicaciones; sin web propia. |
| MUNICIPALIDAD DISTRITAL DE HUACHON | 1 | gob.pe/munihuachon sin convocatorias; munihuachon.gob.pe no respondió. |
| MUNICIPALIDAD DISTRITAL DE PACHAS | 1 | gob.pe/munipachas sin convocatorias; munipachas.gob.pe no existe (DNS). |
| UNIDAD DE GESTION EDUCATIVA LOCAL - CHEP EN | 1 | gob.pe/ugelchepen: lo último es de 2023 (su 'Trabaja con nosotros' es un formulario facilita.gob.pe); ugelchepen.gob.pe no respondió. |
| UNIDAD DE GESTION EDUCATIVA LOCAL DE VIRU | 1 | gob.pe/ugelviru sin publicaciones (ugelviru.gob.pe redirige ahí). |
| UNIDAD DE GESTION EDUCATIVA LOCAL Nº 16 BARRANCA | 1 | gob.pe/ugel16barranca sólo tiene 2 publicaciones de prueba ('Evento', 'Ejemplo'); ugel16barranca.gob.pe no respondió. |
| UNIDAD DE GESTION EDUCATIVA SATIPO CHANCHAMAYO | 1 | gob.pe/ugelsatipo sin publicaciones; ugelsatipo.gob.pe no tiene convocatorias y muestra enlaces de spam de apuestas ('situs toto'): parece comprometido. |
| UNIDAD DE SERVICIOS EDUCATIVOS YUNGAY | 1 | gob.pe/ugelyungay sin convocatorias; ugelyungay.gob.pe redirige a gob.pe. |

## Webs propias que van por el buscador genérico

Las de más plazas abiertas: el genérico sigue los enlaces buscando el número del proceso; donde no alcanza, son las candidatas a tener su adaptador.

| Sitio | Hoy |
|---|---|
| `www.redhuarochiri.gob.pe` | 123 abiertas, 15 con bases, 0 con cómo postular |
| `untrm.edu.pe` | 84 abiertas, en cola |
| `www.hdhuacho.gob.pe` | 32 abiertas, 8 con bases, 0 con cómo postular |
| `saludarequipa.gob.pe` | 32 abiertas, 6 con bases, 0 con cómo postular |
| `portal.muniplibre.gob.pe` | 29 abiertas, 19 con bases, 19 con cómo postular |
| `casrrhh.warminan.gob.pe` | 25 abiertas, en cola |
| `redsaludchanchamayo.com.pe` | 25 abiertas, en cola |
| `unadqtc.edu.pe` | 20 abiertas, 11 con bases, 2 con cómo postular |
| `www.pais.gob.pe` | 19 abiertas, en cola |
| `www.redsaludchepen.gob.pe` | 17 abiertas, 0 con bases, 0 con cómo postular |
| `www.lamolina.edu.pe` | 16 abiertas, 4 con bases, 0 con cómo postular |
| `www.defensoria.gob.pe` | 13 abiertas, 4 con bases, 0 con cómo postular |
| `www.migraciones.gob.pe` | 13 abiertas, 3 con bases, 0 con cómo postular |
| `www.hospitalcayetano.gob.pe` | 12 abiertas, en cola |
| `38.187.4.52` | 11 abiertas, 0 con bases, 0 con cómo postular |
| `www.agriculturacajamarca.gob.pe` | 11 abiertas, en cola |

## Bloqueados y pendientes

| Entidad | Sitio | Abiertas | Por qué no se lee |
|---|---|---|---|
| Ministerio Público (fiscalías) | `https://portal.mpfn.gob.pe/convoca/convocatorias` | 183 | Desafío anti-bots de Radware (captcha). No se intenta saltar. |
| DRELM (Lima Metropolitana) | `https://www.drelm.gob.pe` | 50 | Desafío de Cloudflare, también desde el Perú. |
| PRODUCE | `https://esiscasv2.produce.gob.pe` | 8 | Las bases sólo salen de un postback ASP.NET con la fila elegida; no hay una dirección que se pueda guardar. Posible con un descargador especial. |
| Red de Salud Chepén | `https://www.redsaludchepen.gob.pe/convocatorias/` | 17 | No publica sus CAS 2026 en la web (sólo locaciones y CAS hasta 2022). |
| UGEL Casma | `https://www.ugelcasma.gob.pe` | 10 | No publica estos procesos en una forma que se pueda leer. |

### Ya sabemos cómo leerlo, pero no se puede desde esta red

- **Cuna Más (procesos viejos)** (54 plazas): La lista sólo muestra los 10 últimos; los demás salen por un POST paginado. `http://extranet.cunamas.gob.pe/jobs`. El WAF devuelve 403 («This transfer is blocked by a Web Application Firewall») y https da timeout desde esta red; Jina Reader también queda bloqueado. Hace falta el relay de Lima o la PC del dueño para descubrir el POST con una sesión real.

MTPE, SERNANP y PRONIED ya están en la lista de sitios con adaptador (arriba).

## Las reglas de la recolección

- Sin captchas, sin cuentas y sin postular por nadie.
- Como mucho un pedido por segundo por sitio, intercalando sitios, y las lecturas grandes de madrugada.
- De los resultados (aptos, puntajes, ganadores) sólo el enlace: nunca se bajan ni se leen, porque traen nombres y DNI.
- Los modelos se usan por vigia-llm, y son sólo los abiertos de Workers AI: DeepSeek V4.1 Flash desde el 2026-11-20 (antes, GLM 5.3 flash). La segunda vía, con el PDF entero, tiene tope diario.

---

Cifras de la base de producción (`servir_convocatoria`, `servir_resumen`, `empleo_documento`) al 09/11/2026 10:26. Los adaptadores están en `backend/api/src/lib/adaptadores/` y `empleoAdaptadores.ts`; los enlaces de las entidades sin enlace, en `empleoEnlaces.ts`; el plan, en `docs/automatizacion_cas.md` (sección 10b). Los adaptadores de MTPE, SERNANP y PRONIED están en `backend/api/src/lib/adaptadores/nacionales.ts`, con pruebas en `backend/api/test/empleoAdaptadores.test.ts`.
