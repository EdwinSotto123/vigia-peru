import { AlertTriangle } from "lucide-react";
import type { Alerta } from "@/types";

const TONES = {
  alta: { color: "#7A2E18", label: "Alta" },
  media: { color: "#B5752C", label: "Media" },
  baja: { color: "#76695A", label: "Baja" },
} as const;

type Sev = keyof typeof TONES;

function topSeverity(a: Alerta): Sev {
  if (a.banderas.some((b) => b.severidad === "alta")) return "alta";
  if (a.banderas.some((b) => b.severidad === "media")) return "media";
  return "baja";
}

export function AlertasSeverityCard({ alertas }: { alertas: Alerta[] }) {
  const counts: Record<Sev, number> = { alta: 0, media: 0, baja: 0 };
  alertas.forEach((a) => {
    counts[topSeverity(a)]++;
  });
  const total = alertas.length;

  // Donut: 3 arcs sobre un círculo
  const R = 36;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const segments = (Object.keys(TONES) as Sev[]).map((k) => {
    const pct = total === 0 ? 0 : counts[k] / total;
    const len = pct * C;
    const seg = { color: TONES[k].color, dashArray: `${len} ${C}`, dashOffset: -offset };
    offset += len;
    return { ...seg, key: k };
  });

  return (
    <div className="surface p-4">
      <div className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-clay">
        <AlertTriangle size={11} /> Severidad de alertas
      </div>

      {total === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-paperDeep p-4 text-center text-xs text-mute">
          Sin alertas activas en esta región
        </p>
      ) : (
        <div className="flex items-center gap-4">
          {/* Donut */}
          <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90">
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke="#E8DFC7"
              strokeWidth="14"
            />
            {segments.map((s) => (
              <circle
                key={s.key}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth="14"
                strokeDasharray={s.dashArray}
                strokeDashoffset={s.dashOffset}
              />
            ))}
            <text
              x="50"
              y="50"
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="ui-monospace, monospace"
              fontSize="18"
              fontWeight="700"
              fill="#1B1611"
              transform="rotate(90 50 50)"
            >
              {total}
            </text>
          </svg>

          {/* Legend */}
          <ul className="flex-1 space-y-1.5">
            {(Object.keys(TONES) as Sev[]).map((k) => (
              <li
                key={k}
                className="flex items-center gap-2 text-xs"
              >
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: TONES[k].color }}
                />
                <span className="font-medium text-ink">{TONES[k].label}</span>
                <span className="ml-auto font-mono text-mute">
                  {counts[k]}{" "}
                  <span className="text-[10px]">
                    ({total === 0 ? 0 : Math.round((counts[k] / total) * 100)}%)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
