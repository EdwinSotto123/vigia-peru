import clsx from "clsx";

export function Badge({
  children,
  variant = "neutral",
  className,
}: {
  children: React.ReactNode;
  variant?: "neutral" | "amber" | "crimson" | "navy" | "ink";
  className?: string;
}) {
  const styles = {
    neutral: "bg-line text-ash border-ash/20",
    amber: "bg-amber-soft text-amber border-amber/20",
    crimson: "bg-crimson-soft text-crimson border-crimson/20",
    navy: "bg-navy-soft text-navy border-navy/20",
    ink: "bg-ink text-bone border-ink",
  }[variant];
  return <span className={clsx("pill", styles, className)}>{children}</span>;
}
