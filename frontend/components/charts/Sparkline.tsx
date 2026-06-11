"use client";

export function Sparkline({
  values,
  width = 220,
  height = 56,
  color = "#A0512D",
  labels,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  labels?: string[];
}) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = 0;
  const pad = 4;
  const w = width;
  const h = height;
  const stepX = (w - pad * 2) / Math.max(values.length - 1, 1);
  const scaleY = (v: number) =>
    h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);

  const points = values.map((v, i) => [pad + i * stepX, scaleY(v)] as const);
  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${path} L${pad + (values.length - 1) * stepX},${h - pad} L${pad},${h - pad} Z`;
  const last = points[points.length - 1];
  const gradId = `spark-grad-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg width={w} height={h + (labels ? 14 : 0)} className="block">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i === points.length - 1 ? 3.5 : 2}
          fill={i === points.length - 1 ? "#F4EEDD" : color}
          stroke={color}
          strokeWidth={i === points.length - 1 ? 2 : 0}
        />
      ))}
      {last && (
        <text
          x={last[0] - 6}
          y={last[1] - 8}
          fill="#1B1611"
          fontSize="10"
          textAnchor="end"
          fontFamily="JetBrains Mono, ui-monospace, monospace"
          fontWeight="600"
        >
          {values[values.length - 1]}
        </text>
      )}
      {labels && (
        <g>
          {labels.map((l, i) => (
            <text
              key={l}
              x={pad + i * stepX}
              y={h + 10}
              fill="#76695A"
              fontSize="9"
              textAnchor="middle"
            >
              {l}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
}
