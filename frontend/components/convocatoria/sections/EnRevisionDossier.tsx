"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Indicadores } from "@/components/listado";
import { EN_REVISION } from "@/lib/severidad";
import { ICONO_SEVERIDAD } from "@/components/ui/Severidad";
import { cn } from "@/lib/utils";
import { IdentidadDossier, indicadoresDossier } from "./IdentidadDossier";

/**
 * La Ficha de un contrato cuya alerta quedó frenada para revisión humana (DESIGN_SYSTEM.md
 * §10.4 y §14.2): identidad → indicadores del registro → estado "En revisión", y nada más.
 * Ni puntaje, ni señales, ni dictamen, ni montos cuestionados: las cifras son las del registro
 * OCDS (referencial, adjudicado, fecha), lo mismo que cualquiera ve en el portal del OECE.
 *
 * Antes este caso caía en el dossier normal con todo vacío y se leía "Análisis incompleto:
 * corrieron 0 de 10 agentes", que no es lo que pasó: el análisis terminó y una persona lo revisa.
 */
export function EnRevisionDossier({ conv, ganador, nGanadores }: { conv: any; ganador: any; nGanadores: number }) {
  const ocid: string | null = conv.ocid || conv.codigo || null;
  // Mismo tono y palabra que en las listas (lib/severidad EN_REVISION): una espera, no un veredicto.
  const Icono = ICONO_SEVERIDAD[EN_REVISION.icono];
  return (
    <div className="space-y-5">
      <IdentidadDossier
        conv={conv}
        ganador={ganador}
        nGanadores={nGanadores}
        compartible={false}
        chips={
          <>
            <span className={cn("pill", EN_REVISION.fondo, EN_REVISION.texto, EN_REVISION.borde)}>
              <Icono size={11} aria-hidden />
              {EN_REVISION.etiqueta}
            </span>
            {conv.tipo_proceso && <span className="pill border-line bg-paperSoft text-inkSoft">{conv.tipo_proceso}</span>}
          </>
        }
      />
      <Indicadores items={indicadoresDossier({ conv, ganador })} />
      <section aria-labelledby="en-revision-titulo" className="rounded-2xl border border-line bg-paperSoft px-4 py-3.5 sm:px-5">
        <h2 id="en-revision-titulo" className="inline-flex items-center gap-2 font-display text-[19px] font-bold text-ink">
          <Icono size={18} className={cn("shrink-0", EN_REVISION.texto)} aria-hidden />
          El análisis terminó y está en revisión
        </h2>
        <p className="mt-1 text-sm leading-snug text-inkSoft">
          Una persona del equipo lo revisa antes de publicarlo. Hasta entonces no se muestra lo que encontró.
        </p>
        {ocid && (
          <Link
            href={`/app/contratos/${encodeURIComponent(ocid)}`}
            className="mt-2 inline-flex min-h-[32px] items-center gap-1 text-[13px] font-semibold text-granate hover:underline"
          >
            Ver el contrato y sus documentos oficiales <ArrowRight size={14} aria-hidden />
          </Link>
        )}
      </section>
    </div>
  );
}
