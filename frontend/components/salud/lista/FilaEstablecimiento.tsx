import Link from "next/link";
import type { ReactNode } from "react";
import { Clock3, Stethoscope } from "lucide-react";
import { InsigniaCategoria, InsigniaSector } from "@/components/salud/comun";
import { Dato } from "@/components/ui/Dato";
import { rutaEn } from "@/lib/gobserva";
import { nombrePropio, numero, rutaFicha, type FilaIpress } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { lugarIpress } from "./filtros";
import { ConteoDenuncias, ConteoSanciones, InsigniaInternamiento, InsigniaQuirurgico, InsigniaRegistro } from "./Insignias";

/**
 * Una IPRESS en una lista (la lista, la búsqueda): su categoría, sector y estado en RENIPRESS arriba; el nombre (toda la
 * tarjeta lleva a su ficha); dónde está, su código y qué es; y los hechos que tiene, cada uno con su rótulo: sanciones
 * firmes y denuncias (nunca juntas en una sola cifra), y el centro quirúrgico cuando se sabe. En escritorio los hechos van
 * a la derecha; en el celular, debajo. Server-safe.
 */
export function FilaEstablecimiento({ x, base, children, className }: { x: FilaIpress; base: string; children?: ReactNode; className?: string }) {
  const nombre = nombrePropio(x.nombre) || `IPRESS ${x.codigo}`;
  const hechos = x.sanciones > 0 || (x.denuncias ?? 0) > 0;
  return (
    <article
      className={cn(
        "group relative grid min-w-0 gap-x-6 gap-y-3 rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido focus-within:border-granate/50 hover:border-granate/40 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto]",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <InsigniaCategoria categoria={x.categoria} />
          <InsigniaSector sector={x.sector} />
          <InsigniaRegistro activo={x.activo} estado={x.estado} />
        </div>
        <h3 className="mt-2 text-bloque font-display font-bold leading-snug text-ink">
          <Link
            href={rutaEn(base, rutaFicha(x.codigo))}
            prefetch={false}
            className="line-clamp-2 rounded-sm underline-offset-4 after:absolute after:inset-0 after:rounded-2xl after:content-[''] group-hover:text-granate focus-visible:outline-none"
          >
            {nombre}
          </Link>
        </h3>
        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft">
          <Dato tipo="lugar">{lugarIpress(x)}</Dato>
          <Dato tipo="codigo" nombre="Código IPRESS" mono>
            {x.codigo}
          </Dato>
          {x.clasificacion && <Dato tipo="tipo">{nombrePropio(x.clasificacion)}</Dato>}
          {x.horario && /24\s*H/i.test(x.horario) && (
            <Dato icono={Clock3} nombre="Horario">
              Atiende las 24 horas
            </Dato>
          )}
          {x.medicos ? (
            <Dato icono={Stethoscope} nombre="Médicos que declaró a SUSALUD">
              {x.medicos === 1 ? "1 médico" : `${numero(x.medicos)} médicos`}
            </Dato>
          ) : null}
        </p>
        {children}
      </div>
      {(hechos || x.quirurgico != null || x.internamiento) && (
        <div className="flex flex-wrap content-start items-start gap-1.5 md:max-w-[20rem] md:justify-end">
          {x.sanciones > 0 && <ConteoSanciones n={x.sanciones} />}
          {(x.denuncias ?? 0) > 0 && <ConteoDenuncias n={x.denuncias ?? 0} anio={x.denunciasDe} />}
          <InsigniaQuirurgico quirurgico={x.quirurgico} />
          {x.internamiento && <InsigniaInternamiento />}
        </div>
      )}
    </article>
  );
}
