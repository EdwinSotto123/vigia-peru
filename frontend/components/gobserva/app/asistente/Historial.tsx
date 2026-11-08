"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, Loader2, MessageSquarePlus, Search, Trash2 } from "lucide-react";
import { borrarConversacion, borrarHistorial, type ConversacionResumen } from "@/lib/gobserva-cuenta";
import { cn } from "@/lib/utils";

const normal = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Hoy, Ayer, Esta semana o Antes, por la fecha de Lima de la última pregunta. */
function grupo(actualizado: string): string {
  const hoy = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
  const dia = actualizado.slice(0, 10);
  const dias = Math.round((Date.parse(hoy) - Date.parse(dia)) / 86_400_000);
  if (dias <= 0) return "Hoy";
  if (dias === 1) return "Ayer";
  if (dias < 7) return "Esta semana";
  return "Antes";
}

/**
 * Las conversaciones guardadas del asistente (migración 269): las de hoy, ayer, esta semana y antes, con buscador. Se
 * abre una, se borra una (con confirmación en la misma fila) o se borra todo el historial.
 */
export function Historial({
  conversaciones, cargando, activa, onAbrir, onNueva, onCambio, usoHref, producto,
}: {
  conversaciones: ConversacionResumen[] | undefined;
  cargando: boolean;
  activa: string | null;
  onAbrir: (id: string) => void;
  onNueva: () => void;
  /** Después de borrar: recargar la lista (y cerrar la conversación si era la abierta). */
  onCambio: (borrada?: string) => void;
  usoHref: string;
  producto: "empleo" | "licitaciones";
}) {
  const [q, setQ] = useState("");
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [todo, setTodo] = useState(false);

  const grupos = useMemo(() => {
    const t = normal(q.trim());
    const lista = (conversaciones ?? []).filter((c) => !t || normal(c.titulo).includes(t));
    const out: { nombre: string; items: ConversacionResumen[] }[] = [];
    for (const c of lista) {
      const g = grupo(c.actualizado);
      const ultimo = out[out.length - 1];
      if (ultimo?.nombre === g) ultimo.items.push(c);
      else out.push({ nombre: g, items: [c] });
    }
    return out;
  }, [conversaciones, q]);

  async function borrar(id: string) {
    setBorrando(id);
    try {
      await borrarConversacion(id);
      onCambio(id);
    } finally {
      setBorrando(null);
      setConfirmar(null);
    }
  }
  async function borrarTodo() {
    setBorrando("todo");
    try {
      await borrarHistorial(producto);
      onCambio(activa ?? undefined);
    } finally {
      setBorrando(null);
      setTodo(false);
    }
  }

  const hay = (conversaciones?.length ?? 0) > 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="font-display text-bloque font-bold text-ink">Conversaciones</h2>
        <button
          type="button"
          onClick={onNueva}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-paper px-3 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate/50"
        >
          <MessageSquarePlus size={15} aria-hidden className="text-granate" /> Nueva
        </button>
      </div>
      {hay && (
        <div className="px-3 pt-3">
          <label className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 focus-within:border-granate focus-within:ring-2 focus-within:ring-granate/30">
            <Search size={14} aria-hidden className="shrink-0 text-mute" />
            <span className="sr-only">Buscar en tus conversaciones</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar"
              className="min-h-9 w-full bg-transparent text-dato text-ink placeholder:text-mute focus:outline-none"
            />
          </label>
        </div>
      )}
      <nav aria-label="Tus conversaciones" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {cargando && !conversaciones ? (
          <ul className="space-y-1.5 px-2 pt-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => <li key={i} className="h-10 animate-pulse rounded-lg bg-ink/[0.05]" />)}
          </ul>
        ) : !hay ? (
          <p className="px-3 py-4 text-meta leading-relaxed text-inkSoft">Aquí quedan tus conversaciones, para retomarlas cuando quieras. Empieza con una pregunta.</p>
        ) : !grupos.length ? (
          <p className="px-3 py-4 text-meta text-inkSoft">Ninguna conversación tiene «{q}» en su nombre.</p>
        ) : (
          grupos.map((g) => (
            <section key={g.nombre} aria-label={g.nombre} className="mb-2">
              <p aria-hidden className="px-3 pb-1 pt-2 text-rotulo font-semibold text-mute">{g.nombre}</p>
              <ul>
                {g.items.map((c) =>
                  confirmar === c.id ? (
                    <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-crimson-soft px-3 py-2 text-meta text-crimsonTexto">
                      <span className="min-w-0 truncate">¿Borrar «{c.titulo}»?</span>
                      <span className="flex shrink-0 gap-2">
                        <button type="button" onClick={() => void borrar(c.id)} disabled={!!borrando} className="font-bold underline">
                          {borrando === c.id ? <Loader2 size={13} aria-hidden className="animate-spin" /> : "Sí"}
                        </button>
                        <button type="button" onClick={() => setConfirmar(null)} className="underline">No</button>
                      </span>
                    </li>
                  ) : (
                    <li key={c.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onAbrir(c.id)}
                        aria-current={activa === c.id ? "true" : undefined}
                        className={cn(
                          "flex w-full flex-col rounded-lg px-3 py-2 pr-9 text-left transition-colors duration-rapido",
                          activa === c.id ? "bg-granate-50 text-ink" : "text-inkSoft hover:bg-ink/[0.04] hover:text-ink",
                        )}
                      >
                        <span className="line-clamp-2 text-dato leading-snug">{c.titulo}</span>
                        <span className="mt-0.5 text-rotulo text-mute">
                          {c.preguntas} {c.preguntas === 1 ? "pregunta" : "preguntas"}, {c.creditos} {c.creditos === 1 ? "crédito" : "créditos"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmar(c.id)}
                        aria-label={`Borrar la conversación «${c.titulo}»`}
                        className="absolute right-1.5 top-2 grid h-7 w-7 place-items-center rounded-md text-mute opacity-0 transition-opacity duration-rapido hover:bg-crimson-soft hover:text-crimsonTexto focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))
        )}
      </nav>
      <div className="space-y-1 border-t border-line px-4 py-3">
        <Link href={usoHref} className="flex items-center gap-2 text-meta font-semibold text-granate hover:underline">
          <BarChart3 size={14} aria-hidden /> Tu uso de créditos
        </Link>
        {hay &&
          (todo ? (
            <p className="flex flex-wrap items-center gap-2 text-meta text-crimsonTexto">
              ¿Borrar todas?
              <button type="button" onClick={() => void borrarTodo()} disabled={!!borrando} className="font-bold underline">Sí, borrar</button>
              <button type="button" onClick={() => setTodo(false)} className="underline">No</button>
            </p>
          ) : (
            <button type="button" onClick={() => setTodo(true)} className="text-meta text-mute hover:text-crimsonTexto hover:underline">
              Borrar todo el historial
            </button>
          ))}
      </div>
    </div>
  );
}
