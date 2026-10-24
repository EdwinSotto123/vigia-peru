"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import type { GrafoCaptura } from "@/lib/poder";

/**
 * El grafo de captura de una entidad (mapa de poder, migración 125): en el centro la entidad y el partido que la
 * gobierna; alrededor, las empresas ligadas a ese partido que ganaron sus contratos. Cada radio es un lazo —rojo si
 * financió al partido o tiene un socio adentro, ámbar si le vendió a la campaña— y el tamaño del nodo son los contratos.
 * Son INDICIOS de registros públicos para revisión humana, nunca una acusación. Toca una empresa para ir a su ficha.
 */
type Emp = GrafoCaptura["empresas"][number];

const esFuerte = (l: string[]) => l.includes("partido_gobernante") || l.includes("socio_en_entidad");
const etiquetaLazo = (l: string) =>
  l === "partido_gobernante" ? "financió al partido que gobierna"
    : l === "vendio_gobernante" ? "le vendió a la campaña"
    : l === "socio_en_entidad" ? "socio contratado por esta entidad"
    : l;

function corto(s: string, n: number) {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function GrafoCapturaViz({ data }: { data: GrafoCaptura }) {
  const router = useRouter();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/[:]/g, "");

  const empresas = data.empresas;
  const n = empresas.length;
  const W = 760;
  const H = 540;
  const cx = W / 2;
  const cy = H / 2 + 6;
  const R = 186;
  const maxC = Math.max(...empresas.map((e) => e.contratos), 1);

  const nodos = empresas.map((e, i) => {
    const ang = -Math.PI / 2 + (i + 0.5) * ((2 * Math.PI) / n);
    const x = cx + R * Math.cos(ang);
    const y = cy + R * Math.sin(ang);
    const r = 7 + 13 * Math.sqrt(e.contratos / maxC);
    const fuerte = esFuerte(e.lazos);
    const cos = Math.cos(ang);
    // Umbral bajo (~10° de la vertical): así los nodos de arriba y abajo abren su etiqueta a un lado en vez de
    // amontonarlas centradas (si no, las dos de las 6 en punto se encimaban y el texto se volvía ilegible).
    const anchor = cos > 0.12 ? "start" : cos < -0.12 ? "end" : "middle";
    const lx = x + (r + 7) * Math.cos(ang) + (anchor === "start" ? 3 : anchor === "end" ? -3 : 0);
    const ly = y + (r + 7) * Math.sin(ang) + (anchor === "middle" ? (Math.sin(ang) > 0 ? 11 : -5) : 4);
    return { e, i, x, y, r, fuerte, anchor, lx, ly };
  });

  const activo = hover != null ? nodos[hover] : null;
  const dim = (i: number) => (hover != null && hover !== i ? 0.22 : 1);

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-cuerpo font-semibold text-ink">La red de captura</h2>
        <span className="text-rotulo text-mute">{numero(n)} {n === 1 ? "empresa ligada" : "empresas ligadas"}</span>
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">
        En el centro, la entidad y el partido que la gobierna. Alrededor, las empresas ligadas a ese partido que ganaron
        sus contratos. Toca una para ver su ficha.
      </p>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[560px] touch-manipulation select-none"
          role="img"
          aria-label={`Red de captura de ${corto(data.entidad.nombre ?? data.entidad.ruc, 60)}: ${n} empresas ligadas al partido que la gobierna.`}
        >
          {/* radios entidad → empresa, coloreados por lazo */}
          {nodos.map((nd) => (
            <line
              key={`e${nd.i}`}
              x1={cx}
              y1={cy}
              x2={nd.x}
              y2={nd.y}
              className={nd.fuerte ? "stroke-crimson" : "stroke-amber"}
              strokeWidth={1 + 2.4 * Math.sqrt(nd.e.contratos / maxC)}
              strokeOpacity={hover != null && hover !== nd.i ? 0.12 : 0.5}
              strokeLinecap="round"
            />
          ))}

          {/* nodos empresa */}
          {nodos.map((nd) => (
            <g
              key={`n${nd.i}`}
              className="cursor-pointer"
              opacity={dim(nd.i)}
              onMouseEnter={() => setHover(nd.i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => router.push(`/empresa/${nd.e.ruc}`)}
              role="link"
              tabIndex={0}
              onKeyDown={(ev) => { if (ev.key === "Enter") router.push(`/empresa/${nd.e.ruc}`); }}
              aria-label={`${corto(nd.e.nombre ?? nd.e.ruc, 60)}: ${numero(nd.e.contratos)} contratos`}
            >
              <circle
                cx={nd.x}
                cy={nd.y}
                r={nd.r}
                className={`${nd.fuerte ? "fill-crimson stroke-crimson" : "fill-amber stroke-amber"} stroke-[1.5]`}
                fillOpacity={hover === nd.i ? 0.38 : 0.2}
              />
              <text
                x={nd.lx}
                y={nd.ly}
                textAnchor={nd.anchor}
                className="pointer-events-none fill-inkSoft text-[11px] font-medium"
              >
                {corto(nd.e.nombre ?? nd.e.ruc, 22)}
              </text>
            </g>
          ))}

          {/* núcleo: entidad + partido que la gobierna */}
          <g>
            <circle cx={cx} cy={cy} r={34} className="fill-paperSoft stroke-ink stroke-[2]" />
            <text x={cx} y={cy - 2} textAnchor="middle" className="fill-ink text-[12px] font-semibold">
              {corto(data.entidad.nombre ?? data.entidad.ruc, 18).split(" ").slice(0, 2).join(" ")}
            </text>
            <text x={cx} y={cy + 13} textAnchor="middle" className="fill-mute text-[10px]">
              la entidad
            </text>
          </g>
          <g
            className="cursor-pointer"
            onClick={() => router.push(`/app/poder/${encodeURIComponent(data.partido)}`)}
            role="link"
            tabIndex={0}
            onKeyDown={(ev) => { if (ev.key === "Enter") router.push(`/app/poder/${encodeURIComponent(data.partido)}`); }}
            aria-label={`La gobierna ${corto(data.partido, 60)}`}
          >
            <rect
              x={cx - 112}
              y={cy - 86}
              width={224}
              height={34}
              rx={17}
              className="fill-paper stroke-granate stroke-[1.5]"
            />
            <text x={cx} y={cy - 70} textAnchor="middle" className="fill-mute text-[9px] uppercase tracking-wide">
              la gobierna
            </text>
            <text x={cx} y={cy - 58} textAnchor="middle" className="fill-granate text-[12px] font-semibold">
              {corto(data.partido, 30)}
            </text>
            <line x1={cx} y1={cy - 52} x2={cx} y2={cy - 34} className="stroke-granate stroke-[1.5]" strokeDasharray="3 3" />
          </g>
        </svg>

        {/* detalle de la empresa activa */}
        {activo && (
          <div className="pointer-events-none absolute right-2 top-2 max-w-[260px] rounded-xl border border-line bg-paper/95 p-3 shadow-sm backdrop-blur">
            <div className="text-meta font-semibold text-ink">{corto(activo.e.nombre ?? activo.e.ruc, 44)}</div>
            <div className="mt-0.5 font-mono text-rotulo text-mute">RUC {activo.e.ruc}</div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {activo.e.lazos.map((l) => (
                <span
                  key={l}
                  className={`rounded-full px-2 py-0.5 text-rotulo ${esFuerte([l]) ? "bg-crimson/10 text-crimson" : "bg-amber/10 text-amber"}`}
                >
                  {etiquetaLazo(l)}
                </span>
              ))}
            </div>
            <div className="mt-1.5 font-mono text-rotulo text-inkSoft">
              {numero(activo.e.contratos)} {activo.e.contratos === 1 ? "contrato" : "contratos"}, {solesCompacto(activo.e.monto)}
            </div>
          </div>
        )}
      </div>

      {/* leyenda + nota honesta */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-rotulo text-mute">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson/70" aria-hidden /> financió al partido o es su socio adentro
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber/70" aria-hidden /> le vendió a la campaña
        </span>
        <span className="text-mute">el tamaño es el número de contratos</span>
      </div>
      <p className="text-rotulo leading-relaxed text-mute">
        Son indicios de registros públicos (JNE, ONPE, RNP/SEACE) para revisión humana —una empresa puede ganar de forma
        limpia—, no una acusación.
      </p>
      {/* uid reservado por si se agregan degradados/markers por instancia */}
      <span hidden>{uid}</span>
    </section>
  );
}
