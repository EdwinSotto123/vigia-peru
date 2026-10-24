"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import type { PoderEntidad } from "@/lib/poder";

/**
 * Dónde gobierna un partido, por región: El partido en el centro, alrededor los departamentos donde gobierna (tamaño =
 * cuántas entidades controla ahí) y, al tocar uno, TODAS sus entidades de ese departamento con su autoridad (el afiliado
 * que las gobierna), clickeables a su ficha. En rojo las que tienen indicios de captura. Indicios, no acusación.
 */
const fuerte = (e: PoderEntidad) => (e.n_captura ?? 0) > 0;
function corto(s: string, n: number) {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
const nivelTxt = (n: string) => (n === "regional" ? "Gobierno regional" : n === "provincial" ? "Municipalidad provincial" : "Municipalidad distrital");

export function GrafoPartidoRegiones({ partido, entidades }: { partido: string; entidades: PoderEntidad[] }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null); // departamento

  const deps = useMemo(() => {
    const m = new Map<string, PoderEntidad[]>();
    for (const e of entidades) {
      const d = (e.departamento ?? "—").toString();
      const arr = m.get(d) ?? [];
      arr.push(e);
      m.set(d, arr);
    }
    return [...m.entries()]
      .map(([dep, ents]) => ({ dep, ents: ents.sort((a, b) => (b.n_captura ?? 0) - (a.n_captura ?? 0)) }))
      .sort((a, b) => b.ents.length - a.ents.length);
  }, [entidades]);

  const W = 1180;
  const H = foco ? 900 : 980;
  const cx = W / 2;
  const cy = H / 2;

  const maxDep = Math.max(...deps.map((d) => d.ents.length), 1);
  const focoEnts = foco ? (deps.find((d) => d.dep === foco)?.ents ?? []).slice(0, 28) : [];

  const nodos = useMemo(() => {
    if (foco) {
      const K = focoEnts.length;
      const Re = 320;
      return focoEnts.map((e, k) => {
        const a = ((-90 + (k + 0.5) * (360 / Math.max(K, 1))) * Math.PI) / 180;
        return { e, a, cos: Math.cos(a), x: cx + Re * Math.cos(a), y: cy + Re * Math.sin(a), r: 8 + 9 * Math.sqrt((e.n_captura ?? 0) / Math.max(...focoEnts.map((x) => x.n_captura ?? 0), 1)) };
      });
    }
    const N = Math.min(deps.length, 25);
    const Rd = 330;
    return deps.slice(0, N).map((d, i) => {
      const a = ((-90 + (i + 0.5) * (360 / N)) * Math.PI) / 180;
      return { dep: d.dep, ents: d.ents, a, cos: Math.cos(a), x: cx + Rd * Math.cos(a), y: cy + Rd * Math.sin(a), r: 10 + 16 * Math.sqrt(d.ents.length / maxDep) };
    });
  }, [deps, foco, focoEnts, cx, cy, maxDep]);

  const detE = hover ? entidades.find((e) => e.entidad_ruc === hover) : null;
  const totalDep = deps.length;

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {foco ? (
          <button type="button" onClick={() => setFoco(null)} className="flex items-center gap-1.5 text-meta font-semibold text-granate hover:underline underline-offset-2">
            ← Todas las regiones
          </button>
        ) : (
          <h2 className="text-cuerpo font-semibold text-ink">Dónde gobierna, por región</h2>
        )}
        <span className="text-rotulo text-mute">
          {foco ? `${tituloNatural(foco)}: ${numero(deps.find((d) => d.dep === foco)?.ents.length ?? 0)} entidades` : `${numero(totalDep)} departamentos — tocá uno para ver sus entidades`}
        </span>
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">
        {foco
          ? "Cada entidad que gobierna el partido en esta región, con su autoridad. Tocá una para ir a su ficha; en rojo las que tienen indicios de captura."
          : "El partido al centro; alrededor, los departamentos donde gobierna (más grande = más entidades). Tocá un departamento para ver todas sus entidades y quién las gobierna."}
      </p>

      <div className="relative overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[800px] touch-manipulation select-none" role="img"
             aria-label={foco ? `${tituloNatural(foco)}: entidades del partido` : `${tituloNatural(partido)}: departamentos donde gobierna`}>
          {/* radios */}
          {nodos.map((nd, i) => (
            <line
              key={`l${i}`}
              x1={cx} y1={cy} x2={nd.x} y2={nd.y}
              className={foco ? (fuerte((nd as { e: PoderEntidad }).e) ? "stroke-crimson" : "stroke-granate") : "stroke-line"}
              strokeWidth={foco ? 1.3 : 1.4}
              strokeOpacity={hover && foco && hover !== (nd as { e: PoderEntidad }).e?.entidad_ruc ? 0.12 : foco ? 0.45 : 0.6}
              strokeLinecap="round"
            />
          ))}

          {/* nodos */}
          {foco
            ? focoNodes(nodos as FocoNodo[], { cx, cy, hover, setHover, router })
            : depNodes(nodos as DepNodo[], { cx, cy, setFoco })}

          {/* centro */}
          <circle cx={cx} cy={cy} r={foco ? 40 : 38} className="fill-paperSoft stroke-granate stroke-[2.5]" />
          <text x={cx} y={cy - 2} textAnchor="middle" className="fill-ink text-[12px] font-semibold">{foco ? tituloNatural(foco) : corto(partido, 16)}</text>
          <text x={cx} y={cy + 13} textAnchor="middle" className="fill-mute text-[9px]">{foco ? "del partido" : "el partido"}</text>
        </svg>

        {detE && (
          <div className="pointer-events-none absolute right-2 top-2 max-w-[270px] rounded-xl border border-line bg-paper/95 p-3 shadow-sm backdrop-blur">
            <div className="text-meta font-semibold text-ink">{corto(detE.entidad, 46)}</div>
            <div className="mt-0.5 text-rotulo text-mute">{nivelTxt(detE.nivel)}{detE.departamento ? ` — ${tituloNatural(detE.departamento)}` : ""}</div>
            {detE.autoridad ? <div className="mt-1 text-rotulo text-inkSoft">la gobierna <b className="text-ink">{tituloNatural(detE.autoridad)}</b>{detE.cargo_gob ? ` (${detE.cargo_gob.toLowerCase()})` : ""}</div> : null}
            {(detE.n_captura ?? 0) > 0 ? <div className="mt-1 font-mono text-rotulo text-crimson">{numero(detE.n_captura)} contratos con indicio, {solesCompacto(detE.monto_captura)}</div> : <div className="mt-1 text-rotulo text-mute">sin indicios de captura</div>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-rotulo text-mute">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson/70" aria-hidden /> con indicios de captura</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-granate/70" aria-hidden /> sin ese indicio</span>
        <span className="text-mute">la autoridad de cada entidad es quien la gobierna por el partido</span>
      </div>
    </section>
  );
}

type DepNodo = { dep: string; ents: PoderEntidad[]; a: number; cos: number; x: number; y: number; r: number };
type FocoNodo = { e: PoderEntidad; a: number; cos: number; x: number; y: number; r: number };

function depNodes(nodos: DepNodo[], ctx: { cx: number; cy: number; setFoco: (d: string) => void }) {
  return nodos.map((nd) => {
    const anchor = nd.cos > 0.25 ? "start" : nd.cos < -0.25 ? "end" : "middle";
    const lx = nd.x + (nd.r + 7) * Math.cos(nd.a) + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0);
    const ly = nd.y + (nd.r + 7) * Math.sin(nd.a) + (anchor === "middle" ? (Math.sin(nd.a) > 0 ? 11 : -5) : 4);
    return (
      <g key={nd.dep} className="cursor-pointer" onClick={() => ctx.setFoco(nd.dep)} role="button" tabIndex={0}
         onKeyDown={(ev) => { if (ev.key === "Enter") ctx.setFoco(nd.dep); }} aria-label={`Ver ${tituloNatural(nd.dep)}: ${nd.ents.length} entidades`}>
        <circle cx={nd.x} cy={nd.y} r={nd.r} className="fill-granate/25 stroke-granate stroke-[2]" />
        <text x={lx} y={ly} textAnchor={anchor} className="pointer-events-none fill-ink text-[11px] font-semibold">
          {tituloNatural(nd.dep)} <tspan className="fill-mute">({nd.ents.length})</tspan>
        </text>
      </g>
    );
  });
}

function focoNodes(nodos: FocoNodo[], ctx: { cx: number; cy: number; hover: string | null; setHover: (r: string | null) => void; router: ReturnType<typeof useRouter> }) {
  return nodos.map((nd) => {
    const anchor = nd.cos > 0.25 ? "start" : nd.cos < -0.25 ? "end" : "middle";
    const lx = nd.x + (nd.r + 7) * Math.cos(nd.a) + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0);
    const ly = nd.y + (nd.r + 7) * Math.sin(nd.a) + (anchor === "middle" ? (Math.sin(nd.a) > 0 ? 11 : -5) : 4);
    const f = (nd.e.n_captura ?? 0) > 0;
    return (
      <g key={nd.e.entidad_ruc} className="cursor-pointer" opacity={ctx.hover && ctx.hover !== nd.e.entidad_ruc ? 0.4 : 1}
         onMouseEnter={() => ctx.setHover(nd.e.entidad_ruc)} onMouseLeave={() => ctx.setHover(null)}
         onClick={() => ctx.router.push(`/entidad/${nd.e.entidad_ruc}`)} role="link" tabIndex={0}
         onKeyDown={(ev) => { if (ev.key === "Enter") ctx.router.push(`/entidad/${nd.e.entidad_ruc}`); }}
         aria-label={`${corto(nd.e.entidad, 60)}${nd.e.autoridad ? `, gobierna ${corto(nd.e.autoridad, 40)}` : ""}`}>
        <circle cx={nd.x} cy={nd.y} r={nd.r} className={`${f ? "fill-crimson/30 stroke-crimson" : "fill-granate/25 stroke-granate"} stroke-[1.5]`} />
        <text x={lx} y={ly} textAnchor={anchor} className="pointer-events-none fill-inkSoft text-[10px] font-medium">{corto(nd.e.entidad, 22)}</text>
      </g>
    );
  });
}
