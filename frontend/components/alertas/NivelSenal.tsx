import { AlertTriangle, CircleAlert, Info } from "lucide-react";
import { SEVERIDAD } from "@/lib/severidad";
import type { NivelBandera } from "@/lib/revision";
import { cn } from "@/lib/utils";

/**
 * La severidad de UNA SEÑAL — los tres canales de siempre (color + ícono dibujado +
 * palabra), con los tokens de `lib/severidad.ts` y sin inventar ninguno.
 *
 * `SEVERIDAD` ya es el vocabulario de la señal: "Señal alta", "Señal media" y
 * "Señal baja", con la baja en el neutro que el sistema reserva a lo que no carga
 * semáforo (DESIGN_SYSTEM.md §3.7), nunca en el verde de lo positivo. Los íconos
 * son los fijos de §7: alta `AlertTriangle`, media `AlertCircle`, baja `Info`.
 *
 * Por qué no `<Severidad bandera>`: ese componente todavía no trae el ícono `Info`
 * para la baja, y en una columna de veinte filas la forma es lo que separa una
 * señal media de una baja cuando el color no alcanza.
 */

const ICONO: Record<NivelBandera, typeof AlertTriangle> = {
  alta: AlertTriangle,
  media: CircleAlert,
  baja: Info,
};

export function NivelSenal({
  nivel,
  formato = "linea",
  className,
}: {
  nivel: NivelBandera;
  formato?: "linea" | "pastilla";
  className?: string;
}) {
  const s = SEVERIDAD[nivel];
  const Icono = ICONO[nivel];

  if (formato === "pastilla") {
    return (
      <span className={cn("pill", s.fondo, s.texto, s.borde, className)}>
        <Icono size={11} aria-hidden />
        {s.etiqueta}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", s.texto, className)}>
      <Icono size={13} aria-hidden />
      {s.etiqueta}
    </span>
  );
}
