import type { ReactNode } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Severidad } from "@/components/ui/Severidad";
import { Dato } from "@/components/ui/Dato";
import { IconoBandera } from "@/components/ui/IconoBandera";
import type { Severidad as NivelSenal } from "@/lib/personas";

/**
 * Una señal de una persona en UNA fila: la severidad (color, ícono y palabra), qué registro coincide, el dato que la
 * sostiene y la fuente; la evidencia (la explicación, la tabla, las órdenes citadas, el enlace a la fuente) va plegada
 * debajo y se abre con un clic. Antes cada señal era una caja dentro de la caja de su entidad, con todo abierto: 350 a
 * 450 px por señal y la grave a dos pantallas (auditoría 2026-10-26). La usan la ficha de persona contratada, la de
 * planilla y el panel de la lista de planilla. Server-safe (`<details>` nativo: teclado y lector de pantalla incluidos).
 *
 * Va dentro de una lista con divisores (`ListaSenales`): sin caja propia, así dentro de una `.tarjeta` no hay tres
 * niveles de marco.
 */
export function FilaSenal({
  severidad,
  tipo,
  titulo,
  dato,
  fuente,
  extra,
  abierta = false,
  children,
}: {
  severidad: NivelSenal;
  /** El tipo de la señal: su ícono va junto al título (`IconoBandera`), el mismo en todas las listas. */
  tipo?: string;
  titulo: string;
  /** El dato que la sostiene, en una línea: "S/ 107 a Sentimiento Amazonense Regional en 2022". */
  dato?: string | null;
  /** La fuente en corto ("JNE", "ONPE"); la completa, con su enlace, va en la evidencia. */
  fuente?: string | null;
  /** Otro dato de la línea de la fuente (en cuántas entidades más vale), con su ícono. */
  extra?: ReactNode;
  abierta?: boolean;
  /** La evidencia: se ve al abrir. */
  children: ReactNode;
}) {
  return (
    <li>
      <details className="group/senal" open={abierta || undefined}>
        <summary
          className={
            "-mx-2 grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 rounded-xl px-2 py-3 " +
            "transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate " +
            "sm:grid-cols-[7.25rem_minmax(0,1fr)_auto] [&::-webkit-details-marker]:hidden"
          }
        >
          <span className="col-start-1 row-start-1 pt-px">
            <Severidad bandera={severidad} />
          </span>
          <span className="col-span-2 col-start-1 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
            <span className="flex items-start gap-1.5 text-dato font-semibold leading-snug text-ink text-pretty">
              {tipo && <IconoBandera tipo={tipo} size={15} className="mt-0.5 text-inkSoft" />}
              <span className="min-w-0">{titulo}</span>
            </span>
            {dato && <span className="mt-0.5 block text-meta leading-snug text-inkSoft text-pretty">{dato}</span>}
            {(fuente || extra) && (
              <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-rotulo text-mute">
                {fuente && (
                  <Dato tipo="documento" nombre="Fuente">
                    {fuente}
                  </Dato>
                )}
                {extra}
              </span>
            )}
          </span>
          <span className="col-start-2 row-start-1 inline-flex items-center gap-1 justify-self-end pt-0.5 text-rotulo font-medium text-granate sm:col-start-3">
            <span className="hidden sm:inline sm:group-open/senal:hidden">Ver evidencia</span>
            <span className="hidden sm:group-open/senal:inline">Ocultar</span>
            <ChevronDown size={16} aria-hidden className="shrink-0 text-mute transition-transform duration-rapido group-open/senal:rotate-180" />
          </span>
        </summary>
        <div className="space-y-3 pb-4 pt-1 sm:pl-[8rem]">{children}</div>
      </details>
    </li>
  );
}

/** La lista de señales: filas con divisores, sin caja (la caja es la tarjeta de afuera, si la hay). */
export function ListaSenales({ children, etiqueta, className }: { children: ReactNode; etiqueta: string; className?: string }) {
  return (
    <ol aria-label={etiqueta} className={"divide-y divide-line/70" + (className ? ` ${className}` : "")}>
      {children}
    </ol>
  );
}

/**
 * Una señal en una línea, sin evidencia (el Resumen de la planilla, el panel de una entidad): severidad, qué registro
 * coincide y su dato. La evidencia está en la pestaña Señales.
 */
export function SenalBreve({ severidad, titulo, dato }: { severidad: NivelSenal; titulo: string; dato?: string | null }) {
  return (
    <li className="grid grid-cols-1 gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[7.25rem_minmax(0,1fr)]">
      <span className="pt-px">
        <Severidad bandera={severidad} />
      </span>
      <span className="min-w-0">
        <span className="block text-dato font-semibold leading-snug text-ink text-pretty">{titulo}</span>
        {dato && <span className="mt-0.5 block text-meta leading-snug text-inkSoft text-pretty">{dato}</span>}
      </span>
    </li>
  );
}

/** El pie de la evidencia: de dónde sale, con el enlace al registro oficial si lo hay. */
export function FuenteSenal({ texto, url }: { texto: string; url?: string | null }) {
  return (
    <p className="text-rotulo text-mute">
      Fuente:{" "}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-granate underline-offset-2 hover:underline">
          {texto}
          <ExternalLink size={11} aria-hidden />
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      ) : (
        texto
      )}
    </p>
  );
}
