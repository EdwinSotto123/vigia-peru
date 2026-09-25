import Link from "next/link";
import { COLUMNA_PODIO, FranjaTextil, Medalla, PodioEscena } from "@/components/marca";
import { TIPO_FINANCIADOR_LABEL } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { AvatarAliado, esFundador } from "./TarjetaAliado";
import { pctProporcion } from "./proporcion";
import { hrefPerfil, type FilaRanking } from "./ranking";

/**
 * El puesto en el ranking (#1, #2…) en la tabla y el perfil. Los tres primeros van en
 * granate profundo con el número en maíz (el maíz sólo brilla sobre su propia placa
 * oscura, 8.39:1); del cuarto en adelante, neutro. En el podio el puesto lo dice la
 * medalla (§2.5), no esta pastilla.
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

type Lugar = 1 | 2 | 3;

/** Lo que dice un puesto libre, igual en la portada y en /app/aliados. */
export const LUGAR_LIBRE = "Tu nombre, el de tu colectivo o el de tu empresa.";

/** El escalón que sube (la clase compartida del kit de marca, server-safe). */
const SUBE = COLUMNA_PODIO;

/**
 * Cada lugar del podio. El DOM va 1, 2, 3 (el orden de lectura); la vista, 2 · 1 · 3.
 * Suben 3.º → 2.º → 1.º y la medalla aparece cuando su escalón ya llegó.
 */
const LUGAR: Record<Lugar, { orden: string; alto: string; cara: string; numeral: string; cifra: string; medalla: number; sube: number }> = {
  1: {
    orden: "order-2",
    alto: "h-16 sm:h-24 lg:h-28",
    cara: "border-maiz bg-gradient-to-b from-maiz/30 via-maiz/10 to-maiz/[0.03]",
    numeral: "text-3xl text-maiz/70 sm:text-5xl lg:text-6xl",
    cifra: "text-maiz",
    medalla: 68,
    sube: 400,
  },
  2: {
    orden: "order-1",
    alto: "h-12 sm:h-16 lg:h-20",
    cara: "border-medalla-plata bg-gradient-to-b from-paper/[0.14] to-paper/[0.03]",
    numeral: "text-2xl text-paper/35 sm:text-3xl lg:text-4xl",
    cifra: "text-paper",
    medalla: 54,
    sube: 200,
  },
  3: {
    orden: "order-3",
    alto: "h-8 sm:h-12 lg:h-14",
    cara: "border-medalla-bronce bg-gradient-to-b from-paper/[0.11] to-paper/[0.02]",
    numeral: "text-xl text-paper/30 sm:text-2xl lg:text-3xl",
    cifra: "text-paper",
    medalla: 54,
    sube: 0,
  },
};

/** La medalla aparece cuando su escalón ya subió. */
const DESPUES_DEL_ESCALON = 500;

/**
 * El podio del ranking de aliados (DESIGN_SYSTEM.md §2.5 y §14.6), el mismo en la
 * portada y en /app/aliados: tres escalones de alto distinto (1.º al centro, el más
 * alto; 2.º a la izquierda; 3.º a la derecha), cada uno con su medalla —oro con corona,
 * plata, bronce—, el logo y el nombre del aliado, y cuántos contratos financió (nunca
 * soles). Al entrar en pantalla los escalones suben (3.º, 2.º, 1.º), la medalla aparece
 * y la corona cae; el servidor lo pinta quieto y completo, así que sin JS o con
 * movimiento reducido se ve igual, sin animación.
 *
 * Con menos de tres nombres, los puestos que faltan se dibujan libres (`lugarLibre`):
 * decirlo es más honesto que estirar el podio, y es la invitación a subirse. Sin
 * `lugarLibre`, con menos de tres no se dibuja.
 */
export function PodioRanking({
  filas,
  financiadosAmbito,
  titulo,
  nivel = 2,
  lugarLibre,
}: {
  /** Los primeros del ranking (hasta tres), ya con su puesto. */
  filas: FilaRanking[];
  /** Total financiado del ámbito: sin él no se dice qué parte es de cada uno. */
  financiadosAmbito?: number;
  /** Por defecto, "Los tres que…" con tres nombres y "Quienes…" con menos. */
  titulo?: string;
  /** Nivel del título: 2 en /app/aliados; 3 dentro de una sección de la portada. */
  nivel?: 2 | 3;
  /** Qué se dice en un puesto sin nombre. Sin este texto, con menos de tres no hay podio. */
  lugarLibre?: string;
}) {
  const primeros = filas.slice(0, 3);
  if (primeros.length < 3 && !lugarLibre) return null;
  const Titulo = nivel === 3 ? "h3" : "h2";
  const texto = titulo ?? (primeros.length === 3 ? "Los tres que más contratos hicieron leer" : "Quienes más contratos hicieron leer");
  const lugares: Lugar[] = [1, 2, 3];

  return (
    <section aria-labelledby="podio-titulo" className="sobre-oscuro overflow-hidden rounded-2xl bg-granate-deep text-paper">
      <FranjaTextil alto={8} />
      <div className="px-3 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
        {/* De qué ranking se habla (región, periodo) lo dicen los filtros de la página, no el podio. */}
        <Titulo id="podio-titulo" className="px-1 font-display text-[17px] font-bold leading-tight sm:px-0">
          {texto}
        </Titulo>
        <PodioEscena className="mx-auto mt-5 max-w-3xl">
          {/* El piso del escenario: los escalones se apoyan en una línea, no en el borde. */}
          <ol className="grid grid-cols-3 items-end gap-1.5 border-b border-paper/20 sm:gap-3">
            {lugares.map((lugar) => {
              const fila = primeros.find((f) => f.puesto === lugar);
              return fila ? (
                <Escalon key={fila.id} lugar={lugar} fila={fila} financiadosAmbito={financiadosAmbito} />
              ) : (
                <EscalonLibre key={`libre-${lugar}`} lugar={lugar} texto={lugarLibre ?? ""} />
              );
            })}
          </ol>
        </PodioEscena>
      </div>
    </section>
  );
}

function Escalon({ lugar, fila: f, financiadosAmbito }: { lugar: Lugar; fila: FilaRanking; financiadosAmbito?: number }) {
  const l = LUGAR[lugar];
  const href = hrefPerfil(f.slug);
  const tipo = esFundador(f) ? "La propia plataforma" : TIPO_FINANCIADOR_LABEL[f.tipo];
  const pct = financiadosAmbito ? pctProporcion(f.contratosFinanciados, financiadosAmbito) : null;
  const clase = "group/aliado flex h-full flex-col rounded-t-xl";

  const cuerpo = (
    <>
      <span className="relative flex flex-col items-center px-0.5 pb-3 text-center">
        {/* El oro brilla un poco más: un halo de maíz detrás de la medalla, sólo luz. */}
        {lugar === 1 && (
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-3 h-20 w-20 -translate-x-1/2 rounded-full bg-maiz/25 blur-2xl" />
        )}
        <Medalla puesto={lugar} tamano={l.medalla} animada retraso={l.sube + DESPUES_DEL_ESCALON} className="relative" />
        <span aria-hidden className="mt-2.5 flex">
          <AvatarAliado tipo={f.tipo} logoUrl={f.logoUrl} nombre={f.nombre} size="lg" />
        </span>
        <span
          className={cn(
            "mt-2 line-clamp-2 max-w-full break-words text-[13px] font-semibold leading-snug text-paper sm:text-[15px]",
            href && "underline-offset-2 group-hover/aliado:underline",
          )}
          title={f.nombre}
        >
          {f.nombre}
        </span>
        <span className="mt-0.5 hidden text-[12.5px] leading-snug text-paper/75 sm:block">{tipo}</span>
        <span className={cn("mt-2 font-display text-2xl font-extrabold leading-none tabular-nums sm:text-3xl", l.cifra)}>
          {numero(f.contratosFinanciados)}
        </span>
        <span className="mt-1 text-[11.5px] leading-tight text-paper/75 sm:text-[13px]">
          {f.contratosFinanciados === 1 ? "contrato" : "contratos"}
          <span className="hidden sm:inline">{f.contratosFinanciados === 1 ? " financiado" : " financiados"}</span>
        </span>
        {/* Su parte de lo financiado, en línea propia: debajo de la cifra, no pegada con un separador. */}
        {pct && <span className="mt-0.5 hidden text-[12.5px] leading-tight text-paper/75 md:block">{pct} del total</span>}
      </span>
      <span
        aria-hidden
        className={cn(SUBE, "flex w-full justify-center rounded-t-xl border-t-2 pt-1.5 sm:pt-2", l.alto, l.cara)}
        style={{ animationDelay: `${l.sube}ms` }}
      >
        <span className={cn("font-display font-extrabold leading-none tabular-nums", l.numeral)}>{lugar}</span>
      </span>
    </>
  );

  return (
    <li className={cn("min-w-0", l.orden)}>
      {href ? (
        <Link href={href} className={clase}>
          {cuerpo}
        </Link>
      ) : (
        <div className={clase}>{cuerpo}</div>
      )}
    </li>
  );
}

/** Un puesto sin nombre: el escalón punteado y la invitación, sin fingir que hay alguien. */
function EscalonLibre({ lugar, texto }: { lugar: Lugar; texto: string }) {
  const l = LUGAR[lugar];
  return (
    <li className={cn("flex min-w-0 flex-col", l.orden)}>
      <span className="flex flex-col items-center px-0.5 pb-3 text-center">
        <span
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-paper/30 font-display text-lg font-bold text-paper/60"
        >
          {lugar}
        </span>
        <span className="mt-2 text-[13px] font-semibold leading-snug text-paper/80 sm:text-[15px]">
          Puesto<span className="sr-only"> {lugar}</span> libre
        </span>
        {texto && <span className="mt-0.5 hidden text-[12.5px] leading-snug text-paper/75 sm:block">{texto}</span>}
      </span>
      <span
        aria-hidden
        className={cn(SUBE, "w-full rounded-t-xl border-2 border-b-0 border-dashed border-paper/20", l.alto)}
        style={{ animationDelay: `${l.sube}ms` }}
      />
    </li>
  );
}
