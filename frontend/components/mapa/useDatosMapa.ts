"use client";

import { useEffect, useState } from "react";
import { getContratos, type ContratoResumen } from "@/lib/contratos";
import { getCifrasAnio, type CifrasAnio } from "@/lib/cifras";
import { ANIO_GOBIERNO_VIGENTE, getRankingPartidos } from "@/lib/partidosApi";

const REINTENTO_MS = 12_000;

/**
 * Lo que el mapa pide una vez, aparte de su geografía y sus capas:
 *   · los contratos de mayor puntaje (`/contratos?orden=score`) para «Los de mayor peso del riesgo», con su valor
 *     referencial y su bandera de dato dudoso;
 *   · las cifras del año (`lib/cifras`), las mismas del Inicio y de financiar, para la cabecera de «Todo el Perú»;
 *   · los partidos que gobiernan hoy, para el desplegable «Partido que gobierna».
 *
 * Si los dos primeros no responden se reintenta cada 12 s, y mientras tanto se dice (nunca un cero).
 */
export function useDatosMapa() {
  const [topContratos, setTopContratos] = useState<ContratoResumen[] | null>(null);
  const [falloTop, setFalloTop] = useState(false);
  /** `undefined` = cargando; `null` = no respondió. */
  const [cifrasAnio, setCifrasAnio] = useState<CifrasAnio | null | undefined>(undefined);
  /** `null` = cargando. */
  const [partidos, setPartidos] = useState<{ clave: string; nombre: string }[] | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    let reintento: number | null = null;
    Promise.all([getContratos({ orden: "score", size: 12 }), getCifrasAnio()]).then(([top, cifras]) => {
      if (!vivo) return;
      if (top) setTopContratos(top.data ?? []);
      setFalloTop(!top);
      setCifrasAnio(cifras);
      if (!top || !cifras) reintento = window.setTimeout(() => setIntento((i) => i + 1), REINTENTO_MS);
    });
    return () => {
      vivo = false;
      if (reintento != null) window.clearTimeout(reintento);
    };
  }, [intento]);

  useEffect(() => {
    let vivo = true;
    getRankingPartidos(ANIO_GOBIERNO_VIGENTE, { limit: 100 })
      .then((r) => vivo && setPartidos((r?.data ?? []).map((p) => ({ clave: p.clave, nombre: p.nombre }))))
      .catch(() => vivo && setPartidos([]));
    return () => {
      vivo = false;
    };
  }, []);

  return { topContratos, falloTop, cifrasAnio, partidos };
}
