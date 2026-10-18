/**
 * Cruces de datos a escala nacional (GET /cruces, backend/api/src/routes/cruces.ts): procesos con buena pro cuyo
 * ganador aparece en otros registros públicos. Tipos, catálogo de cruces con su explicación y el parseo de la URL.
 */
import { baseApiNavegador } from "./api-client";

export type Severidad = "alta" | "media" | "baja";

export interface CasoCruce {
  ocid: string;
  codigo: string | null;
  objeto: string | null;
  tipoContratacion: string | null;
  entidadRuc: string | null;
  entidad: string | null;
  departamento: string | null;
  fechaBuenaPro: string | null;
  montoSoles: number | null;
  rucProveedor: string;
  proveedor: string | null;
  consorcio: string | null;
  severidad: Severidad;
  puntaje: number;
  cruces: { tipo: string; severidad: Severidad; n: number; etiqueta: string }[];
}

export interface CrucesPagina {
  total: number;
  resumen: { total: number; procesos: number; entidades: number; proveedores: number; monto: number; altas: number } | null;
  casos: CasoCruce[];
  facetas: {
    tipos: { valor: string; n: number; etiqueta: string }[];
    severidad: { alta: number; media: number; baja: number };
    departamentos: { valor: string; nombre: string | null; n: number }[];
    contratacion: { valor: string; n: number }[];
  } | null;
}

/** Grupos de cruces, en el orden en que se muestran; cada tipo con una explicación corta de qué se cruzó. */
export const GRUPOS_CRUCE: { titulo: string; tipos: { tipo: string; corto: string; explica: string }[] }[] = [
  {
    titulo: "Política",
    tipos: [
      { tipo: "partido_gobernante", corto: "Partido que gobierna", explica: "El ganador o un socio aportó a la campaña del partido que gobierna la entidad, o le vendió a esa campaña (ONPE × JNE)." },
      { tipo: "aporte", corto: "Aportó a un partido", explica: "El proveedor, o un socio o representante suyo, figura como aportante de una organización política (ONPE)." },
      { tipo: "aporte_empresa", corto: "La empresa aportó", explica: "La empresa ganadora aportó con su RUC a una organización política (ONPE)." },
      { tipo: "proveedor_campana", corto: "Vendió a una campaña", explica: "La empresa le facturó a una campaña electoral (gastos de campaña, ONPE Claridad)." },
      { tipo: "candidato", corto: "Fue candidato", explica: "El proveedor o un socio postuló en una elección (ONPE)." },
      { tipo: "autoridad", corto: "Autoridad electa", explica: "El proveedor o un socio es autoridad electa (JNE)." },
    ],
  },
  {
    titulo: "En el proceso",
    tipos: [
      { tipo: "socio_comun", corto: "Socio común entre postores", explica: "Dos postores del mismo proceso comparten socio o representante (RNP): competencia aparente." },
      { tipo: "visita_previa", corto: "Visita antes de la buena pro", explica: "Un socio o representante visitó una entidad pública en los 180 días previos a la buena pro (registro de visitas)." },
      { tipo: "sancion_vigente", corto: "Ganó inhabilitado", explica: "Ganó mientras tenía una inhabilitación vigente del Tribunal de Contrataciones." },
    ],
  },
  {
    titulo: "Historial del proveedor",
    tipos: [
      { tipo: "sancion", corto: "Sancionado", explica: "Tiene sanciones del Tribunal de Contrataciones del Estado (OSCE)." },
      { tipo: "penalidad", corto: "Penalidades", explica: "Le aplicaron penalidades en contratos anteriores." },
      { tipo: "adicional", corto: "Adicionales o prórrogas", explica: "El contrato tuvo adicionales o prórrogas (CONOSCE)." },
    ],
  },
  {
    titulo: "Patrón de compras",
    tipos: [
      { tipo: "fraccionamiento", corto: "Órdenes que pasan 8 UIT", explica: "Recibió de la misma entidad, el mismo día, varias órdenes menores que juntas pasan el tope de 8 UIT (CONOSCE)." },
      { tipo: "recurrente", corto: "Proveedor frecuente", explica: "Ganó varios procesos de la misma entidad (CONOSCE)." },
    ],
  },
];

export const TIPO_CRUCE = Object.fromEntries(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t])));

export const ORDENES_CRUCE = [
  { valor: "puntaje", etiqueta: "Más cruces graves primero" },
  { valor: "reciente", etiqueta: "Buena pro más reciente" },
  { valor: "monto", etiqueta: "Mayor monto adjudicado" },
];

export const CONTRATACION: Record<string, string> = {
  bienes: "Bienes", servicios: "Servicios", obras: "Obras", consultoria: "Consultoría", convenio: "Convenio", directa: "Contratación directa",
};

export const TAM_CRUCES = 25;

/** Parámetros de la URL que entiende la página (y que pasan tal cual al API). */
export const PARAMS_CRUCES = ["tipo", "severidad", "departamento", "contratacion", "entidad", "q", "desde", "hasta", "montoMin", "orden", "pagina"] as const;

export function parseCrucesQuery(sp?: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of PARAMS_CRUCES) {
    const v = sp?.[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (s) out[k] = s.slice(0, 200);
  }
  return out;
}

export async function getCruces(query: Record<string, string | undefined>): Promise<CrucesPagina | null> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v && k !== "pagina") qs.set(k, v);
  const pagina = Math.max(1, Number(query.pagina) || 1);
  qs.set("limit", String(TAM_CRUCES));
  qs.set("offset", String((pagina - 1) * TAM_CRUCES));
  try {
    const res = await fetch(`${baseApiNavegador()}/cruces?${qs}`, { next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) return null;
    return (await res.json()) as CrucesPagina;
  } catch {
    return null;
  }
}
