import type { Metadata } from "next";
import { MapaWrapper } from "@/components/MapaWrapper";
import { Pagina } from "@/components/patrones";
import type { ZonaTab } from "@/components/mapa/ZonaHubPanel";

/** Sólo la parte de la página: el layout raíz le agrega " | Vigía Perú". */
export const metadata: Metadata = { title: "Mapa" };

const TABS: ZonaTab[] = ["resumen", "cola", "entidades", "alertas", "denuncias", "presupuesto"];

/**
 * Hub público: el mapa es la interfaz. Elegir un departamento abre su cola de
 * auditoría, entidades, señales y denuncias, con las acciones financiar/denunciar.
 * Acepta `?region=<regionId>`, `?tab=<…>`, `?ubigeo=<provincia|distrito>` y `?ocid=`.
 *
 * Plantilla Tablero (DESIGN_SYSTEM.md §14): EncabezadoPagina → Indicadores del estado actual →
 * el mapa (la pieza viva) → lo ya hecho (los contratos de mayor peso del riesgo).
 *
 * El encabezado (`EncabezadoPagina`, el único h1) y los `Indicadores` viven dentro de
 * `MapaWrapper` y no acá: tienen que reflejar el estado (región y mes elegidos). Un h1
 * fijo que sigue diciendo "Elige tu región" después de que el usuario eligió una es un
 * encabezado que miente sobre dónde está.
 */
export default function MapaPage({
  searchParams,
}: {
  searchParams?: { region?: string; tab?: string };
}) {
  const region = searchParams?.region?.toLowerCase() ?? null;
  const tab = TABS.includes(searchParams?.tab as ZonaTab) ? (searchParams?.tab as ZonaTab) : undefined;

  // Suelo apenas teñido (paperSoft) y el bloque del mapa blanco con borde: la
  // jerarquía la carga la superficie, sin sombra en reposo (DESIGN_SYSTEM.md §5).
  // El suelo ocupa todo el ancho; el contenido, el contenedor común (`Pagina`, §10.7).
  return (
    <div className="min-h-screen bg-paperSoft">
      <Pagina>
        <MapaWrapper initialRegionId={region} initialTab={tab} />
      </Pagina>
    </div>
  );
}
