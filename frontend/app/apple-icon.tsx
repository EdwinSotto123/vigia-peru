import { ImageResponse } from "next/og";
import { COLOR, isotipoSvg } from "@/components/sitio/isotipoImagen";

/**
 * Ícono de la pantalla de inicio en iPhone/iPad (180 × 180): el isotipo sobre
 * papel. iOS no respeta la transparencia (la pinta de negro) y recorta las
 * esquinas en curva, así que el fondo es opaco y el isotipo ocupa el 80 % del
 * lado, dentro de la zona que el recorte no toca.
 *
 * Edge por la misma razón que app/icon.tsx (la versión Node de `next/og` no
 * encuentra su fuente en Windows).
 */

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: COLOR.paper,
        }}
      >
        {isotipoSvg(144)}
      </div>
    ),
    { ...size },
  );
}
