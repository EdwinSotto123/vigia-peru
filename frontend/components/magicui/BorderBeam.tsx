import { cn } from "@/lib/utils";

/**
 * Magic UI — BorderBeam.
 * Un punto de luz que recorre el borde del contenedor padre en loop. El padre debe ser
 * `relative` (o `position` no-static) y tener `overflow-hidden` + `rounded-*` — este
 * componente es un `<span>` absoluto, así que no cruza ningún límite server/client
 * (no recibe funciones, es puro CSS) y puede usarse desde cualquier server component.
 */
export function BorderBeam({
  className,
  size = 90,
  duration = 8,
  delay = 0,
  colorFrom = "#BE7B26",
  colorTo = "transparent",
}: {
  className?: string;
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent",
        "[mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]",
      )}
    >
      <span
        className={cn("absolute aspect-square", className)}
        style={{
          width: size,
          background: `linear-gradient(to left, ${colorFrom}, ${colorTo})`,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          offsetAnchor: "90% 50%",
          // La utility `animate-border-beam` de tailwind.config depende de la custom
          // property `--duration` (`calc(var(--duration)*1s)`) — si no está seteada,
          // TODO el shorthand `animation` queda inválido (var() sin resolver invalida
          // el shorthand completo, incluido animation-name → "none", no solo la duración
          // que sí parecía "ganar" via inline). Más simple y robusto: armar el shorthand
          // completo acá, sin depender de esa custom property.
          animation: `border-beam ${duration}s infinite linear`,
          animationDelay: `${delay}s`,
        }}
      />
    </div>
  );
}
