// Quién puede usar el MCP (2026-11-08, el usuario: «el MCP debe ser activo para gente con plan activo»): cada llamada pide
// una cuenta conectada y un plan vigente (tienePlanPara, en entorno.ts). Con los cobros en pausa (2026-11-24, freemium), la
// API da el plan abierto a toda cuenta con correo verificado: lo único que puede faltar es confirmar el correo. El plan viaja en el token del MCP (se
// relee en cada refresh, cada hora); si no alcanza, se relee al momento (con un minuto de memoria por cuenta), así quien
// acaba de contratar no tiene que reconectar.
import { api } from "./api";
import { leerCognito, NOMBRE_APP, renovarCognito } from "./cognito";
import { tienePlanPara, type EnvV2, type TopesMcp, type Usuario } from "./entorno";
import { ErrorSesion, renovarIdToken } from "./firebase";

export interface CuentaMcp {
  /** «licitaciones:pro», … */
  planes: string[];
  /** Sus créditos (null si la API no los mandó: se usa el cupo diario de antes). */
  mcp: TopesMcp | null;
  /** Los cobros de Gobserva en pausa (freemium): sin plan sólo falta confirmar el correo. */
  enPausa: boolean;
}

/** Los planes activos de la cuenta y sus créditos del MCP; si la ruta no está o falla, ninguno. */
export async function planesDe(env: EnvV2, idToken: string): Promise<CuentaMcp> {
  try {
    const r = await api<{ planes?: { producto?: string; plan?: string }[]; mcp?: TopesMcp; enPausa?: boolean }>(env, "/gobserva/cuenta/planes", {}, { token: idToken });
    return {
      planes: (r.planes ?? []).filter((p) => p.plan && p.plan !== "gratis").map((p) => `${p.producto}:${p.plan}`),
      mcp: r.mcp && typeof r.mcp.creditos === "number" ? r.mcp : null,
      enPausa: r.enPausa !== false,
    };
  } catch {
    return { planes: [], mcp: null, enPausa: true };
  }
}

/** Un ID token nuevo de la cuenta conectada (Cognito para las apps, Firebase para Vigía). */
export async function idTokenDe(env: EnvV2, u: Pick<Usuario, "app" | "crt" | "frt">): Promise<string> {
  if (u.app) {
    const g = leerCognito(env.COGNITO_GOBSERVA).find((x) => x.app === u.app);
    if (!g || !u.crt) throw new ErrorSesion("sin token de refresco");
    return renovarCognito(g, u.crt);
  }
  if (!u.frt) throw new ErrorSesion("sin token de refresco");
  return (await renovarIdToken(env, u.frt)).idToken;
}

const RELEER_MS = 60_000;
const memoria = new Map<string, CuentaMcp & { al: number }>();

/**
 * Los planes y créditos de la cuenta: los del token o, si no alcanzan para `producto` (o el token es de antes de los
 * créditos), los de hoy, releídos a lo más cada minuto.
 */
async function vigente(env: EnvV2, u: Usuario, producto: "empleo" | "licitaciones" | undefined): Promise<CuentaMcp> {
  if (tienePlanPara(u.planes, producto) && (u.mcp || u.planes.includes("interno"))) return { planes: u.planes, mcp: u.mcp ?? null, enPausa: true };
  const m = memoria.get(u.uid);
  if (m && Date.now() - m.al < RELEER_MS) return m;
  if (Date.now() - u.planesAl < RELEER_MS) return { planes: u.planes, mcp: u.mcp ?? null, enPausa: true };
  const c = await planesDe(env, await idTokenDe(env, u));
  memoria.set(u.uid, { ...c, al: Date.now() });
  if (memoria.size > 500) memoria.delete(memoria.keys().next().value as string);
  return c;
}

const PLANES_EMPLEO = "https://empleo.gobserva.cloud/planes";
const PLANES_LICITACIONES = "https://licitaciones.gobserva.cloud/planes";

/**
 * `{ mcp }` (sus créditos) si puede; si no, `{ error }`: lo que verá quien pregunta (qué plan le falta, dónde se
 * adquiere y con qué cuenta conectar).
 */
export async function revisarPlan(env: EnvV2, u: Usuario | null, producto: "empleo" | "licitaciones" | undefined): Promise<{ error: string } | { mcp: TopesMcp | null }> {
  const no = (error: string) => ({ error });
  if (!u) {
    return no("El MCP de Gobserva es gratis con una cuenta verificada: conecta tu cuenta de Gobserva (Empleo, Licitaciones o Vigía) en la configuración del conector. Si no tienes una, créala con tu correo y confírmalo.");
  }
  const c = await vigente(env, u, producto);
  if (tienePlanPara(c.planes, producto)) return { mcp: c.mcp };
  if (c.enPausa) {
    return no("Tu cuenta todavía no tiene el correo confirmado. Ábrelo con el enlace que te enviamos (o entra con Google) y vuelve a preguntar: el MCP es gratis con una cuenta verificada.");
  }
  const cuenta = u.app
    ? `Conectaste tu cuenta de ${NOMBRE_APP[u.app]}`
    : "Conectaste una cuenta de Vigía, que no tiene plan: desconecta el conector y vuelve a conectarlo con tu cuenta de Gobserva Empleo o Gobserva Licitaciones";
  if (producto === "empleo") {
    return no(`Esta herramienta (plazas CAS) es del plan de Gobserva Empleo. ${cuenta}. Adquiere un plan en ${PLANES_EMPLEO} y vuelve a preguntar.`);
  }
  if (producto === "licitaciones") {
    return no(`Esta herramienta (licitaciones, obras y mercado) es de los planes de Gobserva Licitaciones. ${cuenta}. Adquiere un plan en ${PLANES_LICITACIONES} y vuelve a preguntar.`);
  }
  return no(`El MCP de Gobserva viene con los planes de pago. ${cuenta}, sin un plan vigente. Adquiere uno en ${PLANES_EMPLEO} o en ${PLANES_LICITACIONES} y vuelve a preguntar.`);
}
