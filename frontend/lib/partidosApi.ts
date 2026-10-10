/**
 * Cliente de "Partidos y contratos" (migración 41). Backend: backend/api/src/routes/partidos.ts.
 *
 * Cada contrato se asocia al partido que gobernaba la entidad el mes en que se convocó (gobierno regional,
 * municipalidad provincial o distrital, según el período electoral). Se asocia al GANADOR de la elección:
 * una vacancia o un reemplazo dentro del período no está registrado, y la pantalla lo dice.
 *
 * Los GET devuelven `null` si la API no responde (mismo contrato que lib/contratos.ts): quien llama
 * no dibuja lo que no pudo leer. Funcionan en server components (fetch cacheado) y en el cliente.
 */

import { API_BASE } from "./api-client";

/** Los períodos con datos: la elección que los eligió (2014, 2018, 2022) y cuándo gobiernan. */
export const PERIODOS_GOBIERNO = [
  { anio: 2014, desde: "2015-01-01", hasta: "2018-12-31", texto: "2015 a 2018" },
  { anio: 2018, desde: "2019-01-01", hasta: "2022-12-31", texto: "2019 a 2022" },
  { anio: 2022, desde: "2023-01-01", hasta: "2026-12-31", texto: "2023 a 2026" },
] as const;
export type AnioGobierno = (typeof PERIODOS_GOBIERNO)[number]["anio"];
export const ANIO_GOBIERNO_VIGENTE: AnioGobierno = 2022;

export interface ConteosPartido {
  contratos: number;
  /** Ya leídos por Vigía. */
  leidos: number;
  /** Con señal para revisar (riesgo alto o medio). */
  conSenales: number;
  /** Esperando que alguien financie su lectura. */
  enCola: number;
  documentosListos: number;
  /** Valor referencial convocado, en soles (no lo pagado). */
  montoPen: number;
}

export interface FilaPartido extends ConteosPartido {
  /** Identificador estable (sin tildes, con guiones): va en la URL. */
  clave: string;
  nombre: string;
  tipo: string | null;
  /** Gobiernos del partido en el período, por nivel. */
  gobiernos: { regional: number; provincial: number; distrital: number };
  /** Gobiernos que tienen contratos en la base de Vigía. */
  gobiernosConContratos: number;
}

export interface RankingPartidos {
  anio: AnioGobierno;
  desde: string;
  hasta: string;
  data: FilaPartido[];
}

export interface DetallePartido {
  anio: AnioGobierno;
  desde: string;
  hasta: string;
  partido: { clave: string; nombre: string; tipo: string | null; gobiernos: { regional: number; provincial: number; distrital: number } };
  totales: ConteosPartido;
  /** Contratos convocados por mes ("2024-03") durante el período. */
  porMes: { mes: string; contratos: number; leidos: number; conSenales: number }[];
  /** Las entidades de ese partido con más contratos. */
  entidades: (ConteosPartido & { ruc: string; nombre: string; nivel: "regional" | "provincial" | "distrital"; lugar: string | null; autoridad: string | null })[];
  /** Por región (departamento): ubigeo de 2 dígitos. */
  regiones: (ConteosPartido & { ubigeo: string; nombre: string | null })[];
}

async function leer<T>(ruta: string, revalidate = 120): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export const getRankingPartidos = (anio: AnioGobierno = ANIO_GOBIERNO_VIGENTE) =>
  leer<RankingPartidos>(`/partidos/ranking?anio=${anio}`);

export const getDetallePartido = (clave: string, anio: AnioGobierno = ANIO_GOBIERNO_VIGENTE) =>
  leer<DetallePartido>(`/partidos/${encodeURIComponent(clave)}?anio=${anio}`);

/** "2024-03" → "mar. 2024" (para el eje de contratos por mes). */
export function mesCorto(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  if (!a || !m) return mes;
  return new Intl.DateTimeFormat("es-PE", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(a, m - 1, 1)));
}

export const esAnioGobierno = (n: number): n is AnioGobierno => PERIODOS_GOBIERNO.some((p) => p.anio === n);

/** El año de la URL (`?anio=`) o el período vigente si no es uno de los tres. */
export function anioDeUrl(v: string | string[] | undefined): AnioGobierno {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return esAnioGobierno(n) ? n : ANIO_GOBIERNO_VIGENTE;
}

/** 2022 → "2023 a 2026". */
export const periodoTexto = (anio: AnioGobierno) => PERIODOS_GOBIERNO.find((p) => p.anio === anio)!.texto;

/** El texto que explica, siempre igual, qué significa "por partido". */
export const EXPLICACION_PARTIDO =
  "Se leen contratos de las entidades que ese partido gobernó en ese período. Nadie elige cuáles. Se asocia al ganador de la elección: no registra vacancias ni reemplazos.";

export const AVISO_PARTIDO =
  "Estos contratos se asocian al partido que ganó la elección de ese período. Una señal es un motivo para revisar un contrato, nunca una acusación contra un partido ni una persona.";
