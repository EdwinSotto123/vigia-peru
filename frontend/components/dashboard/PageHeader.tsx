import type { ReactNode } from "react";

/**
 * Encabezado compartido por entidades / denuncias / contratos / alertas /
 * mi-impacto / configuracion / mapa.
 *
 * La prop `eyebrow` se eliminó, no se volvió opcional: una prop opcional se
 * vuelve a usar. El kicker sobre el título era redundancia pura —"Contratos"
 * encima de "Todos los contratos", "Ranking de entidades" encima del ranking—
 * y robaba jerarquía al h1 sin aportar un bit de información. Peor a escala:
 * con estas píldoras más las ad-hoc, una sola pantalla de dossier llegaba a
 * 25 micro-etiquetas mayúsculas compitiendo entre sí, y cuando todo grita
 * nada destaca.
 *
 * También se fue el degradado con orbe borroso: consumía ~200 px antes de
 * que empezara el contenido en siete superficies de producto, donde el
 * usuario llegó a hacer algo. El acento de marca se gana en la acción, no en
 * el fondo del encabezado.
 *
 * `contexto` reemplaza al kicker con algo que sí informa: el estado actual de
 * la superficie (cuántos resultados, qué filtro está puesto, de cuándo es el
 * dato).
 */
export function PageHeader({
  title,
  subtitle,
  contexto,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** Estado de la superficie: "18.394 contratos · 45 leídos". Va al lado del título, no encima. */
  contexto?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-4">
      <div className="min-w-0">
        <h1 className="font-serif text-2xl font-bold leading-tight text-ink sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[68ch] text-sm leading-relaxed text-mute">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {contexto && <div className="text-[13px] text-mute">{contexto}</div>}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
