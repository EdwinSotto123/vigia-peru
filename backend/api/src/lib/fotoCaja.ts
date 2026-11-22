/**
 * «Toma una foto de la caja» (Gobserva Salud, 2026-11-22; el usuario: «ALGO TIPO: TOMA FOTO»): un modelo abierto con
 * visión (vigia-llm, Workers AI) lee en la foto de la caja de un medicamento lo que sirve para verificarlo: el registro
 * sanitario, el lote, el vencimiento, el nombre y el titular. La foto no se guarda ni se registra: se lee y se descarta.
 *
 * El modelo puede leer mal: cada dato pasa por la misma forma que el buscador (`registroDe`, `pareceLote`) o se descarta,
 * y la persona ve lo leído y lo corrige antes de verificar. Sólo vuelven estos campos: si en la foto hay una receta, el
 * nombre de un paciente o un DNI, no se piden ni se devuelven.
 */
import { pareceLote, registroDe } from "./gobservaSalud.js";

export const MODELO_FOTO = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";
/** El tope de la foto (la web la achica a 1 600 px de lado en JPEG: suele pesar 200-500 KB). */
export const MAX_FOTO_CAJA = 1_000_000;

export interface LecturaCaja {
  esMedicamento: boolean;
  nombre: string | null;
  principioActivo: string | null;
  concentracion: string | null;
  registro: string | null;
  lote: string | null;
  vencimiento: string | null;
  titular: string | null;
}

const SISTEMA = `Lees fotos de cajas, frascos, blísteres y etiquetas de medicamentos y dispositivos médicos vendidos en el Perú.
Copia los datos TAL COMO ESTÁN IMPRESOS en el envase, sin corregirlos ni completarlos. Si un dato no se lee con claridad,
déjalo vacío: no lo adivines. No copies nombres de personas, números de DNI ni nada de una receta. Responde sólo con la
herramienta «caja».`;

const HERRAMIENTA = {
  type: "function" as const,
  function: {
    name: "caja",
    description: "Los datos impresos en el envase del medicamento de la foto.",
    parameters: {
      type: "object",
      properties: {
        es_medicamento: { type: "boolean", description: "true si la foto muestra el envase o la etiqueta de un medicamento o dispositivo médico." },
        nombre: { type: "string", description: "El nombre comercial o de marca, como está impreso, sin la concentración ni la forma (p. ej. Panadol Antigripal)." },
        principio_activo: { type: "string", description: "El principio activo (p. ej. Paracetamol)." },
        concentracion: { type: "string", description: "La concentración (p. ej. 500 mg)." },
        registro_sanitario: { type: "string", description: "El código que sigue a «Reg. San.», «R.S.», «RS N°» o «Registro Sanitario» (p. ej. EE-01234, N-12345, DM12345E)." },
        lote: { type: "string", description: "El código que sigue a «Lote», «Lot», «L.» o «Batch»." },
        vencimiento: { type: "string", description: "La fecha que sigue a «Venc.», «Vence», «Exp.», «V.» o «Fecha de vencimiento»." },
        titular: { type: "string", description: "El laboratorio o titular del registro." },
      },
      required: ["es_medicamento"],
    },
  },
};

/** El texto de un campo, limpio: sin saltos ni espacios de más, hasta `max` letras; null si queda vacío. */
function textoCampo(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || t.length > max * 2 || /^(n\/?a|null|ninguno|no (se )?(lee|visible|indica)|-+)$/i.test(t)) return null;
  return t.slice(0, max);
}

/** Lo que devolvió el modelo, validado: lo que no tiene la forma de lo que dice ser, se descarta. */
export function limpiarCaja(args: unknown): LecturaCaja {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const regCrudo = textoCampo(a.registro_sanitario, 30);
  const registro = regCrudo ? registroDe(regCrudo) : null;
  // «Lote: 2405123», «L.2405123»: fuera la palabra; una «L» pegada a los números («L2345») puede ser parte del lote.
  const loteCrudo = textoCampo(a.lote, 30)?.replace(/^(lote|lot|batch)\s*[.:Nº°#]*\s*/i, "").replace(/^l\s*[.:]\s*/i, "") ?? null;
  // El lote se muestra como está impreso (sólo letras, números, guiones y barras); se busca normalizado (pareceLote).
  const lote = loteCrudo && pareceLote(loteCrudo) ? loteCrudo.toUpperCase().replace(/[^A-Z0-9 ./-]/g, "").trim().slice(0, 24) : null;
  const vencCrudo = textoCampo(a.vencimiento, 20)?.replace(/^(venc(e|imiento)?|exp(iry)?)\s*[.:]*\s*/i, "").replace(/^v\s*[.:]\s*/i, "") ?? null;
  const vencimiento = vencCrudo && /\d/.test(vencCrudo) ? vencCrudo : null;
  // Un nombre es letras (con números de concentración a lo más): nunca algo con forma de DNI.
  const nombreCrudo = textoCampo(a.nombre, 80);
  const nombre = nombreCrudo && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(nombreCrudo) && !/\b\d{8}\b/.test(nombreCrudo) ? nombreCrudo : null;
  return {
    esMedicamento: a.es_medicamento !== false,
    nombre,
    principioActivo: textoCampo(a.principio_activo, 80),
    concentracion: textoCampo(a.concentracion, 40),
    registro,
    lote: lote || null,
    vencimiento,
    titular: textoCampo(a.titular, 80),
  };
}

/** ¿Empieza como un JPEG? (FF D8 FF). */
export const esJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

function aBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Los argumentos de la herramienta «caja» (o el JSON del texto, si el modelo no usó la herramienta). */
function argumentos(j: unknown): unknown {
  const m = (j as { choices?: { message?: { content?: unknown; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] } }[] })?.choices?.[0]?.message;
  const args = (m?.tool_calls ?? []).find((t) => t.function?.name === "caja")?.function?.arguments ?? m?.tool_calls?.[0]?.function?.arguments;
  if (args && typeof args === "object") return args;
  const crudo = typeof args === "string" ? args : typeof m?.content === "string" ? m.content : "";
  const i = crudo.indexOf("{");
  const k = crudo.lastIndexOf("}");
  if (i < 0 || k <= i) return null;
  try {
    return JSON.parse(crudo.slice(i, k + 1));
  } catch {
    return null;
  }
}

/** Cómo se llega al modelo: el binding de vigia-llm en el Worker, o su dirección pública desde la PC (pruebas). */
export type PedirModelo = (cuerpo: Record<string, unknown>) => Promise<Response>;

export function pedirPorBinding(env: { LLM?: { fetch(r: Request): Promise<Response> }; LLM_TOKEN?: string }): PedirModelo | null {
  if (!env.LLM || !env.LLM_TOKEN) return null;
  const { LLM, LLM_TOKEN } = env;
  return (cuerpo) =>
    LLM.fetch(
      new Request("https://vigia-llm.interno/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${LLM_TOKEN}` },
        body: JSON.stringify(cuerpo),
      }),
    );
}

/** Lee la foto. Tira "modelo_<status>" o "sin_lectura"; devuelve la lectura validada y los tokens usados. */
export async function leerCaja(pedir: PedirModelo, jpeg: Uint8Array): Promise<{ lectura: LecturaCaja; entrada: number; salida: number }> {
  const r = await pedir({
    model: MODELO_FOTO,
    messages: [
      { role: "system", content: SISTEMA },
      {
        role: "user",
        content: [
          { type: "text", text: "Lee el envase de esta foto y responde con la herramienta «caja»." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${aBase64(jpeg)}` } },
        ],
      },
    ],
    tools: [HERRAMIENTA],
    tool_choice: { type: "function", function: { name: "caja" } },
    reasoning_effort: "low",
    temperature: 0,
    max_tokens: 800,
  });
  if (!r.ok) throw new Error(`modelo_${r.status}`);
  const j = (await r.json()) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const args = argumentos(j);
  if (!args) throw new Error("sin_lectura");
  return { lectura: limpiarCaja(args), entrada: j.usage?.prompt_tokens ?? 0, salida: j.usage?.completion_tokens ?? 0 };
}
