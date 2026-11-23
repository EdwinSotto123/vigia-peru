import type { Metadata } from "next";
import { MapaSalud, type FiltrosMapaCliente } from "@/components/salud/mapa/MapaSalud";
import { filtrosDeUrl } from "@/components/salud/lista/filtros";
import { Encabezado, Ruta } from "@/components/salud/portada/Piezas";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { getResumenSalud } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";

export const dynamic = "force-dynamic";

type Props = { searchParams?: Record<string, string | string[] | undefined> };

export function generateMetadata({ searchParams }: Props): Metadata {
  const f = filtrosDeUrl(searchParams);
  return {
    title: "Mapa de establecimientos de salud",
    description:
      "Los establecimientos de salud del Perú registrados en RENIPRESS en un mapa: públicos, privados y los que tienen sanciones firmes de SUSALUD. Filtra por departamento, categoría y sector.",
    alternates: { canonical: urlCanonica("salud", "/mapa") },
    robots: Object.values(f).some((v) => v != null) ? { index: false, follow: true } : undefined,
  };
}

/**
 * /mapa de Gobserva Salud (2026-11-20): el encabezado y el mapa (components/salud/mapa/MapaSalud.tsx, de cliente: pide los
 * puntos a /v1/salud/mapa con los filtros, que viajan en la URL). El servidor sólo pasa datos planos: los filtros de la
 * URL, las fechas de las fuentes y la cobertura del detalle (GET /salud/resumen).
 */
export default async function MapaPagina({ searchParams }: Props) {
  const base = baseProducto("salud");
  const f = filtrosDeUrl(searchParams);
  const r = await getResumenSalud();
  const inicial: FiltrosMapaCliente = {
    departamento: f.departamento ?? "",
    sector: f.sector ?? "",
    categoria: f.categoria ?? "",
    sanciones: f.sanciones === "con",
    quirurgico: f.quirurgico === "si",
    todos: f.estado === "todos",
  };
  return (
    <div className="container-page pb-10 pt-5 sm:pb-14 sm:pt-6">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/inicio") }, { etiqueta: "Mapa" }]} />
      <Encabezado figura="alfiler"
        className="mt-2"
        titulo="Mapa de establecimientos de salud"
        bajada="Cada punto es un establecimiento con ubicación en RENIPRESS, del color de su sector. Los que tienen una sanción firme de SUSALUD llevan un anillo rojo."
      />
      <div className="mt-5">
        <MapaSalud
          base={base}
          inicial={inicial}
          renipressAl={r?.fuentes.renipressAl ?? null}
          sancionesAl={r?.fuentes.sancionesAl ?? null}
          cobertura={r ? { leidas: r.fuentes.detalle.leidas, total: r.fuentes.detalle.total } : null}
        />
      </div>
    </div>
  );
}
