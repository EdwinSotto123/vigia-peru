/**
 * Perfil público del aliado (migración 30): descripción, web, correo de CONTACTO, redes y portada.
 * Lo edita QUIEN APORTA desde su cuenta (PUT /cuentas/me, routes/cuentas.ts); el panel admin sólo lo
 * modera (ocultar o mostrar con motivo) y lo lee (GET /admin/financiadores). Lo publica
 * GET /financiamiento/aliados/:slug.
 *
 * Reglas en un solo lugar (las mismas que los CHECK de la 30), sin base de datos: al escribir
 * (`normalizarPerfil`) y otra vez al leer (`perfilPublicado`), por si algo lo escribió por otra vía.
 * La detección de las columnas (¿está la 30 en la base?) vive en lib/esquema.ts.
 */

import { z } from "zod";

export type RedAliado = "facebook" | "instagram" | "linkedin" | "x" | "tiktok" | "youtube";

/** Las seis redes que un aliado puede publicar y los dominios que se aceptan para cada una. */
export const REDES_ALIADO: Record<RedAliado, { nombre: string; dominios: readonly string[] }> = {
  facebook: { nombre: "Facebook", dominios: ["facebook.com"] },
  instagram: { nombre: "Instagram", dominios: ["instagram.com"] },
  linkedin: { nombre: "LinkedIn", dominios: ["linkedin.com"] },
  x: { nombre: "X", dominios: ["x.com", "twitter.com"] },
  tiktok: { nombre: "TikTok", dominios: ["tiktok.com"] },
  youtube: { nombre: "YouTube", dominios: ["youtube.com"] },
};
export const CLAVES_RED = Object.keys(REDES_ALIADO) as RedAliado[];

export const MAX_DESCRIPCION = 280;
export const CORREO_PUBLICO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Enlace https bien formado (normalizado), o null. Al escribir y otra vez al leer. */
export function urlHttps(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim() || v.length > 500) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" && u.hostname.includes(".") && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/** Enlace de esa red: https, su dominio o un subdominio (www., m., pe.linkedin.com) y una página, no la portada de la red. */
export function enlaceDeRed(red: RedAliado, v: unknown): string | null {
  const href = urlHttps(v);
  if (!href) return null;
  const u = new URL(href);
  const host = u.hostname.toLowerCase();
  const deLaRed = REDES_ALIADO[red].dominios.some((d) => host === d || host.endsWith(`.${d}`));
  return deLaRed && u.pathname.replace(/\/+$/, "") !== "" ? href : null;
}

/** Sólo las seis redes, en orden fijo y con enlaces válidos: lo que no cumple no sale. */
export function redesPublicas(v: unknown): Partial<Record<RedAliado, string>> {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const out: Partial<Record<RedAliado, string>> = {};
  for (const red of CLAVES_RED) {
    const href = enlaceDeRed(red, o[red]);
    if (href) out[red] = href;
  }
  return out;
}

/** Lo publicado, saneado campo por campo (lo que no cumple sale null / sin esa red). */
export interface PerfilPublicado {
  descripcion: string | null;
  sitioWeb: string | null;
  emailPublico: string | null;
  redes: Partial<Record<RedAliado, string>>;
  portadaUrl: string | null;
}

export function perfilPublicado(r: {
  descripcion?: unknown; sitioWeb?: unknown; emailPublico?: unknown; redes?: unknown; portadaUrl?: unknown;
}): PerfilPublicado {
  return {
    descripcion: typeof r.descripcion === "string" && r.descripcion.trim() ? r.descripcion.trim() : null,
    sitioWeb: urlHttps(r.sitioWeb),
    emailPublico: typeof r.emailPublico === "string" && CORREO_PUBLICO.test(r.emailPublico) ? r.emailPublico : null,
    redes: redesPublicas(r.redes),
    portadaUrl: urlHttps(r.portadaUrl),
  };
}

// ─── Escritura ───────────────────────────────────────────────────────────────
// Campo ausente = no se toca; "" (o null) = se borra. Los topes del esquema son del texto crudo; la
// regla fina (280 caracteres, https, dominio de cada red) va en normalizarPerfil.
const Enlace = z.string().max(500).nullable().optional();

/** Campos del perfil en el cuerpo de PUT /cuentas/me (se esparcen en el esquema de la cuenta). */
export const CamposPerfil = {
  descripcion: z.string().max(1000).nullable().optional(),
  sitioWeb: Enlace,
  emailPublico: z.string().max(254).nullable().optional(),
  portadaUrl: Enlace,
  redes: z.object({
    facebook: Enlace, instagram: Enlace, linkedin: Enlace, x: Enlace, tiktok: Enlace, youtube: Enlace,
  }).strict().optional(),
};
const CuerpoPerfil = z.object(CamposPerfil);
export type CuerpoPerfil = z.infer<typeof CuerpoPerfil>;

/** Campo del API → columna de `financiadores` (lista cerrada: es lo único que entra en el SET). */
export const COL_PERFIL = {
  descripcion: "descripcion", sitioWeb: "sitio_web", emailPublico: "email_publico", portadaUrl: "portada_url",
} as const;
export type CampoPerfil = keyof typeof COL_PERFIL;

export interface CambiosPerfil {
  campos: Partial<Record<CampoPerfil, string | null>>;
  poner: Partial<Record<RedAliado, string>>;
  quitar: RedAliado[];
}

/** Un problema del perfil: el campo del cuerpo ("descripcion", "redes.facebook"…) y la frase para la persona. */
export interface ProblemaPerfil { campo: string; detalle: string }

export const esProblema = (x: CambiosPerfil | ProblemaPerfil): x is ProblemaPerfil => "detalle" in x;

/** ¿Cambia algo del perfil? */
export const tocaPerfil = (p: CambiosPerfil) =>
  Object.keys(p.campos).length > 0 || Object.keys(p.poner).length > 0 || p.quitar.length > 0;

/** Una línea: la cabecera del perfil es un párrafo corto. */
export const unaLinea = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/** Valida y normaliza el perfil del cuerpo (las mismas reglas que los CHECK de la 30). */
export function normalizarPerfil(b: CuerpoPerfil): CambiosPerfil | ProblemaPerfil {
  const campos: CambiosPerfil["campos"] = {};
  if (b.descripcion !== undefined) {
    const d = unaLinea(b.descripcion ?? "");
    const n = [...d].length; // caracteres como char_length() del CHECK
    if (n > MAX_DESCRIPCION) {
      return { campo: "descripcion", detalle: `La descripción tiene ${n} caracteres: el máximo es ${MAX_DESCRIPCION}.` };
    }
    campos.descripcion = d || null;
  }
  for (const [campo, nombre] of [["sitioWeb", "La web"], ["portadaUrl", "La imagen de portada"]] as const) {
    if (b[campo] === undefined) continue;
    const v = (b[campo] ?? "").trim();
    const href = v ? urlHttps(v) : null;
    if (v && !href) {
      return { campo, detalle: `${nombre} tiene que ser un enlace completo que empiece con https:// (por ejemplo https://empresa.pe).` };
    }
    campos[campo] = href;
  }
  if (b.emailPublico !== undefined) {
    const v = (b.emailPublico ?? "").trim().toLowerCase();
    if (v && !(CORREO_PUBLICO.test(v) && z.string().email().safeParse(v).success)) {
      return { campo: "emailPublico", detalle: "El correo de contacto no es válido." };
    }
    campos.emailPublico = v || null;
  }
  const poner: CambiosPerfil["poner"] = {};
  const quitar: RedAliado[] = [];
  for (const red of CLAVES_RED) {
    const crudo = b.redes?.[red];
    if (crudo === undefined) continue;
    const v = (crudo ?? "").trim();
    if (!v) { quitar.push(red); continue; }
    const href = enlaceDeRed(red, v);
    if (!href) {
      const { nombre, dominios } = REDES_ALIADO[red];
      return {
        campo: `redes.${red}`,
        detalle: `El enlace de ${nombre} tiene que empezar con https:// y ser de ${dominios.join(" o ")}, con tu página (no la portada de la red).`,
      };
    }
    poner[red] = href;
  }
  return { campos, poner, quitar };
}

/**
 * El primer problema del cuerpo en un campo del perfil (o del RUC), en palabras. null si el problema
 * es de otro campo: quien llama responde con su error de siempre.
 */
export function problemaDeZod(e: z.ZodError): ProblemaPerfil | null {
  const i = e.issues[0];
  if (!i) return null;
  const campo = String(i.path[0] ?? "");
  if (campo === "redes") {
    if (i.code === "unrecognized_keys") {
      // campo: la primera red que no se acepta ("redes.pinterest").
      return {
        campo: i.keys[0] ? `redes.${i.keys[0]}` : "redes",
        detalle: `Sólo se aceptan estas redes: ${CLAVES_RED.map((r) => REDES_ALIADO[r].nombre).join(", ")}.`,
      };
    }
    const red = i.path[1] != null ? `redes.${String(i.path[1])}` : "redes";
    return { campo: red, detalle: "Cada red va como un enlace de hasta 500 caracteres." };
  }
  if (campo === "descripcion") return { campo, detalle: `La descripción es demasiado larga: el máximo es ${MAX_DESCRIPCION} caracteres.` };
  if (campo === "emailPublico") return { campo, detalle: "El correo de contacto no es válido." };
  if (campo === "sitioWeb") return { campo, detalle: "La web no es un enlace válido." };
  if (campo === "portadaUrl") return { campo, detalle: "La imagen de portada no es un enlace válido." };
  if (campo === "ruc") return { campo, detalle: "El RUC tiene que tener 11 dígitos." };
  return null;
}

/**
 * Los SET del UPDATE de `financiadores` para estos cambios. Agrega los valores a `vals` (los `$n`
 * siguen su largo). Las columnas salen de COL_PERFIL: ningún texto del cuerpo entra en la SQL.
 */
export function setsDelPerfil(p: CambiosPerfil, vals: unknown[]): string[] {
  const sets: string[] = [];
  for (const [campo, v] of Object.entries(p.campos) as [CampoPerfil, string | null][]) {
    vals.push(v);
    sets.push(`${COL_PERFIL[campo]} = $${vals.length}`);
  }
  if (Object.keys(p.poner).length > 0 || p.quitar.length > 0) {
    vals.push(JSON.stringify(p.poner), p.quitar);
    sets.push(`redes = (COALESCE(redes, '{}'::jsonb) || $${vals.length - 1}::jsonb) - $${vals.length}::text[]`);
  }
  return sets;
}

/** CHECK de la 30 → campo del cuerpo (23514 de la base, por si algo pasó la validación de acá y no la suya). */
export const CAMPO_DEL_CHECK: Record<string, string> = {
  financiadores_descripcion_check: "descripcion",
  financiadores_sitio_web_check: "sitioWeb",
  financiadores_portada_url_check: "portadaUrl",
  financiadores_email_publico_check: "emailPublico",
  financiadores_redes_check: "redes",
};
