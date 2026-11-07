"use client";

import { X } from "lucide-react";
import { nombreRegion, nombreTipo } from "@/lib/licitaciones";
import { CONSULTAS, type FiltrosBandeja } from "@/lib/licitaciones-app/filtros";
import { useLista } from "@/lib/licitaciones-app/useListaUrl";
import { solesCompacto } from "@/lib/formato";

interface Chip {
  clave: string;
  texto: string;
  quitar: Partial<FiltrosBandeja>;
}

/** Lo que está filtrando ahora, cada cosa con su X para quitarla. Nada puesto: no se muestra. */
export function Chips() {
  const { filtros: f, ir, limpiar } = useLista();
  const chips: Chip[] = [
    ...(f.q ? [{ clave: "q", texto: `«${f.q}»`, quitar: { q: "" } }] : []),
    ...f.tipo.map((t) => ({ clave: `t-${t}`, texto: nombreTipo(t), quitar: { tipo: f.tipo.filter((x) => x !== t) } })),
    ...f.region.map((r) => ({ clave: `r-${r}`, texto: nombreRegion(r), quitar: { region: f.region.filter((x) => x !== r) } })),
    ...(f.proc ? [{ clave: "proc", texto: f.proc, quitar: { proc: "" } }] : []),
    ...(f.min != null || f.max != null
      ? [{ clave: "valor", texto: [f.min != null ? `Desde ${solesCompacto(f.min)}` : "", f.max != null ? `hasta ${solesCompacto(f.max)}` : ""].join(" ").trim(), quitar: { min: null, max: null } }]
      : []),
    ...(f.cons ? [{ clave: "cons", texto: CONSULTAS.find((c) => c.clave === f.cons)?.etiqueta ?? "", quitar: { cons: null } }] : []),
    ...(f.pub !== 30 ? [{ clave: "pub", texto: `Últimos ${f.pub} días`, quitar: { pub: 30 as const } }] : []),
    ...(f.senal ? [{ clave: "senal", texto: "Con señales de riesgo", quitar: { senal: false } }] : []),
  ];
  if (!chips.length) return null;
  return (
    <div role="group" aria-label="Filtros puestos" className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <button
          key={c.clave}
          type="button"
          onClick={() => ir(c.quitar)}
          aria-label={`Quitar el filtro ${c.texto}`}
          className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border border-line bg-ink/[0.04] pl-3 pr-1.5 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
        >
          <span className="min-w-0 truncate">{c.texto}</span>
          <X size={14} aria-hidden className="shrink-0 text-inkSoft" />
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={limpiar} className="min-h-8 px-2 text-meta font-semibold text-granate underline-offset-4 hover:underline">
          Quitar todos
        </button>
      )}
    </div>
  );
}
