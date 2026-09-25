import { ImageResponse } from "next/og";
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
 * Edge, como la tarjeta Open Graph del comprobante: la versión Node de `next/og`
 * arma la ruta de su fuente con `path.join(import.meta.url, …)` y en Windows eso
 * da una URL inválida ("Invalid URL … noto-sans-v27-latin-regular.ttf"): en un
 * build hecho en Windows el ícono no se podría prerenderizar.
 */

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {isotipoSvg(32)}
      </div>
    ),
    { ...size },
  );
}
