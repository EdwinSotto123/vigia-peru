"use client";

import { useMemo } from "react";
import { Calendar } from "lucide-react";

export interface RangoMes { desde: string; hasta: string; etiqueta: string }

const NOMBRES_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Año y mes de `fecha` EN LIMA. Los contratos se fechan en hora peruana, y este
 * componente se renderiza dos veces: en el servidor (UTC) y en el navegador.
 * Con `getMonth()` a secas, entre las 19:00 y la medianoche del último día del
 * mes el servidor ya estaba en el mes siguiente y el navegador no: dos listas
 * distintas y un error de hidratación. Con la zona fija, las dos coinciden.
 */
function anioMesEnLima(fecha: Date): { y: number; m: number } {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", year: "numeric", month: "numeric" }).formatToParts(fecha);
  const y = Number(partes.find((p) => p.type === "year")?.value);
  const m = Number(partes.find((p) => p.type === "month")?.value) - 1;
  return Number.isFinite(y) && Number.isFinite(m) ? { y, m } : { y: fecha.getUTCFullYear(), m: fecha.getUTCMonth() };
}

/** Últimos `n` meses (el actual primero, en hora de Lima), como rango [primer día, último día]. */
export function ultimosMeses(n = 12, hoy = new Date()): RangoMes[] {
  const { y: y0, m: m0 } = anioMesEnLima(hoy);
  const out: RangoMes[] = [];
  const pad = (x: number) => String(x).padStart(2, "0");
  for (let i = 0; i < n; i++) {
    const total = y0 * 12 + m0 - i;
    const y = Math.floor(total / 12);
    const m = total % 12;
    // Día 0 del mes siguiente = último día de este. En UTC, para no depender de la zona del proceso.
    const ultimoDia = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    out.push({
      desde: `${y}-${pad(m + 1)}-01`,
      hasta: `${y}-${pad(m + 1)}-${pad(ultimoDia)}`,
      etiqueta: `${NOMBRES_MES[m]} ${y}`,
    });
  }
  return out;
}

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
