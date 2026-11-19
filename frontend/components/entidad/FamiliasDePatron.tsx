"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { BarraSegmentada, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { irAPestana } from "@/components/patrones/Pestanas";
import { Severidad } from "@/components/ui/Severidad";
import { numero, porcentaje } from "@/lib/formato";
import type { FamiliaConCasos } from "@/lib/patronesEntidad";
import { cn } from "@/lib/utils";

/**
 * Elige una entrada de un índice (`IndiceAntecedentes`) desde fuera de él, sin ir al servidor: escribe su parámetro en la
 * URL (el índice lo lee con `useSearchParams`) y, si la entrada está en otra subpestaña, la abre antes. Antes las familias
 * eran enlaces: cada clic volvía a pedir la ficha entera de la entidad para cambiar una fila del índice.
 */
function elegirEnIndice(param: string, valor: string, pestana?: { param: string; clave: string }) {
  if (pestana) irAPestana(pestana.clave, pestana.param);
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(param, valor);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    /* sin URL no hay cómo avisarle al índice: no pasa nada */
  }
}

/** Un enlace de texto que abre una entrada de un índice (y su subpestaña), sin recargar. */
export function EnIndice({ param, valor, pestana, className, children }: { param: string; valor: string; pestana?: { param: string; clave: string }; className?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => elegirEnIndice(param, valor, pestana)} className={cn("text-left", className)}>
      {children}
    </button>
  );
}

/** Columnas de la leyenda desde lg, por cuántas familias hay (clases literales para Tailwind). */
const COLUMNAS: Record<number, string> = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" };

/**
 * Cómo se reparten los casos de una subpestaña entre sus familias (concertación, compras partidas, familia y política,
 * sanciones, sus documentos). Pedido del usuario del 2026-11-18: antes eran cinco cajitas que no llenaban el ancho y sólo
 * decían «2 patrones con casos». Ahora, a todo el ancho, una barra partida por familia (skill dataviz: colores de serie
 * por orden fijo, 2 px de aire) y debajo su leyenda, una celda por familia que se toca: su color, su nombre, cuántos
 * casos y qué parte del total, y cuánto de eso es grave (ícono de severidad: color, forma y palabra). Tocarla elige en el
 * índice la primera entrada de esa familia; la familia de la entrada elegida queda marcada.
 *
 * Con una sola familia no se dibuja: una barra entera no reparte nada (el rótulo del índice ya la nombra). En el celular la
 * leyenda va de a dos por fila y sin la línea de gravedad (queda el ícono junto a la cifra): antes las cinco cajas eran
 * 240 px antes del índice.
 */
export function RepartoFamilias({
  familias,
  param,
  inicial,
  unidad,
  entradas,
  etiqueta,
  ayuda,
}: {
  familias: FamiliaConCasos[];
  /** El parámetro del índice que eligen (`patron`, `antecedente`, `atipo`). */
  param: string;
  /** La entrada elegida al abrir si la URL no trae `param`: la primera del índice. */
  inicial?: string;
  /** Qué es un caso, en singular y plural: «caso», «contrato», «vez». */
  unidad: [string, string];
  /** Qué es una entrada: «patrón», «antecedente», «tipo de registro». */
  entradas: [string, string];
  etiqueta: string;
  ayuda?: ReactNode;
}) {
  const enUrl = useSearchParams()?.get(param) ?? null;
  if (familias.length < 2) return null;
  const elegida = enUrl && familias.some((f) => f.claves.includes(enUrl)) ? enUrl : inicial ?? familias[0]?.claves[0];
  const total = familias.reduce((s, f) => s + f.casos, 0);
  const nEntradas = familias.reduce((s, f) => s + f.entradas, 0);
  const cuota = (n: number) => {
    const p = total ? (100 * n) / total : 0;
    return p > 0 && p < 1 ? `menos de ${porcentaje(1)}` : porcentaje(p);
  };
  return (
    <section aria-label={etiqueta} className="overflow-hidden rounded-xl border border-line bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 pt-3">
        {/* Un rótulo y no un título: la sección ya se nombra (`aria-label`) y el título de la pestaña está arriba. */}
        <p className="flex items-center gap-1.5 text-meta font-semibold text-ink">
          Por familia
          {ayuda}
        </p>
        <p className="text-rotulo tabular-nums text-mute">
          <span className="font-mono font-semibold text-inkSoft">{numero(total)}</span> {total === 1 ? unidad[0] : unidad[1]} en{" "}
          <span className="font-mono font-semibold text-inkSoft">{numero(nEntradas)}</span> {nEntradas === 1 ? entradas[0] : entradas[1]}
        </p>
      </div>
      <div className="px-3.5 pb-3 pt-2">
        <BarraSegmentada
          etiqueta={etiqueta}
          partes={familias.map((f) => ({ clave: f.clave, nombre: f.corto, valor: f.casos, texto: `${numero(f.casos)} ${f.casos === 1 ? unidad[0] : unidad[1]}` }))}
        />
      </div>
      <ul className={cn("grid grid-cols-2 gap-px border-t border-line bg-line [&>li:last-child:nth-child(odd)]:col-span-2 lg:[&>li:last-child:nth-child(odd)]:col-span-1", COLUMNAS[familias.length])}>
        {familias.map((f) => {
          const activa = !!elegida && f.claves.includes(elegida);
          return (
            <li key={f.clave} className="min-w-0 bg-paper">
              <button
                type="button"
                onClick={() => elegirEnIndice(param, f.claves[0])}
                aria-pressed={activa}
                title={f.explica}
                className={cn(
                  "flex h-full min-h-11 w-full min-w-0 flex-col items-start gap-0.5 px-3.5 py-2.5 text-left transition-colors duration-rapido hover:bg-paperSoft",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate",
                  // La familia de lo elegido: una raya de marca abajo (posición, no un tinte).
                  activa && "shadow-[inset_0_-2px_0_0_theme(colors.granate.DEFAULT)]",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5 text-meta font-medium leading-tight text-ink">
                  <MuestraSerie i={f.serie} />
                  <span className="min-w-0 truncate">{f.corto}</span>
                </span>
                <span className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-display text-cuerpo font-bold tabular-nums text-ink">{numero(f.casos)}</span>
                  <span className="text-rotulo text-mute">{f.casos === 1 ? unidad[0] : unidad[1]}</span>
                  <span className="font-mono text-rotulo tabular-nums text-inkSoft">{cuota(f.casos)}</span>
                  {/* En el celular, sólo el ícono de severidad junto a la cifra; la línea entera, desde sm. */}
                  <span className="sm:hidden">
                    <Severidad bandera={f.peor} formato="punto" />
                  </span>
                </span>
                <span className="hidden items-center gap-1 text-rotulo leading-snug text-inkSoft sm:flex">
                  <Severidad bandera={f.peor} formato="punto" className="shrink-0" />
                  {f.gravedad}
                </span>
                <span className="sr-only sm:hidden">{f.gravedad}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
