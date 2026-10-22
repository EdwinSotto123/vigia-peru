import { ImageResponse } from "next/og";
import { imagenFijaEnWindows } from "@/lib/imagen-fija-windows";
import { COLOR, franjaTextilUri, isotipoSvg } from "@/components/sitio/isotipoImagen";
import { SITIO } from "@/lib/compartir";

/**
 * La tarjeta que muestran WhatsApp, Facebook, LinkedIn y X al compartir cualquier página que no
 * tenga la suya (el comprobante de impacto tiene la propia). 1200×630 con la identidad Píxel: fondo
 * carbón, la franja de puntos arriba, la firma y el ojo grande en lima. Sin fuentes externas (la del
 * motor). Runtime Node, como app/icon.tsx: el único que corre también en Cloudflare Workers.
 */

export const alt = "Vigía Perú: en qué se gasta el dinero de tu región";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Texto secundario sobre oscuro: blanco al 75 % (DESIGN_SYSTEM.md §3.8).
const PAPER_75 = "rgba(255,255,255,0.75)";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export default async function Image() {
  const fija = await imagenFijaEnWindows();
  if (fija) return fija;
  const dominio = new URL(SITIO).host;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: COLOR.granateDeep,
          color: COLOR.paper,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={franjaTextilUri(1200, 16)} alt="" width={1200} height={16} style={{ width: 1200, height: 16 }} />

        <div style={{ flex: 1, display: "flex", padding: "48px 72px 56px", gap: 48 }}>
          {/* Lo que es y para qué sirve. */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {isotipoSvg(56)}
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800, letterSpacing: -0.5 }}>
                Vigía<span style={{ color: COLOR.maiz, marginLeft: 10 }}>Perú</span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div style={{ display: "flex", fontSize: 66, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2 }}>
                ¿En qué se gasta el dinero de tu región?
              </div>
              <div style={{ display: "flex", fontSize: 28, lineHeight: 1.35, color: PAPER_75, maxWidth: 700 }}>
                Leemos los contratos del Estado, los cruzamos con registros oficiales y te mostramos cuáles merecen una
                segunda mirada, con la ley y la fuente para comprobarlo.
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 22 }}>
              <span style={{ color: PAPER_75 }}>Sin fines de lucro</span>
              <span style={{ color: PAPER_75 }}>Código abierto</span>
              <span style={{ color: COLOR.maiz, fontFamily: MONO }}>{dominio}</span>
            </div>
          </div>

          {/* El ojo de puntos, grande: la marca, no un dato. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 300 }}>{isotipoSvg(280)}</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
