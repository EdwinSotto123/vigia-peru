"use client";

import { AlertTriangle, CheckCircle2, ChevronRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";
import { BlurFade } from "@/components/magicui/BlurFade";

export function ResumenHumano({
  conv,
  ganador,
  nAlta,
  nMedia,
  nBaja,
  banderasArr,
  fmtMoney,
  onClickResumen,
}: {
  conv: any;
  ganador: any;
  nAlta: number;
  nMedia: number;
  nBaja: number;
  banderasArr: any[];
  fmtMoney: (n: any) => string;
  onClickResumen: () => void;
}) {
  const total = nAlta + nMedia + nBaja;
  const riesgo: "alto" | "medio" | "bajo" | "limpio" =
    nAlta > 0 ? "alto" : nMedia > 0 ? "medio" : total === 0 ? "limpio" : "bajo";

  const VIS: Record<typeof riesgo, { label: string; color: string; bg: string; border: string }> = {
    alto:    { label: "Riesgo alto",       color: "text-rust",  bg: "bg-rust",  border: "border-rust/40"  },
    // "Requiere revisión" chocaba con el estado formal `alertas.estado='revision'` (la
    // autoevaluación bloqueando la publicación, con su propia cola en /admin/revision) — esto
    // acá es solo "hay una bandera de severidad media", nada bloqueado ni pendiente de nadie.
    medio:   { label: "Señal media",       color: "text-amber", bg: "bg-amber", border: "border-amber/40" },
    bajo:    { label: "Observaciones menores", color: "text-clay",  bg: "bg-clay",  border: "border-clay/30"  },
    limpio:  { label: "Sin hallazgos",     color: "text-moss",  bg: "bg-moss",  border: "border-moss/30"  },
  };
  const vis = VIS[riesgo];

  // Montos: referencial (lo que el Estado presupuestó) vs adjudicado (lo que se pagará)
  const referencial = Number(conv.cuantia_total || 0);
  const adjudicado = Number(ganador?.monto_ganado || 0);
  const hayAdjudicado = adjudicado > 0;
  const variacion = hayAdjudicado && referencial > 0 ? ((adjudicado - referencial) / referencial) * 100 : null;

  // Top 2 banderas (priorizando alta/media)
  const top = [...banderasArr]
    .sort((a, b) => {
      const order: Record<string, number> = { alta: 0, media: 1, baja: 2 };
      return (order[(a.severidad || "media").toLowerCase()] ?? 1) -
             (order[(b.severidad || "media").toLowerCase()] ?? 1);
    })
    .slice(0, 2);

  // Caption con label + tooltip via title
  const Stat = ({ label, value, hint, valueClass, sublabel }: {
    label: string; value: React.ReactNode; hint: string; valueClass?: string; sublabel?: React.ReactNode;
  }) => (
    <div className="p-3" title={hint}>
      <div className="text-[10px] font-medium text-mute">{label}</div>
      <div className={cn("mt-0.5 font-mono text-lg font-bold tabular-nums leading-tight", valueClass || "text-ink")}>
        {value}
      </div>
      {sublabel && <div className="mt-0.5 text-[10px] text-mute">{sublabel}</div>}
    </div>
  );

  return (
    <section className={cn("surface overflow-hidden p-0", vis.border, "border-2")}>
      {/* HEADER: badge severidad inline · sin uppercase shouty */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paperDeep px-4 py-2">
        <span className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-paper",
          vis.bg,
        )}>
          {riesgo === "limpio" ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} className={riesgo === "alto" ? "animate-pulse" : ""} />}
          {vis.label}
        </span>
        {nAlta > 0 && (
          <span className="rounded-full bg-rust px-1.5 py-0 text-[10px] font-bold text-paper">{nAlta} alta</span>
        )}
        {nMedia > 0 && (
          <span className="rounded-full bg-amber px-1.5 py-0 text-[10px] font-bold text-paper">{nMedia} media</span>
        )}
        {nBaja > 0 && (
          <span className="rounded-full bg-paperSoft px-1.5 py-0 text-[10px] font-bold text-mute">{nBaja} baja</span>
        )}
        <button
          onClick={onClickResumen}
          className={cn("ml-auto inline-flex items-center gap-1 text-[10px] font-bold hover:underline", vis.color)}
        >
          Ver evidencia <ChevronRight size={11} />
        </button>
      </div>

      {/* MONTOS — 2 columnas con labels claros + variación */}
      <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
        <Stat
          label="Presupuesto del Estado"
          value={fmtMoney(referencial)}
          hint="Valor referencial publicado por la entidad (lo que planeaba gastar)."
          sublabel="referencial"
        />
        {hayAdjudicado ? (
          <Stat
            label="Monto adjudicado"
            value={fmtMoney(adjudicado)}
            hint="Lo que finalmente se pagará al ganador."
            valueClass={variacion != null && variacion > 5 ? "text-rust" : variacion != null && variacion < -5 ? "text-moss" : "text-ink"}
            sublabel={
              variacion == null || Math.abs(variacion) < 0.1 ? (
                <span className="text-mute">igual al presupuesto</span>
              ) : (
                <span className={cn(
                  "font-mono font-bold",
                  variacion > 0 ? "text-rust" : "text-moss",
                )}>
                  {variacion > 0 ? "+" : ""}{variacion.toFixed(1)}%
                  <span className="ml-1 font-sans font-normal text-mute">
                    {variacion > 0 ? "sobre presupuesto" : "de ahorro"}
                  </span>
                </span>
              )
            }
          />
        ) : (
          <Stat
            label="Monto adjudicado"
            value={<span className="text-base font-normal italic text-mute">pendiente</span>}
            hint="Aún no se publica la adjudicación."
          />
        )}
      </div>

      {/* QUIÉN — entidad → empresa, 2 columnas */}
      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="p-3" title="Entidad pública que convoca y pagará el contrato.">
          <div className="text-[10px] font-medium text-mute">Entidad que contrata</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-ink">
            {conv.entidad || "—"}
          </div>
          {conv.region && (
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-mute">
              <MapPin size={9} /> {conv.region}
            </div>
          )}
        </div>
        <div className="p-3" title="Empresa privada que ganó la buena pro y ejecutará el contrato.">
          <div className="text-[10px] font-medium text-mute">Empresa ganadora</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-ink">
            {ganador?.nombre || <span className="italic text-mute">Sin adjudicación</span>}
          </div>
          {ganador?.ruc && (
            <div className="mt-0.5 font-mono text-[10px] text-heroViolet">RUC {ganador.ruc}</div>
          )}
        </div>
      </div>

      {/* TOP HALLAZGOS */}
      {top.length > 0 && (
        <div className="border-t border-line bg-paperSoft px-4 py-2.5">
          <div className="mb-1 text-[10px] font-medium text-mute">Hallazgos prioritarios</div>
          <ul className="space-y-1">
            {/* Cascada corta: son 2 hallazgos independientes, no un solo bloque de texto. */}
            {top.map((b, i) => (
              <BlurFade
                as="li"
                key={i}
                delayMs={i * 70}
                className="flex items-start gap-2 text-[12px] leading-snug text-ink"
              >
                <span className={cn(
                  "mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                  (b.severidad || "").toLowerCase() === "alta"  && "bg-rust",
                  (b.severidad || "").toLowerCase() === "media" && "bg-amber",
                  (b.severidad || "").toLowerCase() === "baja"  && "bg-mute",
                )} />
                <span className="line-clamp-2">{redactDnis(b.evidencia || b.regla)}</span>
              </BlurFade>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
