import { formatPEN, type MefBudgetRow } from "@/lib/mef";

/**
 * Gráfico evolutivo PIM vs Devengado por año (SVG, server-rendered).
 */
export function RegionEvolutionChart({
  data,
  currentYear,
}: {
  data: MefBudgetRow[];
  currentYear: number;
}) {
  const W = 720;
  const H = 240;
  const M = { t: 20, r: 24, b: 32, l: 68 };
  const w = W - M.l - M.r;
  const h = H - M.t - M.b;

  const valid = data.filter((d) => d.pim > 0);
  if (valid.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-line text-xs text-mute">
        Datos insuficientes para gráfico evolutivo
      </div>
    );
  }

  const maxY = Math.max(...valid.map((d) => d.pim));
  const stepX = valid.length > 1 ? w / (valid.length - 1) : w;

  const ptPim = (d: MefBudgetRow, i: number) => [
    M.l + i * stepX,
    M.t + h - (d.pim / maxY) * h,
  ];
  const ptDev = (d: MefBudgetRow, i: number) => [
    M.l + i * stepX,
    M.t + h - (d.devengado / maxY) * h,
  ];

  const pimPath = valid
    .map((d, i) => {
      const [x, y] = ptPim(d, i);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const devPath = valid
    .map((d, i) => {
      const [x, y] = ptDev(d, i);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const devArea = `${devPath} L ${(M.l + (valid.length - 1) * stepX).toFixed(1)} ${M.t + h} L ${M.l} ${M.t + h} Z`;

  const gridYTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid horizontal */}
      {gridYTicks.map((t) => {
        const y = M.t + h - t * h;
        return (
          <line
            key={t}
            x1={M.l}
            x2={M.l + w}
            y1={y}
            y2={y}
            stroke="#D9CFB7"
            strokeWidth={0.5}
            strokeDasharray="2 4"
          />
        );
      })}

      {/* Y-axis labels */}
      {[0, 0.5, 1].map((t) => {
        const y = M.t + h - t * h;
        return (
          <text
            key={t}
            x={M.l - 10}
            y={y + 3}
            fontSize="10"
            fill="#76695A"
            textAnchor="end"
            fontFamily="ui-monospace, monospace"
          >
            {formatPEN(maxY * t)}
          </text>
        );
      })}

      {/* Área devengado */}
      <path d={devArea} fill="#A0512D" fillOpacity="0.14" />

      {/* Línea devengado */}
      <path
        d={devPath}
        stroke="#A0512D"
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Línea PIM */}
      <path
        d={pimPath}
        stroke="#1B1611"
        strokeWidth={1.6}
        fill="none"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />

      {/* Eje X + dots */}
      {valid.map((d, i) => {
        const [xp, yp] = ptPim(d, i);
        const [xd, yd] = ptDev(d, i);
        const isCurrent = d.year === currentYear;
        return (
          <g key={d.year}>
            <text
              x={xp}
              y={M.t + h + 18}
              fontSize="11"
              fill={isCurrent ? "#1B1611" : "#76695A"}
              fontWeight={isCurrent ? 700 : 400}
              textAnchor="middle"
              fontFamily="ui-monospace, monospace"
            >
              {d.year}
              {isCurrent ? " ▾" : ""}
            </text>
            <circle cx={xp} cy={yp} r={3} fill="#1B1611" />
            <circle
              cx={xd}
              cy={yd}
              r={4}
              fill="#A0512D"
              stroke="#FAF6E9"
              strokeWidth={1.5}
            />
          </g>
        );
      })}

      {/* Leyenda */}
      <g transform={`translate(${M.l}, ${H - 6})`}>
        <line
          x1={0}
          x2={14}
          y1={0}
          y2={0}
          stroke="#1B1611"
          strokeWidth={1.6}
          strokeDasharray="5 4"
        />
        <text
          x={18}
          y={3}
          fontSize="9.5"
          fill="#76695A"
          fontFamily="ui-monospace, monospace"
        >
          PIM
        </text>
        <line
          x1={56}
          x2={70}
          y1={0}
          y2={0}
          stroke="#A0512D"
          strokeWidth={2.4}
        />
        <text
          x={74}
          y={3}
          fontSize="9.5"
          fill="#A0512D"
          fontFamily="ui-monospace, monospace"
        >
          Devengado
        </text>
      </g>
    </svg>
  );
}
