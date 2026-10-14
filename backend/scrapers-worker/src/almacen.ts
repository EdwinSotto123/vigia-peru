/**
 * Crudos de cada fuente en R2, con su manifiesto: lo de backend/scrapers/_core/storage.py con R2 como
 * disco (en Cloud Run el disco era efímero y cada corrida volvía a bajar todo; acá el manifiesto
 * persiste y un archivo que la fuente no cambió no se vuelve a bajar).
 *
 *   raw/<fuente>/<AAAA-MM-DD>/<archivo>    por defecto (carpeta = día de descarga, hora de Lima)
 *   raw/<fuente>/<clave>/<archivo>         con `subdir` (el periodo AAAA-MM, la parte, …)
 *   raw/<fuente>/manifest.json             historial: url, sha256, bytes, fecha de descarga, fecha de la fuente
 *
 * La idempotencia de la carga sigue siendo `datasets_cargas` (sha256 por fuente y clave).
 */

import type { Env } from "./config.ts";
import { ErrorHttp, obtener } from "./http.ts";
import { registrar } from "./registro.ts";
import { fechaLima } from "./fuentes/comun.ts";

export const BUCKET = "vigia-peru-crudos";
/** Sin Content-Length (o con compresión) el archivo se junta en memoria antes de subirlo: hasta acá. */
const MAX_EN_MEMORIA = 64 << 20;

export interface Entrada {
  url: string;
  /** Ruta relativa a raw/ (`pnda_dji/empleos/dji_empleos.csv`), como `Entry.file` de Python. */
  file: string;
  sha256: string;
  bytes: number;
  downloaded_at: string;
  modified: string | null;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** `r2://vigia-peru-crudos/raw/<file>`: lo que va a `datasets_cargas.gcs_uri`. */
export const uri = (e: Entrada) => `r2://${BUCKET}/raw/${e.file}`;
export const nombreArchivo = (e: Entrada) => e.file.slice(e.file.lastIndexOf("/") + 1);

export class Almacen {
  private entradas: Entrada[] | null = null;
  private readonly env: Env;
  readonly fuente: string;

  constructor(env: Env, fuente: string) {
    this.env = env;
    this.fuente = fuente;
  }

  private get claveManifiesto() {
    return `raw/${this.fuente}/manifest.json`;
  }

  async manifiesto(): Promise<Entrada[]> {
    if (!this.entradas) {
      const obj = await this.env.CRUDOS.get(this.claveManifiesto);
      this.entradas = obj ? ((await obj.json()) as Entrada[]) : [];
    }
    return this.entradas;
  }

  private async guardar(): Promise<void> {
    await this.env.CRUDOS.put(this.claveManifiesto, JSON.stringify(this.entradas, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  async ultima(url: string): Promise<Entrada | null> {
    const es = await this.manifiesto();
    for (let i = es.length - 1; i >= 0; i--) if (es[i].url === url) return es[i];
    return null;
  }

  /** True si ya tenemos esta URL y la fuente no declara una fecha más nueva (y el crudo sigue en R2). */
  async estaAlDia(url: string, modificado: string | null): Promise<boolean> {
    const e = await this.ultima(url);
    if (!e) return false;
    if (modificado && e.modified && modificado > e.modified) return false;
    return (await this.env.CRUDOS.head(`raw/${e.file}`)) !== null;
  }

  /**
   * Baja `url` a raw/<fuente>/<subdir o día>/<archivo> en streaming (calcula sha256 y bytes al pasar)
   * y lo anota en el manifiesto. Si ya está al día, devuelve la entrada que había.
   */
  async bajar(url: string, op: { archivo?: string; modificado?: string | null; forzar?: boolean; subdir?: string } = {}): Promise<Entrada> {
    const modificado = op.modificado ?? null;
    if (!op.forzar && (await this.estaAlDia(url, modificado))) {
      const e = (await this.ultima(url))!;
      registrar("INFO", `   = ${e.file} ya está al día (${e.modified ?? "sin fecha"})`, { fuente: this.fuente });
      return e;
    }
    const nombre = op.archivo ?? url.slice(url.lastIndexOf("/") + 1);
    const file = `${this.fuente}/${op.subdir ?? fechaLima()}/${nombre}`;
    const r = await obtener(this.env, url, { timeoutMs: null });
    if (!r.ok || !r.body) {
      await r.body?.cancel();
      throw new ErrorHttp(r.status, url);
    }
    const resumen = new crypto.DigestStream("SHA-256");
    const escritor = resumen.getWriter();
    let bytes = 0;
    const medidor = new TransformStream<Uint8Array, Uint8Array>({
      async transform(trozo, c) {
        bytes += trozo.byteLength;
        await escritor.write(trozo);
        c.enqueue(trozo);
      },
      async flush() {
        await escritor.close();
      },
    });
    const largo = Number(r.headers.get("content-length") ?? "");
    const comprimido = !!(r.headers.get("content-encoding") ?? "").replace("identity", "").trim();
    const opciones: R2PutOptions = { httpMetadata: { contentType: r.headers.get("content-type") ?? "application/octet-stream" }, customMetadata: { url } };
    if (largo > 0 && !comprimido) {
      await this.env.CRUDOS.put(`raw/${file}`, r.body.pipeThrough(medidor).pipeThrough(new FixedLengthStream(largo)), opciones);
    } else {
      const datos = await new Response(r.body.pipeThrough(medidor)).arrayBuffer();
      if (datos.byteLength > MAX_EN_MEMORIA) throw new Error(`${url}: ${datos.byteLength} bytes sin Content-Length`);
      await this.env.CRUDOS.put(`raw/${file}`, datos, opciones);
    }
    const sha256 = hex(await resumen.digest);
    const previa = await this.ultima(url);
    if (previa && previa.sha256 === sha256) {
      registrar("INFO", `   = ${nombre} sin cambios (mismo sha256); se conserva la copia nueva`, { fuente: this.fuente });
    }
    const e: Entrada = { url, file, sha256, bytes, downloaded_at: new Date().toISOString().slice(0, 19) + "+00:00", modified: modificado };
    (await this.manifiesto()).push(e);
    await this.guardar();
    registrar("INFO", `   ↓ ${nombre} (${(bytes / 1e6).toFixed(1)} MB) → r2://${BUCKET}/raw/${file}`, { fuente: this.fuente });
    return e;
  }

  /** El crudo como stream (para COPY). */
  async abrir(e: Entrada): Promise<R2ObjectBody> {
    const obj = await this.env.CRUDOS.get(`raw/${e.file}`);
    if (!obj) throw new Error(`falta el crudo r2://${BUCKET}/raw/${e.file}`);
    return obj;
  }

  /**
   * El crudo entero en memoria, para parsear (XLS, XLSX, CSV chico). Con tope: un archivo anómalo de la
   * fuente no debe tumbar el isolate (128 MB); los de hoy pesan entre 0,1 y 5 MB.
   */
  async leer(e: Entrada, maximo = MAX_EN_MEMORIA): Promise<Uint8Array> {
    if (e.bytes > maximo) throw new Error(`${e.file}: ${e.bytes} bytes, más de lo que se parsea en memoria (${maximo})`);
    return new Uint8Array(await (await this.abrir(e)).arrayBuffer());
  }
}
