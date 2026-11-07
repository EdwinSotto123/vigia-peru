import type { Comprador, DetalleOportunidad, Hito, Oportunidad } from "./tipos.ts";
import { calcularSenales } from "./senales.ts";

/**
 * De lo que devuelve la API de Gobserva Licitaciones (o la muestra, que es lo mismo guardado) a los tipos de la app. Lo
 * usan los dos adaptadores (fuente-demo y fuente-gobserva): una sola forma de leer una fila, un comprador y una ficha.
 * Una persona natural (RUC 10) nunca sale con su nombre ni su RUC.
 */

/** Una fila tal como la devuelven GET /licitaciones/oportunidades y /bandeja. */
export interface FilaCruda {
  ocid: string;
  codigo: string | null;
  objeto: string | null;
  tipo: string | null;
  procedimiento: string | null;
  valor: number | null;
  fecha: string;
  entidadRuc: string | null;
  entidad: string | null;
  region: string | null;
  consultasHasta: string | null;
  items: number;
  /** /bandeja trae el comprador de cada fila (para las señales). */
  comprador?: Partial<Comprador> | null;
}

/** Lo que se usa de GET /licitaciones/oportunidades/:ocid. */
export interface FichaCruda {
  descripcion?: string | null;
  etapa?: string | null;
  consultas?: { desde: string | null; hasta: string | null } | null;
  entidadProvincia?: string | null;
  items?: DetalleOportunidad["itemsDetalle"];
  documentos?: DetalleOportunidad["documentos"];
  enlaces?: { oece: string; busqueda: string | null } | null;
  inteligencia?: Partial<Comprador> | null;
  parecidos?: {
    ocid: string;
    codigo: string | null;
    descripcion: string | null;
    objeto: string | null;
    entidad: string | null;
    departamento: string | null;
    fecha: string | null;
    unidad: string | null;
    cantidad: number | null;
    unitRef: number | null;
    unitAdj: number | null;
    adjudicado: number | null;
    ruc?: string | null;
    proveedor: string | null;
  }[];
  precios?: DetalleOportunidad["precios"];
}

const persona = (ruc: string | null | undefined) => !!ruc && String(ruc).startsWith("10");

export function comprador(i: Partial<Comprador> | null | undefined): Comprador | null {
  if (!i || !i.procesos) return null;
  return {
    procesos: i.procesos ?? 0,
    monto: i.monto ?? 0,
    adjSobreRef: i.adjSobreRef ?? null,
    conPostores: i.conPostores ?? 0,
    postoresPromedio: i.postoresPromedio ?? null,
    unSoloPostor: i.unSoloPostor ?? 0,
    proveedores: (i.proveedores ?? []).filter((p) => !persona(p.ruc)),
  };
}

export function aOportunidad(f: FilaCruda, c: Comprador | null, consultasHasta: string | null = f.consultasHasta): Oportunidad {
  return {
    id: f.ocid,
    codigo: f.codigo,
    objeto: f.objeto,
    tipo: f.tipo,
    procedimiento: f.procedimiento,
    valor: f.valor,
    publicada: f.fecha,
    consultasHasta,
    entidad: { ruc: f.entidadRuc, nombre: f.entidad },
    region: f.region && /^\d{2}$/.test(f.region) ? f.region : f.region?.slice(0, 2) ?? null,
    items: f.items ?? 0,
    senales: calcularSenales({ valor: f.valor, publicada: f.fecha, consultasHasta, comprador: c }),
  };
}

/** El cronograma: lo que trae el OCDS con su fecha; lo demás, sin fecha (está en el cronograma oficial). */
export function cronograma(o: Oportunidad, ficha: FichaCruda | undefined): Hito[] {
  return [
    { clave: "convocatoria", etiqueta: "Convocatoria", fecha: o.publicada },
    { clave: "consultas_desde", etiqueta: "Inicio de consultas y observaciones", fecha: ficha?.consultas?.desde ?? null },
    { clave: "consultas_hasta", etiqueta: "Fin de consultas y observaciones", fecha: o.consultasHasta },
    { clave: "integracion", etiqueta: "Integración de las bases", fecha: null },
    { clave: "ofertas", etiqueta: "Presentación de ofertas", fecha: null },
    { clave: "buena_pro", etiqueta: "Otorgamiento de la buena pro", fecha: null },
  ];
}

/** El detalle desde la fila y su ficha. */
export function aDetalle(o: Oportunidad, ficha: FichaCruda | undefined): DetalleOportunidad {
  return {
    ...o,
    descripcion: ficha?.descripcion ?? null,
    etapa: ficha?.etapa ?? null,
    provincia: ficha?.entidadProvincia ?? null,
    itemsDetalle: ficha?.items ?? [],
    documentos: ficha?.documentos ?? [],
    cronograma: cronograma(o, ficha),
    comprador: comprador(ficha?.inteligencia),
    parecidos: (ficha?.parecidos ?? []).map((p) => ({
      id: p.ocid,
      codigo: p.codigo,
      descripcion: p.descripcion ?? p.objeto,
      entidad: p.entidad,
      departamento: p.departamento,
      fecha: p.fecha,
      unidad: p.unidad,
      cantidad: p.cantidad,
      unitRef: p.unitRef,
      unitAdj: p.unitAdj,
      adjudicado: p.adjudicado,
      proveedor: persona(p.ruc) ? null : p.proveedor,
    })),
    precios: ficha?.precios ?? [],
    enlaces: {
      seace: ficha?.enlaces?.oece ?? `https://contratacionesabiertas.oece.gob.pe/proceso/${encodeURIComponent(o.id)}`,
      busqueda: ficha?.enlaces?.busqueda ?? null,
    },
  };
}
