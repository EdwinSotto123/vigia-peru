/**
 * Vacío o error SIN llamita, con la misma forma que `EstadoVacio`/`EstadoError`: para cuando
 * la pantalla ya tiene la suya (máximo una por pantalla, DESIGN_SYSTEM.md §2.4). En
 * /app/auditoria el tablero en vivo y el listado de lo leído pueden quedar vacíos a la vez;
 * la llamita la lleva el listado (§14.1) y el tablero usa esto.
 *
 * Existe porque `EstadoVacio` no tiene una variante sin llamita. Server-safe.
 */
export function AvisoSinLlamita({
  titulo,
  children,
  accion,
  tono = "vacio",
  className = "",
}: {
  titulo: string;
  children?: React.ReactNode;
  accion?: React.ReactNode;
  tono?: "vacio" | "error";
  className?: string;
}) {
  const error = tono === "error";
  return (
    <div
      role={error ? "alert" : undefined}
      className={`rounded-2xl border px-5 py-6 text-center ${error ? "border-crimson/25 bg-crimson-soft/60" : "border-dashed border-line bg-paperSoft"} ${className}`}
    >
      <p className={`font-display text-[15px] font-bold text-balance ${error ? "text-crimsonTexto" : "text-ink"}`}>{titulo}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-inkSoft text-pretty">{children}</div>}
      {accion && <div className="mt-3">{accion}</div>}
    </div>
  );
}
