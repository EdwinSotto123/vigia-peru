"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
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
    "group relative flex min-w-0 flex-col rounded-2xl border p-3 text-left sm:p-4",
    destacado ? TONO[tono].caja : "border-line bg-paper",
    interactivo && "transition-[border-color,box-shadow] duration-rapido hover:border-ink/25",
    activo && "border-ink shadow-[0_0_0_3px_rgba(30,25,27,0.08)]",
    className,
  );
  const cuerpo = (
    <>
      <span className="flex items-center gap-2 pr-4 text-[12px] font-medium leading-snug text-inkSoft">
        {tono !== "neutral" && <span className={cn("h-2 w-2 shrink-0 rounded-full", TONO[tono].punto)} aria-hidden />}
        {etiqueta}
      </span>
      {cargando && sinDato ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <span
          className={cn(
            "mt-1 font-semibold text-ink",
            // Un valor que es frase ("Sin ritmo suficiente…") baja de tamaño y envuelve en vez de cortarse.
            typeof valor === "string" && valor.length > 12 ? "text-base leading-snug" : "truncate font-mono text-2xl",
          )}
          title={sinDato ? "Sin dato" : undefined}
        >
          {sinDato ? <><span aria-hidden>—</span><span className="sr-only">Sin dato</span></> : typeof valor === "number" ? valor.toLocaleString("es-PE") : valor}
        </span>
      )}
      {pista && <span className={cn("mt-0.5 text-[11.5px] leading-snug", destacado ? "text-inkSoft" : "text-mute")}>{pista}</span>}
      {href && <ArrowUpRight size={14} className="absolute right-3 top-3 text-mute transition-colors group-hover:text-ink" aria-hidden />}
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

/** Grilla de StatCard: 2 columnas en el teléfono, las que pidas desde tablet. */
export function StatGrid({ columnas = 4, className, children }: { columnas?: keyof typeof COLUMNAS; className?: string; children: React.ReactNode }) {
  return <div className={cn("grid gap-2 sm:gap-3", COLUMNAS[columnas], className)}>{children}</div>;
}
