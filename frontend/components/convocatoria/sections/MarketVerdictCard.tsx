"use client";

import { Coins, Receipt, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { VEREDICTO_VISUAL } from "../constants";

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "ink" | "rust" | "amber" | "moss" }) {
  const cls = {
    ink:   "border-line bg-paperSoft text-ink",
    rust:  "border-rust/30 bg-crimson-soft text-rust",
    amber: "border-amber/40 bg-amber-soft text-amber",
    moss:  "border-moss/30 bg-paperSoft text-moss",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-2.5", cls)}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-mute">{label}</span>
        {icon}
      </div>
      <div className="mt-0.5 font-mono text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

export function MarketVerdictCard({ market, fmtMoney }: { market: any; fmtMoney: (n: any) => string }) {
  const v = VEREDICTO_VISUAL[market.veredicto_global] || VEREDICTO_VISUAL.estimacion;
  // Fallback: si el LLM no llenó total_estimado_mercado, lo calculamos desde
  // los findings sumando mediana × cantidad por sub-item.
  const computedTotalMercado = (() => {
    if (typeof market.total_estimado_mercado === "number" && market.total_estimado_mercado > 0)
      return market.total_estimado_mercado;
    const findings = market?.findings || [];
    let total = 0;
    let hits = 0;
    for (const f of findings) {
      if (typeof f.costo_total_mercado_estimado === "number") {
        total += f.costo_total_mercado_estimado;
        hits++;
      } else if (typeof f.precio_mediana_mercado === "number" && typeof f.cantidad === "number") {
        total += f.precio_mediana_mercado * f.cantidad;
        hits++;
      }
    }
    return hits > 0 ? total : null;
  })();
  // Rango AGREGADO del lote para el veredicto: Σ(cantidad × precio mín) y Σ(cantidad × máx)
  // por sub-ítem (mismo criterio que la tabla). Da el piso y el techo de mercado del lote.
  const mercadoRango = (() => {
    const findings = market?.findings || [];
    let lo = 0, hi = 0, hits = 0;
    for (const f of findings) {
      const med = f.precio_mediana_mercado, cant = f.cantidad;
      if (typeof med === "number" && typeof cant === "number") {
        lo += (typeof f.rango_min === "number" ? f.rango_min : med) * cant;
        hi += (typeof f.rango_max === "number" ? f.rango_max : med) * cant;
        hits++;
      }
    }
    return hits > 0 && hi > lo ? { lo, hi } : null;
  })();
  return (
    <section className={cn("rounded-2xl border p-5 shadow-card", v.bg)}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className={cn("inline-flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest", v.color)}>
            <Receipt size={11} /> Veredicto global · tasación vs mercado
          </div>
          <h2 className="mt-1 font-serif text-2xl font-bold text-ink">{v.emoji} {v.label}</h2>
          {typeof market.n_items === "number" && market.n_items > 0 && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-line bg-paper/70 px-2.5 py-0.5 text-[11px] text-ink">
              <span className="font-mono font-bold">{market.n_con_mediana ?? 0}/{market.n_items}</span>
              <span className="text-mute">ítems con precio de mercado</span>
              {typeof market.cobertura_mercado === "number" && (
                <span className={cn("font-mono font-bold",
                  market.cobertura_mercado >= 0.7 ? "text-moss" :
                  market.cobertura_mercado >= 0.5 ? "text-clay" : "text-rust")}>
                  · {Math.round(market.cobertura_mercado * 100)}%
                </span>
              )}
            </div>
          )}
        </div>
        {typeof market.sobreprecio_abs === "number" && market.sobreprecio_abs > 0 && (
          <div className="text-right">
            <div className={cn("font-mono text-2xl font-bold", v.color)}>
              +{fmtMoney(market.sobreprecio_abs)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-mute">
              sobreprecio detectado ({(market.sobreprecio_pct ?? 0).toFixed(1)}%)
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Kpi
          icon={<Coins size={14} />}
          label="Total ofertado"
          value={fmtMoney(market.total_ofertado ?? market?.padre_lote?.cuantia_total)}
          tone="ink"
        />
        <Kpi
          icon={<Coins size={14} />}
          label={typeof market.total_estimado_mercado === "number" && market.total_estimado_mercado > 0
            ? "Estimado de mercado (mediana)"
            : "Estimado de mercado (mediana, suma de sub-ítems)"}
          value={fmtMoney(computedTotalMercado)}
          tone="ink"
        />
      </div>
      {mercadoRango && (
        <div className="mt-2 rounded-lg bg-paper/70 px-3 py-2 text-center text-[11px] text-mute">
          Rango de mercado del lote (Σ cantidad × precio):{" "}
          <span className="font-mono font-bold text-heroViolet">mín {fmtMoney(mercadoRango.lo)}</span>
          <span className="text-mute"> · </span>
          <span className="font-mono font-bold text-heroViolet">máx {fmtMoney(mercadoRango.hi)}</span>
        </div>
      )}
      {(() => {
        const totalOfertado = market.total_ofertado ?? market?.padre_lote?.cuantia_total;
        // El backend (analyze_market_sharded + juez de plausibilidad) YA decide si el lote es
        // comparable: si dejó `sobreprecio_pct` en null es porque no lo es (cobertura insuficiente
        // frente al total REAL de ítems del requerimiento — que puede ser mucho mayor que los pocos
        // que el parser logró desglosar —, o una comparación que el juez marcó implausible;
        // `motivo_no_verificable` dice cuál). Antes el front IGNORABA esa decisión y volvía a sumar
        // mediana×cantidad desde `findings` con su propio umbral de 70% sobre `cobertura_mercado`
        // (que mide cobertura de los ítems EXTRAÍDOS, no del total real) — así resucitaba, con otro
        // número, el mismo "+105% LOTE MUY ELEVADO" que el backend ya había descartado por falso.
        const backendDecidioNoVerificable = market.veredicto_global === "no_verificable" || market.sobreprecio_pct === null;
        if (backendDecidioNoVerificable && (market.motivo_no_verificable || market.veredicto_global === "no_verificable")) {
          return (
            <div className="mt-2 rounded-lg bg-paper/70 px-3 py-2 text-[11px] text-mute">
              <span className="font-semibold text-clay">No verificable: </span>
              {market.motivo_no_verificable
                ? `${market.motivo_no_verificable}.`
                : "cobertura de mercado insuficiente frente al total de ítems del requerimiento."}
              {typeof market.n_con_mediana === "number" && typeof market.n_items === "number"
                ? ` (${market.n_con_mediana}/${market.n_items} ítems desglosados tienen precio — no necesariamente todo el requerimiento.)` : ""}
              {" "}Sin veredicto de sobreprecio, para no emitir una señal falsa.
            </div>
          );
        }
        if (typeof market.sobreprecio_pct === "number" && typeof totalOfertado === "number" && totalOfertado > 0) {
          // El backend ya calculó esto (mismo criterio, cobertura ya validada) — se muestra tal cual,
          // sin recalcularlo en el cliente.
          const diffAbs = typeof market.sobreprecio_abs === "number" ? market.sobreprecio_abs : totalOfertado - (computedTotalMercado ?? 0);
          return (
            <div className="mt-2 rounded-lg bg-paper/70 px-3 py-2 text-[11px] text-ink">
              <span className="text-mute">Diferencia ofertado vs mercado: </span>
              <span className={cn("font-mono font-bold",
                market.sobreprecio_pct > 15 ? "text-rust" : market.sobreprecio_pct < -15 ? "text-clay" : "text-moss")}>
                {diffAbs > 0 ? "+" : ""}{fmtMoney(diffAbs)} ({market.sobreprecio_pct > 0 ? "+" : ""}{market.sobreprecio_pct.toFixed(1)}%)
              </span>
            </div>
          );
        }
        // Sin `sobreprecio_pct` del backend (formato de análisis viejo, sin este campo todavía):
        // se recalcula en el cliente, con el mismo resguardo de cobertura ≥ 70% de antes.
        if (typeof computedTotalMercado !== "number" || typeof totalOfertado !== "number" || totalOfertado <= 0)
          return null;
        const cob = typeof market.cobertura_mercado === "number" ? market.cobertura_mercado : null;
        const comparable = cob !== null && cob >= 0.7;
        if (!comparable) {
          return (
            <div className="mt-2 rounded-lg bg-paper/70 px-3 py-2 text-[11px] text-mute">
              Cobertura de mercado insuficiente
              {typeof market.n_con_mediana === "number" && typeof market.n_items === "number"
                ? ` (${market.n_con_mediana}/${market.n_items} ítems tasados)` : ""}:
              el estimado solo cubre esos ítems, NO es comparable con el total del contrato.
              Sin veredicto de sobreprecio para no emitir una señal falsa.
            </div>
          );
        }
        const diff = totalOfertado - computedTotalMercado;
        const diffPct = (diff / computedTotalMercado) * 100;
        return (
          <div className="mt-2 rounded-lg bg-paper/70 px-3 py-2 text-[11px] text-ink">
            <span className="text-mute">Diferencia ofertado vs mercado: </span>
            <span className={cn("font-mono font-bold",
              totalOfertado > computedTotalMercado * 1.15 ? "text-rust" :
              totalOfertado < computedTotalMercado * 0.85 ? "text-clay" : "text-moss")}>
              {diff > 0 ? "+" : ""}{fmtMoney(diff)} ({diffPct.toFixed(1)}%)
            </span>
          </div>
        );
      })()}
      {(market.observaciones_clave || []).length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ink">
          {market.observaciones_clave.map((o: string, i: number) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-heroViolet" />
              <span>{o}</span>
            </li>
          ))}
        </ul>
      )}
      {market.recomendacion && (
        <div className="mt-3 rounded-lg bg-paper/60 p-3 text-xs italic text-ink">
          <Sparkles size={11} className="mr-1 inline text-heroViolet" />
          {market.recomendacion}
        </div>
      )}
    </section>
  );
}
