import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Caja, Pagina } from "@/components/gobserva/app/Caja";
import { EstadoVacio } from "@/components/licitaciones-app/ui/Estados";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/** Una plaza que no está (un enlace viejo o mal copiado): qué pasó y el camino de vuelta. */
export default function NoEncontrada() {
  return (
    <Pagina>
      <Caja>
        <EstadoVacio
          Icono={FileQuestion}
          titulo="No encontramos esa plaza"
          texto="Puede que el enlace esté incompleto o que SERVIR ya no la publique. Búscala en Plazas por su puesto o su entidad."
          acciones={
            <Link href={rutaEn(baseProducto("empleo"), "/app/plazas")} className={claseAccion("primario")}>
              Ir a Plazas
            </Link>
          }
        />
      </Caja>
    </Pagina>
  );
}
