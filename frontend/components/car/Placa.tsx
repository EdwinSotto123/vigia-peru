import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { placaLegible } from "./consultas";

/**
 * Una placa peruana dibujada (Gobserva Car): el marco, la franja de arriba con «PERÚ» y los caracteres grandes. Es la
 * «credencial» de la página de una placa, como la colegiatura en la de un médico. Server-safe.
 */
export function Placa({ placa, className, tamano = "lg" }: { placa: string; className?: string; tamano?: "md" | "lg" }) {
  return (
    <div
      className={cn(
        "inline-flex flex-col overflow-hidden rounded-xl border-[3px] border-black bg-white shadow-[0_10px_24px_-14px_rgb(var(--ink)/0.5)]",
        className,
      )}
    >
      <span className="bg-black py-0.5 text-center text-rotulo font-bold tracking-[0.3em] text-white">PERÚ</span>
      <span
        className={cn(
          "px-5 py-1.5 text-center font-mono font-bold tabular-nums tracking-[0.08em] text-black",
          tamano === "lg" ? "text-cifra sm:text-titulo" : "text-bloque",
        )}
      >
        {placaLegible(placa)}
      </span>
    </div>
  );
}

/**
 * El campo de la placa con forma de placa y su botón. Un formulario GET común (`/placa?p=…`): funciona sin JavaScript.
 * `accion` es la ruta de la página de la placa en el producto (rutaEn(base, "/placa")).
 */
export function FormPlaca({ accion, inicial = "", className, grande = false }: { accion: string; inicial?: string; className?: string; grande?: boolean }) {
  return (
    <form action={accion} method="get" role="search" className={cn("flex flex-col gap-2 sm:flex-row sm:items-stretch", className)}>
      <label htmlFor="placa" className="sr-only">
        Placa del vehículo
      </label>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border-[3px] border-black bg-white focus-within:ring-4 focus-within:ring-granate/30">
        <span aria-hidden className="bg-black py-0.5 text-center text-rotulo font-bold tracking-[0.3em] text-white">
          PERÚ
        </span>
        <input
          id="placa"
          name="p"
          defaultValue={inicial}
          required
          minLength={5}
          maxLength={8}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABC-123"
          pattern="[A-Za-z0-9 -]{5,8}"
          title="La placa: 5 a 7 letras y números, por ejemplo ABC-123"
          className={cn(
            "w-full min-w-0 bg-transparent px-4 text-center font-mono font-bold uppercase tracking-[0.08em] text-black placeholder:text-black/35 focus:outline-none",
            grande ? "h-16 text-cifra" : "h-12 text-bloque",
          )}
        />
      </div>
      <button
        type="submit"
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-granate px-6 font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2",
          grande ? "min-h-14 text-cuerpo sm:min-h-0" : "min-h-12 text-dato sm:min-h-0",
        )}
      >
        <Search size={18} aria-hidden /> Verificar la placa
      </button>
    </form>
  );
}
