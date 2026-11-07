"use client";

import { useMemo, useState, type DragEvent } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { CalendarClock, ChevronLeft, ChevronRight, KanbanSquare, Loader2, Search, StickyNote, Trash2 } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { ErrorCuenta, cargarSeguimiento, guardar, quitarGuardado, type EstadoGuardado, type ItemSeguimiento } from "@/lib/gobserva-cuenta";
import { numero, solesCompacto } from "@/lib/formato";
import { nombreRegion } from "@/lib/licitaciones";
import { tituloNatural } from "@/lib/landing";
import { cn } from "@/lib/utils";
import { Aviso, CAMPO, Esqueleto } from "./comun";
import { ESTADOS } from "./PanelGuardados";
import { cuando, rutaItem } from "./plazos";

/** El color de cada columna: un punto, nunca el fondo (la severidad la carga el sistema semántico). */
const PUNTO: Partial<Record<EstadoGuardado, string>> = {
  guardada: "bg-mute",
  preparando: "bg-amber",
  presentada: "bg-granate",
  ganada: "bg-moss",
  perdida: "bg-crimson",
};

type Fuente = "todos" | "oportunidad" | "menor";

/**
 * Seguimiento (2026-11-07, el tablero de LicitaLAB y Stotles): lo guardado en columnas por etapa (guardada, preparando,
 * presentada, ganada, perdida), cada una con cuántos son y cuánto suman; cada tarjeta con su próximo plazo y su nota.
 * Se mueve arrastrando (computadora) o con las flechas y «Mover a» (teclado y celular).
 */
export function PanelSeguimiento({ base }: { base: string }) {
  const { data, error, isLoading, mutate } = useSWR(["gobserva-seguimiento"], () => cargarSeguimiento());
  const { mutate: mutarGlobal } = useSWRConfig();
  const [fuente, setFuente] = useState<Fuente>("todos");
  const [q, setQ] = useState("");
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<EstadoGuardado | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const estados = ESTADOS.licitaciones;

  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.data ?? []).filter(
      (i) => (fuente === "todos" || i.tipo === fuente) && (!t || `${i.titulo ?? ""} ${i.entidad ?? ""} ${i.ref}`.toLowerCase().includes(t)),
    );
  }, [data, fuente, q]);

  async function mover(i: ItemSeguimiento, estado: EstadoGuardado) {
    if (i.estado === estado) return;
    setAviso(null);
    const antes = data;
    // Se mueve ya en la pantalla; si la API no lo acepta, vuelve a su columna.
    await mutate({ data: (data?.data ?? []).map((x) => (x.tipo === i.tipo && x.ref === i.ref ? { ...x, estado } : x)) }, { revalidate: false });
    try {
      await guardar({ producto: "licitaciones", tipo: i.tipo, ref: i.ref, estado });
      void mutarGlobal(["gobserva-guardados", "licitaciones"]);
    } catch (e) {
      await mutate(antes, { revalidate: false });
      setAviso(e instanceof ErrorCuenta ? e.message : "No pudimos moverlo ahora. Vuelve a intentarlo.");
    }
  }

  async function quitar(i: ItemSeguimiento) {
    setAviso(null);
    try {
      await quitarGuardado("licitaciones", i.tipo, i.ref);
      await mutate();
      void mutarGlobal(["gobserva-guardados", "licitaciones"]);
    } catch {
      setAviso("No pudimos quitarlo ahora. Vuelve a intentarlo.");
    }
  }

  async function anotar(i: ItemSeguimiento, nota: string) {
    await guardar({ producto: "licitaciones", tipo: i.tipo, ref: i.ref, nota });
    await mutate();
  }

  if (isLoading) return <Esqueleto className="h-96" />;
  if (error) return <Aviso tono="error">No pudimos cargar tu seguimiento. Vuelve a intentarlo en un momento.</Aviso>;
  if (!data?.data.length) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-dashed border-line p-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex max-w-[60ch] items-start gap-3 text-dato leading-relaxed text-inkSoft">
          <KanbanSquare size={22} aria-hidden className="mt-0.5 shrink-0 text-mute" />
          Todavía no sigues nada. Guarda una licitación o un contrato menor desde su ficha y aquí lo llevas de etapa en etapa, con sus plazos.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={rutaEn(base, "/cuenta?tab=para-ti")} className={claseAccion("primario")}>Ver «Para ti»</Link>
          <Link href={rutaEn(base, "/menores")} className={claseAccion("secundario")}>Contratos menores</Link>
        </div>
      </div>
    );
  }

  const todos = data.data;
  const presentadas = todos.filter((i) => i.estado === "presentada");
  const ganadas = todos.filter((i) => i.estado === "ganada");
  const suma = (xs: ItemSeguimiento[]) => xs.reduce((s, i) => s + (i.valor ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-dato text-inkSoft">
          <b className="font-semibold text-ink">{numero(todos.length)}</b> en seguimiento,{" "}
          <b className="font-semibold text-ink">{numero(presentadas.length)}</b> {presentadas.length === 1 ? "presentada" : "presentadas"}
          {suma(presentadas) > 0 ? ` (${solesCompacto(suma(presentadas))})` : ""} y <b className="font-semibold text-ink">{numero(ganadas.length)}</b>{" "}
          {ganadas.length === 1 ? "ganada" : "ganadas"}
          {suma(ganadas) > 0 ? ` (${solesCompacto(suma(ganadas))})` : ""}.
        </p>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div role="group" aria-label="Qué mostrar" className="grid w-full grid-cols-3 gap-1 rounded-full bg-paperDeep p-1 sm:inline-grid sm:w-auto">
            {(
              [
                ["todos", "Todo"],
                ["oportunidad", "Licitaciones"],
                ["menor", "Menores"],
              ] as const
            ).map(([f, etiqueta]) => (
              <button
                key={f}
                type="button"
                aria-pressed={fuente === f}
                onClick={() => setFuente(f)}
                className={cn(
                  "min-h-9 rounded-full px-3 text-meta font-semibold transition-colors duration-rapido",
                  fuente === f ? "bg-paper text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink",
                )}
              >
                {etiqueta}
              </button>
            ))}
          </div>
          <label className="relative w-full min-w-0 sm:w-56">
            <span className="sr-only">Buscar en tu seguimiento</span>
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" className={cn(CAMPO, "min-h-10 py-2 pl-9")} />
          </label>
        </div>
      </div>

      {aviso && <Aviso tono="error">{aviso}</Aviso>}

      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        {estados.map((e, k) => {
          const col = items.filter((i) => i.estado === e.valor);
          const total = suma(col);
          return (
            <section
              key={e.valor}
              aria-labelledby={`col-${e.valor}`}
              onDragOver={(ev: DragEvent) => {
                if (!arrastrando) return;
                ev.preventDefault();
                setSobre(e.valor);
              }}
              onDragLeave={() => setSobre((s) => (s === e.valor ? null : s))}
              onDrop={(ev: DragEvent) => {
                ev.preventDefault();
                const clave = ev.dataTransfer.getData("text/plain");
                const i = items.find((x) => `${x.tipo}:${x.ref}` === clave);
                setSobre(null);
                setArrastrando(null);
                if (i) void mover(i, e.valor);
              }}
              className={cn(
                "flex w-[82vw] max-w-[19rem] shrink-0 snap-start flex-col rounded-2xl border bg-paperSoft p-2.5 transition-colors duration-rapido sm:w-[17rem]",
                sobre === e.valor ? "border-granate bg-granate-50" : "border-line",
              )}
            >
              <header className="flex items-center justify-between gap-2 px-1.5 pb-2.5 pt-1">
                <h3 id={`col-${e.valor}`} className="flex items-center gap-2 text-cuerpo font-bold text-ink">
                  <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", PUNTO[e.valor])} />
                  {e.etiqueta}
                  <span className="rounded-full bg-paper px-2 text-meta font-semibold tabular-nums text-inkSoft">{col.length}</span>
                </h3>
                {total > 0 && <span className="text-meta font-semibold tabular-nums text-inkSoft">{solesCompacto(total)}</span>}
              </header>
              <ul className="flex min-h-24 flex-1 flex-col gap-2">
                {col.map((i) => (
                  <Tarjeta
                    key={`${i.tipo}:${i.ref}`}
                    i={i}
                    base={base}
                    anterior={estados[k - 1]?.valor ?? null}
                    siguiente={estados[k + 1]?.valor ?? null}
                    estados={estados}
                    mover={(estado) => void mover(i, estado)}
                    quitar={() => void quitar(i)}
                    anotar={(nota) => anotar(i, nota)}
                    onArrastre={(si) => setArrastrando(si ? `${i.tipo}:${i.ref}` : null)}
                  />
                ))}
                {col.length === 0 && (
                  <li className="grid flex-1 place-items-center rounded-xl border border-dashed border-line px-3 py-6 text-center text-meta text-mute">
                    {arrastrando ? "Suéltalo aquí" : "Nada en esta etapa"}
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="text-meta leading-relaxed text-mute">
        Arrastra una tarjeta para cambiarla de etapa, o usa sus flechas. La presentación de ofertas no viene en los datos abiertos: su fecha está en el
        cronograma del SEACE, enlazado en cada ficha.
      </p>
    </div>
  );
}

function Tarjeta({
  i, base, anterior, siguiente, estados, mover, quitar, anotar, onArrastre,
}: {
  i: ItemSeguimiento;
  base: string;
  anterior: EstadoGuardado | null;
  siguiente: EstadoGuardado | null;
  estados: { valor: EstadoGuardado; etiqueta: string }[];
  mover: (e: EstadoGuardado) => void;
  quitar: () => void;
  anotar: (nota: string) => Promise<void>;
  onArrastre: (si: boolean) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [nota, setNota] = useState(i.nota ?? "");
  const [guardando, setGuardando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const p = i.proximo;
  const c = p ? cuando(p.fecha) : null;
  const nombreEstado = (v: EstadoGuardado | null) => estados.find((e) => e.valor === v)?.etiqueta ?? "";

  return (
    <li
      draggable
      onDragStart={(ev) => {
        ev.dataTransfer.setData("text/plain", `${i.tipo}:${i.ref}`);
        ev.dataTransfer.effectAllowed = "move";
        onArrastre(true);
      }}
      onDragEnd={() => onArrastre(false)}
      className="cursor-grab rounded-xl border border-line bg-paper p-3 shadow-[0_1px_2px_rgb(0_0_0/0.06)] active:cursor-grabbing"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-paperDeep px-2 py-0.5 text-rotulo font-semibold text-inkSoft">{i.tipo === "menor" ? "Contrato menor" : "Licitación"}</span>
        {i.region && <span className="text-rotulo text-mute">{nombreRegion(i.region) ?? i.region}</span>}
      </div>
      <Link href={rutaEn(base, rutaItem(i))} className="mt-1.5 line-clamp-3 block text-dato font-semibold leading-snug text-ink hover:text-granate hover:underline">
        {i.titulo || "Sin descripción registrada"}
      </Link>
      {i.entidad && <p className="mt-1 truncate text-meta text-inkSoft">{tituloNatural(i.entidad)}</p>}
      {(i.valor || (p && c)) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
          {i.valor ? <span className="font-semibold tabular-nums text-ink">{solesCompacto(i.valor)}</span> : null}
          {p && c && (
            <span className={cn("inline-flex items-center gap-1", c.urgente ? "font-semibold text-crimsonTexto" : "text-inkSoft")}>
              <CalendarClock size={13} aria-hidden />
              {p.clave === "cierre" ? "Cierra" : p.clave === "consultas" ? "Consultas" : p.etiqueta}: {c.texto.toLowerCase()}
            </span>
          )}
        </div>
      )}

      {editando ? (
        <div className="mt-2">
          <label className="sr-only" htmlFor={`nota-${i.tipo}-${i.ref}`}>Nota</label>
          <textarea
            id={`nota-${i.tipo}-${i.ref}`}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={3}
            maxLength={1000}
            className={cn(CAMPO, "text-meta")}
            placeholder="Qué falta, con quién hablaste, a qué precio piensas ofertar"
          />
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              disabled={guardando}
              onClick={async () => {
                setGuardando(true);
                await anotar(nota.trim()).finally(() => setGuardando(false));
                setEditando(false);
              }}
              className={claseAccion("primario", "min-h-9 px-3")}
            >
              {guardando && <Loader2 size={14} aria-hidden className="animate-spin" />} Guardar
            </button>
            <button type="button" onClick={() => { setEditando(false); setNota(i.nota ?? ""); }} className={claseAccion("fantasma", "min-h-9 px-3")}>Cancelar</button>
          </div>
        </div>
      ) : i.nota ? (
        <button type="button" onClick={() => setEditando(true)} className="mt-2 flex w-full items-start gap-1.5 rounded-lg bg-paperSoft px-2 py-1.5 text-left text-meta text-inkSoft hover:text-ink">
          <StickyNote size={13} aria-hidden className="mt-0.5 shrink-0" />
          <span className="line-clamp-2">{i.nota}</span>
        </button>
      ) : null}

      <div className="mt-2.5 flex items-center justify-between gap-1 border-t border-line pt-2">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={!anterior}
            onClick={() => anterior && mover(anterior)}
            aria-label={anterior ? `Mover a ${nombreEstado(anterior)}` : "Primera etapa"}
            className="grid h-9 w-9 place-items-center rounded-full text-inkSoft hover:bg-paperSoft hover:text-ink disabled:opacity-30"
          >
            <ChevronLeft size={17} aria-hidden />
          </button>
          <button
            type="button"
            disabled={!siguiente}
            onClick={() => siguiente && mover(siguiente)}
            aria-label={siguiente ? `Mover a ${nombreEstado(siguiente)}` : "Última etapa"}
            className="grid h-9 w-9 place-items-center rounded-full text-inkSoft hover:bg-paperSoft hover:text-ink disabled:opacity-30"
          >
            <ChevronRight size={17} aria-hidden />
          </button>
          <label className="sr-only" htmlFor={`mover-${i.tipo}-${i.ref}`}>Mover a</label>
          <select
            id={`mover-${i.tipo}-${i.ref}`}
            value={i.estado}
            onChange={(e) => mover(e.target.value as EstadoGuardado)}
            className="min-h-9 max-w-[7.5rem] rounded-full border border-line bg-paper px-2 text-meta font-semibold text-inkSoft focus:border-granate focus:outline-none"
          >
            {estados.map((e) => <option key={e.valor} value={e.valor}>{e.etiqueta}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-0.5">
          {!editando && (
            <button type="button" onClick={() => setEditando(true)} aria-label="Escribir una nota" className="grid h-9 w-9 place-items-center rounded-full text-inkSoft hover:bg-paperSoft hover:text-ink">
              <StickyNote size={16} aria-hidden />
            </button>
          )}
          {confirmar ? (
            <span className="inline-flex items-center gap-1.5 text-meta">
              <button type="button" onClick={quitar} className="font-semibold text-crimsonTexto underline">Quitar</button>
              <button type="button" onClick={() => setConfirmar(false)} className="text-inkSoft underline">No</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmar(true)} aria-label="Dejar de seguir" className="grid h-9 w-9 place-items-center rounded-full text-inkSoft hover:bg-paperSoft hover:text-crimsonTexto">
              <Trash2 size={16} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
