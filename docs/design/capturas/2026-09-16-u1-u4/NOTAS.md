# U1 + U4 · recorrido en navegador (2026-09-16)

Plan: `docs/superpowers/plans/2026-09-16-mejoras-ux-datasets-rag.md` (§ U1 "El mapa y las cifras dicen la verdad" y § U4 "Admin que sirve para operar"). Dos pasadas navegador → ajuste → deploy. Capturas `NN-*.png` en esta carpeta (`-v1` = primera pasada, `-v2` = después de los ajustes).

## Lo que se veía mal y por qué

| Síntoma | Causa | Corrección |
|---|---|---|
| "10 contratos procesados" para Vigía Perú cuando eran 20 | `ranking_impacto` y `zona_estado` solo se refrescaban con `refresh_financiamiento()` (ingesta nocturna / scheduler / validar aporte); el dispatcher no refrescaba al cerrar cada contrato. Además `zona_estado` tardaba **85 s** por refresh (re-evaluaba `cola_auditoria` por cada una de ~2 000 zonas). | Migración 22: `zona_estado` reescrita con CTEs materializados (**2 s**), `refresh_ranking()` separado. El dispatcher llama `refresh_ranking()` tras cada contrato OK (0.3 s) y `refresh_financiamiento()` al final de la corrida. Aliado, comprobante y estado global calculan en vivo desde `asignaciones` con caché 30 s. |
| Las 5 alertas en `revision` contaban como "señales halladas" | `senales = count(alerta_id)` sin mirar `alertas.estado` ni si había banderas. | "Señal hallada" = alerta **publicada** (activa/confirmada) con ≥ 1 bandera (`alerta_publicada()`); las de revisión se exponen aparte como `enRevision` en zona, ranking, aliado, comprobante y estado global. Vigía Perú: 20 procesados · 14 señales · 5 en revisión. |
| El mapa decía "cola" sin aclarar que hoy solo entran bienes adjudicados | El alcance (`ajustes.procesamiento`) no llegaba al frontend. | `GET /financiamiento/alcance` (público, caché 60 s) + `alcance` en `/zonas/:ubigeo` y `/estado`. Pestaña Cola: "Contratos en cola (bienes con adjudicación o contrato) · 594" y "Documentos listos (otros tipos, análisis en preparación) · 97" + `<details>` "¿Qué se analiza hoy?". Resumen: nota con documentos listos y "N procesados en revisión humana". |
| Capa Contratos coloreada por % de señales | — | Color por estado operativo dominante de la zona: sin analizar · documentos listos · en cola · procesado · en revisión (leyenda de 5 estados, también compacta con región elegida). `/contratos/geo` devuelve `enCola`, `documentosListos`, `enRevision`; `conSenales` solo cuenta alertas publicadas. |
| Franja superior del mapa con "Alertas 45 · Reportes 14 · Convergentes 7 · S/ 115 M" | Venía de `REGIONES` (datos mock). | Ahora: Alertas 87 (API) · Denuncias 6 · Contratos 18 394 · En cola 4 187 · Docs listos 1 609. |
| "Descargados 24 h" se leía como contratos nuevos | Contaba `convocatorias.created_at`. | "Documentos (7 días)" = `documentos_gcs.creado_at` (13 472 documentos · 2 477 contratos), con tooltip. Nueva cifra "En revisión humana" (5) en la franja y en los conteos del tablero. |
| Cobertura mostraba "Invalid Date" en la columna de mes (bug preexistente) | `new Date(iso + "T12:00:00")` con un ISO completo. | `.slice(0, 10)`. |
| /admin decía "0/4 servicios responden" | Arranque en frío de Cloud Run ≈ 8 s > timeout de 3 s. | Se mantiene el timeout de 3 s (nunca desde el navegador), pero los que no responden se re-consultan en segundo plano con 20 s y corrigen la caché de 60 s; la tarjeta dice "arrancando…" y al minuto "4/4 responden · 88-173 ms". |

## URLs verificadas (números reales al cierre)

- `/aliado/vigia-peru` → **Contratos financiados 20 · Procesados 20 (5 en revisión humana) · Señales halladas 14 · Zonas 2**; por aporte: VIG-2026-00005 Puno 10/10 · 6 señales · 3 en revisión; VIG-2026-00004 Cusco 10/10 · 8 señales · 2 en revisión. (`01-aliado-vigia-peru.png`)
- `/impacto/VIG-2026-00005` → Procesados 10/10 (3 en revisión humana) · Señales 18 en 6 contratos con dictamen publicado · Monto auditado S/ 2 136 434. (`12-impacto-VIG-2026-00005.png`)
- `/app/mapa` (país) → leyenda de 5 estados operativos; franja Alertas 87 · Denuncias 6 · Contratos 18 394 · En cola 4 187 · Docs listos 1 609. (`03-…`, `13-…`)
- `/app/mapa?region=cusco&tab=cola` → 594 en cola (bienes con adjudicación o contrato) · S/ 117 561 286 · 101 entidades · 97 documentos listos · 2 en revisión humana · `<details>` con el alcance. (`02-…`, `14-…`)
- `/app/mapa?region=puno&tab=resumen` → 430 en cola · 10 financiados · 10 procesados · 6 señales · nota "71 contratos de otros tipos con documentos listos · 3 procesados en revisión humana". (`04-…`)
- `/app/auditoria` → franja: Documentos (7 días) 13 472 · En cola 0 · Procesando 0 · Procesados hoy 10 · En revisión humana 5 · Con error 0 · Pendientes 0; conteos del tablero "20 procesado · 5 en revisión humana". (`05-…`, `15-…`)
- `/admin` → 6 alertas en revisión · 1 aporte por validar · 0 pedidos abiertos; salud: dispatcher (última corrida 15-set 21:25, 20 procesados en 24 h), servicios 4/4, relay caído (VPS), ingesta hace 32 h, lote nocturno 13 430/13 444 (14 fallidos); cola por estado; financiamiento S/ 60 · 20 financiados · 14 señales (6 en revisión, no cuentan). (`06-…`, `16-…`)
- `/admin/revision` → 6 pendientes (3 respaldo bajo, 2 precio dudoso, 1 sin motivo en bitácora → recalculado); detalle con banderas + verificación determinista + juicio de respaldo, autoevaluación con umbrales, dictamen redactado con `Redact` (0 DNIs en claro en todo el DOM), diálogo Publicar/Descartar con motivo obligatorio. **Se abrió y canceló el diálogo: no se publicó ni descartó ninguna alerta real.** (`07-…`, `08-…`, `09-…`, `18-…`)
- `/admin/procesamientos?perfil=bienes` → filtro por perfil (Bienes 20 · Servicios 0 · Obras 0 · Otros 0), píldora "En revisión humana" + score, botones "Ver traza" y "Re-analizar" (diálogo ≈ US$ 0.25 · ~3 min, bloquea si hay uno procesando). **Se abrió y canceló el diálogo: no se lanzó ningún re-análisis.** (`10-…`)
- `/admin/cobertura` → lote nocturno: 13 472 de 80 139 documentos publicados (16.8 %), faltan 66 667 (15 916 contratos sin bajar), ritmo 6 736/noche, estimación 10 noches ≈ 26-set, últimos 20 errores por ítem ("sin archivo o sin sha256" del lote `documentos-20260915-092446`). (`11-…`, `17-…`)

## Cambios por archivo

**DB** — `backend/db/migrations/22_refresh_ranking.sql` (aplicada): `alerta_publicada()`, `alertas.moderacion`, `ajustes.self_eval`, `zona_estado` (+`en_revision`, `documentos_listos`, 85 s → 2 s), `ranking_impacto` (+`en_revision`, señales publicadas), `refresh_ranking()`, índice `admin_log(objeto)`.

**Dispatcher** — `backend/dispatcher/main.py`: `refrescar_vistas(zonas)` con try/except+log; se llama en `terminar(OK)` y al final de `main()`. Tests nuevos en `tests/test_persistencia.py` (46 pasan).

**API** — `routes/financiamiento.ts` (señales publicadas, `enRevision`, `documentosListos`, `alcance`, `GET /alcance`, cachés 30–60 s), `routes/procesamientos.ts` (`documentosDescargados7d`, `enRevision`, `porEstado.revision`), `routes/contratos.ts` (geo: `enCola`/`documentosListos`/`enRevision`, `conSenales` publicadas), `routes/admin.ts` (monta sub-routers, `perfil` en `/procesamientos`, `enRevision` en resumen), nuevos `routes/admin_revision.ts` (`/revision`, `/revision/:id`, `PUT /alertas/:id/estado`, `GET/PUT /config/self_eval`, port de `debe_bloquear`) y `routes/admin_operacion.ts` (`/operacion`, `POST /procesamientos/:ocid/reanalizar` con 409 si hay activo, `/cobertura/progreso`), `lib/adminlog.ts` (bitácora + `refrescarRanking`).

**Frontend** — `lib/financiamiento.ts` (tipos, `getAlcance`, `alcanceCorto/Largo`), `lib/contratos.ts`, `lib/admin.ts`, `components/contratos/ContratoPin.tsx` (5 estados), `components/MapaWrapper.tsx` (totales reales, leyenda en región), `components/mapa/ZonaHubPanel.tsx` (cola separada, `<details>` alcance, en revisión), `components/auditoria/PanelProcesamiento.tsx` (7 cifras), `components/auditoria/TableroAuditoria.tsx` (en revisión), `app/(public)/aliado/[slug]`, `app/(public)/impacto/[codigo]`, `app/(dashboard)/app/financiar/[ubigeo]`, `components/admin/AdminShell.tsx` (nav Revisión humana), `app/admin/page.tsx` (resumen en una pantalla), `app/admin/revision/page.tsx` + `[id]/page.tsx` (nuevas), `app/admin/procesamientos/page.tsx` (perfil, re-analizar, ver traza), `app/admin/cobertura/page.tsx` (progreso + fix Invalid Date).

## Bitácora
Publicar/descartar (`alerta_publicar` / `alerta_descartar`), re-analizar (`reanalizar`, con costo estimado) y umbrales (`editar_self_eval`) escriben en `admin_log`; la página `/admin/bitacora` ya los lista. Hoy la tabla está vacía (los aportes institucionales se crearon por SQL).

## Pendiente / decisiones
- Los umbrales de `ajustes.self_eval` los usa la API para explicar el motivo; el pipeline (`backend/agent/tools/self_eval.py`, fuera del alcance de esta iteración) sigue leyendo `EVAL_MIN_*` de las variables de entorno. El panel lo dice en el diálogo y en la nota del ajuste.
- Re-analizar un contrato cuya alerta está en `revision`: el upsert de `alertas` (`ON CONFLICT (codigo)`) no toca `estado`, así que seguirá en revisión hasta publicarla. Está avisado en el diálogo.
- El relay residencial (VPS Lima) aparece "caído" en `/admin`: es el estado real del puente, no un fallo del panel.
- La leyenda compacta de Contratos con región elegida queda al pie del mapa (fuera del primer viewport en 1920×900).
