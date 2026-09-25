import type { ReactNode } from "react";
import { EncabezadoPagina } from "@/components/patrones";

/**
 * Encabezado compartido por entidades / denuncias / contratos / alertas /
 * mi-impacto / configuracion / mapa. Es `EncabezadoPagina` (DESIGN_SYSTEM.md
 * §11.3: el único h1, en Montserrat, con su bajada y sus acciones) más dos cosas
 * propias del dashboard: el `contexto` junto a las acciones y la línea que lo
 * separa del contenido. Así el título de una página del dashboard y el de una
 * página pública son el mismo componente, con la misma escala.
 *
 * La prop `eyebrow` se eliminó, no se volvió opcional: una prop opcional se
 * vuelve a usar. El kicker sobre el título era redundancia pura —"Contratos"
 * encima de "Todos los contratos"— y robaba jerarquía al h1 sin aportar un bit
 * de información.
 *
 * También se fue el degradado con orbe borroso: consumía ~200 px antes de que
 * empezara el contenido. El acento de marca se gana en la acción, no en el fondo
 * del encabezado.
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
  /** Estado de la superficie: "18,394 contratos · 45 leídos". Va al lado del título, no encima. */
  contexto?: ReactNode;
  actions?: ReactNode;
}) {
  const acciones =
    contexto || actions ? (
      <>
        {contexto && <div className="text-[13px] leading-snug text-mute">{contexto}</div>}
        {actions}
      </>
    ) : undefined;

  return <EncabezadoPagina titulo={title} bajada={subtitle} acciones={acciones} className="border-b border-line pb-5" />;
}
