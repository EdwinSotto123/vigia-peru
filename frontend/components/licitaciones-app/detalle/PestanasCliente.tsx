"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, History, Loader2, NotebookPen } from "lucide-react";
import useSWR from "swr";
import { fechaHoraLima } from "@/lib/licitaciones-app/formato";
import { useSeguimiento } from "@/lib/licitaciones-app/useSeguimiento";
import { ErrorCuenta, cargarChecklist, guardarChecklist } from "@/lib/gobserva-cuenta";
import { ESTADOS } from "@/components/gobserva/cuenta/PanelGuardados";
import { Caja } from "@/components/gobserva/app/Caja";
import { cn } from "@/lib/utils";
import { EstadoVacio } from "../ui/Estados";
import { Insignia } from "../ui/Insignia";
import { useAvisos } from "../ui/Avisos";
import { SeguirConEtapa } from "../seguimiento/BotonSeguir";

const LARGO_NOTA = 1000;

/**
 * Las notas del proceso, en tu cuenta (la nota de lo que sigues: la misma del tablero de Seguimiento). Guardar una nota
 * en algo que no sigues lo empieza a seguir, y lo dice.
 */
export function PestanaNotas({ id, titulo }: { id: string; titulo: string | null }) {
  const { porRef, anotar, isLoading } = useSeguimiento();
  const avisar = useAvisos();
  const item = porRef.get(id);
  const [texto, setTexto] = useState("");
  const [tocado, setTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!tocado) setTexto(item?.nota ?? "");
  }, [item?.nota, tocado]);
  const resta = LARGO_NOTA - texto.length;

  async function guardarNota() {
    if (resta < 0) return setError(`La nota puede tener hasta ${LARGO_NOTA} caracteres.`);
    setGuardando(true);
    setError(null);
    try {
      await anotar(id, titulo, texto.trim());
      setTocado(false);
      avisar({ tono: "ok", texto: item ? "Nota guardada." : "Nota guardada: ahora sigues este proceso en tu tablero.", accion: { etiqueta: "Ver mi tablero", href: "/cuenta?tab=seguimiento" } });
    } catch (e) {
      setError(e instanceof ErrorCuenta ? e.message : "No pudimos guardar la nota. Vuelve a intentarlo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Caja id="notas" titulo="Notas" descripcion="Lo que tu equipo debe saber de este proceso. Se guarda en tu cuenta y se ve también en tu tablero.">
      {isLoading ? (
        <div aria-hidden className="h-32 animate-pulse rounded-lg bg-ink/[0.06]" />
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void guardarNota();
          }}
        >
          <label htmlFor="nota" className="mb-1.5 block text-meta font-semibold text-ink">
            {item?.nota ? "Tu nota" : "Nueva nota"}
          </label>
          <textarea
            id="nota"
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setTocado(true);
              if (error) setError(null);
            }}
            rows={6}
            placeholder="Qué falta, qué consultar, quién se encarga, qué precio pensamos ofertar…"
            aria-invalid={!!error}
            aria-describedby="nota-ayuda"
            className="w-full resize-y rounded-lg border border-line bg-caja px-3 py-2.5 text-destacado leading-relaxed text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 aria-[invalid=true]:border-crimson sm:text-dato"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p id="nota-ayuda" role={error ? "alert" : undefined} className={cn("text-meta", error || resta < 0 ? "font-medium text-crimsonTexto" : "text-mute")}>
              {error ?? (resta < 0 ? `Te pasaste por ${-resta} caracteres` : item?.actualizado && !tocado && item.nota ? `Guardada el ${fechaHoraLima(item.actualizado)}` : `Quedan ${resta} caracteres`)}
            </p>
            <button type="submit" disabled={guardando || !tocado} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-granate px-4 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep disabled:opacity-50">
              {guardando ? <Loader2 size={15} aria-hidden className="animate-spin" /> : <NotebookPen size={15} aria-hidden />} Guardar nota
            </button>
          </div>
        </form>
      )}
    </Caja>
  );
}

/** El historial: lo que pasó en el SEACE (del servidor) y lo que hiciste tú (desde tu cuenta), en orden. */
export function PestanaHistorial({ id, eventos }: { id: string; eventos: { fecha: string; texto: string }[] }) {
  const { porRef } = useSeguimiento();
  const item = porRef.get(id);
  const etapa = item ? ESTADOS.licitaciones.find((e) => e.valor === item.estado)?.etiqueta ?? item.estado : null;
  const todos = [
    ...eventos.map((e) => ({ ...e, tuyo: false })),
    ...(item ? [{ fecha: item.creado, texto: "Empezaste a seguirlo.", tuyo: true }] : []),
    ...(item && item.actualizado !== item.creado ? [{ fecha: item.actualizado, texto: `Último cambio: etapa «${etapa}»${item.nota ? " y nota" : ""}.`, tuyo: true }] : []),
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

/** La postulación: la etapa en tu tablero y un checklist de trabajo (no reemplaza a las bases). */
export function PestanaPostulacion({ id, codigo, titulo }: { id: string; codigo: string | null; titulo: string | null }) {
  const { porRef } = useSeguimiento();
  const item = porRef.get(id);
  const avisar = useAvisos();
  const lista = useSWR(["gobserva-checklist", id], () => cargarChecklist(id), { revalidateOnFocus: false });
  const hechos = new Set(lista.data?.hechos ?? []);
  async function marcar(req: string, listo: boolean) {
    const antes = lista.data;
    const sig = new Set(hechos);
    if (listo) sig.add(req);
    else sig.delete(req);
    await lista.mutate({ hechos: [...sig] }, { revalidate: false });
    try {
      await guardarChecklist(id, [...sig]);
    } catch (e) {
      await lista.mutate(antes, { revalidate: false });
      avisar({ tono: "error", texto: e instanceof ErrorCuenta ? e.message : "No pudimos guardar el checklist. Vuelve a intentarlo." });
    }
  }
  const n = REQUISITOS.filter((r) => hechos.has(r.id)).length;
  return (
    <div className="grid items-start gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Caja
        id="checklist"
        titulo="Checklist de la oferta"
        descripcion="Una guía de trabajo: lo que piden de verdad está en las bases. Se guarda en tu cuenta."
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
                  disabled={lista.isLoading}
                  onChange={(e) => void marcar(r.id, e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-[rgb(var(--granate))]"
                />
                <span className={cn("text-dato", hechos.has(r.id) ? "text-mute line-through decoration-1" : "text-ink")}>{r.texto}</span>
              </label>
            </li>
          ))}
        </ul>
      </Caja>
      <Caja id="etapa" titulo="Tu etapa" descripcion="La misma de tu tablero de Seguimiento">
        {item ? (
          <p className="mb-3 flex items-center gap-2 text-dato text-inkSoft">
            <CheckCircle2 size={17} aria-hidden className="text-granate" /> Lo sigues desde el {fechaHoraLima(item.creado)}.
          </p>
        ) : (
          <p className="mb-3 text-dato text-inkSoft">Síguelo para llevarlo en tu tablero, con su plazo en tu calendario.</p>
        )}
        <SeguirConEtapa id={id} codigo={codigo} titulo={titulo} />
      </Caja>
    </div>
  );
}
