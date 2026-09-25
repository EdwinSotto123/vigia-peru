"use client";

/**
 * El sello de cotejo de una señal.
 *
 * `banderas.verificacion.ok` (migración 18) dice si el pipeline volvió a comprobar contra la
 * fuente oficial el dato que sostiene la señal. Hasta ahora una señal cotejada se veía idéntica
 * a una sin cotejar — y esa es exactamente la distancia entre una pista y una acusación, que es
 * lo único que este producto promete no confundir.
 *
 * El significado va en un `Popover` y no en un `title`: en celular no existe el hover, y esta es
 * información que el usuario necesita para decidir cuánto peso darle a la señal.
 */

import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import { Ayuda } from "@/components/patrones/Ayuda";
import { cn } from "@/lib/utils";

const SELLO = {
  si: {
    Icono: ShieldCheck,
    label: "cotejada",
    clase: "border-moss/40 bg-moss/10 text-mossTexto",
    titulo: "Señal cotejada",
    texto:
      "El análisis marcó esta señal como cotejada contra la fuente oficial (el registro público del proceso, la SUNAT o el documento del expediente). Igual compruébala tú: la señal trae su norma y el enlace a su fuente.",
  },
  no: {
    Icono: ShieldAlert,
    label: "sin confirmar",
    clase: "border-amber/40 bg-amber-soft text-amberTexto",
    titulo: "El cotejo no la confirmó",
    texto:
      "El cotejo automático corrió y no pudo confirmar el dato contra la fuente oficial. La señal se publica marcada así, no se esconde: sirve como pista, no como prueba.",
  },
  nulo: {
    Icono: ShieldQuestion,
    label: "sin cotejo",
    clase: "border-line bg-paperSoft text-mute",
    titulo: "Sin cotejo registrado",
    texto:
      "Este análisis no guardó el resultado de la verificación para esta señal. No significa que sea falsa ni que sea cierta: significa que nadie la volvió a comprobar automáticamente.",
  },
} as const;

export function SelloVerificada({ verificada, className }: { verificada: boolean | null; className?: string }) {
  const s = verificada === true ? SELLO.si : verificada === false ? SELLO.no : SELLO.nulo;
  const { Icono } = s;
  return (
    <Popover
      titulo={s.titulo}
      anchoClase="w-72"
      className={cn(
        "shrink-0 rounded-full transition-colors duration-rapido focus-visible:outline-none",
        className,
      )}
      trigger={
        <span
          className={cn(
            "pill border text-[11px] font-medium hover:brightness-95",
            s.clase,
          )}
        >
          <Icono size={11} aria-hidden />
          {s.label}
        </span>
      }
    >
      {s.texto}
    </Popover>
  );
}

/**
 * La cifra del cotejo del análisis, en una línea con su explicación a un clic (DESIGN_SYSTEM.md
 * §10.7): "1 de 3 cotejadas ⓘ" o "Sin cotejo registrado ⓘ". Antes eran tres líneas al pie de la
 * lista. Cuando NINGUNA señal trae registro de cotejo, veinte sellos grises idénticos no
 * informan: informa esta línea, que declara la ausencia en vez de dejar el vacío sin explicar.
 */
export function LeyendaCotejo({ verificadas, conCotejo, total }: { verificadas: number; conCotejo: number; total: number }) {
  if (conCotejo === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] text-mute">
        <ShieldQuestion size={13} className="shrink-0" aria-hidden />
        Sin cotejo registrado
        <Ayuda titulo="¿Por qué sin cotejo?">
          Ninguna de las {total} señales trae el cotejo automático contra la fuente oficial: este análisis no guardó ese
          campo. Cada señal conserva su norma y su enlace a la fuente para comprobarla a mano.
        </Ayuda>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-inkSoft">
      <ShieldCheck size={13} className="shrink-0 text-mossTexto" aria-hidden />
      <span className="tabular-nums">
        <strong className="font-semibold text-ink">{verificadas}</strong> de {total} cotejadas
      </span>
      <Ayuda titulo="¿Qué es una señal cotejada?">
        El propio análisis la volvió a comprobar contra su fuente oficial (el registro del proceso, la SUNAT o el
        documento del expediente). Las demás siguen siendo una pista que hay que comprobar.
      </Ayuda>
    </span>
  );
}
