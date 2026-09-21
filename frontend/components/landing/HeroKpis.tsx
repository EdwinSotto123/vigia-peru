"use client";

/**
 * Las 4 cifras del hero (cola, financiados, señales, regiones). Mismo problema que
 * AliadosStats: servidas solo desde el HTML estático (ISR) de la landing, se vieron
 * pegadas en un snapshot viejo en producción (x-nextjs-cache: STALE/HIT sin corregirse
 * solo) mientras el dato real ya había avanzado. `initial` pinta rápido sin JS; el
 * refetch al montar corrige cualquier snapshot vencido para una visita real.
 */

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
    <div className="mt-8 grid max-w-xl grid-cols-2 divide-x divide-line rounded-2xl border border-line bg-paperSoft sm:grid-cols-4">
      <Kpi v={estado?.colaGlobal ?? 0} l="contratos en cola" />
      <Kpi v={estado?.contratosFinanciados ?? 0} l="financiados por aliados" />
      <Kpi v={estado?.senalesHalladas ?? 0} l="señales de riesgo halladas" />
      <Kpi v={estado?.regionesConCola ?? 0} l="regiones con contratos" />
    </div>
  );
}

function Kpi({ v, l }: { v: number; l: string }) {
  return (
    <div className="px-4 py-3">
      <div className="font-mono text-xl font-bold text-ink"><NumberTicker value={v} /></div>
      <div className="mt-0.5 text-[11px] leading-tight text-mute">{l}</div>
    </div>
  );
}
