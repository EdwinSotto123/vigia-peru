import Link from "next/link";
import { Check, Clock3, Sparkles } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { cn } from "@/lib/utils";

export interface Plan {
  /** El plan en la suscripción (migración 226): gratis, alertas, pro, empresa, institucional o mcp. */
  id: "gratis" | "alertas" | "inicia" | "crece" | "pro" | "empresa" | "institucional" | "mcp";
  nombre: string;
  /** Para quién es, en una línea. */
  para: string;
  /** «S/ 79», «Gratis», «A medida». */
  precio: string;
  periodo?: string;
  /** El precio de lista, tachado, cuando hay precio de fundador. */
  antes?: string;
  /** Una línea bajo el precio: «Precio de fundador: los primeros 50». */
  nota?: string;
  destacado?: boolean;
  /** Lo que ya funciona hoy. */
  incluye: string[];
  /** Lo prometido que todavía no funciona (se marca «Pronto»). */
  pronto?: string[];
  accion: { href: string; etiqueta: string };
}

/**
 * Los planes de un producto de Gobserva, en tarjetas: lo que ya funciona hoy con su marca y lo que todavía no, marcado
 * «Pronto» (sin vender como hecho lo que no lo está). El destacado lleva borde de acento y su insignia; cada tarjeta tiene
 * su ancla (#plan-pro) para enlazarla desde otras páginas. Server-safe.
 */
export function Planes({ planes, className }: { planes: Plan[]; className?: string }) {
  return (
    <ol className={cn("grid gap-4 md:grid-cols-2", planes.length >= 5 ? "lg:grid-cols-3 2xl:grid-cols-5" : planes.length === 4 ? "xl:grid-cols-4" : planes.length === 3 ? "lg:grid-cols-3" : "", className)}>
      {planes.map((p) => (
        <li
          key={p.id}
          id={`plan-${p.id}`}
          className={cn(
            "relative flex scroll-mt-24 flex-col rounded-3xl border bg-paper p-5 sm:p-6",
            p.destacado ? "border-granate shadow-[0_18px_50px_-24px_rgb(var(--granate)/0.55)]" : "border-line",
          )}
        >
          {p.destacado && (
            <span className="absolute -top-3 left-5 inline-flex items-center gap-1 rounded-full bg-granate px-3 py-1 text-rotulo font-semibold text-paper">
              {/* «Recomendado» y no «El más pedido»: sería decir algo que no medimos. */}
              <Sparkles size={12} aria-hidden /> Recomendado
            </span>
          )}
          <h3 className="font-display text-bloque font-bold leading-tight text-ink">{p.nombre}</h3>
          <p className="mt-1 text-meta leading-snug text-mute">{p.para}</p>
          <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-cifra font-bold leading-none tracking-tight tabular-nums text-ink">{p.precio}</span>
            {p.periodo && <span className="text-dato text-inkSoft">{p.periodo}</span>}
            {p.antes && (
              <span className="text-dato tabular-nums text-mute line-through">
                <span className="sr-only">Antes </span>
                {p.antes}
              </span>
            )}
          </p>
          {p.nota && <p className="mt-1.5 text-pretty text-meta font-medium text-granate">{p.nota}</p>}
          <ul className="mt-5 flex-1 space-y-2.5 text-dato">
            {p.incluye.map((x) => (
              <li key={x} className="flex gap-2.5 text-ink">
                <Check size={16} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
                <span>{x}</span>
              </li>
            ))}
            {(p.pronto ?? []).map((x) => (
              // «Pronto» en su propia columna, a la derecha: nunca queda suelta en una línea aparte.
              <li key={x} className="flex gap-2.5 text-inkSoft">
                <Clock3 size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
                <span className="min-w-0 flex-1">{x}</span>
                <span className="h-fit shrink-0 rounded-full bg-paperDeep px-1.5 py-0.5 text-rotulo font-semibold text-inkSoft">Pronto</span>
              </li>
            ))}
          </ul>
          {/* La acción de la tarjeta, de 48 px: se toca con el pulgar en el celular. */}
          <Link href={p.accion.href} className={claseAccion(p.destacado ? "primario" : "secundario", "mt-6 w-full text-center", "md")}>
            {p.accion.etiqueta}
          </Link>
        </li>
      ))}
    </ol>
  );
}
