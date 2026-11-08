"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Bookmark, BellRing, Loader2, NotebookPen, Trash2 } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, type Producto } from "@/lib/gobserva";
import { ErrorCuenta, cargarGuardados, fechaLarga, guardar, quitarGuardado, type EstadoGuardado, type Guardado, type Me } from "@/lib/gobserva-cuenta";
import { cn } from "@/lib/utils";
import { Aviso, CAMPO, COSAS } from "./comun";

/** Los estados de lo guardado en cada producto: el camino de una postulación o de un proceso. */
export const ESTADOS: Record<Producto, { valor: EstadoGuardado; etiqueta: string }[]> = {
  empleo: [
    { valor: "guardada", etiqueta: "Guardada" },
    { valor: "postule", etiqueta: "Postulé" },
    { valor: "entrevista", etiqueta: "Entrevista" },
    { valor: "ganada", etiqueta: "Me eligieron" },
    { valor: "descartada", etiqueta: "Descartada" },
  ],
  licitaciones: [
    { valor: "guardada", etiqueta: "Guardada" },
    { valor: "preparando", etiqueta: "Preparando" },
    { valor: "presentada", etiqueta: "Presentada" },
    { valor: "ganada", etiqueta: "Ganada" },
    { valor: "perdida", etiqueta: "Perdida" },
  ],
  obras: [
    { valor: "guardada", etiqueta: "Siguiendo" },
    { valor: "preparando", etiqueta: "Preparando oferta" },
    { valor: "presentada", etiqueta: "Presentada" },
    { valor: "ganada", etiqueta: "Ganada" },
    { valor: "perdida", etiqueta: "Perdida" },
  ],
};

const ruta = (g: Guardado) =>
  g.tipo === "plaza" ? `/plaza/${g.ref}` : g.tipo === "oportunidad" ? `/oportunidad/${encodeURIComponent(g.ref)}` : g.tipo === "menor" ? `/menor/${g.ref}` : `/proyecto/${g.ref}`;

function diasHasta(iso: unknown): number | null {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const hoy = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
  return Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(hoy)) / 86400_000);
}

export function PanelGuardados({ producto, base, me, onCambio }: { producto: Producto; base: string; me: Me; onCambio: () => void }) {
  const { data, mutate, isLoading } = useSWR(["gobserva-guardados", producto], () => cargarGuardados(producto));
  const [filtro, setFiltro] = useState<EstadoGuardado | "todos">("todos");
  const todos = data?.data ?? [];
  const estados = ESTADOS[producto];
  const conteo = useMemo(() => Object.fromEntries(estados.map((e) => [e.valor, todos.filter((g) => g.estado === e.valor).length])), [todos, estados]);
  const visibles = filtro === "todos" ? todos : todos.filter((g) => g.estado === filtro);
  const lim = me.producto?.limites;

  return (
    <section aria-labelledby="guard-t" className="rounded-2xl border border-line bg-caja p-5 shadow-caja sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="guard-t" className="font-display text-seccion font-bold leading-tight text-ink">Tus guardados</h2>
          <p className="mt-1 text-dato text-inkSoft">
            Guarda {COSAS[producto].varias} desde su ficha. Te recordamos 2 días antes de que cierren{producto === "licitaciones" ? " las consultas" : ""}.
          </p>
        </div>
        {lim && <p className="text-meta text-mute">{todos.length} de {lim.guardados}</p>}
      </div>

      {todos.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Filtrar por estado">
          {[{ valor: "todos" as const, etiqueta: "Todos" }, ...estados].map((e) => (
            <li key={e.valor}>
              <button
                type="button"
                onClick={() => setFiltro(e.valor)}
                aria-pressed={filtro === e.valor}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-meta font-semibold",
                  filtro === e.valor ? "border-granate bg-granate text-paper" : "border-line text-inkSoft hover:border-granate/40",
                )}
              >
                {e.etiqueta} {e.valor === "todos" ? todos.length : conteo[e.valor] ?? 0}
              </button>
            </li>
          ))}
        </ul>
      )}

      {isLoading ? (
        <div aria-hidden className="mt-5 h-24 animate-pulse rounded-2xl bg-paperDeep" />
      ) : todos.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-line p-6 text-center">
          <Bookmark size={28} aria-hidden className="mx-auto text-mute" />
          <p className="mt-2 text-dato text-inkSoft">Todavía no guardas nada. En la ficha de cada {COSAS[producto].una} está el botón «Guardar».</p>
          <Link href={rutaEn(base, COSAS[producto].lista)} className={claseAccion("secundario", "mt-4")}>Ver {COSAS[producto].varias}</Link>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {visibles.map((g) => <FilaGuardado key={`${g.tipo}:${g.ref}`} g={g} producto={producto} base={base} onCambio={() => { void mutate(); onCambio(); }} />)}
        </ul>
      )}
    </section>
  );
}

function FilaGuardado({ g, producto, base, onCambio }: { g: Guardado; producto: Producto; base: string; onCambio: () => void }) {
  const [nota, setNota] = useState(g.nota ?? "");
  const [abierta, setAbierta] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dias = diasHasta(g.datos?.cierre);
  const cerrada = dias != null && dias < 0;

  async function cambiar(b: Partial<Pick<Guardado, "estado" | "nota" | "recordar">>) {
    setError(null);
    setOcupado(true);
    try {
      await guardar({ producto, tipo: g.tipo, ref: g.ref, ...b, nota: b.nota ?? undefined });
      onCambio();
    } catch (e) {
      setError(e instanceof ErrorCuenta ? e.message : "No pudimos guardarlo.");
    } finally {
      setOcupado(false);
    }
  }
  async function quitar() {
    setOcupado(true);
    try {
      await quitarGuardado(producto, g.tipo, g.ref);
      onCambio();
    } catch (e) {
      setError(e instanceof ErrorCuenta ? e.message : "No pudimos quitarlo.");
      setOcupado(false);
    }
  }

  return (
    <li className={cn("rounded-2xl border p-4", cerrada ? "border-dashed border-line bg-ink/[0.025]" : "border-line")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={rutaEn(base, ruta(g))} className="text-destacado font-bold text-ink hover:text-granate hover:underline">{g.titulo || g.ref}</Link>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-inkSoft">
            {typeof g.datos?.entidad === "string" && <span>{g.datos.entidad}</span>}
            {typeof g.datos?.cierre === "string" && (
              <span className={cn("rounded-full px-2 py-0.5 font-semibold", cerrada ? "bg-paperDeep text-mute" : dias != null && dias <= 2 ? "bg-amber-soft text-amberTexto" : "bg-paperDeep text-inkSoft")}>
                {cerrada ? "Ya cerró" : dias === 0 ? "Cierra hoy" : dias === 1 ? "Cierra mañana" : `Cierra el ${fechaLarga(g.datos.cierre)}`}
              </span>
            )}
            <span className="text-mute">Guardado el {fechaLarga(g.creado)}</span>
          </p>
        </div>
        <label className="flex items-center gap-2 text-meta font-semibold text-inkSoft">
          <span className="sr-only">Estado</span>
          <select value={g.estado} onChange={(e) => void cambiar({ estado: e.target.value as EstadoGuardado })} disabled={ocupado} className={cn(CAMPO, "w-auto py-1.5")}>
            {ESTADOS[producto].map((e) => <option key={e.valor} value={e.valor}>{e.etiqueta}</option>)}
          </select>
        </label>
      </div>
      {g.nota && !abierta && <p className="mt-2 whitespace-pre-line rounded-xl bg-paperSoft px-3 py-2 text-dato text-inkSoft">{g.nota}</p>}
      {abierta && (
        <div className="mt-3">
          <label htmlFor={`nota-${g.ref}`} className="sr-only">Tu nota</label>
          <textarea id={`nota-${g.ref}`} value={nota} onChange={(e) => setNota(e.target.value)} rows={3} maxLength={1000} className={CAMPO} placeholder="Requisitos que faltan, a quién llamar, qué falta para la oferta…" />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => { void cambiar({ nota }); setAbierta(false); }} disabled={ocupado} className={claseAccion("primario")}>
              {ocupado && <Loader2 size={15} aria-hidden className="animate-spin" />} Guardar la nota
            </button>
            <button type="button" onClick={() => setAbierta(false)} className={claseAccion("fantasma")}>Cancelar</button>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAbierta((v) => !v)} className={claseAccion("fantasma")}>
          <NotebookPen size={15} aria-hidden /> {g.nota ? "Editar la nota" : "Agregar una nota"}
        </button>
        {typeof g.datos?.cierre === "string" && !cerrada && (
          <button type="button" onClick={() => void cambiar({ recordar: !g.recordar })} disabled={ocupado} aria-pressed={g.recordar} className={claseAccion("fantasma")}>
            <BellRing size={15} aria-hidden /> {g.recordar ? "Te recordamos antes del cierre" : "Sin recordatorio"}
          </button>
        )}
        <button type="button" onClick={() => void quitar()} disabled={ocupado} className={claseAccion("fantasma", "text-crimsonTexto")}>
          <Trash2 size={15} aria-hidden /> Quitar
        </button>
      </div>
      {error && <Aviso tono="error" className="mt-2">{error}</Aviso>}
    </li>
  );
}
