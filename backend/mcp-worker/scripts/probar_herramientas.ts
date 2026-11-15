/**
 * Prueba las herramientas del MCP v2 de punta a punta SIN pasar por el OAuth: corre el mismo código de cada herramienta
 * (validación de entrada con su esquema + `ejecutar`) contra la API de producción.
 *
 *   cd backend/mcp-worker
 *   npx esbuild scripts/probar_herramientas.ts --bundle --platform=node --format=esm --outfile=.wrangler-dist/probar.mjs \
 *     --external:cloudflare:workers --log-level=error && node .wrangler-dist/probar.mjs
 *
 * La API es privada: pide un navegador y la cabecera de pruebas `x-gobserva-prueba` (GOBSERVA_PRUEBA en el entorno).
 * `rastro_persona` necesita además MCP_INTERNO_TOKEN; sin él esa prueba se salta. No imprime secretos ni nombres enteros.
 */
import { z } from "zod";
import { normaAplicable, patrones, preciosReferencia, redEmpresa } from "../src/v2/herramientas/actores";

const PRUEBA = process.env.GOBSERVA_PRUEBA ?? "";
if (!PRUEBA) {
  console.error("Falta GOBSERVA_PRUEBA en el entorno.");
  process.exit(2);
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const env = {
  VIGIA_URL: "https://vigia.gobserva.cloud",
  MCP_URL: "https://mcp.gobserva.cloud",
  MCP_INTERNO_TOKEN: process.env.MCP_INTERNO_TOKEN,
  API: {
    fetch: (req: Request) => {
      const u = new URL(req.url);
      const h = new Headers(req.headers);
      h.set("user-agent", UA);
      h.set("x-gobserva-prueba", PRUEBA);
      return fetch(`https://vigia.gobserva.cloud${u.pathname}${u.search}`, { method: req.method, headers: h });
    },
  },
} as never;

type Caso = { h: { nombre: string; entrada: z.ZodRawShape; ejecutar: (a: never, cx: never) => Promise<unknown> }; args: Record<string, unknown>; espera: (r: Record<string, unknown>) => string | null };
const lista = (r: Record<string, unknown>, k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]) : []);
const hay = (k: string, min = 1) => (r: Record<string, unknown>) => (lista(r, k).length >= min ? null : `«${k}» trae ${lista(r, k).length} filas (se esperaban ${min} o más)`);

const CASOS: Caso[] = [
  { h: patrones as never, args: { alcance: "entidad" }, espera: hay("patrones") },
  { h: patrones as never, args: { alcance: "proveedor" }, espera: hay("patrones") },
  { h: patrones as never, args: { alcance: "relleno" }, espera: hay("pares") },
  { h: patrones as never, args: { alcance: "consorcio" }, espera: hay("pares") },
  { h: patrones as never, args: { alcance: "renovacion" }, espera: hay("renovaciones") },
  // El socio sale con un apellido tapado y cada grupo trae dos empresas o más.
  { h: patrones as never, args: { alcance: "dueno" },
    espera: (r) => (lista(r, "grupos").length >= 5 && lista(r, "grupos").every((g) => ((g as { empresas: unknown[] }).empresas ?? []).length >= 2 && /•/.test(String((g as { socio?: string }).socio ?? "•")))
      ? null : "grupos sin dos empresas o con el nombre del socio sin tapar") },
  { h: preciosReferencia as never, args: { que: "papel bond a4 75" }, espera: hay("productos") },
  { h: preciosReferencia as never, args: { que: "vigilancia", tipo: "servicio" }, espera: hay("servicios", 5) },
  // Un proceso de 2025 recibe el artículo 46 del Reglamento como regía antes del 14-01-2026; uno de 2026, el vigente.
  { h: normaAplicable as never, args: { pregunta: "estrategia de contratación: contenido y elaboración", fecha: "2025-09-01" },
    espera: (r) => (lista(r, "normas_que_regian").some((x) => /regía hasta/.test(String((x as { version?: string }).version ?? ""))) ? null : "no trajo el texto anterior del artículo modificado") },
  { h: normaAplicable as never, args: { pregunta: "parientes del alcalde impedidos de contratar", fecha: "2026-03-01" },
    espera: (r) => (lista(r, "normas_que_regian").some((x) => (x as { articulo?: string }).articulo === "30") && lista(r, "criterios_de_esa_ley").length ? null : "sin el artículo 30 o sin criterios") },
  { h: normaAplicable as never, args: { pregunta: "impedimentos para contratar", fecha: "2023-05-10" },
    espera: (r) => (/30225/.test(String(r.rige)) && lista(r, "normas_que_regian").length ? null : "un proceso de 2023 debe regirse por la Ley 30225") },
  { h: redEmpresa as never, args: { ruc: "20100210909" }, espera: (r) => (lista(r, "socias_de_consorcio_que_compiten").length ? null : "sin socias de consorcio para una aseguradora que las tiene") },
];

let fallos = 0;
for (const c of CASOS) {
  const t0 = Date.now();
  try {
    const args = z.object(c.h.entrada).parse(c.args);
    const r = (await c.h.ejecutar(args as never, { env, usuario: null } as never)) as Record<string, unknown>;
    const mal = c.espera(r);
    const texto = JSON.stringify(r);
    // Privacidad: ni un documento de 8 dígitos suelto ni un RUC 10 en lo que sale.
    const dni = /(?<![\d.,])\d{8}(?![\d.,])/.test(texto.replace(/"(ocid|ejemplos_ocid|enlace[a-z_]*)":\s*("[^"]*"|\[[^\]]*\])/g, ""));
    const ruc10 = /(?<!\d)10\d{9}(?!\d)/.test(texto);
    if (mal || ruc10) fallos++;
    console.log(`${mal || ruc10 ? "FALLA" : "ok   "} ${c.h.nombre} ${JSON.stringify(c.args)} ${Date.now() - t0} ms, ${texto.length} bytes` +
      (mal ? ` → ${mal}` : "") + (ruc10 ? " → sale un RUC 10" : "") + (dni ? " (hay un número de 8 dígitos: revisar)" : ""));
  } catch (e) {
    fallos++;
    console.log(`FALLA ${c.h.nombre} ${JSON.stringify(c.args)} → ${(e as Error).message.slice(0, 200)}`);
  }
}
console.log(fallos ? `${fallos} con falla` : "todas bien");
process.exit(fallos ? 1 : 0);
