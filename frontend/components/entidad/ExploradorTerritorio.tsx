"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import type { TerritorioNodo } from "@/lib/poder";

/**
 * Explorador territorial del Estado (migración 125): El Estado → regiones → provincias → distritos, EN LA MISMA PANTALLA.
 * Tocar un nodo abre sus dependencias (sin cambiar de página) y muestra su detalle al lado: su autoridad (el afiliado que
 * la gobierna), partido, captura y de quién depende. Filtro por región. Los municipios son autónomos pero territorialmente
 * anidados. En rojo los que tienen indicios de captura. Indicios de registros públicos para revisión, no una acusación.
 */
const fuerte = (n: TerritorioNodo) => (n.n_captura ?? 0) > 0;
function corto(s: string, n: number) {
  const t = tituloNatural(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
const nivelTxt = (n: string) => (n === "regional" ? "Gobierno regional" : n === "provincial" ? "Municipalidad provincial" : "Municipalidad distrital");

export function ExploradorTerritorio({ nodos }: { nodos: TerritorioNodo[] }) {
  const router = useRouter();
  const [dep, setDep] = useState<string | null>(null);
  const [prov, setProv] = useState<string | null>(null);
  const [sel, setSel] = useState<TerritorioNodo | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const regiones = useMemo(
    () => nodos.filter((n) => n.nivel === "regional").sort((a, b) => (b.n_captura ?? 0) - (a.n_captura ?? 0)),
    [nodos],
  );
  const provinciasDe = useMemo(
    () => (d: string) => nodos.filter((n) => n.nivel === "provincial" && n.departamento === d).sort((a, b) => (b.n_captura ?? 0) - (a.n_captura ?? 0)),
    [nodos],
  );
  const distritosDe = useMemo(
    () => (d: string, p: string) => nodos.filter((n) => n.nivel === "distrital" && n.departamento === d && n.provincia === p).sort((a, b) => (b.n_captura ?? 0) - (a.n_captura ?? 0)),
    [nodos],
  );
  const nHijos = (n: TerritorioNodo) =>
    n.nivel === "regional" ? new Set(nodos.filter((x) => x.nivel === "provincial" && x.departamento === n.departamento).map((x) => x.provincia)).size
      : n.nivel === "provincial" ? distritosDe(n.departamento, n.provincia ?? "").length
      : 0;

  const hijos = !dep ? regiones : !prov ? provinciasDe(dep) : distritosDe(dep, prov);
  const centro = !dep ? "El Estado" : !prov ? tituloNatural(dep) : tituloNatural(prov);
  const centroSub = !dep ? "del Perú" : !prov ? "departamento" : "provincia";

  const W = 1160;
  const H = 900;
  const cx = W / 2;
  const cy = H / 2;
  const R = 332;
  const maxCap = Math.max(...hijos.map((n) => n.n_captura ?? 0), 1);

  const nodosPos = hijos.map((n, i) => {
    const a = ((-90 + (i + 0.5) * (360 / Math.max(hijos.length, 1))) * Math.PI) / 180;
    return { n, a, cos: Math.cos(a), x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), r: 8 + 12 * Math.sqrt((n.n_captura ?? 0) / maxCap) };
  });

  const labelDe = (n: TerritorioNodo) =>
    n.nivel === "regional" ? tituloNatural(n.departamento) : n.nivel === "provincial" ? tituloNatural(n.provincia ?? "") : tituloNatural(n.distrito ?? n.nombre);

  function abrir(n: TerritorioNodo) {
    setSel(n);
    if (n.nivel === "regional") { setDep(n.departamento); setProv(null); }
    else if (n.nivel === "provincial") { setProv(n.provincia ?? null); }
    // distrital: hoja → solo detalle
  }

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      {/* Migas + filtro */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1 text-meta">
          <button type="button" onClick={() => { setDep(null); setProv(null); setSel(null); }} className={`font-semibold ${dep ? "text-granate hover:underline" : "text-ink"}`}>El Estado</button>
          {dep && <span className="text-mute">›</span>}
          {dep && <button type="button" onClick={() => { setProv(null); setSel(null); }} className={`font-semibold ${prov ? "text-granate hover:underline" : "text-ink"}`}>{tituloNatural(dep)}</button>}
          {prov && <span className="text-mute">›</span>}
          {prov && <span className="font-semibold text-ink">{tituloNatural(prov)}</span>}
        </nav>
        <select
          value={dep ?? ""}
          onChange={(e) => { setDep(e.target.value || null); setProv(null); setSel(null); }}
          className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-meta text-ink"
          aria-label="Ir a una región"
        >
          <option value="">Todas las regiones</option>
          {regiones.map((r) => <option key={r.departamento} value={r.departamento}>{tituloNatural(r.departamento)}</option>)}
        </select>
      </div>
      <p className="text-meta leading-relaxed text-inkSoft">
        {!dep ? "El Estado al centro y las 25 regiones. Tocá una región para ver sus provincias, y una provincia para sus distritos — sin salir de la pantalla."
          : !prov ? "Las provincias de la región. Tocá una para ver sus distritos; el panel muestra quién la gobierna."
          : "Los distritos de la provincia. Tocá uno para ver su detalle y abrir su ficha completa."}
      </p>

      <div className="relative overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[800px] touch-manipulation select-none" role="img"
             aria-label={`Explorador territorial: ${centro}, ${numero(hijos.length)} ${!dep ? "regiones" : !prov ? "provincias" : "distritos"}`}>
          {nodosPos.map((p) => (
            <line key={`l${p.n.ruc}`} x1={cx} y1={cy} x2={p.x} y2={p.y}
              className={fuerte(p.n) ? "stroke-crimson" : "stroke-granate"} strokeWidth={1.3}
              strokeOpacity={hover && hover !== p.n.ruc ? 0.1 : 0.45} strokeLinecap="round" />
          ))}
          {nodosPos.map((p) => {
            const anchor = p.cos > 0.25 ? "start" : p.cos < -0.25 ? "end" : "middle";
            const lx = p.x + (p.r + 7) * Math.cos(p.a) + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0);
            const ly = p.y + (p.r + 7) * Math.sin(p.a) + (anchor === "middle" ? (Math.sin(p.a) > 0 ? 11 : -5) : 4);
            const expandible = p.n.nivel !== "distrital";
            return (
              <g key={p.n.ruc} className="cursor-pointer" opacity={hover && hover !== p.n.ruc ? 0.4 : 1}
                 onMouseEnter={() => setHover(p.n.ruc)} onMouseLeave={() => setHover(null)}
                 onClick={() => abrir(p.n)} role="button" tabIndex={0}
                 onKeyDown={(ev) => { if (ev.key === "Enter") abrir(p.n); }}
                 aria-label={`${labelDe(p.n)}${expandible ? `, ${nHijos(p.n)} ${p.n.nivel === "regional" ? "provincias" : "distritos"}` : ""}`}>
                <circle cx={p.x} cy={p.y} r={p.r} className={`${fuerte(p.n) ? "fill-crimson/30 stroke-crimson" : "fill-granate/25 stroke-granate"} stroke-[1.5]`} />
                {expandible && <circle cx={p.x} cy={p.y} r={p.r + 3} className="fill-none stroke-ink/30 stroke-[1]" />}
                <text x={lx} y={ly} textAnchor={anchor} className="pointer-events-none fill-inkSoft text-[10.5px] font-medium">{corto(labelDe(p.n), 20)}</text>
              </g>
            );
          })}
          {/* centro */}
          <circle cx={cx} cy={cy} r={38} className="fill-paperSoft stroke-ink stroke-[2.5]" />
          <text x={cx} y={cy - 2} textAnchor="middle" className="fill-ink text-[12px] font-semibold">{corto(centro, 16)}</text>
          <text x={cx} y={cy + 13} textAnchor="middle" className="fill-mute text-[9px]">{centroSub}</text>
        </svg>

        {/* panel de detalle (en la misma pantalla) */}
        {sel && (
          <div className="absolute right-2 top-2 max-w-[280px] space-y-1.5 rounded-xl border border-line bg-paper/95 p-3 shadow-sm backdrop-blur">
            <div className="text-meta font-semibold text-ink">{corto(sel.nombre, 48)}</div>
            <div className="text-rotulo text-mute">{nivelTxt(sel.nivel)}</div>
            {sel.autoridad ? <div className="text-rotulo text-inkSoft">la gobierna <b className="text-ink">{tituloNatural(sel.autoridad)}</b></div> : null}
            {sel.partido ? <div className="text-rotulo text-inkSoft">del partido <b className="text-ink">{tituloNatural(sel.partido)}</b></div> : null}
            <div className="font-mono text-rotulo text-inkSoft">
              {(sel.n_captura ?? 0) > 0 ? <span className="text-crimson">{numero(sel.n_captura)} contratos con indicio, {solesCompacto(sel.monto_captura)}</span> : "sin indicios de captura"}
            </div>
            <div className="text-rotulo text-mute">
              depende de: {sel.nivel === "distrital" ? `${tituloNatural(sel.provincia ?? "")}, ${tituloNatural(sel.departamento)}` : sel.nivel === "provincial" ? tituloNatural(sel.departamento) : "Gobierno del Perú"}
            </div>
            {sel.nivel !== "distrital" && <div className="text-rotulo text-mute">contiene {numero(nHijos(sel))} {sel.nivel === "regional" ? "provincias" : "distritos"}</div>}
            <button type="button" onClick={() => router.push(`/entidad/${sel.ruc}`)} className="mt-1 w-full rounded-lg bg-granate px-3 py-1.5 text-meta font-semibold text-sobreMaiz hover:opacity-90">
              Ver ficha completa →
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-rotulo text-mute">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson/70" aria-hidden /> con indicios de captura</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-granate/70" aria-hidden /> sin ese indicio</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full border border-ink/40" aria-hidden /> anillo = se puede expandir</span>
      </div>
      <p className="text-rotulo leading-relaxed text-mute">
        Jerarquía territorial (departamento → provincia → distrito). Los municipios son autónomos, pero están anidados en su
        territorio. Fuentes: JNE/ONPE/RNP. Indicios para revisión humana, no una acusación.
      </p>
    </section>
  );
}
