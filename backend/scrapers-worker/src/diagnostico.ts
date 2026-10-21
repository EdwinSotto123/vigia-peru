/**
 * Comprobaciones de lo que los scrapers necesitan desde Cloudflare, sin escribir nada:
 * base (Hyperdrive), COPY dentro de una transacción con tabla temporal, salida al OECE por el relay y
 * directa (la directa debe dar 403), la PNDA, el API del MEF, R2 y (aparte, `cgr`) el buscador de la Contraloría.
 * `colo` es el punto de Cloudflare por donde sale el pedido (de él depende que el WAF de cada sitio responda).
 */

import type { Env } from "./config.ts";
import { conDb } from "./db.ts";
import { obtener } from "./http.ts";

type Resultado = Record<string, unknown>;

async function medir(fn: () => Promise<Resultado>): Promise<Resultado> {
  const t0 = Date.now();
  try {
    return { ...(await fn()), ms: Date.now() - t0 };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e).slice(0, 300), ms: Date.now() - t0 };
  }
}

export async function colo(): Promise<string | null> {
  const r = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(10_000) });
  return /^colo=(\w+)$/m.exec(await r.text())?.[1] ?? null;
}

const ayer = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

export async function diagnosticar(env: Env, partes: Set<string>): Promise<Resultado> {
  const todo = partes.size === 0;
  const out: Resultado = {};
  out.colo = await colo().catch((e) => `error: ${e}`);
  if (todo || partes.has("db")) {
    out.db = await medir(() => conDb(env.HYPERDRIVE, async (db) => {
      const [f] = await db.filas<{ usuario: string; ahora: string }>("SELECT current_user AS usuario, now()::text AS ahora");
      // COPY real dentro de una transacción que se descarta: la tabla temporal muere con el ROLLBACK.
      await db.ejecutar("BEGIN");
      try {
        await db.ejecutar("CREATE TEMP TABLE prueba_copia (a int, b text) ON COMMIT DROP");
        const csv = "a,b\n" + Array.from({ length: 5000 }, (_, i) => `${i},"fila ${i}, con coma"`).join("\n") + "\n";
        const n = await db.copiar("COPY prueba_copia (a, b) FROM STDIN WITH (FORMAT csv, HEADER true)",
          new Blob([csv]).stream());
        const [c] = await db.filas<{ n: string }>("SELECT count(*)::text AS n FROM prueba_copia");
        return { ...f, copia: n, contadas: Number(c.n) };
      } finally {
        await db.ejecutar("ROLLBACK").catch(() => undefined);
      }
    }));
  }
  const oece = `https://contratacionesabiertas.oece.gob.pe/api/v1/releasesAfter?size=1&startDate=${ayer()}&endDate=${ayer()}`;
  if (todo || partes.has("relay")) {
    out.oece_relay = await medir(async () => {
      const r = await obtener(env, oece, { relay: true, sinReintentos: true });
      const cuerpo = await r.text();
      return { status: r.status, bytes: cuerpo.length, releases: r.ok ? (JSON.parse(cuerpo).releases ?? []).length : null };
    });
  }
  if (todo || partes.has("oece")) {
    out.oece_directo = await medir(async () => {
      const r = await obtener(env, oece, { sinReintentos: true });
      await r.body?.cancel();
      return { status: r.status };
    });
  }
  if (todo || partes.has("pnda")) {
    out.pnda = await medir(async () => {
      const r = await obtener(env, "https://www.datosabiertos.gob.pe/dataset/proveedores-sancionados-2025", { sinReintentos: true });
      const html = await r.text();
      return { status: r.status, bytes: html.length, titulo: /<title>([^|<]+)/.exec(html)?.[1]?.trim() ?? null };
    });
  }
  if (todo || partes.has("mef")) {
    out.mef = await medir(async () => {
      const r = await obtener(env, "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search?resource_id=510bae6d-3d37-4fb2-af35-a40ce01715f4&limit=1", { sinReintentos: true });
      await r.body?.cancel();
      return { status: r.status };
    });
  }
  if (partes.has("mef_vel")) {
    // Velocidad de bajada del ZIP del MEF desde este punto (los primeros 20 MB con Range).
    out.mef_vel = await medir(async () => {
      const t0 = Date.now();
      const r = await fetch("https://fs.datosabiertos.mef.gob.pe/datastorefiles/2026-Gasto-Diario.zip",
        { headers: { Range: "bytes=0-20971519", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0" } });
      let n = 0;
      for await (const t of r.body!) n += t.byteLength;
      const s = (Date.now() - t0) / 1000;
      return { status: r.status, mb: +(n / 1e6).toFixed(1), segundos: +s.toFixed(1), mb_s: +(n / 1e6 / s).toFixed(2) };
    });
  }
  if (partes.has("mef_agregar")) {
    // La agregación del MEF entera, sin base ni Workflow: cuánto tarda en este runtime (no escribe nada).
    out.mef_agregar = await medir(async () => {
      const { agregarZip } = await import("./mef_agregado.ts");
      const t0 = Date.now();
      const r = await fetch("https://fs.datosabiertos.mef.gob.pe/datastorefiles/2026-Gasto-Diario.zip", { headers: { "User-Agent": "Mozilla/5.0 Chrome/126.0" } });
      let bytes = 0;
      const contador = new TransformStream<Uint8Array, Uint8Array>({ transform(t, c) { bytes += t.byteLength; c.enqueue(t); } });
      const a = await agregarZip(r.body!.pipeThrough(contador));
      return { filas: a.filas, ejecutoras: a.ejecutoras.size, desglose: a.desglose.size, mb: Math.round(bytes / 1e6), segundos: (Date.now() - t0) / 1000 };
    });
  }
  if (partes.has("cgr")) {
    // Buscador de la Contraloría (fuente contraloria_informes): directo, por el relay y con Browser Rendering. Su
    // servidor no responde a IPs de fuera del Perú (2026-10-21: timeout desde AWS us-east-2 y 522 desde Zúrich).
    const { urlPagina } = await import("./fuentes/contraloria_informes.ts");
    const url = urlPagina(1).replace("PageSize=1000", "PageSize=1");
    const filas = (t: string) => { try { return (JSON.parse(t) as unknown[]).length; } catch { return null; } };
    out.cgr_directo = await medir(async () => {
      const r = await obtener(env, url, { sinReintentos: true, timeoutMs: 25_000 });
      const t = await r.text();
      return { status: r.status, filas: filas(t) };
    });
    out.cgr_relay = await medir(async () => {
      const r = await obtener(env, url, { relay: true, sinReintentos: true, timeoutMs: 25_000 });
      const t = await r.text();
      return { status: r.status, filas: filas(t) };
    });
    out.cgr_navegador = await medir(async () => {
      const { default: puppeteer } = await import("@cloudflare/puppeteer");
      const navegador = await puppeteer.launch(env.BROWSER);
      try {
        const pagina = await navegador.newPage();
        const r = await pagina.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const t = (await pagina.evaluate("document.body ? document.body.innerText : ''")) as string;
        return { status: r?.status() ?? null, filas: filas(t) };
      } finally {
        await navegador.close().catch(() => undefined);
      }
    });
  }
  if (partes.has("pte")) {
    // Portal de Transparencia Estándar, personal (planilla por entidad y mes) y SERVIR Talento Perú (plazas CAS):
    // si responden desde Cloudflare, se cargan en el Worker; si no, desde una PC en el Perú, como la Contraloría.
    const pte = "https://www.transparencia.gob.pe/personal/pte_transparencia_personal.aspx";
    const cuerpo = "ch_tipo_busqueda=1&id_entidad=143&id_tema=31&in_anno_consulta=2025&ch_mes_consulta=12&vc_nombre_funcionario=&vc_dni_funcionario=&ch_tipo_regimen=1";
    out.pte_directo = await medir(async () => {
      const r = await fetch(pte, { method: "POST", body: cuerpo, signal: AbortSignal.timeout(25_000),
                                   headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" } });
      const t = await r.text();
      return { status: r.status, bytes: t.length, conListado: t.includes("LISTADO DE PERSONAL") };
    });
    out.pte_relay = await medir(async () => {
      const r = await obtener(env, `${pte}?id_entidad=143&id_tema=31&ver=`, { relay: true, sinReintentos: true, timeoutMs: 25_000 });
      const t = await r.text();
      return { status: r.status, bytes: t.length, conFormulario: t.includes("frm_busqueda") };
    });
    out.servir_directo = await medir(async () => {
      const r = await obtener(env, "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml", { sinReintentos: true, timeoutMs: 25_000 });
      const t = await r.text();
      return { status: r.status, bytes: t.length, conOfertas: /cuadro-vacantes|Ofertas Laborales/.test(t) };
    });
  }
  if (todo || partes.has("r2")) {
    out.r2 = await medir(async () => {
      const l = await env.CRUDOS.list({ prefix: "raw/", limit: 5 });
      return { objetos: l.objects.length, truncado: l.truncated };
    });
  }
  return out;
}
