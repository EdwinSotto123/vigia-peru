/**
 * Gauge semicircular del puntaje (0–100) con los umbrales 40 / 70 marcados.
 * SVG a mano, sin librerías; sirve en server y client components.
 *
 * Colores por clase de Tailwind (`stroke-*`, `fill-*`), no hex: son los tokens de severidad.
 * El tramo bajo va en gris, no en verde: el verde es "sin señales" (DESIGN_SYSTEM.md §10.1), y
 * un puntaje bajo CON señales no es un resultado limpio ("Riesgo bajo" = señales de poco
 * peso). Quien lo usa no lo muestra sin las señales que lo expliquen.
 */

import { riesgoDe } from "@/lib/contratos";

interface Props {
  score: number | null;
  size?: number;      // ancho en px (alto = size / 2 + 14)
  className?: string;
}

const TRAZO: Record<ReturnType<typeof riesgoDe>, string> = {
  alto: "stroke-rust",
  medio: "stroke-amber",
  bajo: "stroke-mute",
  sin_analizar: "stroke-mute",
};

// Las mismas palabras que las listas (lib/severidad: "Riesgo alto · medio · bajo").
const ROTULO: Record<ReturnType<typeof riesgoDe>, string> = {
  alto: "riesgo alto",
  medio: "riesgo medio",
  bajo: "riesgo bajo",
  sin_analizar: "sin puntaje",
};

function arco(cx: number, cy: number, r: number, desde: number, hasta: number): string {
  // ángulos en grados sobre el semicírculo superior: 180° (izquierda) → 0° (derecha)
  const a = (Math.PI * (180 - desde)) / 180;
  const b = (Math.PI * (180 - hasta)) / 180;
  const x1 = cx + r * Math.cos(a), y1 = cy - r * Math.sin(a);
  const x2 = cx + r * Math.cos(b), y2 = cy - r * Math.sin(b);
  const grande = hasta - desde > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${grande} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function ScoreGauge({ score, size = 132, className = "" }: Props) {
  const w = size, cx = w / 2, r = w / 2 - 10, cy = r + 8, h = cy + 16;
  const s = score == null ? null : Math.max(0, Math.min(100, score));
  const riesgo = riesgoDe(s);
  const pct = s ?? 0;
  const label = ROTULO[riesgo];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Puntaje ${s ?? "sin dato"} de 100: ${label}`} className={className}>
      {/* pista con los tres tramos (umbrales 40 y 70) */}
      <path d={arco(cx, cy, r, 0, 40 * 1.8)} fill="none" className="stroke-mute" strokeOpacity={0.18} strokeWidth={9} strokeLinecap="butt" />
      <path d={arco(cx, cy, r, 40 * 1.8, 70 * 1.8)} fill="none" className="stroke-amber" strokeOpacity={0.18} strokeWidth={9} strokeLinecap="butt" />
      <path d={arco(cx, cy, r, 70 * 1.8, 180)} fill="none" className="stroke-rust" strokeOpacity={0.18} strokeWidth={9} strokeLinecap="butt" />
      {/* valor */}
      {s != null && s > 0 && (
        <path d={arco(cx, cy, r, 0, Math.max(2, pct * 1.8))} fill="none" className={TRAZO[riesgo]} strokeWidth={9} strokeLinecap="round" />
      )}
      {/* marcas de umbral */}
      {[40, 70].map((u) => {
        const a = (Math.PI * (180 - u * 1.8)) / 180;
        const x1 = cx + (r - 8) * Math.cos(a), y1 = cy - (r - 8) * Math.sin(a);
        const x2 = cx + (r + 8) * Math.cos(a), y2 = cy - (r + 8) * Math.sin(a);
        return <line key={u} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-paper" strokeWidth={2} />;
      })}
      <text x={cx} y={cy - 2} textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize={s == null ? 13 : w * 0.24} fontWeight={s == null ? 500 : 700} className={s == null ? "fill-mute" : "fill-ink"}>
        {s == null ? "Sin dato" : Math.round(s)}
      </text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize={11} className="fill-mute">
        {label}
      </text>
    </svg>
  );
}
