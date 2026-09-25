import { ImageResponse } from "next/og";
import { getComprobante } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { COLOR, franjaTextilUri, isotipoSvg } from "@/components/sitio/isotipoImagen";

/**
 * Tarjeta compartible (Open Graph) del comprobante de impacto.
 * 1200×630 con la identidad de Vigía (DESIGN_SYSTEM.md §2, §3.8 y §6): fondo
 * granate profundo —un momento de marca, no de dato—, la franja textil arriba,
 * la firma con el isotipo y las cifras en maíz, que es lo que brilla sobre oscuro.
 * Sin fuentes externas (la tipografía del motor) para que corra en edge.
 * Si el API no responde, devuelve una tarjeta genérica en vez de fallar.
 */

export const runtime = "edge";
export const alt = "Comprobante de impacto de Vigía Perú";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Texto secundario sobre oscuro: paper al 75 % (DESIGN_SYSTEM.md §3.8).
const PAPER_75 = "rgba(255,255,255,0.75)";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export default async function Image({ params }: { params: { codigo: string } }) {
  const codigo = params.codigo.toUpperCase();
  let c: Awaited<ReturnType<typeof getComprobante>> = null;
  try {
    c = await getComprobante(codigo);
  } catch {
    c = null;
  }

  const financiador = c?.financiador ?? "un aliado de transparencia";
  const contratos = c?.contratos ?? null;
  const zona = c?.zona ?? null;
  const senales = c?.resumen.senales ?? null;
  const procesados = c?.resumen.procesados ?? null;

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
        {/* La firma del sitio: la franja textil de borde a borde. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={franjaTextilUri(1200, 16)} alt="" width={1200} height={16} style={{ width: 1200, height: 16 }} />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "44px 72px 56px",
          }}
        >
          {/* cabecera: la firma y qué es esta tarjeta */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {isotipoSvg(64)}
              <div style={{ display: "flex", fontSize: 34, fontWeight: 800, letterSpacing: -0.5 }}>
                Vigía<span style={{ color: COLOR.maiz, marginLeft: 10 }}>Perú</span>
              </div>
            </div>
            <div style={{ display: "flex", fontSize: 22, letterSpacing: 3, textTransform: "uppercase", color: PAPER_75 }}>
              Comprobante de impacto
            </div>
          </div>

          {/* cuerpo: quién financió y qué */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", fontSize: 30, color: PAPER_75 }}>Auditoría financiada por</div>
            <div
              style={{
                fontSize: financiador.length > 28 ? 56 : 72,
                fontWeight: 700,
                lineHeight: 1.05,
                letterSpacing: -1.5,
                maxWidth: 1056,
                overflow: "hidden",
                display: "flex",
              }}
            >
              {financiador}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10, fontSize: 32, marginTop: 4 }}>
              {contratos != null ? (
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 38 }}>{numero(contratos)}</span>
                  <span style={{ color: PAPER_75 }}>{contratos === 1 ? "contrato público" : "contratos públicos"}</span>
                </div>
              ) : (
                <span style={{ color: PAPER_75 }}>contratos públicos leídos con independencia</span>
              )}
              {zona && (
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ color: PAPER_75 }}>en</span>
                  <span>{zona}</span>
                </div>
              )}
            </div>
          </div>

          {/* pie: las cifras, con su denominador, y el código del aporte */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 56 }}>
              {procesados != null && contratos != null && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, fontSize: 48, fontWeight: 700, color: COLOR.maiz }}>
                    {numero(procesados)}
                    <span style={{ fontSize: 30, color: PAPER_75 }}>de {numero(contratos)}</span>
                  </div>
                  <div style={{ display: "flex", fontSize: 22, color: PAPER_75 }}>contratos leídos</div>
                </div>
              )}
              {senales != null && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", fontSize: 48, fontWeight: 700, color: COLOR.maiz }}>{numero(senales)}</div>
                  <div style={{ display: "flex", fontSize: 22, color: PAPER_75 }}>
                    {senales === 1 ? "señal hallada" : "señales halladas"}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", fontSize: 26, fontFamily: MONO, color: COLOR.maiz }}>{codigo}</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
