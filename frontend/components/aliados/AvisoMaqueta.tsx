import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { NOMBRES_MAQUETA } from "@/lib/maqueta-aliados";
import { numero } from "@/lib/formato";
import { Ayuda } from "@/components/patrones/Ayuda";

/**
 * El aviso de que lo que se está mirando no es real.
 *
 * No es una nota al pie ni un `title=""`: en un producto que acusa
 * públicamente de falta de transparencia, un dato inventado que se vea como
 * real lo destruye. Así que el aviso va arriba de todo, dice en UNA línea los
 * nombres exactos de lo que es falso y que las cifras de la página los incluyen,
 * y ofrece la salida en un clic. El cuánto y los prefijos de código, en el ⓘ
 * (DESIGN_SYSTEM.md §10.7).
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
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-amber/50 bg-amber-soft px-5 py-3"
    >
      <TriangleAlert size={18} className="shrink-0 text-amberTexto" aria-hidden />
      <p className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink">
        <strong className="font-semibold">Maqueta: {NOMBRES_MAQUETA} no existen</strong>
        <span className="text-inkSoft">y sus cifras están sumadas en esta página.</span>
        <Ayuda titulo="¿Qué es inventado?" className="text-amberTexto hover:bg-paper">
          <span className="block">
            Son financiadores inventados, puestos acá para ver cómo se comporta el muro con varios nombres.
            {financiados != null && leidos != null && (
              <>
                {" "}Sus <span className="font-mono">{num(financiados)}</span> contratos y sus{" "}
                <span className="font-mono">{num(leidos)}</span> lecturas también son inventados.
              </>
            )}
          </span>
          <span className="mt-2 block text-mute">
            Sus aportes llevan código <span className="font-mono">MAQ-</span> y sus contratos{" "}
            <span className="font-mono">MAQUETA-</span>, no un OCID real.
          </span>
        </Ayuda>
      </p>
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

/** Marca de la tarjeta / de la ficha: se distingue de un vistazo del aliado real. */
export function SelloMaqueta({ className = "" }: { className?: string }) {
  return (
    <span className={`pill border-dashed border-amber/60 bg-amber-soft text-amberTexto ${className}`}>
      <TriangleAlert size={11} aria-hidden />
      Maqueta
    </span>
  );
}
