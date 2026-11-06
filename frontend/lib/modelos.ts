/**
 * El nombre de un modelo de IA como se lee: «Claude Haiku 5.5», «Gemini 3.6 Flash» (pedido del usuario del 2026-11-05:
 * la ficha decía «gemini-3.6-flash» en código y, además, era el modelo equivocado). «respaldo» es el alias del Worker
 * vigia-llm, por el que pasan hoy todas las llamadas: Claude Haiku 5.5.
 */
const CONOCIDOS: Record<string, string> = {
  respaldo: "Claude Haiku 5.5",
  "@cf/zai-org/glm-5.3-flash": "GLM 5.3 Flash",
  "@cf/zai-org/glm-5.3": "GLM 5.3",
};

export function nombreModelo(id: string | null | undefined): string | null {
  const m = (id ?? "").trim();
  if (!m) return null;
  if (CONOCIDOS[m]) return CONOCIDOS[m];
  const base = (m.split("/").pop() ?? m).replace(/-\d{8}$/, "");
  return base
    .replace(/^claude-/, "claude ")
    .replace(/-(\d+)-(\d+)$/, " $1.$2")
    .replace(/-/g, " ")
    .replace(/(^|\s)(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase("es"))
    .replace(/\bGlm\b/, "GLM");
}

/**
 * La norma de una señal como se lee. Las reglas propias de Vigía guardan su fundamento como «Heurística — coherencia rubro
 * empresa vs objeto del contrato»: no es una norma (alguien de afuera buscaba esa «Heurística» en la ley), es un criterio
 * de Vigía. `criterio`: para decirlo así («Criterio de Vigía: …») y no como «Norma: …».
 */
export function normaLegible(norma: string | null | undefined): { texto: string; criterio: boolean } | null {
  const n = (norma ?? "").trim();
  if (!n) return null;
  const m = n.match(/^heur[ií]stica\s*[—–:-]\s*(.+)$/i);
  if (m) return { texto: m[1].charAt(0).toLocaleUpperCase("es") + m[1].slice(1), criterio: true };
  return { texto: n, criterio: false };
}
