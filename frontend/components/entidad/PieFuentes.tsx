import { BookCheck } from "lucide-react";
import { FuenteDato } from "@/components/patrones";
import { cn } from "@/lib/utils";

/**
 * Las fuentes de una pestaña entera, en su caja con ícono (2026-11-23, el usuario: «secciones que son solo texto sin fondo
 * o forma»): antes el «Fuente:» y sus enlaces iban sueltos al pie, sobre el fondo de la página. Las fichas de entidad y de
 * región y la comparación lo usan; la fuente de una tarjeta sola va en su pie (`FuenteDato` con `border-t`).
 */
export function PieFuentes({ className, ...fuente }: Parameters<typeof FuenteDato>[0]) {
  return (
    <div className={cn("flex gap-2.5 rounded-xl border border-line bg-paper px-3.5 py-3", className)}>
      <BookCheck size={15} aria-hidden className="mt-0.5 shrink-0 text-mute" />
      <FuenteDato {...fuente} className="min-w-0" />
    </div>
  );
}
