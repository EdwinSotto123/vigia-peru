"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";
import { SkeletonFilas } from "./Skeleton";

/**
 * Tabla del panel. En escritorio es una <table>; por debajo de `apilarHasta`
 * cada fila se vuelve una tarjeta apilada (la columna `principal` arriba, el
 * resto como pares etiqueta → valor, las `acciones` al pie): el teléfono nunca
 * scrollea de costado. En escritorio, si las columnas no caben, scrollea la
 * caja, no la página.
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
  className?: string;
}) {
  const router = useRouter();
  const [pintadas, setPintadas] = useState(ventana ?? Infinity);
  const principal = columnas.find((c) => c.principal) ?? columnas[0];
  const resto = columnas.filter((c) => c !== principal && !c.acciones && !c.soloEscritorio);
  const acciones = columnas.filter((c) => c.acciones);
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
  const visibles = filas ? filas.slice(0, pintadas) : filas;
  const faltan = filas ? Math.max(0, filas.length - pintadas) : 0;

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-paper", className)} aria-busy={cargando || undefined}>
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
            <table className={cn("w-full text-sm", anchoMinimo)}>
              <caption className="sr-only">{etiqueta}</caption>
              <thead className="text-left text-[11px] text-mute">
                <tr>
                  {columnas.map((c, i) => (
                    <th
                      key={c.clave}
                      scope="col"
                      className={cn(
                        "px-2 py-2 font-medium",
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
                        "border-t border-line align-middle transition-colors duration-rapido",
                        clickeable && "cursor-pointer hover:bg-paperSoft",
                        activa && "bg-paperSoft shadow-[inset_3px_0_0_#D4FF3F]",
                      )}
                    >
                      {columnas.map((c, i) => (
                        <td
                          key={c.clave}
                          className={cn(
                            "px-2 py-1.5",
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
                  className={cn("px-4 py-2.5", clickeable && "cursor-pointer active:bg-paperSoft", activa && "bg-paperSoft shadow-[inset_3px_0_0_#D4FF3F]")}
                >
                  <div className="min-w-0">{celdaPrincipal(f)}</div>
                  {resto.length > 0 && (
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                      {resto.map((c) => (
                        <div key={c.clave} className={cn("min-w-0", c.anchoCompletoMovil && "col-span-2")}>
                          <dt className="text-[11px] text-mute">{etiquetaDe(c)}</dt>
                          <dd className={cn("mt-0.5 break-words text-[13px] text-ink", c.alinear === "derecha" && "font-mono tabular-nums")}>{c.celda(f)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {acciones.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-1.5">{acciones.map((c) => <div key={c.clave}>{c.celda(f)}</div>)}</div>}
                </li>
              );
            })}
          </ul>
          {faltan > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[12.5px] text-inkSoft">
              <span>
                Se muestran {pintadas.toLocaleString("es-PE")} de {filas!.length.toLocaleString("es-PE")}
              </span>
              <button
                type="button"
                onClick={() => setPintadas((n) => n + (ventana ?? 50))}
                className="min-h-9 rounded-full border border-line px-3 font-semibold text-ink hover:bg-paperSoft"
              >
                Ver {Math.min(faltan, ventana ?? 50).toLocaleString("es-PE")} más
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
