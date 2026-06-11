import clsx from "clsx";

export function Card({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("surface p-6", className)} {...rest}>
      {children}
    </div>
  );
}
