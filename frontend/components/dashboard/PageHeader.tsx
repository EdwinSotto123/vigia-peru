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
  // Compartido por entidades/denuncias/contratos/alertas/mi-impacto/configuracion/mapa: antes
  // era texto + un simple border-b, sin ningún color de fondo -- las 7 páginas arrancaban en
  // blanco liso. Un solo cambio acá les da a las 7 el mismo tratamiento de una vez.
  return (
    <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-heroViolet/[0.05] via-paperSoft to-heroGreen/[0.04] p-5 sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-heroViolet/10 blur-3xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-heroViolet">
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
      </div>
    </header>
  );
}
