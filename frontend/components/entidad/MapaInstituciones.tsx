"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import type { Institucion, MapaInstituciones as Datos } from "@/lib/poder";

/**
 * Mapa de instituciones del Estado (las que más contratan): El Estado en el centro y cuatro ramas —Ministerios,
 * Organismos del Estado, Gobiernos Regionales, Municipalidades—, cada institución CLICKEABLE. Tocá una rama para
 * EXPANDIRLA (hasta 24, las que más contratan) y una institución para verla en el panel lateral. En rojo las que tienen
 * indicios de captura política; en lima las demás (los ministerios no se eligen por partido). Indicios, no acusación.
 */
const RAMAS = [
  { key: "ministerios", titulo: "Ministerios", ang: -90 },
  { key: "organismos", titulo: "Organismos del Estado", ang: 0 },
  { key: "regional", titulo: "Gobiernos Regionales", ang: 90 },
  { key: "local", titulo: "Municipalidades", ang: 180 },
] as const;
type RamaKey = (typeof RAMAS)[number]["key"];

const fuerteEnt = (e: Institucion) => (e.captura ?? 0) > 0;
function corto(s: string, n: number) {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function MapaInstituciones({ datos }: { datos: Datos }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const [sel, setSel] = useState<Institucion | null>(null);
  const [foco, setFoco] = useState<RamaKey | null>(null);

  const W = 1200;
  const H = foco ? 940 : 1040;
  const cx = W / 2;
  const cy = H / 2;

  const maxC = useMemo(() => {
    const all = [...datos.ramas.ministerios, ...datos.ramas.organismos, ...datos.ramas.regional, ...datos.ramas.local];
    return Math.max(...all.map((e) => e.n_contratos), 1);
  }, [datos]);

  // Overview: 4 ramas, top 7 cada una. Foco: una rama, hasta 24 en anillo completo.
  const nodos = useMemo(() => {
    const rNodo = (n: number) => 7 + 15 * Math.sqrt(n / maxC);
    if (foco) {
      const insts = (datos.ramas[foco] ?? []).slice(0, 24);
      const K = insts.length;
      const Re = 320;
      return [{
        key: foco,
        bx: cx, by: cy,
        ents: insts.map((e, k) => {
          const a = ((-90 + (k + 0.5) * (360 / K)) * Math.PI) / 180;
          return { e, a, cos: Math.cos(a), x: cx + Re * Math.cos(a), y: cy + Re * Math.sin(a), r: rNodo(e.n_contratos) };
        }),
      }];
    }
    const Rb = 168;
    const Re = 368;
    return RAMAS.map((r) => {
      const insts = (datos.ramas[r.key] ?? []).slice(0, 7);
      const base = (r.ang * Math.PI) / 180;
      const K = insts.length;
      const span = 68;
      return {
        key: r.key,
        bx: cx + Rb * Math.cos(base), by: cy + Rb * Math.sin(base),
        ents: insts.map((e, k) => {
          const a = ((r.ang + (K > 1 ? (k - (K - 1) / 2) * (span / (K - 1)) : 0)) * Math.PI) / 180;
          return { e, a, cos: Math.cos(a), x: cx + Re * Math.cos(a), y: cy + Re * Math.sin(a), r: rNodo(e.n_contratos) };
        }),
      };
    });
  }, [datos, foco, maxC, cx, cy]);

  const all = [...datos.ramas.ministerios, ...datos.ramas.organismos, ...datos.ramas.regional, ...datos.ramas.local];
  const total = all.length;
  const ramaTit = RAMAS.find((r) => r.key === foco)?.titulo;
  const nFoco = foco ? (datos.ramas[foco] ?? []).length : 0;
  // En el panel: la que se pasa con el cursor (preview) o, si no, la última tocada (fija).
  const panelEnt = (hover ? all.find((e) => e.ruc === hover) : null) ?? sel;

  const Leyenda = () => (
    <div className="space-y-1.5 text-rotulo text-mute">
      <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson/70" aria-hidden /> con indicios de captura política</span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-granate/70" aria-hidden /> sin ese indicio (p. ej. ministerios)</span>
      <span>el tamaño es cuánto contrata</span>
    </div>
  );

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {foco ? (
          <button type="button" onClick={() => setFoco(null)} className="flex items-center gap-1.5 text-meta font-semibold text-granate hover:underline underline-offset-2">
            ← Todas las ramas
          </button>
        ) : (
          <h2 className="text-cuerpo font-semibold text-ink">El Estado y sus instituciones</h2>
        )}
        <span className="text-rotulo text-mute">
          {foco ? `${ramaTit}: ${numero(nFoco)} que más contratan` : `${numero(total)} instituciones — tocá una rama para expandir`}
        </span>
      </div>

      {/* dos columnas: grafo + panel lateral */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="overflow-x-auto rounded-xl border border-line bg-fondo/40">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full min-w-[640px] touch-manipulation select-none"
            role="img"
            aria-label={foco ? `${ramaTit}: ${numero(nFoco)} instituciones` : `Mapa del Estado: ${numero(total)} instituciones en cuatro ramas`}
          >
            {/* centro → rama (solo overview) */}
            {!foco && nodos.map((nd) => (
              <line key={`b${nd.key}`} x1={cx} y1={cy} x2={nd.bx} y2={nd.by} className="stroke-line" strokeWidth={1.6} strokeOpacity={0.7} />
            ))}
            {/* rama → institución */}
            {nodos.map((nd) =>
              nd.ents.map((en) => (
                <line
                  key={`l${en.e.ruc}`}
                  x1={nd.bx} y1={nd.by} x2={en.x} y2={en.y}
                  className={fuerteEnt(en.e) ? "stroke-crimson" : "stroke-granate"}
                  strokeWidth={sel?.ruc === en.e.ruc ? 2 : 1.3}
                  strokeOpacity={hover && hover !== en.e.ruc ? 0.12 : 0.45}
                  strokeLinecap="round"
                />
              )),
            )}
            {/* instituciones (clickeables → panel) */}
            {nodos.map((nd) =>
              nd.ents.map((en) => {
                const anchor = en.cos > 0.25 ? "start" : en.cos < -0.25 ? "end" : "middle";
                const lx = en.x + (en.r + 7) * Math.cos(en.a) + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0);
                const ly = en.y + (en.r + 7) * Math.sin(en.a) + (anchor === "middle" ? (Math.sin(en.a) > 0 ? 11 : -5) : 4);
                const esHover = hover === en.e.ruc;
                const esSel = sel?.ruc === en.e.ruc;
                const r = en.r + (esHover ? 3 : 0);
                return (
                  <g
                    key={`n${en.e.ruc}`}
                    className="cursor-pointer transition-opacity duration-rapido"
                    opacity={hover && !esHover ? 0.4 : 1}
                    onMouseEnter={() => setHover(en.e.ruc)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSel(en.e)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ev) => { if (ev.key === "Enter") setSel(en.e); }}
                    aria-label={`${corto(en.e.nombre, 60)}: ${numero(en.e.n_contratos)} contratos`}
                  >
                    {esSel && <circle cx={en.x} cy={en.y} r={r + 5} className="fill-none stroke-ink stroke-[1.5]" />}
                    <circle cx={en.x} cy={en.y} r={r} className={`${fuerteEnt(en.e) ? "fill-crimson/30 stroke-crimson" : "fill-granate/25 stroke-granate"}`} strokeWidth={esHover || esSel ? 2.5 : 1.5} fillOpacity={esHover ? 0.5 : undefined} />
                    <text x={lx} y={ly} textAnchor={anchor} className={`pointer-events-none text-[10.5px] ${esHover || esSel ? "fill-ink font-semibold" : "fill-inkSoft font-medium"}`}>
                      {nd.key === "regional" && en.e.region ? corto(en.e.region, 18) : corto(en.e.nombre, foco ? 22 : 24)}
                    </text>
                  </g>
                );
              }),
            )}
            {/* ramas (hubs) — overview: clickeables para expandir */}
            {!foco && nodos.map((nd) => {
              const tit = RAMAS.find((r) => r.key === nd.key)?.titulo ?? "";
              return (
                <g key={`h${nd.key}`} className="cursor-pointer" onClick={() => setFoco(nd.key as RamaKey)} role="button" tabIndex={0}
                   onKeyDown={(ev) => { if (ev.key === "Enter") setFoco(nd.key as RamaKey); }} aria-label={`Ver todas: ${tit}`}>
                  <rect x={nd.bx - 96} y={nd.by - 16} width={192} height={32} rx={16} className="fill-paperSoft stroke-ink stroke-[1.5]" />
                  <text x={nd.bx} y={nd.by + 4} textAnchor="middle" className="fill-ink text-[12px] font-semibold">{tit} +</text>
                </g>
              );
            })}
            {/* Estado (centro) */}
            <circle cx={cx} cy={cy} r={foco ? 40 : 34} className="fill-paperSoft stroke-ink stroke-[2.5]" />
            <text x={cx} y={cy - (foco ? 4 : 1)} textAnchor="middle" className="fill-ink text-[13px] font-semibold">{foco ? (ramaTit ?? "El Estado") : "El Estado"}</text>
            <text x={cx} y={cy + (foco ? 12 : 15)} textAnchor="middle" className="fill-mute text-[9px]">{foco ? "del Estado" : "peruano"}</text>
          </svg>
        </div>

        {/* panel lateral persistente */}
        <aside className="rounded-xl border border-line bg-paperSoft/50 p-4">
          {panelEnt ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-cuerpo font-semibold leading-tight text-ink">{tituloNatural(panelEnt.nombre)}</div>
                  <div className="font-mono text-rotulo text-mute">RUC {panelEnt.ruc}</div>
                </div>
                {sel && <button type="button" onClick={() => setSel(null)} className="text-mute hover:text-ink" aria-label="Cerrar detalle">✕</button>}
              </div>
              <div className="rounded-lg border border-line bg-paper px-3 py-2">
                <div className="font-mono text-cuerpo font-semibold tabular-nums text-ink">{numero(panelEnt.n_contratos)}</div>
                <div className="text-rotulo text-mute">contratos, {solesCompacto(panelEnt.monto)}</div>
              </div>
              {(panelEnt.captura ?? 0) > 0 && panelEnt.partido
                ? <p className="text-meta text-inkSoft">La gobierna <b className="text-ink">{tituloNatural(panelEnt.partido)}</b> — <span className="text-crimson">{numero(panelEnt.captura)} contratos con indicio</span>.</p>
                : <p className="text-rotulo text-mute">Sin indicios de captura política (no todas las instituciones se eligen por partido).</p>}
              <button type="button" onClick={() => router.push(`/entidad/${panelEnt.ruc}`)} className="mt-1 w-full rounded-lg bg-granate px-3 py-2 text-meta font-semibold text-sobreMaiz transition-opacity duration-rapido hover:opacity-90">
                Ver ficha completa →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-cuerpo font-semibold text-ink">{foco ? ramaTit : "El Estado"}</div>
                <div className="text-rotulo text-mute">{foco ? `${numero(nFoco)} que más contratan` : `${numero(total)} instituciones en 4 ramas`}</div>
              </div>
              <p className="text-meta leading-relaxed text-inkSoft">
                {foco ? "Tocá una institución para ver su detalle, o volvé a todas las ramas." : "Tocá una rama para expandirla, o una institución para ver su detalle."}
              </p>
              <Leyenda />
            </div>
          )}
        </aside>
      </div>

      <p className="text-rotulo leading-relaxed text-mute">
        Las instituciones que más contratan de cada rama. Fuentes: SEACE/OECE (contratos), JNE/ONPE/RNP (captura).
        Indicios para revisión humana, no una acusación.
      </p>
    </section>
  );
}
