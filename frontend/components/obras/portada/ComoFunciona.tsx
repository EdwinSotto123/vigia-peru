import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, BellRing, Building2, Landmark } from "lucide-react";
import { PestanasVivas } from "@/components/gobserva/portada/PestanasVivas";
import { Pixel } from "@/components/pixel/Pixel";
import { claseAccion } from "@/components/ui/EnlaceAccion";

/**
 * «Cómo funciona» en la portada de Gobserva Obras (2026-11-22): los tres pasos, cada uno con su viñeta de píxeles, en
 * pestañas que avanzan solas mientras se ven (la franja se llena hasta el siguiente paso; al tocar se quedan quietas).
 * Debajo, las dos puertas: la cuenta gratis y los planes (Obras viene incluido en los de Gobserva Licitaciones; antes
 * las tarjetas de los planes ocupaban 1,300 px de la portada). Server-safe.
 */
export function ComoFunciona({ correo, crear, planes }: { correo: boolean; crear: string; planes: string }) {
  const pasos: { pestana: string; titulo: string; Icono: typeof Landmark; texto: string; ilustracion: ReactNode }[] = [
    {
      pestana: "Tú eliges",
      titulo: "Dinos qué construyes",
      Icono: Landmark,
      texto: "Tus sectores (agua, pistas, colegios, riego), tus regiones y el tamaño de obra que puedes asumir.",
      ilustracion: (
        <>
          <Pixel nombre="obrero" escala={4} retardo={400} />
          <Pixel nombre="obra" escala={3} retardo={900} />
        </>
      ),
    },
    {
      pestana: "Te avisamos",
      titulo: "Te llega lo nuevo",
      Icono: BellRing,
      texto: `Los proyectos que se declaran viables, los que aprueban su expediente técnico y los que pasan a licitación, ${correo ? "en tu correo" : "en tu cuenta"}: cada semana con la cuenta gratis, cada mañana con un plan.`,
      ilustracion: (
        <>
          <Pixel nombre="obrero" escala={4} retardo={1200} />
          <Pixel nombre="iconoCampana" escala={4.5} acento="accion" className="mb-10" />
        </>
      ),
    },
    {
      pestana: "Llegas antes",
      titulo: "Llega antes y con datos",
      Icono: Building2,
      texto: "Cuánta plata tiene el proyecto este año, cuánto falta ejecutar, quién ganó obras parecidas en la región y a cuánto.",
      ilustracion: (
        <>
          <Pixel nombre="obrero" escala={4} retardo={700} />
          <Pixel nombre="documento" escala={4.5} acento="accion" className="mb-3" />
        </>
      ),
    },
  ];
  return (
    <section aria-labelledby="como-t">
      <h2 id="como-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
        Cómo funciona
      </h2>
      <p className="mt-2 max-w-[62ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">Tres pasos, sin revisar Invierte.pe, INFOBRAS y el SEACE cada semana.</p>
      <PestanasVivas
        etiqueta="Los pasos"
        auto={5200}
        className="mt-5"
        pestanas={pasos.map((p) => ({ titulo: p.pestana, icono: <p.Icono size={16} aria-hidden /> }))}
      >
        {pasos.map((p) => (
          <div key={p.titulo} className="grid items-center gap-5 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] sm:gap-8">
            <div aria-hidden className="flex h-40 select-none items-end justify-center overflow-hidden rounded-2xl border border-line bg-paperSoft px-4 pt-3">
              <div className="flex w-full items-end justify-center gap-4 border-b-[5px] border-dashed border-[rgb(var(--px-linea)/0.25)]">{p.ilustracion}</div>
            </div>
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink sm:text-seccion">
                <p.Icono size={20} aria-hidden className="shrink-0 text-granate" />
                {p.titulo}
              </h3>
              <p className="mt-2 max-w-[52ch] text-cuerpo leading-relaxed text-inkSoft">{p.texto}</p>
            </div>
          </div>
        ))}
      </PestanasVivas>
      <div className="mt-6 flex flex-col gap-3 rounded-3xl border border-line bg-paper p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <p className="max-w-[58ch] text-pretty text-dato leading-relaxed text-inkSoft">
          <b className="font-semibold text-ink">Buscar y leer las fichas es gratis.</b> Obras viene incluido en los planes de Gobserva Licitaciones: con uno,
          te avisamos cada mañana y bajas tus búsquedas en Excel.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={crear} className={claseAccion("primario", "min-h-11")}>
            Crear mi cuenta gratis <ArrowRight size={16} aria-hidden />
          </Link>
          <Link href={planes} className={claseAccion("secundario", "min-h-11")}>
            Ver los planes
          </Link>
        </div>
      </div>
    </section>
  );
}
