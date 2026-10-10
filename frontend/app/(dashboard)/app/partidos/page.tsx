import type { Metadata } from "next";
import { EncabezadoPagina, Pagina } from "@/components/patrones";
import { PartidosExplorador } from "@/components/partidos/PartidosExplorador";

export const metadata: Metadata = { title: "Partidos y gobiernos" };

/**
 * Quién gobierna cada región, provincia y distrito (Elecciones Regionales y Municipales 2014, 2018
 * y 2022, del JNE). Es la misma pieza que muestra la portada, con todo el ancho de la app. Cuenta quién
 * ganó, no qué hizo cada gobierno; los resultados de 2026 se suman cuando el JNE los proclame.
 */
export default function PartidosPage() {
  return (
    <Pagina>
      <EncabezadoPagina
        titulo="Partidos y gobiernos"
        bajada="Quién ganó cada región, provincia y distrito en 2014, 2018 y 2022, y cómo se compara cada organización."
      />
      <PartidosExplorador />
    </Pagina>
  );
}
