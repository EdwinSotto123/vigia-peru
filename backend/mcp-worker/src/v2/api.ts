// La API de Vigía por service binding. Todas las herramientas pasan por acá: así la regla de privacidad es una sola
// (`publicar()` de la API: sin DNI, un apellido tapado, sin RUC 10) y el MCP no tiene SQL propio de Vigía.
//
// El pedido sale NUEVO, sin las cabeceras del cliente: sin `cf-connecting-ip` la API lo trata como interno (no le cuenta el
// límite por IP, que sería el mismo para todos los usuarios de claude.ai). El cupo por persona lo lleva el MCP (cupos.ts).
import type { EnvV2 } from "./entorno";

export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

type Valor = string | number | boolean | null | undefined;

const MENSAJES: Record<number, string> = {
  401: "La sesión de Gobserva venció: vuelve a conectar la cuenta.",
  403: "La API de Vigía no permite esta consulta.",
  404: "No está en Vigía: revisa el código (OCID, RUC o id).",
  429: "La API de Vigía está ocupada: intenta en un minuto.",
};

function mensaje(estado: number, datos: Record<string, unknown> | null): string {
  const detalle = datos?.detail ?? datos?.message ?? datos?.mensaje;
  if (typeof detalle === "string" && detalle.length < 400) return detalle;
  if (estado === 400 && typeof datos?.error === "string") return `Pedido no válido (${datos.error}).`;
  return MENSAJES[estado] ?? `La API de Vigía respondió ${estado}.`;
}

export async function api<T = Record<string, unknown>>(
  env: EnvV2,
  ruta: string,
  params: Record<string, Valor> = {},
  opciones: { metodo?: string; cuerpo?: unknown; token?: string } = {},
): Promise<T> {
  const url = new URL(`https://vigia-api.interno/v1${ruta}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const headers = new Headers({ accept: "application/json", "user-agent": "vigia-mcp/2" });
  if (opciones.token) headers.set("authorization", `Bearer ${opciones.token}`);
  let body: string | undefined;
  if (opciones.cuerpo !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opciones.cuerpo);
  }
  const r = await env.API.fetch(new Request(url, { method: opciones.metodo ?? "GET", headers, body }));
  const texto = await r.text();
  let datos: unknown = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }
  if (!r.ok) {
    const d = (datos && typeof datos === "object" ? datos : null) as Record<string, unknown> | null;
    throw new ErrorApi(r.status, typeof d?.error === "string" ? d.error : `http_${r.status}`, mensaje(r.status, d));
  }
  return datos as T;
}
