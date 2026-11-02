/**
 * Los precios de los planes de Gobserva para las páginas (2026-11-01): el catálogo de la API (/gobserva/planes: precio de
 * hoy, fundador con sus lugares libres, límites de cada plan) y, si la API no responde, el catálogo por defecto de
 * backend/api/src/lib/gobservaPlanes.ts, para que la página nunca quede sin precios. Lo que se cobra lo calcula siempre la
 * API al contratar; esto sólo lo muestra.
 */
import { API_BASE } from "@/lib/api-client";
import type { Producto } from "@/lib/gobserva";
import type { Catalogo, Limites, PlanCatalogo } from "@/lib/gobserva-cuenta";

const PEN = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ENTERO = new Intl.NumberFormat("es-PE");
/** «S/ 39.00» (los precios con céntimos: 4.90). */
export const soles2 = (n: number) => `S/ ${PEN.format(n)}`;
/** «S/ 39» o «S/ 4.90» (sin céntimos cuando son cero). */
export const precioCorto = (n: number) => (Number.isInteger(n) ? `S/ ${n}` : soles2(n));
/** «3,000». */
export const entero = (n: number) => ENTERO.format(n);

export const LIMITES_GRATIS: Limites = { alertas: 1, frecuencias: ["semanal"], guardados: 30, csv: false, filasCsv: 0, recordatorios: true };
const PRO = (alertas: number, guardados: number, filasCsv: number): Limites => ({
  alertas, frecuencias: ["diaria", "semanal"], guardados, csv: true, filasCsv, recordatorios: true,
});

/** El catálogo por defecto (el mismo de la API), para cuando la API no responde. */
const RESPALDO: Record<Producto, PlanCatalogo[]> = {
  empleo: [
    { id: "alertas", nombre: "Alertas", precio: 9.9, fundador: { precio: 4.9, meses: 3, libres: null }, limites: PRO(5, 300, 500) },
    { id: "institucional", nombre: "Bolsas de trabajo e institutos", precio: 149, fundador: null, limites: PRO(50, 3000, 2000) },
  ],
  licitaciones: [
    { id: "pro", nombre: "Pro", precio: 79, fundador: { precio: 39, cupo: 50, libres: null }, limites: PRO(10, 500, 1000) },
    { id: "empresa", nombre: "Empresa", precio: 149, fundador: null, limites: PRO(50, 3000, 3000) },
  ],
  obras: [
    { id: "pro", nombre: "Pro", precio: 99, fundador: { precio: 49, cupo: 50, libres: null }, limites: PRO(10, 500, 1000) },
    { id: "empresa", nombre: "Empresa", precio: 199, fundador: null, limites: PRO(50, 3000, 3000) },
  ],
};

export interface PlanesServidor {
  /** Los planes en venta. */
  planes: PlanCatalogo[];
  /** Lo que trae una cuenta gratis. */
  gratis: Limites;
  /** El aviso del panel («Precio de fundador hasta el 30 de noviembre»). */
  aviso: string | null;
  /** false: los correos todavía no salen y las alertas quedan en la cuenta («Avisos»). */
  correoActivo: boolean;
  /** El RUC del vendedor (null: el recibo es una constancia de pago). */
  ruc: string | null;
  medios: { tarjeta: boolean; qr: boolean };
}

/** Los planes de un producto en el servidor (60 s de caché, como la API). */
export async function planesServidor(producto: Producto): Promise<PlanesServidor> {
  let c: Catalogo | null = null;
  try {
    const r = await fetch(`${API_BASE}/gobserva/planes?producto=${producto}`, { next: { revalidate: 60 } } as RequestInit);
    if (r.ok) c = (await r.json()) as Catalogo;
  } catch {
    // Sale con el catálogo por defecto.
  }
  if (!c) return { planes: RESPALDO[producto], gratis: LIMITES_GRATIS, aviso: null, correoActivo: true, ruc: null, medios: { tarjeta: true, qr: true } };
  return {
    planes: c.planes,
    gratis: c.gratis ?? LIMITES_GRATIS,
    aviso: c.aviso,
    correoActivo: c.correoActivo,
    ruc: c.vendedor.ruc,
    medios: { tarjeta: !!c.medios.tarjeta, qr: !!(c.medios.yape || c.medios.plin || c.medios.transferencia) },
  };
}

/** Lo que va en la tarjeta del plan: el precio de hoy, el de lista tachado y la nota del fundador. */
export function precioDe(p: PlanCatalogo): { precio: string; periodo: string; antes?: string; nota?: string } {
  const f = p.fundador;
  if (!f) return { precio: precioCorto(p.precio), periodo: "al mes" };
  if (f.cupo && f.libres === 0) return { precio: precioCorto(p.precio), periodo: "al mes", nota: `Ya se tomaron los ${f.cupo} lugares de fundador` };
  const nota = f.meses
    ? f.meses === 1 ? "Precio de fundador el primer mes" : `Precio de fundador los ${f.meses} primeros meses`
    : f.cupo
      ? f.libres == null || f.libres >= f.cupo ? `Precio de fundador para los primeros ${f.cupo}` : `Precio de fundador: ${f.libres === 1 ? "queda 1 lugar" : `quedan ${f.libres} lugares`} de ${f.cupo}`
      : "Precio de fundador";
  return { precio: precioCorto(f.precio), periodo: "al mes", antes: precioCorto(p.precio), nota };
}

/** El precio de hoy en una frase corta, para un botón: «S/ 39 al mes». */
export function precioHoy(p: PlanCatalogo): string {
  const v = precioDe(p);
  return `${v.precio} ${v.periodo}`;
}
