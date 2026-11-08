/**
 * Leer el CV de quien busca trabajo para armar su perfil de Gobserva Empleo (2026-11-08, el usuario: «mejora el
 * formulario, para que diga su CV, profesión…»). Haiku 5.5 (por vigia-llm, /nativo) lee el PDF o la foto y devuelve SÓLO
 * lo que el perfil necesita: carreras, el grado más alto, años de experiencia (total y en el Estado), puestos y región.
 *
 * Privacidad: el archivo no se guarda (ni en la base ni en R2) y no se registra su contenido; el modelo tiene prohibido
 * devolver nombre, DNI, teléfono, correo o dirección, y aquí sólo pasan las claves esperadas, con su forma validada.
 */
import { z } from "zod";
import { MODELO_ASISTENTE } from "./asistente.js";

export const TIPOS_CV = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type TipoCv = (typeof TIPOS_CV)[number];
export const MAX_CV_BYTES = 4_000_000;
const ESTUDIOS = ["secundaria", "tecnica", "egresado", "bachiller", "titulo", "posgrado"] as const;

export const SISTEMA_CV = `Lees el CV de una persona que busca trabajo en el Estado peruano (plazas CAS publicadas en SERVIR) para armar su perfil de búsqueda.
Responde SOLO con un objeto JSON, sin texto antes ni después, con estas claves:
- "carreras": de 0 a 3 profesiones o carreras de la persona, como las piden los avisos del Estado ("Arquitectura", "Ingeniería civil", "Contabilidad", "Derecho", "Técnico en enfermería"). Vacía si no tiene carrera.
- "estudios": el grado más alto que YA tiene, uno de: "secundaria", "tecnica", "egresado", "bachiller", "titulo", "posgrado". Una maestría o un doctorado en curso no es "posgrado": cuenta el título que ya tiene.
- "anosExperiencia": años de experiencia laboral en total, un entero (redondeado hacia abajo).
- "anosSectorPublico": años trabajados en entidades del Estado, un entero.
- "puestos": de 0 a 5 puestos que ocupó o a los que apunta, nombres cortos en minúsculas ("residente de obra", "asistente administrativo").
- "region": el departamento del Perú donde vive, en minúsculas y con guiones ("lima", "la-libertad", "san-martin"), o null si no se sabe.
No incluyas el nombre, el DNI, el teléfono, el correo, la dirección ni ningún otro dato personal.
Si el archivo no es un CV, responde exactamente {"error": "no_es_cv"}.`;

const Leido = z.object({
  carreras: z.array(z.string().trim().min(2).max(60)).max(3).catch([]),
  estudios: z.enum(ESTUDIOS).nullable().catch(null),
  anosExperiencia: z.coerce.number().int().min(0).max(60).nullable().catch(null),
  anosSectorPublico: z.coerce.number().int().min(0).max(60).nullable().catch(null),
  puestos: z.array(z.string().trim().min(2).max(60)).max(5).catch([]),
  region: z.string().regex(/^[a-z-]{3,30}$/).nullable().catch(null),
});
export type CvLeido = z.infer<typeof Leido>;

/** La respuesta del modelo → el perfil (o "no_es_cv"). Tira si no es un JSON con esa forma. */
export function interpretarCv(texto: string): CvLeido | "no_es_cv" {
  const t = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const ini = t.indexOf("{");
  const fin = t.lastIndexOf("}");
  if (ini < 0 || fin <= ini) throw new Error("cv_sin_json");
  const j = JSON.parse(t.slice(ini, fin + 1)) as Record<string, unknown>;
  if (j.error === "no_es_cv") return "no_es_cv";
  const r = Leido.parse({ carreras: [], puestos: [], estudios: null, anosExperiencia: null, anosSectorPublico: null, region: null, ...j });
  // Nada que parezca un dato personal se cuela en un texto: sin dígitos largos ni arrobas.
  const limpio = (xs: string[]) => xs.filter((x) => !/\d{6,}|@/.test(x)).map((x) => x.replace(/\s+/g, " "));
  return { ...r, carreras: limpio(r.carreras), puestos: limpio(r.puestos).map((x) => x.toLowerCase()) };
}

interface EnvLlm {
  LLM?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  LLM_TOKEN?: string;
}

/** Lee el CV (en base64) con Haiku. Tira "sin_modelo", "modelo_<status>" o el error de interpretarlo. */
export async function leerCv(env: EnvLlm, base64: string, tipo: TipoCv): Promise<CvLeido | "no_es_cv"> {
  if (!env.LLM || !env.LLM_TOKEN) throw new Error("sin_modelo");
  const archivo = tipo === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: tipo, data: base64 } }
    : { type: "image", source: { type: "base64", media_type: tipo, data: base64 } };
  const r = await env.LLM.fetch(
    new Request("https://vigia-llm.interno/nativo/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.LLM_TOKEN, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELO_ASISTENTE,
        max_tokens: 600,
        system: SISTEMA_CV,
        messages: [{ role: "user", content: [archivo, { type: "text", text: "Este es el CV. Devuelve el JSON." }] }],
      }),
    }),
  );
  if (!r.ok) throw new Error(`modelo_${r.status}`);
  const j = (await r.json()) as { content?: { type: string; text?: string }[] };
  return interpretarCv((j.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""));
}

/** Los bytes de un base64 (sin decodificarlo). */
export const bytesDeBase64 = (b64: string) => Math.floor((b64.replace(/=+$/, "").length * 3) / 4);
