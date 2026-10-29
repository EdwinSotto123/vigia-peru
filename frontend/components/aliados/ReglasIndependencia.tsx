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
 *
 * El texto corre como una oración y el ⓘ va pegado a su última palabra: antes cada trozo era un elemento de una fila
 * flexible y, en la columna angosta del Resumen, el ⓘ caía solo en su propio renglón. Pegado con `inline-flex` y no con
 * `whitespace-nowrap`, que heredaría el texto del ⓘ abierto (vive en el mismo lugar del DOM) y no lo dejaría partirse.
 */
export function PruebaIndependencia({ nombre }: { nombre: string }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl border border-granate/20 bg-granate-50 px-4 py-2.5 text-meta leading-snug text-inkSoft sm:px-5">
      <Scale size={15} className="mt-0.5 shrink-0 text-granate" aria-hidden />
      <span className="min-w-0">
        <strong className="font-semibold text-ink">{nombre} no eligió estos contratos.</strong> Salen de la cola por{" "}
        {/* `-my-1`: el botón del ⓘ mide 24 px y, sin esto, su renglón quedaba más alto que los demás. */}
        <span className="-my-1 inline-flex items-center gap-1">
          antigüedad.
          <Ayuda titulo="¿Cómo se asignan?">
            Al pagar se elige una región y una cantidad; los contratos concretos salen solos de la cola, por antigüedad,
            antes de que arranque la lectura. Quien los lee no recibe el nombre de quien financió, y el dictamen se
            publica igual si termina señalando a {nombre}.
          </Ayuda>
        </span>
      </span>
    </p>
  );
}
