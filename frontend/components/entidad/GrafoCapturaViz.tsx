"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import { corto, rad, anchorDeCos, esLazoFuerte, etiquetaLazo } from "@/lib/grafo";
import {
  GrafoSeccion, GrafoCabecera, GrafoColumnas, GrafoMarco, GrafoAside, BotonFicha,
  Nodo, Arista, ChipLeyenda, type Tono,
} from "@/components/grafo/primitivos";
import type { GrafoCaptura } from "@/lib/poder";

/**
 * El grafo de captura de una entidad (mapa de poder, migración 125): en el centro la entidad y el partido que la
 * gobierna; alrededor, las empresas ligadas a ese partido que ganaron sus contratos. Cada radio es un lazo —rojo si
 * financió al partido o tiene un socio adentro, ámbar si le vendió a la campaña— y el tamaño del nodo son los contratos.
 * Son INDICIOS de registros públicos para revisión humana, nunca una acusación. Usa los primitivos de components/grafo:
 * nodos con brillo y hover suave, radios con flujo direccional y panel lateral persistente (Capa A).
 */
const tonoLazo = (lazos: string[]): Tono => (esLazoFuerte(lazos) ? "crimson" : "amber");

export function GrafoCapturaViz({ data }: { data: GrafoCaptura }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  const empresas = data.empresas;
  const n = empresas.length;
  const W = 760;
  const H = 540;
  const cx = W / 2;
  const cy = H / 2 + 6;
  const R = 186;
  const maxC = Math.max(...empresas.map((e) => e.contratos), 1);

  const nodos = empresas.map((e, i) => {
    const ang = -90 + ((i + 0.5) * 360) / n;
    const x = cx + R * Math.cos(rad(ang));
    const y = cy + R * Math.sin(rad(ang));
    const r = 7 + 13 * Math.sqrt(e.contratos / maxC);
    return { e, x, y, r, ang, tono: tonoLazo(e.lazos) };
  });

  // Empresa activa en el panel: la del cursor (preview) o, si no, la última tocada (fija).
  const act = (hover ? empresas.find((e) => e.ruc === hover) : null) ?? (sel ? empresas.find((e) => e.ruc === sel) : null);

  return (
    <GrafoSeccion>
      <GrafoCabecera
        migas={<span className="text-cuerpo font-semibold text-ink">La red de captura</span>}
        extra={<span className="text-rotulo text-mute">{numero(n)} {n === 1 ? "empresa ligada" : "empresas ligadas"}</span>}
      />
      <p className="text-meta leading-relaxed text-inkSoft">
        En el centro, la entidad y el partido que la gobierna. Alrededor, las empresas ligadas a ese partido que ganaron
        sus contratos. Toca una para ver su ficha.
      </p>

      <GrafoColumnas>
        <GrafoMarco>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full min-w-[560px] touch-manipulation select-none"
            role="img"
            aria-label={`Red de captura de ${corto(data.entidad.nombre ?? data.entidad.ruc, 60)}: ${n} empresas ligadas al partido que la gobierna.`}
          >
            {/* radios entidad → empresa, con flujo direccional, coloreados por lazo */}
            {nodos.map((nd) => (
              <Arista key={`e${nd.e.ruc}`} x1={cx} y1={cy} x2={nd.x} y2={nd.y} tono={nd.tono} flujo
                opacity={hover && hover !== nd.e.ruc ? 0.12 : 0.5} />
            ))}

            {/* nodos empresa */}
            {nodos.map((nd) => (
              <Nodo
                key={`n${nd.e.ruc}`}
                x={nd.x} y={nd.y} r={nd.r}
                tono={nd.tono}
                label={corto(nd.e.nombre ?? nd.e.ruc, 22)}
                anchor={anchorDeCos(Math.cos(rad(nd.ang)))}
                fontSize={11}
                hovered={hover === nd.e.ruc}
                selected={sel === nd.e.ruc}
                atenuado={hover != null && hover !== nd.e.ruc}
                onEnter={() => setHover(nd.e.ruc)}
                onLeave={() => setHover(null)}
                onClick={() => setSel(nd.e.ruc)}
                aria={`${corto(nd.e.nombre ?? nd.e.ruc, 60)}: ${numero(nd.e.contratos)} contratos`}
              />
            ))}

            {/* núcleo: entidad + partido que la gobierna */}
            <circle cx={cx} cy={cy} r={34} className="fill-paperSoft stroke-ink stroke-[2]" />
            <text x={cx} y={cy - 2} textAnchor="middle" className="fill-ink font-semibold" style={{ fontSize: "12px" }}>
              {corto(data.entidad.nombre ?? data.entidad.ruc, 18).split(" ").slice(0, 2).join(" ")}
            </text>
            <text x={cx} y={cy + 13} textAnchor="middle" className="fill-mute" style={{ fontSize: "10px" }}>la entidad</text>
            <g
              className="cursor-pointer"
              onClick={() => router.push(`/app/poder/${encodeURIComponent(data.partido)}`)}
              role="link"
              tabIndex={0}
              onKeyDown={(ev) => { if (ev.key === "Enter") router.push(`/app/poder/${encodeURIComponent(data.partido)}`); }}
              aria-label={`La gobierna ${corto(data.partido, 60)}`}
            >
              <rect x={cx - 112} y={cy - 86} width={224} height={34} rx={17} className="fill-paper stroke-granate stroke-[1.5]" />
              <text x={cx} y={cy - 70} textAnchor="middle" className="fill-mute uppercase tracking-wide" style={{ fontSize: "9px" }}>la gobierna</text>
              <text x={cx} y={cy - 58} textAnchor="middle" className="fill-granate font-semibold" style={{ fontSize: "12px" }}>{corto(data.partido, 30)}</text>
              <line x1={cx} y1={cy - 52} x2={cx} y2={cy - 34} className="stroke-granate stroke-[1.5]" strokeDasharray="3 3" />
            </g>
          </svg>
        </GrafoMarco>

        {/* panel lateral persistente */}
        <GrafoAside>
          {act ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-cuerpo font-semibold leading-tight text-ink">{tituloNatural(act.nombre ?? act.ruc)}</div>
                  <div className="font-mono text-rotulo text-mute">RUC {act.ruc}</div>
                </div>
                {sel && <button type="button" onClick={() => setSel(null)} className="text-mute hover:text-ink" aria-label="Cerrar detalle">✕</button>}
              </div>
              <div className="flex flex-wrap gap-1">
                {act.lazos.map((l) => (
                  <span key={l} className={`rounded-full px-2 py-0.5 text-rotulo ${esLazoFuerte([l]) ? "bg-crimson/10 text-crimson" : "bg-amber/10 text-amber"}`}>{etiquetaLazo(l)}</span>
                ))}
              </div>
              <div className="rounded-lg border border-line bg-paper px-3 py-2 font-mono text-rotulo text-inkSoft">
                {numero(act.contratos)} {act.contratos === 1 ? "contrato" : "contratos"}, {solesCompacto(act.monto)}
              </div>
              <BotonFicha onClick={() => router.push(`/empresa/${act.ruc}`)}>Ver la empresa →</BotonFicha>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-cuerpo font-semibold text-ink">La red de captura</div>
                <div className="text-rotulo text-mute">{numero(n)} {n === 1 ? "empresa ligada" : "empresas ligadas"}</div>
              </div>
              <p className="text-meta leading-relaxed text-inkSoft">Toca una empresa para ver sus lazos con el partido y abrir su ficha.</p>
              <div className="space-y-1.5">
                <ChipLeyenda tono="crimson" forma="punto">financió al partido o es su socio adentro</ChipLeyenda>
                <ChipLeyenda tono="amber" forma="punto">le vendió a la campaña</ChipLeyenda>
                <span className="text-rotulo text-mute">el tamaño es el número de contratos</span>
              </div>
            </div>
          )}
        </GrafoAside>
      </GrafoColumnas>

      <p className="text-rotulo leading-relaxed text-mute">
        Son indicios de registros públicos (JNE, ONPE, RNP/SEACE) para revisión humana —una empresa puede ganar de forma
        limpia—, no una acusación.
      </p>
    </GrafoSeccion>
  );
}
