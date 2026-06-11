"use client";

import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import type { FeatureCollection } from "geojson";

/**
 * Escenario del scrollytelling: el mapa REAL del Perú (vector, d3-geo sobre el
 * geojson que ya vive en /public). Versión oscura cinematográfica — strokes
 * ámbar con glow. Recibe el progreso de scroll `p` (0→1) y, según la escena,
 * dibuja el mapa, hace converger 14 nodos-fuente sobre él, y enciende pines en
 * departamentos reales (Áncash) que convergen en un "caso rojo".
 */

const VB_W = 480;
const VB_H = 640;
const N = 6; // escenas (coherente con ScrollStory)

const clamp = (v: number, a = 0, b = 1) => Math.min(Math.max(v, a), b);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const appear = (p: number, start: number, ramp = 0.06) => clamp((p - start) / ramp);
const local = (p: number, i: number) => clamp((p - i / N) / (1 / N));
function sceneAlpha(p: number, i: number) {
  const seg = 1 / N;
  const d = Math.abs(p - (i + 0.5) * seg);
  const full = seg * 0.3;
  const edge = seg * 0.52;
  if (d <= full) return 1;
  if (d >= edge) return 0;
  return 1 - (d - full) / (edge - full);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Puntos reales (lon, lat) — Áncash, región piloto del MVP.
const P_ALERTA = { lon: -77.53, lat: -9.53 }; // Huaraz
const P_REPORTE = { lon: -78.0, lat: -9.1 }; // costa de Áncash

export function PeruMapStage({ p }: { p: number }) {
  const [geo, setGeo] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/peru-departments.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setGeo(d as FeatureCollection);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const { paths, project } = useMemo(() => {
    if (!geo) return { paths: [] as { d: string; ancash: boolean }[], project: null as any };
    const proj = geoMercator().fitExtent(
      [
        [30, 26],
        [VB_W - 30, VB_H - 26],
      ],
      geo as any,
    );
    const pg = geoPath(proj);
    const paths = (geo.features as any[]).map((f) => ({
      d: pg(f as any) || "",
      ancash: /ncash/i.test(f?.properties?.name || ""),
    }));
    return { paths, project: (lonlat: [number, number]) => proj(lonlat) };
  }, [geo]);

  // Alphas por escena.
  const mapA = appear(p, 0.015, 0.12); // mapa aparece en escena 1 y se queda
  const numDim = sceneAlpha(p, 1); // se atenúa cuando aparece el número
  const groupOpacity = mapA * (1 - 0.62 * numDim);
  const nodesA = sceneAlpha(p, 2);
  const nodeR = 150 * (1 - easeOut(local(p, 2)) * 0.82);
  const alertaA = appear(p, 3.15 / N);
  const reporteA = appear(p, 4.15 / N);
  const convL = easeOut(local(p, 5));
  const convA = appear(p, 5.0 / N);
  const casoA = appear(p, 5.45 / N);
  const ancashGlow = Math.max(alertaA, reporteA, convA);

  const cx = VB_W / 2;
  const cy = VB_H / 2;

  // Posiciones de pines (proyectadas) + convergencia hacia el punto medio.
  let aXY: [number, number] | null = null;
  let rXY: [number, number] | null = null;
  let cXY: [number, number] | null = null;
  if (project) {
    const a = project([P_ALERTA.lon, P_ALERTA.lat]);
    const r = project([P_REPORTE.lon, P_REPORTE.lat]);
    if (a && r) {
      const mid: [number, number] = [(a[0] + r[0]) / 2, (a[1] + r[1]) / 2];
      aXY = [lerp(a[0], mid[0], convL), lerp(a[1], mid[1], convL)];
      rXY = [lerp(r[0], mid[0], convL), lerp(r[1], mid[1], convL)];
      cXY = mid;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-auto"
      role="img"
      aria-label="Mapa del Perú"
    >
      <defs>
        <filter id="map-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="pin-glow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
        <radialGradient id="ancash-fill" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#B5752C" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#B5752C" stopOpacity="0.04" />
        </radialGradient>
      </defs>

      {/* ── MAPA ── */}
      <g style={{ opacity: groupOpacity, transition: "opacity 120ms linear" }}>
        {/* relleno tenue + departamentos */}
        <g filter="url(#map-glow)">
          {paths.map((pt, i) => (
            <path
              key={i}
              d={pt.d}
              fill={pt.ancash ? "url(#ancash-fill)" : "rgba(181,117,44,0.05)"}
              fillOpacity={pt.ancash ? 0.4 + ancashGlow * 0.6 : 1}
              stroke={pt.ancash ? "#E7B765" : "#B5752C"}
              strokeOpacity={pt.ancash ? 0.6 + ancashGlow * 0.4 : 0.55}
              strokeWidth={pt.ancash ? 1.1 : 0.7}
              strokeLinejoin="round"
            />
          ))}
        </g>

        {/* nodos-fuente convergiendo (escena 3) */}
        {nodesA > 0.01 &&
          Array.from({ length: 14 }).map((_, i) => {
            const ang = (i / 14) * Math.PI * 2;
            const x = cx + Math.cos(ang) * nodeR;
            const y = cy + Math.sin(ang) * nodeR;
            return (
              <g key={i} style={{ opacity: nodesA }}>
                <line x1={cx} y1={cy} x2={x} y2={y} stroke="#B5752C" strokeOpacity={0.18 * easeOut(local(p, 2))} strokeWidth={0.5} />
                <circle cx={x} cy={y} r={2} fill="#D9B97A" filter="url(#pin-glow)" />
                <circle cx={x} cy={y} r={1.4} fill="#F2E0B8" />
              </g>
            );
          })}
        {nodesA > 0.01 && (
          <circle cx={cx} cy={cy} r={4} fill="#B5752C" filter="url(#pin-glow)" style={{ opacity: easeOut(local(p, 2)) }} />
        )}
      </g>

      {/* ── PINES en coords reales ── */}
      {aXY && (
        <MapPin x={aXY[0]} y={aXY[1]} color="#E7B765" alpha={alertaA * (1 - casoA)} label="alerta" ring />
      )}
      {rXY && (
        <MapPin x={rXY[0]} y={rXY[1]} color="#C0382A" alpha={reporteA * (1 - casoA)} label="reporte" ring />
      )}
      {cXY && casoA > 0.01 && (
        <MapPin x={cXY[0]} y={cXY[1]} color="#F4EEDD" alpha={casoA} label="caso rojo" big ring />
      )}
    </svg>
  );
}

function MapPin({
  x,
  y,
  color,
  alpha,
  label,
  ring,
  big,
}: {
  x: number;
  y: number;
  color: string;
  alpha: number;
  label: string;
  ring?: boolean;
  big?: boolean;
}) {
  if (alpha <= 0.01) return null;
  const r = big ? 5 : 3.6;
  return (
    <g style={{ opacity: alpha }}>
      <circle cx={x} cy={y} r={r * 2.6} fill={color} opacity={0.14} filter="url(#pin-glow)" />
      {ring && (
        <circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={0.8} opacity={0.7}>
          <animate attributeName="r" values={`${r};${r * 3.2};${r}`} dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.7;0;0.7" dur="2.4s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx={x} cy={y} r={r} fill={color} stroke="#1B1611" strokeWidth={0.6} />
      <text x={x} y={y - r - 4} textAnchor="middle" fontSize={9} fontWeight={700} fill={color} stroke="#1B1611" strokeWidth={2.4} strokeOpacity={0.9} style={{ paintOrder: "stroke", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </text>
    </g>
  );
}
