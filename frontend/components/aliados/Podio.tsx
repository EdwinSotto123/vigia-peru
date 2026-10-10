import Link from "next/link";
import { COLUMNA_PODIO, FranjaTextil, Medalla, PodioEscena } from "@/components/marca";
import { TIPO_FINANCIADOR_LABEL } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { AliadoAbrir } from "./AliadoAbrir";
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
type Medidas = { orden: string; alto: string; cara: string; numeral: string; cifra: string; medalla: number; sube: number };

const LUGAR: Record<Lugar, Medidas> = {
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

/**
 * El podio DESTACADO (portada): más alto, medallas grandes, el oro con un halo lima y
 * chispas de píxel. Las proporciones entre escalones se mantienen: sólo crece todo.
 */
const LUGAR_DESTACADO: Record<Lugar, Medidas> = {
  1: {
    orden: "order-2",
    alto: "h-24 sm:h-40 lg:h-52",
    cara: "border-maiz bg-gradient-to-b from-maiz/55 via-maiz/20 to-maiz/[0.05] shadow-[0_-18px_60px_-12px_rgba(212,255,63,0.45)]",
    numeral: "text-5xl text-maiz sm:text-7xl lg:text-8xl",
    cifra: "text-maiz",
    medalla: 96,
    sube: 400,
  },
  2: {
    orden: "order-1",
    alto: "h-16 sm:h-28 lg:h-36",
    cara: "border-medalla-plata bg-gradient-to-b from-paper/[0.2] to-paper/[0.04]",
    numeral: "text-3xl text-paper/45 sm:text-5xl lg:text-6xl",
    cifra: "text-paper",
    medalla: 72,
    sube: 200,
  },
  3: {
    orden: "order-3",
    alto: "h-12 sm:h-20 lg:h-24",
    cara: "border-medalla-bronce bg-gradient-to-b from-paper/[0.16] to-paper/[0.03]",
    numeral: "text-2xl text-paper/40 sm:text-4xl lg:text-5xl",
    cifra: "text-paper",
    medalla: 72,
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
  destacado = false,
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
  /** La versión de portada: más grande, con halo y chispas. Mismos datos, mismas reglas. */
  destacado?: boolean;
}) {
  const primeros = filas.slice(0, 3);
  if (primeros.length < 3 && !lugarLibre) return null;
  const Titulo = nivel === 3 ? "h3" : "h2";
  const texto = titulo ?? (primeros.length === 3 ? "Los tres que más contratos hicieron leer" : "Quienes más contratos hicieron leer");
  const lugares: Lugar[] = [1, 2, 3];

  return (
    <section
      aria-labelledby="podio-titulo"
      className={cn(
        "sobre-oscuro relative overflow-hidden bg-granate-deep text-paper",
        destacado
          ? "rounded-3xl border border-maiz/30 shadow-[0_0_0_1px_rgba(212,255,63,0.12),0_30px_90px_-30px_rgba(212,255,63,0.35)]"
          : "rounded-2xl",
      )}
    >
      {destacado && <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-70" />}
      <FranjaTextil alto={8} />
      <div className={cn("relative", destacado ? "px-3 pb-6 pt-6 sm:px-10 sm:pb-10 sm:pt-8" : "px-3 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5")}>
        {/* De qué ranking se habla (región, periodo) lo dicen los filtros de la página, no el podio. */}
        <Titulo
          id="podio-titulo"
          className={cn("px-1 font-display font-bold leading-tight sm:px-0", destacado ? "text-[22px] sm:text-[28px]" : "text-[17px]")}
        >
          {texto}
        </Titulo>
        <PodioEscena className={cn("mx-auto", destacado ? "mt-8 max-w-5xl" : "mt-5 max-w-3xl")}>
          {/* El piso del escenario: los escalones se apoyan en una línea, no en el borde. */}
          <ol className="grid grid-cols-3 items-end gap-1.5 border-b border-paper/20 sm:gap-3">
            {lugares.map((lugar) => {
              const fila = primeros.find((f) => f.puesto === lugar);
              return fila ? (
                <Escalon key={fila.id} lugar={lugar} fila={fila} financiadosAmbito={financiadosAmbito} destacado={destacado} />
              ) : (
                <EscalonLibre key={`libre-${lugar}`} lugar={lugar} texto={lugarLibre ?? ""} destacado={destacado} />
              );
            })}
          </ol>
        </PodioEscena>
      </div>
    </section>
  );
}

function Escalon({
  lugar,
  fila: f,
  financiadosAmbito,
  destacado,
}: {
  lugar: Lugar;
  fila: FilaRanking;
  financiadosAmbito?: number;
  destacado: boolean;
}) {
  const l = (destacado ? LUGAR_DESTACADO : LUGAR)[lugar];
  const href = hrefPerfil(f.slug);
  const tipo = esFundador(f) ? "La propia plataforma" : TIPO_FINANCIADOR_LABEL[f.tipo];
  const pct = financiadosAmbito ? pctProporcion(f.contratosFinanciados, financiadosAmbito) : null;
  const clase = "group/aliado flex h-full w-full flex-col rounded-t-xl";

  const cuerpo = (
    <>
      <span className="relative flex flex-col items-center px-0.5 pb-3 text-center">
        {/* El oro brilla un poco más: un halo de maíz detrás de la medalla, sólo luz. */}
        {lugar === 1 && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full blur-2xl",
              destacado ? "h-40 w-40 bg-maiz/35" : "h-20 w-20 bg-maiz/25",
            )}
          />
        )}
        {lugar === 1 && destacado && <Chispas />}
        <Medalla puesto={lugar} tamano={l.medalla} animada retraso={l.sube + DESPUES_DEL_ESCALON} className="relative" />
        <span aria-hidden className={cn("mt-2.5 flex", lugar === 1 && destacado && "rounded-2xl ring-2 ring-maiz ring-offset-4 ring-offset-transparent")}>
          <AvatarAliado tipo={f.tipo} logoUrl={f.logoUrl} nombre={f.nombre} size={destacado && lugar === 1 ? "xl" : "lg"} />
        </span>
        <span
          className={cn(
            "mt-2 line-clamp-2 max-w-full break-words text-[13px] font-semibold leading-snug text-paper sm:text-[15px]",
            destacado && "text-[15px] sm:text-[19px]",
            href && "underline-offset-2 group-hover/aliado:underline",
          )}
          title={f.nombre}
        >
          {f.nombre}
        </span>
        <span className="mt-0.5 hidden text-[12.5px] leading-snug text-paper/75 sm:block">{tipo}</span>
        <span
          className={cn(
            "mt-2 font-display font-extrabold leading-none tabular-nums",
            destacado ? (lugar === 1 ? "text-4xl sm:text-6xl" : "text-3xl sm:text-4xl") : "text-2xl sm:text-3xl",
            l.cifra,
          )}
        >
          {numero(f.contratosFinanciados)}
        </span>
        <span className="mt-1 text-[11.5px] leading-tight text-paper/75 sm:text-[13px]">
          {f.contratosFinanciados === 1 ? "contrato" : "contratos"}
          <span className="hidden sm:inline">{f.contratosFinanciados === 1 ? " financiado" : " financiados"}</span>
        </span>
        {/* Su parte de lo financiado, en línea propia: debajo de la cifra, no pegada con un separador. */}
        {pct && <span className="mt-0.5 hidden text-[12.5px] leading-tight text-paper/75 md:block">{pct} del total</span>}
        {/* La invitación a tocar: sin ella nadie sabe que el puesto abre al aliado. */}
        {href && (
          <span className="mt-2.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-maiz/40 px-2.5 py-1 text-[12px] font-semibold text-maiz transition-colors group-hover/aliado:bg-maiz group-hover/aliado:text-ink sm:text-[13px]">
            Ver quién es <span aria-hidden>→</span>
          </span>
        )}
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
        <AliadoAbrir fila={f} className={clase}>
          {cuerpo}
        </AliadoAbrir>
      ) : (
        <div className={clase}>{cuerpo}</div>
      )}
    </li>
  );
}

/** Un puesto sin nombre: el escalón punteado y la invitación, sin fingir que hay alguien. */
function EscalonLibre({ lugar, texto, destacado }: { lugar: Lugar; texto: string; destacado: boolean }) {
  const l = (destacado ? LUGAR_DESTACADO : LUGAR)[lugar];
  return (
    <li className={cn("min-w-0", l.orden)}>
      <Link href="/app/financiar" className="group/libre flex h-full flex-col rounded-t-xl">
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
        <span className="mt-2.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-paper/30 px-2.5 py-1 text-[12px] font-semibold text-paper/85 transition-colors group-hover/libre:border-maiz group-hover/libre:text-maiz sm:text-[13px]">
          Ocupa este lugar <span aria-hidden>→</span>
        </span>
      </span>
      <span
        aria-hidden
        className={cn(SUBE, "w-full rounded-t-xl border-2 border-b-0 border-dashed border-paper/20 transition-colors group-hover/libre:border-maiz/60", l.alto)}
        style={{ animationDelay: `${l.sube}ms` }}
      />
      </Link>
    </li>
  );
}

/**
 * Chispas de píxel alrededor del oro: cuadritos lima que titilan a destiempo. Sólo
 * decoración (aria-hidden) y sólo en el podio destacado; con movimiento reducido quedan quietas.
 */
const CHISPAS: { x: string; y: string; t: number; d: string }[] = [
  { x: "12%", y: "8%", t: 6, d: "0s" },
  { x: "84%", y: "14%", t: 8, d: "0.5s" },
  { x: "4%", y: "46%", t: 5, d: "1.1s" },
  { x: "94%", y: "52%", t: 6, d: "1.6s" },
  { x: "22%", y: "78%", t: 7, d: "0.3s" },
  { x: "78%", y: "84%", t: 5, d: "0.9s" },
  { x: "36%", y: "-2%", t: 4, d: "1.4s" },
  { x: "62%", y: "2%", t: 5, d: "1.9s" },
];

function Chispas() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-4 bottom-0">
      {CHISPAS.map((c, i) => (
        <span
          key={i}
          className="absolute bg-maiz motion-safe:animate-pulseSoft"
          style={{ left: c.x, top: c.y, width: c.t, height: c.t, animationDelay: c.d }}
        />
      ))}
    </span>
  );
}
