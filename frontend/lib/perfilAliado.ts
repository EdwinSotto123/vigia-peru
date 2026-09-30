import type { RedSocial } from "@/components/aliados/perfil";
import { listaY } from "@/lib/formato";

/**
 * Perfil público de un aliado (migración 30): lo que quien aporta publica de sí en
 * /aliado/<slug>. Lo edita QUIEN APORTA desde /app/configuracion (PUT /cuentas/me); el panel
 * admin sólo lo modera (ocultar o mostrar con motivo).
 *
 * Mismas reglas que el API (backend/api/src/routes/financiamiento.ts: urlHttps, enlaceDeRed,
 * CORREO_PUBLICO; y la normalización de perfilDelCuerpo en admin.ts), para avisar junto al
 * campo antes de mandar. Sólo viaja lo que cambió, y un campo vaciado viaja como "" (lo borra).
 */

export const MAX_DESCRIPCION = 280;
/** Tope del API para cualquier enlace (urlHttps). */
const MAX_ENLACE = 500;

/** Mismas redes y dominios que REDES_ALIADO del API. */
export const REDES: { red: RedSocial; nombre: string; dominios: string[]; ejemplo: string }[] = [
  { red: "facebook", nombre: "Facebook", dominios: ["facebook.com"], ejemplo: "https://www.facebook.com/tu-pagina" },
  { red: "instagram", nombre: "Instagram", dominios: ["instagram.com"], ejemplo: "https://www.instagram.com/tu-cuenta" },
  { red: "linkedin", nombre: "LinkedIn", dominios: ["linkedin.com"], ejemplo: "https://www.linkedin.com/company/tu-empresa" },
  { red: "x", nombre: "X (Twitter)", dominios: ["x.com", "twitter.com"], ejemplo: "https://x.com/tu-cuenta" },
  { red: "tiktok", nombre: "TikTok", dominios: ["tiktok.com"], ejemplo: "https://www.tiktok.com/@tu-cuenta" },
  { red: "youtube", nombre: "YouTube", dominios: ["youtube.com"], ejemplo: "https://www.youtube.com/@tu-canal" },
];

/** CORREO_PUBLICO del API. */
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** El de `z.string().email()` (zod 3), que el API también exige al correo público. */
const CORREO_ZOD = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;

export const esCorreoValido = (v: string) => CORREO.test(v) && CORREO_ZOD.test(v);

/** Lo que el aliado ya publicó (GET /cuentas/me o GET /admin/financiadores). */
export interface PerfilPublicado {
  descripcion?: string | null;
  sitioWeb?: string | null;
  emailPublico?: string | null;
  portadaUrl?: string | null;
  redes?: Partial<Record<RedSocial, string>> | null;
}

/** Lo que se manda: sólo lo que cambió; "" borra el dato (en `redes`, borra esa red). */
export interface CambiosPerfilPublico {
  descripcion?: string;
  sitioWeb?: string;
  emailPublico?: string;
  portadaUrl?: string;
  redes?: Partial<Record<RedSocial, string>>;
}

/** Lo que está escrito en el formulario, tal cual. */
export interface ValoresPerfil {
  descripcion: string;
  sitioWeb: string;
  emailPublico: string;
  portadaUrl: string;
  redes: Partial<Record<RedSocial, string>>;
}

/** Campo con error: los cuatro del perfil o una red por su clave ("facebook"). */
export type CampoPerfil = "descripcion" | "sitioWeb" | "emailPublico" | "portadaUrl" | RedSocial;

/** Una línea, como la guarda el API. */
export const unaLinea = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/** Caracteres de la descripción tal como se guardará (como char_length() del CHECK). */
export const largoDescripcion = (s: string) => [...unaLinea(s)].length;

/**
 * Sin esquema ("empresa.pe/…") se completa con https://; con http:// se rechaza (el API sólo
 * guarda https). Devuelve el enlace igual que `new URL().href` del API: un valor ya guardado
 * vuelve idéntico y no cuenta como cambio.
 */
function enlace(v: string): string {
  if (v.length > MAX_ENLACE) throw new Error(`El enlace es demasiado largo: el máximo es ${MAX_ENLACE} caracteres.`);
  const crudo = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
  let u: URL;
  try { u = new URL(crudo); } catch { throw new Error("No es un enlace válido. Escríbelo completo, por ejemplo https://empresa.pe."); }
  if (u.protocol !== "https:") throw new Error("Tiene que empezar con https://.");
  if (!u.hostname.includes(".") || u.username || u.password) throw new Error("No es un enlace válido. Escríbelo completo, por ejemplo https://empresa.pe.");
  return u.href;
}

function enlaceDeRed(v: string, r: (typeof REDES)[number]): string {
  const href = enlace(v);
  const u = new URL(href);
  const host = u.hostname.toLowerCase();
  if (!r.dominios.some((d) => host === d || host.endsWith(`.${d}`))) {
    throw new Error(`Tiene que ser un enlace de ${r.dominios.join(" o ")}.`);
  }
  if (!u.pathname.replace(/\/+$/, "")) throw new Error(`Pega el enlace a tu página, no la portada de ${r.nombre}.`);
  return href;
}

/** El valor normalizado, o el mensaje de por qué no se acepta. */
function probar(f: () => string): { ok: string } | { error: string } {
  try { return { ok: f() }; } catch (e) { return { error: (e as Error).message }; }
}

/**
 * Valida todo lo escrito y devuelve lo que cambió respecto de lo publicado, más un error por
 * campo (todos a la vez, para marcarlos junto a cada campo; no sólo el primero).
 */
export function validarPerfil(actual: PerfilPublicado, v: ValoresPerfil): { cambios: CambiosPerfilPublico; errores: Partial<Record<CampoPerfil, string>> } {
  const cambios: CambiosPerfilPublico = {};
  const errores: Partial<Record<CampoPerfil, string>> = {};
  const anotar = (campo: "descripcion" | "sitioWeb" | "emailPublico" | "portadaUrl", nuevo: string) => {
    if (nuevo !== (actual[campo] ?? "")) cambios[campo] = nuevo;
  };

  const descripcion = unaLinea(v.descripcion);
  const largo = [...descripcion].length;
  if (largo > MAX_DESCRIPCION) errores.descripcion = `Tiene ${largo} caracteres: el máximo es ${MAX_DESCRIPCION}.`;
  else anotar("descripcion", descripcion);

  for (const campo of ["sitioWeb", "portadaUrl"] as const) {
    const crudo = v[campo].trim();
    if (!crudo) { anotar(campo, ""); continue; }
    const r = probar(() => enlace(crudo));
    if ("error" in r) errores[campo] = r.error;
    else anotar(campo, r.ok);
  }

  const correo = v.emailPublico.trim().toLowerCase();
  if (correo && !esCorreoValido(correo)) errores.emailPublico = "No es un correo válido. Revisa que tenga la forma nombre@dominio.pe.";
  else anotar("emailPublico", correo);

  const redes: Partial<Record<RedSocial, string>> = {};
  for (const r of REDES) {
    const crudo = (v.redes[r.red] ?? "").trim();
    const prueba = crudo ? probar(() => enlaceDeRed(crudo, r)) : { ok: "" };
    if ("error" in prueba) { errores[r.red] = prueba.error; continue; }
    if (prueba.ok !== (actual.redes?.[r.red] ?? "")) redes[r.red] = prueba.ok;
  }
  if (Object.keys(redes).length) cambios.redes = redes;
  return { cambios, errores };
}

/**
 * Lo que se vería publicado con lo escrito ahora: cada dato normalizado, o null si todavía no
 * es válido (la página pública tampoco lo mostraría). Para la vista previa.
 */
export function comoSePublica(v: ValoresPerfil): {
  descripcion: string | null;
  web: string | null;
  email: string | null;
  portadaUrl: string | null;
  redes: Partial<Record<RedSocial, string>>;
} {
  const valido = (f: () => string) => {
    const r = probar(f);
    return "ok" in r && r.ok ? r.ok : null;
  };
  const descripcion = unaLinea(v.descripcion);
  const correo = v.emailPublico.trim().toLowerCase();
  const redes: Partial<Record<RedSocial, string>> = {};
  for (const r of REDES) {
    const crudo = (v.redes[r.red] ?? "").trim();
    const href = crudo ? valido(() => enlaceDeRed(crudo, r)) : null;
    if (href) redes[r.red] = href;
  }
  return {
    descripcion: descripcion && [...descripcion].length <= MAX_DESCRIPCION ? descripcion : null,
    web: v.sitioWeb.trim() ? valido(() => enlace(v.sitioWeb.trim())) : null,
    email: correo && esCorreoValido(correo) ? correo : null,
    portadaUrl: v.portadaUrl.trim() ? valido(() => enlace(v.portadaUrl.trim())) : null,
    redes,
  };
}

/** "descripción, web y 2 redes" para la tabla del panel; null si no publicó nada. */
export function resumenPerfil(p: PerfilPublicado): string | null {
  const redes = Object.values(p.redes ?? {}).filter(Boolean).length;
  const partes = [
    p.descripcion && "descripción",
    p.sitioWeb && "web",
    p.emailPublico && "correo",
    redes > 0 && (redes === 1 ? "1 red" : `${redes} redes`),
    p.portadaUrl && "portada",
  ].filter((x): x is string => Boolean(x));
  return partes.length ? listaY(partes) : null;
}
