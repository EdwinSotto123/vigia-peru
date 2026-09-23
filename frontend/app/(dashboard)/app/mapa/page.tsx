import type { Metadata } from "next";
import { MapaWrapper } from "@/components/MapaWrapper";
import type { ZonaTab } from "@/components/mapa/ZonaHubPanel";

/** Sólo la parte de la página: el layout raíz le agrega " | Vigía Perú". */
export const metadata: Metadata = { title: "Mapa" };

const TABS: ZonaTab[] = ["resumen", "cola", "entidades", "alertas", "denuncias", "presupuesto"];

/**
 * Hub público: el mapa es la interfaz. Elegir un departamento abre su cola de
 * auditoría, entidades, señales y denuncias, con las acciones financiar/denunciar.
 * Acepta `?region=<regionId>`, `?tab=<…>`, `?ubigeo=<provincia|distrito>` y `?ocid=`.
 *
 * El `PageHeader` vive dentro de `MapaWrapper` y no acá: el encabezado tiene que
 * reflejar el estado. Un h1 fijo que sigue diciendo "Elige tu región" después de
 * que el usuario eligió una es un encabezado que miente sobre dónde está.
 */
export default function MapaPage({
  searchParams,
}: {
  searchParams?: { region?: string; tab?: string };
}) {
  const region = searchParams?.region?.toLowerCase() ?? null;
  const tab = TABS.includes(searchParams?.tab as ZonaTab) ? (searchParams?.tab as ZonaTab) : undefined;

  // Suelo teñido. Antes la página era blanca y el bloque del mapa gris: el
  // contenido quedaba MÁS OSCURO que su fondo mientras proyectaba una sombra de
  // elevación — el tono decía hundido y la sombra decía arriba. Con esa
  // contradicción, el borde de 1px era lo único que definía el bloque, y por eso
  // se notaba tanto. Ahora el suelo es el tono hundido y el bloque es blanco: la
  // jerarquía la carga la superficie, no una línea.
  return (
    <div className="min-h-screen space-y-6 bg-paperDeep px-4 py-5 sm:px-6 sm:py-8 lg:px-10">
      <MapaWrapper initialRegionId={region} initialTab={tab} />
    </div>
  );
}
