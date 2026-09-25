import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";
import { Ayuda } from "@/components/patrones/Ayuda";

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

/**
 * La cifra del cotejo, con su explicación a un clic (§10.7): "104 de 226 cotejadas ⓘ".
 * Antes era un párrafo de tres líneas encima de la tabla que nadie leía dos veces.
 */
export function LeyendaCotejo({ cotejadas, total }: { cotejadas: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-inkSoft">
      <ShieldCheck size={13} className="text-mossTexto" aria-hidden />
      <span className="tabular-nums">
        <strong className="font-semibold text-ink">{numero(cotejadas)}</strong> de {numero(total)} cotejadas
      </span>
      <Ayuda titulo="¿Qué es una señal cotejada?">
        <span className="block">
          El cotejo automático no encontró contradicciones entre el monto, el RUC, la fecha o el enlace que cita la señal
          y el registro oficial (OECE, SUNAT o el expediente). Revisa los datos, no la conclusión.
        </span>
        <span className="block mt-2 text-mute">&ldquo;Sin cotejo&rdquo; no quiere decir falsa: ese análisis es anterior a que el cotejo se guardara.</span>
      </Ayuda>
    </span>
  );
}
