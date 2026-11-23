"use client";

/**
 * «La corrida, de un vistazo»: lo primero de la vista Trazabilidad (pedido del usuario del 2026-11-17: «hazla
 * protagonista»). En una frase, cuántos agentes corrieron, cuántas veces se llamó al modelo y a las herramientas, cuánto
 * costó y cuánto duró; debajo, dónde se fue el costo en el orden del recorrido (por rama, con el mismo color que llevan
 * las cajas del grafo) y cuántos controles de calidad pasó. Todo sale de la traza y de `llm_metrics`: un dato que no
 * llega no se muestra.
 */

import type { ReactNode } from "react";
import { ChevronRight, ClipboardCheck } from "lucide-react";
import { colorSerie, Medidor } from "@/components/charts/BarraSegmentada";
import { irAPestana } from "@/components/patrones/Pestanas";
import { decimal, numero, plural } from "@/lib/formato";
import type { ApiResult } from "../types";
import { indiceRama, ORDEN_RAMAS, RAMA_LABEL, usd } from "./cifras";
import { EVALS, resultadoDe } from "./evaluadores";
import type { Recorrido } from "./modelo";

const nro = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** «4 min», «48 s». */
const duracion = (s: number) => (s >= 90 ? `${decimal(s / 60, 1)} min` : `${numero(Math.round(s))} s`);

export function ResumenCorrida({
  recorrido,
  result,
  titulo,
  bajada,
}: {
  recorrido: Recorrido;
  result: ApiResult;
  /**
   * El título de la vista que la contiene (la vista «Trazabilidad» del contrato): va ADENTRO de esta tarjeta, grande, en
   * vez de flotar sobre el fondo encima de ella (2026-11-23, el usuario: «no hay jerarquía»).
   */
  titulo?: string;
  bajada?: ReactNode;
}) {
  const m = result.llm_metrics ?? null;
  const costo = nro(m?.cost_usd);
  const llamadas = nro(m?.n_llm_calls);
  const tokens = nro(m?.tokens_total);
  const segundos = nro(result.timing?.total_s);
  const modelo: string | null = typeof result.dictamen?.gen_meta?.model === "string" ? result.dictamen.gen_meta.model : null;

  // El costo por rama, en el orden del recorrido. Lo que no quedó asignado a un agente no se reparte.
  const ramas = ORDEN_RAMAS.map((rama) => {
    const nodos = recorrido.nodos.filter((n) => n.rama === rama);
    return {
      rama,
      costo: nodos.reduce((s, n) => s + (n.consumo?.costo ?? 0), 0),
      agentes: nodos.filter((n) => n.tipo === "agente" && (n.estado === "corrio" || n.estado === "fallo")).length,
      pasos: nodos.filter((n) => n.estado === "corrio" || n.estado === "fallo").length,
    };
  }).filter((r) => r.costo > 0);
  const repartido = ramas.reduce((s, r) => s + r.costo, 0);

  const conControles = recorrido.evaluaciones.length > 0;
  const aprobados = conControles ? EVALS.filter((e) => resultadoDe(recorrido.evaluaciones.find((x) => x.evaluador === e.n)) === "aprobado").length : 0;

  const vacia = !recorrido.agentesCorrieron && costo == null && !recorrido.consultas;
  // Sin nada que contar, nada; con el título de la vista, sólo el título (no puede desaparecer).
  if (vacia && !titulo) return null;

  return (
    <section aria-labelledby="resumen-corrida" className="mb-5 rounded-2xl border border-line bg-paper px-4 py-4 sm:px-5 sm:py-5">
      {titulo ? (
        <>
          <h2 id="resumen-corrida" className="font-display text-seccion font-bold leading-tight text-ink text-balance">
            {titulo}
          </h2>
          {bajada && <p className="mt-1 max-w-3xl text-dato leading-snug text-inkSoft text-pretty">{bajada}</p>}
        </>
      ) : (
        <h3 id="resumen-corrida" className="font-display text-bloque font-bold text-ink">
          La corrida, de un vistazo
        </h3>
      )}
      {/* Las cifras de la corrida como figuras (antes, una frase con cinco números adentro, y las mismas cifras otra vez
          en pastillas sobre el grafo). */}
      {!vacia && (
      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line lg:grid-cols-4" aria-label="La corrida en cifras">
        <Figura etiqueta="Agentes que corrieron" valor={`${numero(recorrido.agentesCorrieron)} de ${numero(recorrido.totalAgentes)}`} />
        <Figura etiqueta="Llamadas al modelo" valor={llamadas != null ? numero(llamadas) : null} />
        <Figura
          etiqueta="Consultas a herramientas y fuentes"
          valor={recorrido.consultas > 0 ? numero(recorrido.consultas) : null}
          nota={recorrido.consultasFallidas > 0 ? <span className="font-semibold text-crimsonTexto">{plural(recorrido.consultasFallidas, "falló", "fallaron")}</span> : null}
        />
        <Figura
          etiqueta="Lo que costó leerlo"
          valor={costo != null ? usd(costo) : null}
          nota={[tokens != null ? `${numero(tokens)} tokens` : null, segundos != null && segundos > 0 ? duracion(segundos) : null].filter(Boolean).join(", ") || null}
        />
      </dl>
      )}
      {modelo && <p className="mt-2 text-meta text-mute">El dictamen lo redactó el modelo {modelo}.</p>}

      {ramas.length > 0 && repartido > 0 && (
        <div className="mt-4">
          <h4 className="text-cuerpo font-semibold text-ink">Dónde se fue el costo, en el orden del recorrido</h4>
          <div
            role="img"
            aria-label={`Costo por rama del recorrido: ${ramas.map((r) => `${RAMA_LABEL[r.rama] ?? r.rama}, ${usd(r.costo)} (${Math.round((100 * r.costo) / repartido)} %)`).join("; ")}`}
            className="mt-2 flex h-3 w-full gap-[2px] overflow-hidden rounded-full"
          >
            {ramas.map((r) => (
              <span
                key={r.rama}
                className="h-full min-w-[3px]"
                style={{ width: `${(100 * r.costo) / repartido}%`, background: colorSerie(indiceRama(r.rama)) }}
              />
            ))}
          </div>
          <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {ramas.map((r) => (
              <li key={r.rama} className="flex min-w-0 items-baseline gap-2 text-meta">
                <span className="inline-block h-2.5 w-2.5 shrink-0 translate-y-px rounded-sm" style={{ background: colorSerie(indiceRama(r.rama)) }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{RAMA_LABEL[r.rama] ?? r.rama}</span>
                  <span className="block text-rotulo text-mute">
                    {r.agentes > 0 ? plural(r.agentes, "agente", "agentes") : plural(r.pasos, "paso", "pasos")}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-meta tabular-nums text-ink">{usd(r.costo)}</span>
                  <span className="block text-rotulo tabular-nums text-mute">{Math.round((100 * r.costo) / repartido)} %</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!vacia && (
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t border-line pt-3">
        {conControles ? (
          <div className="min-w-[14rem] flex-1 sm:max-w-sm">
            <p className="flex items-center gap-1.5 text-meta text-inkSoft">
              <ClipboardCheck size={14} className="shrink-0 text-mute" aria-hidden />
              <span>
                Pasó <strong className="font-semibold text-ink">{numero(aprobados)} de {plural(EVALS.length, "control", "controles")}</strong> de calidad
              </span>
            </p>
            <Medidor parte={EVALS.length ? aprobados / EVALS.length : 0} etiqueta={`${aprobados} de ${EVALS.length} controles de calidad aprobados`} className="mt-1.5" />
          </div>
        ) : (
          <p className="text-meta text-mute">Esta corrida no guardó sus controles de calidad.</p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {conControles && (
            <button type="button" onClick={() => irAPestana("controles", "traza")} className="inline-flex items-center gap-1 text-meta font-semibold text-granate underline-offset-2 hover:underline">
              Ver los controles <ChevronRight size={14} aria-hidden />
            </button>
          )}
          {costo != null && (
            <button type="button" onClick={() => irAPestana("costo", "traza")} className="inline-flex items-center gap-1 text-meta font-semibold text-granate underline-offset-2 hover:underline">
              Ver el costo agente por agente <ChevronRight size={14} aria-hidden />
            </button>
          )}
        </div>
      </div>
      )}
    </section>
  );
}

/** Una cifra de la corrida: grande, con su nombre debajo. Sin dato, «Sin dato» (nunca un cero inventado). */
function Figura({ etiqueta, valor, nota }: { etiqueta: string; valor: string | null; nota?: ReactNode }) {
  return (
    // El nombre va primero en el documento (un `dt` antes de su `dd`) y debajo en pantalla: la cifra manda.
    <div className="flex min-w-0 flex-col bg-paperSoft px-3.5 py-3">
      <dt className="order-2 mt-1.5 text-meta leading-snug text-inkSoft">{etiqueta}</dt>
      <dd className={valor == null ? "order-1 text-dato text-mute" : "order-1 whitespace-nowrap font-display text-seccion font-bold leading-none tabular-nums text-ink sm:text-cifra"}>{valor ?? "Sin dato"}</dd>
      {nota && <dd className="order-3 text-rotulo text-mute">{nota}</dd>}
    </div>
  );
}
