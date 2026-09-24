"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Ban,
  Building2,
  ChevronDown,
  Combine,
  DoorOpen,
  Eraser,
  FileCheck2,
  FilePen,
  FileSpreadsheet,
  FileText,
  Globe,
  HandCoins,
  Landmark,
  Network,
  RefreshCw,
  Scale,
  ScrollText,
  ShieldAlert,
  UserSearch,
  Users,
  Vote,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FUENTES_FLUJO, RESULTADOS, type FuenteFlujo, type Resultado, type ResultadoClave } from "./fuentesFlujo";
import { Visual } from "./ExploradorVisual";

/**
 * De dónde saca Vigía los datos, qué hace con ellos y qué termina produciendo:
 * FUENTES → VIGÍA → RESULTADOS, como un mapa que se puede tocar.
 *
 * Es para cualquier persona, no para quien programa: al tocar una fuente, ESE
 * nodo se abre y cuenta en palabras qué es, dónde está, en qué llega (Excel,
 * CSV, datos en línea), cada cuánto se actualiza, qué se toma de ella y para
 * qué sirve. Al tocar un resultado, se abre con lo que se obtiene y, cuando la
 * portada tiene la cifra, un gráfico con datos reales. Sin código, sin nombres
 * de columnas ni de tablas: eso quedó en `fuentesFlujoTecnico.ts` para quien lo
 * quiera verificar, y este componente no lo importa (no viaja al navegador).
 *
 * Los caminos que se encienden son los reales (`alimenta`, verificado contra
 * quién lee cada dato). Las fuentes que nadie usa todavía llegan a Vigía con
 * línea punteada y no siguen. Las curvas se miden contra la posición real de
 * cada nodo, así que siguen calzando cuando un nodo se abre. En pantallas
 * angostas el mapa es un flujo vertical sin curvas.
 */

/** Cifras reales de la portada (mismo API que el resto de la página). Nulas = no se dibuja el gráfico. */
export interface CifrasFlujo {
  publicados: number | null;
  /** Contratos con análisis: publicados, en revisión o revisados y no publicados. */
  leidos: number | null;
  /** Los tipos más comunes y, con `resto`, lo que falta para sumar `publicados`. */
  porTipo: { etiqueta: string; n: number; resto?: boolean }[] | null;
  /** Suma `leidos`: cada contrato leído cae en uno de estos grupos. */
  porRiesgo: { alto: number; medio: number; bajo: number; enRevision: number; descartado: number } | null;
  regiones: { nombre: string; n: number }[] | null;
}

const ICONO_FUENTE: Record<string, LucideIcon> = {
  seace: FileText,
  rnp: Users,
  sancionados: Ban,
  visitas: DoorOpen,
  onpe: HandCoins,
  jne: Vote,
  mef: Wallet,
  dji: FilePen,
  "datasets-oece": Archive,
};

const ICONO_RESULTADO: Record<ResultadoClave, LucideIcon> = {
  contratos: ScrollText,
  entidades: Landmark,
  proveedores: Building2,
  personas: UserSearch,
  relaciones: Network,
  senales: ShieldAlert,
  informe: FileCheck2,
};

const ICONO_FORMATO: Record<FuenteFlujo["formato"], LucideIcon> = {
  "En línea": Globe,
  Excel: FileSpreadsheet,
  CSV: FileSpreadsheet,
  Varios: Archive,
};

/** Primero las que alguien usa; al final las que todavía no llegan a ningún resultado. */
const FUENTES = [...FUENTES_FLUJO].sort((a, b) => Number(b.alimenta.length > 0) - Number(a.alimenta.length > 0));

type Seleccion = { tipo: "fuente"; clave: string } | { tipo: "resultado"; clave: ResultadoClave } | { tipo: "vigia" } | null;
type Eleccion = Exclude<Seleccion, null>;

const claveDe = (s: Seleccion) => (!s ? "nada" : s.tipo === "vigia" ? "vigia" : `${s.tipo}:${s.clave}`);
const fuentesDe = (r: ResultadoClave) => FUENTES.filter((f) => f.alimenta.includes(r));

/** Qué se enciende. Sin selección, todo lo que funciona fluye tenue. */
function encendidos(sel: Seleccion): { fuentes: Set<string>; resultados: Set<ResultadoClave>; fuerte: boolean } {
  if (!sel || sel.tipo === "vigia") {
    return {
      fuentes: new Set(FUENTES.filter((f) => f.alimenta.length > 0).map((f) => f.clave)),
      resultados: new Set(RESULTADOS.map((r) => r.clave)),
      fuerte: !!sel,
    };
  }
  if (sel.tipo === "fuente") {
    const f = FUENTES.find((x) => x.clave === sel.clave)!;
    return { fuentes: new Set([f.clave]), resultados: new Set(f.alimenta), fuerte: true };
  }
  return { fuentes: new Set(fuentesDe(sel.clave).map((f) => f.clave)), resultados: new Set([sel.clave]), fuerte: true };
}

type Punto = { x: number; y: number };
type Geometria = {
  w: number;
  h: number;
  fuentes: Record<string, Punto>;
  resultados: Record<string, Punto>;
  entradas: Record<string, Punto>;
  salidas: Record<string, Punto>;
};

export function ExploradorFuentes({ cifras }: { cifras: CifrasFlujo | null }) {
  const [sel, setSel] = useState<Seleccion>(null);
  const [geo, setGeo] = useState<Geometria | null>(null);
  const lienzo = useRef<HTMLDivElement>(null);
  const vigia = useRef<HTMLButtonElement>(null);
  const nodos = useRef<Record<string, HTMLElement | null>>({});
  const on = encendidos(sel);
  const clave = claveDe(sel);

  // ── Geometría de las curvas, medida contra la fila de título de cada nodo.
  const medir = useCallback(() => {
    const c = lienzo.current;
    const v = vigia.current;
    if (!c || !v || window.innerWidth < 1024) {
      setGeo(null);
      return;
    }
    const rc = c.getBoundingClientRect();
    const rv = v.getBoundingClientRect();
    const centro = { x: rv.left + rv.width / 2 - rc.left, y: rv.top + rv.height / 2 - rc.top };
    const radio = rv.width / 2 - 1;
    const enArco = (grados: number) => {
      const a = (grados * Math.PI) / 180;
      return { x: centro.x + radio * Math.cos(a), y: centro.y + radio * Math.sin(a) };
    };
    const borde = (el: HTMLElement | null | undefined, lado: "izq" | "der") => {
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      return { x: (lado === "der" ? r.right : r.left) - rc.left, y: r.top + r.height / 2 - rc.top };
    };
    const g: Geometria = { w: rc.width, h: rc.height, fuentes: {}, resultados: {}, entradas: {}, salidas: {} };
    // Las fuentes entran por el arco izquierdo de Vigía (de arriba abajo) y
    // los resultados salen por el derecho: así las curvas no se cruzan.
    FUENTES.forEach((f, i) => {
      g.fuentes[f.clave] = borde(nodos.current[`fuente:${f.clave}`], "der");
      g.entradas[f.clave] = enArco(180 + 50 - (100 * i) / Math.max(1, FUENTES.length - 1));
    });
    RESULTADOS.forEach((r, i) => {
      g.resultados[r.clave] = borde(nodos.current[`resultado:${r.clave}`], "izq");
      g.salidas[r.clave] = enArco(-45 + (90 * i) / Math.max(1, RESULTADOS.length - 1));
    });
    setGeo(g);
  }, []);

  useEffect(() => {
    const c = lienzo.current;
    if (!c) return;
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(c);
    c.querySelectorAll("ul").forEach((ul) => ro.observe(ul));
    document.fonts?.ready.then(medir).catch(() => {});
    return () => ro.disconnect();
  }, [medir]);

  // Al abrir o cerrar un nodo cambia la altura de su columna: se vuelve a medir.
  useEffect(() => {
    const id = requestAnimationFrame(medir);
    return () => cancelAnimationFrame(id);
  }, [clave, medir]);

  /** Tocar un nodo lo abre; tocarlo de nuevo lo cierra. */
  const alternar = (s: Eleccion) => setSel((actual) => (claveDe(actual) === claveDe(s) ? null : s));

  /**
   * Saltar desde una ficha a otro nodo: se abre y, si quedó fuera de la
   * pantalla, se lo trae. La ficha tocada desaparece al cerrarse su nodo y el
   * foco caía al <body>: se lo lleva al botón de cabecera del nodo de destino.
   */
  const ir = (s: Eleccion) => {
    setSel(s);
    requestAnimationFrame(() => {
      const el = s.tipo === "vigia" ? vigia.current : nodos.current[`${s.tipo}:${s.clave}`];
      if (!el) return;
      el.focus({ preventScroll: true });
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const estadoDe = (abierto: boolean, encendido: boolean) =>
    abierto ? "abierto" : encendido ? (sel ? "encendido" : "reposo") : sel ? "apagado" : "reposo";

  return (
    <div className="mt-8 overflow-hidden rounded-2xl bg-ink text-paper shadow-paper">
      <div
        ref={lienzo}
        className="relative grid gap-4 p-5 sm:p-7 lg:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)_minmax(0,17.5rem)] lg:gap-0 lg:px-10 lg:py-9 xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)_minmax(0,19rem)]"
      >
        {geo && <Trazos geo={geo} on={on} />}

        {/* ── Fuentes ── */}
        <div className="relative">
          <p className="mb-3 text-[12px] font-medium text-paper/50">Fuentes públicas</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-col">
            {FUENTES.map((f) => {
              const abierto = sel?.tipo === "fuente" && sel.clave === f.clave;
              return (
                <li key={f.clave} className={cn(abierto && "col-span-2 sm:col-span-3")}>
                  <Nodo
                    refCabeza={(el) => {
                      nodos.current[`fuente:${f.clave}`] = el;
                    }}
                    Icono={ICONO_FUENTE[f.clave] ?? FileText}
                    titulo={f.corto}
                    estado={estadoDe(abierto, on.fuentes.has(f.clave))}
                    punteado={f.alimenta.length === 0}
                    onClick={() => alternar({ tipo: "fuente", clave: f.clave })}
                  >
                    <DetalleFuente f={f} ir={ir} />
                  </Nodo>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ── Vigía ──
            Anclado arriba y no centrado: al abrir una fuente su columna crece
            hacia abajo, y centrado, Vigía y los resultados bajaban con ella.
            9,5 rem ≈ lo que lo centra contra las fuentes cerradas (medido). */}
        <div className="relative flex flex-col items-center justify-center gap-3 py-2 lg:justify-start lg:py-0 lg:pt-[9.5rem]">
          <ArrowDown size={18} className="text-paper/30 lg:hidden" aria-hidden />
          <NodoVigia refNodo={vigia} elegido={sel?.tipo === "vigia"} onClick={() => alternar({ tipo: "vigia" })} />
          <p className="max-w-[15rem] text-center text-[12px] leading-snug text-paper/45">Toca una fuente o un resultado para ver qué hay detrás.</p>
          <ArrowDown size={18} className="text-paper/30 lg:hidden" aria-hidden />
        </div>

        {/* ── Resultados ── */}
        <div className="relative lg:pt-[3.25rem]">
          <p className="mb-3 text-[12px] font-medium text-paper/50">Lo que obtiene</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-col lg:gap-2.5">
            {RESULTADOS.map((r) => {
              const abierto = sel?.tipo === "resultado" && sel.clave === r.clave;
              return (
                <li key={r.clave} className={cn(abierto && "col-span-2 sm:col-span-3")}>
                  <Nodo
                    refCabeza={(el) => {
                      nodos.current[`resultado:${r.clave}`] = el;
                    }}
                    Icono={ICONO_RESULTADO[r.clave]}
                    titulo={r.nombre}
                    estado={estadoDe(abierto, on.resultados.has(r.clave))}
                    onClick={() => alternar({ tipo: "resultado", clave: r.clave })}
                  >
                    <DetalleResultado r={r} cifras={cifras} ir={ir} />
                  </Nodo>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Vigía es un círculo: lo que hace se cuenta en una franja debajo del mapa. */}
      {sel?.tipo === "vigia" && (
        <div className="border-t border-paper/10 p-5 motion-safe:animate-fadeIn sm:p-7">
          <QueHaceVigia />
        </div>
      )}
    </div>
  );
}

// ── Las curvas ────────────────────────────────────────────────────────────

function curva(a: Punto, b: Punto) {
  const dx = Math.max(36, (b.x - a.x) * 0.5);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}

function Trazos({ geo, on }: { geo: Geometria; on: ReturnType<typeof encendidos> }) {
  return (
    <svg className="pointer-events-none absolute inset-0 hidden lg:block" width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} aria-hidden>
      {FUENTES.map((f) => (
        <Trazo
          key={f.clave}
          d={curva(geo.fuentes[f.clave], geo.entradas[f.clave])}
          encendido={on.fuentes.has(f.clave)}
          fuerte={on.fuerte}
          tono={f.estado === "caida" ? "ambar" : "verde"}
          punteado={f.alimenta.length === 0}
        />
      ))}
      {RESULTADOS.map((r) => (
        <Trazo key={r.clave} d={curva(geo.salidas[r.clave], geo.resultados[r.clave])} encendido={on.resultados.has(r.clave)} fuerte={on.fuerte} tono="verde" />
      ))}
    </svg>
  );
}

/**
 * Un camino. Encendido corre un trazo discontinuo hacia adelante (período 16,
 * el del keyframe `fluirDatos`: el bucle no tiene costura). Sin nada elegido
 * todo lo que funciona fluye tenue; al elegir, lo elegido fluye fuerte y el
 * resto se apaga. Las fuentes que nadie usa son punteadas y nunca fluyen.
 */
function Trazo({ d, encendido, fuerte, tono, punteado }: { d: string; encendido: boolean; fuerte: boolean; tono: "verde" | "ambar"; punteado?: boolean }) {
  const color = tono === "ambar" ? "stroke-amber" : "stroke-heroGreen";
  return (
    <g>
      <path d={d} fill="none" strokeWidth={1.2} strokeDasharray={punteado ? "2 5" : undefined} className="stroke-paper/[0.12]" />
      {encendido && !punteado && (
        <>
          {fuerte && <path d={d} fill="none" strokeWidth={6} className={cn(color, "opacity-[0.14]")} />}
          <path
            d={d}
            fill="none"
            strokeWidth={fuerte ? 1.7 : 1.2}
            strokeDasharray="6 10"
            strokeLinecap="round"
            className={cn(color, fuerte ? "opacity-100" : "opacity-40", "motion-safe:animate-fluirDatos")}
          />
        </>
      )}
    </g>
  );
}

// ── Los nodos ─────────────────────────────────────────────────────────────

/**
 * Un nodo que se abre en su lugar. La cabecera es el botón (y el ancla de la
 * curva); lo que se abre va FUERA del botón porque trae enlaces y fichas que
 * también se tocan, y un botón no puede tener otros adentro.
 */
function Nodo({
  refCabeza,
  Icono,
  titulo,
  estado,
  punteado,
  onClick,
  children,
}: {
  refCabeza: (el: HTMLButtonElement | null) => void;
  Icono: LucideIcon;
  titulo: string;
  estado: "abierto" | "encendido" | "apagado" | "reposo";
  punteado?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const abierto = estado === "abierto";
  return (
    <div
      className={cn(
        "h-full overflow-hidden rounded-xl border bg-[#191D21] transition-[border-color,opacity,box-shadow] duration-normal",
        punteado && "border-dashed",
        abierto && "border-heroGreen bg-[#15201A] shadow-[0_0_0_3px_rgba(47,168,76,0.14)]",
        estado === "encendido" && "border-paper/30",
        estado === "reposo" && "border-paper/15",
        estado === "apagado" && "border-paper/10 opacity-50 hover:opacity-90",
      )}
    >
      <button
        ref={refCabeza}
        type="button"
        onClick={onClick}
        aria-expanded={abierto}
        className="flex w-full items-center gap-2 px-2.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-heroGreen sm:gap-2.5"
      >
        <span
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors duration-normal",
            abierto ? "bg-heroGreen/20 text-heroGreen" : estado === "apagado" ? "bg-paper/[0.06] text-paper/60" : "bg-paper/10 text-paper",
          )}
        >
          <Icono size={15} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-[13.5px] font-semibold leading-tight">{titulo}</span>
        <ChevronDown size={15} className={cn("shrink-0 text-paper/40 transition-transform duration-normal", abierto && "rotate-180 text-heroGreen")} aria-hidden />
      </button>
      {abierto && <div className="border-t border-paper/10 px-3.5 pb-4 pt-3 motion-safe:animate-fadeIn">{children}</div>}
    </div>
  );
}

function NodoVigia({ refNodo, elegido, onClick }: { refNodo: React.RefObject<HTMLButtonElement>; elegido: boolean; onClick: () => void }) {
  return (
    <button
      ref={refNodo}
      type="button"
      onClick={onClick}
      aria-expanded={elegido}
      className={cn(
        "relative grid h-44 w-44 shrink-0 place-items-center rounded-full border-2 bg-[radial-gradient(circle_at_50%_30%,#3a2a74_0%,#231a45_55%,#15131f_100%)] transition-[border-color,box-shadow] duration-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroGreen focus-visible:ring-offset-4 focus-visible:ring-offset-ink lg:h-48 lg:w-48",
        elegido ? "border-heroGreen shadow-[0_0_0_6px_rgba(47,168,76,0.16)]" : "border-heroGreen/45 hover:border-heroGreen/80",
      )}
    >
      <span aria-hidden className="absolute inset-0 rounded-full border border-heroGreen/40 motion-safe:animate-latidoNodo" />
      <span aria-hidden className="absolute -inset-3 rounded-full border border-dashed border-paper/15 motion-safe:animate-[spin_48s_linear_infinite]" />
      <span className="relative px-6 text-center">
        <span className="block font-serif text-3xl font-bold leading-none">Vigía</span>
        <span className="mt-2 block text-[11.5px] leading-snug text-paper/70">Integra, procesa y relaciona información pública</span>
      </span>
    </button>
  );
}

// ── Lo que se abre: una fuente ────────────────────────────────────────────

function DetalleFuente({ f, ir }: { f: FuenteFlujo; ir: (s: Eleccion) => void }) {
  const FormatoIcono = ICONO_FORMATO[f.formato];
  // El reloj del navegador, al abrir la ficha. Esta ficha sólo existe después
  // de un clic, así que no hay HTML del servidor con el que desentonar; y la
  // portada es ISR: un `ahora` mandado desde el servidor podía tener días.
  const [ahora] = useState(() => Date.now());
  // Una descarga que hoy falla no tiene "próxima vez".
  const proxima = f.estado === "caida" ? null : proximaDescarga(f.agenda, ahora);
  const sitio = f.url ? new URL(f.url).hostname.replace(/^www\./, "") : null;
  return (
    <div className="space-y-3.5 text-[13px]">
      <p className="leading-relaxed text-paper/80">{f.aporta}</p>

      <dl className="space-y-2.5">
        <Dato Icono={Globe} etiqueta="Dónde está">
          {f.url && sitio ? (
            <a
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-center gap-1 break-all rounded-sm font-medium text-paper underline decoration-paper/30 underline-offset-4 hover:decoration-heroGreen focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroGreen"
            >
              {sitio}
              <ArrowUpRight size={13} className="shrink-0 text-paper/50 group-hover:text-heroGreen" aria-hidden />
              <span className="sr-only">(se abre en una pestaña nueva)</span>
            </a>
          ) : (
            <span className="text-paper/85">{f.lugar ?? f.corto}</span>
          )}
        </Dato>
        <Dato Icono={FormatoIcono} etiqueta="Llega como">
          <span className="text-paper/85">{f.llegaComo}</span>
        </Dato>
        <Dato Icono={RefreshCw} etiqueta="Se actualiza">
          <span className="text-paper/85">
            {f.frecuencia}
            {proxima && <span className="block text-[12px] text-paper/50">Próxima vez: {proxima}</span>}
          </span>
        </Dato>
      </dl>

      <div>
        <p className="text-[12px] font-medium text-paper/55">Lo que tomamos de ahí</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {f.tomamos.map((t) => (
            <li key={t} className="rounded-full bg-heroGreen/15 px-2.5 py-1 text-[12px] text-[#9BE3AC]">
              {t}
            </li>
          ))}
        </ul>
      </div>

      <p className="leading-relaxed text-paper/75">
        {/* Lo que todavía nadie usa no "sirve": servirá. */}
        <span className="font-semibold text-paper">{f.alimenta.length > 0 ? "Sirve para " : "Servirá para "}</span>
        {f.sirve}
      </p>

      {f.alimenta.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-paper/10 pt-3">
          <span className="text-[12px] text-paper/50">Llega a</span>
          {f.alimenta.map((k) => (
            <Ficha key={k} Icono={ICONO_RESULTADO[k]} onClick={() => ir({ tipo: "resultado", clave: k })}>
              {RESULTADOS.find((r) => r.clave === k)!.nombre}
            </Ficha>
          ))}
        </div>
      )}
    </div>
  );
}

function Dato({ Icono, etiqueta, children }: { Icono: LucideIcon; etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icono size={15} className="mt-0.5 shrink-0 text-heroGreen" aria-hidden />
      <div className="min-w-0">
        <dt className="text-[11.5px] text-paper/50">{etiqueta}</dt>
        <dd className="leading-snug">{children}</dd>
      </div>
    </div>
  );
}

// ── Lo que se abre: un resultado ──────────────────────────────────────────

function DetalleResultado({ r, cifras, ir }: { r: Resultado; cifras: CifrasFlujo | null; ir: (s: Eleccion) => void }) {
  const fuentes = fuentesDe(r.clave);
  return (
    <div className="space-y-4 text-[13px]">
      <p className="leading-relaxed text-paper/80">{r.que}</p>

      <Visual clave={r.clave} cifras={cifras} />

      <div>
        <p className="text-[12px] font-medium text-paper/55">
          Sale de {fuentes.length} {fuentes.length === 1 ? "fuente" : "fuentes"}
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {fuentes.map((f) => {
            const F = ICONO_FORMATO[f.formato];
            return (
              <li key={f.clave}>
                <Ficha Icono={ICONO_FUENTE[f.clave] ?? FileText} onClick={() => ir({ tipo: "fuente", clave: f.clave })}>
                  {f.corto}
                  <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-paper/10 px-1 text-[10.5px] text-paper/60">
                    <F size={10} aria-hidden />
                    {f.formato}
                  </span>
                </Ficha>
              </li>
            );
          })}
        </ul>
      </div>

      <Link
        href={r.donde.href}
        className="group inline-flex items-center gap-2 rounded-full border border-paper/20 px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-rapido hover:border-heroGreen hover:text-heroGreen focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroGreen"
      >
        {r.donde.texto}
        <ArrowRight size={14} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * Qué hace Vigía, en palabras de quien no programa. Cada verbo es algo que el
 * código hace de verdad: unir por RUC, DNI y ubigeo, no volver a cargar lo que
 * no cambió (sha256), cruzar personas con empresas y aplicar las reglas de la
 * ley con revisión humana cuando no está seguro.
 */
const PASOS_VIGIA: { Icono: LucideIcon; verbo: string; que: string }[] = [
  { Icono: Combine, verbo: "Une", que: "Junta los registros de cada fuente por RUC, DNI y ubicación, aunque cada una los escriba distinto." },
  { Icono: Eraser, verbo: "Limpia", que: "Ordena los nombres, descarta filas incompletas y no vuelve a cargar un archivo que no cambió." },
  { Icono: Network, verbo: "Relaciona", que: "Cruza personas, empresas y entidades: quién es socio de quién, quién aportó a quién, quién visitó a quién." },
  { Icono: Scale, verbo: "Revisa", que: "Aplica las reglas de la ley de contrataciones a cada contrato y lee su expediente. Si no está seguro, lo revisa una persona." },
];

function QueHaceVigia() {
  return (
    <div>
      <p className="font-serif text-2xl font-bold leading-tight">Qué hace Vigía con los datos</p>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-paper/75">
        Cada fuente escribe las cosas a su manera. Vigía las junta en un solo lugar y las pone a conversar.
      </p>
      <ol className="relative mt-7 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <span aria-hidden className="absolute left-5 right-5 top-5 hidden h-px bg-gradient-to-r from-heroGreen/50 via-paper/15 to-heroGreen/50 lg:block" />
        {PASOS_VIGIA.map(({ Icono, verbo, que }) => (
          <li key={verbo} className="relative">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-heroGreen/50 bg-ink text-heroGreen">
              <Icono size={18} aria-hidden />
            </span>
            <p className="mt-3 text-[15px] font-semibold">{verbo}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-paper/65">{que}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Ficha({ Icono, onClick, children }: { Icono: LucideIcon; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-paper/15 bg-paper/[0.04] px-2.5 py-1 text-[12px] text-paper/85 transition-colors duration-rapido hover:border-heroGreen/60 hover:text-heroGreen focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroGreen"
    >
      <Icono size={13} aria-hidden />
      {children}
    </button>
  );
}

// ── La próxima descarga, en hora de Lima ──────────────────────────────────

const LIMA = -5 * 60 * 60 * 1000; // Perú no tiene horario de verano.
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

/** La próxima fecha de la agenda después de `ahora` (el reloj del navegador, ver `DetalleFuente`). */
function proximaDescarga(agenda: FuenteFlujo["agenda"], ahora: number): string | null {
  if (agenda.tipo === "a_mano") return null;
  const hora = agenda.hora;
  const minuto = agenda.tipo === "diaria" ? agenda.minuto : 0;
  const lima = new Date(ahora + LIMA);
  for (let k = 0; k < 400; k++) {
    const d = new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate() + k, hora, minuto));
    if (d.getTime() <= lima.getTime()) continue;
    const ok =
      agenda.tipo === "diaria" ||
      (agenda.tipo === "semanal" && d.getUTCDay() === agenda.diaSemana) ||
      (agenda.tipo === "mensual" && agenda.dias.includes(d.getUTCDate()));
    if (ok) return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
  }
  return null;
}
