"use client";

import { Palette } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import { Ayuda } from "@/components/patrones/Ayuda";
import { ContratoPinLeyenda } from "@/components/contratos/ContratoPin";
import { useModo } from "@/lib/modo";
import { paletaMapa, type Escala, type Medida } from "./escala";

/** Mismo rayado que el patrón `sin-dato` del SVG, para que la leyenda y el mapa coincidan (y su modo de color). */
function useRayado(): string {
  const { sinDato, trama } = paletaMapa(useModo());
  return `repeating-linear-gradient(45deg, ${sinDato} 0 3px, ${trama} 3px 4px)`;
}

interface Props {
  escala: Escala;
  medida: Medida;
  /** "los 25 departamentos", "las 20 provincias de Áncash": sobre qué se calcularon los cortes. */
  ambito: string;
  /** Con un departamento abierto también hay puntos por distrito: se explican aparte. */
  conPines?: boolean;
  cargando?: boolean;
}

/**
 * Leyenda del coropleto, SUPERPUESTA en la esquina inferior izquierda del lienzo (el Pacífico: ahí no hay
 * departamentos que tapar). Antes vivía en la barra de filtros y, con el resto de la barra, empujaba el mapa fuera de la
 * primera pantalla. Es UNA sola leyenda, chica: las dos apiladas de antes tapaban Áncash y Lima.
 *
 * Publica el **valor de cada corte**: seis cuadraditos sin un número no son una leyenda, son una decoración que obliga
 * a adivinar si el tono oscuro son diez contratos o diez mil. Cuántos tonos hay, sobre qué zonas se cortaron y qué es el
 * rayado van en el ⓘ.
 *
 * En el celular, plegada en un botón «Leyenda»: desplegada tapaba la costa sur.
 */
export function LeyendaEscala(props: Props) {
  return (
    <>
      <div className="sm:hidden">
        <Popover
          titulo={props.medida.titulo}
          anchoClase="w-72"
          className="min-h-[36px] gap-1.5 rounded-full border border-line bg-paper/95 px-3 py-1.5 text-rotulo font-semibold text-ink shadow-card"
          trigger={
            <>
              <Palette size={14} aria-hidden /> Leyenda
            </>
          }
        >
          <Cuerpo {...props} plegada />
        </Popover>
      </div>
      <div className="hidden max-w-[22rem] rounded-xl border border-line bg-paper/95 px-3 py-2.5 shadow-card backdrop-blur-sm sm:block">
        <Cuerpo {...props} />
      </div>
    </>
  );
}

/** El contenido de la leyenda. `plegada`: dentro del flotante del celular, sin ⓘ ni flotantes adentro (todo a la vista). */
function Cuerpo({ escala, medida, ambito, conPines, cargando, plegada = false }: Props & { plegada?: boolean }) {
  const RAYADO = useRayado();
  const explicacion = (
    <>
      <span className="block">{medida.ayuda}</span>
      <span className="mt-2 block text-mute">
        {!cargando && escala.tramos.length > 1 ? `${escala.tramos.length} tonos, de menos a más. ` : ""}
        Los cortes reparten {ambito} en grupos de tamaño parecido: cada tono junta más o menos la misma cantidad de zonas.
        Con cortes parejos, Lima, que sola concentra casi un tercio del valor convocado, dejaba a 21 de los 25
        departamentos en el mismo tono.
      </span>
      <span className="mt-2 block text-mute">
        Rayado = todavía no tenemos la cifra de esa zona (está cargando o el servicio no respondió). Es distinto de cero:
        cero sí es un dato.
      </span>
    </>
  );
  return (
    <span className="block">
      {!plegada && (
        <span className="mb-1 flex items-center gap-0.5 text-micro">
          <span className="font-medium text-inkSoft">{medida.titulo}</span>
          <Ayuda titulo={medida.titulo} etiqueta="Qué mide esta escala">
            {explicacion}
          </Ayuda>
        </span>
      )}

      {cargando ? (
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="inline-block h-3.5 w-16 animate-pulse rounded bg-paperEdge" />
          ))}
        </span>
      ) : escala.vacia ? (
        <span className="flex items-center gap-1.5 text-micro text-mute">
          <span className="inline-block h-3 w-6 shrink-0 rounded-sm border border-paperEdge" style={{ background: RAYADO }} />
          Sin dato en ninguna zona
        </span>
      ) : (
        // Chips en rejilla y no una rampa con números debajo: los rótulos de una rampa se pisan en cuanto un corte tiene
        // siete dígitos («≥ S/ 1,1 mil M»). En columnas, los valores quedan alineados y se comparan de un vistazo.
        <span className="grid w-fit grid-cols-2 gap-x-4 gap-y-1">
          {escala.tramos.map((t, i) => (
            <span
              key={t.color + i}
              className="inline-flex items-center gap-1.5 whitespace-nowrap text-micro text-mute"
              title={`De ${medida.formato(t.desde)} a ${medida.formato(t.hasta)}`}
            >
              <span className="inline-block h-3 w-5 shrink-0 rounded-sm" style={{ background: t.color }} />
              <span className="font-mono tabular-nums">
                {i === 0 ? "" : "≥ "}
                {medida.formato(t.desde)}
              </span>
            </span>
          ))}
          {/* "Sin dato" nombrado y rayado: no es el escalón más bajo. */}
          <span className="inline-flex items-center gap-1.5 text-micro text-mute">
            <span className="inline-block h-3 w-5 shrink-0 rounded-sm border border-paperEdge" style={{ background: RAYADO }} />
            Sin dato
          </span>
        </span>
      )}

      {plegada ? (
        <span className="mt-3 block border-t border-line pt-2 text-rotulo leading-snug text-inkSoft">
          {explicacion}
          {conPines && (
            <span className="mt-2 block border-t border-line pt-2">
              <span className="mb-1 block font-semibold text-ink">Los puntos por distrito</span>
              <ContratoPinLeyenda />
            </span>
          )}
        </span>
      ) : (
        conPines && (
          <span className="mt-2 block">
            <Popover
              titulo="Los puntos del mapa"
              anchoClase="w-80"
              className="min-h-[28px] rounded-full border border-line bg-paperDeep px-2.5 py-1 text-micro text-inkSoft transition-colors duration-rapido hover:bg-paper hover:text-ink"
              trigger={<>Puntos por distrito</>}
            >
              <ContratoPinLeyenda />
            </Popover>
          </span>
        )
      )}
    </span>
  );
}
