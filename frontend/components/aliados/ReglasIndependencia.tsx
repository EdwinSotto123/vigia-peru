import { Scale } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";

/**
 * La prueba de independencia, pegada a la lista de contratos de un aliado concreto. Las tres reglas
 * generales ("nadie elige qué se audita", "se cuenta en contratos", "conflicto de interés") ya no se
 * repiten al pie de /app/aliados: viven en /app/financiar#independencia.
 */

/**
 * La prueba de independencia donde de verdad importa: pegada a la lista de
 * contratos de un aliado concreto, no como letra chica al pie de la página.
 * Es la diferencia entre declarar la independencia y mostrarla. Una línea a la
 * vista; el mecanismo, en el ⓘ (DESIGN_SYSTEM.md §10.7).
 */
export function PruebaIndependencia({ nombre }: { nombre: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-2xl border border-granate/20 bg-granate-50 px-4 py-2.5 text-meta text-inkSoft sm:px-5">
      <Scale size={15} className="shrink-0 text-granate" aria-hidden />
      <strong className="font-semibold text-ink">{nombre} no eligió estos contratos.</strong>
      <span>Salen de la cola por antigüedad.</span>
      <Ayuda titulo="¿Cómo se asignan?">
        Al pagar se elige una región y una cantidad; los contratos concretos salen solos de la cola, por antigüedad,
        antes de que arranque la lectura. Quien los lee no recibe el nombre de quien financió, y el dictamen se
        publica igual si termina señalando a {nombre}.
      </Ayuda>
    </p>
  );
}
