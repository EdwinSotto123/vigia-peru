import Link from "next/link";
import { Hospital, Pill, Search, Stethoscope } from "lucide-react";
import { EstadoVacio } from "@/components/gobserva/ui/Estados";
import { VecinaPregunta } from "@/components/salud/pixel/Personajes";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/**
 * Lo que no está en Gobserva Salud (2026-11-22: antes caía en el 404 de Vigía, con su menú de contratos). Dice qué pasó y
 * ofrece las tres cosas que se verifican aquí.
 */
export default function NoEncontradoSalud() {
  const base = baseProducto("salud");
  return (
    <div className="container-page py-10 sm:py-16">
      <div className="mx-auto mb-4 flex max-w-2xl justify-center">
        <VecinaPregunta escala={4} />
      </div>
      <div className="tarjeta mx-auto max-w-2xl rounded-2xl border border-line bg-paper">
        <EstadoVacio
          Icono={Search}
          titulo="No encontramos esa página"
          texto="El enlace puede estar incompleto o ser de una versión anterior. Desde aquí puedes verificar lo mismo de siempre."
          acciones={
            <>
              <Link href={rutaEn(base, "/establecimientos")} className={claseAccion("primario", "min-h-11")}>
                <Hospital size={16} aria-hidden /> Un establecimiento
              </Link>
              <Link href={rutaEn(base, "/medico")} className={claseAccion("secundario", "min-h-11")}>
                <Stethoscope size={16} aria-hidden /> Un médico
              </Link>
              <Link href={rutaEn(base, "/medicamentos")} className={claseAccion("secundario", "min-h-11")}>
                <Pill size={16} aria-hidden /> Un medicamento
              </Link>
            </>
          }
        />
      </div>
    </div>
  );
}
