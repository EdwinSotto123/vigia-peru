"use client";

import Link from "next/link";
import { ArrowDown, Award, Clock, Info, ListOrdered, Scale } from "lucide-react";
import { colorSerie } from "@/components/charts/BarraSegmentada";
import { EnUnaFrase } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { Partes } from "@/components/ui/Partes";
import { decimal, numero, oracion, plural, porcentaje, soles } from "@/lib/formato";
import { rutaContrato } from "@/lib/rutas";
import type { EvaluacionLeida, PostorContrato } from "@/lib/contratos";
import { NombreProveedor } from "./QuienGano";
import { ENLACE_RELATO } from "./PorQueLlama";

/**
 * Lo que la página del contrato le pasa al dictamen para el capítulo «Postores y ofertas» (relato-postores): los postores
 * de su ficha (con lo que el acta o cuadro de evaluación leído por pieza agrega: admisión, calificación y su motivo,
 * puntajes, bonificación y hora de la oferta) y la evaluación (factores y si la oferta más baja perdió). Datos planos.
 */
export interface PostoresDelContrato {
  ocid: string;
  moneda: string | null;
  postores: PostorContrato[];
  evaluacion: EvaluacionLeida | null;
  /** La ficha tiene la pestaña «Lo que pedían las bases» (perfil del contratista). */
  conPerfil: boolean;
  /** Cuántos renglones de lo que se compró trae la ficha (bases y contrato leídos por pieza); 0 si ninguno. */
  renglones?: number;
}

/** Presentó oferta: tiene monto o puntaje. Los demás son participantes que se registraron y no ofertaron. */
export const conOferta = (p: PostorContrato) => p.montoOferta != null || p.puntajeFinal != null || p.puntaje != null;

const puntos = (n: number | null | undefined) => (n == null ? null : `${decimal(n, 2)} ${n === 1 ? "punto" : "puntos"}`);

/** El monto en su moneda: soles salvo que el registro diga otra. */
const monto = (n: number | null | undefined, moneda: string | null) =>
  n == null ? null : moneda && moneda !== "PEN" ? `${moneda} ${numero(n)}` : soles(n);

/** El ganador primero; después por orden de prelación, puntaje final y oferta. */
function ordenar(ps: PostorContrato[]): PostorContrato[] {
  const final = (p: PostorContrato) => p.puntajeFinal ?? p.puntaje ?? null;
  return [...ps].sort(
    (a, b) =>
      Number(b.esGanador) - Number(a.esGanador) ||
      (a.ordenPrelacion ?? 99) - (b.ordenPrelacion ?? 99) ||
      (final(b) ?? -1) - (final(a) ?? -1) ||
      (a.montoOferta ?? Infinity) - (b.montoOferta ?? Infinity),
  );
}

/** En qué quedó la oferta: no admitida o no calificada con su motivo; si el acta no lo dice, el estado del registro. */
function enQueQuedo(p: PostorContrato): string | null {
  if (p.esGanador) return null;
  if (p.admitida === false) return `No se admitió${p.motivoNoAdmitida ? `: ${p.motivoNoAdmitida}` : ""}`;
  if (p.calificada === false) return `No calificó${p.motivoNoCalificada ? `: ${p.motivoNoCalificada}` : ""}`;
  if (p.motivoEstado) return oracion(p.motivoEstado);
  if (p.admitida && p.calificada) return "Admitida y calificada";
  return null;
}

/** «precio 35.26 + otros 60 + bonificación 4.76»: de dónde sale el puntaje final, si el acta lo desglosa. */
function desglose(p: PostorContrato): string | null {
  const partes = [
    p.puntajePrecio != null ? `precio ${decimal(p.puntajePrecio, 2)}` : null,
    p.puntajeOtros != null ? `otros factores ${decimal(p.puntajeOtros, 2)}` : null,
    p.bonificacion != null ? `bonificación ${decimal(p.bonificacion, 2)}` : null,
  ].filter(Boolean);
  return partes.length > 1 || (partes.length === 1 && p.bonificacion != null) ? partes.join(" + ") : null;
}

/** Las partes del puntaje final, en el orden en que se suman, con su color de serie. */
function partesPuntaje(p: PostorContrato): { clave: string; valor: number; color: string }[] {
  const final = p.puntajeFinal ?? p.puntaje ?? null;
  if (final == null) return [];
  const precio = p.puntajePrecio ?? null;
  const bono = p.bonificacion ?? null;
  const otros = p.puntajeOtros ?? (precio != null ? Math.max(0, final - precio - (bono ?? 0)) : null);
  if (precio == null) return [{ clave: "final", valor: final, color: colorSerie(0) }];
  return [
    { clave: "precio", valor: precio, color: colorSerie(0) },
    ...(otros ? [{ clave: "otros", valor: otros, color: colorSerie(1) }] : []),
    ...(bono ? [{ clave: "bono", valor: bono, color: colorSerie(2) }] : []),
  ];
}

/**
 * Las dos barras de cada oferta: el monto contra la oferta más alta y el puntaje partido en lo que lo forma (precio,
 * demás factores y bonificación) contra el puntaje más alto. Decorativas (aria-hidden): las cifras están al lado.
 */
function Barras({ p, maxMonto, maxPuntos }: { p: PostorContrato; maxMonto: number; maxPuntos: number }) {
  const partes = partesPuntaje(p);
  if (p.montoOferta == null && !partes.length) return null;
  return (
    <div className="mt-2.5 grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5" aria-hidden>
      {p.montoOferta != null && maxMonto > 0 && (
        <>
          <span className="text-rotulo text-mute">Oferta</span>
          <span className="h-2 overflow-hidden rounded-full bg-paperDeep">
            {/* El ganador en granate (el acento que ya lo marca); los demás en gris: el azul es el «precio» del puntaje. */}
            <span
              className={p.esGanador ? "block h-full rounded-full bg-granate" : "block h-full rounded-full"}
              style={{ width: `${Math.max(2, (100 * p.montoOferta) / maxMonto)}%`, ...(p.esGanador ? {} : { background: "rgb(var(--serie-otros))" }) }}
            />
          </span>
        </>
      )}
      {partes.length > 0 && maxPuntos > 0 && (
        <>
          <span className="text-rotulo text-mute">Puntaje</span>
          <span className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-paperDeep">
            {partes.map((x) => (
              <span key={x.clave} className="block h-full min-w-[2px]" style={{ width: `${(100 * x.valor) / maxPuntos}%`, background: x.color }} />
            ))}
          </span>
        </>
      )}
    </div>
  );
}

export function PostoresOfertas({ datos }: { datos: PostoresDelContrato }) {
  const { ocid, moneda, evaluacion } = datos;
  const ofertas = ordenar(datos.postores.filter(conOferta));
  const sinOferta = datos.postores.length - ofertas.length;
  const ganador = ofertas.find((p) => p.esGanador) ?? null;
  const m = evaluacion?.masBajaPerdio ?? null;
  const factores = (evaluacion?.factores ?? []).filter((f) => f.factor);
  const maxMonto = Math.max(0, ...ofertas.map((p) => p.montoOferta ?? 0));
  const maxPuntos = Math.max(0, ...ofertas.map((p) => partesPuntaje(p).reduce((s, x) => s + x.valor, 0)));
  const admitidas = ofertas.filter((p) => p.montoOferta != null && p.admitida !== false);
  const masBaja = admitidas.length > 1 ? admitidas.reduce((a, b) => (b.montoOferta! < a.montoOferta! ? b : a)) : null;
  const conDesglose = ofertas.some((p) => p.puntajePrecio != null);
  // «… S.R.L.» ya cierra con punto cuando no sigue el monto.
  const cierra = ganador?.razonSocial && ganador.montoOferta == null && /\.$/.test(ganador.razonSocial.trim()) ? "" : ".";

  return (
    <div className="space-y-4">
      <EnUnaFrase
        datos={
          m ? (
            <p className="text-meta leading-relaxed text-inkSoft">
              La oferta más baja, de <NombreProveedor nombre={m.masBaja.nombre ?? "un postor"} ruc={m.masBaja.ruc} />, fue de{" "}
              <strong className="font-semibold text-ink">{monto(m.masBaja.monto, moneda)}</strong>
              {m.masBaja.puntajeFinal != null && <> con {puntos(m.masBaja.puntajeFinal)}</>}, y no ganó: la buena pro fue a una oferta{" "}
              <strong className="font-semibold text-ink">{porcentaje(m.diferenciaPct, { decimales: 1 })} más cara</strong> (
              {monto(m.diferenciaSoles, moneda)} más)
              {m.ganador.puntajeFinal != null && <>, que sumó {puntos(m.ganador.puntajeFinal)}</>}
              {m.ganador.bonificacion != null && <> con {puntos(m.ganador.bonificacion)} de bonificación</>}. Una bonificación que
              dan las bases (por ejemplo, la de 5 % a la micro y pequeña empresa) es legal: explica el resultado, no lo vuelve
              irregular.
            </p>
          ) : undefined
        }
      >
        {plural(ofertas.length, "postor presentó oferta", "postores presentaron oferta")}
        {ganador?.razonSocial ? (
          <>
            {" "}y ganó <NombreProveedor nombre={ganador.razonSocial} ruc={ganador.ruc} />
            {ganador.montoOferta != null && <> con {monto(ganador.montoOferta, moneda)}</>}
          </>
        ) : null}
        {cierra}
      </EnUnaFrase>

      {conDesglose && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-rotulo text-mute" aria-hidden>
          <span>Cómo se forma el puntaje:</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorSerie(0) }} />precio</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorSerie(1) }} />demás factores</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorSerie(2) }} />bonificación</span>
        </p>
      )}

      <ul className="space-y-2" aria-label="Postores que presentaron oferta">
        {ofertas.map((p, i) => {
          const quedo = enQueQuedo(p);
          const d = desglose(p);
          const final = p.puntajeFinal ?? p.puntaje ?? null;
          return (
            <li
              key={`postor-${i}`}
              className={p.esGanador ? "rounded-xl border border-granate/40 bg-paper px-4 py-3" : "rounded-xl border border-line bg-paper px-4 py-3"}
            >
              {/* En el celular se apila (el monto y el desglose no dejaban ancho al nombre); desde sm, dos columnas. */}
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-x-4">
                <div className="min-w-0 flex-1">
                  <p className="text-dato font-semibold text-ink">
                    {p.razonSocial ? <NombreProveedor nombre={p.razonSocial} ruc={p.ruc} /> : "Postor sin nombre en el acta"}
                  </p>
                  <p className="mt-0.5 text-meta text-inkSoft">
                    <Partes
                      partes={[
                        p.esGanador && <Dato key="g" icono={Award} nombre="Resultado">Ganó la buena pro</Dato>,
                        p === masBaja && <Dato key="b" icono={ArrowDown} nombre="Oferta">La oferta más baja</Dato>,
                        p.ordenPrelacion != null && <Dato key="o" icono={ListOrdered} nombre="Orden de prelación">Puesto {p.ordenPrelacion}</Dato>,
                        p.horaOferta && (
                          <Dato key="h" icono={Clock} nombre="Hora de la oferta">
                            Ofertó a las {p.horaOferta.slice(0, 5)}
                          </Dato>
                        ),
                      ]}
                    />
                  </p>
                  {quedo && (
                    <p className="mt-1 flex items-start gap-1.5 text-meta leading-snug text-inkSoft">
                      <Info size={14} className="mt-0.5 shrink-0 text-mute" aria-hidden />
                      <span className="min-w-0 break-words">{quedo}</span>
                    </p>
                  )}
                </div>
                <div className="shrink-0 sm:max-w-[45%] sm:text-right">
                  {p.montoOferta != null && <p className="font-mono text-dato tabular-nums text-ink">{monto(p.montoOferta, moneda)}</p>}
                  {final != null && <p className="text-meta tabular-nums text-inkSoft">{puntos(final)}</p>}
                  {d && <p className="text-rotulo tabular-nums text-mute">{d}</p>}
                </div>
              </div>
              <Barras p={p} maxMonto={maxMonto} maxPuntos={maxPuntos} />
            </li>
          );
        })}
      </ul>

      {sinOferta > 0 && (
        <p className="text-meta text-inkSoft">
          Además, {plural(sinOferta, "participante se registró", "participantes se registraron")} y no presentó oferta.
        </p>
      )}

      {factores.length > 0 && (
        <section aria-label="Cómo se evaluó" className="rounded-xl border border-line bg-paper px-4 py-3">
          <h3 className="flex items-center gap-1.5 font-display text-bloque font-bold text-ink">
            <Scale size={15} className="text-mute" aria-hidden />
            Cómo se evaluó
          </h3>
          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {factores.map((f, i) => (
              <li key={`factor-${i}`} className="flex items-baseline justify-between gap-3 text-meta text-inkSoft">
                <span className="min-w-0 break-words">{f.factor}</span>
                {f.puntajeMaximo != null && <span className="shrink-0 tabular-nums text-ink">{puntos(f.puntajeMaximo)}</span>}
              </li>
            ))}
          </ul>
          {evaluacion?.documento && <p className="mt-2 text-rotulo text-mute">Leído de: {evaluacion.documento}.</p>}
        </section>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href={rutaContrato(ocid, "ficha", { seccion: "postores" })} prefetch={false} className={ENLACE_RELATO}>
          La tabla completa de postores en la ficha
        </Link>
        {datos.conPerfil && (
          <Link href={rutaContrato(ocid, "ficha", { seccion: "perfil" })} prefetch={false} className={ENLACE_RELATO}>
            Lo que pedían las bases
          </Link>
        )}
      </div>
    </div>
  );
}
