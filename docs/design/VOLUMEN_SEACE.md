# Volumen real del SEACE — medición, extrapolación y costo de almacenamiento

> Estado: **medido el 2026-09-15** desde IP peruana con `python -m backend.batch.muestreo`.
> Datos crudos: [`volumen_muestra.json`](volumen_muestra.json) (302 records, 1 157 documentos
> con tamaño, 27 meses contados página a página). Todo lo que no salió de una medición está
> marcado **[extrapolación]** y dice cómo se calculó. Precios de GCS verificados el mismo día.

Comando ejecutado (tres corridas sobre el mismo JSON, `--reanudar`):

```
python -m backend.batch.muestreo --records 300 --docs-por-record 6 --anios 2019,2022,2025 --salida docs/design/volumen_muestra.json
python -m backend.batch.muestreo --sin-records --anios 2019,2022,2025,2026 --salida … --reanudar            # + año en curso
python -m backend.batch.muestreo --sin-conteos --remedir --salida … --reanudar                              # re-medir docs (ver §7)
python -m backend.batch.muestreo --sin-records --sin-sonda --anios 2008,…,2024 --meses 5 --salida <aparte>  # mayo de cada año restante, fusionado
```

---

## 1. Qué tiene la API y desde cuándo

| Hecho | Valor medido | Cómo |
|---|---|---|
| Primer mes con releases | **2008-08** | sonda año a año y luego mes a mes con `size=1` (`primer_mes_con_datos`) |
| Prefijo de OCID | `ocds-dgv273-seacev2-<n>` hasta 2013 · `ocds-dgv273-seacev3-<n>` desde 2014 · `ocds-dgv273-seacev3-<año>-<n>-<m>` mezclado desde 2020 | records de mayo 2010–2024 |
| Filtro `startDate/endDate` | por `tender.tenderPeriod.startDate`; devuelve **todas las versiones** (releases) del proceso, no solo la del mes | inspección de 500 releases de 2025-05: 98 ocids, fechas de release 2025-09 → 2026-03 |
| Tamaño de página (`size=100`) | 0.5–0.9 MB · **~7 KB por release** crudo, ~0.3–0.6 KB gzip | 3 páginas medidas |
| `/record/<ocid>` | 6–9 KB los pequeños; ver §3 | — |
| Velocidad | `/releasesAfter`: 0.2–0.9 s/página (0.4 s típico); `/record`: ~0.1 s | log de la corrida |
| Bloqueos | La API OCDS (`contratacionesabiertas.oece.gob.pe`) no devolvió ningún 429/5xx en ~6 000 páginas. **Los documentos** (`prod1.seace.gob.pe`) devuelven **403 tras ~50 requests en ráfaga** (3 hilos); a 1 request/1.2 s serial aguantó 1 100 sin cortar | §7 |
| Hosts de documentos | `prod1.seace.gob.pe/SeaceWeb-PRO/SdescargarArchivoAlfresco` (da `Content-Length` en HEAD) · `prod4.seace.gob.pe:9000/api/con/documentos/descargar/<id>` (contratos; **chunked, sin `Content-Length`**, hay que leer el cuerpo) · `objectstorage.us-ashburn-1.oraclecloud.com` (docs de SEACE v2 y parte de 2014–2018; no medido) | records 2010–2026 |

---

## 2. Conteos por año (medidos) y extrapolación

Para 2019, 2022, 2025 y 2026 se contaron **tres meses completos** (enero, mayo, septiembre)
siguiendo el cursor `links.next` hasta el final. Para el resto de años, **solo mayo**. `ocids` =
procesos únicos; `releases` = versiones (un proceso aparece una vez por cada republicación).

| Año | Meses medidos (ocids únicos) | ocids/año **[extrapolación: media mensual × 12]** | ocids/año **[extrapolación ajustada]** ¹ | releases/año **[extrapolación]** | releases / ocid (medido) |
|---|---|---|---|---|---|
| 2008 | may: **0** (la API empieza en 2008-08) | — | — | — | — |
| 2009 | may 11 881 | 142 572 | 101 465 | 142 572 | 1.00 |
| 2010 | may 12 111 | 145 332 | 103 429 | 145 332 | 1.00 |
| 2011 | may 9 053 | 108 636 | 77 313 | 108 636 | 1.00 |
| 2012 | may 13 892 | 166 704 | 118 639 | 166 704 | 1.00 |
| 2013 | may 15 136 | 181 632 | 129 263 | 181 692 | 1.00 |
| 2014 | may 11 519 | 138 228 | 98 373 | 180 444 | 1.31 |
| 2015 | may 10 361 | 124 332 | 88 484 | 393 300 | 3.16 |
| 2016 | may 5 450 | 65 400 | 46 544 | 133 752 | 2.05 |
| 2017 | may 5 450 | 65 400 | 46 544 | 132 588 | 2.03 |
| 2018 | may 4 961 | 59 532 | 42 367 | 119 904 | 2.01 |
| **2019** | ene 587 · may 5 829 · sep 6 335 | **51 004** | 51 004 | 103 528 | 2.03 |
| 2020 | may 1 233 (pandemia) | 14 796 | 10 530 | 59 652 | 4.03 |
| 2021 | may 5 053 | 60 636 | 43 153 | 128 412 | 2.12 |
| **2022** | ene 1 211 · may 8 190 · sep 7 655 | **68 224** | 68 224 | 177 792 | 2.61 |
| 2023 | may 7 465 | 89 580 | 63 752 | 297 264 | 3.32 |
| 2024 | may 8 143 | 97 716 | 69 542 | 994 320 | 10.18 |
| **2025** | ene 1 247 · may 3 475 · sep 7 483 | **48 820** | 48 820 | 829 980 | 17.0 |
| **2026** (hasta 15-sep) | ene 940 · may 7 212 · sep (1–15) 2 550 | 42 808 ² | 42 808 | 592 832 | 13.9 ³ |
| **Total histórico 2008-08 → 2026-09** | | **≈ 1.67 M ocids** | **≈ 1.25 M ocids** | **≈ 4.9 M releases** | |

¹ Enero es sistemáticamente bajo (10–15 % de mayo en 2019, 2022 y 2026; 36 % en 2025, cuyo mayo fue
atípicamente bajo): cierre/apertura del año fiscal. En 2019 y 2022 la media de (ene, may, sep) fue 0.73 y 0.69 de mayo → factor **0.712**
aplicado a los años en que solo se midió mayo. Es una corrección, no una medición: el rango honesto
para el histórico es **1.25–1.67 M procesos**.
² 2026 tiene septiembre a medias (15 días) y la extrapolación mecánica lo trata como mes completo, así
que subestima. Cruce con la DB: el backfill de 90 días (15-jun → 14-sep 2026) cargó **18 413** ocids =
6 138/mes, coherente con mayo (7 212) y con sep-parcial (2 550 en 15 días ≈ 5 100/mes).
³ El ratio releases/ocid **crece con la edad del proceso** (se republica el mismo release casi a
diario mientras está vigente: ocid 1170398 tiene un release por día entre dic-2025 y ene-2026 con el
mismo `tag`). En los 302 records de 2026 muestreados: **p50 12, p90 23, máx 47 releases por ocid**.
Los records de 2009–2013 (SEACE v2) tienen exactamente 1.

Consecuencia operativa: **descargar el histórico por `/releasesAfter` cuesta ~4.9 M releases ≈ 49 000
páginas ≈ 6 h** [extrapolación: 0.45 s/página]; pero como cada `/record` ya trae el `compiledRelease`
**y la lista de releases**, el camino barato es `releasesAfter` solo para descubrir ocids y luego
`/record` una vez por ocid: **1.25–1.67 M requests × ~0.1–0.2 s ≈ 35–90 h serial** [extrapolación],
9–23 h con 4 hilos (la API OCDS no limitó a 1 request cada ~0.25 s sostenido; no se probó más).

---

## 3. Tamaño del record JSON (`/record/<ocid>`)

Muestra principal: **302 records** de `convocatorias` (todos convocados jun–sep 2026), estratificados
por `categoria` proporcional a la DB (goods 130 · services 117 · works 55). Bytes del JSON completo:

| | n | p50 | p90 | media | máx |
|---|---|---|---|---|---|
| **Todos** | 302 | **12.5 KB** | 22.6 KB | 13.8 KB | 39.1 KB |
| goods | 130 | 12.3 KB | 18.6 KB | 12.9 KB | 34.8 KB |
| services | 117 | 13.2 KB | 24.0 KB | 14.8 KB | 39.1 KB |
| works | 55 | 13.8 KB | 22.3 KB | 13.8 KB | 28.4 KB |

Muestra histórica (25 records de mayo de cada año, sin HEAD; `muestra_historica` en el JSON):

| Año | records | bytes media | docs/record media | records sin docs | releases/record | gzip |
|---|---|---|---|---|---|---|
| 2010 (v2) | 25 | 7.3 KB | 3.9 | 10 / 25 | 1.0 | 0.29 |
| 2012 (v2) | 25 | 7.5 KB | 3.0 | 11 / 25 | 1.0 | 0.29 |
| 2014 | 25 | 8.2 KB | 5.0 | 0 | 2.6 | 0.29 |
| 2016 | 17 | 23.0 KB | 8.7 | 0 | 6.4 | 0.20 |
| 2018 | 25 | 18.2 KB | 6.3 | 0 | 2.2 | 0.25 |
| 2020 | 25 | 15.4 KB | 7.5 | 0 | 3.9 | 0.24 |
| 2023 | 10 | 19.2 KB | 10.4 | 0 | 10.1 | 0.22 |
| 2024 | 8 | 21.6 KB | 9.9 | 0 | 18.9 | 0.19 |

Lectura: los records **maduros** (con award, contrato y adendas) pesan 15–23 KB y listan 6–10
documentos; los de 2026 son jóvenes (4 docs). **gzip comprime el JSON a 0.19–0.29** (3.5–5×).

---

## 4. Documentos: cuántos y cuánto pesan

**Cuántos** (302 records de 2026; se listan todos, se midieron hasta 6 por record):

| | p50 | p90 | media | máx |
|---|---|---|---|---|
| Documentos por record | **4** | 8 | 4.25 | 24 |
| · goods / services / works | 3 / 5 / 3 | 7 / 8 / 8 | 3.8 / 4.7 / 4.4 | 14 / 24 / 10 |
| Solo tipos clave (`biddingDocuments`+`awardNotice`+`contractSigned`) | **3** | 5 | 3.04 | 13 |

Por `documentType` (1 284 listados): biddingDocuments 633 (2.12 por record: bases + bases integradas),
awardNotice 178, clarifications 173, evaluationReports 164, contractSigned 99, contractAnnexe 15,
sin tipo 8. Formato: **pdf 712 · zip 483 · docx 47 · rar 28**. 150 de 302 tenían awards, 83 contracts.

**Cuánto pesan** (1 157 documentos medidos por `Content-Length` de HEAD —1 119— o leyendo el cuerpo
chunked de `prod4` —38—; 127 quedaron fuera del tope de 6 por record):

| | n | p50 | p90 | media | máx |
|---|---|---|---|---|---|
| **Todos** | 1 157 | **1.45 MB** | **13.3 MB** | **5.60 MB** | 182 MB |
| biddingDocuments | 629 | 2.98 MB | 23.3 MB | 8.42 MB | 182 MB (pdf) |
| evaluationReports | 157 | 1.92 MB | 10.5 MB | 4.68 MB | 84 MB |
| awardNotice | 157 | 0.93 MB | 5.25 MB | 2.24 MB | 42 MB |
| contractSigned | 37 | 1.09 MB | 5.71 MB | 2.16 MB | 10.3 MB |
| clarifications | 170 | 22 KB | 73 KB | 36 KB | 464 KB |
| pdf | 627 | 1.85 MB | 13.9 MB | 5.81 MB | 182 MB |
| zip | 458 | 0.80 MB | 9.95 MB | 4.19 MB | 125 MB |
| docx | 44 | 4.25 MB | 26.2 MB | 8.42 MB | 49.5 MB |
| rar | 28 | 10.3 MB | 42.3 MB | 19.7 MB | 166 MB |
| goods / services / works | 458 / 478 / 221 | 1.42 / 1.17 / 2.07 MB | 7.6 / 15.3 / 15.8 MB | 4.7 / 5.6 / 7.4 MB | |

**Bytes por contrato** (suma de sus documentos medidos, tope 6):

| | p50 | p90 | media | máx |
|---|---|---|---|---|
| Todos los docs | **10.4 MB** | 51 MB | **21.5 MB** | 219 MB |
| Solo tipos clave | 9.1 MB | 46 MB | 19.0 MB | 214 MB |
| goods / services / works (todos) | 7.4 / 12.2 / 18.5 MB | 44 / 56 / 54 MB | 16.6 / 23.0 / 29.7 MB | |

Dos cosas que cambian la política: (a) las **bases** (`biddingDocuments`) son el 82 % de los bytes;
restringirse a "tipos clave" solo ahorra ~12 % (5.73 de 6.48 GB medidos) — el ahorro real está en
**bajar bajo demanda**, no en filtrar por tipo; (b) un contrato **maduro** de 2016–2024 lista 6–10 docs,
no 4: para el histórico hay que asumir **~8.5 docs/record** [extrapolación desde la muestra histórica,
tamaño por doc asumido igual al de 2026].

---

## 5. Estimación total de almacenamiento

Convenciones: v2 = 2009–2013 (0.53–0.74 M ocids), v3 = 2014–2026 (0.72–0.93 M ocids); rango = ajustado
→ mecánico de §2. 1 GiB = 2³⁰ B. **Todo esta sección es [extrapolación] sobre las medidas de §2–§4.**

| # | Qué | Cálculo | Tamaño |
|---|---|---|---|
| 1a | Metadata: un `/record` por ocid, JSON crudo | 1.25–1.67 M × ~14 KB (v2 7 KB, v3 maduro 18 KB) | **17–23 GB** |
| 1b | Ídem gzip (×0.25) o Parquet | | **4–6 GB** |
| 1c | Metadata en Postgres (`convocatorias` hoy: 68 MB / 18 413 filas = 3.7 KB/fila con índices y `ocds_payload`) | 1.25–1.67 M × 3.7 KB | **4.6–6.2 GB** |
| 2 | Todos los documentos, todo el histórico | v3: 0.72–0.93 M × 8.5 docs × 5.6 MB = **34–44 TB**; v2: 0.53–0.74 M × 3.5 × 5.6 MB = 10–15 TB (tamaño v2 **no medido**, están en Oracle Cloud) | **44–59 TB** |
| 3 | Solo `biddingDocuments`+`awardNotice`+`contractSigned`, todo el histórico | 0.88 × v3 | **30–39 TB** (+ v2 9–13 TB) |
| 4 | Versiones (releases crudos) | 4.9 M × 7 KB crudo / ×0.5 KB gzip | **34 GB crudo · ~2.5 GB gzip**; y no hace falta guardarlas: el `/record` ya trae la lista |
| 5 | Derivados por contrato analizado (medido en Cloud SQL, 2026-09-15) | `alertas.analisis_full` JSONB: n=56, **media 169 KB**, p50 140 KB, p90 307 KB, máx 710 KB · `dictamen_markdown`: media 30.5 KB, máx 123 KB · `banderas`: 2.6 por alerta · `documentos.texto_extraido`: **NULL en las 274 filas** (hoy no se persiste texto OCR; `resumen_agente` 107 chars) · embeddings: solo `opiniones_oece` (RAG legal, 0 filas, migrado a Vertex AI Search) | **≈ 200 KB por contrato analizado** → 1 000 análisis = 0.2 GB · 100 000 = 20 GB (Postgres, no GCS) |

Ritmo de ingesta corriente [extrapolación]: 6–7 k procesos/mes en meses normales, ~1 k en enero →
**~80–100 MB/mes de metadata cruda** y, si se bajaran todos sus documentos, **~140–300 GB/mes**
(21.5 MB joven → ~45 MB al madurar).

---

## 6. Costo en GCS (us-central1) — precios verificados el 2026-09-15

Fuente: <https://cloud.google.com/storage/pricing>, selector "Iowa (us-central1)", consultado el
2026-09-15. La página publica precios **por GiB-hora**; el mensual es × 730 h. Facturación en USD.

| Clase | Almacenamiento (GiB-h → **GiB-mes**) | Ops clase A / 1 000 | Ops clase B / 1 000 | Recuperación / GiB | Permanencia mínima |
|---|---|---|---|---|---|
| Standard | $0.000027397 → **$0.020** | $0.005 | $0.0004 | $0 | ninguna |
| Nearline | $0.000013699 → **$0.010** | $0.010 | $0.001 | $0.01 | 30 días |
| Coldline | $0.000005479 → **$0.004** | $0.020 | $0.010 | $0.02 | 90 días |
| Archive | $0.000001644 → **$0.0012** | $0.050 | $0.050 | $0.05 | 365 días |

Red: salida a Internet (destinos mundiales salvo Asia/Australia) **$0.12/GiB** hasta 10 TiB/mes,
$0.11 hasta 150 TiB, $0.08 después; **$0 hacia servicios de Google Cloud en la misma región** (Cloud
Run us-central1 leyendo el bucket). Always Free (us-central1/us-east1/us-west1, agregado): 5 GB-mes
Standard, 5 000 ops A, 50 000 ops B, 100 GB de salida desde Norteamérica al mes. Cloud SQL no se
cotiza acá.

**Costo mensual por escenario** (solo almacenamiento; las operaciones son centavos: 8 500 subidas
clase A = $0.04, 100 000 lecturas clase B = $0.04):

| Escenario | Volumen | Standard | Nearline | Coldline | Archive |
|---|---|---|---|---|---|
| **A. Metadata completa** (1b: records gzip/Parquet de todo el histórico) | 4–6 GiB | **$0.08–0.11** (dentro del Always Free) | $0.04–0.05 | $0.02 | $0.01 |
| A'. + releases crudos gzip (4) | +2.5 GiB | +$0.05 | | | |
| **B. Documentos bajo demanda**, 1 000 contratos/mes con lifecycle Standard 30 d → Nearline → Coldline 90 d | 21.5 GB/mes joven (240 GiB al año) | mes 12: 20 GiB Std $0.40 + 40 GiB NL $0.40 + 180 GiB CL $0.72 = **$1.52/mes** (+$0.08 por cada mes adicional en Coldline) | | | |
| B'. ídem con contratos maduros (45 MB) | 45 GB/mes | **$3.19/mes** al mes 12 | | | |
| **C. Tipos clave de todo v3** (3) | 28 000–36 000 GiB | **$560–720** | $280–360 | $112–144 | $34–43 |
| **D. Todos los documentos, todo v3** (2) | 32 000–41 000 GiB | **$640–820** | $320–410 | $128–164 | $38–49 |
| D'. + v2 (tamaño no medido) | +9 700–13 600 GiB | +$190–270 | +$97–136 | +$39–54 | +$12–16 |
| Entrega de documentos a usuarios (egress) | 1 000 docs × 5.6 MB = 5.2 GiB/mes | **$0.63** (o $0 dentro de los 100 GB gratis) | | | |

Descargar C o D desde una laptop en Perú: **30–44 TB** a 1 request/1.2 s (el ritmo que `prod1` toleró)
son 6–8 M documentos ≈ **3–4 meses solo de requests**, más el ancho de banda (a 50 Mbit/s sostenidos,
34 TB ≈ 63 días). No es un problema de GCS: es de SEACE.

---

## 7. Límites y sorpresas encontrados en la API

1. **403 por ráfaga en `prod1.seace.gob.pe`** (documentos): con 3 hilos, bloqueó a partir del record 12
   (1 056 HEAD fallidos); el bloqueo se levantó solo a los pocos minutos. Serial a 1 request/1.2 s
   aguantó 1 100 requests seguidas sin un solo 403. `muestreo.py` quedó serial con `PAUSA_ENTRE_DOCS`
   y cooldown 60/120/240 s ante 403; `--remedir` recupera las urls re-bajando el record.
2. **`prod4.seace.gob.pe:9000`** (contratos firmados) responde `Transfer-Encoding: chunked` sin
   `Content-Length` ni soporte de `Range`: para medir hay que leer el cuerpo (tope 64 MB en el script;
   ninguno lo alcanzó).
3. **Dos prefijos de OCID** (`seacev2` hasta 2013, `seacev3` después) y desde 2020 ocids compuestos
   (`seacev3-2024-10248-1`). El descargador por lotes debe usar el `ocid` completo tal como viene en el
   release, no reconstruirlo con un prefijo fijo.
4. **La API empieza en 2008-08**; 2008-05 devolvió 0. Los records v2 no tienen documentos en el 40 %
   de los casos y los que tienen apuntan a Oracle Cloud (`objectstorage.us-ashburn-1`), no a SEACE.
5. **Versionado explosivo desde 2024**: 10–17 releases por ocid. `releasesAfter` de un mes de 2025
   son 1 280 páginas (128 k releases para 7.5 k procesos). Deduplicar por ocid es obligatorio y
   `/record` es la fuente eficiente.
6. **Estacionalidad fuerte**: enero = 10–15 % de mayo (36 % en 2025). Cualquier extrapolación "×12" de un solo mes
   sobreestima; la tabla de §2 muestra las dos cifras.
7. `tender.status` sigue siendo null (confirmado en los 302 records: `tag` de todos = `compiled`;
   la etapa se deriva de `awards[]`/`contracts[]`, como dice el plan).
8. `documentos.tamano_bytes` está en NULL en las 274 filas de la DB: el pipeline actual no registra el
   peso de lo que baja. Conviene que el descargador por lotes lo escriba (sha256 + bytes).

---

## 8. Recomendación de arquitectura de almacenamiento

1. **Metadata-first, siempre.** `/record` de cada ocid (gzip, `dataset/_batch/records/<aa>/<ocid>.json.gz`)
   → GCS Standard `batch/records/` (4–6 GiB para todo el histórico: cuesta centavos) → Postgres
   (`convocatorias` + clasificación tipo × etapa). Un snapshot Parquet mensual en GCS Standard para
   análisis y para que cualquiera reproduzca. No guardar releases individuales: el record ya trae la
   lista de versiones.
2. **Documentos bajo demanda** (escenario B): se bajan solo los de contratos financiados/procesados o
   los que un agente necesita (`document_parser` ← bases, acta de buena pro, contrato). Bucket
   `vigia-peru-documentos` en Standard con lifecycle **30 d → Nearline, 90 d → Coldline**; nunca Archive
   (permanencia mínima 365 d y $0.05/GiB de recuperación no compensan a estos volúmenes). Registrar
   sha256 + bytes en `documentos` y no re-bajar un hash existente. Costo: **≈ $1.5–3/mes por cada
   1 000 contratos/mes** de ritmo.
3. **Histórico completo de documentos (C/D) solo si un financiador lo paga**: $560–820/mes en
   Standard o $112–164/mes en Coldline, más 3–4 meses de descarga desde IP peruana al ritmo que SEACE
   tolera. Si se hace, directo a Coldline (se lee poco) y por años, empezando por 2024–2026.
4. **Derivados en Postgres**, no en GCS: 200 KB por contrato analizado. Los reportes/dictámenes que
   se sirven al público ya van a `vigia-peru-reportes` (Standard, egress $0.12/GiB fuera de GCP).
5. **Descarga desde IP peruana, ritmo serial** (1 doc / 1.2 s, 4 hilos para `/record`), reanudable con
   el estado SQLite del Workstream B; lotes nocturnos con tope de GB.
