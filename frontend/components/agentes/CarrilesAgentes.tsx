"use client";

/**
 * Los carriles del DAG sin eje de tiempo: qué agentes hay, en qué rama corre cada uno y qué
 * analiza. Es la vista que sirve cuando todavía no hay ejecución (el catálogo, antes de
 * analizar) o cuando el análisis no guardó marcas de tiempo por agente — en ese caso NO se
 * dibuja una barra inventada ni se afirma que el agente "completó": se muestra lo que sí se
 * sabe, que es qué hace y cuántas señales emitió.
 */

import { useState } from "react";
import { Severidad } from "@/components/ui/Severidad";
import { cn } from "@/lib/utils";
import { PASOS, porCarril, type PasoPipeline } from "./catalogo";
import { severidadMaxima, type SenalAgente } from "./senales";

interface Props {
  pasos?: PasoPipeline[];
  /** Señales por clave de agente. Habilita el contador y convierte cada fila en filtro. */
  senalesPorAgente?: Record<string, SenalAgente[]>;
  totalSenales?: number;
  seleccion?: string | null;
  onSeleccion?: (clave: string | null) => void;
}

export function CarrilesAgentes({ pasos = PASOS, senalesPorAgente, totalSenales, seleccion, onSeleccion }: Props) {
  const [selInterna, setSelInterna] = useState<string | null>(null);
  const controlado = typeof onSeleccion === "function";
  const sel = controlado ? seleccion ?? null : selInterna;
  const elegir = (clave: string) => {
    const siguiente = sel === clave ? null : clave;
    if (controlado) onSeleccion!(siguiente);
    else setSelInterna(siguiente);
  };
  const conSenales = !!senalesPorAgente;

  return (
    <div className="min-w-0">
      {porCarril(pasos).map((c) => (
        <section key={c.key} className="mt-3 first:mt-0">
          <h4 className="border-b border-line pb-1 text-[11px] font-semibold text-inkSoft">
            Carril {c.label}
            <span className="ml-1.5 font-normal text-mute">
              {c.pasos.length} {c.pasos.length === 1 ? "paso" : "pasos"}
              {c.pasos.length > 1 && c.pasos[0].paso !== c.pasos[c.pasos.length - 1].paso ? ", en orden" : ""}
            </span>
          </h4>
          <ul className="divide-y divide-line/60">
            {c.pasos.map((p) => {
              const senales = senalesPorAgente?.[p.clave];
              const n = senales?.length ?? 0;
              const peor = severidadMaxima(senales);
              const seleccionado = sel === p.clave;
              return (
                <li key={p.clave}>
                  <button
                    type="button"
                    onClick={() => elegir(p.clave)}
                    aria-pressed={seleccionado}
                    className={cn(
                      "flex w-full items-start gap-2 px-1 py-1.5 text-left transition-colors duration-rapido",
                      "hover:bg-paperDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50",
                      seleccionado && "bg-heroViolet-soft hover:bg-heroViolet-soft",
                    )}
                  >
                    <span className="w-[6.5rem] shrink-0 sm:w-40">
                      <span className={cn("block truncate text-[12.5px] text-ink", seleccionado && "font-semibold")}>{p.nombre}</span>
                      {p.tipo === "paso" && <span className="block text-[10px] text-mute">no es un agente</span>}
                    </span>
                    <span className="min-w-0 flex-1 text-[12px] leading-snug text-mute">
                      {p.que}
                      {seleccionado && p.fuente && (
                        <span className="mt-0.5 block text-inkSoft">
                          Coteja contra: {p.fuente}
                          {p.id && <span className="ml-1.5 font-mono text-[10px] text-mute">{p.id}</span>}
                        </span>
                      )}
                    </span>
                    {conSenales && (
                      <span className="flex w-14 shrink-0 items-center justify-end gap-1 pt-0.5 text-[11px]">
                        {n > 0 && peor ? (
                          <>
                            <Severidad bandera={peor} formato="punto" />
                            <span className="font-mono tabular-nums text-ink">
                              {n}
                              {totalSenales ? <span className="text-mute">/{totalSenales}</span> : null}
                            </span>
                          </>
                        ) : (
                          <span className="text-mute">sin señales</span>
                        )}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
