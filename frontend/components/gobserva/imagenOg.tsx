import { ImageResponse } from "next/og";
import { imagenFijaEnWindows } from "@/lib/imagen-fija-windows";
import { COLOR_PRODUCTO } from "@/lib/colores-producto";
import { PRODUCTOS, type Producto } from "@/lib/gobserva";

/**
 * La imagen para compartir (Open Graph) de un producto de Gobserva: carbón con el color del producto (lib/colores-producto.ts,
 * el de noche), la lupa, «gobserva_ <producto>», su titular y su dominio. Antes heredaban la de Vigía; hasta 2026-11-21,
 * todas en lima. Colores fijos: una imagen no tiene modo día ni noche.
 */
const CARBON = "#070A0A";
const BLANCO = "#FFFFFF";
const BLANCO_75 = "rgba(255,255,255,0.75)";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export const TAMANO_OG = { width: 1200, height: 630 };

/** Las dos últimas palabras juntas (espacio duro): ninguna línea termina con una palabra sola, como «día». */
const sinViuda = (t: string) => t.replace(/\s+(\S+)\s*$/, "\u00a0$1");

export async function imagenOg(producto: Producto, titular: string, detalle: string): Promise<Response> {
  const fija = await imagenFijaEnWindows();
  if (fija) return fija;
  const p = PRODUCTOS[producto];
  const LIMA = COLOR_PRODUCTO[producto].noche;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: CARBON, color: BLANCO, padding: "64px 72px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width={64} height={64} viewBox="0 0 32 32">
            <circle cx="13.5" cy="13.5" r="9" fill="none" stroke={LIMA} strokeWidth="3" />
            <line x1="20.5" y1="20.5" x2="28" y2="28" stroke={LIMA} strokeWidth="3.6" strokeLinecap="round" />
            <circle cx="10" cy="11" r="1.7" fill={BLANCO} />
            <circle cx="16.5" cy="10" r="1.5" fill={BLANCO} />
            <circle cx="13.5" cy="16.5" r="1.6" fill={BLANCO} />
          </svg>
          <div style={{ display: "flex", alignItems: "baseline", fontFamily: MONO, fontSize: 52, fontWeight: 700, letterSpacing: -2 }}>
            gobserva<span style={{ color: LIMA }}>_</span>
          </div>
          <div style={{ display: "flex", marginLeft: 8, padding: "6px 16px", borderRadius: 12, border: `2px solid ${LIMA}`, color: LIMA, fontFamily: MONO, fontSize: 30, fontWeight: 700 }}>
            {p.nombre}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5, maxWidth: 1000 }}>{sinViuda(titular)}</div>
          <div style={{ display: "flex", fontSize: 30, lineHeight: 1.3, color: BLANCO_75, maxWidth: 980 }}>{sinViuda(detalle)}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: MONO, fontSize: 26, color: BLANCO_75 }}>
          <span style={{ display: "flex", color: LIMA }}>{p.host}</span>
          <span style={{ display: "flex" }}>Lo de todos, a la vista de todos.</span>
        </div>
      </div>
    ),
    TAMANO_OG,
  );
}
