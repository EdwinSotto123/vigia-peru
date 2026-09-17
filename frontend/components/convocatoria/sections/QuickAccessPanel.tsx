"use client";

import { useState } from "react";
import { Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";

export function QuickAccessPanel({
  cached,
  onSelect,
  onRunNew,
}: { cached: any[] | null; onSelect: (ocidOrCodigo: string) => void; onRunNew?: (codigo: string) => void }) {
  const loading = cached === null;
  const items = cached || [];
  const total = items.length;
  const conAlta = items.filter((it: any) => (it.n_alta || 0) > 0).length;
  const conMedia = items.filter((it: any) => (it.n_media || 0) > 0).length;
  const sinBanderas = items.filter((it: any) => (it.n_banderas || 0) === 0).length;
  const [randomLoading, setRandomLoading] = useState(false);

  // top 3 más recientes
  const top3 = [...items]
    .sort((a, b) => String(b.analizado_en || "").localeCompare(String(a.analizado_en || "")))
    .slice(0, 3);

  // Sortear convocatoria NUEVA del SEACE (no analizada) → dispara análisis
  const handleShuffleSeace = async () => {
    if (!onRunNew) return;
    setRandomLoading(true);
    try {
      const r = await fetch("/api/agent/random", { cache: "no-store" });
      const text = await r.text();
      let d: any = null;
      try { d = JSON.parse(text); } catch { /* respuesta no-JSON */ }
      if (d?.found && d.codigo_convocatoria) {
        onRunNew(d.codigo_convocatoria);
      }
    } catch { /* ignore */ }
    finally { setRandomLoading(false); }
  };

  // Sortear de analizadas (rápido, sin re-procesar)
  const handleShuffleCached = () => {
    if (items.length === 0) return;
    const pick = items[Math.floor(Math.random() * items.length)];
    onSelect(pick.codigo_convocatoria || pick.ocid);
  };

  const fmtMoney = (n: number) => {
    if (!n) return "—";
    if (n >= 1e6) return `S/. ${(n/1e6).toFixed(2)} M`;
    if (n >= 1e3) return `S/. ${(n/1e3).toFixed(0)} K`;
    return `S/. ${n.toLocaleString("es-PE")}`;
  };

  return (
    <aside className="surface flex flex-col gap-3 p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="font-serif text-base font-bold text-ink">Análisis recientes</h2>
        {!loading && (
          <span className="rounded-full bg-paperDeep px-1.5 py-0 font-mono text-[10px] font-bold text-ink">
            {total}
          </span>
        )}
      </div>

      {/* Stats compactos */}
      {!loading && total > 0 && (
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-md bg-rust/10 px-1 py-1.5">
            <div className="font-mono text-lg font-bold tabular-nums text-rust">{conAlta}</div>
            <div className="text-[9px] uppercase tracking-wider text-rust">alta</div>
          </div>
          <div className="rounded-md bg-amber/10 px-1 py-1.5">
            <div className="font-mono text-lg font-bold tabular-nums text-amber">{conMedia}</div>
            <div className="text-[9px] uppercase tracking-wider text-amber">media</div>
          </div>
          <div className="rounded-md bg-moss/10 px-1 py-1.5">
            <div className="font-mono text-lg font-bold tabular-nums text-moss">{sinBanderas}</div>
            <div className="text-[9px] uppercase tracking-wider text-moss">limpio</div>
          </div>
        </div>
      )}

      {/* Botones de sorteo */}
      {!loading && (
        <div className="space-y-1.5">
          {onRunNew && (
            <button
              type="button"
              onClick={handleShuffleSeace}
              disabled={randomLoading}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-rust px-2 py-2 text-[11px] font-bold text-paper transition-colors hover:bg-rust/90 disabled:opacity-50"
              title="Pickea una convocatoria del SEACE que aún no se analizó y dispara los agentes"
            >
              <Shuffle size={12} className={randomLoading ? "animate-spin" : ""} />
              <span>{randomLoading ? "Buscando…" : "Sortear nueva del SEACE"}</span>
            </button>
          )}
          {total > 0 && (
            <button
              type="button"
              onClick={handleShuffleCached}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-paper px-2 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:bg-paperDeep"
              title="Abrir una de las ya analizadas, al azar (sin re-procesar)"
            >
              <Shuffle size={11} />
              <span>Sortear ya analizada</span>
            </button>
          )}
        </div>
      )}

      {/* Top 3 más recientes */}
      {!loading && top3.length > 0 && (
        <div className="border-t border-line pt-3">
          <ul className="space-y-1">
            {top3.map((it: any, i: number) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onSelect(it.codigo_convocatoria || it.ocid)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-paperDeep"
                >
                  <span className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-md text-paper",
                    (it.score || 0) >= 85 ? "bg-rust" :
                    (it.score || 0) >= 70 ? "bg-clay" :
                    (it.score || 0) >= 40 ? "bg-amber" : "bg-moss",
                  )}>
                    <span className="font-mono text-[10px] font-bold leading-none">{it.score || 0}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-[10px] font-bold text-ink">{it.codigo_convocatoria}</span>
                      {(it.n_alta || 0) > 0 && (
                        <span className="rounded-full bg-rust px-1 text-[8px] font-bold text-paper">{it.n_alta}A</span>
                      )}
                    </div>
                    <div className="line-clamp-1 text-[10px] text-mute">{it.objeto || "—"}</div>
                  </div>
                  <span className="font-mono text-[9px] text-mute">{fmtMoney(it.monto)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <div key={i} className="h-7 animate-pulse rounded bg-paperDeep" />
          ))}
        </div>
      )}

      {!loading && total === 0 && (
        <p className="text-[11px] text-mute">Sin análisis previos.</p>
      )}
    </aside>
  );
}
