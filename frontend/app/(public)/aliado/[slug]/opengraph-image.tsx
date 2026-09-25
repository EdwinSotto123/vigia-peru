import { ImageResponse } from "next/og";
import { getPerfilAliado, resumirContribuciones } from "@/components/aliados/perfil";
import { puestoDe } from "@/components/aliados/ranking";
import { COLOR, franjaTextilUri, isotipoSvg } from "@/components/sitio/isotipoImagen";
import { numero } from "@/lib/formato";

/**
 * Tarjeta compartible (Open Graph) del perfil de un aliado: lo que se ve cuando la
 * empresa pega el enlace de su perfil en WhatsApp, LinkedIn o Facebook. 1200×630 con la
 * identidad de Vigía, como la del comprobante (impacto/[codigo]/opengraph-image.tsx):
 * granate profundo, la franja textil arriba, la firma con el isotipo, su nombre, su
 * puesto en el ranking y sus cifras en maíz. Cuenta contratos, nunca soles.
 *
 * Sin fuentes externas y en edge. Sin el logo del aliado: si su archivo no respondiera,
 * la tarjeta entera fallaría; va su inicial en un disco. Si el API no responde, devuelve
 * una tarjeta genérica en vez de fallar.
 */

export const runtime = "edge";
export const alt = "Perfil de un aliado de transparencia de Vigía Perú";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Texto secundario sobre oscuro: paper al 75 % (DESIGN_SYSTEM.md §3.8).
const PAPER_75 = "rgba(255,255,255,0.75)";

export default async function Image({ params }: { params: { slug: string } }) {
  let perfil: Awaited<ReturnType<typeof getPerfilAliado>> = null;
  let puesto: Awaited<ReturnType<typeof puestoDe>> = null;
  try {
    [perfil, puesto] = await Promise.all([getPerfilAliado(params.slug, 300), puestoDe(params.slug)]);
  } catch {
    perfil = null;
    puesto = null;
  }

  const nombre = perfil?.aliado.nombre ?? "Aliado de transparencia";
  const r = perfil ? resumirContribuciones(perfil.contribuciones) : null;
  const inicial = nombre.trim().charAt(0).toUpperCase() || "V";
  const cifras = r
    ? [
        { valor: numero(r.financiados), texto: r.financiados === 1 ? "contrato financiado" : "contratos financiados" },
        { valor: numero(r.leidos), texto: r.leidos === 1 ? "ya leído" : "ya leídos" },
        { valor: numero(r.conSenal), texto: "con señales" },
        { valor: numero(r.regionesDistintas), texto: r.regionesDistintas === 1 ? "región" : "regiones" },
      ]
    : [];

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

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "40px 72px 52px" }}>
          {/* cabecera: la firma y qué es esta tarjeta */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {isotipoSvg(60)}
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800, letterSpacing: -0.5 }}>
                Vigía<span style={{ color: COLOR.maiz, marginLeft: 10 }}>Perú</span>
              </div>
            </div>
            <div style={{ display: "flex", fontSize: 22, letterSpacing: 3, textTransform: "uppercase", color: PAPER_75 }}>
              Aliado de transparencia
            </div>
          </div>

          {/* cuerpo: quién es y su puesto */}
          <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
            <div
              style={{
                width: 148,
                height: 148,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 36,
                background: COLOR.paper,
                color: COLOR.granate,
                fontSize: 84,
                fontWeight: 800,
              }}
            >
              {inicial}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 840 }}>
              <div
                style={{
                  display: "flex",
                  fontSize: nombre.length > 26 ? 56 : 72,
                  fontWeight: 700,
                  lineHeight: 1.05,
                  letterSpacing: -1.5,
                  overflow: "hidden",
                }}
              >
                {nombre}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, fontSize: 30 }}>
                {/* Satori: un solo nodo de texto por elemento (por eso las plantillas de texto), y el
                    `gap` del padre no llega a través del fragmento: el espacio va como margen. */}
                {puesto ? (
                  <>
                    <span style={{ fontWeight: 800, fontSize: 40, color: COLOR.maiz }}>{`#${puesto.puesto}`}</span>
                    <span style={{ color: PAPER_75, marginLeft: 12 }}>{`de ${numero(puesto.de)} ${puesto.de === 1 ? "aliado" : "aliados"} en el ranking`}</span>
                  </>
                ) : (
                  <span style={{ color: PAPER_75 }}>Financia la lectura de contratos públicos</span>
                )}
              </div>
            </div>
          </div>

          {/* pie: sus cifras (contratos, nunca soles) */}
          <div style={{ display: "flex", gap: 64 }}>
            {cifras.map((c) => (
              <div key={c.texto} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", fontSize: 48, fontWeight: 700, color: COLOR.maiz }}>{c.valor}</div>
                <div style={{ display: "flex", fontSize: 22, color: PAPER_75 }}>{c.texto}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
