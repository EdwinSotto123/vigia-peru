"use client";

export interface MiniBarItem {
  label: string;
  value: number;
  hint?: string;
}

export function MiniBars({
  items,
  color = "#A0512D",
  formatValue = (v) => v.toLocaleString("es-PE"),
}: {
  items: MiniBarItem[];
  color?: string;
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <ul className="space-y-2.5">
      {items.map((it) => {
        const pct = (it.value / max) * 100;
        return (
          <li key={it.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="truncate font-medium text-ink">{it.label}</span>
              <span className="font-mono text-mute">{formatValue(it.value)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-paperEdge">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${color}, ${color}cc)`,
                }}
              />
            </div>
            {it.hint && (
              <div className="mt-0.5 text-[10px] text-mute">{it.hint}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
