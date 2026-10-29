"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronsDownUp, ChevronsUpDown, LocateFixed, Maximize2, Minus, Move, Plus, Search } from "lucide-react";
import { ArbolTabla, type NodoArbol } from "@/components/grafo/ArbolTabla";
import { useLienzoNavegable } from "@/components/grafo/lienzo";
import { SelectorVista, TablaORed } from "@/components/grafo/vista";
import { BotonCerrar, ChipLeyenda, GrafoMarco, type Tono } from "@/components/grafo/primitivos";
import { AyudaTermino, DatosClave, EnlaceFuente, type DatoClave } from "@/components/patrones";
import type { Columna } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { fechaCorta, numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { conTildes } from "@/lib/tildes";
import { cn } from "@/lib/utils";
import { FUNCION_OFICINA } from "@/lib/planilla";
import {
  ARISTA, COMO_SIGLA, hijosDe, nombreOficina, rutaDe, totalesDe, type NodoOrganigrama, type Organigrama,
} from "@/lib/organigrama";
import { planoOrganigrama, type CajaOrg } from "@/lib/organigramaLayout";

/**
 * La organización de una entidad como mapa mental (fase 1 del plan del 2026-10-27): la entidad al centro y sus oficinas
 * a los dos lados, cada una con de dónde sale y de quién depende. La línea continua es una dependencia que dicen los datos
 * (su ROF, la ley, su planilla); la punteada, una inferida o sin dato. Cada rama se abre y se cierra; tocar una oficina
 * abre su detalle al costado: quién la encabeza, su gente, sus señales, sus visitas y las fuentes. La misma organización
 * como tabla plegable (ArbolTabla) es la vista del celular y la alternativa accesible; el mapa, desde lg, con la letra a
 * su tamaño real (12 a 13 px). Se recorre como un mapa (useLienzoNavegable): arrastrando, con la rueda o el pellizco
 * para acercar y alejar, con doble clic y con el teclado (flechas, + y −).
 */

/** De un cuarto a dos veces y media la letra real: alejar sirve para ver la forma entera; acercar, para leer de lejos. */
const ESCALA_MIN = 0.25;
const ESCALA_MAX = 2.5;

const TONO_FUNCION: Partial<Record<NodoOrganigrama["funcion"], Tono>> = {
  alta_direccion: "granate",
  compras: "amber",
  finanzas: "anil",
  presupuesto: "anil",
};
/* Clases literales (Tailwind sólo genera las que ve escritas). */
const BARRA: Record<Tono, string> = { granate: "fill-granate", amber: "fill-amber", anil: "fill-anil", crimson: "fill-crimson", neutro: "fill-line" };

const metaCaja = (n: NodoOrganigrama, t: { oficinas: number; personas: number } | undefined) => {
  if (n.grupo) return plural(t?.oficinas ?? 0, "oficina", "oficinas");
  if (n.ruc) return `Con RUC propio${n.personas ? `, ${plural(n.personas, "persona", "personas")}` : ""}`;
  const rol = n.rol === "titular" ? "Titular" : n.rol === "aga" ? "AGA" : null;
  const gente = !n.enDatos ? "Sólo en la ley" : n.personas ? plural(n.personas, "persona", "personas") : "Sin gente en su planilla";
  return [rol, gente].filter(Boolean).join(", ");
};

export function OrganigramaMapa({ org, ruta, entidad }: { org: Organigrama; ruta: string; entidad: string }) {
  const hijos = useMemo(() => hijosDe(org.nodos), [org.nodos]);
  const porId = useMemo(() => new Map(org.nodos.map((n) => [n.id, n])), [org.nodos]);
  const totales = useMemo(() => totalesDe(org.nodos, hijos), [org.nodos, hijos]);
  // Abiertas al empezar: el primer nivel y, de lo que cuelga, las ramas de hasta 12 oficinas (sin el agrupador de las que
  // no tienen dependencia, que en un ministerio son cientos).
  const inicial = useMemo(() => {
    const s = new Set<string>();
    for (const n of hijos.get(null) ?? []) {
      if (n.grupo && !n.padre && n.id === "SIN DEPENDENCIA EN LOS DATOS") continue;
      s.add(n.id);
      for (const h of hijos.get(n.id) ?? []) if ((hijos.get(h.id)?.length ?? 0) <= 12) s.add(h.id);
    }
    return s;
  }, [hijos]);
  const [abiertos, setAbiertos] = useState<Set<string>>(inicial);
  const [todos, setTodos] = useState<Set<string>>(() => new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [red, setRed] = useState(true);
  const [q, setQ] = useState("");
  // El tamaño: 1 es la letra real (12 a 13 px); alejar sirve para ver la forma entera, no para leer.
  const [escala, setEscala] = useState(1);
  const lienzo = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const nav = useLienzoNavegable(lienzo, svg, escala, setEscala, { min: ESCALA_MIN, max: ESCALA_MAX, activo: red });

  const alternar = (id: string) =>
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  /**
   * Elige una oficina y la trae a la vista, a la izquierda del panel de su detalle (que se abre encima del mapa, a la
   * derecha): si quedaba debajo del panel, el mapa se corre.
   */
  const elegir = (id: string) => {
    setSel(id);
    // Después de dibujar (al venir del buscador, la rama recién abierta todavía no estaba).
    window.setTimeout(() => {
      const el = lienzo.current;
      const g = el?.querySelector(`[data-org="${CSS.escape(id)}"]`);
      if (!el || !g) return;
      const a = el.getBoundingClientRect();
      const b = g.getBoundingClientRect();
      const visible = el.clientWidth - Math.min(368, el.clientWidth * 0.5);
      const x = b.left - a.left;
      const y = b.top - a.top;
      el.scrollBy({
        left: x < 16 || x + b.width > visible - 16 ? x - (visible - b.width) / 2 : 0,
        top: y < 16 || y + b.height > el.clientHeight - 16 ? y - (el.clientHeight - b.height) / 2 : 0,
        behavior: "smooth",
      });
    }, 60);
  };
  /** Abre las ramas hasta una oficina y la elige (el buscador, «Depende de» en el detalle). */
  const ir = (id: string) => {
    setAbiertos((s) => new Set([...s, ...rutaDe(id, porId).slice(0, -1)]));
    elegir(id);
  };

  const raizLineas = useMemo(() => {
    const nombre = tituloNatural(conTildes(entidad));
    const ls: string[] = [];
    for (const w of nombre.split(" ")) {
      const ult = ls[ls.length - 1];
      if (ult && (ult + " " + w).length <= 30) ls[ls.length - 1] = `${ult} ${w}`;
      else ls.push(w);
    }
    return ls.slice(0, 3);
  }, [entidad]);
  const plano = useMemo(() => planoOrganigrama(hijos, abiertos, todos, nombreOficina, raizLineas), [hijos, abiertos, todos, raizLineas]);

  // Al abrir el mapa: la entidad a un tercio del ancho (la rama grande va a la derecha) y en el medio de la altura.
  useEffect(() => {
    const el = lienzo.current;
    if (!el || !red) return;
    const x = (-plano.vista.x) * escala;
    const y = (-plano.vista.y) * escala;
    // La rama grande va a la derecha: la entidad, cerca del borde izquierdo (lo de su izquierda sigue a la vista).
    el.scrollLeft = Math.max(0, x - el.clientWidth * 0.25);
    el.scrollTop = Math.max(0, y - el.clientHeight / 2);
    // Sólo al montar o al volver al mapa: no cada vez que se abre una rama.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [red]);
  /** Que entre entero, centrado. */
  const verTodo = () => nav.encajar(plano.vista.w, plano.vista.h);
  /** La entidad (la raíz del mapa) al centro de lo que se ve. */
  const centrarEntidad = () =>
    nav.centrarEn(plano.raiz.x + plano.raiz.w / 2 - plano.vista.x, plano.raiz.y + plano.raiz.h / 2 - plano.vista.y);

  const encontradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return org.nodos
      .filter((n) => !n.grupo && (nombreOficina(n).toLowerCase().includes(t) || (n.sigla ?? "").toLowerCase().includes(t) || n.jefes.some((j) => (j.cargo ?? "").toLowerCase().includes(t))))
      .slice(0, 8);
  }, [q, org.nodos]);

  const elegido = sel ? porId.get(sel) ?? null : null;
  const detalle = elegido ? <DetalleOficina n={elegido} porId={porId} totales={totales} ruta={ruta} alElegir={ir} /> : null;

  const mapa = (
    <div className="space-y-2">
      <Leyenda />
      <p className="flex items-center gap-1.5 text-rotulo text-mute">
        <Move size={14} aria-hidden className="shrink-0" />
        Arrastra con el mouse para moverte; la rueda (o el pellizco) acerca y aleja donde está el puntero; doble clic acerca. Con el
        teclado: flechas, + y −.
      </p>
      <GrafoMarco>
        <div className="relative">
        <div
          ref={lienzo}
          tabIndex={0}
          role="region"
          aria-label="Mapa de la organización: arrastra para moverte y usa la rueda para acercar o alejar; con el teclado, flechas, + y −"
          className="max-h-[72vh] min-h-[420px] cursor-grab touch-none select-none overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
          {...nav.manejadores}
        >
          <svg
            ref={svg}
            width={plano.vista.w * escala}
            height={plano.vista.h * escala}
            viewBox={`${plano.vista.x} ${plano.vista.y} ${plano.vista.w} ${plano.vista.h}`}
            role="group"
            aria-label={`Organización de ${tituloNatural(conTildes(entidad))}: ${plural(org.resumen.oficinas, "oficina", "oficinas")}`}
            className="mx-auto block"
          >
            {plano.lineas.map((l) => (
              <path
                key={`l-${l.a}`}
                d={l.d}
                className={cn("fill-none", l.inferida ? "stroke-mute" : "stroke-inkSoft")}
                strokeOpacity={l.inferida ? 0.7 : 0.45}
                strokeWidth={1.2}
                strokeDasharray={l.inferida ? "4 4" : undefined}
              />
            ))}
            <Raiz r={plano.raiz} plantilla={org.plantilla?.nombre ?? null} />
            {plano.cajas.map((c) => {
              if (c.mas) {
                return (
                  <g
                    key={c.id}
                    transform={`translate(${c.x},${c.y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Ver ${c.lineas[0]}`}
                    onClick={() => setTodos((s) => new Set([...s, c.mas!.de]))}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTodos((s) => new Set([...s, c.mas!.de])); } }}
                    className="cursor-pointer focus:outline-none [&:focus-visible>rect]:stroke-granate"
                  >
                    <rect width={c.w} height={c.h} rx={10} className="fill-paperSoft stroke-line" strokeDasharray="4 3" />
                    <text x={12} y={21} className="fill-granate font-semibold" style={{ fontSize: "12.5px" }}>{c.lineas[0]}</text>
                  </g>
                );
              }
              const n = porId.get(c.id)!;
              return (
                <Caja
                  key={c.id}
                  c={c}
                  n={n}
                  meta={metaCaja(n, totales.get(n.id))}
                  elegida={sel === n.id}
                  abierta={abiertos.has(n.id)}
                  nHijos={hijos.get(n.id)?.length ?? 0}
                  alElegir={() => elegir(n.id)}
                  alAlternar={() => alternar(n.id)}
                />
              );
            })}
          </svg>
        </div>
        {/* El tamaño, en la esquina del lienzo: alejar, cuánto, acercar, verlo entero y la entidad al centro. */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full border border-line bg-paper p-1 shadow-sm">
          <BotonZoom etiqueta="Alejar" onClick={() => nav.zoomEn(escala / 1.25)}><Minus size={15} aria-hidden /></BotonZoom>
          <span className="min-w-[3.25rem] text-center font-mono text-rotulo tabular-nums text-inkSoft" aria-live="polite">{`${Math.round(escala * 100)} %`}</span>
          <BotonZoom etiqueta="Acercar" onClick={() => nav.zoomEn(escala * 1.25)}><Plus size={15} aria-hidden /></BotonZoom>
          <BotonZoom etiqueta="Ver todo el mapa" onClick={verTodo}><Maximize2 size={14} aria-hidden /></BotonZoom>
          <BotonZoom etiqueta="Llevar la entidad al centro" onClick={centrarEntidad}><LocateFixed size={15} aria-hidden /></BotonZoom>
          {escala !== 1 && (
            <button type="button" onClick={() => nav.zoomEn(1)} className="min-h-[32px] rounded-full px-2.5 text-rotulo font-semibold text-granate hover:bg-paperSoft">
              Tamaño real
            </button>
          )}
        </div>
        {/* El detalle de la oficina elegida, encima del mapa a la derecha (el mapa usa todo el ancho). */}
        {elegido && (
          <aside
            aria-label={`Detalle de ${nombreOficina(elegido)}`}
            className="absolute inset-y-0 right-0 w-full max-w-[23rem] overflow-y-auto border-l border-line bg-paper p-4 shadow-xl"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <h4 className="font-display text-dato font-bold leading-snug text-ink text-pretty">{nombreOficina(elegido)}</h4>
              <BotonCerrar onClick={() => setSel(null)} />
            </div>
            {detalle}
          </aside>
        )}
        </div>
      </GrafoMarco>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorVista red={red} onCambio={setRed} etiquetaRed="Mapa mental" />
        <div className="relative min-w-0 flex-1 basis-60">
          <label className="sr-only" htmlFor="org-buscar">Buscar una oficina, una sigla o un cargo</label>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
          <input
            id="org-buscar"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar una oficina, una sigla o un cargo…"
            className="min-h-[40px] w-full rounded-full border border-line bg-paper pl-9 pr-4 text-meta text-ink placeholder:text-mute focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
          />
          {encontradas.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-paper shadow-lg">
              {encontradas.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => { ir(n.id); setQ(""); }}
                    className="flex w-full min-h-[40px] items-center justify-between gap-3 px-3.5 py-2 text-left text-meta text-ink hover:bg-paperSoft focus-visible:bg-paperSoft focus-visible:outline-none"
                  >
                    <span className="min-w-0 truncate">{nombreOficina(n)}</span>
                    {n.sigla && <span className="shrink-0 font-mono text-rotulo text-mute">{n.sigla}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {red && (
          <div className="hidden items-center gap-1 lg:flex">
            <button
              type="button"
              onClick={() => setAbiertos(new Set(org.nodos.filter((n) => (hijos.get(n.id)?.length ?? 0) > 0 && n.id !== "SIN DEPENDENCIA EN LOS DATOS").map((n) => n.id)))}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-meta font-medium text-inkSoft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
            >
              <ChevronsUpDown size={15} aria-hidden /> Abrir todo
            </button>
            <button
              type="button"
              onClick={() => setAbiertos(new Set((hijos.get(null) ?? []).filter((n) => n.id !== "SIN DEPENDENCIA EN LOS DATOS").map((n) => n.id)))}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-meta font-medium text-inkSoft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
            >
              <ChevronsDownUp size={15} aria-hidden /> Cerrar todo
            </button>
          </div>
        )}
      </div>
      <TablaORed red={red} tabla={<TablaOrganizacion hijos={hijos} porId={porId} totales={totales} ruta={ruta} />} grafo={mapa} />
    </div>
  );
}

/** La entidad, al centro. */
function Raiz({ r, plantilla }: { r: { x: number; y: number; w: number; h: number; lineas: string[] }; plantilla: string | null }) {
  const alto = r.lineas.length * 16;
  const y0 = r.y + r.h / 2 - alto / 2 + 12 - (plantilla ? 7 : 0);
  return (
    <g aria-hidden>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={14} className="fill-granate/10 stroke-granate" strokeWidth={1.5} />
      {r.lineas.map((t, i) => (
        <text key={i} x={r.x + r.w / 2} y={y0 + i * 16} textAnchor="middle" className="fill-ink font-semibold" style={{ fontSize: "13px" }}>{t}</text>
      ))}
      {plantilla && (
        <text x={r.x + r.w / 2} y={y0 + r.lineas.length * 16 + 2} textAnchor="middle" className="fill-inkSoft" style={{ fontSize: "12px" }}>{plantilla}</text>
      )}
    </g>
  );
}

function Caja({
  c, n, meta, elegida, abierta, nHijos, alElegir, alAlternar,
}: {
  c: CajaOrg; n: NodoOrganigrama; meta: string; elegida: boolean; abierta: boolean; nHijos: number; alElegir: () => void; alAlternar: () => void;
}) {
  const tono = TONO_FUNCION[n.funcion] ?? "neutro";
  const etiqueta = `${nombreOficina(n)}${n.sigla ? ` (${n.sigla})` : ""}: ${meta}`;
  const px = c.lado === 1 ? c.x + c.w + 4 : c.x - 34;
  return (
    <g data-org={n.id}>
      <g
        transform={`translate(${c.x},${c.y})`}
        role="button"
        tabIndex={0}
        aria-label={etiqueta}
        aria-pressed={elegida}
        onClick={alElegir}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alElegir(); } }}
        className="cursor-pointer focus:outline-none [&:focus-visible>rect.caja]:stroke-granate [&:focus-visible>rect.caja]:stroke-2"
      >
        <rect
          className={cn("caja", n.grupo || !n.enDatos ? "fill-paperSoft" : "fill-paper", elegida ? "stroke-granate" : "stroke-line")}
          width={c.w}
          height={c.h}
          rx={10}
          strokeWidth={elegida ? 2 : 1}
          strokeDasharray={n.enDatos || n.grupo ? undefined : "4 3"}
        />
        {!n.grupo && <rect x={0} y={6} width={4} height={c.h - 12} rx={2} className={BARRA[tono]} />}
        {c.lineas.map((t, i) => (
          <text key={i} x={12} y={18 + i * 15} className={cn("font-semibold", n.enDatos || n.grupo ? "fill-ink" : "fill-inkSoft")} style={{ fontSize: "12.5px" }}>
            {t}
          </text>
        ))}
        <text x={12} y={c.h - 9} className="fill-inkSoft" style={{ fontSize: "12px" }}>{meta}</text>
      </g>
      {nHijos > 0 && (
        <g
          transform={`translate(${px},${c.y + c.h / 2 - 10})`}
          role="button"
          tabIndex={0}
          aria-expanded={abierta}
          aria-label={`${abierta ? "Cerrar" : "Abrir"} ${nHijos === 1 ? "la oficina que depende" : `las ${numero(nHijos)} oficinas que dependen`} de ${nombreOficina(n)}`}
          onClick={alAlternar}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alAlternar(); } }}
          className="cursor-pointer focus:outline-none [&:focus-visible>rect]:stroke-granate [&:focus-visible>rect]:stroke-2"
        >
          <rect width={30} height={20} rx={10} className={abierta ? "fill-paper stroke-line" : "fill-granate stroke-granate"} />
          <text x={15} y={14} textAnchor="middle" className={abierta ? "fill-inkSoft font-semibold" : "fill-paper font-semibold"} style={{ fontSize: "12px" }}>
            {abierta ? "−" : `+${nHijos > 99 ? "99" : nHijos}`}
          </text>
        </g>
      )}
    </g>
  );
}

function BotonZoom({ etiqueta, onClick, children }: { etiqueta: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-inkSoft transition-colors duration-rapido hover:bg-paperSoft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
    >
      {children}
    </button>
  );
}

function Leyenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="text-rotulo font-semibold uppercase tracking-wide text-mute">Cómo leerlo</span>
      <ChipLeyenda tono="granate">Quién decide (alta dirección)</ChipLeyenda>
      <ChipLeyenda tono="amber">Quién compra</ChipLeyenda>
      <ChipLeyenda tono="anil">Quién paga y arma el presupuesto</ChipLeyenda>
      <span className="flex items-center gap-1.5 text-rotulo text-mute">
        <svg width={22} height={10} aria-hidden className="shrink-0"><line x1={0} y1={5} x2={22} y2={5} className="stroke-inkSoft" strokeWidth={1.5} /></svg>
        Depende según su ROF, la ley o su planilla
      </span>
      <span className="flex items-center gap-1.5 text-rotulo text-mute">
        <svg width={22} height={10} aria-hidden className="shrink-0"><line x1={0} y1={5} x2={22} y2={5} className="stroke-mute" strokeWidth={1.5} strokeDasharray="4 4" /></svg>
        Inferida o sin dato: puede no ser exacta
      </span>
      <span className="flex items-center gap-1.5 text-rotulo text-mute">
        <svg width={22} height={14} aria-hidden className="shrink-0"><rect x={1} y={1} width={20} height={12} rx={4} className="fill-paperSoft stroke-line" strokeDasharray="3 2" /></svg>
        Sólo en la ley: no aparece en sus datos
      </span>
    </div>
  );
}

/** El detalle de una oficina: el panel del mapa y el de la tabla. */
export function DetalleOficina({
  n, porId, totales, ruta, alElegir,
}: {
  n: NodoOrganigrama;
  porId: Map<string, NodoOrganigrama>;
  totales: Map<string, { oficinas: number; personas: number }>;
  ruta: string;
  alElegir?: (id: string) => void;
}) {
  const padre = n.padre ? porId.get(n.padre) : undefined;
  const t = totales.get(n.id);
  const a = n.arista ? ARISTA[n.arista.tipo] : null;
  const datos: DatoClave[] = [
    ...(n.enDatos && !n.grupo
      ? [{ etiqueta: "Personas", valor: n.personas ? `${numero(n.personas)}${n.cas ? `, ${numero(n.cas)} CAS` : ""}` : "Ninguna en su planilla" }]
      : []),
    ...(n.planilla ? [{ etiqueta: "Sueldos al mes", valor: solesCompacto(n.planilla), mono: true }] : []),
    ...(n.conSenales ? [{ etiqueta: "Con señales", valor: `${numero(n.conSenales)}${n.altas ? `, ${numero(n.altas)} de severidad alta` : ""}` }] : []),
    ...(n.conFamilia ? [{ etiqueta: "Con un familiar en la entidad", valor: plural(n.conFamilia, "persona", "personas") }] : []),
    ...(n.visitas ? [{ etiqueta: "Visitas registradas", valor: `${numero(n.visitas)}${n.ultimaVisita ? `, la última el ${fechaCorta(n.ultimaVisita)}` : ""}` }] : []),
    ...(t && t.oficinas ? [{ etiqueta: "Dependen de ella", valor: `${plural(t.oficinas, "oficina", "oficinas")}, ${plural(t.personas - n.personas, "persona", "personas")}` }] : []),
  ];
  const conPlanilla = n.dependencias[0];
  return (
    <div className="space-y-4 text-meta">
      {n.sigla && n.expansion && (
        <p className="text-inkSoft">
          Su planilla la escribe <span className="font-mono text-ink">{n.sigla}</span>; la leímos con {COMO_SIGLA[n.expansion.como]}.
          {n.expansion.alternativas.length > 0 && <> También podría ser {n.expansion.alternativas.map((x) => tituloNatural(conTildes(x))).join(" o ")}.</>}
        </p>
      )}
      {n.cortado && <p className="text-inkSoft">El Portal de Transparencia corta este nombre a 45 caracteres y ninguna otra fuente lo trae entero.</p>}
      {n.rol && (
        <p className="flex flex-wrap items-center gap-1 rounded-lg bg-granate/10 px-3 py-2 text-ink">
          {n.rol === "titular" ? (
            <>
              <span className="font-semibold">Titular de la entidad</span> <AyudaTermino clave="titular" />
            </>
          ) : (
            <>
              <span className="font-semibold">Aprueba las contrataciones (AGA)</span> <AyudaTermino clave="aga" />
              <EnlaceFuente href="https://leyes.congreso.gob.pe/Documentos/2021_2026/ADLP/Texto_Consolidado/32069-TXM.pdf">Ley 32069, art. 25</EnlaceFuente>
            </>
          )}
        </p>
      )}
      <section className="space-y-1">
        <h5 className="text-rotulo font-semibold uppercase tracking-wide text-mute">Depende de</h5>
        {padre ? (
          <p className="text-ink">
            {alElegir ? (
              <button type="button" onClick={() => alElegir(padre.id)} className="font-semibold text-granate underline-offset-2 hover:underline">
                {nombreOficina(padre)}
              </button>
            ) : (
              <span className="font-semibold">{nombreOficina(padre)}</span>
            )}
          </p>
        ) : (
          <p className="text-ink">De la entidad directamente</p>
        )}
        {a && n.arista && (
          <p className={cn("rounded-lg px-3 py-2", a.inferida ? "bg-paperSoft text-inkSoft" : "bg-paperSoft text-ink")}>
            <span className="font-semibold">{a.corto}.</span> {n.arista.texto}.{" "}
            {n.arista.url && <EnlaceFuente href={n.arista.url}>Ver la fuente</EnlaceFuente>}
          </p>
        )}
      </section>
      {n.jefes.length > 0 && (
        <section className="space-y-1.5">
          <h5 className="text-rotulo font-semibold uppercase tracking-wide text-mute">Quién la encabeza</h5>
          <ul className="space-y-2">
            {n.jefes.slice(0, 4).map((j) => (
              <li key={`${j.nombre}-${j.cargo}`} className="space-y-0.5">
                {j.ficha ? (
                  <Link href={`/app/personas/planilla/${j.ficha}`} prefetch={false} className="font-semibold text-granate underline-offset-2 hover:underline">{j.nombre}</Link>
                ) : (
                  <span className="font-semibold text-ink">{j.nombre}</span>
                )}
                <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-rotulo text-inkSoft">
                  {j.cargo && <Dato tipo="cargo">{tituloNatural(conTildes(j.cargo))}</Dato>}
                  <Dato tipo="documento" nombre="Fuente">{j.fuente === "dji" ? "Su declaración jurada (DJI)" : "Su planilla"}</Dato>
                  {j.desde && <Dato tipo="fecha" nombre="Desde">{`desde ${fechaCorta(j.desde)}`}</Dato>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {datos.length > 0 && <DatosClave items={datos} />}
      {n.funcion !== "otras" && !n.grupo && (
        <p className="text-inkSoft">
          Función por su nombre: <span className="text-ink">{FUNCION_OFICINA[n.funcion]}</span>.
        </p>
      )}
      <section className="space-y-1.5">
        <h5 className="text-rotulo font-semibold uppercase tracking-wide text-mute">De dónde sale</h5>
        <ul className="space-y-1.5">
          {n.evidencias.map((e, i) => (
            <li key={i} className="text-inkSoft">
              {e.texto}.{" "}
              {e.url && <EnlaceFuente href={e.url}>{e.tipo === "ley" ? "La ley" : e.tipo === "rof" ? "La norma en El Peruano" : e.tipo === "dji" ? "Sus declaraciones juradas" : e.tipo === "entidad" ? "La norma (copia del texto oficial)" : "Su planilla en el Portal de Transparencia"}</EnlaceFuente>}
            </li>
          ))}
          {n.grupo && <li className="text-inkSoft">Agrupa oficinas: no es una oficina.</li>}
        </ul>
      </section>
      {n.ruc && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/entidad/${n.ruc}?seccion=organizacion`}
            prefetch={false}
            className="inline-flex min-h-[40px] items-center rounded-full bg-granate px-4 py-1.5 text-meta font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
          >
            Ver su organización
          </Link>
          <Link
            href={`/entidad/${n.ruc}`}
            prefetch={false}
            className="inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-meta font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
          >
            Abrir su ficha
          </Link>
        </div>
      )}
      {conPlanilla && (
        <Link
          href={`${ruta}?seccion=planilla&lofi=${encodeURIComponent(conPlanilla)}`}
          prefetch={false}
          className="inline-flex min-h-[40px] items-center rounded-full bg-granate px-4 py-1.5 text-meta font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
        >
          Ver su gente en la planilla
        </Link>
      )}
    </div>
  );
}

const COLUMNAS: Columna[] = [
  { clave: "oficina", titulo: "Oficina", ancho: "minmax(0,1.5fr)" },
  { clave: "depende", titulo: "Por qué cuelga ahí", corto: "Depende", ancho: "9rem", desde: "md", apilar: "con-rotulo" },
  { clave: "jefe", titulo: "Quién la encabeza", corto: "Jefatura", ancho: "minmax(0,1fr)", desde: "lg", apilar: "con-rotulo" },
  { clave: "personas", titulo: "Personas", ancho: "6rem", alinear: "der" },
];

/** La organización como tabla plegable: la vista del celular y la alternativa accesible del mapa. */
function TablaOrganizacion({
  hijos, porId, totales, ruta,
}: {
  hijos: Map<string | null, NodoOrganigrama[]>;
  porId: Map<string, NodoOrganigrama>;
  totales: Map<string, { oficinas: number; personas: number }>;
  ruta: string;
}) {
  const fila = (n: NodoOrganigrama, propia = false): NodoArbol => {
    const t = totales.get(n.id);
    const celdas: Record<string, ReactNode> = {
      oficina: (
        <span className="block min-w-0">
          <span className={cn("block font-semibold text-pretty", n.enDatos || n.grupo ? "text-ink" : "text-inkSoft")}>
            {propia ? "La oficina" : nombreOficina(n)}
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-rotulo text-inkSoft">
            {!propia && n.sigla && <Dato tipo="codigo" nombre="Sigla en la planilla" mono>{n.sigla}</Dato>}
            {!propia && n.rol && <Dato tipo="tipo" nombre="Rol">{n.rol === "titular" ? "Titular" : "Aprueba las contrataciones (AGA)"}</Dato>}
            {!propia && !n.enDatos && !n.grupo && <Dato tipo="tipo" nombre="Fuente">Sólo en la ley</Dato>}
            {!propia && t && t.oficinas > 0 && <Dato tipo="dependencia" nombre="Dependen de ella">{plural(t.oficinas, "oficina", "oficinas")}</Dato>}
          </span>
        </span>
      ),
      depende: n.arista && !propia ? <span className={cn("text-meta", ARISTA[n.arista.tipo].inferida ? "text-mute" : "text-inkSoft")}>{ARISTA[n.arista.tipo].corto}</span> : null,
      jefe: n.jefes[0] ? <span className="block truncate text-meta text-ink">{n.jefes[0].nombre}</span> : null,
      personas: <span className="text-meta tabular-nums text-ink">{numero(propia ? n.personas : t?.personas ?? n.personas)}</span>,
    };
    const hs = hijos.get(n.id) ?? [];
    const detalle = {
      titulo: nombreOficina(n),
      contenido: <DetalleOficina n={n} porId={porId} totales={totales} ruta={ruta} />,
    };
    if (!hs.length || propia) return { id: propia ? `${n.id}::propia` : n.id, celdas, detalle };
    // Una rama: su primera fila es la oficina misma (abre su detalle); después, lo que depende de ella.
    return { id: n.id, celdas, hijos: [...(n.grupo ? [] : [fila(n, true)]), ...hs.map((h) => fila(h))] };
  };
  const nodos = (hijos.get(null) ?? []).map((n) => fila(n));
  return <ArbolTabla columnas={COLUMNAS} nodos={nodos} etiqueta="Oficinas de la entidad y de quién depende cada una" inicial={(hijos.get(null) ?? []).filter((n) => !n.grupo).map((n) => n.id)} densidad="compacta" />;
}

