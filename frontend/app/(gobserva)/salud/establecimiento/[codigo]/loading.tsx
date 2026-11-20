import { Bloque } from "@/components/gobserva/ui/Estados";

/** Mientras llega la ficha: la ruta, el nombre, la verificación con sus filas y la caja de acciones. */
export default function CargandoFicha() {
  return (
    <div className="container-page pb-6 pt-5 sm:pt-8" role="status" aria-label="Cargando la ficha del establecimiento">
      <Bloque className="h-4 w-56" />
      <Bloque className="mt-5 h-9 w-full max-w-xl" />
      <div className="mt-3 flex gap-2">
        <Bloque className="h-6 w-14" />
        <Bloque className="h-6 w-56" />
        <Bloque className="h-6 w-20" />
      </div>
      <Bloque className="mt-4 h-4 w-full max-w-lg" />
      <Bloque className="mt-2 h-4 w-2/3 max-w-md" />
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-2xl border border-line bg-paper p-5">
          <Bloque className="h-6 w-40" />
          <Bloque className="mt-3 h-5 w-5/6" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="mt-5 flex gap-3">
              <Bloque className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Bloque className="h-4 w-1/3" />
                <Bloque className="h-4 w-11/12" />
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-line bg-paper p-5">
          <Bloque className="h-5 w-32" />
          {[0, 1, 2, 3].map((i) => (
            <Bloque key={i} className="mt-3 h-11 w-full rounded-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
