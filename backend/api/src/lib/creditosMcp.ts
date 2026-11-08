/**
 * Los créditos del MCP (2026-11-08, el usuario: «limitar el uso del MCP por nivel de cuenta»). Cada plan trae créditos al
 * mes (gobservaPlanes.ts, `limites.mcp`); cada llamada descuenta según lo que pesa la herramienta (1 las búsquedas y
 * fichas, 3 los análisis, 10 la consulta libre de cifras y el ZIP de documentos: backend/mcp-worker/src/v2/cupos.ts). El
 * mes y el día son los de Lima. Topes internos que no se venden: en un día, a lo más la quinta parte del mes; y un tope de
 * filas por día contra quien quiera copiarse la base.
 *
 * Esta API es la fuente de los números (los manda en GET /gobserva/cuenta/planes); el MCP cuenta en el Durable Object
 * `Limitador` (workers/limitador.ts, clave `mcp2|u|<uid>|creditos`) y la cuenta lo lee en GET /gobserva/cuenta/mcp.
 */

export interface TopesMcp {
  /** Créditos al mes (la suma de los planes vigentes de la cuenta). */
  creditos: number;
  /** Lo más que se gasta en un día. */
  topeDia: number;
  /** Filas que pueden traer las herramientas de listas en un día. */
  topeFilasDia: number;
}

export function topesMcp(creditos: number): TopesMcp {
  const c = Math.max(0, Math.floor(creditos));
  return { creditos: c, topeDia: Math.ceil(c / 5), topeFilasDia: c ? Math.max(2000, c * 2) : 0 };
}

const lima = (ms: number) => new Date(ms - 5 * 3_600_000).toISOString();
/** «2026-11». */
export const mesLima = (ms = Date.now()) => lima(ms).slice(0, 7);
/** «2026-11-08». */
export const diaLima = (ms = Date.now()) => lima(ms).slice(0, 10);

/** El día en que se renuevan: el 1 del mes siguiente («2026-12-01»). */
export function renuevaMcp(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}
