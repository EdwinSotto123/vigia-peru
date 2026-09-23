import { PageHeader } from "@/components/dashboard/PageHeader";
import { ContratosLista } from "@/components/contratos/ContratosLista";
import { FiltrosContratos } from "@/components/contratos/FiltrosContratos";
import { getEntidad } from "@/lib/api-client";
import { getContratos, getResumenContratos, parseContratosQuery } from "@/lib/contratos";
import { getZonas } from "@/lib/financiamiento";

export const metadata = {
  // Solo la parte de la página: el layout raíz agrega " | Vigía Perú".
  title: "Contratos",
  description: "Todos los contratos públicos del SEACE ingeridos por Vigía, con su tipo, etapa, zona y estado de análisis.",
};

const SIZE = 50;
const N = (n: number) => n.toLocaleString("es-PE");

/**
 * /app/contratos — tabla densa paginada (50) con filtros en la URL. Cada fila
 * abre su resumen en un panel lateral sin salir de la lista; el enlace al
 * dossier completo (/app/contratos/[ocid]) queda al final de la fila y en el pie
 * del panel. El mapa (/app/mapa) muestra los mismos contratos por zona.
 */
export default async function ContratosPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = parseContratosQuery(searchParams);
  const hayFiltros = !!(
    query.q || query.tipo || query.etapa || query.ubigeo || query.entidad ||
    query.riesgo || query.operativo || query.desde || query.monto_min != null || query.monto_max != null
  );
  const [pagina, zonas, entidad, resumen, resumenGlobal] = await Promise.all([
    getContratos({ ...query, size: SIZE }),
    getZonas("departamento"),
    query.entidad ? getEntidad(query.entidad).catch(() => null) : Promise.resolve(null),
    getResumenContratos(query),
    // Sin filtros el resumen filtrado YA es el universo: no se pide dos veces.
    hayFiltros ? getResumenContratos({}) : Promise.resolve(null),
  ]);
  const regiones = (zonas ?? []).map((z) => ({ ubigeo: z.ubigeo, nombre: z.nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  // Toda cifra con su denominador en la misma línea. "Leídos" = los que tienen
  // score, que es exactamente los que tienen alerta analizada (el resto del
  // riesgo viene como sin_analizar desde el propio backend).
  const universo = (resumenGlobal ?? resumen)?.total ?? null;
  const filtrados = pagina?.total ?? null;
  const leidos = resumen
    ? (resumen.porRiesgo.alto ?? 0) + (resumen.porRiesgo.medio ?? 0) + (resumen.porRiesgo.bajo ?? 0)
    : null;

  const contexto =
    universo == null || filtrados == null ? (
      <span className="text-mute">Sin conteo: el API no respondió</span>
    ) : hayFiltros ? (
      <span>
        <strong className="font-mono font-semibold text-ink">{N(filtrados)}</strong> de {N(universo)} contratos con
        estos filtros{leidos != null && <>, de los cuales {N(leidos)} ya leídos</>}
      </span>
    ) : (
      <span>
        {leidos != null && (
          <>
            <strong className="font-mono font-semibold text-ink">{N(leidos)}</strong> leídos de{" "}
          </>
        )}
        {N(universo)} contratos ingeridos
      </span>
    );

  return (
    <div className="space-y-5 px-6 py-8 lg:px-10">
      <PageHeader
        title="Todos los contratos"
        subtitle="Cada convocatoria del SEACE que Vigía ingirió, con su tipo, etapa y estado de análisis. Los que aún no tienen dictamen esperan que alguien financie la capacidad de leerlos."
        contexto={contexto}
      />
      <FiltrosContratos query={query} regiones={regiones} entidadNombre={entidad?.entidad?.nombre ?? null} resumen={resumen} />
      <ContratosLista query={{ ...query, size: SIZE }} initial={pagina} size={SIZE} navegacion="url" />
    </div>
  );
}
