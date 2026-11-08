/**
 * «Lo esencial» de una plaza CAS (migración 270, 2026-11-08, el usuario: «falta más profundidad»). SERVIR publica los
 * requisitos en mayúsculas y amontonados; Haiku 5.5 (por vigia-llm, /nativo) los reescribe en palabras simples: en una
 * frase, a quién buscan, los requisitos clave uno por uno, las competencias y qué mirar con cuidado. Sólo con lo que trae
 * la plaza: no inventa funciones, beneficios ni requisitos. La respuesta sale por una herramienta forzada (siempre con la
 * misma forma) y se guarda por aviso con la huella de los campos leídos.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { MODELO_ASISTENTE } from "./asistente.js";

export interface PlazaParaResumen {
  aviso: number;
  titulo: string | null;
  entidad: string | null;
  ubicacion: string | null;
  numero: string | null;
  vacantes: number | null;
  remuneracion: number | null;
  fecha_fin: string | null;
  experiencia: string | null;
  formacion: string | null;
  especializacion: string | null;
  conocimiento: string | null;
  competencias: string | null;
}

const TIPOS = ["formacion", "experiencia", "curso", "conocimiento", "otro"] as const;

/** Corta en la última palabra entera que entra (con «…»). */
export function recortar(s: string, max: number): string {
  if (s.length <= max) return s;
  const corte = s.slice(0, max - 1);
  return `${corte.replace(/\s+\S*$/, "") || corte}…`;
}

/**
 * Un texto del modelo: se recorta en vez de rechazarse. Con un tope estricto, una plaza con una formación larga hacía que
 * el modelo escribiera 640 caracteres en «a quién buscan» y todo el resumen caía (503 en PROD, 2026-11-08).
 */
export const texto = (min: number, max: number) => z.string().trim().min(min).transform((s) => recortar(s, max));

/** Una lista del modelo: se quedan los elementos válidos (hasta `max`) y se descartan los demás. */
export function lista<T extends z.ZodTypeAny>(item: T, max: number) {
  return z
    .array(z.unknown())
    .transform((xs): z.output<T>[] => xs.flatMap((x) => {
      const r = item.safeParse(x);
      return r.success ? [r.data] : [];
    }).slice(0, max))
    .catch([]);
}

export const Resumen = z.object({
  en_una_frase: texto(10, 320),
  a_quien_buscan: texto(10, 600),
  requisitos: lista(z.object({ que: texto(3, 260), tipo: z.enum(TIPOS).catch("otro") }), 10),
  competencias: lista(texto(2, 60), 10),
  ojo: lista(texto(5, 260), 4),
});
export type ResumenPlaza = z.infer<typeof Resumen>;

/** La huella de lo que se lee: si SERVIR cambia algo de esto, el resumen se vuelve a armar. */
export function huellaPlaza(p: PlazaParaResumen): string {
  const campos = [p.titulo, p.entidad, p.ubicacion, p.vacantes, p.remuneracion, p.fecha_fin, p.experiencia, p.formacion, p.especializacion, p.conocimiento, p.competencias];
  return createHash("sha256").update(JSON.stringify(campos)).digest("hex").slice(0, 32);
}

const SISTEMA = `Explicas una plaza CAS del Estado peruano (publicada en SERVIR) a una persona que piensa postular. Escribe en español del Perú, de tú, con frases cortas y simples, en oración (no en mayúsculas). Responde SIEMPRE con la herramienta «resumen».
Reglas:
- Usa SOLO los datos de la plaza que te paso. No inventes funciones, beneficios, horarios ni requisitos que no estén. Si un campo no dice nada útil, no lo menciones.
- "en_una_frase": qué puesto es, en qué entidad y dónde, cuánto paga al mes y hasta cuándo se postula.
- "a_quien_buscan": el perfil en un párrafo corto: qué estudió, cuánta experiencia (general, específica y en el sector público si lo dice) y qué más pide.
- "requisitos": cada requisito por separado, tal como lo pide (con sus años, carreras y especialidades), con su tipo.
- "competencias": las competencias que pide, en minúscula salvo la primera letra.
- "ojo": de 0 a 3 cosas que suelen dejar fuera a la gente (experiencia específica o en el Estado, colegiatura o habilitación, una especialidad exacta, cursos con horas). Sólo si la plaza lo pide.
- Nunca uses el signo «·». Separa con comas o en la lista.`;

const HERRAMIENTA = {
  name: "resumen",
  description: "Lo esencial de la plaza, en palabras simples.",
  input_schema: {
    type: "object",
    properties: {
      en_una_frase: { type: "string" },
      a_quien_buscan: { type: "string" },
      requisitos: {
        type: "array",
        maxItems: 10,
        items: { type: "object", properties: { que: { type: "string" }, tipo: { type: "string", enum: [...TIPOS] } }, required: ["que", "tipo"] },
      },
      competencias: { type: "array", items: { type: "string" }, maxItems: 10 },
      ojo: { type: "array", items: { type: "string" }, maxItems: 4 },
    },
    required: ["en_una_frase", "a_quien_buscan", "requisitos", "competencias", "ojo"],
  },
} as const;

/** Lo que el modelo lee de la plaza (sin el enlace ni datos de nadie). */
export function textoPlaza(p: PlazaParaResumen): string {
  const linea = (k: string, v: unknown) => (v == null || v === "" ? "" : `${k}: ${String(v).slice(0, 1500)}\n`);
  return [
    linea("Puesto", p.titulo),
    linea("Entidad", p.entidad),
    linea("Lugar", p.ubicacion),
    linea("Convocatoria", p.numero),
    linea("Vacantes", p.vacantes),
    linea("Sueldo mensual (S/)", p.remuneracion),
    linea("Se postula hasta", p.fecha_fin),
    linea("Formación", p.formacion),
    linea("Experiencia", p.experiencia),
    linea("Cursos o especialización", p.especializacion),
    linea("Conocimientos", p.conocimiento),
    linea("Competencias", p.competencias),
  ].join("");
}

interface EnvLlm {
  LLM?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  LLM_TOKEN?: string;
}

export async function resumirPlaza(env: EnvLlm, p: PlazaParaResumen): Promise<ResumenPlaza> {
  if (!env.LLM || !env.LLM_TOKEN) throw new Error("sin_modelo");
  const r = await env.LLM.fetch(
    new Request("https://vigia-llm.interno/nativo/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.LLM_TOKEN, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELO_ASISTENTE,
        max_tokens: 1500,
        system: SISTEMA,
        tools: [HERRAMIENTA],
        tool_choice: { type: "tool", name: "resumen" },
        messages: [{ role: "user", content: `Esta es la plaza:\n${textoPlaza(p)}` }],
      }),
    }),
  );
  if (!r.ok) throw new Error(`modelo_${r.status}`);
  const j = (await r.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
  const uso = (j.content ?? []).find((b) => b.type === "tool_use" && b.name === "resumen");
  if (!uso?.input) throw new Error("sin_resumen");
  const limpio = Resumen.parse(uso.input);
  const sinPunto = (t: string) => t.replace(/\s*·\s*/g, ", ");
  return {
    en_una_frase: sinPunto(limpio.en_una_frase),
    a_quien_buscan: sinPunto(limpio.a_quien_buscan),
    requisitos: limpio.requisitos.map((x) => ({ ...x, que: sinPunto(x.que) })),
    competencias: limpio.competencias.map((x) => x.charAt(0).toUpperCase() + x.slice(1)),
    ojo: limpio.ojo.map(sinPunto),
  };
}
