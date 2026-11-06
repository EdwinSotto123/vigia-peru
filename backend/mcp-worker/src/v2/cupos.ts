// Cupos del MCP v2, contados por el Durable Object `Limitador` de vigia-api (el mismo que limita la API y la web).
//
// Por IP no sirve: todo claude.ai (web, Desktop, celular, Cowork) llega desde el rango de Anthropic 160.79.104.0/21, así
// que una IP es miles de personas. Entonces:
//   · con cuenta: por persona (uid) y por día, más un tope por minuto contra ráfagas;
//   · sin cuenta y desde Anthropic: un tope total por minuto para todo ese tráfico anónimo;
//   · sin cuenta y desde otro lado (Claude Code, otros clientes): por IP (una IPv6 por su /64).
// Si el limitador falla, se atiende: mejor eso que dejar el MCP caído.
import { esDePago, type EnvV2, type Usuario } from "./entorno";

export const CUPOS = {
  anonimoAnthropicPorMinuto: 600,
  anonimoIpPorMinuto: 60,
  cuentaPorMinuto: 60,
  gratisPorDia: 300,
  pagoPorDia: 3000,
  datosGratisPorDia: 50,
  datosPagoPorDia: 1000,
} as const;

const MINUTO = 60_000;
const DIA = 86_400_000;

function ipv4(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  const n = p.map(Number);
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((n[0] << 24) | (n[1] << 16) | (n[2] << 8) | n[3]) >>> 0;
}

const ANTHROPIC = ipv4("160.79.104.0")!;
export function esDeAnthropic(ip: string | null): boolean {
  const n = ip ? ipv4(ip) : null;
  return n !== null && n >>> 11 === ANTHROPIC >>> 11; // /21
}

/** Una IPv4 entera; una IPv6 por su /64 (como backend/api/src/lib/antibots.ts → claveIp). */
function claveIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  const comprimida = ip.includes("::");
  const [cabeza = "", cola = ""] = ip.toLowerCase().split("::");
  const antes = cabeza ? cabeza.split(":") : [];
  const despues = comprimida && cola ? cola.split(":") : [];
  const grupos = comprimida ? [...antes, ...Array<string>(Math.max(0, 8 - antes.length - despues.length)).fill("0"), ...despues] : antes;
  return `${grupos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

type Contador = { contar(tope: number, ventanaMs: number, persistente?: boolean): Promise<boolean> };

async function contar(env: EnvV2, clave: string, tope: number, ventanaMs: number, persistente = false): Promise<boolean> {
  if (!env.LIMITADOR) return true;
  try {
    const objeto = env.LIMITADOR.get(env.LIMITADOR.idFromName(clave)) as unknown as Contador;
    return await objeto.contar(tope, ventanaMs, persistente);
  } catch {
    return true;
  }
}

export const HERRAMIENTAS_DE_DATOS = new Set(["consultar_datos"]);

/** null si la llamada entra; si no, el mensaje que verá quien pregunta. */
export async function pasarCupo(env: EnvV2, ip: string | null, usuario: Usuario | null, herramienta: string): Promise<string | null> {
  if (!usuario) {
    if (esDeAnthropic(ip)) {
      return (await contar(env, "mcp2|anthropic", CUPOS.anonimoAnthropicPorMinuto, MINUTO))
        ? null
        : "Hay mucho uso sin cuenta en este momento. Conecta tu cuenta gratis de Gobserva (en la configuración del conector) para tener tu propio cupo, o intenta en un minuto.";
    }
    if (!ip) return null;
    return (await contar(env, `mcp2|ip|${claveIp(ip)}`, CUPOS.anonimoIpPorMinuto, MINUTO))
      ? null
      : `Sin cuenta el tope es de ${CUPOS.anonimoIpPorMinuto} llamadas por minuto. Espera un minuto o conecta tu cuenta gratis de Gobserva.`;
  }
  const pago = esDePago(usuario);
  if (!(await contar(env, `mcp2|u|${usuario.uid}|min`, CUPOS.cuentaPorMinuto, MINUTO))) {
    return `Son más de ${CUPOS.cuentaPorMinuto} llamadas en un minuto: espera un momento.`;
  }
  const porDia = pago ? CUPOS.pagoPorDia : CUPOS.gratisPorDia;
  if (!(await contar(env, `mcp2|u|${usuario.uid}|dia`, porDia, DIA, true))) {
    return pago
      ? `Llegaste al cupo de ${porDia} llamadas en 24 horas. Si necesitas más, escribe a Gobserva por el plan Institucional.`
      : `Llegaste al cupo gratis de ${porDia} llamadas en 24 horas. Los planes de Gobserva (gobserva.cloud) suben el cupo a ${CUPOS.pagoPorDia}.`;
  }
  if (HERRAMIENTAS_DE_DATOS.has(herramienta)) {
    const datos = pago ? CUPOS.datosPagoPorDia : CUPOS.datosGratisPorDia;
    if (!(await contar(env, `mcp2|u|${usuario.uid}|datos`, datos, DIA, true))) {
      return `Llegaste al cupo de ${datos} consultas de cifras en 24 horas.${pago ? "" : " Con un plan de Gobserva son " + CUPOS.datosPagoPorDia + "."}`;
    }
  }
  return null;
}
