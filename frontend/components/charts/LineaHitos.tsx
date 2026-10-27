import { fechaCorta, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Una línea de tiempo corta: hitos con fecha unidos por una línea y, en cada uno, cuántos días pasaron desde el anterior
 * (como la del proceso de un contrato, LineaTiempoProceso). Sirve para contar una secuencia que un párrafo esconde: «aportó
 * a la campaña → hubo elecciones → asumió el gobierno → le dieron su primera orden». Los hitos del mismo día van juntos;
 * con menos de dos fechas no se dibuja. Server-safe.
 */
export interface Hito {
  /** AAAA-MM-DD. */
  fecha: string;
  texto: string;
  /** El hito al que lleva la secuencia (la orden, la buena pro): con el punto lleno y en granate. */
  destacado?: boolean;
}

const DIA_MS = 86_400_000;
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA_MS);

export function LineaHitos({ hitos, etiqueta, className }: { hitos: Hito[]; etiqueta: string; className?: string }) {
  const validos = hitos.filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.fecha));
  const porDia = new Map<string, Hito & { textos: string[] }>();
  for (const h of validos) {
    const x = porDia.get(h.fecha) ?? { ...h, textos: [] };
    if (!x.textos.includes(h.texto)) x.textos.push(h.texto);
    x.destacado ||= !!h.destacado;
    porDia.set(h.fecha, x);
  }
  const orden = [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (orden.length < 2) return null;
  return (
    <ol aria-label={etiqueta} className={cn("rounded-xl border border-line bg-paperSoft px-3.5 py-3", className)}>
      {orden.map((h, i) => {
        const ultimo = i === orden.length - 1;
        const salto = i === 0 ? null : dias(orden[i - 1].fecha, h.fecha);
        return (
          <li key={h.fecha} className="relative grid grid-cols-[14px_minmax(0,1fr)] gap-x-3">
            <span aria-hidden className="relative flex justify-center">
              <span className={cn("relative z-10 mt-1 h-3 w-3 rounded-full border-2", h.destacado ? "border-granate bg-granate" : "border-granate bg-paper")} />
              {!ultimo && <span className="absolute bottom-0 top-4 w-0.5 bg-line" />}
            </span>
            <div className={cn("min-w-0", !ultimo && "pb-3")}>
              <div className="flex items-baseline justify-between gap-3 text-meta">
                <span className={cn("font-medium", h.destacado ? "text-granate" : "text-ink")}>{h.textos.join("; ")}</span>
                <time dateTime={h.fecha} className="shrink-0 font-mono text-rotulo tabular-nums text-inkSoft">
                  {fechaCorta(h.fecha)}
                </time>
              </div>
              {salto !== null && salto > 0 && (
                <span className="mt-1 inline-block rounded-full bg-paperDeep px-2 py-0.5 text-micro text-mute">{plural(salto, "día", "días")} después</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
