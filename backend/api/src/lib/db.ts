/**
 * Pool de Postgres compartido. Reconecta auto, lib `pg` maneja eso.
 *
 * Para Cloud Run + Cloud SQL:
 *   - Usá `PGHOST=/cloudsql/<connection_name>` (Unix socket)
 *   - Configurá el servicio con `--add-cloudsql-instances=<connection_name>`
 * Para dev local:
 *   - Cloud SQL Auth Proxy → PGHOST=127.0.0.1 PGPORT=5432
 */

import pg from "pg";

const isUnixSocket = (process.env.PGHOST ?? "").startsWith("/cloudsql/");

export const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: isUnixSocket ? undefined : Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? "vigia",
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  console.error("[db] pool error:", err.message);
});

export async function ping(): Promise<{ ok: true; now: Date } | { ok: false; err: string }> {
  try {
    const r = await pool.query<{ now: Date }>("SELECT NOW() as now");
    return { ok: true, now: r.rows[0].now };
  } catch (e) {
    return { ok: false, err: (e as Error).message };
  }
}
