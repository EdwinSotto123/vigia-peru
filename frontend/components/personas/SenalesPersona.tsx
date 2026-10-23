import { Badge } from "@/components/ui/Badge";
import { SENAL, type SenalResumen } from "@/lib/personas";

const VARIANTE = { alta: "crimson", media: "amber", baja: "neutral" } as const;
const MAX = 3;

/**
 * Las señales de una persona en una entidad, en una celda: las más graves primero (ya vienen así de la API), hasta tres
 * y "+n"; un guion si no tiene ninguna. Como CrucesCelda en las listas de contratos.
 */
export function SenalesCelda({ senales }: { senales: SenalResumen[] | null | undefined }) {
  if (!senales?.length) return <span className="text-meta text-mute">Ninguna</span>;
  const resto = senales.length - MAX;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Lo que dicen otros registros de esta persona">
      {senales.slice(0, MAX).map((s) => (
        <li key={s.tipo} title={SENAL[s.tipo]?.explica}>
          <Badge variant={VARIANTE[s.severidad]}>{SENAL[s.tipo]?.corto ?? s.tipo}</Badge>
        </li>
      ))}
      {resto > 0 && (
        <li title={senales.slice(MAX).map((s) => SENAL[s.tipo]?.corto ?? s.tipo).join(", ")}>
          <Badge variant="neutral">+{resto}</Badge>
        </li>
      )}
    </ul>
  );
}

export const VARIANTE_SEVERIDAD = VARIANTE;
