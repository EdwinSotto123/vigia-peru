import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Burbuja, Calle, RenglonBurbuja } from "@/components/pixel/Escena";
import { Pixel } from "@/components/pixel/Pixel";
import { fechaCorta, numero, solesCompacto } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { nombreEntidad, nombreProyecto, type ResumenObras } from "@/lib/gobserva-obras";
import { nombreRegion } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

/**
 * El momento de la portada de Gobserva Obras: un obrero al lado de una obra con su grúa cuenta, en una burbuja, lo que se
 * viene. Con el resumen de Invierte.pe e INFOBRAS (`r`), la burbuja trae los proyectos más grandes con expediente técnico y
 * sin contratista, con su entidad y su costo (o, si no hay, cuántos se vienen, se licitan y están en marcha), y debajo la
 * fecha de cada fuente. Sin el resumen (la API tardó), la misma escena con lo que muestra cada proyecto, marcado como
 * «Ejemplo» y sin cifras. La escena se arma una vez y a pasos (la obra y la grúa se dibujan de abajo arriba, el obrero
 * llega, la burbuja se abre y cada renglón aparece en su turno); después sólo vive: el obrero parpadea, la carga de la grúa
 * sube y baja. Con movimiento reducido, todo quieto y a la vista. Va sobre la banda oscura del héroe; la burbuja es una
 * placa clara. Server-safe.
 */
export function EscenaObras({ r, base, className }: { r: ResumenObras | null; base: string; className?: string }) {
  const ruta = (p: string) => rutaEn(base, p);
  const top = r?.seVienenTop.slice(0, 3) ?? [];
  const burbuja = "w-[20rem] max-w-[94%] sm:w-[22rem]";

  return (
    <div className={cn("relative mx-auto w-full max-w-[30rem]", className)}>
      {r && top.length > 0 ? (
        <Burbuja titulo="Se vienen: con expediente técnico y sin contratista" ejemplo={false} className={burbuja}>
          <ol className="space-y-2.5" aria-label="Los proyectos más grandes que se vienen con expediente técnico">
            {top.map((p, i) => (
              <li key={p.cui}>
                <RenglonBurbuja
                  icono="documento"
                  orden={i}
                  texto={
                    <Link href={ruta(`/proyecto/${p.cui}`)} className="line-clamp-2 underline-offset-2 hover:text-granate hover:underline">
                      {nombreProyecto(p.nombre, p)}
                    </Link>
                  }
                  detalle={
                    <span className="line-clamp-2">
                      {nombreEntidad(p.entidad)}
                      {p.region ? `, ${nombreRegion(p.region)}` : ""}
                    </span>
                  }
                  derecha={p.costo ? solesCompacto(p.costo) : "Sin dato"}
                />
              </li>
            ))}
          </ol>
        </Burbuja>
      ) : r ? (
        <Burbuja titulo="Invierte.pe e INFOBRAS hoy" ejemplo={false} className={burbuja}>
          <div className="space-y-2.5">
            <RenglonBurbuja icono="documento" orden={0} texto={`${numero(r.seVienen)} proyectos se vienen`} detalle="Viables o con expediente técnico, sin contratista" derecha={solesCompacto(r.seVienenMonto)} />
            <RenglonBurbuja icono="iconoCampana" orden={1} texto={`${numero(r.licitando)} se están licitando`} detalle="Con un proceso de obra en convocatoria" derecha={solesCompacto(r.licitandoMonto)} />
            <RenglonBurbuja icono="iconoCaja" orden={2} texto={`${numero(r.enMarcha)} obras en marcha`} detalle="Con su avance y quién las construye" derecha={solesCompacto(r.enMarchaMonto)} />
          </div>
        </Burbuja>
      ) : (
        <Burbuja titulo="Un proyecto que se viene" className={burbuja}>
          <div className="space-y-2.5">
            <RenglonBurbuja icono="documento" orden={0} texto="Con expediente técnico y sin contratista" detalle="Lo siguiente es licitar la obra" />
            <RenglonBurbuja icono="iconoMaletin" orden={1} texto="Su plata y su entidad" detalle="Cuánto tiene este año y cuánto falta ejecutar" />
            <RenglonBurbuja icono="iconoCampana" orden={2} texto="Te avisamos cuando se licite" detalle="O cuando empiece la obra o se paralice" />
          </div>
        </Burbuja>
      )}

      {/* La obra con su grúa detrás (el contrapeso queda sobre el techo) y un cono bajo la carga. Misma escala para las tres:
          en el celular 4.5, desde sm 6, en la columna angosta de lg 5 y desde xl otra vez 6. */}
      <Calle
        className="-mt-2 select-none"
        izquierda={<Pixel nombre="obrero" escala={6} className="h-auto w-[4.5rem] sm:w-24 lg:w-20 xl:w-24" />}
        derecha={
          <div className="flex items-end">
            <Pixel
              nombre="obra"
              escala={6}
              retardo={500}
              className="relative z-[1] -mr-[1.96875rem] h-auto w-[7.3125rem] sm:-mr-[2.625rem] sm:w-[9.75rem] lg:-mr-[2.1875rem] lg:w-[8.125rem] xl:-mr-[2.625rem] xl:w-[9.75rem]"
            />
            <span className="relative block">
              <Pixel nombre="grua" escala={6} retardo={900} className="h-auto w-[9rem] sm:w-[12rem] lg:w-[10rem] xl:w-[12rem]" />
              <Pixel nombre="cono" escala={6} className="absolute bottom-0 left-[68.75%] h-auto w-[2.25rem] sm:w-[3rem] lg:w-[2.5rem] xl:w-[3rem]" />
            </span>
          </div>
        }
      />

      <div className="mt-3 pl-2 sm:pl-4">
        {r?.estado && (
          <p className="flex items-start gap-2 text-meta leading-relaxed text-paper/65">
            <span aria-hidden className="relative mt-[0.4375rem] inline-flex h-2 w-2 shrink-0">
              <span className="absolute inset-0 rounded-full bg-maiz opacity-60 motion-safe:animate-ping" />
              <span className="relative h-2 w-2 rounded-full bg-maiz" />
            </span>
            <span>
              {r.estado.inversionesAl ? `Invierte.pe al ${fechaCorta(r.estado.inversionesAl)}` : "Invierte.pe"},{" "}
              {r.estado.infobrasAl ? `INFOBRAS al ${fechaCorta(r.estado.infobrasAl)}` : "INFOBRAS"} y las convocatorias del SEACE, a diario.{" "}
              {numero(r.nuevos30)} proyectos se declararon viables en los últimos 30 días.
            </span>
          </p>
        )}
        <Link href={ruta("/proyectos")} className="mt-1 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-maiz underline-offset-4 hover:underline">
          {r ? `Ver los ${numero(r.seVienen)} que se vienen` : "Ver los que se vienen"} <ArrowRight size={15} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
