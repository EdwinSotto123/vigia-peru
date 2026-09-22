/**
 * El estado por defecto de /app/auditoria.
 *
 * Que no haya ningún contrato en análisis es el estado NORMAL de esta pantalla, no la
 * excepción: una corrida dura ~4 minutos y entre corrida y corrida pasan horas. Antes,
 * media pantalla era una caja vacía que decía "Ningún contrato en análisis ahora mismo" —
 * el momento en que el producto tenía MÁS para mostrar (98 dossieres con traza completa)
 * era justo el momento en que no mostraba nada.
 *
 * Acá va, en su lugar, la última lectura real: qué contrato fue, qué encontró, en cuántos
 * pasos, y la repetición de la bitácora guardada — que es la prueba de que se leyó de
 * verdad. La repetición vive dentro de <Revelar>, así que no arranca sola al cargar la
 * página: se monta recién cuando alguien la pide.
 *
 * Server component. `ReplayAnalisis` (cliente) recibe solo datos serializables.
 */

import Link from "next/link";
import { ArrowUpRight, Eye } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { Severidad } from "@/components/ui/Severidad";
import { formatPEN } from "@/lib/financiamiento";
import {
  duracion,
  estadoVisible,
  fasesEfectivas,
  progresoFases,
  reglaLabel,
  type ProcesamientoDetalle,
} from "@/lib/auditoria";
import { TOTAL_AGENTES, TOTAL_PASOS } from "@/components/agentes/catalogo";
import { ReplayAnalisis } from "./ReplayAnalisis";

const fechaLarga = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function UltimoAnalisis({ p }: { p: ProcesamientoDetalle | null }) {
  if (!p) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-5">
        <h3 className="text-sm font-semibold text-ink">Todavía no hay ninguna lectura terminada acá</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-mute">
          Los agentes trabajan por tandas: cada contrato toma unos minutos y entre tanda y tanda pasan horas.
          Con los filtros puestos no hay ningún dictamen que mostrar — quitá uno arriba y volvé a mirar.
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
  // `severidadDeScore(18)` devuelve "Sin señal relevante", y ponerla junto a "1 señal de
  // riesgo" es exactamente la contradicción que más daño hace en esta pantalla: la pastilla
  // describe el RIESGO DEL CONTRATO y la cifra cuenta SEÑALES. Con señales encontradas, la
  // pastilla pasa a describir la peor de ellas; sin señales, sigue describiendo el contrato.
  const ORDEN_SEV = { alta: 3, media: 2, baja: 1 } as const;
  const peorSenal = senales.reduce<"alta" | "media" | "baja" | null>(
    (peor, s) => (!peor || ORDEN_SEV[s.severidad] > ORDEN_SEV[peor] ? s.severidad : peor),
    null,
  );

  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {/* "Ningún contrato en análisis" ya lo dice la franja de estado de arriba: repetirlo
            acá sería la tercera vez que la página afirma lo mismo. Este panel solo existe
            cuando eso es cierto, así que se presenta por lo que muestra. */}
        <h3 className="text-sm font-semibold text-ink">Lo último que se leyó</h3>
        {p.finalizadoAt && <span className="text-[11px] text-mute">{fechaLarga(p.finalizadoAt)}</span>}
      </div>

      <Link
        href={`/app/auditoria/${encodeURIComponent(p.ocid)}`}
        className="mt-3 block rounded-xl border border-line bg-paperSoft p-3 transition-colors hover:border-paperEdge hover:bg-paperDeep"
      >
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-mute">
          {p.entidad ?? "Entidad no identificada"}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-ink">{p.titulo ?? p.ocid}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-mute">
          <span>{p.zona}</span>
          {p.montoPen != null && p.montoPen > 0 && <span className="font-mono tabular-nums">{formatPEN(p.montoPen)}</span>}
          <span className="inline-flex items-center gap-0.5">ver dictamen <ArrowUpRight size={11} aria-hidden /></span>
        </p>
      </Link>

      {/* Qué encontró. El score siempre con su denominador. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {peorSenal ? (
          <Severidad bandera={peorSenal} formato="pastilla" />
        ) : conSenales ? null : (
          <Severidad score={p.score} formato="pastilla" />
        )}
        <span className="text-[13px] text-mute">
          {conSenales ? (
            <>
              <span className="font-mono font-semibold text-ink">{nSenales}</span>{" "}
              {nSenales === 1 ? "señal de riesgo" : "señales de riesgo"}
            </>
          ) : (
            "ninguna señal de riesgo"
          )}
          {p.score != null && (
            <span className="ml-2">riesgo <span className="font-mono tabular-nums text-ink">{Math.round(p.score)}</span>/100</span>
          )}
        </span>
      </div>

      {senales.length > 0 && (
        <ul className="mt-2 space-y-1">
          {senales.slice(0, 3).map((s, i) => (
            <li key={`${s.regla}-${i}`} className="flex items-start gap-1.5 text-[12px] leading-snug text-inkSoft">
              <span className="mt-0.5 shrink-0">
                <Severidad bandera={s.severidad} formato="punto" />
              </span>
              <span className="min-w-0">
                {reglaLabel(s.regla)}
                {s.norma && <span className="ml-2 text-mute">{s.norma}</span>}
              </span>
            </li>
          ))}
          {senales.length > 3 && (
            <li className="pl-5 text-[12px] text-mute">
              y {senales.length - 3} {senales.length - 3 === 1 ? "señal más" : "señales más"} en el dictamen
            </li>
          )}
        </ul>
      )}

      {enRevision && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-clayTexto">
          <Eye size={13} className="mt-0.5 shrink-0" aria-hidden />
          La autoevaluación no alcanzó el umbral: una persona revisa este dictamen antes de publicarlo.
        </p>
      )}

      {/* Cuánto trabajo costó, con el vocabulario del catálogo: 10 agentes repartidos en 12 pasos. */}
      <p className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line pt-2 text-[12px] text-mute">
        <span>
          <span className="font-mono font-semibold text-inkSoft">{prog.hechas}</span> de{" "}
          <span className="font-mono font-semibold text-inkSoft">{prog.aplicables}</span> pasos
          {duro != null && duro > 0 && <> en {duracion(duro)}</>}
        </span>
        <span>
          lo pagó <span className="font-medium text-inkSoft">{p.financiador}</span>
        </span>
        <span className="font-mono">{p.contribucionCodigo}</span>
      </p>

      {eventos.length > 0 && (
        <div className="mt-2.5">
          <Revelar
            titulo="Cómo se analizó este contrato"
            descripcion={`${p.titulo ?? p.ocid}. ${eventos.length} eventos de bitácora, tal como quedaron guardados.`}
            ancho="lg"
            etiqueta="Repetir el análisis de este contrato, paso por paso"
            detalle={<ReplayAnalisis eventos={eventos} estadoFinal={estado} compacto />}
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paperSoft px-2.5 py-1 text-[12px] font-medium text-ink transition-colors group-hover:border-paperEdge group-hover:bg-paperDeep">
              Repetir el análisis paso por paso
            </span>
          </Revelar>
          <p className="mt-1.5 text-[11px] leading-snug text-mute">
            {TOTAL_AGENTES} agentes en {TOTAL_PASOS} pasos, con los tiempos reales de esta corrida.
          </p>
        </div>
      )}
    </div>
  );
}
