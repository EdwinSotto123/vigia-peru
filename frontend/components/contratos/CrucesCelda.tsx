import { Badge } from "@/components/ui/Badge";
import { IconoBandera } from "@/components/ui/IconoBandera";
import { ICONO_NIVEL } from "@/components/ui/Severidad";
import { TIPO_CRUCE, chipCruce } from "@/lib/cruces";

const VARIANTE_CRUCE = { alta: "crimson", media: "amber", baja: "neutral" } as const;
// La severidad también con ícono (no sólo el color: WCAG 1.4.1), el mismo de `Severidad`.
const ICONO_CRUCE = ICONO_NIVEL;
const RANGO = { alta: 0, media: 1, baja: 2 } as const;
// Una bandera ENTERA y «+n»: con dos en una columna angosta se leían «Posible n…» y «Planill…» (2026-10-27, el dueño:
// «NEPOTISMO no está como bandera sino como etiqueta de columna»). El nombre ya no se recorta: si no entra, parte en dos
// renglones dentro de su insignia.
const MAX_CRUCES = 1;

/**
 * Los antecedentes del ganador en una celda: los más graves primero, la primera entera y "+n" (la lista entera en el
 * `title` y para el lector de pantalla). Antes iban hasta tres insignias que se partían en renglones y hacían filas de 140
 * a 300 px; la bandera que distinguía a una fila se perdía entre las repetidas. A igual severidad, el orden en que llegan
 * (quien arma la lista pone primero lo que más pesa: el nepotismo).
 * Sin antecedentes no es lo mismo que sin ganador: "Ninguno" en una convocatoria que aún no adjudica se leía "limpio".
 * La usan la lista de contratos, las de procesos de un partido y de una entidad, y la de empresas.
 */
export function CrucesCelda({
  cruces,
  etiquetas,
  sinGanador = false,
  explicaciones,
  etiquetaLista = "Registros donde aparece el ganador",
  max = MAX_CRUCES,
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
  /** Cuántas banderas a la vista antes del «+n» (en una columna angosta, una entera se lee mejor que dos recortadas). */
  max?: number;
}) {
  // En el chip, el nombre breve; el completo (y qué significa) en su title, y la lista entera en el de la fila.
  const corto = (t: string) => etiquetas?.[t] ?? chipCruce(t);
  const completo = (t: string) => etiquetas?.[t] ?? TIPO_CRUCE[t]?.corto ?? t;
  const explica = (t: string) => explicaciones?.[t] ?? TIPO_CRUCE[t]?.explica;
  if (!cruces?.length) return <span className="text-meta text-mute">{sinGanador ? "Sin ganador aún" : "Sin antecedentes"}</span>;
  const orden = [...cruces].sort((a, b) => RANGO[a.severidad] - RANGO[b.severidad]);
  const resto = orden.length - max;
  return (
    // Todas a la vista (un panel): en renglones; en una celda, una línea.
    <ul className={`flex min-w-0 max-w-full items-center gap-1 ${resto > 0 ? "flex-nowrap" : "flex-wrap"}`} aria-label={etiquetaLista} title={orden.map((x) => completo(x.tipo)).join(", ")}>
      {orden.slice(0, max).map((x) => {
        const Icono = ICONO_CRUCE[x.severidad];
        return (
          <li key={x.tipo} className="min-w-0" title={explica(x.tipo) ? `${completo(x.tipo)}: ${explica(x.tipo)}` : completo(x.tipo)}>
            <Badge variant={VARIANTE_CRUCE[x.severidad]} className="max-w-full gap-1 rounded-2xl px-2 py-1 font-semibold leading-tight">
              <Icono size={12} className="shrink-0" aria-hidden />
              {/* En un panel (todas a la vista) también el ícono del tipo; en la celda angosta, sólo la severidad. */}
              {max > MAX_CRUCES && <IconoBandera tipo={x.tipo} size={12} className="opacity-70" />}
              <span className="min-w-0 break-words">{corto(x.tipo)}</span>
            </Badge>
          </li>
        );
      })}
      {resto > 0 && (
        <li className="shrink-0">
          <Badge variant="neutral" className="px-2">
            +{resto}
            <span className="sr-only"> más: {orden.slice(max).map((x) => completo(x.tipo)).join(", ")}</span>
          </Badge>
        </li>
      )}
    </ul>
  );
}

/**
 * Las mismas banderas para un panel, donde hay ancho: todas, con su nombre completo (el `corto` del catálogo) y en
 * renglones si no entran. Mismo color, ícono y orden que `CrucesCelda`; qué significa cada una, en su title.
 */
export function ChipsCruces({
  cruces,
  etiquetaLista = "Antecedentes",
}: {
  cruces: { tipo: string; severidad: "alta" | "media" | "baja" }[];
  etiquetaLista?: string;
}) {
  if (!cruces.length) return null;
  const orden = [...cruces].sort((a, b) => RANGO[a.severidad] - RANGO[b.severidad]);
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label={etiquetaLista}>
      {orden.map((x) => {
        const Icono = ICONO_CRUCE[x.severidad];
        const nombre = TIPO_CRUCE[x.tipo]?.corto ?? chipCruce(x.tipo);
        const explica = TIPO_CRUCE[x.tipo]?.explica;
        return (
          <li key={x.tipo} title={explica ? `${nombre}: ${explica}` : nombre}>
            <Badge variant={VARIANTE_CRUCE[x.severidad]} className="gap-1 px-2">
              <Icono size={12} className="shrink-0" aria-hidden />
              <IconoBandera tipo={x.tipo} size={12} className="opacity-70" />
              {nombre}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
