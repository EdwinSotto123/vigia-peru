import { AlertTriangle, CircleAlert, Info } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { TIPO_CRUCE, chipCruce } from "@/lib/cruces";

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
  explicaciones,
  etiquetaLista = "Registros donde aparece el ganador",
}: {
  cruces: { tipo: string; severidad: "alta" | "media" | "baja" }[] | null | undefined;
  /** Otra etiqueta corta para algún tipo (la lista de empresas: «Sancionada», no «Sancionado antes» de un proceso). */
  etiquetas?: Record<string, string>;
  /** La convocatoria todavía no tiene ganador: no hay de quién buscar antecedentes. */
  sinGanador?: boolean;
  /** Qué significa un tipo que no está en el catálogo de cruces (nepotismo, un estado de la SUNAT): va en su title. */
  explicaciones?: Record<string, string>;
  /** El nombre de la lista para el lector de pantalla. Por defecto, los registros donde aparece el ganador. */
  etiquetaLista?: string;
}) {
  // En el chip, el nombre breve; el completo (y qué significa) en su title, y la lista entera en el de la fila.
  const corto = (t: string) => etiquetas?.[t] ?? chipCruce(t);
  const completo = (t: string) => etiquetas?.[t] ?? TIPO_CRUCE[t]?.corto ?? t;
  const explica = (t: string) => explicaciones?.[t] ?? TIPO_CRUCE[t]?.explica;
  if (!cruces?.length) return <span className="text-meta text-mute">{sinGanador ? "Sin ganador aún" : "Sin antecedentes"}</span>;
  const orden = [...cruces].sort((a, b) => RANGO[a.severidad] - RANGO[b.severidad]);
  const resto = orden.length - MAX_CRUCES;
  return (
    <ul className="flex min-w-0 max-w-full flex-nowrap items-center gap-1 overflow-hidden" aria-label={etiquetaLista} title={orden.map((x) => completo(x.tipo)).join(", ")}>
      {orden.slice(0, MAX_CRUCES).map((x) => {
        const Icono = ICONO_CRUCE[x.severidad];
        return (
          <li key={x.tipo} className="min-w-0" title={explica(x.tipo) ? `${completo(x.tipo)}: ${explica(x.tipo)}` : completo(x.tipo)}>
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
            <span className="sr-only"> más: {orden.slice(MAX_CRUCES).map((x) => completo(x.tipo)).join(", ")}</span>
          </Badge>
        </li>
      )}
    </ul>
  );
}
