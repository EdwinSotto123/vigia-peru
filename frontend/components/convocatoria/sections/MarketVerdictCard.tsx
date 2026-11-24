"use client";

import { Info, Scale } from "lucide-react";
import { numero, porcentaje } from "@/lib/formato";
import { ICONO_SEVERIDAD, enRangoDelJuez, resumenLote } from "@/components/charts/mercado";
import { POSITIVO } from "@/lib/severidad";
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
      <dt className="text-micro text-mute">{etiqueta}</dt>
      <dd className="text-right">
        <span className="font-mono text-meta font-semibold text-ink">{valor}</span>
        {nota && <span className="ml-1.5 text-micro text-mute">{nota}</span>}
      </dd>
    </div>
  );
}

/**
 * Lo que el análisis sí verificó contra las compras del Estado (`precios_internos`): cuántos ítems tienen referencia y,
 * si es uno solo, su diferencia con la mediana. Con esto, un «no verificable» del mercado no se lee como «no se verificó
 * nada» (pedido del usuario del 2026-11-16: arriba decía «En rango» frente al Estado y abajo «No verificable»).
 */
export interface VerificadoEstado {
  /** Ítems con referencia del Estado. */
  conReferencia: number;
  /** Ítems del contrato comparados. */
  items: number;
  /** Con un solo ítem: su diferencia con la mediana del Estado (la del agente) y de cuántos precios sale. */
  diferenciaPct: number | null;
  mediana: number | null;
  precios: number | null;
  entidades: number | null;
}

export function verificadoConEstado(preciosInternos: any): VerificadoEstado | null {
  const items: any[] = preciosInternos?.items ?? [];
  const conRef = items.filter((x) => x?.referencia && typeof x.referencia.mediana === "number");
  if (conRef.length === 0) return null;
  const uno = conRef.length === 1 ? conRef[0] : null;
  return {
    conReferencia: conRef.length,
    items: items.length,
    diferenciaPct: uno && typeof uno.diferencia_vs_mediana_pct === "number" ? uno.diferencia_vs_mediana_pct : null,
    mediana: uno ? uno.referencia.mediana : null,
    precios: uno && typeof uno.referencia.precios === "number" ? uno.referencia.precios : null,
    entidades: uno && typeof uno.referencia.entidades === "number" ? uno.referencia.entidades : null,
  };
}

/** El motivo que escribió el juez de precio, sin sus nombres internos («'alineado_regional'», «Δ»). */
function motivoDelJuez(texto: unknown): string | null {
  const t = typeof texto === "string" ? texto.trim() : "";
  if (!t || !/\s/.test(t)) return null;
  const limpio = t
    .replace(/^juez de plausibilidad de precio:\s*/i, "")
    .replace(/Δ\s*/g, "una diferencia de ")
    .replace(/'alineado_regional'/g, "«alineado con las compras de otras entidades»")
    .replace(/'([a-z_]+)'/g, (_, k: string) => `«${k.replace(/_/g, " ")}»`)
    .replace(/\.$/, "");
  return limpio ? limpio.charAt(0).toLocaleLowerCase("es") + limpio.slice(1) : null;
}

export function MarketVerdictCard({ market, fmtMoney, estado = null }: { market: any; fmtMoney: (n: any) => string; estado?: VerificadoEstado | null }) {
  const r = resumenLote(market);
  const todos: any[] = market?.findings || [];
  // Sin sobreprecio medido porque el precio cae DENTRO del rango observado: se dice eso, con su barra, y no «no se pudo».
  if (!r.comparable && todos.length > 0 && todos.every(enRangoDelJuez)) return <DentroDelRango findings={todos} fmtMoney={fmtMoney} />;
  // Sin sobreprecio de mercado medido, pero con la comparación contra el Estado hecha: verificación parcial, no «no verificable».
  const parcial = !r.comparable && !!estado;
  const findings: any[] = market?.findings || [];
  const motivoJuez = findings.length === 1 ? motivoDelJuez(findings[0]?.motivo_no_verificable) : null;
  const Icono = ICONO_SEVERIDAD[r.veredicto.ui.icono];
  const cobertura = r.cobertura !== null ? Math.round(r.cobertura * 100) : null;
  const conteo =
    r.nItems !== null && r.nConMediana !== null ? `${r.nConMediana} de ${r.nItems} ${r.nItems === 1 ? "ítem" : "ítems"} con precio de mercado` : null;
  // Las líneas de bitácora del backend ("fan-out de 10 workers", "chunk(s) excedieron
  // el timeout") no son hallazgos: se quedan fuera.
  const observaciones = observacionesLegibles(market?.observaciones_clave);

  return (
    <section className="rounded-2xl border border-line bg-paper p-5">
      {/* El veredicto se distinguía con una banda de color de 4px al costado:
          el tell más reconocible de interfaz generada, y prohibido por el craft
          floor. La jerarquía la carga el propio veredicto, que ya tiene su
          pastilla con color, ícono y palabra. */}
      <div className={cn("border-l pl-4", r.veredicto.ui.borde)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-rotulo font-medium text-mute">Precio ofertado contra el mercado</span>
          {parcial ? (
            <span className="pill border-line bg-paperDeep px-2 py-0 text-micro font-semibold text-ink">
              <Scale size={11} aria-hidden />
              Verificación parcial con compras del Estado
            </span>
          ) : (
            <span className={cn("pill px-2 py-0 text-micro", r.veredicto.ui.fondo, r.veredicto.ui.texto, r.veredicto.ui.borde)}>
              <Icono size={11} aria-hidden />
              {r.veredicto.etiqueta}
            </span>
          )}
        </div>

        {r.comparable && r.pct !== null ? (
          <>
            <h2 className="mt-1 font-display text-cifra font-bold leading-tight text-ink">
              El contrato está{" "}
              <span className={r.veredicto.ui.texto}>
                {r.pct > 0 ? "+" : "−"}
                {porcentaje(Math.abs(r.pct), { decimales: 1 })}
              </span>{" "}
              {r.pct >= 0 ? "sobre" : "bajo"} la mediana de mercado
            </h2>
            {r.pct > 0 && (
              <p className="mt-1 text-rotulo leading-relaxed text-mute">
                Pagar más que la mediana puede tener explicación (menor cantidad, transporte, otra calidad): es un indicio para revisar, no una prueba de sobreprecio.
              </p>
            )}
            <p className="mt-1 text-meta leading-snug text-inkSoft">
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
                  {cobertura !== null && ` (${porcentaje(cobertura)} del valor del contrato)`}.
                </>
              )}
            </p>
          </>
        ) : parcial && estado ? (
          <>
            <h2 className="mt-1 font-display text-seccion font-bold leading-tight text-ink">
              El precio sí se verificó contra compras del Estado; contra el mercado, no se pudo
            </h2>
            <ul className="mt-2 space-y-1.5 text-meta leading-snug text-inkSoft">
              <li className="flex gap-2">
                <span className="mt-0.5 shrink-0 rounded-full bg-paperDeep px-1.5 font-mono text-rotulo font-semibold text-ink">Sí</span>
                <span>
                  <strong className="font-semibold text-ink">Compras del Estado por el mismo bien:</strong>{" "}
                  {estado.diferenciaPct !== null && estado.mediana !== null ? (
                    <>
                      el precio está {estado.diferenciaPct > 0 ? "+" : estado.diferenciaPct < 0 ? "−" : ""}
                      {porcentaje(Math.abs(estado.diferenciaPct), { decimales: 0 })} {estado.diferenciaPct >= 0 ? "sobre" : "bajo"} la mediana de{" "}
                      {fmtMoney(estado.mediana)}
                      {estado.precios ? ` (${numero(estado.precios)} precios${estado.entidades ? ` de ${numero(estado.entidades)} entidades` : ""})` : ""}.
                    </>
                  ) : (
                    <>
                      {numero(estado.conReferencia)} de {numero(estado.items)} ítems se compararon con lo que otras entidades pagaron.
                    </>
                  )}{" "}
                  El detalle está arriba, en «Lo que pagó el Estado por lo mismo».
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 shrink-0 rounded-full bg-paperDeep px-1.5 font-mono text-rotulo font-semibold text-ink">No</span>
                <span>
                  <strong className="font-semibold text-ink">Precios de mercado:</strong> no alcanzaron para sostener un porcentaje de sobreprecio
                  {motivoJuez ? ` (${motivoJuez})` : r.motivo && findings.length !== 1 ? ` (${r.motivo})` : ""}. Por eso no se publica una cifra de sobreprecio de
                  mercado en vez de publicar una que no se sostiene.
                </span>
              </li>
            </ul>
          </>
        ) : (
          <>
            <h2 className="mt-1 text-bloque font-semibold leading-snug text-ink">No se pudo determinar el sobreprecio de este contrato</h2>
            <p className="mt-1 text-meta leading-snug text-inkSoft">
              {r.motivo ? `${r.motivo.charAt(0).toUpperCase()}${r.motivo.slice(1)}. ` : ""}
              {conteo}
              {cobertura !== null && ` (${porcentaje(cobertura)} del valor)`}
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
            valor={`${porcentaje(cobertura)} del valor`}
            nota={conteo ?? undefined}
          />
        )}
        {r.nEstimadosIA > 0 && (
          <Cifra
            etiqueta="Ítems estimados por el modelo"
            valor={numero(r.nEstimadosIA)}
            nota="sin búsqueda: no cuentan en el sobreprecio"
          />
        )}
      </dl>
      )}

      {!r.comparable && r.estimadoVsMercadoPct !== null && (r.nConMediana ?? 0) > 0 && (
        <p className="mt-3 border-l-2 border-line pl-3 text-rotulo text-mute">
          La cuantía que estimó la entidad está{" "}
          <strong className="font-semibold text-ink">
            {r.estimadoVsMercadoPct > 0 ? "+" : r.estimadoVsMercadoPct < 0 ? "−" : ""}
            {porcentaje(Math.abs(r.estimadoVsMercadoPct), { decimales: 1 })}
          </strong>{" "}
          respecto de la mediana de mercado. Es una señal sobre el estudio de mercado de la entidad, no sobre un precio
          ofertado: por eso no se publica como sobreprecio del contrato.
        </p>
      )}

      {observaciones.length > 0 && (
        <ul className="mt-3 space-y-1 text-meta text-ink">
          {observaciones.map((o: string, i: number) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-mute" aria-hidden />
              <span>{o}</span>
            </li>
          ))}
        </ul>
      )}

      {market?.recomendacion && (
        <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-rotulo text-inkSoft">
          <Info size={13} className="mt-0.5 shrink-0 text-mute" aria-hidden />
          <span>{market.recomendacion}</span>
        </p>
      )}
    </section>
  );
}

/**
 * El precio ofertado cae dentro del rango de lo observado (`enRangoDelJuez`): la frase con las cifras y una barra del
 * rango con la mediana y lo ofertado marcados. Con varios ítems, la frase dice cuántos y el detalle va en el gráfico.
 */
function DentroDelRango({ findings }: { findings: any[]; fmtMoney: (n: any) => string }) {
  const f = findings.length === 1 ? findings[0] : null;
  // Precios por unidad: con sus dos decimales (S/ 4.70, no S/ 4.7).
  const fmtMoney = (v: number) => `S/ ${v.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const ofertado = f ? Number(f.precio_unitario_ofertado ?? f.precio_unitario_referencial) : null;
  const min = f ? Number(f.rango_min) : null;
  const max = f ? Number(f.rango_max) : null;
  const mediana = f ? Number(f.precio_mediana_mercado ?? f.precio_mediana_comparacion) : null;
  const n = f ? Number(f.n_precios ?? f.precios_observados?.length ?? 0) : 0;
  const diff = f && typeof f.diff_pct === "number" ? f.diff_pct : null;
  const delEstado = f && (f.precios_observados ?? []).length > 0 && (f.precios_observados ?? []).every((p: any) => p?.origen === "conosce" || /oece|seace/i.test(String(p?.dominio ?? "")));
  const de = delEstado ? "compras del Estado" : "precios de mercado";
  // La barra: de un poco menos que el mínimo a un poco más que el máximo (o que lo ofertado, si lo pasa).
  const lo = f && min !== null ? Math.min(min, ofertado ?? min) * 0.85 : 0;
  const hi = f && max !== null ? Math.max(max, ofertado ?? max) * 1.08 : 1;
  const x = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  return (
    <section className="rounded-2xl border border-line bg-paper p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-seccion font-bold leading-tight text-ink text-balance">
            {f && ofertado !== null ? <>Pagó {fmtMoney(ofertado)} por unidad: dentro de lo que se pagó antes</> : <>Los precios ofertados están dentro del rango observado</>}
          </h2>
          <p className="mt-1.5 max-w-[65ch] text-dato leading-snug text-inkSoft text-pretty">
            {f && min !== null && max !== null && mediana !== null ? (
              <>
                Se comparó con {numero(n)} {de} del mismo producto, de {fmtMoney(min)} a {fmtMoney(max)}.{" "}
                {diff !== null && diff > 0 ? (
                  <>
                    Está {porcentaje(diff, { decimales: 0 })} sobre la mediana ({fmtMoney(mediana)}), pero no pasa el precio más alto: no se marca como
                    sobreprecio.
                  </>
                ) : (
                  <>No pasa el precio más alto: no se marca como sobreprecio.</>
                )}
              </>
            ) : (
              <>
                En {findings.length} ítems lo ofertado no pasa el precio más alto observado: no se marca sobreprecio. El detalle de cada uno está en el
                gráfico.
              </>
            )}
          </p>
        </div>
        <span className={cn("pill shrink-0 px-2 py-0.5 text-rotulo", POSITIVO.fondo, POSITIVO.texto, POSITIVO.borde)}>
          <Scale size={12} aria-hidden />
          Dentro del rango
        </span>
      </div>
      {f && min !== null && max !== null && ofertado !== null && (
        <div className="mt-5" aria-hidden>
          <div className="relative h-10">
            {/* El rango observado, la mediana y lo ofertado. */}
            <span className="absolute top-4 h-2 rounded-full bg-moss/25" style={{ left: x(min), width: `calc(${x(max)} - ${x(min)})` }} />
            {mediana !== null && <span className="absolute top-2.5 h-5 w-0.5 -translate-x-1/2 bg-ink/60" style={{ left: x(mediana) }} />}
            <span className="absolute top-3 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-paper bg-ink shadow-[0_1px_3px_rgb(var(--ink)/0.3)]" style={{ left: x(ofertado) }} />
          </div>
          <div className="relative h-5 text-micro tabular-nums text-mute">
            <span className="absolute -translate-x-1/2" style={{ left: x(min) }}>{fmtMoney(min)}</span>
            <span className="absolute -translate-x-1/2" style={{ left: x(max) }}>{fmtMoney(max)}</span>
          </div>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-rotulo text-inkSoft">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-moss/25" /> rango de las {numero(n)} {de}</span>
            {mediana !== null && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-ink/60" /> mediana {fmtMoney(mediana)}</span>}
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ink" /> lo que pagó esta entidad {fmtMoney(ofertado)}</span>
          </p>
        </div>
      )}
    </section>
  );
}
