"use client";

import { useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import type { DependenciaNodo } from "@/lib/poder";

/**
 * Explorador de DEPENDENCIA del Gobierno Nacional (presupuesto MEF): sector → pliego → unidad ejecutora. Muestra de
 * quién depende quién —p. ej. Defensa → Ejército/Marina/FAP (bajo el pliego "M. de Defensa"), más INDECI, CENEPRED,
 * IGN— y marca los sectores AUTÓNOMOS (Contraloría, JNE, ONPE, RENIEC, TC, Ministerio Público, Poder Judicial, Congreso…)
 * que NO dependen del Ejecutivo. Radial colapsable con auto-zoom: tocá un sector y aparecen sus pliegos; tocá un pliego y
 * aparecen sus ejecutoras. El tamaño es el presupuesto (PIM). Estructura oficial, no una acusación.
 */
const AUTONOMOS = new Set(["04", "19", "20", "21", "22", "24", "27", "28", "31", "32", "33"]);
const esAutonomo = (sector: string) => AUTONOMOS.has(sector);
function corto(s: string, n: number) {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const VB = 1000;
const C = VB / 2;
const R1 = 220;
const PR = 150;
const DR = 110;
const rad = (d: number) => (d * Math.PI) / 180;

type Kind = "sector" | "pliego" | "ejec";
type Nd = { kind: Kind; key: string; nombre: string; sector: string; pim: number; dev: number; hijos: number };
type P = { nd: Nd; x: number; y: number; r: number; ang: number; label: string };

export function ExploradorDependencia({ anio, nodos }: { anio: number; nodos: DependenciaNodo[] }) {
  const [sectorAb, setSectorAb] = useState<string | null>(null);
  const [pliegoAb, setPliegoAb] = useState<string | null>(null);
  const [sel, setSel] = useState<Nd | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const { sectores, pliegosDe, ejecsDe } = useMemo(() => {
    const secMap = new Map<string, Nd>();
    const pliMap = new Map<string, Map<string, Nd>>(); // sector -> pliego -> Nd
    const ejeMap = new Map<string, Nd[]>(); // sector|pliego -> ejecutoras
    for (const n of nodos) {
      const s = secMap.get(n.sector) ?? { kind: "sector" as Kind, key: n.sector, nombre: n.sector_nombre, sector: n.sector, pim: 0, dev: 0, hijos: 0 };
      s.pim += n.pim; s.dev += n.devengado; secMap.set(n.sector, s);
      if (!pliMap.has(n.sector)) pliMap.set(n.sector, new Map());
      const pm = pliMap.get(n.sector)!;
      const p = pm.get(n.pliego) ?? { kind: "pliego" as Kind, key: `${n.sector}|${n.pliego}`, nombre: n.pliego_nombre, sector: n.sector, pim: 0, dev: 0, hijos: 0 };
      p.pim += n.pim; p.dev += n.devengado; pm.set(n.pliego, p);
      const ek = `${n.sector}|${n.pliego}`;
      const arr = ejeMap.get(ek) ?? [];
      arr.push({ kind: "ejec", key: `${ek}|${n.ejec}`, nombre: n.ejecutora_nombre, sector: n.sector, pim: n.pim, dev: n.devengado, hijos: 0 });
      ejeMap.set(ek, arr);
    }
    for (const [sec, pm] of pliMap) { secMap.get(sec)!.hijos = pm.size; for (const [pl, p] of pm) p.hijos = (ejeMap.get(`${sec}|${pl}`) ?? []).length; }
    const sectores = [...secMap.values()].sort((a, b) => b.pim - a.pim);
    return {
      sectores,
      pliegosDe: (sec: string) => [...(pliMap.get(sec)?.values() ?? [])].sort((a, b) => b.pim - a.pim),
      ejecsDe: (sec: string, pl: string) => (ejeMap.get(`${sec}|${pl}`) ?? []).sort((a, b) => b.pim - a.pim),
    };
  }, [nodos]);

  const { pos, edges, foco } = useMemo(() => {
    const N = sectores.length || 1;
    const maxS = Math.max(...sectores.map((s) => s.pim), 1);
    const pos: P[] = [];
    const edges: { x1: number; y1: number; x2: number; y2: number; sector: string; faint: boolean }[] = [];
    const F: { sec: P | null; pli: P | null } = { sec: null, pli: null };
    sectores.forEach((s, i) => {
      const ang = -90 + (i * 360) / N;
      const sp: P = { nd: s, x: C + R1 * Math.cos(rad(ang)), y: C + R1 * Math.sin(rad(ang)), r: 8 + 11 * Math.sqrt(s.pim / maxS), ang, label: tituloNatural(s.nombre) };
      pos.push(sp);
      edges.push({ x1: C, y1: C, x2: sp.x, y2: sp.y, sector: s.sector, faint: true });
      if (s.key === sectorAb) {
        F.sec = sp;
        const plis = pliegosDe(s.sector);
        const maxP = Math.max(...plis.map((p) => p.pim), 1);
        const K = plis.length;
        const spread = Math.min(16, 150 / Math.max(K - 1, 1));
        plis.forEach((p, k) => {
          const pa = ang + (k - (K - 1) / 2) * spread;
          const pp: P = { nd: p, x: sp.x + PR * Math.cos(rad(pa)), y: sp.y + PR * Math.sin(rad(pa)), r: 5 + 7 * Math.sqrt(p.pim / maxP), ang: pa, label: tituloNatural(p.nombre) };
          pos.push(pp);
          edges.push({ x1: sp.x, y1: sp.y, x2: pp.x, y2: pp.y, sector: s.sector, faint: false });
          if (p.key === pliegoAb) {
            F.pli = pp;
            const ejes = ejecsDe(s.sector, p.key.split("|")[1]);
            const M = ejes.length;
            const phi = Math.atan2(pp.y - sp.y, pp.x - sp.x) * (180 / Math.PI);
            const spreadD = Math.min(13, 150 / Math.max(M - 1, 1));
            ejes.forEach((e, m) => {
              const da = phi + (m - (M - 1) / 2) * spreadD;
              const ep: P = { nd: e, x: pp.x + DR * Math.cos(rad(da)), y: pp.y + DR * Math.sin(rad(da)), r: 4.5, ang: da, label: tituloNatural(e.nombre) };
              pos.push(ep);
              edges.push({ x1: pp.x, y1: pp.y, x2: ep.x, y2: ep.y, sector: s.sector, faint: false });
            });
          }
        });
      }
    });
    let k = 1, tx = 0, ty = 0;
    const target = F.pli ?? F.sec;
    if (target) {
      const out = rad(target.ang);
      const push = F.pli ? 60 : 82;
      k = F.pli ? 2.8 : 1.95;
      tx = C - (target.x + push * Math.cos(out)) * k;
      ty = C - (target.y + push * Math.sin(out)) * k;
    }
    return { pos, edges, foco: { k, tx, ty } };
  }, [sectores, sectorAb, pliegoAb, pliegosDe, ejecsDe]);

  function abrir(nd: Nd) {
    setSel(nd);
    if (nd.kind === "sector") { setSectorAb(nd.key); setPliegoAb(null); }
    else if (nd.kind === "pliego") { setPliegoAb(nd.key); }
  }
  const clsNodo = (sector: string) => (esAutonomo(sector) ? "fill-anil/30 stroke-anil" : "fill-granate/30 stroke-granate");
  const clsEdge = (sector: string) => (esAutonomo(sector) ? "stroke-anil" : "stroke-granate");
  const kindTxt = (k: Kind) => (k === "sector" ? "Sector / ministerio" : k === "pliego" ? "Pliego" : "Unidad ejecutora");

  const secAbNd = sectorAb ? sectores.find((s) => s.key === sectorAb) : null;

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1.5 text-meta">
          <button type="button" onClick={() => { setSectorAb(null); setPliegoAb(null); setSel(null); }} className={`font-semibold ${sectorAb ? "text-granate hover:underline underline-offset-2" : "text-ink"}`}>Gobierno Nacional</button>
          {secAbNd && <span className="text-mute" aria-hidden>›</span>}
          {secAbNd && <button type="button" onClick={() => { setPliegoAb(null); setSel(null); }} className={`font-semibold ${pliegoAb ? "text-granate hover:underline underline-offset-2" : "text-ink"}`}>{corto(secAbNd.nombre, 24)}</button>}
        </nav>
        <span className="text-rotulo text-mute">presupuesto {anio}</span>
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">
        {!sectorAb ? "El Gobierno Nacional al centro y sus sectores (ministerios y organismos autónomos). Tocá un sector: aparecen sus pliegos y el zoom va solo."
          : !pliegoAb ? "Los pliegos del sector (la entidad rectora y los organismos que dependen de ella). Tocá un pliego para ver sus unidades ejecutoras."
          : "Las unidades ejecutoras del pliego — las que ejecutan el presupuesto."}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="overflow-hidden rounded-xl border border-line bg-fondo/40">
          <svg viewBox={`0 0 ${VB} ${VB}`} className="h-auto w-full min-w-[520px] touch-manipulation select-none" role="img" aria-label="Explorador de dependencia del Gobierno Nacional">
            <g style={{ transform: `translate(${foco.tx}px, ${foco.ty}px) scale(${foco.k})`, transition: "transform 650ms cubic-bezier(0.4,0,0.2,1)" }}>
              {edges.map((ed, i) => (
                <line key={i} x1={ed.x1} y1={ed.y1} x2={ed.x2} y2={ed.y2} className={clsEdge(ed.sector)} strokeWidth={1 / foco.k} strokeOpacity={sectorAb && ed.faint && ed.sector !== sectorAb ? 0.1 : ed.faint ? 0.35 : 0.5} strokeLinecap="round" />
              ))}
              {pos.map((p) => {
                const eh = hover === p.nd.key;
                const es = sel?.key === p.nd.key;
                const dim = sectorAb != null && p.nd.kind === "sector" && p.nd.key !== sectorAb;
                const r = p.r * (eh || es ? 1.5 : 1);
                const anchor = Math.cos(rad(p.ang)) >= 0 ? "start" : "end";
                return (
                  <g key={p.nd.key} className="cursor-pointer" opacity={dim ? 0.3 : 1}
                     onPointerEnter={() => setHover(p.nd.key)} onPointerLeave={() => setHover(null)}
                     onClick={() => abrir(p.nd)} role="button" tabIndex={-1} aria-label={p.label}>
                    {es && <circle cx={p.x} cy={p.y} r={r + 4 / foco.k} className="fill-none stroke-ink" strokeWidth={1.2 / foco.k} />}
                    <circle cx={p.x} cy={p.y} r={r} className={clsNodo(p.nd.sector)} strokeWidth={1.2 / foco.k} />
                    {(p.nd.kind === "sector" || sectorAb) && !dim && (
                      <text x={p.x + (anchor === "start" ? r + 3 / foco.k : -(r + 3 / foco.k))} y={p.y + 1 / foco.k} textAnchor={anchor}
                        className={`pointer-events-none ${eh || es ? "fill-ink font-semibold" : "fill-inkSoft"}`}
                        style={{ fontSize: `${(p.nd.kind === "sector" ? 9.5 : p.nd.kind === "pliego" ? 8 : 6.5) / foco.k}px` }}>
                        {corto(p.label, 22)}
                      </text>
                    )}
                  </g>
                );
              })}
              <circle cx={C} cy={C} r={13} className="cursor-pointer fill-paperSoft stroke-ink" strokeWidth={1.6 / foco.k} onClick={() => { setSectorAb(null); setPliegoAb(null); setSel(null); }} role="button" aria-label="Gobierno Nacional (ver todo)" />
              <text x={C} y={C - 1} textAnchor="middle" className="pointer-events-none fill-ink font-semibold" style={{ fontSize: `${7 / foco.k}px` }}>Gobierno</text>
              <text x={C} y={C + 7 / foco.k} textAnchor="middle" className="pointer-events-none fill-ink font-semibold" style={{ fontSize: `${7 / foco.k}px` }}>Nacional</text>
            </g>
          </svg>
        </div>

        <aside className="rounded-xl border border-line bg-paperSoft/50 p-4">
          {sel ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-cuerpo font-semibold leading-tight text-ink">{tituloNatural(sel.nombre)}</div>
                  <div className="text-rotulo text-mute">{kindTxt(sel.kind)}{sel.kind === "sector" ? (esAutonomo(sel.sector) ? " — autónomo" : " — del Ejecutivo") : ""}</div>
                </div>
                <button type="button" onClick={() => setSel(null)} className="text-mute hover:text-ink" aria-label="Cerrar detalle">✕</button>
              </div>
              {sel.kind === "sector" && (
                <p className="text-meta text-inkSoft">{esAutonomo(sel.sector) ? "Organismo autónomo: NO depende del Poder Ejecutivo." : "Sector del Poder Ejecutivo: sus pliegos y organismos dependen de él."}</p>
              )}
              <div className="rounded-lg border border-line bg-paper px-3 py-2">
                <div className="font-mono text-cuerpo font-semibold tabular-nums text-ink">{solesCompacto(sel.pim)}</div>
                <div className="text-rotulo text-mute">presupuesto {anio} (PIM), {solesCompacto(sel.dev)} ejecutado</div>
              </div>
              {sel.kind !== "ejec" && <div className="text-rotulo text-mute">Contiene {numero(sel.hijos)} {sel.kind === "sector" ? "pliegos" : "unidades ejecutoras"} — tocá el nodo para abrirlo.</div>}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-cuerpo font-semibold text-ink">{secAbNd ? corto(secAbNd.nombre, 26) : "Gobierno Nacional"}</div>
                <div className="text-rotulo text-mute">{secAbNd ? `${numero(pliegosDe(secAbNd.sector).length)} pliegos` : `${numero(sectores.length)} sectores`}</div>
              </div>
              <p className="text-meta leading-relaxed text-inkSoft">Tocá un sector para abrirlo: aparecen sus pliegos (lo que depende de él) y el zoom va solo. Tocá un nodo para su presupuesto.</p>
              <div className="space-y-1.5 text-rotulo text-mute">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-granate/70" aria-hidden /> del Poder Ejecutivo (ministerios)</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-anil/70" aria-hidden /> autónomo (no depende del Ejecutivo)</span>
                <span>el tamaño es el presupuesto</span>
              </div>
            </div>
          )}
        </aside>
      </div>

      <p className="text-rotulo leading-relaxed text-mute">
        Estructura presupuestal oficial del MEF (sector → pliego → unidad ejecutora), {anio}. Es de quién depende quién en
        el Gobierno Nacional; los autónomos no responden al Ejecutivo. Para revisión, no una acusación.
      </p>
    </section>
  );
}
