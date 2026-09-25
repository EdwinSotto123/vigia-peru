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
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { CarrilesAgentes } from "@/components/agentes/CarrilesAgentes";
import { TOTAL_AGENTES, TOTAL_CARRILES, TOTAL_PASOS } from "@/components/agentes/catalogo";
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
        <div className="space-y-4">
          <CarrilesAgentes />
          <p className="border-t border-line pt-3 text-[12px] leading-snug text-mute">
            Son {TOTAL_PASOS} pasos
            {nPasosExtra > 0 ? `: ${TOTAL_AGENTES} agentes y ${nPasosExtra} de consulta o verificación` : ""}. Los carriles
            avanzan a la vez y la síntesis espera a que terminen todos
            {duracion ? (
              <>
                ; una lectura completa tarda {duracion}
                {nLecturas ? ` (mediana de ${nLecturas} lecturas recientes)` : ""}
              </>
            ) : null}
            . Cada señal queda con el agente que la encontró, su norma y su fuente oficial.
          </p>
        </div>
      }
    >
      <Workflow size={15} aria-hidden />
      Cómo se lee un contrato
    </Revelar>
  );
}
