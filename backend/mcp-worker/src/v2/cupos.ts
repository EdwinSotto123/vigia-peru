// Cupos del MCP v2, contados por el Durable Object `Limitador` de vigia-api (el mismo que limita la API y la web).
//
// Por IP no sirve: todo claude.ai (web, Desktop, celular, Cowork) llega desde el rango de Anthropic 160.79.104.0/21, así
// que una IP es miles de personas. Entonces:
//   · con cuenta: por persona (uid) y por día, más un tope por minuto contra ráfagas;
//   · sin cuenta y desde Anthropic: un tope total por minuto para todo ese tráfico anónimo;
//   · sin cuenta y desde otro lado (Claude Code, otros clientes): por IP (una IPv6 por su /64).
// Si el limitador falla, se atiende: mejor eso que dejar el MCP caído.
//
// Créditos (2026-11-08, el usuario: «limitar el uso del MCP por nivel de cuenta»): cada plan trae créditos al mes (la API
// los manda con los planes: backend/api/src/lib/creditosMcp.ts) y cada llamada descuenta lo que pesa su herramienta
// (PESOS). Topes internos: en un día, a lo más la quinta parte del mes; filas por día contra quien quiera copiarse la base;
// 60 llamadas por minuto. Sólo se cobra lo que salió bien (registro.ts → cobrar). El contador vive en el Durable Object
// `Limitador` de vigia-api (clave `mcp2|u|<uid>|creditos`, una suma por mes y por día).
import { esDePago, type EnvV2, type TopesMcp, type Usuario } from "./entorno";

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

/**
 * Lo que descuenta cada herramienta. 0: lo de la cuenta. 1: búsquedas y fichas. 3: análisis (mercado, gasto, red,
 * historia, hallazgos, documentos, planilla, visitas). 10: la consulta libre de cifras y el ZIP de documentos.
 */
export const PESOS: Record<string, number> = {
  seguir: 0, dejar_de_seguir: 0, mis_seguimientos: 0, mi_cupo: 0, estado_fuentes: 0,
  mercado_rubro: 3, mercado_obras: 3, gasto_entidad: 3, gasto_por_concepto: 3, red_empresa: 3, historia: 3, hallazgos_entidad: 3,
  ranking_entidades: 3, buscar_documentos: 3, planilla_entidad: 3, visitas_entidad: 3, informes_control: 3, buscar_informes_control: 1, rastro_persona: 3, patrones: 3, precios_referencia: 3, precios_de_mercado: 3, norma_aplicable: 3,
  // El informe para control de un contrato (lo redacta un modelo abierto la primera vez): un análisis.
  informe_control_contrato: 3,
  consultar_datos: 10, documentos_zip: 10,
};
export const pesoDe = (herramienta: string) => PESOS[herramienta] ?? 1;

const NUM = new Intl.NumberFormat("es-PE");
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const lima = () => new Date(Date.now() - 5 * 3_600_000).toISOString();
export const mesLima = () => lima().slice(0, 7);
export const diaLima = () => lima().slice(0, 10);
/** «el 1 de diciembre». */
export function renuevan(mes = mesLima()): string {
  const m = Number(mes.slice(5, 7));
  return `el 1 de ${MESES[m % 12]}`;
}

interface UsoMcp {
  mes: number;
  dia: number;
  filas: number;
}
type ContadorCreditos = {
  creditos(mes: string, dia: string): Promise<UsoMcp>;
  gastar(mes: string, dia: string, creditos: number, filas: number): Promise<UsoMcp>;
};
const contadorDe = (env: EnvV2, uid: string) =>
  env.LIMITADOR!.get(env.LIMITADOR!.idFromName(`mcp2|u|${uid}|creditos`)) as unknown as ContadorCreditos;

const planesUrl = (u: Usuario) => (u.app === "empleo" ? "https://empleo.gobserva.cloud/planes" : "https://licitaciones.gobserva.cloud/planes");

/** Cuántas filas trajo una respuesta: los largos de sus listas de primer nivel (lo que sirve para copiarse la base). */
export function filasDe(r: unknown): number {
  if (!r || typeof r !== "object" || Array.isArray(r)) return Array.isArray(r) ? r.length : 0;
  return Object.values(r as Record<string, unknown>).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
}

/** null si la llamada entra; si no, el mensaje que verá quien pregunta. `mcp`: los créditos de su plan. */
export async function pasarCupo(env: EnvV2, ip: string | null, usuario: Usuario | null, herramienta: string, mcp?: TopesMcp | null): Promise<string | null> {
  if (!usuario) {
    if (esDeAnthropic(ip)) {
      return (await contar(env, "mcp2|anthropic", CUPOS.anonimoAnthropicPorMinuto, MINUTO))
        ? null
        : "Hay mucho uso sin cuenta en este momento. Conecta tu cuenta de Gobserva (en la configuración del conector) o intenta en un minuto.";
    }
    if (!ip) return null;
    return (await contar(env, `mcp2|ip|${claveIp(ip)}`, CUPOS.anonimoIpPorMinuto, MINUTO))
      ? null
      : `Sin cuenta el tope es de ${CUPOS.anonimoIpPorMinuto} llamadas por minuto. Espera un minuto o conecta tu cuenta de Gobserva.`;
  }
  if (usuario.planes.includes("interno")) return null; // el chat del panel
  if (!(await contar(env, `mcp2|u|${usuario.uid}|min`, CUPOS.cuentaPorMinuto, MINUTO))) {
    return `Son más de ${CUPOS.cuentaPorMinuto} llamadas en un minuto: espera un momento.`;
  }
  const peso = pesoDe(herramienta);
  if (peso === 0) return null;
  if (!mcp || !env.LIMITADOR) return cupoDiarioDeAntes(env, usuario, herramienta);
  let uso: UsoMcp;
  try {
    uso = await contadorDe(env, usuario.uid).creditos(mesLima(), diaLima());
  } catch {
    return null;
  }
  const quedan = Math.max(0, mcp.creditos - uso.mes);
  if (peso > quedan) {
    return quedan > 0
      ? `Esta consulta usa ${peso} créditos del MCP y te quedan ${NUM.format(quedan)} de ${NUM.format(mcp.creditos)} este mes. Se renuevan ${renuevan()}; para más, sube de plan en ${planesUrl(usuario)}.`
      : `Usaste los ${NUM.format(mcp.creditos)} créditos del MCP de este mes. Se renuevan ${renuevan()}; para más, sube de plan en ${planesUrl(usuario)}.`;
  }
  if (uso.dia + peso > mcp.topeDia) {
    return `Hoy ya usaste ${NUM.format(uso.dia)} créditos del MCP: en un día se puede usar hasta la quinta parte del mes (${NUM.format(mcp.topeDia)}). Mañana sigues.`;
  }
  if (uso.filas >= mcp.topeFilasDia) {
    return `Hoy ya trajiste ${NUM.format(uso.filas)} filas, el tope de un día: el MCP es para preguntar, no para copiar la base. Para bajar listas completas está la descarga en Excel de tu plan. Mañana sigues.`;
  }
  return null;
}

/**
 * Descuenta lo que gastó una llamada que salió bien. Devuelve un aviso cuando queda poco (el 10 % o menos del mes), para
 * que la IA se lo diga a quien pregunta.
 */
export async function cobrar(env: EnvV2, usuario: Usuario | null, herramienta: string, mcp: TopesMcp | null | undefined, filas: number): Promise<string | null> {
  if (!usuario || usuario.planes.includes("interno") || !mcp || !env.LIMITADOR) return null;
  const peso = pesoDe(herramienta);
  if (peso === 0 && filas === 0) return null;
  try {
    const uso = await contadorDe(env, usuario.uid).gastar(mesLima(), diaLima(), peso, filas);
    const quedan = Math.max(0, mcp.creditos - uso.mes);
    if (peso > 0 && quedan <= mcp.creditos * 0.1) {
      return `Aviso de Gobserva: te quedan ${NUM.format(quedan)} de ${NUM.format(mcp.creditos)} créditos del MCP este mes (se renuevan ${renuevan()}).`;
    }
  } catch {
    // Si el contador falla, la respuesta igual sale.
  }
  return null;
}

/**
 * Le avisa a la API una llamada que cobró créditos (POST /gobserva/interno/consumo, migración 268), para el panel de
 * consumo. En segundo plano (ctx.waitUntil): si falla, la llamada ya se atendió.
 */
export async function avisarConsumo(env: EnvV2, uid: string, herramienta: string, app: string): Promise<void> {
  const creditos = pesoDe(herramienta);
  if (!creditos || !env.MCP_INTERNO_TOKEN) return;
  try {
    await env.API.fetch(new Request("https://vigia-api.interno/v1/gobserva/interno/consumo", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vigia-interno": env.MCP_INTERNO_TOKEN },
      body: JSON.stringify({ uid, detalle: herramienta, app, creditos }),
    }));
  } catch {
    // sin el registro del panel; el cobro ya quedó en el contador
  }
}

/** El cupo de antes (por llamadas en 24 horas), para una cuenta cuyo token no trae créditos. */
async function cupoDiarioDeAntes(env: EnvV2, usuario: Usuario, herramienta: string): Promise<string | null> {
  const pago = esDePago(usuario);
  const porDia = pago ? CUPOS.pagoPorDia : CUPOS.gratisPorDia;
  if (!(await contar(env, `mcp2|u|${usuario.uid}|dia`, porDia, DIA, true))) {
    return `Llegaste al cupo de ${porDia} llamadas en 24 horas. Si necesitas más, escribe a Gobserva por el plan Institucional.`;
  }
  if (HERRAMIENTAS_DE_DATOS.has(herramienta)) {
    const datos = pago ? CUPOS.datosPagoPorDia : CUPOS.datosGratisPorDia;
    if (!(await contar(env, `mcp2|u|${usuario.uid}|datos`, datos, DIA, true))) {
      return `Llegaste al cupo de ${datos} consultas de cifras en 24 horas.`;
    }
  }
  return null;
}
