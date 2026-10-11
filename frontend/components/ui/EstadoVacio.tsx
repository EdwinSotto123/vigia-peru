import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Estado vacío en línea: un ícono chico, UNA frase y, a lo sumo, un enlace de acción. Nunca una caja
 * alta con un mensaje de dos líneas perdido en el medio (esas medían 1.100 x 230 px con 100 caracteres).
 *
 *   variante "franja"   (por defecto) una sola línea, sin caja: para listas, tablas y paneles vacíos.
 *   variante "compacta" ícono + frase + acción con un filete a la izquierda; máximo ~72 px de alto.
 *
 * Props: `icono` (nodo, p. ej. <Inbox size={16}/>), `children` (la frase: qué pasa y, si hace falta,
 * qué hacer), `accion` ({ href, etiqueta } o un nodo ya armado), `tono` ("neutro" | "error"), `className`.
 * Server-safe. Anuncia con role="status" para que un lector de pantalla lo lea al aparecer.
 */

export function EstadoVacio({
  icono,
  children,
  accion,
  variante = "franja",
  tono = "neutro",
  className,
}: {
  icono?: ReactNode;
  children: ReactNode;
  accion?: { href: string; etiqueta: string } | ReactNode;
  variante?: "franja" | "compacta";
  tono?: "neutro" | "error";
  className?: string;
}) {
  const enlace =
    accion && typeof accion === "object" && "href" in (accion as object) && "etiqueta" in (accion as object) ? (
      <Link
        href={(accion as { href: string }).href}
        className="shrink-0 text-[13.5px] font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
      >
        {(accion as { etiqueta: string }).etiqueta}
      </Link>
    ) : (
      (accion as ReactNode)
    );
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] leading-snug",
        tono === "error" ? "text-crimsonTexto" : "text-mute",
        variante === "compacta" ? "border-l-2 border-line py-2 pl-3" : "py-1.5",
        className,
      )}
    >
      {icono && <span className="shrink-0 text-mute" aria-hidden>{icono}</span>}
      <span className="min-w-0">{children}</span>
      {enlace}
    </div>
  );
}
