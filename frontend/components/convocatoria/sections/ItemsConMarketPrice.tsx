"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { VEREDICTO_VISUAL } from "../constants";

export function ItemsConMarketPrice({ items, allItems = [], market, fmtMoney }: { items: any[]; allItems?: any[]; market: any; fmtMoney: (n: any) => string }) {
  // State para expandir filas (mostrar todas las características de un ítem)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const findingsRaw = market?.findings || [];
  // Deduplicar findings: a) por item_numero normalizado (sin ceros), b) por descripción
  // exacta — el LLM a veces emite "1" y "01.1" para el mismo producto.
  const normalizeNum = (n: any) => String(n ?? "").trim().replace(/^0+(?=\d)/, "");
  const seenKey = new Set<string>();
  const findings = findingsRaw.filter((f: any) => {
    const k1 = normalizeNum(f.item_numero);
    const k2 = String(f.item_descripcion || "").trim().toLowerCase().slice(0, 60);
    const compoundKey = `${k1}|${k2}`;
    if (!k1 && !k2) return true;
    if (seenKey.has(compoundKey)) return false;
    seenKey.add(compoundKey);
    return true;
  });
  const findingByNumero = new Map(findings.map((f: any) => [normalizeNum(f.item_numero), f]));
  // Padre del LOTE (cuando OCDS tiene 1 ítem global y parser desglosa N sub-items).
  // Viene de market_analysis.padre_lote. El padre NO se renderiza como fila
  // normal — se muestra arriba como banner del lote.
  const padreLote = market?.padre_lote || null;
  const itemsExpandidos: Array<{ ocdsItem: any; finding: any; key: string; esLote?: boolean }> = [];
  if (padreLote) {
    itemsExpandidos.push({
      ocdsItem: {
        numero: padreLote.numero,
        descripcion: padreLote.descripcion,
        cantidad: padreLote.cantidad,
        unidad: padreLote.unidad,
        cuantia_referencial: padreLote.cuantia_total,
      },
      finding: null,
      key: "lote-padre",
      esLote: true,
    });
  }
  const padreNum = padreLote ? normalizeNum(padreLote.numero) : null;
  // Sub-items = la lista COMPLETA de productos físicos del REQUERIMIENTO
  // (document_analysis.items_consolidados), cada uno con su finding de mercado si se
  // tasó, o null (no tasado / timeout del market). ANTES la tabla se armaba SOLO desde
  // `findings` (los ítems con precio) → los que el market no alcanzó a tasar
  // DESAPARECÍAN (se veían 2 de 8). El precio se matchea por numero y, como respaldo,
  // por descripción (el numero de los findings diverge del del parser: '1.0' vs '1').
  const normDesc = (s: any) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 50);
  const findingByDesc = new Map(findings.map((f: any) => [normDesc(f.item_descripcion), f]));
  if (allItems.length > 0) {
    for (const ai of allItems) {
      const k = normalizeNum(ai.numero);
      if (padreNum && k === padreNum) continue; // el lote padre no es un sub-ítem
      const f = findingByNumero.get(k) || findingByDesc.get(normDesc(ai.descripcion_corta || ai.descripcion)) || null;
      itemsExpandidos.push({
        ocdsItem: {
          numero: ai.numero,
          descripcion: ai.descripcion_corta || ai.descripcion,
          cantidad: ai.cantidad,
          unidad: ai.unidad,
          requerimiento: ai.requerimiento_tecnico_detallado || "",
        },
        finding: f,
        key: String(ai.numero ?? itemsExpandidos.length),
      });
    }
  } else {
    // Fallback (sin lista del parser): comportamiento anterior basado en findings.
    for (const f of findings) {
      const k = normalizeNum(f.item_numero);
      if (padreNum && k === padreNum) continue;
      itemsExpandidos.push({ ocdsItem: null, finding: f, key: k || String(itemsExpandidos.length) });
    }
    if (!padreLote) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const f: any = findingByNumero.get(normalizeNum(it.numero)) || findings[i];
        if (itemsExpandidos.some(x => x.finding === f)) continue;
        itemsExpandidos.unshift({ ocdsItem: it, finding: f, key: String(it.numero || i + 1) });
      }
    }
  }
  return (
    <>
      {/* TABLA RESUMEN — comparación a primera vista */}
      {(findings.length > 0 || itemsExpandidos.some(x => !x.esLote)) && (
        <div className="overflow-x-auto border-b border-line bg-paperSoft">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-line text-left text-mute">
                <th className="px-3 py-2 font-bold uppercase tracking-wider">#</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Producto</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Características clave</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Cant</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Precio ref.</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Mediana mercado</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Δ%</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Veredicto</th>
              </tr>
            </thead>
            <tbody>
              {itemsExpandidos.filter(x => x.esLote).map(({ ocdsItem, key }) => (
                <tr key={key} className="border-b-2 border-clay/30 bg-clay/5 align-top">
                  <td colSpan={8} className="px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-clay/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-clay">
                          🧺 LOTE OCDS · {ocdsItem?.cantidad ?? 1} {ocdsItem?.unidad || "Unidad"}
                        </span>
                        <div className="mt-0.5 text-[12px] font-semibold text-ink">
                          {String(ocdsItem?.descripcion || "").slice(0, 140)}
                        </div>
                        <div className="text-[10px] italic text-mute">
                          Los precios se desglosan abajo por sub-ítem. Se compara la suma estimada de mercado contra este monto.
                        </div>
                      </div>
                      <div className="text-right font-mono font-bold text-ink">
                        <div className="text-[9px] uppercase tracking-wider text-mute">cuantía lote</div>
                        <div className="text-base">{fmtMoney(ocdsItem?.cuantia_referencial)}</div>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {itemsExpandidos.filter(x => !x.esLote).map(({ ocdsItem, finding, key }) => {
                const v = (finding?.veredicto && VEREDICTO_VISUAL[finding.veredicto]) || null;
                const desc = finding?.item_descripcion || ocdsItem?.descripcion || "—";
                const cantidad = finding?.cantidad ?? ocdsItem?.cantidad;
                const unidad = finding?.unidad || ocdsItem?.unidad || "UND";
                // Sub-items NO tienen precio referencial (no se distribuye desde el lote padre)
                const precioRef = finding?.precio_unitario_referencial;
                const caracs = finding?.caracteristicas_solicitadas_clave || [];
                return (
                  <tr key={key} className="border-b border-line/50 align-top hover:bg-paper">
                    <td className="px-3 py-2 font-mono font-bold text-clay">{key}</td>
                    <td className="px-3 py-2 text-ink">
                      <div className="font-semibold leading-tight">{String(desc).slice(0, 80)}{String(desc).length > 80 ? "…" : ""}</div>
                    </td>
                    <td className="px-3 py-2 text-mute">
                      {caracs.length > 0 ? (
                        (() => {
                          const isOpen = expandedRows.has(key);
                          const shown = isOpen ? caracs : caracs.slice(0, 3);
                          return (
                            <ul className="space-y-0.5">
                              {shown.map((c: string, j: number) => (
                                <li key={j} className="flex items-start gap-1">
                                  <CheckCircle2 size={9} className="mt-0.5 shrink-0 text-clay" />
                                  <span>{c}</span>
                                </li>
                              ))}
                              {caracs.length > 3 && (
                                <li>
                                  <button
                                    type="button"
                                    onClick={() => toggleRow(key)}
                                    className="mt-1 inline-flex items-center gap-1 rounded-full bg-clay/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-clay hover:bg-clay/20"
                                  >
                                    {isOpen
                                      ? `▲ ocultar (${caracs.length - 3} ocultas)`
                                      : `▼ ver +${caracs.length - 3} más`}
                                  </button>
                                </li>
                              )}
                            </ul>
                          );
                        })()
                      ) : (
                        <span className="italic text-mute">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink">
                      {cantidad ?? "—"}
                      <div className="text-[9px] text-mute">{unidad}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-ink">
                      {typeof precioRef === "number" && precioRef > 0 ? fmtMoney(precioRef) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-ink">
                      {typeof finding?.precio_mediana_mercado === "number" ? (
                        fmtMoney(finding.precio_mediana_mercado)
                      ) : typeof finding?.precio_estimado_ia === "number" ? (
                        <span className="italic text-mute" title={`Estimación del modelo por conocimiento previo (confianza ${finding.confianza_estimacion_ia || "—"}) — no es un precio buscado en la web.`}>
                          ≈ {fmtMoney(finding.precio_estimado_ia)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className={cn("px-3 py-2 text-right font-mono font-bold",
                      typeof finding?.diff_pct === "number"
                        ? finding.diff_pct > 15 ? "text-rust" : finding.diff_pct < -15 ? "text-clay" : "text-moss"
                        : "text-mute")}>
                      {typeof finding?.diff_pct === "number" ? (
                        `${finding.diff_pct > 0 ? "+" : ""}${finding.diff_pct.toFixed(1)}%`
                      ) : typeof finding?.diff_pct_estimacion_ia === "number" ? (
                        <span className="italic">≈{finding.diff_pct_estimacion_ia > 0 ? "+" : ""}{finding.diff_pct_estimacion_ia.toFixed(1)}%</span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {v ? (
                        <span className={cn("inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", v.color)}>
                          {v.emoji} {v.label}
                        </span>
                      ) : finding?.estado === "estimado_ia" ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-paperDeep border border-line px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-mute"
                          title={finding?.comentario || "Estimación del modelo desde su conocimiento previo, sin búsqueda web."}
                        >
                          🤔 ESTIMACIÓN IA
                        </span>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {/* FILA DE TOTALES — comparación triple del lote */}
              {(() => {
                const subItems = itemsExpandidos.filter(x => !x.esLote);
                let totalMercado = 0, totalMin = 0, totalMax = 0;
                let nConPrecio = 0;
                for (const x of subItems) {
                  const med = x.finding?.precio_mediana_mercado;
                  const cant = x.finding?.cantidad ?? x.ocdsItem?.cantidad;
                  if (typeof med === "number" && typeof cant === "number") {
                    totalMercado += med * cant;
                    // Rango AGREGADO del lote: Σ(cantidad × precio mínimo) y Σ(cantidad × precio
                    // máximo) por sub-ítem. Si un ítem no trae rango, usamos su mediana para mín y
                    // máx (no rompe la suma). Da el piso y el techo de mercado del lote completo.
                    const lo = typeof x.finding?.rango_min === "number" ? x.finding.rango_min : med;
                    const hi = typeof x.finding?.rango_max === "number" ? x.finding.rango_max : med;
                    totalMin += lo * cant;
                    totalMax += hi * cant;
                    nConPrecio++;
                  }
                }
                const totalReferencial = padreLote
                  ? padreLote.cuantia_total
                  : items.filter(it => (it.cuantia_referencial ?? 0) > 0)
                      .reduce((s, it) => s + (it.cuantia_referencial || 0), 0);
                if (nConPrecio === 0 && !totalReferencial) return null;
                // Cobertura: fracción de sub-ítems con mediana de mercado. Comparar
                // la cuantía TOTAL del lote (todos los ítems) contra una suma de
                // mercado PARCIAL (pocos ítems con precio) es apples-vs-oranges y
                // produce falsos "LOTE MUY ELEVADO". Solo damos veredicto de lote
                // con cobertura alta (≥70% de los sub-ítems tienen mediana).
                // El backend (analyze_market_sharded) YA calcula sobreprecio_pct
                // y cobertura sobre el LOTE COMPLETO, aplicando el gate de ≥70%.
                // Si ese dato existe, es la VERDAD: usarlo. Recalcular acá sobre
                // un subconjunto (p.ej. 1 sub-ítem) contra la cuantía del lote
                // entero produce falsos "+900% LOTE MUY ELEVADO".
                const hasBackend = market && typeof market.cobertura_mercado === "number";
                const cobertura = hasBackend
                  ? market.cobertura_mercado
                  : (subItems.length > 0 ? nConPrecio / subItems.length : 0);
                const comparable = cobertura >= 0.7 && totalReferencial > 0 && totalMercado > 0;
                const diffMercado = hasBackend
                  ? (typeof market.sobreprecio_pct === "number" ? market.sobreprecio_pct : null)
                  : (comparable ? ((totalReferencial - totalMercado) / totalMercado) * 100 : null);
                return (
                  <tr className="border-t-2 border-clay/40 bg-clay/5 font-bold">
                    <td colSpan={4} className="px-3 py-3 text-right text-[10px] uppercase tracking-widest text-mute">
                      Total de mercado del lote<br/>(Σ cantidad × precio · mediana, mín y máx)
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-ink">
                      {totalReferencial > 0 ? fmtMoney(totalReferencial) : "—"}
                      <div className="text-[9px] font-normal text-mute">cuantía OCDS</div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-ink">
                      {totalMercado > 0 ? fmtMoney(totalMercado) : "—"}
                      <div className="text-[9px] font-normal text-mute">mediana del lote</div>
                      {totalMercado > 0 && totalMax > totalMin && (
                        <div className="mt-0.5 text-[9px] font-normal text-clay">
                          mín {fmtMoney(totalMin)} · máx {fmtMoney(totalMax)}
                        </div>
                      )}
                      <div className="mt-0.5 text-[9px] font-normal text-mute">{nConPrecio}/{subItems.length} sub-ítems con mercado</div>
                      {typeof market?.n_items_estimados_ia === "number" && market.n_items_estimados_ia > 0 && (
                        <div className="mt-0.5 text-[9px] font-normal italic text-mute" title="Fuera del presupuesto de búsqueda real de este lote grande: precio estimado por el modelo, sin verificar.">
                          + {market.n_items_estimados_ia} 🤔 estimado(s) por IA (no cuentan aquí)
                        </div>
                      )}
                    </td>
                    <td className={cn("px-3 py-3 text-right font-mono",
                      diffMercado != null
                        ? diffMercado > 15 ? "text-rust" : diffMercado < -15 ? "text-clay" : "text-moss"
                        : "text-mute")}>
                      {diffMercado != null ? `${diffMercado > 0 ? "+" : ""}${diffMercado.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-3 py-3 text-left">
                      {diffMercado != null ? (
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider",
                          diffMercado > 50 ? "bg-crimson-soft text-rust" :
                          diffMercado > 15 ? "bg-amber-soft text-amber" :
                          diffMercado < -15 ? "bg-paperSoft text-clay" : "bg-moss/10 text-moss")}>
                          {diffMercado > 50 ? "🔴 LOTE MUY ELEVADO" :
                            diffMercado > 15 ? "🟠 LOTE ELEVADO" :
                            diffMercado < -15 ? "🔵 LOTE BARATO" : "🟢 LOTE ALINEADO"}
                        </span>
                      ) : (
                        <span className="text-[9px] normal-case text-mute" title={market?.motivo_no_verificable || undefined}>
                          {/* `subItems.length` cuenta los ítems que el parser logró desglosar, no el total real
                              del requerimiento (puede ser mucho mayor) — evitar que "(5/5)" lea como "completo". */}
                          {market?.motivo_no_verificable
                            ? "no verificable — no comparable con la cuantía del lote"
                            : `desglosados ${nConPrecio}/${subItems.length}, no necesariamente todo el requerimiento — no comparable con la cuantía del lote`}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* CARDS DESPLEGABLES — detalle por sub-ítem (no por items OCDS, que solo
          tiene 1 entrada cuando es un lote) */}
      <ul className="divide-y divide-line">
      {itemsExpandidos.filter(x => !x.esLote).map(({ ocdsItem, finding: f, key }, i) => {
        const v = (f?.veredicto && VEREDICTO_VISUAL[f.veredicto]) || null;
        const desc = f?.item_descripcion || ocdsItem?.descripcion || "—";
        const cantidad = f?.cantidad ?? ocdsItem?.cantidad;
        const unidad = f?.unidad || ocdsItem?.unidad || "UND";
        const costoLinea = (typeof f?.precio_mediana_mercado === "number" && typeof cantidad === "number")
          ? f.precio_mediana_mercado * cantidad : null;
        return (
          <li key={key || i} className="px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-paperDeep font-mono text-[10px] font-bold text-clay">
                {key || i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{desc}</div>
                {ocdsItem?.cubso_descripcion && ocdsItem.cubso_descripcion !== desc && (
                  <div className="mt-0.5 text-[11px] text-mute">
                    <span className="font-mono">CUBSO {ocdsItem.cubso}</span> · {ocdsItem.cubso_descripcion}
                  </div>
                )}
              </div>
              <div className="text-right">
                {typeof costoLinea === "number" && (
                  <>
                    <div className="font-mono text-sm font-bold text-ink">{fmtMoney(costoLinea)}</div>
                    <div className="font-mono text-[10px] text-mute">estimado mercado</div>
                  </>
                )}
                <div className="font-mono text-[10px] text-mute">{cantidad ?? "—"} {unidad}</div>
                {typeof f?.precio_mediana_mercado === "number" ? (
                  <div className="font-mono text-[10px] text-mute">unit. {fmtMoney(f.precio_mediana_mercado)}</div>
                ) : typeof f?.precio_estimado_ia === "number" ? (
                  <div className="font-mono text-[10px] italic text-mute">unit. ≈{fmtMoney(f.precio_estimado_ia)} (estim. IA)</div>
                ) : null}
              </div>
            </div>

            {/* Ítem SIN tasar (el market no alcanzó a preciarlo — timeout/cobertura):
                mostramos su requerimiento para que NO quede desnudo en la tabla. */}
            {!f && (
              <div className="mt-3 ml-10 rounded-xl border border-line bg-paperSoft p-3 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-paperDeep px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-mute">
                  <Receipt size={10} /> sin tasación de mercado (no se alcanzó a preciar)
                </span>
                {ocdsItem?.requerimiento && (
                  <p className="mt-2 leading-relaxed text-mute">{String(ocdsItem.requerimiento).slice(0, 400)}</p>
                )}
              </div>
            )}

            {/* Ítem fuera del presupuesto de búsqueda real (lote grande): el modelo dio una
                ESTIMACIÓN desde su conocimiento previo, no una búsqueda — se muestra aparte,
                nunca con los colores de veredicto (alineado/elevado/…) para no confundirla
                con una cifra verificada. */}
            {f && !v && f.estado === "estimado_ia" && (
              <div className="mt-3 ml-10 rounded-xl border border-line bg-paperDeep p-3 text-xs">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-mute"
                    title="Fuera del presupuesto de búsqueda real de este lote grande: precio estimado por el modelo desde su conocimiento previo, no verificado con fuentes."
                  >
                    🤔 ESTIMACIÓN IA · sin búsqueda web
                  </span>
                  {f.confianza_estimacion_ia && (
                    <span className="font-mono text-[10px] font-bold text-mute">confianza {f.confianza_estimacion_ia}</span>
                  )}
                  {typeof f.diff_pct_estimacion_ia === "number" && (
                    <span className="font-mono text-[11px] font-bold text-mute">
                      ≈{f.diff_pct_estimacion_ia > 0 ? "+" : ""}{f.diff_pct_estimacion_ia.toFixed(1)}% vs estimación
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  <span className="text-mute">Estimado por IA:</span>{" "}
                  <span className="font-mono font-bold text-ink">
                    ≈ {fmtMoney(f.precio_estimado_ia)} {f.unidad_estimacion_ia ? `por ${f.unidad_estimacion_ia}` : ""}
                  </span>
                </div>
                {f.comentario && <p className="mt-2 leading-relaxed text-ink">{f.comentario}</p>}
              </div>
            )}

            {/* MARKET PRICE — análisis del agente por ítem */}
            {f && v && (
              <div className={cn("mt-3 ml-10 rounded-xl border p-3 text-xs", v.bg)}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={cn("inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest", v.color)}>
                    <Receipt size={10} /> market_price_agent · {v.label}
                  </span>
                  {typeof f.diff_pct === "number" && (
                    <span className={cn("font-mono text-[11px] font-bold", v.color)}>
                      {f.diff_pct > 0 ? "+" : ""}{f.diff_pct.toFixed(1)}% vs mediana
                    </span>
                  )}
                  {f.es_estimacion && (
                    <span className="rounded-full bg-paperDeep px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-mute">estim.</span>
                  )}
                </div>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  <div>
                    <span className="text-mute">Mediana mercado:</span>{" "}
                    <span className="font-mono font-bold text-ink">{fmtMoney(f.precio_mediana_mercado)}</span>
                  </div>
                  {f.rango_min != null && f.rango_max != null && (
                    <div>
                      <span className="text-mute">Rango:</span>{" "}
                      <span className="font-mono text-ink">{fmtMoney(f.rango_min)} – {fmtMoney(f.rango_max)}</span>
                    </div>
                  )}
                </div>
                {f.comentario && <p className="mt-2 leading-relaxed text-ink">{f.comentario}</p>}
                {(f.fuentes || []).length > 0 && (
                  <div className="mt-2 text-[10px] text-mute">
                    <strong className="text-ink">Fuentes:</strong> {(f.fuentes as string[]).join(" · ")}
                  </div>
                )}
                {f.spec_restrictiva && (
                  <div className="mt-2 rounded-md bg-rust/10 px-2 py-1 text-[10px] text-rust">
                    <AlertTriangle size={10} className="mr-1 inline" />
                    <strong>Spec restrictiva:</strong> {f.spec_restrictiva}
                  </div>
                )}

                {/* Características clave solicitadas (de v2.0 prompt) */}
                {Array.isArray(f.caracteristicas_solicitadas_clave) && f.caracteristicas_solicitadas_clave.length > 0 && (
                  <div className="mt-3 rounded-md border border-line bg-paperSoft px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
                      Características solicitadas en el REQUERIMIENTO
                    </div>
                    <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
                      {f.caracteristicas_solicitadas_clave.map((c: string, j: number) => (
                        <li key={j} className="flex items-start gap-1.5 text-[11px] text-ink">
                          <CheckCircle2 size={10} className="mt-0.5 shrink-0 text-clay" />
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Precios observados con URL + proveedor + cumplimiento */}
                {Array.isArray(f.precios_observados) && f.precios_observados.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-mute">
                      Precios observados en mercado · {f.precios_observados.length} referencia(s)
                    </div>
                    <div className="mt-1 overflow-x-auto">
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="border-b border-line text-left text-mute">
                            <th className="py-1.5 pr-2 font-semibold">Producto / Proveedor</th>
                            <th className="py-1.5 pr-2 font-semibold">Tipo</th>
                            <th className="py-1.5 pr-2 text-right font-semibold">Precio</th>
                            <th className="py-1.5 font-semibold">Cumple</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.precios_observados.map((p: any, j: number) => (
                            <tr key={j} className="border-b border-line/50 align-top">
                              <td className="py-1.5 pr-2 text-ink">
                                <div className="font-semibold">{p.producto_titulo || "—"}</div>
                                <div className="text-mute">
                                  {p.proveedor || "—"}
                                  {p.url && (
                                    <a href={p.url} target="_blank" rel="noreferrer"
                                       className="ml-2 inline-flex items-center gap-0.5 text-clay hover:underline">
                                      ver <ExternalLink size={8} />
                                    </a>
                                  )}
                                </div>
                                {Array.isArray(p.caracteristicas_no_cumplidas) && p.caracteristicas_no_cumplidas.length > 0 && (
                                  <div className="mt-0.5 text-[10px] italic text-rust">
                                    no cumple: {p.caracteristicas_no_cumplidas.join(", ")}
                                  </div>
                                )}
                              </td>
                              <td className="py-1.5 pr-2 text-mute">
                                <span className="rounded bg-paperDeep px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                                  {p.tipo || "—"}
                                </span>
                              </td>
                              <td className="py-1.5 pr-2 text-right font-mono font-bold text-ink">
                                {typeof p.valor === "number" ? fmtMoney(p.valor) : "—"}
                              </td>
                              <td className="py-1.5">
                                {p.cumple_caracteristicas === true && (
                                  <span className="inline-flex items-center gap-0.5 text-moss">
                                    <CheckCircle2 size={11} /> sí
                                  </span>
                                )}
                                {p.cumple_caracteristicas === false && (
                                  <span className="inline-flex items-center gap-0.5 text-rust">
                                    <AlertTriangle size={11} /> no
                                  </span>
                                )}
                                {p.cumple_caracteristicas == null && (
                                  <span className="text-mute">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Proveedores potenciales en Perú */}
                {Array.isArray(f.proveedores_potenciales) && f.proveedores_potenciales.length > 0 && (
                  <div className="mt-3 rounded-md bg-paperSoft px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-mute">
                      Proveedores potenciales (donde la entidad podría haber cotizado)
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {f.proveedores_potenciales.map((p: any, j: number) => (
                        <li key={j} className="text-[11px] text-ink">
                          <strong>{p.nombre || "—"}</strong>
                          {p.linea && <span className="text-mute"> · línea {p.linea}</span>}
                          {p.url && (
                            <a href={p.url} target="_blank" rel="noreferrer"
                               className="ml-2 inline-flex items-center gap-0.5 text-clay hover:underline">
                              <ExternalLink size={9} />
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Queries que ejecutó el agente (mostradas como debug útil) */}
                {Array.isArray(f.queries_realizadas) && f.queries_realizadas.length > 0 && (
                  <details className="mt-2 text-[10px] text-mute">
                    <summary className="cursor-pointer hover:text-ink">
                      Queries realizadas ({f.queries_realizadas.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {f.queries_realizadas.map((q: string, j: number) => (
                        <li key={j} className="font-mono italic">→ {q}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </li>
        );
      })}
      </ul>
    </>
  );
}
