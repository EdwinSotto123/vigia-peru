"use client";

/**
 * Observabilidad del análisis: los ocho evaluadores que revisan el dictamen antes de publicarlo,
 * los guardrails, y lo que costó la corrida.
 *
 * El costo y los tokens estaban como cuatro tiles sueltos —cuatro números grandes sin ninguna
 * escala al lado, que es justo la plantilla que esta dirección rechaza—. Ahora son una línea al
 * pie: la cifra que importa (lo que costó leer este contrato) con su desglose y con la única
 * comparación honesta que existe en el producto (lo que aporta un ciudadano por una lectura).
 */

import { AlertTriangle, CheckCircle2, ExternalLink, Eye } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import { PulseDot } from "@/components/ui/PulseDot";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { cn } from "@/lib/utils";

const EVALS: { n: string; label: string; d: string }[] = [
  { n: "respaldo_de_bandera", label: "Respaldo de bandera", d: "¿la bandera está respaldada por datos verificables (RUC, monto, fecha, artículo)?" },
  { n: "cita_evidencia", label: "Cita de evidencia", d: "¿cada bandera cita norma + fuente oficial (SEACE/OECE)?" },
  { n: "plausibilidad_precio", label: "Plausibilidad de precio", d: "¿el sobreprecio se sostiene con la mediana de mercado?" },
  { n: "coherencia_objeto_items", label: "Coherencia objeto ↔ ítems", d: "¿los ítems analizados pertenecen al objeto de la convocatoria?" },
  { n: "tono_no_acusatorio", label: "Tono no acusatorio", d: "¿el dictamen usa 'señal de riesgo' y nunca acusa de delito?" },
  { n: "completitud_analisis", label: "Completitud del análisis", d: "¿corrieron todas las etapas (docs, mercado, red, dictamen, banderas)?" },
  { n: "cobertura_prensa", label: "Cobertura de prensa", d: "¿el agente de prensa devolvió cobertura estructurada (noticias o 'sin menciones'), no vacío?" },
  { n: "firmantes_plausibles", label: "Firmantes plausibles", d: "¿los firmantes son reales, no placeholders de plantilla ('POSTOR N' sin DNI)?" },
];

const num = (n: any): string => (typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("es-PE") : "—");

export function ObservabilidadPanel({ liveEvents = [], metrics }: { liveEvents?: any[]; metrics?: any }) {
  let liveM: any = null;
  for (let i = liveEvents.length - 1; i >= 0; i--) {
    if (liveEvents[i]?.kind === "metrics") { liveM = liveEvents[i]; break; }
  }
  const live = !!liveM;
  const m = liveM || metrics || null; // resultado: usa métricas persistidas (llm_metrics)
  const hasM = !!m;

  const evalsByName: Record<string, any> = {};
  for (const e of liveEvents) if (e?.kind === "eval" && e.evaluador) evalsByName[e.evaluador] = e;
  const hechos = EVALS.filter((e) => evalsByName[e.n]).length;

  const chipFor = (ev: any): React.ReactNode => {
    if (!ev) return <span className="pill border-line bg-paperSoft text-[10px] text-mute">sin correr</span>;
    if (ev.label != null && ev.pct == null) {
      const ok = ev.label === "ok" || ev.label === "coherente";
      return (
        <span className={cn("pill text-[10px] font-semibold", ok ? "border-moss/40 bg-moss/10 text-moss" : "border-rust/40 bg-crimson-soft text-rust")}>
          {ev.label}
        </span>
      );
    }
    if (ev.pct != null) {
      const cls = ev.pct >= 80 ? "border-moss/40 bg-moss/10 text-moss" : ev.pct >= 50 ? "border-amber/40 bg-amber-soft text-amberTexto" : "border-rust/40 bg-crimson-soft text-rust";
      return (
        <span className={cn("pill text-[10px] font-semibold tabular-nums", cls)}>
          {ev.pct}%{ev.n ? ` (${ev.ok} de ${ev.n})` : ""}
        </span>
      );
    }
    return null;
  };

  return (
    <section className="surface overflow-hidden p-0">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-ink px-4 py-3 text-paper sm:px-5">
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-heroGreen" aria-hidden />
          <h2 className="font-serif text-[15px] font-bold">Cómo se vigila al que vigila</h2>
          {live ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-moss/20 px-2 py-0.5 text-[10px] font-semibold text-moss">
              <PulseDot color="moss" size={6} /> en vivo
            </span>
          ) : hasM ? (
            <span className="rounded-full bg-paper/15 px-2 py-0.5 text-[10px] font-medium text-paper/80">análisis cerrado</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-paper/70">
          {m?.phoenix_trace_id ? (
            <a
              href="https://app.phoenix.arize.com/s/edwin-soto-c"
              target="_blank"
              rel="noreferrer"
              title={`Identificador de la traza: ${m.phoenix_trace_id}. Abre el proyecto vigia-peru en Phoenix y búscalo`}
              className="inline-flex items-center gap-1 rounded-full bg-heroGreen/20 px-2 py-0.5 font-semibold text-heroGreen transition-colors duration-rapido hover:bg-heroGreen/30"
            >
              Ver la traza completa <ExternalLink size={10} aria-hidden />
            </a>
          ) : null}
          <span>Trazas en Arize Phoenix</span>
        </div>
      </header>

      {/* Evaluadores: filas, no tarjetas dentro de una tarjeta. */}
      <div className="bg-paper">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-2 sm:px-5">
          <h3 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <CheckCircle2 size={13} className="text-moss" aria-hidden />
            {hechos > 0 ? `${hechos} de ${EVALS.length} evaluadores ya revisaron este análisis` : `${EVALS.length} evaluadores revisan el análisis al cerrar`}
          </h3>
          <span className="text-[11px] text-mute">4 con un modelo como juez, 4 deterministas en código</span>
        </div>
        <ul className="divide-y divide-line/60">
          {EVALS.map((e) => {
            const ev = evalsByName[e.n];
            return (
              <li key={e.n} className="flex items-start gap-3 px-4 py-2 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-ink">{e.label}</p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-mute">{ev?.pregunta || e.d}</p>
                  {ev?.reason && (
                    <p className="mt-1 border-l-2 border-line pl-2 text-[11px] italic leading-snug text-mute">{ev.reason}</p>
                  )}
                  {Array.isArray(ev?.faltantes) && ev.faltantes.length > 0 && (
                    <p className="mt-1 text-[11px] font-medium text-crimsonTexto">faltó: {ev.faltantes.join(", ")}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {chipFor(ev)}
                  {ev?.metodo && <span className="text-[10px] text-mute">{ev.metodo}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-line bg-paper px-4 py-3 sm:px-5">
        <h3 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <AlertTriangle size={13} className="text-rust" aria-hidden /> Guardrails que no dependen del modelo
        </h3>
        <ul className="mt-1 grid gap-1 text-[11.5px] leading-snug text-mute sm:grid-cols-2">
          <li>Sin corroboración en una fuente oficial no se emite una señal de delito. Es código, no una instrucción al modelo.</li>
          <li>El vocabulario es «señal de riesgo»; el dictamen nunca acusa de un delito.</li>
          <li>Cada llamada de los {TOTAL_AGENTES} agentes queda como span en Phoenix: prompt, respuesta, tokens y latencia.</li>
          <li>Lo normativo se responde con RAG sobre las opiniones del OECE, no de memoria del modelo.</li>
        </ul>
      </div>

      {/* Lo que costó la corrida: una línea con la cifra y su escala, no cuatro cajas. */}
      <div className="border-t border-line bg-paperSoft px-4 py-2.5 text-[12px] leading-relaxed text-mute sm:px-5">
        {hasM ? (
          /* div y no p: el <Popover> del final monta su diálogo como hermano del disparador,
             y un <div> dentro de un <p> rompe la hidratación de React. */
          <div>
            Leer este contrato costó{" "}
            <strong className="font-semibold tabular-nums text-ink">
              ≈ US$ {Number(m.cost_usd ?? 0).toFixed(4)}
            </strong>{" "}
            de cómputo: {num(m.n_llm_calls)} llamadas al modelo y {num(m.tokens_total)} tokens
            {typeof m.tokens_prompt === "number" || typeof m.tokens_output === "number" ? (
              <> ({num(m.tokens_prompt)} de entrada, {num(m.tokens_output)} de salida)</>
            ) : null}
            . Un ciudadano financia una lectura con S/ 3.{" "}
            <Popover
              titulo="Qué incluye esta cifra"
              anchoClase="w-72"
              className="align-baseline text-heroViolet underline decoration-heroViolet/40 transition-colors duration-rapido hover:text-heroViolet-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50"
              trigger={<span className="text-[12px]">qué incluye</span>}
            >
              Es el costo de los tokens del modelo en esta corrida, sumando las llamadas de todos
              los agentes. No incluye la infraestructura ni las descargas del expediente. El aporte
              de S/ 3 paga la lectura completa de un contrato, no solo el cómputo.
            </Popover>
          </div>
        ) : (
          <p>
            Todavía no hay métricas de esta corrida: el costo y los tokens se cierran cuando termina
            el análisis. Cada llamada ya queda registrada como span en Phoenix mientras tanto.
          </p>
        )}
      </div>
    </section>
  );
}
