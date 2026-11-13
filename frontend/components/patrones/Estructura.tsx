import type { ReactNode } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { ExternalLink, Info } from "@/components/ui/iconosCliente";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { fechaCorta } from "@/lib/formato";
import { IconoSeccion } from "./IconoSeccion";

/**
 * Piezas de estructura de página (DESIGN_SYSTEM.md §11.3 y §14). Una página
 * compone estas piezas y no define tipografías, colores ni espaciados propios.
 */

/**
 * El contenedor de toda página de la app (§10.7): usa el ancho que deja la barra
 * lateral, alineado a la izquierda, con el mismo padding en todas. Nada de
 * `mx-auto max-w-*` por página: centrar una vista de datos deja columnas vacías.
 * `lectura` es para prosa (preguntas, noticia): ahí sí conviene una medida de línea.
 */
export function Pagina({
  children,
  ancho = "datos",
  className,
}: {
  children: ReactNode;
  ancho?: "datos" | "lectura";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10",
        ancho === "datos" ? "max-w-[1600px]" : "max-w-3xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Título de página (el único h1), bajada y acciones. Sin kicker encima del título.
 * La bajada es UNA oración (≤ 140 caracteres); lo que explique más va en `ayuda`,
 * un ⓘ junto al título que abre la explicación al clic (§10.7).
 */
export function EncabezadoPagina({
  titulo,
  bajada,
  ayuda,
  acciones,
  banderas,
  className,
}: {
  titulo: ReactNode;
  bajada?: ReactNode;
  /** `<Ayuda titulo="¿Qué es…?">…</Ayuda>` ya armado. */
  ayuda?: ReactNode;
  acciones?: ReactNode;
  /**
   * Las banderas de la ficha (`BanderasFicha` ya armado): van bajo el título en todas las pestañas y también en el
   * celular, donde fuera del Inicio la bajada se esconde.
   */
  banderas?: ReactNode;
  className?: string;
}) {
  /* Dentro de `MarcoFicha` (components/entidad/MarcoFicha.tsx), fuera de la primera pestaña, la cabecera se pliega al
     nombre (y a la línea de sus banderas): sin la bajada, sin las acciones, sin la placa y el título en una línea. En el
     Inicio va entera. Fuera de un `MarcoFicha` estas clases no hacen nada (el grupo `ficha` no existe). Pedido del dueño del
     2026-11-13: en cada pestaña la cabecera ocupaba media pantalla antes de la lista. */
  /* El ⓘ va al final de la bajada (lo que amplía), no junto al h1: un título que
     parte en dos líneas ocupa todo el ancho y empujaba el ⓘ al borde derecho. */
  const cuerpo = bajada ? (
    <>
      <h1 className="line-clamp-3 font-display text-bloque font-bold leading-snug tracking-tight text-ink text-balance sm:text-seccion group-data-[compacta]/ficha:line-clamp-2 group-data-[compacta]/ficha:text-bloque sm:group-data-[compacta]/ficha:line-clamp-1" title={typeof titulo === "string" ? titulo : undefined}>{titulo}</h1>
      <p className="mt-1 max-w-3xl text-meta leading-snug text-inkSoft text-pretty sm:text-dato group-data-[compacta]/ficha:hidden">
        {bajada}
        {ayuda && <span className="ml-1 inline-flex align-middle">{ayuda}</span>}
      </p>
    </>
  ) : (
    <div className="flex items-center gap-2">
      <h1 className="line-clamp-3 font-display text-bloque font-bold leading-snug tracking-tight text-ink text-balance sm:text-seccion group-data-[compacta]/ficha:line-clamp-2 group-data-[compacta]/ficha:text-bloque sm:group-data-[compacta]/ficha:line-clamp-1" title={typeof titulo === "string" ? titulo : undefined}>{titulo}</h1>
      {ayuda}
    </div>
  );
  // La placa de la sección a la izquierda del título (desde `sm`): cada página se reconoce por su ícono.
  const texto = (
    <div className="flex min-w-0 items-start gap-3">
      <span className="contents group-data-[compacta]/ficha:hidden">
        <IconoSeccion />
      </span>
      <div className="min-w-0">{cuerpo}</div>
    </div>
  );
  if (banderas) {
    // Con banderas, dos columnas desde lg (pedido del usuario del 2026-11-05: «la empresa ocupa sólo el 40 % de esa
    // caja»): a la izquierda quién es y sus acciones; a la derecha, el panel de sus banderas en filas
    // (`BanderasFicha` cambia de chips a panel en lg). Abajo de lg, las banderas siguen bajo el título, en chips.
    return (
      <header className={cn("grid gap-x-8 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(21rem,27rem)] lg:items-start group-data-[compacta]/ficha:gap-y-2", className)}>
        {/* Plegada, el nombre a la altura de la línea de sus banderas (que mide 40 px), también con esa línea abierta. */}
        <div className="min-w-0 lg:group-data-[compacta]/ficha:pt-2">
          {texto}
          {acciones && <div className="mt-3 flex flex-wrap items-center gap-2 group-data-[compacta]/ficha:hidden">{acciones}</div>}
        </div>
        <div className="min-w-0">{banderas}</div>
      </header>
    );
  }
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-2", className)}>
      <div className="min-w-0 max-w-3xl">{texto}</div>
      {acciones && <div className="flex flex-wrap items-center gap-2 group-data-[compacta]/ficha:hidden">{acciones}</div>}
    </header>
  );
}

/** Una sección: h2, descripción opcional y contenido, con el ritmo vertical del sistema. */
export function Seccion({
  titulo,
  descripcion,
  ayuda,
  plegable,
  acciones,
  id,
  children,
  className,
}: {
  titulo: ReactNode;
  /** Una línea, o nada. Lo demás, en `ayuda`. */
  descripcion?: ReactNode;
  ayuda?: ReactNode;
  /**
   * Plegada con `<details>` (el h2 va en el `<summary>`): para lo largo y secundario
   * (presupuesto MEF, tablas de más de ~10 filas). `"abierta"` la muestra desplegada.
   */
  plegable?: boolean | "abierta";
  acciones?: ReactNode;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  const cabecera = (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <h2 id={id ? `${id}-titulo` : undefined} className="font-display text-seccion font-bold leading-tight text-ink text-balance">
          {titulo}
        </h2>
        {ayuda}
      </div>
      {descripcion && <p className="mt-0.5 text-dato leading-snug text-inkSoft text-pretty">{descripcion}</p>}
    </div>
  );
  if (plegable) {
    return (
      <details
        id={id}
        open={plegable === "abierta"}
        aria-labelledby={id ? `${id}-titulo` : undefined}
        className={cn("tarjeta group/plegable scroll-mt-24 rounded-2xl border border-line bg-paper", className)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          {cabecera}
          <ChevronDown size={18} className="shrink-0 text-mute transition-transform duration-rapido group-open/plegable:rotate-180" aria-hidden />
        </summary>
        <div className="border-t border-line px-4 py-4">
          {acciones && <div className="mb-3 flex flex-wrap items-center gap-2">{acciones}</div>}
          {children}
        </div>
      </details>
    );
  }
  return (
    <section id={id} aria-labelledby={id ? `${id}-titulo` : undefined} className={cn("scroll-mt-24", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        {cabecera}
        {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * Una cifra con su contexto obligatorio (DESIGN_SYSTEM.md §10.2): un número
 * suelto no dice nada. `contexto` es el denominador, la fuente o la fecha.
 */
export function Cifra({
  valor,
  etiqueta,
  contexto,
  tono = "claro",
  className,
}: {
  /** Ya formateado con lib/formato ("18,393", "S/ 1.3 M", "Sin dato"). */
  valor: ReactNode;
  etiqueta: ReactNode;
  contexto: ReactNode;
  tono?: "claro" | "oscuro";
  className?: string;
}) {
  const oscuro = tono === "oscuro";
  return (
    <div className={cn("min-w-0", className)}>
      <p className={cn("font-display text-cifra font-extrabold leading-none tabular-nums", oscuro ? "text-maiz" : "text-ink")}>{valor}</p>
      <p className={cn("mt-2 text-dato font-semibold", oscuro ? "text-paper" : "text-ink")}>{etiqueta}</p>
      <p className={cn("mt-0.5 text-meta leading-snug", oscuro ? "text-paper/75" : "text-mute")}>{contexto}</p>
    </div>
  );
}

/**
 * Una nota al pie de una lista o de una sección: cómo se cuenta, qué no incluye, de dónde sale. Va en su caja con un
 * ícono, nunca como párrafo suelto sobre el fondo (regla de diseño del usuario). Para un dato que puede estar mal,
 * AvisoDato; para una explicación que se abre, Ayuda.
 */
export function Nota({ icono, children, className }: { icono?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div role="note" className={cn("flex gap-2.5 rounded-xl border border-line bg-paperSoft/70 px-3.5 py-3", className)}>
      <span className="mt-0.5 shrink-0 text-mute">{icono ?? <Info size={15} aria-hidden />}</span>
      <p className="min-w-0 text-meta leading-relaxed text-inkSoft">{children}</p>
    </div>
  );
}

/**
 * Un enlace a una fuente oficial, que se ve como enlace: granate, subrayado y con la flecha de «se abre afuera» (antes
 * el pie «Fuente:» era gris y sin subrayar, y no se notaba que llevaba a algún lado). Para FuenteDato y la evidencia.
 */
export function EnlaceFuente({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-h-6 items-center gap-1 font-medium text-granate underline decoration-granate/35 underline-offset-2 transition-colors duration-rapido hover:decoration-granate",
        className,
      )}
    >
      {children}
      <ExternalLink size={12} className="shrink-0" aria-hidden />
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );
}

/**
 * De dónde sale un dato y de cuándo es: "Fuente: SEACE, 14 set. 2026". Con `href`, el nombre de la fuente es el enlace;
 * con `enlaces`, debajo, uno por registro oficial donde comprobarlo (el proceso en el OECE, la obra en INFOBRAS, la
 * planilla de la entidad en el Portal de Transparencia), armados con lib/fuentes.ts.
 */
export function FuenteDato({
  fuente,
  fecha,
  href,
  enlaces,
  className,
}: {
  fuente: string;
  fecha?: string | null;
  href?: string | null;
  enlaces?: ({ texto: string; href: string } | null | false | undefined)[];
  className?: string;
}) {
  const lista = (enlaces ?? []).filter((e): e is { texto: string; href: string } => !!e && !!e.href);
  return (
    <div className={cn("text-rotulo text-mute", className)}>
      <p>
        Fuente: {href ? <EnlaceFuente href={href}>{fuente}</EnlaceFuente> : fuente}
        {fecha ? `, ${fechaCorta(fecha)}` : ""}
      </p>
      {lista.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5" aria-label="Dónde comprobarlo">
          {lista.map((e) => (
            <li key={e.href}>
              <EnlaceFuente href={e.href}>{e.texto}</EnlaceFuente>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * El regreso de una ficha a su listado (§14.2): "← Contratos". Uno por página, arriba del h1.
 * Sin prefetch (auditoría A14): el listado de destino es la página más pesada de la app y
 * casi siempre se vuelve con el botón atrás del navegador, que ya lo tiene.
 */
export function Volver({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={cn("inline-flex min-h-[32px] items-center gap-1.5 text-dato text-inkSoft transition-colors duration-rapido hover:text-granate", className)}
    >
      <ArrowLeft size={15} aria-hidden />
      {children}
    </Link>
  );
}
