import clsx from "clsx";
import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "ink";

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; full?: boolean }
>(function Button({ variant = "primary", full, className, children, ...rest }, ref) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const styles: Record<Variant, string> = {
    primary: "bg-crimson text-white shadow-card hover:bg-crimson/90",
    secondary: "bg-white text-ink border border-line hover:bg-line",
    ghost: "text-ink hover:bg-line",
    ink: "bg-ink text-bone hover:bg-ink/90",
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
