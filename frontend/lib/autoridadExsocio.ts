import { fechaConAnio, numero, plural, solesCompacto } from "@/lib/formato";

/**
 * En observación (migración 367): una autoridad electa dejó de figurar en una empresa y esa empresa le vendió a la
 * entidad que gobierna o fiscaliza, dentro de su periodo. Lo que comparten la tarjeta de la persona en la ficha de la
 * empresa y la fila de Patrones.
 */
export interface VentaASuEntidad {
  entidadRuc: string;
  entidad: string | null;
  cargo: string;
  lugar?: string | null;
  /** El corte mensual del RNP en que dejó de figurar en la empresa. */
  bajaCorte: string;
  fueSocio: boolean;
  ordenes: number;
  montoOrdenes: number;
  procesos: number;
  montoProcesos: number;
  /** Ventas de cuando todavía figuraba en la empresa. */
  ventasMientras: number;
  /** Ventas hasta 12 meses después del corte en que dejó de figurar (incluye las de mientras). */
  ventasEnPlazo: number;
  montoEnPlazo: number;
  /** Ventas de más de 12 meses después. */
  ventasDespues: number;
  primera: string | null;
  ultima: string | null;
  severidad: "alta" | "media";
}

/** «38 órdenes por S/ 869 mil y 4 procesos adjudicados por S/ 1,1 M». */
export function loQueVendio(v: VentaASuEntidad): string {
  return [
    v.ordenes ? `${plural(v.ordenes, "orden", "órdenes")} por ${solesCompacto(v.montoOrdenes)}` : null,
    v.procesos ? `${plural(v.procesos, "proceso adjudicado", "procesos adjudicados")} por ${solesCompacto(v.montoProcesos)}` : null,
  ].filter(Boolean).join(" y ");
}

/** Cuántas de esas ventas caen cuando figuraba en la empresa o en los 12 meses siguientes a su salida. */
export function ventasFrenteALaSalida(v: VentaASuEntidad): string {
  const total = v.ordenes + v.procesos;
  const corte = fechaConAnio(v.bajaCorte);
  if (v.ventasEnPlazo === 0) return `Todas son de más de 12 meses después del corte en que dejó de figurar (${corte}).`;
  const cuantas = v.ventasEnPlazo === total ? (total === 1 ? "Es" : "Todas son") : `${numero(v.ventasEnPlazo)} son`;
  const mientras =
    v.ventasMientras === v.ventasEnPlazo
      ? "de cuando todavía figuraba en la empresa"
      : v.ventasMientras === 0
        ? "de los 12 meses siguientes al corte en que dejó de figurar"
        : "de cuando figuraba en la empresa o de los 12 meses siguientes a su salida";
  return `${cuantas} ${mientras} (dejó de figurar en el corte del ${corte}).`;
}

/** La regla, en una línea, con lo que el dato no dice. */
export const REGLA_AUTORIDAD_EXSOCIO =
  "El impedimento para contratar alcanza a la empresa en la que una autoridad tenga o haya tenido más del 30 % del capital dentro de los 12 meses anteriores a la convocatoria, y a la que integra o representa (artículo 11 de la Ley 30225; artículo 30 de la Ley 32069). El RNP no publica el porcentaje: es un dato para revisar.";
