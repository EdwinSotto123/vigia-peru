import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Paginación por cursor (keyset): "Anterior / Siguiente" y cuántos se ven de cuántos.
 *
 * Hermana de `Paginacion` (mismo lugar en la barra, mismos tamaños): con un cursor no se
 * sabe en qué página número está la lista, así que no se inventa un "3 / 368". El texto lo
 * arma quien la usa ("1–50 de 18,393" en la primera página, "50 de 10,000+" después).
 *
 * Sin estado ni efectos: sirve igual desde un server component que desde uno cliente.
 * Recibe los `href` ya armados (datos, nunca funciones); `null` = no hay más en ese sentido.
 * `prefetch={false}`: la página siguiente se pide al hacer clic, no por estar a la vista.
 */
export function PaginacionCursor({
  texto,
  anterior,
  siguiente,
}: {
  texto: string;
  anterior: string | null;
  siguiente: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-[12px] text-mute">
      {/* Sin aria-live: la vista muestra dos paginadores (arriba y abajo). */}
      <span className="font-mono tabular-nums">{texto}</span>
      <span className="inline-flex items-center gap-1.5">
        <Paso href={anterior}>
          <ChevronLeft size={13} aria-hidden />
          Anterior
        </Paso>
        <Paso href={siguiente}>
          Siguiente
          <ChevronRight size={13} aria-hidden />
        </Paso>
      </span>
    </div>
  );
}

const PASO =
  "inline-flex h-8 items-center gap-1 rounded-full border border-line bg-paper px-3 text-[12px] font-medium text-ink transition-colors duration-rapido hover:bg-paperDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2";

/** El texto visible ("Anterior", "Siguiente") es el nombre accesible: sin aria-label que lo contradiga. */
function Paso({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) {
    return (
      <span aria-disabled="true" className={`${PASO} pointer-events-none opacity-40`}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} prefetch={false} scroll={false} className={PASO}>
      {children}
    </Link>
  );
}
