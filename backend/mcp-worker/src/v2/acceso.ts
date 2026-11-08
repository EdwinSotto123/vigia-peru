// Quién puede usar el MCP (2026-11-08, el usuario: «el MCP debe ser activo para gente con plan activo»): cada llamada pide
// una cuenta conectada y un plan de pago vigente (tienePlanPara, en entorno.ts). El plan viaja en el token del MCP (se
// relee en cada refresh, cada hora); si no alcanza, se relee al momento (con un minuto de memoria por cuenta), así quien
// acaba de contratar no tiene que reconectar.
import { api } from "./api";
import { leerCognito, NOMBRE_APP, renovarCognito } from "./cognito";
import { tienePlanPara, type EnvV2, type Usuario } from "./entorno";
import { ErrorSesion, renovarIdToken } from "./firebase";

/** Los planes activos de la cuenta («licitaciones:pro»); si la ruta no está o falla, ninguno. */
export async function planesDe(env: EnvV2, idToken: string): Promise<string[]> {
  try {
    const r = await api<{ planes?: { producto?: string; plan?: string }[] }>(env, "/gobserva/cuenta/planes", {}, { token: idToken });
    return (r.planes ?? []).filter((p) => p.plan && p.plan !== "gratis").map((p) => `${p.producto}:${p.plan}`);
  } catch {
    return [];
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
const memoria = new Map<string, { planes: string[]; al: number }>();

/** Los planes de la cuenta: los del token o, si no alcanzan para `producto`, los de hoy (releídos a lo más cada minuto). */
async function planesVigentes(env: EnvV2, u: Usuario, producto: "empleo" | "licitaciones" | undefined): Promise<string[]> {
  if (tienePlanPara(u.planes, producto)) return u.planes;
  const m = memoria.get(u.uid);
  if (m && Date.now() - m.al < RELEER_MS) return m.planes;
  if (Date.now() - u.planesAl < RELEER_MS) return u.planes;
  const planes = await planesDe(env, await idTokenDe(env, u));
  memoria.set(u.uid, { planes, al: Date.now() });
  if (memoria.size > 500) memoria.delete(memoria.keys().next().value as string);
  return planes;
}

const PLANES_EMPLEO = "https://empleo.gobserva.cloud/planes";
const PLANES_LICITACIONES = "https://licitaciones.gobserva.cloud/planes";

/** null si puede; si no, lo que verá quien pregunta (qué plan le falta, dónde se adquiere y con qué cuenta conectar). */
export async function revisarPlan(env: EnvV2, u: Usuario | null, producto: "empleo" | "licitaciones" | undefined): Promise<string | null> {
  if (!u) return "El MCP de Gobserva viene con los planes de pago: conecta tu cuenta de Gobserva Empleo o Gobserva Licitaciones en la configuración del conector.";
  if (tienePlanPara(await planesVigentes(env, u, producto), producto)) return null;
  const cuenta = u.app
    ? `Conectaste tu cuenta de ${NOMBRE_APP[u.app]}`
    : "Conectaste una cuenta de Vigía, que no tiene plan: desconecta el conector y vuelve a conectarlo con tu cuenta de Gobserva Empleo o Gobserva Licitaciones";
  if (producto === "empleo") {
    return `Esta herramienta (plazas CAS) es del plan de Gobserva Empleo. ${cuenta}. Adquiere un plan en ${PLANES_EMPLEO} y vuelve a preguntar.`;
  }
  if (producto === "licitaciones") {
    return `Esta herramienta (licitaciones, obras y mercado) es de los planes de Gobserva Licitaciones. ${cuenta}. Adquiere un plan en ${PLANES_LICITACIONES} y vuelve a preguntar.`;
  }
  return `El MCP de Gobserva viene con los planes de pago. ${cuenta}, sin un plan vigente. Adquiere uno en ${PLANES_EMPLEO} o en ${PLANES_LICITACIONES} y vuelve a preguntar.`;
}
