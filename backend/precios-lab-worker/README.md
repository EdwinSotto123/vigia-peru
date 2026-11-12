# vigia-precios-lab

Laboratorio de exploración de precios (2026-11-12). Dado un producto, o el ítem de un contrato, busca su precio de mercado
en el Perú, juzga si cada oferta es el mismo producto y lo compara con lo que pagó el Estado. Se usa desde el panel:
**Admin → Laboratorio de precios** (`/admin/precios`, solo admin).

## Cómo funciona

| Paso | Qué hace | Con qué |
|---|---|---|
| entender | Arma la ficha: nombre, atributos obligatorios, unidad de comparación y búsquedas | GLM 5.3 flash (vigia-llm) |
| tiendas | Busca en 15 tiendas peruanas con precio estructurado | vigia-precios (service binding) |
| buscadores | Abre el buscador de tiendas armadas con JavaScript (Inkafarma y Mifarma, solo para productos de salud); los productos salen del JSON-LD del listado o GLM los copia del Markdown | Crawl4AI en contenedor, GLM |
| web | Busca páginas de venta en el Perú fuera de esas tiendas | Tavily |
| leer | Lee cada página: robots.txt, turno por dominio, schema.org; si falta, Crawl4AI (Browser Run de respaldo) y luego GLM | `fetch`, Crawl4AI, GLM |
| emparejar | Reglas, parecido (bge-m3) y juicio de GLM: ¿mismo producto?, ¿cuántas unidades trae? | Workers AI |
| resumir | Valida (moneda, unidades, precio visto en la página, extremos) y compara con la referencia | código |

La orquestación es un **Cloudflare Workflow** (`flujo.ts`). Cada paso se reintenta solo y, si el Worker se reinicia,
retoma desde el último paso terminado. No hay ADK ni LangChain: el flujo es fijo y cada precio queda con su evidencia,
así que un framework de agentes no suma. El modelo solo interpreta (ficha, juicio, leer un texto); los números los
calcula el código.

- **D1** `vigia-precios-lab`: investigaciones, pasos, ofertas y caché (Tavily 3 días, robots.txt 1 día). Esquema en `schema.sql`.
- **R2** `vigia-precios-lab`: la evidencia de cada página (`lab/<id>/web-<n>.json`: método, fragmento schema.org,
  texto alrededor del precio) y la respuesta de las tiendas (`lab/<id>/tiendas.json`). Nunca la página entera.
- **Durable Object** `Turnos`: como mucho un pedido por segundo a cada dominio, sumando todas las investigaciones.
- **Contenedor** `Lector` (`lector.ts`): Crawl4AI 0.9.4 (Apache 2.0), la imagen `docker.io/unclecode/crawl4ai` tal cual
  (Cloudflare la baja de Docker Hub; no hace falta Docker local). standard-1 (½ vCPU, 4 GiB), se duerme a los 5
  minutos sin uso. Solo este Worker le habla. La evidencia del buscador va a `lab/<id>/buscador-<n>.json`.

## Cortesía

Se presenta con su nombre (`VigiaPeru-PreciosLab/0.1`), también dentro de Crawl4AI, respeta robots.txt (y
`Content-Signal: ai-input=no`) y no insiste si el sitio responde 401, 403, 429, pide verificar que eres humano o pide
iniciar sesión. Los captchas no se intentan pasar: Crawl4AI corre sin `magic`, `simulate_user` ni `override_navigator`.

Buscadores revisados el 2026-11-12 y dejados fuera: MercadoLibre (manda a verificar la cuenta), Memory Kings e Impacto
(robots prohíbe su buscador), Dimerc y Sercoplus (responden 403), La Curacao y Efe (robots prohíbe `/search/`), Crisol, Real Plaza (ya no vende en línea), Makro (su listado no muestra precios sin elegir tienda; su API VTEX
sí, así que le corresponde a vigia-precios).

## API (solo por service binding; sin dirección pública)

`POST /research`, `GET /jobs`, `GET /jobs/:id`, `GET /results/:id`, `GET /evidencia/:id/:archivo`, `GET /salud`.
La API de Vigía la expone al panel en `/admin/precios-lab` (`backend/api/src/routes/admin_precios.ts`), que además arma
el pedido desde un contrato (`ocid` + `item`) y suma lo que pagó el Estado por el mismo CUBSO.

## Despliegue

```bash
npx wrangler d1 execute vigia-precios-lab --remote --file schema.sql   # una vez
bash infrastructure/deploy/cloudflare/worker.sh precios-lab
# secretos: LLM_TOKEN (/vigia/llm/token), PRECIOS_TOKEN (/vigia/precios/token), TAVILY_API_KEY (/vigia/tavily/api-key),
#   CRAWL4AI_TOKEN (/vigia/precios-lab/crawl4ai-token): Crawl4AI 0.9.4 sin token solo escucha en 127.0.0.1 y el Worker no lo alcanza
npm test && npx tsc --noEmit
```

## Costo

Unos US$ 0,005 a 0,02 por investigación: GLM 5.3 flash (US$ 0,15 y 0,50 por millón de tokens de entrada y salida) y
una búsqueda de Tavily (~US$ 0,008), más el contenedor mientras corre (standard-1: ~US$ 0,00002 por segundo; Workers
Paid incluye 25 GiB-hora de memoria al mes, unas 6 horas de este contenedor). Crawl4AI arma hasta 8 páginas de la web
por investigación, además de los buscadores.
