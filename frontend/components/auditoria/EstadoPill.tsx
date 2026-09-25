import { AlertCircle, CheckCircle2, Clock, Eye, Moon, PauseCircle, RotateCw } from "lucide-react";
import { ESTADO_PROC, type EstadoProc } from "@/lib/auditoria";
import { cn } from "@/lib/utils";

/**
 * Píldora de estado de un procesamiento. El estado nunca se comunica solo por
 * color: cada uno lleva texto y un icono distinto (punto pulsante = procesando).
 * `revision` = procesado pero la autoevaluación bloqueó la publicación (lo revisa una persona).
 *
 * Usa la clase `pill`, la misma de `Severidad` y `PesoRiesgo`: en la columna de estado
 * de una tabla (§14.1) conviven las dos y tienen que medir lo mismo.
 *
 * Sin `role="status"`: una píldora es una etiqueta, no una región viva. Con 36 píldoras en
 * /app/auditoria, cada una anunciaba su texto a los lectores de pantalla en cada sondeo. La
 * única región viva de cada página vive en el componente que sabe qué cambió de verdad.
 *
 * `intentos`: con `error`, a partir del tercer intento ya no se reintenta solo (dispatcher,
 * MAX_INTENTOS = 3). Decir "Reintentando" ahí era falso.
 */
export function EstadoPill({ estado, size = "sm", intentos }: { estado: EstadoProc; size?: "sm" | "md"; intentos?: number }) {
  const agotado = estado === "error" && (intentos ?? 0) >= 3;
  const { label, cls } = ESTADO_PROC[estado];
  return (
    // Puede partir en dos líneas: en la columna de estado de un celular, "Esperando documentos" no cabe en una.
    <span className={cn("pill border-transparent [&>svg]:shrink-0", size === "md" && "px-3 py-1", cls)}>
      {estado === "procesando" && (
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber" />
        </span>
      )}
      {estado === "encolado" && <Clock size={11} aria-hidden />}
      {estado === "procesado" && <CheckCircle2 size={11} aria-hidden />}
      {estado === "pendiente_de_procesamiento" && <PauseCircle size={11} aria-hidden />}
      {estado === "esperando_documentos" && <Moon size={11} aria-hidden />}
      {estado === "error" && !agotado && <RotateCw size={11} className="animate-spin [animation-duration:3s]" aria-hidden />}
      {agotado && <AlertCircle size={11} aria-hidden />}
      {estado === "revision" && <Eye size={11} aria-hidden />}
      {agotado ? "Falló, revisión manual" : label}
    </span>
  );
}
