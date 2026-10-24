"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import { baseApiNavegador } from "@/lib/api-client";
import type { TerritorioNodo } from "@/lib/poder";
import type { Cadena } from "@/lib/cadena";

/**
 * Explorador territorial del Estado (migración 125): UN SOLO ÁRBOL con TODOS los nodos —El Estado → las 25 regiones →
 * todas sus provincias → todos sus distritos (~1.841)— con ZOOM y ARRASTRE para navegarlo, sin niveles ni topes. Al
 * tocar una entidad, el panel lateral muestra quién la gobierna (la autoridad = el afiliado), su captura, de quién
 * depende y su CADENA de captura (empresas ligadas → quién aprueba). Filtro por región (hace zoom ahí). En rojo las que
 * tienen indicios de captura. Los municipios son autónomos pero territorialmente anidados. Indicios, no acusación.
 */
const fuerte = (n: TerritorioNodo) => (n.n_captura ?? 0) > 0;
const fuerteLazo = (ls: string[]) => ls.includes("partido_gobernante") || ls.includes("socio_en_entidad");
function corto(s: string, n: number) {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
const nivelTxt = (n: string) => (n === "regional" ? "Gobierno regional" : n === "provincial" ? "Municipalidad provincial" : "Municipalidad distrital");

type Pos = { n: TerritorioNodo; x: number; y: number; r: number; ang: number; label: string };

const W = 1000;
const H = 1000;
const CX = W / 2;
const CY = H / 2;
const RR = { regional: 175, provincial: 310, distrital: 445 } as const;

export function ExploradorTerritorio({ nodos }: { nodos: TerritorioNodo[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<TerritorioNodo | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cadena, setCadena] = useState<Cadena | null>(null);
  const [cargandoCadena, setCargandoCadena] = useState(false);
  const [filtroDep, setFiltroDep] = useState<string>("");
  const [vista, setVista] = useState({ k: 1, x: 0, y: 0 });
  const arrastre = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  // Construir el árbol completo y asignar posiciones radiales (partición angular por nº de hojas/distritos).
  const { posList, posByRuc, edges, regiones } = useMemo(() => {
    const regs = nodos.filter((n) => n.nivel === "regional").map((n) => n.departamento);
    const provsDe = (d: string) => [...new Set(nodos.filter((n) => n.nivel === "provincial" && n.departamento === d).map((n) => n.provincia as string))];
    const distsDe = (d: string, p: string) => nodos.filter((n) => n.nivel === "distrital" && n.departamento === d && n.provincia === p);
    const nodoReg = (d: string) => nodos.find((n) => n.nivel === "regional" && n.departamento === d)!;
    const nodoProv = (d: string, p: string) => nodos.find((n) => n.nivel === "provincial" && n.departamento === d && n.provincia === p);

    const hojasProv = (d: string, p: string) => Math.max(distsDe(d, p).length, 1);
    const hojasReg = (d: string) => Math.max(provsDe(d).reduce((s, p) => s + hojasProv(d, p), 0), 1);
    const L = regs.reduce((s, d) => s + hojasReg(d), 0) || 1;

    const posList: Pos[] = [];
    const posByRuc = new Map<string, Pos>();
    const edges: { x1: number; y1: number; x2: number; y2: number; fuerte: boolean }[] = [];
    const push = (n: TerritorioNodo, ang: number, lvl: keyof typeof RR, label: string) => {
      const r = lvl === "regional" ? 8 : lvl === "provincial" ? 5 : 3.2;
      const a = (ang * Math.PI) / 180;
      const p: Pos = { n, x: CX + RR[lvl] * Math.cos(a), y: CY + RR[lvl] * Math.sin(a), r, ang, label };
      posList.push(p);
      posByRuc.set(n.ruc, p);
      return p;
    };

    let ang = -90;
    const regMeta: { dep: string; ang: number }[] = [];
    for (const d of regs.sort()) {
      const span = (hojasReg(d) / L) * 360;
      const regNode = nodoReg(d);
      const regPos = push(regNode, ang + span / 2, "regional", tituloNatural(d));
      regMeta.push({ dep: d, ang: ang + span / 2 });
      edges.push({ x1: CX, y1: CY, x2: regPos.x, y2: regPos.y, fuerte: fuerte(regNode) });
      let a2 = ang;
      for (const p of provsDe(d)) {
        const pspan = (hojasProv(d, p) / hojasReg(d)) * span;
        const provN = nodoProv(d, p);
        if (provN) {
          const provPos = push(provN, a2 + pspan / 2, "provincial", tituloNatural(p));
          edges.push({ x1: regPos.x, y1: regPos.y, x2: provPos.x, y2: provPos.y, fuerte: fuerte(provN) });
          const dists = distsDe(d, p);
          dists.forEach((dn, k) => {
            const da = a2 + ((k + 0.5) / Math.max(dists.length, 1)) * pspan;
            const dPos = push(dn, da, "distrital", tituloNatural(dn.distrito ?? dn.nombre));
            edges.push({ x1: provPos.x, y1: provPos.y, x2: dPos.x, y2: dPos.y, fuerte: fuerte(dn) });
          });
        }
        a2 += pspan;
      }
      ang += span;
    }
    return { posList, posByRuc, edges, regiones: regMeta };
  }, [nodos]);

  // Cadena de captura (Capa C) al seleccionar.
  useEffect(() => {
    if (!sel) { setCadena(null); return; }
    let vivo = true;
    setCadena(null);
    setCargandoCadena(true);
    fetch(`${baseApiNavegador()}/cadena/entidad/${sel.ruc}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Cadena | null) => { if (vivo) setCadena(d); })
      .catch(() => { if (vivo) setCadena(null); })
      .finally(() => { if (vivo) setCargandoCadena(false); });
    return () => { vivo = false; };
  }, [sel]);

  const nHijos = (n: TerritorioNodo) => {
    if (n.nivel === "regional") return new Set(nodos.filter((x) => x.nivel === "provincial" && x.departamento === n.departamento).map((x) => x.provincia)).size;
    if (n.nivel === "provincial") return nodos.filter((x) => x.nivel === "distrital" && x.departamento === n.departamento && x.provincia === n.provincia).length;
    return 0;
  };

  // Zoom hacia el cursor.
  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const my = ((e.clientY - rect.top) / rect.height) * H;
    setVista((v) => {
      const k2 = Math.min(14, Math.max(1, v.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      // mantener el punto bajo el cursor fijo: (m - x)/k constante
      return { k: k2, x: mx - ((mx - v.x) / v.k) * k2, y: my - ((my - v.y) / v.k) * k2 };
    });
  }
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    arrastre.current = { x: e.clientX, y: e.clientY, vx: vista.x, vy: vista.y, moved: false };
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const a = arrastre.current;
    if (!a) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - a.x) / rect.width) * W;
    const dy = ((e.clientY - a.y) / rect.height) * H;
    if (Math.abs(e.clientX - a.x) + Math.abs(e.clientY - a.y) > 3) a.moved = true;
    setVista((v) => ({ ...v, x: a.vx + dx, y: a.vy + dy }));
  }
  function onPointerUp() { arrastre.current = null; }

  function irARegion(dep: string) {
    setFiltroDep(dep);
    if (!dep) { setVista({ k: 1, x: 0, y: 0 }); return; }
    const reg = regiones.find((r) => r.dep === dep);
    if (!reg) return;
    // zoom al sector de la región
    const a = (reg.ang * Math.PI) / 180;
    const fx = CX + 330 * Math.cos(a);
    const fy = CY + 330 * Math.sin(a);
    const k = 3.2;
    setVista({ k, x: CX - fx * k, y: CY - fy * k });
  }

  const mostrarEtiqueta = (p: Pos) =>
    p.n.nivel === "regional" || hover === p.n.ruc || sel?.ruc === p.n.ruc || (vista.k >= 3 && p.n.nivel === "provincial") || (vista.k >= 6 && p.n.nivel === "distrital");

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-cuerpo font-semibold text-ink">El Estado y su territorio</h2>
          <p className="text-rotulo text-mute">{numero(posList.length)} entidades — rueda para zoom, arrastrá para mover, tocá una para su detalle</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={filtroDep} onChange={(e) => irARegion(e.target.value)} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-meta text-ink shadow-sm focus:border-granate focus:outline-none" aria-label="Ir a una región">
            <option value="">Todas las regiones</option>
            {regiones.map((r) => <option key={r.dep} value={r.dep}>{tituloNatural(r.dep)}</option>)}
          </select>
          <button type="button" onClick={() => { setVista({ k: 1, x: 0, y: 0 }); setFiltroDep(""); }} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-meta text-inkSoft shadow-sm hover:text-ink">Reiniciar</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="overflow-hidden rounded-xl border border-line bg-fondo/40">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full min-w-[560px] touch-none select-none"
            style={{ cursor: arrastre.current ? "grabbing" : "grab" }}
            role="img"
            aria-label={`Árbol territorial del Estado: ${numero(posList.length)} entidades`}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <g transform={`translate(${vista.x} ${vista.y}) scale(${vista.k})`}>
              {edges.map((ed, i) => (
                <line key={i} x1={ed.x1} y1={ed.y1} x2={ed.x2} y2={ed.y2} className={ed.fuerte ? "stroke-crimson" : "stroke-granate"} strokeWidth={0.5 / vista.k} strokeOpacity={0.3} />
              ))}
              {posList.map((p) => {
                const eh = hover === p.n.ruc;
                const es = sel?.ruc === p.n.ruc;
                const r = p.r * (eh || es ? 1.6 : 1);
                return (
                  <g key={p.n.ruc} className="cursor-pointer"
                     onPointerEnter={() => setHover(p.n.ruc)} onPointerLeave={() => setHover(null)}
                     onClick={() => { if (!arrastre.current?.moved) setSel(p.n); }}
                     role="button" tabIndex={-1} aria-label={p.label}>
                    {es && <circle cx={p.x} cy={p.y} r={r + 3 / vista.k} className="fill-none stroke-ink" strokeWidth={1 / vista.k} />}
                    <circle cx={p.x} cy={p.y} r={r} className={`${fuerte(p.n) ? "fill-crimson/40 stroke-crimson" : "fill-granate/35 stroke-granate"}`} strokeWidth={0.6 / vista.k} />
                    {mostrarEtiqueta(p) && (
                      <text x={p.x + (Math.cos((p.ang * Math.PI) / 180) >= 0 ? r + 2 / vista.k : -(r + 2 / vista.k))} y={p.y + 1 / vista.k}
                        textAnchor={Math.cos((p.ang * Math.PI) / 180) >= 0 ? "start" : "end"}
                        className={`pointer-events-none ${eh || es ? "fill-ink font-semibold" : "fill-inkSoft"}`}
                        style={{ fontSize: `${(p.n.nivel === "regional" ? 9 : 7) / vista.k}px` }}>
                        {corto(p.label, 20)}
                      </text>
                    )}
                  </g>
                );
              })}
              <circle cx={CX} cy={CY} r={11} className="fill-paperSoft stroke-ink" strokeWidth={1.5 / vista.k} />
              <text x={CX} y={CY + 1} textAnchor="middle" className="fill-ink font-semibold" style={{ fontSize: `${8 / vista.k}px` }}>El Estado</text>
            </g>
          </svg>
        </div>

        <aside className="rounded-xl border border-line bg-paperSoft/50 p-4">
          {sel ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-cuerpo font-semibold leading-tight text-ink">{tituloNatural(sel.nombre)}</div>
                  <div className="text-rotulo text-mute">{nivelTxt(sel.nivel)}</div>
                </div>
                <button type="button" onClick={() => setSel(null)} className="text-mute hover:text-ink" aria-label="Cerrar detalle">✕</button>
              </div>
              {sel.autoridad ? <p className="text-meta text-inkSoft">La gobierna <b className="text-ink">{tituloNatural(sel.autoridad)}</b>{sel.partido ? <> del partido <b className="text-ink">{tituloNatural(sel.partido)}</b></> : null}.</p> : null}
              <div className="rounded-lg border border-line bg-paper px-3 py-2">
                {(sel.n_captura ?? 0) > 0 ? (
                  <>
                    <div className="font-mono text-cuerpo font-semibold tabular-nums text-crimson">{numero(sel.n_captura)}</div>
                    <div className="text-rotulo text-mute">contratos con indicio, {solesCompacto(sel.monto_captura)}</div>
                  </>
                ) : <div className="text-meta text-mute">Sin indicios de captura.</div>}
              </div>
              <div className="text-rotulo text-mute">Depende de: {sel.nivel === "distrital" ? `${tituloNatural(sel.provincia ?? "")}, ${tituloNatural(sel.departamento)}` : sel.nivel === "provincial" ? tituloNatural(sel.departamento) : "Gobierno del Perú"}</div>
              {sel.nivel !== "distrital" && <div className="text-rotulo text-mute">Contiene {numero(nHijos(sel))} {sel.nivel === "regional" ? "provincias" : "distritos"}.</div>}

              {cargandoCadena && <div className="border-t border-line pt-2 text-rotulo text-mute">cargando la cadena…</div>}
              {cadena?.disponible && cadena.empresas && cadena.empresas.length > 0 && (
                <div className="space-y-1.5 border-t border-line pt-2">
                  <div className="text-rotulo font-semibold uppercase tracking-wide text-mute">La cadena de captura</div>
                  <p className="text-rotulo leading-relaxed text-inkSoft"><b className="text-ink">{numero(cadena.empresas.length)}</b> {cadena.empresas.length === 1 ? "empresa ligada" : "empresas ligadas"} al partido ganan sus contratos; los aprueba <b className="text-ink">{cadena.decision?.apruebaContratos ?? "la entidad"}</b>.</p>
                  <div className="flex flex-wrap gap-1">
                    {cadena.empresas.slice(0, 6).map((emp) => (
                      <button key={emp.ruc} type="button" onClick={() => router.push(`/empresa/${emp.ruc}`)} className={`rounded-full px-2 py-0.5 text-rotulo transition-opacity hover:opacity-80 ${fuerteLazo(emp.lazos) ? "bg-crimson/10 text-crimson" : "bg-amber/10 text-amber"}`}>{corto(emp.nombre ?? emp.ruc, 18)}</button>
                    ))}
                  </div>
                </div>
              )}
              <button type="button" onClick={() => router.push(`/entidad/${sel.ruc}`)} className="mt-1 w-full rounded-lg bg-granate px-3 py-2 text-meta font-semibold text-sobreMaiz transition-opacity duration-rapido hover:opacity-90">Ver ficha completa →</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-cuerpo font-semibold text-ink">El Estado</div>
                <div className="text-rotulo text-mute">{numero(posList.length)} entidades, de las 25 regiones a cada distrito</div>
              </div>
              <p className="text-meta leading-relaxed text-inkSoft">Están TODAS: el centro es el Estado, el primer anillo las regiones, luego las provincias y afuera los distritos. Rueda para acercarte, arrastrá para moverte, tocá un nodo para su detalle y su cadena de captura.</p>
              <div className="space-y-1.5 text-rotulo text-mute">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson/70" aria-hidden /> con indicios de captura</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-granate/70" aria-hidden /> sin ese indicio</span>
                <span>anillos: regiones → provincias → distritos</span>
              </div>
            </div>
          )}
        </aside>
      </div>

      <p className="text-rotulo leading-relaxed text-mute">
        Jerarquía territorial (departamento → provincia → distrito). Los municipios son autónomos, pero están anidados en su
        territorio. Fuentes: JNE/ONPE/RNP. Indicios para revisión humana, no una acusación.
      </p>
    </section>
  );
}
