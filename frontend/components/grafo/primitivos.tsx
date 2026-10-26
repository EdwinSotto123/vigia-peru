"use client";

import type { ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";

/**
 * Primitivos visuales compartidos de los grafos del mapa de poder. Un solo lenguaje: nodos con brillo por capas
 * (halo translúcido del mismo token, nunca un filtro ni un hex), halo fijo en el enfocado y en los que tienen indicio,
 * anillo punteado para los autónomos (3er canal, no sólo color) y el marco de dos columnas (grafo + panel). Todo por
 * token → día/noche gratis.
 *
 * Sin movimiento decorativo (auditoría 2026-10-26): las aristas ya no «fluyen», los nodos no brotan en cascada y el halo
 * no respira; en una superficie de trabajo el movimiento sólo responde a lo que hace quien la usa (el radio del nodo al
 * enfocarlo, el zoom al abrir una rama). Las props `flujo`, `entra` e `indice` siguen aceptándose por compatibilidad:
 * `flujo` resalta la arista (más gruesa, sin animar) y `entra`/`indice` ya no hacen nada.
 *
 * Dentro de una tarjeta (`GrafoSeccion`, clase `tarjeta`) el lienzo y el panel van sin marco propio: una caja con borde
 * dentro de otra era ruido.
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
  /** Si se da (grados), la etiqueta se dibuja RADIAL (en abanico hacia afuera del centro), que evita el
   *  amontonamiento arriba/abajo de los anillos densos. Si no, la etiqueta es horizontal (anchor/offset). */
  anguloEtiqueta?: number;
  /** Factor de zoom del lienzo: los grosores/offsets/letra se dividen por él para verse constantes. */
  k?: number;
  hovered?: boolean; selected?: boolean;
  /** Halo fijo del nodo abierto (la rama que se está viendo). */
  foco?: boolean;
  /** Halo persistente (p. ej. tiene indicio de captura): el 3er canal junto a color+palabra. */
  resalta?: boolean;
  /** Anillo punteado = «autónomo/independiente» (3er canal). */
  punteado?: boolean;
  /** Sin efecto (antes: entrada en cascada). Se acepta por compatibilidad. */
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

  return (
    <g
      className="grafo-nodo cursor-pointer focus:outline-none [&:focus-visible>circle.grafo-nodo-circulo]:stroke-[3px]"
      opacity={p.atenuado ? 0.3 : 1}
      onPointerEnter={p.onEnter}
      onPointerLeave={p.onLeave}
      onFocus={p.onEnter}
      onBlur={p.onLeave}
      onClick={p.onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); p.onClick?.(); } }}
      role="button"
      tabIndex={p.atenuado ? -1 : 0}
      aria-label={p.aria ?? p.label}
    >
      {p.foco || p.resalta || activo ? (
        <circle cx={p.x} cy={p.y} r={rr + (p.foco ? 7 : activo ? 5 : 4) * inv} className={`${c.halo} pointer-events-none`} />
      ) : null}
      {p.selected && (
        <circle cx={p.x} cy={p.y} r={rr + 3.5 * inv} className="fill-none stroke-ink pointer-events-none" strokeWidth={1.2 * inv} />
      )}
      {p.punteado && (
        <circle cx={p.x} cy={p.y} r={rr + 2.5 * inv} className={`fill-none ${c.borde} pointer-events-none`} strokeWidth={1 * inv} strokeOpacity={0.9} strokeDasharray={`${2.4 * inv} ${2.4 * inv}`} />
      )}
      <circle className={`grafo-nodo-circulo ${c.cuerpo} ${c.borde}`} cx={p.x} cy={p.y} r={rr} strokeWidth={1.3 * inv} />
      {p.label && (p.anguloEtiqueta != null ? (
        <g transform={`translate(${p.x} ${p.y}) rotate(${p.anguloEtiqueta})`} className="pointer-events-none">
          <text
            transform={`translate(${rr + 4 * inv} 0)${Math.cos((p.anguloEtiqueta * Math.PI) / 180) < 0 ? " rotate(180)" : ""}`}
            y={(p.fontSize ?? 9) * inv * 0.32}
            textAnchor={Math.cos((p.anguloEtiqueta * Math.PI) / 180) < 0 ? "end" : "start"}
            className={activo ? "fill-ink font-semibold" : "fill-inkSoft"}
            style={{ fontSize: `${(p.fontSize ?? 9) * inv}px` }}
          >
            {p.label}
          </text>
        </g>
      ) : (
        <text
          x={p.x + lx}
          y={p.y + 1 * inv}
          textAnchor={anchor}
          className={`pointer-events-none ${activo ? "fill-ink font-semibold" : "fill-inkSoft"}`}
          style={{ fontSize: `${(p.fontSize ?? 9) * inv}px` }}
        >
          {p.label}
        </text>
      ))}
    </g>
  );
}

/** Nodo central del grafo (El Estado / Gobierno Nacional): núcleo con una o dos líneas de texto. */
export function NodoCentro({ x, y, k = 1, lineas, onClick, aria, fontSize = 7 }: { x: number; y: number; k?: number; lineas: string[]; onClick?: () => void; aria?: string; fontSize?: number }) {
  const inv = 1 / k;
  // El círculo crece con su texto (la línea más larga y cuántas son), para que el nombre no se salga.
  const largo = Math.max(1, ...lineas.map((l) => l.length));
  const r = Math.max(16, largo * fontSize * 0.3 + fontSize * 0.8, lineas.length * fontSize * 0.95) * inv;
  return (
    <g className="cursor-pointer" onClick={onClick} role="button" tabIndex={-1} aria-label={aria}>
      <circle cx={x} cy={y} r={r + 4 * inv} className="fill-granate/15 pointer-events-none" />
      <circle cx={x} cy={y} r={r} className="fill-paperSoft stroke-ink" strokeWidth={1.6 * inv} />
      {lineas.map((t, i) => (
        <text key={i} x={x} y={y + (i - (lineas.length - 1) / 2) * fontSize * 1.05 * inv + fontSize * 0.35 * inv} textAnchor="middle" className="pointer-events-none fill-ink font-semibold" style={{ fontSize: `${fontSize * inv}px` }}>
          {t}
        </text>
      ))}
    </g>
  );
}

/** Una arista. `flujo` la resalta (la rama abierta): más gruesa, quieta. */
export function Arista({ x1, y1, x2, y2, tono, opacity = 0.4, k = 1, flujo }: { x1: number; y1: number; x2: number; y2: number; tono: Tono; opacity?: number; k?: number; flujo?: boolean }) {
  const c = TONO[tono];
  return (
    <line
      x1={x1} y1={y1} x2={x2} y2={y2}
      className={c.arista}
      strokeWidth={(flujo ? 1.6 : 1) / k}
      strokeOpacity={opacity}
      strokeLinecap="round"
    />
  );
}

/* ── Marco y paneles ─────────────────────────────────────────────────────── */

/** La caja de primer nivel de un grafo: una tarjeta. Lo de adentro (lienzo, panel) va sin marco propio. */
export function GrafoSeccion({ children }: { children: ReactNode }) {
  return <section className="tarjeta space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">{children}</section>;
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

/** Separador de migas: el mismo chevrón de `Migas` (un ícono dibujado, no un glifo). */
export function MigaSep() {
  return <ChevronRight size={14} className="shrink-0 text-mute" aria-hidden />;
}

export function GrafoColumnas({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">{children}</div>;
}

/**
 * El lienzo del grafo. Fuera de una tarjeta, con su marco; dentro de una (`GrafoSeccion`), sólo el fondo apenas hundido.
 * overflow-x-auto (no -hidden): en móvil el SVG de min-w ~520px se desplaza en vez de recortarse; el auto-zoom sigue
 * encuadrando porque el propio <svg> recorta lo que sale de su viewBox.
 */
export function GrafoMarco({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-fondo/40 [.tarjeta_&]:border-0 [.tarjeta_&]:bg-paperSoft">
      {children}
    </div>
  );
}

/**
 * El panel junto al grafo. Dentro de una tarjeta no es otra caja: una raya lo separa del lienzo (arriba en el celular,
 * a la izquierda desde lg).
 */
export function GrafoAside({ children }: { children: ReactNode }) {
  return (
    <aside
      className={
        "rounded-xl border border-line bg-paperSoft/50 p-4 " +
        "[.tarjeta_&]:rounded-none [.tarjeta_&]:border-x-0 [.tarjeta_&]:border-b-0 [.tarjeta_&]:bg-transparent [.tarjeta_&]:p-0 [.tarjeta_&]:pt-4 " +
        "lg:[.tarjeta_&]:border-l lg:[.tarjeta_&]:border-t-0 lg:[.tarjeta_&]:pl-4 lg:[.tarjeta_&]:pt-0"
      }
    >
      {children}
    </aside>
  );
}

/** La acción del panel: la píldora primaria del sitio (como `Button`). */
export function BotonFicha({ onClick, children = "Ver ficha completa" }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-full bg-granate px-4 py-2 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2"
    >
      {children}
    </button>
  );
}

/** Cerrar un detalle: el ícono X de lucide (no el glifo «✕»), con su nombre para el lector de pantalla. */
export function BotonCerrar({ onClick, etiqueta = "Cerrar detalle" }: { onClick: () => void; etiqueta?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
    >
      <X size={16} aria-hidden />
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
