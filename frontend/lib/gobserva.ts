/**
 * Los productos de pago de Gobserva (2026-11-01): Gobserva Empleo (empleo.gobserva.cloud, las plazas CAS del Estado) y
 * Gobserva Licitaciones (licitaciones.gobserva.cloud, las convocatorias del SEACE con inteligencia de mercado). Viven en
 * esta misma app (app/(gobserva)/<producto>), con marca propia y sin la cabecera ni el menú de Vigía, que sigue gratis.
 *
 * Cada producto se sirve desde su subdominio: el middleware reescribe `empleo.gobserva.cloud/plaza/123` a
 * `/empleo/plaza/123`. En otro host (DEV, o vigia.gobserva.cloud) se llega por la ruta con el prefijo (`/empleo/…`). Por
 * eso los enlaces de un producto se arman con su base: "" en su subdominio y "/empleo" en otro lado (`rutaEn`). En el
 * servidor la base sale del host del pedido (lib/gobserva-servidor.ts); a un componente de cliente se le pasa como prop.
 *
 * Sin JSX ni imports de servidor: lo usan el middleware, las páginas y los componentes de cliente.
 */

export type Producto = "empleo" | "licitaciones";

export interface InfoProducto {
  clave: Producto;
  /** El nombre corto, junto a la marca: «gobserva_ empleo». */
  nombre: string;
  /** El nombre entero, para títulos y metadatos. */
  titulo: string;
  /** Una línea: qué resuelve. */
  lema: string;
  host: string;
  /** El subdominio de prueba (apunta al Worker de DEV). */
  hostDev: string;
}

export const PRODUCTOS: Record<Producto, InfoProducto> = {
  empleo: {
    clave: "empleo",
    nombre: "empleo",
    titulo: "Gobserva Empleo",
    lema: "Todas las plazas CAS del Estado, con sus requisitos claros y lo que nadie te dice.",
    host: "empleo.gobserva.cloud",
    hostDev: "empleo-dev.gobserva.cloud",
  },
  licitaciones: {
    clave: "licitaciones",
    nombre: "licitaciones",
    titulo: "Gobserva Licitaciones",
    lema: "Las oportunidades para venderle al Estado, cada día, con lo que necesitas saber para ganarlas.",
    host: "licitaciones.gobserva.cloud",
    hostDev: "licitaciones-dev.gobserva.cloud",
  },
};

/** Qué producto sirve cada subdominio (producción y DEV). */
export const PRODUCTO_POR_HOST: Record<string, Producto> = Object.fromEntries(
  Object.values(PRODUCTOS).flatMap((p) => [
    [p.host, p.clave],
    [p.hostDev, p.clave],
  ]),
) as Record<string, Producto>;

/** El host sin puerto y en minúsculas. */
export const hostLimpio = (host: string | null | undefined) => (host ?? "").split(":")[0].trim().toLowerCase();

/** La raíz del producto en este host: "" en su subdominio, "/empleo" en otro (DEV, vigia.gobserva.cloud). */
export function baseDe(producto: Producto, host: string | null | undefined): string {
  return PRODUCTO_POR_HOST[hostLimpio(host)] === producto ? "" : `/${producto}`;
}

/** Una ruta del producto con su base: `rutaEn("", "/plaza/1")` → "/plaza/1"; `rutaEn("/empleo", "/")` → "/empleo". */
export function rutaEn(base: string, ruta = "/"): string {
  const r = ruta.startsWith("/") ? ruta : `/${ruta}`;
  if (!base) return r;
  // La raíz y un ancla o consulta de la raíz («/#mcp», «/?q=») van pegadas a la base: «/licitaciones#mcp».
  if (r === "/" || r.startsWith("/#") || r.startsWith("/?")) return `${base}${r.slice(1)}`;
  return `${base}${r}`;
}

/** La URL canónica (producción) de una ruta del producto: «https://empleo.gobserva.cloud/plaza/1». */
export function urlCanonica(producto: Producto, ruta = "/"): string {
  const r = ruta.startsWith("/") ? ruta : `/${ruta}`;
  return `https://${PRODUCTOS[producto].host}${r === "/" ? "" : r}`;
}

/** El otro producto (para el pie y el menú). */
export const otroProducto = (p: Producto): InfoProducto => PRODUCTOS[p === "empleo" ? "licitaciones" : "empleo"];

/** El servidor MCP público de Gobserva (backend/mcp-worker): lo que se pega en Claude, ChatGPT o Cursor. */
export const URL_MCP = "https://vigia-mcp.vigiaperu.workers.dev/mcp";

/** Correo de contacto de Gobserva (correo de IONOS del dominio). */
export const CORREO_GOBSERVA = "hello@gobserva.cloud";
