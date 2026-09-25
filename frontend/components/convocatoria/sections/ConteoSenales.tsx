import { severidadDeBandera } from "@/lib/severidad";
import { ICONO_SEVERIDAD } from "@/components/ui/Severidad";
import { cn } from "@/lib/utils";
import type { ConteoSeveridad, SeveridadSenal } from "../dossier";

const PALABRA: Record<SeveridadSenal, [string, string]> = {
  alta: ["señal alta", "señales altas"],
  media: ["señal media", "señales medias"],
  baja: ["señal baja", "señales bajas"],
};

/**
 * "2 señales altas · 1 señal media · 3 señales bajas": el conteo por severidad del dossier,
 * con los tres canales (color, ícono y palabra). Sale de `contarSeveridades` (../dossier),
 * la misma lectura que usa la lista de señales, así que la cabecera y la lista cuadran.
 */
export function ConteoSenales({ conteo, className }: { conteo: ConteoSeveridad; className?: string }) {
  const niveles = (["alta", "media", "baja"] as const).filter((k) => conteo[k] > 0);
  if (niveles.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label="Señales por severidad">
      {niveles.map((k) => {
        const ui = severidadDeBandera(k);
        const Icono = ICONO_SEVERIDAD[ui.icono];
        const n = conteo[k];
        return (
          <li key={k} className={cn("pill tabular-nums", ui.fondo, ui.texto, ui.borde)}>
            <Icono size={12} aria-hidden />
            {n} {n === 1 ? PALABRA[k][0] : PALABRA[k][1]}
          </li>
        );
      })}
    </ul>
  );
}
