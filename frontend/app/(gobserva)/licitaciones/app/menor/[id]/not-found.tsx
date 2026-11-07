import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Caja, Pagina } from "@/components/gobserva/app/Caja";
import { EstadoVacio } from "@/components/licitaciones-app/ui/Estados";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/** Un contrato menor que no está (un enlace viejo o mal copiado): qué pasó y el camino de vuelta. */
export default function NoEncontrado() {
  return (
    <Pagina>
      <Caja>
        <EstadoVacio
          Icono={FileQuestion}
          titulo="No encontramos ese contrato menor"
          texto="Puede que el enlace esté incompleto o que ya no esté publicado. Búscalo en Contratos menores por su código o su entidad."
          acciones={
            <Link href={rutaEn(baseProducto("licitaciones"), "/app/menores")} className={claseAccion("primario")}>
              Ir a Contratos menores
            </Link>
          }
        />
      </Caja>
    </Pagina>
  );
}
