"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Link2, LocateFixed, TrendingUp } from "lucide-react";
import { irAPestana } from "@/components/patrones/Pestanas";
import { Severidad } from "@/components/ui/Severidad";
import { fechaConAnio } from "@/lib/formato";
import { mesLargo, type PatronHistoria, type SecuenciaHistoria, type SeveridadHistoria } from "@/lib/historia";
import { cn } from "@/lib/utils";

/** Lo que pide «Verlo en la línea» a la línea de tiempo de la misma historia (`clave`): un patrón o una secuencia. */
export const VER_EN_LINEA = "vigia:historia-ver";
/** Lo que avisa la línea de tiempo cuando cambia lo elegido (para marcar la tarjeta), o `null` al cerrarlo. */
export const ELEGIDO_EN_LINEA = "vigia:historia-elegido";
export type PedidoLinea = { clave: string; tipo: "patron" | "secuencia"; id: string };
export type ElegidoLinea = { clave: string; id: string | null };

/** El id del lienzo de una historia en la página (para saber si su pestaña está a la vista). */
export const idLinea = (clave: string) => `linea-${clave.replace(/[^a-zA-Z0-9]/g, "-")}`;

type Item = { tipo: "secuencia"; s: SecuenciaHistoria } | { tipo: "patron"; p: PatronHistoria };
const PESO: Record<SeveridadHistoria, number> = { alta: 0, media: 1, baja: 2 };
const sevDe = (x: Item) => (x.tipo === "secuencia" ? x.s.severidad : x.p.severidad);
const idDe = (x: Item) => (x.tipo === "secuencia" ? x.s.id : x.p.id);

/**
 * «Lo que llama la atención»: en un solo lugar y en orden de gravedad, las secuencias que prueban sus datos (una cosa
 * llevó a otra) y los meses fuera de lo normal de sus series. Antes eran dos grillas de tarjetas seguidas («Lo que
 * encadenan sus datos» y «Lo que llama la atención en sus datos») que se leían como lo mismo repetido (pedido del usuario
 * del 2026-10-28: «ordénalo más adecuadamente, parece que se repite información»).
 *
 * Cada tarjeta dice qué clase de hallazgo es, cuándo, qué pasó (los pasos de la secuencia o la explicación del pico) y
 * lleva a la línea de tiempo con eso marcado; la secuencia, además, a su evidencia. Cuatro a la vista; el resto, a un toque.
 */
export function Destacados({ clave, secuencias, patrones }: { clave: string; secuencias: SecuenciaHistoria[]; patrones: PatronHistoria[] }) {
  const [todos, setTodos] = useState(false);
  const [elegido, setElegido] = useState<string | null>(null);

  // La línea avisa qué quedó elegido (o que se cerró): la tarjeta se marca igual.
  useEffect(() => {
    const alElegir = (e: Event) => {
      const d = (e as CustomEvent<ElegidoLinea>).detail;
      if (d?.clave === clave) setElegido(d.id);
    };
    window.addEventListener(ELEGIDO_EN_LINEA, alElegir);
    return () => window.removeEventListener(ELEGIDO_EN_LINEA, alElegir);
  }, [clave]);

  // Lo más grave primero; a igual gravedad, las secuencias (prueban un encadenamiento) antes que los picos. Dentro de
  // cada clase, el orden de la API (de lo más fuerte a lo menos).
  const items: Item[] = [
    ...secuencias.map((s) => ({ tipo: "secuencia" as const, s })),
    ...patrones.map((p) => ({ tipo: "patron" as const, p })),
  ]
    .map((x, i) => ({ x, i }))
    .sort((a, b) => PESO[sevDe(a.x)] - PESO[sevDe(b.x)] || (a.x.tipo === b.x.tipo ? a.i - b.i : a.x.tipo === "secuencia" ? -1 : 1))
    .map(({ x }) => x);
  if (!items.length) return null;
  const vistos = todos ? items : items.slice(0, 4);

  const ver = (x: Item) => {
    const linea = typeof document !== "undefined" ? document.getElementById(idLinea(clave)) : null;
    // Si la línea no está a la vista (otra forma de verla abierta), primero su pestaña.
    if (!linea || linea.closest("[hidden]")) irAPestana("tiempo", "hv");
    const pedido: PedidoLinea = { clave, tipo: x.tipo, id: idDe(x) };
    // Después de que la pestaña se abra (la línea ya está montada: es la primera).
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(VER_EN_LINEA, { detail: pedido })));
  };

  return (
    <section aria-labelledby={`${idLinea(clave)}-destacados`} className="space-y-2.5">
      <div className="space-y-0.5">
        <h3 id={`${idLinea(clave)}-destacados`} className="font-display text-bloque font-bold text-ink">
          Lo que llama la atención
        </h3>
        <p className="max-w-prose text-meta text-inkSoft">
          Lo más grave primero: lo que encadenan sus datos (una cosa llevó a otra) y los meses fuera de lo normal. Nada de esto
          prueba una falta: dice dónde mirar.
        </p>
      </div>
      <ul className="grid gap-2 md:grid-cols-2">
        {vistos.map((x) => {
          const id = idDe(x);
          const sel = elegido === id;
          const sev = sevDe(x);
          const titulo = x.tipo === "secuencia" ? x.s.titulo : x.p.titulo;
          const cuando =
            x.tipo === "secuencia"
              ? x.s.pasos.length > 1
                ? `${fechaConAnio(x.s.pasos[0].fecha)} a ${fechaConAnio(x.s.pasos[x.s.pasos.length - 1].fecha)}`
                : fechaConAnio(x.s.pasos[0]?.fecha)
              : x.p.hasta && x.p.hasta !== x.p.mes
                ? `${mesLargo(x.p.mes)} a ${mesLargo(x.p.hasta)}`
                : mesLargo(x.p.mes);
          return (
            <li
              key={`${x.tipo}-${id}`}
              className={cn(
                "flex flex-col gap-2 rounded-xl border bg-paper px-3.5 py-3 transition-colors duration-rapido",
                sel ? "border-granate ring-1 ring-granate/30" : sev === "alta" ? "border-crimson/30" : "border-line",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Severidad bandera={sev} formato="linea" />
                <span className="inline-flex items-center gap-1 text-rotulo font-semibold text-inkSoft">
                  {x.tipo === "secuencia" ? <Link2 size={13} aria-hidden /> : <TrendingUp size={13} aria-hidden />}
                  {x.tipo === "secuencia" ? "Una cosa llevó a otra" : "Fuera de lo normal"}
                </span>
                <span className="text-rotulo text-mute">{cuando}</span>
              </div>
              <p className="text-meta font-semibold leading-snug text-ink text-pretty">{titulo}</p>
              {x.tipo === "secuencia" ? (
                <ol className="space-y-1 border-l-2 border-line pl-3">
                  {x.s.pasos.map((p, k) => (
                    <li key={k} className="text-rotulo leading-snug text-inkSoft">
                      <span className="font-mono tabular-nums text-ink">{fechaConAnio(p.fecha)}</span> {p.texto}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="line-clamp-3 text-rotulo leading-snug text-inkSoft">{x.p.explica}</p>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5">
                <button
                  type="button"
                  onClick={() => ver(x)}
                  aria-pressed={sel}
                  className="inline-flex min-h-[32px] items-center gap-1.5 text-rotulo font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate"
                >
                  <LocateFixed size={13} aria-hidden />
                  {sel ? "Marcado en la línea" : "Verlo en la línea"}
                </button>
                {x.tipo === "secuencia" && x.s.href && (
                  <Link
                    href={x.s.href}
                    prefetch={false}
                    className="inline-flex min-h-[32px] items-center gap-1 text-rotulo font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate"
                  >
                    Ver la evidencia
                    <ArrowRight size={13} aria-hidden />
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > 4 && (
        <button
          type="button"
          onClick={() => setTodos((v) => !v)}
          aria-expanded={todos}
          className="min-h-[32px] text-rotulo font-semibold text-granate underline decoration-granate/40 underline-offset-2"
        >
          {todos ? "Ver menos" : `Ver los ${items.length}`}
        </button>
      )}
    </section>
  );
}
