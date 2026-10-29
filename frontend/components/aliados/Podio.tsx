import Link from "next/link";
import { Plus } from "lucide-react";
import { COLUMNA_PODIO, FranjaTextil, Medalla, PodioEscena } from "@/components/marca";
import { TIPO_FINANCIADOR_LABEL } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { AliadoAbrir } from "./AliadoAbrir";
import { AvatarAliado } from "./TarjetaAliado";
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

/** Adónde lleva un lugar libre: el aporte al fondo común (migración 206). */
export const HREF_APOYAR = "/app/apoyar";

/** «oct. 2026»: desde cuándo sostiene la vigilancia. */
const mesCorto = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("es-PE", { month: "short", year: "numeric", timeZone: "America/Lima" }).format(new Date(iso)) : null;

/** El escalón que sube (la clase compartida del kit de marca, server-safe). */
const SUBE = COLUMNA_PODIO;

/**
 * Cada lugar del podio. El DOM va 1, 2, 3 (el orden de lectura); la vista, 2, 1, 3.
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
 * El podio de los aliados (pedido del usuario del 2026-10-29: «que sea un PODIO»), el mismo en la portada y en
 * /app/aliados: siempre tres escalones (1.º al centro, el más alto; 2.º a la izquierda; 3.º a la derecha). Un lugar
 * ocupado lleva su medalla, el logo y el nombre del aliado y CUÁNTOS MESES sostiene la vigilancia; uno libre, la
 * medalla apagada y la invitación a ocuparlo. Se gana por constancia, nunca por plata (ranking.ts): con S/ 5 al mes se
 * llega al primer lugar igual que con S/ 500, y la semilla de Vigía Perú no compite, así que la plataforma no se pone
 * medallas a sí misma (lo que DIRECCION.md temía de un podio). Al entrar en pantalla los escalones suben (3.º, 2.º,
 * 1.º) y la medalla aparece; el servidor lo pinta quieto y completo, así que sin JS o con movimiento reducido se ve
 * igual.
 */
export function PodioRanking({
  filas,
  titulo,
  nivel = 2,
  destacado = false,
  subtitulo,
  nota,
  cuando = "",
}: {
  /** Los primeros del ranking (hasta tres), ya con su puesto. Los que falten van como lugares libres. */
  filas: FilaRanking[];
  /** Por defecto, según cuántos lugares están ocupados. */
  titulo?: string;
  /** Nivel del título: 2 en /app/aliados; 3 dentro de una sección de la portada. */
  nivel?: 2 | 3;
  /** La versión de portada: más grande, con halo y chispas. Mismos datos, mismas reglas. */
  destacado?: boolean;
  /** Una frase bajo el título: qué significa estar acá. Con ella, el podio se pone al lado del texto (desde lg). */
  subtitulo?: string;
  /** Lo que se dice bajo el subtítulo, a la izquierda del podio: cómo se gana un puesto. */
  nota?: React.ReactNode;
  /** « este mes», « este año» o vacío: el periodo del podio, para la invitación de abajo. */
  cuando?: string;
}) {
  const primeros = filas.slice(0, 3);
  const Titulo = nivel === 3 ? "h3" : "h2";
  const libres = 3 - primeros.length;
  const texto =
    titulo ??
    (primeros.length === 0 ? "El podio está por estrenarse" : primeros.length === 1 ? "Quien sostiene la vigilancia" : "Quienes sostienen la vigilancia");
  const lugares: Lugar[] = [1, 2, 3];
  // Con subtítulo (la versión de la app), el texto va a la izquierda y el podio a la derecha: sin una franja vacía a los lados.
  const lateral = !!subtitulo && !destacado;
  // Cómo se gana un lugar, siempre a la vista. En la versión de la app, desde lg va en la columna del texto, bajo el
  // subtítulo (donde estaba la nota que repetía la bajada de la página), y no en una línea suelta bajo las dos columnas.
  const leyenda = (
    <>
      {libres === 3
        ? `Todavía nadie con nombre${cuando}: quien se sume primero ocupa el primer lugar.`
        : libres > 0
          ? `${libres === 1 ? "Queda un lugar libre" : "Quedan dos lugares libres"} en el podio${cuando}.`
          : null}{" "}
      Se gana por constancia, no por plata: cada mes que aportas cuenta, desde S/ 5.
    </>
  );

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
      <div className={cn("relative", destacado ? "px-3 pb-6 pt-6 sm:px-10 sm:pb-10 sm:pt-8" : "px-3 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5")}>
        <div className={cn(lateral && "lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-8")}>
          <div className="min-w-0">
            {/* Sin rótulo encima del título (DESIGN_SYSTEM.md §4): el título habla solo. */}
            <Titulo
              id="podio-titulo"
              className={cn(
                "px-1 font-display font-bold leading-tight sm:px-0",
                destacado ? "text-seccion sm:text-cifra" : subtitulo ? "text-seccion sm:text-cifra lg:text-titulo" : "text-bloque",
              )}
            >
              {texto}
            </Titulo>
            {subtitulo && <p className="mt-2 max-w-[60ch] px-1 text-dato leading-snug text-paper/80 sm:px-0 sm:text-destacado">{subtitulo}</p>}
            {/* Sin filete de color al costado: una nota es texto, no un cartel. */}
            {nota && <div className="mt-4 hidden max-w-[48ch] space-y-2 text-dato leading-snug text-paper/75 lg:block">{nota}</div>}
            {lateral && <p className="mt-4 hidden max-w-[48ch] text-dato leading-snug text-paper/80 lg:block">{leyenda}</p>}
          </div>
          <PodioEscena className={cn("mx-auto", destacado ? "mt-8 max-w-5xl" : lateral ? "mt-5 max-w-3xl lg:mt-0 lg:max-w-none" : "mt-5 max-w-3xl")}>
            {/* El piso del escenario: los escalones se apoyan en una línea, no en el borde. */}
            <ol className="grid grid-cols-3 items-end gap-1.5 border-b border-paper/20 sm:gap-3" aria-label="Podio de aliados">
              {lugares.map((lugar) => {
                // Los tres llegan ordenados: si un puesto no coincide (la página del API cuenta también a los anónimos), manda el orden.
                const fila = primeros.find((f) => f.puesto === lugar) ?? primeros[lugar - 1];
                return fila ? (
                  <Escalon key={fila.id} lugar={lugar} fila={fila} destacado={destacado} />
                ) : (
                  <LugarLibre key={`libre-${lugar}`} lugar={lugar} destacado={destacado} />
                );
              })}
            </ol>
          </PodioEscena>
        </div>
        {/* Bajo el podio: en el celular y en la portada; en la app desde lg ya está en la columna del texto. */}
        <p
          className={cn(
            "mt-4 max-w-[70ch] px-1 text-dato leading-snug text-paper/80 sm:px-0",
            lateral && "lg:hidden",
            destacado && "sm:mt-6 sm:text-destacado",
          )}
        >
          {leyenda}
        </p>
      </div>
    </section>
  );
}

function Escalon({ lugar, fila: f, destacado }: { lugar: Lugar; fila: FilaRanking; destacado: boolean }) {
  const l = (destacado ? LUGAR_DESTACADO : LUGAR)[lugar];
  const href = hrefPerfil(f.slug);
  const desde = mesCorto(f.desde);
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
            "mt-2 line-clamp-2 max-w-full break-words text-meta font-semibold leading-snug text-paper sm:text-cuerpo",
            destacado && "text-cuerpo sm:text-bloque",
            href && "underline-offset-2 group-hover/aliado:underline",
          )}
          title={f.nombre}
        >
          {f.nombre}
        </span>
        <span className="mt-0.5 hidden text-meta leading-snug text-paper/75 sm:block">{TIPO_FINANCIADOR_LABEL[f.tipo]}</span>
        <span
          className={cn(
            "mt-2 font-display font-extrabold leading-none tabular-nums",
            destacado ? (lugar === 1 ? "text-4xl sm:text-6xl" : "text-3xl sm:text-4xl") : "text-2xl sm:text-3xl",
            l.cifra,
          )}
        >
          {numero(f.meses)}
        </span>
        <span className="mt-1 text-rotulo leading-tight text-paper/75 sm:text-meta">
          {f.meses === 1 ? "mes" : "meses"}
          <span className="hidden sm:inline"> sosteniendo</span>
        </span>
        {desde && <span className="mt-0.5 hidden text-meta leading-tight text-paper/70 md:block">desde {desde}</span>}
        {f.mensual && (
          <span className="mt-1.5 inline-flex items-center rounded-full bg-maiz/15 px-2 py-0.5 text-rotulo font-semibold text-maiz">Cada mes</span>
        )}
        {/* La invitación a tocar: sin ella nadie sabe que el puesto abre al aliado. */}
        {href && (
          <span className="mt-2.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-maiz/40 px-2.5 py-1 text-rotulo font-semibold text-maiz transition-colors group-hover/aliado:bg-maiz group-hover/aliado:text-ink sm:text-meta">
            Ver quién es <span aria-hidden>→</span>
          </span>
        )}
      </span>
      <Pedestal l={l} lugar={lugar} />
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
 * Un lugar que nadie ocupa todavía: la medalla apagada (todavía no se entregó), un marco punteado en lugar del logo y
 * la invitación a ocuparlo, que lleva al aporte. El escalón es el mismo: el podio se ve entero aunque falten nombres.
 */
function LugarLibre({ lugar, destacado }: { lugar: Lugar; destacado: boolean }) {
  const l = (destacado ? LUGAR_DESTACADO : LUGAR)[lugar];
  const marco = destacado && lugar === 1 ? "h-20 w-20 rounded-2xl" : "h-14 w-14 rounded-xl";
  return (
    <li className={cn("min-w-0", l.orden)}>
      <Link href={HREF_APOYAR} className="group/libre flex h-full w-full flex-col rounded-t-xl">
        <span className="relative flex flex-col items-center px-0.5 pb-3 text-center">
          <Medalla puesto={lugar} tamano={l.medalla} corona={false} className="relative opacity-35 grayscale" />
          <span
            aria-hidden
            className={cn(
              "mt-2.5 flex items-center justify-center border-2 border-dashed border-paper/35 text-paper/60 transition-colors group-hover/libre:border-maiz group-hover/libre:text-maiz",
              marco,
            )}
          >
            <Plus size={destacado && lugar === 1 ? 30 : 22} />
          </span>
          <span className={cn("mt-2 text-meta font-semibold leading-snug text-paper sm:text-cuerpo", destacado && "text-cuerpo sm:text-bloque")}>
            Lugar libre
          </span>
          <span className="mt-0.5 hidden text-meta leading-snug text-paper/70 sm:block">Puede ser el tuyo</span>
          <span className="mt-2.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-maiz/40 px-2.5 py-1 text-rotulo font-semibold text-maiz transition-colors group-hover/libre:bg-maiz group-hover/libre:text-ink sm:text-meta">
            Ocúpalo <span aria-hidden>→</span>
          </span>
        </span>
        <Pedestal l={l} lugar={lugar} apagado />
      </Link>
    </li>
  );
}

/** El escalón con su número. Apagado, en un lugar libre: el mismo alto, la cara más tenue. */
function Pedestal({ l, lugar, apagado = false }: { l: Medidas; lugar: Lugar; apagado?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(SUBE, "relative flex w-full justify-center overflow-hidden rounded-t-xl border-t-2 pt-1.5 sm:pt-2", l.alto, l.cara, apagado && "opacity-50")}
      style={{ animationDelay: `${l.sube}ms` }}
    >
      <span aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-30" />
      <span className={cn("relative font-display font-extrabold leading-none tabular-nums", l.numeral)}>{lugar}</span>
    </span>
  );
}

/**
 * Chispas de píxel alrededor del oro: cuadritos lima que titilan a destiempo. Sólo
 * decoración (aria-hidden) y sólo en el podio destacado; con movimiento reducido quedan quietas.
 * Van en la franja de la medalla y la corona: más abajo caían sobre «desde set. 2026» y «Cada mes».
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
    <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-4 h-36">
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
