import Link from "next/link";
import { Landmark } from "lucide-react";
import type { GobiernoContrato } from "@/lib/contratos";
import { periodoTexto, type AnioGobierno } from "@/lib/partidosApi";

/**
 * El partido que gobernaba la entidad cuando se convocó el contrato (API: `gobierno`, lib/gobiernoFila.ts): el
 * gobierno regional, provincial o distrital de su ubigeo en ese mandato. Enlaza a la ficha del partido en ese período.
 *   · `completo`: el nombre, el gobierno y el mandato (ficha del contrato).
 *   · corto: sólo el ícono y el nombre (la línea de una fila).
 */
const NIVEL: Record<string, string> = { regional: "Gobierno regional", provincial: "Municipalidad provincial", distrital: "Municipalidad distrital" };

export const nombreGobierno = (g: GobiernoContrato) => `${NIVEL[g.nivel] ?? "Gobierno"}${g.lugar ? ` de ${g.lugar}` : ""}`;

export function PartidoQueGobierna({ g, completo = false }: { g: GobiernoContrato | null | undefined; completo?: boolean }) {
  if (!g) return null;
  const href = `/app/partidos/${g.clave}?anio=${g.anio}`;
  if (!completo) {
    return (
      <span className="inline-flex items-center gap-1" title={`Gobernaba la entidad: ${g.nombre}`}>
        <Landmark size={12} className="shrink-0" aria-hidden />
        {g.nombre}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <Landmark size={14} className="shrink-0 text-mute" aria-hidden />
      <span className="text-mute">Gobernaba</span>
      <Link href={href} prefetch={false} className="font-semibold text-ink underline-offset-2 hover:text-granate hover:underline">
        {g.nombre}
      </Link>
      <span className="text-mute">
        {nombreGobierno(g)}, {periodoTexto(g.anio as AnioGobierno)}
      </span>
    </span>
  );
}
