"use client";

import { HelpCircle } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import { ContratoPinLeyenda } from "@/components/contratos/ContratoPin";
import { SIN_DATO, SIN_DATO_TRAMA, type Escala, type Medida } from "./escala";

/** Mismo rayado que el patrón `sin-dato` del SVG, para que la leyenda y el mapa coincidan. */
const RAYADO = `repeating-linear-gradient(45deg, ${SIN_DATO} 0 3px, ${SIN_DATO_TRAMA} 3px 4px)`;

/**
 * Leyenda del coropleto. Vive **en la barra de filtros**, no flotando sobre el
 * lienzo: las dos leyendas apiladas que había antes sumaban diez entradas en
 * `position:absolute` y tapaban Áncash y Lima, que son justo las zonas más
 * densas del mapa.
 *
 * Y publica el **valor de cada corte**. Seis cuadraditos sin un número no son
 * una leyenda: son una decoración que obliga a adivinar si el tono oscuro son
 * diez contratos o diez mil.
 */
export function LeyendaEscala({
  escala,
  medida,
  ambito,
  conPines,
  cargando,
}: {
  escala: Escala;
  medida: Medida;
  /** "los 25 departamentos", "las 20 provincias de Áncash": sobre qué se calcularon los cortes. */
  ambito: string;
  /** Con un departamento abierto también hay puntos por distrito: se explican aparte. */
  conPines?: boolean;
  cargando?: boolean;
}) {
  return (
    // La ayuda va al costado y no en una fila propia: en 390 px esa fila sola
    // empujaba el mapa 40 px más abajo.
    <div className="flex items-start justify-between gap-x-3 sm:items-end sm:justify-start sm:gap-x-5">
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-baseline gap-x-3 text-[11px] text-mute">
          <span className="font-medium text-inkSoft">{medida.titulo}</span>
          {cargando ? (
            <span className="inline-block h-3 w-40 animate-pulse rounded bg-paperEdge" aria-hidden />
          ) : escala.tramos.length > 1 ? (
            <span>
              {escala.tramos.length} tonos de añil, de menos a más, sobre {ambito}
            </span>
          ) : null}
        </div>

        {cargando ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1" aria-hidden>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className="inline-block h-3.5 w-16 animate-pulse rounded bg-paperEdge" />
            ))}
          </div>
        ) : escala.vacia ? (
          <div className="flex items-center gap-1.5 text-[11px] text-mute">
            <span className="inline-block h-3 w-6 shrink-0 rounded-sm border border-paperEdge" style={{ background: RAYADO }} />
            Sin dato en ninguna zona
          </div>
        ) : (
          // Chips y no una rampa con números debajo: los rótulos de una rampa se
          // pisan entre sí en cuanto un corte tiene siete dígitos, y este mapa
          // pasa de "59" a "S/ 5,7 mil M" según la medida elegida.
          // Tres columnas, no una tira que envuelve. Con cortes de siete dígitos
          // ("≥ S/ 1,1 mil M") la tira se rompía a una entrada por línea y la
          // leyenda pasaba a ocupar seis renglones. En rejilla, los seis valores
          // entran en dos filas y —lo que más importa— quedan alineados en
          // columna, que es lo que permite comparar un corte con el siguiente de
          // un vistazo en vez de leerlos uno por uno.
          <ul className="grid w-fit grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 sm:gap-x-5">
            {escala.tramos.map((t, i) => (
              <li
                key={t.color + i}
                className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-mute"
                title={`De ${medida.formato(t.desde)} a ${medida.formato(t.hasta)}`}
              >
                <span className="inline-block h-3 w-5 shrink-0 rounded-sm" style={{ background: t.color }} />
                <span className="font-mono tabular-nums">
                  {i === 0 ? "" : "≥ "}
                  {medida.formato(t.desde)}
                </span>
              </li>
            ))}
            {/* "Sin dato" nombrado y rayado: no es el escalón más bajo. */}
            <li className="inline-flex items-center gap-1.5 text-[11px] text-mute">
              <span className="inline-block h-3 w-5 shrink-0 rounded-sm border border-paperEdge" style={{ background: RAYADO }} />
              Sin dato
            </li>
          </ul>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <Popover
          titulo={medida.titulo}
          anchoClase="w-80"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-mute transition-colors duration-rapido hover:bg-paperSoft hover:text-granate"
          trigger={
            <>
              <HelpCircle size={15} aria-hidden />
              <span className="sr-only">Qué mide esta escala</span>
            </>
          }
        >
          <p>{medida.ayuda}</p>
          <p className="mt-2 text-mute">
            Los cortes reparten {ambito} en grupos de tamaño parecido: cada tono junta más o menos la misma cantidad de
            zonas. Con cortes parejos, Lima, que sola concentra casi un tercio del valor convocado, dejaba a 21 de los 25
            departamentos en el mismo tono y el mapa se veía de un solo color.
          </p>
          <p className="mt-2 text-mute">
            Rayado = todavía no tenemos la cifra de esa zona (está cargando o el servicio no respondió). Es distinto de
            cero: cero sí es un dato.
          </p>
        </Popover>

        {conPines && (
          <Popover
            titulo="Los puntos del mapa"
            anchoClase="w-80"
            className="rounded-full border border-line bg-paperDeep px-2.5 py-1 text-[11px] text-inkSoft transition-colors duration-rapido hover:bg-paper hover:text-ink"
            trigger={<>Puntos por distrito</>}
          >
            <ContratoPinLeyenda />
          </Popover>
        )}
      </div>
    </div>
  );
}
