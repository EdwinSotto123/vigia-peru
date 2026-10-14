/**
 * Registro de cargas en `datasets_cargas` (migración 23): lo de backend/scrapers/_core/registro.py.
 * Antes de cargar: `yaCargado(fuente, clave, sha256)`; al terminar: `registrarCarga(...)`. Así el cron es
 * idempotente (un archivo con el mismo sha256 no se vuelve a insertar) y /admin/cobertura lee
 * `datasets_cobertura` sin tocar cada tabla.
 */

import type { Db } from "./db.ts";

export interface Carga {
  fuente: string;
  clave: string;
  sha256: string;
  tabla?: string | null;
  archivo?: string | null;
  gcs_uri?: string | null;
  bytes?: number | null;
  filas?: number | null;
  fuente_url?: string | null;
  descargado_at?: string | null;
  estado?: string;
  error?: string | null;
}

/** True si esa clave ya se cargó con ese mismo sha256 y sin error. */
export async function yaCargado(db: Db, fuente: string, clave: string, sha256: string): Promise<boolean> {
  const f = await db.filas("SELECT 1 FROM datasets_cargas WHERE fuente=$1 AND clave=$2 AND sha256=$3 AND estado='ok'", [fuente, clave, sha256]);
  return f.length > 0;
}

export async function registrarCarga(db: Db, c: Carga): Promise<void> {
  await db.ejecutar(
    `INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, gcs_uri, sha256, bytes, filas,
                                  fuente_url, descargado_at, cargado_at, estado, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,now(),$11,$12)
     ON CONFLICT (fuente, clave) DO UPDATE SET
       tabla=EXCLUDED.tabla, archivo=EXCLUDED.archivo, gcs_uri=EXCLUDED.gcs_uri,
       sha256=EXCLUDED.sha256, bytes=EXCLUDED.bytes, filas=EXCLUDED.filas,
       fuente_url=EXCLUDED.fuente_url, descargado_at=EXCLUDED.descargado_at,
       cargado_at=now(), estado=EXCLUDED.estado, error=EXCLUDED.error`,
    [c.fuente, c.clave, c.tabla ?? null, c.archivo ?? null, c.gcs_uri ?? null, c.sha256, c.bytes ?? null, c.filas ?? null,
      c.fuente_url ?? null, c.descargado_at ?? null, c.estado ?? "ok", c.error ?? null],
  );
}
