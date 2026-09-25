import clsx from "clsx";
import { forwardRef } from "react";

/** DESIGN_SYSTEM.md §11.2. `oscuro` va sobre fondos ink/granate: papel con texto granate. */
type Variant = "primary" | "secondary" | "ghost" | "ink" | "oscuro";

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; full?: boolean }
>(function Button({ variant = "primary", full, className, children, ...rest }, ref) {
  const base =
    "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";
  const styles: Record<Variant, string> = {
    primary: "bg-granate text-paper hover:bg-granate-deep",
    secondary: "border border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
    ghost: "text-ink hover:bg-paperDeep",
    ink: "bg-ink text-paper hover:bg-ink/90",
    oscuro: "bg-paper text-granate hover:bg-maiz-soft",
  };
  return (
    <button
      ref={ref}
      className={clsx(base, styles[variant], full && "w-full", className)}
      {...rest}
    >
      {children}
    </button>
  );
});
