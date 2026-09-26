/**
 * Pools de Postgres. Reconectan solos (lo maneja `pg`).
 *
 *   · `pool`      rutas públicas: 8 conexiones, 5 s para conseguir una, 10 s por sentencia.
 *   · `poolAdmin` panel admin y tareas del Scheduler (/admin/asignar, refrescos): 4 conexiones,
 *                 120 s por sentencia. Con credenciales propias si existen (PGUSER_ADMIN /
 *                 PGPASSWORD_ADMIN; si no, las mismas del público).
 *
 * Límites por sentencia (auditoría A3):
 *   · En la base: el rol de cada pool trae su `statement_timeout` (vigia_api 10 s, vigia_api_admin
 *     120 s, migración 37). Con conexión directa (local, Cloud SQL sin pooler) además se manda
 *     `options=-c statement_timeout=…` al conectar. Detrás de PgBouncer en modo transacción
 *     (`PG_POOLER=pgbouncer`) eso no se manda: PgBouncer ignora los parámetros por conexión.
 *   · En el cliente: `query_timeout` (12 s / 130 s) corta la espera aunque la base no responda.
 *     Funciona igual con o sin PgBouncer.
 *
 * Sin estado de sesión en ninguna consulta (PgBouncer en modo transacción reparte las sentencias
 * entre conexiones): nada de SET sin LOCAL, tablas temporales, LISTEN/NOTIFY ni sentencias
 * preparadas con nombre. node-pg usa sentencias sin nombre salvo que se le pase `name`.
 *
 * Para Cloud Run + Cloud SQL: `PGHOST=/cloudsql/<connection_name>` (socket Unix) y el servicio con
 * `--add-cloudsql-instances=<connection_name>`. Local: `PGHOST=127.0.0.1 PGPORT=5432`.
 */

import pg from "pg";

const isUnixSocket = (process.env.PGHOST ?? "").startsWith("/cloudsql/");
const conPgBouncer = (process.env.PG_POOLER ?? "").trim().toLowerCase() === "pgbouncer";

function configBase(usuario: string | undefined, clave: string | undefined, statementMs: number): pg.PoolConfig {
  return {
    host: process.env.PGHOST,
    port: isUnixSocket ? undefined : Number(process.env.PGPORT ?? 5432),
    user: usuario ?? "postgres",
    password: clave,
    database: process.env.PGDATABASE ?? "vigia",
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // Límite del lado del cliente: un poco más que el de la base, para que normalmente corte ella.
    query_timeout: statementMs + 2_000,
    ...(conPgBouncer ? {} : { options: `-c statement_timeout=${statementMs}` }),
  };
}

export const pool = new pg.Pool({
  ...configBase(process.env.PGUSER, process.env.PGPASSWORD, 10_000),
  max: 8,
  application_name: "vigia-api",
});

export const poolAdmin = new pg.Pool({
  ...configBase(process.env.PGUSER_ADMIN ?? process.env.PGUSER, process.env.PGPASSWORD_ADMIN ?? process.env.PGPASSWORD, 120_000),
  max: 4,
  application_name: "vigia-api-admin",
});

pool.on("error", (err) => {
  console.error(JSON.stringify({ severity: "ERROR", message: `[db] error del pool: ${err.message}` }));
});
poolAdmin.on("error", (err) => {
  console.error(JSON.stringify({ severity: "ERROR", message: `[db] error del pool admin: ${err.message}` }));
});

/** Cierra los dos pools (SIGTERM). Nunca tira. */
export async function cerrarPools(): Promise<void> {
  await Promise.allSettled([pool.end(), poolAdmin.end()]);
}

/**
 * SQL: OCIDs (corto y largo) que cumplen `ocid_corto(x) = ocid_corto(p)`. `convocatorias` no tiene
 * índice sobre ocid_corto(ocid) y esa igualdad la recorre entera (~18 k filas, 35–45 ms); con
 * `c.ocid = ANY(OCID_CANDIDATOS(p)) AND ocid_corto(c.ocid) = ocid_corto(p)` se busca por PK y el
 * resultado es exactamente el mismo. El prefijo es el de la función ocid_corto() (migración 12).
 */
export const OCID_CANDIDATOS = (p: string) => `ARRAY[${p}, ocid_corto(${p}), 'ocds-dgv273-seacev3-' || ocid_corto(${p})]`;

/** Error de Postgres por código SQLSTATE (42883 = función inexistente, 42P01 = tabla inexistente…). */
export const esErrorPg = (e: unknown, ...codigos: string[]) => codigos.includes(String((e as { code?: string })?.code ?? ""));

/** Texto para un LIKE literal: escapa `\`, `%` y `_` (el patrón usa el escape por defecto, `\`). */
export const escaparLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * `SELECT 1` con plazo propio (2 s por defecto): para /health. `ok: false` si la base no responde
 * a tiempo o da error (el motivo se registra en el log, no se devuelve).
 */
export async function ping(plazoMs = 2_000): Promise<{ ok: boolean; ms: number }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, rechazar) => { timer = setTimeout(() => rechazar(new Error(`sin respuesta en ${plazoMs} ms`)), plazoMs); }),
    ]);
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    const err = e as Error & { code?: string };
    console.error(JSON.stringify({ severity: "ERROR", message: `[health] la base no responde: ${err.message || err.code || String(e)}` }));
    return { ok: false, ms: Date.now() - t0 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
