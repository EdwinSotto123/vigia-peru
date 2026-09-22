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
    neutral: "bg-line text-mute border-mute/20",
    amber: "bg-amber-soft text-amber border-amber/20",
    crimson: "bg-crimson-soft text-crimson border-crimson/20",
    // Antes "navy": apuntaba a un token legacy (#1B1611, un marrón casi
    // negro) que no era de la marca ni de la semántica de severidad.
    // Sin ningún call site, así que pasa a ser el badge de marca.
    marca: "bg-heroViolet-soft text-heroViolet border-heroViolet/20",
    ink: "bg-ink text-paper border-ink",
  }[variant];
  return <span className={clsx("pill", styles, className)}>{children}</span>;
}
