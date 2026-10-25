"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Primitivos visuales compartidos de los grafos del mapa de poder. Un solo lenguaje: nodos con brillo por capas
 * (halo translúcido del mismo token, nunca un filtro ni un hex), hover suave, halo que respira en el enfocado,
 * halo persistente en los que tienen indicio, anillo punteado para los autónomos (3er canal, no sólo color),
 * aristas con flujo direccional opcional, y el marco de dos columnas (grafo + panel). Todo por token → día/noche
 * gratis. Las animaciones son transform/opacity y las define app/globals.css + tailwind.config.ts
 * (grafoBrota, latidoNodo, fluirDatos); prefers-reduced-motion ya las neutraliza globalmente.
 */

export type Tono = "granate" | "crimson" | "amber" | "anil" | "neutro";

/* Clases LITERALES por token (Tailwind sólo genera las que ve escritas; nada de `fill-${x}`). */
const TONO: Record<Tono, { halo: string; cuerpo: string; borde: string; arista: string; chip: string; solido: string }> = {
  granate: { halo: "fill-granate/15", cuerpo: "fill-granate/30", borde: "stroke-granate", arista: "stroke-granate", chip: "bg-granate/70", solido: "fill-granate" },
  crimson: { halo: "fill-crimson/20", cuerpo: "fill-crimson/35", borde: "stroke-crimson", arista: "stroke-crimson", chip: "bg-crimson/70", solido: "fill-crimson" },
  amber:   { halo: "fill-amber/15",   cuerpo: "fill-amber/30",   borde: "stroke-amber",   arista: "stroke-amber",   chip: "bg-amber/70",   solido: "fill-amber" },
  anil:    { halo: "fill-anil/15",    cuerpo: "fill-anil/30",    borde: "stroke-anil",    arista: "stroke-anil",    chip: "bg-anil/70",    solido: "fill-anil" },
  neutro:  { halo: "fill-mute/10",    cuerpo: "fill-paperSoft",  borde: "stroke-ink",     arista: "stroke-line",    chip: "bg-mute/70",    solido: "fill-mute" },
};
export const chipTono = (t: Tono) => TONO[t].chip;
export const aristaTono = (t: Tono) => TONO[t].arista;

export interface NodoProps {
  x: number; y: number; r: number; tono: Tono;
  label?: string; anchor?: "start" | "end" | "middle"; fontSize?: number;
  /** Factor de zoom del lienzo: los grosores/offsets/letra se dividen por él para verse constantes. */
  k?: number;
  hovered?: boolean; selected?: boolean;
  /** Halo que respira (rama abierta / seleccionado). */
  foco?: boolean;
  /** Halo persistente, sin respirar (p. ej. tiene indicio de captura): el 3er canal junto a color+palabra. */
  resalta?: boolean;
  /** Anillo punteado = «autónomo/independiente» (3er canal). */
  punteado?: boolean;
  /** Entrada en cascada (sólo para lo que aparece al abrir un nodo). */
  entra?: boolean; indice?: number;
  /** Atenuado (hermanos de una rama no abierta). */
  atenuado?: boolean;
  onEnter?: () => void; onLeave?: () => void; onClick?: () => void;
  aria?: string;
}

export function Nodo(p: NodoProps) {
  const c = TONO[p.tono];
  const k = p.k ?? 1;
  const inv = 1 / k;
  const activo = p.hovered || p.selected;
  const rr = p.r * (activo ? 1.42 : 1);
  const anchor = p.anchor ?? "start";
  const lx = anchor === "start" ? rr + 3 * inv : anchor === "end" ? -(rr + 3 * inv) : 0;

  const nodo = (
    <g
      className="grafo-nodo cursor-pointer"
      opacity={p.atenuado ? 0.3 : 1}
      onPointerEnter={p.onEnter}
      onPointerLeave={p.onLeave}
      onClick={p.onClick}
      role="button"
      tabIndex={-1}
      aria-label={p.aria ?? p.label}
    >
      {p.foco ? (
        <circle cx={p.x} cy={p.y} r={rr + 7 * inv} className={`grafo-halo animate-latidoNodo ${c.halo} pointer-events-none`} />
      ) : p.resalta || activo ? (
        <circle cx={p.x} cy={p.y} r={rr + (activo ? 5 : 4) * inv} className={`${c.halo} pointer-events-none`} />
      ) : null}
      {p.selected && (
        <circle cx={p.x} cy={p.y} r={rr + 3.5 * inv} className="fill-none stroke-ink pointer-events-none" strokeWidth={1.2 * inv} />
      )}
      {p.punteado && (
        <circle cx={p.x} cy={p.y} r={rr + 2.5 * inv} className={`fill-none ${c.borde} pointer-events-none`} strokeWidth={1 * inv} strokeOpacity={0.9} strokeDasharray={`${2.4 * inv} ${2.4 * inv}`} />
      )}
      <circle className={`grafo-nodo-circulo ${c.cuerpo} ${c.borde}`} cx={p.x} cy={p.y} r={rr} strokeWidth={1.3 * inv} />
      {p.label && (
        <text
          x={p.x + lx}
          y={p.y + 1 * inv}
          textAnchor={anchor}
          className={`pointer-events-none ${activo ? "fill-ink font-semibold" : "fill-inkSoft"}`}
          style={{ fontSize: `${(p.fontSize ?? 9) * inv}px` }}
        >
          {p.label}
        </text>
      )}
    </g>
  );

  if (!p.entra) return nodo;
  return (
    <g className="grafo-brota" style={{ "--i": `${Math.min((p.indice ?? 0) * 22, 360)}ms` } as CSSProperties}>
      {nodo}
    </g>
  );
}

/** Nodo central del grafo (El Estado / Gobierno Nacional): núcleo con una o dos líneas de texto. */
export function NodoCentro({ x, y, k = 1, lineas, onClick, aria }: { x: number; y: number; k?: number; lineas: string[]; onClick?: () => void; aria?: string }) {
  const inv = 1 / k;
  return (
    <g className="cursor-pointer" onClick={onClick} role="button" tabIndex={-1} aria-label={aria}>
      <circle cx={x} cy={y} r={15} className="fill-granate/15 pointer-events-none" />
      <circle cx={x} cy={y} r={13} className="fill-paperSoft stroke-ink" strokeWidth={1.6 * inv} />
      {lineas.map((t, i) => (
        <text key={i} x={x} y={y + (i - (lineas.length - 1) / 2) * 7 * inv + 1 * inv} textAnchor="middle" className="pointer-events-none fill-ink font-semibold" style={{ fontSize: `${7 * inv}px` }}>
          {t}
        </text>
      ))}
    </g>
  );
}

export function Arista({ x1, y1, x2, y2, tono, opacity = 0.4, k = 1, flujo }: { x1: number; y1: number; x2: number; y2: number; tono: Tono; opacity?: number; k?: number; flujo?: boolean }) {
  const c = TONO[tono];
  return (
    <line
      x1={x1} y1={y1} x2={x2} y2={y2}
      className={`${c.arista} ${flujo ? "animate-fluirDatos" : ""}`}
      strokeWidth={1 / k}
      strokeOpacity={opacity}
      strokeLinecap="round"
      strokeDasharray={flujo ? "8 8" : undefined}
    />
  );
}

/* ── Marco y paneles ─────────────────────────────────────────────────────── */

export function GrafoSeccion({ children }: { children: ReactNode }) {
  return <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">{children}</section>;
}

/** Cabecera: migas a la izquierda, un extra opcional (select, año) a la derecha. */
export function GrafoCabecera({ migas, extra }: { migas: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav className="flex flex-wrap items-center gap-1.5 text-meta">{migas}</nav>
      {extra}
    </div>
  );
}

/** Separador de migas (sin «·», que lo caza la guardia de estilo: una guilla). */
export function MigaSep() {
  return <span className="text-mute" aria-hidden>›</span>;
}

export function GrafoColumnas({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">{children}</div>;
}

export function GrafoMarco({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-line bg-fondo/40">{children}</div>;
}

export function GrafoAside({ children }: { children: ReactNode }) {
  return <aside className="rounded-xl border border-line bg-paperSoft/50 p-4">{children}</aside>;
}

export function BotonFicha({ onClick, children = "Ver ficha completa →" }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="mt-1 w-full rounded-lg bg-granate px-3 py-2 text-meta font-semibold text-sobreMaiz transition-opacity duration-rapido hover:opacity-90">
      {children}
    </button>
  );
}

/* ── Leyenda de 3 canales (color + forma + palabra) ──────────────────────── */

export type FormaLeyenda = "punto" | "halo" | "punteado";

export function ChipLeyenda({ tono, forma = "punto", children }: { tono: Tono; forma?: FormaLeyenda; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-rotulo text-mute">
      <GlifoLeyenda tono={tono} forma={forma} />
      {children}
    </span>
  );
}

function GlifoLeyenda({ tono, forma }: { tono: Tono; forma: FormaLeyenda }) {
  const c = TONO[tono];
  if (forma === "punteado") {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden className="shrink-0">
        <circle cx={7} cy={7} r={5} className={`fill-none ${c.borde}`} strokeWidth={1.4} strokeDasharray="2.2 2.2" />
      </svg>
    );
  }
  if (forma === "halo") {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden className="shrink-0">
        <circle cx={7} cy={7} r={6} className={c.halo} />
        <circle cx={7} cy={7} r={3.2} className={c.solido} />
      </svg>
    );
  }
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${chipTono(tono)}`} aria-hidden />;
}
