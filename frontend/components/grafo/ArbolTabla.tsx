"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Columna } from "@/components/listado";
import { BotonFila, ProveedorDetalle, type DetalleFila } from "@/components/listado/DetalleFilas";
import { cn } from "@/lib/utils";

/**
 * Una jerarquía como tabla plegable (región → provincia → distrito; sector → pliego → ejecutora; departamento →
 * entidad). Antes eran radiales con letra de 4 a 9 px que se cortaban sin decir cuántas había; ahora cada rama es una
 * fila con sus totales (la «fila padre») que se abre en el lugar, y cada hoja abre el panel lateral compartido del kit
 * (`ProveedorDetalle`: anclado en escritorio, con anterior/siguiente) o va a su página.
 *
 * Misma anatomía que `Tabla` (components/listado/Tabla.tsx): las columnas se declaran una vez (`desde`, `alinear`,
 * `ayuda`, `apilar`) y cabecera y filas comparten la rejilla. Las celdas que faltan quedan vacías (una métrica que sólo
 * tiene la rama, o sólo la hoja), no "Sin dato": quien llama escribe "Sin dato" donde corresponde.
 *
 * Accesible como divulgación: cada rama es un botón con `aria-expanded`; las hojas, la fila-botón del panel o un enlace.
 * La rama abierta del primer nivel queda fija arriba mientras se recorre lo suyo. Con `todoAbierto` (al buscar o
 * filtrar) se ve todo lo que quedó, sin tener que abrir nada.
 */

type Desde = "md" | "lg" | "xl";

export interface NodoArbol {
  id: string;
  celdas: Record<string, ReactNode>;
  hijos?: NodoArbol[];
  /** Hoja que abre el panel lateral compartido. */
  detalle?: Omit<DetalleFila, "id">;
  /** Hoja que va a su página. */
  href?: string;
}

const ORDEN: (Desde | undefined)[] = [undefined, "md", "lg", "xl"];
const visibleEn = (c: Columna, bp: Desde | undefined) => ORDEN.indexOf(c.desde) <= ORDEN.indexOf(bp);

// Clases literales (Tailwind sólo genera lo que ve escrito entero en el código), las mismas de `Tabla`.
const OCULTA: Record<Desde, string> = { md: "hidden md:flex", lg: "hidden lg:flex", xl: "hidden xl:flex" };
const MOSTRAR_HASTA: Record<Desde, string> = { md: "md:hidden", lg: "lg:hidden", xl: "xl:hidden" };
const GRID = "grid grid-cols-[var(--t-base)] md:grid-cols-[var(--t-md)] lg:grid-cols-[var(--t-lg)] xl:grid-cols-[var(--t-xl)] items-center gap-x-4";
// Sangría por nivel (la del título): literales.
const SANGRIA = ["", "pl-5", "pl-10", "pl-14"];

function rejilla(columnas: Columna[]): CSSProperties {
  const t = (bp: Desde | undefined) => [...columnas.filter((c) => visibleEn(c, bp)).map((c) => c.ancho), "16px"].join(" ");
  return { "--t-base": t(undefined), "--t-md": t("md"), "--t-lg": t("lg"), "--t-xl": t("xl") } as CSSProperties;
}

const FILA =
  "group w-full px-4 text-left transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate";
const ALTO = { normal: "min-h-[56px] py-2.5", compacta: "min-h-[44px] py-1.5" } as const;

/** Las hojas que se ven (en orden), para el anterior/siguiente del panel. */
function hojasVisibles(nodos: NodoArbol[], abierto: (id: string) => boolean, out: NodoArbol[] = []): NodoArbol[] {
  for (const n of nodos) {
    if (n.hijos?.length) {
      if (abierto(n.id)) hojasVisibles(n.hijos, abierto, out);
    } else if (n.detalle) out.push(n);
  }
  return out;
}

/** ¿Alguna hoja del árbol (abierta o no) abre el panel? */
const conDetalle = (nodos: NodoArbol[]): boolean => nodos.some((n) => (n.hijos?.length ? conDetalle(n.hijos) : !!n.detalle));

export function ArbolTabla({
  columnas,
  nodos,
  etiqueta,
  inicial = [],
  todoAbierto = false,
  densidad = "normal",
  className,
}: {
  columnas: Columna[];
  nodos: NodoArbol[];
  /** Nombre de la lista para el lector de pantalla y del panel: "Entidades por departamento". */
  etiqueta: string;
  /** Las ramas abiertas al cargar. */
  inicial?: string[];
  /** Todo abierto (al buscar o filtrar): se ve lo que quedó. */
  todoAbierto?: boolean;
  densidad?: "normal" | "compacta";
  className?: string;
}) {
  // Lo abierto a mano y, con `todoAbierto`, lo cerrado a mano: al filtrar se ve todo, pero una rama se puede plegar igual.
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set(inicial));
  const [cerradas, setCerradas] = useState<Set<string>>(() => new Set());
  const abierto = (id: string) => (todoAbierto ? !cerradas.has(id) : abiertas.has(id));
  const alternar = (id: string) =>
    (todoAbierto ? setCerradas : setAbiertas)((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const estilo = useMemo(() => rejilla(columnas), [columnas]);
  // El proveedor del panel envuelve siempre que alguna hoja lo use (no sólo cuando hay alguna a la vista): si apareciera
  // al abrir la primera rama, la tabla se volvería a montar y el foco del botón recién tocado se perdería.
  const hayDetalle = useMemo(() => conDetalle(nodos), [nodos]);
  const detalles = hayDetalle ? hojasVisibles(nodos, abierto).map((n) => ({ id: n.id, ...n.detalle! })) : [];
  const principal = columnas.findIndex((c) => !c.desde);
  const apiladas = columnas.filter((c) => c.apilar && c.desde);
  const ultima = apiladas.reduce<Desde | undefined>((m, c) => (ORDEN.indexOf(c.desde) > ORDEN.indexOf(m) ? c.desde : m), undefined);

  const celdas = (n: NodoArbol, nivel: number, rama: boolean, abierta: boolean) => (
    <>
      {columnas.map((c, i) => {
        const valor = n.celdas[c.clave];
        const clase = cn("min-w-0 items-center", c.desde ? OCULTA[c.desde] : "flex", c.alinear === "der" && "justify-end text-right");
        if (i !== principal) return <span key={c.clave} className={clase}>{valor}</span>;
        const conValor = apiladas.filter((a) => n.celdas[a.clave] != null);
        return (
          <span key={c.clave} className={cn(clase, SANGRIA[Math.min(nivel, SANGRIA.length - 1)])}>
            <span className="flex w-full min-w-0 items-start gap-1.5">
              {/* El chevrón de la rama; en una hoja, el mismo hueco, para que los nombres queden alineados. */}
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                {rama && <ChevronRight size={16} className={cn("text-mute transition-transform duration-rapido", abierta && "rotate-90 text-ink")} />}
              </span>
              <span className="block min-w-0 flex-1">
                {valor}
                {conValor.length > 0 && (
                  <span className={cn("mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1", ultima && MOSTRAR_HASTA[ultima])}>
                    {conValor.map((a) => (
                      <span key={a.clave} className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5", MOSTRAR_HASTA[a.desde!])}>
                        {a.apilar === "con-rotulo" && <span className="shrink-0 text-rotulo text-mute">{a.corto ?? a.titulo}</span>}
                        {n.celdas[a.clave]}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </span>
          </span>
        );
      })}
      {/* La flecha de la hoja que se abre; la rama ya tiene su chevrón. */}
      {!rama && (n.detalle || n.href) ? (
        <ChevronRight size={16} className="text-mute transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
      ) : (
        <span aria-hidden />
      )}
    </>
  );

  const fila = (n: NodoArbol, nivel: number, primera: boolean): ReactNode => {
    const rama = !!n.hijos?.length;
    const raya = !primera && "border-t border-line/70";
    if (rama) {
      const a = abierto(n.id);
      return (
        <li key={n.id}>
          <button
            type="button"
            aria-expanded={a}
            onClick={() => alternar(n.id)}
            className={cn(
              GRID,
              FILA,
              ALTO[densidad],
              raya,
              nivel === 0 ? "bg-paperSoft hover:bg-paperDeep" : "hover:bg-paperSoft",
              // La rama abierta del primer nivel queda arriba mientras se recorre lo suyo.
              nivel === 0 && a && "sticky top-0 z-[1] shadow-[0_1px_0_rgb(var(--line))]",
            )}
          >
            {celdas(n, nivel, true, a)}
          </button>
          {a && <ul>{n.hijos!.map((h) => fila(h, nivel + 1, false))}</ul>}
        </li>
      );
    }
    const clase = cn(GRID, FILA, ALTO[densidad], raya, "hover:bg-paperSoft");
    if (n.detalle) {
      return (
        <li key={n.id}>
          <BotonFila id={n.id} etiqueta={n.detalle.etiqueta ?? `Ver el detalle de ${n.detalle.titulo}`} className={clase}>
            {celdas(n, nivel, false, false)}
          </BotonFila>
        </li>
      );
    }
    if (n.href) {
      return (
        <li key={n.id}>
          <Link href={n.href} prefetch={false} className={clase}>
            {celdas(n, nivel, false, false)}
          </Link>
        </li>
      );
    }
    return (
      <li key={n.id}>
        <div className={clase}>{celdas(n, nivel, false, false)}</div>
      </li>
    );
  };

  const tabla = (
    // `overflow-clip` (no -hidden): recorta las esquinas sin crear un contenedor de scroll, así la rama abierta queda fija.
    <div
      className={cn(
        "overflow-clip rounded-2xl border border-line bg-paper",
        "[.tarjeta_&]:rounded-none [.tarjeta_&]:border-x-0 [.tarjeta_&]:border-b-0 [.tarjeta_&]:bg-transparent",
        className,
      )}
      style={estilo}
    >
      <div className={cn(GRID, "border-b border-line bg-paperSoft px-4 py-2.5 text-rotulo font-medium text-mute")}>
        {columnas.map((c, i) => (
          <span key={c.clave} className={cn("min-w-0 items-center gap-1", c.desde ? OCULTA[c.desde] : "flex", c.alinear === "der" && "justify-end", i === principal && "pl-[22px]")}>
            <span className="truncate">{c.titulo}</span>
            {c.ayuda}
          </span>
        ))}
        <span aria-hidden />
      </div>
      <ul aria-label={etiqueta}>{nodos.map((n, i) => fila(n, 0, i === 0))}</ul>
    </div>
  );

  return hayDetalle ? (
    <ProveedorDetalle detalles={detalles} nombre={etiqueta}>
      {tabla}
    </ProveedorDetalle>
  ) : (
    tabla
  );
}
