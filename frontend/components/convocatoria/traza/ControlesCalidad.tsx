"use client";

/**
 * "Controles de calidad": los ocho evaluadores que revisan el análisis antes de publicarlo y las
 * reglas que no dependen del modelo. Arriba, el resumen en cifras (cuántos aprobaron, cuántos
 * con juez de IA y cuántos en código); abajo, un renglón por control, agrupados por método, con
 * su detalle —el porqué y el caso por caso— en un panel.
 *
 * "Aprobado" es un 100 % (o la etiqueta "ok"/"coherente" en los que no cuentan casos); un
 * control que corrió sin nada que revisar (n = 0) no se cuenta como aprobado: "Sin datos".
 */

import type { ReactNode } from "react";
import { Activity, AlertCircle, BookOpen, CheckCircle2, ChevronRight, CircleDashed, ExternalLink, MessageSquareQuote, MinusCircle, ShieldCheck, XCircle } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueDetalle, ChipsDetalle, CitaDetalle, CuerpoDetalle, DatosClave } from "@/components/patrones/Detalle";
import { Indicadores } from "@/components/listado/Indicadores";
import { reglaLabel } from "@/lib/auditoria";
import { numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import type { ApiResult } from "../types";
import { AvisoSeccion } from "../sections/AvisoSeccion";
import { EVALS, metodoHumano, resultadoDe, type Evaluador, type ResultadoControl } from "./evaluadores";
import type { EvaluacionTraza, Recorrido } from "./modelo";
import { legible } from "./pasos";
import { TextoSeguro } from "./redaccion";

const RESULTADO: Record<ResultadoControl, { icono: typeof CheckCircle2; clase: string; palabra: string }> = {
  aprobado: { icono: CheckCircle2, clase: "border-moss/40 bg-moss/10 text-mossTexto", palabra: "Aprobado" },
  parcial: { icono: AlertCircle, clase: "border-line bg-paperDeep text-inkSoft", palabra: "Con observaciones" },
  no_aprobado: { icono: XCircle, clase: "border-crimson/40 bg-crimson-soft text-crimsonTexto", palabra: "No aprobado" },
  sin_datos: { icono: CircleDashed, clase: "border-dashed border-line bg-paper text-mute", palabra: "Sin datos que revisar" },
  no_corrio: { icono: MinusCircle, clase: "border-dashed border-line bg-paper text-mute", palabra: "No corrió" },
};

/** "5 de 5", "ok", "coherente"… con el ícono y el color de su resultado (nunca color solo). */
export function ChipResultado({ ev, resultado }: { ev: EvaluacionTraza | undefined; resultado: ResultadoControl }) {
  const r = RESULTADO[resultado];
  const Icono = r.icono;
  const valor =
    ev && ev.n != null && ev.ok != null && ev.n > 0 ? `${numero(ev.ok)} de ${numero(ev.n)}` : ev?.label ? legible(ev.label) : r.palabra;
  return (
    <span className={cn("pill shrink-0 whitespace-nowrap text-[11.5px] font-semibold tabular-nums", r.clase)} title={r.palabra}>
      <Icono size={12} aria-hidden />
      {valor}
      <span className="sr-only">, {r.palabra.toLowerCase()}</span>
    </span>
  );
}

/** Los controles en una lista corta (panel del grafo, tarjeta del modo Texto). */
export function ControlesEnResumen({ recorrido, onVerControles }: { recorrido: Recorrido; onVerControles?: () => void }) {
  if (!recorrido.evaluaciones.length) return <p className="text-[12.5px] text-mute">Sin registro en la traza.</p>;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line/70">
        {EVALS.map((e) => {
          const ev = recorrido.evaluaciones.find((x) => x.evaluador === e.n);
          return (
            <li key={e.n} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
              <span className="min-w-0 text-ink">{e.label}</span>
              <ChipResultado ev={ev} resultado={resultadoDe(ev)} />
            </li>
          );
        })}
      </ul>
      {onVerControles && (
        <button
          type="button"
          onClick={onVerControles}
          className="inline-flex items-center gap-1 rounded text-[12.5px] font-medium text-granate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50"
        >
          Ver cada control con su detalle <ChevronRight size={13} aria-hidden />
        </button>
      )}
    </div>
  );
}

export function ControlesCalidad({ recorrido, result }: { recorrido: Recorrido; result: ApiResult }) {
  const evs = recorrido.evaluaciones;
  const filas = EVALS.map((e) => {
    const ev = evs.find((x) => x.evaluador === e.n);
    return { e, ev, resultado: resultadoDe(ev), metodo: metodoHumano(ev?.metodo) };
  });
  const aprobados = filas.filter((f) => f.resultado === "aprobado").length;
  const juez = filas.filter((f) => f.metodo === "Juez de IA");
  const codigo = filas.filter((f) => f.metodo === "En código");
  const otros = filas.filter((f) => !f.metodo);
  const observados = filas.filter((f) => f.resultado === "parcial" || f.resultado === "no_aprobado").length;
  const llamadasJuez = typeof (result.self_evals as any)?.n_judge_calls === "number" ? (result.self_evals as any).n_judge_calls : null;

  return (
    <div className="space-y-6">
      <h2 className="sr-only">Controles de calidad</h2>
      {evs.length ? (
        <>
          <Indicadores
            items={[
              {
                valor: `${numero(aprobados)} de ${numero(EVALS.length)}`,
                etiqueta: "controles aprobados",
                contexto: observados ? plural(observados, "con observaciones", "con observaciones") : undefined,
                tono: aprobados === EVALS.length ? "positivo" : "neutro",
                ayuda: (
                  <Ayuda titulo="¿Qué pasa si uno no aprueba?">
                    Antes de publicar, estos controles revisan el análisis. Si falla uno de los que pueden frenarlo, la alerta queda
                    en revisión de una persona del equipo y no se publica sola.
                  </Ayuda>
                ),
              },
              {
                valor: numero(juez.length),
                etiqueta: "con un juez de IA",
                contexto: llamadasJuez != null ? plural(llamadasJuez, "llamada al modelo", "llamadas al modelo") : undefined,
              },
              { valor: numero(codigo.length), etiqueta: "comprobados en código", contexto: "sin modelo de IA" },
            ]}
          />
          <div className="[container-type:inline-size]">
            <div className="grid gap-5 [@container(min-width:40rem)]:grid-cols-2">
              {juez.length > 0 && <GrupoControles titulo="Con un juez de IA" filas={juez} />}
              {codigo.length > 0 && <GrupoControles titulo="Comprobados en código" filas={codigo} />}
              {otros.length > 0 && <GrupoControles titulo="Sin registro del método" filas={otros} />}
            </div>
          </div>
        </>
      ) : (
        <AvisoSeccion titulo="Este análisis no guardó su control de calidad">
          La traza de esta lectura no tiene registro de los evaluadores.
        </AvisoSeccion>
      )}

      <Guardas phoenix={result.llm_metrics?.phoenix_trace_id ?? null} />
    </div>
  );
}

function GrupoControles({ titulo, filas }: { titulo: string; filas: { e: Evaluador; ev: EvaluacionTraza | undefined; resultado: ResultadoControl; metodo: string | null }[] }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 font-display text-[15px] font-bold text-ink">{titulo}</h3>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
        {filas.map(({ e, ev, resultado }) => (
          <li key={e.n}>
            <Revelar
              titulo={e.label}
              descripcion={ev?.pregunta ?? e.d}
              etiqueta={`Ver el detalle del control ${e.label}`}
              detalle={<DetalleControl e={e} ev={ev} resultado={resultado} />}
              className="transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate/50"
            >
              <span className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-ink">{e.label}</span>
                  <span className="block truncate text-[12px] text-mute">{ev?.pregunta ?? e.d}</span>
                </span>
                <ChipResultado ev={ev} resultado={resultado} />
                <ChevronRight size={14} className="shrink-0 text-mute" aria-hidden />
              </span>
            </Revelar>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DetalleControl({ e, ev, resultado }: { e: Evaluador; ev: EvaluacionTraza | undefined; resultado: ResultadoControl }) {
  const metodo = metodoHumano(ev?.metodo);
  if (!ev) {
    return (
      <CuerpoDetalle>
        <ChipsDetalle>
          <ChipResultado ev={ev} resultado={resultado} />
        </ChipsDetalle>
        <p className="text-[14px] text-inkSoft">La traza de este análisis no tiene registro de este control.</p>
      </CuerpoDetalle>
    );
  }
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <ChipResultado ev={ev} resultado={resultado} />
        {metodo && <span className="pill border-line bg-paperSoft text-inkSoft">{metodo}</span>}
      </ChipsDetalle>
      <DatosClave
        items={[
          { etiqueta: "Qué revisa", valor: ev.objetivo ? legible(ev.objetivo).replace(/^\p{L}/u, (c) => c.toUpperCase()) : null },
          {
            etiqueta: "Resultado",
            valor: ev.n != null && ev.ok != null && ev.n > 0 ? `${numero(ev.ok)} de ${numero(ev.n)}${ev.pct != null ? `, ${numero(ev.pct)} %` : ""}` : ev.label ? legible(ev.label) : RESULTADO[resultado].palabra,
          },
          { etiqueta: "Cómo", valor: metodo === "Juez de IA" ? "Un modelo de IA lee el análisis y hace de juez" : metodo === "En código" ? "Una comprobación escrita en código, sin modelo" : null },
        ]}
      />
      {ev.reason && (
        <BloqueDetalle titulo="Por qué">
          <CitaDetalle fuente="Nota del evaluador">
            <TextoSeguro texto={legible(ev.reason)} />
          </CitaDetalle>
        </BloqueDetalle>
      )}
      {ev.porItem.length > 0 && (
        <BloqueDetalle titulo="Caso por caso">
          <ul className="divide-y divide-line/70">
            {ev.porItem.map((it, i) => {
              const ok = [it.respaldada, it.plausible, it.ok].find((v) => typeof v === "boolean") as boolean | undefined;
              const titulo = typeof it.regla === "string" ? reglaLabel(it.regla) : typeof it.item === "string" ? it.item : `Caso ${i + 1}`;
              return (
                <li key={i} className="flex items-start gap-2 py-2 text-[13px]">
                  {ok === true ? (
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-mossTexto" aria-label="Pasó" />
                  ) : ok === false ? (
                    <XCircle size={14} className="mt-0.5 shrink-0 text-crimsonTexto" aria-label="No pasó" />
                  ) : (
                    <CircleDashed size={14} className="mt-0.5 shrink-0 text-mute" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">
                      <TextoSeguro texto={titulo} />
                    </span>
                    {typeof it.reason === "string" && (
                      <span className="block text-[12.5px] leading-snug text-inkSoft">
                        <TextoSeguro texto={it.reason} />
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </BloqueDetalle>
      )}
      {ev.faltantes.length > 0 && (
        <BloqueDetalle titulo="Qué faltó">
          <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink">
            {ev.faltantes.map((f) => (
              <li key={f}>{legible(f)}</li>
            ))}
          </ul>
        </BloqueDetalle>
      )}
    </CuerpoDetalle>
  );
}

/** Lo que no depende del modelo: cuatro reglas, cada una con su ícono. */
function Guardas({ phoenix }: { phoenix: string | null }) {
  const items: { icono: typeof ShieldCheck; titulo: string; detalle: ReactNode }[] = [
    { icono: ShieldCheck, titulo: "Sin fuente oficial, no hay señal de delito", detalle: "Lo decide el código, no una instrucción al modelo." },
    { icono: MessageSquareQuote, titulo: "Se habla de «señal de riesgo»", detalle: "El dictamen nunca acusa a nadie de un delito." },
    { icono: BookOpen, titulo: "La norma, con sus fuentes", detalle: "Lo normativo se responde con las opiniones del OECE, no de memoria del modelo." },
    {
      icono: Activity,
      titulo: "Cada llamada al modelo queda registrada",
      detalle: (
        <>
          En Arize Phoenix: la pregunta, la respuesta, los tokens y la demora.
          {phoenix && (
            <a
              href="https://app.phoenix.arize.com/s/edwin-soto-c"
              target="_blank"
              rel="noreferrer"
              title={`Identificador de la traza: ${phoenix}`}
              className="ml-1 inline-flex items-center gap-0.5 font-medium text-granate hover:underline"
            >
              Ver la traza <ExternalLink size={11} aria-hidden />
            </a>
          )}
        </>
      ),
    },
  ];
  return (
    <section className="[container-type:inline-size]">
      <h3 className="mb-2 font-display text-[15px] font-bold text-ink">Reglas que no dependen del modelo</h3>
      <ul className="grid gap-2 [@container(min-width:36rem)]:grid-cols-2">
        {items.map(({ icono: Icono, titulo, detalle }) => (
          <li key={titulo} className="flex items-start gap-2.5 rounded-xl border border-line bg-paperSoft px-3 py-2.5">
            <Icono size={16} className="mt-0.5 shrink-0 text-inkSoft" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-ink">{titulo}</span>
              <span className="block text-[12.5px] leading-snug text-inkSoft">{detalle}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
