import { AlertTriangle, CircleAlert, CircleCheck, CircleDashed, Eye, Info, type LucideIcon } from "lucide-react";
import { EN_REVISION, severidadDeContrato, type SeveridadUI } from "@/lib/severidad";
import { cn } from "@/lib/utils";

/**
 * El PESO DEL RIESGO de un contrato (DESIGN_SYSTEM.md §10.1): color + ícono +
 * palabra, en una celda de tabla, una línea o una píldora.
 *
 * Por qué no `<Severidad score>` a secas: la fila de un contrato sabe más que el
 * score. Si la alerta está en revisión el API manda score null, y `<Severidad>`
 * lo leía como "Sin leer todavía" mientras la columna de lectura decía
 * "Procesado" (auditoría 2026-09-24, punto 9). Y con el número de señales, 0 es
 * "Sin señales" sin adivinar por el score.
 *
 * Un ícono distinto por tramo —triángulo, círculo con signo, info, check, ojo,
 * círculo punteado—: en la columna angosta el ícono va sin palabra, así que la
 * forma tiene que distinguir sola lo que el color no alcanza (media y baja
 * compartían ícono y se separaban sólo por color).
 *
 * Sin estado ni eventos: sirve en server y en client components.
 */

function iconoDe(s: SeveridadUI): LucideIcon {
  if (s === EN_REVISION) return Eye;
  if (s.icono === "ok") return CircleCheck;
  if (s.nivel === "alta") return AlertTriangle;
  if (s.nivel === "media") return CircleAlert;
  if (s.nivel === "baja") return Info;
  return CircleDashed;
}

export function PesoRiesgo({
  score,
  banderas,
  enRevision,
  formato = "linea",
  className,
}: {
  score: number | null | undefined;
  /** Señales publicadas, si se conocen: 0 con el análisis terminado es "Sin señales". */
  banderas?: number | null;
  enRevision?: boolean | null;
  /** `punto`: sólo el ícono (la palabra va en `title` y para lectores de pantalla). */
  formato?: "punto" | "linea" | "pastilla";
  className?: string;
}) {
  const s = severidadDeContrato({ score, banderas, enRevision });
  const Icono = iconoDe(s);

  if (formato === "punto") {
    return (
      <span className={cn("inline-flex items-center", s.texto, className)} title={s.etiqueta}>
        <Icono size={14} aria-hidden />
        <span className="sr-only">{s.etiqueta}</span>
      </span>
    );
  }

  if (formato === "linea") {
    return (
      <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[12px] font-medium", s.texto, className)}>
        <Icono size={13} className="shrink-0" aria-hidden />
        <span className="truncate">{s.etiqueta}</span>
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

/**
 * Leyenda del eje, con el MISMO componente que usan las filas: una muestra por
 * tramo, en el orden en que se leen.
 */
export function LeyendaPeso({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <span className="text-mute">Peso del riesgo:</span>
      <PesoRiesgo score={85} className="text-[11px]" />
      <PesoRiesgo score={55} className="text-[11px]" />
      <PesoRiesgo score={10} className="text-[11px]" />
      <PesoRiesgo score={0} className="text-[11px]" />
      <PesoRiesgo score={null} enRevision className="text-[11px]" />
      <PesoRiesgo score={null} className="text-[11px]" />
    </span>
  );
}
