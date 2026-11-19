/**
 * Las visitas que recibió una entidad (fase 2.3 del plan del 2026-10-27; rediseño del 2026-11-18) en la API
 * (backend/api/src/routes/visitas.ts y lib/visitasLista.ts):
 *
 *   GET /visitas/entidad/:ruc         el resumen de la pestaña (cifras, repartos, visitas por mes, cuántas filas tiene
 *                                     cada lista). Sin las listas.
 *   GET /visitas/entidad/:ruc/lista   cada lista ENTERA, de a una página: las empresas que ganaron algo después, quiénes
 *                                     la visitan, a qué oficinas, las de familiares de sus funcionarios y todas las visitas.
 *
 * Nunca el documento de quien visita; su nombre con un apellido tapado (completo si es autoridad electa), y ni eso si es
 * el familiar de un funcionario. De quien recibe, sólo su cargo y su área. Nunca se busca a una persona por su nombre.
 */
import { API_BASE } from "@/lib/api-client";

/** Lo que el Estado le dio a una empresa después de la primera visita de su gente: lo primero. */
export type TipoDespues = "contrato" | "consorcio" | "orden";

export interface OrganizacionVisitante {
  org: string;
  tipo: "privada" | "publica" | string | null;
  visitas: number;
  visitantes: number;
  primera: string | null;
  ultima: string | null;
  decisores: number;
  /** La empresa (RUC 20) que se reconoce en esas visitas, si alguna. */
  ruc: string | null;
  empresa: string | null;
  /** Lo primero que le dio la entidad después de la primera visita de su gente, y cuánto en total desde entonces. */
  despues: string | null;
  despuesTipo: TipoDespues | null;
  montoDespues: number;
  /** CUÁL fue (migración 204): el número de la orden o la nomenclatura del proceso, y su monto. */
  despuesNumero?: string | null;
  despuesMonto?: number | null;
}

/**
 * Una empresa cuya gente visitó la entidad (migración 203): se la reconoce por el documento de quien visita (su socio,
 * representante legal o directivo en el RNP) o porque dijo venir de ella, y lo que la entidad le dio desde la primera
 * visita. Sin nombres ni documentos de quienes visitan.
 */
export interface EmpresaVisitante {
  ruc: string;
  empresa: string | null;
  visitas: number;
  visitantes: number;
  decisores: number;
  /** Visitas según cómo se reconoce a quien visita. */
  socio: number;
  representante: number;
  directivo: number;
  porNombre: number;
  /** Visitas que declararon a la empresa como su organización (0: el vínculo sólo se ve por su gente). */
  declaradas: number;
  personal: number;
  /** Visitas de alguien que figura en más de una empresa: no se sabe por cuál fue. */
  compartidas: number;
  /** La otra organización que más declararon, si no declararon a la empresa. */
  otraOrg: string | null;
  primera: string;
  ultima: string;
  /** Contratos y órdenes que la entidad le dio antes de la primera visita (0: la primera vez que le vende). */
  antes: number;
  despues: string;
  despuesTipo: TipoDespues;
  /** Días entre la última visita hasta ese día y lo primero que le dio. */
  dias: number | null;
  contratos: number;
  consorcios: number;
  ordenes: number;
  /** Lo que suman sus contratos (sola) y órdenes desde la primera visita, sin montos dudosos. */
  monto: number;
  /** CUÁL fue lo primero (migración 204): número de la orden o nomenclatura del proceso, qué se compró, su monto, el código
   * del proceso, el tipo de orden y el OCID del contrato si está en la base. */
  despuesNumero?: string | null;
  despuesDetalle?: string | null;
  despuesMonto?: number | null;
  despuesCodigo?: string | null;
  despuesOrden?: string | null;
  despuesOcid?: string | null;
}

export interface AreaVisitada {
  area: string;
  cargo: string | null;
  visitas: number;
  privadas: number;
  decisor: boolean;
}

export interface VisitaPariente {
  /** Su lugar en la lista (no el id de la visita: no se dice quién es el familiar). */
  clave: string;
  fecha: string;
  parentesco: string | null;
  cargo: string | null;
  area: string | null;
  decisor: boolean;
  proveedor: boolean;
}

export interface VisitaEntidad {
  clave: string;
  fecha: string | null;
  hora: string | null;
  duracion: number | null;
  /** Con un apellido tapado (completo si es autoridad electa); null si es el familiar de un funcionario. */
  visitante: string | null;
  electo?: true;
  tipo: string | null;
  organizacion: string | null;
  cargo: string | null;
  area: string | null;
  motivo: string | null;
  fuente: string | null;
  decisor: boolean;
  fueraDeHora: boolean;
  pariente: boolean;
  empresa: { ruc: string; nombre: string | null } | null;
  enlace: string | null;
}

/** Las visitas de un mes (migración 205): cuántas, de empresas, a quien decide y cuántas empresas distintas. */
export interface MesVisitas {
  /** "YYYY-MM" */
  mes: string;
  visitas: number;
  privadas: number;
  decisores: number;
  empresas: number;
}

/** El resumen de la pestaña (GET /visitas/entidad/:ruc). */
export interface VisitasEntidad {
  total: number;
  desde: string | null;
  hasta: string | null;
  resumen?: { privadas: number; publicas: number; personas: number; visitantes: number; decisores: number; fueraDeHora: number; largas: number; parientes: number };
  /** Cuántas filas tiene cada lista. */
  totales?: { organizaciones: number | null; areas: number | null; parientes: number | null };
  /** Falta en la API anterior al 2026-11-18 (o con la caché vieja): el gráfico no se dibuja. */
  meses?: MesVisitas[];
  /** Las empresas de quienes la visitan (migración 203): cuántas y cuántas ganaron algo después. */
  empresas?: { empresas: number; soloSuGente: number; ganaron: number; ganaronSoloSuGente: number; primeraVez: number };
  fuentes?: { texto: string; href: string }[];
}

export async function getVisitasEntidad(ruc: string): Promise<VisitasEntidad | null> {
  if (!/^\d{11}$/.test(ruc)) return null;
  try {
    const r = await fetch(`${API_BASE}/visitas/entidad/${ruc}`, { next: { revalidate: 900 } } as RequestInit);
    return r.ok ? ((await r.json()) as VisitasEntidad) : null;
  } catch {
    return null;
  }
}

// ─── Las listas, de a una página ────────────────────────────────────────────────

export type ListaVisitas = "empresas" | "organizaciones" | "areas" | "parientes" | "visitas";

export interface FilaDe {
  empresas: EmpresaVisitante;
  organizaciones: OrganizacionVisitante;
  areas: AreaVisitada;
  parientes: VisitaPariente;
  visitas: VisitaEntidad;
}

export interface PaginaVisitas<L extends ListaVisitas> {
  que: L;
  page: number;
  size: number;
  /** null: la lista de visitas con filtros combinados no sabe su total sin recorrer todo; vale `hayMas`. */
  total: number | null;
  hayMas: boolean;
  filas: FilaDe[L][];
  /** Por filtro, cuántas filas da cada opción con los demás filtros puestos; null si no se sabe. */
  facetas: Record<string, Record<string, number> | null>;
  /** Visitas: los años que tiene, y en cuántas organizaciones encontró lo buscado. */
  anios?: number[];
  organizaciones?: number;
}

/** Lo que pasó al pedir una página: la página, o por qué no llegó (lenta: pasó el plazo; honda: un salto muy grande). */
export type RespuestaLista<L extends ListaVisitas> = { ok: true; pagina: PaginaVisitas<L> } | { ok: false; motivo: "lenta" | "honda" | "error" };

/** Filas por página: 15 (la pestaña entera cabe en una pantalla y media). */
export const TAM_VISITAS = 15;

/**
 * Los parámetros de la URL de cada lista, con su prefijo (`ve`, `vo`, `va`, `vp`, `vl`): las cinco van en la misma ficha
 * y cada una guarda su búsqueda, sus filtros, su orden y su página. La subpestaña abierta va en `vv`.
 */
export const P_VISITAS = {
  sub: "vv",
  empresas: { q: "veq", page: "vepag", orden: "veord", via: "vevia", declaro: "vedecl", antes: "veantes", decisor: "vedec", tipo: "vetipo" },
  organizaciones: { q: "voq", page: "vopag", orden: "voord", tipo: "votipo", despues: "vodesp", decisor: "vodec" },
  areas: { q: "vaq", page: "vapag", orden: "vaord", decisor: "vadec" },
  parientes: { q: "vpq", page: "vppag", orden: "vpord", proveedor: "vpprov", decisor: "vpdec" },
  visitas: { q: "vlq", page: "vlpag", orden: "vlord", tipo: "vltipo", decisor: "vldec", hora: "vlhora", anio: "vlanio", org: "vlorg" },
} as const;

/** Una página de una lista. `filtros` usa los nombres de la API (q, page, orden, antes…), no los de la URL de la ficha. */
export async function getListaVisitas<L extends ListaVisitas>(ruc: string, que: L, filtros: Record<string, string | number | undefined>): Promise<RespuestaLista<L>> {
  if (!/^\d{11}$/.test(ruc)) return { ok: false, motivo: "error" };
  const p = new URLSearchParams({ que, size: String(TAM_VISITAS) });
  for (const [k, v] of Object.entries(filtros)) if (v != null && v !== "") p.set(k, String(v));
  try {
    const r = await fetch(`${API_BASE}/visitas/entidad/${ruc}/lista?${p}`, { next: { revalidate: 900 } } as RequestInit);
    if (r.ok) return { ok: true, pagina: (await r.json()) as PaginaVisitas<L> };
    const e = (await r.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, motivo: e?.error === "consulta_lenta" ? "lenta" : e?.error === "pagina_muy_honda" ? "honda" : "error" };
  } catch {
    return { ok: false, motivo: "error" };
  }
}

/** El parentesco como lo dice cualquiera: «HERMANO(A)» → «hermano o hermana de un funcionario». */
export function parentescoLlano(p: string | null): string {
  const t = (p ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return "familiar de un funcionario";
  const base = t.replace(/\((a|o)\)/g, "").replace(/\s+/g, " ").trim();
  return `${base} de un funcionario`;
}
