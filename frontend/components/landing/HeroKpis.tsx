"use client";

/**
 * Las 4 cifras del hero (cola, financiados, señales/procesados, regiones). Mismo
 * problema que AliadosStats: servidas solo desde el HTML estático (ISR) de la landing,
 * se vieron pegadas en un snapshot viejo en producción (x-nextjs-cache: STALE/HIT sin
 * corregirse solo) mientras el dato real ya había avanzado. `initial` pinta rápido sin
 * JS; el refetch al montar corrige cualquier snapshot vencido para una visita real.
 *
 * `regionesConCola` NO viene del polling de `/financiamiento/estado` (ese campo del
 * backend puede desincronizarse del propio listado de `zonas` que el mapa ya muestra al
 * lado — el hero no debe poder contradecirse a sí mismo con un "0 regiones" junto a un
 * top-5 con cientos de contratos) — lo calcula HeroCompacto directamente del array real
 * de zonas y lo pasa fijo.
 *
 * Cuando hay una región elegida en el mapa (HeroMapSync), las 4 cifras cambian a las de
 * esa zona — antes el mapa y el panel de KPIs eran dos widgets sin relación.
 */

import { AlertTriangle, Coins, FileClock, MapPinned } from "lucide-react";
import { useEffect, useState } from "react";
import { NumberTicker } from "@/components/magicui/NumberTicker";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import type { EstadoGlobal } from "@/lib/financiamiento";
import { useHeroMapSync } from "./HeroMapSync";

type Stats = Pick<EstadoGlobal, "colaGlobal" | "contratosFinanciados" | "senalesHalladas" | "contratosProcesados">;

export function HeroKpis({ initial, regionesConCola }: { initial: Stats | null; regionesConCola: number }) {
  const { zona, setUbigeo } = useHeroMapSync();
  const [estado, setEstado] = useState<Stats | null>(initial);

  // Re-consulta cada 30s (solo con la pestaña visible) para que las 4 cifras nunca
  // queden pegadas en un snapshot viejo — el dato en sí es la señal de "esto está vivo",
  // no hace falta un badge aparte anunciándolo (no le servía al usuario para nada).
  useEffect(() => {
    let vivo = true;
    const cargar = () => {
      fetch(`${PUBLIC_API_BASE}/financiamiento/estado`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: Stats | null) => { if (vivo && j) setEstado(j); })
        .catch(() => {});
    };
    cargar();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") cargar(); }, 30000);
    const onVis = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { vivo = false; window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // señalesHalladas a veces puede llegar en 0 mientras la cola recién arranca — liderar
  // con un cero justo en la promesa central del producto rompe confianza antes de los 3
  // segundos. Si eso pasa, se muestra "contratos ya leídos" (procesados), que si hay
  // actividad real siempre es positivo — nunca se inventa un número, solo se elige cuál
  // cifra real liderar.
  const senales = estado?.senalesHalladas ?? 0;
  const procesados = estado?.contratosProcesados ?? 0;
  const usarProcesados = senales === 0 && procesados > 0;

  if (zona) {
    return (
      <div className="mt-6 max-w-xl">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-heroViolet">
            <MapPinned size={12} /> Mostrando: {zona.nombre}
          </span>
          <button
            type="button"
            onClick={() => setUbigeo(null)}
            className="text-[11px] font-medium text-mute underline-offset-2 transition-colors hover:text-ink hover:underline"
          >
            ‹ ver todo el Perú
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Kpi icon={<FileClock size={14} />} tint="heroViolet" v={zona.totalCola} l="contratos en cola" />
          <Kpi icon={<Coins size={14} />} tint="heroGreen" v={zona.financiados} l="financiados por aliados" />
          <Kpi icon={<AlertTriangle size={14} />} tint="rust" v={zona.senales} l="señales de riesgo halladas" />
          <Kpi icon={<MapPinned size={14} />} tint="heroViolet" v={zona.procesados} l="contratos procesados" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 max-w-xl">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Kpi icon={<FileClock size={14} />} tint="heroViolet" v={estado?.colaGlobal ?? 0} l="contratos en cola" />
        <Kpi icon={<Coins size={14} />} tint="heroGreen" v={estado?.contratosFinanciados ?? 0} l="financiados por aliados" />
        {usarProcesados ? (
          <Kpi icon={<FileClock size={14} />} tint="heroGreen" v={procesados} l="contratos ya leídos" />
        ) : (
          <Kpi icon={<AlertTriangle size={14} />} tint="rust" v={senales} l="señales de riesgo halladas" />
        )}
        <Kpi icon={<MapPinned size={14} />} tint="heroViolet" v={regionesConCola} l="regiones con contratos" />
      </div>
    </div>
  );
}

const TINTS = {
  heroViolet: "bg-heroViolet/10 text-heroViolet",
  heroGreen: "bg-heroGreen/10 text-heroGreen",
  rust: "bg-rust/10 text-rust",
} as const;

function Kpi({ icon, tint, v, l }: { icon: React.ReactNode; tint: keyof typeof TINTS; v: number; l: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-3 shadow-card">
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${TINTS[tint]}`}>{icon}</span>
      <div className="mt-2 font-mono text-xl font-bold text-ink"><NumberTicker value={v} /></div>
      <div className="mt-0.5 text-[11px] leading-tight text-mute">{l}</div>
    </div>
  );
}
