"use client";

import { AlertTriangle, CheckCircle2, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";

export function CausalDirectaSection({
  causal, acto,
}: { causal?: any; acto?: any }) {
  if (!causal?.match) return null;
  const tieneActo = acto?.encontrado === true;
  // Con acto resolutivo ubicado: verificado (verde). Sin él: una pista que pide atención, con
  // ícono y palabra, en el ámbar de las señales medias (no en el rojo de una alta).
  const sevColor = tieneActo ? "bg-moss/10 border-moss/30" : "bg-amber-soft/60 border-amber/40";

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line bg-paperSoft px-5 py-3">
        <h2 className="font-display text-xl font-bold text-ink">
          <Scale size={16} className="mr-1.5 inline text-mute" aria-hidden />
          Contratación directa, literal {causal.causal_letra?.toUpperCase()}: {causal.descripcion}
        </h2>
        <p className="mt-0.5 text-[12px] text-mute">Causal invocada según el Art. 27 del TUO de la Ley 30225</p>
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        <article className="rounded-xl border border-line bg-paperSoft p-4">
          <h3 className="text-[12px] font-semibold text-ink">
            Causal invocada
          </h3>
          <div className="mt-2 space-y-1.5 text-[12px]">
            <div className="rounded-md bg-paper px-2 py-1.5">
              <dt className="text-[11px] text-mute">Letra / Inciso</dt>
              <dd className="font-mono font-bold text-ink">Art. 27.1 lit. {causal.causal_letra}</dd>
            </div>
            <div className="rounded-md bg-paper px-2 py-1.5">
              <dt className="text-[11px] text-mute">Descripción</dt>
              <dd className="text-ink">{redactDnis(causal.descripcion)}</dd>
            </div>
            {causal.evidencia_text && (
              <div className="rounded-md bg-paper px-2 py-1.5">
                <dt className="text-[11px] text-mute">Evidencia en el documento</dt>
                <dd className="italic text-inkSoft">“{redactDnis(causal.evidencia_text)}”</dd>
              </div>
            )}
            <div className="rounded-md bg-paper px-2 py-1.5">
              <dt className="text-[11px] text-mute">¿Requiere acto resolutivo?</dt>
              <dd className="font-bold text-ink">
                {causal.requiere_acto_resolutivo ? "Sí (D.S., D.U., resolución o acuerdo regional)" : "No"}
              </dd>
            </div>
          </div>
        </article>

        <article className={cn("rounded-xl border p-4", sevColor)}>
          <h3 className={cn("inline-flex items-center gap-1.5 text-[12px] font-semibold", tieneActo ? "text-mossTexto" : "text-amberTexto")}>
            {tieneActo ? <CheckCircle2 size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />}
            Acto resolutivo que la sustenta: {tieneActo ? "ubicado" : "no ubicado"}
          </h3>
          {tieneActo ? (
            <div className="mt-2 space-y-1.5 text-[12px]">
              <div className="rounded-md bg-paper px-2 py-1.5">
                <dt className="text-[11px] text-mute">Tipo</dt>
                <dd className="font-bold text-ink">{acto.tipo}</dd>
              </div>
              <div className="rounded-md bg-paper px-2 py-1.5">
                <dt className="text-[11px] text-mute">Número</dt>
                <dd className="font-mono font-bold text-ink">{acto.numero}</dd>
              </div>
              {acto.fecha_proxima && (
                <div className="rounded-md bg-paper px-2 py-1.5">
                  <dt className="text-[11px] text-mute">Fecha aproximada</dt>
                  <dd className="font-mono text-ink">{acto.fecha_proxima}</dd>
                </div>
              )}
              {acto.fragmento && (
                <div className="rounded-md bg-paper px-2 py-1.5">
                  <dt className="text-[11px] text-mute">Fragmento del documento</dt>
                  <dd className="italic text-inkSoft text-[11px]">“{redactDnis(acto.fragmento)}”</dd>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-[12px] font-semibold text-ink">
                No se ubicó el acto resolutivo que declara la situación.
              </p>
              <p className="text-[12px] text-inkSoft">
                {acto?.motivo || "Los documentos publicados no mencionan número de D.S./D.U./Resolución/Acuerdo Regional/Ordenanza que sustente esta causal."}
              </p>
              <p className="border-t border-line pt-2 text-[12px] text-inkSoft">
                <strong>Norma:</strong> Art. 27.1 lit. a del TUO de la Ley 30225: la situación de
                emergencia debe estar acreditada por declaratoria oficial.
              </p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
