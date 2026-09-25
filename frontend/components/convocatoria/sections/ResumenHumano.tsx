"use client";

import { useContext } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { reglaLabel } from "@/lib/auditoria";
import { CORTE_ALTA, CORTE_MEDIA, severidadDeBandera } from "@/lib/severidad";
import { plural } from "@/lib/formato";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Revelar } from "@/components/ui/Revelar";
import { ICONO_SEVERIDAD, Severidad } from "@/components/ui/Severidad";
import { DetalleSenal } from "@/components/agentes/ListaSenales";
import { nombreDeAgente } from "@/components/agentes/catalogo";
import { severidadDe, type ConteoSeveridad, type EstadoCorrida, type NivelDossier } from "../dossier";
import { desdeBandera } from "./BanderasAgrupadas";
import { ConteoSenales } from "./ConteoSenales";
import { NivelTituloDossier } from "./nivelTitulo";

const ORDEN = { alta: 0, media: 1, baja: 2 } as const;

/**
 * El veredicto del dossier (DESIGN_SYSTEM.md §10.4, §10.7 y §14): qué encontró el análisis,
 * cuánto pesa, cuántas señales de cada severidad y las dos que más pesan. Va DESPUÉS de la
 * ficha del contrato (qué, quién, cuánto, cuándo).
 *
 * Dato primero: una línea de veredicto, una línea de cifras y cada señal en UNA línea con su
 * severidad. La evidencia completa se abre en el panel lateral (la misma ficha que la lista de
 * la pestaña Señales) y lo que antes eran párrafos de explicación está en la ⓘ. En la fila no va
 * texto de evidencia: así ningún dato personal queda dentro de un botón.
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
    ? `El análisis encontró ${plural(conteo.total, "señal", "señales")}`
    : nivel.nivel === "limpio"
      ? "El análisis terminó sin señales"
      : "El análisis no terminó completo";

  // Qué revisiones se completaron, en una línea. Lo que eso significa va en la ⓘ.
  const revisiones = corrida.hayTraza
    ? corrida.nombres.length > 0
      ? `Se completaron ${corrida.nombres.length} de ${corrida.total} revisiones`
      : "El registro no muestra ninguna revisión completada"
    : "No quedó registro de qué revisiones se completaron";

  return (
    <section aria-labelledby="veredicto-titulo" className={cn("overflow-hidden rounded-2xl border bg-paper", nivel.ui.borde)}>
      {/* Veredicto + acceso a la evidencia, en una línea. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
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
              Una o más revisiones del análisis no llegaron a correr. Que no aparezcan señales no quiere decir que el
              contrato no las tenga.
            </Ayuda>
          )}
        </div>
        {conSenales && (
          <button
            type="button"
            onClick={onVerEvidencia}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-full text-[13px] font-semibold text-granate hover:underline"
          >
            Ver {conteo.total === 1 ? "la señal con su evidencia" : `las ${conteo.total} con su evidencia`}
            <ChevronRight size={14} aria-hidden />
          </button>
        )}
      </div>

      {/* Las cifras, en una línea de datos (§10.7). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-4 py-2.5 text-[13px] text-inkSoft sm:px-5">
        {conSenales ? (
          <>
            <span className={cn("pill font-semibold", nivel.ui.fondo, nivel.ui.texto, nivel.ui.borde)}>
              <Icono size={11} aria-hidden />
              {nivel.etiqueta}
            </span>
            {score !== null && (
              <span className="tabular-nums">
                puntaje <strong className="font-mono font-semibold text-ink">{Math.round(score)}</strong> de 100
              </span>
            )}
            <ConteoSenales conteo={conteo} />
            {/* Con señales pero el análisis cortado: se dice, sin esconder lo que sí se registró. */}
            {!corrida.completa && (
              <span className="text-mute">Análisis incompleto{corrida.faltan.length > 0 && <>: faltó {corrida.faltan.join(" y ")}</>}</span>
            )}
          </>
        ) : nivel.nivel === "limpio" ? (
          <span>Ninguna regla de contratación disparó una señal.</span>
        ) : (
          <span>
            {revisiones}
            {corrida.faltan.length > 0 && <>; faltó {corrida.faltan.join(" y ")}</>}.
          </span>
        )}
      </div>

      {/* Las que más pesan: una línea cada una; la evidencia, en el panel lateral. */}
      {top.length > 0 && (
        <div className="border-t border-line bg-paperSoft px-4 py-2 sm:px-5">
          <p className="text-[12px] font-medium text-mute">Las que más pesan</p>
          <ul className="mt-1 divide-y divide-line/70">
            {top.map((b, i) => {
              const senal = desdeBandera(b);
              const etiqueta = reglaLabel(String(b.regla || "Señal"));
              return (
                <li key={`${b.regla ?? "senal"}-${i}`}>
                  <Revelar
                    titulo={etiqueta}
                    // El nombre accesible empieza por lo que se ve ("Señal alta …"), y dice qué abre.
                    etiqueta={`${severidadDeBandera(senal.severidad).etiqueta} ${etiqueta}: ver la evidencia`}
                    descripcion={
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Severidad bandera={senal.severidad} formato="linea" />
                        <span>
                          la encontró <strong className="font-semibold text-ink">{nombreDeAgente(senal.agenteBruto ?? senal.agente)}</strong>
                        </span>
                      </span>
                    }
                    detalle={<DetalleSenal senal={senal} etiqueta={etiqueta} descripcion={null} />}
                    className="flex min-h-[36px] items-center gap-2 rounded-lg px-1 py-1.5 transition-colors duration-rapido hover:bg-paperDeep"
                  >
                    <Severidad bandera={senal.severidad} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{etiqueta}</span>
                    <ChevronRight size={14} className="shrink-0 text-mute" aria-hidden />
                  </Revelar>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
