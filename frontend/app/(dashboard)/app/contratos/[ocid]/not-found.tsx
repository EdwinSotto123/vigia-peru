import Link from "next/link";
import { ArrowLeft, FileSearch } from "lucide-react";
import { EstadoVacio, Pagina } from "@/components/patrones";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";

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
    <Pagina>
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
          <EnlaceAccion href="/app/contratos">
            <FileSearch size={15} aria-hidden /> Buscar en la lista de contratos
          </EnlaceAccion>
        }
      >
        El código no está entre los contratos que Vigía tomó del SEACE: puede estar mal escrito, ser anterior o ya no
        figurar en el registro.
      </EstadoVacio>
    </Pagina>
  );
}
