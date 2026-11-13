import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, Info, RotateCw } from "lucide-react";
import { Seccion } from "@/components/patrones/Estructura";
import { IconoBandera } from "@/components/ui/IconoBandera";
import { ICONO_NIVEL } from "@/components/ui/Severidad";
import { tituloNatural } from "@/lib/landing";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { GRUPOS_CRUCE } from "@/lib/cruces";
import { TIPOS, type Lectura, type ResumenContratos } from "@/lib/contratos";
import { cn } from "@/lib/utils";
import { PISTA, type ParteBarra } from "./BarraPartes";

/**
 * Las piezas de la pestaña "Inicio" de una entidad, un partido o una región: el resumen de todo en una pantalla
 * (en qué gasta, sus contratos, las banderas levantadas y los casos de corrupción), cada bloque con un enlace a la
 * pestaña que tiene el detalle. Sin estado: se arman en el servidor con lo que ya trae cada página (y sirven también
 * en el navegador: el Inicio de una región es de cliente).
 * Colores sólo con los tokens del tema (DESIGN_SYSTEM.md): nada de hex.
 *
 * Dos formas de armar un Inicio:
 *   · `RejillaInicio` + `BloqueInicio`: bloques del mismo peso en dos columnas (partido, región).
 *   · `SubseccionInicio` (h2) con sus `BloqueInicio nivel={3}` adentro: el orden de la ficha (§14.2) "qué se encontró
 *     → dinero → control", con la columna lateral aparte (entidad). La rejilla de bloques iguales «no dice nada»: el
 *     dueño no encontraba qué mirar primero (2026-10-26).
 */

/**
 * Bloques del mismo peso en dos columnas desde lg. `className` para `items-start` (cada bloque mide lo suyo) cuando los
 * vecinos tienen largos muy distintos: «En sus contratos» y «En las personas…» iban uno debajo del otro a 1,030 px, con
 * la etiqueta a 900 px de su número (auditoría del 2026-11-05).
 */
export function RejillaInicio({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-4 lg:grid-cols-2", className)}>{children}</div>;
}

/** El "Ver …  ›" de la cabecera de un bloque o una subsección: lleva a la pestaña o la lista con el detalle. */
function EnlaceInicio({ href, texto }: { href: string; texto: string }) {
  return (
    <Link href={href} prefetch={false} className="inline-flex min-h-8 shrink-0 items-center gap-0.5 text-meta font-semibold text-granate underline-offset-4 hover:underline">
      {texto} <ChevronRight size={14} aria-hidden />
    </Link>
  );
}

/**
 * Una subsección del Inicio de una ficha ("Qué se encontró", "Dinero", "Control"): su título (h2), una línea y su ⓘ;
 * adentro, sus bloques con título h3 (`BloqueInicio nivel={3}`). Es `Seccion` del kit con el ritmo del Inicio.
 */
export function SubseccionInicio({
  titulo,
  descripcion,
  ayuda,
  enlace,
  id,
  children,
}: {
  titulo: string;
  /** Una línea, o nada: lo demás va en `ayuda`. */
  descripcion?: ReactNode;
  ayuda?: ReactNode;
  enlace?: { href: string; texto: string };
  id?: string;
  children: ReactNode;
}) {
  return (
    <Seccion id={id} titulo={titulo} descripcion={descripcion} ayuda={ayuda} acciones={enlace ? <EnlaceInicio {...enlace} /> : undefined}>
      {/* Dos columnas desde lg: apiladas, las tarjetas del Inicio de una entidad median 5,7 pantallas en una columna con el
          resto del ancho vacio (auditoria del 2026-11-13). Cada tarjeta mide lo suyo (`items-start`). */}
      <div className="space-y-4 lg:columns-2 lg:gap-4 lg:space-y-0 [&>*]:break-inside-avoid lg:[&>*]:mb-4 lg:[&>.grid]:[column-span:all]">{children}</div>
    </Seccion>
  );
}

/** Un bloque: título con su "?", el contenido y, si hay, el enlace a la pestaña con el detalle. */
export function BloqueInicio({
  titulo,
  ayuda,
  enlace,
  ancho = false,
  nivel = 2,
  className,
  children,
}: {
  titulo: string;
  ayuda?: ReactNode;
  enlace?: { href: string; texto: string };
  /** Ocupa las dos columnas de la rejilla. */
  ancho?: boolean;
  /**
   * 2 (por defecto): el bloque es una sección de la pestaña Inicio (bajo el h1 de la ficha no hay otro nivel).
   * 3: va dentro de una `SubseccionInicio`, que ya pone el h2.
   */
  nivel?: 2 | 3;
  /** Un bloque sin dato va con `lg:self-start`: no se estira al alto del vecino (una tarjeta grande y vacía). */
  className?: string;
  children: ReactNode;
}) {
  const Titulo = nivel === 3 ? "h3" : "h2";
  return (
    <section className={`tarjeta min-w-0 rounded-2xl border border-line bg-paper p-4 sm:p-5${ancho ? " lg:col-span-2" : ""}${className ? ` ${className}` : ""}`}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        {/* La ⓘ va AL LADO del título y no dentro: dentro, su texto pasaba a ser parte del nombre del título para el
            lector de pantalla. */}
        <div className="flex items-center gap-1.5">
          <Titulo className="font-display text-bloque font-bold text-ink">{titulo}</Titulo>
          {ayuda}
        </div>
        {enlace && <EnlaceInicio {...enlace} />}
      </header>
      {children}
    </section>
  );
}

/** Una tarjeta de primer nivel sin título propio: cuando la subsección ya lo pone (h2) y adentro va una sola pieza. */
export function TarjetaInicio({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`tarjeta min-w-0 rounded-2xl border border-line bg-paper p-4 sm:p-5${className ? ` ${className}` : ""}`}>{children}</div>;
}

/**
 * Lo que no tiene dato, al final del Inicio y en una línea cada uno: "En qué gasta: Sin dato…". Antes era una tarjeta
 * vacía del mismo tamaño que las llenas (y «En qué gasta» sin presupuesto ocupaba el primer lugar).
 */
export function LineasSinDato({ items }: { items: { titulo: string; motivo: ReactNode }[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1.5 border-t border-line pt-4" aria-label="Lo que no tiene dato">
      {items.map((i) => (
        <li key={i.titulo} className="flex items-start gap-2 text-meta leading-snug text-mute">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="font-semibold text-inkSoft">{i.titulo}:</span> {i.motivo}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Texto en gris cuando no hay dato: nunca un 0 inventado. */
export function SinDato({ children }: { children: ReactNode }) {
  // Un estado, no un párrafo suelto: una línea en su caja suave, con su ícono.
  return (
    <p className="flex items-start gap-2 rounded-xl bg-paperSoft px-3 py-2.5 text-dato text-mute">
      <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * Un servicio que no respondió ESTA vez (no es que falte el dato): una línea y «Reintentar», que vuelve a pedir la página.
 * Antes decía «Sin dato: el servicio de contratos no respondió», como si fuera definitivo, en una captura sí y en otra no
 * (el Inicio de un partido, auditoría del 2026-11-05). Un `<a>` y no un `Link`: navegar a la misma URL con el enrutador
 * puede devolver la página que ya tiene guardada (con el mismo fallo); así el servidor la arma de nuevo, y como Next no
 * guarda una respuesta fallida, el pedido se repite de verdad.
 */
export function SinRespuesta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-paperSoft px-3 py-2 text-dato text-mute">
      <span className="flex min-w-0 items-center gap-2">
        <Info size={15} className="shrink-0" aria-hidden />
        <span className="min-w-0">{children}</span>
      </span>
      <a href={href} className="inline-flex min-h-8 items-center gap-1 font-semibold text-granate underline-offset-4 hover:underline">
        <RotateCw size={14} aria-hidden /> Reintentar
      </a>
    </p>
  );
}

export interface RubroGasto {
  nombre: string;
  pim: number;
  devengado: number;
}

/**
 * "En qué gasta": los rubros más grandes del presupuesto (PIM), cada barra con la parte ya gastada (devengado)
 * encima. El largo es contra el rubro mayor; el texto dice qué parte del total es.
 */
export function BarrasGasto({ rubros, total, maximo = 5 }: { rubros: RubroGasto[]; total: number; maximo?: number }) {
  const lista = [...rubros].filter((r) => r.pim > 0).sort((a, b) => b.pim - a.pim).slice(0, maximo);
  const mayor = Math.max(1, ...lista.map((r) => r.pim));
  return (
    <ol className="space-y-3">
      {lista.map((r) => {
        const gastado = r.pim > 0 ? (r.devengado / r.pim) * 100 : 0;
        return (
          <li key={r.nombre}>
            <div className="flex items-baseline justify-between gap-3 text-dato">
              <span className="min-w-0 truncate text-ink" title={r.nombre}>{tituloNatural(r.nombre)}</span>
              <span className="shrink-0 font-mono tabular-nums text-inkSoft">{solesCompacto(r.pim)}</span>
            </div>
            <div
              className="mt-1 h-2 overflow-hidden rounded-full bg-paperDeep"
              role="img"
              aria-label={`${solesCompacto(r.pim)} de presupuesto, ${porcentaje(gastado)} ya gastado`}
            >
              <div className="h-full rounded-full bg-granate/25" style={{ width: `${Math.max(2, (r.pim / mayor) * 100)}%` }}>
                <div className="h-full rounded-full bg-granate" style={{ width: `${Math.min(100, gastado)}%` }} />
              </div>
            </div>
            <dl className="mt-1 flex flex-wrap gap-x-5 text-rotulo">
              <div className="flex gap-1">
                <dt className="text-mute">Gastado</dt>
                <dd className="font-mono tabular-nums text-ink">{porcentaje(gastado)}</dd>
              </div>
              <div className="flex gap-1">
                <dt className="text-mute">Del total</dt>
                <dd className="font-mono tabular-nums text-ink">{porcentaje(total > 0 ? (r.pim / total) * 100 : 0)}</dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ol>
  );
}

/** Una fila de `ListaConteos`: qué se cuenta, cuántos y la lista ya filtrada que los muestra. */
export interface FilaConteo {
  etiqueta: string;
  n: number;
  href?: string;
  /** Una línea debajo: de qué es la cifra o cómo se compone. */
  detalle?: string;
  /** Una bandera grave: el ícono de severidad en rojo, la barra del mismo tono y la etiqueta en negrita. */
  grave?: boolean;
  /** De severidad media (el riesgo medio de lo leído): el ícono ámbar de su severidad. */
  media?: boolean;
  /**
   * Lo que comparten varias filas seguidas («Antecedentes del ganador más frecuentes», «De sus 1,322 inversiones en
   * Invierte.pe»): va UNA vez, como subtítulo sobre ellas. Antes se repetía como detalle bajo cada una.
   */
  grupo?: string;
  /** El tipo de bandera o de señal (`IconoBandera`): el ícono de su familia al comienzo de la fila. */
  tipo?: string;
  /**
   * De cuántos es la cifra (sus contratos, sus obras, las personas que contrató): el largo de su barra y el % escrito al
   * lado. Sin él, la fila va sin barra: medida frente a la fila mayor, «Leídos con riesgo alto 25» llenaba la barra
   * aunque fueran 25 de 219 leídos (auditoría del 2026-11-05).
   */
  de?: number;
}

/**
 * Filas «ícono, etiqueta, barra, %, número ›», cada una con su enlace al filtro que la muestra. La gravedad se ve (el ícono
 * de severidad en rojo y su barra del mismo tono, no sólo una negrita), la barra dice qué parte de su total (`de`) es la
 * cifra, con el % escrito, y las filas en 0 van al final de su grupo, en gris: antes «Leídos con riesgo alto 0» abría la
 * lista. Lo que varias filas repetían debajo va una vez arriba de ellas (`grupo`). Todo lo nuevo de `FilaConteo` es
 * opcional: sin `grupo`, `tipo` ni `de`, una sola lista con la bandera genérica y sin barras.
 * Sin estado ni funciones: sirve en el servidor y en el navegador (el Inicio del panel de zona es de cliente).
 */
export function ListaConteos({ filas }: { filas: FilaConteo[] }) {
  // Los grupos son filas seguidas con el mismo `grupo`. En cada uno, las de 0 al final (en su orden); y los grupos sin
  // ningún caso, después de los que tienen alguno.
  const grupos: { grupo?: string; filas: FilaConteo[] }[] = [];
  for (const f of filas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.grupo === f.grupo) ultimo.filas.push(f);
    else grupos.push({ grupo: f.grupo, filas: [f] });
  }
  const conCasos = (f: FilaConteo) => f.n > 0;
  const ordenados = grupos
    .map((g) => ({ ...g, filas: [...g.filas.filter(conCasos), ...g.filas.filter((f) => !conCasos(f))] }))
    .sort((a, b) => Number(!conCasos(a.filas[0])) - Number(!conCasos(b.filas[0])));
  return (
    // Dentro de una tarjeta (un bloque de Inicio), sin marco propio: sólo los divisores.
    <div className="space-y-3 rounded-xl border border-line py-1.5 [container-type:inline-size] [.tarjeta_&]:rounded-none [.tarjeta_&]:border-0 [.tarjeta_&]:py-0">
      {ordenados.map((g, i) => {
        // Un grupo sin nombre que bajó por estar en 0 se nombra igual: si no, se leería como parte del grupo de arriba.
        const titulo = g.grupo ?? (i > 0 && !conCasos(g.filas[0]) ? "Sin casos" : undefined);
        return (
          <div key={`${i}-${g.grupo ?? ""}`}>
            {titulo && (
              <p aria-hidden className="px-3.5 pb-1 text-rotulo font-semibold leading-snug text-mute">
                {titulo}
              </p>
            )}
            <ul aria-label={titulo} className="divide-y divide-line/70">
              {g.filas.map((f) => (
                <FilaLista key={f.etiqueta} f={f} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Una fila de `ListaConteos`: el ícono, la etiqueta (y su detalle), la barra con su %, el número y, si abre su lista, la
 * flecha. La barra sólo con un total (`de`): sin él, el número solo.
 */
function FilaLista({ f }: { f: FilaConteo }) {
  const hay = f.n > 0;
  const grave = hay && !!f.grave;
  const media = hay && !grave && !!f.media;
  const Nivel = grave ? ICONO_NIVEL.alta : ICONO_NIVEL.media;
  // Nunca más de 100 %: si el total llegó más chico que la cifra (dos conteos de distinto momento), manda la cifra.
  const de = f.de && f.de > 0 ? Math.max(f.de, f.n) : 0;
  const cuota = de ? (f.n / de) * 100 : 0;
  const menosDeUno = cuota > 0 && cuota < 1;
  // La misma barra va debajo de la etiqueta (contenedor angosto) o en su columna (ancho): una sola se ve.
  const barra =
    hay && de ? (
      <BarraConteo parte={cuota} texto={menosDeUno ? `<${porcentaje(1)}` : porcentaje(cuota)} tono={grave ? "grave" : media ? "media" : "neutra"} />
    ) : null;
  const cuerpo = (
    <>
      {grave || media ? (
        <>
          <Nivel size={15} className={cn("mt-0.5 shrink-0 self-start", grave ? "text-rust" : "text-amberTexto")} aria-hidden />
          <span className="sr-only">{grave ? "Bandera grave: " : "Bandera media: "}</span>
        </>
      ) : (
        <IconoBandera tipo={f.tipo ?? ""} size={15} className={cn("mt-0.5 self-start", hay ? "text-inkSoft" : "text-mute")} />
      )}
      {/* Hasta tres líneas en lo angosto y dos en lo ancho: «Ganó una empresa ligada a la gestión» quedaba en «…la ges…».
          Desde 34rem de lista (el contenedor, no la pantalla: el Inicio de un partido va en dos columnas), la etiqueta toma
          un ancho fijo y la barra llena lo que queda hasta el número: antes, a 1,030 px, la etiqueta quedaba a 900 px de su
          cifra y la barra era un trazo de 112 px. Las clases van enteras: Tailwind no ve las armadas con una constante. */}
      <span className="min-w-0 flex-1 [@container(min-width:34rem)]:w-[42%] [@container(min-width:34rem)]:flex-none">
        <span className={cn("line-clamp-3 text-dato leading-snug [@container(min-width:34rem)]:line-clamp-2", !hay ? "text-mute" : grave ? "font-semibold text-ink" : "text-ink")}>
          {f.etiqueta}
        </span>
        {f.detalle && <span className="mt-0.5 line-clamp-2 text-rotulo leading-snug text-mute">{f.detalle}</span>}
        {barra && <span className="mt-1.5 block [@container(min-width:34rem)]:hidden">{barra}</span>}
      </span>
      {/* La columna de la barra va también en las filas en 0 (vacía): así los números quedan alineados. */}
      <span className="hidden min-w-0 flex-1 [@container(min-width:34rem)]:block">{barra}</span>
      <span className={cn("relative min-w-10 shrink-0 text-right font-mono text-dato tabular-nums [@container(min-width:34rem)]:min-w-14", hay ? "text-ink" : "text-mute")}>
        {numero(f.n)}
        {/* El % de la barra es para el ojo (aria-hidden): el lector de pantalla lo oye aquí, con su total. */}
        {barra && <span className="sr-only">{`, ${menosDeUno ? `menos de ${porcentaje(1)}` : porcentaje(cuota)} de ${numero(de)}`}</span>}
      </span>
      <span className="flex w-3.5 shrink-0 justify-end">{hay && !!f.href && <ChevronRight size={14} className="text-mute" aria-hidden />}</span>
    </>
  );
  const clase = "flex min-h-11 items-center gap-2.5 px-3.5 py-2";
  return (
    <li>
      {hay && f.href ? (
        <Link
          href={f.href}
          prefetch={false}
          className={cn(clase, "transition-colors duration-rapido hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate")}
        >
          {cuerpo}
        </Link>
      ) : (
        <span className={clase}>{cuerpo}</span>
      )}
    </li>
  );
}

/**
 * El color de una marca según lo que dice (skill dataviz, «colores por rol»): rojo y ámbar SÓLO para la severidad (grave,
 * media); lo demás, la primera serie de los gráficos (--serie-1), no el gris de antes, que hacía de todas las filas la
 * misma barra apagada («muy sosa en el día», pedido del usuario del 2026-11-05). Tampoco la marca: de día es verde y se
 * leería como algo bueno, o como un enlace. La pista es un tono claro del mismo color (como `Medidor`).
 * Clases enteras: Tailwind no ve las armadas.
 */
const MARCA_CONTEO = { grave: "bg-crimson", media: "bg-amber", neutra: "bg-[rgb(var(--serie-1))]" } as const;
const PISTA_CONTEO = { grave: "bg-crimson/15", media: "bg-amber/20", neutra: "bg-[rgb(var(--serie-1)_/_0.16)]" } as const;

/**
 * La barra de una fila: qué parte de su total (`de`) es la cifra, y el % escrito al lado (ancho fijo: todas las pistas
 * de una lista miden lo mismo y se comparan). El número ya está escrito en la fila: barra y % son para el ojo.
 */
function BarraConteo({ parte, texto, tono }: { parte: number; texto: string; tono: keyof typeof MARCA_CONTEO }) {
  const p = Math.min(100, Math.max(0, Number.isFinite(parte) ? parte : 0));
  return (
    <span aria-hidden className="flex items-center gap-2">
      <span className={cn("block h-2 min-w-0 flex-1 overflow-hidden rounded-full", PISTA_CONTEO[tono])}>
        <span className={cn("block h-full rounded-full", MARCA_CONTEO[tono])} style={{ width: `${p > 0 ? Math.max(2, p) : 0}%` }} />
      </span>
      <span className="w-11 shrink-0 text-right text-rotulo tabular-nums text-inkSoft">{texto}</span>
    </span>
  );
}

/** Cómo se pinta cada parte de un `RepartoInicio`: por lo que dice, no por su lugar. */
export type TonoReparto = "grave" | "media" | "neutra" | "aparte" | "ninguna";
const CLASE_REPARTO: Record<TonoReparto, string> = {
  grave: "bg-crimson",
  media: "bg-amber",
  neutra: "bg-[rgb(var(--serie-1))]",
  aparte: "bg-[rgb(var(--serie-otros))]",
  ninguna: PISTA,
};

export interface ParteReparto {
  clave: string;
  etiqueta: string;
  n: number;
  /** grave y media: severidad (rojo, ámbar); neutra: lo demás que tiene algo (--serie-1); aparte: lo que no se cuenta
   *  todavía, como lo que está en revisión (--serie-otros); ninguna: lo que no tiene nada (la pista). */
  tono: TonoReparto;
  /** La lista ya filtrada que muestra esa parte: su renglón de la leyenda es el enlace. */
  href?: string;
}

/**
 * La cabeza de un bloque de banderas: el TODO partido en sus partes (con uno grave, con otro, sin nada) en una barra
 * segmentada fina, con su leyenda debajo (muestra de color, nombre, cifra y %), y de cuántos es arriba a la derecha.
 * Antes cada bloque eran filas con barras grises iguales medidas contra la fila mayor: «Con alguna señal 33,829» llenaba
 * su barra sin decir de cuántas (auditoría del 2026-11-05). El color nunca va solo: cada parte lleva su nombre y su cifra.
 * Sin estado: sirve en el servidor y en el navegador.
 */
export function RepartoInicio({ titulo, de, partes, className }: { titulo: string; de: string; partes: ParteReparto[]; className?: string }) {
  const visibles = partes.filter((p) => p.n > 0);
  const total = visibles.reduce((s, p) => s + p.n, 0);
  if (total <= 0) return null;
  // «menos de 1 %» y no «0 %»: una parte que existe nunca se lee como nada.
  const cuota = (n: number) => {
    const x = (100 * n) / total;
    return x > 0 && x < 1 ? `menos de ${porcentaje(1)}` : porcentaje(x);
  };
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-meta font-semibold text-ink">{titulo}</p>
        <p className="text-rotulo tabular-nums text-mute">{de}</p>
      </div>
      <div role="img" aria-label={`${titulo}, ${de}: ${visibles.map((p) => `${p.etiqueta}, ${numero(p.n)} (${cuota(p.n)})`).join("; ")}`} className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
        {visibles.map((p) => (
          // Cada tramo crece en proporción a su parte (descontados los 2 px de aire); el más chico se ve igual.
          <span key={p.clave} title={`${p.etiqueta}: ${numero(p.n)} (${cuota(p.n)})`} className={cn("h-full min-w-1", CLASE_REPARTO[p.tono])} style={{ flex: `${p.n} 1 0%` }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-0.5 text-meta">
        {visibles.map((p) => {
          const cuerpo = (
            <>
              <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", CLASE_REPARTO[p.tono], p.tono === "ninguna" && "border border-line")} />
              {/* Lo que abre su lista va subrayado (como la etiqueta de una cifra de la franja): se ve que se toca. */}
              <span className={cn(p.tono === "grave" ? "font-semibold text-ink" : "text-inkSoft", p.href && "underline decoration-line underline-offset-4 group-hover/parte:decoration-granate group-hover/parte:text-ink")}>
                {p.etiqueta}
              </span>
              <span className="font-mono font-semibold tabular-nums text-ink">{numero(p.n)}</span>
              <span className="text-rotulo tabular-nums text-mute">{cuota(p.n)}</span>
            </>
          );
          return (
            <li key={p.clave}>
              {p.href ? (
                <Link href={p.href} prefetch={false} className="group/parte inline-flex min-h-8 items-center gap-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate">
                  {cuerpo}
                </Link>
              ) : (
                <span className="inline-flex min-h-8 items-center gap-1.5">{cuerpo}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Nombre corto de un tipo de antecedente ("Sancionado por el OECE"), del mismo catálogo que el desplegable. */
const CORTO = new Map(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t.corto] as const)));
export const nombreCruce = (tipo: string) => CORTO.get(tipo) ?? tipo.replace(/_/g, " ");

/**
 * Banderas levantadas en los contratos: arriba, los dos TODOS partidos en sus partes (`RepartoInicio`), cada uno con su
 * propio total: los antecedentes del ganador de TODOS sus contratos (con uno grave, con otro, sin ninguno) y el riesgo de
 * lo que leyó Vigía (alto, medio, bajo, en revisión). Debajo, las filas: las señales de `extra` y los tipos de
 * antecedente más frecuentes, cada una con su barra contra el total de contratos y su %. `href(filtro)` arma el enlace a
 * la lista de contratos ya filtrada.
 *
 * Antes eran sólo filas con barras grises iguales medidas contra la fila mayor: «Penalidades 135» llenaba su barra
 * siendo 135 de 1,120 contratos (auditoría del 2026-11-05). Sin `total` (el panel de zona del mapa, que no lo pasa), las
 * filas de antes («Ganador con un antecedente grave», «con algún antecedente») sin barra.
 *
 * Toda señal nueva de un contrato entra aquí, como una fila más con su lista filtrada (`extra`), y no como un cartel
 * aparte: así llegó la captura política de la entidad, que eran cuatro bloques. `sinTipos` saca de "los más frecuentes"
 * los tipos que ya cuenta una fila de `extra` (no se repite la cifra).
 */
export function Banderas({
  porRiesgo,
  porCruces,
  href,
  tipos = 5,
  extra = [],
  sinTipos = [],
  conRiesgo = true,
  conAlguno = true,
  total,
  porLectura,
  unidad = ["contrato", "contratos"],
}: {
  porRiesgo: Partial<Record<string, number>> | null | undefined;
  porCruces: { con: number; alta: number; tipos?: Record<string, number> } | null | undefined;
  href: (filtro: Record<string, string>) => string;
  tipos?: number;
  extra?: FilaConteo[];
  sinTipos?: string[];
  /** `false` cuando no hay nada leído: el riesgo de lo leído no dice nada si no se leyó ninguno. */
  conRiesgo?: boolean;
  /** Sin `total`: `false` cuando la cabecera de la ficha ya dice cuántos tienen algún antecedente (la misma cifra dos veces). */
  conAlguno?: boolean;
  /** Cuántos contratos cuentan los antecedentes (los de la base de Vigía): el total del reparto y de las barras de las filas. */
  total?: number | null;
  /** «¿Lo leyó Vigía?»: los que están en revisión humana (el riesgo de un partido no los trae). */
  porLectura?: { revision?: number } | null;
  /** Cómo se dice el total: «de 1,120 contratos» o, en un partido, «… en la base de Vigía». */
  unidad?: [string, string];
}) {
  if (!porRiesgo && !porCruces && !extra.length) return <SinDato>Sin dato: el servicio de contratos no respondió.</SinDato>;

  // El riesgo de lo leído, con lo que está en revisión humana como una parte más: todos de lo que leyó Vigía.
  const alto = porRiesgo?.alto ?? 0;
  const medio = porRiesgo?.medio ?? 0;
  const bajo = porRiesgo?.bajo ?? 0;
  const revision = porLectura?.revision ?? porRiesgo?.en_revision ?? 0;
  const leidos = alto + medio + bajo + revision;
  const riesgo =
    conRiesgo && leidos > 0 ? (
      <RepartoInicio
        key="riesgo"
        titulo="El riesgo de lo que leyó Vigía"
        de={`de ${plural(leidos, "contrato leído", "contratos leídos")}`}
        partes={[
          { clave: "alto", etiqueta: "Riesgo alto", n: alto, tono: "grave", href: href({ riesgo: "alto" }) },
          { clave: "medio", etiqueta: "Riesgo medio", n: medio, tono: "media", href: href({ riesgo: "medio" }) },
          { clave: "bajo", etiqueta: "Riesgo bajo", n: bajo, tono: "neutra", href: href({ riesgo: "bajo" }) },
          { clave: "revision", etiqueta: "En revisión humana", n: revision, tono: "aparte", href: href({ lectura: "revision" }) },
        ]}
      />
    ) : null;

  // Los antecedentes del ganador, de TODOS los contratos (no sólo los leídos): con uno grave, con otro y sin ninguno.
  const deCruces = porCruces && total != null ? Math.max(total, porCruces.con) : 0;
  const cruces =
    porCruces && deCruces > 0 ? (
      <RepartoInicio
        key="cruces"
        titulo="Antecedentes del ganador"
        de={`de ${plural(deCruces, unidad[0], unidad[1])}`}
        partes={[
          { clave: "alta", etiqueta: "Con uno grave", n: porCruces.alta, tono: "grave", href: href({ cruces: "alta" }) },
          // «Con otro» no tiene filtro propio («con» incluye los graves): el enlace de la cabecera del bloque los abre.
          { clave: "otro", etiqueta: "Con otro antecedente", n: Math.max(0, porCruces.con - porCruces.alta), tono: "neutra" },
          { clave: "sin", etiqueta: "Sin antecedentes", n: Math.max(0, deCruces - porCruces.con), tono: "ninguna" },
        ]}
      />
    ) : null;

  const filas: FilaConteo[] = [
    // Una señal de `extra` sin total propio es de los mismos contratos.
    ...extra.map((f) => (f.de || !deCruces ? f : { ...f, de: deCruces })),
    // Sin total (no hay reparto): las dos filas de antes, sin barra. Con un total de 0, nada que contar.
    ...(porCruces && total == null
      ? [
          { etiqueta: "Ganador con un antecedente grave", n: porCruces.alta, href: href({ cruces: "alta" }), grave: true },
          ...(conAlguno ? [{ etiqueta: "Ganador con algún antecedente", n: porCruces.con, href: href({ cruces: "con" }) }] : []),
        ]
      : []),
    // Los tipos, bajo UN subtítulo (antes «antecedente del ganador» se repetía bajo cada uno), cada uno con su ícono y su
    // barra contra el total de contratos.
    // recorte: los `tipos` más frecuentes; todos, en el filtro «Antecedentes» de la lista (el enlace del bloque)
    ...Object.entries(porCruces?.tipos ?? {})
      .filter(([tipo, n]) => n > 0 && !sinTipos.includes(tipo))
      .sort((a, b) => b[1] - a[1])
      .slice(0, tipos)
      .map(([tipo, n]) => ({ etiqueta: nombreCruce(tipo), grupo: "Antecedentes del ganador más frecuentes", tipo, n, href: href({ cruces: tipo }), de: deCruces || undefined })),
  ];

  const repartos = [cruces, riesgo].filter(Boolean);
  if (!repartos.length && !filas.length) return <SinDato>Ninguno de sus contratos está en la base de Vigía: no hay banderas que contar.</SinDato>;
  return (
    // Los dos repartos lado a lado si el bloque es ancho (el contenedor, no la pantalla), uno sobre otro si no.
    <div className="space-y-5 [container-type:inline-size]">
      {repartos.length > 0 && <div className="grid gap-x-8 gap-y-5 px-3.5 [@container(min-width:44rem)]:grid-cols-2">{repartos}</div>}
      {filas.length > 0 && <ListaConteos filas={filas} />}
    </div>
  );
}

// ─── Sus contratos por tipo y por lectura (entidad y región) ────────────────────

/**
 * El color de cada tipo de contrato: categórico, por su lugar en `TIPOS` (bienes, servicios, consultoría, obras, convenio,
 * directa) en las series de los gráficos (--serie-1…6); «Otro» en la serie de lo demás y «Sin tipo» en la pista. Antes,
 * marca, añil y grises alternados (la mitad del reparto en gris). Clases enteras: Tailwind no ve las armadas.
 */
const SERIE_TIPO = [
  "bg-[rgb(var(--serie-1))]",
  "bg-[rgb(var(--serie-2))]",
  "bg-[rgb(var(--serie-3))]",
  "bg-[rgb(var(--serie-4))]",
  "bg-[rgb(var(--serie-5))]",
  "bg-[rgb(var(--serie-6))]",
] as const;

/** Sus contratos por tipo, como partes de `BarraPartes`: cada una con su lista filtrada (los sin tipo no tienen filtro). */
export function partesPorTipo(porTipo: ResumenContratos["porTipo"], contratos: (f: Record<string, string>) => string): ParteBarra[] {
  return [
    ...TIPOS.map((t, i) => ({
      clave: t.value,
      etiqueta: t.label,
      n: porTipo[t.value] ?? 0,
      href: contratos({ tipo: t.value }),
      clase: i < SERIE_TIPO.length ? SERIE_TIPO[i] : "bg-[rgb(var(--serie-otros))]",
    })),
    // Los que el OECE no clasifica también suman el total; no tienen filtro.
    { clave: "sin_clasificar", etiqueta: "Sin tipo", n: porTipo.sin_clasificar ?? 0, clase: PISTA },
  ];
}

/** Si Vigía leyó (o está leyendo) alguno: sin ninguno, la barra de «¿Lo leyó Vigía?» era toda «Aún no». */
export const hayLectura = (l: Partial<Record<Lectura, number>> | null | undefined) => !!l && (l.publicado ?? 0) + (l.revision ?? 0) + (l.leyendo ?? 0) > 0;

/** «¿Lo leyó Vigía?» como partes de `BarraPartes`: una rampa de la marca, de lo leído a lo que aún no (la pista). */
export function partesPorLectura(l: Partial<Record<Lectura, number>>, contratos: (f: Record<string, string>) => string): ParteBarra[] {
  return [
    { clave: "publicado", etiqueta: "Con dictamen", n: l.publicado ?? 0, href: contratos({ lectura: "publicado" }), clase: "bg-granate", destacada: true },
    { clave: "revision", etiqueta: "En revisión humana", n: l.revision ?? 0, href: contratos({ lectura: "revision" }), clase: "bg-granate/50" },
    { clave: "leyendo", etiqueta: "Leyéndose", n: l.leyendo ?? 0, href: contratos({ lectura: "leyendo" }), clase: "bg-granate/25" },
    { clave: "sin_leer", etiqueta: "Aún no", n: l.sin_leer ?? 0, href: contratos({ lectura: "sin_leer" }), clase: PISTA },
  ];
}

/** Barras de un solo valor (monto), contra el mayor: "en qué contrataron", "dónde". Cada fila puede llevar a su filtro. */
export function BarrasMonto({ items, maximo = 6 }: { items: { nombre: string; monto: number; detalle?: string; href?: string }[]; maximo?: number }) {
  const lista = [...items].filter((i) => i.monto > 0).sort((a, b) => b.monto - a.monto).slice(0, maximo);
  const mayor = Math.max(1, ...lista.map((i) => i.monto));
  return (
    <ol className="space-y-3">
      {lista.map((i) => {
        const fila = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-dato">
              <span className="min-w-0 truncate text-ink" title={i.nombre}>{tituloNatural(i.nombre)}</span>
              <span className="shrink-0 font-mono tabular-nums text-inkSoft">{solesCompacto(i.monto)}</span>
            </span>
            <span className="mt-1 block h-2 overflow-hidden rounded-full bg-paperDeep" role="img" aria-label={`${solesCompacto(i.monto)}`}>
              <span className="block h-full rounded-full bg-granate" style={{ width: `${Math.max(2, (i.monto / mayor) * 100)}%` }} />
            </span>
            {i.detalle && <span className="mt-0.5 block text-rotulo text-mute">{i.detalle}</span>}
          </>
        );
        return (
          <li key={i.nombre}>
            {i.href ? (
              <Link href={i.href} prefetch={false} className="block rounded-lg transition-colors hover:bg-granate-50">{fila}</Link>
            ) : (
              <span className="block">{fila}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Un reparto en fichas: cada parte con su nombre y su número, cada ficha su propio enlace (si lo tiene). Para "por tipo"
 * y "¿lo leyó Vigía?": datos distintos lado a lado, no una frase con separadores.
 */
export function Fichas({ items }: { items: { etiqueta: string; n: number; href?: string; destacada?: boolean }[] }) {
  const visibles = items.filter((i) => i.n > 0);
  if (!visibles.length) return <span className="text-mute">Ninguno</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {visibles.map((i) => {
        const cuerpo = (
          <>
            <span className={i.destacada ? "font-semibold text-ink" : "text-inkSoft"}>{i.etiqueta}</span>
            <span className="font-mono text-meta tabular-nums text-ink">{numero(i.n)}</span>
          </>
        );
        const clase = "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-paper px-3 text-meta";
        return (
          <li key={i.etiqueta}>
            {i.href ? (
              <Link href={i.href} prefetch={false} className={`${clase} transition-colors hover:border-granate/40 hover:bg-granate-50`}>{cuerpo}</Link>
            ) : (
              <span className={clase}>{cuerpo}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
