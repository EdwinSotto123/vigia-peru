"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Coins,
  GitMerge,
  ChevronUp,
  ChevronDown,
  MessageSquareWarning,
  MapPin as MapPinIcon,
} from "lucide-react";
import { REGIONES, type MetricaId, metricLabel } from "@/lib/peru-data";
import { formatSoles, ALERTAS_MOCK } from "@/lib/mock-data";
import { getReportes, getAlertas } from "@/lib/api-client";
import { coordsForRegionWithJitter } from "@/lib/region-coords";
import { AgentsRibbon } from "./AgentsRibbon";
import { RegionDetailPanel } from "./RegionDetailPanel";
import { Marquee } from "./magicui/Marquee";
import { cn } from "@/lib/utils";
import type { MapPoint } from "./PeruChoropleth";

const PeruChoropleth = dynamic(
  () => import("./PeruChoropleth").then((m) => m.PeruChoropleth),
  { ssr: false, loading: () => <MapSkeleton /> },
);

const METRICS: { id: MetricaId; label: string; icon: React.ReactNode }[] = [
  { id: "alertas", label: "Alertas", icon: <AlertTriangle size={14} /> },
  { id: "convergentes", label: "Convergentes", icon: <GitMerge size={14} /> },
  { id: "monto", label: "Monto S/.", icon: <Coins size={14} /> },
  { id: "score", label: "Score", icon: <Activity size={14} /> },
];

export function MapaWrapper() {
  const [metric, setMetric] = useState<MetricaId>("alertas");
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [provinciaActiva, setProvinciaActiva] = useState<any | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Toggle de capas de pines
  const [showAlertas, setShowAlertas] = useState(true);
  const [showDenuncias, setShowDenuncias] = useState(true);
  const [reportes, setReportes] = useState<any[]>([]);
  const [alertasApi, setAlertasApi] = useState<any[]>([]);

  // Fetch alertas REALES + denuncias en paralelo
  useEffect(() => {
    let alive = true;
    getReportes({ limit: 200 })
      .then((data) => { if (alive) setReportes(data as any[]); })
      .catch(() => {});
    getAlertas({ limit: 200 })
      .then((data) => { if (alive) setAlertasApi(data as any[]); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Construir lista de pines unificada.
  // Alertas: priorizamos API real con coords derivadas de la región contratante;
  // fallback al mock si la API no responde. Para alertas sin lat/lon, derivamos
  // del centroide de la región con jitter determinista (evita apilamientos).
  const points = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    if (showAlertas) {
      const alertasFuente = alertasApi.length > 0 ? alertasApi : ALERTAS_MOCK;
      for (const a of alertasFuente) {
        let lat: number | null = typeof a.lat === "number" ? a.lat : null;
        let lon: number | null = typeof a.lon === "number" ? a.lon : null;
        // Si no hay lat/lon explícito → derivar del centroide de la región
        if (lat == null || lon == null) {
          const derived = coordsForRegionWithJitter(a.region, a.id || a.codigo || "");
          if (derived) { lat = derived.lat; lon = derived.lon; }
        }
        if (lat == null || lon == null) continue;
        out.push({
          id: `a-${a.id || a.codigo}`, kind: "alerta",
          lat, lon,
          score: a.score, label: a.objeto?.slice(0, 80),
          href: `/app/convocatoria/${a.codigoconvocatoria || a.codigo?.replace("OECE-", "") || a.id}`,
        });
      }
    }
    if (showDenuncias) {
      for (const r of reportes) {
        let lat: number | null = typeof r.lat === "number" ? r.lat : null;
        let lon: number | null = typeof r.lon === "number" ? r.lon : null;
        if (lat == null || lon == null) {
          const derived = coordsForRegionWithJitter(r.region, r.id);
          if (derived) { lat = derived.lat; lon = derived.lon; }
        }
        if (lat == null || lon == null) continue;
        out.push({
          id: `r-${r.id}`, kind: "reporte",
          lat, lon,
          categoria: r.categoria, label: r.descripcion?.slice(0, 80),
          confirmado: !!r.confirmado,
          href: `/app/denuncias/${r.id}`,
        });
      }
    }
    return out;
  }, [showAlertas, showDenuncias, reportes, alertasApi]);

  const selectedRegion = useMemo(
    () => REGIONES.find((r) => r.id === selectedRegionId) ?? null,
    [selectedRegionId],
  );

  const totals = useMemo(
    () =>
      REGIONES.reduce(
        (acc, r) => {
          acc.alertas += r.alertas;
          acc.reportes += r.reportes;
          acc.convergentes += r.convergentes;
          acc.monto += r.monto;
          return acc;
        },
        { alertas: 0, reportes: 0, convergentes: 0, monto: 0 },
      ),
    [],
  );

  const tickerAlertas = [...ALERTAS_MOCK].sort((a, b) => b.score - a.score).slice(0, 8);

  // Abre el drawer móvil cuando se selecciona una región
  const handleSelectRegion = (id: string | null) => {
    setSelectedRegionId(id);
    setProvinciaActiva(null);
    setMobileDrawerOpen(id !== null);
  };

  return (
    <div className="space-y-4">
      <AgentsRibbon />

      {/* Marquee de alertas */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-paperSoft py-1 shadow-card">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-paperSoft to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-paperSoft to-transparent" />
        <div className="pointer-events-none absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-rust px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-paper">
          en vivo
        </div>
        <Marquee className="[--duration:60s] [--gap:2.5rem] pl-24" pauseOnHover>
          {tickerAlertas.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 whitespace-nowrap text-xs"
            >
              <span className="rounded bg-amber-soft px-1.5 py-0.5 font-mono text-[10px] text-amber">
                score {a.score}
              </span>
              <span className="font-mono text-mute">{a.codigoconvocatoria}</span>
              <span className="text-ink">·</span>
              <span className="text-mute">{a.region}</span>
              <span className="text-ink">·</span>
              <span className="max-w-[420px] truncate text-ink">{a.objeto}</span>
              <span className="text-ink">·</span>
              <span className="font-mono text-clay">{formatSoles(a.montoSoles)}</span>
            </div>
          ))}
        </Marquee>
      </div>

      {/* Main dashboard */}
      <div className="surface relative overflow-hidden rounded-3xl">
        {/* TOP STRIP */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paperDeep px-4 py-3 sm:px-5">
          {/* Metric switcher */}
          <div className="flex items-center gap-1 rounded-full border border-line bg-paperSoft p-1">
            {METRICS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMetric(m.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  metric === m.id
                    ? "bg-ink text-paper"
                    : "text-mute hover:bg-paper hover:text-ink",
                )}
              >
                {m.icon}
                <span className="hidden sm:inline">{m.label}</span>
              </button>
            ))}
          </div>

          {/* Layer toggles — pines de alertas/denuncias */}
          <div className="flex items-center gap-1 rounded-full border border-line bg-paperSoft p-1">
            <button
              onClick={() => setShowAlertas((v) => !v)}
              title={`${showAlertas ? "Ocultar" : "Mostrar"} alertas en el mapa`}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                showAlertas ? "bg-amber text-paper" : "text-mute hover:bg-paper hover:text-ink",
              )}
            >
              <AlertTriangle size={13} />
              <span className="hidden sm:inline">Alertas</span>
              <span className="font-mono text-[10px] opacity-80">
                {(alertasApi.length > 0 ? alertasApi : ALERTAS_MOCK).length}
              </span>
            </button>
            <button
              onClick={() => setShowDenuncias((v) => !v)}
              title={`${showDenuncias ? "Ocultar" : "Mostrar"} denuncias en el mapa`}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                showDenuncias ? "bg-rust text-paper" : "text-mute hover:bg-paper hover:text-ink",
              )}
            >
              <MessageSquareWarning size={13} />
              <span className="hidden sm:inline">Denuncias</span>
              <span className="font-mono text-[10px] opacity-80">{reportes.length}</span>
            </button>
          </div>

          {/* Breadcrumb o quick totals */}
          <div className="flex items-center gap-3 text-xs">
            {!selectedRegion ? (
              <div className="hidden gap-4 md:flex">
                <Stat label="Alertas" value={totals.alertas} accent="text-amber" />
                <Stat label="Reportes" value={totals.reportes} accent="text-rust" />
                <Stat
                  label="Convergentes"
                  value={totals.convergentes}
                  accent="text-clay"
                />
                <Stat label="Monto" value={formatSoles(totals.monto)} accent="text-ink" />
              </div>
            ) : (
              <div className="flex items-center gap-2 font-mono text-xs">
                <button
                  onClick={() => handleSelectRegion(null)}
                  className="text-mute hover:text-clay"
                >
                  Perú
                </button>
                <ChevronRight size={12} className="text-mute" />
                <span className="font-semibold text-ink">{selectedRegion.nombre}</span>
                {provinciaActiva && (
                  <>
                    <ChevronRight size={12} className="text-mute" />
                    <span className="text-rust">{provinciaActiva.nombre}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* MAP + PANEL */}
        <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]">
          {/* Map area */}
          <div className="relative">
            <div className="aspect-[480/700] max-h-[680px] w-full overflow-hidden">
              <PeruChoropleth
                metric={metric}
                selectedRegionId={selectedRegionId}
                hoveredRegionId={hoveredRegionId}
                onHoverRegion={setHoveredRegionId}
                onSelectRegion={handleSelectRegion}
                onSelectProvincia={(regionId, p) => {
                  setProvinciaActiva({ regionId, ...p });
                  setMobileDrawerOpen(true);
                }}
                points={points}
              />
            </div>

            {/* Back button */}
            {selectedRegion && (
              <button
                onClick={() => handleSelectRegion(null)}
                className="absolute left-3 top-3 z-20 flex animate-fadeIn items-center gap-1.5 rounded-full border border-line bg-paperSoft/95 px-3 py-1.5 text-xs font-medium text-ink backdrop-blur-sm hover:bg-paper sm:left-4 sm:top-4 sm:px-3 sm:py-2"
              >
                <ArrowLeft size={14} />
                <span className="hidden sm:inline">Volver al Perú</span>
                <span className="sm:hidden">Volver</span>
              </button>
            )}

            {/* Metric label */}
            <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-2xl border border-line bg-paperSoft/95 px-3 py-1.5 backdrop-blur-sm sm:right-4 sm:top-4 sm:py-2">
              <div className="text-right text-[9px] font-semibold uppercase tracking-widest text-mute">
                Visualizando
              </div>
              <div className="text-right font-serif text-sm font-bold text-ink">
                {metricLabel(metric)}
              </div>
            </div>

            {/* Legend (vista país) */}
            {!selectedRegion && (
              <div className="absolute bottom-3 right-3 z-10 animate-fadeIn space-y-2 rounded-2xl border border-line bg-paperSoft/95 px-3 py-2 backdrop-blur-sm sm:bottom-4 sm:right-4">
                <div>
                  <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-mute">
                    Intensidad
                  </div>
                  <div className="flex items-center gap-1">
                    {["#E8DFC7", "#D9B97A", "#C28840", "#A05A1F", "#7A2E18", "#4A150C"].map(
                      (c) => (
                        <span
                          key={c}
                          className="h-3 w-5 rounded-sm border border-paperEdge"
                          style={{ background: c }}
                        />
                      ),
                    )}
                  </div>
                  <div className="mt-1 flex justify-between text-[9px] text-mute">
                    <span>0</span>
                    <span>más alertas</span>
                  </div>
                </div>
                {(showAlertas || showDenuncias) && points.length > 0 && (
                  <div className="border-t border-line pt-2">
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-mute">
                      Pines
                    </div>
                    <div className="space-y-0.5 text-[9px] text-mute">
                      {showAlertas && (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#7A2E18" }} />
                          <span>Alerta score ≥ 85</span>
                        </div>
                      )}
                      {showAlertas && (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#C28840" }} />
                          <span>Alerta 70-84</span>
                        </div>
                      )}
                      {showDenuncias && (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#8B2A1E" }} />
                          <span>Denuncia confirmada</span>
                        </div>
                      )}
                      {showDenuncias && (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#A05A1F" }} />
                          <span>Denuncia pendiente</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Hints */}
            {!selectedRegionId && (
              <div className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-md rounded-2xl border border-line bg-paperSoft/95 px-4 py-2 text-center text-xs text-mute backdrop-blur-sm sm:inset-x-4 sm:bottom-4 lg:hidden">
                Toca un departamento para hacer zoom
              </div>
            )}
            {selectedRegion &&
              selectedRegion.provincias.filter((p) => p.alertas > 0).length > 0 &&
              !provinciaActiva &&
              !mobileDrawerOpen && (
                <div className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-md animate-fadeIn rounded-2xl border border-rust/30 bg-crimson-soft px-4 py-2 text-center text-xs text-rust sm:inset-x-4 sm:bottom-4 lg:hidden">
                  Toca una provincia roja para abrir su detalle
                </div>
              )}
          </div>

          {/* DESKTOP SIDEBAR (lg+) */}
          <aside className="hidden border-l border-line lg:block">
            <RegionDetailPanel
              region={selectedRegion}
              provinciaActiva={provinciaActiva}
              onClose={() => handleSelectRegion(null)}
              onClearProvincia={() => setProvinciaActiva(null)}
              alertasApi={alertasApi}
            />
          </aside>

          {/* MOBILE DRAWER (< lg) */}
          {selectedRegion && (
            <div
              className={cn(
                "fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 lg:hidden",
                mobileDrawerOpen ? "translate-y-0" : "translate-y-[calc(100%-58px)]",
              )}
            >
              <div className="rounded-t-3xl border-t border-line bg-paperSoft shadow-paper">
                {/* Handle */}
                <button
                  onClick={() => setMobileDrawerOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-3 border-b border-line bg-paperDeep px-5 py-3"
                >
                  <div className="flex items-center gap-2 text-left">
                    <div className="h-1 w-10 rounded-full bg-line" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-clay">
                      {selectedRegion.nombre}
                    </div>
                    <div className="text-xs text-mute">
                      {selectedRegion.alertas} alertas · {formatSoles(selectedRegion.monto)}
                    </div>
                  </div>
                  {mobileDrawerOpen ? (
                    <ChevronDown size={18} className="text-mute" />
                  ) : (
                    <ChevronUp size={18} className="text-mute" />
                  )}
                </button>
                <div className="max-h-[70vh] overflow-y-auto">
                  <RegionDetailPanel
                    region={selectedRegion}
                    provinciaActiva={provinciaActiva}
                    onClose={() => handleSelectRegion(null)}
                    onClearProvincia={() => setProvinciaActiva(null)}
                    alertasApi={alertasApi}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div className="text-right">
      <div className="text-[9px] uppercase tracking-widest text-mute">{label}</div>
      <div className={"font-mono text-sm font-semibold " + accent}>
        {typeof value === "number" ? value.toLocaleString("es-PE") : value}
      </div>
    </div>
  );
}

function MapSkeleton() {
  return (
    <div className="flex h-[680px] items-center justify-center bg-paperDeep">
      <div className="text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-clay/30 border-t-clay" />
        <p className="mt-3 text-sm text-mute">Cargando mapa…</p>
      </div>
    </div>
  );
}
