import Link from "next/link";
import { ArrowRight, CalendarClock, ShieldCheck } from "lucide-react";
import { limpiar, nombreRegion, nombreTipo } from "@/lib/licitaciones";
import { tituloNatural } from "@/lib/landing";
import { fechaLargaLima, pct, vencimiento } from "@/lib/licitaciones-app/formato";
import type { DetalleOportunidad } from "@/lib/licitaciones-app/tipos";
import { numero, soles, solesCompacto } from "@/lib/formato";
import { CLASE_ENLACE_PIE, Caja } from "@/components/gobserva/app/Caja";
import { InsigniaSenal, InsigniaVence } from "@/components/gobserva/ui/Insignia";
import type { Pestana } from "./Pestanas";

/**
 * El resumen: qué se compra y los datos del proceso a la izquierda; a la derecha, lo que hay que hacer ya (el próximo
 * plazo), las señales y el comprador en tres cifras, cada bloque con el enlace a su pestaña.
 */
export function PestanaResumen({ o, ahora, href }: { o: DetalleOportunidad; ahora: number; href: (p: Pestana) => string }) {
  const v = vencimiento(o.consultasHasta, ahora);
  const descripcion = limpiar(o.descripcion);
  const c = o.comprador;
  const datos: [string, React.ReactNode][] = [
    ["Código", <span key="c" className="font-mono">{o.codigo ?? o.id}</span>],
    ["Entidad", o.entidad.nombre ? tituloNatural(o.entidad.nombre) : "Sin nombre"],
    ["RUC de la entidad", o.entidad.ruc ? <span key="r" className="font-mono">{o.entidad.ruc}</span> : "Sin dato"],
    ["Lugar", [o.provincia, nombreRegion(o.region)].filter(Boolean).join(", ")],
    ["Tipo", nombreTipo(o.tipo)],
    ["Procedimiento", o.procedimiento ?? "Sin dato"],
    ["Valor referencial", o.valor != null ? soles(o.valor) : "No publicado"],
    ["Publicado", fechaLargaLima(o.publicada)],
    ["Fin de consultas", o.consultasHasta ? fechaLargaLima(o.consultasHasta) : "Sin dato"],
    ["Ítems", numero(o.itemsDetalle.length || o.items)],
  ];

  return (
    <div className="grid items-start gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="grid gap-4 sm:gap-6">
        <Caja id="que" titulo="Qué se compra">
          <p className="max-w-[72ch] text-pretty text-cuerpo leading-relaxed text-ink">{descripcion || limpiar(o.objeto) || "La entidad no publicó una descripción."}</p>
          {o.itemsDetalle.length > 0 && (
            <ul className="mt-4 space-y-1.5 border-t border-line pt-4">
              {/* recorte: los tres primeros; todos, con CUBSO y valor, en la pestaña Ítems. */}
              {o.itemsDetalle.slice(0, 3).map((i) => (
                <li key={i.posicion} className="flex gap-3 text-dato text-inkSoft">
                  <span className="w-6 shrink-0 text-right font-mono text-meta text-mute">{i.posicion}</span>
                  <span className="min-w-0 flex-1 line-clamp-2">{limpiar(i.descripcion) || i.cubsoNombre || "Ítem sin descripción"}</span>
                  {i.valor != null && <span className="shrink-0 font-semibold tabular-nums text-ink">{solesCompacto(i.valor)}</span>}
                </li>
              ))}
            </ul>
          )}
          {o.itemsDetalle.length > 3 && (
            <Link href={href("items")} scroll={false} className={`${CLASE_ENLACE_PIE} mt-3`}>
              Ver los {o.itemsDetalle.length} ítems <ArrowRight size={15} aria-hidden />
            </Link>
          )}
        </Caja>
        <Caja id="datos" titulo="Datos del proceso">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {datos.map(([k, val]) => (
              <div key={k} className="min-w-0 border-b border-line pb-2.5">
                <dt className="text-meta text-mute">{k}</dt>
                <dd className="mt-0.5 text-dato font-medium text-ink [overflow-wrap:anywhere]">{val}</dd>
              </div>
            ))}
          </dl>
        </Caja>
      </div>

      <div className="grid gap-4 sm:gap-6">
        <Caja id="plazo" titulo="Lo próximo">
          <div className="flex items-start gap-3">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink/[0.06] text-inkSoft">
              <CalendarClock size={19} />
            </span>
            <div className="min-w-0">
              <p className="text-dato font-semibold text-ink">
                {v.estado === "sin_dato" ? "La entidad no publicó el fin de consultas" : v.estado === "vencido" ? "Las consultas ya cerraron" : "Fin de consultas y observaciones"}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {v.estado !== "vencido" && <InsigniaVence iso={o.consultasHasta} ahora={ahora} />}
                {o.consultasHasta && <span className="text-meta text-inkSoft">{v.estado === "vencido" ? "Cerraron el " : ""}{fechaLargaLima(o.consultasHasta)}</span>}
              </div>
              <p className="mt-2 text-meta leading-relaxed text-inkSoft">
                {v.estado === "vencido"
                  ? "Lo que sigue (integración de bases, ofertas y buena pro) está en el cronograma oficial."
                  : "Lee las bases y manda tus consultas en el SEACE antes de esa fecha."}
              </p>
              <Link href={href("cronograma")} scroll={false} className={`${CLASE_ENLACE_PIE} mt-2`}>
                Ver el cronograma <ArrowRight size={15} aria-hidden />
              </Link>
            </div>
          </div>
        </Caja>

        <Caja
          id="senales"
          titulo="Señales de riesgo"
          accion={
            <Link href={href("analisis")} scroll={false} className={CLASE_ENLACE_PIE}>
              Análisis
            </Link>
          }
        >
          {o.senales.length === 0 ? (
            <p className="flex items-start gap-2.5 text-dato leading-relaxed text-inkSoft">
              <ShieldCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
              Con lo que sabemos del comprador en 12 meses, nada que marcar.
            </p>
          ) : (
            <ul className="space-y-3">
              {o.senales.map((s) => (
                <li key={s.clave}>
                  <InsigniaSenal senal={s} />
                  <p className="mt-1 text-meta leading-relaxed text-inkSoft">{s.evidencia}</p>
                </li>
              ))}
            </ul>
          )}
        </Caja>

        {c && (
          <Caja id="comprador" titulo="El comprador en 12 meses" descripcion="Adjudicaciones y postores de CONOSCE (OECE)">
            <dl className="grid grid-cols-3 gap-3 text-center">
              <div>
                <dt className="text-meta text-mute">Procesos</dt>
                <dd className="mt-1 font-display text-bloque font-bold tabular-nums text-ink">{numero(c.procesos)}</dd>
              </div>
              <div>
                <dt className="text-meta text-mute">Postores</dt>
                <dd className="mt-1 font-display text-bloque font-bold tabular-nums text-ink">{c.postoresPromedio != null ? c.postoresPromedio.toLocaleString("es-PE", { maximumFractionDigits: 1 }) : "Sin dato"}</dd>
              </div>
              <div>
                <dt className="text-meta text-mute">Un postor</dt>
                <dd className="mt-1 font-display text-bloque font-bold tabular-nums text-ink">{c.conPostores ? pct(c.unSoloPostor / c.conPostores) : "Sin dato"}</dd>
              </div>
            </dl>
          </Caja>
        )}
      </div>
    </div>
  );
}
