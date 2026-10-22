import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { FUENTE_DUDOSO, MOTIVO_DUDOSO, QUIEN_CARGA, type FuenteDudoso, type MotivoDudoso } from "@/lib/datoDudoso";

/**
 * La bandera de un dato que el Estado publicó y no se puede creer (migración 102): un monto que es el RUC del
 * proveedor, un sueldo de S/ 46 millones, una adjudicación 100 veces su valor referencial. Vigía NO borra ni cambia el
 * dato (pedido del usuario, 2026-10-22: "no elimines nada, sólo menciona que puede ser un error de CONOSCE al subir
 * datos"): lo muestra tal como vino y dice, sin rodeos, que puede ser un error de quien lo cargó. Sólo lo deja fuera de
 * las sumas y comparaciones, y cada total lo nombra aparte.
 *
 * `BanderaDato` va en la fila (junto a las otras banderas, con el motivo en el `title`); `AvisoDato` en la ficha o en
 * el panel de detalle, con la explicación entera. Server-safe.
 */

export function BanderaDato({ motivo, fuente, className }: { motivo: MotivoDudoso; fuente: FuenteDudoso; className?: string }) {
  const m = MOTIVO_DUDOSO[motivo];
  return (
    <span
      className={cn("pill inline-flex items-center gap-1 border-amber/30 bg-amber-soft text-amberTexto", className)}
      title={`Puede ser un error ${QUIEN_CARGA[fuente]} al subir el dato: ${m.explica}`}
    >
      <TriangleAlert size={12} strokeWidth={2.25} className="shrink-0" aria-hidden />
      Posible error {QUIEN_CARGA[fuente]}
    </span>
  );
}

export function AvisoDato({
  motivo,
  fuente,
  suma = true,
  children,
  className,
}: {
  motivo: MotivoDudoso;
  fuente: FuenteDudoso;
  /** `false` cuando el dato no entra en ninguna suma de esa vista (no hace falta decir que va aparte). */
  suma?: boolean;
  /** El dato tal como vino ("S/ 45,006,800 en la O/S 106-2026"), u otra línea. */
  children?: ReactNode;
  className?: string;
}) {
  const m = MOTIVO_DUDOSO[motivo];
  return (
    <div role="note" className={cn("flex gap-3 rounded-xl border border-amber/30 bg-amber-soft/60 p-3.5", className)}>
      <TriangleAlert size={18} strokeWidth={2.25} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
      <div className="min-w-0 space-y-1 text-[13.5px] leading-snug">
        <p className="font-semibold text-ink">Puede ser un error {QUIEN_CARGA[fuente]} al subir el dato</p>
        <p className="text-inkSoft">{m.explica}</p>
        {children && <p className="text-inkSoft">{children}</p>}
        <p className="text-[12.5px] text-mute">
          Vigía no borra ni cambia el dato: lo muestra tal como lo publicó {FUENTE_DUDOSO[fuente]}
          {suma ? ". Va aparte de los totales y de las comparaciones, para que un posible error no infle las cifras." : "."}
        </p>
      </div>
    </div>
  );
}
