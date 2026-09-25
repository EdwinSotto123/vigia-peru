"use client";

/**
 * Los análisis publicados dentro del panel del equipo (/admin/analisis): la MISMA lista que
 * /app/convocatoria —mismas piezas del kit, mismos filtros en la URL, mismos conteos— pero
 * armada en el cliente, porque la página del panel no le pasa `searchParams`.
 */

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { BarraFiltros, Listado, ZonaResultados } from "@/components/listado";
import { getAnalyzedList } from "@/lib/dossier-cache";
import {
  analisisQueryParams,
  esAnalisisPublicado,
  filtrarAnalisis,
  ordenarAnalisis,
  parseAnalisisQuery,
  TOPE_API,
  type AnalisisPublicado,
} from "../analisisPublicados";
import { barraAnalisis, TablaAnalisis, TablaAnalisisSkeleton } from "../TablaAnalisis";

export function AnalisisPublicadosPanel() {
  const ruta = usePathname() || "/admin/analisis";
  const query = parseAnalisisQuery(useSearchParams());
  const [items, setItems] = useState<AnalisisPublicado[] | null>(null);
  const [parcial, setParcial] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  useEffect(() => {
    getAnalyzedList(500)
      .then((d) => {
        if (d?.error) return setFallo(String(d.detail || d.error));
        const crudos: unknown[] = Array.isArray(d?.items) ? d.items : [];
        setItems(crudos.filter(esAnalisisPublicado));
        setParcial(crudos.length >= TOPE_API);
      })
      .catch((e) => setFallo((e as Error)?.message || "sin conexión"));
  }, []);

  return (
    <section aria-labelledby="publicados-titulo" className="space-y-3">
      <h2 id="publicados-titulo" className="font-display text-[20px] font-bold leading-tight text-ink">
        Análisis publicados
      </h2>
      {!items && !fallo ? (
        <TablaAnalisisSkeleton />
      ) : (
        <Listado ruta={ruta} parametros={analisisQueryParams(query)}>
          {items && items.length > 0 && <BarraFiltros {...barraAnalisis(items, query)} />}
          <ZonaResultados>
            <TablaAnalisis
              universo={items ?? []}
              filtrados={ordenarAnalisis(filtrarAnalisis(items ?? [], query), query)}
              query={query}
              ruta={ruta}
              parcial={parcial}
              fallo={fallo}
            />
          </ZonaResultados>
        </Listado>
      )}
    </section>
  );
}
