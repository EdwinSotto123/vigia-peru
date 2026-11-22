import Link from "next/link";
import { CarFront, Search, Wrench } from "lucide-react";
import { EstadoVacio } from "@/components/gobserva/ui/Estados";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/** Lo que no está en Gobserva Car: qué pasó y lo que sí se verifica aquí. */
export default function NoEncontradoCar() {
  const base = baseProducto("car");
  return (
    <div className="container-page py-10 sm:py-16">
      <div className="tarjeta mx-auto max-w-2xl rounded-2xl border border-line bg-paper">
        <EstadoVacio
          Icono={Search}
          titulo="No encontramos esa página"
          texto="El enlace puede estar incompleto. Desde aquí puedes verificar una placa, buscar un centro de revisión técnica o ver dónde sacar tu licencia."
          acciones={
            <>
              <Link href={rutaEn(base, "/placa")} className={claseAccion("primario", "min-h-11")}>
                <CarFront size={16} aria-hidden /> Verificar una placa
              </Link>
              <Link href={rutaEn(base, "/revision-tecnica")} className={claseAccion("secundario", "min-h-11")}>
                <Wrench size={16} aria-hidden /> Revisión técnica
              </Link>
            </>
          }
        />
      </div>
    </div>
  );
}
