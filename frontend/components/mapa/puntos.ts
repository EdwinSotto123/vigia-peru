/**
 * Los puntos que el mapa dibuja encima del coroplético: contratos de riesgo
 * medio o alto y denuncias ciudadanas. Funciones puras (sin React): el
 * contenedor (MapaWrapper) las llama dentro de un `useMemo`.
 *
 * La clasificación es de `lib/severidad`; acá sólo se traduce a relleno SVG. Y
 * la palabra viaja con el punto (`titulo`): el color solo nunca basta.
 */

import type { MapPoint } from "@/components/PeruChoropleth";
import type { ApiAlertaPunto } from "@/lib/api-client";
import { estaConfirmada, tieneUbicacion } from "@/lib/denuncias-meta";
import { nivelDeScore, severidadDeScore, type NivelSeveridad } from "@/lib/severidad";
import { UBIGEO_REGION, nombreDepartamento } from "./region-match";
import { PROVINCIA_NOMBRE } from "./provincias";
import { alertaHref, esBajoPesoPorConteo, esSenalPorConteo, zonaDeAlerta } from "./senales";

/**
 * Una alerta publicada, tal como la usa el mapa (puntos y conteos por zona), venga de
 * `GET /alertas/puntos` (todas, en filas mínimas) o de la lista `/alertas` (COMPAT-API-VIEJA).
 */
export interface AlertaMapa {
  id: string;
  href: string;
  lat: number | null;
  lon: number | null;
  /** Provincia (4 díg.) si se reconoce; si no, departamento (2 díg.); si no, null. */
  zona: string | null;
  score: number;
  /** Señales publicadas del contrato. */
  nBanderas: number;
  /** Objeto del contrato: sólo lo trae la lista vieja; los puntos nuevos no lo necesitan. */
  objeto: string | null;
}

/** Las alertas del mapa y si son TODAS (con la API vieja pueden llegar recortadas). */
export interface AlertasMapa {
  alertas: AlertaMapa[];
  /** `false` = la lista llegó recortada: sus conteos no son totales (se dicen parciales). */
  completo: boolean;
}

/** Zona más fina que se puede afirmar de un ubigeo: provincia conocida, si no departamento. */
function zonaDeUbigeo(ubigeo: string | null): string | null {
  if (!ubigeo) return null;
  if (ubigeo.length >= 4 && PROVINCIA_NOMBRE[ubigeo.slice(0, 4)]) return ubigeo.slice(0, 4);
  return UBIGEO_REGION[ubigeo.slice(0, 2)] ? ubigeo.slice(0, 2) : null;
}

/** Fila de `GET /alertas/puntos` → alerta del mapa. */
export function alertaMapaDesdePunto(p: ApiAlertaPunto): AlertaMapa {
  return {
    id: p.codigo,
    href: alertaHref({ codigoconvocatoria: p.convocatoria, codigo: p.codigo }),
    lat: p.lat,
    lon: p.lon,
    zona: zonaDeUbigeo(p.ubigeo),
    score: p.score,
    nBanderas: p.nBanderas,
    objeto: null,
  };
}

/** COMPAT-API-VIEJA: fila de la lista `/alertas` → alerta del mapa (la provincia viene en `region`). */
export function alertaMapaDesdeLista(a: any): AlertaMapa {
  return {
    id: String(a.id || a.codigo),
    href: alertaHref(a),
    lat: typeof a.lat === "number" ? a.lat : null,
    lon: typeof a.lon === "number" ? a.lon : null,
    zona: zonaDeAlerta(a),
    score: typeof a.score === "number" ? a.score : 0,
    nBanderas: Array.isArray(a.banderas) ? a.banderas.length : 0,
    objeto: typeof a.objeto === "string" ? a.objeto : null,
  };
}

/** Conteos de un departamento sobre TODAS las alertas del mapa: con señales, de riesgo medio o alto y de bajo peso. */
export function conteosDeDepartamento(alertas: AlertaMapa[], ubigeo: string): { conSenales: number; senales: number; bajas: number } {
  let conSenales = 0;
  let senales = 0;
  let bajas = 0;
  for (const a of alertas) {
    if (a.zona?.slice(0, 2) !== ubigeo) continue;
    // "Con señales" (§10.1, como `tieneSenales`): al menos una señal publicada, de cualquier peso.
    if (a.nBanderas > 0) conSenales++;
    if (esSenalPorConteo(a.score, a.nBanderas)) senales++;
    else if (esBajoPesoPorConteo(a.score, a.nBanderas)) bajas++;
  }
  return { conSenales, senales, bajas };
}

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
 * Un punto por contrato de riesgo medio o alto: en sus coordenadas si las trae, si no
 * anclado a su provincia (o a su departamento). Antes se buscaba en una tabla de 25
 * capitales y las que no eran capital (45 de 94) no se dibujaban, y a las demás se les
 * sumaba un desplazamiento de hasta 33 km que dejaba puntos en el mar.
 */
export function puntosDeSenales(alertas: AlertaMapa[]): MapPoint[] {
  const senales = alertas
    .filter((a) => esSenalPorConteo(a.score, a.nBanderas))
    .filter((a) => a.zona || (a.lat != null && a.lon != null))
    .sort((x, y) => y.score - x.score);
  const n = new Map<string, number>();
  for (const a of senales) if (a.zona) n.set(a.zona, (n.get(a.zona) ?? 0) + 1);
  const i = new Map<string, number>();
  return senales.map((a) => {
    const nivel = nivelDeScore(a.score);
    const conGps = a.lat != null && a.lon != null;
    const zona = a.zona;
    const idx = zona ? i.get(zona) ?? 0 : 0;
    if (zona) i.set(zona, idx + 1);
    const lugar = zona ? (zona.length === 4 ? PROVINCIA_NOMBRE[zona] ?? null : nombreDepartamento(zona)) : null;
    // "Riesgo alto, 3 señales. Cusco. Adquisición de…": peso + las señales que lo explican (§10.4).
    const titulo = [`${severidadDeScore(a.score).etiqueta}, ${a.nBanderas === 1 ? "1 señal" : `${a.nBanderas} señales`}`, lugar, a.objeto]
      .filter((p): p is string => !!p)
      .join(". ");
    return {
      id: `a-${a.id}`,
      kind: "alerta" as const,
      ...(conGps ? { lat: a.lat as number, lon: a.lon as number } : { zona: zona ?? undefined, grupo: zona ? { i: idx, n: n.get(zona) ?? 1 } : undefined }),
      score: a.score,
      label: a.objeto?.slice(0, 80) ?? lugar ?? undefined,
      titulo,
      colorClase: FILL_SEVERIDAD[nivel],
      r: RADIO_SEVERIDAD[nivel],
      href: a.href,
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
