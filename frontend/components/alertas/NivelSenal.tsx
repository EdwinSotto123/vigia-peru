import { Severidad } from "@/components/ui/Severidad";
import type { NivelBandera } from "@/lib/revision";

/**
 * La severidad de UNA SEÑAL. Ahora es `<Severidad bandera>` (que ya trae el ícono
 * `Info` para la baja, §7): un solo componente de severidad en todo el producto.
 * Se conserva el nombre para los que ya lo importan.
 */
export function NivelSenal({
  nivel,
  formato = "linea",
  className,
}: {
  nivel: NivelBandera;
  formato?: "linea" | "pastilla";
  className?: string;
}) {
  return <Severidad bandera={nivel} formato={formato} className={className} />;
}
