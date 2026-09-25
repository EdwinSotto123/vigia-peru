"use client";

import { useContext } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { reglaLabel } from "@/lib/auditoria";
import { ICONO_SEVERIDAD, Severidad } from "@/components/ui/Severidad";
import { redactDnis } from "../../Redact";
import { severidadDe, type ConteoSeveridad, type EstadoCorrida, type NivelDossier } from "../dossier";
import { ConteoSenales } from "./ConteoSenales";
import { evidenciaComoTexto } from "./Evidencia";
import { NivelTituloDossier } from "./nivelTitulo";

const ORDEN = { alta: 0, media: 1, baja: 2 } as const;

/**
 * El veredicto del dossier, en palabras (DESIGN_SYSTEM.md §10.4 y §14): qué encontró el
 * análisis, cuánto pesa, cuántas señales de cada severidad y las dos que más pesan. Va
 * DESPUÉS de la ficha del contrato (qué, quién, cuánto, cuándo).
 *
 * El puntaje (0–100) sólo aparece junto a las señales que lo explican: sin señales no se
 * imprime un "0 / 100" suelto. Los conteos salen de `contarSeveridades`, la misma lectura
 * que usa la lista de señales de abajo: la cabecera y la lista siempre suman lo mismo.
 */
export function ResumenHumano({
  conteo,
  banderasArr,
  score,
  nivel,
  corrida,
  onVerEvidencia,
}: {
  conteo: ConteoSeveridad;
  /** Señales que se pueden sostener (sin las de sobreprecio que el mercado no midió). */
  banderasArr: any[];
  score: number | null;
  nivel: NivelDossier;
  corrida: EstadoCorrida;
  onVerEvidencia: () => void;
}) {
  // Dentro de la vista previa del panel el título del dossier es h2: este baja a h3.
  const Titulo = useContext(NivelTituloDossier) === "h1" ? "h2" : "h3";
  const conSenales = banderasArr.length > 0;
  // El único mapa de íconos de severidad (components/ui/Severidad): el check sólo en "Sin señales".
  const Icono = ICONO_SEVERIDAD[nivel.ui.icono];

  const top = [...banderasArr].sort((a, b) => ORDEN[severidadDe(a)] - ORDEN[severidadDe(b)]).slice(0, 2);

  const titular = conSenales
    ? `El análisis encontró ${conteo.total} ${conteo.total === 1 ? "señal" : "señales"} en este contrato`
    : nivel.nivel === "limpio"
      ? "El análisis terminó sin señales en este contrato"
      : "El análisis de este contrato no terminó completo";

  return (
    <section aria-labelledby="veredicto-titulo" className={cn("overflow-hidden rounded-2xl border bg-paper", nivel.ui.borde)}>
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full border", nivel.ui.fondo, nivel.ui.texto, nivel.ui.borde)} aria-hidden>
          <Icono size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <Titulo id="veredicto-titulo" className="font-display text-[20px] font-bold leading-tight text-ink text-balance">
            {titular}
          </Titulo>

          {conSenales ? (
            <p className="mt-1 text-sm leading-relaxed text-inkSoft text-pretty">
              <strong className={cn("font-semibold", nivel.ui.texto)}>{nivel.etiqueta}</strong>
              {score !== null && (
                <>
                  {" "}(puntaje <span className="font-mono tabular-nums text-ink">{Math.round(score)}</span> de 100)
                </>
              )}
              . Una señal no es una acusación: es un patrón con la norma y la evidencia que lo sostienen, para que lo compruebes.
            </p>
          ) : nivel.nivel === "limpio" ? (
            <p className="mt-1 text-sm leading-relaxed text-inkSoft text-pretty">
              Se evaluaron las reglas de contratación y se escribió el dictamen, y ninguna regla disparó una señal. No es un
              certificado: es lo que permitieron ver los datos públicos de este proceso.
            </p>
          ) : (
            <p className="mt-1 text-sm leading-relaxed text-inkSoft text-pretty">
              {corrida.hayTraza
                ? corrida.nombres.length > 0
                  ? `Se completaron ${corrida.nombres.length} de las ${corrida.total} revisiones del análisis. `
                  : "El registro no muestra ninguna revisión completada. "
                : "No quedó registro de qué revisiones se completaron. "}
              {corrida.faltan.length > 0 && `Faltó ${corrida.faltan.join(" y ")}. `}
              Que no aparezcan señales no quiere decir que el contrato no las tenga.
            </p>
          )}

          {/* Con señales pero el análisis cortado: se dice, sin esconder lo que sí se registró. */}
          {conSenales && !corrida.completa && (
            <p className="mt-2 text-[13px] leading-relaxed text-mute">
              Este análisis no terminó completo
              {corrida.faltan.length > 0 && <> (faltó {corrida.faltan.join(" y ")})</>}: las señales que sí se registraron
              están abajo.
            </p>
          )}

          <ConteoSenales conteo={conteo} className="mt-3" />
        </div>
      </div>

      {/* Las dos que más pesan: patrón en palabras, con su severidad en tres canales. */}
      {top.length > 0 && (
        <div className="border-t border-line bg-paperSoft px-4 py-3 sm:px-5">
          <p className="text-[12px] font-medium text-mute">Las que más pesan</p>
          <ul className="mt-1.5 space-y-2">
            {top.map((b, i) => {
              const texto = evidenciaComoTexto(b.evidencia) || reglaLabel(String(b.regla || "Señal"));
              return (
                <li key={`${b.regla ?? "senal"}-${i}`} className="text-[13px] leading-snug text-ink">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <Severidad bandera={severidadDe(b)} formato="linea" />
                    <span className="font-semibold">{reglaLabel(String(b.regla || "Señal"))}</span>
                  </span>
                  {texto && texto !== reglaLabel(String(b.regla || "Señal")) && (
                    <span className="mt-0.5 line-clamp-2 block text-inkSoft">{redactDnis(texto)}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={onVerEvidencia}
            className="mt-2.5 inline-flex min-h-[32px] items-center gap-1 rounded-full text-[13px] font-semibold text-granate hover:underline"
          >
            Ver {conteo.total === 1 ? "la señal con su evidencia" : `las ${conteo.total} señales con su evidencia`}
            <ChevronRight size={14} aria-hidden />
          </button>
        </div>
      )}
    </section>
  );
}
