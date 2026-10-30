"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { BotonCerrar, GrafoMarco } from "@/components/grafo/primitivos";
import { fechaConAnio, numero, plural, solesCompacto } from "@/lib/formato";
import { mesDe, mesesDe, mesLargo, sumarMes, type EventoHistoria, type HechoHilo, type HiloHistoria, type MarcaHistoria } from "@/lib/historia";
import { tituloNatural } from "@/lib/landing";
import { cn } from "@/lib/utils";

/**
 * Los hilos de una entidad (pedido del usuario el 2026-10-28: «capaz no sea una lista sino una especie de grafo que
 * correlaciona hechos a lo largo del tiempo»): una fila por empresa con lo que pasó entre ella y la entidad, sobre el
 * mismo eje de años: las visitas de su gente (banda), lo que le dieron después (rombo), sus contratos con banderas
 * (cuadrado), sus obras (triángulo) y si se paralizaron (aspa) y sus sanciones del Tribunal (banda roja). Detrás, las
 * gestiones y las elecciones, para ver con quién gobernaba pasó cada cosa. Pasar por un hecho dice qué es; tocar una fila
 * abre su hilo completo con la evidencia de cada hecho. La lista de abajo (HistoriaFicha) es la versión accesible.
 */

const FILA = 34;
const EJE = 26;
const ETIQUETA = 168;
const VISIBLES = 12;

type Clase = HechoHilo["tipo"];
const CLASES: { clave: Clase; texto: string }[] = [
  { clave: "visitas", texto: "Visitas de su gente" },
  { clave: "despues", texto: "Lo que le dieron después" },
  { clave: "contrato", texto: "Contrato con banderas" },
  { clave: "obra", texto: "Obra" },
  { clave: "paralizada", texto: "Obra paralizada" },
  { clave: "sancion", texto: "Sanción del Tribunal" },
];
/** Clases LITERALES (Tailwind sólo genera las que ve escritas). */
const RELLENO: Record<string, string> = { alta: "fill-crimson", media: "fill-amber", baja: "fill-mute", ninguna: "fill-ink/60" };

function useAncho(ref: React.RefObject<HTMLElement>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** La forma de cada clase de hecho, centrada en (x, y). */
function Forma({ h, x, y, elegido }: { h: HechoHilo; x: number; y: number; elegido: boolean }) {
  const sev = h.severidad ?? "ninguna";
  const borde = elegido ? "stroke-granate" : "stroke-paper";
  if (h.tipo === "despues") return <path d={`M ${x} ${y - 6} L ${x + 6} ${y} L ${x} ${y + 6} L ${x - 6} ${y} Z`} strokeWidth={1.5} className={cn(RELLENO[sev], borde)} />;
  if (h.tipo === "contrato") return <rect x={x - 5} y={y - 5} width={10} height={10} rx={1.5} strokeWidth={1.5} className={cn(RELLENO[sev], borde)} />;
  if (h.tipo === "obra") return <path d={`M ${x} ${y - 6} L ${x + 6} ${y + 5} L ${x - 6} ${y + 5} Z`} strokeWidth={1.5} className={cn("fill-ink/60", borde)} />;
  if (h.tipo === "paralizada") {
    return (
      <g className="stroke-crimson" strokeWidth={2.5} strokeLinecap="round">
        <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} />
        <line x1={x + 5} y1={y - 5} x2={x - 5} y2={y + 5} />
      </g>
    );
  }
  return <circle cx={x} cy={y} r={4} strokeWidth={1.5} className={cn("fill-granate", borde)} />;
}

export function HilosHistoria({
  hilos, desde, hasta, marcas, gestiones,
}: {
  hilos: HiloHistoria[]; desde: string; hasta: string; marcas: MarcaHistoria[]; gestiones: EventoHistoria[];
}) {
  const [soloGraves, setSoloGraves] = useState(false);
  const [todos, setTodos] = useState(false);
  const [elegido, setElegido] = useState<string | null>(null);
  const [encima, setEncima] = useState<{ h: HechoHilo; nombre: string; x: number; y: number } | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const ancho = useAncho(caja);

  const lista = useMemo(() => hilos.filter((x) => !soloGraves || x.severidad === "alta"), [hilos, soloGraves]);
  const vistos = todos ? lista : lista.slice(0, VISIBLES);
  // El eje: del primer año con un hecho de los hilos (o de la historia) a hoy.
  const primero = useMemo(() => {
    const f = hilos.flatMap((x) => x.hechos.map((h) => h.fecha)).sort()[0];
    return mesDe(f && f > desde ? `${f.slice(0, 4)}-01-01` : desde);
  }, [hilos, desde]);
  const ultimo = mesDe(hasta);
  const n = mesesDe(primero, ultimo) + 1;
  const W = Math.max(ancho, n * 6);
  const mw = W / n;
  const xF = (f: string) => mesesDe(primero, mesDe(f)) * mw + ((Number(f.slice(8, 10)) || 1) - 1) / 31 * mw;
  const H = EJE + vistos.length * FILA + 4;
  const hilo = hilos.find((x) => x.ruc === elegido) ?? null;
  const tecla = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          aria-pressed={soloGraves}
          onClick={() => setSoloGraves((v) => !v)}
          className={cn(
            "min-h-[32px] rounded-full border px-3 text-rotulo font-semibold transition-colors duration-rapido",
            soloGraves ? "border-ink bg-ink text-paper" : "border-line text-inkSoft hover:border-paperEdge hover:text-ink",
          )}
        >
          Sólo los graves ({numero(hilos.filter((x) => x.severidad === "alta").length)})
        </button>
        <span className="text-rotulo text-mute">{plural(lista.length, "empresa", "empresas")}; toca una para ver su hilo con la evidencia</span>
      </div>

      <GrafoMarco>
        <div className="relative flex">
          {/* Los nombres de las empresas, fijos a la izquierda (el lienzo se desliza a su derecha). */}
          <div className="shrink-0 border-r border-line bg-paper" style={{ width: ETIQUETA }}>
            <div style={{ height: EJE }} />
            {vistos.map((x) => (
              <button
                key={x.ruc}
                type="button"
                onClick={() => setElegido(x.ruc === elegido ? null : x.ruc)}
                aria-pressed={x.ruc === elegido}
                style={{ height: FILA }}
                className={cn(
                  "flex w-full items-center gap-1.5 border-t border-line/60 px-2.5 text-left transition-colors duration-rapido",
                  x.ruc === elegido ? "bg-granate/10" : "hover:bg-paperDeep",
                )}
              >
                <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", x.severidad === "alta" ? "bg-crimson" : x.severidad === "media" ? "bg-amber" : "bg-mute")} />
                <span className="line-clamp-2 text-rotulo font-semibold leading-tight text-ink">{tituloNatural(x.nombre)}</span>
              </button>
            ))}
          </div>
          <div ref={caja} className="relative min-w-0 flex-1 overflow-x-auto">
            <svg width={W} height={H} role="img" aria-label={`Hilos de ${plural(vistos.length, "empresa", "empresas")}: lo que pasó entre cada una y la entidad, de ${mesLargo(primero)} a ${mesLargo(ultimo)}.`} className="block select-none">
              {/* Las gestiones, alternadas de fondo, y el eje de años. */}
              {gestiones.filter((g) => g.hasta && mesDe(g.hasta) >= primero).map((g, i) => (
                <rect key={g.id} x={Math.max(0, xF(g.fecha))} y={EJE} width={Math.max(0, Math.min(W, xF(g.hasta!)) - Math.max(0, xF(g.fecha)))} height={H - EJE} className={i % 2 ? "fill-paperDeep/60" : "fill-transparent"} />
              ))}
              {Array.from({ length: n }, (_, i) => sumarMes(primero, i)).filter((m) => m.endsWith("-01")).map((m) => (
                <g key={m}>
                  <line x1={xF(`${m}-01`)} x2={xF(`${m}-01`)} y1={EJE - 6} y2={H} className="stroke-line" strokeWidth={1} />
                  <text x={xF(`${m}-01`) + 4} y={14} className="fill-ink font-semibold" style={{ fontSize: "11px" }}>{m.slice(0, 4)}</text>
                </g>
              ))}
              {marcas.filter((m) => mesDe(m.fecha) >= primero).map((m) => (
                <line key={`${m.tipo}-${m.fecha}`} x1={xF(m.fecha)} x2={xF(m.fecha)} y1={EJE - 8} y2={H} strokeWidth={m.tipo === "gobierno" ? 1.5 : 1} strokeDasharray={m.tipo === "eleccion" ? "3 3" : undefined} className={m.tipo === "gobierno" ? "stroke-ink/50" : "stroke-ink/30"}>
                  <title>{`${fechaConAnio(m.fecha)}: ${m.texto}`}</title>
                </line>
              ))}

              {vistos.map((x, i) => {
                const y = EJE + i * FILA + FILA / 2;
                const fechas = x.hechos.flatMap((h) => [h.fecha, h.hasta ?? h.fecha]).sort();
                const abre = () => setElegido(x.ruc === elegido ? null : x.ruc);
                return (
                  <g key={x.ruc}>
                    <line x1={0} x2={W} y1={EJE + i * FILA} y2={EJE + i * FILA} className="stroke-line/60" strokeWidth={1} />
                    {x.ruc === elegido && <rect x={0} y={EJE + i * FILA} width={W} height={FILA} className="fill-granate/10" />}
                    {/* El hilo: del primer hecho al último. */}
                    <line x1={xF(fechas[0])} x2={xF(fechas[fechas.length - 1])} y1={y} y2={y} strokeWidth={1.5} className="stroke-ink/30" />
                    {/* Las bandas: las visitas (de la primera a la última) y las sanciones. */}
                    {x.hechos.filter((h) => h.hasta && (h.tipo === "visitas" || h.tipo === "sancion")).map((h, k) => (
                      <rect key={`b${k}`} x={xF(h.fecha)} y={y - (h.tipo === "sancion" ? 9 : 6)} width={Math.max(3, xF(h.hasta!) - xF(h.fecha))} height={h.tipo === "sancion" ? 18 : 12} rx={3} className={h.tipo === "sancion" ? "fill-crimson/20" : "fill-granate/25"} />
                    ))}
                    {x.hechos.map((h, k) => (
                      <g
                        key={k}
                        role="button"
                        tabIndex={0}
                        aria-label={`${tituloNatural(x.nombre)}: ${fechaConAnio(h.fecha)}, ${h.titulo}`}
                        onClick={abre}
                        onKeyDown={tecla(abre)}
                        onMouseEnter={(e) => {
                          const r = caja.current?.getBoundingClientRect();
                          if (r) setEncima({ h, nombre: x.nombre, x: e.clientX - r.left, y: e.clientY - r.top });
                        }}
                        onMouseLeave={() => setEncima(null)}
                        className="cursor-pointer focus:outline-none"
                      >
                        <circle cx={xF(h.fecha)} cy={y} r={10} className="fill-transparent" />
                        {h.tipo === "sancion" ? (
                          <rect x={xF(h.fecha) - 2} y={y - 9} width={4} height={18} className="fill-crimson" />
                        ) : (
                          <Forma h={h} x={xF(h.fecha)} y={y} elegido={x.ruc === elegido} />
                        )}
                      </g>
                    ))}
                  </g>
                );
              })}
            </svg>
            {encima && <Globo {...encima} ancho={ancho} />}
          </div>
        </div>
      </GrafoMarco>

      <LeyendaHilos />
      {lista.length > VISIBLES && (
        <button type="button" onClick={() => setTodos((v) => !v)} className="text-meta font-semibold text-granate underline decoration-granate/40 underline-offset-2">
          {todos ? "Ver menos" : `Ver las ${numero(lista.length)} empresas`}
        </button>
      )}

      {hilo && (
        <section aria-live="polite" aria-label={`Hilo de ${tituloNatural(hilo.nombre)}`} className="rounded-xl border border-line bg-paper p-4">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="font-display text-dato font-bold leading-snug text-ink text-pretty">{tituloNatural(hilo.nombre)}</h4>
              <p className="text-meta text-inkSoft">{hilo.resumen}</p>
            </div>
            <BotonCerrar onClick={() => setElegido(null)} />
          </div>
          <ol className="relative space-y-2.5 border-l border-line pl-4">
            {hilo.hechos.map((h, k) => (
              <li key={k} className="space-y-0.5">
                <span aria-hidden className={cn("absolute -left-[5px] mt-1.5 inline-block size-2.5 rounded-full", h.severidad === "alta" ? "bg-crimson" : h.severidad === "media" ? "bg-amber" : "bg-ink/40")} />
                <p className="text-meta text-ink">
                  <span className="font-mono text-rotulo tabular-nums text-inkSoft">{h.hasta ? `${fechaConAnio(h.fecha)} a ${fechaConAnio(h.hasta)}` : fechaConAnio(h.fecha)}</span>{" "}
                  <span className="font-semibold">{h.titulo}</span>
                  {h.monto ? `, ${solesCompacto(h.monto)}` : ""}
                </p>
                {h.detalle && <p className="text-rotulo text-inkSoft">{h.detalle}</p>}
                {h.href && <Abrir href={h.href}>Ver la evidencia</Abrir>}
              </li>
            ))}
          </ol>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <Abrir href={hilo.href}>Abrir la ficha de la empresa</Abrir>
            <span className="text-micro text-mute">Una coincidencia en el tiempo no prueba un favor: dice qué revisar.</span>
          </p>
        </section>
      )}
    </div>
  );
}

function Abrir({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} prefetch={false} className="text-rotulo font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
      {children}
    </Link>
  );
}

function Globo({ h, nombre, x, y, ancho }: { h: HechoHilo; nombre: string; x: number; y: number; ancho: number }) {
  const izquierda = x + 290 > ancho;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 w-[280px] rounded-lg border border-line bg-paper p-2.5 shadow-lg"
      style={{ left: izquierda ? Math.max(4, x - 292) : x + 14, top: Math.max(4, y - 8) }}
    >
      <p className="text-rotulo font-semibold text-ink">{tituloNatural(nombre)}</p>
      <p className="text-micro text-inkSoft">
        <span className="font-mono tabular-nums">{h.hasta ? `${fechaConAnio(h.fecha)} a ${fechaConAnio(h.hasta)}` : fechaConAnio(h.fecha)}</span>{" "}
        <span className="font-semibold text-ink">{h.titulo}</span>
        {h.monto ? `, ${solesCompacto(h.monto)}` : ""}
      </p>
      {h.detalle && <p className="mt-0.5 line-clamp-3 text-micro text-inkSoft">{h.detalle}</p>}
      <p className="mt-1 text-micro text-mute">Toca para ver su hilo completo</p>
    </div>
  );
}

function LeyendaHilos() {
  const muestra = (h: HechoHilo, texto: string) => (
    <span key={texto} className="inline-flex items-center gap-1.5">
      <svg width={16} height={16} aria-hidden className="shrink-0">
        <Forma h={h} x={8} y={8} elegido={false} />
      </svg>
      {texto}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-rotulo text-inkSoft">
      <span className="inline-flex items-center gap-1.5">
        <svg width={22} height={14} aria-hidden className="shrink-0"><rect x={1} y={2} width={20} height={10} rx={3} className="fill-granate/25" /><circle cx={4} cy={7} r={3.5} className="fill-granate" /></svg>
        Visitas de su gente (de la primera a la última)
      </span>
      {muestra({ fecha: "", tipo: "despues", titulo: "", severidad: "alta" }, "Lo primero que le dieron después")}
      {muestra({ fecha: "", tipo: "contrato", titulo: "", severidad: "alta" }, "Contrato con banderas")}
      {muestra({ fecha: "", tipo: "obra", titulo: "" }, "Obra")}
      {muestra({ fecha: "", tipo: "paralizada", titulo: "" }, "Obra paralizada")}
      <span className="inline-flex items-center gap-1.5">
        <svg width={22} height={14} aria-hidden className="shrink-0"><rect x={1} y={1} width={20} height={12} rx={3} className="fill-crimson/20" /><rect x={1} y={1} width={3} height={12} className="fill-crimson" /></svg>
        Sanción del Tribunal
      </span>
      <span>Rojo: grave. Ámbar: medio. El fondo alterna con cada gestión.</span>
      <span className="sr-only">{CLASES.map((c) => c.texto).join(", ")}</span>
    </div>
  );
}
