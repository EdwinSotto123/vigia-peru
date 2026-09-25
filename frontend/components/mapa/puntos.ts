/**
 * Los puntos que el mapa dibuja encima del coroplético: contratos de riesgo
 * medio o alto y denuncias ciudadanas. Funciones puras (sin React): el
 * contenedor (MapaWrapper) las llama dentro de un `useMemo`.
 *
 * La clasificación es de `lib/severidad`; acá sólo se traduce a relleno SVG. Y
 * la palabra viaja con el punto (`titulo`): el color solo nunca basta.
 */

import type { MapPoint } from "@/components/PeruChoropleth";
import { estaConfirmada, tieneUbicacion } from "@/lib/denuncias-meta";
import { nivelDeScore, severidadDeScore, type NivelSeveridad } from "@/lib/severidad";
import { nombreDepartamento } from "./region-match";
import { PROVINCIA_NOMBRE } from "./provincias";
import { alertaHref, esSenal, zonaDeAlerta } from "./senales";

/**
 * Relleno de cada tramo en el SVG. `baja` es neutro, nunca verde: un contrato
 * de riesgo bajo TIENE señales (hoy no se dibuja: la capa es de riesgo medio o
 * alto, pero si entra, entra sin mentir).
 */
const FILL_SEVERIDAD: Record<NivelSeveridad, string> = {
  alta: "fill-rust",
  media: "fill-amber",
  baja: "fill-mute",
  sin_analizar: "fill-mute",
};
const RADIO_SEVERIDAD: Record<NivelSeveridad, number> = { alta: 4.2, media: 3.5, baja: 3, sin_analizar: 2.8 };

/**
 * Un punto por contrato de riesgo medio o alto, anclado a su provincia. `/alertas`
 * trae la provincia en `region`; antes se buscaba en una tabla de 25 capitales y
 * las que no eran capital (45 de 94) no se dibujaban, y a las demás se les sumaba
 * un desplazamiento de hasta 33 km que dejaba puntos en el mar.
 */
export function puntosDeSenales(alertas: any[]): MapPoint[] {
  const senales = alertas
    .filter(esSenal)
    .map((a) => ({ a, zona: zonaDeAlerta(a) }))
    .filter((x) => x.zona || (typeof x.a.lat === "number" && typeof x.a.lon === "number"))
    .sort((x, y) => (y.a.score ?? 0) - (x.a.score ?? 0));
  const n = new Map<string, number>();
  for (const x of senales) if (x.zona) n.set(x.zona, (n.get(x.zona) ?? 0) + 1);
  const i = new Map<string, number>();
  return senales.map(({ a, zona }) => {
    const nivel = nivelDeScore(a.score);
    const conGps = typeof a.lat === "number" && typeof a.lon === "number";
    const idx = zona ? i.get(zona) ?? 0 : 0;
    if (zona) i.set(zona, idx + 1);
    const lugar = zona ? (zona.length === 4 ? PROVINCIA_NOMBRE[zona] ?? a.region : nombreDepartamento(zona)) : a.region;
    const nSenales = Array.isArray(a.banderas) ? a.banderas.length : 0;
    return {
      id: `a-${a.id || a.codigo}`,
      kind: "alerta" as const,
      ...(conGps ? { lat: a.lat, lon: a.lon } : { zona: zona ?? undefined, grupo: zona ? { i: idx, n: n.get(zona) ?? 1 } : undefined }),
      score: a.score,
      label: a.objeto?.slice(0, 80),
      // "Riesgo alto, 3 señales. Cusco. Adquisición de…": peso + las señales que lo explican (§10.4).
      titulo: `${severidadDeScore(a.score).etiqueta}, ${nSenales === 1 ? "1 señal" : `${nSenales} señales`}. ${lugar ?? ""}. ${a.objeto ?? ""}`.trim(),
      colorClase: FILL_SEVERIDAD[nivel],
      r: RADIO_SEVERIDAD[nivel],
      href: alertaHref(a),
    };
  });
}

/**
 * Denuncias ciudadanas reales (las de demo ya las saca `getReportes`), SÓLO con
 * su GPS. Una denuncia sin ubicación no se dibuja: antes se le inventaba un punto
 * cerca del centro de la región. Sigue contándose en su pestaña.
 */
export function puntosDeDenuncias(reportes: any[]): MapPoint[] {
  return reportes.filter(tieneUbicacion).map((r) => {
    const confirmada = estaConfirmada(r);
    return {
      id: `r-${r.id}`,
      kind: "reporte" as const,
      lat: Number(r.lat),
      lon: Number(r.lon),
      categoria: r.categoria,
      label: r.descripcion?.slice(0, 80),
      titulo: `Denuncia ciudadana ${confirmada ? "confirmada" : "en validación"}. ${r.categoria ?? ""}. ${r.descripcion ?? ""}`.trim(),
      colorClase: confirmada ? "fill-rust" : "fill-clay",
      r: 3.4,
      confirmado: confirmada,
      href: `/app/denuncias/${r.id}`,
    };
  });
}
