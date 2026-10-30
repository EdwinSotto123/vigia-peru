"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";
import { SkeletonFilas } from "./Skeleton";
import { claseBoton } from "./boton";

/**
 * Tabla del panel. En escritorio es una <table>; por debajo de `apilarHasta`
 * cada fila se vuelve una tarjeta apilada (la columna `principal` arriba, el
 * resto como pares etiqueta → valor, las `acciones` al pie): el teléfono nunca
 * scrollea de costado. En escritorio, si las columnas no caben, scrollea la
 * caja, no la página.
 *
 * Listas largas: `porPagina` (25 en casi todo el panel) pagina en el navegador con su paginador al pie; antes
 * Procesamiento pintaba 200 filas seguidas (16 pantallas en el celular). `compactoMovil` pone en el teléfono las
 * demás columnas en una línea bajo la principal, en vez de pares rótulo → valor que hacían de cada fila seis renglones.
 *
 * Filas clickeables: con `hrefFila` la fila entera navega (Ctrl/⌘ abre en
 * pestaña nueva) y la celda principal es un <Link> de verdad para el teclado;
 * con `onFila` la celda principal es un <button>; la fila elegida (`filaActiva`)
 * lleva aria-current: es "la que se está mostrando", no un interruptor.
 * Los botones y enlaces propios de otras celdas siguen funcionando: el clic de
 * fila los ignora. Por eso la celda principal no debe traer enlaces propios.
 */
export interface Columna<T> {
  clave: string;
  titulo: React.ReactNode;
  celda: (fila: T) => React.ReactNode;
  alinear?: "derecha";
  /** Clases extra de <th>/<td> (anchos, max-w). */
  className?: string;
  /** Titula la fila en el apilado y lleva el enlace/selección. Si ninguna la marca, la primera. */
  principal?: boolean;
  /** Botones de la fila: al pie de la tarjeta en el apilado, sin etiqueta. */
  acciones?: boolean;
  /** No se muestra en el apilado. */
  soloEscritorio?: boolean;
  /** Etiqueta en el apilado cuando `titulo` no es texto. */
  etiquetaMovil?: string;
  /** En el apilado ocupa las dos columnas (textos largos, varias etiquetas). */
  anchoCompletoMovil?: boolean;
}

const APILAR = {
  md: { tabla: "hidden md:block", lista: "md:hidden" },
  lg: { tabla: "hidden lg:block", lista: "lg:hidden" },
} as const;

const INTERACTIVO = "a,button,input,select,textarea,label,summary,[role=button]";

/** La fila que se está mostrando: el mismo filete lima que la fila resaltada de la `Tabla` pública. */
const FILA_ELEGIDA = "bg-granate-50 shadow-[inset_3px_0_0_0_theme(colors.granate.DEFAULT)]";

export function DataTable<T>({
  columnas,
  filas,
  claveFila,
  etiqueta,
  hrefFila,
  externo,
  onFila,
  filaActiva,
  alAcercarse,
  cargando,
  vacio,
  apilarHasta = "md",
  anchoMinimo,
  ventana,
  porPagina,
  compactoMovil,
  reinicio,
  className,
}: {
  columnas: Columna<T>[];
  /** null/undefined = todavía no hay datos (con `cargando`, esqueleto). */
  filas: T[] | null | undefined;
  claveFila: (f: T) => string;
  /** Nombre de la tabla para lectores de pantalla. */
  etiqueta: string;
  hrefFila?: (f: T) => string | null | undefined;
  externo?: boolean;
  onFila?: (f: T) => void;
  filaActiva?: (f: T) => boolean;
  /**
   * Al pasar el mouse o enfocar una fila: sirve para precargar el detalle antes del clic. En el
   * teléfono no hay hover y el touchstart no sirve (todo scroll empieza con uno): ahí sólo el foco.
   */
  alAcercarse?: (f: T) => void;
  cargando?: boolean;
  /** Qué mostrar sin filas (idealmente un <EmptyState compacto>). */
  vacio?: React.ReactNode;
  apilarHasta?: keyof typeof APILAR;
  /** min-width de la tabla de escritorio, p. ej. "min-w-[860px]". */
  anchoMinimo?: string;
  /**
   * Listas largas: se muestran las primeras `ventana` filas y un botón "Ver N más" agrega otra tanda.
   * Las filas siguen en los datos (buscar y filtrar corre sobre todas); solo se pintan por tramos.
   */
  ventana?: number;
  /**
   * Filas por página, con su paginador al pie («1–25 de 200», anterior y siguiente). Buscar y filtrar corren sobre
   * todas; cuando la lista cambia se vuelve a la primera página. Gana sobre `ventana`.
   */
  porPagina?: number;
  /** En el teléfono, las demás columnas en una línea bajo la principal (sin rótulo visible), no en pares. */
  compactoMovil?: boolean;
  /**
   * Cuándo volver a la primera página: lo que define la lista (filtros y búsqueda, p. ej. `${estado}|${q}`). Sin esto,
   * se vuelve a la primera cuando cambian el largo o la primera fila; en una lista que se refresca sola (Procesamiento,
   * cada 15 s) eso devolvía a la página 1 a quien estaba leyendo la 3, así que ahí hay que pasarlo.
   */
  reinicio?: string | number;
  className?: string;
}) {
  const router = useRouter();
  const [pintadas, setPintadas] = useState(ventana ?? Infinity);
  const [pagina, setPagina] = useState(1);
  const caja = useRef<HTMLDivElement>(null);
  // Otra lista (un filtro, una búsqueda): a la primera página. Con `reinicio`, sólo cuando cambia; sin él, por largo y
  // primera fila (no por identidad del arreglo: muchas páginas lo arman en cada render y SWR lo vuelve a traer).
  const firma = reinicio !== undefined ? `r:${reinicio}` : filas ? `${filas.length}:${filas.length ? claveFila(filas[0]) : ""}` : "";
  useEffect(() => setPagina(1), [firma]);
  const principal = columnas.find((c) => c.principal) ?? columnas[0];
  const resto = columnas.filter((c) => c !== principal && !c.acciones && !c.soloEscritorio);
  const acciones = columnas.filter((c) => c.acciones);
  // En el teléfono, una acción marcada `soloEscritorio` no se pinta (se decide en la ficha, por ejemplo).
  const accionesMovil = acciones.filter((c) => !c.soloEscritorio);
  const clickeable = !!hrefFila || !!onFila;

  function alClicFila(e: React.MouseEvent, f: T) {
    if ((e.target as HTMLElement).closest(INTERACTIVO)) return;
    if (window.getSelection()?.toString()) return; // estaba seleccionando texto
    const href = hrefFila?.(f);
    if (href) {
      if (externo || e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
      else router.push(href);
      return;
    }
    onFila?.(f);
  }

  function celdaPrincipal(f: T) {
    const contenido = principal.celda(f);
    const href = hrefFila?.(f);
    if (href)
      return (
        <Link href={href} target={externo ? "_blank" : undefined} className="block rounded-md">
          {contenido}
        </Link>
      );
    if (onFila)
      return (
        <button type="button" onClick={() => onFila(f)} aria-current={filaActiva?.(f) ? "true" : undefined} className="block w-full rounded-md text-left">
          {contenido}
        </button>
      );
    return contenido;
  }

  const etiquetaDe = (c: Columna<T>) => c.etiquetaMovil ?? (typeof c.titulo === "string" ? c.titulo : c.clave);
  const sinFilas = !!filas && filas.length === 0;
  const esperando = !filas;
  const paginas = porPagina && filas ? Math.max(1, Math.ceil(filas.length / porPagina)) : 1;
  const actual = Math.min(pagina, paginas);
  const visibles = !filas ? filas : porPagina ? filas.slice((actual - 1) * porPagina, actual * porPagina) : filas.slice(0, pintadas);
  const faltan = filas && !porPagina ? Math.max(0, filas.length - pintadas) : 0;

  function irA(n: number) {
    setPagina(n);
    // Si el comienzo de la tabla quedó arriba de la pantalla (se pasó de página desde abajo), se lo trae a la vista.
    const el = caja.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return (
    <div ref={caja} className={cn("scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-paperSoft", className)} aria-busy={cargando || undefined}>
      {esperando ? (
        // Sin filas todavía no es "vacío": o está cargando o falló (el aviso de error va arriba, en la página).
        // Nunca se muestra `vacio` acá: diría "no hay nada" cuando en realidad no sabemos.
        cargando ? <SkeletonFilas columnas={Math.min(columnas.length, 6)} /> : <EmptyState compacto titulo="La lista no llegó" descripcion="Si arriba hay un aviso de error, reintenta desde ahí." />
      ) : sinFilas ? (
        vacio ?? <EmptyState compacto titulo="Nada que mostrar" />
      ) : (
        <div className={cn("transition-opacity duration-rapido", cargando && "opacity-60")}>
          {/* Escritorio */}
          <div className={cn("overflow-x-auto", APILAR[apilarHasta].tabla)}>
            <table className={cn("w-full text-dato leading-5", anchoMinimo)}>
              <caption className="sr-only">{etiqueta}</caption>
              <thead className="bg-paperDeep/50 text-left text-rotulo text-mute">
                <tr>
                  {columnas.map((c, i) => (
                    <th
                      key={c.clave}
                      scope="col"
                      className={cn(
                        "px-3 py-2.5 font-medium",
                        i === 0 && "pl-4",
                        i === columnas.length - 1 && "pr-4",
                        (c.alinear === "derecha" || c.acciones) && "text-right",
                        c.className,
                      )}
                    >
                      {c.acciones && typeof c.titulo !== "string" ? <span className="sr-only">Acciones</span> : c.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibles!.map((f) => {
                  const activa = filaActiva?.(f);
                  return (
                    <tr
                      key={claveFila(f)}
                      onClick={clickeable ? (e) => alClicFila(e, f) : undefined}
                      onMouseEnter={alAcercarse ? () => alAcercarse(f) : undefined}
                      onFocus={alAcercarse ? () => alAcercarse(f) : undefined}
                      className={cn(
                        "border-t border-line/70 align-middle transition-colors duration-rapido",
                        clickeable && "cursor-pointer hover:bg-paperDeep/50",
                        activa && FILA_ELEGIDA,
                      )}
                    >
                      {columnas.map((c, i) => (
                        <td
                          key={c.clave}
                          className={cn(
                            "px-3 py-2",
                            i === 0 && "pl-4",
                            i === columnas.length - 1 && "pr-4",
                            (c.alinear === "derecha" || c.acciones) && "text-right",
                            c.alinear === "derecha" && "whitespace-nowrap font-mono tabular-nums",
                            c.className,
                          )}
                        >
                          {c === principal ? celdaPrincipal(f) : c.celda(f)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Teléfono: tarjetas apiladas */}
          <ul className={cn("divide-y divide-line", APILAR[apilarHasta].lista)} aria-label={etiqueta}>
            {visibles!.map((f) => {
              const activa = filaActiva?.(f);
              return (
                <li
                  key={claveFila(f)}
                  onClick={clickeable ? (e) => alClicFila(e, f) : undefined}
                  onFocus={alAcercarse ? () => alAcercarse(f) : undefined}
                  className={cn("px-4 py-3", clickeable && "cursor-pointer active:bg-paperDeep/50", activa && FILA_ELEGIDA)}
                >
                  {/* Con `compactoMovil` las acciones van a la derecha de la principal, no en un tercer renglón. */}
                  <div className={cn(compactoMovil && accionesMovil.length > 0 && "flex items-start gap-2")}>
                    <div className="min-w-0 flex-1">
                      <div className="min-w-0">{celdaPrincipal(f)}</div>
                      {resto.length > 0 && compactoMovil && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-inkSoft">
                          {resto.map((c) => (
                            <span key={c.clave} className={cn("min-w-0 break-words", c.alinear === "derecha" && "font-mono tabular-nums")}>
                              <span className="sr-only">{etiquetaDe(c)}: </span>
                              {c.celda(f)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {compactoMovil && accionesMovil.length > 0 && (
                      <div className="flex shrink-0 items-center gap-1.5">{accionesMovil.map((c) => <div key={c.clave}>{c.celda(f)}</div>)}</div>
                    )}
                  </div>
                  {resto.length > 0 && !compactoMovil && (
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                      {resto.map((c) => (
                        <div key={c.clave} className={cn("min-w-0", c.anchoCompletoMovil && "col-span-2")}>
                          <dt className="text-micro text-mute">{etiquetaDe(c)}</dt>
                          <dd className={cn("mt-0.5 break-words text-meta text-ink", c.alinear === "derecha" && "font-mono tabular-nums")}>{c.celda(f)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {!compactoMovil && accionesMovil.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">{accionesMovil.map((c) => <div key={c.clave}>{c.celda(f)}</div>)}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {porPagina && filas && filas.length > porPagina && (
            <nav aria-label={`Páginas de ${etiqueta}`} className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-meta text-inkSoft">
              <span className="font-mono tabular-nums">
                {((actual - 1) * porPagina + 1).toLocaleString("es-PE")}–{Math.min(actual * porPagina, filas.length).toLocaleString("es-PE")} de{" "}
                {filas.length.toLocaleString("es-PE")}
              </span>
              <span className="flex items-center gap-1.5">
                <button type="button" onClick={() => irA(actual - 1)} disabled={actual <= 1} className={claseBoton("secundario", "xs")} aria-label="Página anterior">
                  <ChevronLeft size={14} aria-hidden />
                </button>
                <span className="min-w-[4.5rem] text-center font-mono tabular-nums" aria-live="polite">
                  {actual} / {paginas}
                </span>
                <button type="button" onClick={() => irA(actual + 1)} disabled={actual >= paginas} className={claseBoton("secundario", "xs")} aria-label="Página siguiente">
                  <ChevronRight size={14} aria-hidden />
                </button>
              </span>
            </nav>
          )}
          {faltan > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-meta text-inkSoft">
              <span>
                Se muestran {pintadas.toLocaleString("es-PE")} de {filas!.length.toLocaleString("es-PE")}
              </span>
              <button type="button" onClick={() => setPintadas((n) => n + (ventana ?? 50))} className={claseBoton("secundario", "xs")}>
                Ver {Math.min(faltan, ventana ?? 50).toLocaleString("es-PE")} más
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
