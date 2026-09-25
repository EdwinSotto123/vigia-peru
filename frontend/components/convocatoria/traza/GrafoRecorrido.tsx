"use client";

/**
 * El recorrido del análisis como grafo: cada paso es una tarjeta y las flechas dicen qué paso
 * espera a cuál. Sin librería de grafos: la disposición la hace CSS (grid con container queries,
 * así se acomoda al ancho de la columna y no de la pantalla) y las flechas se dibujan en un SVG
 * encima, midiendo dónde quedó cada tarjeta. Con la columna ancha, las tres ramas van lado a
 * lado; angosta (celular), van una debajo de otra colgando de una línea común —el reparto del
 * coordinador— que baja hasta donde se juntan, y la síntesis baja en una sola columna.
 *
 * Tocar una tarjeta abre su panel (DetalleNodo): qué recibió, qué hizo, qué entregó. Pasar por
 * encima o enfocar con el teclado resalta sus flechas.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ClipboardCheck, Bot, Cog, Sparkles, Wrench } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { irAPestana } from "@/components/patrones/Pestanas";
import { cn } from "@/lib/utils";
import type { ApiResult } from "../types";
import { CifrasNodo, ICONO_TIPO } from "./BloquesNodo";
import { DetalleNodo } from "./DetalleNodo";
import { GRUPOS_PARALELOS, SINTESIS, type GrupoParalelo, type NodoTraza, type Recorrido } from "./modelo";
import { resumenCorto } from "./nodos";
import { TextoSeguro } from "./redaccion";

type Caja = { l: number; t: number; r: number; b: number; w: number; h: number; cx: number; cy: number };
interface Arista {
  id: string;
  de: string;
  a: string;
  d: string;
  flecha: boolean;
  punteada: boolean;
}

const CAJA_DE: Record<string, string> = Object.fromEntries(
  Object.entries(GRUPOS_PARALELOS).flatMap(([g, ks]) => ks.map((k) => [k, `g-${g}`])),
);

const CADENA: [string, string][] = [
  ["document_parser", "g-expediente"],
  ["proveedor", "g-proveedor"],
  ["union", "person_network"],
  ...SINTESIS.slice(1).map((k, i) => [SINTESIS[i], k] as [string, string]),
];
/** Con la columna ancha: el registro reparte a las tres ramas y las tres bajan a la unión. */
const ARISTAS_ANCHO: [string, string][] = [
  ["ocds", "compliance"],
  ["ocds", "document_parser"],
  ["ocds", "proveedor"],
  ["compliance", "union"],
  ["g-expediente", "union"],
  ["g-proveedor", "union"],
  ...CADENA,
];
const RAICES = ["compliance", "document_parser", "proveedor"];
/** El ancho de columna desde el que las ramas van lado a lado (44rem, el mismo corte del CSS). */
const ANCHO_RAMAS = 704;
/** Dónde corre la línea común en la vista angosta (px desde el borde izquierdo del lienzo). */
const X_BUS = 7;

const limitar = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** La curva de una flecha: hacia abajo (tangentes verticales) o hacia la derecha (horizontales). */
function camino(s: Caja, d: Caja): string {
  if (d.t >= s.b - 1) {
    // Desde una caja ancha (el registro, la barra de unión) la flecha sale a la altura del destino.
    const sx = s.w > d.w * 1.4 ? limitar(d.cx, s.l + 14, s.r - 14) : s.cx;
    const tx = d.w > s.w * 1.4 ? limitar(sx, d.l + 14, d.r - 14) : d.cx;
    const my = (s.b + d.t) / 2;
    return `M${sx},${s.b} C${sx},${my} ${tx},${my} ${tx},${d.t}`;
  }
  if (d.l >= s.r - 1) {
    const mx = (s.r + d.l) / 2;
    return `M${s.r},${s.cy} C${mx},${s.cy} ${mx},${d.cy} ${d.l},${d.cy}`;
  }
  return `M${s.cx},${s.b} C${s.cx},${s.b + 40} ${d.cx},${d.t - 40} ${d.cx},${d.t}`;
}

export function GrafoRecorrido({ recorrido, result }: { recorrido: Recorrido; result: ApiResult }) {
  const lienzo = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, "");
  const [aristas, setAristas] = useState<Arista[]>([]);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  const [sel, setSel] = useState<string | null>(null);
  // El panel sigue mostrando el último nodo mientras se cierra (la animación de salida).
  const [visto, setVisto] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null);

  const corrio = useCallback(
    (id: string) => {
      const ks = id.startsWith("g-") ? GRUPOS_PARALELOS[id.slice(2) as GrupoParalelo] ?? [] : id === "union" ? ["person_network"] : [id];
      return ks.some((k) => ["corrio", "fallo"].includes(recorrido.porClave[k]?.estado ?? ""));
    },
    [recorrido],
  );

  useLayoutEffect(() => {
    const el = lienzo.current;
    if (!el) return;
    const medir = () => {
      const base = el.getBoundingClientRect();
      if (!base.width) return; // la pestaña está oculta: se mide al mostrarse (ResizeObserver)
      const caja = (id: string): Caja | null => {
        const n = el.querySelector<HTMLElement>(`[data-nodo="${id}"]`);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        const l = r.left - base.left;
        const t = r.top - base.top;
        return { l, t, r: l + r.width, b: t + r.height, w: r.width, h: r.height, cx: l + r.width / 2, cy: t + r.height / 2 };
      };
      const out: Arista[] = [];
      const ancho = base.width >= ANCHO_RAMAS;
      for (const [de, a] of ancho ? ARISTAS_ANCHO : CADENA) {
        const s = caja(de);
        const d = caja(a);
        if (!s || !d) continue;
        out.push({ id: `${de}>${a}`, de, a, d: camino(s, d), flecha: a !== "union", punteada: !corrio(de) || !corrio(a) });
      }
      if (!ancho) {
        // Vista angosta: una línea común baja del registro a la unión y de ella cuelga cada rama.
        const o = caja("ocds");
        const u = caja("union");
        if (o && u) {
          out.push({ id: "bus", de: "ocds", a: "union", d: `M${X_BUS},${o.b} L${X_BUS},${u.cy}`, flecha: false, punteada: false });
          for (const k of RAICES) {
            const r = caja(k);
            if (r) out.push({ id: `bus>${k}`, de: "ocds", a: k, d: `M${X_BUS},${r.cy} L${r.l},${r.cy}`, flecha: true, punteada: !corrio(k) });
          }
        }
      }
      setAristas(out);
      setTam({ w: base.width, h: base.height });
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    // Las fuentes web cambian el alto de las tarjetas al terminar de cargar.
    document.fonts?.ready.then(medir).catch(() => {});
    return () => ro.disconnect();
  }, [corrio]);

  useEffect(() => {
    if (sel) setVisto(sel);
  }, [sel]);

  const activo = sel ?? foco;
  const tocaA = (x: Arista) => {
    if (!activo) return false;
    const propias = new Set([activo, CAJA_DE[activo]].filter(Boolean));
    if (activo === "person_network" && x.a === "union") return true;
    return propias.has(x.de) || propias.has(x.a);
  };

  const nodo = visto ? recorrido.porClave[visto] : null;
  const verControles = () => {
    setSel(null);
    window.setTimeout(() => irAPestana("controles", "traza"), 220);
  };

  const tarjeta = (clave: string, className?: string) => {
    const n = recorrido.porClave[clave];
    return n ? (
      <NodoGrafo
        key={clave}
        nodo={n}
        resumen={resumenCorto(n, recorrido, result)}
        seleccionado={sel === clave}
        onElegir={() => setSel(clave)}
        onFoco={(v) => setFoco(v ? clave : null)}
        className={className}
      />
    ) : null;
  };
  const grupo = (g: GrupoParalelo) => (
    <div data-nodo={`g-${g}`} className="relative rounded-2xl border border-dashed border-paperEdge bg-paperSoft/70 p-1 pt-6">
      <span className="absolute left-2.5 top-1.5 text-[11px] font-medium text-mute">{recorrido.paralelo[g] ? "A la vez" : "Después, uno tras otro"}</span>
      <div className="grid grid-cols-2 gap-1 [@container(min-width:44rem)]:flex">
        {GRUPOS_PARALELOS[g].map((k) => tarjeta(k, "[@container(min-width:44rem)]:flex-1"))}
      </div>
    </div>
  );
  /** Una rama: en la vista angosta lleva su nombre arriba (en la ancha lo dicen las columnas). */
  const rama = (titulo: string, children: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-8">
      <span className="-mb-6 text-[12px] font-semibold text-inkSoft [@container(min-width:44rem)]:hidden">Rama: {titulo}</span>
      {children}
    </div>
  );

  const hayTenues = recorrido.nodos.some((n) => n.estado === "sin_rastro" || n.estado === "omitido");

  return (
    <figure className="rounded-2xl border border-line bg-paper p-3 sm:p-4">
      <div ref={lienzo} className="relative [container-type:inline-size]">
        <svg aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible" width={tam.w} height={tam.h}>
          <defs>
            <marker id={`${uid}-f`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L8,4 L0,8 z" className="fill-mute" />
            </marker>
            <marker id={`${uid}-fa`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L8,4 L0,8 z" className="fill-granate" />
            </marker>
          </defs>
          {aristas.map((x) => {
            const on = tocaA(x);
            return (
              <path
                key={x.id}
                d={x.d}
                fill="none"
                strokeWidth={on ? 2 : 1.25}
                strokeDasharray={x.punteada ? "4 4" : undefined}
                markerEnd={x.flecha ? `url(#${uid}-${on ? "fa" : "f"})` : undefined}
                className={cn("transition-[stroke,opacity] duration-rapido", on ? "stroke-granate" : "stroke-mute", activo && !on ? "opacity-25" : "opacity-60")}
              />
            );
          })}
        </svg>

        <div className="relative flex flex-col gap-8">
          <div className="w-full [@container(min-width:44rem)]:mx-auto [@container(min-width:44rem)]:max-w-[18rem]">{tarjeta("ocds")}</div>

          <div className="relative">
            <Etiqueta className="-top-6 hidden [@container(min-width:44rem)]:block">{recorrido.paralelo.ramas ? "Tres ramas a la vez" : "Tres ramas"}</Etiqueta>
            <span className="-mt-4 mb-4 block pl-6 text-[11px] font-medium text-mute [@container(min-width:44rem)]:hidden">
              {recorrido.paralelo.ramas ? "Tres ramas a la vez" : "Tres ramas"}
            </span>
            <div className="grid gap-8 pl-6 [@container(min-width:44rem)]:grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)_minmax(0,3.2fr)] [@container(min-width:44rem)]:items-start [@container(min-width:44rem)]:gap-3 [@container(min-width:44rem)]:pl-0">
              {rama("Reglas", tarjeta("compliance"))}
              {rama(
                "Expediente",
                <>
                  {tarjeta("document_parser", "[@container(min-width:44rem)]:mx-auto [@container(min-width:44rem)]:max-w-[15rem]")}
                  {grupo("expediente")}
                </>,
              )}
              {rama(
                "Proveedor",
                <>
                  {tarjeta("proveedor", "[@container(min-width:44rem)]:mx-auto [@container(min-width:44rem)]:max-w-[15rem]")}
                  {grupo("proveedor")}
                </>,
              )}
            </div>
          </div>

          <div data-nodo="union" className="relative h-px bg-mute/40 [@container(min-width:44rem)]:mx-2">
            <Etiqueta className="top-1/2 -translate-y-1/2">Se juntan las tres ramas</Etiqueta>
          </div>

          <ol className="grid gap-8 [@container(min-width:30rem)]:grid-cols-3 [@container(min-width:30rem)]:gap-x-7 [@container(min-width:62rem)]:grid-cols-6">
            {SINTESIS.map((k) => (
              <li key={k} className="min-w-0">
                {tarjeta(k)}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <figcaption className="mt-4 border-t border-line pt-3 text-[12px] text-mute">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Leyenda icono={<Bot size={12} aria-hidden />}>Agente de IA</Leyenda>
          <Leyenda icono={<Cog size={12} aria-hidden />}>Código del coordinador, sin IA</Leyenda>
          <Leyenda icono={<ClipboardCheck size={12} aria-hidden />}>Control de calidad</Leyenda>
          <Leyenda icono={<Sparkles size={12} aria-hidden />}>Llamadas al modelo</Leyenda>
          <Leyenda icono={<Wrench size={12} aria-hidden />}>Consultas a herramientas</Leyenda>
          {hayTenues && <Leyenda icono={<span className="inline-block h-3 w-4 rounded border border-dashed border-mute" aria-hidden />}>Sin registro o no aplicó</Leyenda>}
        </span>
        <span className="mt-1.5 block">Las flechas dicen qué paso espera a cuál. Toca un paso para ver qué recibió, qué hizo y qué entregó.</span>
      </figcaption>

      <Panel abierto={!!sel} onCerrar={() => setSel(null)} titulo={nodo?.titulo ?? ""} descripcion={nodo?.que} ancho="lg">
        {nodo && <DetalleNodo key={nodo.clave} nodo={nodo} recorrido={recorrido} result={result} onIr={setSel} onVerControles={verControles} />}
      </Panel>
    </figure>
  );
}

function Etiqueta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("pointer-events-none absolute left-1/2 z-[1] -translate-x-1/2 whitespace-nowrap bg-paper px-2 text-[11px] font-medium text-mute", className)}>
      {children}
    </span>
  );
}

function Leyenda({ icono, children }: { icono: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icono}
      {children}
    </span>
  );
}

function NodoGrafo({
  nodo,
  resumen,
  seleccionado,
  onElegir,
  onFoco,
  className,
}: {
  nodo: NodoTraza;
  resumen: string;
  seleccionado: boolean;
  onElegir: () => void;
  onFoco: (on: boolean) => void;
  className?: string;
}) {
  const Icono = ICONO_TIPO[nodo.tipo];
  const tenue = nodo.estado === "sin_rastro" || nodo.estado === "omitido";
  return (
    <button
      type="button"
      data-nodo={nodo.clave}
      onClick={onElegir}
      onMouseEnter={() => onFoco(true)}
      onMouseLeave={() => onFoco(false)}
      onFocus={() => onFoco(true)}
      onBlur={() => onFoco(false)}
      aria-haspopup="dialog"
      aria-label={`${nodo.nombre}: ${resumen}. Ver qué recibió, qué hizo y qué entregó`}
      className={cn(
        "relative flex min-h-[4.75rem] w-full min-w-0 flex-col rounded-xl border px-2 py-2 text-left transition-colors duration-rapido",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-1",
        tenue
          ? "border-dashed border-paperEdge bg-paperSoft hover:border-mute"
          : nodo.estado === "fallo"
            ? "border-crimson/40 bg-crimson-soft/60 hover:border-crimson"
            : cn("border-line hover:border-granate/50 hover:shadow-card", nodo.tipo === "agente" ? "bg-paper" : "bg-paperSoft"),
        seleccionado && "border-granate ring-1 ring-granate",
        className,
      )}
    >
      <span className="flex min-w-0 items-start gap-1.5">
        <Icono size={13} className={cn("mt-px shrink-0", tenue ? "text-mute" : "text-inkSoft")} aria-hidden />
        <span className={cn("min-w-0 hyphens-auto text-[12.5px] font-semibold leading-tight", tenue ? "text-mute" : "text-ink")}>{nodo.nombre}</span>
      </span>
      <span className={cn("mt-1 line-clamp-3 text-[12px] leading-snug", tenue ? "text-mute" : "text-inkSoft")}>
        <TextoSeguro texto={resumen} plano />
      </span>
      <CifrasNodo nodo={nodo} className="mt-auto pt-1.5" />
    </button>
  );
}
