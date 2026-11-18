/**
 * «Lo más grave» de una historia (pedido del usuario del 2026-11-18: «sólo muestra cosas irrelevantes como visitas»).
 *
 * Antes, «Lo que llama la atención» juntaba sólo las secuencias y los meses fuera de lo normal: en una entidad grande eran
 * ocho picos de visitas y de planilla, mientras sus 120 contratos con banderas y sus informes de control con
 * responsabilidad penal quedaban abajo, como puntos de la línea. Aquí todo lo que tiene gravedad entra en UNA lista:
 * cada hecho con severidad (el contrato con banderas, el informe, la obra paralizada, la visita que terminó en compra),
 * cada secuencia y cada mes fuera de lo normal, por clase (el renglón de la línea), lo más grave primero.
 *
 * Funciones puras: las usan el servidor (para contar la pestaña) y la vista (para filtrar).
 */
import type { Carril, EventoHistoria, Historia, PatronHistoria, SecuenciaHistoria, SeveridadHistoria } from "./historia";

/** La clase de un hallazgo: el renglón de la línea, una secuencia («una cosa llevó a otra») o un mes fuera de lo normal. */
export type ClaseHallazgo = Carril | "secuencias" | "ritmo";

interface Base {
  id: string;
  clase: ClaseHallazgo;
  severidad: SeveridadHistoria;
  titulo: string;
  /** Cuándo empezó (un hecho suelto: su día). */
  fecha: string;
  /** Cuándo terminó, si es un tramo o una secuencia. */
  hasta: string | null;
  monto: number | null;
}
export type Hallazgo =
  | (Base & { tipo: "evento"; e: EventoHistoria })
  | (Base & { tipo: "secuencia"; s: SecuenciaHistoria })
  | (Base & { tipo: "patron"; p: PatronHistoria });

/**
 * En qué orden van las clases a igual gravedad: primero lo que ya dijo un órgano de control o una sanción, luego los
 * contratos con banderas, las obras, lo que encadenan sus datos, y al final el ritmo (un pico dice poco por sí solo).
 */
const ORDEN_CLASE: ClaseHallazgo[] = [
  "control", "banderas", "obras", "secuencias", "visitas", "politica", "empresa", "compras", "ordenes", "personas", "menores", "planilla", "plazas",
  "presupuesto", "ritmo", "gobierno",
];
const ROTULO: Partial<Record<ClaseHallazgo, string>> = { secuencias: "Una cosa llevó a otra", ritmo: "Fuera de lo normal" };

/** Cuántos antecedentes graves explican un hecho (un contrato con banderas). */
const graves = (x: Hallazgo) => (x.tipo === "evento" ? (x.e.banderas ?? []).filter((b) => b.severidad === "alta").length : 0);
/** El día que cuenta para ubicarlo en un periodo: cuando se cerró (la buena pro que siguió a las visitas), o su día. */
export const diaDe = (x: Hallazgo) => (x.tipo === "secuencia" ? x.hasta ?? x.fecha : x.fecha);

/**
 * Todo lo que tiene gravedad en una historia, ordenado para leer de arriba abajo: lo de señal alta, luego lo medio y lo
 * bajo; dentro de cada gravedad, UNO de cada clase por vuelta (así la primera pantalla no son doce contratos seguidos: es
 * el informe más grave, el contrato más marcado, la obra paralizada, la visita que terminó en compra…) y, dentro de cada
 * clase, primero lo de más antecedentes graves, más monto y más reciente.
 */
export function hallazgosDe(h: Historia): Hallazgo[] {
  const xs: Hallazgo[] = [];
  for (const e of h.eventos) {
    if (e.carril === "gobierno" || !e.severidad) continue;
    xs.push({ tipo: "evento", id: `e:${e.id}`, clase: e.carril, severidad: e.severidad, titulo: e.titulo, fecha: e.fecha, hasta: e.hasta ?? null, monto: e.monto ?? null, e });
  }
  for (const s of h.secuencias) {
    if (!s.pasos.length) continue;
    const ultimo = s.pasos[s.pasos.length - 1].fecha;
    xs.push({ tipo: "secuencia", id: `s:${s.id}`, clase: "secuencias", severidad: s.severidad, titulo: s.titulo, fecha: s.pasos[0].fecha, hasta: ultimo !== s.pasos[0].fecha ? ultimo : null, monto: null, s });
  }
  for (const p of h.patrones ?? []) {
    xs.push({ tipo: "patron", id: `p:${p.id}`, clase: "ritmo", severidad: p.severidad, titulo: p.titulo, fecha: `${p.mes}-01`, hasta: p.hasta && p.hasta !== p.mes ? `${p.hasta}-28` : null, monto: null, p });
  }
  const dentro = (a: Hallazgo, b: Hallazgo) => graves(b) - graves(a) || (b.monto ?? 0) - (a.monto ?? 0) || diaDe(b).localeCompare(diaDe(a)) || a.id.localeCompare(b.id);
  const out: Hallazgo[] = [];
  for (const sev of ["alta", "media", "baja"] as const) {
    const colas = ORDEN_CLASE.map((c) => xs.filter((x) => x.severidad === sev && x.clase === c).sort(dentro)).filter((q) => q.length > 0);
    for (let i = 0; colas.some((q) => i < q.length); i++) for (const q of colas) if (i < q.length) out.push(q[i]);
  }
  return out;
}

export interface ClaseConCuenta {
  clave: ClaseHallazgo;
  etiqueta: string;
  n: number;
}

/** El nombre de una clase: el del renglón de la línea de esta historia («Contratos con banderas», «Sanciones y penalidades»). */
export function nombreDeClase(h: Historia, clase: ClaseHallazgo): string {
  return ROTULO[clase] ?? h.carriles.find((c) => c.clave === clase)?.titulo ?? clase;
}

/** Las clases que tienen hallazgos, en su orden, con cuántos (sobre la lista que se le pasa: ya filtrada por lo demás). */
export function clasesDe(h: Historia, todos: Hallazgo[], vistos: Hallazgo[] = todos): ClaseConCuenta[] {
  const hay = new Set(todos.map((x) => x.clase));
  return ORDEN_CLASE.filter((c) => hay.has(c)).map((c) => ({ clave: c, etiqueta: nombreDeClase(h, c), n: vistos.filter((x) => x.clase === c).length }));
}

export interface PeriodoHistoria {
  clave: string;
  etiqueta: string;
  /** Desde este día (incluido)… */
  desde: string;
  /** …hasta este (sin incluirlo). */
  hasta: string;
}

/**
 * Los periodos por los que se puede mirar la historia: las gestiones (quién gobernaba), si la historia las trae, o los
 * años en que hay algo. De lo más reciente a lo más viejo.
 */
export function periodosDe(h: Historia, todos: Hallazgo[]): { nombre: "Gestión" | "Año"; opciones: PeriodoHistoria[] } {
  const gestiones = h.eventos
    .filter((e) => e.carril === "gobierno")
    .map((e) => {
      const hasta = e.hasta ?? "9999-12-31";
      const a = e.fecha.slice(0, 4);
      const b = (e.hasta ?? h.hasta).slice(0, 4);
      return { clave: e.id, etiqueta: `${e.titulo}, ${a === b ? a : `${a} a ${b}`}`, desde: e.fecha, hasta };
    })
    .filter((g) => g.hasta > h.desde && todos.some((x) => diaDe(x) >= g.desde && diaDe(x) < g.hasta))
    .sort((a, b) => b.desde.localeCompare(a.desde));
  if (gestiones.length > 1) return { nombre: "Gestión", opciones: gestiones };
  const anios = [...new Set(todos.map((x) => diaDe(x).slice(0, 4)))].sort().reverse();
  return { nombre: "Año", opciones: anios.map((a) => ({ clave: a, etiqueta: a, desde: `${a}-01-01`, hasta: `${Number(a) + 1}-01-01` })) };
}

export const enPeriodo = (x: Hallazgo, p: PeriodoHistoria | null | undefined) => !p || (diaDe(x) >= p.desde && diaDe(x) < p.hasta);

export interface CifraHistoria {
  clave: string;
  valor: number;
  etiqueta: string;
  /** Lo que acompaña a la cifra: cuánto suman, cuántos graves. */
  contexto: string | null;
  /** Su lista entera en la ficha. */
  href: string | null;
}

/** Qué series resumen un periodo, en orden: primero las que dicen algo de sus compras. */
const SERIES_CIFRA: Carril[] = ["banderas", "compras", "ordenes", "personas", "menores", "visitas", "plazas"];

/**
 * Las cifras de un periodo (o de toda la historia), sacadas de las series por mes y de sus informes o sanciones: cuántos
 * contratos con banderas, cuántos procesos, cuántas órdenes y por cuánto. Son los totales reales, no los de la muestra de
 * hechos que va en la lista. A lo sumo cuatro (las que tienen algo).
 */
export function cifrasDe(h: Historia, p: PeriodoHistoria | null | undefined, soles: (n: number) => string, contar: (n: number) => string): CifraHistoria[] {
  const desde = (p?.desde ?? "0000-01").slice(0, 7);
  const hasta = (p?.hasta ?? "9999-12").slice(0, 7);
  // Por meses: el mes en que asume una gestión cuenta para la que entra.
  const dentro = (mes: string) => mes >= desde && mes < hasta;
  const out: CifraHistoria[] = [];
  const control = h.eventos.filter((e) => e.carril === "control" && (!p || (e.fecha >= p.desde && e.fecha < p.hasta)));
  for (const carril of SERIES_CIFRA) {
    const s = h.series.find((x) => x.carril === carril && !x.porAnio);
    if (!s) continue;
    const puntos = s.puntos.filter((x) => dentro(x.periodo));
    const n = puntos.reduce((t, x) => t + x.n, 0);
    if (!n) continue;
    const monto = puntos.reduce((t, x) => t + (x.monto ?? 0), 0);
    const extra = puntos.reduce((t, x) => t + (x.extra ?? 0), 0);
    out.push({
      clave: carril,
      valor: n,
      etiqueta: s.titulo,
      contexto: carril === "banderas" && s.extra ? `${contar(extra)} ${s.extra}` : monto > 0 ? `suman ${soles(monto)}` : null,
      href: s.href ?? null,
    });
    // Tras los contratos con banderas, lo que dijo el control (o las sanciones, en una empresa).
    if (carril === "banderas" && control.length && !h.omitidos.control) out.push(cifraControl(h, control, contar));
  }
  if (control.length && !h.omitidos.control && !out.some((x) => x.clave === "control")) out.splice(Math.min(1, out.length), 0, cifraControl(h, control, contar));
  return out.slice(0, 4);
}

function cifraControl(h: Historia, control: EventoHistoria[], contar: (n: number) => string): CifraHistoria {
  const altas = control.filter((e) => e.severidad === "alta").length;
  const entidad = h.sujeto.tipo === "entidad";
  return {
    clave: "control",
    valor: control.length,
    etiqueta: entidad ? (control.length === 1 ? "Informe de control" : "Informes de control") : nombreDeClase(h, "control"),
    contexto: altas ? (entidad ? `${contar(altas)} con responsabilidad penal` : `${contar(altas)} de señal alta`) : entidad ? "ninguno con responsabilidad penal" : null,
    href: control[0]?.href ?? null,
  };
}

/** Los totales de una clase en toda la historia, si la lista sólo trae una muestra (los contratos con banderas). */
export function omitidosDe(h: Historia, clase: ClaseHallazgo): { n: number; href: string | null } | null {
  const n = clase === "secuencias" || clase === "ritmo" ? 0 : h.omitidos[clase] ?? 0;
  return n > 0 ? { n, href: h.series.find((s) => s.carril === clase)?.href ?? null } : null;
}
