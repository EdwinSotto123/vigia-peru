/**
 * Comprobaciones de lo que los scrapers necesitan desde Cloudflare, sin escribir nada:
 * base (Hyperdrive), COPY dentro de una transacción con tabla temporal, salida al OECE por el relay y
 * directa (la directa debe dar 403), la PNDA, el API del MEF y R2. `colo` es el punto de Cloudflare
 * por donde sale el pedido (de él depende que el WAF de cada sitio responda).
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
  if (todo || partes.has("r2")) {
    out.r2 = await medir(async () => {
      const l = await env.CRUDOS.list({ prefix: "raw/", limit: 5 });
      return { objetos: l.objects.length, truncado: l.truncated };
    });
  }
  return out;
}
