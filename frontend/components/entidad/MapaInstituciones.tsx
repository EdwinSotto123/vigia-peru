"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type CSSProperties } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import { corto } from "@/lib/grafo";
import { GrafoSeccion, GrafoColumnas, GrafoAside, BotonFicha, ChipLeyenda } from "@/components/grafo/primitivos";
import { AyudaTermino } from "@/components/patrones";
import type { Institucion, MapaInstituciones as Datos } from "@/lib/poder";

/**
 * Mapa de instituciones del Estado (las que más contratan): El Estado en el centro y cuatro ramas —Ministerios,
 * Organismos del Estado, Gobiernos Regionales, Municipalidades—, cada institución CLICKEABLE. Tocá una rama para
 * EXPANDIRLA (hasta 24, las que más contratan) y una institución para verla en el panel lateral. En rojo + halo las que
 * tienen indicios de captura política; en lima las demás (los ministerios no se eligen por partido). Las instituciones
 * «brotan» al cambiar de rama. Sobre los primitivos de components/grafo. Indicios, no acusación.
 */
const RAMAS = [
  { key: "ministerios", titulo: "Ministerios", ang: -90 },
  { key: "organismos", titulo: "Organismos del Estado", ang: 0 },
  { key: "regional", titulo: "Gobiernos Regionales", ang: 90 },
  { key: "local", titulo: "Municipalidades", ang: 180 },
] as const;
type RamaKey = (typeof RAMAS)[number]["key"];

const fuerteEnt = (e: Institucion) => (e.captura ?? 0) > 0;

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

  return (
    <GrafoSeccion>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {foco ? (
          <button type="button" onClick={() => setFoco(null)} className="flex items-center gap-1.5 text-meta font-semibold text-granate hover:underline underline-offset-2">
            ← Todas las ramas
          </button>
        ) : (
          <div className="text-cuerpo font-semibold tracking-tight text-ink">El Estado y sus instituciones</div>
        )}
        <span className="text-rotulo text-mute">
          {foco ? `${ramaTit}: ${numero(nFoco)} que más contratan` : `${numero(total)} instituciones — tocá una rama para expandir`}
        </span>
      </div>

      <GrafoColumnas>
        <div className="overflow-x-auto rounded-xl border border-line bg-fondo/40">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full min-w-[640px] touch-manipulation select-none"
            role="img"
            aria-label={foco ? `${ramaTit}: ${numero(nFoco)} instituciones` : `Mapa del Estado: ${numero(total)} instituciones en cuatro ramas`}
          >
            {/* centro → rama (solo overview) */}
            {!foco && nodos.map((nd) => (
              <line key={`b${nd.key}`} x1={cx} y1={cy} x2={nd.bx} y2={nd.by} className="stroke-line" strokeWidth={1.6} strokeOpacity={0.7} strokeLinecap="round" />
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
            {/* instituciones (clickeables → panel), con halo por capas y entrada «brota» */}
            {nodos.map((nd) =>
              nd.ents.map((en, k) => {
                const esHover = hover === en.e.ruc;
                const esSel = sel?.ruc === en.e.ruc;
                const captura = fuerteEnt(en.e);
                const r = en.r * (esHover || esSel ? 1.4 : 1);
                const txt = nd.key === "regional" && en.e.region ? corto(en.e.region, 18) : corto(en.e.nombre, foco ? 22 : 24);
                const clsTxt = `pointer-events-none ${esHover || esSel ? "fill-ink font-semibold" : "fill-inkSoft font-medium"}`;
                // Overview (7 por rama en un arco corto): etiqueta horizontal con ancla de 3 vías.
                const anchor = en.cos > 0.25 ? "start" : en.cos < -0.25 ? "end" : "middle";
                const lx = en.x + (en.r + 7) * Math.cos(en.a) + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0);
                const ly = en.y + (en.r + 7) * Math.sin(en.a) + (anchor === "middle" ? (Math.sin(en.a) > 0 ? 11 : -5) : 4);
                // Foco (hasta 24 en anillo completo): etiqueta RADIAL en abanico, auto-volteada a la izquierda.
                const deg = (en.a * 180) / Math.PI;
                const flip = en.cos < 0;
                return (
                  <g key={`n${en.e.ruc}`} className="grafo-brota" style={{ "--i": `${Math.min(k * 20, 340)}ms` } as CSSProperties}>
                    <g
                      className="grafo-nodo cursor-pointer"
                      opacity={hover && !esHover ? 0.4 : 1}
                      onMouseEnter={() => setHover(en.e.ruc)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => setSel(en.e)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(ev) => { if (ev.key === "Enter") setSel(en.e); }}
                      aria-label={`${corto(en.e.nombre, 60)}: ${numero(en.e.n_contratos)} contratos`}
                    >
                      {esSel && <circle cx={en.x} cy={en.y} r={r + 5} className="fill-none stroke-ink pointer-events-none" strokeWidth={1.5} />}
                      {(captura || esHover || esSel) && (
                        <circle cx={en.x} cy={en.y} r={r + (esHover ? 5 : 4)} className={`pointer-events-none ${captura ? "fill-crimson/20" : "fill-granate/15"}`} />
                      )}
                      <circle cx={en.x} cy={en.y} r={r} className={`grafo-nodo-circulo ${captura ? "fill-crimson/35 stroke-crimson" : "fill-granate/30 stroke-granate"}`} strokeWidth={esHover || esSel ? 2.5 : 1.5} />
                      {foco ? (
                        <g transform={`translate(${en.x} ${en.y}) rotate(${deg})`} className="pointer-events-none">
                          <text transform={`translate(${r + 6} 0)${flip ? " rotate(180)" : ""}`} y={3.4} textAnchor={flip ? "end" : "start"} className={clsTxt} style={{ fontSize: "10.5px" }}>
                            {txt}
                          </text>
                        </g>
                      ) : (
                        <text x={lx} y={ly} textAnchor={anchor} className={clsTxt} style={{ fontSize: "10.5px" }}>
                          {txt}
                        </text>
                      )}
                    </g>
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
                  <rect x={nd.bx - 96} y={nd.by - 16} width={192} height={32} rx={16} className="fill-paperSoft stroke-ink" strokeWidth={1.5} />
                  <text x={nd.bx} y={nd.by + 4} textAnchor="middle" className="fill-ink font-semibold" style={{ fontSize: "12px" }}>{tit} +</text>
                </g>
              );
            })}
            {/* Estado (centro) */}
            <circle cx={cx} cy={cy} r={(foco ? 40 : 34) + 6} className="fill-granate/10 pointer-events-none" />
            <circle cx={cx} cy={cy} r={foco ? 40 : 34} className="fill-paperSoft stroke-ink" strokeWidth={2.5} />
            <text x={cx} y={cy - (foco ? 4 : 1)} textAnchor="middle" className="fill-ink font-semibold" style={{ fontSize: "13px" }}>{foco ? (ramaTit ?? "El Estado") : "El Estado"}</text>
            <text x={cx} y={cy + (foco ? 12 : 15)} textAnchor="middle" className="fill-mute" style={{ fontSize: "9px" }}>{foco ? "del Estado" : "peruano"}</text>
          </svg>
        </div>

        {/* panel lateral persistente */}
        <GrafoAside>
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
                ? <p className="text-meta text-inkSoft">La gobierna <b className="text-ink">{tituloNatural(panelEnt.partido)}</b>, con <span className="text-crimson">{numero(panelEnt.captura)} de {numero(panelEnt.n_contratos)} contratos con indicio</span>.</p>
                : <p className="text-rotulo text-mute">Sin indicios de captura política (no todas las instituciones se eligen por partido).</p>}
              <BotonFicha onClick={() => router.push(`/entidad/${panelEnt.ruc}`)} />
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
              <div className="space-y-1.5">
                <ChipLeyenda tono="crimson" forma="halo">con indicios de captura política <AyudaTermino clave="captura" /></ChipLeyenda>
                <ChipLeyenda tono="granate" forma="punto">sin ese indicio (p. ej. ministerios)</ChipLeyenda>
                <span className="text-rotulo text-mute">el tamaño es cuánto contrata</span>
              </div>
            </div>
          )}
        </GrafoAside>
      </GrafoColumnas>

      <p className="text-rotulo leading-relaxed text-mute">
        Las instituciones que más contratan de cada rama. Fuentes: SEACE/OECE (contratos), JNE/ONPE/RNP (captura).
        Indicios para revisión humana, no una acusación.
      </p>
    </GrafoSeccion>
  );
}
