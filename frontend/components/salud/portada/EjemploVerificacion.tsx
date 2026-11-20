import { Building2 } from "lucide-react";
import { InsigniaCategoria, InsigniaEstado, InsigniaHecho } from "@/components/salud/comun";
import { Ejemplo } from "@/components/licitaciones/portada/Maquetas";
import { fechaCorta, type EstadoChequeo, type TipoHecho } from "@/lib/gobserva-salud";

/**
 * Cómo se ve la verificación de un establecimiento, en el héroe de la portada: una maqueta marcada «Ejemplo» con un
 * establecimiento genérico («Una clínica de Lima»), armada con las mismas insignias que la ficha. Las fechas son las de
 * las fuentes de hoy: así el ejemplo dice lo mismo que diría la ficha. Server-safe.
 */
export function EjemploVerificacion({ renipressAl, sancionesAl }: { renipressAl: string | null; sancionesAl: string | null }) {
  const ren = renipressAl ? fechaCorta(renipressAl) : "el último viernes";
  const san = sancionesAl ? fechaCorta(sancionesAl) : "el último viernes";
  const chequeos: { estado: EstadoChequeo; tipo: TipoHecho; titulo: string; detalle: string }[] = [
    { estado: "ok", tipo: "registro_administrativo", titulo: "Registro en RENIPRESS", detalle: `Figura como activa (archivo revisado el ${ren}).` },
    {
      estado: "atencion",
      tipo: "registro_administrativo",
      titulo: "Centro quirúrgico",
      detalle: "No le registra una unidad de centro quirúrgico activa. Si te ofrecen una cirugía aquí, pregunta dónde se hará.",
    },
    { estado: "ok", tipo: "sancion_firme", titulo: "Sanciones firmes", detalle: `No figura en el Registro de Sanciones de SUSALUD revisado el ${san}.` },
    {
      estado: "externo",
      tipo: "verificacion_externa",
      titulo: "Responsable de la atención",
      detalle: "Un médico con colegiatura registrada. Su habilitación la confirma el Colegio Médico.",
    },
  ];
  return (
    <figure className="min-w-0 overflow-hidden rounded-2xl border border-line bg-paper text-ink shadow-dialog">
      <figcaption className="flex items-center justify-between gap-3 border-b border-line bg-paperSoft px-4 py-2.5">
        <span className="text-meta font-semibold text-inkSoft">Así se ve una verificación</span>
        <Ejemplo />
      </figcaption>
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
            <Building2 size={19} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-bloque font-bold leading-tight text-ink">Un centro médico de Lima</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <InsigniaCategoria categoria="I-3" />
              <span className="text-meta text-inkSoft">Centro de salud sin internamiento</span>
            </p>
          </div>
        </div>
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {chequeos.map((c) => (
            <li key={c.titulo} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-dato font-semibold text-ink">{c.titulo}</span>
                <InsigniaEstado estado={c.estado} />
              </div>
              <p className="mt-1 text-meta leading-snug text-inkSoft">{c.detalle}</p>
              <InsigniaHecho tipo={c.tipo} className="mt-1.5" />
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
