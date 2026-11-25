"use client";

import { useMemo, type ReactNode } from "react";
import { Check, Link2, Loader2, RotateCcw, TriangleAlert, type LucideIcon } from "lucide-react";
import { Respuesta } from "@/components/admin/chat/Respuesta";
import { RevisionRespuesta } from "@/components/admin/chat/RevisionRespuesta";
import type { MensajeAsistente, PasoHerramienta } from "@/components/admin/chat/conversacion";
import { Llamita } from "@/components/marca/Llamita";
import { cn } from "@/lib/utils";

/** Las piezas de la conversación del asistente de Vigía: quién habla, los globos, las respuestas rápidas y cada turno. */

/** El ojo de Vigía en su placa: quién habla en el chat. */
export function Avatar() {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-paperSoft text-ink [&_svg]:h-5 [&_svg]:w-5" aria-hidden>
      <Llamita />
    </span>
  );
}

/** Un mensaje del asistente que no viene del modelo (saludo, avisos): globo a la izquierda con su avatar. */
export function BurbujaAsistente({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Avatar />
      <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-md border border-line bg-paperSoft px-4 py-3 sm:max-w-[80%]">{children}</div>
    </div>
  );
}

/** Respuestas rápidas: con sesión, un toque pregunta; sin sesión, la pregunta espera a que entres. */
export function Sugerencias({
  titulo,
  opciones,
  alElegir,
  chicas = false,
  desactivado = false,
}: {
  titulo: string;
  opciones: { icono?: LucideIcon; texto: string }[];
  alElegir: (q: string) => void;
  chicas?: boolean;
  desactivado?: boolean;
}) {
  return (
    <section aria-label={titulo} className="pl-[2.875rem]">
      <p className="mb-2 text-meta font-semibold text-mute">{titulo}</p>
      <ul className={cn("gap-2", chicas ? "flex flex-wrap" : "grid sm:grid-cols-2")}>
        {opciones.map(({ icono: Icono, texto }) => (
          <li key={texto} className="min-w-0">
            <button
              type="button"
              disabled={desactivado}
              onClick={() => alElegir(texto)}
              className={cn(
                "flex w-full items-start gap-2.5 border border-line bg-paper text-left text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate disabled:opacity-50",
                chicas ? "min-h-9 items-center rounded-full px-3.5 py-1.5 text-meta font-medium" : "rounded-xl px-3.5 py-3 text-dato leading-snug",
              )}
            >
              {Icono && <Icono size={16} className="mt-0.5 shrink-0 text-granate" aria-hidden />}
              <span className="min-w-0">{texto}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Una respuesta: lo que va consultando mientras corre, la respuesta, su revisión y las consultas que hizo. */
export function Turno({ m, alReintentar }: { m: MensajeAsistente; alReintentar?: () => void }) {
  const corriendo = m.estado === "corriendo";
  const profundo = m.modeloPedido === "fino";
  const pasos = m.pasos.filter((p): p is PasoHerramienta => p.tipo === "herramienta");
  const enlaces = useMemo(() => new Map((m.revision?.enlaces.dudosos ?? []).flatMap((d) => (d.url ? [[d.url, d.motivo] as const] : []))), [m.revision]);
  const montos = useMemo(() => new Map((m.revision?.montos.dudosos ?? []).map((d) => [d.texto, d.motivo] as const)), [m.revision]);
  const enCurso = [...pasos].reverse().find((p) => p.estado === "en_curso");
  const listos = pasos.filter((p) => p.estado === "listo").length;
  return (
    <div className="flex items-start gap-2.5">
      <Avatar />
      <article aria-label="Respuesta del asistente" aria-busy={corriendo} className="min-w-0 flex-1 overflow-hidden rounded-2xl rounded-tl-md border border-line bg-paperSoft">
        {corriendo && (
          <div className="px-4 py-3 sm:px-5" role="status">
            <p className="flex items-center gap-2 text-dato text-inkSoft">
              <Loader2 size={15} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
              {enCurso ? `Consultando: ${enCurso.titulo}` : pasos.length ? "Armando la respuesta" : profundo ? "Planificando la revisión" : "Pensando"}
            </p>
            {pasos.length > 0 && (
              <p className="mt-1 pl-6 text-rotulo tabular-nums text-mute">
                {listos} de {pasos.length} {pasos.length === 1 ? "consulta lista" : "consultas listas"}
                {profundo && ", modo profundo"}
              </p>
            )}
          </div>
        )}
        {m.texto != null && <Respuesta texto={m.texto} className="px-4 py-3.5 sm:px-5" enlacesPorRevisar={enlaces} montosPorRevisar={montos} />}
        {!corriendo && m.texto != null && m.revision && <RevisionRespuesta r={m.revision} />}
        {!corriendo && m.texto == null && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
            <p className="flex min-w-0 flex-1 items-start gap-2 text-dato text-crimsonTexto">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
              {m.error ?? (m.estado === "detenido" ? "Detuviste la respuesta." : "El asistente no llegó a responder.")}
            </p>
            {alReintentar && (
              <button type="button" onClick={alReintentar} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate/40">
                <RotateCcw size={14} aria-hidden />
                Volver a preguntar
              </button>
            )}
          </div>
        )}
        {pasos.length > 0 && !corriendo && (
          <details className="group border-t border-line px-4 py-2 sm:px-5">
            <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-meta font-semibold text-inkSoft underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
              <Link2 size={14} className="shrink-0" aria-hidden />
              Lo que consultó para responder ({pasos.length})
              {profundo && <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-rotulo font-medium text-mute no-underline">Profundo</span>}
            </summary>
            <ol className="mt-2 space-y-1 pb-1">
              {pasos.map((p) => (
                <li key={p.id} className="flex items-start gap-2 text-meta text-inkSoft">
                  {p.estado === "listo" ? <Check size={14} className="mt-0.5 shrink-0 text-moss" aria-hidden /> : <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />}
                  <span className="min-w-0">
                    {p.titulo}
                    {p.estado !== "listo" && <span className="text-mute"> (sin resultado)</span>}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </article>
    </div>
  );
}
