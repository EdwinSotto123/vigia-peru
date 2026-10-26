import { useEffect, useState } from "react";
import { PERIODOS, cargarAutoridades, type Anio, type AutoridadesDatos } from "@/lib/partidos";

/**
 * Los gobiernos de una región en las tres elecciones cargadas (2014, 2018 y 2022: mandatos 2015-2018, 2019-2022 y
 * 2023-2026), de los archivos del JNE que ya usa /app/partidos (`public/data/autoridades-<año>.json`). Los tres archivos
 * se bajan una vez por página (`cargarAutoridades` los comparte) y los usan el resumen, la historia y el árbol de
 * provincias y distritos de la ficha. Sólo para componentes de cliente.
 */

export const ANIOS: Anio[] = [2022, 2018, 2014];
export type DatosAutoridades = Partial<Record<Anio, AutoridadesDatos>>;
export const mandato = (a: Anio) => PERIODOS.find((p) => p.anio === a)?.mandato ?? String(a);

/** `undefined` mientras llegan; `null` si no llegó ninguno de los tres. */
export function useAutoridades(): DatosAutoridades | null | undefined {
  const [d, setD] = useState<DatosAutoridades | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    Promise.all(ANIOS.map((a) => cargarAutoridades(a))).then((xs) => {
      if (!vivo) return;
      const out: DatosAutoridades = {};
      ANIOS.forEach((a, i) => {
        if (xs[i]) out[a] = xs[i]!;
      });
      setD(Object.keys(out).length ? out : null);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return d;
}
