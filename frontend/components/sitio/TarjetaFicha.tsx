import { COLOR, franjaTextilUri, isotipoSvg } from "@/components/sitio/isotipoImagen";

/**
 * La tarjeta compartible (Open Graph, 1200×630) de una ficha: entidad o empresa (fase 6 del plan del 2026-10-27). La
 * identidad de Vigía como la del comprobante de impacto: fondo carbón, la franja textil, la firma, el nombre grande y hasta
 * tres cifras en lima, y abajo la ruta y «indicios para revisar». Para `ImageResponse` (next/og): sólo estilos en línea y
 * `display: flex` en cada caja; sin fuentes externas.
 */
const PAPER_75 = "rgba(255,255,255,0.75)";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export interface CifraTarjeta {
  valor: string;
  etiqueta: string;
}

export function TarjetaFicha({ etiqueta, nombre, bajada, cifras, ruta }: { etiqueta: string; nombre: string; bajada: string | null; cifras: CifraTarjeta[]; ruta: string }) {
  const largo = nombre.length;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: COLOR.granateDeep, color: COLOR.paper, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={franjaTextilUri(1200, 16)} alt="" width={1200} height={16} style={{ width: 1200, height: 16 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "44px 72px 52px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {isotipoSvg(56)}
            <div style={{ display: "flex", fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>
              Vigía<span style={{ color: COLOR.maiz, marginLeft: 10 }}>Perú</span>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 20, letterSpacing: 3, textTransform: "uppercase", color: PAPER_75 }}>{etiqueta}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", fontSize: largo > 70 ? 44 : largo > 40 ? 54 : 66, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.2, maxWidth: 1056 }}>
            {largo > 120 ? `${nombre.slice(0, 117)}…` : nombre}
          </div>
          {bajada && <div style={{ display: "flex", fontSize: 26, color: PAPER_75 }}>{bajada}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 52 }}>
            {/* recorte: una tarjeta de 1200 px lleva a lo sumo tres cifras; la ficha tiene todas. */}
            {cifras.slice(0, 3).map((c) => (
              <div key={c.etiqueta} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", fontSize: 46, fontWeight: 700, color: COLOR.maiz }}>{c.valor}</div>
                <div style={{ display: "flex", fontSize: 21, color: PAPER_75, maxWidth: 300 }}>{c.etiqueta}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ display: "flex", fontSize: 22, fontFamily: MONO, color: COLOR.maiz }}>{ruta}</div>
            <div style={{ display: "flex", fontSize: 18, color: PAPER_75 }}>Indicios para revisar, no acusaciones</div>
          </div>
        </div>
      </div>
    </div>
  );
}
