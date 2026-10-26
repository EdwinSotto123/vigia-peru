import { AlertTriangle, CircleAlert, Info } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { TIPO_CRUCE } from "@/lib/cruces";

const VARIANTE_CRUCE = { alta: "crimson", media: "amber", baja: "neutral" } as const;
// La severidad también con ícono (no sólo el color: WCAG 1.4.1), el mismo de `Severidad`.
const ICONO_CRUCE = { alta: AlertTriangle, media: CircleAlert, baja: Info } as const;
const RANGO = { alta: 0, media: 1, baja: 2 } as const;
const MAX_CRUCES = 2;

/**
 * Los antecedentes del ganador en una celda, en UNA línea: los más graves primero, hasta dos y "+n" (la lista entera en
 * el `title`). Antes iban hasta tres insignias que se partían en renglones y hacían filas de 140 a 300 px; la bandera que
 * distinguía a una fila se perdía entre las repetidas.
 * Sin antecedentes no es lo mismo que sin ganador: "Ninguno" en una convocatoria que aún no adjudica se leía "limpio".
 * La usan la lista de contratos, las de procesos de un partido y de una entidad, y la de empresas.
 */
export function CrucesCelda({
  cruces,
  etiquetas,
  sinGanador = false,
}: {
  cruces: { tipo: string; severidad: "alta" | "media" | "baja" }[] | null | undefined;
  /** Otra etiqueta corta para algún tipo (la lista de empresas: «Sancionada», no «Sancionado antes» de un proceso). */
  etiquetas?: Record<string, string>;
  /** La convocatoria todavía no tiene ganador: no hay de quién buscar antecedentes. */
  sinGanador?: boolean;
}) {
  const corto = (t: string) => etiquetas?.[t] ?? TIPO_CRUCE[t]?.corto ?? t;
  if (!cruces?.length) return <span className="text-meta text-mute">{sinGanador ? "Sin ganador aún" : "Sin antecedentes"}</span>;
  const orden = [...cruces].sort((a, b) => RANGO[a.severidad] - RANGO[b.severidad]);
  const resto = orden.length - MAX_CRUCES;
  return (
    <ul className="flex min-w-0 max-w-full flex-nowrap items-center gap-1 overflow-hidden" aria-label="Registros donde aparece el ganador" title={orden.map((x) => corto(x.tipo)).join(", ")}>
      {orden.slice(0, MAX_CRUCES).map((x) => {
        const Icono = ICONO_CRUCE[x.severidad];
        return (
          <li key={x.tipo} className="min-w-0" title={TIPO_CRUCE[x.tipo]?.explica}>
            <Badge variant={VARIANTE_CRUCE[x.severidad]} className="max-w-full gap-1 px-2">
              <Icono size={12} className="shrink-0" aria-hidden />
              <span className="truncate">{corto(x.tipo)}</span>
            </Badge>
          </li>
        );
      })}
      {resto > 0 && (
        <li className="shrink-0">
          <Badge variant="neutral" className="px-2">
            +{resto}
            <span className="sr-only"> más: {orden.slice(MAX_CRUCES).map((x) => corto(x.tipo)).join(", ")}</span>
          </Badge>
        </li>
      )}
    </ul>
  );
}
