/**
 * Postgres por Hyperdrive como vigia_jobs (Workers VPC → túnel → PgBouncer del proxy EC2 → RDS), igual
 * que `pg_dsn()` de los pipelines de Python. PgBouncer y Hyperdrive van en modo transacción: nada de
 * SET ni estado de sesión; una transacción (BEGIN … COMMIT) sí se queda con su conexión hasta el final.
 *
 * Una conexión por paso de Workflows (la documentación pide abrir la de Hyperdrive dentro de cada
 * `step.do()`): `conDb` la abre y la cierra.
 */

import { once } from "node:events";
import pg from "pg";
import { from as copiaDesde } from "pg-copy-streams";
import { registrar } from "./registro.ts";

export class Db {
  readonly cliente: pg.Client;
  private abierta: Promise<void> | null = null;

  constructor(cadena: string) {
    // Sin query_timeout: un COPY de 400 MB o refresh_financiamiento() tardan minutos y vigia_jobs no
    // tiene statement_timeout (37_roles.sql), igual que la conexión directa de los jobs de Cloud Run.
    this.cliente = new pg.Client({ connectionString: cadena, connectionTimeoutMillis: 20_000 });
    this.cliente.on("error", (e) => registrar("WARNING", `[db] conexión rota: ${e.message}`));
  }

  private async conectar(): Promise<void> {
    this.abierta ??= this.cliente.connect().then(() => undefined);
    await this.abierta;
  }

  /** Filas como objetos (columna → valor), como `cursor.fetchall()` con nombres. */
  async filas<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.conectar();
    return (await this.cliente.query(sql, params)).rows as T[];
  }

  /** Ejecuta y devuelve `rowCount` (lo que da `cursor.rowcount` en psycopg2). */
  async ejecutar(sql: string, params: unknown[] = []): Promise<number> {
    await this.conectar();
    return (await this.cliente.query(sql, params)).rowCount ?? 0;
  }

  /** `fn` dentro de BEGIN … COMMIT (ROLLBACK si tira). */
  async transaccion<T>(fn: () => Promise<T>): Promise<T> {
    await this.ejecutar("BEGIN");
    try {
      const r = await fn();
      await this.ejecutar("COMMIT");
      return r;
    } catch (e) {
      await this.ejecutar("ROLLBACK").catch(() => undefined);
      throw e;
    }
  }

  /**
   * Abre un `COPY … FROM STDIN`: se le escriben bytes con `escribir` y `cerrar` devuelve las filas
   * copiadas (lo que hace `cursor.copy_expert` en pnda_dji, pero en partes).
   *
   * El socket de pg en Workers (pg-cloudflare) responde `true` a cada write y encola sin límite: con
   * un CSV de 400 MB eso llena los 128 MB del isolate. Mientras dura el COPY, `write` cuenta lo que
   * aún no salió y pide esperar (`false` + 'drain', lo que pg-copy-streams ya sabe hacer) por encima
   * de ALTO; se restaura al cerrar.
   */
  async abrirCopia(sql: string): Promise<Copia> {
    await this.conectar();
    const ALTO = 8 << 20;
    const BAJO = 2 << 20;
    const socket = (this.cliente as unknown as { connection: { stream: SocketPg } }).connection.stream;
    const original = socket.write;
    let pendientes = 0;
    let esperando = false;
    socket.write = function (this: SocketPg, datos: Uint8Array, cod?: unknown, cb?: unknown): boolean {
      const fin = (typeof cod === "function" ? cod : cb) as ((e?: Error) => void) | undefined;
      pendientes += datos.length;
      original.call(this, datos, typeof cod === "string" ? cod : "utf8", (e?: Error) => {
        pendientes -= datos.length;
        if (esperando && pendientes <= BAJO) {
          esperando = false;
          socket.emit("drain");
        }
        fin?.(e);
      });
      if (pendientes >= ALTO) esperando = true;
      return !esperando;
    };
    const copia = this.cliente.query(copiaDesde(sql));
    const fallo = new Promise<never>((_, rechazar) => copia.on("error", rechazar));
    fallo.catch(() => undefined);   // se lee en los Promise.race; esto solo evita el aviso de rechazo sin manejar
    const terminado = once(copia, "finish");
    let cerrada = false;
    const restaurar = () => {
      if (!cerrada) {
        cerrada = true;
        socket.write = original;
      }
    };
    return {
      async escribir(datos: Uint8Array) {
        try {
          if (datos.length && !copia.write(Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength))) {
            await Promise.race([once(copia, "drain"), fallo]);
          }
        } catch (e) {
          copia.destroy(e as Error);
          restaurar();
          throw e;
        }
      },
      async cerrar() {
        try {
          copia.end();
          await Promise.race([terminado, fallo]);
          return copia.rowCount;
        } catch (e) {
          copia.destroy(e as Error);
          throw e;
        } finally {
          restaurar();
        }
      },
    };
  }

  /** `COPY … FROM STDIN` con los bytes de `origen` tal cual. Devuelve las filas copiadas. */
  async copiar(sql: string, origen: ReadableStream<Uint8Array>): Promise<number> {
    const copia = await this.abrirCopia(sql);
    for await (const trozo of origen) await copia.escribir(trozo);
    return copia.cerrar();
  }

  async cerrar(): Promise<void> {
    if (this.abierta) await this.cliente.end().catch(() => undefined);
  }
}

interface SocketPg {
  write(datos: Uint8Array, cod?: unknown, cb?: unknown): boolean;
  emit(evento: string): boolean;
}

export interface Copia {
  escribir(datos: Uint8Array): Promise<void>;
  /** Termina el COPY y devuelve las filas copiadas. */
  cerrar(): Promise<number>;
}

/** Corre `fn` con una conexión nueva a Hyperdrive y la cierra al terminar. */
export async function conDb<T>(hyperdrive: Hyperdrive, fn: (db: Db) => Promise<T>): Promise<T> {
  if (!hyperdrive?.connectionString) throw new Error("[db] falta el binding HYPERDRIVE");
  const db = new Db(hyperdrive.connectionString);
  try {
    return await fn(db);
  } finally {
    await db.cerrar();
  }
}
