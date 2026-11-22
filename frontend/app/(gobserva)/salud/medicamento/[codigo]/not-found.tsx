import Link from "next/link";
import { ArrowUpRight, PackageSearch, Pill } from "lucide-react";
import { EstadoVacio } from "@/components/gobserva/ui/Estados";
import { Pixel } from "@/components/pixel/Pixel";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

const URL_OBSERVATORIO = "https://opm-digemid.minsa.gob.pe/#/consulta-producto";

/** Un código de medicamento que no está en el Indicador de precios (un enlace viejo o mal copiado): cómo seguir. */
export default function MedicamentoNoEncontrado() {
  const base = baseProducto("salud");
  return (
    <div className="container-page py-10 sm:py-16">
      <div aria-hidden className="mx-auto mb-4 flex max-w-2xl justify-center">
        <Pixel nombre="frasco" escala={5} acento="accion" />
      </div>
      <div className="tarjeta mx-auto max-w-2xl rounded-2xl border border-line bg-paper">
        <EstadoVacio
          Icono={PackageSearch}
          titulo="Ese medicamento no está en nuestra lista"
          texto="Sólo tenemos los medicamentos con precios reportados a DIGEMID. Búscalo por su nombre, su principio activo o el registro sanitario de la caja."
          acciones={
            <>
              <Link href={rutaEn(base, "/medicamentos")} className={claseAccion("primario", "min-h-11")}>
                <Pill size={16} aria-hidden /> Buscar un medicamento
              </Link>
              <a href={URL_OBSERVATORIO} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario", "min-h-11")}>
                Observatorio de DIGEMID <ArrowUpRight size={14} aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </>
          }
        />
      </div>
    </div>
  );
}
