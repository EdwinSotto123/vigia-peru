import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, Info } from "lucide-react";
import { Seccion } from "@/components/patrones/Estructura";
import { IconoBandera } from "@/components/ui/IconoBandera";
import { ICONO_NIVEL } from "@/components/ui/Severidad";
import { tituloNatural } from "@/lib/landing";
import { numero, porcentaje, solesCompacto } from "@/lib/formato";
import { GRUPOS_CRUCE } from "@/lib/cruces";
import { cn } from "@/lib/utils";

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

export function RejillaInicio({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 lg:grid-cols-2">{children}</div>;
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
      <div className="space-y-4">{children}</div>
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
  /** De cuántos es la cifra (sus obras, las personas que contrató): el largo de su barra. Sin él, frente a la fila mayor. */
  de?: number;
}

/**
 * Filas «ícono, etiqueta, barra, número ›», cada una con su enlace al filtro que la muestra. La gravedad se ve (el ícono de
 * severidad en rojo y su barra del mismo tono, no sólo una negrita), la barra dice cuánto pesa la cifra (de su total o
 * frente a la fila mayor) y las filas en 0 van al final de su grupo, en gris: antes «Leídos con riesgo alto 0» abría la
 * lista. Lo que varias filas repetían debajo va una vez arriba de ellas (`grupo`). Todo lo nuevo de `FilaConteo` es
 * opcional: sin `grupo`, `tipo` ni `de`, una sola lista con la bandera genérica y las barras frente a la mayor.
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
  // Las filas sin `de` se miden contra la mayor de ellas.
  const mayor = Math.max(1, ...filas.filter((f) => !f.de).map((f) => f.n));
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
                <FilaLista key={f.etiqueta} f={f} mayor={mayor} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Una fila de `ListaConteos`: el ícono, la etiqueta (y su detalle), la barra, el número y, si abre su lista, la flecha. */
function FilaLista({ f, mayor }: { f: FilaConteo; mayor: number }) {
  const hay = f.n > 0;
  const grave = hay && !!f.grave;
  const media = hay && !grave && !!f.media;
  const Nivel = grave ? ICONO_NIVEL.alta : ICONO_NIVEL.media;
  const cuota = f.de ? (f.n / f.de) * 100 : 0;
  const resumen = f.de
    ? `${numero(f.n)} de ${numero(f.de)} (${cuota > 0 && cuota < 1 ? `menos de ${porcentaje(1)}` : porcentaje(cuota)})`
    : `${numero(f.n)}, frente a ${numero(mayor)} de la fila mayor`;
  // La misma barra va debajo de la etiqueta (contenedor angosto) o en su columna (ancho): una sola se ve.
  const barra = hay ? <BarraConteo parte={f.n / (f.de || mayor)} resumen={resumen} grave={grave} /> : null;
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
          Desde 34rem de lista (el contenedor, no la pantalla: el Inicio de un partido va en dos columnas), la barra pasa a
          su columna, al lado del número. Las clases van enteras: Tailwind no ve las armadas con una constante. */}
      <span className="min-w-0 flex-1">
        <span className={cn("line-clamp-3 text-dato leading-snug [@container(min-width:34rem)]:line-clamp-2", !hay ? "text-mute" : grave ? "font-semibold text-ink" : "text-ink")}>
          {f.etiqueta}
        </span>
        {f.detalle && <span className="mt-0.5 line-clamp-2 text-rotulo leading-snug text-mute">{f.detalle}</span>}
        {barra && <span className="mt-1.5 block [@container(min-width:34rem)]:hidden">{barra}</span>}
      </span>
      {/* La columna de la barra va también en las filas en 0: así los números quedan alineados. */}
      <span className="hidden w-28 shrink-0 [@container(min-width:34rem)]:block">{barra}</span>
      <span className={cn("min-w-10 shrink-0 text-right font-mono text-dato tabular-nums [@container(min-width:34rem)]:min-w-14", hay ? "text-ink" : "text-mute")}>
        {numero(f.n)}
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
 * La barra de una fila: qué parte de su total (`de`) es la cifra, o cuánto frente a la fila mayor. Roja si la fila es
 * grave; si no, neutra (la marca no es severidad, y de día la marca es verde: se leería como algo bueno). El número ya
 * está escrito al lado: la barra es para el ojo (su `title` lo dice en palabras).
 */
function BarraConteo({ parte, resumen, grave }: { parte: number; resumen: string; grave: boolean }) {
  const p = Math.min(1, Math.max(0, Number.isFinite(parte) ? parte : 0));
  return (
    <span aria-hidden title={resumen} className="block h-1.5 w-full overflow-hidden rounded-full bg-paperDeep">
      <span className={cn("block h-full rounded-full", grave ? "bg-rust/80" : "bg-inkSoft/50")} style={{ width: `${p > 0 ? Math.max(3, p * 100) : 0}%` }} />
    </span>
  );
}

/** Nombre corto de un tipo de antecedente ("Sancionado por el OECE"), del mismo catálogo que el desplegable. */
const CORTO = new Map(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t.corto] as const)));
export const nombreCruce = (tipo: string) => CORTO.get(tipo) ?? tipo.replace(/_/g, " ");

/**
 * Banderas levantadas: riesgo de lo leído y antecedentes del ganador (con uno grave, con alguno y los tipos más
 * frecuentes). `href(filtro)` arma el enlace a la lista de contratos ya filtrada.
 *
 * Toda señal nueva de un contrato entra aquí, como una fila más con su lista filtrada (`extra`, antes de los
 * antecedentes), y no como un cartel aparte: así llegó la captura política de la entidad, que eran cuatro bloques.
 * `sinTipos` saca de "los más frecuentes" los tipos que ya cuenta una fila de `extra` (no se repite la cifra).
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
}: {
  porRiesgo: Partial<Record<string, number>> | null | undefined;
  porCruces: { con: number; alta: number; tipos?: Record<string, number> } | null | undefined;
  href: (filtro: Record<string, string>) => string;
  tipos?: number;
  extra?: FilaConteo[];
  sinTipos?: string[];
  /** `false` cuando no hay nada leído: "Leídos con riesgo alto 0" no dice nada si no se leyó ninguno. */
  conRiesgo?: boolean;
  /** `false` cuando la cabecera de la ficha ya dice cuántos tienen algún antecedente (la misma cifra dos veces). */
  conAlguno?: boolean;
}) {
  if (!porRiesgo && !porCruces && !extra.length) return <SinDato>Sin dato: el servicio de contratos no respondió.</SinDato>;
  const filas: FilaConteo[] = [
    ...(conRiesgo
      ? [
          { etiqueta: "Leídos con riesgo alto", n: porRiesgo?.alto ?? 0, href: href({ riesgo: "alto" }), grave: true },
          { etiqueta: "Leídos con riesgo medio", n: porRiesgo?.medio ?? 0, href: href({ riesgo: "medio" }), media: true },
        ]
      : []),
    ...extra,
    ...(porCruces
      ? [
          { etiqueta: "Ganador con un antecedente grave", n: porCruces.alta, href: href({ cruces: "alta" }), grave: true },
          ...(conAlguno ? [{ etiqueta: "Ganador con algún antecedente", n: porCruces.con, href: href({ cruces: "con" }) }] : []),
          // Los tipos, bajo UN subtítulo (antes «antecedente del ganador» se repetía bajo cada uno), cada uno con su ícono.
          ...Object.entries(porCruces.tipos ?? {})
            .filter(([tipo]) => !sinTipos.includes(tipo))
            .sort((a, b) => b[1] - a[1])
            .slice(0, tipos)
            .map(([tipo, n]) => ({ etiqueta: nombreCruce(tipo), grupo: "Antecedentes del ganador más frecuentes", tipo, n, href: href({ cruces: tipo }) })),
        ]
      : []),
  ];
  return <ListaConteos filas={filas} />;
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
