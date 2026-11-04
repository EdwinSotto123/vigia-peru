"use client";

/**
 * Lo que pagó el Estado por lo mismo (`precios_internos` del agente, plan 2026-11-04): por ítem, su precio unitario
 * contra los percentiles 25, 50 y 75 de lo adjudicado por el mismo código CUBSO y la misma unidad en todo el Estado.
 * Es la comparación más fuerte porque es el mismo bien; va antes del mercado retail.
 */

import { Landmark } from "lucide-react";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { montoDossier } from "../dossier";

const VEREDICTO: Record<string, { texto: string; clase: string }> = {
  muy_por_encima: { texto: "Muy por encima", clase: "bg-crimson-soft text-crimsonTexto" },
  por_encima: { texto: "Por encima", clase: "bg-amber-soft text-amberTexto" },
  en_rango: { texto: "En rango", clase: "bg-paperDeep text-inkSoft" },
  por_debajo: { texto: "Por debajo", clase: "bg-paperDeep text-inkSoft" },
  sin_dato: { texto: "Sin referencia", clase: "bg-paperDeep text-mute" },
};

export function PreciosDelEstado({ datos }: { datos: any }) {
  const items: any[] = datos?.items ?? [];
  if (!items.length) return null;
  const conRef = items.filter((x) => x.referencia);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line bg-paperSoft px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-seccion font-bold text-ink">
          <Landmark size={16} className="text-mute" aria-hidden /> Lo que pagó el Estado por lo mismo
        </h2>
        <p className="mt-0.5 text-rotulo text-mute">
          {numero(conRef.length)} de {numero(items.length)} ítems con referencia: el mismo código CUBSO y la misma unidad,
          adjudicados por otras entidades (5 precios o más de 3 entidades o más).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-rotulo">
          <thead className="bg-paperSoft text-micro uppercase tracking-wide text-mute">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Ítem</th>
              <th className="px-4 py-2 text-right font-semibold">Precio unitario</th>
              <th className="px-4 py-2 text-right font-semibold">Mediana del Estado</th>
              <th className="px-4 py-2 text-right font-semibold">Diferencia</th>
              <th className="px-4 py-2 text-left font-semibold">Veredicto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((x, i) => {
              const v = VEREDICTO[x.veredicto] ?? VEREDICTO.sin_dato;
              const r = x.referencia;
              return (
                <tr key={i} className="align-top">
                  <td className="px-4 py-2.5">
                    <span className="line-clamp-2 text-ink">{x.descripcion || `Ítem ${x.item}`}</span>
                    <span className="text-micro text-mute">{x.unidad}{x.cantidad ? `, ${numero(x.cantidad)}` : ""}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">
                    {montoDossier(x.precio_unitario)}
                    <span className="block text-micro text-mute">{x.origen_precio}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">
                    {r ? montoDossier(r.mediana) : "Sin dato"}
                    {r && <span className="block text-micro text-mute">{numero(r.precios)} precios, {numero(r.entidades)} entidades, {r.anio}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">
                    {typeof x.diferencia_vs_mediana_pct === "number" ? `${x.diferencia_vs_mediana_pct > 0 ? "+" : ""}${x.diferencia_vs_mediana_pct.toFixed(0)} %` : "Sin dato"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-micro font-semibold", v.clase)}>{v.texto}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
