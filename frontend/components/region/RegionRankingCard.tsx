import { TrendingUp, TrendingDown, Trophy } from "lucide-react";
import { REGIONES, type RegionData } from "@/lib/peru-data";
import { formatSoles } from "@/lib/mock-data";

type Metric = {
  key: keyof Pick<RegionData, "alertas" | "convergentes" | "monto"> | "pcMonto";
  label: string;
  hint: string;
  /** "high" = más es peor, "low" = menos es peor */
  worse: "high" | "low";
  format: (v: number) => string;
};

const METRICS: Metric[] = [
  {
    key: "alertas",
    label: "Alertas activas",
    hint: "más alertas = mayor riesgo",
    worse: "high",
    format: (v) => v.toString(),
  },
  {
    key: "convergentes",
    label: "Convergencias",
    hint: "máquina + ciudadano",
    worse: "high",
    format: (v) => v.toString(),
  },
  {
    key: "monto",
    label: "Monto vigilado",
    hint: "soles bajo alerta",
    worse: "high",
    format: (v) => formatSoles(v),
  },
  {
    key: "pcMonto",
    label: "Monto per cápita",
    hint: "S/. vigilados por habitante",
    worse: "high",
    format: (v) => `S/. ${v.toFixed(0)}`,
  },
];

export function RegionRankingCard({ region }: { region: RegionData }) {
  const total = REGIONES.length;

  return (
    <div className="surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-clay">
          <Trophy size={11} /> Posición nacional
        </div>
        <span className="text-[10px] text-mute">de {total} regiones</span>
      </div>

      <ul className="space-y-2.5">
        {METRICS.map((m) => {
          const value =
            m.key === "pcMonto"
              ? region.monto / Math.max(region.poblacion, 1)
              : (region as any)[m.key];

          const sorted = [...REGIONES].sort((a, b) => {
            const va =
              m.key === "pcMonto"
                ? a.monto / Math.max(a.poblacion, 1)
                : (a as any)[m.key];
            const vb =
              m.key === "pcMonto"
                ? b.monto / Math.max(b.poblacion, 1)
                : (b as any)[m.key];
            return m.worse === "high" ? vb - va : va - vb;
          });

          const rank = sorted.findIndex((r) => r.id === region.id) + 1;
          const pctile = rank / total;
          const isBad = m.worse === "high" ? pctile <= 0.3 : pctile <= 0.3;

          return (
            <li key={m.key as string} className="flex items-center gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg font-mono text-xs font-bold ${
                  isBad
                    ? "bg-crimson-soft text-rust"
                    : "bg-paperDeep text-ink"
                }`}
              >
                <span className="leading-none">#{rank}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-ink">{m.label}</span>
                  <span className="font-mono text-xs font-semibold text-ink">
                    {m.format(value)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-mute">
                  {isBad ? (
                    <TrendingUp size={10} className="text-rust" />
                  ) : (
                    <TrendingDown size={10} className="text-moss" />
                  )}
                  <span>{m.hint}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-line pt-2 text-[10px] text-mute">
        Ranking calculado sobre todas las regiones del país.
      </p>
    </div>
  );
}
