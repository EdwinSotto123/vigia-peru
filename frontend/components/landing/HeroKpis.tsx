"use client";

/**
 * Las 4 cifras del hero (cola, financiados, señales, regiones). Mismo problema que
 * AliadosStats: servidas solo desde el HTML estático (ISR) de la landing, se vieron
 * pegadas en un snapshot viejo en producción (x-nextjs-cache: STALE/HIT sin corregirse
 * solo) mientras el dato real ya había avanzado. `initial` pinta rápido sin JS; el
 * refetch al montar corrige cualquier snapshot vencido para una visita real.
 */

import { AlertTriangle, Coins, FileClock, MapPinned } from "lucide-react";
import { useEffect, useState } from "react";
import { NumberTicker } from "@/components/magicui/NumberTicker";
import { PulseDot } from "@/components/ui/PulseDot";
import { PUBLIC_API_BASE, haceCuanto } from "@/lib/auditoria";
import type { EstadoGlobal } from "@/lib/financiamiento";

type Stats = Pick<EstadoGlobal, "colaGlobal" | "contratosFinanciados" | "senalesHalladas" | "regionesConCola">;

export function HeroKpis({ initial }: { initial: Stats | null }) {
  const [estado, setEstado] = useState<Stats | null>(initial);
  const [actualizadoAt, setActualizadoAt] = useState<number | null>(initial != null ? Date.now() : null);
  const [ahora, setAhora] = useState(0); // 0 hasta montar: el HTML del servidor no lleva cronómetros

  // Se re-consulta cada 30s (solo con la pestaña visible) para que "se actualiza solo"
  // sea literal, no solo el fix de snapshot-viejo del primer fetch.
  useEffect(() => {
    let vivo = true;
    const cargar = () => {
      fetch(`${PUBLIC_API_BASE}/financiamiento/estado`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: Stats | null) => { if (vivo && j) { setEstado(j); setActualizadoAt(Date.now()); } })
        .catch(() => {});
    };
    cargar();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") cargar(); }, 30000);
    const onVis = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { vivo = false; window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  useEffect(() => {
    setAhora(Date.now());
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="mt-8 max-w-xl">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Kpi icon={<FileClock size={14} />} tint="heroViolet" v={estado?.colaGlobal ?? 0} l="contratos en cola" />
        <Kpi icon={<Coins size={14} />} tint="heroGreen" v={estado?.contratosFinanciados ?? 0} l="financiados por aliados" />
        <Kpi icon={<AlertTriangle size={14} />} tint="rust" v={estado?.senalesHalladas ?? 0} l="señales de riesgo halladas" />
        <Kpi icon={<MapPinned size={14} />} tint="heroViolet" v={estado?.regionesConCola ?? 0} l="regiones con contratos" />
      </div>
      <p
        className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-mute"
        title={ahora > 0 && actualizadoAt ? `actualizado ${haceCuanto(ahora - actualizadoAt)}` : undefined}
      >
        <PulseDot color="moss" size={6} />
        Tablero público · se actualiza solo
      </p>
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
