"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle, ArrowUp, Bot, Coins, Loader2, MessageSquarePlus, RotateCcw, Square } from "lucide-react";
import { CabeceraPagina, Caja, Pagina } from "@/components/gobserva/app/Caja";
import { Respuesta } from "@/components/admin/chat/Respuesta";
import { Descargas } from "@/components/admin/chat/Descargas";
import type { MensajeAsistente, PasoHerramienta } from "@/components/admin/chat/conversacion";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { cargarUsoMcp, fechaLarga } from "@/lib/gobserva-cuenta";
import { cn } from "@/lib/utils";
import { MODOS, MODOS_DE, useAsistente, type AppAsistente } from "./useAsistente";

const TEXTOS: Record<AppAsistente, { bajada: string; ejemplos: string[]; placeholder: string }> = {
  empleo: {
    bajada: "Pregúntale por plazas del Estado en tus palabras: te responde con las convocatorias abiertas de hoy, sus requisitos y el enlace para postular.",
    ejemplos: [
      "Soy contadora con 3 años de experiencia: ¿a qué plazas puedo postular en Arequipa?",
      "¿Qué plazas de chofer cierran esta semana en Lima?",
      "¿Qué plazas piden solo secundaria y pagan más de S/ 2,000?",
    ],
    placeholder: "Escribe tu pregunta: tu carrera, tu experiencia, dónde quieres trabajar…",
  },
  licitaciones: {
    bajada: "Pregúntale por licitaciones, contratos menores y obras en tus palabras: busca, lee las bases y te dice quién compra, quién gana y a qué precio.",
    ejemplos: [
      "¿Qué licitaciones de uniformes se convocaron esta semana en Cusco?",
      "¿Quién le gana más contratos de combustible al Estado en Arequipa y a qué precio?",
      "¿Qué obras de agua potable de más de S/ 5 millones se vienen en Puno?",
      "Arma un informe del mercado de tóner de los últimos 12 meses.",
    ],
    placeholder: "Escribe tu pregunta: qué vendes, dónde, a qué entidad…",
  },
};

const NUM = new Intl.NumberFormat("es-PE");

/**
 * El asistente de cada app (2026-11-08): una conversación con Claude que consulta los datos de Gobserva con las
 * herramientas del MCP de su producto. Cobra de los créditos del mes del plan (el rápido 5 por pregunta; en Licitaciones
 * también el preciso, 25, y el profundo, de 25 a 100). Sin plan, ofrece los planes.
 */
export function Asistente({ app, base }: { app: AppAsistente; base: string }) {
  const uso = useSWR(["gobserva-mcp", app], () => cargarUsoMcp(app), { revalidateOnFocus: false });
  const refrescar = useCallback(() => void uso.mutate(), [uso]);
  const { mensajes, modo, setModo, enviar, detener, nueva, reintentar, corriendo, aviso, cobro } = useAsistente(app, refrescar);
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);
  const fin = useRef<HTMLDivElement>(null);
  const t = TEXTOS[app];
  const sinPlan = uso.data ? uso.data.creditos === 0 : false;
  const modos = MODOS_DE[app];

  // Lo nuevo de la conversación, a la vista.
  const ultimoLargo = mensajes.length;
  useEffect(() => {
    if (ultimoLargo) fin.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [ultimoLargo]);

  async function mandar(x: string) {
    if (!x.trim() || corriendo) return;
    setTexto("");
    await enviar(x);
    campo.current?.focus();
  }
  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void mandar(texto);
    }
  }

  const creditos = uso.data && uso.data.creditos > 0 && (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-caja px-3 py-1.5 text-meta text-inkSoft">
      <Coins size={14} aria-hidden className="text-granate" />
      Te quedan <b className="font-semibold tabular-nums text-ink">{NUM.format(Math.max(0, uso.data.creditos - uso.data.usados))}</b> de{" "}
      {NUM.format(uso.data.creditos)} créditos
    </span>
  );

  return (
    <Pagina>
      <CabeceraPagina
        titulo="Asistente"
        bajada={t.bajada}
        acciones={
          <>
            {creditos}
            {mensajes.length > 0 && (
              <button type="button" onClick={nueva} className={claseAccion("secundario")}>
                <MessageSquarePlus size={15} aria-hidden /> Nueva conversación
              </button>
            )}
          </>
        }
      />

      {sinPlan ? (
        <Caja titulo="El asistente viene con los planes de pago">
          <p className="max-w-[60ch] text-dato leading-relaxed text-inkSoft">
            Con un plan, cada mes tienes créditos para preguntarle aquí y a tu IA por el MCP.{" "}
            {app === "empleo" ? "Con el plan Alertas son 300: cada pregunta usa 5." : "Con Inicia son 1,500: una pregunta rápida usa 5."}
          </p>
          <Link href={rutaEn(base, "/planes")} className={claseAccion("primario", "mt-4")}>Ver los planes</Link>
        </Caja>
      ) : (
        <Caja relleno={false} cuerpoClassName="flex flex-col">
          <div className="min-h-[18rem] space-y-5 p-4 sm:p-5" aria-live="polite">
            {mensajes.length === 0 ? (
              <div>
                <p className="flex items-center gap-2 text-dato font-semibold text-ink">
                  <Bot size={17} aria-hidden className="text-granate" /> Pregúntale, por ejemplo
                </p>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {t.ejemplos.map((e) => (
                    <li key={e}>
                      <button
                        type="button"
                        onClick={() => void mandar(e)}
                        className="h-full w-full rounded-xl border border-line bg-paperSoft px-3.5 py-2.5 text-left text-dato leading-snug text-inkSoft transition-colors hover:border-granate/50 hover:text-ink"
                      >
                        {e}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              mensajes.map((m, i) =>
                m.rol === "usuario" ? (
                  <p key={m.id} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-granate-50 px-4 py-2.5 text-dato leading-relaxed text-ink [overflow-wrap:anywhere]">
                    {m.texto}
                  </p>
                ) : (
                  <Turno
                    key={m.id}
                    m={m}
                    app={app}
                    pregunta={i > 0 && mensajes[i - 1].rol === "usuario" ? (mensajes[i - 1] as { texto: string }).texto : null}
                    ultimo={i === mensajes.length - 1}
                    onReintentar={reintentar}
                    cobrados={i === mensajes.length - 1 ? cobro?.usados ?? null : null}
                  />
                ),
              )
            )}
            <div ref={fin} />
          </div>

          <div className="border-t border-line p-3 sm:p-4">
            {aviso && (
              <p role="alert" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-crimson/30 bg-crimson-soft px-3.5 py-2.5 text-dato text-crimsonTexto">
                <AlertTriangle size={15} aria-hidden className="shrink-0" />
                <span className="min-w-0 flex-1">{aviso.texto}</span>
                {aviso.codigo !== "tope_dia" && (
                  <Link href={rutaEn(base, "/planes")} className="font-semibold underline underline-offset-2">Ver los planes</Link>
                )}
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mandar(texto);
              }}
              className="flex items-end gap-2"
            >
              <label htmlFor={`asistente-${app}`} className="sr-only">Tu pregunta</label>
              <textarea
                id={`asistente-${app}`}
                ref={campo}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={alTeclear}
                rows={2}
                maxLength={4000}
                placeholder={t.placeholder}
                className="min-h-[3rem] w-full flex-1 resize-y rounded-xl border border-line bg-paper px-3.5 py-2.5 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato"
              />
              {corriendo ? (
                <button type="button" onClick={detener} className={claseAccion("secundario", "min-h-12")} aria-label="Detener la respuesta">
                  <Square size={15} aria-hidden /> Detener
                </button>
              ) : (
                <button type="submit" disabled={!texto.trim()} className={claseAccion("primario", "min-h-12")} aria-label="Enviar la pregunta">
                  <ArrowUp size={16} aria-hidden /> Enviar
                </button>
              )}
            </form>
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              {modos.length > 1 ? (
                <fieldset className="flex flex-wrap items-center gap-1.5">
                  <legend className="sr-only">Modo</legend>
                  {modos.map((x) => (
                    <label
                      key={x}
                      title={MODOS[x].detalle}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-meta",
                        modo === x ? "border-granate bg-granate-50 font-semibold text-ink" : "border-line text-inkSoft hover:text-ink",
                      )}
                    >
                      <input type="radio" name={`modo-${app}`} value={x} checked={modo === x} onChange={() => setModo(x)} className="sr-only" />
                      {MODOS[x].etiqueta} <span className="font-normal text-mute">{MODOS[x].costo}</span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p className="text-meta text-mute">Cada pregunta usa 5 créditos.</p>
              )}
              <p className="text-meta text-mute">
                {uso.data?.renueva ? `Tus créditos se renuevan el ${fechaLarga(uso.data.renueva)}. ` : ""}Gobserva no guarda tus conversaciones.
              </p>
            </div>
          </div>
        </Caja>
      )}
    </Pagina>
  );
}

function Turno({
  m, app, pregunta, ultimo, onReintentar, cobrados,
}: {
  m: MensajeAsistente;
  app: AppAsistente;
  pregunta: string | null;
  ultimo: boolean;
  onReintentar: () => void;
  cobrados: number | null;
}) {
  const pintada = useRef<HTMLDivElement>(null);
  const corriendo = m.estado === "corriendo";
  const herramientas = m.pasos.filter((p): p is PasoHerramienta => p.tipo === "herramienta");
  const enCurso = [...herramientas].reverse().find((p) => p.estado === "en_curso");
  const consultas = [...new Set(herramientas.filter((p) => p.estado === "listo").map((p) => p.titulo))];
  return (
    <article aria-busy={corriendo} className="min-w-0 rounded-2xl border border-line bg-paperSoft">
      {m.texto != null && (
        <div ref={pintada}>
          <Respuesta texto={m.texto} className="px-4 py-3.5 sm:px-5" />
        </div>
      )}
      {corriendo && (
        <p className="flex items-center gap-2 px-4 py-3 text-dato text-inkSoft sm:px-5">
          <Loader2 size={15} aria-hidden className="animate-spin text-granate" />
          {enCurso ? `Consultando: ${enCurso.titulo}` : "Pensando…"}
        </p>
      )}
      {!corriendo && m.texto == null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
          <p className="flex min-w-0 flex-1 items-start gap-2 text-dato text-crimsonTexto">
            <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {m.estado === "detenido" ? "Detuviste la respuesta. No se usaron créditos." : m.error ?? "La respuesta se cortó antes de terminar. No se usaron créditos."}
            </span>
          </p>
          {ultimo && (
            <button type="button" onClick={onReintentar} className={claseAccion("secundario")}>
              <RotateCcw size={14} aria-hidden /> Reintentar
            </button>
          )}
        </div>
      )}
      {!corriendo && m.texto != null && app === "licitaciones" && (
        <Descargas texto={m.texto} pregunta={pregunta} modelo={m.modelo} pasos={m.pasos} revision={m.revision} contenido={pintada} />
      )}
      {!corriendo && m.texto != null && (consultas.length > 0 || cobrados != null) && (
        <p className="border-t border-line px-4 py-2 text-meta text-mute sm:px-5">
          {consultas.length > 0 && `Consultó: ${consultas.join(", ")}.`}
          {cobrados != null && ` Usó ${cobrados} ${cobrados === 1 ? "crédito" : "créditos"}.`}
        </p>
      )}
    </article>
  );
}
