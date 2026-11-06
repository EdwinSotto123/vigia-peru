"use client";

import { memo, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, CircleStop, Coins, Cpu, Loader2, MessageSquare, RotateCcw, Timer, Wrench, XCircle } from "lucide-react";
import { Badge, claseBoton, plural, type Tone } from "@/components/admin/ui";
import { Dato } from "@/components/ui/Dato";
import { cn } from "@/lib/utils";
import { duracion, entero, entradaCompacta, usd, type EstadoPaso, type MensajeAsistente, type Paso, type PasoHerramienta, type Totales } from "./conversacion";
import { Descargas } from "./Descargas";
import { Respuesta } from "./Respuesta";

/**
 * Un turno de la conversación. La pregunta, en una burbuja a la derecha. La respuesta, en una tarjeta: mientras corre,
 * «Pensando…» con los segundos y los pasos a la vista según llegan; al terminar, la respuesta en markdown, debajo los
 * pasos plegados («Pasos (N)») y una línea con tiempo, herramientas, tokens y costo. Una respuesta terminada se puede
 * bajar como informe (Word, PDF, Excel, CSV) o copiar con formato (Descargas.tsx).
 */

export function BurbujaUsuario({ texto }: { texto: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-paperEdge bg-paperDeep px-4 py-2.5 text-cuerpo leading-relaxed text-ink [overflow-wrap:anywhere] sm:max-w-[80%]">
        <span className="sr-only">Tu pregunta: </span>
        {texto}
      </p>
    </div>
  );
}

const ESTADO_PASO: Record<EstadoPaso, { etiqueta: string; tono: Tone }> = {
  en_curso: { etiqueta: "en curso", tono: "warn" },
  listo: { etiqueta: "listo", tono: "ok" },
  error: { etiqueta: "error", tono: "danger" },
  cortado: { etiqueta: "sin terminar", tono: "muted" },
};

export const TurnoAsistente = memo(function TurnoAsistente({
  m,
  pregunta,
  ultimo,
  onReintentar,
}: {
  m: MensajeAsistente;
  /** La pregunta que responde: va de título en el informe que se baja. */
  pregunta: string | null;
  /** Sólo el último turno ofrece reintentar: uno del medio cambiaría el orden de la conversación. */
  ultimo: boolean;
  onReintentar: (id: string) => void;
}) {
  const corriendo = m.estado === "corriendo";
  const enCurso = [...m.pasos].reverse().find((p): p is PasoHerramienta => p.tipo === "herramienta" && p.estado === "en_curso");
  const sinRespuesta = !corriendo && m.texto == null;
  const pintada = useRef<HTMLDivElement>(null);

  return (
    // El margen de arriba deja a la vista el comienzo de la respuesta bajo la barra fija (la fila de secciones en el
    // celular, la cabecera en escritorio) cuando la página salta a ella.
    <article id={`turno-${m.id}`} aria-label="Respuesta del asistente" aria-busy={corriendo} className="min-w-0 scroll-mt-16 rounded-2xl border border-line bg-paperSoft lg:scroll-mt-28">
      {m.texto != null && (
        <div ref={pintada}>
          <Respuesta texto={m.texto} className="px-4 py-3.5 sm:px-5" />
        </div>
      )}

      {sinRespuesta && (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
          <p className={cn("flex min-w-0 flex-1 basis-60 items-start gap-2 text-meta leading-relaxed", m.estado === "error" ? "text-crimsonTexto" : "text-inkSoft")}>
            {m.estado === "error" ? <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> : <CircleStop size={15} className="mt-0.5 shrink-0 text-mute" aria-hidden />}
            <span className="min-w-0 [overflow-wrap:anywhere]">{textoSinRespuesta(m)}</span>
          </p>
          {ultimo && (
            <button type="button" onClick={() => onReintentar(m.id)} className={claseBoton("secundario", "sm")}>
              <RotateCcw size={12} aria-hidden /> Reintentar
            </button>
          )}
        </div>
      )}

      {/* Con respuesta y además un error (p. ej. se cortó al cerrar): se dice debajo, en una línea. */}
      {!sinRespuesta && !corriendo && m.error && (
        <p className="flex items-start gap-2 px-4 pb-3 text-meta text-crimsonTexto sm:px-5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">{m.error}</span>
        </p>
      )}

      {!corriendo && m.texto != null && <Descargas texto={m.texto} pregunta={pregunta} modelo={m.modelo} pasos={m.pasos} contenido={pintada} />}

      {m.pasos.length > 0 && <Pasos pasos={m.pasos} corriendo={corriendo} conRespuesta={m.texto != null} />}

      {/* Al final de la tarjeta, junto al campo: lo que llega empuja los pasos hacia arriba y el indicador sigue a la vista. */}
      {corriendo && <Pensando desde={m.inicio} paso={enCurso?.titulo ?? null} conPasos={m.pasos.length > 0} />}

      {m.fin && <Pie fin={m.fin} modelo={m.modelo} pasos={m.pasos} />}
    </article>
  );
});

function textoSinRespuesta(m: MensajeAsistente): string {
  if (m.estado === "detenido") return "Detuviste la respuesta antes de que terminara.";
  if (m.estado === "error") return m.error ?? "El asistente no pudo terminar.";
  return "La respuesta se cortó antes de terminar (se cerró la conexión o se recargó la página).";
}

/** «Pensando… 12 s» y la herramienta que está consultando. Los segundos no se anuncian: sólo el estado. */
function Pensando({ desde, paso, conPasos }: { desde: number; paso: string | null; conPasos: boolean }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((ahora - desde) / 1000));
  return (
    <div className={cn("flex min-w-0 items-center gap-2 px-4 py-3 text-meta sm:px-5", conPasos && "border-t border-line")}>
      <Loader2 size={15} className="shrink-0 animate-spin text-granate" aria-hidden />
      <span role="status" className="font-medium text-ink">
        Pensando…
      </span>
      <span className="shrink-0 font-mono tabular-nums text-mute" aria-hidden>
        {s} s
      </span>
      {paso && <span className="min-w-0 truncate text-mute">{paso}</span>}
    </div>
  );
}

/**
 * Los pasos del turno: cada herramienta con su entrada, su estado y lo que devolvió, y entre medio lo que el asistente
 * dijo (apagado). Mientras corre se ven abiertos; al llegar la respuesta se pliegan bajo ella.
 */
function Pasos({ pasos, corriendo, conRespuesta }: { pasos: Paso[]; corriendo: boolean; conRespuesta: boolean }) {
  const [abierto, setAbierto] = useState(corriendo);
  const id = useId();
  // Al empezar se abren; al llegar la respuesta se pliegan. Sin respuesta (error, detenido) quedan como estaban.
  useEffect(() => {
    if (corriendo) setAbierto(true);
    else if (conRespuesta) setAbierto(false);
  }, [corriendo, conRespuesta]);

  const herramientas = pasos.filter((p): p is PasoHerramienta => p.tipo === "herramienta");
  const conError = herramientas.filter((p) => p.estado === "error").length;

  return (
    <div className="border-t border-line">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={id}
        onClick={() => setAbierto((a) => !a)}
        className="flex min-h-10 w-full items-center gap-2 px-4 py-2 text-left text-meta font-medium text-inkSoft transition-colors duration-rapido hover:bg-paperDeep/50 hover:text-ink sm:px-5"
      >
        <Wrench size={13} className="shrink-0 text-mute" aria-hidden />
        <span>
          Pasos <span className="tabular-nums">({entero(herramientas.length)})</span>
        </span>
        {conError > 0 && (
          <Badge tono="danger" className="ml-1">
            {plural(conError, "con error", "con error")}
          </Badge>
        )}
        <ChevronDown size={15} className={cn("ml-auto shrink-0 text-mute transition-transform duration-rapido", abierto && "rotate-180")} aria-hidden />
      </button>
      <ol id={id} hidden={!abierto} className="space-y-3 px-4 pb-3.5 pt-1 sm:px-5">
        {pasos.map((p) => (p.tipo === "texto" ? <PasoDicho key={p.id} texto={p.texto} /> : <PasoFila key={p.id} p={p} />))}
      </ol>
    </div>
  );
}

function IconoEstado({ estado }: { estado: EstadoPaso }) {
  const clase = "mt-0.5 shrink-0";
  if (estado === "en_curso") return <Loader2 size={15} className={cn(clase, "animate-spin text-amberTexto")} aria-hidden />;
  if (estado === "listo") return <CheckCircle2 size={15} className={cn(clase, "text-mossTexto")} aria-hidden />;
  if (estado === "error") return <XCircle size={15} className={cn(clase, "text-crimsonTexto")} aria-hidden />;
  return <CircleStop size={15} className={cn(clase, "text-mute")} aria-hidden />;
}

function PasoFila({ p }: { p: PasoHerramienta }) {
  const pares = entradaCompacta(p.entrada);
  const est = ESTADO_PASO[p.estado];
  return (
    <li className="flex min-w-0 gap-2.5">
      <IconoEstado estado={p.estado} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-dato font-medium leading-snug text-ink">{p.titulo}</span>
          {p.titulo !== p.herramienta && <span className="font-mono text-micro text-mute">{p.herramienta}</span>}
          <Badge tono={est.tono}>{est.etiqueta}</Badge>
          {p.caracteres != null && <span className="text-rotulo tabular-nums text-mute">{plural(p.caracteres, "carácter", "caracteres")}</span>}
        </p>
        {pares.length > 0 && (
          <dl className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-rotulo">
            {pares.map(({ clave, valor }) => (
              <div key={clave} className="min-w-0 max-w-full">
                <dt className="inline text-mute">{clave}: </dt>
                <dd className="inline font-mono text-inkSoft [overflow-wrap:anywhere]">{valor}</dd>
              </div>
            ))}
          </dl>
        )}
        {p.resumen && <p className="mt-1 whitespace-pre-line text-meta leading-snug text-mute [overflow-wrap:anywhere]">{p.resumen}</p>}
      </div>
    </li>
  );
}

/** Lo que el asistente dijo entre una herramienta y otra: apagado, para no confundirlo con la respuesta. */
function PasoDicho({ texto }: { texto: string }) {
  return (
    <li className="flex min-w-0 gap-2.5">
      <MessageSquare size={14} className="mt-0.5 shrink-0 text-mute" aria-hidden />
      <p className="min-w-0 whitespace-pre-line text-meta italic leading-snug text-mute [overflow-wrap:anywhere]">{texto}</p>
    </li>
  );
}

/** Tiempo, herramientas, tokens, costo y modelo del turno (evento `fin`), cada dato con su ícono. */
function Pie({ fin, modelo, pasos }: { fin: Totales; modelo: string | null; pasos: Paso[] }) {
  const herramientas = fin.herramientas ?? pasos.filter((p) => p.tipo === "herramienta").length;
  const t = fin.tokens;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-rotulo text-mute sm:px-5">
      {fin.ms != null && (
        <Dato icono={Timer} nombre="Tiempo" mono>
          {duracion(fin.ms)}
        </Dato>
      )}
      <Dato icono={Wrench} nombre="Herramientas">
        {plural(herramientas, "herramienta", "herramientas")}
      </Dato>
      {t && (
        <Dato icono={Cpu} nombre="Tokens">
          <span className="tabular-nums">{entero(t.entrada)}</span> de entrada, <span className="tabular-nums">{entero(t.salida)}</span> de salida
          {t.cache_leidos > 0 && (
            <>
              , <span className="tabular-nums">{entero(t.cache_leidos)}</span> de caché
            </>
          )}
        </Dato>
      )}
      {fin.costo_usd != null && (
        <Dato icono={Coins} nombre="Costo" mono>
          {usd(fin.costo_usd)}
        </Dato>
      )}
      {modelo && (
        <Dato icono={Bot} nombre="Modelo" mono>
          {modelo}
        </Dato>
      )}
    </p>
  );
}
