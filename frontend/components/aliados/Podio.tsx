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
        tamano === "lg" ? "h-9 min-w-[2.75rem] px-2.5 text-destacado" : "h-7 min-w-[2.25rem] px-2 text-meta",
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

/** La invitación cuando todavía no hay tres aliados con nombre, igual en la portada y en /app/aliados. */
export const LUGAR_LIBRE = "El siguiente puede ser el tuyo, el de tu colectivo o el de tu empresa.";

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
    numeral: "text-2xl text-paper/60 sm:text-3xl lg:text-4xl",
    cifra: "text-paper",
    medalla: 54,
    sube: 200,
  },
  3: {
    orden: "order-3",
    alto: "h-8 sm:h-12 lg:h-14",
    cara: "border-medalla-bronce bg-gradient-to-b from-paper/[0.11] to-paper/[0.02]",
    numeral: "text-xl text-paper/60 sm:text-2xl lg:text-3xl",
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
    numeral: "text-3xl text-paper/70 sm:text-5xl lg:text-6xl",
    cifra: "text-paper",
    medalla: 72,
    sube: 200,
  },
  3: {
    orden: "order-3",
    alto: "h-12 sm:h-20 lg:h-24",
    cara: "border-medalla-bronce bg-gradient-to-b from-paper/[0.16] to-paper/[0.03]",
    numeral: "text-2xl text-paper/65 sm:text-4xl lg:text-5xl",
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
 * El podio existe sólo con TRES aliados con nombre o más. Con uno o dos, una fila honesta
 * por aliado (sin medallas ni escalones vacíos) y la invitación (`lugarLibre`): un podio con
 * dos losas «¿Serás tú?» y una medalla para la propia plataforma probaba soledad, justo lo
 * que DIRECCION.md descarta (tiene que leerse bien con n=1). Sin `lugarLibre`, con menos de
 * tres no se dibuja.
 */
export function PodioRanking({
  filas,
  financiadosAmbito,
  titulo,
  nivel = 2,
  lugarLibre,
  destacado = false,
  subtitulo,
  nota,
}: {
  /** Los primeros del ranking (hasta tres), ya con su puesto. */
  filas: FilaRanking[];
  /** Total financiado del ámbito: sin él no se dice qué parte es de cada uno. */
  financiadosAmbito?: number;
  /** Por defecto, "Los tres que…" con tres nombres y "Quienes…" con menos. */
  titulo?: string;
  /** Nivel del título: 2 en /app/aliados; 3 dentro de una sección de la portada. */
  nivel?: 2 | 3;
  /** La invitación cuando todavía no hay tres. Sin este texto, con menos de tres no se dibuja nada. */
  lugarLibre?: string;
  /** La versión de portada: más grande, con halo y chispas. Mismos datos, mismas reglas. */
  destacado?: boolean;
  /** Una frase bajo el título: qué significa estar acá. Con ella, el podio se pone al lado del texto (desde lg). */
  subtitulo?: string;
  /** Lo que se dice bajo el subtítulo, a la izquierda del podio: cómo se gana un puesto. */
  nota?: React.ReactNode;
}) {
  const primeros = filas.slice(0, 3);
  const conPodio = primeros.length === 3;
  if (!conPodio && (!lugarLibre || primeros.length === 0)) return null;
  const Titulo = nivel === 3 ? "h3" : "h2";
  const texto = conPodio
    ? titulo ?? "Los tres que más contratos hicieron leer"
    : primeros.length === 1
      ? "Quien hace leer los contratos"
      : "Quienes hacen leer los contratos";
  const lugares: Lugar[] = [1, 2, 3];
  // Con subtítulo (la versión de la app), el texto va a la izquierda y el podio a la derecha: sin una franja vacía a los lados.
  const lateral = !!subtitulo && !destacado && conPodio;

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
        <div className={cn(lateral && "lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-8")}>
        <div className="min-w-0">
        {/* Sin rótulo encima del título (DESIGN_SYSTEM.md §4): el título habla solo. */}
        <Titulo
          id="podio-titulo"
          className={cn("px-1 font-display font-bold leading-tight sm:px-0", destacado ? "text-seccion sm:text-cifra" : subtitulo ? "text-seccion sm:text-cifra lg:text-titulo" : "text-bloque")}
        >
          {texto}
        </Titulo>
        {subtitulo && <p className="mt-2 max-w-[60ch] px-1 text-dato leading-snug text-paper/80 sm:px-0 sm:text-destacado">{subtitulo}</p>}
        {/* Sin filete de color al costado: una nota es texto, no un cartel. */}
        {nota && <div className="mt-4 hidden max-w-[48ch] space-y-2 text-dato leading-snug text-paper/75 lg:block">{nota}</div>}
        </div>
        {conPodio ? (
          <PodioEscena className={cn("mx-auto", destacado ? "mt-8 max-w-5xl" : lateral ? "mt-5 max-w-3xl lg:mt-0 lg:max-w-none" : "mt-5 max-w-3xl")}>
            {/* El piso del escenario: los escalones se apoyan en una línea, no en el borde. */}
            <ol className="grid grid-cols-3 items-end gap-1.5 border-b border-paper/20 sm:gap-3">
              {lugares.map((lugar) => {
                // Los tres llegan ordenados: si un puesto no coincide (la página del API cuenta también a los anónimos), manda el orden.
                const fila = primeros.find((f) => f.puesto === lugar) ?? primeros[lugar - 1];
                return <Escalon key={fila.id} lugar={lugar} fila={fila} financiadosAmbito={financiadosAmbito} destacado={destacado} />;
              })}
            </ol>
          </PodioEscena>
        ) : (
          <FilaHonesta filas={primeros} financiadosAmbito={financiadosAmbito} invitacion={lugarLibre ?? ""} />
        )}
        </div>
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
        {lugar === 1 && <Chispas />}
        <Medalla puesto={lugar} tamano={l.medalla} animada retraso={l.sube + DESPUES_DEL_ESCALON} className="relative" />
        <span aria-hidden className={cn("mt-2.5 flex", lugar === 1 && destacado && "rounded-2xl ring-2 ring-maiz ring-offset-4 ring-offset-transparent")}>
          <AvatarAliado tipo={f.tipo} logoUrl={f.logoUrl} nombre={f.nombre} size={destacado && lugar === 1 ? "xl" : "lg"} />
        </span>
        <span
          className={cn(
            "mt-2 line-clamp-2 max-w-full break-words text-meta font-semibold leading-snug text-paper sm:text-cuerpo",
            destacado && "text-cuerpo sm:text-bloque",
            href && "underline-offset-2 group-hover/aliado:underline",
          )}
          title={f.nombre}
        >
          {f.nombre}
        </span>
        <span className="mt-0.5 hidden text-meta leading-snug text-paper/75 sm:block">{tipo}</span>
        <span
          className={cn(
            "mt-2 font-display font-extrabold leading-none tabular-nums",
            destacado ? (lugar === 1 ? "text-4xl sm:text-6xl" : "text-3xl sm:text-4xl") : "text-2xl sm:text-3xl",
            l.cifra,
          )}
        >
          {numero(f.contratosFinanciados)}
        </span>
        <span className="mt-1 text-rotulo leading-tight text-paper/75 sm:text-meta">
          {f.contratosFinanciados === 1 ? "contrato" : "contratos"}
          <span className="hidden sm:inline">{f.contratosFinanciados === 1 ? " financiado" : " financiados"}</span>
        </span>
        {/* Su parte de lo financiado, en línea propia: debajo de la cifra, no pegada con un separador. */}
        {pct && <span className="mt-0.5 hidden text-meta leading-tight text-paper/75 md:block">{pct} del total</span>}
        {!!financiadosAmbito && (
          <span aria-hidden className="mt-1.5 hidden h-1.5 w-full max-w-[7rem] overflow-hidden rounded-full bg-paper/15 sm:block">
            <span className="block h-full rounded-full bg-maiz" style={{ width: `${Math.min(100, Math.round((f.contratosFinanciados / financiadosAmbito) * 100))}%` }} />
          </span>
        )}
        {/* La invitación a tocar: sin ella nadie sabe que el puesto abre al aliado. */}
        {href && (
          <span className="mt-2.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-maiz/40 px-2.5 py-1 text-rotulo font-semibold text-maiz transition-colors group-hover/aliado:bg-maiz group-hover/aliado:text-ink sm:text-meta">
            Ver quién es <span aria-hidden>→</span>
          </span>
        )}
      </span>
      <span
        aria-hidden
        className={cn(SUBE, "relative flex w-full justify-center overflow-hidden rounded-t-xl border-t-2 pt-1.5 sm:pt-2", l.alto, l.cara)}
        style={{ animationDelay: `${l.sube}ms` }}
      >
        <span aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-30" />
        <span className={cn("relative font-display font-extrabold leading-none tabular-nums", l.numeral)}>{lugar}</span>
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

/**
 * Con uno o dos aliados con nombre: una fila por aliado, sin medallas ni escalones (un podio con lugares vacíos y una
 * medalla para la propia plataforma probaba soledad), con lo mismo que diría su escalón —quién es, cuántos contratos
 * financió, su parte del total— y, debajo, la invitación en una frase. Cada fila abre al aliado sin salir de la página.
 */
function FilaHonesta({ filas, financiadosAmbito, invitacion }: { filas: FilaRanking[]; financiadosAmbito?: number; invitacion: string }) {
  return (
    <div className="mt-4">
      <ul className="divide-y divide-paper/15 border-y border-paper/15">
        {filas.map((f) => {
          const href = hrefPerfil(f.slug);
          const tipo = esFundador(f) ? "La propia plataforma" : TIPO_FINANCIADOR_LABEL[f.tipo];
          const pct = financiadosAmbito ? pctProporcion(f.contratosFinanciados, financiadosAmbito) : null;
          const clase = "group/aliado flex w-full items-center gap-3 px-1 py-3 text-left sm:gap-4";
          const cuerpo = (
            <>
              <span aria-hidden className="flex shrink-0">
                <AvatarAliado tipo={f.tipo} logoUrl={f.logoUrl} nombre={f.nombre} size="lg" />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn("block truncate font-display text-bloque font-bold leading-snug text-paper", href && "underline-offset-2 group-hover/aliado:underline")}
                  title={f.nombre}
                >
                  {f.nombre}
                </span>
                <span className="block text-meta leading-snug text-paper/75">
                  {tipo}
                  {href && <span className="text-maiz"> Ver quién es <span aria-hidden>→</span></span>}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-display text-cifra font-extrabold leading-none tabular-nums text-maiz">{numero(f.contratosFinanciados)}</span>
                <span className="mt-1 block text-rotulo leading-tight text-paper/75">
                  {f.contratosFinanciados === 1 ? "contrato financiado" : "contratos financiados"}
                  {pct && <span className="block">{pct} del total</span>}
                </span>
              </span>
            </>
          );
          return (
            <li key={f.id} className="min-w-0">
              {href ? (
                <AliadoAbrir fila={f} className={clase}>
                  {cuerpo}
                </AliadoAbrir>
              ) : (
                <div className={clase}>{cuerpo}</div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 max-w-[60ch] text-dato leading-snug text-paper/80">
        {filas.length === 1 ? "Por ahora hay un solo aliado con nombre." : "Por ahora hay dos aliados con nombre."} El podio se arma con
        tres. {invitacion}
      </p>
    </div>
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
