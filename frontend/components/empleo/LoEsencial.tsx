"use client";

import useSWR from "swr";
import { AlertTriangle, Award, BookOpen, Briefcase, GraduationCap, ListChecks, Sparkles } from "lucide-react";
import { Caja } from "@/components/gobserva/app/Caja";
import { PUBLIC_API_BASE } from "@/lib/auditoria";

interface Resumen {
  en_una_frase: string;
  a_quien_buscan: string;
  requisitos: { que: string; tipo: "formacion" | "experiencia" | "curso" | "conocimiento" | "otro" }[];
  competencias: string[];
  ojo: string[];
}

const ICONO = { formacion: GraduationCap, experiencia: Briefcase, curso: Award, conocimiento: BookOpen, otro: ListChecks } as const;

async function cargar(aviso: number): Promise<Resumen | null> {
  const r = await fetch(`${PUBLIC_API_BASE}/empleo/plazas/${aviso}/resumen`);
  if (!r.ok) return null;
  return ((await r.json()) as { resumen?: Resumen }).resumen ?? null;
}

/**
 * «Lo esencial» de una plaza (2026-11-08): lo que SERVIR publica en mayúsculas y amontonado, en palabras simples y
 * escrito por IA (GET /empleo/plazas/:aviso/resumen, migración 270): en una frase, a quién buscan, cada requisito, las
 * competencias y lo que suele dejar fuera a la gente. La primera vez tarda unos segundos; después queda guardado.
 */
export function LoEsencial({ aviso }: { aviso: number }) {
  const { data, isLoading } = useSWR(["empleo-resumen", aviso], () => cargar(aviso), { revalidateOnFocus: false });
  if (!isLoading && !data) return null;
  return (
    <Caja
      id="esencial"
      titulo="Lo esencial de esta plaza"
      descripcion="En palabras simples, con lo que la entidad publicó en SERVIR. Lo escribe una IA: confírmalo en las bases antes de postular."
    >
      {!data ? (
        <div aria-busy="true" aria-label="Leyendo la plaza">
          <p className="flex items-center gap-2 text-meta text-inkSoft">
            <Sparkles size={14} aria-hidden className="animate-pulse text-granate" /> Leyendo la plaza…
          </p>
          <div className="mt-3 space-y-2" aria-hidden>
            <span className="block h-4 w-11/12 animate-pulse rounded bg-ink/[0.06]" />
            <span className="block h-4 w-9/12 animate-pulse rounded bg-ink/[0.06]" />
            <span className="block h-4 w-10/12 animate-pulse rounded bg-ink/[0.06]" />
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="max-w-[70ch] text-pretty text-cuerpo leading-relaxed text-ink">{data.en_una_frase}</p>
          <div>
            <h3 className="text-cuerpo font-semibold text-ink">A quién buscan</h3>
            <p className="mt-1 max-w-[70ch] text-pretty text-dato leading-relaxed text-inkSoft">{data.a_quien_buscan}</p>
          </div>
          {data.requisitos.length > 0 && (
            <div>
              <h3 className="text-cuerpo font-semibold text-ink">Lo que piden, uno por uno</h3>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {data.requisitos.map((r) => {
                  const Icono = ICONO[r.tipo] ?? ListChecks;
                  return (
                    <li key={r.que} className="flex items-start gap-3 px-3.5 py-2.5 text-dato leading-snug text-ink">
                      <Icono size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                      <span className="min-w-0">{r.que}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {data.competencias.length > 0 && (
            <div>
              <h3 className="text-cuerpo font-semibold text-ink">Competencias que evalúan</h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {data.competencias.map((c) => (
                  <li key={c} className="rounded-full border border-line bg-paper px-3 py-1 text-meta text-inkSoft">{c}</li>
                ))}
              </ul>
            </div>
          )}
          {data.ojo.length > 0 && (
            <div className="rounded-xl border border-amber/30 bg-amber-soft/40 p-4">
              <h3 className="flex items-center gap-2 text-cuerpo font-semibold text-ink">
                <AlertTriangle size={16} aria-hidden className="text-amberTexto" /> Lo que suele dejar fuera a la gente
              </h3>
              <ul className="mt-2 space-y-1.5">
                {data.ojo.map((o) => (
                  <li key={o} className="text-dato leading-relaxed text-inkSoft">{o}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Caja>
  );
}
