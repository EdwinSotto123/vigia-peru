import { fechaConAnio, numero, plural, solesCompacto } from "@/lib/formato";

/**
 * Lo que comparten el caso de la ficha de una persona y la fila de Patrones en «trabaja en compras y un familiar recibe
 * órdenes de su entidad» (migraciones 364, 366 y 368): el periodo del puesto y lo que recibió el familiar (a su nombre o
 * con su empresa) frente a él. Los campos `…EnPuesto`, `ordenesAntes` y `ordenesLuego` faltan en una respuesta anterior
 * a la migración 366; `via` y los de la empresa, en una anterior a la 368.
 */
export interface PuestoYOrdenes {
  cargoDesde: string | null;
  /** null: sin cese declarado. */
  cargoHasta: string | null;
  /** Sin cese: la fecha de su última declaración jurada que nombra el puesto como vigente. */
  vistoHasta?: string | null;
  /** persona: órdenes a nombre del familiar · empresa: ventas de una empresa en la que el familiar figura (RNP). */
  via?: "persona" | "empresa";
  empresaRuc?: string | null;
  empresa?: string | null;
  /** Los papeles del familiar en esa empresa: socio, representante legal, directivo. */
  rolEnEmpresa?: string[] | null;
  /** Desde cuándo figura el familiar en la empresa. */
  parienteDesde?: string | null;
  ordenes: number;
  monto: number;
  /** Años de las órdenes (del familiar o de su empresa) en esa entidad. */
  desde: number | null;
  hasta: number | null;
  /** Órdenes emitidas entre el inicio del puesto y su fin (el cese o, sin cese, la última declaración). */
  ordenesEnPuesto?: number | null;
  montoEnPuesto?: number | null;
  /** Procesos que la empresa del familiar ganó en esa entidad con la persona en el puesto. */
  procesosEnPuesto?: number | null;
  montoProcesosEnPuesto?: number | null;
  ordenesAntes?: number | null;
  ordenesLuego?: number | null;
  primeraEnPuesto?: string | null;
  ultimaEnPuesto?: string | null;
  coincide: boolean;
  empezoDespues: boolean;
}

const conEmpresa = (x: PuestoYOrdenes) => x.via === "empresa";

/** «desde el 20 ago. 2021 hasta el 29 oct. 2021», o sin cese y hasta qué declaración consta. null si no declaró el inicio. */
export function periodoDelPuesto(x: PuestoYOrdenes): string | null {
  if (!x.cargoDesde) return null;
  const desde = `desde el ${fechaConAnio(x.cargoDesde)}`;
  if (x.cargoHasta) return `${desde} hasta el ${fechaConAnio(x.cargoHasta)}`;
  if (x.vistoHasta) return `${desde}, sin cese declarado (su última declaración que lo nombra es del ${fechaConAnio(x.vistoHasta)})`;
  return `${desde} (sin cese declarado)`;
}

/** Los años de todas las órdenes en la entidad: «en 2020», «de 2018 a 2025». */
export function aniosDeLasOrdenes(x: PuestoYOrdenes): string | null {
  if (!x.desde || !x.hasta) return null;
  return x.desde === x.hasta ? `en ${x.desde}` : `de ${x.desde} a ${x.hasta}`;
}

/** Los papeles del familiar en la empresa, en una frase: «socio y representante legal». */
export function papelEnLaEmpresa(x: PuestoYOrdenes): string {
  const r = x.rolEnEmpresa?.length ? x.rolEnEmpresa : ["socio o representante"];
  return r.length > 1 ? `${r.slice(0, -1).join(", ")} y ${r[r.length - 1]}` : r[0];
}

/**
 * Qué recibió el familiar de esa entidad, sin el nombre de la empresa (quien llama lo enlaza aparte): «recibió de esa
 * entidad 25 órdenes a su nombre por S/ 325 mil, de 2018 a 2026» o «que recibió de esa entidad 21 órdenes por S/ 351 mil».
 */
export function loQueRecibio(x: PuestoYOrdenes): string {
  const anios = aniosDeLasOrdenes(x);
  if (!conEmpresa(x)) return `recibió de esa entidad ${plural(x.ordenes, "orden", "órdenes")} a su nombre por ${solesCompacto(x.monto)}${anios ? `, ${anios}` : ""}`;
  return x.ordenes
    ? `recibió de esa entidad ${plural(x.ordenes, "orden", "órdenes")} por ${solesCompacto(x.monto)}${anios ? `, ${anios}` : ""}`
    : "le vendió a esa entidad por procesos de selección";
}

/** Las fechas de las ventas hechas con la persona en el puesto: «el 5 set. 2021», «del 5 ene. 2023 al 25 jun. 2026». */
export function fechasEnElPuesto(x: PuestoYOrdenes): string | null {
  if (!x.primeraEnPuesto || !x.ultimaEnPuesto) return null;
  return x.primeraEnPuesto === x.ultimaEnPuesto
    ? `el ${fechaConAnio(x.primeraEnPuesto)}`
    : `del ${fechaConAnio(x.primeraEnPuesto)} al ${fechaConAnio(x.ultimaEnPuesto)}`;
}

/** Cuántas de esas órdenes (y, con una empresa, cuántos procesos) cayeron con la persona en el puesto. */
export function ordenesEnElPuesto(x: PuestoYOrdenes): string {
  if (x.ordenesEnPuesto == null) {
    if (x.empezoDespues) return "La primera de esas órdenes es de cuando ya tenía el puesto.";
    if (x.coincide) return "Parte de esas órdenes cae en el tiempo en que tenía el puesto.";
    return "No se pudo comparar las fechas de esas órdenes con las del puesto.";
  }
  const procesos = x.procesosEnPuesto ?? 0;
  const ganados = procesos ? `${plural(procesos, "proceso", "procesos")} de esa entidad por ${solesCompacto(x.montoProcesosEnPuesto ?? 0)}` : "";
  const fechas = fechasEnElPuesto(x);
  if (x.ordenesEnPuesto === 0) {
    if (procesos) return `Mientras tenía el puesto, la empresa ganó ${ganados}${fechas ? ` (${fechas})` : ""}.`;
    return x.ordenes ? "Ninguna de esas órdenes se emitió mientras tenía el puesto." : "Ninguna de esas ventas cae en el tiempo en que tenía el puesto.";
  }
  const cuantas = x.ordenesEnPuesto === 1 ? "Una de esas órdenes se emitió" : `${numero(x.ordenesEnPuesto)} de esas órdenes se emitieron`;
  const ordenes = `${cuantas} mientras tenía el puesto, por ${solesCompacto(x.montoEnPuesto ?? 0)}${fechas ? ` (${fechas})` : ""}.`;
  return procesos ? `${ordenes} En ese tiempo la empresa ganó además ${ganados}.` : ordenes;
}

/** Lo que recibió antes de que la persona asumiera y después del fin del puesto. null si no hay nada que decir. */
export function ordenesFueraDelPuesto(x: PuestoYOrdenes): string | null {
  if (x.ordenesEnPuesto == null) return null;
  const frases: string[] = [];
  const antes = x.ordenesAntes ?? 0;
  const luego = x.ordenesLuego ?? 0;
  if (antes > 0) frases.push(`${plural(antes, "orden es", "órdenes son")} de antes de que asumiera.`);
  else if (x.empezoDespues) frases.push(`Antes de que asumiera, ${conEmpresa(x) ? "la empresa no le había vendido a" : "el familiar no tenía órdenes de"} esa entidad.`);
  if (luego > 0) {
    frases.push(
      x.cargoHasta
        ? `${plural(luego, "orden es", "órdenes son")} de después de su cese.`
        : `${plural(luego, "orden es", "órdenes son")} de después de su última declaración: no consta si seguía en el puesto.`,
    );
  }
  return frases.length ? frases.join(" ") : null;
}

/** El título del caso, según el puesto y cómo cobra el familiar. */
export function tituloCompraFamilia(x: PuestoYOrdenes & { tipoCargo?: "compras" | "decide" }): string {
  const puesto = x.tipoCargo === "decide" ? "decide el gasto" : "trabaja en compras";
  return conEmpresa(x)
    ? `En observación: ${puesto} y la empresa de un familiar le vende a su entidad`
    : `En observación: ${puesto} y un familiar recibe órdenes de su entidad`;
}

/** La regla, según cómo cobra el familiar. */
export function reglaCompraFamilia(x: PuestoYOrdenes): string {
  return conEmpresa(x)
    ? "La ley impide contratar con la entidad a la empresa en la que el cónyuge, conviviente o un pariente hasta el segundo grado de quien interviene en sus contrataciones tenga o haya tenido más del 30 % del capital en los 12 meses anteriores a la convocatoria, o que integre o represente (artículo 11 del TUO de la Ley 30225; artículo 30 de la Ley 32069). El RNP no publica el porcentaje."
    : "La ley impide contratar con la entidad al cónyuge, conviviente y parientes hasta el segundo grado de quien interviene en sus contrataciones (artículo 11 del TUO de la Ley 30225; artículo 30 de la Ley 32069).";
}
