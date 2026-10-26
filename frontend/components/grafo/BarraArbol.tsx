"use client";

import type { ReactNode } from "react";
import { Buscador } from "@/components/listado";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * La barra de una lista plegable del mapa de poder (`ArbolTabla`): buscador, desplegables con su conteo y orden, y
 * cuántas quedan (con «Quitar filtros») mientras se filtra. Las mismas piezas y medidas que la barra de `TablaFiltrable` del kit,
 * que no sirve aquí porque no agrupa.
 */

export interface FiltroArbol {
  clave: string;
  /** Para el lector de pantalla: "Nivel de gobierno". */
  etiqueta: string;
  /** La opción sin filtro: "Todos los niveles". */
  todas: string;
  opciones: { valor: string; etiqueta: string; n?: number }[];
}

const CAMPO =
  "h-10 w-full rounded-xl border border-line bg-paper px-3 text-dato text-ink transition-colors duration-rapido hover:border-paperEdge focus:border-granate";

export function BarraArbol({
  buscar,
  consulta,
  onConsulta,
  filtros = [],
  elegidos,
  onElegir,
  orden,
  resultado,
  onQuitar,
}: {
  buscar: { placeholder: string; etiqueta: string };
  consulta: string;
  /** Estable (useCallback): el buscador lo usa en un efecto. */
  onConsulta: (v: string) => void;
  filtros?: FiltroArbol[];
  elegidos: Record<string, string>;
  onElegir: (clave: string, valor: string) => void;
  orden?: { valor: string; opciones: { valor: string; etiqueta: string }[]; onCambio: (v: string) => void };
  /** "37 de 1,841 entidades": se muestra mientras se busca o filtra. */
  resultado?: ReactNode;
  onQuitar: () => void;
}) {
  const filtrando = !!consulta || Object.values(elegidos).some(Boolean);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-[1_1_17rem]">
          <Buscador placeholder={buscar.placeholder} etiqueta={buscar.etiqueta} valor={consulta} onBuscar={onConsulta} />
        </div>
        {filtros.map((f) => (
          <label key={f.clave} className="min-w-[11rem] flex-[0_1_14rem]">
            <span className="sr-only">{f.etiqueta}</span>
            <select
              className={cn(CAMPO, elegidos[f.clave] && "border-granate font-semibold text-granate")}
              value={elegidos[f.clave] ?? ""}
              onChange={(e) => onElegir(f.clave, e.target.value)}
            >
              <option value="">{f.todas}</option>
              {f.opciones.map((o) => (
                <option key={o.valor} value={o.valor} disabled={o.n === 0 && elegidos[f.clave] !== o.valor}>
                  {o.n != null ? `${o.etiqueta} (${numero(o.n)})` : o.etiqueta}
                </option>
              ))}
            </select>
          </label>
        ))}
        {orden && (
          <label className="ml-auto min-w-[11rem] flex-[0_1_14rem]">
            <span className="sr-only">Ordenar</span>
            <select className={CAMPO} value={orden.valor} onChange={(e) => orden.onCambio(e.target.value)}>
              {orden.opciones.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {filtrando && (
        <p className="flex flex-wrap items-center gap-2 text-meta tabular-nums text-mute" aria-live="polite">
          {resultado}
          <button
            type="button"
            className="rounded-full border border-line px-2.5 py-0.5 text-meta text-inkSoft hover:border-granate/40 hover:text-ink"
            onClick={onQuitar}
          >
            Quitar filtros
          </button>
        </p>
      )}
    </div>
  );
}
