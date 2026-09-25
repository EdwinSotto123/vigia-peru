import Link from "next/link";
import { FranjaTextil } from "@/components/marca";
import { TIPO_FINANCIADOR_LABEL } from "@/lib/financiamiento";
import { esSlugMaqueta } from "@/lib/maqueta-aliados";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { AvatarAliado, esFundador } from "./TarjetaAliado";
import { SelloMaqueta } from "./AvisoMaqueta";
import { pctProporcion } from "./proporcion";
import { hrefPerfil, type FilaRanking } from "./ranking";

/**
 * El puesto en el ranking (#1, #2…), en todas partes igual: la tabla, el podio y el
 * perfil. Los tres primeros van en granate profundo con el número en maíz (el único
 * lugar donde el maíz brilla sobre claro es dentro de su propia placa oscura, 8.39:1);
 * del cuarto en adelante, neutro. Sin trofeos ni medallas: oro y bronce se leerían
 * como severidad (§3.7), y el rango ya lo dice el número.
 */
export function Puesto({ n, tamano = "md", className }: { n: number; tamano?: "md" | "lg"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-display font-extrabold leading-none tabular-nums",
        n <= 3 ? "bg-granate-deep text-maiz" : "bg-paperDeep text-inkSoft",
        tamano === "lg" ? "h-9 min-w-[2.75rem] px-2.5 text-[16px]" : "h-7 min-w-[2.25rem] px-2 text-[13px]",
        className,
      )}
    >
      <span className="sr-only">Puesto </span>
      <span aria-hidden className="mr-px opacity-70">
        #
      </span>
      {numero(n)}
    </span>
  );
}

/**
 * Los tres primeros del ranking, en una franja de marca sobre la tabla (DESIGN_SYSTEM.md
 * §3.8 y §14.6): granate profundo, texto papel y el maíz sólo en el puesto y la cifra.
 * Cada tarjeta es un enlace a su perfil. En el celular, tres renglones compactos; desde
 * `md`, tres columnas en orden de lectura (1, 2, 3), sin pedestales que obliguen a
 * adivinar el orden por la altura.
 *
 * Sólo existe ordenando por contratos financiados: con otro orden, "los tres primeros"
 * significaría otra cosa.
 */
export function PodioRanking({
  filas,
  financiadosAmbito,
  ambito,
}: {
  /** Los tres primeros, ya con su puesto. */
  filas: FilaRanking[];
  /** Total financiado del ámbito: el denominador de cada tarjeta. */
  financiadosAmbito: number;
  /** "todo el Perú · desde el inicio", para que el título diga de qué ranking habla. */
  ambito: string;
}) {
  if (filas.length < 3) return null;
  return (
    <section aria-labelledby="podio-titulo" className="sobre-oscuro overflow-hidden rounded-2xl bg-granate-deep text-paper">
      <FranjaTextil alto={8} />
      <div className="px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <h2 id="podio-titulo" className="font-display text-[17px] font-bold leading-tight">
            Los tres que más contratos hicieron leer
          </h2>
          <p className="text-[12.5px] text-paper/75">{ambito}</p>
        </div>
        <ol className="mt-3.5 grid gap-2.5 md:grid-cols-3 md:gap-3">
          {filas.slice(0, 3).map((f) => (
            <li key={f.id} className="min-w-0">
              <TarjetaPodio fila={f} financiadosAmbito={financiadosAmbito} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function TarjetaPodio({ fila: f, financiadosAmbito }: { fila: FilaRanking; financiadosAmbito: number }) {
  const maqueta = esSlugMaqueta(f.slug);
  const href = hrefPerfil(f.slug);
  const tipo = esFundador(f) ? "La propia plataforma" : TIPO_FINANCIADOR_LABEL[f.tipo];
  const pct = pctProporcion(f.contratosFinanciados, financiadosAmbito);
  const clase = cn(
    "group flex h-full items-center gap-3 rounded-xl bg-paper/5 p-3 ring-1 ring-inset transition-colors duration-rapido md:flex-col md:items-stretch md:gap-3 md:p-4",
    f.puesto === 1 ? "ring-maiz/50" : "ring-paper/15",
    href && "hover:bg-paper/10",
  );
  const cuerpo = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="w-9 shrink-0 font-display text-[24px] font-extrabold leading-none text-maiz tabular-nums md:w-auto md:text-[30px]">
          <span className="sr-only">Puesto </span>
          <span aria-hidden className="text-[0.7em] opacity-80">
            #
          </span>
          {f.puesto}
        </span>
        <span aria-hidden className="shrink-0">
          <AvatarAliado tipo={f.tipo} logoUrl={f.logoUrl} nombre={f.nombre} size="lg" maqueta={maqueta} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-paper group-hover:underline" title={f.nombre}>
            {f.nombre}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-paper/75">
            {tipo}
            {maqueta && <SelloMaqueta />}
          </span>
        </span>
      </span>
      <span className="shrink-0 text-right md:flex md:items-baseline md:gap-2 md:border-t md:border-paper/15 md:pt-3 md:text-left">
        <span className="block font-display text-[20px] font-bold leading-none text-maiz tabular-nums md:text-[26px]">
          {numero(f.contratosFinanciados)}
        </span>
        <span className="mt-1 block text-[12px] leading-tight text-paper/75 md:mt-0 md:text-[13px]">
          {f.contratosFinanciados === 1 ? "contrato" : "contratos"}
          <span className="hidden md:inline"> financiados</span>
          {pct && <span className="hidden md:inline"> · {pct}</span>}
        </span>
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={clase}>
      {cuerpo}
    </Link>
  ) : (
    <div className={clase}>{cuerpo}</div>
  );
}
