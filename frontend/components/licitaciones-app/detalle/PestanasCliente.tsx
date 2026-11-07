"use client";

import { useState } from "react";
import { CheckCircle2, History, MessageSquare, Trash2 } from "lucide-react";
import { ErrorAlmacen, LARGO_COMENTARIO } from "@/lib/licitaciones-app/almacen";
import { fechaHoraLima } from "@/lib/licitaciones-app/formato";
import { getAlmacen, useEstadoUsuario } from "@/lib/licitaciones-app/usarAlmacen";
import { Caja } from "@/components/gobserva/app/Caja";
import { cn } from "@/lib/utils";
import { EstadoVacio } from "../ui/Estados";
import { Insignia } from "../ui/Insignia";
import { SeguirConEtapa } from "../seguimiento/BotonSeguir";

const NOTA_DEMO = "Demostración: se guarda en este navegador. Con el equipo, lo verán tus compañeros.";

/** Los comentarios del equipo sobre el proceso: escribir (con su tope y su error), leer y borrar. */
export function PestanaComentarios({ id }: { id: string }) {
  const { comentarios } = useEstadoUsuario();
  const lista = comentarios[id] ?? [];
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const resta = LARGO_COMENTARIO - texto.length;

  return (
    <Caja id="comentarios" titulo="Comentarios" descripcion={NOTA_DEMO} relleno={false}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          try {
            getAlmacen().comentar(id, texto);
            setTexto("");
            setError(null);
          } catch (err) {
            setError(err instanceof ErrorAlmacen ? err.message : "No pudimos guardarlo. Vuelve a intentarlo.");
          }
        }}
        className="border-b border-line p-4 sm:p-5"
      >
        <label htmlFor="comentario" className="mb-1.5 block text-meta font-semibold text-ink">
          Nuevo comentario
        </label>
        <textarea
          id="comentario"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            if (error) setError(null);
          }}
          rows={3}
          maxLength={LARGO_COMENTARIO + 50}
          placeholder="Qué falta, qué consultar, quién se encarga…"
          aria-invalid={!!error}
          aria-describedby="comentario-ayuda"
          className="w-full resize-y rounded-lg border border-line bg-caja px-3 py-2.5 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 aria-[invalid=true]:border-crimson sm:text-dato"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p id="comentario-ayuda" className={cn("text-meta", error ? "font-medium text-crimsonTexto" : resta < 0 ? "text-crimsonTexto" : "text-mute")} role={error ? "alert" : undefined}>
            {error ?? `${resta < 0 ? `Te pasaste por ${-resta}` : `Quedan ${resta}`} caracteres`}
          </p>
          <button type="submit" className="min-h-10 rounded-lg bg-granate px-4 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep">
            Publicar
          </button>
        </div>
      </form>
      {lista.length === 0 ? (
        <EstadoVacio Icono={MessageSquare} titulo="Todavía no hay comentarios" texto="Anota aquí lo que el equipo debe saber de este proceso." className="py-8 sm:py-10" />
      ) : (
        <ul className="divide-y divide-line">
          {lista.map((c) => (
            <li key={c.id} className="flex gap-3 px-4 py-3.5 sm:px-5">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-granate text-meta font-bold text-paper">
                T
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-meta text-mute">
                  <b className="font-semibold text-ink">Tú</b> {fechaHoraLima(c.creado)}
                </p>
                <p className="mt-1 whitespace-pre-line text-dato leading-relaxed text-ink [overflow-wrap:anywhere]">{c.texto}</p>
              </div>
              {borrando === c.id ? (
                <span className="flex shrink-0 items-start gap-1 text-meta">
                  <button type="button" onClick={() => getAlmacen().borrarComentario(id, c.id)} className="rounded-md px-2 py-1 font-semibold text-crimsonTexto hover:bg-crimson-soft">
                    Borrar
                  </button>
                  <button type="button" onClick={() => setBorrando(null)} className="rounded-md px-2 py-1 text-inkSoft hover:bg-ink/[0.06]">
                    No
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setBorrando(c.id)} aria-label="Borrar el comentario" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-mute hover:bg-ink/[0.06] hover:text-crimsonTexto">
                  <Trash2 size={16} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Caja>
  );
}

/** El historial: lo que pasó en el SEACE (del servidor) y lo que hiciste tú, en orden. */
export function PestanaHistorial({ id, eventos }: { id: string; eventos: { fecha: string; texto: string }[] }) {
  const { historial } = useEstadoUsuario();
  const todos = [
    ...eventos.map((e) => ({ ...e, tuyo: false })),
    ...(historial[id] ?? []).map((e) => ({ ...e, tuyo: true })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));
  return (
    <Caja id="historial" titulo="Historial" descripcion="Lo que pasó en el proceso y lo que hizo tu equipo" relleno={false}>
      {todos.length === 0 ? (
        <EstadoVacio Icono={History} titulo="Sin movimientos todavía" />
      ) : (
        <ol className="divide-y divide-line">
          {todos.map((e, i) => (
            <li key={`${e.fecha}-${i}`} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <Insignia tono={e.tuyo ? "acento" : "neutro"}>{e.tuyo ? "Tu equipo" : "SEACE"}</Insignia>
              <div className="min-w-0 flex-1">
                <p className="text-dato text-ink">{e.texto}</p>
                <p className="mt-0.5 text-meta text-mute">{fechaHoraLima(e.fecha)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Caja>
  );
}

const REQUISITOS = [
  { id: "bases", texto: "Leer las bases y sus anexos completos" },
  { id: "tecnico", texto: "Revisar las especificaciones técnicas o los términos de referencia" },
  { id: "consultas", texto: "Enviar consultas u observaciones antes de que venzan" },
  { id: "rnp", texto: "Confirmar que tu RNP está vigente en el capítulo que corresponde" },
  { id: "experiencia", texto: "Reunir la experiencia que piden (contratos y conformidades)" },
  { id: "dj", texto: "Llenar las declaraciones juradas de los anexos" },
  { id: "precio", texto: "Armar la oferta económica, ítem por ítem" },
  { id: "garantias", texto: "Ver si piden garantías y gestionarlas" },
  { id: "presentar", texto: "Presentar la oferta en el SEACE antes del plazo" },
] as const;

/** La postulación: la etapa en la que estás y un checklist de trabajo (no reemplaza a las bases). */
export function PestanaPostulacion({ id, codigo, titulo }: { id: string; codigo: string | null; titulo: string | null }) {
  const { checklist, seguidos } = useEstadoUsuario();
  const hechos = new Set(checklist[id] ?? []);
  const n = REQUISITOS.filter((r) => hechos.has(r.id)).length;
  return (
    <div className="grid items-start gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Caja
        id="checklist"
        titulo="Checklist de la oferta"
        descripcion="Una guía de trabajo: lo que piden de verdad está en las bases"
        accion={
          <span className="text-meta font-semibold tabular-nums text-inkSoft">
            {n} de {REQUISITOS.length}
          </span>
        }
        relleno={false}
      >
        <div className="px-4 pt-4 sm:px-5" aria-hidden>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-granate transition-[width] duration-normal" style={{ width: `${(n / REQUISITOS.length) * 100}%` }} />
          </div>
        </div>
        <ul className="p-2 sm:p-3">
          {REQUISITOS.map((r) => (
            <li key={r.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-ink/[0.035]">
                <input
                  type="checkbox"
                  checked={hechos.has(r.id)}
                  onChange={(e) => getAlmacen().marcarRequisito(id, r.id, e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-[rgb(var(--granate))]"
                />
                <span className={cn("text-dato", hechos.has(r.id) ? "text-mute line-through decoration-1" : "text-ink")}>{r.texto}</span>
              </label>
            </li>
          ))}
        </ul>
      </Caja>
      <Caja id="etapa" titulo="Tu etapa" descripcion={NOTA_DEMO}>
        {seguidos[id] ? (
          <p className="mb-3 flex items-center gap-2 text-dato text-inkSoft">
            <CheckCircle2 size={17} aria-hidden className="text-granate" /> Lo sigues desde el {fechaHoraLima(seguidos[id].desde)}.
          </p>
        ) : (
          <p className="mb-3 text-dato text-inkSoft">Síguelo para llevarlo en tu seguimiento y marcar su etapa.</p>
        )}
        <SeguirConEtapa id={id} codigo={codigo} titulo={titulo} />
      </Caja>
    </div>
  );
}
