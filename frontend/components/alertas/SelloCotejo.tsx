import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";

/**
 * El cotejo de una señal contra fuentes oficiales — el sello que separa "esto se
 * comprobó" de "esto lo dijo un agente y nadie lo contrastó".
 *
 * Tres estados, no dos, porque el dato tiene tres: `banderas.verificacion->>'ok'`
 * vale `true` en 69 de las 220 señales publicadas y es `null` en 131 (análisis
 * anteriores a que se guardara el cotejo, o contratos que ya no responden). Pintar
 * ese `null` de rojo, o de "no verificada", sería afirmar que el cotejo falló
 * cuando lo que pasó es que no consta. En un producto que acusa de falta de
 * transparencia, esa diferencia es el producto.
 *
 * Los tres canales de siempre: color + ícono dibujado + palabra. El sello cotejado
 * es el único con fondo pleno, así que se ve a golpe de vista en una columna de
 * veinte filas aunque no se lea ni una palabra.
 */
export function SelloCotejo({ verificada, className }: { verificada: boolean | null; className?: string }) {
  if (verificada === true) {
    return (
      <span className={cn("pill border-moss/40 bg-moss/10 font-semibold text-mossTexto", className)}>
        <ShieldCheck size={12} aria-hidden />
        Cotejada
      </span>
    );
  }
  if (verificada === false) {
    return (
      <span className={cn("pill border-amber/40 bg-amber-soft text-amberTexto", className)}>
        <ShieldAlert size={12} aria-hidden />
        No se pudo cotejar
      </span>
    );
  }
  return (
    <span className={cn("pill border-dashed border-line bg-transparent text-mute", className)}>
      <ShieldQuestion size={12} aria-hidden />
      Sin cotejo
    </span>
  );
}

/** La misma distinción, explicada una vez arriba de la tabla en vez de en un tooltip por fila. */
export function LeyendaCotejo({ cotejadas, total }: { cotejadas: number; total: number }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-mute">
      <ShieldCheck size={12} className="mr-1 inline align-[-1px] text-mossTexto" aria-hidden />
      <strong className="font-semibold text-mossTexto">Cotejada</strong> significa que el cotejo automático no encontró
      contradicciones entre el monto, el RUC, la fecha o el enlace que cita la señal y el registro de contrataciones del
      OECE, SUNAT o el propio expediente (revisa los datos, no la conclusión):{" "}
      <span className="font-semibold tabular-nums text-ink">{numero(cotejadas)}</span> de{" "}
      <span className="font-semibold tabular-nums text-ink">{numero(total)}</span> señales.{" "}
      <ShieldQuestion size={12} className="mr-1 inline align-[-1px]" aria-hidden />
      <strong className="font-semibold text-inkSoft">Sin cotejo</strong> no quiere decir que sea falsa: quiere decir que
      ese análisis es anterior a que el cotejo se guardara, y que nadie lo comprobó por segunda vez.
    </p>
  );
}
