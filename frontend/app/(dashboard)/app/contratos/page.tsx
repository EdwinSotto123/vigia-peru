import { Ayuda, EncabezadoPagina, Pagina } from "@/components/patrones";
import { ContratosLista } from "@/components/contratos/ContratosLista";
import { FiltrosContratos } from "@/components/contratos/FiltrosContratos";
import { getEntidad } from "@/lib/api-client";
import { getContratos, getResumenContratos, parseContratosQuery } from "@/lib/contratos";
import { getZonas } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";

export const metadata = {
  // Solo la parte de la página: el layout raíz agrega " | Vigía Perú".
  title: "Contratos",
  description: "Todos los contratos públicos del SEACE que tiene Vigía, con su tipo, etapa, zona y estado de lectura.",
};

const SIZE = 50;

/**
 * /app/contratos — plantilla "Listado" (DESIGN_SYSTEM.md §14): encabezado → filtros
 * (chips con conteo) → tabla densa → paginación → estado vacío. Cada fila abre su
 * resumen en un panel lateral sin salir de la lista; el enlace al dossier completo
 * (/app/contratos/[ocid]) queda al final de la fila y en el pie del panel. El mapa
 * (/app/mapa) muestra los mismos contratos por zona.
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

  // Toda cifra con su denominador, en UNA línea de datos (§10.2 y §10.7), con las palabras de §10.1:
  //   · leídos = el análisis terminó por cualquier vía (publicado, en revisión o descartado);
  //   · con dictamen publicado = leídos cuya alerta está publicada (alto + medio + bajo).
  const universo = (resumenGlobal ?? resumen)?.total ?? null;
  const filtrados = pagina?.total ?? null;
  const r = resumen?.porRiesgo;
  const conDictamen = r ? (r.alto ?? 0) + (r.medio ?? 0) + (r.bajo ?? 0) : null;
  const leidos = r && conDictamen != null ? conDictamen + (r.en_revision ?? 0) + (r.descartado ?? 0) : null;

  return (
    <Pagina className="space-y-5">
      <EncabezadoPagina
        titulo="Todos los contratos"
        bajada="Convocatorias del SEACE en la base de Vigía, con su tipo, etapa y estado de lectura."
        ayuda={
          <Ayuda titulo="¿Qué contratos hay aquí?">
            Cada convocatoria del SEACE que Vigía tiene en su base. Las que aún no tienen dictamen esperan que alguien
            financie su lectura; se leen por orden de llegada y nadie elige cuál.
          </Ayuda>
        }
      />
      {universo == null || filtrados == null ? (
        <p className="text-[13px] text-mute" aria-live="polite">No pudimos contar los contratos en este momento.</p>
      ) : (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] tabular-nums text-inkSoft" aria-live="polite">
          {hayFiltros ? (
            <span>
              <strong className="font-semibold text-ink">{numero(filtrados)}</strong> de {numero(universo)} contratos
              publicados
            </span>
          ) : (
            <span>
              {leidos != null && (
                <>
                  <strong className="font-semibold text-ink">{numero(leidos)}</strong> leídos de{" "}
                </>
              )}
              {numero(universo)} contratos publicados
            </span>
          )}
          {hayFiltros && leidos != null && (
            <span>
              <strong className="font-semibold text-ink">{numero(leidos)}</strong> de {numero(filtrados)} leídos
            </span>
          )}
          {conDictamen != null && (
            <span className="inline-flex items-center gap-1">
              <span>
                <strong className="font-semibold text-ink">{numero(conDictamen)}</strong> con dictamen publicado
              </span>
              <Ayuda titulo="¿Leído o con dictamen?">
                Leído: el análisis terminó, por cualquier vía. Con dictamen publicado: leídos cuyo resultado ya es público;
                el resto está en revisión humana o se descartó.
              </Ayuda>
            </span>
          )}
        </p>
      )}
      <FiltrosContratos query={query} regiones={regiones} entidadNombre={entidad?.entidad?.nombre ?? null} resumen={resumen} />
      <ContratosLista query={{ ...query, size: SIZE }} initial={pagina} size={SIZE} navegacion="url" />
    </Pagina>
  );
}
