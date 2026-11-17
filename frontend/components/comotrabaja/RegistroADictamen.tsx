/**
 * «Del registro al dictamen»: las cuatro clases de dato de Vigía como un recorrido, de lo más firme a lo más
 * interpretado (antes, cuatro tarjetas iguales una al lado de otra: «muy soso y plano», 2026-11-17). Debajo, dos cosas
 * que el recorrido no decía:
 *   · el desvío de las señales nuevas, que nacen EN OBSERVACIÓN y no suman puntaje hasta que 40 casos revisados a mano
 *     midan cuánto aciertan (migración 329);
 *   · la trazabilidad, que acompaña todo el recorrido: cada paso deja su rastro y se puede ver en cada contrato.
 * En escritorio el recorrido es horizontal, con su línea; en el celular, vertical.
 */
import Link from "next/link";
import { Database, FileSearch, FlaskConical, Route, Scale, ScanText, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ENLACE = "font-medium text-ink underline underline-offset-2 transition-colors hover:text-granate";

const ESTACIONES: { icono: LucideIcon; titulo: string; texto: string; sostiene: string; ejemplo: string; firmeza: number }[] = [
  {
    icono: Database,
    titulo: "Dato oficial",
    texto: "Lo que publica una entidad del Estado, tal como lo publica.",
    sostiene: "El enlace al registro de origen",
    ejemplo: "El monto adjudicado en el SEACE, una sanción del OECE, el presupuesto del MEF.",
    firmeza: 4,
  },
  {
    icono: Scale,
    titulo: "Cruce de registros",
    texto: "Una regla fija compara dos registros oficiales. No interviene ningún modelo de IA.",
    sostiene: "La regla y los dos registros que compara",
    ejemplo: "El proveedor tiene una sanción vigente; la empresa se fundó poco antes de ganar.",
    firmeza: 3,
  },
  {
    icono: ScanText,
    titulo: "Lectura con IA",
    texto: "Un modelo lee el documento del expediente y saca cada dato con la página y la frase que lo dicen.",
    sostiene: "La página y la cita, que se comprueban contra el texto",
    ejemplo: "Cuántos postores quedaron fuera según el acta, qué marca piden las bases.",
    firmeza: 2,
  },
  {
    icono: FileSearch,
    titulo: "Dictamen",
    texto: "El informe que redactan los agentes con todo lo anterior. Orienta la revisión y lleva el puntaje.",
    sostiene: "Las señales que cita, cada una con su evidencia y su norma",
    ejemplo: "«Qué pasó» y «Por qué llama la atención» en un contrato analizado.",
    firmeza: 1,
  },
];

function Firmeza({ n }: { n: number }) {
  return (
    <span className="flex items-center gap-1" role="img" aria-label={`Firmeza: ${n} de 4`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn("h-1.5 w-5 rounded-full", i <= n ? "bg-granate" : "bg-line")} />
      ))}
    </span>
  );
}

export function RegistroADictamen() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 text-rotulo font-medium text-mute" aria-hidden>
        <span>Lo más firme</span>
        <span className="h-px flex-1 bg-line" />
        <span>Lo más interpretado</span>
      </div>

      <ol className="grid gap-x-6 gap-y-6 lg:grid-cols-4">
        {ESTACIONES.map(({ icono: Icono, titulo, texto, sostiene, ejemplo, firmeza }, i) => (
          <li
            key={titulo}
            className={cn(
              "relative pl-14 lg:pl-0",
              // La línea que une las estaciones: vertical en el celular, horizontal en escritorio.
              i < ESTACIONES.length - 1 &&
                "before:absolute before:bottom-[-1.5rem] before:left-5 before:top-10 before:w-px before:bg-line lg:before:hidden " +
                  "lg:after:absolute lg:after:left-12 lg:after:right-[-1.5rem] lg:after:top-5 lg:after:h-px lg:after:bg-line",
            )}
          >
            <span className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper lg:relative lg:mb-3">
              <Icono size={18} className="text-granate" aria-hidden />
            </span>
            <h3 className="text-cuerpo font-semibold text-ink">{titulo}</h3>
            <p className="mt-1 text-meta leading-relaxed text-inkSoft">{texto}</p>
            <dl className="mt-3 space-y-2 text-rotulo leading-relaxed">
              <div>
                <dt className="font-medium text-mute">Lo sostiene</dt>
                <dd className="text-ink">{sostiene}</dd>
              </div>
              <div>
                <dt className="font-medium text-mute">Por ejemplo</dt>
                <dd className="text-inkSoft">{ejemplo}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <dt className="font-medium text-mute">Firmeza</dt>
                <dd><Firmeza n={firmeza} /></dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-4">
        <section className="rounded-2xl border border-line bg-paperSoft px-4 py-4 sm:px-5 lg:col-span-2 lg:col-start-2">
          <h3 className="flex items-center gap-2 text-cuerpo font-semibold text-ink">
            <FlaskConical size={16} className="shrink-0 text-granate" aria-hidden />
            Una señal nueva nace en observación
          </h3>
          <p className="mt-1.5 text-meta leading-relaxed text-inkSoft">
            Un cruce o una lectura que Vigía no había medido antes se muestra con su evidencia, pero no suma al puntaje ni hace a un
            contrato «con antecedentes». Pasa a puntuar cuando una persona revisó a mano al menos 40 casos y se sabe cuántas veces
            acierta.
          </p>
          <ol className="mt-3 grid grid-cols-3 gap-2 text-center text-rotulo leading-snug" aria-label="Cómo pasa una señal a puntuar">
            {["Se muestra con su evidencia", "40 casos revisados a mano", "Puntúa si acierta"].map((paso, i) => (
              <li key={paso} className={cn("rounded-xl border px-2 py-2", i === 2 ? "border-granate/40 bg-paper text-ink" : "border-line bg-paper text-inkSoft")}>
                {paso}
              </li>
            ))}
          </ol>
          <Link href="/app/patrones?seccion=observacion" prefetch={false} className={`${ENLACE} mt-3 inline-block text-meta`}>
            Ver los indicadores en observación
          </Link>
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-paper px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-cuerpo font-semibold text-ink">
              <Route size={16} className="shrink-0 text-granate" aria-hidden />
              Trazabilidad: cada paso deja su rastro
            </h3>
            <p className="mt-1.5 max-w-[70ch] text-meta leading-relaxed text-inkSoft">
              De cada contrato analizado queda qué agentes corrieron y en qué orden, qué documento y qué página leyó cada uno, qué
              norma citó, cuánto tardó y cuánto costó. Se ve en la vista Trazabilidad de cada contrato, y lo que se está leyendo
              ahora, en la auditoría en vivo.
            </p>
          </div>
          <Link href="/app/auditoria" prefetch={false} className={`${ENLACE} shrink-0 text-meta`}>
            Ir a la auditoría en vivo
          </Link>
        </div>
      </section>
    </div>
  );
}
