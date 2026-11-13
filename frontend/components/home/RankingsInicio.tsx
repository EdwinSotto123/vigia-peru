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
 * Cada fila lleva a la FICHA de lo que nombra (la entidad, el partido, el aliado, la región): antes las entidades y las
 * regiones llevaban directo a pagar. Financiar queda como la acción secundaria de la pestaña, al pie.
 *
 * Desde el 2026-11-13 va a todo el ancho y cada fila es UNA línea desde md (puesto, nombre con su contexto, barra y
 * cifra en columnas): antes eran tres renglones por fila en media pantalla, 81 px cada una. En el celular la barra baja
 * a su propio renglón.
 */
export interface FilaRank {
  id: string;
  nombre: string;
  /** Una línea corta bajo el nombre. */
  sub?: string;
  /** Lo que ordena la fila y fija el largo de su barra. */
  valor: number;
  /** El número, ya con su texto ("116 en cola"). */
  texto: string;
  /** De `valor`, qué parte (0 a 1) va en color pleno; el resto, atenuado (p. ej. lo ya leído). */
  parte?: number;
  /** La ficha de lo que nombra la fila. */
  href?: string;
}
export interface PestanaRank {
  id: string;
  etiqueta: string;
  /** La métrica, en una frase. */
  metrica: string;
  filas: FilaRank[];
  verTodos: { href: string; texto: string };
  /** La acción secundaria de la pestaña (financiar la lectura de lo que ordena), junto a "Ver todos". */
  accion?: { href: string; texto: string };
  /** Aclaración opcional bajo la lista. */
  nota?: string;
}

/** Una fila: puesto | nombre y contexto | cifra en el celular (la barra abajo); desde md, puesto | nombre | barra | cifra. */
const FILA =
  "grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-2 py-2 md:grid-cols-[1.25rem_minmax(0,17rem)_minmax(0,1fr)_8.5rem] md:gap-x-4";

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
    <section aria-labelledby={`${base}-t`} className="tarjeta rounded-2xl border border-line bg-paper">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-5">
        <h2 id={`${base}-t`} className="font-display text-bloque font-bold leading-tight text-ink sm:text-seccion">Avance de la lectura</h2>
        <div role="tablist" aria-label="Qué ordenar" className="grid auto-cols-fr grid-flow-col gap-1 rounded-full border border-line bg-paperDeep p-1 sm:inline-flex">
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

      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${actual.id}`} className="px-4 py-3 sm:px-5">
        <p className="text-meta leading-snug text-mute">{actual.metrica}</p>
        {actual.filas.length === 0 ? (
          <p className="mt-3 rounded-xl bg-paperSoft px-4 py-6 text-center text-dato text-mute">Todavía no hay datos para ordenar.</p>
        ) : (
          <ol className="mt-2 divide-y divide-line">
            {actual.filas.map((f, i) => {
              const ancho = Math.max(3, (f.valor / max) * 100);
              const cuerpo = (
                <>
                  <span aria-hidden className="text-center font-mono text-meta font-bold tabular-nums text-mute">{i + 1}</span>
                  <span className="min-w-0">
                    {/* El nombre en dos líneas en el celular: "Gobierno Regional d…" tres veces no distinguía a nadie. */}
                    <span className="line-clamp-2 text-dato font-semibold leading-snug text-ink md:line-clamp-1" title={f.nombre}>
                      {f.nombre}
                    </span>
                    {f.sub && <span className="hidden truncate text-meta text-mute md:block">{f.sub}</span>}
                  </span>
                  {/* La barra: en el celular, su propio renglón bajo el nombre; desde md, la columna del medio. */}
                  <span aria-hidden className="col-span-2 col-start-2 block h-2 overflow-hidden rounded-full bg-paperDeep md:col-span-1 md:col-start-auto">
                    <span className="relative block h-full rounded-full bg-granate/30" style={{ width: `${ancho}%` }}>
                      {f.parte != null && <span className="absolute inset-y-0 left-0 rounded-full bg-granate" style={{ width: `${Math.max(0, Math.min(1, f.parte)) * 100}%` }} />}
                      {f.parte == null && <span className="absolute inset-0 rounded-full bg-granate" />}
                    </span>
                  </span>
                  <span className="col-start-3 row-start-1 whitespace-nowrap text-right font-mono text-meta font-semibold tabular-nums text-ink md:col-start-auto md:row-start-auto">
                    {f.texto}
                  </span>
                  {/* En el celular el contexto va bajo la barra, a lo ancho: al lado del nombre se cortaba a la mitad. */}
                  {f.sub && <span className="col-span-2 col-start-2 text-meta leading-snug text-mute md:hidden">{f.sub}</span>}
                </>
              );
              return (
                <li key={f.id}>
                  {f.href ? (
                    <Link href={f.href} className={cn(FILA, "rounded-lg transition-colors duration-rapido hover:bg-granate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-granate")}>
                      {cuerpo}
                    </Link>
                  ) : (
                    <div className={FILA}>{cuerpo}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {actual.nota && <p className="mt-2 text-meta leading-snug text-mute">{actual.nota}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3">
          <Link
            href={actual.verTodos.href}
            className="inline-flex min-h-10 items-center gap-1.5 text-dato font-semibold text-granate underline-offset-4 hover:underline"
          >
            {actual.verTodos.texto} <ArrowRight size={14} aria-hidden />
          </Link>
          {/* La acción secundaria con forma de botón: suelta y en gris se leía como texto (2026-10-29). */}
          {actual.accion && (
            <Link
              href={actual.accion.href}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-paper px-4 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
            >
              {actual.accion.texto}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
