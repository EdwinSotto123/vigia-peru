# vigia-ocr

OCR abierto para las páginas escaneadas de los documentos del SEACE. Es el Worker `vigia-ocr` con Docling (RapidOCR
más estructura de tablas) en un Cloudflare Container. URL: `https://vigia-ocr.vigiaperu.workers.dev`.

Sólo saca el texto y las tablas (como tablas Markdown). No usa un modelo de lenguaje ni tiene límite de uso: ordenar el
texto lo hace después el modelo.

## Por qué

Hasta el 24 de noviembre de 2026 el OCR se hacía con el modelo de visión de Workers AI dentro de cada análisis. Con el
límite de uso lleno se perdía: en 7 días, 4 143 de 4 684 análisis perdieron parte de sus documentos.

## Quién lo usa

- **La lectura previa** (`backend/scripts/lectura_previa.py`): lee enteros los documentos de un contrato antes de
  analizarlo y los deja guardados (`documentos_texto` y la caché de la extracción). El análisis los encuentra hechos.
  Por defecto usa este servicio (`LECTURA_PREVIA_OCR=servicio`).
- **Los agentes** (`backend/agent/tools/documentos/ocr_servicio.py`), cuando tienen `OCR_URL` y `OCR_TOKEN`.
  `infrastructure/deploy/aws/agentes.sh` los pone si el token está en SSM (`/vigia/ocr/token`).

## Rutas

| Ruta | Qué hace |
|---|---|
| `GET /salud` | sin token |
| `POST /ocr` | `{"paginas": [base64…]}` con `Authorization: Bearer <OCR_TOKEN>`; devuelve `{"paginas": [{markdown, dudosa, segundos}], "segundos"}` |

Una página `dudosa` (números de ítem que no son correlativos, una cantidad con un símbolo de moneda suelto, filas de
ítem fuera de una tabla) conviene leerla con otro motor. Lo decide quien llama.

## Cómo corre

- `src/index.ts`: el Worker revisa el token y manda cada pedido a una de `INSTANCIAS` instancias al azar (hoy 10).
- `contenedor/`: la imagen (`Dockerfile`, Python 3.12, torch sólo CPU, Docling, FastAPI). Los modelos de OCR quedan
  dentro de la imagen (`calentar.py`). `app.py` es el servicio.
- Instancias `standard-4` (4 vCPU, 12 GiB), con un tope de 12 a la vez (`max_instances`). Cada una lee de a una página
  y se apaga a los 10 minutos sin pedidos.

Secreto: `OCR_TOKEN` (`npx wrangler secret put OCR_TOKEN`; copia en SSM `/vigia/ocr/token`).

## Desplegar

```bash
cd backend/ocr-worker
npm ci
npm run deploy       # wrangler deploy: construye la imagen de contenedor/Dockerfile y la sube
```

Construir la imagen pide Docker en la PC. Este Worker no está en `infrastructure/deploy/cloudflare/worker.sh` ni en
`.gitlab-ci.yml`. No hay pruebas automáticas.
