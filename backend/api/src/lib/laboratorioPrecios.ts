/**
 * Lo que el laboratorio de precios (Worker vigia-precios-lab, service binding PRECIOS_LAB) averiguó de cada renglón de un
 * contrato, en la forma que publica la ficha y el dictamen (GET /contratos/:ocid/precios-mercado).
 *
 * Por renglón: la última investigación, lo que pagó el Estado en este contrato, la mediana y el rango de las ofertas
 * válidas de las tiendas (con su enlace), las referencias del Estado que se le dieron (mismo CUBSO o mismas palabras:
 * procesos, compras menores, catálogo de Perú Compras, otros contratos leídos) y el veredicto. El total suma sólo los
 * renglones comparables (tres o más ofertas válidas, sin sospecha de caja, con su cantidad), y lo pagado de más sólo en los
 * que quedan por encima del mercado: uno barato no tapa a uno caro.
 */

interface Servicio {
  fetch(req: Request): Promise<Response>;
}

export interface ReferenciaEstado {
  fuente: string;
  detalle: string;
  unidad: string | null;
  n: number;
  p25: number | null;
  mediana: number;
  p75: number | null;
}

export interface OfertaTienda {
  tienda: string;
  producto: string;
  marca: string | null;
  precioUnitario: number;
  url: string;
  fuente: string;
}

export interface RenglonMercado {
  item: number;
  producto: string;
  estado: string;
  cantidad: number | null;
  unidad: string | null;
  unidadComparada: string | null;
  pagado: number | null;
  mediana: number | null;
  p25: number | null;
  p75: number | null;
  validas: number;
  razon: number | null;
  veredicto: string | null;
  nota: string | null;
  caja: number | null;
  cuenta: boolean;
  referencias: ReferenciaEstado[];
  ofertas: OfertaTienda[];
  investigado: string | null;
}

export interface PreciosMercado {
  renglones: RenglonMercado[];
  total: { renglones: number; comparados: number; encima: number; pagado: number; mercado: number; exceso: number };
}

/**
 * Fuera la referencia que no puede ser el mismo bien en la misma unidad: 10 veces más cara o más barata que otra de la
 * misma unidad respaldada por 20 compras o más. Leche evaporada «por unidad»: 389 procesos a S/ 4,20 y 3 compras menores
 * a S/ 622 (cajas leídas como una lata).
 */
export function depurarReferencias<T extends { unidad: string | null; n: number; mediana: number }>(refs: T[]): T[] {
  const norma = (u: string | null) => (u ?? "").trim().toLowerCase();
  return refs.filter((r) => !refs.some((o) => o !== r && o.n >= 20 && o.n > r.n && norma(o.unidad) === norma(r.unidad)
    && (r.mediana > o.mediana * 10 || r.mediana < o.mediana / 10)));
}

const ocidCorto = (ocid: string) => ocid.trim().replace(/^OECE-/i, "").replace(/^ocds-dgv273-seacev3-/i, "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const MAX_RENGLONES = 40;

async function pedir<T>(s: Servicio, ruta: string): Promise<T | null> {
  try {
    const r = await s.fetch(new Request(`https://vigia-precios-lab.interno${ruta}`));
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

type Corta = { id: string; estado: string; item: number | null; consulta: string; terminado: string | null; creado: string };
type Detalle = { entrada?: Record<string, unknown>; ficha?: Record<string, unknown>; resumen?: Record<string, unknown>; terminado?: string | null };
type Resultados = { ofertas?: Record<string, unknown>[] };

/** null si esta API no tiene el laboratorio conectado; sin renglones si el contrato no se investigó. */
export async function preciosDeMercado(s: Servicio | undefined, ocid: string): Promise<PreciosMercado | null> {
  if (!s) return null;
  const lista = await pedir<{ investigaciones?: Corta[] }>(s, `/jobs?ocid=${encodeURIComponent(ocidCorto(ocid))}&limite=200`);
  if (!lista) return null;
  // La más reciente de cada renglón (la lista viene de la más nueva a la más vieja); una que falló no tapa a una lista.
  const por = new Map<number, Corta>();
  for (const i of lista.investigaciones ?? []) {
    const k = num(i.item);
    if (k == null) continue;
    const previa = por.get(k);
    if (!previa || (previa.estado === "error" && i.estado !== "error")) por.set(k, i);
  }
  const elegidas = [...por.entries()].sort((a, b) => a[0] - b[0]).slice(0, MAX_RENGLONES);
  const renglones = await Promise.all(elegidas.map(async ([item, inv]): Promise<RenglonMercado> => {
    const listo = inv.estado === "listo";
    const [det, res] = await Promise.all([
      pedir<Detalle>(s, `/jobs/${inv.id}`),
      listo ? pedir<Resultados>(s, `/results/${inv.id}`) : Promise.resolve(null),
    ]);
    const e = det?.entrada ?? {};
    const r = det?.resumen ?? {};
    const pagado = num(e.precioReferencia);
    const cantidad = num(e.cantidad);
    const mediana = num(r.mediana);
    const validas = num(r.validas) ?? 0;
    const razon = num(r.razon);
    const caja = num(r.caja);
    const veredicto = typeof r.veredicto === "string" ? r.veredicto : null;
    const cuenta = listo && !!pagado && !!cantidad && !!mediana && razon != null && validas >= 3 && !caja && !/no concluyente/i.test(veredicto ?? "");
    const ofertas = (res?.ofertas ?? [])
      .filter((o) => o.valida && num(o.precioUnitario) != null && typeof o.url === "string" && /^https?:\/\//.test(o.url as string))
      .slice(0, 8)
      .map((o) => ({
        tienda: String(o.tienda ?? ""), producto: String(o.titulo ?? "").slice(0, 160), marca: (o.marca as string) ?? null,
        precioUnitario: num(o.precioUnitario)!, url: String(o.url), fuente: String(o.fuente ?? ""),
      }));
    const referencias = (Array.isArray(e.referencias) ? e.referencias : []).flatMap((x) => {
      const o = x as Record<string, unknown>;
      const m = num(o.mediana);
      return m ? [{ fuente: String(o.fuente ?? ""), detalle: String(o.detalle ?? ""), unidad: (o.unidad as string) ?? null, n: num(o.n) ?? 0,
        p25: num(o.p25), mediana: m, p75: num(o.p75) }] : [];
    });
    return {
      item, producto: String(e.consulta ?? inv.consulta ?? ""), estado: inv.estado, cantidad, unidad: (e.unidad as string) ?? null,
      unidadComparada: (det?.ficha?.unidad_base as string) ?? null, pagado, mediana, p25: num(r.p25), p75: num(r.p75), validas, razon,
      veredicto, nota: typeof r.nota === "string" ? r.nota : null, caja, cuenta, referencias, ofertas,
      investigado: det?.terminado ?? inv.terminado ?? null,
    };
  }));
  const total = { renglones: renglones.length, comparados: 0, encima: 0, pagado: 0, mercado: 0, exceso: 0 };
  for (const f of renglones) {
    if (!f.cuenta) continue;
    total.comparados++;
    total.pagado += f.pagado! * f.cantidad!;
    total.mercado += f.mediana! * f.cantidad!;
    if ((f.razon ?? 0) >= 1.15) {
      total.encima++;
      total.exceso += (f.pagado! - f.mediana!) * f.cantidad!;
    }
  }
  for (const k of ["pagado", "mercado", "exceso"] as const) total[k] = Math.round(total[k] * 100) / 100;
  return { renglones, total };
}
