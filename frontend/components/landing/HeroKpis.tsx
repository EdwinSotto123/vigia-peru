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
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import type { EstadoGlobal } from "@/lib/financiamiento";

type Stats = Pick<EstadoGlobal, "colaGlobal" | "contratosFinanciados" | "senalesHalladas" | "regionesConCola">;

export function HeroKpis({ initial }: { initial: Stats | null }) {
  const [estado, setEstado] = useState<Stats | null>(initial);

  useEffect(() => {
    let vivo = true;
    fetch(`${PUBLIC_API_BASE}/financiamiento/estado`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Stats | null) => { if (vivo && j) setEstado(j); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  return (
    <div className="mt-8 grid max-w-xl grid-cols-2 gap-2.5 sm:grid-cols-4">
      <Kpi icon={<FileClock size={14} />} tint="heroViolet" v={estado?.colaGlobal ?? 0} l="contratos en cola" />
      <Kpi icon={<Coins size={14} />} tint="heroGreen" v={estado?.contratosFinanciados ?? 0} l="financiados por aliados" />
      <Kpi icon={<AlertTriangle size={14} />} tint="rust" v={estado?.senalesHalladas ?? 0} l="señales de riesgo halladas" />
      <Kpi icon={<MapPinned size={14} />} tint="heroViolet" v={estado?.regionesConCola ?? 0} l="regiones con contratos" />
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
    <div className="rounded-2xl border border-line bg-paper p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card">
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${TINTS[tint]}`}>{icon}</span>
      <div className="mt-2 font-mono text-xl font-bold text-ink"><NumberTicker value={v} /></div>
      <div className="mt-0.5 text-[11px] leading-tight text-mute">{l}</div>
    </div>
  );
}
