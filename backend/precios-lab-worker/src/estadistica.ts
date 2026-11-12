/**
 * Validar las ofertas juzgadas y resumirlas (pasos «validar» y «resumir»). Funciones puras (test/estadistica.test.ts).
 *
 * Entra en la estadística una oferta que: coincide (exacta o equivalente), tiene precio en soles y sabemos cuántas
 * unidades base trae. Después se sacan las que están lejísimos de la mediana (más de 4 veces o menos de un cuarto):
 * suelen ser otro producto (un repuesto, un lote de 100) que el juicio no vio.
 */
import type { Oferta, ReferenciaEstado, Resumen } from "./tipos.ts";

export function percentil(ordenados: number[], p: number): number | null {
  if (!ordenados.length) return null;
  const i = (ordenados.length - 1) * p, a = Math.floor(i), b = Math.ceil(i);
  return ordenados[a] + (ordenados[b] - ordenados[a]) * (i - a);
}

const redondo = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

export function validar(ofertas: Oferta[]): Oferta[] {
  const marcadas = ofertas.map((o): Oferta => {
    const base = { ...o, valida: false, precioUnitario: null as number | null };
    if (o.precio == null) return { ...base, motivo: "sin precio" };
    if (o.coincidencia !== "exacta" && o.coincidencia !== "equivalente") return { ...base, motivo: o.coincidencia === "distinta" ? "otro producto" : "sin juicio" };
    if (o.moneda && o.moneda !== "PEN") return { ...base, motivo: `en ${o.moneda}` };
    const u = o.unidades && o.unidades > 0 ? o.unidades : null;
    if (!u) return { ...base, motivo: "no se sabe cuántas unidades trae" };
    if (o.confirmado === false) return { ...base, precioUnitario: redondo(o.precio / u), motivo: "el precio no aparece en la página" };
    return { ...base, precioUnitario: redondo(o.precio / u), valida: true, motivo: null };
  });
  const precios = marcadas.filter((o) => o.valida).map((o) => o.precioUnitario!).sort((a, b) => a - b);
  const med = percentil(precios, 0.5);
  if (med == null || precios.length < 3) return marcadas;
  // Muchas farmacias dan el precio de UNA tableta aunque el nombre diga «x 100» (Novafarma: «Paracetamol 500 mg x 100
  // tab» a S/ 0,10, 2026-11-12). Solo se rescata la oferta que, dividida, queda lejísimos POR DEBAJO de la mediana y
  // cuyo precio tal cual sí calza con ella. Se probó también buscar el «grupo» donde caben más ofertas leyendo cada una
  // de las dos formas, y fallaba: toda oferta de varias unidades gana una segunda lectura más alta y el grupo se corría
  // hacia arriba (un blíster de 10 a S/ 1 pasaba por S/ 1 la tableta).
  // Se repite con la mediana nueva (hasta 3 veces): las mal leídas bajan la mediana y pueden esconder a otras.
  const en = (m: number, p: number) => p <= m * 4 && p >= m / 4;
  const mediana = (os: Oferta[]) => percentil(os.filter((o) => o.valida).map((o) => o.precioUnitario!).sort((a, b) => a - b), 0.5)!;
  let leidas = marcadas;
  for (let vuelta = 0, m = med; vuelta < 3; vuelta++, m = mediana(leidas)) {
    let cambio = false;
    leidas = leidas.map((o): Oferta => {
      if (!(o.valida && o.precioUnitario! < m / 4 && (o.unidades ?? 1) > 1 && en(m, o.precio!))) return o;
      cambio = true;
      return { ...o, precioUnitario: redondo(o.precio!), motivo: "la tienda da el precio por unidad" };
    });
    if (!cambio) break;
  }
  // Y con esa lectura, fuera lo que queda lejísimos de la mediana (más de 4 veces o menos de un cuarto).
  const final = mediana(leidas);
  return leidas.map((o) => (o.valida && !en(final, o.precioUnitario!) ? { ...o, valida: false, motivo: "muy lejos de las demás" } : o));
}

const soles = (n: number) => `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function resumir(ofertas: Oferta[], referencia: number | null, refs: ReferenciaEstado[] = [], sinComparar: string | null = null): Resumen {
  const validas = ofertas.filter((o) => o.valida);
  const precios = validas.map((o) => o.precioUnitario!).sort((a, b) => a - b);
  const porFuente: Record<string, number> = {};
  for (const o of validas) porFuente[o.fuente] = (porFuente[o.fuente] ?? 0) + 1;
  const mediana = percentil(precios, 0.5);
  const razon = referencia && mediana ? Math.round((referencia / mediana) * 100) / 100 : null;
  let veredicto = "Sin con qué comparar";
  let nota = "";
  if (precios.length === 0) {
    veredicto = "No se encontraron ofertas del mismo producto";
    nota = "Prueba con otras palabras o una especificación más corta.";
  } else if (precios.length < 3) {
    veredicto = "Pocas ofertas, no concluyente";
    nota = `Solo ${precios.length === 1 ? "una oferta coincide" : "dos ofertas coinciden"} con el producto.`;
  } else if (razon == null) {
    veredicto = "Precio de mercado encontrado";
    nota = `La mitad de las ${precios.length} ofertas cuesta menos de ${soles(mediana!)} por unidad.`;
  } else {
    veredicto =
      razon >= 1.5 ? "Muy por encima del mercado" : razon >= 1.15 ? "Por encima del mercado" : razon > 0.85 ? "En línea con el mercado" : "Por debajo del mercado";
    nota = `La referencia (${soles(referencia!)}) es ${razon.toLocaleString("es-PE")} veces la mediana de ${precios.length} ofertas (${soles(mediana!)}).`;
  }
  if (sinComparar && precios.length >= 3) nota += ` No se compara con lo que pagó el Estado: ${sinComparar.replace(/\.$/, "")}.`;
  const caja = precios.length >= 3 ? cajaProbable(razon) : null;
  if (caja) nota += ` Ojo: es casi ${caja} veces la mediana; puede que la entidad compre por caja o paquete de ${caja} y lo llame «unidad». Revisa las bases antes de concluir.`;
  const estado = refs.length ? refs.reduce((m, r) => (r.n > m.n ? r : m), refs[0]) : null;
  if (estado && mediana) {
    nota += ` El Estado pagó una mediana de ${soles(estado.mediana)} (${estado.detalle}).`;
  }
  return {
    n: ofertas.length,
    validas: precios.length,
    minimo: redondo(precios[0] ?? null),
    p25: redondo(percentil(precios, 0.25)),
    mediana: redondo(mediana),
    p75: redondo(percentil(precios, 0.75)),
    maximo: redondo(precios[precios.length - 1] ?? null),
    porFuente,
    referencia,
    razon,
    veredicto,
    nota: nota.trim(),
    caja,
    sinComparar,
  };
}

/** Tamaños de caja o paquete comunes en las compras del Estado (blísteres, cajas de leche, millares…). */
const CAJAS = [6, 10, 12, 20, 24, 25, 30, 36, 40, 48, 50, 60, 100];

/**
 * Las entidades a veces llaman «unidad» a una caja: leche evaporada «x 400 g» a S/ 36 la unidad (2026-754-1) es una caja
 * de 24 latas a S/ 1,50 cada una, o una compra cara. Si la referencia es casi N veces la mediana (±10 %), con N un tamaño de
 * caja común, se avisa. No cambia el veredicto: lo resuelve quien lee las bases.
 */
export function cajaProbable(razon: number | null): number | null {
  if (razon == null || razon < 5) return null;
  const cerca = CAJAS.map((k) => ({ k, d: Math.abs(razon / k - 1) })).sort((a, b) => a.d - b.d)[0];
  return cerca.d <= 0.1 ? cerca.k : null;
}
