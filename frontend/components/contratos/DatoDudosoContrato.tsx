import type { ReactNode } from "react";
import { AvisoDato, BanderaDato } from "@/components/ui/BanderaDato";
import { motivoDudoso } from "@/lib/datoDudoso";
import { soles } from "@/lib/formato";
import type { DatoDudosoContrato } from "@/lib/contratos";

/**
 * El posible error de carga de un contrato del OECE (migración 102) en las piezas de contratos: `ConBanderaDato` apila
 * la bandera bajo el chip de estado de una fila (la columna de estado de toda tabla de contratos) y `AvisoContrato` va
 * en la ficha y en el panel, junto a las cifras, con los dos montos tal como se publicaron. Server-safe.
 */

export function ConBanderaDato({ dato, children }: { dato: DatoDudosoContrato | null | undefined; children: ReactNode }) {
  const motivo = motivoDudoso(dato?.motivo);
  if (!motivo) return <>{children}</>;
  return (
    <span className="flex flex-col items-start gap-1">
      {children}
      <BanderaDato motivo={motivo} />
    </span>
  );
}

/** S/ 0.01 y S/ 1 con sus decimales: redondeados dirían "S/ 0". */
const montoExacto = (n: number | null) => (n == null ? "Sin dato" : n < 10 ? `S/ ${n.toFixed(2)}` : soles(n));

export function AvisoContrato({ dato, className }: { dato: DatoDudosoContrato | null | undefined; className?: string }) {
  const motivo = motivoDudoso(dato?.motivo);
  if (!dato || !motivo) return null;
  return (
    <AvisoDato motivo={motivo} fuente="oece_ocds" suma={false} className={className}>
      Valor referencial publicado: <b className="font-mono tabular-nums text-ink">{montoExacto(dato.referencial)}</b>. Adjudicación
      más grande: <b className="font-mono tabular-nums text-ink">{montoExacto(dato.adjudicado)}</b>.
    </AvisoDato>
  );
}
