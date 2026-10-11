import type { Metadata } from "next";
import { EncabezadoPagina, Pagina } from "@/components/patrones";
import { ContratosPorPartido } from "@/components/partidos/ContratosPorPartido";
import { PartidosExplorador } from "@/components/partidos/PartidosExplorador";
import { leerCobertura } from "@/components/landing/PartidosSeccion";
import { anioDeUrl, getRankingPartidos } from "@/lib/partidosApi";

export const metadata: Metadata = { title: "Partidos y gobiernos" };

/**
 * Arriba, los contratos por partido de un período (cada contrato se asocia al partido que gobernaba la entidad
 * el mes en que se convocó). Abajo, quién gobierna cada región, provincia y distrito (Elecciones Regionales y
 * Municipales 2014, 2018 y 2022, del JNE): la misma pieza que muestra la portada, con todo el ancho de la app.
 * Cuenta quién ganó, no qué hizo cada gobierno; los resultados de 2026 se suman cuando el JNE los proclame.
 */
export default async function PartidosPage({ searchParams }: { searchParams?: { anio?: string | string[] } }) {
  const anio = anioDeUrl(searchParams?.anio);
  const [cobertura, ranking] = await Promise.all([leerCobertura(), getRankingPartidos(anio)]);
  return (
    <Pagina className="space-y-8">
      <EncabezadoPagina
        titulo="Partidos y gobiernos"
        bajada="Qué contratos se firmaron bajo los gobiernos de cada partido, y quién ganó cada región, provincia y distrito en 2014, 2018 y 2022."
      />
      <ContratosPorPartido ranking={ranking} anio={anio} />
      <section aria-labelledby="quien-gobierna-titulo" className="space-y-4">
        <h2 id="quien-gobierna-titulo" className="font-display text-2xl font-bold leading-tight text-ink">Quién gobierna cada lugar</h2>
        <PartidosExplorador cobertura={cobertura} />
      </section>
    </Pagina>
  );
}
