import { cn } from "@/lib/utils";

const COLOR: Record<string, string> = {
  moss: "bg-moss",
  amber: "bg-amber",
  rust: "bg-rust",
  paper: "bg-paper",
};

/**
 * Punto pulsante para indicadores "en vivo" (ping + dot sólido) — el mismo patrón de
 * dos `<span>` estaba repetido a mano en 8 archivos (auditoría, convocatoria, sidebar)
 * con leves variaciones de color. Puro CSS/datos: sirve igual en server o client.
 */
export function PulseDot({ color = "moss", size = 6, className }: { color?: keyof typeof COLOR; className?: string; size?: number }) {
  const bg = COLOR[color] ?? COLOR.moss;
  const dim = { width: size, height: size };
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={dim} aria-hidden>
      <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", bg)} />
      <span className={cn("relative inline-flex h-full w-full rounded-full", bg)} />
    </span>
  );
}
