import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TonoRespuesta = "pendiente" | "bien" | "neutro" | "ojo";

const COLOR: Record<TonoRespuesta, string> = {
  pendiente: "bg-amber-soft text-amberTexto",
  bien: "bg-moss/10 text-mossTexto",
  neutro: "bg-paperSoft text-inkSoft",
  ojo: "bg-crimson-soft text-crimsonTexto",
};

/**
 * Las preguntas que trae quien llega a una ficha, cada una con su respuesta corta y lo que puede hacer (2026-11-22, el
 * usuario: «no tiene jerarquía… esfuérzate»; luego «mejor, ahora mejora lo demás así mismo»). Una lista en un solo panel:
 * la pregunta chica, la respuesta en negrita y, debajo, la acción o la aclaración. El color del ícono sale del dato
 * (bien, ojo, pendiente o neutro), no del adorno. Server-safe.
 */
export function Respuestas({ etiqueta, children, className }: { etiqueta: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={etiqueta} className={cn("min-w-0 overflow-hidden rounded-2xl border border-line bg-paper", className)}>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

export function Respuesta({
  Icono,
  tono,
  pregunta,
  respuesta,
  children,
}: {
  Icono: LucideIcon;
  tono: TonoRespuesta;
  pregunta: string;
  respuesta: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex gap-3.5 px-4 py-4 sm:px-5">
      <span aria-hidden className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", COLOR[tono])}>
        <Icono size={19} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-meta font-semibold text-inkSoft">{pregunta}</p>
        <p className="mt-0.5 text-cuerpo font-bold leading-snug text-ink">{respuesta}</p>
        {children}
      </div>
    </li>
  );
}
