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
  despuesTipo: "contrato" | "consorcio" | "orden";
  /** Días entre la última visita hasta ese día y lo primero que le dio. */
  dias: number | null;
  contratos: number;
  consorcios: number;
  ordenes: number;
  /** Lo que suman sus contratos (sola) y órdenes desde la primera visita, sin montos dudosos. */
  monto: number;
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
  /** «Lo que le dio después» no alcanzó el plazo de la API (entidades con muchísimas órdenes): las organizaciones van sin él. */
  despuesSinCalcular?: boolean;
  /** Las empresas de quienes la visitan (migración 203): cuántas, cuántas ganaron algo después y la lista de esas. */
  empresas?: {
    empresas: number;
    soloSuGente: number;
    ganaron: number;
    ganaronSoloSuGente: number;
    primeraVez: number;
    lista: EmpresaVisitante[];
  };
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
