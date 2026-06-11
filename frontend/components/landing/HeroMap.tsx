"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { MapPoint } from "../PeruChoropleth";

const PeruChoropleth = dynamic(
  () => import("../PeruChoropleth").then((m) => m.PeruChoropleth),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-amber/30 border-t-amber" />
      </div>
    ),
  },
);

// Pines curados sobre coords reales del Perú (alertas + reportes).
const HERO_POINTS: MapPoint[] = [
  { id: "a1", kind: "alerta", lat: -9.53, lon: -77.53, score: 88, label: "Áncash · obra vial" },
  { id: "a2", kind: "alerta", lat: -12.05, lon: -77.04, score: 92, label: "Lima · equipos" },
  { id: "a3", kind: "alerta", lat: -8.11, lon: -79.03, score: 84, label: "La Libertad · salud" },
  { id: "a4", kind: "alerta", lat: -5.19, lon: -80.63, score: 79, label: "Piura · agua" },
  { id: "a5", kind: "alerta", lat: -15.84, lon: -70.02, score: 81, label: "Puno" },
  { id: "r1", kind: "reporte", lat: -13.53, lon: -71.97, confirmado: true, label: "Cusco · obra paralizada" },
  { id: "r2", kind: "reporte", lat: -16.4, lon: -71.54, confirmado: false, label: "Arequipa" },
  { id: "r3", kind: "reporte", lat: -3.75, lon: -73.25, confirmado: true, label: "Loreto" },
];

/** Mapa del Perú para el hero: muestra el choropleth de alertas con pines.
 *  Hover resalta; el click no hace zoom (es vitrina, no dashboard). */
export function HeroMap() {
  const [hov, setHov] = useState<string | null>(null);
  return (
    <PeruChoropleth
      metric="alertas"
      selectedRegionId={null}
      hoveredRegionId={hov}
      onHoverRegion={setHov}
      onSelectRegion={() => {}}
      onSelectProvincia={() => {}}
      points={HERO_POINTS}
    />
  );
}
