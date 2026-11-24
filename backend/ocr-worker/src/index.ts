/**
 * vigia-ocr · OCR abierto para las páginas escaneadas de los documentos del SEACE (Docling en un Cloudflare Container).
 *
 * Por qué (2026-11-24): el OCR se hacía con el modelo de visión de Workers AI dentro de cada análisis y, con el límite de
 * uso lleno, se perdía (en 7 días, 4 143 de 4 684 análisis perdieron parte de sus documentos). Aquí lo hace Docling
 * (RapidOCR + estructura de tablas), sin modelo de lenguaje ni límite de uso: sólo saca el texto y las tablas; ordenarlo
 * lo hace después el modelo.
 *
 *   GET  /salud                          sin token
 *   POST /ocr  {"paginas": [base64…]}    Bearer OCR_TOKEN → {"paginas": [{markdown, dudosa, segundos}], "segundos"}
 *
 * Cada pedido va a una de INSTANCIAS instancias al azar (standard-4: 4 vCPU, 12 GiB); una instancia sin pedidos se
 * apaga a los 10 minutos (se cobra la memoria mientras está prendida).
 */
import { Container, getRandom } from "@cloudflare/containers";

interface Env {
  LECTOR: DurableObjectNamespace<LectorOcr>;
  OCR_TOKEN: string;
  INSTANCIAS?: string;
}

export class LectorOcr extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "10m";
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/salud") return Response.json({ ok: true });
    if (!env.OCR_TOKEN || req.headers.get("authorization") !== `Bearer ${env.OCR_TOKEN}`) {
      return Response.json({ error: "no_autorizado" }, { status: 401 });
    }
    if (url.pathname !== "/ocr" || req.method !== "POST") return Response.json({ error: "no_encontrado" }, { status: 404 });
    const n = Math.max(1, Number(env.INSTANCIAS ?? "4") || 4);
    const instancia = await getRandom(env.LECTOR, n);
    return instancia.fetch(req);
  },
};
