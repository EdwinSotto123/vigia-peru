"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, CalendarClock, CalendarDays, Coins, KanbanSquare, Sparkles, Target } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { FilaParaTi } from "@/components/licitaciones/ParaTi";
import { rutaEn } from "@/lib/gobserva";
import { cargarLineas, cargarParaTi, cargarSeguimiento, type Me } from "@/lib/gobserva-cuenta";
import { numero, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";
import type { Seccion } from "./Cuenta";
import { Esqueleto } from "./comun";
import { ParaEmpezar, PanelResumen, TituloSeccion } from "./PanelResumen";
import { ABIERTOS, cuando, eventos, fechaHora, rutaItem } from "./plazos";

type Ir = (t: Seccion) => void;

/**
 * Inicio de la app de Licitaciones (2026-11-07, al estilo del tablero de LicitaLAB): lo que falta para empezar, cuatro
 * cifras que se tocan (lo que calza contigo, lo que cierra esta semana, el valor en juego y lo que sigues), lo mejor de
 * «Para ti» en dos pestañas (licitaciones y contratos menores), los próximos plazos de lo que sigues y, abajo, el plan y
 * lo último que te avisamos (PanelResumen).
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
  const proximos = eventos(abiertos).filter((e) => !cuando(e.plazo.fecha).paso).slice(0, 6);
  const r = paraTi.data?.resumen;
  const mejores = (paraTi.data?.data ?? []).filter((o) => o.fuente === fuente).slice(0, 5);

  return (
    <div className="space-y-10">
      <ParaEmpezar producto="licitaciones" base={base} me={me} onCambio={onCambio} irA={irA} />

      {/* Las cifras del día: cada una lleva a donde está el detalle. */}
      {lineas.isLoading ? (
        <Esqueleto className="h-32" />
      ) : !linea ? (
        <section className="flex flex-col items-start gap-4 rounded-2xl border border-granate/30 bg-granate-50 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <h2 className="font-display text-bloque font-bold leading-tight text-ink">Dinos qué vende tu empresa</h2>
            <p className="mt-1 max-w-[60ch] text-dato leading-relaxed text-inkSoft">
              Con eso te mostramos aquí cuántas oportunidades calzan contigo, cuáles cierran esta semana y cuánto hay en juego.
            </p>
          </div>
          <button type="button" onClick={() => irA("para-ti")} className={claseAccion("primario", "shrink-0", "md")}>
            <Sparkles size={16} aria-hidden /> Armar mi «Para ti»
          </button>
        </section>
      ) : (
        <section aria-labelledby="hoy-t">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <h2 id="hoy-t" className="font-display text-bloque font-bold leading-tight text-ink">Hoy, para tu empresa</h2>
            {(lineas.data?.data.length ?? 0) > 1 ? (
              <label className="flex items-center gap-2 text-meta text-inkSoft">
                Línea
                <select
                  value={linea.id}
                  onChange={(e) => setLineaId(Number(e.target.value))}
                  className="min-h-10 rounded-full border border-line bg-paper px-3 text-dato font-semibold text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30"
                >
                  {lineas.data!.data.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </select>
              </label>
            ) : (
              <p className="text-meta text-inkSoft">Según tu línea «{linea.nombre}»</p>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra
              Icono={Target}
              valor={r ? numero(r.calzan) : null}
              etiqueta="calzan contigo"
              detalle={r ? `${numero(r.procesos)} ${r.procesos === 1 ? "licitación" : "licitaciones"} y ${numero(r.menores)} ${r.menores === 1 ? "contrato menor" : "contratos menores"}` : ""}
              onClick={() => irA("para-ti")}
              destacada
            />
            <Cifra Icono={CalendarClock} valor={r ? numero(r.cierranSemana) : null} etiqueta="cierran esta semana" detalle="Consultas o cotización en 7 días" onClick={() => irA("para-ti")} />
            <Cifra
              Icono={Coins}
              valor={r ? (r.valorEnJuego > 0 ? solesCompacto(r.valorEnJuego) : "S/ 0") : null}
              etiqueta="en juego"
              detalle="Valor referencial de las licitaciones que calzan"
              onClick={() => irA("para-ti")}
            />
            <Cifra
              Icono={KanbanSquare}
              valor={seg.data ? numero(abiertos.length) : null}
              etiqueta="en seguimiento"
              detalle={seg.data ? `${numero(presentadas)} ${presentadas === 1 ? "oferta presentada" : "ofertas presentadas"}` : ""}
              onClick={() => irA("seguimiento")}
            />
          </div>
        </section>
      )}

      {linea && (
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:gap-8">
          {/* Lo mejor de «Para ti», en dos pestañas. */}
          <section aria-labelledby="mejor-t" className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <h2 id="mejor-t" className="font-display text-bloque font-bold leading-tight text-ink">Lo mejor para ti hoy</h2>
              <div role="tablist" aria-label="Qué mostrar" className="inline-grid grid-cols-2 gap-1 rounded-full bg-paperDeep p-1">
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
                      "min-h-9 whitespace-nowrap rounded-full px-3.5 text-meta font-semibold transition-colors duration-rapido",
                      fuente === f ? "bg-paper text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink",
                    )}
                  >
                    {etiqueta}
                  </button>
                ))}
              </div>
            </div>
            {paraTi.isLoading ? (
              <Esqueleto className="mt-4 h-72" />
            ) : mejores.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-dashed border-line p-5 text-dato leading-relaxed text-inkSoft">
                {fuente === "menor"
                  ? "Ahora no hay contratos menores abiertos parecidos a lo que vendes. Se publican nuevos cada hora."
                  : "Ahora no hay licitaciones abiertas parecidas a lo que vendes. Prueba con otras palabras en tu línea."}
              </p>
            ) : (
              <ol className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
                {mejores.map((o) => (
                  <li key={`${o.fuente}-${o.id}`} className="min-w-0">
                    <FilaParaTi o={o} base={base} />
                  </li>
                ))}
              </ol>
            )}
            <button type="button" onClick={() => irA("para-ti")} className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-dato font-semibold text-granate underline-offset-4 hover:underline">
              Ver todo en «Para ti» <ArrowRight size={15} aria-hidden />
            </button>
          </section>

          {/* Los próximos plazos de lo que sigues. */}
          <section aria-labelledby="plazos-t" className="min-w-0">
            <TituloSeccion id="plazos-t" titulo="Tus próximos plazos" accion={{ etiqueta: "Calendario", onClick: () => irA("calendario") }} />
            {seg.isLoading ? (
              <Esqueleto className="mt-4 h-60" />
            ) : proximos.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-line p-5">
                <p className="flex items-start gap-3 text-dato leading-relaxed text-inkSoft">
                  <CalendarDays size={20} aria-hidden className="mt-0.5 shrink-0 text-mute" />
                  {abiertos.length ? "Lo que sigues no tiene plazos por venir." : "Guarda licitaciones o contratos menores y aquí verás sus plazos: consultas, cierres y buena pro."}
                </p>
              </div>
            ) : (
              <ol className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
                {proximos.map(({ item, plazo }) => {
                  const c = cuando(plazo.fecha);
                  return (
                    <li key={`${item.tipo}-${item.ref}-${plazo.clave}`}>
                      <Link href={rutaEn(base, rutaItem(item))} className="flex gap-3 px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft">
                        <span className={cn("mt-0.5 w-20 shrink-0 text-meta font-bold", c.urgente ? "text-crimsonTexto" : "text-ink")}>{c.texto}</span>
                        <span className="min-w-0">
                          <span className="block text-meta font-semibold text-inkSoft">{plazo.etiqueta}, {fechaHora(plazo.fecha)}</span>
                          <span className="mt-0.5 line-clamp-2 block text-dato font-semibold leading-snug text-ink">{item.titulo || "Sin descripción registrada"}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      )}

      {/* El plan y lo último que te avisamos (lo de siempre del resumen, sin repetir «Para empezar»). */}
      <PanelResumen producto="licitaciones" base={base} me={me} onCambio={onCambio} irA={irA} sinPasos />
    </div>
  );
}

function Cifra({
  Icono, valor, etiqueta, detalle, onClick, destacada = false,
}: {
  Icono: typeof Target;
  valor: string | null;
  etiqueta: string;
  detalle: string;
  onClick: () => void;
  destacada?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex min-w-0 flex-col rounded-2xl border p-4 text-left transition-colors duration-rapido sm:p-5",
        destacada ? "border-granate/40 bg-granate-50 hover:border-granate" : "border-line bg-paper hover:border-granate/40 hover:bg-paperSoft",
      )}
    >
      <Icono size={18} aria-hidden className="text-granate" />
      {valor == null ? (
        <span aria-hidden className="mt-3 block h-8 w-16 animate-pulse rounded-lg bg-paperDeep" />
      ) : (
        <span className="mt-3 block font-display text-seccion font-bold leading-none tabular-nums text-ink sm:text-cifra">{valor}</span>
      )}
      <span className="mt-1.5 block text-dato font-semibold text-ink">{etiqueta}</span>
      <span className="mt-0.5 block text-meta leading-snug text-inkSoft">{detalle}</span>
    </button>
  );
}
