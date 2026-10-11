/*
 * Sesión de administrador LOCAL para auditar /admin. Firma la cookie de sesión igual que
 * lib/admin-sesion.ts (HS256, audiencia "vigia-admin", claims correo y rol) con la llave de .env.local
 * (gitignored). La llave y la cookie NUNCA se imprimen ni se guardan: el token pasa por stdin al navegador
 * (no por argumentos de línea de comandos) y vive solo en la sesión del navegador de auditoría.
 *
 * Esa cookie también vale contra producción (misma llave si .env.local es el de producción): trátala como
 * una credencial y no la copies a ningún archivo del repositorio.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";

const aqui = dirname(fileURLToPath(import.meta.url));
const frontend = join(aqui, "..", "..");

function leerEnv() {
  const ruta = join(frontend, ".env.local");
  if (!existsSync(ruta)) return {};
  const env = {};
  for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea);
    if (m && !linea.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

/** @returns {Promise<{cookie: string, correo: string} | null>} */
export async function firmarCookieAdmin() {
  const env = { ...leerEnv(), ...process.env };
  const secreto = env.ADMIN_SESSION_SECRET;
  const correo = (env.ADMIN_EMAILS || "").split(",")[0]?.trim().toLowerCase();
  if (!secreto || secreto.length < 32 || !correo) return null;
  const cookie = await new SignJWT({ correo, rol: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(correo)
    .setAudience("vigia-admin")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(secreto));
  return { cookie, correo };
}

/** Token de servicio del API para leer el panel desde Node (resolver ids). No se imprime. */
export function tokenApiAdmin() {
  const env = { ...leerEnv(), ...process.env };
  return env.ADMIN_TOKEN || null;
}
