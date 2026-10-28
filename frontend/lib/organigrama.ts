/**
 * La Organización 2.0 de una entidad (fase 1 del plan del 2026-10-27): GET /planilla/organigrama?entidad= de la API
 * (backend/api/src/lib/organigrama.ts). Cada oficina con de dónde sale (su planilla, la DJI de su jefatura, la ley, su
 * ROF) y de quién depende y por qué; las siglas de la planilla, leídas; quién es la titular y la autoridad que aprueba las
 * contrataciones (AGA).
 */
import { API_BASE } from "@/lib/api-client";
import { conTildes } from "@/lib/tildes";
import { tituloNatural } from "@/lib/landing";
import type { OficinaEntidad } from "@/lib/planilla";

export type FuncionOficina = OficinaEntidad["funcion"];
export type TipoArista = "rof" | "planilla" | "ley" | "funcion" | "nivel";
export type ComoSigla = "dji" | "planilla" | "ley" | "rof" | "diccionario" | "global" | "abreviatura" | "region";

export interface JefeOficina { nombre: string; cargo: string | null; ficha: string | null; fuente: "planilla" | "dji"; desde: string | null }
export interface EvidenciaOficina { tipo: "planilla" | "dji" | "ley" | "rof" | "entidad"; texto: string; url: string | null }

export interface NodoOrganigrama {
  id: string;
  nombre: string;
  sigla: string | null;
  expansion: { como: ComoSigla; alternativas: string[] } | null;
  nivel: 1 | 2 | 3 | 4;
  funcion: FuncionOficina;
  grupo: boolean;
  padre: string | null;
  arista: { tipo: TipoArista; texto: string; url: string | null } | null;
  evidencias: EvidenciaOficina[];
  jefes: JefeOficina[];
  dependencias: string[];
  personas: number;
  planilla: number;
  cas: number;
  conSenales: number;
  altas: number;
  conFamilia: number;
  visitas: number;
  ultimaVisita: string | null;
  rol: "titular" | "aga" | null;
  enDatos: boolean;
  cortado: boolean;
  /** Una unidad del mismo gobierno con su propio RUC (una UGEL, un hospital, un organismo adscrito). */
  ruc: string | null;
}

export interface Organigrama {
  mes: string | null;
  idPte: number | null;
  /** Hasta cuándo llega el registro de visitas. */
  visitasHasta?: string | null;
  enlaces: { planilla: string | null; dji: string | null };
  plantilla: { id: string; nombre: string; ley: { texto: string; url: string | null } | null } | null;
  nodos: NodoOrganigrama[];
  resumen: {
    oficinas: number; personas: number; jefaturas: number; planilla: number; siglas: number; siglasExpandidas: number;
    inferidas: number; visitas: number; visitasSinOficina: number; unidades: number;
  };
}

export async function getOrganigrama(entidad: string): Promise<Organigrama | null> {
  if (!/^\d{11}$/.test(entidad)) return null;
  try {
    const r = await fetch(`${API_BASE}/planilla/organigrama?entidad=${entidad}`, { next: { revalidate: 600 } } as RequestInit);
    return r.ok ? ((await r.json()) as Organigrama) : null;
  } catch {
    return null;
  }
}

/** El nombre para mostrar: con sus tildes y en tipo título si llegó en mayúsculas; «…» si el portal lo cortó. */
export function nombreOficina(n: Pick<NodoOrganigrama, "nombre" | "cortado">): string {
  const t = n.nombre === n.nombre.toUpperCase() ? tituloNatural(conTildes(n.nombre)) : n.nombre;
  return n.cortado ? `${t}…` : t;
}

/** Por qué cuelga de su padre, en corto (el chip) y en largo (la explicación). */
export const ARISTA: Record<TipoArista, { corto: string; explica: string; inferida: boolean }> = {
  rof: { corto: "Según su ROF", explica: "Su Reglamento de Organización y Funciones (o una designación publicada en El Peruano) lo dice.", inferida: false },
  ley: { corto: "Según la ley", explica: "La ley de su tipo de entidad fija esta dependencia.", inferida: false },
  planilla: { corto: "Según su planilla", explica: "Su planilla escribe la dependencia así, con la oficina de la que depende.", inferida: false },
  funcion: { corto: "Inferida", explica: "Ningún dato lo dice: se deduce por su nombre o su función. Puede no ser exacta.", inferida: true },
  nivel: { corto: "Sin dato", explica: "Ningún dato dice de quién depende: se muestra donde suele estar.", inferida: true },
};

/** Cómo se leyó una sigla de la planilla. */
export const COMO_SIGLA: Record<ComoSigla, string> = {
  dji: "el cargo que declara su jefatura en la declaración jurada de intereses",
  planilla: "otro nombre de la misma planilla",
  ley: "un órgano que la ley pide para este tipo de entidad",
  rof: "su Reglamento de Organización y Funciones",
  diccionario: "una sigla de uso general en el Estado",
  global: "el nombre que usan otras entidades para la misma sigla",
  abreviatura: "una abreviatura de la planilla",
  region: "el nombre que usan otras entidades, sin la inicial de la región al final",
};

/** Los hijos de cada oficina (null: los que cuelgan de la entidad), en el orden de la API (nivel y gente). */
export function hijosDe(nodos: NodoOrganigrama[]): Map<string | null, NodoOrganigrama[]> {
  const m = new Map<string | null, NodoOrganigrama[]>();
  const ids = new Set(nodos.map((n) => n.id));
  for (const n of nodos) {
    const p = n.padre && ids.has(n.padre) ? n.padre : null;
    m.set(p, [...(m.get(p) ?? []), n]);
  }
  return m;
}

/** Cuántas oficinas hay debajo de cada una (sin contarla) y cuánta gente suman con las suyas. */
export function totalesDe(nodos: NodoOrganigrama[], hijos = hijosDe(nodos)): Map<string, { oficinas: number; personas: number }> {
  const out = new Map<string, { oficinas: number; personas: number }>();
  const ir = (n: NodoOrganigrama): { oficinas: number; personas: number } => {
    const ya = out.get(n.id);
    if (ya) return ya;
    let oficinas = 0;
    let personas = n.personas;
    for (const h of hijos.get(n.id) ?? []) {
      const t = ir(h);
      oficinas += (h.grupo ? 0 : 1) + t.oficinas;
      personas += t.personas;
    }
    const r = { oficinas, personas };
    out.set(n.id, r);
    return r;
  };
  for (const n of nodos) ir(n);
  return out;
}

/** La ruta de una oficina desde la entidad (para abrir sus ramas al buscarla). */
export function rutaDe(id: string, porId: Map<string, NodoOrganigrama>): string[] {
  const out: string[] = [];
  for (let n = porId.get(id); n; n = n.padre ? porId.get(n.padre) : undefined) out.unshift(n.id);
  return out;
}
