# vigia-precios-lab

Laboratorio de exploración de precios (2026-11-12). Dado un producto, o el ítem de un contrato, busca su precio de mercado
en el Perú, juzga si cada oferta es el mismo producto y lo compara con lo que pagó el Estado. Se usa desde el panel:
**Admin → Laboratorio de precios** (`/admin/precios`, solo admin).

## Cómo funciona

| Paso | Qué hace | Con qué |
|---|---|---|
| entender | Arma la ficha: nombre, atributos obligatorios, unidad de comparación y búsquedas | GLM 5.3 flash (vigia-llm) |
| tiendas | Busca en 15 tiendas peruanas con precio estructurado | vigia-precios (service binding) |
| web | Busca páginas de venta en el Perú fuera de esas tiendas | Tavily |
| leer | Lee cada página: robots.txt, turno por dominio, schema.org; si falta, navegador y luego GLM | `fetch`, Browser Run, GLM |
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

## Cortesía

Se presenta con su nombre (`VigiaPeru-PreciosLab/0.1`), respeta robots.txt y no insiste si el sitio responde 401, 403,
429 o pide verificar que eres humano. Los captchas no se intentan pasar.

## API (solo por service binding; sin dirección pública)

`POST /research`, `GET /jobs`, `GET /jobs/:id`, `GET /results/:id`, `GET /evidencia/:id/:archivo`, `GET /salud`.
La API de Vigía la expone al panel en `/admin/precios-lab` (`backend/api/src/routes/admin_precios.ts`), que además arma
el pedido desde un contrato (`ocid` + `item`) y suma lo que pagó el Estado por el mismo CUBSO.

## Despliegue

```bash
npx wrangler d1 execute vigia-precios-lab --remote --file schema.sql   # una vez
bash infrastructure/deploy/cloudflare/worker.sh precios-lab
# secretos: LLM_TOKEN (/vigia/llm/token), PRECIOS_TOKEN (/vigia/precios/token), TAVILY_API_KEY (/vigia/tavily/api-key)
npm test && npx tsc --noEmit
```

## Costo

Unos US$ 0,005 a 0,02 por investigación: GLM 5.3 flash (US$ 0,15 y 0,50 por millón de tokens de entrada y salida) y
una búsqueda de Tavily (~US$ 0,008). Browser Run solo abre hasta 3 páginas por investigación.
