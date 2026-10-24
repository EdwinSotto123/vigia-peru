"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import { baseApiNavegador } from "@/lib/api-client";
import type { TerritorioNodo } from "@/lib/poder";
import type { Cadena } from "@/lib/cadena";

/**
 * Explorador territorial del Estado (migración 125): radial COLAPSABLE con AUTO-ZOOM. Se ve el Estado + las 25 regiones;
 * al tocar una región aparecen sus provincias y el zoom va solo hasta ella; al tocar una provincia aparecen sus distritos.
 * Progresivo (los datos aparecen al clickear), navegable, con panel lateral que trae el detalle + la cadena de captura.
 * En rojo las que tienen indicios de captura. Los municipios son autónomos pero territorialmente anidados. Indicios, no
 * acusación.
 */
const fuerte = (n: TerritorioNodo) => (n.n_captura ?? 0) > 0;
const fuerteLazo = (ls: string[]) => ls.includes("partido_gobernante") || ls.includes("socio_en_entidad");
function corto(s: string, n: number) {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
const nivelTxt = (n: string) => (n === "regional" ? "Gobierno regional" : n === "provincial" ? "Municipalidad provincial" : "Municipalidad distrital");

const VB = 1000;
const C = VB / 2;
const R1 = 215; // regiones desde el centro
const PR = 155; // provincias desde su región
const DR = 108; // distritos desde su provincia
const rad = (deg: number) => (deg * Math.PI) / 180;

type P = { n: TerritorioNodo; x: number; y: number; r: number; ang: number; label: string; nivel: "regional" | "provincial" | "distrital" };

export function ExploradorTerritorio({ nodos }: { nodos: TerritorioNodo[] }) {
  const router = useRouter();
  const [regAbierta, setRegAbierta] = useState<string | null>(null);
  const [provAbierta, setProvAbierta] = useState<string | null>(null);
  const [sel, setSel] = useState<TerritorioNodo | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cadena, setCadena] = useState<Cadena | null>(null);
  const [cargandoCadena, setCargandoCadena] = useState(false);

  const regiones = useMemo(
    () => nodos.filter((n) => n.nivel === "regional").sort((a, b) => a.departamento.localeCompare(b.departamento)),
    [nodos],
  );
  const provsDe = (d: string) => nodos.filter((n) => n.nivel === "provincial" && n.departamento === d).sort((a, b) => (b.n_captura ?? 0) - (a.n_captura ?? 0));
  const distsDe = (d: string, p: string) => nodos.filter((n) => n.nivel === "distrital" && n.departamento === d && n.provincia === p).sort((a, b) => (b.n_captura ?? 0) - (a.n_captura ?? 0));
  const nHijos = (n: TerritorioNodo) =>
    n.nivel === "regional" ? new Set(nodos.filter((x) => x.nivel === "provincial" && x.departamento === n.departamento).map((x) => x.provincia)).size
      : n.nivel === "provincial" ? distsDe(n.departamento, n.provincia ?? "").length : 0;

  // Posiciones: regiones siempre; la región abierta despliega sus provincias; la provincia abierta sus distritos.
  const { nodosPos, edges, foco } = useMemo(() => {
    const N = regiones.length || 1;
    const pos: P[] = [];
    const byRuc = new Map<string, P>();
    const edges: { a: P | null; x1: number; y1: number; bx: number; by: number; fuerte: boolean }[] = [];
    const F: { reg: P | null; prov: P | null } = { reg: null, prov: null };

    regiones.forEach((rn, i) => {
      const ang = -90 + (i * 360) / N;
      const rp: P = { n: rn, x: C + R1 * Math.cos(rad(ang)), y: C + R1 * Math.sin(rad(ang)), r: 9, ang, label: tituloNatural(rn.departamento), nivel: "regional" };
      pos.push(rp); byRuc.set(rn.ruc, rp);
      edges.push({ a: null, x1: C, y1: C, bx: rp.x, by: rp.y, fuerte: fuerte(rn) });
      if (rn.departamento === regAbierta) {
        F.reg = rp;
        const provs = provsDe(rn.departamento);
        const K = provs.length;
        const spread = Math.min(14, 130 / Math.max(K - 1, 1));
        provs.forEach((pn, k) => {
          const pa = ang + (k - (K - 1) / 2) * spread;
          const pp: P = { n: pn, x: rp.x + PR * Math.cos(rad(pa)), y: rp.y + PR * Math.sin(rad(pa)), r: 6, ang: pa, label: tituloNatural(pn.provincia ?? ""), nivel: "provincial" };
          pos.push(pp); byRuc.set(pn.ruc, pp);
          edges.push({ a: rp, x1: rp.x, y1: rp.y, bx: pp.x, by: pp.y, fuerte: fuerte(pn) });
          if (pn.provincia === provAbierta) {
            F.prov = pp;
            const dists = distsDe(rn.departamento, pn.provincia ?? "");
            const M = dists.length;
            const phi = Math.atan2(pp.y - rp.y, pp.x - rp.x) * (180 / Math.PI);
            const spreadD = Math.min(12, 150 / Math.max(M - 1, 1));
            dists.forEach((dn, m) => {
              const da = phi + (m - (M - 1) / 2) * spreadD;
              const dp: P = { n: dn, x: pp.x + DR * Math.cos(rad(da)), y: pp.y + DR * Math.sin(rad(da)), r: 4.5, ang: da, label: tituloNatural(dn.distrito ?? dn.nombre), nivel: "distrital" };
              pos.push(dp); byRuc.set(dn.ruc, dp);
              edges.push({ a: pp, x1: pp.x, y1: pp.y, bx: dp.x, by: dp.y, fuerte: fuerte(dn) });
            });
          }
        });
      }
    });

    // foco + transform
    let k = 1, tx = 0, ty = 0;
    const target = F.prov ?? F.reg;
    if (target) {
      const out = rad(target.ang);
      const push = F.prov ? 60 : 82;
      const px = target.x + push * Math.cos(out);
      const py = target.y + push * Math.sin(out);
      k = F.prov ? 2.9 : 2.0;
      tx = C - px * k;
      ty = C - py * k;
    }
    return { nodosPos: pos, edges, foco: { k, tx, ty } };
  }, [nodos, regiones, regAbierta, provAbierta]);

  useEffect(() => {
    if (!sel) { setCadena(null); return; }
    let vivo = true;
    setCadena(null); setCargandoCadena(true);
    fetch(`${baseApiNavegador()}/cadena/entidad/${sel.ruc}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Cadena | null) => { if (vivo) setCadena(d); })
      .catch(() => { if (vivo) setCadena(null); })
      .finally(() => { if (vivo) setCargandoCadena(false); });
    return () => { vivo = false; };
  }, [sel]);

  function abrir(p: P) {
    setSel(p.n);
    if (p.nivel === "regional") { setRegAbierta(p.n.departamento); setProvAbierta(null); }
    else if (p.nivel === "provincial") { setProvAbierta(p.n.provincia ?? null); }
  }

  const mostrarEtiqueta = (p: P) => p.nivel === "regional" || regAbierta != null;

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1.5 text-meta">
          <button type="button" onClick={() => { setRegAbierta(null); setProvAbierta(null); setSel(null); }} className={`font-semibold ${regAbierta ? "text-granate hover:underline underline-offset-2" : "text-ink"}`}>El Estado</button>
          {regAbierta && <span className="text-mute" aria-hidden>›</span>}
          {regAbierta && <button type="button" onClick={() => { setProvAbierta(null); setSel(null); }} className={`font-semibold ${provAbierta ? "text-granate hover:underline underline-offset-2" : "text-ink"}`}>{tituloNatural(regAbierta)}</button>}
          {provAbierta && <span className="text-mute" aria-hidden>›</span>}
          {provAbierta && <span className="font-semibold text-ink">{tituloNatural(provAbierta)}</span>}
        </nav>
        <select
          value={regAbierta ?? ""}
          onChange={(e) => { setRegAbierta(e.target.value || null); setProvAbierta(null); setSel(null); }}
          className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-meta text-ink shadow-sm focus:border-granate focus:outline-none"
          aria-label="Ir a una región"
        >
          <option value="">Todas las regiones</option>
          {regiones.map((r) => <option key={r.departamento} value={r.departamento}>{tituloNatural(r.departamento)}</option>)}
        </select>
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">
        {!regAbierta ? "El Estado al centro y las 25 regiones. Tocá una región: aparecen sus provincias y el zoom va solo hasta ahí."
          : !provAbierta ? "Las provincias de la región. Tocá una para abrir sus distritos; el panel muestra quién la gobierna y su cadena."
          : "Los distritos de la provincia. Tocá uno para su detalle, o las migas para volver."}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="overflow-hidden rounded-xl border border-line bg-fondo/40">
          <svg viewBox={`0 0 ${VB} ${VB}`} className="h-auto w-full min-w-[520px] touch-manipulation select-none" role="img" aria-label="Explorador territorial del Estado">
            <g style={{ transform: `translate(${foco.tx}px, ${foco.ty}px) scale(${foco.k})`, transition: "transform 650ms cubic-bezier(0.4,0,0.2,1)" }}>
              {edges.map((ed, i) => (
                <line key={i} x1={ed.x1} y1={ed.y1} x2={ed.bx} y2={ed.by} className={ed.fuerte ? "stroke-crimson" : "stroke-granate"} strokeWidth={1 / foco.k} strokeOpacity={regAbierta && !ed.a ? 0.12 : 0.4} strokeLinecap="round" />
              ))}
              {nodosPos.map((p) => {
                const eh = hover === p.n.ruc;
                const es = sel?.ruc === p.n.ruc;
                const dim = regAbierta != null && p.nivel === "regional" && p.n.departamento !== regAbierta;
                const r = p.r * (eh || es ? 1.5 : 1);
                const anchor = Math.cos(rad(p.ang)) >= 0 ? "start" : "end";
                return (
                  <g key={p.n.ruc} className="cursor-pointer" opacity={dim ? 0.3 : 1}
                     onPointerEnter={() => setHover(p.n.ruc)} onPointerLeave={() => setHover(null)}
                     onClick={() => abrir(p)} role="button" tabIndex={-1} aria-label={p.label}>
                    {es && <circle cx={p.x} cy={p.y} r={r + 4 / foco.k} className="fill-none stroke-ink" strokeWidth={1.2 / foco.k} />}
                    <circle cx={p.x} cy={p.y} r={r} className={`${fuerte(p.n) ? "fill-crimson/35 stroke-crimson" : "fill-granate/30 stroke-granate"}`} strokeWidth={1.2 / foco.k} />
                    {mostrarEtiqueta(p) && !dim && (
                      <text x={p.x + (anchor === "start" ? r + 3 / foco.k : -(r + 3 / foco.k))} y={p.y + 1 / foco.k} textAnchor={anchor}
                        className={`pointer-events-none ${eh || es ? "fill-ink font-semibold" : "fill-inkSoft"}`}
                        style={{ fontSize: `${(p.nivel === "regional" ? 10 : p.nivel === "provincial" ? 8 : 6.5) / foco.k}px` }}>
                        {corto(p.label, 20)}
                      </text>
                    )}
                  </g>
                );
              })}
              <circle cx={C} cy={C} r={13} className="cursor-pointer fill-paperSoft stroke-ink" strokeWidth={1.6 / foco.k} onClick={() => { setRegAbierta(null); setProvAbierta(null); setSel(null); }} role="button" aria-label="El Estado (ver todo)" />
              <text x={C} y={C + 1} textAnchor="middle" className="pointer-events-none fill-ink font-semibold" style={{ fontSize: `${8 / foco.k}px` }}>El Estado</text>
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
              {sel.nivel !== "distrital" && <div className="text-rotulo text-mute">Contiene {numero(nHijos(sel))} {sel.nivel === "regional" ? "provincias" : "distritos"} — tocá el nodo para abrirlo.</div>}
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
                <div className="text-cuerpo font-semibold text-ink">{regAbierta ? tituloNatural(regAbierta) : "El Estado"}</div>
                <div className="text-rotulo text-mute">{regAbierta ? `${numero(provsDe(regAbierta).length)} provincias` : `${numero(regiones.length)} regiones`}</div>
              </div>
              <p className="text-meta leading-relaxed text-inkSoft">Tocá una región para abrirla: aparecen sus provincias y el zoom va solo. Tocá un nodo para ver quién lo gobierna y su cadena de captura.</p>
              <div className="space-y-1.5 text-rotulo text-mute">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson/70" aria-hidden /> con indicios de captura</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-granate/70" aria-hidden /> sin ese indicio</span>
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
