import { ArrowUpRight } from "lucide-react";
import { fechaHoraLima, fechaLargaLima, instante } from "@/lib/licitaciones-app/formato";
import type { DetalleOportunidad } from "@/lib/licitaciones-app/tipos";
import { Caja } from "@/components/gobserva/app/Caja";
import { cn } from "@/lib/utils";
import { InsigniaVence } from "../ui/Insignia";
import { BotonIcs } from "./BotonIcs";

/**
 * El cronograma: los pasos con la fecha que publicó la entidad en los datos abiertos y, los que no vienen ahí (bases
 * integradas, ofertas, buena pro), con el enlace al cronograma oficial. No inventamos fechas.
 */
export function PestanaCronograma({ o, ahora }: { o: DetalleOportunidad; ahora: number }) {
  const conFecha = o.cronograma.filter((h) => h.fecha);
  return (
    <Caja
      id="crono"
      titulo="Cronograma"
      descripcion="Lo que publicó la entidad en los datos abiertos del OECE"
      accion={<BotonIcs id={o.id} codigo={o.codigo} hitos={conFecha.map((h) => ({ clave: h.clave, etiqueta: h.etiqueta, fecha: h.fecha! }))} url={o.enlaces.seace} />}
      pie={
        <p className="py-1 text-meta leading-relaxed text-mute">
          La presentación de ofertas y la buena pro no vienen en los datos abiertos. Están en el{" "}
          <a href={o.enlaces.seace} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline-offset-4 hover:underline">
            cronograma oficial del proceso
          </a>
          .
        </p>
      }
    >
      <ol className="relative">
        {o.cronograma.map((h, i) => {
          const pasado = h.fecha ? instante(h.fecha) < ahora : false;
          return (
            <li key={h.clave} className="relative flex gap-4 pb-6 last:pb-0">
              {i < o.cronograma.length - 1 && <span aria-hidden className="absolute left-[0.6875rem] top-6 h-[calc(100%-1rem)] w-px bg-line" />}
              <span
                aria-hidden
                className={cn(
                  "relative mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2",
                  !h.fecha ? "border-dashed border-line bg-caja" : pasado ? "border-granate bg-granate" : "border-granate bg-caja",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className={cn("text-dato font-semibold", h.fecha ? "text-ink" : "text-inkSoft")}>{h.etiqueta}</p>
                {h.fecha ? (
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-meta text-inkSoft">
                    {h.fecha.length === 10 ? fechaLargaLima(h.fecha) : fechaHoraLima(h.fecha)}
                    {h.clave === "consultas_hasta" && <InsigniaVence iso={h.fecha} ahora={ahora} />}
                  </p>
                ) : (
                  <a href={o.enlaces.seace} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-meta font-medium text-granate underline-offset-4 hover:underline">
                    En el cronograma oficial <ArrowUpRight size={13} aria-hidden />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Caja>
  );
}
