/**
 * Las visitas que recibió una entidad (fase 2.3 del plan del 2026-10-27): GET /visitas/entidad/:ruc de la API
 * (backend/api/src/routes/visitas.ts). Quiénes la visitan (y si después ganaron algo), a qué oficinas, las de familiares
 * declarados de sus funcionarios (sin decir quiénes) y las 1,000 más recientes. Nunca el documento de quien visita; su
 * nombre con un apellido tapado, y ni eso si es el familiar de un funcionario. De quien recibe, sólo su cargo y su área.
 */
import { API_BASE } from "@/lib/api-client";

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
  /** Lo primero que le dio la entidad después de su primera visita, y cuánto en total desde entonces. */
  despues: string | null;
  despuesTipo: "contrato" | "orden" | null;
  montoDespues: number;
}

export interface VisitaEntidad {
  clave: string;
  fecha: string | null;
  hora: string | null;
  duracion: number | null;
  visitante: string | null;
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

export interface VisitasEntidad {
  total: number;
  desde: string | null;
  hasta: string | null;
  resumen?: { privadas: number; publicas: number; personas: number; visitantes: number; decisores: number; fueraDeHora: number; largas: number; parientes: number };
  organizaciones?: OrganizacionVisitante[];
  areas?: { area: string; cargo: string | null; visitas: number; privadas: number; decisor: boolean }[];
  parientes?: { fecha: string; parentesco: string | null; cargo: string | null; area: string | null; decisor: boolean; proveedor: boolean }[];
  visitas?: VisitaEntidad[];
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

/** El parentesco como lo dice cualquiera: «HERMANO(A)» → «hermano o hermana de un funcionario». */
export function parentescoLlano(p: string | null): string {
  const t = (p ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return "familiar de un funcionario";
  const base = t.replace(/\((a|o)\)/g, "").replace(/\s+/g, " ").trim();
  return `${base} de un funcionario`;
}
