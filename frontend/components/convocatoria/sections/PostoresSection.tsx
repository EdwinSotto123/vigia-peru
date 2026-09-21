"use client";

import { Award, Building2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export function PostoresSection({ postores, fmtMoney }: { postores: any[]; fmtMoney: (n: any) => string }) {
  const ganadores = postores.filter(p => p.es_ganador);
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
          <Users size={11} className="mr-1 inline" />
          Postores · {postores.length} · {ganadores.length} ganador{ganadores.length === 1 ? "" : "es"}
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Quién ofertó · Quién ganó
        </h2>
      </div>
      <ul className="divide-y divide-line">
        {postores.map((p, i) => (
          <li key={i} className="px-5 py-3">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                p.es_ganador ? "bg-heroViolet text-paper" : "bg-paperDeep text-mute",
              )}>
                {p.es_ganador ? <Award size={15} /> : <Building2 size={15} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-ink">{p.nombre}</span>
                  {p.es_ganador && (
                    <span className="rounded-full bg-heroViolet px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-paper">GANADOR</span>
                  )}
                  {p.es_consorcio && (
                    <span className="rounded-full bg-amber-soft px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-amber">CONSORCIO</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-mute">
                  <span className="font-mono">RUC {p.ruc}</span>
                  <span>·</span>
                  <span>{(p.roles || []).join(" + ")}</span>
                </div>
              </div>
              {p.monto_ganado != null && p.monto_ganado > 0 && (
                <div className="text-right">
                  <div className="font-mono text-sm font-bold text-heroViolet">{fmtMoney(p.monto_ganado)}</div>
                  <div className="text-[9px] uppercase tracking-wider text-mute">adjudicado</div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
