"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import type { GrafoPartido } from "@/lib/poder";

/**
 * El grafo de captura de un partido (mapa de poder, migración 125), dibujado como red BIPARTITA: a la izquierda las
 * entidades que gobierna, a la derecha las empresas «puente» —las que ganaron con indicio en 2+ de esas entidades—, y
 * una línea por cada vez que una empresa ganó en una entidad. Rojo si financió al partido o es su socio adentro, ámbar
 * si sólo le vendió a la campaña. El grosor del nodo-empresa es a cuántas entidades llega (su «alcance»). Son INDICIOS
 * de registros públicos para revisión humana, nunca una acusación. Toca una entidad o una empresa para ir a su ficha.
 */
const esFuerte = (l: string[]) => l.includes("partido_gobernante") || l.includes("socio_en_entidad");
const etiquetaLazo = (l: string) =>
  l === "partido_gobernante" ? "financió al partido que gobierna"
    : l === "vendio_gobernante" ? "le vendió a la campaña"
    : l === "socio_en_entidad" ? "socio contratado por la entidad"
    : l;

function corto(s: string, n: number) {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** El prefijo común (a límite de palabra) de varios nombres. Sirve para que entidades con el mismo arranque
 * —p. ej. muchas unidades de «Gobierno Regional de Ayacucho …»— muestren la parte que las distingue, no todas igual. */
function prefijoComun(nombres: string[]): string {
  if (nombres.length < 2) return "";
  let p = nombres[0];
  for (const n of nombres) {
    while (p && !n.startsWith(p)) p = p.slice(0, -1);
    if (!p) return "";
  }
  const i = p.lastIndexOf(" ");
  return i > 0 ? p.slice(0, i + 1) : "";
}

type Hover = { tipo: "ent" | "emp"; ruc: string } | null;

export function GrafoPartidoViz({ data }: { data: GrafoPartido }) {
  const router = useRouter();
  const [hover, setHover] = useState<Hover>(null);

  const { ents, comps, maxCap } = useMemo(() => {
    const empEnt = new Set(data.empresas.flatMap((e) => e.entidades));
    const ents = data.entidades.filter((e) => empEnt.has(e.ruc)); // sólo las que tocan alguna empresa puente
    const idx = new Map(ents.map((e, i) => [e.ruc, i]));
    const comps = data.empresas
      .map((c) => ({ ...c, ents: c.entidades.filter((r) => idx.has(r)) }))
      .filter((c) => c.ents.length > 0);
    // Orden baricéntrico: cada empresa cerca del promedio de sus entidades → menos cruces de líneas.
    const bary = (c: (typeof comps)[number]) => c.ents.reduce((s, r) => s + (idx.get(r) ?? 0), 0) / c.ents.length;
    comps.sort((a, b) => bary(a) - bary(b) || b.n_entidades - a.n_entidades);
    // Etiqueta de cada entidad sin el prefijo que comparten todas (surge la unidad que las distingue).
    const titulos = ents.map((e) => tituloNatural(e.nombre));
    const pre = prefijoComun(titulos);
    const entsEtq = ents.map((e, i) => ({ ...e, etiqueta: (pre ? "… " : "") + titulos[i].slice(pre.length) }));
    return { ents: entsEtq, comps, maxCap: Math.max(...ents.map((e) => e.n_captura), 1) };
  }, [data]);

  const entIdx = useMemo(() => new Map(ents.map((e, i) => [e.ruc, i])), [ents]);
  const nE = ents.length;
  const nC = comps.length;
  const rows = Math.max(nE, nC);

  const W = 860;
  const top = 108;
  const band = rows * 34;
  const H = top + band + 48;
  const xEnt = 300;
  const xEmp = 600;
  const eY = (i: number) => top + ((i + 0.5) * band) / nE;
  const cY = (j: number) => top + ((j + 0.5) * band) / nC;
  const rEnt = (cap: number) => 5 + 9 * Math.sqrt(cap / maxCap);
  const rEmp = (n: number) => Math.min(17, 6 + 3 * Math.sqrt(n));

  // Conjuntos activos según el hover (para resaltar un nodo y sus líneas y atenuar el resto).
  const { actEnt, actEmp, sinHover } = useMemo(() => {
    if (!hover) return { actEnt: null as Set<string> | null, actEmp: null as Set<string> | null, sinHover: true };
    if (hover.tipo === "emp") {
      const c = comps.find((x) => x.ruc === hover.ruc);
      return { actEnt: new Set(c?.ents ?? []), actEmp: new Set([hover.ruc]), sinHover: false };
    }
    const emp = new Set(comps.filter((c) => c.ents.includes(hover.ruc)).map((c) => c.ruc));
    return { actEnt: new Set([hover.ruc]), actEmp: emp, sinHover: false };
  }, [hover, comps]);

  const entOn = (ruc: string) => sinHover || actEnt?.has(ruc);
  const empOn = (ruc: string) => sinHover || actEmp?.has(ruc);

  const detalle = hover?.tipo === "emp" ? comps.find((c) => c.ruc === hover.ruc) : null;
  const detalleEnt = hover?.tipo === "ent" ? ents.find((e) => e.ruc === hover.ruc) : null;

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-cuerpo font-semibold text-ink">El patrón: empresas que se repiten por sus municipios</h2>
        <span className="text-rotulo text-mute">{numero(nC)} {nC === 1 ? "empresa puente" : "empresas puente"}</span>
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">
        A la izquierda, las entidades que gobierna el partido; a la derecha, las empresas que ganaron contratos con
        indicio en <b className="text-ink">dos o más</b> de ellas. Cada línea es una de esas entidades. Toca para ver la ficha.
      </p>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[640px] touch-manipulation select-none"
          role="img"
          aria-label={`Grafo del partido ${corto(data.partido.partido, 50)}: ${numero(nE)} entidades y ${numero(nC)} empresas que se repiten en dos o más de ellas.`}
        >
          {/* rótulos de columna */}
          <text x={xEnt} y={top - 34} textAnchor="middle" className="fill-mute text-[11px] font-semibold uppercase tracking-wide">
            Entidades que gobierna
          </text>
          <text x={xEmp} y={top - 34} textAnchor="middle" className="fill-mute text-[11px] font-semibold uppercase tracking-wide">
            Empresas que se repiten
          </text>

          {/* líneas entidad ↔ empresa */}
          {comps.map((c) =>
            c.ents.map((r) => {
              const i = entIdx.get(r);
              if (i == null) return null;
              const j = comps.indexOf(c);
              const x1 = xEnt + rEnt(ents[i].n_captura);
              const y1 = eY(i);
              const x2 = xEmp - rEmp(c.n_entidades);
              const y2 = cY(j);
              const mx = (x1 + x2) / 2;
              const on = sinHover || (actEmp?.has(c.ruc) && actEnt?.has(r));
              return (
                <path
                  key={`${c.ruc}-${r}`}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  className={esFuerte(c.lazos) ? "stroke-crimson" : "stroke-amber"}
                  strokeWidth={on && !sinHover ? 2 : 1.2}
                  strokeOpacity={on ? 0.5 : 0.08}
                  strokeLinecap="round"
                />
              );
            }),
          )}

          {/* nodos entidad */}
          {ents.map((e, i) => (
            <g
              key={e.ruc}
              className="cursor-pointer"
              opacity={entOn(e.ruc) ? 1 : 0.25}
              onMouseEnter={() => setHover({ tipo: "ent", ruc: e.ruc })}
              onMouseLeave={() => setHover(null)}
              onClick={() => router.push(`/entidad/${e.ruc}`)}
              role="link"
              tabIndex={0}
              onKeyDown={(ev) => { if (ev.key === "Enter") router.push(`/entidad/${e.ruc}`); }}
              aria-label={`${corto(e.nombre, 60)}: ${numero(e.n_captura)} contratos con indicio`}
            >
              <circle cx={xEnt} cy={eY(i)} r={rEnt(e.n_captura)} className="fill-granate/25 stroke-granate stroke-[1.5]" />
              <text x={xEnt - rEnt(e.n_captura) - 8} y={eY(i) + 4} textAnchor="end" className="pointer-events-none fill-inkSoft text-[11px] font-medium">
                {trunc(e.etiqueta, 26)}
              </text>
            </g>
          ))}

          {/* nodos empresa */}
          {comps.map((c, j) => (
            <g
              key={c.ruc}
              className="cursor-pointer"
              opacity={empOn(c.ruc) ? 1 : 0.25}
              onMouseEnter={() => setHover({ tipo: "emp", ruc: c.ruc })}
              onMouseLeave={() => setHover(null)}
              onClick={() => router.push(`/empresa/${c.ruc}`)}
              role="link"
              tabIndex={0}
              onKeyDown={(ev) => { if (ev.key === "Enter") router.push(`/empresa/${c.ruc}`); }}
              aria-label={`${corto(c.nombre ?? c.ruc, 60)}: ganó en ${numero(c.n_entidades)} entidades del partido`}
            >
              <circle
                cx={xEmp}
                cy={cY(j)}
                r={rEmp(c.n_entidades)}
                className={`${esFuerte(c.lazos) ? "fill-crimson/25 stroke-crimson" : "fill-amber/25 stroke-amber"} stroke-[1.5]`}
              />
              <text x={xEmp + rEmp(c.n_entidades) + 8} y={cY(j) + 1} textAnchor="start" className="pointer-events-none fill-inkSoft text-[11px] font-medium">
                {corto(c.nombre ?? c.ruc, 26)}
              </text>
              <text x={xEmp + rEmp(c.n_entidades) + 8} y={cY(j) + 13} textAnchor="start" className="pointer-events-none fill-mute text-[10px]">
                {numero(c.n_entidades)} entidades, {numero(c.contratos)} contratos
              </text>
            </g>
          ))}
        </svg>

        {/* detalle del nodo activo */}
        {(detalle || detalleEnt) && (
          <div className="pointer-events-none absolute right-2 top-2 max-w-[260px] rounded-xl border border-line bg-paper/95 p-3 shadow-sm backdrop-blur">
            {detalle && (
              <>
                <div className="text-meta font-semibold text-ink">{corto(detalle.nombre ?? detalle.ruc, 44)}</div>
                <div className="mt-0.5 font-mono text-rotulo text-mute">RUC {detalle.ruc}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {detalle.lazos.map((l) => (
                    <span key={l} className={`rounded-full px-2 py-0.5 text-rotulo ${esFuerte([l]) ? "bg-crimson/10 text-crimson" : "bg-amber/10 text-amber"}`}>
                      {etiquetaLazo(l)}
                    </span>
                  ))}
                </div>
                <div className="mt-1.5 font-mono text-rotulo text-inkSoft">
                  ganó en {numero(detalle.n_entidades)} entidades, {numero(detalle.contratos)} contratos, {solesCompacto(detalle.monto)}
                </div>
              </>
            )}
            {detalleEnt && (
              <>
                <div className="text-meta font-semibold text-ink">{corto(detalleEnt.nombre, 44)}</div>
                <div className="mt-0.5 text-rotulo text-mute">{[detalleEnt.departamento].filter(Boolean).map((x) => tituloNatural(String(x))).join("")}</div>
                <div className="mt-1.5 font-mono text-rotulo text-inkSoft">{numero(detalleEnt.n_captura)} contratos con indicio, {solesCompacto(detalleEnt.monto_captura)}</div>
              </>
            )}
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
        <span className="text-mute">el tamaño de la empresa es a cuántas entidades llega</span>
      </div>
      <p className="text-rotulo leading-relaxed text-mute">
        Que una empresa gane en varias entidades del mismo partido es un indicio para revisar —puede ser competencia
        legítima—, no una acusación. Fuentes: JNE, ONPE, RNP/SEACE.
      </p>
    </section>
  );
}
