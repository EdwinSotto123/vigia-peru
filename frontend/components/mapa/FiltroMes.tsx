"use client";

import { useMemo } from "react";
import { Calendar } from "lucide-react";
import { ultimosMeses, type RangoMes } from "./meses";

// El cálculo de meses vive en `meses.ts` (sin "use client"): /app/contratos lo usa en el servidor.
export type { RangoMes };

/**
 * Filtro rápido "¿de qué mes son estos contratos?". Acota el color del mapa y
 * las cifras del encabezado y de la ficha; el panel de la zona sigue mostrando
 * todo el histórico (lo dice la barra cuando hay un mes elegido).
 */
export function FiltroMes({ valor, onChange, meses = 12 }: {
  /** `null` = todo el histórico (sin filtro). */
  valor: RangoMes | null;
  onChange: (r: RangoMes | null) => void;
  meses?: number;
}) {
  const opciones = useMemo(() => ultimosMeses(meses), [meses]);
  return (
    <label className="inline-flex min-h-[28px] shrink-0 items-center gap-1.5 rounded-full border border-line bg-paperSoft px-3 py-1 text-xs font-medium text-inkSoft focus-within:ring-2 focus-within:ring-granate focus-within:ring-offset-1">
      <Calendar size={13} aria-hidden />
      <span className="sr-only">Mes de convocatoria</span>
      <select
        value={valor?.desde ?? ""}
        onChange={(e) => {
          const r = opciones.find((o) => o.desde === e.target.value);
          onChange(r ?? null);
        }}
        className="bg-transparent text-xs text-ink focus:outline-none"
        title="Filtrar contratos por mes de convocatoria"
      >
        <option value="">Todo el histórico</option>
        {opciones.map((o) => (
          <option key={o.desde} value={o.desde}>{o.etiqueta}</option>
        ))}
      </select>
    </label>
  );
}
