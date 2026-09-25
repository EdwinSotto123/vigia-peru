"use client";

/**
 * Los cinco estados que puede tener un paso del DAG, con los tres canales de siempre:
 * color, forma dibujada y palabra. Nunca solo color.
 *
 * La única animación que sobrevive acá es el punto del agente EN CURSO: es estado que
 * cambia de verdad mientras lo mirás. Nada pulsa por estar seleccionado ni por ser un dato.
 */

import { AlertCircle, Check, Circle, MinusCircle } from "lucide-react";
import { PulseDot } from "@/components/ui/PulseDot";
import type { EstadoFase } from "@/lib/auditoria";
import { cn } from "@/lib/utils";

export const ESTADO_PASO: Record<EstadoFase, { label: string; texto: string; barra: string; borde: string; fondo: string }> = {
  pendiente: { label: "pendiente", texto: "text-mute", barra: "bg-line", borde: "border-line", fondo: "bg-paper" },
  corriendo: { label: "en curso", texto: "text-amberTexto", barra: "bg-amber", borde: "border-amber/50", fondo: "bg-amber-soft" },
  hecho: { label: "completado", texto: "text-inkSoft", barra: "bg-moss", borde: "border-moss/40", fondo: "bg-moss/10" },
  omitido: { label: "omitido", texto: "text-mute", barra: "bg-paperDeep", borde: "border-line", fondo: "bg-paperSoft" },
  error: { label: "falló", texto: "text-crimsonTexto", barra: "bg-crimson", borde: "border-crimson/40", fondo: "bg-crimson-soft" },
};

export function IconoEstado({ estado, size = 12, className }: { estado: EstadoFase; size?: number; className?: string }) {
  if (estado === "corriendo") return <PulseDot color="amber" size={size - 4} className={className} />;
  const props = { size, "aria-hidden": true as const, className: cn("shrink-0", className) };
  if (estado === "hecho") return <Check {...props} strokeWidth={3} className={cn(props.className, "text-mossTexto")} />;
  if (estado === "omitido") return <MinusCircle {...props} className={cn(props.className, "text-mute")} />;
  if (estado === "error") return <AlertCircle {...props} className={cn(props.className, "text-crimsonTexto")} />;
  return <Circle {...props} className={cn(props.className, "text-line")} />;
}

/** Ícono + palabra, para cuando el estado se lee suelto (fuera de una fila del eje). */
export function EstadoTexto({ estado, className }: { estado: EstadoFase; className?: string }) {
  const e = ESTADO_PASO[estado];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", e.texto, className)}>
      <IconoEstado estado={estado} />
      {e.label}
    </span>
  );
}
