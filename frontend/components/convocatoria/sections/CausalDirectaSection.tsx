"use client";

import { Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";

export function CausalDirectaSection({
  causal, acto,
}: { causal?: any; acto?: any }) {
  if (!causal?.match) return null;
  const tieneActo = acto?.encontrado === true;
  const sevColor = tieneActo
    ? "bg-moss/10 text-moss border-moss/30"
    : "bg-rust/15 text-rust border-rust/40";

  return (
    <section className="surface overflow-hidden p-0">
      <div className={cn("border-b border-line px-5 py-3", "bg-paperDeep")}>
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Scale size={11} className="mr-1 inline" />
          Causal de Contratación Directa · Art. 27 TUO Ley 30225
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Lit. {causal.causal_letra?.toUpperCase()} — {causal.descripcion}
        </h2>
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-clay">
            Causal invocada
          </h3>
          <div className="mt-2 space-y-1.5 text-[12px]">
            <div className="rounded-md bg-paper px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Letra / Inciso</dt>
              <dd className="font-mono font-bold text-ink">Art. 27.1 lit. {causal.causal_letra}</dd>
            </div>
            <div className="rounded-md bg-paper px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Descripción</dt>
              <dd className="text-ink">{redactDnis(causal.descripcion)}</dd>
            </div>
            {causal.evidencia_text && (
              <div className="rounded-md bg-paper px-2 py-1.5">
                <dt className="text-[9px] uppercase tracking-widest text-mute">Evidencia en el documento</dt>
                <dd className="italic text-inkSoft">"{causal.evidencia_text}"</dd>
              </div>
            )}
            <div className="rounded-md bg-paper px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">¿Requiere acto resolutivo?</dt>
              <dd className="font-bold text-ink">
                {causal.requiere_acto_resolutivo ? "SÍ (D.S./D.U./Resolución/Acuerdo Regional)" : "No"}
              </dd>
            </div>
          </div>
        </article>

        <article className={cn("rounded-md border p-4", sevColor)}>
          <h3 className="text-[10px] font-bold uppercase tracking-widest">
            Acto resolutivo que la sustenta
          </h3>
          {tieneActo ? (
            <div className="mt-2 space-y-1.5 text-[12px]">
              <div className="rounded-md bg-paper px-2 py-1.5">
                <dt className="text-[9px] uppercase tracking-widest text-mute">Tipo</dt>
                <dd className="font-bold text-ink">{acto.tipo}</dd>
              </div>
              <div className="rounded-md bg-paper px-2 py-1.5">
                <dt className="text-[9px] uppercase tracking-widest text-mute">Número</dt>
                <dd className="font-mono font-bold text-ink">{acto.numero}</dd>
              </div>
              {acto.fecha_proxima && (
                <div className="rounded-md bg-paper px-2 py-1.5">
                  <dt className="text-[9px] uppercase tracking-widest text-mute">Fecha aproximada</dt>
                  <dd className="font-mono text-ink">{acto.fecha_proxima}</dd>
                </div>
              )}
              {acto.fragmento && (
                <div className="rounded-md bg-paper px-2 py-1.5">
                  <dt className="text-[9px] uppercase tracking-widest text-mute">Fragmento del documento</dt>
                  <dd className="italic text-inkSoft text-[11px]">"{acto.fragmento}"</dd>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-[12px] font-bold">
                ⚠ No se ubicó el acto resolutivo que declara la situación.
              </p>
              <p className="text-[11px] italic">
                {acto?.motivo || "Los documentos publicados no mencionan número de D.S./D.U./Resolución/Acuerdo Regional/Ordenanza que sustente esta causal."}
              </p>
              <p className="border-t border-line pt-2 text-[10px]">
                <strong>Norma:</strong> Art. 27.1 lit. a TUO Ley 30225 — la situación de
                emergencia debe estar acreditada por declaratoria oficial.
              </p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
