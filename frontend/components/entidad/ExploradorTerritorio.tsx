"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { tituloNatural } from "@/lib/landing";
import { numero, solesCompacto } from "@/lib/formato";
import { baseApiNavegador } from "@/lib/api-client";
import type { TerritorioNodo } from "@/lib/poder";
import type { Cadena } from "@/lib/cadena";

/**
 * Explorador territorial del Estado (migración 125): El Estado → regiones → provincias → distritos, EN LA MISMA PANTALLA.
 * Tocar un nodo abre sus dependencias (sin cambiar de página) y lo muestra en el panel lateral: su autoridad (el afiliado
 * que la gobierna), partido, captura y de quién depende. Filtro por región, migas para subir. Los municipios son autónomos
 * pero territorialmente anidados. En rojo los que tienen indicios de captura. Indicios de registros públicos, no acusación.
 */
const fuerte = (n: TerritorioNodo) => (n.n_captura ?? 0) > 0;
const fuerteLazo = (ls: string[]) => ls.includes("partido_gobernante") || ls.includes("socio_en_entidad");
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
  const [cadena, setCadena] = useState<Cadena | null>(null);
  const [cargandoCadena, setCargandoCadena] = useState(false);

  // Al seleccionar una entidad, traé su cadena de captura (Capa C) para mostrarla compacta en el panel.
  useEffect(() => {
    if (!sel) { setCadena(null); return; }
    let vivo = true;
    setCadena(null);
    setCargandoCadena(true);
    fetch(`${baseApiNavegador()}/cadena/entidad/${sel.ruc}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Cadena | null) => { if (vivo) setCadena(d); })
      .catch(() => { if (vivo) setCadena(null); })
      .finally(() => { if (vivo) setCargandoCadena(false); });
    return () => { vivo = false; };
  }, [sel]);

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
  const nivelHijos = !dep ? "regiones" : !prov ? "provincias" : "distritos";
  const conIndicio = hijos.filter(fuerte).length;

  const W = 880;
  const H = 760;
  const cx = W / 2;
  const cy = H / 2;
  const R = 266;
  const maxCap = Math.max(...hijos.map((n) => n.n_captura ?? 0), 1);

  const nodosPos = hijos.map((n, i) => {
    const a = ((-90 + (i + 0.5) * (360 / Math.max(hijos.length, 1))) * Math.PI) / 180;
    return { n, a, cos: Math.cos(a), x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), r: 9 + 12 * Math.sqrt((n.n_captura ?? 0) / maxCap) };
  });

  const labelDe = (n: TerritorioNodo) =>
    n.nivel === "regional" ? tituloNatural(n.departamento) : n.nivel === "provincial" ? tituloNatural(n.provincia ?? "") : tituloNatural(n.distrito ?? n.nombre);

  function abrir(n: TerritorioNodo) {
    setSel(n);
    if (n.nivel === "regional") { setDep(n.departamento); setProv(null); }
    else if (n.nivel === "provincial") { setProv(n.provincia ?? null); }
  }

  const Leyenda = () => (
    <div className="space-y-1.5 text-rotulo text-mute">
      <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson/70" aria-hidden /> con indicios de captura</span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-granate/70" aria-hidden /> sin ese indicio</span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full border border-ink/40" aria-hidden /> anillo = se puede abrir</span>
    </div>
  );

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      {/* barra: migas + filtro */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1.5 text-meta">
          <button type="button" onClick={() => { setDep(null); setProv(null); setSel(null); }} className={`font-semibold ${dep ? "text-granate hover:underline underline-offset-2" : "text-ink"}`}>El Estado</button>
          {dep && <span className="text-mute" aria-hidden>›</span>}
          {dep && <button type="button" onClick={() => { setProv(null); setSel(null); }} className={`font-semibold ${prov ? "text-granate hover:underline underline-offset-2" : "text-ink"}`}>{tituloNatural(dep)}</button>}
          {prov && <span className="text-mute" aria-hidden>›</span>}
          {prov && <span className="font-semibold text-ink">{tituloNatural(prov)}</span>}
        </nav>
        <select
          value={dep ?? ""}
          onChange={(e) => { setDep(e.target.value || null); setProv(null); setSel(null); }}
          className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-meta text-ink shadow-sm focus:border-granate focus:outline-none"
          aria-label="Ir a una región"
        >
          <option value="">Todas las regiones</option>
          {regiones.map((r) => <option key={r.departamento} value={r.departamento}>{tituloNatural(r.departamento)}</option>)}
        </select>
      </div>

      {/* dos columnas: grafo + panel lateral */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="overflow-x-auto rounded-xl border border-line bg-fondo/40">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px] touch-manipulation select-none" role="img"
               aria-label={`Explorador territorial: ${centro}, ${numero(hijos.length)} ${nivelHijos}`}>
            {nodosPos.map((p) => (
              <line key={`l${p.n.ruc}`} x1={cx} y1={cy} x2={p.x} y2={p.y}
                className={fuerte(p.n) ? "stroke-crimson" : "stroke-granate"} strokeWidth={sel?.ruc === p.n.ruc ? 2 : 1.3}
                strokeOpacity={hover && hover !== p.n.ruc ? 0.1 : 0.4} strokeLinecap="round" />
            ))}
            {nodosPos.map((p) => {
              const anchor = p.cos > 0.25 ? "start" : p.cos < -0.25 ? "end" : "middle";
              const lx = p.x + (p.r + 8) * Math.cos(p.a) + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0);
              const ly = p.y + (p.r + 8) * Math.sin(p.a) + (anchor === "middle" ? (Math.sin(p.a) > 0 ? 12 : -6) : 4);
              const expandible = p.n.nivel !== "distrital";
              const esHover = hover === p.n.ruc;
              const esSel = sel?.ruc === p.n.ruc;
              const r = p.r + (esHover ? 3 : 0);
              return (
                <g key={p.n.ruc} className="cursor-pointer transition-opacity duration-rapido" opacity={hover && !esHover ? 0.45 : 1}
                   onMouseEnter={() => setHover(p.n.ruc)} onMouseLeave={() => setHover(null)}
                   onClick={() => abrir(p.n)} role="button" tabIndex={0}
                   onKeyDown={(ev) => { if (ev.key === "Enter") abrir(p.n); }}
                   aria-label={`${labelDe(p.n)}${expandible ? `, ${nHijos(p.n)} ${p.n.nivel === "regional" ? "provincias" : "distritos"}` : ""}`}>
                  {esSel && <circle cx={p.x} cy={p.y} r={r + 5} className="fill-none stroke-ink stroke-[1.5]" />}
                  <circle cx={p.x} cy={p.y} r={r} className={`${fuerte(p.n) ? "fill-crimson/30 stroke-crimson" : "fill-granate/25 stroke-granate"}`} strokeWidth={esHover || esSel ? 2.5 : 1.5} fillOpacity={esHover ? 0.5 : undefined} />
                  {expandible && <circle cx={p.x} cy={p.y} r={r + 3.5} className="fill-none stroke-ink/30 stroke-[1]" />}
                  <text x={lx} y={ly} textAnchor={anchor} className={`pointer-events-none text-[11px] ${esHover || esSel ? "fill-ink font-semibold" : "fill-inkSoft font-medium"}`}>{corto(labelDe(p.n), 18)}</text>
                </g>
              );
            })}
            {/* centro */}
            <circle cx={cx} cy={cy} r={40} className="fill-paperSoft stroke-ink stroke-[2.5]" />
            <text x={cx} y={cy - 3} textAnchor="middle" className="fill-ink text-[13px] font-semibold">{corto(centro, 16)}</text>
            <text x={cx} y={cy + 12} textAnchor="middle" className="fill-mute text-[9px]">{centroSub}</text>
          </svg>
        </div>

        {/* panel lateral persistente */}
        <aside className="rounded-xl border border-line bg-paperSoft/50 p-4">
          {sel ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-cuerpo font-semibold leading-tight text-ink">{tituloNatural(sel.nombre)}</div>
                  <div className="text-rotulo text-mute">{nivelTxt(sel.nivel)}</div>
                </div>
                <button type="button" onClick={() => setSel(null)} className="text-mute hover:text-ink" aria-label="Cerrar detalle">✕</button>
              </div>
              {sel.autoridad ? <p className="text-meta text-inkSoft">La gobierna <b className="text-ink">{tituloNatural(sel.autoridad)}</b>{sel.partido ? <> del partido <b className="text-ink">{tituloNatural(sel.partido)}</b></> : null}.</p> : null}
              <div className="rounded-lg border border-line bg-paper px-3 py-2">
                {(sel.n_captura ?? 0) > 0 ? (
                  <>
                    <div className="font-mono text-cuerpo font-semibold tabular-nums text-crimson">{numero(sel.n_captura)}</div>
                    <div className="text-rotulo text-mute">contratos con indicio, {solesCompacto(sel.monto_captura)}</div>
                  </>
                ) : <div className="text-meta text-mute">Sin indicios de captura.</div>}
              </div>
              <div className="text-rotulo text-mute">Depende de: {sel.nivel === "distrital" ? `${tituloNatural(sel.provincia ?? "")}, ${tituloNatural(sel.departamento)}` : sel.nivel === "provincial" ? tituloNatural(sel.departamento) : "Gobierno del Perú"}</div>
              {sel.nivel !== "distrital" && <div className="text-rotulo text-mute">Contiene {numero(nHijos(sel))} {sel.nivel === "regional" ? "provincias" : "distritos"} — tocá el nodo para abrirlo.</div>}

              {/* Capa C: la cadena de captura, compacta */}
              {cargandoCadena && <div className="border-t border-line pt-2 text-rotulo text-mute">cargando la cadena…</div>}
              {cadena?.disponible && cadena.empresas && cadena.empresas.length > 0 && (
                <div className="space-y-1.5 border-t border-line pt-2">
                  <div className="text-rotulo font-semibold uppercase tracking-wide text-mute">La cadena de captura</div>
                  <p className="text-rotulo leading-relaxed text-inkSoft">
                    <b className="text-ink">{numero(cadena.empresas.length)}</b> {cadena.empresas.length === 1 ? "empresa ligada" : "empresas ligadas"} al partido ganan sus contratos; los aprueba{" "}
                    <b className="text-ink">{cadena.decision?.apruebaContratos ?? "la entidad"}</b>.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {cadena.empresas.slice(0, 6).map((emp) => (
                      <button
                        key={emp.ruc}
                        type="button"
                        onClick={() => router.push(`/empresa/${emp.ruc}`)}
                        className={`rounded-full px-2 py-0.5 text-rotulo transition-opacity hover:opacity-80 ${fuerteLazo(emp.lazos) ? "bg-crimson/10 text-crimson" : "bg-amber/10 text-amber"}`}
                      >
                        {corto(emp.nombre ?? emp.ruc, 18)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button type="button" onClick={() => router.push(`/entidad/${sel.ruc}`)} className="mt-1 w-full rounded-lg bg-granate px-3 py-2 text-meta font-semibold text-sobreMaiz transition-opacity duration-rapido hover:opacity-90">
                Ver ficha completa →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-cuerpo font-semibold text-ink">{centro}</div>
                <div className="text-rotulo text-mute">{numero(hijos.length)} {nivelHijos}{conIndicio > 0 ? `, ${numero(conIndicio)} con indicios` : ""}</div>
              </div>
              <p className="text-meta leading-relaxed text-inkSoft">
                Tocá un nodo para ver quién lo gobierna y abrir sus dependencias, sin salir de la pantalla.
              </p>
              <Leyenda />
            </div>
          )}
        </aside>
      </div>

      <p className="text-rotulo leading-relaxed text-mute">
        Jerarquía territorial (departamento → provincia → distrito). Los municipios son autónomos, pero están anidados en su
        territorio. Fuentes: JNE/ONPE/RNP. Indicios para revisión humana, no una acusación.
      </p>
    </section>
  );
}
