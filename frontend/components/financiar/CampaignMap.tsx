"use client";

/**
 * Mapa de campaña de "Financia una auditoría".
 *
 * Mismo enfoque que PeruChoropleth (d3-geo sobre <svg>, sin tiles) pero coloreado
 * por ESTADO de financiamiento, no por severidad. Drill-down: clic en un
 * departamento → zoom + provincias de ese departamento (geometría de
 * peru-provinces.json, code = ubigeo de 4 dígitos). Los distritos no tienen
 * geometría todavía: se listan en el panel de la zona.
 *
 * `zonas` viene de /financiamiento/zonas (departamentos) y, al hacer drill-down,
 * de /financiamiento/zonas?nivel=provincia&padre=XX.
 */

import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { ESTADO_FILL, ESTADO_LABEL, type Zona, type ZonaEstado, pct } from "@/lib/financiamiento";

export const VB_W = 480;
export const VB_H = 640;
const API = process.env.NEXT_PUBLIC_VIGIA_API_URL ?? "https://vigia-peru-api-36169102688.us-central1.run.app";

type DeptFC = FeatureCollection<Geometry, { name: string; id: string; code?: string }>;
type ProvFC = FeatureCollection<Geometry, { name: string; departamento: string; regionId: string; id: string; code?: string }>;

interface Props {
  zonas: Zona[];                 // departamentos (nivel 1) con estado
  compact?: boolean;             // versión landing: sin panel, solo mapa + leyenda
  initialUbigeo?: string | null; // abrir ya en un departamento
  linkToHub?: boolean;           // compact: clic en un departamento → /app/mapa?region=… (el único mapa interactivo)
  onRegionClick?: (code: string, centroid: [number, number]) => void; // compact: si se pasa, el clic llama esto en vez de navegar — incluye el centroide del departamento (espacio VB_W×VB_H) para posicionar UI cerca del punto real del clic
  landingVariant?: boolean;      // sistema de sombra/radio de la landing (shadow-card/paper) para el chrome del mapa; false en /app/financiar, que mantiene su tratamiento nativo
}

export function CampaignMap({ zonas, compact = false, initialUbigeo = null, linkToHub = false, onRegionClick, landingVariant = false }: Props) {
  const router = useRouter();
  const [depts, setDepts] = useState<DeptFC | null>(null);
  const [provs, setProvs] = useState<ProvFC | null>(null);
  const [selected, setSelected] = useState<string | null>(initialUbigeo);   // ubigeo de departamento (2 dígitos)
  const [hover, setHover] = useState<string | null>(null);
  const [provZonas, setProvZonas] = useState<Record<string, Zona[]>>({});

  useEffect(() => {
    let alive = true;
    fetch("/peru-departments.json").then((r) => r.json()).then((d) => alive && setDepts(d)).catch(() => {});
    if (!compact) fetch("/peru-provinces.json").then((r) => r.json()).then((d) => alive && setProvs(d)).catch(() => {});
    return () => { alive = false; };
  }, [compact]);

  // Provincias del departamento seleccionado (lazy, cacheado en memoria).
  useEffect(() => {
    if (!selected || provZonas[selected]) return;
    fetch(`${API}/financiamiento/zonas?nivel=provincia&padre=${selected}`)
      .then((r) => r.json())
      .then((j) => setProvZonas((m) => ({ ...m, [selected]: j.data ?? [] })))
      .catch(() => setProvZonas((m) => ({ ...m, [selected]: [] })));
  }, [selected, provZonas]);

  const byUbigeo = useMemo(() => {
    const m = new Map<string, Zona>();
    for (const z of zonas) m.set(z.ubigeo, z);
    for (const list of Object.values(provZonas)) for (const z of list) m.set(z.ubigeo, z);
    return m;
  }, [zonas, provZonas]);

  const projection = useMemo(
    () => (depts ? geoMercator().fitExtent([[16, 16], [VB_W - 16, VB_H - 16]], depts as any) : null),
    [depts],
  );
  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  const deptPaths = useMemo(() => {
    if (!depts || !path) return [];
    return depts.features.map((f) => ({
      code: f.properties.code ?? "",
      name: f.properties.name,
      d: path(f as any) || "",
      bounds: path.bounds(f as any),
      centroid: path.centroid(f as any),
    }));
  }, [depts, path]);

  const provPaths = useMemo(() => {
    if (!provs || !path || !selected) return [];
    return provs.features
      .filter((f) => (f.properties.code ?? "").startsWith(selected))
      .map((f) => ({ code: f.properties.code ?? "", name: f.properties.name, d: path(f as any) || "", centroid: path.centroid(f as any) }));
  }, [provs, path, selected]);

  const transform = useMemo(() => {
    if (!selected) return "translate(0,0) scale(1)";
    const sel = deptPaths.find((p) => p.code === selected);
    if (!sel) return "translate(0,0) scale(1)";
    const [[x0, y0], [x1, y1]] = sel.bounds;
    const w = x1 - x0 || 1, h = y1 - y0 || 1;
    const s = Math.min((VB_W * 0.8) / w, (VB_H * 0.8) / h, 6);
    const tx = VB_W / 2 - ((x0 + x1) / 2) * s;
    const ty = VB_H / 2 - ((y0 + y1) / 2) * s;
    return `translate(${tx.toFixed(1)},${ty.toFixed(1)}) scale(${s.toFixed(3)})`;
  }, [selected, deptPaths]);

  const hovered = hover ? byUbigeo.get(hover) : null;
  const selectedZona = selected ? byUbigeo.get(selected) : null;

  // Mientras ninguna zona tenga financiamiento, el mapa pinta por INTENSIDAD de cola
  // (cuántos contratos esperan) en vez de un gris uniforme; en cuanto hay aportes,
  // vuelve a los colores por estado.
  const maxCola = useMemo(() => Math.max(1, ...zonas.map((z) => z.totalCola)), [zonas]);
  const sinFinanciamiento = useMemo(() => zonas.every((z) => z.financiados === 0), [zonas]);
  const fillFor = (code: string) => {
    const z = byUbigeo.get(code);
    if (!z || z.totalCola === 0) return ESTADO_FILL.sin_datos;
    if (sinFinanciamiento && z.estado === "pendiente") {
      const t = Math.sqrt(z.totalCola / maxCola);           // raíz: Lima no aplasta al resto
      const l = 92 - t * 52;                                 // 92% (casi blanco) → 40% (clay oscuro)
      return `hsl(28 55% ${l.toFixed(0)}%)`;
    }
    return ESTADO_FILL[z.estado as ZonaEstado];
  };

  return (
    <div className={compact ? "relative" : "grid gap-6 lg:grid-cols-[1fr_360px]"}>
      <div className="relative">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full select-none" role="img" aria-label="Mapa del Perú por estado de financiamiento de auditoría">
          <defs>
            <pattern id="hatch-pendiente" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#C3C9D1" strokeWidth="1.5" />
            </pattern>
          </defs>
          <g style={{ transform, transformOrigin: "0 0", transition: "transform 600ms cubic-bezier(.2,.8,.2,1)" }}>
            {deptPaths.map((p) => {
              const z = byUbigeo.get(p.code);
              const isSel = selected === p.code;
              const dim = selected && !isSel;
              const interactivo = !(compact && !linkToHub && !onRegionClick);
              const activar = () => {
                if (compact) {
                  if (onRegionClick) { onRegionClick(p.code, p.centroid); return; }
                  if (linkToHub) router.push(`/app/mapa?region=${UBIGEO_REGION[p.code] ?? ""}`);
                  return;
                }
                setSelected(isSel ? null : p.code);
              };
              return (
                <g key={p.code}>
                  <path
                    d={p.d}
                    fill={z?.estado === "pendiente" && !sinFinanciamiento ? "url(#hatch-pendiente)" : fillFor(p.code)}
                    stroke="#FFFFFF"
                    strokeWidth={isSel ? 0.6 : 0.9}
                    opacity={dim ? 0.25 : 1}
                    className={interactivo ? "cursor-pointer transition-opacity" : ""}
                    tabIndex={interactivo ? 0 : undefined}
                    role={interactivo ? "button" : undefined}
                    aria-label={interactivo ? p.name : undefined}
                    onMouseEnter={() => setHover(p.code)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(p.code)}
                    onBlur={() => setHover(null)}
                    onClick={activar}
                    onKeyDown={(e) => {
                      if (interactivo && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); activar(); }
                    }}
                  />
                  {z?.estado === "pendiente" && !sinFinanciamiento && !dim && (
                    <path d={p.d} fill="#D9DEE4" opacity={0.55} pointerEvents="none" />
                  )}
                </g>
              );
            })}
            {/* Provincias del departamento seleccionado */}
            {selected && provPaths.map((p) => {
              const z = byUbigeo.get(p.code);
              return (
                <path
                  key={p.code}
                  d={p.d}
                  fill={fillFor(p.code)}
                  stroke="#14171A"
                  strokeWidth={0.25}
                  className="cursor-pointer"
                  opacity={z?.estado === "sin_datos" ? 0.6 : 1}
                  onMouseEnter={() => setHover(p.code)}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
            {/* Anillos de progreso en zonas parciales/financiadas (solo sin drill-down) */}
            {!selected && deptPaths.map((p) => {
              const z = byUbigeo.get(p.code);
              if (!z || z.totalCola === 0 || z.estado === "pendiente") return null;
              const r = 7, c = 2 * Math.PI * r;
              const f = pct(z.financiados, z.totalCola) / 100;
              return (
                <g key={`ring-${p.code}`} transform={`translate(${p.centroid[0].toFixed(1)},${p.centroid[1].toFixed(1)})`} pointerEvents="none">
                  <circle r={r + 2.5} fill="#FFFFFF" opacity={0.9} />
                  <circle r={r} fill="none" stroke="#E4E7EB" strokeWidth={2.2} />
                  <circle r={r} fill="none" stroke="#B26A2E" strokeWidth={2.2} strokeDasharray={`${(c * f).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90)" strokeLinecap="round" />
                </g>
              );
            })}
          </g>
        </svg>

        {/* Tooltip */}
        {hovered && (
          <div className={cn("pointer-events-none absolute left-3 top-3 max-w-[260px] border border-line bg-paper/95 p-3 text-xs backdrop-blur", landingVariant ? "rounded-2xl shadow-paper" : "rounded-xl shadow-lg")}>
            <div className="font-semibold text-ink">{hovered.nombre} <span className="font-normal text-mute">· {hovered.nivel}</span></div>
            <div className="mt-0.5 text-mute">{ESTADO_LABEL[hovered.estado]}</div>
            {hovered.totalCola > 0 ? (
              <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
                <Stat label="cola" v={hovered.totalCola} />
                <Stat label="financ" v={hovered.financiados} />
                <Stat label="proces" v={hovered.procesados} />
              </div>
            ) : (
              <div className="mt-1 text-[11px] text-mute">Todavía no ingresamos contratos de esta zona.</div>
            )}
          </div>
        )}

        {/* Leyenda */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-mute">
          {sinFinanciamiento && (
            <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1", landingVariant ? "shadow-card" : "shadow-sm")}>
              <span className="inline-block h-2.5 w-10 rounded-full" style={{ background: "linear-gradient(90deg, hsl(28 55% 92%), hsl(28 55% 40%))" }} />
              menos → más contratos en cola
            </span>
          )}
          {(sinFinanciamiento ? (["parcial", "financiada", "procesada"] as ZonaEstado[]) : (["pendiente", "parcial", "financiada", "procesada", "sin_datos"] as ZonaEstado[])).map((e) => (
            <span key={e} className={cn("inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1", landingVariant ? "shadow-card" : "shadow-sm")}>
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: ESTADO_FILL[e] }} />
              {ESTADO_LABEL[e]}
            </span>
          ))}
        </div>
        {selected && !compact && (
          <button onClick={() => setSelected(null)} className="absolute right-3 top-3 rounded-full border border-line bg-paper px-3 py-1 text-xs font-medium text-ink shadow hover:bg-paperDeep">
            ← Todo el Perú
          </button>
        )}
      </div>

      {!compact && (
        <aside className="rounded-2xl border border-line bg-paper p-5">
          {selectedZona ? (
            <ZonaPanel zona={selectedZona} provincias={provZonas[selected!] ?? []} />
          ) : (
            <div>
              <h3 className="font-serif text-lg font-bold text-ink">Elige una región</h3>
              <p className="mt-1 text-sm text-mute">
                Cada región tiene una cola de contratos públicos que Vigía aún no leyó. Financiar su auditoría
                cuesta {zonas[0]?.precioPen ? `S/ ${zonas[0].precioPen}` : "S/ 3"} por contrato.
              </p>
              <ul className="mt-4 space-y-2">
                {[...zonas].filter((z) => z.totalCola > 0).sort((a, b) => b.totalCola - a.totalCola).slice(0, 8).map((z) => (
                  <li key={z.ubigeo}>
                    <button onClick={() => setSelected(z.ubigeo)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-paperDeep">
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: ESTADO_FILL[z.estado] }} />
                        {z.nombre}
                      </span>
                      <span className="font-mono text-xs text-mute">{z.financiados}/{z.totalCola}</span>
                    </button>
                  </li>
                ))}
                {zonas.every((z) => z.totalCola === 0) && (
                  <li className="text-sm text-mute">Aún no hay contratos en cola. La ingesta diaria está arrancando.</li>
                )}
              </ul>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="text-ink">{v.toLocaleString("es-PE")}</div>
      <div className="text-[10px] uppercase tracking-wide text-mute">{label}</div>
    </div>
  );
}

function ZonaPanel({ zona, provincias }: { zona: Zona; provincias: Zona[] }) {
  const p = pct(zona.financiados, zona.totalCola);
  const q = pct(zona.procesados, zona.totalCola);
  const restantes = Math.max(0, zona.totalCola - zona.financiados);
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-mute">{zona.nivel}</div>
      <h3 className="font-serif text-2xl font-bold text-ink">{zona.nombre}</h3>
      <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-mute">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: ESTADO_FILL[zona.estado] }} />
        {ESTADO_LABEL[zona.estado]}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Row k="Cola de auditoría" v={`${zona.totalCola.toLocaleString("es-PE")} contratos`} />
        <Row k="Costo de auditarla" v={`S/ ${(zona.totalCola * zona.precioPen).toLocaleString("es-PE")}`} />
        <Row k="Financiado" v={`${zona.financiados} / ${zona.totalCola}`} />
        <Row k="Procesado" v={`${zona.procesados} / ${zona.totalCola}`} />
        <Row k="Señales halladas" v={zona.senales.toLocaleString("es-PE")} />
        <Row k="Aliados" v={zona.contribuciones.toLocaleString("es-PE")} />
      </dl>

      <div className="mt-4">
        <div className="flex justify-between text-[11px] text-mute"><span>financiado {p}%</span><span>procesado {q}%</span></div>
        <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-paperDeep">
          <div className="absolute inset-y-0 left-0 rounded-full bg-amber" style={{ width: `${p}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-moss" style={{ width: `${q}%` }} />
        </div>
      </div>

      {provincias.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-mute">Provincias con contratos en cola</div>
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto pr-1 text-sm">
            {provincias.filter((z) => z.totalCola > 0).map((z) => (
              <li key={z.ubigeo} className="flex items-center justify-between">
                <Link href={`/app/financiar/${z.ubigeo}`} className="flex items-center gap-2 hover:underline">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: ESTADO_FILL[z.estado] }} />{z.nombre}
                </Link>
                <span className="font-mono text-xs text-mute">{z.financiados}/{z.totalCola}</span>
              </li>
            ))}
            {provincias.every((z) => z.totalCola === 0) && <li className="text-mute">Sin contratos en cola aún.</li>}
          </ul>
        </div>
      )}

      <Link
        href={`/app/financiar/${zona.ubigeo}`}
        className="mt-5 flex w-full items-center justify-center rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-paper transition-transform hover:scale-[1.01]"
      >
        {restantes > 0 ? `Financiar auditoría · quedan ${restantes.toLocaleString("es-PE")} contratos` : "Ver auditoría de la zona"}
      </Link>
      <p className="mt-2 text-center text-[11px] text-mute">Financiás capacidad de análisis. Los resultados no dependen de quién aporta.</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-mute">{k}</dt>
      <dd className="font-mono text-ink">{v}</dd>
    </div>
  );
}
