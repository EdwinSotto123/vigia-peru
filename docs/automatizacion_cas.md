# Automatización de CAS y prácticas: las bases y los pasos para postular

Documento de referencia para el agente que va a construir los scrapers de Gobserva Empleo. Escrito el 2026-11-08 con
datos medidos en producción (tabla `servir_convocatoria`, 8 232 plazas leídas de SERVIR desde el 2026-10-07) y con las
páginas de SERVIR abiertas ese día desde el Perú.

**Qué se pide, en una frase:** para cada convocatoria del Estado (CAS y prácticas, primero), tener **sus bases** (los
documentos, guardados por nosotros y leídos por IA) y **los pasos exactos para postular** (por dónde, con qué, en qué
formato, hasta cuándo), y avisar cuando la entidad publica algo nuevo (comunicados, cambios de cronograma, resultados).
Primero para lo que miran los usuarios que pagan.

---

## 1. Lo que tienes que saber antes de empezar

### Reglas que no se rompen

| Regla | Por qué |
|---|---|
| **Nunca guardar nombres ni DNI de postulantes.** Las listas de resultados («aptos», «ganadores») traen nombres y DNI: de ellas sólo se guarda que se publicó el resultado de tal etapa, su fecha y el enlace al documento de la entidad. Nunca el contenido. | Privacidad (ver `vigia-privacidad-datos`). El repo es público. |
| **No resolver ni saltar captchas.** El Ministerio Público (`portal.mpfn.gob.pe`, 350 plazas) tiene captcha: queda fuera, con su enlace. | Decisión del dueño. |
| **No postular por nadie ni usar credenciales de usuarios.** Gobserva informa y guía; postular es siempre en la entidad. | Decisión del dueño. |
| **Sin secretos en el código.** El repo es público (a GitHub sólo por `publicar_github.sh`). | Seguridad. |
| **Los modelos van por el Worker `vigia-llm` (ruta `/nativo`), modelo «respaldo» = Haiku 5.5.** Nunca Bedrock. | Costo y arquitectura. |
| **SERVIR sólo responde a IP del Perú** (Imperva: 403 desde Cloudflare y desde Zúrich). Se sale por el relay de Lima (`pedirLima` en `backend/scrapers-worker/src/http.ts`) o desde la PC del dueño (`backend/scrapers-pc`). Varias webs de entidades bloquean a Cloudflare también (Poder Judicial, DRELM): mismo camino. | Medido. |
| **Cortesía con cada sitio:** 1 pedido por segundo por dominio como máximo, de madrugada para las lecturas grandes, con el `UA` de `http.ts` (sin correos personales). Cachear y no volver a bajar un PDF cuyo hash ya tenemos. | Son webs chicas del Estado. |
| **Migraciones primero en DEV y después en PROD.** Despliegue por GitLab (`deploy:*`); no empujar otro commit mientras corre un pipeline. `git add` con rutas explícitas. | Flujo del repo. |

### Lo que ya existe (no lo rehagas)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Scraper de SERVIR «Ofertas laborales» | `backend/scrapers-worker/src/fuentes/servir_convocatorias.ts` (respaldo: `backend/scripts/cargar_servir_convocatorias.py`) | JSF + PrimeFaces con sesión y ViewState, paginador por «Sig.», detalle por «¡Ver más!». Diario incremental (huella de la fila), completo los jueves. Escribe `servir_convocatoria` (migr. 93). |
| Buscador de bases | `backend/api/src/lib/basesPlaza.ts` (`buscarBases`) | Abre `detalle_url`, busca el enlace del proceso por su número («…-108» = «CAS N° 108»), entra a la página del proceso y toma sus PDF. Recorre las hojas de las colecciones de gob.pe. Hasta 9 pedidos. |
| Lector de bases | `basesPlaza.ts` (`leerBases`) + `resumenPlaza.ts` | Haiku lee los PDF con herramienta forzada: `corresponde`, funciones, requisitos extra, cronograma, evaluación, documentos, cómo postular, condiciones y «ojo» (lo que deja fuera). |
| Caché de bases y lecturas | tabla `servir_resumen` (migr. 270): `bases jsonb`, `bases_estado` (`encontradas`, `no_encontradas`, `error`), `bases_at` | Hoy se llena **sólo cuando alguien abre la ficha** (a pedido). |
| Copias de documentos | R2, servidas en `GET /v1/empleo/bases/:clave` (24 hex) | El visor de la ficha muestra el PDF desde nuestra copia. |
| Ficha en la app | `frontend/components/empleo/` (`LasBases`, `QueHacer`, `usePlaza`, `BarraPlaza`) | Muestra documentos, cronograma, «Aquí postulas», documentos para marcar. |

---

## 2. Qué publica el Estado y dónde

### Los regímenes y modalidades

| Régimen o modalidad | Norma | Dónde se publica | En nuestra base |
|---|---|---|---|
| **CAS** (contrato administrativo de servicios) | D. Leg. 1057, Ley 31131 | Talento Perú «Ofertas laborales» + web de la entidad | 6 467 plazas en 90 días, 510 entidades |
| **Carrera administrativa** | D. Leg. 276 | Talento Perú «Ofertas laborales» + web de la entidad | 1 190 plazas, 135 entidades |
| **Régimen privado en el Estado** | D. Leg. 728 | Talento Perú «Ofertas laborales» + web | 462 plazas, 59 entidades |
| **Servicio civil** | Ley 30057 | Talento Perú | 15 plazas, 2 entidades |
| Jueces, docentes universitarios, profesionales de la salud | Leyes 29277, 30220, 23536 | Talento Perú + web | 98 plazas, 9 entidades |
| **Prácticas preprofesionales y profesionales** | D. Leg. 1401, reglamento D.S. 083-2019-PCM; Ley 31396 (cuentan como experiencia) | Talento Perú **«Modalidades formativas»** + web de la entidad | **0: no lo leemos** |
| Contratación directa (urgencias, sobre todo salud) | D. Leg. 1057 | Talento Perú «Contratación directa» (trae «Datos adjuntos») | No lo leemos (el 08-11 mostraba avisos de 2021) |
| Cooperación laboral | — | Talento Perú «Cooperación laboral» | Vacío el 08-11 |
| SECIGRA Derecho (servicio civil de graduandos) | D.S. 001-2018-JUS | MINJUS (gob.pe/minjus), por universidad | Fase posterior |
| SERUMS, residentado, docentes de EBR (PUN) | Normas del MINSA y MINEDU | Plataformas propias del MINSA y MINEDU | Fase posterior |

El reglamento del D. Leg. 1401 manda publicar la convocatoria de prácticas en la plataforma de SERVIR **y** en el portal
institucional de la entidad. Las bases de prácticas siguen el mismo patrón que las de CAS (ejemplos públicos: ITP
`www.itp.gob.pe/archivos/practicas/<año>/PRA-<n>-<año>-ITP-BASE.pdf`, SBN, MINSA OGGRH, UGEL 06
`convocatorias.ugel06.gob.pe/practicante/`).

### Talento Perú: los cuatro listados

Todos en `https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/<listado>.xhtml`, misma tecnología (JSF +
PrimeFaces 5.3, 10 por página, «¡Ver más!» abre el detalle, cada aviso trae «Convocatoria en Word»). Medido el
2026-11-08:

| Listado | Formulario | Páginas | Qué trae | Estado en Gobserva |
|---|---|---|---|---|
| `ofertas_laborales` | `frmLstOfertsLabo` | 335 | CAS, 276, 728 y otros | **Ya se lee** a diario |
| `modalidades_formativas` | `frmLstModFormativas` | 10 (~100 abiertas) | «Tipo de modalidad: Prácticas profesionales / preprofesionales», número, vacantes, ubicación, fechas | **Falta: prioridad 1** |
| `contratacion_directa` | `frmLstOfertsLabo` (+ `frmAdjuntos`) | 22 | Plazas con «Datos adjuntos» | Falta; revisar si hay vigentes |
| `cooperacion_laboral` | `frmLstOfertsLabo` | 0 | — | Vigilar |

El lado de la entidad es `talentoentidad.servir.gob.pe` (registro de ofertas). No se usa.

---

## 3. El inventario medido (2026-11-08)

### Cuánto hay

- **8 232 plazas** en `servir_convocatoria` (publicadas del 2026-10-07 al 2026-11-06), **3 365 abiertas**, **585 entidades**.
- Sólo **210 de 585 entidades** traen RUC en SERVIR. Para las demás, el agente tiene que resolver el RUC (por nombre
  contra `oece_entidades`/`entidades` o el padrón de la SUNAT) para empatarlas con su web y con gob.pe.

### Quién publica (90 días)

| Tipo de entidad | Plazas | Entidades |
|---|---|---|
| Salud (hospitales, redes, DIRIS, DIRESA) | 1 272 | 66 |
| Otras (sin clasificar por nombre) | 1 213 | 106 |
| Justicia (Poder Judicial, cortes, Ministerio Público) | 904 | 11 |
| Educación (UGEL, DRE) | 899 | 105 |
| Ministerios | 893 | 22 |
| Gobiernos regionales (sede, gerencias, direcciones) | 745 | 60 |
| Organismos (técnicos, reguladores, autónomos) | 721 | 59 |
| Municipalidades | 683 | 104 |
| Universidades | 559 | 25 |
| Programas y proyectos (Cuna Más, Juntos, PAE, INABIF…) | 300 | 22 |
| Empresas del Estado | 43 | 5 |

Las que más publican: Poder Judicial (647), Ministerio Público (304), MINJUS (144), UGEL 07 (133), Red de Salud
Huarochirí (123), DIRESA Cajamarca (103), FAP (101), UGEL 06 (101), MINEDU (100), MIMP (100).

Por región: Lima 3 370, La Libertad 546, Huánuco 452, Cusco 386, Cajamarca 347, Junín 323, Áncash 301; el resto, menos
de 250 cada una.

### A dónde enlaza SERVIR (`detalle_url`, 90 días)

| Clase de enlace | Plazas | Entidades |
|---|---|---|
| Web propia `.gob.pe` | 4 815 | 262 |
| **gob.pe** (plataforma única del Estado) | 1 303 | 134 |
| **Sin enlace** | 920 | 117 |
| Otra web (Facebook 413 plazas de 66 entidades; Google Drive 53 de 10; blogspot; IP sueltas) | 707 | 96 |
| Universidad `.edu.pe` | 395 | 27 |
| SERVIR (la entidad no tiene web) | 92 | 5 |

**Concentración** (entre las plazas con enlace que no es Facebook): la fuente más grande cubre el 19 %; las 5 primeras,
el 40 %; las 10, el 47 %; las 20, el 57 %; las **30, el 63 %**; las 50, el 73 %; las **100, el 87 %**; las 200, el 98 %.
Hay 292 fuentes distintas. Conclusión: **un adaptador genérico para gob.pe + ~30 adaptadores bien hechos cubren dos
tercios**; con un adaptador genérico de «lista HTML con PDF» se llega a la cola larga.

### Cuánto encontramos hoy

El buscador de bases sólo corre a pedido: hasta hoy se intentó en **9 plazas**, con 4 encontradas (2 del Poder Judicial
y 2 de gob.pe). **No hay medición real de cobertura**: es lo primero que hay que hacer (fase 1).

---

## 4. Las familias de sitios (un adaptador por familia)

Clasifica cada fuente en una familia. El adaptador de la familia hace el trabajo; los específicos sólo cuando el sitio
es grande y raro.

### A. gob.pe (134 entidades, 1 303 plazas): adaptador genérico, prioridad 1

Rutas que aparecen en `detalle_url`:

| Ruta | Plazas | Cómo leerla |
|---|---|---|
| `/institucion/<slug>/colecciones/<id>-<nombre>` | 406 | Una colección con hojas (`?sheet=2…`); cada ítem es una publicación con sus PDF. Ya lo hace `buscarBases`. |
| `/institucion/<slug>/informes-publicaciones[/<id>-<nombre>]` | 307 | Lista de publicaciones; filtrar por el número del proceso; la publicación trae los PDF (`cdn.www.gob.pe/uploads/document/file/...`). |
| `/<id>-<nombre>` (páginas de servicio o campaña, p. ej. `gob.pe/35478-postular-a-las-oportunidades-laborales-de-provias`) | 144 | **Son la mejor fuente de PASOS**: páginas de trámite con «¿Qué necesitas?», «Pasos», «Canales». Guardarlas como guía de la entidad. |
| `/<slug>` sola (`gob.pe/dirislimanorte`, `/mincetur`, `/vivienda`, `/mef`…) | ~250 | La portada de la institución: buscar su colección de convocatorias (enlaces que digan «convocatoria», «CAS», «prácticas», «proceso de selección»). |
| `/es/i/<id>`, `/es/o/<id>` | 30 | Enlaces cortos: seguir la redirección. |

Slugs con más plazas: `mimp` (100), `fap` (57), `regioncusco` (55), `sunarp` (45), `unicanete` (44),
`ugelsanjuandemiraflores` (37), `ogess402-hc` (37), `pae` (29), `cenepred` (19), `hrlambayeque` (16).

Para entidades sin enlace o con Facebook: buscar su institución en gob.pe por nombre (gob.pe tiene directorio de
instituciones) y usar su colección de convocatorias. Muchas UGEL, redes de salud y municipalidades la tienen aunque
SERVIR enlace a Facebook.

### B. Aplicativos propios (formularios, JSF, ASPX): adaptadores específicos

| Fuente | Plazas | Entidades | Nota |
|---|---|---|---|
| `aplicativo.pj.gob.pe/psep/wfrmConvocatoriasV.aspx?TCon=C` | 815 | 7 (Poder Judicial y sus cortes) | ASP.NET WebForms (ViewState). Bloquea a Cloudflare: salir por Lima. Una fuente, siete entidades. `buscarBases` ya encontró 2 de 4. |
| `portal.mpfn.gob.pe/convoca/convocatorias` | 350 | 6 | **Captcha: fuera.** Sólo enlace. |
| `convocatoria.minjus.gob.pe/convocatoria/public/index.xhtml` | 143 | 1 | JSF. |
| `postulacioncas.minedu.gob.pe/PostulacionCas/Home` | 77 | 1 | Aplicativo de postulación con registro. Tiene manual del postulante. |
| `convocatorias.minsa.gob.pe/convocatorias` | 44 | 1 | |
| `caspublico.oece.gob.pe` | 57 | 1 | |
| `convocatoria.juntos.gob.pe/Convocatoria/Lista` | 39 | 1 | |
| `app.inia.gob.pe/convocatorias/` | 35 | 1 | |
| `convocatoria.fmp.gob.pe` | 35 | 1 | Fuero Militar Policial. |
| `aplicativosweb2.sunafil.gob.pe` | 34 | 1 | |
| `digpe.fap.mil.pe/seleccion_personal/meritos` | 42 | 1 | |
| `oportunidadeslaborales.indecopi.gob.pe` | 28 | 1 | Indecopi también publica muchas prácticas. |
| `convocatorias.itp.gob.pe`, `convocatorias.cultura.gob.pe`, `convocatorias.cofopri.gob.pe`, `esiscasv2.produce.gob.pe`, `pad2.minem.gob.pe`, `app.hrayacucho.gob.pe` | 20 a 23 cada una | 1 cada una | |

### C. Plataformas regionales con varias entidades: alto rendimiento

Un adaptador cubre varias entidades del mismo gobierno regional:

| Fuente | Entidades | Plazas | Cuáles |
|---|---|---|---|
| `convocatorias.regionpiura.gob.pe/<entidad>` | 7 | 83 | DRE Piura, DIRESA Piura, Hospital de Chulucanas, UGEL Chulucanas, Sullana, Huarmaca, UE 403 Morropón |
| `convocatoriasgrc.regioncajamarca.gob.pe` | 4 | 132 | DIRESA Cajamarca, Hospital Jaén, UE Salud Santa Cruz y San Ignacio |
| `convocatorias.regioncajamarca.gob.pe` | 4 | 57 | DRTC, Hospital Jaén, UE Salud Santa Cruz, UE Salud Cajamarca |
| `convocatorias.regionamazonas.gob.pe` | 3 | 38 | DIRESA, DRE Chachapoyas, Hospital de Bagua |
| `www.inpe.gob.pe/convocatorias.html` | 4 | 49 | INPE y sus oficinas regionales |
| `*.regionhuanuco.gob.pe` (`reddosdemayo`, `agricultura`) | varias | 63+ | Subdominios por entidad |

Busca más del mismo tipo: `convocatorias.region<x>.gob.pe`, `<entidad>.region<x>.gob.pe`.

### D. Webs propias con lista HTML y PDF: adaptador genérico con reglas por sitio

La cola larga (262 entidades): WordPress, PHP o HTML con una tabla o lista de procesos y enlaces a PDF. Ejemplos con
muchas plazas: `www.ugel07.gob.pe` (133), `www.redhuarochiri.gob.pe/rhuarochiri/convocatoria/cas_ano` (123),
`www.ugel06.gob.pe/portal/index.php/servicios/administracion-de-personal` (95), `www.reddesaludotuzco.gob.pe` (79),
`portal.muniplibre.gob.pe/convocatorias_laborales/` (68), `www.drelm.gob.pe/drelm/contratacion-de-personal/` (68,
bloquea a Cloudflare), `www.inabif.gob.pe/portalweb/convocatoria_v3.php` (67), `portalweb.unas.edu.pe` (56),
`portal.inen.sld.pe/cas/` (55), `www.hdhuacho.gob.pe/convocatoria.html` (45), `www.ins.gob.pe` (33),
`saludarequipa.gob.pe` (32), `transparencia.unjbg.edu.pe` (32), `www.migraciones.gob.pe` (30),
`www.invermet.gob.pe` (30), `munipachacamac.gob.pe` (28), `www.defensoria.gob.pe` (26), `portal.indeci.gob.pe` (26).

Diseño: el adaptador genérico recibe por fuente una **receta** en JSON (URL de la lista, selector o patrón de las filas,
cómo leer número y puesto, si los PDF están en la fila o en una página del proceso, paginación). El agente descubridor
propone la receta y una prueba la valida contra 3 procesos conocidos antes de activarla.

### E. Facebook (66 entidades, 413 plazas): no se scrapea

Facebook pide sesión y cambia seguido. Para estas entidades (Salud Virú y Santiago de Chuco → GERESA La Libertad,
Hospital Regional de Pucallpa, UGEL Chupaca, Bellavista, Aymaraes, Putumayo, Tayacaja…): **buscar su web o su gob.pe**
(muchas la tienen; p. ej. `munijauja.gob.pe/trabaja_nosotros.php`, `ugelpangoa.gob.pe`). Si no hay, queda «sólo
publica en Facebook» con el enlace.

### F. Archivos sueltos (Google Drive, Docs, blogspot; 10+ entidades)

Si `detalle_url` ya es un archivo (`drive.google.com/file/d/<id>`), bajarlo directo (`uc?export=download&id=<id>`).
Si es una carpeta pública, listarla. Blogspot (`uecmfbrrhh.blogspot.com`) se lee como la familia D.

### G. Sin enlace (117 entidades, 920 plazas)

Las que más: Universidad Intercultural de la Amazonía (94), Cuna Más (54), MTPE (50), Hospital Regional de Moquegua (48),
DRE Tacna (39), Hospital Hipólito Unanue de Tacna (39), UNTELS (32), La Molina (31), Hospital de Huaral (29), Red de Salud
La Convención (27), DIRESA Moquegua (26), SENACE (21). Resolver su web (RUC → gob.pe o dominio propio) con el agente
descubridor y guardarla en el registro de fuentes. Ya no dependemos de que SERVIR traiga el enlace.

### H. Bloqueadas o con captcha

Ministerio Público (captcha): fuera. Poder Judicial y DRELM bloquean a Cloudflare pero no a IP peruanas: van por el
relay. Anota en el registro cuál es cuál.

---

## 5. Qué hay que sacar

### Por convocatoria (cambia en cada proceso)

| Dato | De dónde | Ya existe |
|---|---|---|
| **Documentos**: bases, perfil o TDR, anexos (formatos de DJ), cronograma, comunicados, fe de erratas, **resultados de cada etapa** (sólo el aviso, ver reglas) | La página del proceso en la web de la entidad | Parcial (`buscarBases`) |
| Copia de cada documento en R2, con hash (para saber si cambió) | Nosotros | Sí (bases) |
| Lectura: funciones, requisitos (y los que las bases suman a SERVIR), cronograma, evaluación con puntajes, documentos a presentar, cómo postular, condiciones, lo que deja fuera | Haiku sobre los PDF | Sí (`leerBases`) |
| **Cambios**: documento nuevo, cronograma distinto, comunicado, resultado publicado | Comparar contra la lectura anterior | **No** |

### Por entidad o plataforma (casi no cambia): la guía para postular

La mitad de «los pasos» no depende del proceso sino de **cómo postula esa entidad**. Se saca una vez y se revisa cada mes:

- **Canal:** en línea con registro (MINEDU PostulacionCas, Poder Judicial PSEP, MINJUS, JUNTOS, OECE), correo
  electrónico, mesa de partes virtual, o presencial.
- **URL de la plataforma o correo de recepción** (correo institucional de la entidad, no de personas).
- **Si pide crear cuenta**, y qué datos.
- **Formato:** un solo PDF o varios, tamaño máximo, foliado, firma (manuscrita o digital), orden de los documentos,
  nombre del archivo, asunto del correo.
- **Manual del postulante** (PDF o video) si existe: bajarlo, guardarlo y resumirlo en pasos.
- **Errores que descalifican** que la entidad repite en sus bases (lo aprende el lector de varias bases de la misma
  entidad).

Las páginas de trámite de gob.pe (familia A, `/<id>-postular-a-…`) traen esto ya estructurado.

---

## 6. Arquitectura propuesta: agentes y tablas

### Tablas nuevas (proponer en una migración, DEV primero)

- **`empleo_fuente`**: una fila por sitio de convocatorias. Entidades que publica (nombres de SERVIR y RUC), dominio, URL
  de la lista, familia (A a H), adaptador y receta (jsonb), si necesita salir por Lima, estado (`activa`, `bloqueada`,
  `captcha`, `solo_facebook`, `sin_web`), último éxito, último error, plazas en 90 días.
- **`empleo_documento`**: listado y aviso (o número de proceso), fuente, URL original, título, tipo (`bases`, `perfil`,
  `anexo`, `cronograma`, `comunicado`, `fe_erratas`, `resultado`), clave en R2, hash, visto primero y visto último.
- **`empleo_guia`**: por fuente, la guía para postular (canal, URL, cuenta, formato, límites, manual, pasos en jsonb),
  con fecha y de dónde se sacó.
- **`empleo_evento`**: por convocatoria, lo que cambió (`documento_nuevo`, `cambio_cronograma`, `comunicado`,
  `resultado_etapa`), con fecha y enlace. Alimenta los avisos a quien guardó la plaza.
- **Prácticas:** agregar a `servir_convocatoria` el `listado` (`ofertas_laborales`, `modalidades_formativas`,
  `contratacion_directa`) y la `modalidad` (`cas`, `276`, `728`, `practica_pre`, `practica_pro`…), o una tabla hermana.
  **Verifica primero si los números de aviso chocan entre listados**: si chocan, la llave pasa a ser (listado, aviso).

`servir_resumen` (migr. 270) sigue guardando la lectura por aviso; `empleo_documento` y `empleo_evento` le agregan la
historia.

### Los agentes

1. **Descubridor** (una vez por entidad, y cuando falla una fuente): con el nombre y el RUC, encuentra la página de
   convocatorias (`detalle_url`, gob.pe, la web propia), la clasifica en una familia, propone la receta y la valida con 3
   procesos conocidos. Escribe `empleo_fuente`. Puede usar el modelo para entender la página, pero la receta final es
   determinística.
2. **Recolector** (diario, de madrugada): por cada fuente activa, lee la lista, empata cada proceso con su aviso de
   SERVIR (por número, puesto y fechas), baja los documentos nuevos a R2 (por hash) y escribe `empleo_documento`.
3. **Lector** (cuando hay un documento nuevo): Haiku lee bases y anexos (`leerBases`, extendido para prácticas) y, de
   los manuales y páginas de trámite, la guía de la entidad. Una lectura por PDF distinto, aunque sirva a varias plazas.
4. **Vigía de cambios** (diario, sólo plazas abiertas o guardadas): compara documentos y cronograma contra lo anterior y
   escribe `empleo_evento`. Si es un resultado, sólo la etapa, la fecha y el enlace.
5. **Supervisor** (semanal): cobertura por fuente, fuentes que dejaron de responder, recetas rotas, costo del modelo.
   Reabre al Descubridor donde haga falta.

### Dónde corre

- Worker `vigia-scrapers` (Cloudflare Workflows, crons): Talento Perú y los recolectores, saliendo por el relay de Lima
  cuando el sitio lo pide.
- La PC del dueño (`backend/scrapers-pc`): lo que no pasa por el relay o es muy pesado.
- Jobs `tarea:*` de GitLab CI (con túnel SSM): rellenos grandes.
- Lecturas por `vigia-llm` (`/nativo`, Haiku 5.5). Referencia de costo: los lectores de actas costaron ~USD 0,02 por
  documento; con bases compartidas entre plazas, calcula ~USD 0,02 a 0,04 por plaza nueva y mídelo en la fase 1.

---

## 7. Prioridad: primero para los que pagan

Tablas: `gobserva_planes_cliente` (plan vigente: `producto = 'empleo'`, `estado`, `vigente_hasta`), `gobserva_busquedas`
(«Mi perfil»: carreras, región, estudios, experiencia), `gobserva_alertas` (filtros), `gobserva_guardados` (`tipo =
'plaza'`, `ref` = aviso, etapa).

1. **Plazas guardadas por quien paga:** documentos, lectura y vigía de cambios **diarios**, con aviso por correo
   (Resend) y en la app cuando cambia algo o sale un resultado.
2. **Plazas abiertas que calzan con el perfil o las alertas de quien paga:** documentos y lectura antes de que las abra
   (de noche).
3. **Fuentes por puntaje** = plazas abiertas × (1 + pagadores con plazas que calzan ahí). Se trabajan en ese orden.
4. **Lo demás:** a pedido, como hoy, cuando alguien abre la ficha.

---

## 8. Plan por fases

| Fase | Qué | Cómo se sabe que terminó |
|---|---|---|
| **0. Prácticas en Talento Perú** (1 a 2 días) | Leer `modalidades_formativas` (y revisar `contratacion_directa`) con el mismo motor de `servir_convocatorias.ts` (cambia el formulario: `frmLstModFormativas`). Guardar modalidad (pre o profesional) y lo que traiga el detalle (carrera, ciclo, subvención). | ~100 prácticas abiertas en la base; filtro «Prácticas» en la app. |
| **1. Medir** (1 día) | Correr `buscarBases` sobre una muestra de 500 plazas abiertas (estratificada por familia), sin leer con IA. | Tabla de cobertura por familia y fuente; costo estimado de la lectura. |
| **2. gob.pe + top 10** (1 semana) | Adaptador genérico de gob.pe (todas sus rutas) y específicos del Poder Judicial, MINJUS, MINEDU, MINSA, OECE, JUNTOS, INIA, FMP, SUNAFIL y las plataformas regionales (Piura, Cajamarca ×2, Amazonas). Registro `empleo_fuente`. | ≥ 50 % de las plazas abiertas con documentos. |
| **3. Cola larga** (2 semanas) | Adaptador genérico de lista HTML con recetas; Descubridor para las 50 fuentes siguientes y para las sin enlace y de Facebook. | ≥ 75 % de las plazas abiertas con documentos; ≥ 90 % de esas con lectura. |
| **4. Guías para postular** (1 semana) | Guía por entidad de las 100 fuentes más grandes: páginas de trámite de gob.pe, manuales del postulante, lo común de sus bases. | Las 100 primeras con canal, formato y pasos. |
| **5. Vigía de cambios y resultados** (1 semana) | `empleo_evento` y avisos a quien guardó la plaza (correo por Resend, en la app y push). | Un cambio de cronograma real llega como aviso en menos de 24 h. |
| **6. Otras modalidades** | SECIGRA, SERUMS, docentes (PUN), Ley 30057 cuando crezca. | A decidir con el dueño. |

### Cómo medir (siempre)

- % de plazas abiertas con documentos, con lectura y con guía de su entidad.
- Horas entre que SERVIR publica y que tenemos las bases.
- Fuentes activas, rotas y bloqueadas.
- Costo del modelo por plaza y por mes.
- Errores de empate (bases de otro proceso): la lectura trae `corresponde`; si sube, revisar el recolector.

---

## 9. Pruebas que tiene que traer cada adaptador

- 3 procesos reales con sus documentos esperados (número, puesto, cantidad de PDF), guardados como fixtures (HTML
  limpio, sin datos personales).
- Que no baje nada dos veces (hash) y que respete 1 pedido por segundo.
- Que no guarde nombres ni DNI de listas de resultados.
- Que empate bien cuando una entidad publica varios procesos con el mismo puesto (se distinguen por número).
- En el Worker: correr con `seco` primero, como `servir_convocatorias`.

## 10. Plazas de prueba conocidas

- **822073** (MIDIS): sin bases encontradas; sirve para el caso «no encontradas» y el número para copiar.
- **824501** (UGEL 01, gob.pe): bases encontradas y leídas; postulación por MINEDU en línea el 19 de noviembre de 2026;
  9 documentos a presentar.
- Poder Judicial: las 4 plazas ya intentadas (2 encontradas, 2 no) en `servir_resumen` con `bases_estado`.

---

## 10b. Estado al 2026-11-09: los sitios que ya leemos

El recolector (`lib/empleoRecolector.ts`, cron de la madrugada y `POST /admin/empleo/recolectar`) prueba primero el
adaptador del sitio (`lib/empleoAdaptadores.ts` y `lib/adaptadores/*.ts`, 85 dominios) y, si no, el buscador genérico.
Baja hasta 3 PDF por plaza (25 MB cada uno, 35 MB por plaza), los copia a R2 y los lee GLM 5.3 flash: el texto, o las
páginas escaneadas como imágenes (también JPEG guardados con Flate). Haiku sólo de respaldo y con tope.

**Con adaptador probado** (bases de la plaza correcta, sin listas de resultados):

- **Ola 1:** el Poder Judicial; MINJUS; MINEDU (postulacioncas y www); SUNAFIL; JUNTOS; MINSA; INS; INABIF; PromPerú;
  DIRESA Callao; las Redes de Salud Cusco Sur y Tacna; UNICA; UNAH; las UGEL 03, 06, 07 y Santa; la DRE Cajamarca; y los
  Gobiernos Regionales de Cajamarca (dos aplicativos), Piura y Amazonas. gob.pe va por su búsqueda pública
  (`busquedas.json`).
- **Ola 2, salud:** INEN; los Hospitales Regionales de Ayacucho (TLS vencido, por el relay) y Hermilio Valdizán; la Red de
  Salud Huamanga; los Hospitales Demarini, Daniel A. Carrión de Huancayo, de Ventanilla y Dos de Mayo; la Red de Salud
  Otuzco; la Red Huaylas Norte; y la DIRESA Huánuco (por su API).
- **Ola 2, educación:** UNAS; DRE Áncash; UGEL 02; UGEL Tacna (Drive); UGEL 04 (por IP); UNHEVAL; y el Colegio Militar
  Bolognesi (Blogger: la convocatoria es una imagen).
- **Ola 2, nacionales:** INPE; Indecopi; SMV; PGE (el PDF viene dentro del visor); ATU; COFOPRI; SUTRAN; Osinergmin;
  MINEM (Laserfiche); SENAMHI; MINAM.
- **Ola 2, especiales:**
  - carpetas y archivos de Google Drive (`embeddedfolderview`) y los enlaces `share.google`;
  - la OECE (descarga por POST: `…#post`);
  - el MIDIS y Provías Nacional, detectados por el nombre de la entidad;
  - Agua Cañete, DRTC Ayacucho, Municipalidad de La Perla y Municipalidad de Pachitea.
- **Por el relay de Lima** (no responden a Cloudflare o tienen el TLS roto): Poder Judicial, MINJUS, INS, INABIF, SUNAFIL,
  Gobierno Regional de Piura, OECE, COFOPRI, HR Ayacucho, INPE, MIDIS, PGE y MINEM.

**Entidades sin enlace o sólo con Facebook:** `lib/empleoEnlaces.ts` dice dónde publican 29 de ellas, probadas una por
una. Por ejemplo Cuna Más, UNTELS, SENACE, la JNJ, Migraciones, La Molina y varias UGEL y municipalidades en gob.pe. Para
hallar el slug de gob.pe de una institución: `busquedas.json?contenido[]=instituciones&term=<nombre>`, y su «Trabaja con
nosotros» lleva a su portal.

**Falta (por valor):**

1. **Ministerio Público** (`portal.mpfn.gob.pe`, unas 180 plazas): tiene un captcha de Radware. No se salta.
2. **DRELM:** un desafío de Cloudflare, también desde el Perú.
3. **MTPE:** API JSON pública; el PDF llega en base64.
4. **PRODUCE:** el PDF sólo sale de un postback ASP.NET con la fila elegida.
5. **SERNANP y PRONIED:** listas por POST.
6. **Cuna Más:** los procesos viejos salen por un POST paginado.
7. **Sin nada en línea:** unas 27 entidades que sólo usan Facebook o tienen la web caída. Ejemplos: UE 412 Salud Virú,
   la RIS Santiago de Chuco y la GSR Castrovirreyna.
8. **Sitios que el lector no confirma:** Demarini (la suplencia de SERVIR no calza con la web) y la carpeta de Drive de
   Cutervo (la plaza es un centro de salud que no sale en las primeras 24 páginas).
9. **Red de Salud Chepén y UGEL Casma:** no publican estos procesos en su web.

**Plazas de prueba de la ola 2** (desde Cloudflare, el 2026-11-09):

| Plaza | Entidad | Lo que se obtuvo |
|---|---|---|
| 825059 | INPE | bases, cómo postular y 10 etapas |
| 824710 | OECE | bases y perfil por POST, cómo postular y 8 etapas |
| 824338 | MIDIS | bases, cómo postular y 8 etapas |
| 825137 | Provías | bases, cómo postular y 12 etapas |
| 820232 | PGE | bases, cómo postular y 7 etapas |
| 825315 | MINEM | bases, cómo postular y 11 etapas |
| 824601 | UNHEVAL | escaneo de 18 páginas leído como imágenes, con 11 etapas |
| 824378 | COFOPRI | bases y cronograma |

---

## 11. Fuentes consultadas

- SERVIR, Talento Perú: `app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/` (los cuatro listados, abiertos desde
  el Perú el 2026-11-08).
- [Talento Perú: ofertas de trabajo y prácticas en el Estado (gob.pe)](https://www.gob.pe/institucion/servir/campa%C3%B1as/4782-talento-peru)
- [Acceder a la bolsa de trabajo y prácticas en el Estado (gob.pe)](https://www.gob.pe/10009-acceder-a-la-bolsa-de-trabajo-y-practicas-en-el-estado)
- [D. Leg. 1401 (gob.pe)](https://cdn.www.gob.pe/uploads/document/file/8191721/6850253-dl-1401.pdf) y su reglamento, D.S. 083-2019-PCM.
- [SERVIR, informe técnico 1993-2019 sobre la convocatoria de prácticas](https://cdn.www.gob.pe/uploads/document/file/5684622/5048083-informe-tecnico-1993-2019-servir-gpgsc.pdf)
- [SERVIR: procesos de prácticas profesionales y preprofesionales vigentes](https://www.gob.pe/institucion/servir/colecciones/34972-procesos-de-seleccion-para-practicas-profesionales-y-preprofesionales-vigentes)
- [SECIGRA Derecho 2027 (El Peruano)](https://elperuano.pe/noticia/307820-secigra-derecho-2027-establecen-dos-periodos-de-servicio-y-un-estipendio-minimo-equivalente-a-la-rmv)
- Datos propios: `servir_convocatoria` y `servir_resumen` en producción, consultados el 2026-11-08.

**Por confirmar:** el plazo mínimo legal de publicación en Talento Perú (Ley 31131 y normas de SERVIR) y si los avisos de
`modalidades_formativas` comparten numeración con los de `ofertas_laborales`.
