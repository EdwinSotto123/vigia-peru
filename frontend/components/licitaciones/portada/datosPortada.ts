import "server-only";
import { getMenores, getOportunidades, getResumen, type Oportunidad, type PaginaMenores, type Resumen } from "@/lib/licitaciones";

/**
 * Lo que la portada de Gobserva Licitaciones muestra vivo (2026-11-22): el resumen de las convocatorias (la semana y la
 * competencia del último año), la cabecera de los contratos menores abiertos y, para cada rubro del «Pruébalo», cuántas
 * convocatorias se publicaron en los últimos 15 días (el plazo por defecto de /oportunidades), la más reciente y cuántos
 * contratos menores de ese rubro todavía se pueden cotizar. Las mismas consultas que hacen Oportunidades y Contratos
 * menores, en paralelo y con su caché (5 min y 2 min); cada una que falle sólo quita su parte.
 */
export const RUBROS_PORTADA = [
  { etiqueta: "Alimentos", q: "alimentos" },
  { etiqueta: "Combustible", q: "combustible" },
  { etiqueta: "Limpieza", q: "limpieza" },
  { etiqueta: "Vigilancia", q: "seguridad y vigilancia" },
  { etiqueta: "Mantenimiento", q: "mantenimiento" },
] as const;

export interface RubroVivo {
  etiqueta: string;
  q: string;
  /** Convocatorias publicadas en los últimos 15 días que coinciden con el rubro. */
  total: number;
  /** La más reciente de ellas. */
  primera: Oportunidad | null;
  /** Contratos menores de ese rubro que todavía reciben cotizaciones (null si no se pudo saber). */
  menores: number | null;
}

export interface DatosPortada {
  resumen: Resumen | null;
  menores: PaginaMenores["cabecera"] | null;
  rubros: RubroVivo[];
}

export async function datosPortada(): Promise<DatosPortada> {
  const consulta = (q: string) => new URLSearchParams({ q });
  const [resumen, menores, ...porRubro] = await Promise.all([
    getResumen(),
    getMenores(new URLSearchParams()),
    ...RUBROS_PORTADA.map((r) => Promise.all([getOportunidades(consulta(r.q)), getMenores(consulta(r.q))])),
  ]);
  const rubros: RubroVivo[] = [];
  RUBROS_PORTADA.forEach((r, i) => {
    const [op, men] = porRubro[i];
    if (!op || op.total <= 0) return;
    rubros.push({ etiqueta: r.etiqueta, q: r.q, total: op.total, primera: op.data[0] ?? null, menores: men ? men.total : null });
  });
  return { resumen, menores: menores?.cabecera ?? null, rubros };
}
