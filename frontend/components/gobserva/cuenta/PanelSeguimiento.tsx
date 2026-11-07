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
import { ABIERTOS, cuando, eventos, rutaItem } from "./plazos";
import { Caja, VacioCaja } from "../app/Caja";

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
      <Caja id="tablero" titulo="Tu tablero">
        <VacioCaja
          Icono={KanbanSquare}
          titulo="Todavía no sigues nada"
          texto="Guarda una licitación o un contrato menor desde su ficha y aquí lo llevas de etapa en etapa, con sus plazos."
          accion={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href={rutaEn(base, "/cuenta?tab=para-ti")} className={claseAccion("primario")}>Ver «Para ti»</Link>
              <Link href={rutaEn(base, "/menores")} className={claseAccion("secundario")}>Contratos menores</Link>
            </div>
          }
        />
      </Caja>
    );
  }

  const todos = data.data;
  const presentadas = todos.filter((i) => i.estado === "presentada");
  const ganadas = todos.filter((i) => i.estado === "ganada");
  const suma = (xs: ItemSeguimiento[]) => xs.reduce((s, i) => s + (i.valor ?? 0), 0);
  const proximo = eventos(todos.filter((i) => ABIERTOS.has(i.estado))).map((e) => e.plazo).find((p) => !cuando(p.fecha).paso) ?? null;

  return (
    <div className="grid gap-4 sm:gap-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-caja lg:grid-cols-4">
        <Resumen etiqueta="En seguimiento" valor={numero(todos.length)} detalle={suma(todos) > 0 ? `${solesCompacto(suma(todos))} en total` : "Sin valor publicado"} />
        <Resumen etiqueta="Presentadas" valor={numero(presentadas.length)} detalle={suma(presentadas) > 0 ? solesCompacto(suma(presentadas)) : "Ofertas enviadas"} />
        <Resumen etiqueta="Ganadas" valor={numero(ganadas.length)} detalle={suma(ganadas) > 0 ? solesCompacto(suma(ganadas)) : "Buenas pro a tu favor"} />
        <Resumen
          etiqueta="Próximo plazo"
          valor={proximo ? cuando(proximo.fecha).texto : "Ninguno"}
          detalle={proximo ? proximo.etiqueta : "Nada por vencer"}
          urgente={!!proximo && cuando(proximo.fecha).urgente}
        />
      </div>

      <Caja
        id="tablero"
        titulo="Tu tablero"
        descripcion="De guardada a ganada: cada etapa con cuántos procesos hay y cuánto suman."
        accion={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div role="group" aria-label="Qué mostrar" className="grid w-full grid-cols-3 gap-1 rounded-lg bg-ink/[0.06] p-1 sm:inline-grid sm:w-auto">
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
                    "min-h-8 rounded-md px-3 text-meta font-semibold transition-colors duration-rapido",
                    fuente === f ? "bg-caja text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink",
                  )}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
            <label className="relative w-full min-w-0 sm:w-52">
              <span className="sr-only">Buscar en tu seguimiento</span>
              <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" className={cn(CAMPO, "min-h-10 rounded-lg py-2 pl-9")} />
            </label>
          </div>
        }
        relleno={false}
        pie={
          <p className="py-1 text-meta leading-relaxed text-mute">
            Arrastra una tarjeta para cambiarla de etapa, o usa sus flechas. La presentación de ofertas no viene en los datos abiertos: su fecha está en el
            cronograma del SEACE, enlazado en cada ficha.
          </p>
        }
      >
      {aviso && <Aviso tono="error" className="mx-4 mt-4 sm:mx-5">{aviso}</Aviso>}

      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto p-4 sm:p-5">
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
                "flex w-[78vw] max-w-[19rem] shrink-0 snap-start flex-col rounded-xl border p-2.5 transition-colors duration-rapido sm:w-[18rem]",
                sobre === e.valor ? "border-granate bg-granate-50" : "border-line bg-lienzo",
              )}
            >
              <header className="flex items-center justify-between gap-2 px-1.5 pb-2.5 pt-1">
                <h3 id={`col-${e.valor}`} className="flex items-center gap-2 text-cuerpo font-bold text-ink">
                  <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", PUNTO[e.valor])} />
                  {e.etiqueta}
                  <span className="rounded-full bg-caja px-2 text-meta font-semibold tabular-nums text-inkSoft">{col.length}</span>
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
      </Caja>
    </div>
  );
}

/** Una cifra del tablero: cuántos hay en esa etapa y cuánto suman (o cuándo vence lo próximo). */
function Resumen({ etiqueta, valor, detalle, urgente = false }: { etiqueta: string; valor: string; detalle: string; urgente?: boolean }) {
  return (
    <div className="min-w-0 bg-caja p-4 sm:p-5">
      <p className="text-meta font-semibold text-inkSoft">{etiqueta}</p>
      <p className={cn("mt-2 truncate font-display text-seccion font-bold leading-none tabular-nums sm:text-cifra", urgente ? "text-crimsonTexto" : "text-ink")}>{valor}</p>
      <p className="mt-1.5 truncate text-meta text-mute">{detalle}</p>
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
      className="cursor-grab rounded-xl border border-line bg-caja p-3 shadow-caja active:cursor-grabbing"
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
        <button type="button" onClick={() => setEditando(true)} className="mt-2 flex w-full items-start gap-1.5 rounded-lg bg-ink/[0.04] px-2 py-1.5 text-left text-meta text-inkSoft hover:text-ink">
          <StickyNote size={13} aria-hidden className="mt-0.5 shrink-0" />
          <span className="line-clamp-2">{i.nota}</span>
        </button>
      ) : null}

      <div className="mt-2.5 flex items-center justify-between gap-1 border-t border-line pt-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <button
            type="button"
            disabled={!anterior}
            onClick={() => anterior && mover(anterior)}
            aria-label={anterior ? `Mover a ${nombreEstado(anterior)}` : "Primera etapa"}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-inkSoft hover:bg-ink/[0.06] hover:text-ink disabled:opacity-30"
          >
            <ChevronLeft size={17} aria-hidden />
          </button>
          <button
            type="button"
            disabled={!siguiente}
            onClick={() => siguiente && mover(siguiente)}
            aria-label={siguiente ? `Mover a ${nombreEstado(siguiente)}` : "Última etapa"}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-inkSoft hover:bg-ink/[0.06] hover:text-ink disabled:opacity-30"
          >
            <ChevronRight size={17} aria-hidden />
          </button>
          <label className="sr-only" htmlFor={`mover-${i.tipo}-${i.ref}`}>Mover a</label>
          <select
            id={`mover-${i.tipo}-${i.ref}`}
            value={i.estado}
            onChange={(e) => mover(e.target.value as EstadoGuardado)}
            className="min-h-8 min-w-0 flex-1 rounded-lg border border-line bg-caja px-1.5 text-meta font-semibold text-inkSoft focus:border-granate focus:outline-none"
          >
            {estados.map((e) => <option key={e.valor} value={e.valor}>{e.etiqueta}</option>)}
          </select>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!editando && (
            <button type="button" onClick={() => setEditando(true)} aria-label="Escribir una nota" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-inkSoft hover:bg-ink/[0.06] hover:text-ink">
              <StickyNote size={16} aria-hidden />
            </button>
          )}
          {confirmar ? (
            <span className="inline-flex items-center gap-1.5 text-meta">
              <button type="button" onClick={quitar} className="font-semibold text-crimsonTexto underline">Quitar</button>
              <button type="button" onClick={() => setConfirmar(false)} className="text-inkSoft underline">No</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmar(true)} aria-label="Dejar de seguir" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-inkSoft hover:bg-ink/[0.06] hover:text-crimsonTexto">
              <Trash2 size={16} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
