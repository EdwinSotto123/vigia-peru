"use client";

/**
 * La red del proveedor en carriles (reemplaza al grafo polar de RelationshipGraph, plan 2026-11-04), de izquierda a
 * derecha: las personas del proveedor → el proveedor → sus empresas vinculadas → la entidad y sus funcionarios → los
 * otros postores y contratos. Los nodos son botones HTML con letra real (13 px el nombre, 12 px su dato), nunca un
 * texto de SVG que se achica; las aristas, un SVG encima, medido sobre el contenedor con ResizeObserver, con el color
 * de su relación (tonos de components/grafo/primitivos: día y noche sin hex).
 *
 * La relación no se escribe sobre la arista (con varias se encimaban): al pasar el mouse o enfocar a alguien, sus
 * vecinos dicen en su segunda línea por qué están unidos, y el panel del nodo (ui/Panel) los lista todos.
 *
 * Sólo van los carriles con alguien, cada uno de 128 px como mínimo: si faltan unos pocos px (la columna del informe a
 * 1440 con su barra lateral), la red se desliza de costado; si faltan más (el celular, una tableta), sin SVG: cada carril
 * es una lista y cada nodo dice «vinculado a … por …». Desde ahí (y desde el escritorio) un botón abre la red a pantalla
 * completa, como grafo, para recorrerla arrastrando y pellizcando (components/grafo/lienzo). Mismos datos y enmascarado
 * que antes (`buildRelationshipGraphData`).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, Minus, Plus, Scan, X } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { useLienzoNavegable } from "@/components/grafo/lienzo";
import { aristaTono, chipTono, type Tono } from "@/components/grafo/primitivos";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";
import type { GraphEdge, GraphNode } from "../types";
import { CuerpoNodo, ETIQUETA_NODO, PieNodo, tituloNodo, type VinculoNodo } from "./NodeDetailPanel";
import { buildRelationshipGraphData } from "./RelationshipGraph.layout";

type Grupo = "riesgo" | "politica" | "familia" | "negocio" | "estado";

const CARRILES: { id: string; titulo: string; kinds: GraphNode["kind"][] }[] = [
  { id: "personas", titulo: "Personas del proveedor", kinds: ["person", "pareja", "party", "partido_compartido", "cargo_pasado", "municipio_familiar"] },
  { id: "proveedor", titulo: "El proveedor", kinds: ["company_main"] },
  { id: "empresas", titulo: "Empresas vinculadas", kinds: ["company_titular", "company_domicilio", "socio_postor_conflicto"] },
  { id: "entidad", titulo: "La entidad y sus funcionarios", kinds: ["entidad", "alcalde", "funcionario_designado", "autoridad", "firmante_conflicto", "entidad_secundaria"] },
  { id: "competencia", titulo: "Otros postores y contratos", kinds: ["postor_rival", "contract"] },
];

const GRUPO: Record<GraphEdge["kind"], Grupo> = {
  titular: "negocio", contrato: "negocio", adjudicacion: "negocio", compitio: "negocio",
  domicilio: "riesgo", firma_conflicto: "riesgo", conflicto_funcionario: "riesgo", socio_de: "riesgo", visito: "riesgo",
  doble_vinculacion: "riesgo",
  candidato: "politica", aporte: "politica", cargo: "politica", mismo_partido_que: "politica", partido_de: "politica",
  pareja: "familia",
  autoridad: "estado", preside_entidad: "estado", designado_por: "estado", trabaja_en: "estado",
};

/** El tono de cada relación, del mismo juego que los grafos del mapa de poder (`Tono`). */
const TONO_GRUPO: Record<Grupo, Tono> = { riesgo: "crimson", politica: "amber", familia: "anil", negocio: "granate", estado: "neutro" };
const NOMBRE_GRUPO: Record<Grupo, string> = {
  riesgo: "Conflicto o cruce de riesgo",
  politica: "Política: aportes, candidaturas, cargos",
  familia: "Familia",
  negocio: "Titularidad, contratos, competencia",
  estado: "Cargos y designaciones en la entidad",
};
/* Clases LITERALES (Tailwind sólo genera las que ve escritas). La arista neutra va en `mute`: la `line` de los grafos del
   mapa de poder casi no se ve sobre el fondo de un carril. */
const trazoDe = (g: Grupo) => (TONO_GRUPO[g] === "neutro" ? "stroke-mute" : aristaTono(TONO_GRUPO[g]));
const TEXTO_GRUPO: Record<Grupo, string> = {
  riesgo: "text-crimsonTexto",
  politica: "text-amberTexto",
  familia: "text-anilTexto",
  negocio: "text-granate",
  estado: "text-inkSoft",
};

const ETIQUETA: Record<GraphEdge["kind"], string> = {
  titular: "es titular de", domicilio: "mismo domicilio", candidato: "fue candidato", aporte: "aportó a", cargo: "tuvo el cargo",
  contrato: "contrató", pareja: "pareja o familia", autoridad: "autoridad", firma_conflicto: "firmó con conflicto",
  adjudicacion: "le adjudicó", preside_entidad: "preside", designado_por: "designado por",
  conflicto_funcionario: "funcionario en conflicto", trabaja_en: "trabaja en", mismo_partido_que: "mismo partido",
  partido_de: "partido de", compitio: "compitió", socio_de: "socio de", visito: "visitó", doble_vinculacion: "doble vínculo",
};

const NODO_RIESGO = new Set<GraphNode["kind"]>(["firmante_conflicto", "socio_postor_conflicto", "company_domicilio"]);
const POR_CARRIL = 8;
/**
 * El ancho mínimo de un carril con letra real (13 px, nombres en dos líneas) y el hueco entre carriles (por donde pasan
 * las curvas). Sólo cuentan los carriles con alguien: sin empresas vinculadas, los otros cuatro se reparten el ancho.
 */
const ANCHO_CARRIL = 128;
const HUECO = 28;
/**
 * Cuánto puede faltar para que los carriles entren: hasta ahí la red se desliza de costado dentro de su caja (en una
 * columna de ~730 px a 1440, con la barra lateral del informe); con más, va como listas.
 */
const HOLGURA = 80;
/** El ancho del grafo a pantalla completa (a escala 1): los cinco carriles con nombres de dos líneas. */
const ANCHO_GRAFO = 1180;

const relacionDe = (e: GraphEdge) => redactDnis(e.label || ETIQUETA[e.kind] || e.kind) as ReactNode;
const textoRelacion = (e: GraphEdge) => String(e.label || ETIQUETA[e.kind] || e.kind);

type Caja = { l: number; t: number; r: number; b: number; cy: number };
type Trazo = { id: string; d: string; grupo: Grupo; de: string; a: string };

function camino(s: Caja, d: Caja, ls: number, ld: number): string {
  if (ls < ld) {
    const dx = Math.max(24, (d.l - s.r) / 2);
    return `M${s.r},${s.cy} C${s.r + dx},${s.cy} ${d.l - dx},${d.cy} ${d.l},${d.cy}`;
  }
  if (ls > ld) {
    const dx = Math.max(24, (s.l - d.r) / 2);
    return `M${s.l},${s.cy} C${s.l - dx},${s.cy} ${d.r + dx},${d.cy} ${d.r},${d.cy}`;
  }
  const x = Math.max(s.r, d.r) + 18;
  return `M${s.r},${s.cy} C${x},${s.cy} ${x},${d.cy} ${d.r},${d.cy}`;
}

/** Lo que comparten la vista en línea y la de pantalla completa: los nodos por carril y los vecinos de cada uno. */
interface Red {
  nodos: GraphNode[];
  aristas: GraphEdge[];
  carrilDe: Map<string, number>;
  porCarril: GraphNode[][];
  vecinos: Map<string, { otro: string; arista: GraphEdge }[]>;
  nombre: (id: string) => string;
}

export function RedProveedor({ person, web, proveedor, ctx }: { person: any; web: any; proveedor: any; ctx?: any }) {
  const router = useRouter();
  const datos = useMemo(() => buildRelationshipGraphData(person, web, proveedor, ctx), [person, web, proveedor, ctx]);
  const red = useMemo<Red | null>(() => {
    if (!datos?.nodes.length) return null;
    const nodos = datos.nodes;
    const aristas = datos.edges;
    const carrilDe = new Map<string, number>();
    for (const n of nodos) {
      const i = CARRILES.findIndex((c) => c.kinds.includes(n.kind));
      carrilDe.set(n.id, i < 0 ? CARRILES.length - 1 : i);
    }
    const porCarril = CARRILES.map((_, i) => nodos.filter((n) => carrilDe.get(n.id) === i));
    const vecinos = new Map<string, { otro: string; arista: GraphEdge }[]>();
    for (const e of aristas) {
      (vecinos.get(e.from) ?? vecinos.set(e.from, []).get(e.from)!).push({ otro: e.to, arista: e });
      (vecinos.get(e.to) ?? vecinos.set(e.to, []).get(e.to)!).push({ otro: e.from, arista: e });
    }
    const porId = new Map(nodos.map((n) => [n.id, n]));
    return { nodos, aristas, carrilDe, porCarril, vecinos, nombre: (id: string) => porId.get(id)?.label ?? "" };
  }, [datos]);

  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [completa, setCompleta] = useState(false);
  const [estrecho, setEstrecho] = useState(false);
  // El último nodo abierto queda en el panel mientras se cierra (su animación): sin él, el panel se vaciaría antes.
  const ultimo = useRef<GraphNode | null>(null);

  if (!red) return null;

  const nodoSel = sel ? red.nodos.find((n) => n.id === sel) ?? null : null;
  if (nodoSel) ultimo.current = nodoSel;
  const enPanel = ultimo.current;
  const vinculosPanel: VinculoNodo[] = enPanel
    ? (red.vecinos.get(enPanel.id) ?? []).map((v) => ({
        relacion: textoRelacion(v.arista),
        con: red.nombre(v.otro),
        punto: chipTono(TONO_GRUPO[GRUPO[v.arista.kind] ?? "negocio"]),
      }))
    : [];
  const grupos = Array.from(new Set(red.aristas.map((e) => GRUPO[e.kind] ?? "negocio")));
  const alternar = (id: string) =>
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const elegir = (id: string) => setSel((s) => (s === id ? null : id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        {grupos.length > 0 && (
          <ul className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1" aria-label="Qué significa cada color de vínculo">
            {grupos.map((g) => (
              <li key={g} className="inline-flex items-center gap-1.5 text-rotulo text-inkSoft">
                <span className={cn("h-1 w-4 rounded-full", chipTono(TONO_GRUPO[g]))} aria-hidden />
                {NOMBRE_GRUPO[g]}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setCompleta(true)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-paperEdge hover:bg-paperDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          <Maximize2 size={14} aria-hidden />
          {estrecho ? "Ver la red como grafo" : "Pantalla completa"}
        </button>
      </div>
      <p className="text-rotulo text-mute">
        {red.nodos.length} {red.nodos.length === 1 ? "persona, empresa o entidad" : "personas, empresas y entidades"} unidas por{" "}
        {red.aristas.length} {red.aristas.length === 1 ? "vínculo" : "vínculos"}.{" "}
        {estrecho ? "Toca a cualquiera para ver su detalle." : "Pasa el mouse o enfoca a alguien para ver con quién se vincula y por qué; tócalo para ver su detalle."}
      </p>

      <div className="rounded-2xl border border-line bg-paperSoft p-4 sm:p-5">
        <Carriles red={red} abiertos={abiertos} alternar={alternar} sel={sel} onElegir={elegir} onEstrecho={setEstrecho} />
      </div>

      {completa && (
        <PantallaCompleta titulo="La red del proveedor" onCerrar={() => setCompleta(false)}>
          <Carriles red={red} abiertos={abiertos} alternar={alternar} sel={sel} onElegir={elegir} fijo />
        </PantallaCompleta>
      )}

      {enPanel && (
        <Panel
          abierto={!!nodoSel}
          onCerrar={() => setSel(null)}
          titulo={tituloNodo(enPanel)}
          descripcion={ETIQUETA_NODO[enPanel.kind]}
          pie={<PieNodo node={enPanel} onVigiaSearch={(ruc) => router.push(`/app/contratos?q=${encodeURIComponent(ruc)}`)} />}
        >
          <CuerpoNodo node={enPanel} vinculos={vinculosPanel} />
        </Panel>
      )}
    </div>
  );
}

/**
 * Los carriles con sus nodos y, si caben, las aristas encima. `fijo`: siempre como grafo (pantalla completa, dentro
 * de un contenedor de ancho fijo que se escala con CSS); se mide sin la escala (`offsetWidth` y las cajas divididas por
 * ella), así la letra y las curvas no cambian al acercar o alejar.
 */
function Carriles({
  red,
  abiertos,
  alternar,
  sel,
  onElegir,
  onEstrecho,
  fijo = false,
}: {
  red: Red;
  abiertos: Set<string>;
  alternar: (id: string) => void;
  sel: string | null;
  onElegir: (id: string) => void;
  onEstrecho?: (estrecho: boolean) => void;
  fijo?: boolean;
}) {
  const { aristas, carrilDe, porCarril, vecinos, nombre } = red;
  const marco = useRef<HTMLDivElement | null>(null);
  const lienzo = useRef<HTMLDivElement | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  // `marco`: el ancho que hay (decide grafo o listas); `w` y `h`: lo que mide la red (el lienzo de las aristas).
  const [tam, setTam] = useState({ marco: 0, w: 0, h: 0 });
  const [trazos, setTrazos] = useState<Trazo[]>([]);
  const nCols = Math.max(1, porCarril.filter((l) => l.length > 0).length);
  const minimo = nCols * ANCHO_CARRIL + (nCols - 1) * HUECO;
  const ancho = fijo || tam.marco >= minimo - HOLGURA;

  const visibles = useMemo(() => {
    const v = new Set<string>();
    porCarril.forEach((lista, i) => (abiertos.has(CARRILES[i].id) ? lista : lista.slice(0, POR_CARRIL)).forEach((n) => v.add(n.id)));
    return v;
  }, [porCarril, abiertos]);

  useEffect(() => {
    if (tam.marco) onEstrecho?.(!ancho);
  }, [ancho, tam.marco, onEstrecho]);

  useLayoutEffect(() => {
    const m = marco.current;
    const el = lienzo.current;
    if (!m || !el) return;
    const medir = () => {
      const wm = m.offsetWidth;
      if (!wm) return; // pestaña oculta: se mide al mostrarse
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setTam((t) => (t.marco === wm && t.w === w && t.h === h ? t : { marco: wm, w, h }));
      if (!fijo && wm < minimo - HOLGURA) {
        setTrazos([]);
        return;
      }
      const base = el.getBoundingClientRect();
      // La escala del lienzo de pantalla completa (1 en la vista en línea).
      const k = base.width / w || 1;
      const caja = (id: string): Caja | null => {
        const n = el.querySelector<HTMLElement>(`[data-nodo="${CSS.escape(id)}"]`);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        const l = (r.left - base.left) / k;
        const t = (r.top - base.top) / k;
        return { l, t, r: l + r.width / k, b: t + r.height / k, cy: t + r.height / k / 2 };
      };
      const out: Trazo[] = [];
      aristas.forEach((e, i) => {
        if (!visibles.has(e.from) || !visibles.has(e.to)) return;
        const s = caja(e.from);
        const d = caja(e.to);
        if (!s || !d) return;
        out.push({
          id: `${e.from}>${e.to}>${i}`,
          d: camino(s, d, carrilDe.get(e.from) ?? 0, carrilDe.get(e.to) ?? 0),
          grupo: GRUPO[e.kind] ?? "negocio",
          de: e.from,
          a: e.to,
        });
      });
      setTrazos(out);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(m);
    ro.observe(el);
    document.fonts?.ready.then(medir).catch(() => {});
    return () => ro.disconnect();
  }, [aristas, visibles, carrilDe, ancho, fijo, minimo]);

  const activo = ancho ? sel ?? foco : null;
  /** Por qué está unido cada vecino al nodo activo: la relación de la primera arista entre los dos. */
  const relacionCon = new Map<string, GraphEdge>();
  if (activo) for (const v of vecinos.get(activo) ?? []) if (!relacionCon.has(v.otro)) relacionCon.set(v.otro, v.arista);

  return (
    // Con la red un poco más ancha que su caja, se desliza de costado (la letra no se achica).
    <div ref={marco} className={cn(ancho && !fijo && "overflow-x-auto overscroll-x-contain pb-1")}>
      <div ref={lienzo} className="relative" style={ancho ? { minWidth: minimo } : undefined}>
        {ancho && (
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={tam.w} height={tam.h} aria-hidden>
            {trazos.map((t) => {
              const toca = !!activo && (t.de === activo || t.a === activo);
              return (
                <path
                  key={t.id}
                  d={t.d}
                  fill="none"
                  className={cn(trazoDe(t.grupo), "transition-opacity motion-reduce:transition-none", activo ? (toca ? "opacity-100" : "opacity-10") : "opacity-50")}
                  strokeWidth={toca ? 2.25 : 1.25}
                  strokeDasharray={t.grupo === "estado" ? "4 3" : undefined}
                />
              );
            })}
          </svg>
        )}

        <div
          className={cn("relative grid", !ancho && "grid-cols-1 gap-5")}
          style={ancho ? { gridTemplateColumns: `repeat(${nCols}, minmax(0, 1fr))`, columnGap: HUECO } : undefined}
        >
          {CARRILES.map((c, i) => {
            const lista = porCarril[i];
            if (!lista.length) return null;
            const abierto = abiertos.has(c.id);
            const mostrar = abierto ? lista : lista.slice(0, POR_CARRIL);
            return (
              <section key={c.id} className="min-w-0 space-y-2" aria-label={c.titulo}>
                <h4 className="text-rotulo font-semibold uppercase tracking-wide text-mute">
                  {c.titulo} <span className="font-mono tabular-nums">({lista.length})</span>
                </h4>
                <ul className="space-y-2">
                  {mostrar.map((n) => {
                    const rel = relacionCon.get(n.id);
                    const apagado = !!activo && activo !== n.id && !rel;
                    const suyos = vecinos.get(n.id) ?? [];
                    const segunda = n.sublabel || ETIQUETA_NODO[n.kind];
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          data-nodo={n.id}
                          onMouseEnter={() => setFoco(n.id)}
                          onMouseLeave={() => setFoco(null)}
                          onFocus={() => setFoco(n.id)}
                          onBlur={() => setFoco(null)}
                          onClick={() => onElegir(n.id)}
                          aria-pressed={sel === n.id}
                          aria-label={`${n.label}: ${ETIQUETA_NODO[n.kind]}, ${suyos.length} ${suyos.length === 1 ? "vínculo" : "vínculos"}. Ver el detalle`}
                          className={cn(
                            "block w-full rounded-xl border bg-paper px-3 py-2 text-left transition-opacity duration-rapido motion-reduce:transition-none",
                            "hover:border-paperEdge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                            n.kind === "company_main" ? "border-granate bg-granate-50" : NODO_RIESGO.has(n.kind) ? "border-crimson/70" : "border-line",
                            sel === n.id && "ring-2 ring-granate",
                            apagado && "opacity-40",
                          )}
                        >
                          <span className="line-clamp-2 text-meta font-semibold leading-snug text-ink">{redactDnis(n.label)}</span>
                          {/* La segunda línea siempre está (su dato o qué es): al resaltar un vecino dice por qué está unido sin
                              cambiar de alto, así los demás nodos no se corren bajo el mouse. */}
                          {rel ? (
                            <span className={cn("mt-0.5 line-clamp-1 text-rotulo font-semibold", TEXTO_GRUPO[GRUPO[rel.kind] ?? "negocio"])}>
                              {relacionDe(rel)}
                            </span>
                          ) : (
                            <span className="mt-0.5 line-clamp-1 text-rotulo text-mute">{redactDnis(segunda)}</span>
                          )}
                          {!ancho && suyos.length > 0 && (
                            <span className="mt-1.5 block space-y-0.5 border-t border-line pt-1.5">
                              {suyos.slice(0, 3).map((v, k) => (
                                <span key={k} className="flex items-start gap-1.5 text-rotulo leading-snug text-inkSoft">
                                  <span className={cn("mt-1.5 h-1 w-3 shrink-0 rounded-full", chipTono(TONO_GRUPO[GRUPO[v.arista.kind] ?? "negocio"]))} aria-hidden />
                                  <span className="min-w-0">
                                    Vinculado a <span className="font-semibold text-ink">{redactDnis(nombre(v.otro))}</span> por {relacionDe(v.arista)}
                                  </span>
                                </span>
                              ))}
                              {suyos.length > 3 && <span className="block pl-[18px] text-rotulo text-mute">y {suyos.length - 3} vínculos más en su detalle</span>}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {lista.length > POR_CARRIL && (
                  <button
                    type="button"
                    className="inline-flex min-h-8 items-center text-meta font-semibold text-granate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                    onClick={() => alternar(c.id)}
                    aria-expanded={abierto}
                  >
                    {abierto ? "Ver menos" : `+${lista.length - POR_CARRIL} más`}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const BOTON_LIENZO =
  "inline-flex size-9 items-center justify-center rounded-full text-inkSoft transition-colors duration-rapido hover:bg-paperDeep hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate";

/**
 * La red a pantalla completa (un `<dialog>` modal: encima de todo, Escape lo cierra): los carriles a su ancho de
 * escritorio dentro de un lienzo que se arrastra y se pellizca (`useLienzoNavegable`, como el organigrama). La escala
 * se aplica con CSS al contenido; el envoltorio mide lo escalado para que el desplazamiento llegue a los bordes.
 */
function PantallaCompleta({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const lienzo = useRef<HTMLDivElement>(null);
  const contenido = useRef<HTMLDivElement>(null);
  const interior = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);
  const [alto, setAlto] = useState(0);
  const centrado = useRef(false);
  // El lienzo sólo pide del contenido su caja en pantalla (getBoundingClientRect): un <div> sirve igual que un <svg>.
  const nav = useLienzoNavegable(lienzo, contenido as unknown as RefObject<SVGSVGElement>, escala, setEscala, { min: 0.35, max: 1.75 });

  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);

  useLayoutEffect(() => {
    const el = interior.current;
    if (!el) return;
    const medir = () => setAlto(el.offsetHeight);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Al abrir: el proveedor al centro de lo que se ve (en el celular, el grafo entero no entra con letra legible).
  useEffect(() => {
    if (!alto || centrado.current) return;
    const c = contenido.current;
    const n = c?.querySelector<HTMLElement>('[data-nodo="co_main"]');
    if (!c || !n) return;
    centrado.current = true;
    const a = c.getBoundingClientRect();
    const b = n.getBoundingClientRect();
    nav.centrarEn((b.left - a.left + b.width / 2) / escala, (b.top - a.top + b.height / 2) / escala, "auto");
    // Sólo la primera vez que hay alto: después lo mueve quien mira.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alto]);

  return (
    <dialog
      ref={dialogo}
      aria-label={titulo}
      onClose={onCerrar}
      className="m-0 flex h-dvh max-h-none w-screen max-w-none flex-col overflow-hidden border-0 bg-paper p-0 text-ink backdrop:bg-ink/50"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-paperSoft px-4 py-2">
        <h2 className="min-w-0 truncate font-display text-bloque font-bold text-ink">{titulo}</h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" className={BOTON_LIENZO} onClick={() => nav.zoomEn(escala / 1.25)} aria-label="Alejar">
            <Minus size={16} aria-hidden />
          </button>
          <span className="w-12 text-center font-mono text-rotulo tabular-nums text-mute" aria-live="polite">
            {Math.round(escala * 100)} %
          </span>
          <button type="button" className={BOTON_LIENZO} onClick={() => nav.zoomEn(escala * 1.25)} aria-label="Acercar">
            <Plus size={16} aria-hidden />
          </button>
          <button type="button" className={BOTON_LIENZO} onClick={() => nav.encajar(ANCHO_GRAFO, alto || 600)} aria-label="Ver la red entera">
            <Scan size={16} aria-hidden />
          </button>
          <button type="button" className={BOTON_LIENZO} onClick={() => dialogo.current?.close()} aria-label="Cerrar la pantalla completa">
            <X size={18} aria-hidden />
          </button>
        </div>
      </header>
      <p className="shrink-0 px-4 py-1.5 text-rotulo text-mute">
        Arrastra para moverte; pellizca o usa la rueda para acercar y alejar. Toca a alguien para ver su detalle.
      </p>
      <div
        ref={lienzo}
        tabIndex={0}
        role="region"
        aria-label="La red del proveedor: arrastra para moverte y usa la rueda para acercar o alejar; con el teclado, flechas, + y −"
        className="min-h-0 flex-1 cursor-grab touch-none select-none overflow-auto bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
        {...nav.manejadores}
      >
        <div ref={contenido} className="relative mx-auto" style={{ width: ANCHO_GRAFO * escala, height: (alto || 600) * escala }}>
          <div ref={interior} className="absolute left-0 top-0 origin-top-left p-6" style={{ width: ANCHO_GRAFO, transform: `scale(${escala})` }}>
            {children}
          </div>
        </div>
      </div>
    </dialog>
  );
}
