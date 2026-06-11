import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  icon,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div>
        {eyebrow && (
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-line bg-paperSoft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-clay">
            {icon}
            {eyebrow}
          </div>
        )}
        <h1 className="font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 max-w-3xl text-sm text-mute">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
