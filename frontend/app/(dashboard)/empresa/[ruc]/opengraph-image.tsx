import { ImageResponse } from "next/og";
import { imagenFijaEnWindows } from "@/lib/imagen-fija-windows";
import { getFichaEmpresa } from "@/lib/empresas";
import { numero, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { TarjetaFicha, type CifraTarjeta } from "@/components/sitio/TarjetaFicha";

/**
 * La tarjeta compartible de una empresa (fase 6 del plan del 2026-10-27): su nombre, a cuántas entidades le vende y tres
 * cifras (lo que ganó en procesos, lo que le ordenaron y sus antecedentes graves). Sólo empresas (RUC 20): una persona
 * natural no tiene ficha de empresa ni tarjeta.
 */
export const alt = "Ficha de una empresa proveedora del Estado en Vigía Perú";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { ruc: string } }) {
  const fija = await imagenFijaEnWindows();
  if (fija) return fija;
  const f = await getFichaEmpresa(params.ruc).catch(() => null);
  const e = f?.empresa;
  const cifras: CifraTarjeta[] = e
    ? [
        { valor: solesCompacto(e.adjMonto), etiqueta: `ganados en ${numero(e.adjProcesos)} ${e.adjProcesos === 1 ? "proceso" : "procesos"}` },
        e.ordMonto ? { valor: solesCompacto(e.ordMonto), etiqueta: `en ${numero(e.ordN)} ${e.ordN === 1 ? "orden" : "órdenes"}` } : null,
        { valor: numero(e.nAlta), etiqueta: e.nAlta === 1 ? "antecedente grave" : "antecedentes graves" },
      ].filter((x): x is CifraTarjeta => !!x)
    : [];
  return new ImageResponse(
    (
      <TarjetaFicha
        etiqueta="Empresa proveedora"
        nombre={e?.nombre ? tituloNatural(e.nombre) : `Empresa con RUC ${params.ruc}`}
        bajada={e ? `Le vende a ${numero(e.entidades)} ${e.entidades === 1 ? "entidad" : "entidades"} del Estado` : null}
        cifras={cifras}
        ruta={`vigia/empresa/${params.ruc}`}
      />
    ),
    { ...size },
  );
}
