"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, CalendarClock, CalendarDays, Coins, KanbanSquare, Sparkles, Target } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { FilaParaTi } from "@/components/licitaciones/ParaTi";
import { rutaEn } from "@/lib/gobserva";
import { PUNTAJE_CALZA, cargarLineas, cargarParaTi, cargarSeguimiento, type Me } from "@/lib/gobserva-cuenta";
import { numero, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { CLASE_ENLACE_PIE, Caja, ESPACIO_CAJAS, VacioCaja } from "../app/Caja";
import type { Seccion } from "./Cuenta";
import { Esqueleto } from "./comun";
import { CajaAvisos, CajaPlan, PagosPorConfirmar, ParaEmpezar } from "./PanelResumen";
import { ABIERTOS, cuando, eventos, fechaHora, rutaItem } from "./plazos";

type Ir = (t: Seccion) => void;

/**
 * Inicio de la app de Licitaciones (2026-11-07). Un tablero sobre el lienzo, todo en cajas:
 *
 *  1. «Para empezar», en una fila, mientras falte algún paso.
 *  2. «Hoy, para tu empresa»: cuatro cifras en una sola caja (lo que calza contigo, lo que cierra esta semana, el valor
 *     en juego y lo que sigues), cada una lleva a su detalle.
 *  3. Dos columnas: a la izquierda lo mejor de «Para ti» (licitaciones o contratos menores); a la derecha tus próximos
 *     plazos, tu plan y lo último que te avisamos. En el celular, una debajo de otra en ese orden.
 */
export function PanelInicio({ base, me, onCambio, irA }: { base: string; me: Me; onCambio: () => void; irA: Ir }) {
  const lineas = useSWR(["gobserva-lineas"], () => cargarLineas(), { revalidateOnFocus: false });
  const [lineaId, setLineaId] = useState<number | null>(null);
  const linea = lineas.data?.data.find((l) => l.id === lineaId) ?? lineas.data?.data[0] ?? null;
  const paraTi = useSWR(linea ? ["gobserva-para-ti", linea.id, linea.actualizada] : null, () => cargarParaTi(linea!.id), { revalidateOnFocus: false });
  const seg = useSWR(["gobserva-seguimiento"], () => cargarSeguimiento(), { revalidateOnFocus: true });
  const [fuente, setFuente] = useState<"proceso" | "menor">("proceso");

  const items = seg.data?.data ?? [];
  const abiertos = items.filter((i) => ABIERTOS.has(i.estado));
  const presentadas = items.filter((i) => i.estado === "presentada").length;
  const proximos = eventos(abiertos).filter((e) => !cuando(e.plazo.fecha).paso).slice(0, 5);
  const r = paraTi.data?.resumen;
  const mejores = (paraTi.data?.data ?? []).filter((o) => o.fuente === fuente).slice(0, 5);
  const variasLineas = (lineas.data?.data.length ?? 0) > 1;

  return (
    <div className={cn("grid", ESPACIO_CAJAS)}>
      <ParaEmpezar producto="licitaciones" base={base} me={me} onCambio={onCambio} irA={irA} />
      <PagosPorConfirmar producto="licitaciones" me={me} onCambio={onCambio} />

      {/* Las cifras del día: cada una lleva a donde está el detalle. */}
      {lineas.isLoading ? (
        <Esqueleto className="h-44" />
      ) : !linea ? (
        <Caja id="hoy" titulo="Hoy, para tu empresa">
          <VacioCaja
            Icono={Target}
            titulo="Dinos qué vende tu empresa"
            texto="Con eso te mostramos aquí cuántas oportunidades calzan contigo, cuáles cierran esta semana y cuánto hay en juego."
            accion={
              <Link href={rutaEn(base, "/app/bienvenida")} className={claseAccion("primario")}>
                <Sparkles size={15} aria-hidden /> Armar mi perfil (2 minutos)
              </Link>
            }
          />
        </Caja>
      ) : (
        <Caja
          id="hoy"
          titulo="Hoy, para tu empresa"
          descripcion={variasLineas ? undefined : `Según tu línea «${linea.nombre}»`}
          accion={
            variasLineas ? (
              <label className="flex items-center gap-2 text-meta text-inkSoft">
                Línea
                <select
                  value={linea.id}
                  onChange={(e) => setLineaId(Number(e.target.value))}
                  className="min-h-9 rounded-lg border border-line bg-caja px-2.5 text-dato font-semibold text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30"
                >
                  {lineas.data!.data.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </select>
              </label>
            ) : (
              <button type="button" onClick={() => irA("para-ti")} className={CLASE_ENLACE_PIE}>Editar tu línea</button>
            )
          }
          relleno={false}
        >
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-2xl bg-line lg:grid-cols-4">
            <Cifra
              Icono={Target}
              etiqueta="Calzan contigo"
              valor={r ? numero(r.calzan) : null}
              detalle={r ? `Con ${PUNTAJE_CALZA} o más de parecido: ${numero(r.procesos)} ${r.procesos === 1 ? "licitación" : "licitaciones"} y ${numero(r.menores)} ${r.menores === 1 ? "contrato menor" : "contratos menores"}` : ""}
              onClick={() => irA("para-ti")}
            />
            <Cifra
              Icono={CalendarClock}
              etiqueta="Cierran esta semana"
              valor={r ? numero(r.cierranSemana) : null}
              detalle="Consultas o cotización en 7 días"
              urgente={!!r && r.cierranSemana > 0}
              onClick={() => irA("para-ti")}
            />
            <Cifra
              Icono={Coins}
              etiqueta="En juego"
              valor={r ? (r.valorEnJuego > 0 ? solesCompacto(r.valorEnJuego) : "Sin dato") : null}
              detalle={r && r.valorEnJuego === 0 ? "Lo que calza no publicó su valor referencial" : "Valor referencial de lo que calza"}
              onClick={() => irA("para-ti")}
            />
            <Cifra
              Icono={KanbanSquare}
              etiqueta="En seguimiento"
              valor={seg.data ? numero(abiertos.length) : null}
              detalle={seg.data ? `${numero(presentadas)} ${presentadas === 1 ? "oferta presentada" : "ofertas presentadas"}` : ""}
              onClick={() => irA("seguimiento")}
            />
          </div>
        </Caja>
      )}

      {linea && (
        <div className={cn("grid items-start", ESPACIO_CAJAS, "xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]")}>
          {/* Lo mejor de «Para ti», en dos pestañas. */}
          <Caja
            id="mejor"
            titulo="Lo mejor para ti hoy"
            descripcion="De lo más parecido a lo que vendes a lo menos"
            accion={
              <div role="tablist" aria-label="Qué mostrar" className="inline-grid grid-cols-2 gap-1 rounded-lg bg-ink/[0.06] p-1">
                {(
                  [
                    { f: "proceso", etiqueta: "Licitaciones" },
                    { f: "menor", etiqueta: "Contratos menores" },
                  ] as const
                ).map(({ f, etiqueta }) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={fuente === f}
                    onClick={() => setFuente(f)}
                    className={cn(
                      "min-h-8 whitespace-nowrap rounded-md px-3 text-meta font-semibold transition-colors duration-rapido",
                      fuente === f ? "bg-caja text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink",
                    )}
                  >
                    {etiqueta}
                  </button>
                ))}
              </div>
            }
            relleno={false}
            pie={
              <button type="button" onClick={() => irA("para-ti")} className={CLASE_ENLACE_PIE}>
                Ver todo en «Para ti» <ArrowRight size={15} aria-hidden />
              </button>
            }
          >
            {paraTi.isLoading ? (
              <div aria-hidden className="space-y-3 p-4 sm:p-5">
                <Esqueleto className="h-20" />
                <Esqueleto className="h-20" />
                <Esqueleto className="h-20" />
              </div>
            ) : mejores.length === 0 ? (
              <VacioCaja
                Icono={Sparkles}
                titulo={fuente === "menor" ? "Sin contratos menores parecidos ahora" : "Sin licitaciones parecidas ahora"}
                texto={
                  fuente === "menor"
                    ? "Se publican nuevos cada hora: vuelve más tarde o suma palabras a tu línea."
                    : "Prueba con otras palabras en tu línea de negocio."
                }
              />
            ) : (
              <ol className="divide-y divide-line">
                {mejores.map((o) => (
                  <li key={`${o.fuente}-${o.id}`} className="min-w-0">
                    <FilaParaTi o={o} base={base} />
                  </li>
                ))}
              </ol>
            )}
          </Caja>

          <div className={cn("grid content-start", ESPACIO_CAJAS)}>
            {/* Los próximos plazos de lo que sigues. */}
            <Caja
              id="plazos"
              titulo="Tus próximos plazos"
              accion={<button type="button" onClick={() => irA("calendario")} className={CLASE_ENLACE_PIE}>Calendario</button>}
              relleno={false}
            >
              {seg.isLoading ? (
                <div aria-hidden className="space-y-3 p-4 sm:p-5">
                  <Esqueleto className="h-12" />
                  <Esqueleto className="h-12" />
                </div>
              ) : proximos.length === 0 ? (
                <VacioCaja
                  Icono={CalendarDays}
                  titulo={abiertos.length ? "Nada por vencer" : "Todavía no sigues nada"}
                  texto={
                    abiertos.length
                      ? "Lo que sigues no tiene plazos por venir."
                      : "Guarda licitaciones o contratos menores y aquí verás sus plazos: consultas, cierres y buena pro."
                  }
                />
              ) : (
                <ol className="divide-y divide-line">
                  {proximos.map(({ item, plazo }) => {
                    const c = cuando(plazo.fecha);
                    return (
                      <li key={`${item.tipo}-${item.ref}-${plazo.clave}`}>
                        <Link href={rutaEn(base, rutaItem(item))} className="flex gap-3 px-4 py-3 transition-colors duration-rapido hover:bg-ink/[0.035] sm:px-5">
                          <span
                            className={cn(
                              "mt-0.5 inline-flex h-6 shrink-0 items-center rounded-md px-2 text-rotulo font-bold tabular-nums",
                              c.urgente ? "bg-crimson-soft text-crimsonTexto" : "bg-ink/[0.06] text-ink",
                            )}
                          >
                            {c.texto}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-meta text-inkSoft">{plazo.etiqueta}, {fechaHora(plazo.fecha)}</span>
                            <span className="mt-0.5 line-clamp-2 block text-dato font-semibold leading-snug text-ink">{item.titulo || "Sin descripción registrada"}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Caja>
            <CajaPlan producto="licitaciones" base={base} me={me} irA={irA} angosta />
            <CajaAvisos producto="licitaciones" me={me} irA={irA} />
          </div>
        </div>
      )}

      {/* Sin línea todavía: el plan y los avisos, igual que en el resumen. */}
      {!linea && !lineas.isLoading && (
        <div className={cn("grid", ESPACIO_CAJAS, "xl:grid-cols-2")}>
          <CajaPlan producto="licitaciones" base={base} me={me} irA={irA} />
          <CajaAvisos producto="licitaciones" me={me} irA={irA} />
        </div>
      )}
    </div>
  );
}

/** Una cifra del día dentro de la caja: el rótulo con su ícono, el número y de qué se compone. Lleva a su detalle. */
function Cifra({
  Icono, valor, etiqueta, detalle, onClick, urgente = false,
}: {
  Icono: typeof Target;
  valor: string | null;
  etiqueta: string;
  detalle: string;
  onClick: () => void;
  urgente?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 flex-col bg-caja p-4 text-left transition-colors duration-rapido hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:p-5"
    >
      <span className="flex items-center gap-2 text-meta font-semibold text-inkSoft">
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-granate-50 text-granate group-hover:bg-caja">
          <Icono size={15} />
        </span>
        {etiqueta}
      </span>
      {valor == null ? (
        <span aria-hidden className="mt-3 block h-8 w-16 animate-pulse rounded-lg bg-paperDeep" />
      ) : (
        <span className={cn("mt-3 block font-display text-cifra font-bold leading-none tabular-nums", urgente ? "text-crimsonTexto" : "text-ink")}>{valor}</span>
      )}
      <span className="mt-1.5 block text-meta leading-snug text-mute">{detalle}</span>
    </button>
  );
}
