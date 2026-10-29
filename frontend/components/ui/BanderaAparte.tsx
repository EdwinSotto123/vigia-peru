import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import { cn } from "@/lib/utils";

/**
 * Un monto que va aparte de un total porque puede ser un error de quien lo cargó (migración 102), como bandera chica en
 * el contexto de una cifra: el monto en ámbar, con la forma de `BanderaDato`, y al tocarlo, qué registros son y por qué
 * no se suman (un flotante y no un `title`: el `title` no existe en el celular ni con teclado).
 *
 * Antes era la cola de la frase («…; aparte, S/ 1.6 billones en 412 órdenes con posible error de CONOSCE») y hacía del
 * contexto de una tarjeta de cifras un párrafo de cuatro o cinco renglones. Va en su propio renglón, debajo del primer dato.
 *
 * Server-safe: el flotante (isla de cliente) recibe el texto ya armado.
 */
export function BanderaAparte({
  monto,
  titulo,
  children,
  className,
}: {
  /** El monto que queda fuera del total, ya formateado: «S/ 1.6 billones». */
  monto: string;
  /** Quién lo cargó con el posible error, como en `BanderaDato`: «Posible error de CONOSCE». Es el título del flotante. */
  titulo: string;
  /** Qué registros son y por qué no se suman: texto o `<span className="block">`, nunca `<p>`. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <Popover
      titulo={titulo}
      anchoClase="w-72"
      className={cn(
        "pill flex w-fit max-w-full gap-1 border-amber/30 bg-amber-soft text-left text-amberTexto transition-colors duration-rapido hover:border-amber/60",
        className,
      )}
      trigger={
        <>
          <TriangleAlert size={12} strokeWidth={2.25} className="shrink-0" aria-hidden />
          <span className="min-w-0">{monto} aparte</span>
          <span className="sr-only"> ({titulo})</span>
        </>
      }
    >
      {children}
    </Popover>
  );
}
