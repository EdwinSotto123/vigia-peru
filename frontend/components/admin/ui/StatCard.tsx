"use client";

import { Children, isValidElement, type ReactElement } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { CifrasEnFila, CifrasEnFilaSkeleton, type Cifra } from "@/components/ui/CifrasEnFila";
import { TONO, type Tone } from "./tono";

/**
 * KPI: número grande, etiqueta con el punto de su tono y una pista corta.
 * Con `href` es un enlace (lleva a donde se resuelve); con `onClick` es un
 * filtro de la página: un interruptor (`activo` → aria-pressed) o, con
 * `rol="radio"`, una opción de un grupo de selección única (aria-checked; el
 * grupo va en un role="radiogroup" con `flechasRadio`). `destacado` tiñe la caja
 * con el tono, para lo que espera una decisión. Sin valor muestra "—" y lo dice.
 */
export function StatCard({
  etiqueta,
  valor,
  pista,
  tono = "neutral",
  destacado,
  href,
  externo,
  onClick,
  activo,
  rol = "interruptor",
  cargando,
  className,
}: {
  etiqueta: string;
  valor: number | string | null | undefined;
  pista?: React.ReactNode;
  tono?: Tone;
  destacado?: boolean;
  href?: string;
  externo?: boolean;
  onClick?: () => void;
  activo?: boolean;
  rol?: "interruptor" | "radio";
  cargando?: boolean;
  className?: string;
}) {
  const sinDato = valor === null || valor === undefined || valor === "";
  const interactivo = !!href || !!onClick;
  const cls = cn(
    "group relative flex min-w-0 flex-col rounded-xl border px-3 py-2 text-left",
    destacado ? TONO[tono].caja : "border-line bg-paper",
    interactivo && "transition-[border-color,box-shadow] duration-rapido hover:border-ink/25",
    activo && "border-ink shadow-[0_0_0_3px_rgba(30,25,27,0.08)]",
    className,
  );
  const cuerpo = (
    <>
      <span className="flex items-center gap-2 pr-4 text-[11.5px] font-medium leading-tight text-inkSoft">
        {tono !== "neutral" && <span className={cn("h-2 w-2 shrink-0 rounded-full", TONO[tono].punto)} aria-hidden />}
        {etiqueta}
      </span>
      {/* La cifra y su pista comparten renglón: una tarjeta de dos líneas, no una caja con aire. */}
      <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        {cargando && sinDato ? (
          <Skeleton className="h-6 w-16" />
        ) : (
          <span
            className={cn(
              "font-semibold text-ink",
              // Un valor que es frase ("Sin ritmo suficiente…") baja de tamaño y envuelve en vez de cortarse.
              typeof valor === "string" && valor.length > 12 ? "text-sm leading-snug" : "truncate font-mono text-xl leading-tight",
            )}
            title={sinDato ? "Sin dato" : undefined}
          >
            {sinDato ? <><span aria-hidden>—</span><span className="sr-only">Sin dato</span></> : typeof valor === "number" ? valor.toLocaleString("es-PE") : valor}
          </span>
        )}
        {pista && <span className={cn("min-w-0 text-[11.5px] leading-snug", destacado ? "text-inkSoft" : "text-mute")}>{pista}</span>}
      </span>
      {href && <ArrowUpRight size={13} className="absolute right-2.5 top-2.5 text-mute transition-colors group-hover:text-ink" aria-hidden />}
    </>
  );
  if (href)
    return (
      <Link href={href} target={externo ? "_blank" : undefined} className={cls}>
        {cuerpo}
      </Link>
    );
  if (onClick)
    return (
      <button
        type="button"
        onClick={onClick}
        role={rol === "radio" ? "radio" : undefined}
        aria-checked={rol === "radio" ? !!activo : undefined}
        aria-pressed={rol === "radio" ? undefined : !!activo}
        tabIndex={rol === "radio" ? (activo ? 0 : -1) : undefined}
        className={cls}
      >
        {cuerpo}
      </button>
    );
  return <div className={cls}>{cuerpo}</div>;
}

const COLUMNAS = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5",
} as const;

type PropsStatCard = Parameters<typeof StatCard>[0];

const TONO_CIFRA: Record<Tone, NonNullable<Cifra["tono"]>> = {
  neutral: "neutro", muted: "neutro", brand: "neutro", ok: "positivo", warn: "media", pending: "media", danger: "alta",
};

/** Reparte n cifras en filas de hasta 4, parejas (5 → 3 + 2, no 4 + 1). */
function repartir(n: number): number[] {
  const filas = Math.ceil(n / 4);
  const base = Math.floor(n / filas);
  const resto = n % filas;
  return Array.from({ length: filas }, (_, i) => base + (i < resto ? 1 : 0));
}

/**
 * Grilla de StatCard. Si todas sus tarjetas son solo de lectura (sin `onClick`), se pinta como UNA franja
 * de cifras (components/ui/CifrasEnFila): sin una caja con borde por cada número, que medían 270 x 100 px
 * con tres líneas de texto. Si alguna es un filtro (`onClick`), queda como grilla de tarjetas, porque ahí
 * cada caja es un botón y tiene que verse como tal.
 */
export function StatGrid({ columnas = 4, className, children }: { columnas?: keyof typeof COLUMNAS; className?: string; children: React.ReactNode }) {
  const hijos = Children.toArray(children).filter((h): h is ReactElement<PropsStatCard> => isValidElement(h));
  const soloLectura = hijos.length > 0 && hijos.every((h) => h.type === StatCard && !(h.props as PropsStatCard).onClick);
  if (!soloLectura) return <div className={cn("grid gap-2", COLUMNAS[columnas], className)}>{children}</div>;

  const props = hijos.map((h) => h.props as PropsStatCard);
  const cargandoTodo = props.every((c) => c.cargando && (c.valor === null || c.valor === undefined || c.valor === ""));
  const cifras: Cifra[] = props.map((c) => ({
    etiqueta: c.etiqueta,
    valor: c.valor === null || c.valor === undefined || c.valor === "" ? null : typeof c.valor === "number" ? c.valor.toLocaleString("es-PE") : c.valor,
    contexto: c.pista,
    tono: TONO_CIFRA[c.tono ?? "neutral"],
    href: c.href,
  }));
  let desde = 0;
  return (
    <div className={cn("divide-y divide-line rounded-2xl border border-line bg-paper px-4", className)}>
      {repartir(cifras.length).map((n, i) => {
        const fila = cifras.slice(desde, desde + n);
        desde += n;
        return (
          <div key={i} className="py-2.5">
            {cargandoTodo ? <CifrasEnFilaSkeleton n={n} /> : <CifrasEnFila items={fila} />}
          </div>
        );
      })}
    </div>
  );
}
