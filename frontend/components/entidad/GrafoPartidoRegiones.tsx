"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import type { PoderEntidad } from "@/lib/poder";

/**
 * Dónde gobierna un partido, por región: El partido en el centro, alrededor los departamentos donde gobierna (tamaño =
 * cuántas entidades controla ahí) y, al tocar uno, TODAS sus entidades de ese departamento con su autoridad (el afiliado
 * que las gobierna), en el panel lateral y clickeables a su ficha. En rojo las que tienen indicios de captura. No acusación.
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
  const [sel, setSel] = useState<string | null>(null); // entidad_ruc en foco
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

  const W = 880;
  const H = 760;
  const cx = W / 2;
  const cy = H / 2;

  const maxDep = Math.max(...deps.map((d) => d.ents.length), 1);
  const focoEnts = foco ? (deps.find((d) => d.dep === foco)?.ents ?? []).slice(0, 28) : [];
  const maxCapFoco = Math.max(...focoEnts.map((x) => x.n_captura ?? 0), 1);

  const depNodos = deps.slice(0, 25).map((d, i) => {
    const N = Math.min(deps.length, 25);
    const a = ((-90 + (i + 0.5) * (360 / N)) * Math.PI) / 180;
    return { d, a, cos: Math.cos(a), x: cx + 266 * Math.cos(a), y: cy + 266 * Math.sin(a), r: 10 + 14 * Math.sqrt(d.ents.length / maxDep) };
  });
  const entNodos = focoEnts.map((e, k) => {
    const a = ((-90 + (k + 0.5) * (360 / Math.max(focoEnts.length, 1))) * Math.PI) / 180;
    return { e, a, cos: Math.cos(a), x: cx + 266 * Math.cos(a), y: cy + 266 * Math.sin(a), r: 8 + 10 * Math.sqrt((e.n_captura ?? 0) / maxCapFoco) };
  });

  const detE = (hover ? entidades.find((e) => e.entidad_ruc === hover) : null) ?? (sel ? entidades.find((e) => e.entidad_ruc === sel) : null);
  const totalDep = deps.length;
  const centro = foco ? tituloNatural(foco) : corto(partido, 16);

  const etiqueta = (anchor: "start" | "end" | "middle", x: number, y: number, a: number, r: number) => ({
    x: x + (r + 7) * Math.cos(a) + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0),
    y: y + (r + 7) * Math.sin(a) + (anchor === "middle" ? (Math.sin(a) > 0 ? 11 : -5) : 4),
  });

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {foco ? (
          <button type="button" onClick={() => { setFoco(null); setSel(null); }} className="flex items-center gap-1.5 text-meta font-semibold text-granate hover:underline underline-offset-2">
            ← Todas las regiones
          </button>
        ) : (
          <h2 className="text-cuerpo font-semibold text-ink">Dónde gobierna, por región</h2>
        )}
        <span className="text-rotulo text-mute">
          {foco ? `${tituloNatural(foco)}: ${numero(deps.find((d) => d.dep === foco)?.ents.length ?? 0)} entidades` : `${numero(totalDep)} departamentos — tocá uno para ver sus entidades`}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="overflow-x-auto rounded-xl border border-line bg-fondo/40">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px] touch-manipulation select-none" role="img"
               aria-label={foco ? `${tituloNatural(foco)}: entidades del partido` : `${tituloNatural(partido)}: departamentos donde gobierna`}>
            {/* radios */}
            {foco
              ? entNodos.map((nd) => (
                  <line key={`l${nd.e.entidad_ruc}`} x1={cx} y1={cy} x2={nd.x} y2={nd.y}
                    className={fuerte(nd.e) ? "stroke-crimson" : "stroke-granate"} strokeWidth={sel === nd.e.entidad_ruc ? 2 : 1.3}
                    strokeOpacity={hover && hover !== nd.e.entidad_ruc ? 0.12 : 0.45} strokeLinecap="round" />
                ))
              : depNodos.map((nd) => (
                  <line key={`l${nd.d.dep}`} x1={cx} y1={cy} x2={nd.x} y2={nd.y} className="stroke-line" strokeWidth={1.4} strokeOpacity={0.55} strokeLinecap="round" />
                ))}

            {/* nodos */}
            {foco
              ? entNodos.map((nd) => {
                  const anchor = nd.cos > 0.25 ? "start" : nd.cos < -0.25 ? "end" : "middle";
                  const { x: lx, y: ly } = etiqueta(anchor, nd.x, nd.y, nd.a, nd.r);
                  const esHover = hover === nd.e.entidad_ruc;
                  const esSel = sel === nd.e.entidad_ruc;
                  const r = nd.r + (esHover ? 3 : 0);
                  return (
                    <g key={nd.e.entidad_ruc} className="cursor-pointer transition-opacity duration-rapido" opacity={hover && !esHover ? 0.4 : 1}
                       onMouseEnter={() => setHover(nd.e.entidad_ruc)} onMouseLeave={() => setHover(null)}
                       onClick={() => setSel(nd.e.entidad_ruc)} role="button" tabIndex={0}
                       onKeyDown={(ev) => { if (ev.key === "Enter") setSel(nd.e.entidad_ruc); }}
                       aria-label={`${corto(nd.e.entidad, 60)}${nd.e.autoridad ? `, gobierna ${corto(nd.e.autoridad, 40)}` : ""}`}>
                      {esSel && <circle cx={nd.x} cy={nd.y} r={r + 5} className="fill-none stroke-ink stroke-[1.5]" />}
                      <circle cx={nd.x} cy={nd.y} r={r} className={`${fuerte(nd.e) ? "fill-crimson/30 stroke-crimson" : "fill-granate/25 stroke-granate"}`} strokeWidth={esHover || esSel ? 2.5 : 1.5} fillOpacity={esHover ? 0.5 : undefined} />
                      <text x={lx} y={ly} textAnchor={anchor} className={`pointer-events-none text-[10.5px] ${esHover || esSel ? "fill-ink font-semibold" : "fill-inkSoft font-medium"}`}>{corto(nd.e.entidad, 22)}</text>
                    </g>
                  );
                })
              : depNodos.map((nd) => {
                  const anchor = nd.cos > 0.25 ? "start" : nd.cos < -0.25 ? "end" : "middle";
                  const { x: lx, y: ly } = etiqueta(anchor, nd.x, nd.y, nd.a, nd.r);
                  const esHover = hover === nd.d.dep;
                  const r = nd.r + (esHover ? 3 : 0);
                  return (
                    <g key={nd.d.dep} className="cursor-pointer transition-opacity duration-rapido" opacity={hover && !esHover ? 0.5 : 1}
                       onMouseEnter={() => setHover(nd.d.dep)} onMouseLeave={() => setHover(null)}
                       onClick={() => { setFoco(nd.d.dep); setSel(null); }} role="button" tabIndex={0}
                       onKeyDown={(ev) => { if (ev.key === "Enter") { setFoco(nd.d.dep); setSel(null); } }}
                       aria-label={`Ver ${tituloNatural(nd.d.dep)}: ${nd.d.ents.length} entidades`}>
                      <circle cx={nd.x} cy={nd.y} r={r} className="fill-granate/25 stroke-granate" strokeWidth={esHover ? 2.5 : 2} />
                      <circle cx={nd.x} cy={nd.y} r={r + 3.5} className="fill-none stroke-ink/30 stroke-[1]" />
                      <text x={lx} y={ly} textAnchor={anchor} className={`pointer-events-none text-[11px] ${esHover ? "fill-ink font-semibold" : "fill-ink font-semibold"}`}>
                        {tituloNatural(nd.d.dep)} <tspan className="fill-mute">({nd.d.ents.length})</tspan>
                      </text>
                    </g>
                  );
                })}

            {/* centro */}
            <circle cx={cx} cy={cy} r={40} className="fill-paperSoft stroke-granate stroke-[2.5]" />
            <text x={cx} y={cy - 2} textAnchor="middle" className="fill-ink text-[12px] font-semibold">{centro}</text>
            <text x={cx} y={cy + 13} textAnchor="middle" className="fill-mute text-[9px]">{foco ? "del partido" : "el partido"}</text>
          </svg>
        </div>

        {/* panel lateral persistente */}
        <aside className="rounded-xl border border-line bg-paperSoft/50 p-4">
          {detE ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-cuerpo font-semibold leading-tight text-ink">{tituloNatural(detE.entidad)}</div>
                  <div className="text-rotulo text-mute">{nivelTxt(detE.nivel)}{detE.departamento ? ` — ${tituloNatural(detE.departamento)}` : ""}</div>
                </div>
                {sel && <button type="button" onClick={() => setSel(null)} className="text-mute hover:text-ink" aria-label="Cerrar detalle">✕</button>}
              </div>
              {detE.autoridad ? <p className="text-meta text-inkSoft">La gobierna <b className="text-ink">{tituloNatural(detE.autoridad)}</b>{detE.cargo_gob ? ` (${detE.cargo_gob.toLowerCase()})` : ""}.</p> : null}
              <div className="rounded-lg border border-line bg-paper px-3 py-2">
                {(detE.n_captura ?? 0) > 0 ? (
                  <>
                    <div className="font-mono text-cuerpo font-semibold tabular-nums text-crimson">{numero(detE.n_captura)}</div>
                    <div className="text-rotulo text-mute">contratos con indicio, {solesCompacto(detE.monto_captura)}</div>
                  </>
                ) : <div className="text-meta text-mute">Sin indicios de captura.</div>}
              </div>
              <button type="button" onClick={() => router.push(`/entidad/${detE.entidad_ruc}`)} className="mt-1 w-full rounded-lg bg-granate px-3 py-2 text-meta font-semibold text-sobreMaiz transition-opacity duration-rapido hover:opacity-90">
                Ver ficha completa →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-cuerpo font-semibold text-ink">{foco ? tituloNatural(foco) : corto(partido, 24)}</div>
                <div className="text-rotulo text-mute">{foco ? `${numero(deps.find((d) => d.dep === foco)?.ents.length ?? 0)} entidades` : `gobierna en ${numero(totalDep)} departamentos`}</div>
              </div>
              <p className="text-meta leading-relaxed text-inkSoft">
                {foco ? "Tocá una entidad para ver su autoridad y abrir su ficha." : "Tocá un departamento para ver todas las entidades que gobierna el partido ahí, y quién las gobierna."}
              </p>
              <div className="space-y-1.5 text-rotulo text-mute">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson/70" aria-hidden /> con indicios de captura</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-granate/70" aria-hidden /> sin ese indicio</span>
              </div>
            </div>
          )}
        </aside>
      </div>

      <p className="text-rotulo leading-relaxed text-mute">
        La autoridad de cada entidad es quien la gobierna por el partido. Fuentes: JNE/ONPE/RNP. Indicios para revisión
        humana, no una acusación.
      </p>
    </section>
  );
}
