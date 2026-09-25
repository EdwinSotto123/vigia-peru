"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import { FuenteDato } from "@/components/patrones";
import { fecha, porcentaje } from "@/lib/formato";
import { PersonName, Ruc, esPersonaNatural } from "../../Redact";
import { montoDossier } from "../dossier";
import { oeceProcesoUrl } from "../utils";

/**
 * La identidad del contrato, antes de cualquier veredicto (DESIGN_SYSTEM.md §14, "Detalle"):
 * quién compra, quién ganó, cuánto y cuándo. Todo sale del registro OCDS del OECE, y se dice.
 *
 * Los dos montos van rotulados por lo que son: el VALOR REFERENCIAL es lo que la entidad
 * presupuestó (tender.value); el MONTO ADJUDICADO es lo que se le dio al ganador. La
 * diferencia se escribe en palabras y en tinta neutra: pasarse del referencial no es por sí
 * solo una señal, y pintarlo de rojo sin ícono ni palabra lo convertía en una.
 */
export function FichaContrato({
  conv,
  ganador,
  nGanadores = ganador ? 1 : 0,
}: {
  conv: any;
  ganador: any;
  /** Cuántos postores ganaron algo (lotes/ítems adjudicados a distintos proveedores). */
  nGanadores?: number;
}) {
  const referencial = Number(conv.cuantia_total) > 0 ? Number(conv.cuantia_total) : null;
  const adjudicado =
    Number(conv.monto_adjudicado) > 0 ? Number(conv.monto_adjudicado) : Number(ganador?.monto_ganado) > 0 ? Number(ganador.monto_ganado) : null;
  const variacion = adjudicado !== null && referencial !== null ? ((adjudicado - referencial) / referencial) * 100 : null;
  const natural = esPersonaNatural(ganador?.ruc);
  const cuando: { etiqueta: string; valor: string | null } = conv.fecha_buena_pro
    ? { etiqueta: "Buena pro", valor: conv.fecha_buena_pro }
    : conv.fecha_contrato
      ? { etiqueta: "Firma del contrato", valor: conv.fecha_contrato }
      : { etiqueta: "Convocatoria publicada", valor: conv.fecha_publicacion ?? null };

  return (
    <section aria-label="Ficha del contrato" className="rounded-2xl border border-line bg-paper">
      <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
        {/* QUIÉN COMPRA */}
        <div className="p-4 sm:border-b sm:border-r sm:border-line">
          <dt className="text-[12px] font-medium text-mute">Quién compra</dt>
          <dd className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">
            {conv.entidad && conv.buyer_ruc ? (
              <Link
                href={`/entidad/${encodeURIComponent(conv.buyer_ruc)}`}
                className="underline decoration-line underline-offset-2 hover:decoration-granate"
              >
                {conv.entidad}
              </Link>
            ) : (
              conv.entidad || <span className="font-normal text-mute">Sin dato</span>
            )}
          </dd>
          {conv.region && (
            <dd className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-mute">
              <MapPin size={12} aria-hidden /> {conv.region}
            </dd>
          )}
        </div>

        {/* QUIÉN GANÓ */}
        <div className="p-4 sm:border-b sm:border-line">
          <dt className="text-[12px] font-medium text-mute">{natural ? "Quién ganó (persona natural)" : "Quién ganó"}</dt>
          <dd className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">
            {ganador?.nombre ? (
              natural ? <PersonName name={ganador.nombre} orden="sunat" /> : ganador.nombre
            ) : (
              <span className="font-normal text-mute">Sin adjudicación publicada</span>
            )}
          </dd>
          {ganador?.ruc && (
            <dd className="mt-0.5 font-mono text-[12px] text-mute">
              RUC <Ruc value={ganador.ruc} />
            </dd>
          )}
          {nGanadores > 1 && (
            <dd className="mt-0.5 text-[12px] text-mute">
              y {nGanadores - 1} {nGanadores - 1 === 1 ? "ganador más" : "ganadores más"} en otros ítems
            </dd>
          )}
        </div>

        {/* CUÁNTO */}
        <div className="p-4 sm:border-r sm:border-line">
          <dt className="text-[12px] font-medium text-mute">Cuánto</dt>
          <dd className="mt-1 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[12px] text-mute">Valor referencial</div>
              <div className="font-mono text-base font-semibold tabular-nums text-ink">
                {referencial !== null ? montoDossier(referencial) : <span className="font-sans text-sm font-normal text-mute">Sin dato</span>}
              </div>
            </div>
            <div>
              <div className="text-[12px] text-mute">Monto adjudicado</div>
              <div className="font-mono text-base font-semibold tabular-nums text-ink">
                {adjudicado !== null ? montoDossier(adjudicado) : <span className="font-sans text-sm font-normal text-mute">Sin adjudicar</span>}
              </div>
            </div>
          </dd>
          {variacion !== null && (
            <dd className="mt-1 text-[12px] text-inkSoft">
              {Math.abs(variacion) < 0.1
                ? "El adjudicado es igual al referencial."
                : `El adjudicado está ${porcentaje(Math.abs(variacion), { decimales: 1 })} ${variacion > 0 ? "sobre" : "bajo"} el referencial.`}
            </dd>
          )}
        </div>

        {/* CUÁNDO */}
        <div className="p-4">
          <dt className="text-[12px] font-medium text-mute">Cuándo</dt>
          <dd className="mt-0.5 text-[15px] font-semibold text-ink">
            {cuando.valor ? fecha(cuando.valor) : <span className="font-normal text-mute">Sin dato</span>}
          </dd>
          <dd className="text-[12px] text-mute">{cuando.etiqueta}</dd>
          {conv.tipo_proceso && <dd className="mt-1 text-[12px] text-inkSoft">{conv.tipo_proceso}</dd>}
        </div>
      </dl>
      <FuenteDato
        fuente="registro OCDS del OECE"
        href={oeceProcesoUrl(conv.ocid || conv.codigo)}
        className="border-t border-line px-4 py-2"
      />
    </section>
  );
}
