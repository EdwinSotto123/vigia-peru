import Link from "next/link";
import { ArrowUpRight, FileQuestion, Search } from "lucide-react";
import { EstadoVacio } from "@/components/gobserva/ui/Estados";
import { URL_RENIPRESS_CONSULTA } from "@/components/salud/fuentes/urls";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/** Un código que no está en RENIPRESS (un enlace viejo o mal copiado): qué pasó y cómo seguir. */
export default function EstablecimientoNoEncontrado() {
  const base = baseProducto("salud");
  return (
    <div className="container-page py-10 sm:py-16">
      <div className="tarjeta mx-auto max-w-2xl rounded-2xl border border-line bg-paper">
        <EstadoVacio
          Icono={FileQuestion}
          titulo="Ese código no está en RENIPRESS"
          texto="El código único de una IPRESS tiene hasta 8 cifras. Puede que el enlace esté incompleto o que el establecimiento ya no figure en el registro. Búscalo por su nombre o su distrito."
          acciones={
            <>
              <Link href={rutaEn(base, "/buscar")} className={claseAccion("primario", "min-h-11")}>
                <Search size={16} aria-hidden /> Buscar un establecimiento
              </Link>
              <a
                href={URL_RENIPRESS_CONSULTA}
                target="_blank"
                rel="noopener noreferrer"
                className={claseAccion("secundario", "min-h-11")}
              >
                Consulta oficial de RENIPRESS <ArrowUpRight size={14} aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </>
          }
        />
      </div>
    </div>
  );
}
