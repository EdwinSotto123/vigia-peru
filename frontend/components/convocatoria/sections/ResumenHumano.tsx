"use client";

import { useContext } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CORTE_ALTA, CORTE_MEDIA } from "@/lib/severidad";
import { plural } from "@/lib/formato";
import { Ayuda } from "@/components/patrones/Ayuda";
import { ICONO_SEVERIDAD } from "@/components/ui/Severidad";
import { redactDnis } from "../../Redact";
import type { ConteoSeveridad, EstadoCorrida, NivelDossier } from "../dossier";
import { NivelTituloDossier } from "./nivelTitulo";

/**
 * El veredicto de la Ficha (DESIGN_SYSTEM.md §14.2 y §10.4): UNA tarjeta con qué se sabe, en
 * palabras. El titular, el anticipo del dictamen (≤ 2 líneas; el texto entero en su pestaña) y
 * el puntaje junto a las señales que lo explican. Los conteos por severidad ya están en los
 * `Indicadores` de arriba y la lista de señales en la pestaña de abajo: aquí no se repiten.
 *
 * El chip del peso del riesgo va en la identidad; aquí el mismo tono lo lleva el ícono.
 */
export function ResumenHumano({
  conteo,
  score,
  nivel,
  corrida,
  resumenEjecutivo,
  onVerEvidencia,
  onLeerDictamen,
}: {
  conteo: ConteoSeveridad;
  score: number | null;
  nivel: NivelDossier;
  corrida: EstadoCorrida;
  /** Anticipo del dictamen, ya cortado (≈180 caracteres). */
  resumenEjecutivo: string;
  onVerEvidencia: () => void;
  onLeerDictamen: () => void;
}) {
  // Dentro de la vista previa del panel el título del dossier es h2: este baja a h3.
  const Titulo = useContext(NivelTituloDossier) === "h1" ? "h2" : "h3";
  const conSenales = conteo.total > 0;
  // El único mapa de íconos de severidad (components/ui/Severidad): el check sólo en "Sin señales".
  const Icono = ICONO_SEVERIDAD[nivel.ui.icono];

  const titular = conSenales
    ? `El análisis encontró ${plural(conteo.total, "señal", "señales")}`
    : nivel.nivel === "limpio"
      ? "El análisis terminó sin señales"
      : "El análisis no terminó completo";

  // Una línea de estado: el puntaje con las señales, o qué faltó. Lo que significa, en la ⓘ.
  const estado = conSenales
    ? [score !== null ? `Puntaje ${Math.round(score)} de 100` : null, !corrida.completa ? `Análisis incompleto${corrida.faltan.length ? `: faltó ${corrida.faltan.join(" y ")}` : ""}` : null]
        .filter(Boolean)
        .join(" · ")
    : nivel.nivel === "limpio"
      ? "Ninguna regla de contratación disparó una señal."
      : `${
          corrida.hayTraza
            ? corrida.nombres.length > 0
              ? `Se completaron ${corrida.nombres.length} de ${corrida.total} revisiones`
              : "El registro no muestra ninguna revisión completada"
            : "No quedó registro de qué revisiones se completaron"
        }${corrida.faltan.length > 0 ? `; faltó ${corrida.faltan.join(" y ")}` : ""}.`;

  return (
    <section aria-labelledby="veredicto-titulo" className={cn("rounded-2xl border bg-paper px-4 py-3.5 sm:px-5", nivel.ui.borde)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full border", nivel.ui.fondo, nivel.ui.texto, nivel.ui.borde)} aria-hidden>
            <Icono size={16} />
          </span>
          <Titulo id="veredicto-titulo" className="font-display text-[19px] font-bold leading-tight text-ink text-balance">
            {titular}
          </Titulo>
          {conSenales ? (
            <Ayuda titulo="¿Qué es una señal?">
              Un patrón que disparó una regla de contratación, con la norma y la evidencia que lo sostienen: una pista para
              comprobar, no una acusación. El peso del riesgo sale del puntaje (0 a 100), que suma el peso de cada señal:
              alto desde {CORTE_ALTA}, medio desde {CORTE_MEDIA}.
            </Ayuda>
          ) : nivel.nivel === "limpio" ? (
            <Ayuda titulo="¿Qué quiere decir sin señales?">
              Se evaluaron las reglas de contratación y se escribió el dictamen, y ninguna regla disparó una señal. No es un
              certificado: es lo que permitieron ver los datos públicos de este proceso.
            </Ayuda>
          ) : (
            <Ayuda titulo="¿Qué quiere decir incompleto?">
              Una o más revisiones del análisis no llegaron a correr. Que no aparezcan señales no quiere decir que el contrato
              no las tenga.
            </Ayuda>
          )}
        </div>
        {conSenales && (
          <button type="button" onClick={onVerEvidencia} className={ENLACE}>
            Ver {conteo.total === 1 ? "la señal con su evidencia" : `las ${conteo.total} con su evidencia`}
            <ChevronRight size={14} aria-hidden />
          </button>
        )}
      </div>

      {/* Qué se sabe, en palabras: el anticipo del dictamen, pasado por la redacción de datos personales. */}
      {resumenEjecutivo && (
        <p className="mt-2 line-clamp-2 max-w-[70ch] text-sm leading-relaxed text-inkSoft">{redactDnis(resumenEjecutivo)}</p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {estado ? <p className="text-[12.5px] tabular-nums text-mute">{estado}</p> : <span />}
        {resumenEjecutivo && (
          <button type="button" onClick={onLeerDictamen} className={ENLACE}>
            Leer el dictamen completo <ChevronRight size={14} aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}

const ENLACE = "inline-flex min-h-[32px] items-center gap-1 rounded-full text-[13px] font-semibold text-granate hover:underline";
