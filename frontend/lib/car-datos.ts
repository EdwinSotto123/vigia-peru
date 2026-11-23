/**
 * Las listas del MTC de Gobserva Car (CITV, licencia de conducir, auto a gas). Sólo servidor.
 *
 * Cada lunes la fuente `mtc_car` del worker de scrapers (backend/scrapers-worker/src/fuentes/mtc_car.ts) las baja del MTC y
 * las publica en R2 `vigia-peru-reportes`, en datos/car/<nombre>.json (binding MEDIOS; públicas en medios.gobserva.cloud).
 * La web las lee de ahí, sin volver a desplegar. Las de frontend/data/car son el respaldo: las que usa el build, `next dev`
 * y cualquier pedido en que R2 falle o devuelva algo sin todas sus listas.
 */
import "server-only";
import citv from "@/data/car/citv.json";
import gas from "@/data/car/gas.json";
import licencia from "@/data/car/licencia.json";
import { bindingCloudflare } from "./entorno";

const RESPALDO = { citv, licencia, gas };
export type NombreCar = keyof typeof RESPALDO;
export type DatosCar<N extends NombreCar> = (typeof RESPALDO)[N] & { actualizadoAl?: string };

/** Cuánto guarda cada instancia del worker lo que leyó de R2 (la fuente cambia una vez por semana). */
const VIDA_MS = 15 * 60_000;
const guardadas = new Map<NombreCar, { hasta: number; datos: Promise<unknown> }>();

interface BucketR2 {
  get(clave: string): Promise<{ text(): Promise<string> } | null>;
}

/** Lo leído de R2 sirve si trae, como el respaldo, cada una de sus listas, y ninguna vacía. */
function completo(nombre: NombreCar, d: unknown): boolean {
  if (!d || typeof d !== "object") return false;
  const leido = d as Record<string, unknown>;
  return Object.entries(RESPALDO[nombre]).every(([k, v]) => !Array.isArray(v) || (Array.isArray(leido[k]) && (leido[k] as unknown[]).length > 0));
}

async function leer<N extends NombreCar>(r2: BucketR2, nombre: N): Promise<DatosCar<N>> {
  const o = await r2.get(`datos/car/${nombre}.json`);
  if (!o) return RESPALDO[nombre];
  const d: unknown = JSON.parse(await o.text());
  return completo(nombre, d) ? (d as DatosCar<N>) : RESPALDO[nombre];
}

/** Una lista del MTC: la última que publicó `mtc_car`, o el respaldo. */
export function datosCar<N extends NombreCar>(nombre: N): Promise<DatosCar<N>> {
  const r2 = bindingCloudflare<BucketR2>("MEDIOS");
  if (!r2) return Promise.resolve(RESPALDO[nombre]);
  const g = guardadas.get(nombre);
  if (g && g.hasta > Date.now()) return g.datos as Promise<DatosCar<N>>;
  const datos = leer(r2, nombre).catch(() => RESPALDO[nombre] as DatosCar<N>);
  guardadas.set(nombre, { hasta: Date.now() + VIDA_MS, datos });
  return datos;
}
