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
/** «S/ 39.00» (los precios con céntimos: 4.90). Entre «S/» y la cifra va un espacio que no se parte al final de una línea. */
export const soles2 = (n: number) => `S/\u00a0${PEN.format(n)}`;
/** «S/ 39» o «S/ 4.90» (sin céntimos cuando son cero). */
export const precioCorto = (n: number) => (Number.isInteger(n) ? `S/\u00a0${n}` : soles2(n));
/** «3,000». */
export const entero = (n: number) => ENTERO.format(n);

export const LIMITES_GRATIS: Limites = { alertas: 1, frecuencias: ["semanal"], guardados: 30, csv: false, filasCsv: 0, recordatorios: true };

/**
 * Los cobros en pausa (2026-11-24, el usuario: «las suscripciones a Gobserva, frena; por ahora próximamente, como
 * freemium: pueden usar el MCP y demás sólo si se crean cuenta con correo y se autentican»). El mismo interruptor que
 * GOBSERVA_COBROS en la API (backend/api/src/lib/gobservaPlanes.ts): mientras sea true, los planes salen como
 * «próximamente» y los textos dicen que todo viene gratis con una cuenta con el correo confirmado.
 */
export const COBROS_EN_PAUSA = true;

/** Lo que trae hoy, gratis, una cuenta con el correo confirmado (LIMITES_ABIERTO de la API). */
const ABIERTO_PROVEEDOR: Limites = { alertas: 5, frecuencias: ["diaria", "semanal"], guardados: 500, csv: true, filasCsv: 1000, recordatorios: true, mcp: 1500 };
export const LIMITES_ABIERTO: Record<"empleo" | "licitaciones" | "obras", Limites> = {
  empleo: { alertas: 5, frecuencias: ["diaria", "semanal"], guardados: 300, csv: true, filasCsv: 500, recordatorios: true, mcp: 300 },
  licitaciones: ABIERTO_PROVEEDOR,
  obras: ABIERTO_PROVEEDOR,
};
const PRO = (alertas: number, guardados: number, filasCsv: number, mcp: number): Limites => ({
  alertas, frecuencias: ["diaria", "semanal"], guardados, csv: true, filasCsv, recordatorios: true, mcp,
});
/** Los de quien le vende al Estado (Licitaciones; Obras es el mismo plan). */
const PROVEEDOR: PlanCatalogo[] = [
  { id: "inicia", nombre: "Inicia", precio: 99, fundador: { precio: 49, cupo: 50, libres: null }, limites: PRO(3, 300, 500, 1500) },
  { id: "crece", nombre: "Crece", precio: 199, fundador: { precio: 99, cupo: 50, libres: null }, limites: PRO(15, 1000, 2000, 5000) },
  { id: "pro", nombre: "Pro", precio: 349, fundador: { precio: 179, cupo: 50, libres: null }, limites: PRO(50, 3000, 5000, 15000) },
];

/** El catálogo por defecto (el mismo de la API), para cuando la API no responde. */
const RESPALDO: Record<Producto, PlanCatalogo[]> = {
  empleo: [
    { id: "alertas", nombre: "Alertas", precio: 9.9, fundador: { precio: 4.9, meses: 3, libres: null }, limites: PRO(5, 300, 500, 300) },
    { id: "institucional", nombre: "Bolsas de trabajo e institutos", precio: 149, fundador: null, limites: PRO(50, 3000, 2000, 5000) },
  ],
  licitaciones: PROVEEDOR,
  obras: PROVEEDOR,
  // Gobserva Salud es abierto: sin planes.
  salud: [],
  car: [],
};

export interface PlanesServidor {
  /** Los planes en venta. */
  planes: PlanCatalogo[];
  /** Los cobros en pausa: los planes salen como «próximamente» y `abierto` es lo que trae hoy una cuenta verificada. */
  enPausa: boolean;
  abierto: Limites | null;
  /** Lo que trae una cuenta gratis. */
  gratis: Limites;
  /** El aviso del panel («Precio de fundador hasta el 30 de noviembre»). */
  aviso: string | null;
  /** false: los correos todavía no salen y las alertas quedan en la cuenta («Avisos»). */
  correoActivo: boolean;
  /** El RUC del vendedor (null: el recibo es una constancia de pago). */
  ruc: string | null;
  /** `qr`: algún medio por QR o transferencia; `yape` y `plin`, para mostrar sus marcas. */
  medios: { tarjeta: boolean; qr: boolean; yape: boolean; plin: boolean };
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
  const abierto = producto === "empleo" || producto === "licitaciones" || producto === "obras" ? LIMITES_ABIERTO[producto] : null;
  if (!c) {
    return {
      planes: RESPALDO[producto], enPausa: COBROS_EN_PAUSA, abierto, gratis: LIMITES_GRATIS, aviso: null, correoActivo: true, ruc: null,
      medios: { tarjeta: true, qr: true, yape: true, plin: true },
    };
  }
  return {
    planes: c.planes,
    enPausa: c.enPausa ?? COBROS_EN_PAUSA,
    abierto: c.abierto ?? abierto,
    gratis: c.gratis ?? LIMITES_GRATIS,
    aviso: c.aviso,
    correoActivo: c.correoActivo,
    ruc: c.vendedor.ruc,
    medios: { tarjeta: !!c.medios.tarjeta, qr: !!(c.medios.yape || c.medios.plin || c.medios.transferencia), yape: !!c.medios.yape, plin: !!c.medios.plin },
  };
}

/** Lo que va en la tarjeta del plan: el precio de hoy, el de lista tachado y la nota del fundador. */
export function precioDe(p: PlanCatalogo): { precio: string; periodo: string; antes?: string; nota?: string } {
  const f = p.fundador;
  if (!f) return { precio: precioCorto(p.precio), periodo: "al mes" };
  if (f.cupo && f.libres === 0) return { precio: precioCorto(p.precio), periodo: "al mes", nota: `Ya se tomaron los ${f.cupo} lugares de fundador` };
  // El número va pegado a la palabra de antes con un espacio duro: nunca queda solo en la segunda línea.
  const nota = f.meses
    ? f.meses === 1 ? "Precio de fundador el primer mes" : `Precio de fundador los ${f.meses} primeros meses`
    : f.cupo
      ? f.libres == null || f.libres >= f.cupo
        ? `Precio de fundador para los primeros\u00a0${f.cupo}`
        : `Precio de fundador: ${f.libres === 1 ? "queda 1 lugar" : `quedan ${f.libres} lugares`} de\u00a0${f.cupo}`
      : "Precio de fundador";
  return { precio: precioCorto(f.precio), periodo: "al mes", antes: precioCorto(p.precio), nota };
}

/** El precio de hoy en una frase corta, para un botón: «S/ 39 al mes». */
export function precioHoy(p: PlanCatalogo): string {
  const v = precioDe(p);
  return `${v.precio} ${v.periodo}`;
}
