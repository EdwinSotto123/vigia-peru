// Lo común a las respuestas del MCP v2: enlaces a Vigía, regiones, RUC, recortes y la forma de cada resultado.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { EnvV2 } from "./entorno";

/** Un error que se le explica a quien pregunta (no un fallo del servidor). */
export class ErrorUsuario extends Error {}

export const AVISO =
  "Señal de riesgo, no acusación. La denuncia corresponde a la Contraloría o a la Fiscalía; verifica en la fuente oficial (SEACE/OECE).";

export function hoyLima(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Lima" });
}

export function enlaces(env: EnvV2) {
  const v = env.VIGIA_URL;
  return {
    contrato: (ocid: string) => `${v}/app/contratos/${encodeURIComponent(ocid)}`,
    dictamen: (ocid: string) => `${v}/app/contratos/${encodeURIComponent(ocid)}?vista=dictamen`,
    menor: (id: string | number) => `${v}/app/contratos/menor/${id}`,
    empresa: (ruc: string) => `${v}/empresa/${ruc}`,
    entidad: (ruc: string) => `${v}/entidad/${ruc}`,
    partido: (clave: string) => `${v}/app/partidos/${encodeURIComponent(clave)}`,
    planilla: (codigo: string) => `${v}/app/personas/planilla/${codigo}`,
    obra: (cui: string) => `https://obras.gobserva.cloud/proyecto/${cui}`,
  };
}

const DEPARTAMENTOS: [string, string, string][] = [
  ["01", "amazonas", "Amazonas"], ["02", "ancash", "Áncash"], ["03", "apurimac", "Apurímac"], ["04", "arequipa", "Arequipa"],
  ["05", "ayacucho", "Ayacucho"], ["06", "cajamarca", "Cajamarca"], ["07", "callao", "Callao"], ["08", "cusco", "Cusco"],
  ["09", "huancavelica", "Huancavelica"], ["10", "huanuco", "Huánuco"], ["11", "ica", "Ica"], ["12", "junin", "Junín"],
  ["13", "la libertad", "La Libertad"], ["14", "lambayeque", "Lambayeque"], ["15", "lima", "Lima"], ["16", "loreto", "Loreto"],
  ["17", "madre de dios", "Madre de Dios"], ["18", "moquegua", "Moquegua"], ["19", "pasco", "Pasco"], ["20", "piura", "Piura"],
  ["21", "puno", "Puno"], ["22", "san martin", "San Martín"], ["23", "tacna", "Tacna"], ["24", "tumbes", "Tumbes"], ["25", "ucayali", "Ucayali"],
];

const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();

/** «Cusco», «cuzco», «Junín», «08» → { ubigeo: "08", nombre: "Cusco" }. */
export function region(texto: string | undefined): { ubigeo: string; nombre: string } | undefined {
  if (!texto) return undefined;
  const t = sinTildes(texto).replace(/^(region|departamento|gobierno regional( de)?)\s+/, "").replace(/^cuzco$/, "cusco");
  const d = DEPARTAMENTOS.find(([u, n]) => u === t || n === t);
  if (!d) throw new ErrorUsuario(`No reconozco la región «${texto}». Usa el nombre de un departamento: ${DEPARTAMENTOS.map((x) => x[2]).join(", ")}.`);
  return { ubigeo: d[0], nombre: d[2] };
}

export const NOMBRES_REGION = DEPARTAMENTOS.map((d) => d[2]);

const soloDigitos = (t: string) => t.replace(/\D/g, "");

/** RUC de una empresa o entidad. Un RUC 10 (persona natural) no se consulta. */
export function rucJuridico(texto: string, que = "RUC"): string {
  const ruc = soloDigitos(texto);
  if (ruc.length !== 11) throw new ErrorUsuario(`El ${que} debe tener 11 dígitos («${texto}» no los tiene). Si no lo sabes, usa la herramienta buscar.`);
  if (ruc.startsWith("10")) {
    throw new ErrorUsuario("Ese RUC es de una persona natural: Vigía no muestra ni busca personas naturales por su RUC o DNI.");
  }
  return ruc;
}

/** OCID completo (ocds-…-1228227) o el código corto (1228227, OECE-1228227). */
export function ocid(texto: string): string {
  const t = texto.trim().replace(/^OECE-/i, "");
  if (!/^[\w.-]{1,64}$/.test(t)) throw new ErrorUsuario(`«${texto}» no parece un OCID ni un código de convocatoria.`);
  return t;
}

export function recortar(texto: unknown, max: number): string | null {
  if (texto == null) return null;
  const s = String(texto).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

export const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** Solo las llaves pedidas, sin null ni listas vacías: respuestas cortas para el modelo. */
export function tomar<T extends Record<string, unknown>>(o: T | null | undefined, llaves: (keyof T)[]): Partial<T> {
  const r: Partial<T> = {};
  if (!o) return r;
  for (const k of llaves) {
    const v = o[k];
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    r[k] = v;
  }
  return r;
}

/** Resultado de una herramienta: JSON compacto con la fecha de la consulta. */
export function resultado(datos: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ ...datos, consultado: hoyLima() }) }] };
}

export function fallo(mensaje: string): CallToolResult {
  return { content: [{ type: "text", text: mensaje }], isError: true };
}
