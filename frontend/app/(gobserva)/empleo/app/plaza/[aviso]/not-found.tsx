import Link from "next/link";
import { Caja, Pagina } from "@/components/gobserva/app/Caja";
import { EstadoPostulante } from "@/components/empleo/EstadoPostulante";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/** Una plaza que no está (un enlace viejo o mal copiado): qué pasó y el camino de vuelta, con el postulante que pregunta. */
export default function NoEncontrada() {
  return (
    <Pagina>
      <Caja>
        <EstadoPostulante
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
