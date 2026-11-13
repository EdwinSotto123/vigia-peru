import { Caja, Pagina } from "@/components/gobserva/app/Caja";
import { Bloque } from "@/components/gobserva/ui/Estados";

/** Mientras llega el detalle: la cabecera, las cuatro cifras, las pestañas y dos cajas. */
export default function Cargando() {
  return (
    <Pagina>
      <Bloque className="h-5 w-24" />
      <Bloque className="mt-4 h-4 w-48" />
      <Bloque className="mt-3 h-8 w-full max-w-2xl" />
      <Bloque className="mt-2 h-8 w-2/3 max-w-xl" />
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Bloque key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="mt-6 flex gap-4 border-b border-line pb-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Bloque key={i} className="h-5 w-20" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Caja as="div">
          <Bloque className="h-4 w-full" />
          <Bloque className="mt-2 h-4 w-5/6" />
          <Bloque className="mt-2 h-4 w-2/3" />
        </Caja>
        <Caja as="div">
          <Bloque className="h-16 w-full" />
        </Caja>
      </div>
    </Pagina>
  );
}
