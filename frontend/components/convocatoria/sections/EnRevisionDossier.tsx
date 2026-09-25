"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EN_REVISION } from "@/lib/severidad";
import { ICONO_SEVERIDAD } from "@/components/ui/Severidad";
import { cn } from "@/lib/utils";
import { FichaContrato } from "./FichaContrato";
import { ShareableHeader } from "./ShareableHeader";

/**
 * Un dossier cuya alerta quedó frenada para revisión humana (DESIGN_SYSTEM.md §10.4): se
 * muestra "En revisión" y nada más. Ni puntaje, ni señales, ni dictamen, ni montos
 * cuestionados. Queda lo que ya es público en el registro OCDS (qué, quién, cuánto, cuándo),
 * que es lo mismo que cualquiera ve en el portal del OECE.
 *
 * Antes este caso caía en el dossier normal con todo vacío y se leía "Análisis incompleto:
 * corrieron 0 de 10 agentes", que no es lo que pasó: el análisis terminó y una persona lo
 * está revisando.
 */
export function EnRevisionDossier({ conv, ganador, nGanadores, onReset }: { conv: any; ganador: any; nGanadores: number; onReset?: () => void }) {
  const ocid: string | null = conv.ocid || conv.codigo || null;
  // Mismo tono y palabra que en las listas (lib/severidad EN_REVISION): una espera, no un veredicto.
  const Icono = ICONO_SEVERIDAD[EN_REVISION.icono];
  return (
    // Ancho de página y a la izquierda, como el dossier publicado (§10.7): antes iba centrado a 4xl.
    <div className="space-y-4">
      <ShareableHeader conv={conv} codigo={conv.codigo} onReset={onReset} compartible={false} />
      <FichaContrato conv={conv} ganador={ganador} nGanadores={nGanadores} />
      <section aria-labelledby="en-revision-titulo" className="rounded-2xl border border-line bg-paperSoft px-4 py-3 sm:px-5">
        <h2 id="en-revision-titulo" className="inline-flex items-center gap-2 font-display text-[20px] font-bold text-ink">
          <Icono size={18} className={cn("shrink-0", EN_REVISION.texto)} aria-hidden />
          {EN_REVISION.etiqueta}
        </h2>
        <p className="mt-1 text-sm leading-snug text-inkSoft">
          El análisis terminó y una persona del equipo lo revisa antes de publicarlo. Hasta entonces no se muestra lo que encontró.
        </p>
        {ocid && (
          <Link
            href={`/app/contratos/${encodeURIComponent(ocid)}`}
            className="mt-3 inline-flex min-h-[32px] items-center gap-1 text-[13px] font-semibold text-granate hover:underline"
          >
            Ver el contrato y sus documentos oficiales <ArrowRight size={14} aria-hidden />
          </Link>
        )}
      </section>
    </div>
  );
}
