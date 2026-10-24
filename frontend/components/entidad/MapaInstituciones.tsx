"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import type { Institucion, MapaInstituciones as Datos } from "@/lib/poder";

/**
 * Mapa de instituciones del Estado (las que más contratan): en el centro el Estado y tres ramas —Gobierno Nacional
 * (ministerios y organismos), Gobiernos Regionales, Municipalidades—, y de cada rama sus instituciones más grandes,
 * cada una CLICKEABLE a su ficha. En rojo las que tienen indicios de captura política (empresas ligadas al partido que
 * las gobierna); en lima las demás (los ministerios no se eligen por partido). Indicios para revisión, no acusación.
 */
const RAMAS = [
  { key: "ministerios", titulo: "Ministerios", ang: -90 },
  { key: "regional", titulo: "Gobiernos Regionales", ang: 30 },
  { key: "local", titulo: "Municipalidades", ang: 150 },
] as const;

function corto(s: string, n: number) {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function MapaInstituciones({ datos }: { datos: Datos }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);

  const W = 1200;
  const H = 1040;
  const cx = W / 2;
  const cy = H / 2;
  const Rb = 168;
  const Re = 368;

  const { nodos, maxC, total } = useMemo(() => {
    const all = [...datos.ramas.ministerios, ...datos.ramas.regional, ...datos.ramas.local];
    const maxC = Math.max(...all.map((e) => e.n_contratos), 1);
    const nodos = RAMAS.map((r) => {
      const insts = (datos.ramas[r.key] ?? []).slice(0, 9);
      const base = (r.ang * Math.PI) / 180;
      const bx = cx + Rb * Math.cos(base);
      const by = cy + Rb * Math.sin(base);
      const span = 100;
      const K = insts.length;
      const ents = insts.map((e, k) => {
        const a = ((r.ang + (K > 1 ? (k - (K - 1) / 2) * (span / (K - 1)) : 0)) * Math.PI) / 180;
        const cos = Math.cos(a);
        return {
          e, a, cos,
          x: cx + Re * Math.cos(a),
          y: cy + Re * Math.sin(a),
          r: 7 + 15 * Math.sqrt(e.n_contratos / maxC),
        };
      });
      const cos = Math.cos(base);
      return { r, bx, by, ents, cosB: cos };
    });
    return { nodos, maxC, total: all.length };
  }, [datos]);

  const det = hover ? [...datos.ramas.ministerios, ...datos.ramas.regional, ...datos.ramas.local].find((e) => e.ruc === hover) : null;
  const dim = (ruc: string) => (hover && hover !== ruc ? 0.3 : 1);

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-cuerpo font-semibold text-ink">El Estado y sus instituciones</h2>
        <span className="text-rotulo text-mute">{numero(total)} instituciones, las que más contratan</span>
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">
        En el centro, el Estado; las tres ramas y, de cada una, las instituciones que más contratan. Toca cualquiera para
        ir a su ficha. En rojo, las que tienen indicios de captura política.
      </p>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[820px] touch-manipulation select-none"
          role="img"
          aria-label={`Mapa del Estado: ${numero(total)} instituciones en tres ramas (nacional, regional, municipal), las que más contratan.`}
        >
          {/* centro → rama */}
          {nodos.map((nd) => (
            <line key={`b${nd.r.key}`} x1={cx} y1={cy} x2={nd.bx} y2={nd.by} className="stroke-line" strokeWidth={1.6} strokeOpacity={0.7} />
          ))}
          {/* rama → institución */}
          {nodos.map((nd) =>
            nd.ents.map((en) => (
              <line
                key={`l${en.e.ruc}`}
                x1={nd.bx}
                y1={nd.by}
                x2={en.x}
                y2={en.y}
                className={(en.e.captura ?? 0) > 0 ? "stroke-crimson" : "stroke-granate"}
                strokeWidth={1.3}
                strokeOpacity={hover && hover !== en.e.ruc ? 0.12 : 0.45}
                strokeLinecap="round"
              />
            )),
          )}

          {/* instituciones (clickeables) */}
          {nodos.map((nd) =>
            nd.ents.map((en) => {
              const anchor = en.cos > 0.25 ? "start" : en.cos < -0.25 ? "end" : "middle";
              const lx = en.x + (en.r + 7) * Math.cos(en.a) + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0);
              const ly = en.y + (en.r + 7) * Math.sin(en.a) + (anchor === "middle" ? (Math.sin(en.a) > 0 ? 11 : -5) : 4);
              const fuerte = (en.e.captura ?? 0) > 0;
              return (
                <g
                  key={`n${en.e.ruc}`}
                  className="cursor-pointer"
                  opacity={dim(en.e.ruc)}
                  onMouseEnter={() => setHover(en.e.ruc)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => router.push(`/entidad/${en.e.ruc}`)}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(ev) => { if (ev.key === "Enter") router.push(`/entidad/${en.e.ruc}`); }}
                  aria-label={`${corto(en.e.nombre, 60)}: ${numero(en.e.n_contratos)} contratos`}
                >
                  <circle cx={en.x} cy={en.y} r={en.r} className={`${fuerte ? "fill-crimson/30 stroke-crimson" : "fill-granate/25 stroke-granate"} stroke-[1.5]`} />
                  <text x={lx} y={ly} textAnchor={anchor} className="pointer-events-none fill-inkSoft text-[10.5px] font-medium">
                    {corto(en.e.nombre, 24)}
                  </text>
                </g>
              );
            }),
          )}

          {/* ramas (hubs con etiqueta) */}
          {nodos.map((nd) => (
            <g key={`h${nd.r.key}`}>
              <rect x={nd.bx - 92} y={nd.by - 15} width={184} height={30} rx={15} className="fill-paperSoft stroke-ink stroke-[1.5]" />
              <text x={nd.bx} y={nd.by + 4} textAnchor="middle" className="fill-ink text-[12px] font-semibold">{nd.r.titulo}</text>
            </g>
          ))}

          {/* Estado (centro) */}
          <circle cx={cx} cy={cy} r={34} className="fill-paperSoft stroke-ink stroke-[2.5]" />
          <text x={cx} y={cy + 1} textAnchor="middle" className="fill-ink text-[13px] font-semibold">El Estado</text>
          <text x={cx} y={cy + 15} textAnchor="middle" className="fill-mute text-[9px]">peruano</text>
        </svg>

        {det && (
          <div className="pointer-events-none absolute right-2 top-2 max-w-[270px] rounded-xl border border-line bg-paper/95 p-3 shadow-sm backdrop-blur">
            <div className="text-meta font-semibold text-ink">{corto(det.nombre, 46)}</div>
            <div className="mt-0.5 font-mono text-rotulo text-mute">RUC {det.ruc}</div>
            <div className="mt-1.5 font-mono text-rotulo text-inkSoft">{numero(det.n_contratos)} contratos, {solesCompacto(det.monto)}</div>
            {(det.captura ?? 0) > 0 && det.partido ? (
              <div className="mt-1 text-rotulo text-crimson">la gobierna {corto(det.partido, 30)} — {numero(det.captura ?? 0)} contratos con indicio</div>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-rotulo text-mute">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson/70" aria-hidden /> con indicios de captura política
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-granate/70" aria-hidden /> sin ese indicio (p. ej. ministerios, que no se eligen por partido)
        </span>
        <span className="text-mute">el tamaño es cuánto contrata</span>
      </div>
      <p className="text-rotulo leading-relaxed text-mute">
        Las instituciones que más contratan de cada rama; tocá una para ver todo su detalle. Fuentes: SEACE/OECE
        (contratos), JNE/ONPE/RNP (captura). Indicios de registros públicos para revisión humana, no una acusación.
      </p>
    </section>
  );
}
