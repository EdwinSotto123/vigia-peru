import { fechaConAnio, numero, plural, solesCompacto } from "@/lib/formato";

/**
 * Lo que comparten el caso de la ficha de una persona y la fila de Patrones en «trabaja en compras y un familiar recibe
 * órdenes de su entidad» (migraciones 364 y 366): el periodo del puesto y las órdenes del familiar frente a él.
 * Los campos `…EnPuesto`, `ordenesAntes` y `ordenesLuego` faltan en una respuesta anterior a la migración 366.
 */
export interface PuestoYOrdenes {
  cargoDesde: string | null;
  /** null: sin cese declarado. */
  cargoHasta: string | null;
  /** Sin cese: la fecha de su última declaración jurada que nombra el puesto como vigente. */
  vistoHasta?: string | null;
  ordenes: number;
  monto: number;
  /** Años de las órdenes del familiar en esa entidad. */
  desde: number | null;
  hasta: number | null;
  /** Órdenes emitidas entre el inicio del puesto y su fin (el cese o, sin cese, la última declaración). */
  ordenesEnPuesto?: number | null;
  montoEnPuesto?: number | null;
  ordenesAntes?: number | null;
  ordenesLuego?: number | null;
  primeraEnPuesto?: string | null;
  ultimaEnPuesto?: string | null;
  coincide: boolean;
  empezoDespues: boolean;
}

/** «desde el 20 ago. 2021 hasta el 29 oct. 2021», o sin cese y hasta qué declaración consta. null si no declaró el inicio. */
export function periodoDelPuesto(x: PuestoYOrdenes): string | null {
  if (!x.cargoDesde) return null;
  const desde = `desde el ${fechaConAnio(x.cargoDesde)}`;
  if (x.cargoHasta) return `${desde} hasta el ${fechaConAnio(x.cargoHasta)}`;
  if (x.vistoHasta) return `${desde}, sin cese declarado (su última declaración que lo nombra es del ${fechaConAnio(x.vistoHasta)})`;
  return `${desde} (sin cese declarado)`;
}

/** Los años de todas las órdenes del familiar en la entidad: «en 2020», «de 2018 a 2025». */
export function aniosDeLasOrdenes(x: PuestoYOrdenes): string | null {
  if (!x.desde || !x.hasta) return null;
  return x.desde === x.hasta ? `en ${x.desde}` : `de ${x.desde} a ${x.hasta}`;
}

/** Las fechas de las órdenes emitidas con la persona en el puesto: «el 5 set. 2021», «del 5 ene. 2023 al 25 jun. 2026». */
export function fechasEnElPuesto(x: PuestoYOrdenes): string | null {
  if (!x.primeraEnPuesto || !x.ultimaEnPuesto) return null;
  return x.primeraEnPuesto === x.ultimaEnPuesto
    ? `el ${fechaConAnio(x.primeraEnPuesto)}`
    : `del ${fechaConAnio(x.primeraEnPuesto)} al ${fechaConAnio(x.ultimaEnPuesto)}`;
}

/** Cuántas de las órdenes del familiar se emitieron con la persona en el puesto. */
export function ordenesEnElPuesto(x: PuestoYOrdenes): string {
  if (x.ordenesEnPuesto == null) {
    if (x.empezoDespues) return "La primera de esas órdenes es de cuando ya tenía el puesto.";
    if (x.coincide) return "Parte de esas órdenes cae en el tiempo en que tenía el puesto.";
    return "No se pudo comparar las fechas de esas órdenes con las del puesto.";
  }
  if (x.ordenesEnPuesto === 0) return "Ninguna de esas órdenes se emitió mientras tenía el puesto.";
  const cuantas = x.ordenesEnPuesto === 1 ? "Una de esas órdenes se emitió" : `${numero(x.ordenesEnPuesto)} de esas órdenes se emitieron`;
  const fechas = fechasEnElPuesto(x);
  return `${cuantas} mientras tenía el puesto, por ${solesCompacto(x.montoEnPuesto ?? 0)}${fechas ? ` (${fechas})` : ""}.`;
}

/** Lo que el familiar recibió antes de que la persona asumiera y después del fin del puesto. null si no hay nada que decir. */
export function ordenesFueraDelPuesto(x: PuestoYOrdenes): string | null {
  if (x.ordenesEnPuesto == null) return null;
  const frases: string[] = [];
  const antes = x.ordenesAntes ?? 0;
  const luego = x.ordenesLuego ?? 0;
  if (antes > 0) frases.push(`${plural(antes, "orden es", "órdenes son")} de antes de que asumiera.`);
  else if (x.ordenesEnPuesto > 0) frases.push("Antes de que asumiera, el familiar no tenía órdenes de esa entidad.");
  if (luego > 0) {
    frases.push(
      x.cargoHasta
        ? `${plural(luego, "orden es", "órdenes son")} de después de su cese.`
        : `${plural(luego, "orden es", "órdenes son")} de después de su última declaración: no consta si seguía en el puesto.`,
    );
  }
  return frases.length ? frases.join(" ") : null;
}
