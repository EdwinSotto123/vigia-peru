/**
 * Las cifras del año en curso, en un solo lugar (DESIGN_SYSTEM.md §10.1: «si una cifra aparece en dos páginas con la
 * misma palabra, es el mismo número»).
 *
 * La base trae la historia del OECE desde 2015, pero lo que Vigía lee y financia es lo del año: «publicados», «leídos» y
 * «con riesgo alto» se cuentan sobre las convocatorias de ese año, las tres del MISMO resumen
 * (`GET /contratos/resumen?desde=AAAA-01-01`). Antes el Inicio decía «386 ya leídos, 0.7 % de los 57,936 de 2026»: el
 * numerador era de toda la base y el denominador sólo del año, mientras el mapa, financiar y la portada decían 371.
 *
 * Lo leen el Inicio (/app), el mapa sin filtros (/app/mapa) y financiar (/app/financiar). Sin JSX ni estado: sirve en el
 * servidor y en el navegador. Si el resumen no responde, `null`: nadie rellena con un número plausible.
 */

import { anioLectura, desdeLectura, getResumenContratos, type ResumenContratos } from "@/lib/contratos";
import { contarLeidos } from "@/lib/landing";
import { porcentaje } from "@/lib/formato";

export interface CifrasAnio {
  /** El año que se cuenta (el de Lima). */
  anio: number;
  /** Convocatorias del año publicadas en el SEACE. */
  publicados: number;
  /** De esas, las que Vigía terminó de leer, por cualquier vía (publicadas, en revisión o descartadas). */
  leidos: number;
  /** Leídas con el dictamen publicado y peso del riesgo alto. */
  riesgoAlto: number;
  /** Leídas con el dictamen publicado y peso del riesgo medio o alto (puntaje de 40 o más). */
  riesgoMedioOAlto: number;
  /** Leídas cuya alerta espera revisión humana. */
  enRevision: number;
}

/** Las cifras del año a partir de un resumen ya pedido con `desde` = 1 de enero (el de financiar, por ejemplo). */
export function cifrasDeResumen(r: ResumenContratos | null | undefined, anio: number = anioLectura()): CifrasAnio | null {
  if (!r) return null;
  const p = r.porRiesgo ?? {};
  return {
    anio,
    publicados: r.total,
    leidos: contarLeidos(p) ?? 0,
    riesgoAlto: p.alto ?? 0,
    riesgoMedioOAlto: (p.alto ?? 0) + (p.medio ?? 0),
    enRevision: p.en_revision ?? 0,
  };
}

/** Pide el resumen del año y arma sus cifras. `null` si el API no respondió. */
export async function getCifrasAnio(): Promise<CifrasAnio | null> {
  const r = await getResumenContratos({ desde: desdeLectura() }).catch(() => null);
  return cifrasDeResumen(r);
}

/**
 * «0.6 %»: qué parte de `de` es `parte`, con UN formato en toda la app (antes la misma cifra salía «0.64 %» en
 * financiar, «0.7 %» en el Inicio y «0.6 %» en la portada). Un decimal; por debajo de 0.1 %, «menos de 0.1 %», que
 * redondeado diría «0 %» y un cero es un dato. Sin denominador, `null`.
 */
export function pctDe(parte: number, de: number): string | null {
  if (!(de > 0)) return null;
  const p = (parte / de) * 100;
  if (p > 0 && p < 0.1) return `menos de ${porcentaje(0.1, { decimales: 1 })}`;
  return porcentaje(p, { decimales: 1 });
}
