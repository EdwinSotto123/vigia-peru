"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import type { PoderPartido, PoderEntidad } from "@/lib/poder";
import { clavePartido } from "@/lib/poder";

/**
 * Grafo-resumen del mapa de poder (migración 125): en el centro el Estado, alrededor los partidos que más capturan y,
 * colgando de cada uno, las entidades que gobierna (coloreadas por su indicio: rojo si alguna empresa le financió la
 * campaña, ámbar si sólo le vendió). Da la vista de conjunto —qué partido controla qué instituciones— que la tabla no
 * da de un vistazo. Pasa el cursor por un partido para ver sus instituciones; toca para ir a su ficha. Indicios, no
 * acusaciones.
 */
function corto(s: string, n: number) {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
const fuerteEnt = (e: PoderEntidad) => (e.n_financiaron ?? 0) > 0 || (e.n_socio ?? 0) > 0;

export function PoderResumenGrafo({ partidos, entidades }: { partidos: PoderPartido[]; entidades: PoderEntidad[] }) {
  const router = useRouter();
  const [hoverP, setHoverP] = useState<string | null>(null);
  const [hoverE, setHoverE] = useState<string | null>(null);

  const clusters = useMemo(() => {
    const tops = partidos.filter((p) => p.n_captura > 0).sort((a, b) => b.n_captura - a.n_captura).slice(0, 8);
    return tops
      .map((p) => ({
        p,
        ents: entidades
          .filter((e) => e.partido === p.partido && e.n_captura > 0)
          .sort((a, b) => b.n_captura - a.n_captura)
          .slice(0, 4),
      }))
      .filter((c) => c.ents.length > 0);
  }, [partidos, entidades]);

  const N = clusters.length;
  const W = 900;
  const H = 700;
  const cx = W / 2;
  const cy = H / 2;
  const Rp = 190;
  const Re = Rp + 92;
  const maxCap = Math.max(...clusters.map((c) => c.p.n_captura), 1);

  const nodos = clusters.map((c, i) => {
    const ang = ((-90 + (i * 360) / N) * Math.PI) / 180;
    const hx = cx + Rp * Math.cos(ang);
    const hy = cy + Rp * Math.sin(ang);
    const K = c.ents.length;
    const spreadDeg = Math.min(52, 15 * K);
    const ents = c.ents.map((e, k) => {
      const ea = ang + (((k - (K - 1) / 2) * spreadDeg) / Math.max(K, 1)) * (Math.PI / 180);
      return { e, x: cx + Re * Math.cos(ea), y: cy + Re * Math.sin(ea) };
    });
    const rHub = 10 + 16 * Math.sqrt(c.p.n_captura / maxCap);
    const cos = Math.cos(ang);
    const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
    return { c, ang, hx, hy, ents, rHub, cos, anchor };
  });

  const activa = hoverP != null;
  const dimP = (nombre: string) => (activa && hoverP !== nombre ? 0.2 : 1);

  const detP = hoverP ? clusters.find((c) => c.p.partido === hoverP)?.p : null;
  const detE = hoverE ? entidades.find((e) => e.entidad_ruc === hoverE) : null;

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <p className="text-meta leading-relaxed text-inkSoft">
        En el centro, el Estado; alrededor, los partidos que más capturan y las instituciones que gobiernan. Pasa el
        cursor por un partido para ver sus instituciones; toca para ir a su ficha.
      </p>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[680px] touch-manipulation select-none"
          role="img"
          aria-label={`Mapa de poder: los ${numero(N)} partidos que más capturan y sus instituciones.`}
        >
          {/* radios Estado → partido */}
          {nodos.map((nd) => (
            <line
              key={`c${nd.c.p.partido}`}
              x1={cx}
              y1={cy}
              x2={nd.hx}
              y2={nd.hy}
              className="stroke-line"
              strokeWidth={1.2}
              strokeOpacity={activa && hoverP !== nd.c.p.partido ? 0.15 : 0.7}
            />
          ))}

          {/* radios partido → entidad, por indicio */}
          {nodos.map((nd) =>
            nd.ents.map((en) => (
              <line
                key={`e${en.e.entidad_ruc}`}
                x1={nd.hx}
                y1={nd.hy}
                x2={en.x}
                y2={en.y}
                className={fuerteEnt(en.e) ? "stroke-crimson" : "stroke-amber"}
                strokeWidth={1.4}
                strokeOpacity={activa && hoverP !== nd.c.p.partido ? 0.1 : 0.5}
                strokeLinecap="round"
              />
            )),
          )}

          {/* entidades */}
          {nodos.map((nd) =>
            nd.ents.map((en) => (
              <g
                key={`en${en.e.entidad_ruc}`}
                className="cursor-pointer"
                opacity={dimP(nd.c.p.partido)}
                onMouseEnter={() => { setHoverP(nd.c.p.partido); setHoverE(en.e.entidad_ruc); }}
                onMouseLeave={() => { setHoverP(null); setHoverE(null); }}
                onClick={() => router.push(`/entidad/${en.e.entidad_ruc}`)}
                role="link"
                tabIndex={0}
                onKeyDown={(ev) => { if (ev.key === "Enter") router.push(`/entidad/${en.e.entidad_ruc}`); }}
                aria-label={`${corto(en.e.entidad, 60)}: ${numero(en.e.n_captura)} contratos con indicio`}
              >
                <circle cx={en.x} cy={en.y} r={7} className={`${fuerteEnt(en.e) ? "fill-crimson/30 stroke-crimson" : "fill-amber/30 stroke-amber"} stroke-[1.5]`} />
                {hoverP === nd.c.p.partido && (
                  <text
                    x={en.x + (nd.cos >= 0 ? 10 : -10)}
                    y={en.y + 3}
                    textAnchor={nd.cos >= 0 ? "start" : "end"}
                    className="pointer-events-none fill-inkSoft text-[10px] font-medium"
                  >
                    {corto(en.e.entidad, 22)}
                  </text>
                )}
              </g>
            )),
          )}

          {/* partidos (hubs) */}
          {nodos.map((nd) => (
            <g
              key={`h${nd.c.p.partido}`}
              className="cursor-pointer"
              opacity={dimP(nd.c.p.partido)}
              onMouseEnter={() => setHoverP(nd.c.p.partido)}
              onMouseLeave={() => setHoverP(null)}
              onClick={() => router.push(`/app/poder/${clavePartido(nd.c.p.partido)}`)}
              role="link"
              tabIndex={0}
              onKeyDown={(ev) => { if (ev.key === "Enter") router.push(`/app/poder/${clavePartido(nd.c.p.partido)}`); }}
              aria-label={`${corto(nd.c.p.partido, 60)}: gobierna ${numero(nd.c.p.n_entidades)} entidades, ${numero(nd.c.p.n_captura)} contratos con indicio`}
            >
              <circle cx={nd.hx} cy={nd.hy} r={nd.rHub} className="fill-granate/25 stroke-granate stroke-[2]" />
              <text
                x={nd.hx + (nd.anchor === "start" ? nd.rHub + 6 : nd.anchor === "end" ? -(nd.rHub + 6) : 0)}
                y={nd.hy + (nd.anchor === "middle" ? (nd.hy > cy ? nd.rHub + 14 : -(nd.rHub + 8)) : 4)}
                textAnchor={nd.anchor}
                className="pointer-events-none fill-ink text-[11px] font-semibold"
              >
                {corto(nd.c.p.partido, 24)}
              </text>
            </g>
          ))}

          {/* Estado (centro) */}
          <circle cx={cx} cy={cy} r={30} className="fill-paperSoft stroke-ink stroke-[2]" />
          <text x={cx} y={cy - 1} textAnchor="middle" className="fill-ink text-[12px] font-semibold">El Estado</text>
          <text x={cx} y={cy + 13} textAnchor="middle" className="fill-mute text-[9px]">los que gobiernan</text>
        </svg>

        {(detP || detE) && (
          <div className="pointer-events-none absolute right-2 top-2 max-w-[260px] rounded-xl border border-line bg-paper/95 p-3 shadow-sm backdrop-blur">
            {detE ? (
              <>
                <div className="text-meta font-semibold text-ink">{corto(detE.entidad, 44)}</div>
                <div className="mt-0.5 text-rotulo text-mute">{[detE.departamento].filter(Boolean).map((x) => tituloNatural(String(x))).join("")}</div>
                <div className="mt-1.5 font-mono text-rotulo text-inkSoft">{numero(detE.n_captura)} contratos con indicio, {solesCompacto(detE.monto_captura)}</div>
              </>
            ) : detP ? (
              <>
                <div className="text-meta font-semibold text-ink">{corto(detP.partido, 44)}</div>
                <div className="mt-1.5 font-mono text-rotulo text-inkSoft">
                  gobierna {numero(detP.n_entidades)} entidades, {numero(detP.n_captura)} contratos con indicio, {solesCompacto(detP.monto_captura)}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-rotulo text-mute">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-granate/70" aria-hidden /> partido que gobierna
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson/70" aria-hidden /> una empresa le financió la campaña o es su socio
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber/70" aria-hidden /> le vendió a la campaña
        </span>
      </div>
      <p className="text-rotulo leading-relaxed text-mute">
        Sólo los 8 partidos con más indicios y sus instituciones más capturadas; la lista los tiene todos. Indicios de
        registros públicos (JNE, ONPE, RNP/SEACE) para revisión humana, no una acusación.
      </p>
    </section>
  );
}
