import { cn } from "@/lib/utils";

export interface ParClave {
  etiqueta: string;
  valor: React.ReactNode;
  /** Línea chica bajo el valor ("validó edwin@…", "14 de 50 leídos"). */
  pista?: React.ReactNode;
  mono?: boolean;
  /** Ocupa toda la fila de la grilla. */
  completo?: boolean;
}

// Dos columnas también en el teléfono: los valores largos (correos, códigos) se marcan `completo`.
const COLUMNAS = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" } as const;

const vacio = (v: React.ReactNode) => v === null || v === undefined || v === false || (typeof v === "string" && (v.trim() === "" || v.trim() === "—"));

/** "Sin dato" en cursiva apagada: un hueco se nombra, no se deja en blanco ni se rellena. */
export function SinDato({ texto = "Sin dato" }: { texto?: string }) {
  return <span className="italic text-mute">{texto}</span>;
}

/** Lista clave → valor en grilla (<dl>). Un valor vacío se muestra como "Sin dato". */
export function KeyValue({ items, columnas = 2, className }: { items: ParClave[]; columnas?: keyof typeof COLUMNAS; className?: string }) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-3", COLUMNAS[columnas], className)}>
      {items.map((it) => (
        <div key={it.etiqueta} className={cn("min-w-0", it.completo && "col-span-full")}>
          <dt className="text-[11px] font-medium text-mute">{it.etiqueta}</dt>
          <dd className={cn("mt-0.5 break-words text-sm text-ink", it.mono && !vacio(it.valor) && "font-mono text-[13px]")}>{vacio(it.valor) ? <SinDato /> : it.valor}</dd>
          {it.pista && <dd className="text-[11.5px] leading-snug text-mute">{it.pista}</dd>}
        </div>
      ))}
    </dl>
  );
}
