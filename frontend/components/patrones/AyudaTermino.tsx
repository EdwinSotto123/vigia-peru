import Link from "next/link";
import { GLOSARIO, nombreTermino } from "@/lib/glosario";
import { Ayuda } from "./Ayuda";

/**
 * El "?" de un término del glosario: <AyudaTermino clave="pim" /> cuelga de un ⓘ la definición llana de ese término,
 * una sola vez definida en lib/glosario.ts. Server-safe (reusa Ayuda). Si la clave no existe, no renderiza nada —
 * así nunca rompe la vista por un término sin definir. Al pie, el enlace a /glosario con ese término ya buscado.
 */
export function AyudaTermino({ clave, ancho, className }: { clave: string; ancho?: string; className?: string }) {
  const t = GLOSARIO[clave];
  if (!t) return null;
  return (
    <Ayuda titulo={`¿Qué es ${t.termino}?`} etiqueta={`Qué es ${t.termino}`} ancho={ancho} className={className}>
      {t.definicion}
      {t.fuente ? <span className="mt-1.5 block text-rotulo text-mute">Fuente: {t.fuente}</span> : null}
      <Link
        href={`/glosario?q=${encodeURIComponent(nombreTermino(t.termino))}`}
        className="mt-1.5 block text-rotulo font-medium text-ink underline underline-offset-2 hover:text-granate"
      >
        Ver el glosario
      </Link>
    </Ayuda>
  );
}
