"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import { corto, rad, anchorDeCos, nivelTxt } from "@/lib/grafo";
import {
  GrafoSeccion, GrafoCabecera, GrafoColumnas, GrafoMarco, GrafoAside, BotonFicha,
  Nodo, Arista, ChipLeyenda, type Tono,
} from "@/components/grafo/primitivos";
import type { PoderEntidad } from "@/lib/poder";

/**
 * Dónde gobierna un partido, por región: El partido en el centro, alrededor los departamentos donde gobierna (tamaño =
 * cuántas entidades controla ahí) y, al tocar uno, sus entidades de ese departamento con su autoridad (el afiliado que
 * las gobierna) brotan alrededor y en el panel, clickeables a su ficha. En rojo + halo las que tienen indicios de
 * captura (3 canales). Usa los primitivos de components/grafo. No acusación.
 */
const fuerte = (e: PoderEntidad) => (e.n_captura ?? 0) > 0;
const tonoEnt = (e: PoderEntidad): Tono => (fuerte(e) ? "crimson" : "granate");

export function GrafoPartidoRegiones({ partido, entidades }: { partido: string; entidades: PoderEntidad[] }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null); // entidad_ruc en foco
  const [foco, setFoco] = useState<string | null>(null); // departamento

  const deps = useMemo(() => {
    const m = new Map<string, PoderEntidad[]>();
    for (const e of entidades) {
      const d = (e.departamento ?? "Sin dato").toString();
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
  // recorte: el país tiene 25 departamentos; mostramos todos (el anillo nunca pasa de 25).
  const depVis = deps.slice(0, 25);
  const focoEnts = foco ? (deps.find((d) => d.dep === foco)?.ents ?? []).slice(0, 28) : [];
  const maxCapFoco = Math.max(...focoEnts.map((x) => x.n_captura ?? 0), 1);

  const depNodos = depVis.map((d, i) => {
    const N = depVis.length;
    const deg = -90 + ((i + 0.5) * 360) / N;
    const a = rad(deg);
    return { d, a, deg, cos: Math.cos(a), x: cx + 266 * Math.cos(a), y: cy + 266 * Math.sin(a), r: 10 + 14 * Math.sqrt(d.ents.length / maxDep) };
  });
  const entNodos = focoEnts.map((e, k) => {
    const deg = -90 + ((k + 0.5) * 360) / Math.max(focoEnts.length, 1);
    const a = rad(deg);
    return { e, k, a, deg, cos: Math.cos(a), x: cx + 266 * Math.cos(a), y: cy + 266 * Math.sin(a), r: 8 + 10 * Math.sqrt((e.n_captura ?? 0) / maxCapFoco) };
  });

  const detE = (hover ? entidades.find((e) => e.entidad_ruc === hover) : null) ?? (sel ? entidades.find((e) => e.entidad_ruc === sel) : null);
  const totalDep = deps.length;
  const centro = foco ? tituloNatural(foco) : corto(partido, 16);

  return (
    <GrafoSeccion>
      <GrafoCabecera
        migas={
          foco ? (
            <button type="button" onClick={() => { setFoco(null); setSel(null); }} className="flex items-center gap-1.5 text-meta font-semibold text-granate hover:underline underline-offset-2">
              ← Todas las regiones
            </button>
          ) : (
            <span className="text-cuerpo font-semibold text-ink">Dónde gobierna, por región</span>
          )
        }
        extra={
          <span className="text-rotulo text-mute">
            {foco ? `${tituloNatural(foco)}: ${numero(deps.find((d) => d.dep === foco)?.ents.length ?? 0)} entidades` : `${numero(totalDep)} departamentos — tocá uno para ver sus entidades`}
          </span>
        }
      />

      <GrafoColumnas>
        <GrafoMarco>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px] touch-manipulation select-none" role="img"
               aria-label={foco ? `${tituloNatural(foco)}: entidades del partido` : `${tituloNatural(partido)}: departamentos donde gobierna`}>
            {/* radios */}
            {foco
              ? entNodos.map((nd) => (
                  <Arista key={`l${nd.e.entidad_ruc}`} x1={cx} y1={cy} x2={nd.x} y2={nd.y} tono={tonoEnt(nd.e)} flujo
                    opacity={hover && hover !== nd.e.entidad_ruc ? 0.12 : 0.45} />
                ))
              : depNodos.map((nd) => (
                  <Arista key={`l${nd.d.dep}`} x1={cx} y1={cy} x2={nd.x} y2={nd.y} tono="neutro" opacity={0.55} />
                ))}

            {/* nodos */}
            {foco
              ? entNodos.map((nd) => (
                  <Nodo
                    key={nd.e.entidad_ruc}
                    x={nd.x} y={nd.y} r={nd.r}
                    tono={tonoEnt(nd.e)}
                    label={corto(nd.e.entidad, 22)}
                    anchor={anchorDeCos(nd.cos)}
                    anguloEtiqueta={nd.deg}
                    fontSize={10.5}
                    hovered={hover === nd.e.entidad_ruc}
                    selected={sel === nd.e.entidad_ruc}
                    resalta={fuerte(nd.e)}
                    entra
                    indice={nd.k}
                    atenuado={!!hover && hover !== nd.e.entidad_ruc}
                    onEnter={() => setHover(nd.e.entidad_ruc)}
                    onLeave={() => setHover(null)}
                    onClick={() => setSel(nd.e.entidad_ruc)}
                    aria={`${corto(nd.e.entidad, 60)}${nd.e.autoridad ? `, gobierna ${corto(nd.e.autoridad, 40)}` : ""}`}
                  />
                ))
              : depNodos.map((nd) => (
                  <Nodo
                    key={nd.d.dep}
                    x={nd.x} y={nd.y} r={nd.r}
                    tono="granate"
                    label={`${tituloNatural(nd.d.dep)} (${nd.d.ents.length})`}
                    anchor={anchorDeCos(nd.cos)}
                    anguloEtiqueta={nd.deg}
                    fontSize={11}
                    hovered={hover === nd.d.dep}
                    atenuado={!!hover && hover !== nd.d.dep}
                    onEnter={() => setHover(nd.d.dep)}
                    onLeave={() => setHover(null)}
                    onClick={() => { setFoco(nd.d.dep); setSel(null); }}
                    aria={`Ver ${tituloNatural(nd.d.dep)}: ${nd.d.ents.length} entidades`}
                  />
                ))}

            {/* centro */}
            <circle cx={cx} cy={cy} r={43} className="fill-granate/15 pointer-events-none" />
            <circle cx={cx} cy={cy} r={40} className="fill-paperSoft stroke-granate stroke-[2.5]" />
            <text x={cx} y={cy - 2} textAnchor="middle" className="fill-ink font-semibold" style={{ fontSize: "12px" }}>{centro}</text>
            <text x={cx} y={cy + 13} textAnchor="middle" className="fill-mute" style={{ fontSize: "9px" }}>{foco ? "del partido" : "el partido"}</text>
          </svg>
        </GrafoMarco>

        {/* panel lateral persistente */}
        <GrafoAside>
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
              <BotonFicha onClick={() => router.push(`/entidad/${detE.entidad_ruc}`)} />
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
              <div className="space-y-1.5">
                <ChipLeyenda tono="crimson" forma="halo">con indicios de captura</ChipLeyenda>
                <ChipLeyenda tono="granate" forma="punto">sin ese indicio</ChipLeyenda>
              </div>
            </div>
          )}
        </GrafoAside>
      </GrafoColumnas>

      <p className="text-rotulo leading-relaxed text-mute">
        La autoridad de cada entidad es quien la gobierna por el partido. Fuentes: JNE/ONPE/RNP. Indicios para revisión
        humana, no una acusación.
      </p>
    </GrafoSeccion>
  );
}
