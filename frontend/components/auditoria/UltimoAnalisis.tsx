/**
 * El estado por defecto de /app/auditoria.
 *
 * Que no haya ningún contrato en análisis es el estado NORMAL de esta pantalla, no la
 * excepción: una corrida dura ~4 minutos y entre corrida y corrida pasan horas. Antes,
 * media pantalla era una caja vacía que decía "Ningún contrato en análisis ahora mismo":
 * el momento en que el producto tenía MÁS para mostrar era justo el momento en que no
 * mostraba nada.
 *
 * Acá va, en su lugar, la última lectura real: qué contrato fue, qué encontró, en cuántos
 * pasos, y la repetición de la bitácora guardada, que es la prueba de que se leyó de
 * verdad. La repetición vive dentro de <Revelar>, así que no arranca sola al cargar la
 * página: se monta recién cuando alguien la pide.
 *
 * Dato primero (DESIGN_SYSTEM.md §10.7): una franja de cuatro líneas —cuándo y cuánto
 * trabajo, qué fue, de quién y quién lo pagó, qué encontró— con las señales y los motivos
 * como chips. Lo que explica cada motivo está a un clic (Ayuda); el dictamen, en la página
 * del contrato. Es lo primero de la pestaña En curso: cuanto más corta, más se ve la cola.
 *
 * Si esa última lectura quedó EN REVISIÓN HUMANA, no se muestra nada de lo que encontró (ni
 * señales, ni severidad, ni puntaje): sólo que está en revisión y por qué. Publicar acá el
 * "riesgo 60/100" de un análisis que el propio sistema frenó era publicarlo igual.
 *
 * Server component. `ReplayAnalisis` (cliente) recibe solo datos serializables.
 */

import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Eye, Play } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { Severidad } from "@/components/ui/Severidad";
import { Ayuda } from "@/components/patrones";
import { plural, porcentaje, solesCompacto } from "@/lib/formato";
import {
  duracion,
  estadoVisible,
  fasesEfectivas,
  fechaLima,
  progresoFases,
  reglaLabel,
  type ProcesamientoDetalle,
} from "@/lib/auditoria";
import { TOTAL_AGENTES, TOTAL_PASOS } from "@/components/agentes/catalogo";
import { ReplayAnalisis } from "./ReplayAnalisis";

const pct = (x: number | null) => (x == null ? null : porcentaje(x * 100));

export function UltimoAnalisis({ p, hayFiltros = false }: { p: ProcesamientoDetalle | null; hayFiltros?: boolean }) {
  if (!p) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-paperSoft px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">Todavía no hay ninguna lectura terminada acá</h3>
        <p className="mt-0.5 text-[13px] text-inkSoft">
          {hayFiltros
            ? "Con estos filtros no hay ningún análisis terminado: quita uno arriba."
            : "Cuando termine el primer análisis, aparece acá con lo que encontró."}
        </p>
      </div>
    );
  }

  const estado = estadoVisible(p);
  const enRevision = estado === "revision";
  const eventos = Array.isArray(p.eventos) ? p.eventos : [];
  const fases = fasesEfectivas(p, eventos);
  const prog = progresoFases(fases, estado);
  const duro =
    p.iniciadoAt && p.finalizadoAt ? new Date(p.finalizadoAt).getTime() - new Date(p.iniciadoAt).getTime() : null;
  const senales = p.resultado?.banderas ?? [];
  const conSenales = senales.length > 0 || p.banderas > 0;
  const nSenales = senales.length || p.banderas;
  // La pastilla de severidad tiene que hablar de lo mismo que la cifra que está a su lado.
  // La pastilla describe la peor SEÑAL, porque la cifra de al lado cuenta señales: el tramo
  // del puntaje ("Riesgo bajo" con score 18) habla del contrato, no de sus señales, y
  // mezclarlos es la contradicción que más daño hace en esta pantalla. Sin señales, la
  // pastilla es la de "Sin señales" (el único check verde).
  const ORDEN_SEV = { alta: 3, media: 2, baja: 1 } as const;
  const peorSenal = senales.reduce<"alta" | "media" | "baja" | null>(
    (peor, s) => (!peor || ORDEN_SEV[s.severidad] > ORDEN_SEV[peor] ? s.severidad : peor),
    null,
  );
  const motivos = enRevision ? p.resultado?.revisionMotivos ?? [] : [];
  const titulo = p.titulo ?? p.ocid;
  const href = `/app/auditoria/${encodeURIComponent(p.ocid)}`;

  return (
    <div className="rounded-2xl border border-line bg-paper px-4 py-3">
      {/* "Ningún contrato en análisis" ya lo dice la franja de estado de arriba: este panel solo
          existe cuando eso es cierto, así que se presenta por lo que muestra. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px] text-mute">
          <h3 className="text-[13px] font-semibold text-ink">Lo último que se leyó</h3>
          {p.finalizadoAt && <time dateTime={p.finalizadoAt}>{fechaLima(p.finalizadoAt, { larga: true, hora: true })}</time>}
          {/* Cuánto trabajo costó, junto a cuándo terminó. */}
          <span>
            <span className="font-mono font-semibold text-inkSoft">{prog.hechas}</span> de{" "}
            <span className="font-mono font-semibold text-inkSoft">{prog.aplicables}</span> pasos
            {duro != null && duro > 0 && <> en {duracion(duro)}</>}
          </span>
        </div>
        {eventos.length > 0 && (
          <Revelar
            titulo="Cómo se analizó este contrato"
            descripcion={`${plural(eventos.length, "evento", "eventos")} de bitácora de ${TOTAL_AGENTES} agentes en ${TOTAL_PASOS} pasos, tal como quedaron guardados y con los tiempos reales.`}
            ancho="lg"
            etiqueta="Repetir el análisis de este contrato, paso por paso"
            className="w-auto"
            detalle={<ReplayAnalisis eventos={eventos} estadoFinal={estado} compacto />}
          >
            <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line bg-paperSoft px-3 py-1 text-[12px] font-medium text-ink transition-colors group-hover:border-paperEdge group-hover:bg-paperDeep">
              <Play size={11} aria-hidden /> Repetir el análisis paso por paso
            </span>
          </Revelar>
        )}
      </div>

      {/* Qué fue: el objeto en una línea (entero en `title`), entidad, zona y valor. */}
      <Link href={href} className="group mt-1.5 block min-w-0 rounded-lg">
        <span className="text-[14px] font-semibold leading-snug text-ink line-clamp-2 group-hover:text-granate md:truncate" title={titulo}>
          {titulo}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-mute">
          <span className="min-w-0 truncate">{p.entidad ?? "Entidad no identificada"}</span>
          <span>{p.zona}</span>
          {p.montoPen != null && p.montoPen > 0 && <span className="font-mono tabular-nums">{solesCompacto(p.montoPen)}</span>}
          <span title={p.contribucionCodigo ? `Aporte ${p.contribucionCodigo}` : undefined}>
            lo pagó <span className="font-medium text-inkSoft">{p.financiador}</span>
          </span>
          <span className="inline-flex items-center gap-0.5 font-medium text-granate">
            {enRevision ? "Ver su estado" : "Ver el dictamen"} <ArrowUpRight size={12} aria-hidden />
          </span>
        </span>
      </Link>

      {/* Qué encontró, en una línea de chips. En revisión: sólo eso y sus motivos (§10.4). */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
        {enRevision ? (
          <>
            <span className="pill border-clay/40 bg-paperDeep font-semibold text-clayTexto">
              <Eye size={11} aria-hidden /> En revisión
            </span>
            {motivos.map((m) => (
              <span key={m.clave} className="pill border-line bg-paperSoft text-inkSoft">
                {m.titulo}
                {m.valor != null && <span className="font-semibold tabular-nums text-ink">{pct(m.valor)}</span>}
              </span>
            ))}
            <Ayuda titulo="¿Por qué está en revisión?">
              <span className="block">Una persona lo revisa antes de publicarlo; mientras tanto no cuenta como señal hallada.</span>
              {motivos.map((m) => (
                <span key={m.clave} className="mt-1.5 block text-mute">
                  <span className="font-semibold text-ink">{m.titulo}</span>
                  {m.valor != null && m.umbral != null && (
                    <span className="tabular-nums"> ({pct(m.valor)}, mínimo {pct(m.umbral)})</span>
                  )}
                  . {m.detalle}
                </span>
              ))}
            </Ayuda>
          </>
        ) : (
          <>
            {peorSenal ? (
              <Severidad bandera={peorSenal} formato="pastilla" />
            ) : conSenales ? null : (
              // Sin señales: el verde de "sin señales" (§10.1), no la severidad del puntaje.
              <span className="pill border-moss/40 bg-moss/10 text-mossTexto">
                <CheckCircle2 size={11} aria-hidden /> Sin señales
              </span>
            )}
            {conSenales && (
              <span className="text-[13px] text-mute">
                <span className="font-semibold text-ink">{plural(nSenales, "señal de riesgo", "señales de riesgo")}</span>
                {/* El puntaje sólo junto a las señales que lo explican (§10.4). */}
                {p.score != null && (
                  <span className="ml-2">
                    puntaje <span className="font-mono tabular-nums text-ink">{Math.round(p.score)}</span> de 100
                  </span>
                )}
              </span>
            )}
            {senales.slice(0, 3).map((s, i) => (
              <span key={`${s.regla}-${i}`} className="pill max-w-full border-line bg-paperSoft text-inkSoft" title={s.norma ?? undefined}>
                <Severidad bandera={s.severidad} formato="punto" />
                <span className="truncate">{reglaLabel(s.regla)}</span>
              </span>
            ))}
            {senales.length > 3 && (
              <span className="text-mute">y {plural(senales.length - 3, "señal más", "señales más")} en el dictamen</span>
            )}
          </>
        )}
      </div>

    </div>
  );
}
