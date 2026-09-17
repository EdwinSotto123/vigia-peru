import { FileSearch } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { ContratosLista } from "@/components/contratos/ContratosLista";
import { FiltrosContratos } from "@/components/contratos/FiltrosContratos";
import { getEntidad } from "@/lib/api-client";
import { getContratos, getResumenContratos, parseContratosQuery } from "@/lib/contratos";
import { getZonas } from "@/lib/financiamiento";

export const metadata = {
  title: "Contratos — Vigía Perú",
  description: "Todos los contratos públicos del SEACE ingeridos por Vigía, con su tipo, etapa, zona y estado de análisis.",
};

const SIZE = 50;

/**
 * /app/contratos — lista paginada (50) con filtros en la URL. Cada fila lleva a
 * /app/contratos/[ocid]. El mapa (/app/mapa) muestra los mismos contratos por zona.
 */
export default async function ContratosPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = parseContratosQuery(searchParams);
  const [pagina, zonas, entidad, resumen] = await Promise.all([
    getContratos({ ...query, size: SIZE }),
    getZonas("departamento"),
    query.entidad ? getEntidad(query.entidad).catch(() => null) : Promise.resolve(null),
    getResumenContratos(query),
  ]);
  const regiones = (zonas ?? []).map((z) => ({ ubigeo: z.ubigeo, nombre: z.nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return (
    <div className="space-y-5 px-6 py-8 lg:px-10">
      <PageHeader
        eyebrow="Contratos"
        icon={<FileSearch size={11} className="text-clay" />}
        title="Todos los contratos"
        subtitle="Cada convocatoria del SEACE que Vigía ingirió, con su tipo, etapa y estado de análisis. Los que aún no tienen dictamen esperan que alguien financie la capacidad de leerlos."
      />
      <FiltrosContratos query={query} regiones={regiones} entidadNombre={entidad?.entidad?.nombre ?? null} resumen={resumen} />
      <ContratosLista query={{ ...query, size: SIZE }} initial={pagina} size={SIZE} navegacion="url" />
    </div>
  );
}
