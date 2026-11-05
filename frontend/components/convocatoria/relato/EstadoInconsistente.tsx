"use client";

import { Info } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { fechaCorta, numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Los documentos y el portal oficial no coinciden en la etapa del proceso. Es un dato sobre el registro, no una señal: va
 * en tinta neutra. Aviso inevitable = una línea + ⓘ (§10.7); los documentos que lo muestran van en la ⓘ.
 *
 * Antes iba suelto entre el veredicto y las pestañas; con el relato (pedido del usuario del 2026-11-05) va donde se
 * entiende: al pie de «Qué pasó», junto a los pasos del proceso que contradice.
 */
export function EstadoInconsistente({ er, className }: { er: any; className?: string }) {
  const legible = (s: unknown) => String(s || "").replace(/_/g, " ");
  const docs: any[] = er.documentos_clave || [];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-line bg-paperSoft px-4 py-2.5 text-meta", className)}>
      <Info size={15} className="shrink-0 text-inkSoft" aria-hidden />
      <span className="font-semibold text-ink">Los documentos y el portal oficial no coinciden</span>
      <span className="text-inkSoft">
        OECE: {legible(er.estado_ocds)}, expediente: {legible(er.estado_documentos)}
      </span>
      <Ayuda titulo="¿Por qué no coinciden?">
        <span className="block">
          El registro OCDS del OECE muestra el estado &ldquo;{legible(er.estado_ocds)}&rdquo;, pero el expediente ya tiene{" "}
          {numero(docs.length)} {docs.length === 1 ? "documento clave" : "documentos clave"} de &ldquo;
          {legible(er.estado_documentos)}&rdquo;. El portal puede estar desactualizado o la publicación de la adjudicación,
          pendiente.
        </span>
        {/* recorte: los tres primeros en la ⓘ, el resto se cuenta abajo («y N documentos más») y está en «Documentos». */}
        {docs.slice(0, 3).map((d: any, i: number) => (
          <span key={i} className="mt-1.5 block text-rotulo text-inkSoft">
            <strong className="font-semibold text-ink">{legible(d.tipo)}</strong> {d.titulo}
            {d.fecha && <span className="text-mute">, del {fechaCorta(String(d.fecha).slice(0, 10))}</span>}
          </span>
        ))}
        {docs.length > 3 && <span className="mt-1.5 block text-rotulo text-mute">{`y ${docs.length - 3} documentos más en el expediente.`}</span>}
      </Ayuda>
    </div>
  );
}
