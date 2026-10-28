/**
 * Cliente de "Partidos y contratos" (migración 41). Backend: backend/api/src/routes/partidos.ts.
 *
 * Cada contrato se asocia al partido que gobernaba la entidad el mes en que se convocó (gobierno regional,
 * municipalidad provincial o distrital, según el período electoral). Se asocia al GANADOR de la elección:
 * una vacancia o un reemplazo dentro del período no está registrado, y la pantalla lo dice.
 *
 * Desde la migración 65 hay una segunda fuente: los procesos adjudicados del OECE desde 2015 (CONOSCE desde 2018, migración 68 antes; `procesos`,
 * `historia`, `gobiernos`, getProcesosPartido), para los tres períodos. La base de Vigía (`contratos`, leídos, cola) es
 * casi toda de 2026: sola, dejaba a los períodos anteriores sin nada.
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
  /** Gobiernos que tienen contratos en la base de Vigía (con filtro de región: solo los de esa región). */
  gobiernosConContratos: number;
  /** Departamentos (ubigeo de 2 dígitos) donde el partido tiene contratos o procesos. */
  regiones?: string[];
  /** Procesos adjudicados de sus gobiernos en el período (CONOSCE). Falta en la API vieja. */
  procesos?: number;
  /** Lo adjudicado en esos procesos, en soles (los procesos en otras monedas cuentan, pero no se suman). */
  montoAdjudicadoPen?: number;
  gobiernosConProcesos?: number;
}

export interface RankingPartidos {
  anio: AnioGobierno;
  desde: string;
  hasta: string;
  /** Departamento del filtro (2 dígitos), si lo hubo. */
  region?: string | null;
  /** Cuántos partidos cumplen los filtros, sin paginar. Las API antiguas no lo traen: se usa `data.length`. */
  total?: number;
  limit?: number | null;
  offset?: number;
  data: FilaPartido[];
}

export type OrdenPartidos = "contratos" | "cola" | "leidos" | "nombre" | "procesos" | "monto";
export const ORDENES_PARTIDOS: { valor: OrdenPartidos; etiqueta: string }[] = [
  { valor: "cola", etiqueta: "Más en cola" },
  { valor: "contratos", etiqueta: "Más contratos" },
  { valor: "leidos", etiqueta: "Más leídos" },
  { valor: "procesos", etiqueta: "Más procesos" },
  { valor: "monto", etiqueta: "Más adjudicado" },
  { valor: "nombre", etiqueta: "Nombre, de la A a la Z" },
];
export const esOrdenPartidos = (v: unknown): v is OrdenPartidos => ORDENES_PARTIDOS.some((o) => o.valor === v);

/** Filtros y paginación del ranking. Sin `limit` la API devuelve todos los partidos (los usos de portada e inicio). */
export interface OpcionesRanking {
  /** Departamento, 2 dígitos del ubigeo ("15" Lima). */
  region?: string;
  /** Parte del nombre (desde 2 letras). */
  q?: string;
  /** Solo los que tienen contratos esperando lectura. */
  conCola?: boolean;
  orden?: OrdenPartidos;
  limit?: number;
  offset?: number;
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
  /** Sus procesos adjudicados del período (CONOSCE, migración 65). Falta en la API vieja. */
  historia?: {
    procesos: number;
    montoAdjudicadoPen: number;
    entidades: number;
    proveedores: number;
    gobiernosConProcesos: number;
    desde: string | null;
    hasta: string | null;
    porMes: { mes: string; procesos: number; montoAdjudicadoPen: number }[];
    porObjeto: { objeto: string; procesos: number; montoAdjudicadoPen: number }[];
  };
  /** TODOS los gobiernos que ganó en el período, con sus procesos y sus contratos en la base de Vigía. */
  gobiernos?: GobiernoDePartido[];
}

export interface GobiernoDePartido {
  nivel: "regional" | "provincial" | "distrital";
  ubigeo: string;
  autoridad: string | null;
  lugar: string | null;
  provincia: string | null;
  region: string | null;
  procesos: number;
  montoAdjudicadoPen: number;
  contratos: number;
  leidos: number;
  conSenales: number;
  /** La entidad que abre ese gobierno (la de más procesos; en un gobierno regional, casi siempre la sede). */
  ruc: string | null;
}

/** Un proceso adjudicado de CONOSCE (GET /partidos/:clave/procesos). */
export interface ProcesoPartido extends EstadoEnVigia {
  codigo: string;
  nomenclatura: string | null;
  descripcion: string | null;
  objeto: string | null;
  tipoProceso: string | null;
  fecha: string;
  entidad: string | null;
  entidadRuc: string;
  /** El gobierno (en la lista de un partido); `null` en la de una entidad. */
  nivel: "regional" | "provincial" | "distrital" | null;
  lugar: string | null;
  items: number;
  montoReferencial: number | null;
  montoAdjudicado: number | null;
  moneda: string | null;
  proveedores: number;
  proveedor: string | null;
  rucProveedor: string | null;
  /** Si el proceso también está en la base de Vigía: abre su ficha. */
  ocid: string | null;
}

/** Lo que Vigía sabe de un proceso que también está en su base (mismos campos que una fila de /contratos). */
export interface EstadoEnVigia {
  estadoProcesamiento?: string | null;
  estadoOperativo?: string | null;
  score?: number | null;
  banderas?: number | null;
  enRevision?: boolean;
  /** Antecedentes del ganador: cada tipo una vez, con su severidad más alta. */
  cruces?: { tipo: string; severidad: "alta" | "media" | "baja" }[] | null;
}

export interface ProcesosPartido {
  total: number;
  montoAdjudicadoPen: number;
  page: number;
  size: number;
  data: ProcesoPartido[];
  /** Conteos de "¿Lo leyó Vigía?", "Riesgo" y "Antecedentes" (sólo los procesos que están en la base de Vigía). */
  facetas?: {
    porLectura: Record<string, number>;
    porRiesgo: Record<string, number>;
    porCruces: { con: number; alta: number; tipos?: Record<string, number> } | null;
  };
}

/** Los procesos de UNA entidad desde 2015 (GET /entidades/:ruc/procesos): `resumen`, sin filtros, para las cifras. */
export interface ProcesosEntidad extends ProcesosPartido {
  resumen: {
    procesos: number;
    montoAdjudicadoPen: number;
    proveedores: number;
    desde: string | null;
    porAnio: { anio: number; procesos: number; montoAdjudicadoPen: number }[];
    porObjeto: { objeto: string; procesos: number; montoAdjudicadoPen: number }[];
  };
}

export interface FiltrosProcesos {
  nivel?: string;
  region?: string;
  ubigeo?: string;
  q?: string;
  objeto?: string;
  lectura?: string;
  riesgo?: string;
  cruces?: string;
  orden?: "fecha" | "monto";
  page?: number;
  size?: number;
}

async function leer<T>(ruta: string, revalidate = 120): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { next: { revalidate } } as RequestInit);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export function getRankingPartidos(anio: AnioGobierno = ANIO_GOBIERNO_VIGENTE, o: OpcionesRanking = {}) {
  const p = new URLSearchParams({ anio: String(anio) });
  if (o.region && /^\d{2}$/.test(o.region)) p.set("region", o.region);
  const q = (o.q ?? "").trim();
  if (q.length >= 2) p.set("q", q.slice(0, 60));
  if (o.conCola) p.set("conCola", "1");
  if (o.orden) p.set("orden", o.orden);
  if (o.limit != null) p.set("limit", String(Math.min(100, Math.max(1, Math.floor(o.limit)))));
  if (o.offset && o.offset > 0) p.set("offset", String(Math.floor(o.offset)));
  return leer<RankingPartidos>(`/partidos/ranking?${p.toString()}`, 60);
}

export const getDetallePartido = (clave: string, anio: AnioGobierno = ANIO_GOBIERNO_VIGENTE) =>
  leer<DetallePartido>(`/partidos/${encodeURIComponent(clave)}?anio=${anio}`);

/** Los procesos adjudicados de una entidad desde 2015 (OECE), paginados y filtrados; con su resumen. */
export function getProcesosEntidad(ruc: string, f: { q?: string; objeto?: string; anio?: number; orden?: "fecha" | "monto"; page?: number; size?: number } = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") p.set(k, String(v));
  return leer<ProcesosEntidad>(`/entidades/${ruc}/procesos?${p.toString()}`, 600);
}

/** Sus procesos adjudicados del período (CONOSCE), paginados y filtrados. */
export function getProcesosPartido(clave: string, anio: AnioGobierno, f: FiltrosProcesos = {}) {
  const p = new URLSearchParams({ anio: String(anio) });
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") p.set(k, String(v));
  return leer<ProcesosPartido>(`/partidos/${encodeURIComponent(clave)}/procesos?${p.toString()}`, 300);
}

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

/** Un rubro del presupuesto (función, genérica, nivel): presupuesto modificado y lo ya gastado. */
export interface RubroMef {
  nombre: string;
  pim: number;
  devengado: number;
}

/**
 * En qué gastan los gobiernos que ganó un partido (GET /partidos/:clave/gasto): el MEF de sus ejecutoras, sólo para
 * el mandato que incluye el año cargado con desglose (hoy 2026). `disponible: false` en los demás.
 */
export interface GastoPartido {
  anio: AnioGobierno;
  mef: number | null;
  desde: string;
  hasta: string;
  disponible: boolean;
  totales?: { gobiernos: number; conMef: number; ejecutoras: number; pim: number; devengado: number };
  porNivel?: { nivel: "regional" | "provincial" | "distrital"; gobiernos: number; pim: number; devengado: number }[];
  funciones?: RubroMef[];
  genericas?: RubroMef[];
  proyectos?: { codigo: string; nombre: string; nivel: "regional" | "provincial" | "distrital"; ubigeo: string; lugar: string | null; pim: number; devengado: number }[];
  gobiernos?: { nivel: "regional" | "provincial" | "distrital"; ubigeo: string; lugar: string | null; departamento: string; region: string | null; pim: number; devengado: number }[];
}

export const getGastoPartido = (clave: string, anio: AnioGobierno) =>
  leer<GastoPartido>(`/partidos/${encodeURIComponent(clave)}/gasto?anio=${anio}`, 3600);

/** Las plazas CAS que sus gobiernos convocaron después de las elecciones y antes de entregar el cargo (migración 183). */
export interface SalientesPartido {
  anio: number;
  entidades: { entidadRuc: string; entidad: string; plazas: number; vacantes: number; alMes: number; aLaMedida: number }[];
  total: { plazas: number; vacantes: number; alMes: number; aLaMedida: number };
}

export const getSalientesPartido = (clave: string, anio: AnioGobierno) =>
  leer<SalientesPartido>(`/partidos/${encodeURIComponent(clave)}/salientes?anio=${anio}`, 3600);
