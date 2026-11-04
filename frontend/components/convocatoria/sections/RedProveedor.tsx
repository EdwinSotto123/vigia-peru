"use client";

/**
 * La red del proveedor en carriles (reemplaza al grafo polar de RelationshipGraph, plan 2026-11-04): personas y política
 * → el proveedor → empresas vinculadas → la entidad → competencia y contratos. Los nodos son botones HTML con letra real
 * (nunca se achica con el zoom) y las aristas, un SVG encima medido sobre el contenedor (como traza/GrafoRecorrido).
 * Todo por token: día y noche sin hex. Angosto (menos de 640 px): sin SVG, cada carril es una lista y cada nodo dice con
 * quién se vincula y por qué. Mismos datos y enmascarado que antes (`buildRelationshipGraphData`).
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";
import type { GraphEdge, GraphNode } from "../types";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { buildRelationshipGraphData } from "./RelationshipGraph.layout";

type Grupo = "riesgo" | "politica" | "familia" | "negocio" | "estado";

const CARRILES: { id: string; titulo: string; kinds: GraphNode["kind"][] }[] = [
  { id: "personas", titulo: "Personas y política", kinds: ["person", "pareja", "party", "partido_compartido", "cargo_pasado", "municipio_familiar"] },
  { id: "proveedor", titulo: "El proveedor", kinds: ["company_main"] },
  { id: "empresas", titulo: "Empresas vinculadas", kinds: ["company_titular", "company_domicilio", "socio_postor_conflicto"] },
  { id: "entidad", titulo: "La entidad", kinds: ["entidad", "alcalde", "funcionario_designado", "autoridad", "firmante_conflicto", "entidad_secundaria"] },
  { id: "competencia", titulo: "Competencia y contratos", kinds: ["postor_rival", "contract"] },
];

const GRUPO: Record<GraphEdge["kind"], Grupo> = {
  titular: "negocio", contrato: "negocio", adjudicacion: "negocio", compitio: "negocio",
  domicilio: "riesgo", firma_conflicto: "riesgo", conflicto_funcionario: "riesgo", socio_de: "riesgo", visito: "riesgo",
  doble_vinculacion: "riesgo",
  candidato: "politica", aporte: "politica", cargo: "politica", mismo_partido_que: "politica", partido_de: "politica",
  pareja: "familia",
  autoridad: "estado", preside_entidad: "estado", designado_por: "estado", trabaja_en: "estado",
};

/* Clases LITERALES (Tailwind sólo genera las que ve escritas). */
const TONO: Record<Grupo, { trazo: string; punto: string; nombre: string }> = {
  riesgo: { trazo: "stroke-crimson", punto: "bg-crimson", nombre: "Conflicto o cruce de riesgo" },
  politica: { trazo: "stroke-amber", punto: "bg-amber", nombre: "Política: aportes, candidaturas, cargos" },
  familia: { trazo: "stroke-anil", punto: "bg-anil", nombre: "Familia" },
  negocio: { trazo: "stroke-granate", punto: "bg-granate", nombre: "Titularidad, contratos, competencia" },
  estado: { trazo: "stroke-mute", punto: "bg-mute", nombre: "Cargos y designaciones en la entidad" },
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
const ANCHO_CARRILES = 640;

type Caja = { l: number; t: number; r: number; b: number; cy: number };

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

export function RedProveedor({ person, web, proveedor, ctx }: { person: any; web: any; proveedor: any; ctx?: any }) {
  const router = useRouter();
  const datos = useMemo(() => buildRelationshipGraphData(person, web, proveedor, ctx), [person, web, proveedor, ctx]);
  const nodos: GraphNode[] = datos?.nodes ?? [];
  const aristas: GraphEdge[] = datos?.edges ?? [];
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [foco, setFoco] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [trazos, setTrazos] = useState<{ id: string; d: string; grupo: Grupo; de: string; a: string; mx: number; my: number; texto: string }[]>([]);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  const lienzo = useRef<HTMLDivElement | null>(null);

  const carrilDe = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodos) {
      const i = CARRILES.findIndex((c) => c.kinds.includes(n.kind));
      m.set(n.id, i < 0 ? 4 : i);
    }
    return m;
  }, [nodos]);

  const porCarril = useMemo(() => CARRILES.map((c, i) => nodos.filter((n) => carrilDe.get(n.id) === i)), [nodos, carrilDe]);
  const visibles = useMemo(() => {
    const v = new Set<string>();
    porCarril.forEach((lista, i) => (abiertos.has(CARRILES[i].id) ? lista : lista.slice(0, POR_CARRIL)).forEach((n) => v.add(n.id)));
    return v;
  }, [porCarril, abiertos]);

  const vecinos = useMemo(() => {
    const m = new Map<string, { otro: string; arista: GraphEdge }[]>();
    for (const e of aristas) {
      (m.get(e.from) ?? m.set(e.from, []).get(e.from)!).push({ otro: e.to, arista: e });
      (m.get(e.to) ?? m.set(e.to, []).get(e.to)!).push({ otro: e.from, arista: e });
    }
    return m;
  }, [aristas]);

  const ancho = tam.w >= ANCHO_CARRILES;

  useLayoutEffect(() => {
    const el = lienzo.current;
    if (!el) return;
    const medir = () => {
      const base = el.getBoundingClientRect();
      if (!base.width) return; // pestaña oculta: se mide al mostrarse
      setTam({ w: base.width, h: base.height });
      if (base.width < ANCHO_CARRILES) {
        setTrazos([]);
        return;
      }
      const caja = (id: string): Caja | null => {
        const n = el.querySelector<HTMLElement>(`[data-nodo="${CSS.escape(id)}"]`);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        const l = r.left - base.left;
        const t = r.top - base.top;
        return { l, t, r: l + r.width, b: t + r.height, cy: t + r.height / 2 };
      };
      const out: typeof trazos = [];
      aristas.forEach((e, i) => {
        if (!visibles.has(e.from) || !visibles.has(e.to)) return;
        const s = caja(e.from);
        const d = caja(e.to);
        if (!s || !d) return;
        const ls = carrilDe.get(e.from) ?? 0;
        const ld = carrilDe.get(e.to) ?? 0;
        out.push({
          id: `${e.from}>${e.to}>${i}`, d: camino(s, d, ls, ld), grupo: GRUPO[e.kind] ?? "negocio", de: e.from, a: e.to,
          mx: (Math.min(s.r, d.r) + Math.max(s.l, d.l)) / 2, my: (s.cy + d.cy) / 2,
          texto: e.label || ETIQUETA[e.kind] || e.kind,
        });
      });
      setTrazos(out);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    document.fonts?.ready.then(medir).catch(() => {});
    return () => ro.disconnect();
  }, [aristas, visibles, carrilDe]);

  if (!datos || !nodos.length) return null;

  const activo = sel ?? foco;
  const conectados = new Set<string>(activo ? [activo, ...(vecinos.get(activo) ?? []).map((v) => v.otro)] : []);
  const nodoSel = sel ? nodos.find((n) => n.id === sel) ?? null : null;
  const grupos = Array.from(new Set(aristas.map((e) => GRUPO[e.kind] ?? "negocio")));
  const nombre = (id: string) => redactDnis(nodos.find((n) => n.id === id)?.label ?? "");

  return (
    <div className="space-y-3 border-t border-line bg-paperSoft px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-destacado font-bold text-ink">Su red</h3>
        <p className="text-micro text-mute">
          {nodos.length} {nodos.length === 1 ? "nodo" : "nodos"} y {aristas.length} {aristas.length === 1 ? "vínculo" : "vínculos"}.
          {ancho ? " Pasa el mouse o enfoca un nodo para ver sus vínculos; tócalo para el detalle." : " Toca un nodo para el detalle."}
        </p>
      </div>
      {grupos.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Qué significa cada color de vínculo">
          {grupos.map((g) => (
            <li key={g} className="inline-flex items-center gap-1.5 text-micro text-inkSoft">
              <span className={cn("h-1 w-4 rounded-full", TONO[g].punto)} aria-hidden />
              {TONO[g].nombre}
            </li>
          ))}
        </ul>
      )}

      <div ref={lienzo} className="relative">
        {ancho && (
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={tam.w} height={tam.h} aria-hidden>
            {trazos.map((t) => {
              const toca = !!activo && (t.de === activo || t.a === activo);
              return (
                <path key={t.id} d={t.d} fill="none"
                      className={cn(TONO[t.grupo].trazo, "transition-opacity motion-reduce:transition-none",
                                    activo ? (toca ? "opacity-100" : "opacity-10") : "opacity-50")}
                      strokeWidth={toca ? 2.25 : 1.25} strokeDasharray={t.grupo === "estado" ? "4 3" : undefined} />
              );
            })}
            {activo && trazos.filter((t) => t.de === activo || t.a === activo).map((t) => (
              <text key={`l-${t.id}`} x={t.mx} y={t.my - 4} textAnchor="middle"
                    className="fill-inkSoft text-micro" paintOrder="stroke" stroke="rgb(var(--paper-soft))" strokeWidth={4}>
                {t.texto}
              </text>
            ))}
          </svg>
        )}

        <div className={cn("relative grid gap-4", ancho ? "grid-cols-5 gap-x-8" : "grid-cols-1")}>
          {CARRILES.map((c, i) => {
            const lista = porCarril[i];
            if (!lista.length) return ancho ? <div key={c.id} /> : null;
            const mostrar = abiertos.has(c.id) ? lista : lista.slice(0, POR_CARRIL);
            return (
              <section key={c.id} className="min-w-0 space-y-2" aria-label={c.titulo}>
                <h4 className="text-micro font-semibold uppercase tracking-wide text-mute">
                  {c.titulo} <span className="font-mono tabular-nums">({lista.length})</span>
                </h4>
                <ul className="space-y-2">
                  {mostrar.map((n) => {
                    const apagado = !!activo && !conectados.has(n.id);
                    const suyos = vecinos.get(n.id) ?? [];
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          data-nodo={n.id}
                          onMouseEnter={() => setFoco(n.id)}
                          onMouseLeave={() => setFoco(null)}
                          onFocus={() => setFoco(n.id)}
                          onBlur={() => setFoco(null)}
                          onClick={() => setSel(sel === n.id ? null : n.id)}
                          aria-pressed={sel === n.id}
                          className={cn(
                            "w-full rounded-xl border bg-paper px-3 py-2 text-left transition-opacity motion-reduce:transition-none",
                            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-granate",
                            n.kind === "company_main" ? "border-granate" : NODO_RIESGO.has(n.kind) ? "border-crimson" : "border-line",
                            sel === n.id && "ring-2 ring-granate",
                            apagado && "opacity-40",
                          )}
                        >
                          <span className="line-clamp-2 text-rotulo font-semibold leading-4 text-ink">{redactDnis(n.label)}</span>
                          {n.sublabel && <span className="mt-0.5 line-clamp-2 text-micro text-mute">{redactDnis(n.sublabel)}</span>}
                          {!ancho && suyos.length > 0 && (
                            <span className="mt-1 block space-y-0.5">
                              {suyos.slice(0, 4).map((v, k) => (
                                <span key={k} className="flex items-center gap-1.5 text-micro text-inkSoft">
                                  <span className={cn("h-1 w-3 shrink-0 rounded-full", TONO[GRUPO[v.arista.kind] ?? "negocio"].punto)} aria-hidden />
                                  <span className="min-w-0 truncate">{v.arista.label || ETIQUETA[v.arista.kind]}: {nombre(v.otro)}</span>
                                </span>
                              ))}
                              {suyos.length > 4 && <span className="block text-micro text-mute">y {suyos.length - 4} vínculos más</span>}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {lista.length > POR_CARRIL && (
                  <button type="button" className="text-micro font-medium text-granate hover:underline"
                          onClick={() => setAbiertos((s) => {
                            const n = new Set(s);
                            if (n.has(c.id)) n.delete(c.id);
                            else n.add(c.id);
                            return n;
                          })}>
                    {abiertos.has(c.id) ? "Ver menos" : `Ver ${lista.length - POR_CARRIL} más`}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {nodoSel && (
        <NodeDetailPanel
          node={nodoSel}
          onClose={() => setSel(null)}
          onVigiaSearch={(ruc) => router.push(`/app/contratos?q=${encodeURIComponent(ruc)}`)}
        />
      )}
    </div>
  );
}
