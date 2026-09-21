/**
 * Tarjeta de cifra suelta: label chico arriba, número grande abajo — mismo lenguaje
 * visual que `EstadisticaAliado` (TarjetaAliado.tsx) y que `Metric` en /app/financiar.
 * La comparten /app/aliados y /aliado/[slug] para no repetir la misma tarjeta con dos
 * recetas de clases casi idénticas (antes: `Kpi` sin sombra en una, `K` con radio y
 * padding distintos en la otra).
 *
 * El color del valor nunca es decorativo, solo representa un estado real — igual que
 * en EstadisticaAliado: "verde" = verificado/completo (mismo criterio que "Procesados"
 * ahí), "rust" = riesgo hallado (mismo criterio que "Señales halladas", solo si > 0).
 */
export function KpiTile({
  label,
  value,
  hint,
  hintTone,
  valueTone,
}: {
  label: string;
  value: number;
  hint?: string;
  hintTone?: "clay";
  valueTone?: "rust" | "verde";
}) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4 shadow-card transition-shadow hover:shadow-paper">
      <div
        className={`font-mono text-2xl font-semibold ${
          valueTone === "rust" ? "text-rust" : valueTone === "verde" ? "text-heroGreen" : "text-ink"
        }`}
      >
        {value.toLocaleString("es-PE")}
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-mute">{label}</div>
      {hint && <div className={`mt-0.5 text-[11px] ${hintTone === "clay" ? "text-clay" : "text-mute"}`}>{hint}</div>}
    </div>
  );
}
