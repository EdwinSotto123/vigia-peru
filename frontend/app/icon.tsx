import { ImageResponse } from "next/og";
import { imagenFijaEnWindows } from "@/lib/imagen-fija-windows";
import { isotipoSvg } from "@/components/sitio/isotipoImagen";

/**
 * Favicon (DESIGN_SYSTEM.md §2.2): el isotipo —disco granate, llama blanca,
 * anillo tejido y mango de lupa— dibujado en vector y rasterizado por Next al
 * compilar. Reemplaza al icon.png recortado del logo: ahora es el mismo dibujo
 * que la cabecera, y un cambio en la marca llega solo a la pestaña.
 *
 * 32 px: por encima del mínimo de 24 px del isotipo (por debajo el anillo se
 * vuelve ruido). Fondo transparente: la pestaña pone el suyo.
 *
 * Runtime Node (el de Cloud Run y el único que corre la réplica en Cloudflare
 * Workers; ver CLOUDFLARE.md) y dinámico, como cuando era edge: la versión Node
 * de `next/og` arma la ruta de su fuente con `path.join(import.meta.url, …)` y en
 * Windows eso da una URL inválida ("Invalid URL … noto-sans-v27-latin-regular.ttf"),
 * así que un build hecho en Windows no podría prerenderizarlo. En Linux (Cloud
 * Run, Workers) se dibuja bien; con `next dev` en Windows se sirve el logo fijo (lib/imagen-fija-windows.ts).
 */

export const dynamic = "force-dynamic";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
  const fija = await imagenFijaEnWindows();
  if (fija) return fija;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {isotipoSvg(32)}
      </div>
    ),
    { ...size },
  );
}
