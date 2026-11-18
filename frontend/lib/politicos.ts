/**
 * Cliente de «Políticos» de un partido (migración 299). Backend: backend/api/src/routes/partidosPoliticos.ts.
 *
 * Los candidatos del partido que ganaron, los que no ganaron y sus aportantes, y lo que otros registros públicos dicen
 * de cada uno: sus empresas que le vendieron al Estado (RNP y OECE), sus órdenes de servicio, los funcionarios que lo
 * declararon como familiar (declaraciones juradas de intereses), sus aportes (ONPE) y sus sanciones (OECE).
 *
 * Desde la migración 301, también lo que dice SU declaración jurada de intereses (DJI), si ganó desde 2022: los familiares
 * que declara y lo que obtuvieron del Estado, y sus informes de control con responsabilidad PRESUNTA.
 *
 * Privacidad (docs/PRIVACIDAD.md): la API nunca da un documento; quien no ganó una elección llega con un apellido tapado
 * y quien ganó, con su nombre completo (como en el resto de Vigía). El nombre no va a un `title` ni a un `aria-label`.
 * Sólo se cruza a quien su fuente trae con documento (`conDocumento`): nunca por nombre. La excepción es su propia DJI, que
 * la Contraloría publica sin documento: se empata por el nombre completo y la entidad que gobierna, y la pantalla pide
 * confirmar que es la misma persona. De sus familiares no llega ni el nombre ni el documento: sólo el parentesco. Y de un
 * electo (nombre completo), el familiar cuyo parentesco destaparía su apellido tapado (hermano, hijo, sobrino, primo,
 * nieto o desconocido) llega sólo contado en `reservados`, sin parentesco, monto, empresa ni años.
 */

import { API_BASE } from "./api-client";

export const SENALES_POLITICO = [
  "empresas_gobierno", "ordenes_gobierno", "familia_su_entidad", "control_penal", "inhabilitado", "sancion", "empresa_inhabilitada",
  "empresas_estado", "familia_partido", "control", "ordenes", "familia_estado", "familia",
] as const;
export type SenalPolitico = (typeof SENALES_POLITICO)[number];
export type SeveridadPolitico = "alta" | "media" | "baja";

/** Cada cruce: su nombre corto (la bandera de la fila), su título y qué significa. Un cruce es un hecho para revisar. */
export const SENAL_POLITICO: Record<SenalPolitico, { corto: string; titulo: string; explica: string }> = {
  empresas_gobierno: {
    corto: "Su empresa ganó en gobiernos del partido",
    titulo: "Una empresa suya ganó contratos en gobiernos de este partido",
    explica:
      "Es socio, representante o directivo (RNP) de una empresa que ganó procesos en gobiernos de este partido después de su primer aporte o candidatura con él. Si quien aporta es una empresa, es ella misma la que ganó. Ganar un contrato es legal: lo que se señala es el vínculo, para revisar cada proceso.",
  },
  ordenes_gobierno: {
    corto: "Recibió órdenes de gobiernos del partido",
    titulo: "Recibió órdenes de servicio de una entidad que gobernaba este partido",
    explica:
      "Como persona natural, una entidad le dio órdenes de servicio mientras la gobernaba este partido. Trabajar para el Estado es legal: lo que se señala es que postuló o aportó a quien lo contrató.",
  },
  inhabilitado: {
    corto: "Inhabilitado por el Tribunal",
    titulo: "El Tribunal de Contrataciones lo inhabilitó",
    explica: "Figura en el registro de sancionados del OECE con una inhabilitación temporal o definitiva para contratar con el Estado.",
  },
  sancion: {
    corto: "Multado por el Tribunal",
    titulo: "Tiene multas del Tribunal de Contrataciones",
    explica: "Figura en el registro de sancionados del OECE con una multa, sin inhabilitación.",
  },
  empresa_inhabilitada: {
    corto: "Una empresa suya está inhabilitada",
    titulo: "Una empresa suya está inhabilitada para contratar con el Estado",
    explica: "Es socio, representante o directivo (RNP) de una empresa que el Tribunal de Contrataciones inhabilitó.",
  },
  empresas_estado: {
    corto: "Sus empresas le vendieron al Estado",
    titulo: "Sus empresas le vendieron al Estado",
    explica:
      "Es socio, representante o directivo (RNP) de empresas que ganaron procesos o recibieron órdenes de compra del Estado, en cualquier entidad y año. Es un dato de contexto: no dice que hayan ganado por él.",
  },
  ordenes: {
    corto: "Recibió órdenes del Estado",
    titulo: "Recibió órdenes de servicio del Estado",
    explica: "Como persona natural recibió órdenes de servicio de entidades públicas (OECE, desde 2018), gobernadas o no por este partido.",
  },
  familia: {
    corto: "Familiar de un funcionario",
    titulo: "Un funcionario lo declaró como su familiar",
    explica:
      "Un funcionario público lo nombró como pariente en su Declaración Jurada de Intereses (Ley 31227). Dice que un familiar suyo tiene un puesto en el Estado, no que lo consiguió por él.",
  },
  familia_su_entidad: {
    corto: "Un familiar contrata con su entidad",
    titulo: "Un familiar que declaró obtuvo contratos de la entidad que gobierna",
    explica:
      "En su declaración jurada de intereses declaró a un familiar que, durante su gestión, recibió órdenes de servicio de la misma entidad que él gobierna o tiene una empresa que le ganó buenas pro. Es el indicio de posible nepotismo: un hecho para revisar, no una acusación. Su declaración se empató por su nombre completo y la entidad: confirma que es la misma persona.",
  },
  familia_partido: {
    corto: "Un familiar contrata con gobiernos del partido",
    titulo: "Un familiar que declaró obtuvo contratos de gobiernos de este partido",
    explica:
      "Un familiar que declaró en su DJI recibió órdenes de entidades que gobernaba este partido, o tiene una empresa que ganó buenas pro en sus gobiernos. Es un hecho para revisar, no una acusación.",
  },
  familia_estado: {
    corto: "Un familiar contrata con el Estado",
    titulo: "Un familiar que declaró contrata con el Estado",
    explica:
      "Un familiar que declaró en su DJI recibió órdenes de servicio de alguna entidad pública o tiene una empresa que ganó buenas pro. Es un dato de contexto: trabajar para el Estado es legal.",
  },
  control_penal: {
    corto: "Responsabilidad penal presunta",
    titulo: "Un informe de control le señala responsabilidad penal presunta",
    explica:
      "La Contraloría lo comprende en un informe de control con responsabilidad penal presunta, que deriva al Ministerio Público. Es presunta: no es una acusación fiscal ni una condena.",
  },
  control: {
    corto: "Informe de control (presunta)",
    titulo: "Un informe de control le señala responsabilidad presunta",
    explica:
      "La Contraloría lo comprende en un informe de control con responsabilidad civil o administrativa presunta. Es presunta: no es una sanción firme.",
  },
};

/** Lo que un informe de control le señala a una persona, en palabras. Siempre presunta. */
export const RESPONSABILIDAD: Record<string, string> = {
  penal: "Penal",
  civil: "Civil",
  administrativa_entidad: "Administrativa (la ve la entidad)",
  administrativa_pas: "Administrativa (procedimiento sancionador)",
  administrativa: "Administrativa",
};

/** El estado de su DJI: sólo de quien ganó desde 2022 (la DJI es de quien ejerce un cargo). */
export type EstadoDji = "leida" | "registro" | "no_encontrada" | "ambigua";
export const ESTADO_DJI: Record<EstadoDji, string> = {
  leida: "Su DJI está leída",
  registro: "Su DJI está en el registro, todavía sin leer",
  no_encontrada: "No encontramos su DJI",
  ambigua: "No se pudo empatar su DJI (un homónimo o un nombre muy corto)",
};

export interface Politico {
  /** Su código en Vigía (al azar): con él se pide su detalle. Nunca un documento. */
  codigo: string;
  tipo: "persona" | "empresa";
  /** Con un apellido tapado si no ganó una elección. `null` si quien aporta es una empresa. */
  nombre: string | null;
  razonSocial: string | null;
  /** El RUC de la empresa que aporta (RUC 20). */
  ruc: string | null;
  /** Ganó una elección: su nombre va completo. */
  electo?: true;
  /** Ganó una elección con ESTE partido. */
  gano: boolean;
  /** Postuló en una elección cuyo resultado aún no está cargado y no ganó otra: no es «no ganó». Una API anterior no lo trae. */
  pendiente?: boolean;
  candidato: boolean;
  aportante: boolean;
  nCandidaturas: number;
  /** Los años de las elecciones en que postuló con el partido. */
  elecciones: number[];
  ultimaCandidatura: { puesto: string | null; lugar: string | null } | null;
  aportes: { n: number; monto: number; desde: string | null; hasta: string | null };
  /** La fuente lo trae con su documento: sólo así se cruza con otros registros. */
  conDocumento: boolean;
  /** Su ficha de persona contratada (/app/personas/<código>), si recibió órdenes. */
  personaCodigo: string | null;
  cruces: {
    empresas: { n: number; vendido: number; inhabilitadas: number; enGobiernos: { procesos: number; monto: number } };
    ordenes: { entidades: number; monto: number; enGobiernos: { entidades: number; monto: number } };
    familia: number;
    sanciones: number;
    /** Lo que obtuvieron los familiares que declara en su DJI (migración 301; en una API vieja no viene). */
    familiares?: {
      declarados: number;
      conOrdenes: number;
      /** `null` si el político va con su nombre completo: sólo se cuentan. */
      ordenesMonto: number | null;
      conEmpresas: number;
      suEntidad: { n: number; monto: number | null };
      partido: { n: number; monto: number | null };
    };
    /** Informes de control con responsabilidad PRESUNTA. */
    control?: { informes: number; penal: number };
  };
  /** El estado de su DJI, si ganó desde 2022; `null` para los demás. */
  dji?: EstadoDji | null;
  senales: { tipo: SenalPolitico; severidad: SeveridadPolitico }[];
}

export interface ResumenPoliticos {
  total: number;
  gano: number;
  noGano: number;
  /** Con el resultado de su elección aún sin publicar. Una API anterior no lo trae. */
  pendientes?: number;
  aportantes: number;
  empresas: number;
  conDocumento: number;
  /** Se pudo cruzar: con su documento o, sin él, por su DJI empatada (en una API vieja no viene: es `conDocumento`). */
  cruzables?: number;
  conCruces: number;
  alta: number;
  media: number;
  baja: number;
  aportesMonto: number;
  aportesN: number;
  porSenal: { tipo: string; n: number }[];
  porEleccion: { anio: number; n: number }[];
  /** Quienes ganaron con el partido desde 2022, por su DJI (migración 301). */
  dji?: { alcance: number; leida: number; registro: number; sinDji: number; conFamiliares: number } | null;
}

export interface PaginaPoliticos {
  /** `false`: esta base todavía no tiene la tabla (migración 299 sin aplicar). */
  disponible: boolean;
  total: number;
  page: number;
  size: number;
  politicos: Politico[];
  resumen: ResumenPoliticos | null;
}

export const PAPELES_POLITICO = [
  { valor: "gano", etiqueta: "Ganaron una elección" },
  { valor: "no_gano", etiqueta: "Postularon y no ganaron" },
  { valor: "pendiente", etiqueta: "Postularon, resultado pendiente" },
  { valor: "aportante", etiqueta: "Aportantes" },
] as const;
export type PapelPolitico = (typeof PAPELES_POLITICO)[number]["valor"];

export const CRUCES_POLITICO = ["con", "alta", "sin", "sin_documento"] as const;
export type CrucesPolitico = (typeof CRUCES_POLITICO)[number];

/** El filtro por su DJI (sólo quien ganó desde 2022). */
export const DJI_POLITICO = [
  { valor: "con", etiqueta: "Con su DJI" },
  { valor: "leida", etiqueta: "Con su DJI leída" },
  { valor: "familiares", etiqueta: "Declara familiares" },
  { valor: "sin", etiqueta: "Sin su DJI" },
] as const;
export type DjiPolitico = (typeof DJI_POLITICO)[number]["valor"];

export const ORDENES_POLITICOS = [
  { valor: "cruces", etiqueta: "Más cruces primero" },
  { valor: "aportes", etiqueta: "Mayor aporte" },
  { valor: "reciente", etiqueta: "Elección más reciente" },
  { valor: "nombre", etiqueta: "Apellido, de la A a la Z" },
] as const;
export type OrdenPoliticos = (typeof ORDENES_POLITICOS)[number]["valor"];

export interface FiltrosPoliticos {
  papel?: PapelPolitico;
  cruces?: CrucesPolitico;
  senal?: SenalPolitico;
  dji?: DjiPolitico;
  eleccion?: number;
  q?: string;
  orden?: OrdenPoliticos;
  page?: number;
}

/** Los nombres de sus filtros en la URL de la ficha del partido (con «k» delante: no chocan con los de otras pestañas). */
export const P_POLITICOS = { papel: "kpapel", cruces: "kcruces", senal: "ksenal", dji: "kdji", eleccion: "kanio", q: "kq", orden: "korden", page: "kpag" } as const;

type Busqueda = Record<string, string | string[] | undefined> | undefined;
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Los filtros de la URL, sólo los valores que la API acepta. */
export function filtrosPoliticosDeUrl(sp: Busqueda): FiltrosPoliticos {
  const v = (k: keyof typeof P_POLITICOS) => uno(sp?.[P_POLITICOS[k]]);
  const eleccion = Number(v("eleccion"));
  const q = v("q")?.trim().slice(0, 80);
  const page = Math.floor(Number(v("page")));
  return {
    papel: PAPELES_POLITICO.find((p) => p.valor === v("papel"))?.valor,
    cruces: CRUCES_POLITICO.find((c) => c === v("cruces")),
    senal: SENALES_POLITICO.find((s) => s === v("senal")),
    dji: DJI_POLITICO.find((d) => d.valor === v("dji"))?.valor,
    eleccion: Number.isInteger(eleccion) && eleccion >= 2000 && eleccion <= 2100 ? eleccion : undefined,
    // La búsqueda pide 3 letras (como la API): con menos, no filtra.
    q: q && q.length >= 3 ? q : undefined,
    orden: ORDENES_POLITICOS.find((o) => o.valor === v("orden"))?.valor,
    page: page > 1 ? page : undefined,
  };
}

/** Los filtros puestos, con sus nombres de URL (lo que la lista conserva en sus enlaces). */
export function parametrosPoliticos(f: FiltrosPoliticos): Record<string, string | undefined> {
  return {
    [P_POLITICOS.papel]: f.papel,
    [P_POLITICOS.cruces]: f.cruces,
    [P_POLITICOS.senal]: f.senal,
    [P_POLITICOS.dji]: f.dji,
    [P_POLITICOS.eleccion]: f.eleccion ? String(f.eleccion) : undefined,
    [P_POLITICOS.q]: f.q,
    [P_POLITICOS.orden]: f.orden && f.orden !== "cruces" ? f.orden : undefined,
  };
}

export const TAM_POLITICOS = 20;

/** La lista (server component): `null` si la API no respondió. */
export async function getPoliticos(clave: string, f: FiltrosPoliticos = {}, size = TAM_POLITICOS): Promise<PaginaPoliticos | null> {
  const p = new URLSearchParams({ size: String(size) });
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") p.set(k, String(v));
  try {
    const r = await fetch(`${API_BASE}/partidos/${encodeURIComponent(clave)}/politicos?${p.toString()}`, { next: { revalidate: 600 } } as RequestInit);
    return r.ok ? ((await r.json()) as PaginaPoliticos) : null;
  } catch {
    return null;
  }
}

/** El detalle de una persona (GET /partidos/:clave/politicos/:codigo): lo pide su panel al abrirse. */
export interface DetallePolitico {
  codigo: string;
  tipo: "persona" | "empresa";
  conDocumento: boolean;
  /** Su primer aporte o candidatura con el partido: lo que sus empresas ganaron después es lo que cuenta la bandera. */
  vinculoDesde: string | null;
  candidaturas: { anio: number; cargo: string | null; lugar: string | null; resultado: "electo" | "no_electo" | null; fuente: string }[];
  aportes: { n: number; monto: number; filas: { fecha: string | null; anio: number | null; monto: number; tipo: string | null; proceso: string | null; nivel: string | null }[] } | null;
  empresas: {
    ruc: string;
    nombre: string | null;
    rol: string | null;
    desde: string | null;
    vendido: number | null;
    entidades: number | null;
    inhabilitada: string | null;
    estadoSunat: string | null;
    enGobiernos: { procesos: number; monto: number; despues: number; montoDespues: number } | null;
  }[];
  procesos: {
    total: number;
    filas: {
      codigo: string;
      ruc: string;
      fecha: string | null;
      entidad: string | null;
      entidadRuc: string | null;
      descripcion: string | null;
      objeto: string | null;
      monto: number | null;
      ocid: string | null;
      nivel: string | null;
      despues: boolean | null;
    }[];
  };
  ordenes: {
    personaCodigo: string | null;
    entidades: { entidadRuc: string; entidad: string | null; servicio: string | null; ordenes: number; monto: number; primera: string | null; ultima: string | null; tipos: string[] | null; gobernaba: boolean }[];
  } | null;
  /** `reservado`: uno de los dos va con su nombre completo y el parentesco destaparía el apellido tapado del otro: sólo que existe. */
  familia: ({ entidadRuc: string; entidad: string | null; parentesco: string | null; grado: string | null; puesto: string | null; funcionarioApellido: string | null; ficha: string | null; reservado?: undefined }
    | { reservado: true })[];
  sanciones: { tipo: string; desde: string | null; hasta: string | null; resolucion: string | null; infraccion: string | null; estado: string | null; multa: number | null }[];
  otrosPartidos: { clave: string; partido: string | null; gano: boolean; candidato: boolean; aportante: boolean; elecciones: number[]; aportesMonto: number }[];
  /** Su DJI (migración 301): sólo si ganó desde 2022. El empate es por nombre completo y la entidad que gobierna. */
  dji?: {
    estado: EstadoDji;
    empate: "nombre";
    declaraciones: {
      entidadRuc: string;
      entidad: string | null;
      partidoClave: string | null;
      partido: string | null;
      cargoElecto: string | null;
      proceso: string | null;
      desde: string | null;
      hasta: string | null;
      cargoDji: string | null;
      presentada: string | null;
      declaraciones: number;
      leida: boolean;
      familiares: number;
    }[];
  } | null;
  /** Los familiares que declara en su DJI y lo que obtuvieron. Sin nombre ni documento: `pariente` sólo los numera. */
  familiares?: {
    declarados: number;
    conAlgo: number;
    /**
     * De un político de nombre completo, los familiares cuyo parentesco destaparía su apellido tapado: sólo cuántos y, con
     * dos o más en un cruce, el monto sumado (`null` con uno solo). `null` si no hay.
     */
    reservados?: {
      n: number;
      suEntidad: { n: number; monto: number | null };
      partido: { n: number };
      ordenes: { n: number; monto: number | null };
      empresas: { n: number };
    } | null;
    lista: {
      pariente: number;
      parentesco: string | null;
      grado: string | null;
      suEntidad: boolean;
      delPartido: boolean;
      ordenes: { entidadRuc: string | null; entidad: string | null; ordenes: number | null; monto: number | null; desde: number | null; hasta: number | null; suEntidad: boolean; nepotismo: boolean; delPartido: boolean }[];
      empresas: { ruc: string | null; nombre: string | null; rol: string | null; procesos: number | null; monto: number | null; suEntidad: { procesos: number; monto: number } | null; delPartido: boolean }[];
    }[];
  };
  /** Sus informes de control con responsabilidad PRESUNTA (por su DNI, migraciones 302 y 301). */
  informes?: { informe: string; numero: string | null; titulo: string | null; entidad: string | null; entidadRuc: string | null; fecha: string | null; responsabilidades: string[]; url: string | null }[];
}

/** En qué papel está la persona en el partido, en palabras: «Ganó una elección y aportó». */
export function papelTexto(p: Pick<Politico, "gano" | "pendiente" | "candidato" | "aportante" | "tipo">): string {
  if (p.tipo === "empresa") return "Empresa que aportó";
  const partes = [p.gano ? "Ganó una elección" : p.pendiente ? "Postuló y el resultado está pendiente" : p.candidato ? "Postuló y no ganó" : null, p.aportante ? (p.candidato ? "aportó" : "Aportó") : null].filter(Boolean);
  return partes.join(" y ");
}
