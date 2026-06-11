"use client";

import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import Link from "next/link";
import type { ReporteCiudadano } from "@/types";
import { CATEGORIA_META, type CategoriaDenuncia } from "@/lib/denuncias-meta";

/**
 * Mapa SVG de Perú con pines por reporte ciudadano. Pasale los reportes ya
 * filtrados — el mapa solo dibuja.
 */
export function DenunciasMap({
  reportes,
  highlightId,
}: {
  reportes: ReporteCiudadano[];
  highlightId?: string;
}) {
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    fetch("/peru-departments.json")
      .then((r) => r.json())
      .then(setGeo)
      .catch(() => setGeo(null));
  }, []);

  const W = 720;
  const H = 520;

  const { projection, paths } = useMemo(() => {
    if (!geo) return { projection: null, paths: [] as any[] };
    const proj = geoMercator().fitSize([W, H], geo as any);
    const pathFn = geoPath(proj);
    const pp = (geo.features || []).map((f: any) => ({
      d: pathFn(f) ?? "",
      name: f.properties?.NAME_1 ?? f.properties?.name ?? "",
    }));
    return { projection: proj, paths: pp };
  }, [geo]);

  return (
    <div className="surface relative overflow-hidden p-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Polígonos del Perú */}
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill="#FAF6E9"
            stroke="#D9CFB7"
            strokeWidth={0.6}
          />
        ))}

        {/* Pines */}
        {projection &&
          reportes.map((r) => {
            const pt = projection([r.lon, r.lat]);
            if (!pt) return null;
            const [x, y] = pt;
            const meta = CATEGORIA_META[r.categoria as CategoriaDenuncia];
            const color = meta?.color ?? "#8B2A1E";
            const isHover = hovered === r.id || highlightId === r.id;
            return (
              <g key={r.id} transform={`translate(${x}, ${y})`}>
                <circle
                  r={isHover ? 9 : 6}
                  fill={color}
                  fillOpacity={r.confirmado ? 0.95 : 0.55}
                  stroke="#FAF6E9"
                  strokeWidth={1.8}
                  className="cursor-pointer transition-all"
                  onMouseEnter={() => setHovered(r.id)}
                  onMouseLeave={() => setHovered(null)}
                />
                {!r.confirmado && (
                  <circle
                    r={9}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.2}
                    strokeDasharray="2 2"
                    opacity={0.7}
                  />
                )}
              </g>
            );
          })}

        {/* Tooltip flotante para el hovereado */}
        {hovered &&
          (() => {
            const r = reportes.find((x) => x.id === hovered);
            if (!r || !projection) return null;
            const pt = projection([r.lon, r.lat]);
            if (!pt) return null;
            const [x, y] = pt;
            const tx = Math.min(x + 12, W - 180);
            const ty = Math.max(y - 30, 10);
            const meta = CATEGORIA_META[r.categoria as CategoriaDenuncia];
            return (
              <g transform={`translate(${tx}, ${ty})`}>
                <rect
                  width={180}
                  height={56}
                  rx={8}
                  fill="#1B1611"
                  fillOpacity={0.92}
                />
                <text
                  x={10}
                  y={18}
                  fill="#F4EEDD"
                  fontSize={10}
                  fontFamily="ui-monospace, monospace"
                >
                  {meta?.label ?? r.categoria}
                </text>
                <text x={10} y={35} fill="#F4EEDD" fontSize={10}>
                  {r.region} · {r.fecha}
                </text>
                <text x={10} y={49} fill="#A89887" fontSize={9}>
                  {r.confirmado ? "✓ verificado" : "en validación"}
                </text>
              </g>
            );
          })()}
      </svg>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line bg-paperSoft px-4 py-2 text-[10px] text-mute">
        <span className="font-semibold text-ink">Leyenda:</span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-rust" /> verificado
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border border-rust bg-rust/40" />
          en validación
        </span>
        <span className="ml-auto">
          {reportes.length} reporte{reportes.length === 1 ? "" : "s"} en mapa
        </span>
      </div>

      {/* Link rápido al detalle del hovereado */}
      {hovered && (
        <Link
          href={`/app/denuncias/${hovered}`}
          className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-[11px] font-medium text-paper shadow-paper"
        >
          Ver detalle →
        </Link>
      )}
    </div>
  );
}
