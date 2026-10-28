import { ImageResponse } from "next/og";
import { imagenFijaEnWindows } from "@/lib/imagen-fija-windows";
import { getConteosEntidad, getEntidad } from "@/lib/api-client";
import { banderasEntidad } from "@/lib/banderasEntidad";
import { numero, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { TarjetaFicha, type CifraTarjeta } from "@/components/sitio/TarjetaFicha";

/**
 * La tarjeta compartible de una entidad (fase 6 del plan del 2026-10-27): su nombre, dónde está y tres cifras (sus
 * contratos desde 2015, lo que suman sus órdenes y sus banderas). Sin respuesta de la API, la tarjeta con su RUC.
 */
export const alt = "Ficha de una entidad del Estado en Vigía Perú";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { ruc: string } }) {
  const fija = await imagenFijaEnWindows();
  if (fija) return fija;
  const [r, conteos] = await Promise.all([getEntidad(params.ruc).catch(() => null), getConteosEntidad(params.ruc).catch(() => null)]);
  const e = r?.entidad;
  const banderas = r ? banderasEntidad(params.ruc, r.senales, r.informes, r.nepotismo?.total ?? 0) ?? [] : [];
  const cifras: CifraTarjeta[] = [
    e?.contratos != null ? { valor: numero(Number(e.contratos)), etiqueta: "contratos desde 2015" } : null,
    conteos?.ordenesMonto ? { valor: solesCompacto(conteos.ordenesMonto), etiqueta: "en órdenes de compra y servicio" } : null,
    { valor: numero(banderas.length), etiqueta: banderas.length === 1 ? "bandera para revisar" : "banderas para revisar" },
  ].filter((x): x is CifraTarjeta => !!x);
  return new ImageResponse(
    (
      <TarjetaFicha
        etiqueta="Entidad del Estado"
        nombre={e?.nombre ? tituloNatural(String(e.nombre)) : `Entidad con RUC ${params.ruc}`}
        bajada={[e?.region, e?.provincia].filter(Boolean).join(", ") || null}
        cifras={cifras}
        ruta={`vigia/entidad/${params.ruc}`}
      />
    ),
    { ...size },
  );
}
