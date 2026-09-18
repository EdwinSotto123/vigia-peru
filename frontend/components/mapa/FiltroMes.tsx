"use client";

import { useMemo } from "react";
import { Calendar } from "lucide-react";

export interface RangoMes { desde: string; hasta: string; etiqueta: string }

const NOMBRES_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Últimos `n` meses (el actual primero), como rango [primer día, último día]. */
export function ultimosMeses(n = 12, hoy = new Date()): RangoMes[] {
  const out: RangoMes[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const y = d.getFullYear(), m = d.getMonth();
    const ultimoDia = new Date(y, m + 1, 0).getDate();
    const pad = (x: number) => String(x).padStart(2, "0");
    out.push({
      desde: `${y}-${pad(m + 1)}-01`,
      hasta: `${y}-${pad(m + 1)}-${pad(ultimoDia)}`,
      etiqueta: `${NOMBRES_MES[m]} ${y}`,
    });
  }
  return out;
}

/**
 * Filtro rápido "¿de qué mes son estos contratos?" — antes no había ninguna forma de acotar
 * por fecha en el mapa; todo se veía siempre mezclado, sin decir de cuándo es cada cosa.
 */
export function FiltroMes({ valor, onChange, meses = 12 }: {
  /** `null` = todo el histórico (sin filtro). */
  valor: RangoMes | null;
  onChange: (r: RangoMes | null) => void;
  meses?: number;
}) {
  const opciones = useMemo(() => ultimosMeses(meses), [meses]);
  return (
    <label className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paperSoft px-3 py-1.5 text-xs font-medium text-mute">
      <Calendar size={13} />
      <select
        value={valor?.desde ?? ""}
        onChange={(e) => {
          const r = opciones.find((o) => o.desde === e.target.value);
          onChange(r ?? null);
        }}
        className="bg-transparent text-xs text-ink outline-none"
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
