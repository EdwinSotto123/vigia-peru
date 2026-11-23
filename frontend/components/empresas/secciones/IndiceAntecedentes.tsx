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
  /** El nombre corto de su familia («Concertación»): el botón de la familia en el filtro. */
  grupoCorto?: string;
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
 * Hoy (2026-11-23) el índice es un FILTRO de dos filas arriba del detalle: las familias y, debajo, los tipos de la
 * elegida (ver el comentario del render). Lo que sigue es su historia.
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
  const familias = useRef<HTMLDivElement>(null);

  // Una bandera de la cabecera de la ficha (`?seccion=antecedentes&atipo=…`) cambia el tipo de la URL sin rehacer este
  // índice: se elige ése. Lo que se elige aquí también pasa por acá (ya elegido: no cambia nada).
  const previo = useRef(enUrl);
  useEffect(() => {
    if (enUrl === previo.current) return;
    previo.current = enUrl;
    setActual(enUrl ?? primera);
  }, [enUrl, primera]);

  // Lo elegido a la vista dentro de su fila, cuando la fila se desliza (celular): el tipo y su familia. Sólo se mueve la
  // fila, nunca la página: `scrollIntoView` bajaba hasta la pestaña al cargar la ficha.
  useEffect(() => {
    const i = tipos.findIndex((t) => t.clave === actual);
    enSuFila(lista.current, botones.current[i]);
    enSuFila(familias.current, familias.current?.querySelector<HTMLElement>("[aria-pressed=true]") ?? null);
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

  // Las flechas recorren los tipos a la vista (los de la familia elegida).
  const alTeclado = (e: KeyboardEvent, i: number, vista: { t: TipoDelIndice }[]) => {
    const n = vista.length;
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
    elegir(vista[destino].t.clave, true);
  };

  // Las familias en su orden, con sus entradas. Se ve UNA a la vez: la del elegido.
  const grupos: { nombre?: string; corto?: string; serie?: number; total: number; items: { t: TipoDelIndice; i: number }[] }[] = [];
  tipos.forEach((t, i) => {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.nombre === t.grupo) {
      ultimo.items.push({ t, i });
      ultimo.total += t.n;
    } else grupos.push({ nombre: t.grupo, corto: t.grupoCorto, serie: t.serie, total: t.n, items: [{ t, i }] });
  });
  const conFamilias = grupos.length > 1;
  const suya = grupos.find((g) => g.items.some((x) => x.t.clave === actual)) ?? grupos[0];
  const vista = conFamilias ? suya.items : tipos.map((t, i) => ({ t, i }));

  const boton = ({ t, i }: { t: TipoDelIndice; i: number }, k: number) => {
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
        aria-label={`${t.nombre}: ${t.resumen}`}
        tabIndex={sel ? 0 : -1}
        onClick={() => elegir(t.clave)}
        onKeyDown={(ev) => alTeclado(ev, k, vista)}
        title={`${t.nombre}: ${t.resumen}`}
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border pl-2.5 pr-1 text-meta transition-colors duration-rapido",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-1",
          sel ? "border-granate bg-granate-50 font-semibold text-ink" : "border-line bg-paper font-medium text-inkSoft hover:border-granate/40 hover:text-ink",
        )}
      >
        {sel ? <Check size={14} strokeWidth={2.5} aria-hidden className="shrink-0 text-granate" /> : <Severidad bandera={t.severidad} formato="punto" className="shrink-0" />}
        <span className="whitespace-nowrap">{t.corto}</span>
        <span className={cn("min-w-7 rounded-full px-1.5 py-0.5 text-center text-rotulo font-semibold tabular-nums", sel ? "bg-granate text-paper" : "bg-paperDeep text-inkSoft")}>
          {numero(t.n)}
        </span>
      </button>
    );
  };

  /*
   * Un filtro de DOS filas (2026-11-23, el usuario: «demasiado scroll, demasiado grandes»). La versión anterior ponía
   * todos los tipos con su nombre entero, en filas por familia: los 53 antecedentes de una entidad medían 1 750 px antes
   * del primer caso. Ahora, arriba, las familias como un control segmentado (su color, su nombre corto y cuántos casos
   * suman: hace de reparto, que ya no va aparte); debajo, sólo los tipos de la familia elegida, en chips cortos. El
   * nombre entero del tipo es el título de su detalle. Elegir una familia abre su primer tipo (el más grave).
   */
  return (
    <div className="min-w-0 max-w-full space-y-3">
      <div className="min-w-0 max-w-full space-y-2.5 rounded-2xl border border-line bg-paper p-2.5 sm:p-3">
        {conFamilias && (
          <div
            ref={familias}
            role="group"
            aria-label={`Familias: ${titulo}`}
            className={cn(
              "relative flex gap-1 overflow-x-auto rounded-xl bg-paperDeep p-1 [scrollbar-width:none] sm:grid sm:overflow-visible [&::-webkit-scrollbar]:hidden",
              COLUMNAS[grupos.length] ?? "sm:grid-cols-3",
            )}
          >
            {grupos.map((g) => {
              const sel = g === suya;
              return (
                <button
                  key={g.nombre ?? "sin"}
                  type="button"
                  aria-pressed={sel}
                  title={g.nombre}
                  onClick={() => !sel && elegir(g.items[0].t.clave)}
                  className={cn(
                    "flex min-h-9 min-w-0 shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-left text-meta transition-colors duration-rapido",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                    sel ? "bg-paper font-semibold text-ink shadow-sm ring-1 ring-line" : "font-medium text-inkSoft hover:bg-paper/60 hover:text-ink",
                  )}
                >
                  {g.serie != null && <MuestraSerie i={g.serie} />}
                  <span className="min-w-0 whitespace-nowrap sm:truncate">{g.corto ?? g.nombre}</span>
                  <span className={cn("ml-auto shrink-0 pl-1 tabular-nums", sel ? "text-ink" : "text-mute")}>{numero(g.total)}</span>
                </button>
              );
            })}
          </div>
        )}
        <div
          ref={lista}
          role="tablist"
          aria-label={titulo}
          className="relative -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden"
        >
          {vista.map((x, k) => boton(x, k))}
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

/**
 * Las columnas de la fila de familias desde sm, por cuántas hay (clases literales para Tailwind): hasta cuatro en una
 * fila; cinco o seis, de a tres (en una sola fila se cortaban sus nombres: «Concerta…», «Compr…»).
 */
const COLUMNAS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };

/** Deja a la vista un botón dentro de su fila si la fila se desliza de costado; nunca mueve la página. */
function enSuFila(fila: HTMLElement | null, el: HTMLElement | null | undefined) {
  if (!fila || !el || fila.scrollWidth <= fila.clientWidth) return;
  const izquierda = el.offsetLeft - 8;
  const derecha = el.offsetLeft + el.offsetWidth - fila.clientWidth + 8;
  if (fila.scrollLeft > izquierda) fila.scrollLeft = izquierda;
  else if (fila.scrollLeft < derecha) fila.scrollLeft = derecha;
}
