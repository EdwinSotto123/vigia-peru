"use client";

import { Sparkles } from "lucide-react";
import { ICONO_SEVERIDAD, resumenLote } from "@/components/charts/mercado";
import { cn } from "@/lib/utils";
import { observacionesLegibles } from "../dossier";

/**
 * Veredicto del contrato completo contra el mercado.
 *
 * Antes esto era un porcentaje suelto en una caja ("+60,5 %") junto a dos
 * KPIs de número grande con label chico. Ahora la cifra titular va con su
 * denominador en la misma línea —cuántos ítems la sostienen y qué parte del
 * valor cubren—, porque un porcentaje sin denominador en una herramienta que
 * acusa de opacidad es exactamente el defecto que denuncia.
 *
 * Regla dura, con historia en este repo: si el backend dejó `sobreprecio_pct`
 * en null es porque su juez de plausibilidad decidió que el lote NO es
 * comparable. Acá no se recalcula un porcentaje propio — se dice que no se
 * pudo determinar y se explica por qué. El absoluto que se muestra tampoco se
 * deriva del porcentaje: es la resta del par exacto que el backend usó
 * (`lib`/`mercado.ts` → `resumenLote`).
 */

function Cifra({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5">
      <dt className="text-[11px] text-mute">{etiqueta}</dt>
      <dd className="text-right">
        <span className="font-mono text-[13px] font-semibold text-ink">{valor}</span>
        {nota && <span className="ml-1.5 text-[11px] text-mute">{nota}</span>}
      </dd>
    </div>
  );
}

export function MarketVerdictCard({ market, fmtMoney }: { market: any; fmtMoney: (n: any) => string }) {
  const r = resumenLote(market);
  const Icono = ICONO_SEVERIDAD[r.veredicto.ui.icono];
  const cobertura = r.cobertura !== null ? Math.round(r.cobertura * 100) : null;
  const conteo =
    r.nItems !== null && r.nConMediana !== null ? `${r.nConMediana} de ${r.nItems} ítems con precio de mercado` : null;
  // Las líneas de bitácora del backend ("fan-out de 10 workers", "chunk(s) excedieron
  // el timeout") no son hallazgos: se quedan fuera.
  const observaciones = observacionesLegibles(market?.observaciones_clave);

  return (
    <section className="rounded-2xl border border-line bg-paper p-5 shadow-card">
      {/* El veredicto se distinguía con una banda de color de 4px al costado:
          el tell más reconocible de interfaz generada, y prohibido por el craft
          floor. La jerarquía la carga el propio veredicto, que ya tiene su
          pastilla con color, ícono y palabra. */}
      <div className={cn("border-l pl-4", r.veredicto.ui.borde)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-mute">Precio ofertado contra el mercado</span>
          <span className={cn("pill px-2 py-0 text-[10px]", r.veredicto.ui.fondo, r.veredicto.ui.texto, r.veredicto.ui.borde)}>
            <Icono size={11} aria-hidden />
            {r.veredicto.etiqueta}
          </span>
        </div>

        {r.comparable && r.pct !== null ? (
          <>
            <h2 className="mt-1 font-serif text-2xl font-bold leading-tight text-ink">
              El contrato está{" "}
              <span className={r.veredicto.ui.texto}>
                {r.pct > 0 ? "+" : "−"}
                {Math.abs(r.pct).toFixed(1)} %
              </span>{" "}
              {r.pct >= 0 ? "sobre" : "bajo"} la mediana de mercado
            </h2>
            <p className="mt-1 text-[13px] leading-snug text-inkSoft">
              {r.abs !== null && (
                <>
                  <strong className="font-semibold">
                    {r.abs > 0 ? "+" : "−"}
                    {fmtMoney(Math.abs(r.abs))}
                  </strong>{" "}
                  de diferencia.{" "}
                </>
              )}
              {r.totalOfertado !== null && r.totalMercado !== null && (
                <>
                  {fmtMoney(r.totalOfertado)} {r.esReferencial ? "de cuantía estimada" : "ofertados"} contra{" "}
                  {fmtMoney(r.totalMercado)} de mercado.{" "}
                </>
              )}
              {conteo && (
                <>
                  Medido en {conteo}
                  {cobertura !== null && ` (${cobertura} % del valor del contrato)`}.
                </>
              )}
            </p>
          </>
        ) : (
          <>
            <h2 className="mt-1 font-serif text-2xl font-bold leading-tight text-ink">
              No se pudo determinar el sobreprecio de este contrato
            </h2>
            <p className="mt-1 text-[13px] leading-snug text-inkSoft">
              {r.motivo ? `${r.motivo.charAt(0).toUpperCase()}${r.motivo.slice(1)}. ` : ""}
              {conteo}
              {cobertura !== null && ` (${cobertura} % del valor)`}
              {conteo || cobertura !== null ? ". " : ""}
              Se deja sin veredicto de sobreprecio en vez de publicar una señal que no se sostiene.
            </p>
          </>
        )}
      </div>

      {/* Sin sobreprecio medido no se imprimen totales: un "total de mercado" hecho con
          los pocos ítems que sí se tasaron se lee como el precio del lote, y no lo es. */}
      {r.comparable && (
      <dl className="mt-3">
        {r.totalOfertado !== null && (
          <Cifra
            etiqueta={r.esReferencial ? "Cuantía estimada por la entidad" : "Total ofertado"}
            valor={fmtMoney(r.totalOfertado)}
            nota={r.esReferencial ? "no es un precio ofertado" : undefined}
          />
        )}
        {r.totalMercado !== null && (
          <Cifra
            etiqueta="Estimado de mercado (mediana)"
            valor={fmtMoney(r.totalMercado)}
            nota={
              r.totalMercadoEsSuma
                ? `suma de los ${r.nConMediana ?? 0} sub-ítems tasados`
                : conteo
                  ? `sobre ${conteo}`
                  : undefined
            }
          />
        )}
        {r.rango && (
          <Cifra
            etiqueta="Rango de mercado del lote (Σ cantidad × precio)"
            valor={`${fmtMoney(r.rango.lo)} – ${fmtMoney(r.rango.hi)}`}
            nota="mínimo y máximo observados"
          />
        )}
        {cobertura !== null && (
          <Cifra
            etiqueta="Cobertura de la comparación"
            valor={`${cobertura} % del valor`}
            nota={conteo ?? undefined}
          />
        )}
        {r.nEstimadosIA > 0 && (
          <Cifra
            etiqueta="Ítems estimados por el modelo"
            valor={String(r.nEstimadosIA)}
            nota="sin búsqueda: no cuentan en el sobreprecio"
          />
        )}
      </dl>
      )}

      {!r.comparable && r.estimadoVsMercadoPct !== null && (r.nConMediana ?? 0) > 0 && (
        <p className="mt-3 border-l-2 border-line pl-3 text-[12px] text-mute">
          La cuantía que estimó la entidad está{" "}
          <strong className="font-semibold text-ink">
            {r.estimadoVsMercadoPct > 0 ? "+" : ""}
            {r.estimadoVsMercadoPct.toFixed(1)} %
          </strong>{" "}
          respecto de la mediana de mercado. Es una señal sobre el estudio de mercado de la entidad, no sobre un precio
          ofertado: por eso no se publica como sobreprecio del contrato.
        </p>
      )}

      {observaciones.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px] text-ink">
          {observaciones.map((o: string, i: number) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-heroViolet" aria-hidden />
              <span>{o}</span>
            </li>
          ))}
        </ul>
      )}

      {market?.recomendacion && (
        <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-[12px] italic text-inkSoft">
          <Sparkles size={12} className="mt-0.5 shrink-0 text-heroViolet" aria-hidden />
          <span>{market.recomendacion}</span>
        </p>
      )}
    </section>
  );
}
