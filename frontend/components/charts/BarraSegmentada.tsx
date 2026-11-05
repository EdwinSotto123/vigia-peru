import { cn } from "@/lib/utils";

/**
 * Un todo partido en sus partes (skill dataviz, «barra segmentada fina»): sin texto encima, porque la lista de al lado ya
 * da el nombre y la cifra de cada parte; cada fila de esa lista lleva el cuadrito de su color (`MuestraSerie`). Hasta 6
 * partes con su color por orden fijo (--serie-1 … --serie-6) y el resto en «Otros» gris. 2 px de aire entre partes,
 * extremos redondeados. El nombre accesible lista cada parte con su cifra. Server-safe.
 */
export interface ParteBarra {
  clave: string;
  nombre: string;
  /** Lo que mide (procesos, soles); la barra usa la proporción. */
  valor: number;
  /** Cómo se lee la cifra en el nombre accesible y el `title` («291 procesos»). */
  texto: string;
}

export const colorSerie = (i: number | "otros") => (i === "otros" ? "rgb(var(--serie-otros))" : `rgb(var(--serie-${(i % 6) + 1}))`);

export function MuestraSerie({ i, className }: { i: number | "otros"; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-sm", className)} style={{ background: colorSerie(i) }} aria-hidden />;
}

export function BarraSegmentada({ partes, otros, etiqueta, className }: { partes: ParteBarra[]; otros?: ParteBarra | null; etiqueta: string; className?: string }) {
  const todas = [...partes.map((p, i) => ({ p, i: i as number | "otros" })), ...(otros && otros.valor > 0 ? [{ p: otros, i: "otros" as const }] : [])];
  const total = todas.reduce((t, x) => t + x.p.valor, 0);
  if (!total) return null;
  return (
    <div
      role="img"
      aria-label={`${etiqueta}: ${todas.map((x) => `${x.p.nombre}, ${x.p.texto} (${Math.round((100 * x.p.valor) / total)} %)`).join("; ")}`}
      className={cn("flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full", className)}
    >
      {todas.map((x) => (
        <span
          key={x.p.clave}
          title={`${x.p.nombre}: ${x.p.texto} (${Math.round((100 * x.p.valor) / total)} %)`}
          className="h-full min-w-[3px]"
          style={{ width: `${(100 * x.p.valor) / total}%`, background: colorSerie(x.i) }}
        />
      ))}
    </div>
  );
}

/** Una proporción contra su tope (ganó 437 de 653): la pista es un tono claro del mismo color. */
export function Medidor({ parte, etiqueta, className }: { parte: number; etiqueta: string; className?: string }) {
  const p = Math.max(0, Math.min(1, parte));
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} aria-label={etiqueta}
         className={cn("h-2 w-full overflow-hidden rounded-full", className)} style={{ background: "rgb(var(--serie-1) / 0.18)" }}>
      <span className="block h-full rounded-full" style={{ width: `${p * 100}%`, background: "rgb(var(--serie-1))" }} />
    </div>
  );
}
