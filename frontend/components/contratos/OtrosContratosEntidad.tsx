import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import type { ContratoResumen } from "@/lib/contratos";

/**
 * "Más contratos de esta entidad": un botón que abre la lista de contratos de la entidad (o la de contratos
 * parecidos de la provincia), con cuántos hay. Antes eran 5 filas bajo la ficha y se leían como parte de este
 * contrato. Si no hay otros, no se dibuja. Server-safe.
 */
export function OtrosContratosEntidad({
  entidadRuc,
  contratos,
  total,
  titulo,
  verHref,
  idSeccion = "otros-contratos",
  compacta = false,
}: {
  entidad?: string | null;
  entidadRuc: string;
  contratos: ContratoResumen[];
  total: number;
  /** Otro texto (p. ej. "Contratos parecidos en la provincia") y su enlace. */
  titulo?: string;
  verHref?: string;
  idSeccion?: string;
  /** La versión secundaria (borde), para que el botón verde sea uno solo por pantalla. */
  compacta?: boolean;
}) {
  if (contratos.length === 0) return null;
  const n = Math.max(total, contratos.length);
  return (
    <section aria-label={titulo ?? "Más contratos de esta entidad"} id={idSeccion}>
      <EnlaceAccion
        href={verHref ?? `/app/contratos?entidad=${entidadRuc}`}
        variante={compacta ? "secundario" : "primario"}
        flecha
        className="w-full"
      >
        {titulo ? `Mira ${titulo.charAt(0).toLowerCase()}${titulo.slice(1)}` : "Mira más contratos de esta entidad"}
        <span className="font-normal opacity-80">({n.toLocaleString("es-PE")})</span>
      </EnlaceAccion>
    </section>
  );
}
