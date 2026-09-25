import type { DialogField } from "@/components/admin/Dialog";
import type { CambiosPerfilAliado, FinanciadorAdmin } from "@/lib/admin";
import type { RedSocial } from "@/components/aliados/perfil";

/**
 * Formulario "Perfil público" de un financiador (migración 30): los campos del diálogo, la misma
 * validación que hace el API (backend/api/src/routes/admin.ts · perfilDelCuerpo) para avisar antes
 * de mandar, y el diff: sólo viaja lo que cambió, y un campo vaciado viaja como "" (lo borra).
 */

export const MAX_DESCRIPCION = 280;

/** Mismas redes y dominios que REDES_ALIADO del API. */
const REDES: { red: RedSocial; nombre: string; dominios: string[]; ejemplo: string }[] = [
  { red: "facebook", nombre: "Facebook", dominios: ["facebook.com"], ejemplo: "https://www.facebook.com/empresa" },
  { red: "instagram", nombre: "Instagram", dominios: ["instagram.com"], ejemplo: "https://www.instagram.com/empresa" },
  { red: "linkedin", nombre: "LinkedIn", dominios: ["linkedin.com"], ejemplo: "https://www.linkedin.com/company/empresa" },
  { red: "x", nombre: "X (Twitter)", dominios: ["x.com", "twitter.com"], ejemplo: "https://x.com/empresa" },
  { red: "tiktok", nombre: "TikTok", dominios: ["tiktok.com"], ejemplo: "https://www.tiktok.com/@empresa" },
  { red: "youtube", nombre: "YouTube", dominios: ["youtube.com"], ejemplo: "https://www.youtube.com/@empresa" },
];

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Sin esquema ("empresa.pe/…") se completa con https://; con http:// se rechaza (el API sólo guarda https). */
function enlace(v: string, nombre: string): string {
  const crudo = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
  let u: URL;
  try { u = new URL(crudo); } catch { throw new Error(`${nombre}: no es un enlace válido.`); }
  if (u.protocol !== "https:") throw new Error(`${nombre}: tiene que empezar con https://.`);
  if (!u.hostname.includes(".") || u.username || u.password) throw new Error(`${nombre}: no es un enlace válido.`);
  // Igual que `new URL().href` del API: un valor ya guardado vuelve idéntico y no cuenta como cambio.
  return u.href;
}

function enlaceDeRed(v: string, r: (typeof REDES)[number]): string {
  const href = enlace(v, r.nombre);
  const u = new URL(href);
  const host = u.hostname.toLowerCase();
  if (!r.dominios.some((d) => host === d || host.endsWith(`.${d}`))) {
    throw new Error(`${r.nombre}: el enlace tiene que ser de ${r.dominios.join(" o ")}.`);
  }
  if (!u.pathname.replace(/\/+$/, "")) throw new Error(`${r.nombre}: pega el enlace a la página del aliado, no la portada de ${r.nombre}.`);
  return href;
}

/** Una línea, como la guarda el API. */
const unaLinea = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

export function camposPerfil(f: FinanciadorAdmin): DialogField[] {
  return [
    {
      name: "descripcion", label: "Descripción", type: "textarea", defaultValue: f.descripcion ?? "",
      placeholder: "Quiénes son y por qué apoyan la transparencia",
      hint: `Una o dos frases, hasta ${MAX_DESCRIPCION} caracteres. Va en una sola línea.`,
    },
    { name: "sitioWeb", label: "Web", defaultValue: f.sitioWeb ?? "", placeholder: "https://empresa.pe" },
    {
      name: "emailPublico", label: "Correo de contacto (público)", defaultValue: f.emailPublico ?? "", placeholder: "contacto@empresa.pe",
      hint: `Se muestra en su página. El correo del pago (${f.email}) sigue privado.`,
    },
    ...REDES.map((r): DialogField => ({ name: `red_${r.red}`, label: r.nombre, defaultValue: f.redes?.[r.red] ?? "", placeholder: r.ejemplo })),
    {
      name: "portadaUrl", label: "Imagen de portada", defaultValue: f.portadaUrl ?? "", placeholder: "https://…/portada.jpg",
      hint: "Enlace https a una imagen horizontal (unos 1500 × 500 px). Sin ella, la portada es la franja textil.",
    },
  ];
}

/** Valida lo escrito y devuelve sólo lo que cambió. Tira un Error con el primer problema, en palabras. */
export function cambiosPerfil(f: FinanciadorAdmin, v: Record<string, string>): CambiosPerfilAliado {
  const cambios: CambiosPerfilAliado = {};
  const anotar = (campo: "descripcion" | "sitioWeb" | "emailPublico" | "portadaUrl", nuevo: string) => {
    if (nuevo !== (f[campo] ?? "")) cambios[campo] = nuevo;
  };

  const descripcion = unaLinea(v.descripcion ?? "");
  const largo = [...descripcion].length;
  if (largo > MAX_DESCRIPCION) throw new Error(`La descripción tiene ${largo} caracteres: el máximo es ${MAX_DESCRIPCION}.`);
  anotar("descripcion", descripcion);

  const web = (v.sitioWeb ?? "").trim();
  anotar("sitioWeb", web ? enlace(web, "Web") : "");

  const correo = (v.emailPublico ?? "").trim().toLowerCase();
  if (correo && !CORREO.test(correo)) throw new Error("El correo de contacto no es válido.");
  anotar("emailPublico", correo);

  const portada = (v.portadaUrl ?? "").trim();
  anotar("portadaUrl", portada ? enlace(portada, "Imagen de portada") : "");

  const redes: Partial<Record<RedSocial, string>> = {};
  for (const r of REDES) {
    const crudo = (v[`red_${r.red}`] ?? "").trim();
    const nuevo = crudo ? enlaceDeRed(crudo, r) : "";
    if (nuevo !== (f.redes?.[r.red] ?? "")) redes[r.red] = nuevo;
  }
  if (Object.keys(redes).length) cambios.redes = redes;
  return cambios;
}

/** "descripción · web · 2 redes" para la tabla; null si no publicó nada. */
export function resumenPerfil(f: FinanciadorAdmin): string | null {
  const redes = Object.values(f.redes ?? {}).filter(Boolean).length;
  const partes = [
    f.descripcion && "descripción",
    f.sitioWeb && "web",
    f.emailPublico && "correo",
    redes > 0 && (redes === 1 ? "1 red" : `${redes} redes`),
    f.portadaUrl && "portada",
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}
