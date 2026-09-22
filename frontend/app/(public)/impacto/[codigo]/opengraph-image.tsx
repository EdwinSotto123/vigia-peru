import { ImageResponse } from "next/og";
import { getComprobante } from "@/lib/financiamiento";

/**
 * Tarjeta compartible (Open Graph) del comprobante de impacto.
 * 1200×630, fondo ink, sin fuentes externas (system-ui) para que corra en edge.
 * Si el API no responde, devuelve una tarjeta genérica en vez de fallar.
 */

export const runtime = "edge";
export const alt = "Comprobante de impacto — Vigía Perú";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#14171A";
const PAPER = "#FFFFFF";
const MUTE = "#9AA3AF";
const AMBER = "#F2C879";
const MOSS = "#9CCB9F";
const RUST = "#E8766A";

const fmt = (n: number) => n.toLocaleString("es-PE");

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
  const conSenales = (senales ?? 0) > 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          color: PAPER,
          padding: "64px 72px",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        {/* cabecera */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 14, height: 14, borderRadius: 999, background: AMBER, display: "flex" }} />
            <div style={{ fontSize: 22, letterSpacing: 4, textTransform: "uppercase", color: MUTE }}>Comprobante de impacto</div>
          </div>
          <div style={{ fontSize: 26, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: MUTE }}>{codigo}</div>
        </div>

        {/* cuerpo */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 30, color: MUTE }}>Auditoría financiada por</div>
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
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, fontSize: 34, marginTop: 6 }}>
            {contratos != null ? (
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 700, fontSize: 40 }}>{fmt(contratos)}</span>
                <span style={{ color: MUTE }}>{contratos === 1 ? "contrato público" : "contratos públicos"}</span>
              </div>
            ) : (
              <span style={{ color: MUTE }}>contratos públicos leídos con independencia</span>
            )}
            {zona && (
              <>
                <span style={{ color: MUTE }}>en</span>
                <span>{zona}</span>
              </>
            )}
          </div>
        </div>

        {/* pie */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 40 }}>
            {senales != null && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 48, fontWeight: 700, color: conSenales ? RUST : MOSS }}>{fmt(senales)}</div>
                <div style={{ fontSize: 20, letterSpacing: 2, textTransform: "uppercase", color: MUTE }}>{senales === 1 ? "señal de riesgo hallada" : "señales de riesgo halladas"}</div>
              </div>
            )}
            {procesados != null && contratos != null && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 48, fontWeight: 700, color: PAPER }}>
                  {fmt(procesados)}<span style={{ color: MUTE, fontSize: 30 }}> / {fmt(contratos)}</span>
                </div>
                <div style={{ fontSize: 20, letterSpacing: 2, textTransform: "uppercase", color: MUTE }}>procesados</div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>Vigía Perú</div>
            <div style={{ fontSize: 22, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: AMBER }}>{codigo}</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
