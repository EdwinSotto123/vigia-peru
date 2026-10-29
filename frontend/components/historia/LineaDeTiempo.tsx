"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { LineaHitos } from "@/components/charts/LineaHitos";
import { BotonCerrar, GrafoMarco } from "@/components/grafo/primitivos";
import { fechaCorta, numero, plural, solesCompacto } from "@/lib/formato";
import {
  INICIAL_MES,
  MINIMO_PICO,
  comoLoNormal,
  mesCorto,
  mesDe,
  mesesDe,
  mesLargo,
  normalDeSerie,
  sumarMes,
  type Carril,
  type EventoHistoria,
  type Historia,
  type PatronHistoria,
  type SecuenciaHistoria,
  type SerieHistoria,
} from "@/lib/historia";
import { cn } from "@/lib/utils";

/**
 * La línea de tiempo de una ficha (fase 3 del plan del 2026-10-27): un renglón por carril (quién gobierna, compras,
 * órdenes, planilla, visitas, control…) sobre el mismo eje de meses, con los cambios de gobierno (línea continua) y las
 * elecciones (punteada) cruzándolos a todos. Las series van en barras (el alto, relativo a su propio máximo en lo que se
 * ve); los hechos sueltos, en puntos por mes (más grande si son varios; rojo los graves, ámbar los medios) y los tramos
 * (una gestión, una sanción) en barras horizontales. Arriba, las secuencias: una cosa que llevó a otra.
 *
 * Pasar por un mes muestra lo de ese mes en todos los renglones; tocarlo (o tocar un punto) abre su detalle debajo, con
 * la fuente de cada cosa y el enlace a su lista en Vigía. Se mira todo o por periodos de gobierno (2015-2018, 2019-2022,
 * 2023-2026), en número o en soles. En el celular el lienzo se desliza y arranca en lo más reciente. La lista completa,
 * con su buscador, va debajo (HistoriaFicha): es también la versión accesible.
 */

type Medida = "n" | "monto";
type Seleccion = { tipo: "mes"; mes: string } | { tipo: "evento"; id: string } | { tipo: "secuencia"; id: string };

interface Fila {
  clave: string;
  titulo: string;
  explica: string;
  alto: number;
  carril?: Carril;
  serie?: SerieHistoria;
  eventos: EventoHistoria[];
  secuencias?: SecuenciaHistoria[];
}

const EJE = 30;
const MIN_MES = 6;
/** Clases LITERALES por severidad (Tailwind sólo genera las que ve escritas). */
const PUNTO: Record<string, string> = { alta: "fill-crimson", media: "fill-amber", baja: "fill-mute", ninguna: "fill-ink/70" };
const TRAMO: Record<string, string> = { alta: "fill-crimson/70", media: "fill-amber/70", baja: "fill-mute/60", ninguna: "fill-ink/30" };
const PESO: Record<string, number> = { alta: 3, media: 2, baja: 1 };

const valorDe = (s: SerieHistoria, p: SerieHistoria["puntos"][number], medida: Medida) =>
  s.medida === "monto" || (medida === "monto" && p.monto != null) ? (p.monto ?? 0) : p.n;
const usaMonto = (s: SerieHistoria, medida: Medida) => s.medida === "monto" || (medida === "monto" && s.puntos.some((p) => p.monto != null));
/** Cómo se dice el valor de una serie en un periodo. */
function decir(s: SerieHistoria, p: SerieHistoria["puntos"][number]): string {
  if (s.medida === "monto") return `${solesCompacto(p.monto ?? 0)}${p.extra != null && s.extra ? `; ${s.extra} ${solesCompacto(p.extra)}` : ""}`;
  return [
    `${numero(p.n)} ${s.unidad}`,
    p.monto != null && p.monto > 0 ? `por ${solesCompacto(p.monto)}` : null,
    p.extra != null && s.extra ? `${numero(p.extra)} ${s.extra}` : null,
    p.extra2 != null && s.extra2 ? `${numero(p.extra2)} ${s.extra2}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}
const peor = (xs: EventoHistoria[]) => xs.reduce<string>((m, e) => ((PESO[e.severidad ?? ""] ?? 0) > (PESO[m] ?? 0) ? (e.severidad as string) : m), "ninguna");

/** El ancho del contenedor (para repartir los meses). */
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

export function LineaDeTiempo({ h, etiqueta }: { h: Historia; etiqueta: string }) {
  const primerMes = mesDe(h.desde);
  const ultimoMes = mesDe(h.hasta);
  // Los periodos de gobierno local (enero de un año a diciembre de cuatro años después) que caen en la historia.
  const tramos = useMemo(() => {
    const out: { clave: string; etiqueta: string; desde: string; hasta: string }[] = [{ clave: "todo", etiqueta: "Todo", desde: primerMes, hasta: ultimoMes }];
    for (let a = 2015; a <= Number(ultimoMes.slice(0, 4)); a += 4) {
      const d = `${a}-01`;
      const hh = `${a + 3}-12`;
      if (hh < primerMes) continue;
      out.push({ clave: String(a), etiqueta: `${a} a ${a + 3}`, desde: d < primerMes ? primerMes : d, hasta: hh > ultimoMes ? ultimoMes : hh });
    }
    if (mesesDe(primerMes, ultimoMes) > 24) out.push({ clave: "ultimo", etiqueta: "Último año", desde: sumarMes(ultimoMes, -11), hasta: ultimoMes });
    return out;
  }, [primerMes, ultimoMes]);
  const [tramo, setTramo] = useState("todo");
  const [medida, setMedida] = useState<Medida>("n");
  const [ocultos, setOcultos] = useState<Set<Carril>>(new Set());
  const [sel, setSel] = useState<Seleccion | null>(null);
  const [encima, setEncima] = useState<{ mes: string; x: number; y: number } | null>(null);
  const lienzo = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const ancho = useAncho(caja);

  const t = tramos.find((x) => x.clave === tramo) ?? tramos[0];
  const n = mesesDe(t.desde, t.hasta) + 1;
  const mw = Math.max(MIN_MES, ancho > 0 ? ancho / n : MIN_MES);
  const W = Math.round(mw * n);
  const xMes = (mes: string) => mesesDe(t.desde, mes) * mw;
  const xFecha = (f: string) => xMes(f.slice(0, 7)) + ((Number(f.slice(8, 10)) || 1) - 1) / 31 * mw;
  const visible = (mes: string) => mes >= t.desde && mes <= t.hasta;

  // Los renglones: las secuencias arriba (si hay) y un carril por renglón, sin los ocultos.
  const filas = useMemo<Fila[]>(() => {
    const out: Fila[] = [];
    if (h.secuencias.length) {
      const carrilesSec = Math.min(4, h.secuencias.length);
      out.push({ clave: "secuencias", titulo: "Una cosa lleva a otra", explica: "Secuencias que prueban los datos: cada línea une sus pasos en el tiempo.", alto: 14 + carrilesSec * 11, eventos: [], secuencias: h.secuencias });
    }
    for (const c of h.carriles) {
      if (ocultos.has(c.clave)) continue;
      const serie = h.series.find((s) => s.carril === c.clave);
      const eventos = h.eventos.filter((e) => e.carril === c.clave);
      out.push({ clave: c.clave, carril: c.clave, titulo: c.titulo, explica: c.explica, alto: serie ? 46 : c.clave === "gobierno" ? 34 : 30, serie, eventos });
    }
    return out;
  }, [h, ocultos]);
  // Dónde empieza cada renglón: debajo del eje, uno tras otro.
  const ys = filas.reduce<number[]>((acc, _f, i) => [...acc, i === 0 ? EJE : acc[i - 1] + filas[i - 1].alto], []);
  const H = (ys[ys.length - 1] ?? EJE) + (filas[filas.length - 1]?.alto ?? 0) + 6;

  // Al abrir (y al cambiar de periodo), lo más reciente a la vista: el lienzo se desliza sólo si no entra.
  useEffect(() => {
    const el = lienzo.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [tramo, ancho]);

  const haySoles = h.series.some((s) => s.medida !== "monto" && s.puntos.some((p) => (p.monto ?? 0) > 0));
  // Lo normal de cada renglón en cada mes (la mediana de sus doce meses anteriores): para marcar los picos en las barras y
  // decir en el globo cuántas veces lo normal fue ese mes.
  const normales = useMemo(() => new Map(h.series.map((s) => [s.carril, normalDeSerie(s)])), [h.series]);
  const patrones = h.patrones ?? [];
  const patronesDelMes = (mes: string) => patrones.filter((p) => mes >= p.mes && mes <= (p.hasta ?? p.mes));
  // Quién gobernaba cada mes y desde cuándo (el renglón «Quién gobierna»).
  const gestionDe = (mes: string) => {
    const g = h.eventos.find((e) => e.carril === "gobierno" && e.hasta && mesDe(e.fecha) <= mes && mesDe(e.hasta) >= mes);
    return g ? { titulo: g.titulo, mes: mesesDe(mesDe(g.fecha), mes) + 1 } : null;
  };
  const [patronSel, setPatronSel] = useState<string | null>(null);
  const patronElegido = patrones.find((p) => p.id === patronSel) ?? null;
  const verPatron = (p: PatronHistoria) => {
    setTramo("todo");
    setPatronSel(p.id);
    setSel({ tipo: "mes", mes: p.mes });
    // El mes del patrón a la vista en el lienzo (se desliza si no entra).
    requestAnimationFrame(() => {
      const el = lienzo.current;
      if (el) el.scrollLeft = Math.max(0, mesesDe(primerMes, p.mes) * Math.max(MIN_MES, ancho > 0 ? ancho / (mesesDe(primerMes, ultimoMes) + 1) : MIN_MES) - el.clientWidth / 2);
    });
  };
  const porMes = useMemo(() => {
    const m = new Map<string, EventoHistoria[]>();
    for (const e of h.eventos) if (!e.hasta) m.set(mesDe(e.fecha), [...(m.get(mesDe(e.fecha)) ?? []), e]);
    return m;
  }, [h.eventos]);

  /** Lo de un mes en una línea por renglón (el globo y el detalle). */
  const delMes = (mes: string) =>
    filas
      .filter((f) => f.carril)
      .map((f) => {
        const p = f.serie?.puntos.find((x) => x.periodo === (f.serie?.porAnio ? mes.slice(0, 4) : mes));
        const ev = (porMes.get(mes) ?? []).filter((e) => e.carril === f.carril);
        const vigentes = f.eventos.filter((e) => e.hasta !== undefined && e.hasta !== null && mesDe(e.fecha) <= mes && mesDe(e.hasta) >= mes);
        const partes = [
          p && f.serie ? decir(f.serie, p) : null,
          ev.length ? (ev.length === 1 ? ev[0].titulo : plural(ev.length, "hecho", "hechos")) : null,
          vigentes.length && f.carril === "gobierno" ? vigentes.map((e) => e.titulo).join(", ") : null,
        ].filter(Boolean);
        const normal = f.carril && f.serie && !f.serie.porAnio ? normales.get(f.carril)?.get(mes) ?? null : null;
        return partes.length ? { fila: f, texto: partes.join("; "), ev, punto: p ?? null, normal } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

  const alternar = (c: Carril) =>
    setOcultos((s) => {
      const x = new Set(s);
      if (x.has(c)) x.delete(c);
      else x.add(c);
      return x;
    });

  const mesDelPuntero = (clientX: number) => {
    const el = lienzo.current;
    if (!el) return null;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft;
    const i = Math.floor(x / mw);
    return i >= 0 && i < n ? sumarMes(t.desde, i) : null;
  };

  const elegido =
    sel?.tipo === "evento" ? h.eventos.find((e) => e.id === sel.id) ?? null : null;
  const secElegida = sel?.tipo === "secuencia" ? h.secuencias.find((s) => s.id === sel.id) ?? null : null;
  const mesElegido = sel?.tipo === "mes" ? sel.mes : null;

  return (
    <div className="space-y-3">
      {patrones.length > 0 && <Patrones xs={patrones} elegido={patronSel} ver={verPatron} />}
      {/* Controles: el periodo, la medida y los renglones. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* En el celular, cada grupo en una fila que se desliza (antes, cinco filas de chips antes de la línea). */}
        <div role="group" aria-label="Periodo" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-0.5 sm:flex-wrap sm:overflow-visible">
          {tramos.map((x) => (
            <button
              key={x.clave}
              type="button"
              aria-pressed={tramo === x.clave}
              onClick={() => {
                setTramo(x.clave);
                setEncima(null);
              }}
              className={cn(
                "min-h-[32px] shrink-0 whitespace-nowrap rounded-full border px-3 text-rotulo font-semibold transition-colors duration-rapido",
                tramo === x.clave ? "border-ink bg-ink text-paper" : "border-line text-inkSoft hover:border-paperEdge hover:text-ink",
              )}
            >
              {x.etiqueta}
            </button>
          ))}
        </div>
        {haySoles && (
          <div role="group" aria-label="Medir en" className="flex rounded-full border border-line p-0.5">
            {(["n", "monto"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={medida === m}
                onClick={() => setMedida(m)}
                className={cn("min-h-[28px] rounded-full px-3 text-rotulo font-semibold", medida === m ? "bg-paperDeep text-ink" : "text-inkSoft hover:text-ink")}
              >
                {m === "n" ? "Cuántos" : "Cuánto (soles)"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div role="group" aria-label="Renglones a mostrar" className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-0.5 sm:flex-wrap sm:overflow-visible">
        {h.carriles.map((c) => (
          <button
            key={c.clave}
            type="button"
            aria-pressed={!ocultos.has(c.clave)}
            onClick={() => alternar(c.clave)}
            title={c.explica}
            className={cn(
              "inline-flex min-h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-rotulo transition-colors duration-rapido",
              ocultos.has(c.clave) ? "border-dashed border-line text-mute line-through" : "border-line bg-paper text-ink hover:border-paperEdge",
            )}
          >
            {c.titulo}
          </button>
        ))}
      </div>

      <GrafoMarco>
        <div className="relative flex">
          {/* Los nombres de los renglones, fijos a la izquierda (el lienzo se desliza a su derecha). */}
          <div className="w-[104px] shrink-0 border-r border-line bg-paper sm:w-[156px]" aria-hidden>
            <div style={{ height: EJE }} />
            {filas.map((f) => (
              <div key={f.clave} style={{ height: f.alto }} className="flex items-center border-t border-line/60 px-2.5" title={f.explica}>
                <span className="line-clamp-2 text-rotulo font-semibold leading-tight text-ink">{f.titulo}</span>
              </div>
            ))}
          </div>
          <div ref={caja} className="min-w-0 flex-1">
            <div
              ref={lienzo}
              className="relative overflow-x-auto"
              onMouseMove={(e) => {
                const mes = mesDelPuntero(e.clientX);
                const r = e.currentTarget.getBoundingClientRect();
                setEncima(mes ? { mes, x: e.clientX - r.left, y: e.clientY - r.top } : null);
              }}
              onMouseLeave={() => setEncima(null)}
            >
              <svg
                width={W}
                height={H}
                role="img"
                aria-label={`${etiqueta}, de ${mesLargo(t.desde)} a ${mesLargo(t.hasta)}. La lista de abajo tiene cada hecho con su fuente.`}
                className="block cursor-crosshair select-none"
                onClick={(e) => {
                  const mes = mesDelPuntero(e.clientX);
                  if (mes) setSel({ tipo: "mes", mes });
                }}
              >
                {/* El eje: los años (y las iniciales de los meses si hay sitio). */}
                {Array.from({ length: n }, (_, i) => sumarMes(t.desde, i)).map((m) => {
                  const enero = m.endsWith("-01");
                  if (!enero && mw < 13) return null;
                  return (
                    <g key={`eje-${m}`}>
                      {enero && <line x1={xMes(m)} x2={xMes(m)} y1={EJE - 8} y2={H} className="stroke-line" strokeWidth={1} />}
                      <text x={xMes(m) + (enero ? 4 : mw / 2)} y={enero ? 13 : EJE - 6} textAnchor={enero ? "start" : "middle"} className={enero ? "fill-ink font-semibold" : "fill-mute"} style={{ fontSize: enero ? "11.5px" : "9.5px" }}>
                        {enero ? m.slice(0, 4) : INICIAL_MES[Number(m.slice(5, 7)) - 1]}
                      </text>
                    </g>
                  );
                })}
                {/* Los renglones: su raya de arriba. */}
                {filas.map((f, i) => (
                  <line key={`r-${f.clave}`} x1={0} x2={W} y1={ys[i]} y2={ys[i]} className="stroke-line/60" strokeWidth={1} />
                ))}
                {/* El patrón elegido (sus meses) y el mes elegido y el del puntero. */}
                {patronElegido && visible(patronElegido.mes) && (
                  <rect x={xMes(patronElegido.mes)} y={EJE} width={(mesesDe(patronElegido.mes, patronElegido.hasta ?? patronElegido.mes) + 1) * mw} height={H - EJE} className="fill-amber/15" />
                )}
                {mesElegido && visible(mesElegido) && <rect x={xMes(mesElegido)} y={EJE} width={mw} height={H - EJE} className="fill-granate/20" />}
                {encima && visible(encima.mes) && <rect x={xMes(encima.mes)} y={EJE} width={mw} height={H - EJE} className="fill-ink/[0.06]" />}

                {filas.map((f, i) => (
                  <g key={f.clave}>
                    {f.serie && <Barras f={f} y={ys[i]} medida={medida} xMes={xMes} mw={mw} visible={visible} desde={t.desde} hasta={t.hasta} normal={f.carril ? normales.get(f.carril) : undefined} />}
                    {f.secuencias && <Secuencias xs={f.secuencias} y={ys[i]} xFecha={xFecha} t={t} elegir={(id) => setSel({ tipo: "secuencia", id })} elegida={secElegida?.id ?? null} />}
                    {!f.secuencias && <Hechos f={f} y={ys[i]} xMes={xMes} xFecha={xFecha} mw={mw} W={W} t={t} elegir={(s) => setSel(s)} elegido={elegido?.id ?? null} />}
                  </g>
                ))}

                {patrones
                  .filter((p) => visible(p.mes))
                  .map((p) => (
                    <g key={`patron-${p.id}`} className="cursor-pointer" onClick={(ev) => { ev.stopPropagation(); verPatron(p); }}>
                      <title>{p.titulo}</title>
                      <circle cx={xMes(p.mes) + mw / 2} cy={EJE - 15} r={4} className={p.severidad === "alta" ? "fill-crimson" : p.severidad === "media" ? "fill-amber" : "fill-mute"} />
                    </g>
                  ))}
                {/* Los cambios de gobierno (continua) y las elecciones (punteada), sobre todo. */}
                {h.marcas
                  .filter((m) => visible(mesDe(m.fecha)))
                  .map((m) => (
                    <g key={`${m.tipo}-${m.fecha}`}>
                      <title>{`${fechaCorta(m.fecha)}: ${m.texto}`}</title>
                      <line
                        x1={xFecha(m.fecha)}
                        x2={xFecha(m.fecha)}
                        y1={EJE - 10}
                        y2={H}
                        className={m.tipo === "gobierno" ? "stroke-ink/60" : "stroke-ink/35"}
                        strokeWidth={m.tipo === "gobierno" ? 1.5 : 1}
                        strokeDasharray={m.tipo === "eleccion" ? "3 3" : undefined}
                      />
                      <path d={`M ${xFecha(m.fecha) - 4} ${EJE - 10} L ${xFecha(m.fecha) + 4} ${EJE - 10} L ${xFecha(m.fecha)} ${EJE - 4} Z`} className={m.tipo === "gobierno" ? "fill-ink/70" : "fill-ink/35"} />
                    </g>
                  ))}
              </svg>
            </div>
            {encima && (
              <Globo
                mes={encima.mes} x={encima.x} y={encima.y} ancho={ancho} lineas={delMes(encima.mes)}
                marcas={h.marcas.filter((m) => mesDe(m.fecha) === encima.mes)} gestion={gestionDe(encima.mes)} patrones={patronesDelMes(encima.mes)}
              />
            )}
          </div>
        </div>
      </GrafoMarco>
      <Leyenda hayPicos={[...normales.values()].some((m) => m.size > 0)} />

      {/* El detalle de lo elegido: un mes, un hecho o una secuencia. */}
      {sel && (
        <section aria-live="polite" aria-label="Detalle de lo elegido" className="rounded-xl border border-line bg-paper p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h4 className="font-display text-dato font-bold leading-snug text-ink text-pretty">
              {mesElegido ? capital(mesLargo(mesElegido)) : elegido ? elegido.titulo : secElegida?.titulo}
            </h4>
            <BotonCerrar onClick={() => { setSel(null); setPatronSel(null); }} />
          </div>
          {mesElegido && (
            <DetalleMes
              lineas={delMes(mesElegido)} marcas={h.marcas.filter((m) => mesDe(m.fecha) === mesElegido)} gestion={gestionDe(mesElegido)}
              patrones={patronesDelMes(mesElegido)} elegir={(id) => setSel({ tipo: "evento", id })}
            />
          )}
          {elegido && <DetalleEvento e={elegido} />}
          {secElegida && <DetalleSecuencia s={secElegida} />}
        </section>
      )}
    </div>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Las partes del lienzo ──────────────────────────────────────────────────────────────────────

function Barras({
  f, y, medida, xMes, mw, visible, desde, hasta, normal,
}: {
  f: Fila; y: number; medida: Medida; xMes: (m: string) => number; mw: number; visible: (m: string) => boolean; desde: string; hasta: string;
  normal?: Map<string, { mediana: number; veces: number }>;
}) {
  const s = f.serie!;
  const alto = f.alto - 10;
  if (s.porAnio) {
    const pts = s.puntos.filter((p) => `${p.periodo}-12` >= desde && `${p.periodo}-01` <= hasta);
    const max = Math.max(1, ...pts.map((p) => Math.max(p.monto ?? 0, p.extra ?? 0)));
    return (
      <>
        {pts.map((p) => {
          const x0 = Math.max(xMes(`${p.periodo}-01`), 0);
          const x1 = xMes(`${p.periodo}-12`) + mw;
          const hp = ((p.monto ?? 0) / max) * alto;
          const hd = ((p.extra ?? 0) / max) * alto;
          return (
            <g key={p.periodo}>
              <rect x={x0 + 1} y={y + f.alto - 4 - hp} width={Math.max(1, x1 - x0 - 2)} height={hp} rx={2} className="fill-ink/15" />
              <rect x={x0 + 1} y={y + f.alto - 4 - hd} width={Math.max(1, x1 - x0 - 2)} height={hd} rx={2} className="fill-ink/40" />
            </g>
          );
        })}
      </>
    );
  }
  const pts = s.puntos.filter((p) => visible(p.periodo));
  const max = Math.max(1, ...pts.map((p) => valorDe(s, p, medida)));
  const hueco = mw >= 4 ? 1 : 0;
  // El pico se mide en cuántos (no en soles) y sólo en los renglones con su mínimo (MINIMO_PICO, como la API).
  const minimo = medida === "n" && s.medida === "n" ? MINIMO_PICO[s.carril] : undefined;
  const color = (p: SerieHistoria["puntos"][number]) => {
    const x = minimo != null ? normal?.get(p.periodo) : undefined;
    if (!x || p.n < minimo! || p.n - x.mediana < minimo!) return "fill-ink/30";
    return x.veces >= 4 ? "fill-crimson/75" : x.veces >= 2.5 ? "fill-amber/85" : "fill-ink/30";
  };
  return (
    <>
      {pts.map((p) => {
        const v = valorDe(s, p, medida);
        if (v <= 0) return null;
        const hb = Math.max(1.5, (v / max) * alto);
        return <rect key={p.periodo} x={xMes(p.periodo) + hueco / 2} y={y + f.alto - 4 - hb} width={Math.max(1, mw - hueco)} height={hb} rx={mw > 6 ? 1.5 : 0} className={color(p)} />;
      })}
    </>
  );
}

function Hechos({
  f, y, xMes, xFecha, mw, W, t, elegir, elegido,
}: {
  f: Fila; y: number; xMes: (m: string) => number; xFecha: (d: string) => number; mw: number; W: number;
  t: { desde: string; hasta: string }; elegir: (s: Seleccion) => void; elegido: string | null;
}) {
  const tramos = f.eventos.filter((e) => e.hasta !== undefined && e.hasta !== null && mesDe(e.fecha) <= t.hasta && mesDe(e.hasta) >= t.desde);
  const sueltos = f.eventos.filter((e) => !e.hasta && mesDe(e.fecha) >= t.desde && mesDe(e.fecha) <= t.hasta);
  const grupos = new Map<string, EventoHistoria[]>();
  for (const e of sueltos) grupos.set(mesDe(e.fecha), [...(grupos.get(mesDe(e.fecha)) ?? []), e]);
  const gob = f.carril === "gobierno";
  const cy = f.serie ? y + 12 : y + f.alto / 2;
  const tecla = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
  return (
    <>
      {tramos.map((e, i) => {
        const x0 = Math.max(0, xFecha(e.fecha));
        const x1 = Math.min(W, xFecha(e.hasta!));
        if (x1 <= x0) return null;
        const alto = gob ? f.alto - 10 : 7;
        const yy = gob ? y + 5 : y + f.alto - 10;
        // La etiqueta de una gestión adentro de su barra, si cabe (unos 6,3 px por letra a 11 px).
        const cabe = Math.floor((x1 - x0 - 12) / 6.3);
        const texto = gob && cabe >= 6 ? (e.titulo.length > cabe ? `${e.titulo.slice(0, cabe - 1)}…` : e.titulo) : null;
        return (
          <g
            key={e.id}
            role="button"
            tabIndex={0}
            aria-label={`${e.titulo}, de ${fechaCorta(e.fecha)} a ${fechaCorta(e.hasta!)}`}
            onClick={(ev) => {
              ev.stopPropagation();
              elegir({ tipo: "evento", id: e.id });
            }}
            onKeyDown={tecla(() => elegir({ tipo: "evento", id: e.id }))}
            className="cursor-pointer focus:outline-none [&:focus-visible>rect]:stroke-granate"
          >
            <title>{`${e.titulo} (${fechaCorta(e.fecha)} a ${fechaCorta(e.hasta!)})`}</title>
            <rect x={x0 + 0.5} y={yy} width={x1 - x0 - 1} height={alto} rx={gob ? 4 : 3} strokeWidth={elegido === e.id ? 2 : 0} className={cn(gob ? (i % 2 ? "fill-paperDeep" : "fill-line/70") : TRAMO[e.severidad ?? "ninguna"], elegido === e.id ? "stroke-granate" : "stroke-transparent")} />
            {texto && (
              <text x={x0 + 7} y={yy + alto / 2 + 4} className="pointer-events-none fill-ink" style={{ fontSize: "11px" }}>
                {texto}
              </text>
            )}
          </g>
        );
      })}
      {[...grupos.entries()].map(([mes, xs]) => {
        const r = 3.6 + Math.min(4, Math.log2(xs.length) * 1.3);
        const cx = xMes(mes) + mw / 2;
        const uno = xs.length === 1 ? xs[0] : null;
        const elegirlo = () => elegir(uno ? { tipo: "evento", id: uno.id } : { tipo: "mes", mes });
        return (
          <g
            key={mes}
            role="button"
            tabIndex={0}
            aria-label={uno ? `${uno.titulo}, ${fechaCorta(uno.fecha)}` : `${plural(xs.length, "hecho", "hechos")} en ${mesLargo(mes)}`}
            onClick={(ev) => {
              ev.stopPropagation();
              elegirlo();
            }}
            onKeyDown={tecla(elegirlo)}
            className="cursor-pointer focus:outline-none [&:focus-visible>circle]:stroke-granate"
          >
            <circle cx={cx} cy={cy} r={r + 5} className="fill-transparent" />
            <circle cx={cx} cy={cy} r={r} strokeWidth={uno && elegido === uno.id ? 2.5 : 1.5} className={cn(PUNTO[peor(xs)], uno && elegido === uno.id ? "stroke-granate" : "stroke-paper")} />
          </g>
        );
      })}
    </>
  );
}

function Secuencias({
  xs, y, xFecha, t, elegir, elegida,
}: {
  xs: SecuenciaHistoria[]; y: number; xFecha: (d: string) => number; t: { desde: string; hasta: string }; elegir: (id: string) => void; elegida: string | null;
}) {
  const carriles = Math.min(4, xs.length);
  return (
    <>
      {xs.map((s, i) => {
        const pasos = s.pasos.filter((p) => mesDe(p.fecha) >= t.desde && mesDe(p.fecha) <= t.hasta);
        if (!pasos.length) return null;
        const yy = y + 12 + (i % carriles) * 11;
        const x0 = xFecha(pasos[0].fecha);
        const x1 = xFecha(pasos[pasos.length - 1].fecha);
        const clase = s.severidad === "alta" ? "crimson" : s.severidad === "media" ? "amber" : "mute";
        return (
          <g
            key={s.id}
            role="button"
            tabIndex={0}
            aria-label={s.titulo}
            onClick={(ev) => {
              ev.stopPropagation();
              elegir(s.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                elegir(s.id);
              }
            }}
            className="cursor-pointer focus:outline-none"
          >
            <title>{s.titulo}</title>
            <line x1={x0} x2={Math.max(x1, x0 + 2)} y1={yy} y2={yy} strokeWidth={elegida === s.id ? 4 : 2.5} strokeLinecap="round" className={clase === "crimson" ? "stroke-crimson" : clase === "amber" ? "stroke-amber" : "stroke-mute"} />
            {pasos.map((p, k) => (
              <circle key={k} cx={xFecha(p.fecha)} cy={yy} r={k === pasos.length - 1 ? 4 : 3} strokeWidth={1.5} className={cn(k === pasos.length - 1 ? (clase === "crimson" ? "fill-crimson" : clase === "amber" ? "fill-amber" : "fill-mute") : "fill-paper", clase === "crimson" ? "stroke-crimson" : clase === "amber" ? "stroke-amber" : "stroke-mute")} />
            ))}
            <line x1={x0 - 4} x2={Math.max(x1, x0 + 2) + 4} y1={yy} y2={yy} strokeWidth={12} className="stroke-transparent" />
          </g>
        );
      })}
    </>
  );
}

// ─── El globo y los detalles ────────────────────────────────────────────────────────────────────

interface LineaMes {
  fila: Fila;
  texto: string;
  ev: EventoHistoria[];
  punto: SerieHistoria["puntos"][number] | null;
  /** Lo normal de ese renglón ese mes (la mediana de los doce anteriores) y cuántas veces lo normal fue. */
  normal: { mediana: number; veces: number } | null;
}

/** «3,2 veces lo normal (40)» en ámbar o rojo si es un pico; nada si es como siempre. */
function Normal({ n, min }: { n: { mediana: number; veces: number } | null; min?: number }) {
  if (!n || (n.veces > 0.5 && n.veces < 1.5)) return null;
  const pico = n.veces >= 2.5 && (min == null || n.mediana * n.veces - n.mediana >= min);
  return (
    <span className={cn("font-semibold", pico ? (n.veces >= 4 ? "text-crimsonTexto" : "text-amberTexto") : "text-inkSoft")}>
      {` ${comoLoNormal(n.veces)} (lo normal: ${numero(Math.round(n.mediana))})`}
    </span>
  );
}

function Globo({
  mes, x, y, ancho, lineas, marcas, gestion, patrones,
}: {
  mes: string; x: number; y: number; ancho: number; lineas: LineaMes[]; marcas: Historia["marcas"];
  gestion: { titulo: string; mes: number } | null; patrones: PatronHistoria[];
}) {
  if (!lineas.length && !marcas.length) return null;
  const izquierda = x + 330 > ancho;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 w-[320px] rounded-lg border border-line bg-paper p-3 shadow-lg"
      style={{ left: izquierda ? Math.max(4, x - 332) : x + 14, top: Math.max(4, y - 8) }}
    >
      <p className="text-rotulo font-semibold text-ink">{capital(mesLargo(mes))}</p>
      {gestion && <p className="text-micro text-inkSoft">{`${gestion.titulo}, mes ${gestion.mes} de su gestión`}</p>}
      <ul className="mt-1.5 space-y-1">
        {marcas.map((m) => (
          <li key={m.fecha + m.texto} className="text-micro font-semibold text-ink">
            {m.texto}
          </li>
        ))}
        {/* recorte: el globo es un vistazo; el detalle (al tocar el mes) los tiene todos. */}
        {lineas.filter((l) => l.fila.carril !== "gobierno").slice(0, 8).map((l) => (
          <li key={l.fila.clave} className="text-micro leading-snug text-inkSoft">
            <span className="font-semibold text-ink">{l.fila.titulo}:</span> {l.texto}
            <Normal n={l.normal} min={l.fila.carril ? MINIMO_PICO[l.fila.carril] : undefined} />
            {l.ev.length > 0 && l.punto && (
              <span className="block pl-2 text-mute">{l.ev.length === 1 ? l.ev[0].titulo : `${plural(l.ev.length, "hecho", "hechos")}: ${l.ev[0].titulo}…`}</span>
            )}
          </li>
        ))}
        {patrones.map((p) => (
          <li key={p.id} className={cn("text-micro font-semibold", p.severidad === "alta" ? "text-crimsonTexto" : "text-amberTexto")}>
            {`Llama la atención: ${p.titulo}`}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-micro text-mute">Toca el mes para ver todo con su evidencia</p>
    </div>
  );
}

function Fuente({ texto, href }: { texto: string; href?: string | null }) {
  if (!href) return <span className="text-micro text-mute">Fuente: {texto}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-micro text-mute underline decoration-line underline-offset-2 hover:text-ink">
      Fuente: {texto} <ExternalLink size={11} aria-hidden />
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );
}

function Abrir({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} prefetch={false} className="text-micro font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
      {children}
    </Link>
  );
}

function DetalleMes({
  lineas, marcas, gestion, patrones, elegir,
}: {
  lineas: LineaMes[]; marcas: Historia["marcas"]; gestion: { titulo: string; mes: number } | null; patrones: PatronHistoria[]; elegir: (id: string) => void;
}) {
  if (!lineas.length && !marcas.length) return <p className="text-meta text-inkSoft">Ese mes no tiene datos en ningún renglón.</p>;
  return (
    <div className="space-y-3">
      {gestion && <p className="text-meta text-inkSoft">{`${gestion.titulo}: el mes ${gestion.mes} de su gestión.`}</p>}
      {patrones.map((p) => (
        <div key={p.id} className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2">
          <p className="text-meta font-semibold text-ink">{p.titulo}</p>
          <p className="text-rotulo text-inkSoft">{p.explica}</p>
        </div>
      ))}
      {marcas.map((m) => (
        <p key={m.fecha + m.texto} className="text-meta font-semibold text-ink">
          {fechaCorta(m.fecha)}: {m.texto}
        </p>
      ))}
      <ul className="divide-y divide-line/60">
        {lineas.map((l) => (
          <li key={l.fila.clave} className="space-y-1.5 py-2.5">
            <p className="text-meta text-ink">
              <span className="font-semibold">{l.fila.titulo}.</span> {l.punto && l.fila.serie ? capital(decir(l.fila.serie, l.punto)) : null}
              <Normal n={l.normal} min={l.fila.carril ? MINIMO_PICO[l.fila.carril] : undefined} />
            </p>
            {l.fila.serie && (
              <p className="flex flex-wrap gap-x-3 gap-y-1">
                {l.fila.serie.href && <Abrir href={l.fila.serie.href}>Ver la lista</Abrir>}
                <Fuente texto={l.fila.serie.fuente} href={l.fila.serie.enlace} />
              </p>
            )}
            {l.ev.length > 0 && (
              <ul className="space-y-1">
                {/* recorte: seis por renglón; «y N más» lleva a la lista completa de abajo. */}
                {l.ev.slice(0, 6).map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => elegir(e.id)} className="text-left text-meta text-inkSoft underline decoration-line underline-offset-2 hover:text-ink">
                      {fechaCorta(e.fecha)}: {e.titulo}
                      {e.monto ? `, ${solesCompacto(e.monto)}` : ""}
                    </button>
                  </li>
                ))}
                {l.ev.length > 6 && (
                  <li>
                    <a href="#historia-lista" className="text-micro font-semibold text-granate underline decoration-granate/40 underline-offset-2">
                      Y {numero(l.ev.length - 6)} más en la lista de todos los hechos
                    </a>
                  </li>
                )}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetalleEvento({ e }: { e: EventoHistoria }) {
  return (
    <div className="space-y-2">
      <p className="text-meta text-inkSoft">
        {e.hasta ? `Del ${fechaCorta(e.fecha)} al ${fechaCorta(e.hasta)}` : fechaCorta(e.fecha)}
        {e.monto ? `; ${solesCompacto(e.monto)}` : ""}
        {e.severidad === "alta" ? "; grave" : e.severidad === "media" ? "; medio" : ""}
      </p>
      {e.detalle && <p className="text-meta text-ink">{e.detalle}</p>}
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        {e.href && <Abrir href={e.href}>Ver en Vigía</Abrir>}
        <Fuente texto={e.fuente} href={e.enlace} />
      </p>
    </div>
  );
}

function DetalleSecuencia({ s }: { s: SecuenciaHistoria }) {
  return (
    <div className="space-y-3">
      <p className="text-meta text-inkSoft">{s.explica}</p>
      <LineaHitos hitos={s.pasos.map((p, i) => ({ fecha: p.fecha, texto: p.texto, destacado: i === s.pasos.length - 1 }))} etiqueta={s.titulo} />
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        {s.href && <Abrir href={s.href}>Ver la evidencia</Abrir>}
        <span className="text-micro text-mute">Fuente: {s.fuente}</span>
      </p>
    </div>
  );
}

function Muestra({ children, texto }: { children: ReactNode; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={18} height={14} aria-hidden className="shrink-0">{children}</svg>
      {texto}
    </span>
  );
}

function Leyenda({ hayPicos }: { hayPicos: boolean }) {
  return (
    <div className="space-y-2 rounded-xl border border-line bg-paper px-3.5 py-3 [.tarjeta_&]:border-0 [.tarjeta_&]:bg-transparent [.tarjeta_&]:px-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-rotulo text-inkSoft">
        <Muestra texto="Cuánto hubo ese mes"><rect x={3} y={4} width={4} height={10} rx={1} className="fill-ink/30" /><rect x={9} y={7} width={4} height={7} rx={1} className="fill-ink/30" /></Muestra>
        {hayPicos && <Muestra texto="Pico: 2,5 veces lo normal"><rect x={6} y={2} width={6} height={12} rx={1} className="fill-amber/85" /></Muestra>}
        {hayPicos && <Muestra texto="4 veces lo normal o más"><rect x={6} y={1} width={6} height={13} rx={1} className="fill-crimson/75" /></Muestra>}
        <Muestra texto="Un hecho grave"><circle cx={9} cy={7} r={4.5} className="fill-crimson" /></Muestra>
        <Muestra texto="Medio"><circle cx={9} cy={7} r={4.5} className="fill-amber" /></Muestra>
        <Muestra texto="Sin gravedad (más grande si son varios)"><circle cx={9} cy={7} r={4.5} className="fill-ink/70" /></Muestra>
        <Muestra texto="Cambio de gobierno"><line x1={9} x2={9} y1={1} y2={13} className="stroke-ink/60" strokeWidth={1.5} /></Muestra>
        <Muestra texto="Elección"><line x1={9} x2={9} y1={1} y2={13} className="stroke-ink/35" strokeDasharray="3 3" /></Muestra>
        <Muestra texto="Patrón que llama la atención (arriba del eje)"><circle cx={9} cy={7} r={4} className="fill-amber" /></Muestra>
      </div>
      <details className="group">
        <summary className="cursor-pointer text-rotulo font-semibold text-granate">Cómo leer esta línea</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-rotulo leading-relaxed text-inkSoft">
          <li>Cada renglón es una fuente: las barras dicen cuánto hubo cada mes. Cada renglón tiene su propia escala: compara sus barras entre sí, no con las de otro renglón.</li>
          <li>«Lo normal» de un mes es la mediana de los doce meses anteriores de ese mismo renglón. Una barra ámbar es un pico de 2,5 veces lo normal; roja, de 4 veces o más.</li>
          <li>Las líneas verticales cruzan todos los renglones: la continua es un cambio de gobierno y la punteada, una elección. Mira qué cambia justo después.</li>
          <li>Pasa el mouse por un mes para ver lo de todos los renglones juntos, en qué gestión cae y cuánto se aleja de lo normal. Tócalo para ver cada hecho con su fuente.</li>
          <li>Un pico o una coincidencia no prueba nada: dice dónde mirar. Las razones pueden ser legítimas (una emergencia, un programa, el cierre del año).</li>
        </ul>
      </details>
    </div>
  );
}

/** Lo que llama la atención en sus series (patronesDeSeries de la API): tocar uno lo marca en la línea. */
function Patrones({ xs, elegido, ver }: { xs: PatronHistoria[]; elegido: string | null; ver: (p: PatronHistoria) => void }) {
  // Los cuatro más fuertes a la vista (en el celular, ocho tarjetas empujaban la línea muy abajo); el resto, a un toque.
  const [todos, setTodos] = useState(false);
  const vistos = todos ? xs : xs.slice(0, 4);
  return (
    <section aria-label="Lo que llama la atención en sus datos" className="space-y-2">
      <p className="text-meta font-semibold text-ink">Lo que llama la atención en sus datos</p>
      <ul className="grid gap-2 md:grid-cols-2">
        {vistos.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => ver(p)}
              aria-pressed={elegido === p.id}
              className={cn(
                "flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors duration-rapido",
                elegido === p.id ? "border-granate bg-granate/5" : "border-line bg-paper hover:border-paperEdge",
              )}
            >
              <span aria-hidden className={cn("mt-1.5 inline-block size-2 shrink-0 rounded-full", p.severidad === "alta" ? "bg-crimson" : p.severidad === "media" ? "bg-amber" : "bg-mute")} />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-meta font-semibold leading-snug text-ink">{p.titulo}</span>
                <span className="line-clamp-3 block text-rotulo leading-snug text-inkSoft">{p.explica}</span>
                <span className="block text-rotulo font-semibold text-granate">Verlo en la línea</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {xs.length > 4 && (
        <button type="button" onClick={() => setTodos((v) => !v)} className="text-rotulo font-semibold text-granate underline decoration-granate/40 underline-offset-2">
          {todos ? "Ver menos" : `Ver los ${xs.length} patrones`}
        </button>
      )}
    </section>
  );
}
