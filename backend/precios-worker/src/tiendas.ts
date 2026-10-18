/**
 * Catálogos de tiendas con plataforma VTEX: la misma búsqueda que hace cada web (`/api/catalog_system/pub/
 * products/search`), sin clave. No es una API ofrecida a terceros: sin garantía de servicio, puede cambiar o
 * cerrarse. Por eso este Worker la usa con cuidado: caché, pocas consultas, User-Agent propio y corte automático
 * de la tienda que empieza a fallar (`estadoTrasFallo`).
 */

export interface Tienda {
  id: string;
  base: string;
  /** false: no vende alimentos, queda fuera de la canasta semanal (solo responde búsquedas). */
  canasta?: boolean;
}

export const TIENDAS: Tienda[] = [
  { id: "promart.pe", base: "https://www.promart.pe" },
  { id: "plazavea.com.pe", base: "https://www.plazavea.com.pe" },
  { id: "oechsle.pe", base: "https://www.oechsle.pe" },
  { id: "metro.pe", base: "https://www.metro.pe" },
  { id: "wong.pe", base: "https://www.wong.pe" },
  { id: "cassinelli.com", base: "https://www.cassinelli.com", canasta: false },   // ferretería y construcción
  { id: "coolbox.pe", base: "https://www.coolbox.pe", canasta: false },           // tecnología y electrodomésticos
];

export const USER_AGENT = "VigiaPeru-Precios/1.0 (+https://vigia-web.vigiaperu.workers.dev; consulta de precios de referencia)";

export interface Producto {
  tienda: string;
  producto: string;
  marca: string | null;
  sku: string | null;
  precio: number;
  precio_lista: number | null;
  unidad_medida: string | null;
  multiplicador: number | null;
  url: string;
}

/** Término comparable: minúsculas, sin tildes ni signos, espacios simples. Es la clave de caché. */
export function normalizarTermino(t: string): string {
  return (t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\d)[.,](\d)/g, "$1.$2")          // "42,5 kg" / "42.5 kg" → "42.5 kg": el decimal es parte del producto
    .replace(/[^a-z0-9ñ. ]+/g, " ")
    .replace(/\.(?!\d)|(?<!\d)\./g, " ")       // los demás puntos fuera
    .replace(/\s+/g, " ")
    .trim();
}

export function urlBusqueda(t: Tienda, termino: string, n: number): string {
  return `${t.base}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(termino)}&_from=0&_to=${Math.max(0, n - 1)}`;
}

/** Respuesta VTEX → productos con precio vigente y stock. Tolerante: lo que no tiene la forma esperada se omite. */
export function normalizarVtex(datos: unknown, t: Tienda): Producto[] {
  if (!Array.isArray(datos)) return [];
  const out: Producto[] = [];
  for (const p of datos as any[]) {
    const item = p?.items?.[0];
    const oferta = item?.sellers?.[0]?.commertialOffer;
    const precio = Number(oferta?.Price);
    if (!item || !oferta || !(precio > 0)) continue;
    if (oferta.AvailableQuantity !== undefined && Number(oferta.AvailableQuantity) <= 0) continue;
    const lista = Number(oferta.ListPrice);
    out.push({
      tienda: t.id,
      producto: String(p.productName ?? "").slice(0, 200),
      marca: p.brand ? String(p.brand) : null,
      sku: item.itemId ? String(item.itemId) : null,
      precio,
      precio_lista: lista > 0 ? lista : null,
      unidad_medida: item.measurementUnit ? String(item.measurementUnit) : null,
      multiplicador: Number(item.unitMultiplier) > 0 ? Number(item.unitMultiplier) : null,
      url: typeof p.link === "string" && p.link ? p.link : `${t.base}/${p.linkText}/p`,
    });
  }
  return out;
}

// ─── corte automático por tienda ──────────────────────────────────────────────
export interface EstadoTienda {
  errores: number;
  bloqueada_hasta: number; // epoch ms; 0 = libre
}

export const LIBRE: EstadoTienda = { errores: 0, bloqueada_hasta: 0 };

export function bloqueada(e: EstadoTienda | null | undefined, ahora: number): boolean {
  return !!e && e.bloqueada_hasta > ahora;
}

/**
 * Tras un fallo (HTTP ≥ 400, timeout, JSON inválido): a partir del 3.º seguido, la tienda queda en pausa
 * 30 min y la pausa se duplica con cada fallo nuevo, hasta 24 h. Un 429 o 403 pausa de inmediato: es la tienda
 * pidiendo que paremos.
 */
export function estadoTrasFallo(e: EstadoTienda | null | undefined, ahora: number, status = 0): EstadoTienda {
  const errores = (e?.errores ?? 0) + 1;
  const inmediato = status === 429 || status === 403;
  if (errores < 3 && !inmediato) return { errores, bloqueada_hasta: 0 };
  const exp = Math.max(0, errores - 3);
  const pausa = Math.min(30 * 60_000 * 2 ** exp, 24 * 3_600_000);
  return { errores, bloqueada_hasta: ahora + pausa };
}

export function estadoTrasExito(): EstadoTienda {
  return { ...LIBRE };
}
