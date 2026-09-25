"use client";

/**
 * Qué agentes leen un contrato, a un clic (DESIGN_SYSTEM.md §10.7): un botón en la cabecera de
 * /app/convocatoria que abre los carriles en el panel lateral, sin navegar. Antes era un
 * desplegable dentro de la tarjeta del buscador, con dos líneas de explicación abiertas.
 *
 * El conjunto, el orden y los recuentos salen del catálogo (`components/agentes/catalogo`), que
 * sale del DAG real (CARRILES + FASES de lib/auditoria): si el backend agrega o quita un agente,
 * esto cambia solo. La duración no se escribe a mano: es la mediana medida en producción
 * (/financiamiento/procesamientos/resumen → estimado.medianaSeg). Sin ese dato, no se promete.
 */

import { Workflow } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueDetalle, CuerpoDetalle } from "@/components/patrones/Detalle";
import { Indicadores } from "@/components/listado/Indicadores";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { CarrilesAgentes } from "@/components/agentes/CarrilesAgentes";
import { TOTAL_AGENTES, TOTAL_CARRILES, TOTAL_PASOS } from "@/components/agentes/catalogo";
import { numero, plural } from "@/lib/formato";
import { duracionEnPalabras } from "./conteoRiesgo";

export function AgentsPipeline({
  medianaSeg = null,
  nLecturas = null,
}: {
  /** Mediana real de duración de una lectura, en segundos. */
  medianaSeg?: number | null;
  /** Sobre cuántas lecturas se calculó la mediana. */
  nLecturas?: number | null;
}) {
  const duracion = duracionEnPalabras(medianaSeg);
  const nPasosExtra = TOTAL_PASOS - TOTAL_AGENTES; // pasos del DAG que no son uno de los agentes
  const forma = TOTAL_CARRILES > 2 ? "dos ramas en paralelo y una síntesis al final" : `${TOTAL_CARRILES} carriles`;
  return (
    <Revelar
      titulo="Cómo se lee un contrato"
      descripcion={`${TOTAL_AGENTES} agentes de IA: ${forma}`}
      etiqueta="Cómo se lee un contrato"
      ancho="lg"
      className={claseAccion("fantasma", "w-auto")}
      detalle={
        // Formato de panel (§14.4): las cifras del proceso arriba, los carriles en su bloque y
        // el "cómo" a un clic, en vez de un párrafo al pie.
        <CuerpoDetalle>
          <Indicadores
            items={[
              { valor: numero(TOTAL_AGENTES), etiqueta: "agentes", contexto: `en ${plural(TOTAL_CARRILES, "carril", "carriles")}` },
              {
                valor: numero(TOTAL_PASOS),
                etiqueta: "pasos",
                contexto: nPasosExtra > 0 ? `${numero(nPasosExtra)} de consulta o verificación` : undefined,
              },
              {
                valor: duracion,
                etiqueta: "tarda una lectura",
                // Sin mediana medida no se promete un tiempo: "Sin dato", sin contexto inventado.
                contexto: duracion ? (nLecturas ? `mediana de ${numero(nLecturas)} lecturas recientes` : "mediana medida en producción") : undefined,
              },
            ]}
          />
          <BloqueDetalle
            titulo="Quién lee qué"
            ayuda={
              <Ayuda titulo="¿En qué orden trabajan?">
                Los carriles avanzan a la vez y la síntesis espera a que terminen todos. Cada señal queda con el agente que
                la encontró, su norma y su fuente oficial.
              </Ayuda>
            }
          >
            <CarrilesAgentes />
          </BloqueDetalle>
        </CuerpoDetalle>
      }
    >
      <Workflow size={15} aria-hidden />
      Cómo se lee un contrato
    </Revelar>
  );
}
