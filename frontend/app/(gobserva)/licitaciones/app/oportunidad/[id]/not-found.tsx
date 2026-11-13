import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Caja, Pagina } from "@/components/gobserva/app/Caja";
import { EstadoVacio } from "@/components/gobserva/ui/Estados";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/** Un proceso que no está (un enlace viejo o mal copiado): qué pasó y el camino de vuelta. */
export default function NoEncontrado() {
  return (
    <Pagina>
      <Caja>
        <EstadoVacio
          Icono={FileQuestion}
          titulo="No encontramos ese proceso"
          texto="Puede que el enlace esté incompleto o que el proceso ya no esté en convocatoria. Búscalo en la bandeja por su código o su entidad."
          acciones={
            <Link href={rutaEn(baseProducto("licitaciones"), "/app/bandeja")} className={claseAccion("primario")}>
              Ir a la bandeja
            </Link>
          }
        />
      </Caja>
    </Pagina>
  );
}
