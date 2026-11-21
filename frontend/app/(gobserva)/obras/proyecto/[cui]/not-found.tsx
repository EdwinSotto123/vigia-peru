import Link from "next/link";
import { FileQuestion, Search } from "lucide-react";
import { EstadoVacio } from "@/components/gobserva/ui/Estados";
import { PersonajePregunta } from "@/components/pixel/Escena";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/**
 * Un CUI que no trae ficha: un enlace viejo o mal copiado, o la ficha que no se pudo leer en ese momento (la API responde
 * igual en los dos casos). Dentro del marco de Gobserva Obras, con el obrero que pregunta y el camino de vuelta.
 */
export default function ProyectoNoEncontrado() {
  const base = baseProducto("obras");
  return (
    <div className="container-page py-10 sm:py-16">
      <div className="mx-auto mb-4 flex max-w-2xl justify-center">
        <PersonajePregunta nombre="obrero" escala={4} />
      </div>
      <div className="mx-auto max-w-2xl rounded-2xl border border-line bg-paper">
        <EstadoVacio
          Icono={FileQuestion}
          titulo="No encontramos ese proyecto"
          texto="El CUI de una inversión tiene 7 cifras. Puede que el enlace esté incompleto o que no pudimos leer la ficha ahora: vuelve a intentarlo en unos segundos o búscalo por su nombre o su CUI."
          acciones={
            <>
              <Link href={rutaEn(base, "/proyectos")} className={claseAccion("primario", "min-h-11")}>
                <Search size={16} aria-hidden /> Buscar proyectos
              </Link>
              <Link href={rutaEn(base, "/")} className={claseAccion("secundario", "min-h-11")}>
                Ir al inicio de Obras
              </Link>
            </>
          }
        />
      </div>
    </div>
  );
}
