import { Caja, Pagina } from "@/components/gobserva/app/Caja";
import { Bloque, EsqueletoTabla } from "@/components/licitaciones-app/ui/Estados";

/** Mientras llega la bandeja: su misma forma (cabecera, filtros y tabla), no un spinner. */
export default function Cargando() {
  return (
    <Pagina>
      <div className="mb-6 space-y-2 sm:mb-8">
        <Bloque className="h-8 w-40" />
        <Bloque className="h-4 w-full max-w-lg" />
      </div>
      <div className="grid gap-4 sm:gap-6">
        <Caja as="div">
          <Bloque className="h-11 w-full" />
          <div className="mt-3 flex flex-wrap gap-2">
            {["w-20", "w-24", "w-32", "w-20", "w-24", "w-44"].map((w, i) => (
              <Bloque key={i} className={`h-10 ${w}`} />
            ))}
          </div>
        </Caja>
        <Caja as="div" relleno={false}>
          <div className="border-b border-line px-4 py-4 sm:px-5">
            <Bloque className="h-5 w-48" />
          </div>
          <EsqueletoTabla />
        </Caja>
      </div>
    </Pagina>
  );
}
