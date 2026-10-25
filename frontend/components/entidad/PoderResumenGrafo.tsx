"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import { rad, corto, anguloEnAnillo, radioPorRaiz, anchorDeCos } from "@/lib/grafo";
import {
  GrafoSeccion, GrafoColumnas, GrafoMarco, GrafoAside, BotonFicha,
  Nodo, NodoCentro, Arista, ChipLeyenda,
} from "@/components/grafo/primitivos";
import type { PoderGrafoPartido } from "@/lib/poder";
import { clavePartido } from "@/lib/poder";

/**
 * Grafo-resumen del mapa de poder (migración 125): en el centro el Estado, alrededor los partidos que más capturan y,
 * colgando de cada uno, sus instituciones más capturadas (rojo si una empresa le financió la campaña o es su socio,
 * ámbar si sólo le vendió). La vista de conjunto —qué partido controla qué instituciones— que la tabla no da de un
 * vistazo. Pasá el cursor por un partido o una institución y el panel lo detalla; tocá para ir a su ficha. Sobre los
 * primitivos de components/grafo. Indicios, no acusaciones.
 */
type Inst = PoderGrafoPartido["instituciones"][number];
const fuerteEnt = (e: Inst) => (e.n_financiaron ?? 0) > 0 || (e.n_socio ?? 0) > 0;

const W = 1040;
const H = 900;
const cx = W / 2;
const cy = H / 2;
const Rp = 235;
const Re = Rp + 112;

export function PoderResumenGrafo({ partidos }: { partidos: PoderGrafoPartido[] }) {
  const router = useRouter();
  const [hoverP, setHoverP] = useState<string | null>(null);
  const [hoverE, setHoverE] = useState<string | null>(null);

  const clusters = useMemo(() => partidos.filter((p) => p.instituciones.length > 0).slice(0, 12), [partidos]);
  const N = clusters.length;
  const maxCap = Math.max(...clusters.map((c) => c.n_captura), 1);

  const nodos = useMemo(() => clusters.map((c, i) => {
    const ang = anguloEnAnillo(i, N);
    const hx = cx + Rp * Math.cos(rad(ang));
    const hy = cy + Rp * Math.sin(rad(ang));
    const insts = c.instituciones.slice(0, 6);
    const K = insts.length;
    const spreadDeg = Math.min(26, 5 * K);
    const ents = insts.map((e, k) => {
      const ea = ang + ((k - (K - 1) / 2) * spreadDeg) / Math.max(K - 1, 1);
      return { e, x: cx + Re * Math.cos(rad(ea)), y: cy + Re * Math.sin(rad(ea)), cos: Math.cos(rad(ea)) };
    });
    return { c, ang, hx, hy, ents, rHub: radioPorRaiz(c.n_captura, maxCap, 11, 17), cos: Math.cos(rad(ang)) };
  }), [clusters, N, maxCap]);

  const activa = hoverP != null;
  const detP = hoverP ? clusters.find((c) => c.partido === hoverP) : null;
  const detE = hoverE ? clusters.flatMap((c) => c.instituciones).find((e) => e.ruc === hoverE) : null;
  const totInst = clusters.reduce((s, c) => s + c.instituciones.length, 0);

  return (
    <GrafoSeccion>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-cuerpo font-semibold tracking-tight text-ink">Quién controla qué</div>
        <span className="text-rotulo text-mute">{numero(N)} partidos, {numero(totInst)} instituciones</span>
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">
        En el centro, el Estado; alrededor, los partidos que más capturan y las instituciones que gobiernan. Pasá el
        cursor por un partido para ver sus instituciones; tocá para ir a su ficha.
      </p>

      <GrafoColumnas>
        <GrafoMarco>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[520px] touch-manipulation select-none" role="img"
               aria-label={`Mapa de poder: los ${numero(N)} partidos que más capturan y sus ${numero(totInst)} instituciones.`}>
            {/* radios Estado → partido */}
            {nodos.map((nd) => (
              <Arista key={`c${nd.c.partido}`} x1={cx} y1={cy} x2={nd.hx} y2={nd.hy} tono="neutro"
                opacity={activa && hoverP !== nd.c.partido ? 0.12 : 0.6} />
            ))}
            {/* radios partido → institución */}
            {nodos.map((nd) =>
              nd.ents.map((en) => (
                <Arista key={`e${en.e.ruc}`} x1={nd.hx} y1={nd.hy} x2={en.x} y2={en.y}
                  tono={fuerteEnt(en.e) ? "crimson" : "amber"}
                  opacity={activa && hoverP !== nd.c.partido ? 0.08 : 0.5}
                  flujo={hoverP === nd.c.partido} />
              )),
            )}
            {/* instituciones */}
            {nodos.map((nd) =>
              nd.ents.map((en) => (
                <Nodo
                  key={`en${en.e.ruc}`}
                  x={en.x} y={en.y} r={8}
                  tono={fuerteEnt(en.e) ? "crimson" : "amber"}
                  resalta={fuerteEnt(en.e)}
                  label={hoverP === nd.c.partido ? corto(en.e.nombre, 22) : undefined}
                  anchor={anchorDeCos(en.cos)}
                  fontSize={10}
                  hovered={hoverE === en.e.ruc}
                  atenuado={activa && hoverP !== nd.c.partido}
                  onEnter={() => { setHoverP(nd.c.partido); setHoverE(en.e.ruc); }}
                  onLeave={() => { setHoverP(null); setHoverE(null); }}
                  onClick={() => router.push(`/entidad/${en.e.ruc}`)}
                  aria={`${corto(en.e.nombre, 60)}: ${numero(en.e.n_captura)} contratos con indicio`}
                />
              )),
            )}
            {/* partidos (hubs) */}
            {nodos.map((nd) => (
              <Nodo
                key={`h${nd.c.partido}`}
                x={nd.hx} y={nd.hy} r={nd.rHub}
                tono="granate"
                label={corto(nd.c.partido, 24)}
                anchor={anchorDeCos(nd.cos)}
                fontSize={11}
                hovered={hoverP === nd.c.partido}
                foco={hoverP === nd.c.partido}
                atenuado={activa && hoverP !== nd.c.partido}
                onEnter={() => setHoverP(nd.c.partido)}
                onLeave={() => setHoverP(null)}
                onClick={() => router.push(`/app/poder/${clavePartido(nd.c.partido)}`)}
                aria={`${corto(nd.c.partido, 60)}: gobierna ${numero(nd.c.n_entidades)} entidades, ${numero(nd.c.n_captura)} contratos con indicio`}
              />
            ))}
            <NodoCentro x={cx} y={cy} lineas={["El Estado", "los que gobiernan"]} />
          </svg>
        </GrafoMarco>

        <GrafoAside>
          {detE ? (
            <div className="space-y-2">
              <div className="text-cuerpo font-semibold leading-tight text-ink">{tituloNatural(detE.nombre)}</div>
              {detE.departamento ? <div className="text-rotulo text-mute">{tituloNatural(String(detE.departamento))}</div> : null}
              <div className="rounded-lg border border-line bg-paper px-3 py-2">
                <div className="font-mono text-cuerpo font-semibold tabular-nums text-crimson">{numero(detE.n_captura)}</div>
                <div className="text-rotulo text-mute">contratos con indicio, {solesCompacto(detE.monto_captura)}</div>
              </div>
              <BotonFicha onClick={() => router.push(`/entidad/${detE.ruc}`)} />
            </div>
          ) : detP ? (
            <div className="space-y-2">
              <div className="text-cuerpo font-semibold leading-tight text-ink">{tituloNatural(detP.partido)}</div>
              <div className="text-rotulo text-mute">gobierna {numero(detP.n_entidades)} entidades</div>
              <div className="rounded-lg border border-line bg-paper px-3 py-2">
                <div className="font-mono text-cuerpo font-semibold tabular-nums text-ink">{numero(detP.n_captura)}</div>
                <div className="text-rotulo text-mute">contratos con indicio, {solesCompacto(detP.monto_captura)}</div>
              </div>
              <BotonFicha onClick={() => router.push(`/app/poder/${clavePartido(detP.partido)}`)}>Ver el partido →</BotonFicha>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-cuerpo font-semibold text-ink">Quién controla qué</div>
                <div className="text-rotulo text-mute">{numero(N)} partidos, {numero(totInst)} instituciones</div>
              </div>
              <p className="text-meta leading-relaxed text-inkSoft">Pasá el cursor por un partido para ver sus instituciones; tocá para ir a su ficha.</p>
              <div className="space-y-1.5">
                <ChipLeyenda tono="granate" forma="punto">partido que gobierna</ChipLeyenda>
                <ChipLeyenda tono="crimson" forma="halo">una empresa le financió la campaña o es su socio</ChipLeyenda>
                <ChipLeyenda tono="amber" forma="punto">le vendió a la campaña</ChipLeyenda>
              </div>
            </div>
          )}
        </GrafoAside>
      </GrafoColumnas>

      <p className="text-rotulo leading-relaxed text-mute">
        Los {numero(N)} partidos con más indicios y sus instituciones más capturadas; la lista los tiene todos. Indicios
        de registros públicos (JNE, ONPE, RNP/SEACE) para revisión humana, no una acusación.
      </p>
    </GrafoSeccion>
  );
}
