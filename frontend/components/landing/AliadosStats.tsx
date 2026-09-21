"use client";

/**
 * Los 3 mini-stats del hero de aliados (contratos financiados, monto, regiones). Antes se
 * quedaban solo en el HTML estático (ISR) de la landing — y en producción se vieron pegados
 * en "0 / S/0 / 0" durante días con 45 contratos ya financiados de verdad (x-nextjs-cache:
 * STALE/HIT, ambos sirviendo el mismo snapshot viejo; el revalidate en segundo plano no lo
 * estaba corrigiendo). Mismo patrón que TableroAuditoria: `initial` para el primer pintado
 * (sin JS, sin parpadeo), y un refetch al montar para nunca mostrarle a una visita real un
 * número vencido — esta sección es justamente la que vende seriedad a un donante nuevo.
 */

import { useEffect, useState } from "react";
import { NumberTicker } from "@/components/magicui/NumberTicker";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import type { EstadoGlobal } from "@/lib/financiamiento";

type Stats = Pick<EstadoGlobal, "contratosFinanciados" | "montoPen" | "regionesConAuditoria">;

export function AliadosStats({ initial }: { initial: Stats | null }) {
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
    <div className="mt-5 grid grid-cols-3 gap-2">
      <Mini v={estado?.contratosFinanciados ?? 0} l="contratos financiados" />
      <Mini v={estado?.montoPen ?? 0} l="destinados a auditoría" format="pen" />
      <Mini v={estado?.regionesConAuditoria ?? 0} l="regiones con auditoría" />
    </div>
  );
}

function Mini({ v, l, format }: { v: number; l: string; format?: "entero" | "pen" }) {
  return (
    <div className="rounded-2xl border border-line bg-paperSoft p-3 shadow-card">
      <div className="font-mono text-lg font-semibold text-ink"><NumberTicker value={v} format={format} /></div>
      <div className="text-[10px] uppercase tracking-wide text-mute">{l}</div>
    </div>
  );
}
