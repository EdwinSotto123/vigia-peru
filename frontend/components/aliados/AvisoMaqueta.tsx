import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { CANTIDAD_MAQUETA, NOMBRES_MAQUETA } from "@/lib/maqueta-aliados";
import { numero } from "@/lib/formato";

/**
 * El aviso de que lo que se está mirando no es real.
 *
 * No es una nota al pie ni un `title=""`: en un producto que acusa
 * públicamente de falta de transparencia, un dato inventado que se vea como
 * real lo destruye. Así que el aviso va arriba de todo, dice los nombres
 * exactos de lo que es falso, dice que las cifras de la página los incluyen, y
 * ofrece la salida en un clic.
 *
 * La versión `compacta` viaja en la barra pegajosa: mientras el usuario
 * recorre el muro, el recordatorio no se va de la pantalla.
 */

const num = numero;

export function AvisoMaqueta({
  volverHref,
  financiados,
  leidos,
}: {
  /** URL de la misma vista con `?maqueta=0` (en desarrollo, sin parámetro la maqueta vuelve a encenderse). */
  volverHref: string;
  /** Contratos de maqueta sumados a la cascada de esta página. */
  financiados?: number;
  /** Lecturas de maqueta sumadas a la cascada de esta página. */
  leidos?: number;
}) {
  return (
    <aside
      aria-label="Aviso: datos de maqueta"
      className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-2xl border border-amber/50 bg-amber-soft px-5 py-4"
    >
      <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">
          Estás viendo una maqueta: {CANTIDAD_MAQUETA} de los aliados de esta página no existen.
        </p>
        <p className="mt-1 max-w-[78ch] text-[13px] leading-relaxed text-inkSoft">
          {NOMBRES_MAQUETA} son financiadores inventados, puestos acá para ver cómo se comporta el muro
          con varios nombres.
          {financiados != null && leidos != null && (
            <>
              {" "}Sus <span className="font-mono">{num(financiados)}</span> contratos y sus{" "}
              <span className="font-mono">{num(leidos)}</span> lecturas también son inventados, y están
              sumados en todas las cifras de esta página.
            </>
          )}{" "}
          Sus aportes llevan código <span className="font-mono">MAQ-</span> y sus contratos{" "}
          <span className="font-mono">MAQUETA-</span>, no un OCID real.
        </p>
      </div>
      <Link
        href={volverHref}
        // En móvil baja a línea propia y ocupa el ancho: con el texto a la izquierda
        // el botón dejaba la advertencia en una columna de seis palabras.
        className="inline-flex min-h-[40px] w-full shrink-0 items-center justify-center rounded-full border border-amber/60 bg-paper px-4 py-2 text-[13px] font-semibold text-amberTexto transition-colors duration-rapido hover:bg-amber-soft sm:w-auto"
      >
        Volver a la vista real
      </Link>
    </aside>
  );
}

/** Recordatorio permanente para la barra pegajosa: no ocupa línea propia. */
export function MarcaMaquetaBarra({ volverHref }: { volverHref: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-amberTexto">
      <TriangleAlert size={13} aria-hidden />
      <span className="font-semibold">Maqueta activa</span>
      <Link href={volverHref} className="inline-flex min-h-[24px] items-center underline underline-offset-2 hover:text-ink">
        salir
      </Link>
    </span>
  );
}

/** Marca de la tarjeta / de la ficha: se distingue de un vistazo del aliado real. */
export function SelloMaqueta({ className = "" }: { className?: string }) {
  return (
    <span className={`pill border-dashed border-amber/60 bg-amber-soft text-amberTexto ${className}`}>
      <TriangleAlert size={11} aria-hidden />
      Maqueta
    </span>
  );
}
