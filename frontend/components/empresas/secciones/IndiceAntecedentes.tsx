"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { MuestraSerie } from "@/components/charts/BarraSegmentada";
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

  // Los grupos (familias) en su orden, con sus entradas: en el escritorio cada familia es una fila de filtros.
  const grupos: { nombre?: string; serie?: number; items: { t: TipoDelIndice; i: number }[] }[] = [];
  tipos.forEach((t, i) => {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.nombre === t.grupo) ultimo.items.push({ t, i });
    else grupos.push({ nombre: t.grupo, serie: t.serie, items: [{ t, i }] });
  });
  const boton = (t: TipoDelIndice, i: number) => {
    const sel = t.clave === actual;
    return (
      <button
        key={t.clave}
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
          "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border py-1.5 pl-3 pr-1.5 text-left transition-colors duration-rapido",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-1",
          sel ? "border-granate bg-granate-50 font-semibold text-ink" : "border-line bg-paper font-medium text-inkSoft hover:border-granate/40 hover:text-ink",
        )}
      >
        {sel ? <Check size={15} strokeWidth={2.5} aria-hidden className="shrink-0 text-granate" /> : <Severidad bandera={t.severidad} formato="punto" className="shrink-0" />}
        <span className="whitespace-nowrap text-dato lg:hidden">{t.corto}</span>
        <span className="hidden whitespace-nowrap text-dato lg:inline">{t.nombre}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-rotulo font-semibold tabular-nums", sel ? "bg-granate text-paper" : "bg-paperDeep text-inkSoft")}>{numero(t.n)}</span>
        <span className="sr-only">: {t.resumen}</span>
      </button>
    );
  };

  /*
   * Un FILTRO arriba, no un índice al costado (2026-11-23, el usuario: «este orden de acá al costado no tiene sentido…
   * debería ser un filtro, no lo colocamos como texto y línea de color sin sentido»). Cada entrada es un botón con su
   * gravedad, su nombre y cuántos casos tiene; la elegida, marcada con ✓ y rellena. En el escritorio, una fila por
   * familia con su color; en el celular, una fila que se desliza. Lo elegido ocupa todo el ancho debajo.
   */
  return (
    <div className="min-w-0 max-w-full space-y-4">
      <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-line bg-paper p-3 sm:p-4">
        <p id={`${id}-titulo`} className="mb-2.5 flex items-baseline justify-between gap-3 text-meta font-semibold text-ink">
          <span>Filtrar por {que.toLowerCase()}</span>
          <span className="font-normal text-mute">{titulo}</span>
        </p>
        <div
          ref={lista}
          role="tablist"
          aria-labelledby={`${id}-titulo`}
          className="relative -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:mx-0 lg:block lg:space-y-2.5 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden"
        >
          {grupos.map((g, k) => (
            <div
              key={g.nombre ?? k}
              role="presentation"
              className={cn("contents", g.nombre ? "lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-3" : "lg:block", k > 0 && "lg:border-t lg:border-line lg:pt-2.5")}
            >
              {g.nombre ? (
                <span role="presentation" className="hidden min-h-10 items-center gap-2 text-meta font-semibold leading-snug text-ink lg:flex">
                  {g.serie != null && <MuestraSerie i={g.serie} />}
                  <span className="min-w-0">{g.nombre}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-mute">{numero(g.items.reduce((s, x) => s + x.t.n, 0))}</span>
                </span>
              ) : null}
              <div role="presentation" className="contents lg:flex lg:flex-wrap lg:gap-2">
                {g.items.map(({ t, i }) => boton(t, i))}
              </div>
            </div>
          ))}
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
