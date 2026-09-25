import clsx from "clsx";

export function Badge({
  children,
  variant = "neutral",
  className,
}: {
  children: React.ReactNode;
  variant?: "neutral" | "amber" | "crimson" | "marca" | "ink";
  className?: string;
}) {
  const styles = {
    // mute sobre line daba 3.97:1 (bajo AA); inkSoft llega a 8.44:1.
    neutral: "bg-line text-inkSoft border-mute/20",
    amber: "bg-amber-soft text-amberTexto border-amber/20",
    crimson: "bg-crimson-soft text-crimsonTexto border-crimson/20",
    // Antes "navy": apuntaba a un token legacy (#1B1611, un marrón casi
    // negro) que no era de la marca ni de la semántica de severidad.
    // Sin ningún call site, así que pasa a ser el badge de marca.
    marca: "bg-granate-soft text-granate border-granate/20",
    ink: "bg-ink text-paper border-ink",
  }[variant];
  return <span className={clsx("pill", styles, className)}>{children}</span>;
}
