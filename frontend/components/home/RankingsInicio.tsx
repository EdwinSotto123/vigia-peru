"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Rankings de /app: una pestaña por cosa que se puede ordenar (entidades, partidos, aliados, regiones),
 * top 5 y un solo enlace "Ver todos". Los datos llegan ya armados desde el servidor (sólo valores, nunca
 * funciones: un server component no puede pasar funciones a un client component).
 *
 * Cada pestaña dice en una línea CUÁL es la métrica: un ranking sin su regla confunde más de lo que informa.
 */
export interface FilaRank {
  id: string;
  nombre: string;
  /** Una línea corta bajo el nombre. */
  sub?: string;
  /** Lo que ordena la fila y fija el largo de su barra. */
  valor: number;
  /** El número, ya con su texto ("116 esperando"). */
  texto: string;
  /** De `valor`, qué parte (0 a 1) va en color pleno; el resto, atenuado (p. ej. lo ya leído). */
  parte?: number;
  href?: string;
}
export interface PestanaRank {
  id: string;
  etiqueta: string;
  /** La métrica, en una frase. */
  metrica: string;
  filas: FilaRank[];
  verTodos: { href: string; texto: string };
  /** Aclaración opcional bajo la lista. */
  nota?: string;
}

export function RankingsInicio({ pestanas }: { pestanas: PestanaRank[] }) {
  const base = useId();
  const [activa, setActiva] = useState(pestanas[0]?.id ?? "");
  const botones = useRef<Record<string, HTMLButtonElement | null>>({});
  if (pestanas.length === 0) return null;
  const actual = pestanas.find((p) => p.id === activa) ?? pestanas[0];
  const max = Math.max(1, ...actual.filas.map((f) => f.valor));

  const teclas = (e: KeyboardEvent, i: number) => {
    const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!paso && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const n = e.key === "Home" ? 0 : e.key === "End" ? pestanas.length - 1 : (i + paso + pestanas.length) % pestanas.length;
    setActiva(pestanas[n].id);
    botones.current[pestanas[n].id]?.focus();
  };

  return (
    <section aria-labelledby={`${base}-t`} className="rounded-2xl border border-line bg-paper">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-5">
        <h2 id={`${base}-t`} className="font-display text-bloque font-bold leading-tight text-ink sm:text-seccion">Rankings</h2>
        <div role="tablist" aria-label="Qué ordenar" className="grid grid-cols-4 gap-1 rounded-full border border-line bg-paperDeep p-1 sm:inline-flex">
          {pestanas.map((p, i) => (
            <button
              key={p.id}
              ref={(el) => { botones.current[p.id] = el; }}
              role="tab"
              type="button"
              id={`${base}-tab-${p.id}`}
              aria-selected={actual.id === p.id}
              aria-controls={`${base}-panel`}
              tabIndex={actual.id === p.id ? 0 : -1}
              onClick={() => setActiva(p.id)}
              onKeyDown={(e) => teclas(e, i)}
              className={cn(
                "min-h-9 rounded-full px-1.5 text-meta font-semibold sm:px-3.5 sm:text-dato transition-colors duration-rapido focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-granate",
                actual.id === p.id ? "bg-granate text-paper" : "text-inkSoft hover:text-ink",
              )}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${actual.id}`} className="px-4 py-4 sm:px-5">
        <p className="text-dato leading-snug text-mute">{actual.metrica}</p>
        {actual.filas.length === 0 ? (
          <p className="mt-4 rounded-xl bg-paperSoft px-4 py-6 text-center text-dato text-mute">Todavía no hay datos para ordenar.</p>
        ) : (
          <ol className="mt-3 space-y-1.5">
            {actual.filas.map((f, i) => {
              const ancho = Math.max(3, (f.valor / max) * 100);
              const cuerpo = (
                <>
                  <span aria-hidden className="w-6 shrink-0 text-center font-mono text-meta font-bold tabular-nums text-mute">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-cuerpo font-semibold text-ink">{f.nombre}</span>
                      <span className="shrink-0 font-mono text-meta font-semibold tabular-nums text-ink">{f.texto}</span>
                    </span>
                    <span aria-hidden className="mt-1.5 block h-2 overflow-hidden rounded-full bg-paperDeep">
                      <span className="relative block h-full rounded-full bg-granate/30" style={{ width: `${ancho}%` }}>
                        {f.parte != null && <span className="absolute inset-y-0 left-0 rounded-full bg-granate" style={{ width: `${Math.max(0, Math.min(1, f.parte)) * 100}%` }} />}
                        {f.parte == null && <span className="absolute inset-0 rounded-full bg-granate" />}
                      </span>
                    </span>
                    {f.sub && <span className="mt-1 block truncate text-meta text-mute">{f.sub}</span>}
                  </span>
                </>
              );
              return (
                <li key={f.id}>
                  {f.href ? (
                    <Link href={f.href} className="flex items-start gap-2 rounded-xl px-2 py-2 transition-colors duration-rapido hover:bg-granate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-granate">
                      {cuerpo}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-2 px-2 py-2">{cuerpo}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {actual.nota && <p className="mt-3 text-meta leading-snug text-mute">{actual.nota}</p>}
        <Link
          href={actual.verTodos.href}
          className="mt-4 inline-flex min-h-10 items-center gap-1.5 text-dato font-semibold text-granate underline-offset-4 hover:underline"
        >
          {actual.verTodos.texto} <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
