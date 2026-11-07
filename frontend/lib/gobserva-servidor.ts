import { cookies, headers } from "next/headers";
import { COOKIE_SESION, PRODUCTOS_CON_APP, baseDe, type Producto } from "@/lib/gobserva";

/**
 * La base de los enlaces de un producto de Gobserva en el servidor, según el host del pedido (lib/gobserva.ts): "" en
 * su subdominio y "/empleo" en otro host. Lee las cabeceras: la página que la usa se arma en cada pedido.
 */
export function baseProducto(producto: Producto): string {
  return baseDe(producto, headers().get("host"));
}

/**
 * Si la página se arma dentro de la app (MarcoApp: con la marca de sesión y un producto con app). La misma regla que
 * MarcoProducto, para que una página ajuste lo suyo (sin el cartel de venta, con el ancho de la app).
 */
export function enLaApp(producto: Producto): boolean {
  return PRODUCTOS_CON_APP.includes(producto) && cookies().get(COOKIE_SESION)?.value === "1";
}
