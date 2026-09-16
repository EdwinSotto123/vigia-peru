# Datasets externos — qué hay cargado, de dónde sale y con qué regla se cruza

> Frente D del plan `docs/superpowers/plans/2026-09-16-mejoras-ux-datasets-rag.md`. Todas las cifras
> de este documento salen de `backend/scripts/datasets_resumen.py` (consultas reales a Cloud SQL) y
> llevan la fecha en que se ejecutó. Para refrescarlas: `cd backend/scrapers && PYTHONPATH=. python ../scripts/datasets_resumen.py`.

## Principios

- **Todo lo que toca `.gob.pe` corre desde IP peruana** (laptop/VPS, paso 6 de `infrastructure/deploy/batch-nocturno.sh`). GCP recibe 403 de la PNDA, OECE, ONPE y JNE.
- El crudo se conserva tal cual en `gs://vigia-peru-batch/raw/<fuente>/<clave>/<archivo>` (`SCRAPER_GCS_BUCKET`) y localmente en `dataset/_raw/<fuente>/<clave>/`.
- Cada carga queda en `datasets_cargas (fuente, clave, sha256, filas, gcs_uri, descargado_at, cargado_at)`; la vista `datasets_cobertura` (una fila por fuente) es la base de la sección "Fuentes externas" de `/admin/cobertura`.
- **Idempotencia**: un archivo cuyo sha256 ya está registrado para esa clave no se recarga (salvo `--force`); si la fuente republica con otro sha256 se reemplaza la clave completa (periodo, proceso o foto). Nunca `INSERT` a ciegas.
- Las tablas normalizadas llevan `fuente`, `sha256` y `descargado_at` por fila. Datos personales (DNI) se guardan completos en la DB; el enmascarado lo hace el frontend (`Redact.tsx`).
- Migraciones: `backend/db/migrations/23_datasets.sql`, `24_jne_autoridades_detalle.sql`, `25_onpe_candidatos.sql` (aplicadas el 2026-09-16).

## Tabla resumen

Filas y fechas: consultas del 2026-09-16 (`datasets_resumen.py`, salida completa al final).

| Fuente | Pipeline | Tabla destino | Filas cargadas hoy | Última fecha del dato | Frecuencia (`batch-nocturno.sh`) | Cómo se cruza con las reglas | Bloqueos |
|---|---|---|---|---|---|---|---|
| PNDA — Reporte de registro de visitas (GORE Loreto) | `pnda_visitas` | `visitas_entidades` (`fuente='pnda_visitas'`, `periodo` AAAA-MM) | 57 643 (17 meses, 2025-01 → 2026-05) | visita 2026-05-29 | días 1 y 15 (`--desde/--hasta` para backfill) | `check_lobby_visits_rule` (`lobby_visits_pre_convocatoria`): visitas de socios/representantes RNP del postor a la entidad contratante en los 180 días previos a la convocatoria; `query_visitas_de_persona` (person_network_agent) | El dataset solo cubre una entidad (GORE Loreto). 2024 y 2026-06+ no publicados |
| Portal PCM de visitas (todas las entidades) | `pnda_visitas --xlsx` (export manual) | `visitas_entidades` (`fuente='portal_visitas_manual'`) | 24 454 (345 entidades) | visita 2026-05-22 | manual (botón "Excel" del portal, rango ≤ 90 días) | ídem | **Turnstile** bloquea la automatización (ver evidencia) |
| ONPE Claridad — aportes de campaña por organización | `onpe_claridad` | `onpe_aportantes` (`proceso`, `ruc_organizacion`, `nivel='campaña'`) | 14 723 (ERM2018 5 339 · ECE2020 965 · EG2021 2 186 · ERM2022 2 799 · EG2026 3 415 · EMC 19) + 7 189 del export manual 2015-2016 | aporte 2026-08-01 (EG2026) | mensual con `ONPE=1` (navegador con ventana); semanal en campaña | `query_onpe_aportantes` por DNI exacto o nombre (batch_person_lookup sobre socios/representantes RNP del postor y autoridades de la entidad); `detect_aporte_a_partido_del_alcalde` (C3: gerente del proveedor aportó al partido de la autoridad de la entidad) | Cloudflare + reCAPTCHA v3: solo con Chromium **con ventana** |
| ONPE Claridad — Información Financiera Anual | `onpe_claridad --ifa` | `onpe_aportantes` (`proceso='IFA<año>'`, `nivel='anual'`) | 59 695 (IFA2017 → IFA2024) | aporte 2024-12-31 (IFA2024) | ídem | ídem | ídem |
| ONPE Claridad — padrón de candidatos | `onpe_claridad --candidatos` | `onpe_candidatos` (DNI, organización, departamento, proceso) | 36 749 (todos con DNI) | proceso ERM2026 | ídem | Da DNI a `jne_autoridades` y a `jne_candidaturas.numero_documento` → `query_jne_candidaturas(dni)` acierta por documento | ídem |
| JNE — Autoridades vigentes / electas (PNDA) | `jne_infogob` | `jne_autoridades` (+ vista `jne_autoridades_vigentes`) | 13 237 (4 579 con DNI; Cusco 794, Puno 735) | reporte del 2026-07-30; periodos hasta 2031-07-27 | día 5 | Quién gobierna la entidad contratante por ubigeo INEI y periodo (insumo de `query_autoridades_entidad` y `detect_aporte_a_partido_del_alcalde` / C3); `detect_puerta_giratoria` (C9) usa `jne_candidaturas`, que ahora tiene DNI | El XLS del JNE no trae DNI (el diccionario lo lista, el archivo no) |
| JNE Infogob — candidatos y autoridades por proceso (XLSX) | `jne_infogob --root dataset/ELECCIONES` | `jne_candidaturas` | 319 066 (37 597 con DNI, antes 0) | ERM 2022 | por proceso electoral, manual | `query_autoridades_entidad` (electos 2022), `query_jne_candidaturas` | Incapsula + captcha de imagen en "Base de datos" |
| Contraloría — DJI (PNDA) | `pnda_dji` | `dji_funcionarios`, `dji_empleos`, vista `dji_puerta_giratoria` | 1 826 967 + 2 726 382 | CSV publicado 2026-08/09 | día 5 | C9 puerta giratoria: `dji_empleos.ruc_entidad` = RUC del postor/ganador; C8 rotación de funcionarios por entidad y cargo | CSV de 268 + 442 MB (≈ 3 min de carga) |

## Hallazgos y bloqueos con evidencia (2026-09-16)

### PNDA visitas = una sola entidad
Probando los 3 patrones de slug (`reporte-de-registro-de-visitas[-en-linea]-<mes>[-<año>]`) para 2024-01 → 2026-09 existen 17 datasets (2025-01 → 2026-05). Los 17 XLSX tienen **una única `Entidad visitada`: GOBIERNO REGIONAL DE LORETO** (2 458 – 5 049 filas/mes). El export manual del portal PCM de abr-may 2026 (`dataset/VISITANTES_ENTIDADES/visita_a_entidades.xlsx`) tiene 348 entidades y 25 254 filas en 4 semanas: esa es la fuente que vale para la regla de lobby.

### Portal PCM `visitas.servicios.gob.pe/consultas` — Turnstile
El HTML de la página trae la lógica completa (sin ofuscar):
```
var url = "https://visitas.servicios.gob.pe/api/consultas-busqueda";
… turnstile.reset('#cf-turnstile'); turnstile.execute('#cf-turnstile');   // consulta()
… ajax POST { busqueda, fecha ("dd/mm/yyyy - dd/mm/yyyy", ≤ 90 días), ruc, token }
<div id="cf-turnstile" data-sitekey="0x4AAAAAAD4EMnHhyxdZQbWN" data-execution="execute" data-appearance="interaction-only">
```
y acepta `?ruc_enti=<RUC>` para consultar por entidad. Con Playwright (Chromium 1243 y `channel="chrome"`, `--disable-blink-features=AutomationControlled`, `navigator.webdriver` oculto) el callback `onTurnstileToken` **nunca se dispara** en 60 s: el input `cf-turnstile-response` queda vacío y el POST no sale (0 requests a `/api/`). Sí funciona en un navegador normal, por eso el pipeline acepta el export "Excel" con `--xlsx` (se parte por mes y se deduplica contra las filas de la PNDA por entidad+fecha+documento+hora).

### ONPE Claridad — sí hay API, detrás de Cloudflare y reCAPTCHA v3
- `claridadportal.onpe.gob.pe` (Next.js) y `claridad.onpe.gob.pe/claridad-backend` responden **403 "Just a moment…"** a `requests`, `curl` y `page.request` de Playwright; el challenge JS pasa con Chromium **con ventana** (headless se queda en el challenge). Navegaciones posteriores con `page.goto` reciben un challenge interactivo → el pipeline abre una sola página y hace todo con `fetch` desde ella.
- Los endpoints `portal/consult/*` exigen `token` reCAPTCHA v3 (site key `6Lf6p1UtAAAAACYJTSj2fVJhFIYrjduWSWWajOXp`, acción `submit`) que el frontend genera con `grecaptcha.execute`; el pipeline lo genera igual dentro de la página. No hay login ni API key.
- `consult/org/find` con filtro vacío devuelve las 234 parejas (organización, proceso) de campaña; `find-detail` pagina 1-based y acepta `size=500`. La tabla web muestra el **DNI/RUC completo** (no enmascarado). `candidate/find-lastname` con filtro vacío devuelve el padrón completo de candidatos (37 496 filas, 36 749 únicas).
- Errores transitorios `TypeError: Failed to fetch` (≈ 1 de cada 30 llamadas) se reintentan con espera creciente.
- Falta explorar: aportes recibidos directamente por **candidatos** (`consult/candidate/*` no expone el detalle; el frontend lo pide por otra ruta) y gastos (`consultaGasto*`).

### JNE — el reporte oficial está en la PNDA (sin DNI) y con ubigeo RENIEC
- `datosabiertos.gob.pe/dataset/autoridades-vigentes-jne` → `autoridades_vigentes_20260730.xls` (13 238 filas: ERM 2022 + complementarias 2023/2025 + reemplazos + Congreso bicameral y Ejecutivo 2026). `autoridades-electas-jne` → 209 proclamados 2026.
- El diccionario del dataset lista `DOCUMENTOIDENTIDAD`, el archivo no lo incluye → el DNI se completa desde `onpe_candidatos` por (apellidos+nombres, organización, proceso).
- `UBIGEO` es codificación RENIEC (Cusco 07, Puno 20, Callao 24); se resuelve el ubigeo INEI por nombres con `_core/ubigeo.py` (13 029/13 237 resueltos; 10 565/10 727 distritales a 6 dígitos; los que faltan son distritos nuevos que no están en `zonas`).
- Infogob (`infogob.jne.gob.pe`) está detrás de Incapsula y la descarga de "Base de datos" pide un formulario con captcha de imagen → se deja como carga manual (`--root`).

## Lectura de los cruces (2026-09-16)

- **Visitas**: 121 visitas de 9 socios/representantes (RNP) de 9 empresas postoras de contratos ya procesados, pero **0** caen en la ventana de la regla (misma entidad contratante, 180 días antes de la convocatoria). Motivo: la PNDA solo cubre al GORE Loreto y el export manual del portal PCM cubre 4 semanas de 2026; de las 71 entidades con contratos procesados, 6 tienen visitas registradas. Con más meses del portal PCM (export manual o cuando Turnstile lo permita) la regla tendrá cobertura real: hay 13 103 visitas de 3 827 personas que figuran en el RNP y 11 443 visitas a 77 entidades con convocatorias en la cola.
- **ONPE**: 74 418 aportes con documento completo (74 359 DNI, 58 RUC). Cruces ya posibles: 3 aportantes son socios/representantes de postores en contratos procesados (11 aportes); 4 106 aportantes son socios de algún proveedor del Estado (RNP); 691 aportantes son hoy autoridades vigentes (3 217 aportes) → insumo directo de `detect_aporte_a_partido_del_alcalde`. Las fechas con año imposible (1021, 0217, 1919, 2916) vienen así de la fuente y se conservan; `año` se toma de la fecha o del año de elección. Una pareja (IFA2018 · FUERZA REGIONAL) devuelve 500 en el backend de Claridad y queda registrada con `estado='error'`.
- **JNE**: 1 352 entidades tienen autoridades vigentes en su mismo ubigeo y 9 814 convocatorias de la cola tienen alcalde vigente identificado; 34,6 % de las autoridades tienen DNI (la cobertura del padrón de Claridad es parcial: solo organizaciones que rindieron cuentas). `jne_candidaturas` pasó de 0 a 37 597 filas con DNI → `query_jne_candidaturas(dni)` y `detect_puerta_giratoria` ahora aciertan por documento.
- **DJI**: 1 490 empleos previos de 1 059 funcionarios en 64 empresas postoras de contratos procesados (C9 puerta giratoria, vista `dji_puerta_giratoria`); 716 943 declaraciones son de entidades con convocatorias en la cola.

## Cifras (salida de `datasets_resumen.py`, 2026-09-16)

## Cargas registradas (`datasets_cobertura`)

| fuente | tabla | cargas | filas | última clave | última descarga | última carga |
|---|---|---|---|---|---|---|
| jne_infogob | jne_autoridades | 2 | 13,445 | vigentes | 2026-09-16 06:36 | 2026-09-16 06:37 |
| onpe_claridad | onpe_candidatos | 1014 | 114,432 | IFA2024/-/unidos-por-tacna | 2026-09-16 07:59 | 2026-09-16 08:23 |
| pnda_dji | dji_funcionarios | 2 | 4,553,349 | funcionarios | 2026-09-16 06:40 | 2026-09-16 06:42 |
| pnda_visitas | visitas_entidades | 17 | 57,643 | 2026-05 | 2026-09-16 06:11 | 2026-09-16 06:12 |
| portal_visitas_manual | visitas_entidades | 2 | 24,454 | 2026-05/visita_a_entidades | 2026-05-24 16:03 | 2026-09-16 06:22 |

## visitas_entidades

- pnda_visitas: 57,643 visitas · 2025-01-02 → 2026-05-29 · 1 entidades visitadas · 16,176 documentos distintos
- portal_visitas_manual: 24,454 visitas · 2026-04-25 → 2026-05-22 · 345 entidades visitadas · 17,385 documentos distintos
- Visitas de socios/representantes (RNP) de empresas postoras en contratos procesados: **121 visitas · 9 personas · 9 empresas**
- Regla `lobby_visits_pre_convocatoria` (misma SQL que compliance_rules, todos los contratos con postores): **0 visitas en 0 contratos**
- Visitas de personas que figuran en el RNP como socio/representante de algún proveedor del Estado: **13,103 visitas · 3,827 personas**
- Entidades visitadas que están en `entidades` (tienen convocatorias en la cola): **77** (11,443 visitas)
- Entidades de contratos ya procesados con visitas registradas: FONDO METROPOLITANO DE INVERSIONES, MUNICIPALIDAD DISTRITAL DE CAJARURO, MUNICIPALIDAD DISTRITAL DE MEGANTONI, MUNICIPALIDAD PROVINCIAL DEL CALLAO, MUNICIPALIDAD PROVINCIAL DEL CUSCO, OFICINA NACIONAL DE PROCESOS ELECTORALES

## onpe_aportantes / onpe_candidatos

| proceso | aportes | aportantes distintos | monto (S/) | primer aporte | último aporte |
|---|---|---|---|---|---|
| ECE2020 | 965 | 761 | 2,692,643.12 | 2019-01-17 | 2020-12-13 |
| EG2021 | 2,186 | 1,388 | 13,589,365.71 | 1021-01-21 | 2021-08-02 |
| EG2026 | 3,415 | 2,195 | 20,944,343.57 | 2025-01-23 | 2026-08-01 |
| EMC2019 | 10 | 1 | 1,645.50 | 2019-01-31 | 2019-08-31 |
| EMC2023 | 5 | 4 | 4,705.00 | 2023-06-01 | 2023-07-26 |
| EMC2024 | 2 | 2 | 6,000.00 | 2024-06-01 | 2024-06-01 |
| EMC2025 | 2 | 2 | 6,000.00 | 2025-09-25 | 2025-09-25 |
| ERM2018 | 5,339 | 3,463 | 6,326,985.89 | 2017-04-20 | 2021-12-05 |
| ERM2022 | 2,799 | 1,576 | 3,127,090.71 | 2022-01-04 | 2022-12-31 |
| (export manual 2015-2016, sin proceso) | 7,189 | 2,950 | 29,841,220.83 | 2003-02-04 | 2916-02-29 |
| IFA2017 | 9,083 | 3,112 | 4,486,584.23 | 0217-06-23 | 2017-12-31 |
| IFA2018 | 14,503 | 8,366 | 11,869,679.07 | 2018-01-01 | 2019-01-21 |
| IFA2019 | 5,973 | 3,401 | 4,598,127.88 | 1919-10-29 | 2021-10-29 |
| IFA2020 | 4,170 | 2,214 | 8,657,354.75 | 2020-01-01 | 2022-06-08 |
| IFA2021 | 4,939 | 2,088 | 12,220,953.78 | 2020-07-02 | 2022-07-12 |
| IFA2022 | 9,770 | 5,946 | 7,586,018.29 | 2002-03-26 | 2023-08-19 |
| IFA2023 | 3,954 | 1,344 | 3,085,826.97 | 2022-01-02 | 2024-12-31 |
| IFA2024 | 7,303 | 2,649 | 4,992,163.01 | 2021-05-31 | 2024-12-31 |

- Aportes con proceso (API Claridad): **74,418** · con documento 74,418 (DNI 74,359 · RUC 58)
- Aportantes persona que son socios/representantes (RNP) de postores en contratos procesados: **11 aportes · 3 personas**
- Aportantes empresa (RUC) que son postores en contratos procesados: **0 aportes · 0 empresas**
- Aportantes empresa inscritas en el RNP (proveedores del Estado): **20 aportes · 10 empresas**
- Aportantes persona que son socios/representantes de algún proveedor del Estado (RNP): **13,263 aportes · 4,106 personas**
- Aportantes que hoy son autoridades vigentes (por DNI, `jne_autoridades`): **3,217 aportes · 691 personas**
- `onpe_candidatos`: **36,749** candidatos (36,749 con DNI) · procesos: ERM2022 17,563, ERM2018 10,590, EG2026 4,031, EG2021 1,742, ECE2020 1,518, ERM2026 1,275, EMC2019 29, EMC2020 1

## jne_autoridades / jne_candidaturas

- `jne_autoridades`: **13,237** filas · 4,579 con DNI (vía onpe_candidatos) · 13,029 con ubigeo INEI · 13,237 vigentes
  - REGIDOR DISTRITAL: 9,033 (2,048 con DNI)
  - REGIDOR PROVINCIAL: 1,714 (559 con DNI)
  - ALCALDE DISTRITAL: 1,694 (1,418 con DNI)
  - CONSEJERO REGIONAL: 342 (186 con DNI)
  - ALCALDE PROVINCIAL: 196 (156 con DNI)
  - DIPUTADO: 130 (121 con DNI)
  - SENADOR: 60 (56 con DNI)
  - GOBERNADOR REGIONAL: 25 (13 con DNI)
  - VICEGOBERNADOR REGIONAL: 25 (10 con DNI)
  - REPRESENTANTE ANTE EL PARLAMENTO ANDINO - TITULAR: 5 (4 con DNI)
  - REPRESENTANTE ANTE EL PARLAMENTO ANDINO - SEGUNDO SUPLENTE: 5 (3 con DNI)
  - REPRESENTANTE ANTE EL PARLAMENTO ANDINO - PRIMER SUPLENTE: 5 (3 con DNI)
  - PRESIDENTE DE LA REPUBLICA: 1 (0 con DNI)
  - SEGUNDO VICEPRESIDENTE: 1 (1 con DNI)
  - PRIMER VICEPRESIDENTE: 1 (1 con DNI)
- Cusco (08): 794 autoridades · 308 con DNI · 116 alcaldes
- Puno (21): 735 autoridades · 483 con DNI · 110 alcaldes
- Entidades con autoridades vigentes en su mismo ubigeo: **1,352** · convocatorias en la cola cuya entidad tiene alcalde vigente identificado: **9,814**
- `jne_candidaturas`: 319,066 filas · **37,597 con DNI** (antes de este frente: 0)

## dji_funcionarios / dji_empleos

- `dji_funcionarios`: **1,826,967** declaraciones · 2,853 entidades · `dji_empleos`: **2,726,382** empleos previos (2,674,571 con RUC)
- Empleos previos en empresas postoras de contratos procesados (puerta giratoria, C9): **1,490 empleos · 64 empresas · 1,059 funcionarios**
- Empleos previos en cualquier empresa de `empresas`: **83,541**
- Declaraciones de funcionarios de entidades con convocatorias en la cola: **716,943**

