"use client";

import Link from "next/link";
import { ArrowUpRight, WifiOff } from "lucide-react";
import { Severidad } from "@/components/ui/Severidad";
import { formatoSoles } from "./escala";

/**
 * Las señales publicadas más fuertes, en una tira estática.
 *
 * Reemplaza al marquee "EN VIVO" que había acá. Dos motivos, los dos de
 * fondo: (1) cuando la API no respondía, el marquee caía a `ALERTAS_MOCK` y
 * mostraba alertas inventadas sobre convocatorias inventadas sin decirlo —
 * en un producto que acusa de falta de transparencia; (2) era una animación
 * infinita corriendo sobre datos, que además obligaba a esperar a que el
 * texto pasara para poder leerlo.
 */
export function SenalesRecientes({
  alertas,
  fallo,
}: {
  alertas: any[];
  fallo: boolean;
}) {
  if (fallo) {
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-inkSoft" role="status" aria-live="polite">
        <WifiOff size={13} className="text-clayTexto" aria-hidden />
        No se pudieron cargar las señales publicadas · reintentando
      </p>
    );
  }

  if (alertas.length === 0) {
    return (
      <p className="text-[12px] leading-relaxed text-mute">
        Todavía no hay ninguna señal publicada. Aparecen acá cuando un contrato termina de leerse y su dictamen pasa la
        autoevaluación.
      </p>
    );
  }

  const top = [...alertas].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-[12px] text-mute">
        <strong className="font-semibold text-ink">{alertas.length.toLocaleString("es-PE")}</strong> señales publicadas ·
        las de mayor score
      </span>
      {/* En móvil cada señal ocupa su propia línea completa y el objeto se
          queda con el ancho sobrante (flex-1 + min-w-0), porque la suma de las
          piezas fijas —nivel, código, región, monto— ya se comía los 390 px y
          empujaba la página 51 px hacia la derecha. El código y el monto son
          contexto secundario: desaparecen en pantalla angosta en vez de
          desbordar. */}
      <ul className="flex w-full min-w-0 flex-col gap-y-1.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
        {top.map((a) => (
          <li key={a.id ?? a.codigo} className="min-w-0">
            <Link
              href={`/app/convocatoria/${a.codigoconvocatoria || a.codigo?.replace("OECE-", "") || a.id}`}
              className="group flex min-w-0 items-center gap-2 text-[12px] text-ink hover:text-heroViolet"
            >
              <span className="shrink-0">
                <Severidad score={a.score} formato="linea" />
              </span>
              <span className="hidden shrink-0 font-mono text-[11px] text-mute sm:inline">
                {a.codigoconvocatoria ?? a.codigo}
              </span>
              <span className="shrink-0 text-mute">{a.region}</span>
              <span className="min-w-0 flex-1 truncate sm:max-w-[40ch] sm:flex-none">{a.objeto}</span>
              {typeof a.montoSoles === "number" && a.montoSoles > 0 && (
                <span className="hidden shrink-0 font-mono text-[11px] tabular-nums text-mute sm:inline">
                  {formatoSoles(a.montoSoles)}
                </span>
              )}
              <ArrowUpRight size={12} className="shrink-0 text-mute transition-colors group-hover:text-heroViolet" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
