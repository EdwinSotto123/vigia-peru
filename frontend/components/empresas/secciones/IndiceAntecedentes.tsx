"use client";

import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { MuestraSerie, colorSerie } from "@/components/charts/BarraSegmentada";
import { Severidad } from "@/components/ui/Severidad";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

/** Un tipo de antecedente del índice: lo que se ve en su entrada y sus casos, ya armados en el servidor. */
export interface TipoDelIndice {
  /** El tipo (`fraccionamiento`, `sancion_temporal`…): va a la URL (`?atipo=`). */
  clave: string;
  /** Su nombre entero, en la lista del escritorio. */
  nombre: string;
  /** Su nombre corto, en la fila de chips del celular. */
  corto: string;
  /** La más grave de sus casos: el ícono de la entrada. */
  severidad: "alta" | "media" | "baja";
  /** Cuántas veces lo nombra el registro (el número del chip). */
  n: number;
  /** «12 veces: 2 de señal alta y 10 de media», bajo el nombre en el escritorio. */
  resumen: string;
  /** La familia a la que pertenece (los patrones de una entidad): un rótulo en el índice del escritorio al cambiar. */
  grupo?: string;
  /** El color de su familia (su lugar en el reparto de arriba): la muestra de su rótulo y su barra. Sin él, gris. */
  serie?: number;
  contenido: ReactNode;
}

/**
 * Los antecedentes de una empresa como lista y detalle (pedido del usuario del 2026-11-05: «solo lo colocamos DEBAJO DE
 * TODO Y YA, cuando podemos crear un layout adecuado»). Antes los 16 tipos iban apilados, cada uno con su buscador, dos
 * paginadores y cinco filas: 11 pantallas en el escritorio y 30 en el celular para MEDIFARMA. Ahora, como «Lo que llama
 * la atención» (historia/Destacados.tsx) y las entidades de una persona (personas/IndiceEntidades.tsx):
 *
 * - Escritorio (lg): a la izquierda, fijo al bajar, el índice de tipos (ícono de severidad, nombre y cuántas veces), lo
 *   más grave primero; a la derecha, sólo los casos del elegido.
 * - Celular: el índice es una fila de chips que se desliza de costado, arriba de los casos (antes, 16 renglones de lista
 *   antes del primer caso).
 * - El elegido va a la URL (`param`, `?atipo=`) con `history.replaceState`, sin ir al servidor ni ensuciar el historial: el
 *   enlace comparte ese tipo y las banderas de la cabecera de la ficha (que llevan `?atipo=`) lo eligen aquí también. El
 *   primero va sin parámetro.
 * - Sólo se monta el tipo elegido: el panel de un caso abierto (anclado a la derecha) se cierra al cambiar de tipo.
 * - Patrón de pestañas de WAI-ARIA: flechas (las cuatro), Inicio y Fin.
 *
 * Pedido del usuario del 2026-11-18 («lo veo sin forma»): el índice del escritorio era una columna de texto. Ahora se lee
 * de un vistazo, como una tabla chica: arriba qué es cada columna («Patrón», «Casos»); cada fila con el ícono de su
 * severidad, el nombre, su cifra a la derecha y debajo una barra con su parte frente a la mayor del índice, del color de
 * su familia (`serie`, el mismo del reparto de arriba); y el rótulo de cada familia con su muestra de color. La elegida,
 * con un borde y una raya de marca a la izquierda (sin tinte de fondo). En el celular siguen los chips en una fila que se
 * desliza: el detalle queda justo debajo.
 */
export function IndiceAntecedentes({
  tipos,
  param,
  titulo,
  inicial,
  que = "Nombre",
  columna = "Casos",
}: {
  tipos: TipoDelIndice[];
  param: string;
  titulo: string;
  /** El elegido al abrir si la URL no trae `param` (un enlace viejo que lo nombraba con otro parámetro). */
  inicial?: string;
  /** Qué es cada fila («Patrón», «Antecedente»): el rótulo de la columna del nombre en el escritorio. */
  que?: string;
  /** Qué cuenta la cifra de cada fila («Casos», «Contratos», «Veces»): el rótulo de su columna en el escritorio. */
  columna?: string;
}) {
  const primera = tipos[0]?.clave;
  const valido = (t: string | null | undefined) => (t && tipos.some((x) => x.clave === t) ? t : undefined);
  // Desde Next 14.1 el router se entera de `history.replaceState`: lo que se elige aquí también cambia `useSearchParams`.
  const enUrl = valido(useSearchParams()?.get(param));
  const [actual, setActual] = useState(enUrl ?? valido(inicial) ?? primera);
  const id = useId();
  const lista = useRef<HTMLDivElement>(null);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const detalle = useRef<HTMLDivElement>(null);

  // Una bandera de la cabecera de la ficha (`?seccion=antecedentes&atipo=…`) cambia el tipo de la URL sin rehacer este
  // índice: se elige ése. Lo que se elige aquí también pasa por acá (ya elegido: no cambia nada).
  const previo = useRef(enUrl);
  useEffect(() => {
    if (enUrl === previo.current) return;
    previo.current = enUrl;
    setActual(enUrl ?? primera);
  }, [enUrl, primera]);

  // En el celular, el chip elegido a la vista dentro de su fila (llegar con `?atipo=` del noveno tipo lo dejaba fuera).
  // Sólo se mueve la fila, nunca la página: `scrollIntoView` bajaba hasta la pestaña al cargar la ficha.
  useEffect(() => {
    const l = lista.current;
    const b = botones.current[tipos.findIndex((t) => t.clave === actual)];
    if (!l || !b || l.scrollWidth <= l.clientWidth) return;
    const izquierda = b.offsetLeft - 8;
    const derecha = b.offsetLeft + b.offsetWidth - l.clientWidth + 8;
    if (l.scrollLeft > izquierda) l.scrollLeft = izquierda;
    else if (l.scrollLeft < derecha) l.scrollLeft = derecha;
  }, [actual, tipos]);

  if (!tipos.length) return null;
  // La barra de cada fila se mide contra la mayor del índice: se comparan de un vistazo.
  const mayor = Math.max(1, ...tipos.map((t) => t.n));

  const elegir = (clave: string, enfocar = false) => {
    setActual(clave);
    try {
      const url = new URL(window.location.href);
      if (clave === primera) url.searchParams.delete(param);
      else url.searchParams.set(param, clave);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* sin URL no se comparte el tipo elegido, pero se elige igual */
    }
    if (enfocar) botones.current[tipos.findIndex((t) => t.clave === clave)]?.focus({ preventScroll: true });
    // Si se había bajado en un tipo largo, el comienzo del elegido a la vista (bajo la barra de pestañas fija).
    window.requestAnimationFrame(() => {
      const d = detalle.current;
      if (d && d.getBoundingClientRect().top < 64) d.scrollIntoView({ block: "start" });
    });
  };

  const alTeclado = (e: KeyboardEvent, i: number) => {
    const n = tipos.length;
    const destino =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? (i + 1) % n
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (destino < 0) return;
    e.preventDefault();
    elegir(tipos[destino].clave, true);
  };

  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-5 xl:grid-cols-[17rem_minmax(0,1fr)] xl:gap-6">
      {/* El índice: fijo al bajar en el escritorio (bajo la barra de pestañas fija) y con su propio scroll si no entra. */}
      <div className="mb-3 min-w-0 lg:sticky lg:top-[calc(var(--alto-barra-fija,0px)_+_0.75rem)] lg:mb-0 lg:max-h-[calc(100dvh_-_var(--alto-barra-fija,0px)_-_1.5rem)] lg:overflow-y-auto lg:overscroll-contain">
        <p id={`${id}-titulo`} className="mb-1.5 text-meta font-semibold text-inkSoft lg:mb-1 lg:px-2.5">
          {titulo}
        </p>
        {/* Qué es cada columna del índice (escritorio): el nombre a la izquierda, la cifra a la derecha. */}
        <p aria-hidden className="hidden items-baseline justify-between gap-2 border-b border-line px-2.5 pb-1 text-rotulo font-medium text-mute lg:flex">
          <span>{que}</span>
          <span>{columna}</span>
        </p>
        <div
          ref={lista}
          role="tablist"
          aria-labelledby={`${id}-titulo`}
          className="relative -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1.5 lg:mx-0 lg:mt-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {tipos.map((t, i) => {
            const sel = t.clave === actual;
            const abreGrupo = !!t.grupo && t.grupo !== tipos[i - 1]?.grupo;
            const parte = t.n / mayor;
            return (
              <Fragment key={t.clave}>
              {abreGrupo ? (
                <p role="presentation" className={cn("hidden items-center gap-2 px-2.5 pb-1 text-meta font-semibold leading-snug text-ink lg:flex", i > 0 ? "pt-5" : "pt-2")}>
                  {t.serie != null && <MuestraSerie i={t.serie} />}
                  <span className="min-w-0">{t.grupo}</span>
                </p>
              ) : null}
              <button
                ref={(el) => {
                  botones.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${i}`}
                aria-selected={sel}
                aria-controls={sel ? `${id}-panel` : undefined}
                tabIndex={sel ? 0 : -1}
                onClick={() => elegir(t.clave)}
                onKeyDown={(ev) => alTeclado(ev, i)}
                title={t.resumen}
                className={cn(
                  // Celular: un chip de una línea. Escritorio: una fila (ícono, nombre, cifra) con su barra debajo.
                  "flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-left transition-colors duration-rapido",
                  "lg:grid lg:min-h-0 lg:w-full lg:shrink lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start lg:gap-x-2 lg:gap-y-1 lg:rounded-lg lg:px-2.5 lg:py-1.5",
                  // Por dentro: la fila de chips y el índice del escritorio se deslizan (overflow) y recortarían el anillo de afuera.
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate",
                  // La elegida, rellena (2026-11-23: la raya de 3 px a la izquierda y el borde no la separaban de las demás).
                  sel
                    ? "border-granate bg-paper lg:border-transparent lg:bg-granate-50"
                    : "border-line bg-paper hover:border-granate/30 lg:border-transparent lg:bg-transparent lg:hover:bg-paperSoft",
                )}
              >
                <Severidad bandera={t.severidad} formato="punto" className="shrink-0 lg:mt-[3px]" />
                <span className={cn("whitespace-nowrap text-meta lg:hidden", sel ? "font-semibold text-granate" : "font-medium text-ink")}>
                  {t.corto} <span className="tabular-nums text-mute">{numero(t.n)}</span>
                </span>
                <span className={cn("hidden min-w-0 break-words text-dato leading-snug text-ink text-pretty lg:block", sel ? "font-semibold" : "font-medium")}>{t.nombre}</span>
                <span className={cn("hidden font-display text-dato font-bold tabular-nums lg:block", sel ? "text-granate" : "text-ink")}>{numero(t.n)}</span>
                {/* La barra: su parte frente a la mayor del índice, del color de su familia. */}
                <span aria-hidden className="col-start-2 col-end-4 hidden h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.06] lg:block">
                  <span
                    className={cn("block h-full rounded-full", t.serie == null && "bg-inkSoft/70")}
                    style={{ width: `${Math.max(2, parte * 100)}%`, background: t.serie != null ? colorSerie(t.serie) : undefined }}
                  />
                </span>
                <span className="sr-only">: {t.resumen}</span>
              </button>
              </Fragment>
            );
          })}
        </div>
      </div>
      <div ref={detalle} className="min-w-0 scroll-mt-[calc(var(--alto-barra-fija,3.5rem)_+_1rem)]">
        {tipos.map((t, i) =>
          t.clave === actual ? (
            <div key={t.clave} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${i}`}>
              {t.contenido}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
