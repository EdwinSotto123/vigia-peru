import { Badge } from "@/components/ui/Badge";
import { TIPO_CRUCE } from "@/lib/cruces";

const VARIANTE_CRUCE = { alta: "crimson", media: "amber", baja: "neutral" } as const;
const MAX_CRUCES = 3;

/**
 * Los antecedentes del ganador en una celda: los más graves primero, hasta tres y "+n"; un guion si no tiene ninguno
 * o aún no ganó nadie. La usan la lista de contratos y las de procesos de un partido y de una entidad.
 */
export function CrucesCelda({ cruces }: { cruces: { tipo: string; severidad: "alta" | "media" | "baja" }[] | null | undefined }) {
  if (!cruces?.length) return <span className="text-[12.5px] text-mute">—</span>;
  const resto = cruces.length - MAX_CRUCES;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Registros donde aparece el ganador">
      {cruces.slice(0, MAX_CRUCES).map((x) => (
        <li key={x.tipo} title={TIPO_CRUCE[x.tipo]?.explica}>
          <Badge variant={VARIANTE_CRUCE[x.severidad]}>{TIPO_CRUCE[x.tipo]?.corto ?? x.tipo}</Badge>
        </li>
      ))}
      {resto > 0 && (
        <li title={cruces.slice(MAX_CRUCES).map((x) => TIPO_CRUCE[x.tipo]?.corto ?? x.tipo).join(", ")}>
          <Badge variant="neutral">+{resto}</Badge>
        </li>
      )}
    </ul>
  );
}
