"use client";

/**
 * "Costo": lo que costó leer el contrato en cómputo, en cifras con su escala (el aporte
 * ciudadano de S/ 3), y quién lo consumió, agente por agente.
 *
 * El total es `llm_metrics` (lo que guarda el backend al cerrar). El consumo por agente sale de
 * los eventos `metrics` de la traza: el backend suma cada sub-corrida a un contador y deja un
 * evento con el acumulado, así que lo de cada agente es la diferencia con el evento anterior.
 * Si la suma por agente no da el total, se dice cuánto quedó sin asignar.
 */

import { Ayuda } from "@/components/patrones/Ayuda";
import { Indicadores, type Indicador } from "@/components/listado/Indicadores";
import { listaY, numero, plural } from "@/lib/formato";
import type { ApiResult } from "../types";
import { AvisoSeccion } from "../sections/AvisoSeccion";
import { usd } from "./cifras";
import type { Recorrido } from "./modelo";

const nro = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function CostoCorrida({ recorrido, result }: { recorrido: Recorrido; result: ApiResult }) {
  const m = (result.llm_metrics ?? null) as (ApiResult["llm_metrics"] & { tokens_thoughts?: number }) | null;
  const costo = nro(m?.cost_usd);
  const llamadas = nro(m?.n_llm_calls);
  const tokens = nro(m?.tokens_total);
  const razonamiento = nro(m?.tokens_thoughts);
  const enCache = nro(m?.tokens_cached);
  const segundos = nro(result.timing?.total_s);

  // Las llamadas del juez de calidad van aparte: se afirma sólo si el último evento de métricas
  // de la traza coincide con el total (es decir, el total se cerró antes de los evaluadores).
  const trace = (result.agent_trace || []) as any[];
  const ultimaMetrica = [...trace].reverse().find((e) => e?.kind === "metrics");
  const juez = nro((result.self_evals as any)?.n_judge_calls);
  // Desde que el backend guarda `por_etapa`, el total ya incluye al juez.
  const juezAparte = !m?.por_etapa && juez != null && juez > 0 && ultimaMetrica && nro(ultimaMetrica.n_llm_calls) === llamadas;

  if (!m || (costo == null && llamadas == null && tokens == null)) {
    return (
      <AvisoSeccion titulo="Este análisis no guardó lo que costó">
        La traza no trae las métricas de consumo del modelo para esta lectura.
      </AvisoSeccion>
    );
  }

  const cifras: Indicador[] = [
    {
      valor: usd(costo),
      etiqueta: "costó leer este contrato",
      contexto: "un aporte ciudadano es S/ 3",
      ayuda: (
        <Ayuda titulo="¿Qué incluye esta cifra?">
          Es el costo de los tokens del modelo en esta lectura: todas las llamadas, incluidas la lectura de documentos, los
          precios de mercado y el control de calidad. No incluye la infraestructura ni las descargas del expediente. El aporte de S/ 3 paga la lectura completa de un contrato, no sólo el
          cómputo.
        </Ayuda>
      ),
    },
    {
      valor: numero(llamadas),
      etiqueta: llamadas === 1 ? "llamada al modelo" : "llamadas al modelo",
      contexto: juezAparte ? `más ${numero(juez)} del control de calidad` : undefined,
    },
    {
      valor: numero(tokens),
      etiqueta: "tokens",
      contexto: nro(m.tokens_prompt) != null && nro(m.tokens_output) != null ? `${numero(m.tokens_prompt)} de entrada y ${numero(m.tokens_output)} de salida` : undefined,
      ayuda: (
        <Ayuda titulo="¿Qué es un token?">
          Un pedazo de palabra: es la unidad con la que el modelo mide y cobra lo que lee (entrada) y lo que escribe (salida).
          {razonamiento != null && razonamiento > 0 && (
            <span className="mt-1.5 block">
              De los tokens de salida, {numero(razonamiento)} fueron del razonamiento interno del modelo antes de responder.
            </span>
          )}
          {enCache != null && enCache > 0 && (
            <span className="mt-1.5 block">
              De los tokens de entrada, {numero(enCache)} el modelo ya los tenía de una llamada anterior y se cobran al 10 %.
            </span>
          )}
        </Ayuda>
      ),
    },
  ];
  if (segundos != null && segundos > 0) {
    cifras.push({ valor: segundos >= 90 ? `${numero(segundos / 60)} min` : `${numero(segundos)} s`, etiqueta: "duró la lectura" });
  }

  const agentes = recorrido.nodos.filter((n) => n.consumo && n.consumo.costo > 0).sort((a, b) => b.consumo!.costo - a.consumo!.costo);
  const maximo = agentes[0]?.consumo?.costo ?? 0;
  const suma = agentes.reduce((s, n) => s + n.consumo!.costo, 0);
  const sinAsignar = costo != null ? costo - suma : 0;
  const sinConsumo = recorrido.nodos.filter((n) => n.tipo === "agente" && (n.estado === "corrio" || n.estado === "fallo") && !n.consumo?.llamadas);

  return (
    <div className="space-y-6">
      <h2 className="sr-only">Costo de la lectura</h2>
      <Indicadores items={cifras} />

      {agentes.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1 font-display text-[15px] font-bold text-ink">
            Quién consumió qué
            <Ayuda titulo="¿Cómo se reparte?">
              Cada agente anota lo que consumió al terminar su parte. Sumado, da el total de arriba.
            </Ayuda>
          </h3>
          <ol className="divide-y divide-line rounded-2xl border border-line bg-paper">
            {agentes.map((n) => {
              const c = n.consumo!;
              const pct = maximo > 0 ? Math.max(2, (c.costo / maximo) * 100) : 0;
              return (
                <li key={n.clave} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{n.titulo}</span>
                    <span className="block text-[12px] tabular-nums text-mute">
                      {plural(c.llamadas, "llamada", "llamadas")}, {numero(c.tokens)} tokens
                    </span>
                  </span>
                  <span className="col-span-2 row-start-2 h-2 overflow-hidden rounded-full bg-paperDeep sm:col-span-1 sm:row-start-auto" aria-hidden>
                    <span className="block h-full rounded-full bg-textil-anil" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-right font-mono text-[13px] tabular-nums text-ink">{usd(c.costo)}</span>
                </li>
              );
            })}
          </ol>
          {Math.abs(sinAsignar) > 0.001 && (
            <p className="mt-2 text-[12.5px] text-mute">
              La suma por agente da {usd(suma)}: {usd(Math.abs(sinAsignar))} del total no quedaron asignados a un agente en la traza.
            </p>
          )}
          {sinConsumo.length > 0 && (
            <p className="mt-2 text-[12.5px] text-mute">
              Sin consumo del modelo registrado: {listaY(sinConsumo.map((n) => n.titulo))}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
