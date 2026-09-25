import Link from "next/link";
import { ArrowLeft, FileSearch } from "lucide-react";
import { EstadoVacio } from "@/components/patrones";

/**
 * (El título de la pestaña lo pone `generateMetadata` de la página: "Contrato no encontrado".)
 *
 * /app/contratos/[ocid] sin contrato: ni el OCID ni el código SEACE pegado
 * aparecen en lo que Vigía tomó del registro público. Dice qué pasó, por qué
 * puede pasar y a dónde ir: el estado vacío con la llamita, cuyo título es el
 * h1 de la página (DESIGN_SYSTEM.md §14, estados de sistema).
 */
export default function ContratoNoEncontrado() {
  return (
    <div className="space-y-6 px-4 py-8 sm:px-6 lg:px-10">
      <Link
        href="/app/contratos"
        className="inline-flex min-h-6 items-center gap-1.5 rounded-full text-sm text-mute transition-colors duration-rapido hover:text-granate"
      >
        <ArrowLeft size={14} aria-hidden /> Contratos
      </Link>

      <EstadoVacio
        nivel="h1"
        titulo="No encontramos ese contrato"
        className="mx-auto max-w-2xl"
        accion={
          <Link
            href="/app/contratos"
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-granate px-5 py-2.5 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
          >
            <FileSearch size={15} aria-hidden /> Buscar en la lista de contratos
          </Link>
        }
      >
        El código del enlace no está entre los contratos que Vigía tomó del registro público de compras del Estado
        (SEACE). Puede que esté mal escrito, que la convocatoria sea anterior a las que Vigía tomó o que ya no figure
        en el registro.
      </EstadoVacio>
    </div>
  );
}
