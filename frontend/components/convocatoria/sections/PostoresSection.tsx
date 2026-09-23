"use client";

import { Award, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PersonName, Ruc, esPersonaNatural } from "../../Redact";

/** Roles OCDS → castellano. "tenderer + supplier" no le dice nada a nadie. */
const ROL: Record<string, string> = {
  tenderer: "postor",
  supplier: "adjudicatario",
  buyer: "entidad compradora",
  procuringEntity: "entidad convocante",
  payer: "pagador",
};

function rolesLegibles(roles: unknown): string | null {
  if (!Array.isArray(roles) || roles.length === 0) return null;
  const txt = Array.from(new Set(roles.map((r) => ROL[String(r)] ?? String(r).replace(/_/g, " "))));
  return txt.join(" y ");
}

export function PostoresSection({ postores, fmtMoney }: { postores: any[]; fmtMoney: (n: any) => string }) {
  const ganadores = postores.filter(p => p.es_ganador);
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <h2 className="font-serif text-xl font-bold text-ink">
          Quién ofertó y quién ganó
        </h2>
        <p className="mt-0.5 text-[12px] text-mute">
          {postores.length} postor{postores.length === 1 ? "" : "es"}, {ganadores.length} ganador{ganadores.length === 1 ? "" : "es"}
        </p>
      </div>
      <ul className="divide-y divide-line">
        {postores.map((p, i) => {
          const natural = esPersonaNatural(p.ruc);
          const roles = rolesLegibles(p.roles);
          return (
            <li key={i} className="px-5 py-3">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  p.es_ganador ? "bg-heroViolet text-paper" : "bg-paperDeep text-mute",
                )}>
                  {p.es_ganador ? <Award size={15} aria-hidden /> : <Building2 size={15} aria-hidden />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {/* Persona natural con negocio (RUC 10): su nombre viene en
                          orden SUNAT y se tapa el apellido materno. Empresa: tal cual. */}
                      {natural ? <PersonName name={p.nombre} orden="sunat" /> : p.nombre}
                    </span>
                    {p.es_ganador && (
                      <span className="rounded-full bg-heroViolet px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-paper">Ganador</span>
                    )}
                    {p.es_consorcio && (
                      <span className="rounded-full bg-amber-soft px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-amberTexto">Consorcio</span>
                    )}
                    {natural && (
                      <span className="rounded-full bg-paperDeep px-1.5 py-0 text-[9px] font-medium text-mute">persona natural</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-mute">
                    {p.ruc && <span className="font-mono">RUC <Ruc value={p.ruc} /></span>}
                    {roles && <span>{roles}</span>}
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
          );
        })}
      </ul>
    </section>
  );
}
