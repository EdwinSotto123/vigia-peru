import { MapPin } from "lucide-react";
import { formatSoles } from "@/lib/mock-data";
import type { ProvinciaData } from "@/lib/peru-data";

export function ProvinciasBars({
  provincias,
}: {
  provincias: ProvinciaData[];
}) {
  const withData = provincias
    .filter((p) => p.alertas > 0 || p.monto > 0)
    .sort((a, b) => b.alertas - a.alertas || b.monto - a.monto)
    .slice(0, 8);

  if (withData.length === 0) {
    return (
      <div className="surface p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-clay">
          <MapPin size={11} /> Provincias
        </div>
        <p className="rounded-xl border border-dashed border-line bg-paperDeep p-4 text-center text-xs text-mute">
          Sin datos provinciales
        </p>
      </div>
    );
  }

  const maxMonto = Math.max(...withData.map((p) => p.monto));

  return (
    <div className="surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-clay">
          <MapPin size={11} /> Provincias con alertas
        </div>
        <span className="text-[10px] text-mute">
          top {withData.length}
        </span>
      </div>

      <ul className="space-y-2.5">
        {withData.map((p) => {
          const pct = (p.monto / maxMonto) * 100;
          const scoreColor =
            p.scorePromedio >= 85
              ? "#7A2E18"
              : p.scorePromedio >= 70
                ? "#B5752C"
                : "#76695A";
          return (
            <li key={p.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium text-ink">{p.nombre}</span>
                  <span
                    className="rounded px-1 py-0 text-[9px] font-bold text-paper"
                    style={{ background: scoreColor }}
                  >
                    {p.scorePromedio}
                  </span>
                </span>
                <span className="font-mono text-[10.5px] text-mute">
                  {formatSoles(p.monto)}
                </span>
              </div>
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-paperDeep">
                <div
                  className="h-full transition-all duration-700 ease-out"
                  style={{
                    width: `${pct}%`,
                    background: scoreColor,
                  }}
                />
              </div>
              <div className="mt-0.5 text-[9.5px] text-mute">
                {p.alertas} alerta{p.alertas === 1 ? "" : "s"}
                {p.convergentes > 0 && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-crimson-soft px-1.5 py-0 text-[9px] font-semibold text-rust">
                    {p.convergentes} converg.
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
