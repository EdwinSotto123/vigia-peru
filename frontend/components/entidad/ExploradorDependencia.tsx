"use client";

import { useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import { VB, C, rad, corto, radioPorRaiz, anguloEnAnillo, anchorDeCos } from "@/lib/grafo";
import {
  GrafoSeccion, GrafoCabecera, MigaSep, GrafoColumnas, GrafoMarco, GrafoAside,
  Nodo, NodoCentro, Arista, ChipLeyenda, type Tono,
} from "@/components/grafo/primitivos";
import type { DependenciaNodo } from "@/lib/poder";

/**
 * Explorador de DEPENDENCIA del Gobierno Nacional (presupuesto MEF): sector → pliego → unidad ejecutora. Muestra de
 * quién depende quién —p. ej. Defensa → M. de Defensa (Ejército/Marina/FAP), INDECI, CENEPRED, IGN— y marca los
 * sectores AUTÓNOMOS (Contraloría, JNE, ONPE, RENIEC, TC, Ministerio Público, Poder Judicial, Congreso…) que NO
 * dependen del Ejecutivo: anil + anillo punteado (3er canal, no sólo color) + la palabra en el panel. Radial
 * colapsable con auto-zoom: tocá un sector y sus pliegos brotan; tocá un pliego y brotan sus ejecutoras. El tamaño
 * es el presupuesto (PIM). Estructura oficial, no una acusación. Usa los primitivos de components/grafo.
 */
const AUTONOMOS = new Set(["04", "19", "20", "21", "22", "24", "27", "28", "31", "32", "33"]);
const esAutonomo = (sector: string) => AUTONOMOS.has(sector);
const tonoDe = (sector: string): Tono => (esAutonomo(sector) ? "anil" : "granate");

const R1 = 220;
const PR = 150;
const DR = 110;

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
    const pos: (P & { kind: Kind; indice: number })[] = [];
    const edges: { x1: number; y1: number; x2: number; y2: number; sector: string; faint: boolean }[] = [];
    const F: { sec: P | null; pli: P | null } = { sec: null, pli: null };
    sectores.forEach((s, i) => {
      const ang = anguloEnAnillo(i, N);
      const sp: P = { nd: s, x: C + R1 * Math.cos(rad(ang)), y: C + R1 * Math.sin(rad(ang)), r: radioPorRaiz(s.pim, maxS, 8, 11), ang, label: tituloNatural(s.nombre) };
      pos.push({ ...sp, kind: "sector", indice: i });
      edges.push({ x1: C, y1: C, x2: sp.x, y2: sp.y, sector: s.sector, faint: true });
      if (s.key === sectorAb) {
        F.sec = sp;
        const plis = pliegosDe(s.sector);
        const maxP = Math.max(...plis.map((p) => p.pim), 1);
        const K = plis.length;
        const spread = Math.min(16, 150 / Math.max(K - 1, 1));
        plis.forEach((p, k) => {
          const pa = ang + (k - (K - 1) / 2) * spread;
          const pp: P = { nd: p, x: sp.x + PR * Math.cos(rad(pa)), y: sp.y + PR * Math.sin(rad(pa)), r: radioPorRaiz(p.pim, maxP, 5, 7), ang: pa, label: tituloNatural(p.nombre) };
          pos.push({ ...pp, kind: "pliego", indice: k });
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
              pos.push({ ...ep, kind: "ejec", indice: m });
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
  const kindTxt = (k: Kind) => (k === "sector" ? "Sector / ministerio" : k === "pliego" ? "Pliego" : "Unidad ejecutora");
  const focoKey = pliegoAb ?? sectorAb;
  const secAbNd = sectorAb ? sectores.find((s) => s.key === sectorAb) : null;

  return (
    <GrafoSeccion>
      <GrafoCabecera
        extra={<span className="text-rotulo text-mute">presupuesto {anio}</span>}
        migas={
          <>
            <button type="button" onClick={() => { setSectorAb(null); setPliegoAb(null); setSel(null); }} className={`font-semibold ${sectorAb ? "text-granate hover:underline underline-offset-2" : "text-ink"}`}>Gobierno Nacional</button>
            {secAbNd && <MigaSep />}
            {secAbNd && <button type="button" onClick={() => { setPliegoAb(null); setSel(null); }} className={`font-semibold ${pliegoAb ? "text-granate hover:underline underline-offset-2" : "text-ink"}`}>{corto(secAbNd.nombre, 24)}</button>}
          </>
        }
      />
      <p className="text-meta leading-relaxed text-inkSoft">
        {!sectorAb ? "El Gobierno Nacional al centro y sus sectores (ministerios y organismos autónomos). Tocá un sector: sus pliegos brotan y el zoom va solo."
          : !pliegoAb ? "Los pliegos del sector (la entidad rectora y los organismos que dependen de ella). Tocá un pliego para ver sus unidades ejecutoras."
          : "Las unidades ejecutoras del pliego — las que ejecutan el presupuesto."}
      </p>

      <GrafoColumnas>
        <GrafoMarco>
          <svg viewBox={`0 0 ${VB} ${VB}`} className="h-auto w-full min-w-[520px] touch-manipulation select-none" role="img" aria-label="Explorador de dependencia del Gobierno Nacional">
            <g style={{ transform: `translate(${foco.tx}px, ${foco.ty}px) scale(${foco.k})`, transition: "transform 650ms cubic-bezier(0.4,0,0.2,1)" }}>
              {edges.map((ed, i) => (
                <Arista key={i} x1={ed.x1} y1={ed.y1} x2={ed.x2} y2={ed.y2} tono={tonoDe(ed.sector)} k={foco.k} flujo={!ed.faint}
                  opacity={sectorAb && ed.faint && ed.sector !== sectorAb ? 0.1 : ed.faint ? 0.35 : 0.5} />
              ))}
              {pos.map((p) => {
                const dim = sectorAb != null && p.kind === "sector" && p.nd.key !== sectorAb;
                const mostrarLabel = p.kind === "sector" || sectorAb != null;
                return (
                  <Nodo
                    key={p.nd.key}
                    x={p.x} y={p.y} r={p.r} k={foco.k}
                    tono={tonoDe(p.nd.sector)}
                    label={mostrarLabel && !dim ? corto(p.label, p.kind === "sector" ? 30 : 22) : undefined}
                    anchor={anchorDeCos(Math.cos(rad(p.ang)))}
                    anguloEtiqueta={p.kind === "sector" ? p.ang : undefined}
                    fontSize={p.kind === "sector" ? 9.5 : p.kind === "pliego" ? 8 : 6.5}
                    hovered={hover === p.nd.key}
                    selected={sel?.key === p.nd.key}
                    foco={p.nd.key === focoKey}
                    punteado={p.kind === "sector" && esAutonomo(p.nd.sector)}
                    entra={p.kind !== "sector"}
                    indice={p.indice}
                    atenuado={dim}
                    onEnter={() => setHover(p.nd.key)}
                    onLeave={() => setHover(null)}
                    onClick={() => abrir(p.nd)}
                    aria={p.label}
                  />
                );
              })}
              <NodoCentro x={C} y={C} k={foco.k} lineas={["Gobierno", "Nacional"]} onClick={() => { setSectorAb(null); setPliegoAb(null); setSel(null); }} aria="Gobierno Nacional (ver todo)" />
            </g>
          </svg>
        </GrafoMarco>

        <GrafoAside>
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
              <p className="text-meta leading-relaxed text-inkSoft">Tocá un sector para abrirlo: sus pliegos brotan (lo que depende de él) y el zoom va solo. Tocá un nodo para su presupuesto.</p>
              <div className="space-y-1.5">
                <ChipLeyenda tono="granate" forma="punto">del Poder Ejecutivo (ministerios)</ChipLeyenda>
                <ChipLeyenda tono="anil" forma="punteado">autónomo (no depende del Ejecutivo)</ChipLeyenda>
                <span className="text-rotulo text-mute">el tamaño es el presupuesto</span>
              </div>
            </div>
          )}
        </GrafoAside>
      </GrafoColumnas>

      <p className="text-rotulo leading-relaxed text-mute">
        Estructura presupuestal oficial del MEF (sector → pliego → unidad ejecutora), {anio}. Es de quién depende quién en
        el Gobierno Nacional; los autónomos no responden al Ejecutivo. Para revisión, no una acusación.
      </p>
    </GrafoSeccion>
  );
}
