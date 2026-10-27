/**
 * Lo que el registro del proceso dice además de la convocatoria (API: backend/api/src/lib/proceso.ts): quiénes se
 * registraron y quiénes ofertaron, el cronograma, lo adjudicado y el contrato firmado, y el presupuesto del proyecto.
 * Tipos de la respuesta de GET /contratos/:ocid y piezas puras para pintarla (server o client). Los nombres de personas
 * naturales y sus RUC llegan ya tapados (`10·ref·…`, `•••`).
 */

import { esRucPersonaNatural } from "./privacidad";
import { TIPO_CRUCE } from "./cruces";
import { CORTO_EMPRESA } from "./empresas";
import { oracion, plural } from "./formato";
import type { InversionDelContrato, ObraDelContrato } from "./obras";

export type Severidad = "alta" | "media" | "baja";

export interface PersonaProceso { ruc: string; nombre: string | null }

/** Lo que une a un participante con otros de ESTE proceso (cruces socio común y mismo domicilio). */
export interface VinculoProceso {
  tipo: "socio_comun" | "domicilio_compartido";
  severidad: Severidad;
  con: PersonaProceso[];
  /** Alguno de `con` ganó la buena pro. */
  conGanador: boolean;
  /** La dirección que comparten (dos empresas). */
  domicilio?: string | null;
}

export interface Participante extends PersonaProceso {
  tipo: "empresa" | "persona" | "consorcio";
  /** Figura entre los registrados del OCDS. */
  registrado: boolean;
  /** Presentó oferta (CONOSCE): cuándo y a qué ítems. */
  oferta: { desde: string | null; hasta: string | null; items: number[] } | null;
  gano: boolean;
  itemsGanados: number[];
  montoAdjudicado: number | null;
  sunat: {
    estado: string | null; condicion: string | null; fechaAlta: string | null; mesesAlConvocar: number | null;
    actividad: string | null; domicilio?: string | null; distrito?: string | null;
  } | null;
  rnpVigente: boolean | null;
  historial: {
    postulaciones: number; ganadas: number; adjudicado: number | null; alta: number; media: number; baja: number;
    antecedentes: { tipo: string; severidad: Severidad; n: number }[];
  } | null;
  vinculos: VinculoProceso[];
  integrantes: PersonaProceso[];
}

export interface HitoProceso {
  clave: "convocatoria" | "consultas" | "documentos" | "ofertas" | "buena_pro" | "consentimiento" | "contrato" | "vigencia";
  fecha: string;
  hasta?: string | null;
  fuentes: ("ocds" | "conosce" | "seace")[];
  n?: number;
  contratos?: string[];
  documentos?: { titulo: string | null; tipo: string | null }[];
}

export interface ItemAdjudicado {
  posicion: number;
  descripcion: string | null;
  estado: string | null;
  fuente: "conosce" | "ocds" | null;
  referencial: number | null;
  adjudicado: number | null;
  porcentaje: number | null;
  proveedores: (PersonaProceso & { monto: number | null })[];
  fechaBuenaPro: string | null;
  fechaConsentimiento: string | null;
  contratos: string[];
}

export interface ContratoFirmado {
  codigo: string | null;
  numero: string | null;
  items: number[];
  monto: number | null;
  adicional: number | null;
  reduccion: number | null;
  prorroga: number | null;
  complementario: number | null;
  moneda: string | null;
  firmado: string | null;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  vigenciaOriginal: string | null;
  publicado: string | null;
  url: string | null;
  contratista: PersonaProceso | null;
  fuente: "conosce" | "ocds";
}

export interface PresupuestoProceso {
  cui: string | null;
  proyecto: string | null;
  fuente: string | null;
  monto: number | null;
  cuiOrigen: "ocds" | "descripcion" | null;
  mef: { anio: number; nombre: string | null; pia: number | null; pim: number | null; devengado: number | null }[];
}

/** Lo que agrega la API a la ficha (todo opcional: la API de antes no lo manda). */
export interface ProcesoContrato {
  participantes?: Participante[];
  /** Cuántos presentaron oferta según CONOSCE; null si CONOSCE no trae los postores del proceso. */
  ofertas?: number | null;
  cronograma?: HitoProceso[];
  contrato?: { items: ItemAdjudicado[]; firmados: ContratoFirmado[] };
  presupuesto?: PresupuestoProceso | null;
  /** De dónde salió la fecha de la buena pro: los agentes, CONOSCE o la adjudicación del OCDS. */
  fechaBuenaProFuente?: "analisis" | "conosce" | "ocds" | null;
  /** La obra de INFOBRAS que ejecuta o supervisa este contrato y la inversión de su CUI en Invierte.pe (migración 160). */
  obras?: ObraDelContrato[];
  inversiones?: InversionDelContrato[];
}

/** Ganó, presentó oferta o sólo se registró. Sin postores en CONOSCE no se sabe quién ofertó: «Registrado». */
export function estadoParticipante(p: Participante, conOfertas: boolean): "Ganó" | "Ofertó" | "Solo se registró" | "Registrado" | "Ofertó sin registro" {
  if (p.gano) return "Ganó";
  if (p.oferta) return p.registrado ? "Ofertó" : "Ofertó sin registro";
  return conOfertas ? "Solo se registró" : "Registrado";
}

/** Los vínculos con el ganador como banderas propias (no están en el catálogo de cruces: van con su etiqueta). */
export const ETIQUETA_VINCULO: Record<string, string> = {
  domicilio_ganador: "Mismo domicilio que el ganador",
  socio_ganador: "Socio común con el ganador",
  socio_postor: "Socio común con otro participante",
  domicilio_postor: "Mismo domicilio que otro participante",
};
export const EXPLICA_VINCULO: Record<string, string> = {
  domicilio_ganador: "Tiene el mismo domicilio fiscal que la empresa que ganó (SUNAT): posible competencia aparente o empresas vinculadas.",
  socio_ganador: "Comparte un socio o representante con la empresa que ganó (RNP): competencia aparente.",
  socio_postor: "Comparte un socio o representante con otro participante del proceso (RNP).",
  domicilio_postor: "Tiene el mismo domicilio fiscal que otro participante del proceso (SUNAT).",
};

/** El nombre breve de cada vínculo de este proceso, para el chip de la columna «En el proceso» (el completo, en el title). */
export const CHIP_VINCULO: Record<string, string> = {
  domicilio_ganador: "Domicilio del ganador",
  socio_ganador: "Socio del ganador",
  socio_postor: "Socio en común",
  domicilio_postor: "Mismo domicilio",
};
/** Los nombres de chip de las banderas de un participante: los de una empresa y los de sus vínculos (`CrucesCelda`). */
export const ETIQUETAS_PARTICIPANTE: Record<string, string> = { ...CORTO_EMPRESA, ...CHIP_VINCULO };

/** "7 meses", "15 años": cuánto llevaba inscrita en la SUNAT al convocarse; inscrita después, lo dice. */
export function antiguedad(meses: number | null): string | null {
  if (meses == null) return null;
  if (meses < 0) return "después de la convocatoria";
  return meses < 24 ? plural(meses, "mes", "meses") : plural(Math.floor(meses / 12), "año", "años");
}

/** "Activo y habido", "Baja de oficio y no habido": su estado y su condición en la SUNAT, en una línea. */
export const estadoSunat = (s: NonNullable<Participante["sunat"]>) =>
  [s.estado, s.condicion].filter((x): x is string => !!x).map((x, i) => (i ? x.toLocaleLowerCase("es") : oracion(x))).join(" y ") || null;

/** El tipo de bandera de un vínculo: con el ganador o con otro participante (y, en el ganador, el cruce de siempre). */
export function tipoVinculo(v: VinculoProceso, esGanador: boolean): string {
  if (esGanador) return v.tipo;
  if (v.tipo === "domicilio_compartido") return v.conGanador ? "domicilio_ganador" : "domicilio_postor";
  return v.conGanador ? "socio_ganador" : "socio_postor";
}

/** Lo que une al participante con otros de ESTE proceso, como banderas (una por tipo). */
export function vinculosComoBanderas(p: Participante): { tipo: string; severidad: Severidad }[] {
  const out = new Map<string, Severidad>();
  for (const v of p.vinculos) {
    const tipo = tipoVinculo(v, p.gano);
    const previa = out.get(tipo);
    if (!previa || "amb".indexOf(v.severidad[0]) < "amb".indexOf(previa[0])) out.set(tipo, v.severidad);
  }
  return [...out].map(([tipo, severidad]) => ({ tipo, severidad }));
}

/**
 * Sus antecedentes en otros registros (empresa_resumen), sin los tipos que ya van como vínculo de este proceso (el
 * ganador trae el mismo domicilio o el socio común también en su resumen).
 */
export function antecedentesDe(p: Participante): { tipo: string; severidad: Severidad }[] {
  const vinculos = new Set(vinculosComoBanderas(p).map((v) => v.tipo));
  return (p.historial?.antecedentes ?? []).filter((a) => !vinculos.has(a.tipo)).map((a) => ({ tipo: a.tipo, severidad: a.severidad }));
}

/** Todas sus banderas: los vínculos de este proceso y sus antecedentes (`CrucesCelda` las ordena por severidad). */
export const banderasParticipante = (p: Participante) => [...vinculosComoBanderas(p), ...antecedentesDe(p)];

/** El nombre de una bandera de participante (vínculo propio o tipo del catálogo de cruces). */
export const nombreBandera = (tipo: string): string => ETIQUETA_VINCULO[tipo] ?? TIPO_CRUCE[tipo]?.corto ?? tipo.replace(/_/g, " ");
export const explicaBandera = (tipo: string): string | undefined => EXPLICA_VINCULO[tipo] ?? TIPO_CRUCE[tipo]?.explica;

/** ¿Se puede mostrar su RUC? El de una empresa sí; el de una persona natural llega tapado y no se repite en la fila. */
export const rucVisibleDe = (p: PersonaProceso) => (esRucPersonaNatural(p.ruc) ? null : /^\d{11}$/.test(p.ruc) ? p.ruc : null);

/**
 * El nombre de un contrato: «Contrato N.° 21-2026». CONOSCE trae el número como lo escribe cada entidad («CONTRATO NRO
 * 21-2026», «23», «002-2026-MDS»): la palabra de adelante se quita para no repetirla. Sin número, su código del SEACE.
 */
export function tituloContrato(numero: string | null | undefined, codigo?: string | null): string {
  const n = numeroContrato(numero);
  if (!n) return codigo ? `Contrato ${codigo}` : "Contrato sin número";
  return /^CONTRATO\b/i.test(n) ? n.charAt(0) + n.slice(1).toLocaleLowerCase("es") : `Contrato N.° ${n}`;
}

/** El número de un contrato sin la palabra que algunas entidades le anteponen («CONTRATO NRO 21-2026» → «21-2026»). */
export function numeroContrato(numero: string | null | undefined): string | null {
  const t = (numero ?? "").trim();
  const m = /^CONTRATO\s*(?:N(?:RO|[°º])?\.?|N[UÚ]MERO)?\s*[:.]?\s*(\d.*)$/i.exec(t);
  return (m ? m[1] : t) || null;
}

/** De dónde sale un hito, en palabras. */
export const FUENTE_HITO: Record<HitoProceso["fuentes"][number], string> = {
  ocds: "Registro OCDS (SEACE)",
  conosce: "CONOSCE (OECE)",
  seace: "Documento del SEACE",
};
