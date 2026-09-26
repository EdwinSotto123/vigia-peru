/**
 * Enrutado por tipo de contratación → servicio de agentes (`url_para` de backend/dispatcher/main.py).
 * Un servicio por perfil (mismo código, `PIPELINE_PROFILE` distinto): AGENT_URL_BIENES,
 * AGENT_URL_SERVICIOS, AGENT_URL_OBRAS y AGENT_URL_OTROS. `AGENT_URL` (histórico) es el fallback SOLO
 * para bienes y para contratos sin clasificación. Nunca se manda servicios/obras/otros al de bienes.
 */

import { strip } from "./py.ts";

// Tipo de clasificación (backend/core/clasificacion.py) → perfil del servicio de agentes.
export const PERFIL_DE_TIPO: Readonly<Record<string, string>> = {
  bienes: "bienes", servicios: "servicios", obras: "obras",
  consultoria: "otros", convenio: "otros", directa: "otros", otro: "otros",
};
export const PERFILES = ["bienes", "servicios", "obras", "otros"] as const;

export type Variables = Readonly<Record<string, unknown>>;

const sinBarraFinal = (s: string) => s.replace(/\/+$/, "");
const texto = (env: Variables, k: string) => (typeof env[k] === "string" ? (env[k] as string) : "");

/** Perfil que atiende `tipo` (null si el tipo es desconocido o vacío). */
export function perfilDe(tipo: string | null | undefined): string | null {
  if (!tipo) return null;
  const t = strip(String(tipo)).toLowerCase();
  return Object.hasOwn(PERFIL_DE_TIPO, t) ? PERFIL_DE_TIPO[t] : null;
}

/**
 * [url, perfil] del servicio de agentes para `tipo`:
 *   · `AGENT_URL_<PERFIL>` si está configurada;
 *   · sin tipo (contrato sin clasificar) o tipo bienes → fallback a `AGENT_URL`;
 *   · tipo de otro perfil sin URL configurada → [null, perfil]: queda pendiente;
 *   · tipo desconocido → [null, null].
 */
export function urlPara(tipo: string | null | undefined, env: Variables): [string | null, string | null] {
  const perfil = tipo ? perfilDe(tipo) : null;
  if (tipo && perfil === null) return [null, null];
  if (perfil !== null) {
    const url = sinBarraFinal(texto(env, `AGENT_URL_${perfil.toUpperCase()}`));
    if (url) return [url, perfil];
  }
  if (perfil === null || perfil === "bienes") {
    const base = sinBarraFinal(texto(env, "AGENT_URL"));
    if (base) return [base, perfil ?? "bienes"];
  }
  return [null, perfil];
}

/** URL configurada de cada perfil ("" si falta), para el registro y /simular. */
export function urlsPorPerfil(env: Variables): Record<string, string> {
  return Object.fromEntries(PERFILES.map((p) => [p, sinBarraFinal(texto(env, `AGENT_URL_${p.toUpperCase()}`))]));
}
