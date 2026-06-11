# Vigía — Servicio local de descarga (puente residencial PE)

SEACE bloquea IPs de datacenter (Cloud Run, Cloudflare colos) con `403`, pero
acepta IPs residenciales peruanas. Este contenedor corre en **tu máquina** (IP
peruana), descarga los PDFs del SEACE, los sube al bucket GCS y le devuelve la
URL al orquestador. Todo en memoria — no deja archivos en disco.

```
Orquestador (Cloud Run)  ──POST /download {url, ocid}──▶  Túnel CF  ──▶  este contenedor (tu IP PE)
        ▲                                                                      │
        └────────────  { gcs_path: gs://… }  ◀───────  sube a GCS  ◀──────────┘
```

---

## 1. Requisitos

- Docker Desktop con WSL2 (Windows).
- `gcloud` CLI autenticado en el proyecto `vivid-spot-480905-a4`.
- (Opción A del túnel) un dominio gestionado en Cloudflare.

## 2. Crear el service account (para subir al bucket)

Ejecuta esto **tú** (yo nunca toco tu llave). En PowerShell:

```powershell
$PROJECT = "vivid-spot-480905-a4"
$SA = "vigia-downloader"

# 2.1 Crear el SA
gcloud iam service-accounts create $SA `
  --project $PROJECT `
  --display-name "Vigia local downloader"

# 2.2 Darle permiso de escribir SOLO en el bucket de documentos
gcloud storage buckets add-iam-policy-binding gs://vigia-peru-documentos `
  --member "serviceAccount:$SA@$PROJECT.iam.gserviceaccount.com" `
  --role roles/storage.objectAdmin

# 2.3 Generar la llave JSON y dejarla en esta carpeta como sa-key.json
gcloud iam service-accounts keys create .\sa-key.json `
  --iam-account "$SA@$PROJECT.iam.gserviceaccount.com"
```

Queda `downloader/sa-key.json`. **No lo subas a git** (ya está en `.dockerignore`).

## 3. Configurar variables

```powershell
Copy-Item .env.example .env
# Genera un token secreto:
python -c "import secrets;print(secrets.token_urlsafe(32))"
```

Pega ese valor en `VIGIA_DL_TOKEN` dentro de `.env`. **Guarda ese mismo token**
— el orquestador lo necesita (paso 6).

## 4. Túnel Cloudflare

### Opción A — túnel con nombre (URL estable, recomendado)
1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel**.
2. Tipo *Cloudflared*. Ponle nombre (ej. `vigia-downloader`).
3. En **Public Hostname**: elige un subdominio de tu dominio (ej.
   `descargas.tudominio.com`) y apúntalo al servicio `http://downloader:8080`.
4. Copia el **token** del túnel y pégalo en `TUNNEL_TOKEN` del `.env`.

La URL pública será `https://descargas.tudominio.com`.

### Opción B — túnel rápido (sin dominio, URL aleatoria)
En `docker-compose.yml` comenta el bloque `tunnel` y descomenta `tunnel-quick`.
La URL (`https://xxxx.trycloudflare.com`) aparece en los logs:
```powershell
docker compose logs -f tunnel-quick
```
> Ojo: esa URL cambia en cada reinicio → tendrás que actualizar el env del
> orquestador cada vez. Para el demo, la Opción A es mucho mejor.

## 5. Levantar

```powershell
docker compose up -d --build
docker compose logs -f downloader
```

Prueba local (incluye tu token):

`/download` — PDFs/ZIPs → suben a GCS:
```powershell
curl.exe -s -X POST http://127.0.0.1:8080/download `
  -H "Content-Type: application/json" `
  -H "X-Vigia-Token: TU_TOKEN" `
  -d '{\"url\":\"https://prod1.seace.gob.pe/SeaceWeb-PRO/SdescargarArchivoAlfresco?fileCode=XXXX\",\"ocid\":\"ocds-dgv273-seacev3-1212841\"}'
```
Respuesta: `{ "ok": true, "gcs_path": "gs://vigia-peru-documentos/convocatorias/…", "bytes": 3630398, … }`

`/fetch` — metadata OCDS (JSON) → devuelve el body directo (sin GCS):
```powershell
curl.exe -s -X POST http://127.0.0.1:8080/fetch `
  -H "Content-Type: application/json" `
  -H "X-Vigia-Token: TU_TOKEN" `
  -d '{\"url\":\"https://contratacionesabiertas.oece.gob.pe/api/v1/record/ocds-dgv273-seacev3-1212841\"}'
```
Respuesta: `{ "ok": true, "status": 200, "content_type": "application/json", "body": "{...OCDS...}" }`

## Endpoints

| Endpoint | Para qué | Devuelve |
|---|---|---|
| `POST /download` | PDFs/ZIPs del SEACE | sube a GCS → `{gcs_path, gcs_url, bytes}` |
| `POST /fetch` | metadata OCDS (JSON) de OECE | el body directo → `{ok, status, body}` |
| `GET /health` | estado | `{ok, bucket, protected}` |

Con `/fetch` cableado, el orquestador trae la **metadata por tu IP peruana** →
**ya no hace falta pegar el JSON a mano**: basta el código de la convocatoria.

## 6. Conectar el orquestador

El orquestador ya tiene el path de fallback en el código (`tools/documentos.py`),
pero ese código aún no está desplegado. Cuando tengas la URL del túnel, hay que
**redeployar el código + setear las dos env vars** en un solo paso (un
`update-env-vars` solo no basta: usaría la imagen vieja sin el path nuevo):

```powershell
cd ..\functions\agent-orchestrator-adk
gcloud run deploy agent-orchestrator-adk --source . --region us-central1 --max-instances=2 `
  --update-env-vars "LOCAL_DOWNLOADER_URL=https://descargas.tudominio.com,LOCAL_DOWNLOADER_TOKEN=TU_TOKEN"
```

(Usa la misma URL del túnel y el mismo token del paso 3.) Yo puedo hacer este
deploy por ti cuando me pases la URL del túnel.

A partir de ahí, cuando un PDF no esté en GCS, el orquestador llama a tu
contenedor → descarga con IP peruana → sube a GCS → procesa. ✅

## Seguridad

- El acceso se controla con el **token compartido** (`X-Vigia-Token`). Detrás de
  un túnel el filtrado por IP no sirve (todo parece venir de localhost), así que
  el token ES el control de acceso — solo el orquestador lo conoce.
- El servicio solo escucha en `127.0.0.1:8080` localmente; al exterior solo se
  llega por el túnel.
- (Opcional, más seguro) añade **Cloudflare Access** sobre el hostname del túnel.
