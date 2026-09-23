"use client";

import { AlertTriangle, Award, Calendar, FilePen, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { reglaLabel } from "@/lib/auditoria";
import { redactDnis } from "../../Redact";
import { evidenciaComoTexto } from "./Evidencia";

/**
 * La línea de tiempo del proceso, con las fechas reales del registro OCDS.
 *
 * Antes rotulaba la fecha de buena pro como "Cierre presentación" y juzgaba el
 * plazo contra mínimos legales escritos a mano (22, 12, 8, 5 días) que no
 * salían de ninguna regla del backend. Ahora solo dice lo que el registro trae:
 * las fechas y los días entre una y otra. Si una regla de plazo sí disparó, se
 * muestra su señal, con su evidencia.
 */

const DIA = 86_400_000;
function diasEntre(a: string, b: string): number | null {
  const pa = /^(\d{4})-(\d{2})-(\d{2})/.exec(a);
  const pb = /^(\d{4})-(\d{2})-(\d{2})/.exec(b);
  if (!pa || !pb) return null;
  const ta = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const tb = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.round((tb - ta) / DIA);
}

type Paso = { key: string; label: string; fecha: string; icon: React.ReactNode };

export function CronologiaSection({ convocatoria, banderas = [] }: { convocatoria: any; banderas?: any[] }) {
  const c = convocatoria || {};
  const mismaPresentacion = c.fecha_inicio && c.fecha_fin && c.fecha_inicio === c.fecha_fin;
  const candidatos: (Paso | null)[] = [
    c.fecha_publicacion ? { key: "pub", label: "Convocatoria publicada", fecha: c.fecha_publicacion, icon: <FileText size={12} /> } : null,
    mismaPresentacion
      ? { key: "ofe", label: "Presentación de ofertas", fecha: c.fecha_inicio, icon: <Calendar size={12} /> }
      : c.fecha_inicio
        ? { key: "ini", label: "Inicio de presentación", fecha: c.fecha_inicio, icon: <Calendar size={12} /> }
        : null,
    !mismaPresentacion && c.fecha_fin ? { key: "fin", label: "Cierre de presentación", fecha: c.fecha_fin, icon: <Calendar size={12} /> } : null,
    c.fecha_buena_pro ? { key: "bp", label: "Buena pro", fecha: c.fecha_buena_pro, icon: <Award size={12} /> } : null,
    c.fecha_contrato ? { key: "ctr", label: "Firma del contrato", fecha: c.fecha_contrato, icon: <FilePen size={12} /> } : null,
  ];
  const steps = candidatos.filter((s): s is Paso => !!s);

  const senalPlazo = (banderas || []).find((b: any) => /plazo/i.test(String(b?.regla || "")));

  if (steps.length === 0 && !senalPlazo) return null;

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <h2 className="font-serif text-xl font-bold text-ink">Línea de tiempo del proceso</h2>
        <p className="mt-0.5 text-[12px] text-mute">
          Fechas del registro OCDS publicado por el OECE
          {c.tipo_proceso && (
            <>
              {" "}para un proceso de <strong className="font-semibold text-ink">{c.tipo_proceso}</strong>
            </>
          )}
          .
        </p>
      </div>
      {steps.length > 0 && (
        <div className="overflow-x-auto px-5 py-6">
          <ol className="flex min-w-max items-start">
            {steps.map((s, i) => {
              const siguiente = steps[i + 1];
              const gap = siguiente ? diasEntre(s.fecha, siguiente.fecha) : null;
              return (
                <li key={s.key} className="flex items-start">
                  <div className="flex w-36 flex-col items-start">
                    <div
                      className={cn(
                        "grid h-10 w-10 place-items-center rounded-full ring-4 ring-paper",
                        i === steps.length - 1 ? "bg-heroViolet text-paper" : "bg-paperDeep text-inkSoft",
                      )}
                      aria-hidden
                    >
                      {s.icon}
                    </div>
                    <div className="mt-2 text-[12px] font-semibold text-ink">{s.label}</div>
                    <div className="mt-0.5 font-mono text-xs text-inkSoft">{s.fecha}</div>
                  </div>
                  {siguiente && (
                    <div className="mt-5 flex w-20 flex-col items-center">
                      <div className="h-px w-full bg-line" />
                      {gap !== null && (
                        <span className="mt-1 text-[11px] tabular-nums text-mute">
                          {gap} {Math.abs(gap) === 1 ? "día" : "días"}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {senalPlazo && (
        <div className="border-t border-line bg-crimson-soft/60 px-5 py-3 text-[12px] leading-relaxed text-inkSoft">
          <p className="flex items-center gap-1.5 font-semibold text-crimsonTexto">
            <AlertTriangle size={12} aria-hidden /> {reglaLabel(String(senalPlazo.regla))}
          </p>
          {evidenciaComoTexto(senalPlazo.evidencia) && <p className="mt-0.5">{redactDnis(evidenciaComoTexto(senalPlazo.evidencia))}</p>}
          {senalPlazo.norma && <p className="mt-0.5 text-[11px] text-mute">Norma: {senalPlazo.norma}</p>}
        </div>
      )}
    </section>
  );
}
