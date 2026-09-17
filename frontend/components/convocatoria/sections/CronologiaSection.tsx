"use client";

import { AlertTriangle, Award, Calendar, CheckCircle2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export function CronologiaSection({ convocatoria }: { convocatoria: any }) {
  const c = convocatoria || {};
  const steps = [
    { key: "pub", label: "Publicación", fecha: c.fecha_publicacion, icon: <FileText size={12} /> },
    { key: "ini", label: "Inicio convocatoria", fecha: c.fecha_inicio, icon: <Calendar size={12} /> },
    { key: "fin", label: "Cierre presentación", fecha: c.fecha_fin, icon: <Calendar size={12} /> },
    { key: "bp",  label: "Buena pro", fecha: c.fecha_buena_pro, icon: <Award size={12} /> },
  ].filter(s => s.fecha);

  if (steps.length === 0) return null;

  // Verificación de plazo entre inicio y buena pro
  let plazo_dias: number | null = null;
  let plazo_ok: boolean | null = null;
  let plazo_minimo_legal: number | null = null;
  if (c.fecha_inicio && c.fecha_buena_pro) {
    const d1 = new Date(c.fecha_inicio);
    const d2 = new Date(c.fecha_buena_pro);
    plazo_dias = Math.round((d2.getTime() - d1.getTime()) / 86400000);
    const tp = (c.tipo_proceso || "").toUpperCase();
    if (tp.includes("LICITACION") || tp.includes("CONCURSO")) plazo_minimo_legal = 22;
    else if (tp.includes("SUBASTA")) plazo_minimo_legal = 12;
    else if (tp.includes("ADJUDICACION SIMPLIFICADA") || tp.includes("AS-")) plazo_minimo_legal = 8;
    else if (tp.includes("COMPARACION")) plazo_minimo_legal = 5;
    if (plazo_minimo_legal != null && plazo_dias != null) {
      plazo_ok = plazo_dias >= plazo_minimo_legal;
    }
  }

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
          <Calendar size={11} className="mr-1 inline" />
          Cronología del expediente
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Línea de tiempo del proceso
        </h2>
        {c.tipo_proceso && (
          <p className="mt-1 text-xs text-mute">Tipo de proceso: <strong className="text-ink">{c.tipo_proceso}</strong></p>
        )}
      </div>
      <div className="overflow-x-auto px-5 py-6">
        <ol className="relative flex min-w-max items-start gap-4 pl-2">
          {/* línea horizontal */}
          <div className="absolute left-2 right-2 top-5 h-px bg-line" />
          {steps.map((s, i) => (
            <li key={s.key} className="relative z-10 flex w-40 flex-col items-start">
              <div className={cn(
                "grid h-10 w-10 place-items-center rounded-full ring-4 ring-paper text-paper",
                i === steps.length - 1 ? "bg-clay" : "bg-amber",
              )}>
                {s.icon}
              </div>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-clay">
                {s.label}
              </div>
              <div className="mt-0.5 font-mono text-xs text-ink">{s.fecha}</div>
            </li>
          ))}
        </ol>
      </div>
      {plazo_dias != null && (
        <div className={cn(
          "border-t border-line px-5 py-3 text-xs",
          plazo_ok === false ? "bg-crimson-soft" : "bg-paperSoft",
        )}>
          <div className="flex flex-wrap items-baseline gap-2">
            <strong className="text-ink">Plazo entre inicio y buena pro:</strong>
            <span className="font-mono font-bold text-ink">{plazo_dias} días</span>
            {plazo_minimo_legal != null && (
              <>
                <span className="text-mute">·</span>
                <span className="text-mute">Mínimo legal {c.tipo_proceso}:</span>
                <span className="font-mono text-ink">{plazo_minimo_legal} días</span>
                {plazo_ok === false && (
                  <span className="ml-2 rounded-full bg-rust px-2 py-0.5 text-[10px] font-bold text-paper">
                    <AlertTriangle size={9} className="mr-1 inline" />
                    INCUMPLE PLAZO LEGAL
                  </span>
                )}
                {plazo_ok === true && (
                  <span className="ml-2 rounded-full bg-moss/30 px-2 py-0.5 text-[10px] font-bold text-moss">
                    <CheckCircle2 size={9} className="mr-1 inline" />
                    cumple plazo
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
