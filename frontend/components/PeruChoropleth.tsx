"use client";

import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath, geoCentroid } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { AlertCircle, Terminal } from "lucide-react";
import {
  REGIONES,
  type ProvinciaData,
  type MetricaId,
  regionMetric,
} from "@/lib/peru-data";
import { normalizeRegionId } from "@/lib/utils";

const VB_W = 480;
const VB_H = 700;

interface DepartmentProps {
  name: string;
  id: string;
  code?: string;
}

interface ProvinceProps {
  name: string;
  departamento: string;
  regionId: string;
  id: string;
  code?: string;
}

type DeptFeature = Feature<Geometry, DepartmentProps>;
type ProvFeature = Feature<Geometry, ProvinceProps>;
type DeptGeo = FeatureCollection<Geometry, DepartmentProps>;
type ProvGeo = FeatureCollection<Geometry, ProvinceProps>;

// Escala secuencial cálida — coherente con paleta kraft.
function fillForValue(value: number, max: number): string {
  if (max === 0 || value === 0) return "#EDF0F3"; // sin data (gris frío)
  const t = value / max;
  if (t < 0.2) return "#D9B97A";  // sand
  if (t < 0.45) return "#C28840"; // bronze
  if (t < 0.7) return "#A05A1F";  // tobacco
  if (t < 0.9) return "#7A2E18";  // oxblood
  return "#4A150C";                // deep
}

export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
  kind: "alerta" | "reporte";
  label?: string;
  // Para alertas: 0-100. Para reportes: categoria.
  score?: number;
  categoria?: string;
  confirmado?: boolean;
  href?: string;
}

export interface PeruChoroplethProps {
  metric: MetricaId;
  selectedRegionId: string | null;
  hoveredRegionId: string | null;
  onHoverRegion: (id: string | null) => void;
  onSelectRegion: (id: string | null) => void;
  onSelectProvincia: (regionId: string, provincia: ProvinciaData) => void;
  // Pines opcionales que se overlay sobre el choropleth
  points?: MapPoint[];
}

export function PeruChoropleth({
  metric,
  selectedRegionId,
  hoveredRegionId,
  onHoverRegion,
  onSelectRegion,
  onSelectProvincia,
  points = [],
}: PeruChoroplethProps) {
  const [deptData, setDeptData] = useState<DeptGeo | null>(null);
  const [provData, setProvData] = useState<ProvGeo | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">(
    "loading",
  );
  const [hoveredProvId, setHoveredProvId] = useState<string | null>(null);
  // Estado animado del transform — actualizado por RAF
  const [animTransform, setAnimTransform] = useState({ tx: 0, ty: 0, s: 1 });

  useEffect(() => {
    let alive = true;
    fetch("/peru-departments.json")
      .then((r) => {
        if (r.status === 404) throw new Error("missing");
        if (!r.ok) throw new Error("error");
        return r.json();
      })
      .then((data: DeptGeo) => {
        if (!alive) return;
        setDeptData(data);
        setStatus("ready");
      })
      .catch((err) => {
        if (!alive) return;
        setStatus(err.message === "missing" ? "missing" : "error");
      });
    fetch("/peru-provinces.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ProvGeo | null) => {
        if (alive && data) setProvData(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const projection = useMemo(() => {
    if (!deptData) return null;
    return geoMercator().fitExtent(
      [
        [16, 24],
        [VB_W - 16, VB_H - 16],
      ],
      deptData as any,
    );
  }, [deptData]);

  const deptPaths = useMemo(() => {
    if (!deptData || !projection) return [];
    const pg = geoPath(projection);
    return (deptData.features as DeptFeature[]).map((feat) => {
      const propsId =
        feat.properties.id || normalizeRegionId(feat.properties.name || "");
      const region = REGIONES.find((r) => r.id === propsId);
      const value = region ? regionMetric(region, metric) : 0;
      const bounds = pg.bounds(feat as any);
      return {
        id: propsId,
        name: feat.properties.name,
        value,
        d: pg(feat as any) || "",
        centroid: pg.centroid(feat as any),
        bounds,
        region,
      };
    });
  }, [deptData, projection, metric]);

  const max = useMemo(
    () => Math.max(...deptPaths.map((p) => p.value), 1),
    [deptPaths],
  );

  const selectedRegion =
    selectedRegionId != null
      ? REGIONES.find((r) => r.id === selectedRegionId)
      : null;

  // Computa target transform basado en la región seleccionada
  const targetTransform = useMemo(() => {
    if (!selectedRegionId || !deptPaths.length) {
      return { tx: 0, ty: 0, s: 1 };
    }
    const sel = deptPaths.find((p) => p.id === selectedRegionId);
    if (!sel || !sel.bounds) return { tx: 0, ty: 0, s: 1 };
    const [[x0, y0], [x1, y1]] = sel.bounds;
    const w = x1 - x0 || 1;
    const h = y1 - y0 || 1;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const padding = 0.78;
    const s = Math.min((VB_W * padding) / w, (VB_H * padding) / h);
    const tx = VB_W / 2 - cx * s;
    const ty = VB_H / 2 - cy * s;
    return { tx, ty, s };
  }, [selectedRegionId, deptPaths]);

  // Animación con requestAnimationFrame — cubic ease out
  useEffect(() => {
    const duration = 700;
    const start = performance.now();
    const from = animTransform;
    const to = targetTransform;
    let raf = 0;

    const step = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimTransform({
        tx: from.tx + (to.tx - from.tx) * eased,
        ty: from.ty + (to.ty - from.ty) * eased,
        s: from.s + (to.s - from.s) * eased,
      });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTransform.tx, targetTransform.ty, targetTransform.s]);

  const provincePaths = useMemo(() => {
    if (!provData || !projection || !selectedRegionId) return [];
    const pg = geoPath(projection);
    return (provData.features as ProvFeature[])
      .filter((f) => f.properties.regionId === selectedRegionId)
      .map((f) => {
        const provName = f.properties.name;
        const provNorm = normalizeRegionId(provName);
        const mockProv = selectedRegion?.provincias.find(
          (p) => normalizeRegionId(p.nombre) === provNorm,
        );
        // Centroide geográfico para sintetizar provincias sin mock
        const [lng, lat] = geoCentroid(f as any);
        const synth: ProvinciaData = mockProv ?? {
          id: f.properties.id,
          nombre: provName,
          lat,
          lon: lng,
          alertas: 0,
          convergentes: 0,
          monto: 0,
          scorePromedio: 0,
        };
        return {
          id: f.properties.id,
          name: provName,
          d: pg(f as any) || "",
          centroid: pg.centroid(f as any) as [number, number],
          mockProv,
          provData: synth,
        };
      });
  }, [provData, projection, selectedRegionId, selectedRegion]);

  if (status === "loading") return <Loading />;
  if (status === "missing") return <MissingGeoJSON />;
  if (status === "error") return <FetchError />;

  const { tx, ty, s: zoomScale } = animTransform;
  const transformStr = `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${zoomScale.toFixed(4)})`;

  // Tamaños base que se dividen por zoom para mantener tamaño visual
  const fs = {
    dept: 9 / zoomScale,
    deptSelected: 11.5 / zoomScale,
    deptValue: 8.5 / zoomScale,
    prov: 8 / zoomScale,
  };
  const sw = {
    dept: 0.6 / zoomScale,
    deptSelected: 1.6 / zoomScale,
    province: 0.4 / zoomScale,
    provinceData: 0.9 / zoomScale,
    labelHalo: 2.8 / zoomScale,
    labelHaloSm: 2.2 / zoomScale,
  };

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label="Mapa del Perú por departamentos"
      >
        <defs>
          {/* Patrón océano: papel kraft con trazos cruzados sutiles */}
          <pattern
            id="ocean"
            width="26"
            height="26"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(28)"
          >
            <line x1="0" y1="0" x2="0" y2="26" stroke="#E4E7EB" strokeWidth="0.6" />
          </pattern>

          {/* Sombra suave estilo papel */}
          <filter id="paper-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow
              dx="1.5"
              dy="3"
              stdDeviation="2.5"
              floodColor="#1B1611"
              floodOpacity="0.22"
            />
          </filter>
        </defs>

        {/* Fondo limpio */}
        <rect width={VB_W} height={VB_H} fill="#FFFFFF" />
        <rect width={VB_W} height={VB_H} fill="url(#ocean)" opacity={0.4} />

        {/* Grupo transformado (zoom via atributo SVG, no CSS) */}
        <g transform={transformStr}>
          {/* Departamentos */}
          <g filter="url(#paper-shadow)">
            {deptPaths.map((p) => {
              const isHover = hoveredRegionId === p.id;
              const isSelected = selectedRegionId === p.id;
              const isDimmed = selectedRegionId !== null && !isSelected;
              return (
                <path
                  key={p.id}
                  d={p.d}
                  fill={fillForValue(p.value, max)}
                  stroke={isSelected ? "#1B1611" : "#76695A"}
                  strokeWidth={
                    isSelected ? sw.deptSelected : sw.dept
                  }
                  strokeLinejoin="round"
                  onMouseEnter={() => onHoverRegion(p.id)}
                  onMouseLeave={() => onHoverRegion(null)}
                  onClick={() => onSelectRegion(isSelected ? null : p.id)}
                  style={{
                    cursor: "pointer",
                    transition: "opacity 400ms ease, filter 220ms ease",
                    opacity: isDimmed ? 0.25 : 1,
                    filter:
                      isHover && !isSelected
                        ? "brightness(1.08)"
                        : undefined,
                  }}
                />
              );
            })}
          </g>

          {/* Provincias del departamento seleccionado */}
          {selectedRegionId && provincePaths.length > 0 && (
            <g>
              {provincePaths.map((p) => {
                const hasData = !!p.mockProv && p.mockProv.alertas > 0;
                const isHover = hoveredProvId === p.id;
                return (
                  <path
                    key={p.id}
                    d={p.d}
                    fill={
                      hasData
                        ? "rgba(139, 42, 30, 0.45)"
                        : isHover
                          ? "rgba(160, 81, 45, 0.18)"
                          : "rgba(118, 105, 90, 0.08)"
                    }
                    stroke={hasData ? "#8B2A1E" : "rgba(118, 105, 90, 0.55)"}
                    strokeWidth={hasData ? sw.provinceData : sw.province}
                    strokeLinejoin="round"
                    strokeDasharray={hasData ? "" : `${1.5 / zoomScale} ${1.2 / zoomScale}`}
                    style={{
                      cursor: "pointer",
                      transition: "fill 220ms, filter 220ms",
                      filter: isHover && hasData ? "brightness(0.92)" : undefined,
                    }}
                    onMouseEnter={() => setHoveredProvId(p.id)}
                    onMouseLeave={() => setHoveredProvId(null)}
                    onClick={() => {
                      onSelectProvincia(selectedRegionId, p.provData);
                    }}
                  />
                );
              })}
            </g>
          )}

          {/* Etiquetas dept */}
          <g pointerEvents="none">
            {deptPaths.map((p) => {
              const isHover = hoveredRegionId === p.id;
              const isSelected = selectedRegionId === p.id;
              const isDimmed = selectedRegionId !== null && !isSelected;
              const showLabel =
                (isHover || isSelected || p.value > 0) && !isDimmed;
              if (!showLabel) return null;
              const [cx, cy] = p.centroid;
              const f = isSelected ? fs.deptSelected : fs.dept;
              return (
                <g key={`lb-${p.id}`} transform={`translate(${cx},${cy})`}>
                  <text
                    textAnchor="middle"
                    dy="0.35em"
                    fontSize={f}
                    fontWeight={isSelected ? 700 : 600}
                    fill="#1B1611"
                    stroke="#F4EEDD"
                    strokeWidth={sw.labelHalo}
                    strokeOpacity="0.95"
                    style={{ paintOrder: "stroke" }}
                  >
                    {p.name}
                  </text>
                  <text
                    textAnchor="middle"
                    dy="0.35em"
                    fontSize={f}
                    fontWeight={isSelected ? 700 : 600}
                    fill="#1B1611"
                  >
                    {p.name}
                  </text>
                  {p.value > 0 && (isSelected || isHover) && (
                    <text
                      textAnchor="middle"
                      dy="1.65em"
                      fontSize={fs.deptValue}
                      fontFamily="JetBrains Mono, monospace"
                      fill="#8B2A1E"
                    >
                      {formatMetric(p.value, metric)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* Etiquetas provincia con alertas */}
          {selectedRegionId && (
            <g pointerEvents="none">
              {provincePaths
                .filter((p) => p.mockProv && p.mockProv.alertas > 0)
                .map((p) => {
                  const [cx, cy] = p.centroid;
                  return (
                    <g
                      key={`lb-prov-${p.id}`}
                      transform={`translate(${cx},${cy})`}
                    >
                      <text
                        textAnchor="middle"
                        dy="0.35em"
                        fontSize={fs.prov}
                        fontWeight="700"
                        fill="#8B2A1E"
                        stroke="#F4EEDD"
                        strokeWidth={sw.labelHaloSm}
                        strokeOpacity="0.95"
                        style={{ paintOrder: "stroke" }}
                      >
                        {p.name}
                      </text>
                      <text
                        textAnchor="middle"
                        dy="0.35em"
                        fontSize={fs.prov}
                        fontWeight="700"
                        fill="#8B2A1E"
                      >
                        {p.name}
                      </text>
                    </g>
                  );
                })}
            </g>
          )}

          {/* Pines de alertas/denuncias overlay sobre el choropleth */}
          {projection && points.length > 0 && (
            <g pointerEvents="auto">
              {points.map((pt) => {
                const proj = projection([pt.lon, pt.lat]);
                if (!proj) return null;
                const [px, py] = proj;
                const isAlerta = pt.kind === "alerta";
                const score = pt.score ?? 0;
                // Tamaño y color para alertas según score
                const r = isAlerta
                  ? (score >= 85 ? 4.2 : score >= 70 ? 3.5 : 3) / zoomScale
                  : 3.5 / zoomScale;
                const fill = isAlerta
                  ? (score >= 85 ? "#7A2E18" : score >= 70 ? "#C28840" : "#D9B97A")
                  : pt.confirmado ? "#8B2A1E" : "#A05A1F";
                const stroke = isAlerta ? "#F4EEDD" : "#F4EEDD";
                const sw2 = 0.8 / zoomScale;
                return (
                  <g key={`pt-${pt.id}`}>
                    {/* Halo pulsante para denuncias confirmadas y alertas alta */}
                    {(pt.confirmado || (isAlerta && score >= 85)) && (
                      <circle cx={px} cy={py} r={r * 2}
                        fill={isAlerta ? "rgba(122, 46, 24, 0.18)" : "rgba(139, 42, 30, 0.20)"}
                      >
                        <animate attributeName="r"
                          values={`${r * 1.6};${r * 2.8};${r * 1.6}`}
                          dur="2s" repeatCount="indefinite" />
                      </circle>
                    )}
                    <circle
                      cx={px} cy={py} r={r}
                      fill={fill} stroke={stroke} strokeWidth={sw2}
                      style={{ cursor: pt.href ? "pointer" : "default" }}
                      onClick={() => { if (pt.href) window.location.assign(pt.href); }}
                    >
                      <title>{`${isAlerta ? "Alerta" : "Denuncia"}${pt.label ? " · " + pt.label : ""}${
                        isAlerta && score ? " · score " + score : ""
                      }${pt.categoria ? " · " + pt.categoria : ""}`}</title>
                    </circle>
                  </g>
                );
              })}
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}

function formatMetric(value: number, metric: MetricaId): string {
  if (metric === "monto") {
    if (value >= 1_000_000) return `S/. ${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1000) return `S/. ${(value / 1000).toFixed(0)}K`;
    return `S/. ${value}`;
  }
  if (metric === "score") return `${value}/100`;
  return `${value} ${metric === "alertas" ? "alertas" : "casos"}`;
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-clay/30 border-t-clay" />
        <p className="mt-3 text-sm text-mute">Cargando geometría del Perú…</p>
      </div>
    </div>
  );
}

function FetchError() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border border-rust/40 bg-rust/10 p-6 text-center">
        <AlertCircle size={32} className="text-rust" />
        <h3 className="font-serif text-lg font-bold text-ink">
          Error cargando el mapa
        </h3>
        <p className="text-sm text-mute">
          La geometría no pudo descargarse.
        </p>
      </div>
    </div>
  );
}

function MissingGeoJSON() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-lg flex-col items-center gap-4 rounded-2xl border border-paperEdge bg-paperSoft p-7 text-center shadow-card">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-paperDeep text-clay">
          <Terminal size={22} />
        </div>
        <h3 className="font-serif text-xl font-bold text-ink">
          Falta la geometría del Perú
        </h3>
        <p className="text-sm leading-relaxed text-mute">
          Generala una vez con:
        </p>
        <pre className="w-full rounded-xl border border-line bg-paperDeep px-4 py-3 text-left font-mono text-xs leading-relaxed text-ink">
          python scripts/fetch_peru_geo.py
        </pre>
      </div>
    </div>
  );
}
