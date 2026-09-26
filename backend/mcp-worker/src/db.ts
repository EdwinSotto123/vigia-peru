// Conexión a Postgres por Hyperdrive (rol vigia_mcp, pooling en modo transacción como PgBouncer).
// Un cliente por llamada de tool, igual que _pg() en el servidor Python; se cierra con waitUntil para
// no demorar la respuesta. Sólo consultas sueltas en autocommit: nada de SET ni estado de sesión.
import { Client, types } from "pg";

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

const OID_DATE = 1082;

// Las fechas llegan como texto 'YYYY-MM-DD' (lo mismo que date.isoformat() en Python), sin pasar por
// Date ni por la zona horaria del runtime. bigint y numeric quedan como texto y se convierten a mano.
const tiposPg = {
  getTypeParser: ((oid: number, formato?: "text" | "binary") =>
    oid === OID_DATE ? (v: string) => v : types.getTypeParser(oid, formato)) as typeof types.getTypeParser,
};

export async function conConexion<T>(env: Env, ctx: ExecutionContext, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString, types: tiposPg });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    ctx.waitUntil(client.end().catch(() => undefined));
  }
}
