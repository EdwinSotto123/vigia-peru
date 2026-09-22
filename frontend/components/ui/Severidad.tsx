import { AlertTriangle, CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { severidadDeScore, severidadDeBandera, type SeveridadUI } from "@/lib/severidad";
import { cn } from "@/lib/utils";

const ICONO = {
  alerta: AlertTriangle,
  atencion: CircleAlert,
  ok: CircleCheck,
  vacio: CircleDashed,
} as const;

/**
 * Los tres canales de severidad juntos — color, forma y palabra — en un solo
 * componente, para que sea más fácil hacerlo bien que hacerlo mal.
 *
 * El ícono no es decoración: es el canal redundante que sostiene la
 * distinción cuando el color falla (protanopía, pantalla barata, sol directo
 * sobre un celular en la calle, que es la escena de uso real de este
 * producto). Por eso no hay una variante "sólo color".
 */
export function Severidad({
  score,
  bandera,
  formato = "pastilla",
  className,
}: {
  /** Score 0–100. Usar este o `bandera`, no los dos. */
  score?: number | null;
  /** Severidad ya clasificada por el backend. */
  bandera?: "alta" | "media" | "baja";
  formato?: "pastilla" | "linea" | "punto";
  className?: string;
}) {
  const s: SeveridadUI = bandera ? severidadDeBandera(bandera) : severidadDeScore(score);
  const Icono = ICONO[s.icono];

  if (formato === "punto") {
    return (
      <span className={cn("inline-flex items-center gap-1.5", s.texto, className)} title={s.etiqueta}>
        <Icono size={13} aria-hidden />
        <span className="sr-only">{s.etiqueta}</span>
      </span>
    );
  }

  if (formato === "linea") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", s.texto, className)}>
        <Icono size={13} aria-hidden />
        {s.etiqueta}
      </span>
    );
  }

  return (
    <span className={cn("pill", s.fondo, s.texto, s.borde, className)}>
      <Icono size={11} aria-hidden />
      {s.etiqueta}
    </span>
  );
}
