# Scrapers en la nube — qué se construyó y por qué (2026-09-16)

**Lo que pediste:** "crea N carpetas para cada tipo de scrapeo, así luego los configuro con
Cloud Scheduler — la idea es descargar con scrapers, CSV, etc." Esto es la explicación de lo
que hay ahora en `backend/cloud_functions/` y qué tan cierto es "ya lo configuré con Cloud
Scheduler" (spoiler: 6 de 8, y los otros 2 no es por falta de ganas — es un bloqueo real).

---

## 1. La idea en una frase

Cada scraper que ya tenías en `backend/scrapers/<fuente>/` (probado, corriendo desde tu
laptop) ahora **además** vive empaquetado en un contenedor propio en
`backend/cloud_functions/<fuente>/`, con su propio Cloud Run Job y, cuando el sitio lo permite,
su propio Cloud Scheduler que lo dispara solo, en GCP, sin que tu laptop tenga que estar
prendida. La lógica de scraping **no se duplicó** — el contenedor solo empaqueta el mismo
código y lo hace correr solo.

## 2. Por qué "Cloud Run Jobs" y no "Cloud Functions" a secas

Pediste `backend/cloud_functions`, y el nombre de la carpeta se quedó así, pero por dentro
usé **Cloud Run Jobs**, no Cloud Functions clásicas. Motivo concreto, no preferencia:

- `pnda_dji` baja hasta 700 MB y tarda varios minutos — Cloud Functions tiene límites de
  tiempo y tamaño más estrechos.
- `onpe_claridad` necesita Chromium con perfil completo (no un runtime ligero) y un
  `Dockerfile` con dependencias de sistema (Xvfb) — Cloud Functions no te deja traer tu propio
  `Dockerfile` con esa libertad; Cloud Run Jobs sí.
- Cloud Scheduler agenda Cloud Run Jobs exactamente igual que agendaría una Cloud Function
  (una llamada HTTP a una API de Google) — para vos, como usuario, el resultado es el mismo:
  "algo corre solo, a la hora que dije". Por dentro es más robusto.

## 3. Antes de construir nada: comprobé qué sitio bloquea la nube y cuál no

Ya sabíamos (de trabajo anterior) que el SEACE/OECE bloquea IPs de GCP con 403. La pregunta
que faltaba responder era: **¿eso aplica a TODOS estos scrapers, o solo a algunos?** En vez
de asumir, lancé un `Cloud Build` (que corre físicamente con IP de Google Cloud) que le pega
a cada sitio real:

```
PROBE 403 https://contratacionesabiertas.oece.gob.pe/api/v1/releasesAfter   ← OECE, bloqueado (ya lo sabíamos)
PROBE 200 https://www.datosabiertos.gob.pe                                  ← PNDA, ABIERTO
PROBE 403 https://claridad.onpe.gob.pe/claridad-backend/...                 ← ONPE, Cloudflare
PROBE 200 https://visitas.servicios.gob.pe                                  ← responde, pero el formulario pide Turnstile igual
```

**Resultado:** la PNDA (`datosabiertos.gob.pe`, de donde salen `pnda_sancionados`,
`pnda_visitas`, `pnda_dji`, `pnda_oece` y el reporte que usa `jne_infogob`) y la API del MEF
**no tienen ningún bloqueo de nube** — son datos abiertos de verdad, sin WAF. Solo el OECE
(WAF propio) y ONPE (Cloudflare) bloquean IPs de datacenter.

## 4. La arquitectura, en árbol

```
backend/cloud_functions/
├── _base/Dockerfile           ← imagen compartida: Python 3.12 + las dependencias de
│                                 backend/scrapers + el código de backend/scrapers y
│                                 backend/scripts (sin navegador)
├── pnda_sancionados/Dockerfile   ← 2 líneas: "usa la imagen base" + "corre este pipeline"
├── pnda_visitas/Dockerfile       ← igual
├── pnda_dji/Dockerfile           ← igual
├── pnda_oece/Dockerfile          ← igual
├── jne_infogob/Dockerfile        ← igual
├── mef_presupuesto/Dockerfile    ← igual
├── oece_ocds/Dockerfile          ← igual (pero ver §6: no se agenda)
└── onpe_claridad/Dockerfile      ← imagen PROPIA (Playwright + Xvfb, más pesada) — ver §6
```

Un Dockerfile "de 2 líneas" se ve así (el de `pnda_sancionados`, literal):

```dockerfile
FROM …/scrapers-base:latest
ENTRYPOINT ["python", "-m", "backend.scrapers.pnda_sancionados.pipeline"]
```

Es decir: la imagen pesada (dependencias + todo el código) se construye **una sola vez**
como base compartida, y cada fuente es solo "arriba de esa base, corré este comando". Agregar
una fuente nueva a este esquema son 3 líneas de Dockerfile + una entrada en el script de
despliegue, no reinventar nada.

## 5. Qué quedó agendado en Cloud Scheduler (y a qué hora)

| Job (`scraper-<fuente>`) | Cuándo (hora de Lima) | Por qué esa frecuencia |
|---|---|---|
| `pnda-sancionados` | domingos 8am | el Tribunal de Contrataciones resuelve toda la semana |
| `pnda-visitas` | días 1 y 15, 8am | la PNDA publica el mes cerrado con 2-3 meses de retraso |
| `pnda-dji` | día 5, 8am | Contraloría actualiza esos CSV cada 1-2 meses |
| `pnda-oece` | día 1, 9am | datasets pesados, no cambian seguido |
| `jne-infogob` | día 5, 8am | el JNE republica tras cada proclamación/vacancia |
| `mef-presupuesto` | día 12, 8am | el devengado del mes cierra por esas fechas |

Cada uno, al dispararse: descarga el archivo de la fuente → sube el crudo a
`gs://vigia-peru-batch/raw/<fuente>/…` (ahí quedan los CSV/XLSX que pediste, un clic desde
GCS) → lo carga a Cloud SQL, todo dentro del mismo contenedor, sin tocar tu laptop.

**El mecanismo real** (por si alguna vez lo revisás en la consola): Cloud Scheduler no
"sabe" de Cloud Run directamente — le hace una llamada HTTP POST a la API de Google
(`run.googleapis.com/v2/…/jobs/<job>:run`) autenticada con la misma cuenta de servicio que
ya usa el resto del proyecto. Confirmé esto contra la documentación oficial antes de
escribirlo (no de memoria) y lo probé disparándolo a mano, no solo desplegándolo.

## 6. Los 2 que NO se agendaron — y por qué eso es lo correcto, no un pendiente

| Carpeta | Bloqueo confirmado | Dónde sigue corriendo |
|---|---|---|
| `oece_ocds` | 403 (WAF del OECE) | igual que siempre: tu laptop o el VPS de Lima, `scrapers-job.sh` |
| `onpe_claridad` | 403 (Cloudflare) + necesita un navegador con ventana real | igual que siempre: laptop/VPS con sesión gráfica (`ONPE=1`) |

La imagen de ambos **sí se construyó** (podés hacer `docker run` con ellas en el VPS si
alguna vez preferís contenedores a Python a pelo), pero agendarlas con Cloud Scheduler no
serviría de nada: Cloud Scheduler cambia *cuándo* corre algo, no *desde qué IP* — y el
problema de estos dos es la IP/el navegador, no el horario. Ponerles un cron en la nube solo
habría producido un 403 puntual cada vez, sin avisarte de nada útil.

## 7. Lo probé en producción de verdad, no solo "quedó desplegado"

Después de desplegar, disparé cada uno de los 6 a mano y leí los logs reales:

| Fuente | Resultado |
|---|---|
| `pnda_sancionados` | **Falló la primera vez** con un error real de la base de datos (ver §8) → corregido → segunda corrida OK |
| `pnda_visitas` | OK — bajó el reporte de mayo, vio que ya estaba cargado (mismo archivo, no repite trabajo) |
| `jne_infogob` | OK — 13 237 autoridades, confirmó que ya estaban al día |
| `pnda_oece` | OK |
| `pnda_dji` | OK — bajó 267.9 MB + 441.6 MB, confirmó que ya estaban cargados |
| `mef_presupuesto` | **Falló** — no es un bug mío, ver §9 |

## 8. Un bug real que encontré (y arreglé) de paso

La primera corrida de `pnda_sancionados` reventó con este error de Postgres:

```
psycopg2.errors.UniqueViolation: could not create unique index "osce_sancionados_ruc_res_uq"
DETAIL: Key (ruc, resolucion)=(20486298147, 2593-2019-TCE-S3) is duplicated.
```

Investigué: la tabla `osce_sancionados` tenía **27 pares duplicados** desde una carga de
mayo (33 filas exactamente repetidas), de antes de que el índice único llegara a existir. El
código del pipeline siempre intentó crear ese índice en cada corrida (correcto, así evita
duplicados futuros) pero con esos datos viejos sucios, la creación fallaba **siempre**, en
cada corrida, en tu laptop también — solo que quizás no lo habías notado porque el pipeline
seguía "pareciendo" correr bien hasta ese punto.

Lo arreglé en la base de datos (borré los 33 duplicados, dejando la fila más antigua de cada
par, y creé el índice) — no hizo falta tocar el código, la lógica ya era correcta. Segunda
corrida: perfecta.

## 9. Un problema que encontré y NO es mío — la API del MEF está rota

`mef_presupuesto` falló con `HTTP Error 404: Not Found` en **todas** las consultas (25
departamentos × varios años × varios desgloses, todos 404). Antes de asumir que era un
problema de nube, probé la misma consulta exacta desde tu laptop (IP peruana):

```
HTTP Error 404: Not Found
{"oDes": "Recurso no encontrado", "iURI": "/DatosAbiertos/v1/datastore_search_sql", ...}
```

Mismo resultado. Até más el cabo: hasta `package_search` (el catálogo general de la API)
devuelve el mismo 404 genérico. Conclusión: la API vieja del MEF (`DatosAbiertos v1`, la que
usaba este pipeline) parece haber cambiado o quedado obsoleta — no es un bloqueo de IP, es
que la fuente cambió de forma. Lo dejé agendado igual (no cuesta nada tenerlo esperando) y
ahora se ve claramente en `/admin/cobertura → Fuentes externas` con el error, en vez de
fallar en silencio en algún cron que nadie mira. Encontrar la URL nueva de la API del MEF es
una tarea aparte, si querés que la retome.

## 10. Cómo operar esto de acá en adelante

```bash
# ver todo lo que hay agendado
gcloud scheduler jobs list --location us-central1

# correr uno ahora mismo, sin esperar al cron
gcloud scheduler jobs run scraper-pnda-sancionados --location us-central1

# ver los logs de la última corrida
gcloud run jobs executions list --job scraper-pnda-sancionados --region us-central1

# agregar o redesplegar uno solo (por si cambia el código del pipeline)
bash infrastructure/deploy/cloud-scrapers.sh --solo pnda_dji

# desplegar todo de nuevo (base + los 8 + los 6 schedulers)
bash infrastructure/deploy/cloud-scrapers.sh
```

También queda visible desde la web: `/admin/cobertura → Fuentes externas` muestra, por
fuente, cuántas filas hay, cuándo fue la última carga y si la última tuvo error — sin entrar
a la consola de GCP.

## 11. Qué queda pendiente, si en algún momento lo querés retomar

- **MEF**: encontrar el endpoint nuevo de datos abiertos del MEF (el viejo `DatosAbiertos v1`
  ya no responde) y actualizar `backend/scripts/fetch_mef_budget.py`.
- **oece_ocds / onpe_claridad**: si algún día el VPS de Lima queda estable 24/7, se le puede
  agregar Cloud Scheduler → Pub/Sub → un pequeño receptor en el VPS, para que el *disparo*
  también sea automático (hoy el disparo es manual/cron local, no Cloud Scheduler).
- Documentación completa y técnica (matriz, cómo agregar una fuente nueva, límites conocidos):
  `backend/cloud_functions/README.md`.
