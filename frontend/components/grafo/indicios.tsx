import Link from "next/link";
import { AlertTriangle, ChevronRight, CircleAlert, Info } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Ayuda } from "@/components/patrones/Ayuda";
import { CeldaBarra } from "@/components/listado/Tabla";
import { indiciosDe, rutaContratosIndicio, traeDesglose, TIPOS_CAPTURA, type ConteosCaptura, type Indicio } from "@/lib/grafo";
import { TIPO_CRUCE } from "@/lib/cruces";
import { numero, plural, porcentaje } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Los indicios de captura en el sistema de banderas del sitio: el mismo `Badge`, el mismo ícono por severidad y el mismo
 * nombre corto del catálogo de cruces (lib/cruces.ts) que `CrucesCelda` en la lista de contratos, más lo que aquí sí se
 * sabe: CUÁNTOS contratos tienen cada indicio. Antes eran insignias propias con tres nombres para el mismo cruce y sin
 * unidad. Server-safe.
 *
 *   ChipsIndicio   en una celda: una línea, el más grave primero (hasta `max`) y «+n»; la explicación en el `title`.
 *   ListaIndicios  en un panel: cada indicio con su ⓘ y su conteo; con `entidadRuc`, el conteo lleva a esos contratos.
 */

const VARIANTE = { alta: "crimson", media: "amber", baja: "neutral" } as const;
// La severidad también con ícono (no sólo el color: WCAG 1.4.1), los mismos de `CrucesCelda` y `Severidad`.
const ICONO = { alta: AlertTriangle, media: CircleAlert, baja: Info } as const;

const unidad = (n: number) => plural(n, "contrato", "contratos");

export function ChipsIndicio({ x, max = 2, sinIndicio = "Sin indicio" }: { x: ConteosCaptura & { n_captura?: number | null }; max?: number; sinIndicio?: string }) {
  const lista = indiciosDe(x);
  if (!lista.length) {
    // Sin desglose (una API vieja manda sólo el total): no se dice "sin indicio" de algo que sí lo tiene.
    if (!traeDesglose(x) && (x.n_captura ?? 0) > 0) return null;
    return <span className="text-meta text-mute">{sinIndicio}</span>;
  }
  const resto = lista.length - max;
  return (
    <ul
      className="flex min-w-0 max-w-full flex-nowrap items-center gap-1 overflow-hidden"
      aria-label="Indicios, con cuántos contratos tiene cada uno"
      title={lista.map((i) => `${i.corto}: ${unidad(i.n)}`).join(", ")}
    >
      {lista.slice(0, max).map((i) => (
        <li key={i.tipo} className="min-w-0" title={`${unidad(i.n)}. ${i.explica}`}>
          <ChipIndicio i={i} />
        </li>
      ))}
      {resto > 0 && (
        <li className="shrink-0">
          <Badge variant="neutral" className="px-2">
            +{resto}
            <span className="sr-only"> más: {lista.slice(max).map((i) => `${i.corto}, ${unidad(i.n)}`).join("; ")}</span>
          </Badge>
        </li>
      )}
    </ul>
  );
}

/**
 * Un indicio: ícono, nombre (se recorta si no entra) y su conteo, que nunca se recorta. `conteo`: el número solo (en
 * una celda, donde la cabecera dice la unidad), con su unidad («597 contratos») o ninguno (cuando va al lado).
 */
export function ChipIndicio({ i, conteo = "numero" }: { i: Indicio; conteo?: "numero" | "unidad" | "ninguno" }) {
  const Icono = ICONO[i.severidad];
  return (
    <Badge variant={VARIANTE[i.severidad]} className="max-w-full gap-1 px-2">
      <Icono size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{i.corto}</span>
      {conteo !== "ninguno" && <span className="shrink-0 font-semibold tabular-nums">{conteo === "unidad" ? unidad(i.n) : numero(i.n)}</span>}
      {conteo === "numero" && <span className="sr-only"> {i.n === 1 ? "contrato" : "contratos"}</span>}
    </Badge>
  );
}

/**
 * Los indicios en un panel, uno por fila: el chip, su ⓘ con qué se cruzó y cuántos contratos lo tienen. Con
 * `entidadRuc`, el conteo es el enlace a esos contratos en la lista (filtrados por la entidad y el tipo).
 */
export function ListaIndicios({
  x,
  entidadRuc,
  periodo,
}: {
  x: ConteosCaptura & { n_captura?: number | null };
  entidadRuc?: string;
  /** El periodo de gobierno de la cifra: el enlace lista lo mismo que cuenta. */
  periodo?: { desde?: string | null; hasta?: string | null };
}) {
  const lista = indiciosDe(x);
  if (!lista.length) {
    return (
      <p className="text-dato text-mute">
        {!traeDesglose(x) && (x.n_captura ?? 0) > 0 ? "Sin el desglose por tipo de indicio." : "Ningún contrato con estos indicios."}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line/70 rounded-xl border border-line [.tarjeta_&]:rounded-none [.tarjeta_&]:border-0">
      {lista.map((i) => (
        <li key={i.tipo} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3.5 py-2.5">
          <span className="flex min-w-0 items-center gap-1">
            <ChipIndicio i={i} conteo="ninguno" />
            <Ayuda titulo={`¿Qué es «${i.corto}»?`}>{i.explica}</Ayuda>
          </span>
          {entidadRuc ? (
            <Link
              href={rutaContratosIndicio(entidadRuc, i.tipo, periodo)}
              prefetch={false}
              className="inline-flex min-h-[32px] shrink-0 items-center gap-1 font-mono text-dato tabular-nums text-granate underline-offset-4 hover:underline"
            >
              {unidad(i.n)}
              <ChevronRight size={14} aria-hidden />
            </Link>
          ) : (
            <span className="shrink-0 font-mono text-dato tabular-nums text-ink">{unidad(i.n)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** El ⓘ de una columna de indicios: qué es cada uno y cómo se cuenta. Texto en `span` (va dentro de un flotante). */
export function AyudaIndicios({ titulo = "¿Qué indicios se cuentan?" }: { titulo?: string }) {
  return (
    <Ayuda titulo={titulo}>
      <span className="block">
        Cada indicio con cuántos contratos lo tienen; un contrato puede tener más de uno, por eso no siempre suman el total.
      </span>
      {TIPOS_CAPTURA.map((t) => (
        <span key={t.tipo} className="mt-1.5 block">
          <b>{TIPO_CRUCE[t.tipo]?.corto}</b>: {TIPO_CRUCE[t.tipo]?.explica}
        </span>
      ))}
    </Ayuda>
  );
}

/**
 * Una cifra «X de Y» con su barra (la del kit, `CeldaBarra`): cuántas de las entidades tienen contratos con indicio. El
 * porcentaje se escribe además de dibujarse, y la barra dice lo mismo a quien no la ve.
 */
export function CeldaTasa({ con, de, className }: { con: number; de: number; className?: string }) {
  const p = de > 0 ? con / de : 0;
  const pct = porcentaje(p * 100);
  return (
    <span className={cn("block w-full min-w-0", className)}>
      <span className="flex items-baseline justify-between gap-2 text-meta tabular-nums">
        <span className="min-w-0 truncate text-ink">
          <b className="font-semibold">{numero(con)}</b> <span className="text-mute">de {numero(de)}</span>
        </span>
        <span className="shrink-0 font-mono text-rotulo text-inkSoft">{pct}</span>
      </span>
      <CeldaBarra parte={p} resumen={`${numero(con)} de ${numero(de)} con indicio, ${pct}`} className="mt-1" />
    </span>
  );
}
