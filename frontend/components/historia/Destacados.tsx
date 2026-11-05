"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Link2, LocateFixed, TrendingUp } from "lucide-react";
import { irAPestana } from "@/components/patrones/Pestanas";
import { ICONO_NIVEL, Severidad } from "@/components/ui/Severidad";
import { fechaConAnio } from "@/lib/formato";
import { mesLargo, type PatronHistoria, type SecuenciaHistoria, type SeveridadHistoria } from "@/lib/historia";
import { cn } from "@/lib/utils";
import { TextoPaso } from "./TextoPaso";

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
const COLOR: Record<SeveridadHistoria, string> = { alta: "text-crimsonTexto", media: "text-amberTexto", baja: "text-mute" };
const PALABRA: Record<SeveridadHistoria, string> = { alta: "Señal alta", media: "Señal media", baja: "Señal baja" };

/**
 * «Lo que llama la atención»: en un solo lugar y en orden de gravedad, las secuencias que prueban sus datos (una cosa
 * llevó a otra) y los meses fuera de lo normal de sus series (pedido del usuario del 2026-10-28: «parece que se repite
 * información»).
 *
 * Lista y detalle (pedido del usuario del 2026-11-05: «solo lo colocamos debajo de todo y ya, cuando podemos crear un
 * layout adecuado»): antes eran tarjetas de dos en dos, cuatro a la vista y «Ver los 15». Ahora, a la izquierda, TODOS en
 * filas compactas (gravedad, qué es, cuándo) y, a la derecha, el elegido entero: sus pasos en una línea vertical con los
 * días entre uno y otro, o la explicación del pico, y los botones a la línea de tiempo y a la evidencia. En el celular el
 * detalle se abre bajo su fila. Lo que se elige en la línea de tiempo también se elige aquí.
 */
export function Destacados({ clave, secuencias, patrones }: { clave: string; secuencias: SecuenciaHistoria[]; patrones: PatronHistoria[] }) {
  const [activo, setActivo] = useState<string | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);

  // La línea avisa qué quedó elegido (o que se cerró): la fila se marca y su detalle se abre.
  useEffect(() => {
    const alElegir = (e: Event) => {
      const d = (e as CustomEvent<ElegidoLinea>).detail;
      if (d?.clave !== clave) return;
      setElegido(d.id);
      if (d.id) setActivo(d.id);
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
  const actual = items.find((x) => idDe(x) === activo) ?? items[0];

  const ver = (x: Item) => {
    const linea = typeof document !== "undefined" ? document.getElementById(idLinea(clave)) : null;
    // Si la línea no está a la vista (otra forma de verla abierta), primero su pestaña.
    if (!linea || linea.closest("[hidden]")) irAPestana("tiempo", "hv");
    const pedido: PedidoLinea = { clave, tipo: x.tipo, id: idDe(x) };
    // Después de que la pestaña se abra (la línea ya está montada: es la primera).
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(VER_EN_LINEA, { detail: pedido })));
  };

  const cuenta: Record<SeveridadHistoria, number> = { alta: 0, media: 0, baja: 0 };
  for (const x of items) cuenta[sevDe(x)] += 1;
  const resumen = [
    cuenta.alta ? `${cuenta.alta} de señal alta` : null,
    cuenta.media ? `${cuenta.media} media` : null,
    cuenta.baja ? `${cuenta.baja} baja` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const idTitulo = `${idLinea(clave)}-destacados`;

  return (
    <section aria-labelledby={idTitulo} className="tarjeta rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={idTitulo} className="font-display text-bloque font-bold text-ink">
          Lo que llama la atención
        </h3>
        <p className="text-rotulo text-inkSoft">
          {items.length === 1 ? "1 hallazgo" : `${items.length} hallazgos`}: {resumen}
        </p>
      </div>
      <p className="mt-0.5 max-w-prose text-meta text-inkSoft">
        Lo que encadenan sus datos y los meses fuera de lo normal, lo más grave primero. No prueba una falta: dice dónde mirar.
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ul className="-mx-1 space-y-0.5 px-1 md:max-h-[28rem] md:overflow-y-auto md:overscroll-contain md:pr-2" aria-label="Hallazgos">
          {items.map((x) => {
            const id = idDe(x);
            const on = idDe(actual) === id;
            const sev = sevDe(x);
            const Icono = ICONO_NIVEL[sev];
            return (
              <li key={`${x.tipo}-${id}`}>
                <button
                  type="button"
                  onClick={() => setActivo(id)}
                  aria-current={on ? "true" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                    on ? "border-granate/40 bg-paperSoft" : "border-transparent hover:bg-paperSoft",
                  )}
                >
                  <Icono size={15} className={cn("mt-0.5 shrink-0", COLOR[sev])} aria-hidden />
                  <span className="sr-only">{PALABRA[sev]}: </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-meta font-semibold leading-snug text-ink text-pretty">{tituloDe(x)}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-rotulo text-mute">
                      <span className="inline-flex items-center gap-1">
                        {x.tipo === "secuencia" ? <Link2 size={12} aria-hidden /> : <TrendingUp size={12} aria-hidden />}
                        {x.tipo === "secuencia" ? "Una cosa llevó a otra" : "Fuera de lo normal"}
                      </span>
                      <span>{cuandoDe(x)}</span>
                    </span>
                  </span>
                </button>
                {on && (
                  <div className="px-1 pb-3 pt-2 md:hidden">
                    <Detalle x={x} marcado={elegido === id} ver={() => ver(x)} bajoSuFila />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="hidden min-w-0 md:block">
          <div className="sticky top-[calc(var(--alto-barra-fija,0px)+0.75rem)] rounded-xl border border-line bg-paperSoft/60 p-4">
            <Detalle x={actual} marcado={elegido === idDe(actual)} ver={() => ver(actual)} />
          </div>
        </div>
      </div>
    </section>
  );
}

const tituloDe = (x: Item) => (x.tipo === "secuencia" ? x.s.titulo : x.p.titulo);

function cuandoDe(x: Item): string {
  if (x.tipo === "secuencia") {
    const ps = x.s.pasos;
    return ps.length > 1 && ps[0].fecha !== ps[ps.length - 1].fecha
      ? `${fechaConAnio(ps[0].fecha)} a ${fechaConAnio(ps[ps.length - 1].fecha)}`
      : fechaConAnio(ps[0]?.fecha);
  }
  return x.p.hasta && x.p.hasta !== x.p.mes ? `${mesLargo(x.p.mes)} a ${mesLargo(x.p.hasta)}` : mesLargo(x.p.mes);
}

/** Los días entre dos fechas «aaaa-mm-dd» (para «170 días después» entre dos pasos). */
function dias(a: string, b: string): number | null {
  const x = Date.parse(a.slice(0, 10));
  const y = Date.parse(b.slice(0, 10));
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86_400_000) : null;
}

/** El hallazgo elegido entero: qué es, cuándo, sus pasos (o la explicación del pico) y a dónde ir. */
function Detalle({ x, marcado, ver, bajoSuFila = false }: { x: Item; marcado: boolean; ver: () => void; bajoSuFila?: boolean }) {
  const sev = sevDe(x);
  // Bajo su fila (en el celular), la fila ya dice qué es, cuándo y su título: no se repiten.
  return (
    <div className={cn("space-y-3", bajoSuFila && "border-l-2 border-granate/30 pl-3")}>
      {!bajoSuFila && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Severidad bandera={sev} formato="linea" />
        <span className="inline-flex items-center gap-1 text-rotulo font-semibold text-inkSoft">
          {x.tipo === "secuencia" ? <Link2 size={13} aria-hidden /> : <TrendingUp size={13} aria-hidden />}
          {x.tipo === "secuencia" ? "Una cosa llevó a otra" : "Fuera de lo normal"}
        </span>
        <span className="text-rotulo text-mute">{cuandoDe(x)}</span>
        </div>
      )}
      {!bajoSuFila && <p className="font-display text-destacado font-bold leading-snug text-ink text-pretty">{tituloDe(x)}</p>}
      {x.tipo === "secuencia" ? (
        // Los pasos en una línea vertical: la fecha, lo que pasó y, entre uno y otro, cuántos días pasaron.
        <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-paperEdge">
          {x.s.pasos.map((p, k) => {
            const d = k > 0 ? dias(x.s.pasos[k - 1].fecha, p.fecha) : null;
            return (
              <li key={k} className="relative pl-6">
                <span
                  className={cn("absolute left-0 top-1 size-[11px] rounded-full border-2 border-paper", k === x.s.pasos.length - 1 ? "bg-granate" : "bg-inkSoft")}
                  aria-hidden
                />
                <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-rotulo tabular-nums text-inkSoft">
                  {fechaConAnio(p.fecha)}
                  {d != null && d >= 0 && (
                    <span className="font-sans font-semibold text-ink">{d === 0 ? "el mismo día" : d === 1 ? "1 día después" : `${d} días después`}</span>
                  )}
                </p>
                <p className="text-meta leading-snug text-ink text-pretty">
                  <TextoPaso texto={p.texto} href={p.href} />
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-meta leading-relaxed text-inkSoft text-pretty">{x.p.explica}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2.5">
        <button
          type="button"
          onClick={ver}
          aria-pressed={marcado}
          className="inline-flex min-h-[32px] items-center gap-1.5 text-meta font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate"
        >
          <LocateFixed size={14} aria-hidden />
          {marcado ? "Marcado en la línea" : "Verlo en la línea"}
        </button>
        {x.tipo === "secuencia" && x.s.href && (
          <Link
            href={x.s.href}
            prefetch={false}
            className="inline-flex min-h-[32px] items-center gap-1 text-meta font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate"
          >
            Ver la evidencia
            <ArrowRight size={14} aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
