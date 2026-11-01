import { headers } from "next/headers";
import { baseDe, type Producto } from "@/lib/gobserva";

/**
 * La base de los enlaces de un producto de Gobserva en el servidor, según el host del pedido (lib/gobserva.ts): "" en
 * su subdominio y "/empleo" en otro host. Lee las cabeceras: la página que la usa se arma en cada pedido.
 */
export function baseProducto(producto: Producto): string {
  return baseDe(producto, headers().get("host"));
}
