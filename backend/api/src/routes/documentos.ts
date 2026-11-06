/**
 * Documentos de varios contratos juntos (MCP de Vigía y chat del panel: «arma un ZIP con las bases y actas de …»).
 *
 *   GET /documentos/indice?ocid=1228227&ocid=…   hasta 10 procesos: qué documentos hay guardados, su tamaño y cuáles no
 *   GET /documentos/zip?ocid=1228227&ocid=…      el ZIP en streaming desde R2 (vigia-peru-batch), con indice.csv
 *
 * Son copias de documentos públicos del SEACE que Vigía ya guardó (documentos_gcs, la misma fila que usa
 * /contratos/:ocid/documento). Lo que no está guardado va en el índice con su enlace al SEACE. Sin compresión (los PDF ya
 * vienen comprimidos): el ZIP sale a medida que se lee cada archivo. Tope: 10 procesos y 300 MB por ZIP, y 6 ZIP cada
 * 10 minutos por IP.
 */
import { Hono } from "hono";
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { pool } from "../lib/db.js";
import { ambitoPedido } from "../lib/plataforma.js";
import { dentroDeTope, ipCliente } from "../lib/antibots.js";

export const documentosRouter = new Hono();

const MAX_PROCESOS = 10;
const MAX_BYTES = 300 * 1024 * 1024;

interface Doc {
  ocid: string;
  tipo: string | null;
  titulo: string | null;
  formato: string | null;
  bytes: number | null;
  urlGcs: string;
  urlOrigen: string | null;
}

function ocidsDe(url: URL): string[] | string {
  const lista = Array.from(new Set(url.searchParams.getAll("ocid").flatMap((x) => x.split(",")).map((x) => x.trim().replace(/^OECE-/i, "")).filter(Boolean)));
  if (!lista.length) return "Indica al menos un proceso: ?ocid=1228227 (hasta 10).";
  if (lista.length > MAX_PROCESOS) return `Hasta ${MAX_PROCESOS} procesos por ZIP (pediste ${lista.length}).`;
  if (lista.some((x) => !/^[\w.-]{1,64}$/.test(x))) return "Algún código no es un OCID ni un código de convocatoria.";
  return lista;
}

async function documentos(ocids: string[]): Promise<Doc[]> {
  const r = await pool.query<Doc>(
    `SELECT DISTINCT ON (d.url_gcs) ocid_corto(d.ocid) AS ocid, d.tipo, d.titulo, lower(d.formato) AS formato, d.bytes,
            d.url_gcs AS "urlGcs", d.url_origen AS "urlOrigen"
       FROM documentos_gcs d
      WHERE ocid_corto(d.ocid) = ANY(SELECT ocid_corto(x) FROM unnest($1::text[]) x)
        AND d.borrado_at IS NULL AND d.expira_at > now()
      ORDER BY d.url_gcs, d.creado_at DESC`,
    [ocids],
  );
  return r.rows.sort((a, b) => a.ocid.localeCompare(b.ocid) || String(a.titulo).localeCompare(String(b.titulo)));
}

/** Nombre de archivo seguro y único dentro del ZIP: «1228227/Bases_Administrativas.pdf». */
function nombres(docs: Doc[]): string[] {
  const usados = new Set<string>();
  return docs.map((d) => {
    const base = (d.titulo ?? d.tipo ?? "documento").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "documento";
    let n = `${d.ocid}/${base}.${d.formato || "bin"}`;
    for (let i = 2; usados.has(n); i++) n = `${d.ocid}/${base}_${i}.${d.formato || "bin"}`;
    usados.add(n);
    return n;
  });
}

const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

documentosRouter.get("/indice", async (c) => {
  const ocids = ocidsDe(new URL(c.req.url));
  if (typeof ocids === "string") return c.json({ error: "pedido_invalido", detail: ocids }, 400);
  const docs = await documentos(ocids);
  const archivos = nombres(docs);
  const bytes = docs.reduce((n, d) => n + Number(d.bytes ?? 0), 0);
  c.header("Cache-Control", "public, max-age=300");
  return c.json({
    procesos: ocids,
    sin_documentos: ocids.filter((o) => !docs.some((d) => d.ocid === o.replace(/^.*-/, "") || d.ocid === o)),
    documentos: docs.map((d, i) => ({ ocid: d.ocid, archivo: archivos[i], titulo: d.titulo, tipo: d.tipo, formato: d.formato, bytes: d.bytes, seace: d.urlOrigen })),
    total_bytes: bytes,
    cabe_en_un_zip: bytes <= MAX_BYTES,
    zip: `/v1/documentos/zip?${ocids.map((o) => `ocid=${encodeURIComponent(o)}`).join("&")}`,
  });
});

documentosRouter.get("/zip", async (c) => {
  const ocids = ocidsDe(new URL(c.req.url));
  if (typeof ocids === "string") return c.json({ error: "pedido_invalido", detail: ocids }, 400);
  if (!(await dentroDeTope(`zip|${ipCliente(c)}`, 6, 600))) {
    return c.json({ error: "demasiados_pedidos", detail: "Son muchos ZIP seguidos: espera unos minutos.", reintentarEn: 600 }, 429);
  }
  const docs = await documentos(ocids);
  if (!docs.length) return c.json({ error: "sin_documentos", detail: "Vigía no tiene guardado ningún documento de esos procesos." }, 404);
  const bytes = docs.reduce((n, d) => n + Number(d.bytes ?? 0), 0);
  if (bytes > MAX_BYTES) return c.json({ error: "zip_grande", detail: `Pesa ${Math.round(bytes / 1048576)} MB: pide menos procesos (tope ${MAX_BYTES / 1048576} MB).` }, 413);
  const ambito = ambitoPedido.getStore();
  const archivos = nombres(docs);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const escritor = writable.getWriter();
  const zip = new Zip((err, trozo, final) => {
    if (err) {
      void escritor.abort(err);
      return;
    }
    void escritor.write(trozo);
    if (final) void escritor.close();
  });

  const llenar = async () => {
    const indice = ["ocid,archivo,titulo,tipo,formato,bytes,guardado,seace"];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(d.urlGcs);
      const objeto = m ? await ambito?.almacen?.(m[1])?.get(m[2]) : null;
      indice.push([d.ocid, archivos[i], d.titulo, d.tipo, d.formato, d.bytes, objeto ? "si" : "no", d.urlOrigen].map(csv).join(","));
      if (!objeto) continue;
      const entrada = new ZipPassThrough(archivos[i]);
      zip.add(entrada);
      const lector = objeto.body.getReader();
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        entrada.push(value as Uint8Array);
      }
      entrada.push(new Uint8Array(0), true);
    }
    const leeme = new ZipPassThrough("indice.csv");
    zip.add(leeme);
    leeme.push(strToU8(`﻿${indice.join("\r\n")}\r\n`), true);
    zip.end();
  };
  llenar().catch((e) => void escritor.abort(e));

  const nombre = ocids.length === 1 ? `vigia-${ocids[0]}-documentos.zip` : `vigia-${ocids.length}-procesos-documentos.zip`;
  return new Response(readable, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
