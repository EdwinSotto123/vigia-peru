/**
 * Postgres por Hyperdrive (rol vigia_dispatcher, pooling en modo transacción como PgBouncer): solo
 * sentencias sueltas en autocommit, nada de SET ni estado de sesión, igual que `_query` de main.py.
 *
 * Una conexión por paso de Workflows: la documentación de Workflows pide abrir la conexión de
 * Hyperdrive dentro de cada `step.do()` y no reusarla entre pasos. `conDb` la abre y la cierra.
 */

import pg from "pg";
import type { Consultor, OpcionesConsulta } from "./sql.ts";
import { registrar } from "./registro.ts";

const OID_JSON = 114;
const OID_JSONB = 3802;

const tiposCrudos = {
  getTypeParser: ((oid: number, formato?: "text" | "binary") =>
    oid === OID_JSON || oid === OID_JSONB ? (v: string) => v : pg.types.getTypeParser(oid, formato)) as typeof pg.types.getTypeParser,
};

export class Db implements Consultor {
  private readonly cliente: pg.Client;
  private abierta: Promise<void> | null = null;

  constructor(cadena: string) {
    // connect_timeout=15 como el DSN de main.py; query_timeout corta del lado del cliente una
    // sentencia colgada (el rol ya tiene statement_timeout de 60 s en el servidor).
    this.cliente = new pg.Client({ connectionString: cadena, connectionTimeoutMillis: 15_000, query_timeout: 90_000 });
    this.cliente.on("error", (e) => registrar("WARNING", `[db] conexión rota: ${e.message}`));
  }

  async query(sql: string, params: unknown[], opciones: OpcionesConsulta = {}): Promise<unknown[][]> {
    this.abierta ??= this.cliente.connect().then(() => undefined);
    await this.abierta;
    const r = await this.cliente.query({
      text: sql,
      values: params,
      rowMode: "array",
      ...(opciones.jsonCrudo ? { types: tiposCrudos } : {}),
    });
    return (r.rows ?? []) as unknown[][];
  }

  async cerrar(): Promise<void> {
    if (this.abierta) await this.cliente.end().catch(() => undefined);
  }
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
