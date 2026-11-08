/**
 * El asistente de cada app de Gobserva (2026-11-08, el usuario: «un chat interno por cada uno, con Haiku y Sonnet, por
 * créditos»). Es el motor del chat del panel (lib/chatInvestigacion.ts) con las herramientas de la dirección del MCP de su
 * producto (/mcp/empleo, /mcp/licitaciones), sus instrucciones y topes más cortos. Cobra de los mismos créditos del mes
 * que el MCP (lib/creditosMcp.ts), porque acá el modelo lo pagamos nosotros:
 *
 *   rápido    Haiku 5.5, 5 créditos la pregunta (unos US$ 0,006 medidos en el panel)
 *   fino      Sonnet 5.5, 25 créditos
 *   profundo  Sonnet 5.5 con plan y verificación: lo que cueste (1 crédito ≈ US$ 0,0016), de 25 a 100
 *
 * Empleo sólo trae el rápido (su plan es de S/ 9,90). Sólo se cobra la pregunta que tuvo respuesta. Las conversaciones no
 * se guardan en el servidor.
 */
import type { ModeloChat } from "./chatInvestigacion.js";

export type AppChat = "empleo" | "licitaciones";
export type ModoChat = "rapido" | "fino" | "profundo";

export const MODOS_APP: Record<AppChat, ModoChat[]> = { empleo: ["rapido"], licitaciones: ["rapido", "fino", "profundo"] };

/** Lo que se reserva antes de preguntar (lo más que puede costar) y lo que se cobra fijo. */
export const CREDITOS_MODO: Record<ModoChat, number> = { rapido: 5, fino: 25, profundo: 100 };
const USD_POR_CREDITO = 0.0016;
const PROFUNDO_MIN = 25;

/** Lo que se cobra al terminar: fijo en rápido y fino; en profundo, lo que costó, entre 25 y 100. */
export function creditosCobrados(modo: ModoChat, costoUsd: number): number {
  if (modo !== "profundo") return CREDITOS_MODO[modo];
  return Math.min(CREDITOS_MODO.profundo, Math.max(PROFUNDO_MIN, Math.ceil(costoUsd / USD_POR_CREDITO)));
}

export const modeloDe = (modo: ModoChat): ModeloChat => (modo === "rapido" ? "rapido" : "fino");

const TOPES: Record<ModoChat, { vueltas: number; max: number }> = {
  rapido: { vueltas: 10, max: 6000 },
  fino: { vueltas: 14, max: 10000 },
  profundo: { vueltas: 22, max: 16000 },
};

const COMUN = `Cómo responder:
- En español del Perú, de tú, claro y directo. Primero la respuesta en una o dos frases; después el detalle.
- Usa SOLO lo que devuelven tus herramientas: no inventes datos ni completes con lo que creas saber. Si algo no está, dilo.
- Si una búsqueda da poco o nada, reintenta con otras palabras (singular, plural, sinónimos) antes de decir que no hay.
- Tablas cuando haya varias filas: una fila por registro, cifras con S/ y separador de miles (S/ 4,500.00), la columna del nombre enlazada.
- Enlaza cada cosa que nombres con el enlace que trae la herramienta, y el oficial cuando venga.
- No nombres las herramientas ni sus parámetros: habla de los datos y de su fuente.
- Separa con comas, puntos o listas, nunca con «·».
- Nunca pidas ni muestres un DNI. Las personas naturales salen con un apellido tapado: respétalo. Una señal es un indicio, no una acusación.`;

function hoy(): string {
  return new Date().toLocaleDateString("es-PE", { timeZone: "America/Lima", day: "numeric", month: "long", year: "numeric" });
}

function sistemaEmpleo(): string {
  return `Eres el asistente de Gobserva Empleo. Ayudas a una persona a encontrar plazas CAS del Estado peruano a las que puede postular y a entender sus requisitos. Las plazas salen de SERVIR, se leen cada día y solo están las abiertas hoy. Hoy es ${hoy()}.

Cómo ayudar:
- Si te dice su carrera, sus estudios, sus años de experiencia, su región o el sueldo que busca, úsalos para buscar. Si falta algo importante, búscalo igual y al final pregunta lo que mejoraría la búsqueda.
- Muestra las plazas en una tabla: puesto, entidad, lugar, sueldo, cuándo cierra y el enlace. Primero las que mejor calzan y las que cierran antes.
- Para una plaza concreta, trae su ficha: requisitos (formación, experiencia, cursos), sueldo frente a otras entidades, plazo y enlace oficial para postular. Dile qué cumple y qué le falta si te dio su perfil.
- No prometas que la van a contratar: explica los requisitos y el plazo.

${COMUN}`;
}

function sistemaLicitaciones(profundo: boolean): string {
  return `Eres el asistente de Gobserva Licitaciones. Ayudas a una empresa que le vende al Estado peruano a encontrar oportunidades (licitaciones del SEACE, contratos menores, obras que se vienen), a entender qué piden las bases y a conocer al comprador y a la competencia. Hoy es ${hoy()}.

Cómo ayudar:
- Oportunidades: busca por rubro, región y monto; muestra en tabla el objeto, la entidad, el valor referencial, el plazo (de consultas o de cotización) y el enlace. Las que cierran antes, primero.
- Bases y requisitos: busca dentro de los documentos del proceso (experiencia exigida, marcas, plazos, garantías, penalidades) y cita documento y página. Si piden los documentos, arma el ZIP y da el enlace.
- El comprador: qué compra la entidad, cuánto y a quién (sus proveedores principales y sus órdenes).
- La competencia y el precio: quién gana en ese rubro, a qué precio y cuántos compiten (el mercado del rubro); la ficha de una empresa competidora.
- Obras: los proyectos que se vienen o están en marcha, su avance y quién los gana.
- Cuando des una cifra para decidir (precio de referencia, monto adjudicado), di de dónde sale y de qué periodo.
- Debajo de cada respuesta hay botones para bajarla en Word, PDF y Excel: si piden un informe o un Excel, no digas que no puedes; arma la respuesta pensando en ese archivo.

${COMUN}${profundo ? `

Modo profundo:
- Antes de la primera consulta escribe un plan breve (de 3 a 5 pasos).
- Llama en paralelo lo que no depende entre sí y cruza fuentes: verifica las cifras principales con una segunda consulta y di si coinciden.
- Termina con «Recomendación» (qué haría la empresa, con sus riesgos) y «Lo que no pude verificar».` : ""}`;
}

/** `perfil`: lo que quien pregunta guardó en su cuenta (perfilParaChat), para buscar sin que lo repita. */
export function pedidoApp(app: AppChat, modo: ModoChat, perfil?: string | null): { ruta: string; sistema: string; vueltas: number; max: number } {
  const base = app === "empleo" ? sistemaEmpleo() : sistemaLicitaciones(modo === "profundo");
  const conPerfil = perfil
    ? `${base}\n\nLo que quien pregunta guardó en su cuenta de Gobserva (úsalo para buscar y ordenar sin pedírselo de nuevo; si pregunta por otra cosa, responde eso):\n${perfil}`
    : base;
  return {
    ruta: app === "empleo" ? "/mcp/empleo" : "/mcp/licitaciones",
    sistema: conPerfil,
    ...TOPES[modo],
  };
}

const ESTUDIOS_TEXTO: Record<string, string> = {
  secundaria: "secundaria", tecnica: "técnica", egresado: "egresado o estudiante", bachiller: "bachiller", titulo: "título profesional", posgrado: "posgrado",
};

/** El perfil de Empleo («Mi perfil», la query que guarda la entrevista) en palabras. */
export function perfilEmpleoTexto(query: string): string | null {
  const q = new URLSearchParams(query);
  const lista = (k: string) => (q.get(k) ?? "").split("|").map((x) => x.trim()).filter(Boolean);
  const partes = [
    lista("carreras").length ? `Carrera: ${lista("carreras").join(", ")}.` : "",
    lista("palabras").length ? `Puestos que le interesan: ${lista("palabras").join(", ")}.` : "",
    q.get("tengo") ? `Estudios: ${ESTUDIOS_TEXTO[q.get("tengo")!] ?? q.get("tengo")}.` : "",
    q.get("exp") ? `Experiencia: ${q.get("exp")} años o más.` : "",
    q.get("region") ? `Dónde quiere trabajar: ${q.get("region")!.replace(/-/g, " ")}.` : "Dónde quiere trabajar: cualquier región.",
    q.get("sueldo") ? `Sueldo mínimo: S/ ${q.get("sueldo")}.` : "",
  ].filter(Boolean);
  return partes.length > 1 ? partes.join(" ") : null;
}

/** Las líneas de negocio de Licitaciones en palabras. */
export function lineasTexto(lineas: { nombre: string; descripcion: string; palabras: string[]; regiones: string[]; tipos: string[] }[], departamentos: Record<string, string>): string | null {
  if (!lineas.length) return null;
  return lineas
    .map((l) => {
      const regiones = l.regiones.map((r) => departamentos[r] ?? r).join(", ");
      return `Línea «${l.nombre}»: ${l.descripcion.slice(0, 300)}${l.palabras.length ? `. Palabras: ${l.palabras.join(", ")}` : ""}${regiones ? `. Regiones: ${regiones}` : ""}${l.tipos.length ? `. Compra de: ${l.tipos.join(", ")}` : ""}.`;
    })
    .join("\n");
}
