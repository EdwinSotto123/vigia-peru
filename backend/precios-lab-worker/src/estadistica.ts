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
  // tab» a S/ 0,10, 2026-11-12). Una oferta de varias unidades se puede leer de dos formas: precio del paquete
  // (dividido) o precio por unidad (tal cual). Se busca el grupo de precios donde calzan más ofertas (a menos de 4 veces)
  // y, a igualdad, el más cercano a la mediana; cada oferta se lee como calce en ese grupo. El centro del grupo es
  // siempre la lectura «del paquete» de alguna oferta: si no, el precio de una caja entera (S/ 10 la de 100) armaría
  // su propio grupo con otras cajas y pasaría por precio unitario.
  const lecturas = (o: Oferta) => ((o.unidades ?? 1) > 1 ? [o.precioUnitario!, o.precio!] : [o.precioUnitario!]);
  const validas = marcadas.filter((o) => o.valida);
  const en = (m: number, p: number) => p <= m * 4 && p >= m / 4;
  let grupo = med, calces = -1;
  for (const m of [...new Set(validas.map((o) => o.precioUnitario!))].filter((m) => m > 0)) {
    const c = validas.filter((o) => lecturas(o).some((p) => en(m, p))).length;
    if (c > calces || (c === calces && Math.abs(Math.log(m / med)) < Math.abs(Math.log(grupo / med)))) [grupo, calces] = [m, c];
  }
  const leidas = marcadas.map((o): Oferta => {
    if (!o.valida || en(grupo, o.precioUnitario!)) return o;
    if ((o.unidades ?? 1) > 1 && en(grupo, o.precio!)) return { ...o, precioUnitario: redondo(o.precio!), motivo: "la tienda da el precio por unidad" };
    return o;
  });
  // Y con esa lectura, fuera lo que queda lejísimos de la mediana (más de 4 veces o menos de un cuarto).
  const final = percentil(leidas.filter((o) => o.valida).map((o) => o.precioUnitario!).sort((a, b) => a - b), 0.5)!;
  return leidas.map((o) => (o.valida && !en(final, o.precioUnitario!) ? { ...o, valida: false, motivo: "muy lejos de las demás" } : o));
}

const soles = (n: number) => `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function resumir(ofertas: Oferta[], referencia: number | null, refs: ReferenciaEstado[] = []): Resumen {
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
  };
}
