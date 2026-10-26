import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { numero } from "@/lib/formato";
import type { ContratoResumen } from "@/lib/contratos";

/**
 * "Mira más contratos de esta entidad (838)": un enlace SECUNDARIO a la pestaña Contratos de la ficha de la entidad (o a
 * la lista de contratos parecidos de la provincia), con cuántos hay. Va en la columna de la entidad, bajo «Esta entidad
 * en Vigía». Antes era un botón verde a todo el ancho en el Resumen del contrato que llevaba a /app/contratos?entidad=
 * (la acción principal de la pantalla era irse a otra lista) mientras «Ver su ficha», al lado, iba a la entidad; antes
 * aún, 5 filas bajo la ficha que se leían como parte de este contrato. Si no hay otros, no se dibuja. Server-safe.
 */
export function OtrosContratosEntidad({
  entidadRuc,
  contratos,
  total,
  titulo,
  verHref,
  idSeccion = "otros-contratos",
}: {
  entidadRuc: string;
  contratos: ContratoResumen[];
  total: number;
  /** Otro texto (p. ej. "Bienes de otras entidades de la provincia") y su enlace. */
  titulo?: string;
  verHref?: string;
  idSeccion?: string;
}) {
  if (contratos.length === 0) return null;
  const n = Math.max(total, contratos.length);
  return (
    <section aria-label={titulo ?? "Más contratos de esta entidad"} id={idSeccion}>
      <EnlaceAccion href={verHref ?? `/entidad/${entidadRuc}?seccion=contratos`} variante="secundario" flecha className="w-full">
        {titulo ? `Mira ${titulo.charAt(0).toLowerCase()}${titulo.slice(1)}` : "Mira más contratos de esta entidad"}
        <span className="font-normal tabular-nums text-inkSoft">({numero(n)})</span>
      </EnlaceAccion>
    </section>
  );
}
