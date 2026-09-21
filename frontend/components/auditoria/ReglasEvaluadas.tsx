"use client";

/**
 * "N reglas evaluadas · M señales": lista plegable de las reglas deterministas del perfil que
 * corrieron en este análisis — las que dispararon (señal) y las que NO (verde). Las señales de
 * agentes LLM (legal, prensa, mercado) se listan aparte como "otras señales".
 *
 * Datos: GET /financiamiento/procesamientos/reglas?perfil= (JSON estático) + banderas del resultado.
 */

import { useEffect, useState } from "react";
import { ChevronDown, Check, AlertTriangle, ListChecks } from "lucide-react";
import { getReglasPerfil, reglaLabel, type ReglasPerfil, type SenalRiesgo } from "@/lib/auditoria";

interface Props {
  perfil: string | null | undefined;
  senales: SenalRiesgo[];
  reglasDisparadas?: string[] | null;
  enRevision?: boolean;
  compacto?: boolean;
}

const cache = new Map<string, ReglasPerfil>();

export function ReglasEvaluadas({ perfil, senales, reglasDisparadas, enRevision = false, compacto = false }: Props) {
  const key = (perfil ?? "bienes").toLowerCase();
  const [data, setData] = useState<ReglasPerfil | null>(cache.get(key) ?? null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (cache.has(key)) { setData(cache.get(key)!); return; }
    let vivo = true;
    getReglasPerfil(key).then((r) => { if (r && vivo) { cache.set(key, r); setData(r); } });
    return () => { vivo = false; };
  }, [key]);

  if (!data) return null;
  const disparadas = new Set<string>([...(reglasDisparadas ?? []), ...senales.map((s) => s.regla)]);
  const reglas = data.reglas;
  const nSenales = reglas.filter((r) => disparadas.has(r.id)).length;
  const otras = senales.filter((s) => !reglas.some((r) => r.id === s.regla));
  const total = reglas.length;

  return (
    <div className={`rounded-xl border border-line bg-paperSoft ${compacto ? "text-[11px]" : "text-[12px]"}`}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls="reglas-evaluadas"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
          <ListChecks size={13} className="text-heroViolet" aria-hidden />
          {total} reglas evaluadas · {enRevision ? `${nSenales} en revisión` : `${nSenales} señal${nSenales === 1 ? "" : "es"}`}
          {otras.length > 0 && !enRevision && <span className="font-normal text-mute">· {otras.length} de agentes</span>}
        </span>
        <ChevronDown size={14} className={`shrink-0 text-mute transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {abierto && (
        <div id="reglas-evaluadas" className="border-t border-line px-3 py-2">
          <p className="mb-2 text-[11px] text-mute">
            Reglas deterministas del perfil <span className="font-mono">{data.perfil}</span> (v{data.version}). Cada una corrió sobre el registro OCDS, el expediente y las fuentes oficiales; las que no dispararon también cuentan: dicen qué se descartó.
          </p>
          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2" aria-label="Reglas evaluadas">
            {[...reglas].sort((a, b) => Number(disparadas.has(b.id)) - Number(disparadas.has(a.id)) || a.etiqueta.localeCompare(b.etiqueta)).map((r) => {
              const on = disparadas.has(r.id);
              return (
                <li key={r.id} className="flex items-start gap-1.5 py-0.5" title={r.descripcion}>
                  {on ? <AlertTriangle size={12} className="mt-0.5 shrink-0 text-rust" aria-hidden /> : <Check size={12} className="mt-0.5 shrink-0 text-moss" aria-hidden />}
                  <span className={on ? "font-medium text-ink" : "text-mute"}>
                    {r.etiqueta}
                    <span className="sr-only">{on ? " (señal)" : " (sin señal)"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {otras.length > 0 && (
            <div className="mt-2 border-t border-line pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-mute">Otras señales (agentes de lectura, prensa y mercado)</div>
              <ul className="mt-1 space-y-0.5">
                {otras.map((s, i) => (
                  <li key={`${s.regla}-${i}`} className="flex items-start gap-1.5" title={data.otrasSenales[s.regla]?.descripcion}>
                    <AlertTriangle size={12} className="mt-0.5 shrink-0 text-rust" aria-hidden />
                    <span className="text-ink">{data.otrasSenales[s.regla]?.etiqueta ?? reglaLabel(s.regla)}</span>
                    {s.agente && <span className="text-[10px] text-mute">· {s.agente.replace(/_agent$/, "").replace(/_/g, " ")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
