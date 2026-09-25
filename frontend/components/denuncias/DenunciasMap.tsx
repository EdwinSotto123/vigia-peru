"use client";

import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import type { ReporteCiudadano } from "@/types";
import { CATEGORIA_META, tieneUbicacion, type CategoriaDenuncia } from "@/lib/denuncias-meta";

/**
 * Ubicador de UNA denuncia: el contorno del Perú con un solo punto, para que la
 * ficha diga dónde queda sin obligar a salir de ella.
 *
 * No es un mapa para explorar: el producto tiene uno solo, /app/mapa, y antes
 * este componente era un segundo mapa interactivo (pines con hover, tooltip,
 * enlace flotante) montado dentro de /app/denuncias. Ahora es una figura
 * estática, sin eventos. Quien la llama decide si la muestra: sin ubicación
 * real (`tieneUbicacion`), no hay punto que dibujar y no se dibuja ninguno.
 */
export function DenunciasMap({
  reporte,
}: {
  reporte: Pick<ReporteCiudadano, "lat" | "lon" | "categoria" | "region">;
}) {
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    fetch("/peru-departments.json")
      .then((r) => r.json())
      .then(setGeo)
      .catch(() => setGeo(null));
  }, []);

  const W = 720;
  const H = 520;

  const { projection, paths } = useMemo(() => {
    if (!geo) return { projection: null, paths: [] as string[] };
    const proj = geoMercator().fitSize([W, H], geo as any);
    const pathFn = geoPath(proj);
    return { projection: proj, paths: (geo.features || []).map((f: any) => pathFn(f) ?? "") };
  }, [geo]);

  if (!tieneUbicacion(reporte)) return null;
  const pt = projection ? projection([Number(reporte.lon), Number(reporte.lat)]) : null;
  // El color de la categoría viene de lib/denuncias-meta (el mismo que usa el mapa). Sin
  // categoría conocida el punto va en tinta: nunca en el rojo de la severidad.
  const color = CATEGORIA_META[reporte.categoria as CategoriaDenuncia]?.color;

  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-paper">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Ubicación de la denuncia${reporte.region ? ` en ${reporte.region}` : ""}`}
      >
        {paths.map((d, i) => (
          <path key={i} d={d} className="fill-paperSoft stroke-paperEdge" strokeWidth={0.6} />
        ))}
        {pt && (
          <g transform={`translate(${pt[0]}, ${pt[1]})`}>
            <circle r={14} fill={color} className={color ? undefined : "fill-ink"} fillOpacity={0.18} />
            <circle r={7} fill={color} className={color ? "stroke-paper" : "fill-ink stroke-paper"} strokeWidth={2} />
          </g>
        )}
      </svg>
    </figure>
  );
}
