"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import { corto, esLazoFuerte, etiquetaLazo } from "@/lib/grafo";
import {
  GrafoSeccion, GrafoCabecera, GrafoColumnas, GrafoMarco, GrafoAside, BotonFicha,
  Nodo, ChipLeyenda, type Tono,
} from "@/components/grafo/primitivos";
import type { GrafoPartido } from "@/lib/poder";

/**
 * El grafo de captura de un partido (mapa de poder, migración 125), dibujado como red BIPARTITA: a la izquierda las
 * entidades que gobierna, a la derecha las empresas «puente» —las que ganaron con indicio en 2+ de esas entidades—, y
 * una línea por cada vez que una empresa ganó en una entidad. Rojo si financió al partido o es su socio adentro, ámbar
 * si sólo le vendió a la campaña. Al enfocar un nodo, sus conexiones fluyen. Panel lateral persistente (Capa A). Usa los
 * primitivos de components/grafo. Son INDICIOS para revisión, nunca acusación.
 */
const tonoLazo = (lazos: string[]): Tono => (esLazoFuerte(lazos) ? "crimson" : "amber");
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
  // 38 px por fila: deja aire entre la etiqueta de la empresa y su segunda línea de detalle, sin amontonarse.
  const band = rows * 38;
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

  const entOn = (ruc: string) => sinFoco || !!actEnt?.has(ruc);
  const empOn = (ruc: string) => sinFoco || !!actEmp?.has(ruc);
  const act = (tipo: "ent" | "emp", ruc: string) => foco?.tipo === tipo && foco.ruc === ruc;
  const esSel = (tipo: "ent" | "emp", ruc: string) => sel?.tipo === tipo && sel.ruc === ruc;

  const detalle = foco?.tipo === "emp" ? comps.find((c) => c.ruc === foco.ruc) : null;
  const detalleEnt = foco?.tipo === "ent" ? ents.find((e) => e.ruc === foco.ruc) : null;

  return (
    <GrafoSeccion>
      <GrafoCabecera
        migas={<span className="text-cuerpo font-semibold text-ink">El patrón: empresas que se repiten por sus municipios</span>}
        extra={<span className="text-rotulo text-mute">{numero(nC)} {nC === 1 ? "empresa puente" : "empresas puente"}</span>}
      />

      <GrafoColumnas>
        <GrafoMarco>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full min-w-[560px] touch-manipulation select-none"
            role="img"
            aria-label={`Grafo del partido ${corto(data.partido.partido, 50)}: ${numero(nE)} entidades y ${numero(nC)} empresas que se repiten en dos o más de ellas.`}
          >
            <text x={xEnt} y={top - 34} textAnchor="middle" className="fill-mute font-semibold uppercase tracking-wide" style={{ fontSize: "11px" }}>Entidades que gobierna</text>
            <text x={xEmp} y={top - 34} textAnchor="middle" className="fill-mute font-semibold uppercase tracking-wide" style={{ fontSize: "11px" }}>Empresas que se repiten</text>

            {/* líneas entidad ↔ empresa (curvas); fluyen cuando el par está enfocado */}
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
                const on = sinFoco || (!!actEmp?.has(c.ruc) && !!actEnt?.has(r));
                const fluye = on && !sinFoco;
                return (
                  <path key={`${c.ruc}-${r}`} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none"
                    className={`${esLazoFuerte(c.lazos) ? "stroke-crimson" : "stroke-amber"} ${fluye ? "animate-fluirDatos" : ""}`}
                    strokeWidth={fluye ? 2 : 1.2} strokeOpacity={on ? 0.5 : 0.08} strokeLinecap="round"
                    strokeDasharray={fluye ? "8 8" : undefined} />
                );
              }),
            )}

            {/* nodos entidad (izquierda) */}
            {ents.map((e, i) => (
              <Nodo
                key={e.ruc}
                x={xEnt} y={eY(i)} r={rEnt(e.n_captura)}
                tono="granate"
                label={trunc(e.etiqueta, 30)}
                anchor="end"
                fontSize={11}
                hovered={act("ent", e.ruc)}
                selected={esSel("ent", e.ruc)}
                resalta={(e.n_captura ?? 0) > 0}
                atenuado={!entOn(e.ruc)}
                onEnter={() => setHover({ tipo: "ent", ruc: e.ruc })}
                onLeave={() => setHover(null)}
                onClick={() => setSel({ tipo: "ent", ruc: e.ruc })}
                aria={`${corto(e.nombre, 60)}: ${numero(e.n_captura)} contratos con indicio`}
              />
            ))}

            {/* nodos empresa (derecha) + segunda línea de detalle */}
            {comps.map((c, j) => (
              <g key={c.ruc} opacity={empOn(c.ruc) ? 1 : 0.25}>
                <Nodo
                  x={xEmp} y={cY(j)} r={rEmp(c.n_entidades)}
                  tono={tonoLazo(c.lazos)}
                  label={corto(c.nombre ?? c.ruc, 26)}
                  anchor="start"
                  fontSize={11}
                  hovered={act("emp", c.ruc)}
                  selected={esSel("emp", c.ruc)}
                  onEnter={() => setHover({ tipo: "emp", ruc: c.ruc })}
                  onLeave={() => setHover(null)}
                  onClick={() => setSel({ tipo: "emp", ruc: c.ruc })}
                  aria={`${corto(c.nombre ?? c.ruc, 60)}: ganó en ${numero(c.n_entidades)} entidades del partido`}
                />
                <text x={xEmp + rEmp(c.n_entidades) + 8} y={cY(j) + 13} textAnchor="start" className="pointer-events-none fill-mute" style={{ fontSize: "10px" }}>
                  {numero(c.n_entidades)} entidades, {numero(c.contratos)} contratos
                </text>
              </g>
            ))}
          </svg>
        </GrafoMarco>

        {/* panel lateral persistente */}
        <GrafoAside>
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
                  <span key={l} className={`rounded-full px-2 py-0.5 text-rotulo ${esLazoFuerte([l]) ? "bg-crimson/10 text-crimson" : "bg-amber/10 text-amber"}`}>{etiquetaLazo(l)}</span>
                ))}
              </div>
              <div className="rounded-lg border border-line bg-paper px-3 py-2 font-mono text-rotulo text-inkSoft">
                ganó en {numero(detalle.n_entidades)} entidades, {numero(detalle.contratos)} contratos, {solesCompacto(detalle.monto)}
              </div>
              <BotonFicha onClick={() => router.push(`/empresa/${detalle.ruc}`)}>Ver la empresa →</BotonFicha>
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
              <BotonFicha onClick={() => router.push(`/entidad/${detalleEnt.ruc}`)}>Ver la entidad →</BotonFicha>
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
              <div className="space-y-1.5">
                <ChipLeyenda tono="crimson" forma="punto">financió al partido o es su socio</ChipLeyenda>
                <ChipLeyenda tono="amber" forma="punto">le vendió a la campaña</ChipLeyenda>
                <span className="text-rotulo text-mute">el tamaño de la empresa es a cuántas entidades llega</span>
              </div>
            </div>
          )}
        </GrafoAside>
      </GrafoColumnas>

      <p className="text-rotulo leading-relaxed text-mute">
        Que una empresa gane en varias entidades del mismo partido es un indicio para revisar —puede ser competencia
        legítima—, no una acusación. Fuentes: JNE, ONPE, RNP/SEACE.
      </p>
    </GrafoSeccion>
  );
}
