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
import { PulseDot } from "@/components/ui/PulseDot";
import { PUBLIC_API_BASE, haceCuanto } from "@/lib/auditoria";
import type { EstadoGlobal } from "@/lib/financiamiento";
import { useHeroMapSync } from "./HeroMapSync";

type Stats = Pick<EstadoGlobal, "colaGlobal" | "contratosFinanciados" | "senalesHalladas" | "contratosProcesados">;

export function HeroKpis({ initial, regionesConCola }: { initial: Stats | null; regionesConCola: number }) {
  const { zona, setUbigeo } = useHeroMapSync();
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

  // señalesHalladas a veces puede llegar en 0 mientras la cola recién arranca — liderar
  // con un cero justo en la promesa central del producto rompe confianza antes de los 3
  // segundos. Si eso pasa, se muestra "contratos ya leídos" (procesados), que si hay
  // actividad real siempre es positivo — nunca se inventa un número, solo se elige cuál
  // cifra real liderar.
  const senales = estado?.senalesHalladas ?? 0;
  const procesados = estado?.contratosProcesados ?? 0;
  const usarProcesados = senales === 0 && procesados > 0;

  // Antes era un <p> de texto suelto debajo de 4 tarjetas de KPI — misma inconsistencia
  // que ya se corrigió en TarjetaAliado: la única línea sin tratamiento de tarjeta al
  // lado de todo lo que sí lo tiene. Ahora es una píldora propia, mismo lenguaje que el
  // badge "Plataforma cívica" de arriba del hero (borde + fondo tintado, no texto plano).
  const actualizado = (
    <div
      className="mt-3 inline-flex items-center gap-2 rounded-full border border-moss/30 bg-moss/10 py-1.5 pl-2.5 pr-3.5 text-[11px] font-semibold uppercase tracking-wide text-moss"
      title={ahora > 0 && actualizadoAt ? `actualizado ${haceCuanto(ahora - actualizadoAt)}` : undefined}
    >
      <PulseDot color="moss" size={6} />
      Tablero público · se actualiza solo
    </div>
  );

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
        {actualizado}
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
      {actualizado}
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
