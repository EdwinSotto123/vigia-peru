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
 * si sólo le vendió a la campaña. El panel lateral muestra el nodo activo. Son INDICIOS para revisión, nunca acusación.
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

const ABREV: [RegExp, string][] = [
  [/^Gobierno Regional Del? /i, "G.R. "],
  [/^Municipalidad Provincial Del? /i, "M.P. "],
  [/^Municipalidad Distrital Del? /i, "M.D. "],
  [/^Municipalidad Del? /i, "Mun. "],
];
function abreviar(t: string): string {
  for (const [re, ab] of ABREV) if (re.test(t)) return t.replace(re, ab);
  return t;
}

type Ref = { tipo: "ent" | "emp"; ruc: string } | null;

export function GrafoPartidoViz({ data }: { data: GrafoPartido }) {
  const router = useRouter();
  const [hover, setHover] = useState<Ref>(null);
  const [sel, setSel] = useState<Ref>(null);

  const { ents, comps, maxCap } = useMemo(() => {
    const empEnt = new Set(data.empresas.flatMap((e) => e.entidades));
    const ents = data.entidades.filter((e) => empEnt.has(e.ruc));
    const idx = new Map(ents.map((e, i) => [e.ruc, i]));
    const comps = data.empresas
      .map((c) => ({ ...c, ents: c.entidades.filter((r) => idx.has(r)) }))
      .filter((c) => c.ents.length > 0);
    const bary = (c: (typeof comps)[number]) => c.ents.reduce((s, r) => s + (idx.get(r) ?? 0), 0) / c.ents.length;
    comps.sort((a, b) => bary(a) - bary(b) || b.n_entidades - a.n_entidades);
    const entsEtq = ents.map((e) => ({ ...e, etiqueta: abreviar(tituloNatural(e.nombre)) }));
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

  // El nodo "activo" (para resaltar y para el panel): el del cursor o, si no, el fijado al tocar.
  const foco = hover ?? sel;
  const { actEnt, actEmp, sinFoco } = useMemo(() => {
    if (!foco) return { actEnt: null as Set<string> | null, actEmp: null as Set<string> | null, sinFoco: true };
    if (foco.tipo === "emp") {
      const c = comps.find((x) => x.ruc === foco.ruc);
      return { actEnt: new Set(c?.ents ?? []), actEmp: new Set([foco.ruc]), sinFoco: false };
    }
    const emp = new Set(comps.filter((c) => c.ents.includes(foco.ruc)).map((c) => c.ruc));
    return { actEnt: new Set([foco.ruc]), actEmp: emp, sinFoco: false };
  }, [foco, comps]);

  const entOn = (ruc: string) => sinFoco || actEnt?.has(ruc);
  const empOn = (ruc: string) => sinFoco || actEmp?.has(ruc);
  const act = (tipo: "ent" | "emp", ruc: string) => foco?.tipo === tipo && foco.ruc === ruc;
  const esSel = (tipo: "ent" | "emp", ruc: string) => sel?.tipo === tipo && sel.ruc === ruc;

  const detalle = foco?.tipo === "emp" ? comps.find((c) => c.ruc === foco.ruc) : null;
  const detalleEnt = foco?.tipo === "ent" ? ents.find((e) => e.ruc === foco.ruc) : null;

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-cuerpo font-semibold text-ink">El patrón: empresas que se repiten por sus municipios</h2>
        <span className="text-rotulo text-mute">{numero(nC)} {nC === 1 ? "empresa puente" : "empresas puente"}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="overflow-x-auto rounded-xl border border-line bg-fondo/40">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full min-w-[560px] touch-manipulation select-none"
            role="img"
            aria-label={`Grafo del partido ${corto(data.partido.partido, 50)}: ${numero(nE)} entidades y ${numero(nC)} empresas que se repiten en dos o más de ellas.`}
          >
            <text x={xEnt} y={top - 34} textAnchor="middle" className="fill-mute text-[11px] font-semibold uppercase tracking-wide">Entidades que gobierna</text>
            <text x={xEmp} y={top - 34} textAnchor="middle" className="fill-mute text-[11px] font-semibold uppercase tracking-wide">Empresas que se repiten</text>

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
                const on = sinFoco || (actEmp?.has(c.ruc) && actEnt?.has(r));
                return (
                  <path key={`${c.ruc}-${r}`} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none"
                    className={esFuerte(c.lazos) ? "stroke-crimson" : "stroke-amber"}
                    strokeWidth={on && !sinFoco ? 2 : 1.2} strokeOpacity={on ? 0.5 : 0.08} strokeLinecap="round" />
                );
              }),
            )}

            {/* nodos entidad */}
            {ents.map((e, i) => {
              const r = rEnt(e.n_captura) + (act("ent", e.ruc) ? 2 : 0);
              return (
                <g key={e.ruc} className="cursor-pointer transition-opacity duration-rapido" opacity={entOn(e.ruc) ? 1 : 0.25}
                   onMouseEnter={() => setHover({ tipo: "ent", ruc: e.ruc })} onMouseLeave={() => setHover(null)}
                   onClick={() => setSel({ tipo: "ent", ruc: e.ruc })} role="button" tabIndex={0}
                   onKeyDown={(ev) => { if (ev.key === "Enter") setSel({ tipo: "ent", ruc: e.ruc }); }}
                   aria-label={`${corto(e.nombre, 60)}: ${numero(e.n_captura)} contratos con indicio`}>
                  {esSel("ent", e.ruc) && <circle cx={xEnt} cy={eY(i)} r={r + 4} className="fill-none stroke-ink stroke-[1.5]" />}
                  <circle cx={xEnt} cy={eY(i)} r={r} className="fill-granate/25 stroke-granate" strokeWidth={act("ent", e.ruc) ? 2.5 : 1.5} />
                  <text x={xEnt - r - 8} y={eY(i) + 4} textAnchor="end" className={`pointer-events-none text-[11px] ${act("ent", e.ruc) ? "fill-ink font-semibold" : "fill-inkSoft font-medium"}`}>{trunc(e.etiqueta, 30)}</text>
                </g>
              );
            })}

            {/* nodos empresa */}
            {comps.map((c, j) => {
              const r = rEmp(c.n_entidades) + (act("emp", c.ruc) ? 2 : 0);
              return (
                <g key={c.ruc} className="cursor-pointer transition-opacity duration-rapido" opacity={empOn(c.ruc) ? 1 : 0.25}
                   onMouseEnter={() => setHover({ tipo: "emp", ruc: c.ruc })} onMouseLeave={() => setHover(null)}
                   onClick={() => setSel({ tipo: "emp", ruc: c.ruc })} role="button" tabIndex={0}
                   onKeyDown={(ev) => { if (ev.key === "Enter") setSel({ tipo: "emp", ruc: c.ruc }); }}
                   aria-label={`${corto(c.nombre ?? c.ruc, 60)}: ganó en ${numero(c.n_entidades)} entidades del partido`}>
                  {esSel("emp", c.ruc) && <circle cx={xEmp} cy={cY(j)} r={r + 4} className="fill-none stroke-ink stroke-[1.5]" />}
                  <circle cx={xEmp} cy={cY(j)} r={r} className={`${esFuerte(c.lazos) ? "fill-crimson/25 stroke-crimson" : "fill-amber/25 stroke-amber"}`} strokeWidth={act("emp", c.ruc) ? 2.5 : 1.5} />
                  <text x={xEmp + r + 8} y={cY(j) + 1} textAnchor="start" className={`pointer-events-none text-[11px] ${act("emp", c.ruc) ? "fill-ink font-semibold" : "fill-inkSoft font-medium"}`}>{corto(c.nombre ?? c.ruc, 26)}</text>
                  <text x={xEmp + r + 8} y={cY(j) + 13} textAnchor="start" className="pointer-events-none fill-mute text-[10px]">{numero(c.n_entidades)} entidades, {numero(c.contratos)} contratos</text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* panel lateral persistente */}
        <aside className="rounded-xl border border-line bg-paperSoft/50 p-4">
          {detalle ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-cuerpo font-semibold leading-tight text-ink">{tituloNatural(detalle.nombre ?? detalle.ruc)}</div>
                  <div className="font-mono text-rotulo text-mute">RUC {detalle.ruc}</div>
                </div>
                {sel && <button type="button" onClick={() => setSel(null)} className="text-mute hover:text-ink" aria-label="Cerrar detalle">✕</button>}
              </div>
              <div className="flex flex-wrap gap-1">
                {detalle.lazos.map((l) => (
                  <span key={l} className={`rounded-full px-2 py-0.5 text-rotulo ${esFuerte([l]) ? "bg-crimson/10 text-crimson" : "bg-amber/10 text-amber"}`}>{etiquetaLazo(l)}</span>
                ))}
              </div>
              <div className="rounded-lg border border-line bg-paper px-3 py-2 font-mono text-rotulo text-inkSoft">
                ganó en {numero(detalle.n_entidades)} entidades, {numero(detalle.contratos)} contratos, {solesCompacto(detalle.monto)}
              </div>
              <button type="button" onClick={() => router.push(`/empresa/${detalle.ruc}`)} className="mt-1 w-full rounded-lg bg-granate px-3 py-2 text-meta font-semibold text-sobreMaiz transition-opacity duration-rapido hover:opacity-90">Ver la empresa →</button>
            </div>
          ) : detalleEnt ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="text-cuerpo font-semibold leading-tight text-ink">{tituloNatural(detalleEnt.nombre)}</div>
                {sel && <button type="button" onClick={() => setSel(null)} className="text-mute hover:text-ink" aria-label="Cerrar detalle">✕</button>}
              </div>
              {detalleEnt.departamento ? <div className="text-rotulo text-mute">{tituloNatural(String(detalleEnt.departamento))}</div> : null}
              <div className="rounded-lg border border-line bg-paper px-3 py-2">
                <div className="font-mono text-cuerpo font-semibold tabular-nums text-crimson">{numero(detalleEnt.n_captura)}</div>
                <div className="text-rotulo text-mute">contratos con indicio, {solesCompacto(detalleEnt.monto_captura)}</div>
              </div>
              <button type="button" onClick={() => router.push(`/entidad/${detalleEnt.ruc}`)} className="mt-1 w-full rounded-lg bg-granate px-3 py-2 text-meta font-semibold text-sobreMaiz transition-opacity duration-rapido hover:opacity-90">Ver la entidad →</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-cuerpo font-semibold text-ink">El patrón</div>
                <div className="text-rotulo text-mute">{numero(nE)} entidades, {numero(nC)} empresas que se repiten</div>
              </div>
              <p className="text-meta leading-relaxed text-inkSoft">
                A la izquierda, las entidades que gobierna el partido; a la derecha, las empresas que ganaron con indicio en
                <b className="text-ink"> dos o más</b> de ellas. Tocá un nodo para verlo.
              </p>
              <div className="space-y-1.5 text-rotulo text-mute">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson/70" aria-hidden /> financió al partido o es su socio</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber/70" aria-hidden /> le vendió a la campaña</span>
                <span>el tamaño de la empresa es a cuántas entidades llega</span>
              </div>
            </div>
          )}
        </aside>
      </div>

      <p className="text-rotulo leading-relaxed text-mute">
        Que una empresa gane en varias entidades del mismo partido es un indicio para revisar —puede ser competencia
        legítima—, no una acusación. Fuentes: JNE, ONPE, RNP/SEACE.
      </p>
    </section>
  );
}
