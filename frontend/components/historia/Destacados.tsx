"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Link2, LocateFixed, SearchX, TrendingUp } from "lucide-react";
import { irAPestana } from "@/components/patrones/Pestanas";
import { Paginacion } from "@/components/ui/Paginacion";
import { ICONO_NIVEL, Severidad } from "@/components/ui/Severidad";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { fechaConAnio, numero, plural, solesCompacto } from "@/lib/formato";
import { mesLargo, normalDeSerie, type Historia, type SeveridadHistoria } from "@/lib/historia";
import { cifrasDe, clasesDe, enPeriodo, hallazgosDe, nombreDeClase, omitidosDe, periodosDe, type ClaseHallazgo, type Hallazgo } from "@/lib/historiaGrave";
import { cn } from "@/lib/utils";
import { DetalleHecho } from "./DetalleHecho";
import { TextoPaso } from "./TextoPaso";

/** Lo que pide «Verlo en la línea» a la línea de tiempo de la misma historia (`clave`): un hecho, un patrón o una secuencia. */
export const VER_EN_LINEA = "vigia:historia-ver";
/** Lo que avisa la línea de tiempo cuando cambia lo elegido, o `null` al cerrarlo. */
export const ELEGIDO_EN_LINEA = "vigia:historia-elegido";
export type PedidoLinea = { clave: string; tipo: "patron" | "secuencia" | "evento"; id: string };
export type ElegidoLinea = { clave: string; id: string | null };

/** El id del lienzo de una historia en la página (para saber si su pestaña ya está montada). */
export const idLinea = (clave: string) => `linea-${clave.replace(/[^a-zA-Z0-9]/g, "-")}`;

const TAM = 7;
const COLOR: Record<SeveridadHistoria, string> = { alta: "text-crimsonTexto", media: "text-amberTexto", baja: "text-mute" };
const PALABRA: Record<SeveridadHistoria, string> = { alta: "Señal alta", media: "Señal media", baja: "Señal baja" };
const CHIP =
  "inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-meta transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate disabled:cursor-not-allowed disabled:opacity-45";
const CAJA =
  "relative inline-flex h-9 min-w-0 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-paper pl-3 pr-2.5 text-meta text-ink transition-colors duration-rapido has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-granate";

/**
 * «Lo más grave» de una historia: la primera forma de verla (pedido del usuario del 2026-11-18: «sólo muestra cosas
 * irrelevantes como visitas… scrolleamos y hay secciones de texto y no lo que hemos dicho de tenerlo ordenado, sin scroll
 * infinito… filtros»). Antes, «Lo que llama la atención» iba apilado sobre la línea y sólo traía las secuencias y los
 * meses fuera de lo normal: en la Marina de Guerra eran ocho picos de visitas y de planilla, y sus 120 contratos con
 * banderas y sus informes de control no aparecían.
 *
 * Ahora es una pestaña (la línea de tiempo es la siguiente) con todo lo que tiene gravedad en UNA lista:
 *  - Arriba, las cifras del periodo (los totales reales de sus series: contratos con banderas, informes, procesos, órdenes),
 *    cada una con el enlace a su lista entera.
 *  - Los filtros: la clase de hecho (los renglones de la línea, con su conteo), la gestión (o el año) y «sólo señal alta».
 *  - Lista y detalle: a la izquierda, siete por página, lo más grave primero y una clase por vuelta; a la derecha, el
 *    elegido entero (el mismo detalle que en la línea), con su fuente, su enlace y «Verlo en la línea». En el celular el
 *    detalle se abre bajo su fila.
 */
export function Destacados({ clave, h }: { clave: string; h: Historia }) {
  const todos = useMemo(() => hallazgosDe(h), [h]);
  const periodos = useMemo(() => periodosDe(h, todos), [h, todos]);
  const [clase, setClase] = useState<ClaseHallazgo | "">("");
  const [periodo, setPeriodo] = useState("");
  const [soloAlta, setSoloAlta] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [activo, setActivo] = useState<string | null>(null);

  const p = periodos.opciones.find((x) => x.clave === periodo) ?? null;
  // Cada chip cuenta sobre los otros filtros (el periodo y la gravedad): dice cuántos quedarían al elegirlo.
  const porLoDemas = todos.filter((x) => enPeriodo(x, p) && (!soloAlta || x.severidad === "alta"));
  const clases = clasesDe(h, todos, porLoDemas);
  const vistos = clase ? porLoDemas.filter((x) => x.clase === clase) : porLoDemas;
  const paginas = Math.max(1, Math.ceil(vistos.length / TAM));
  const pag = Math.min(pagina, paginas);
  const enPagina = vistos.slice((pag - 1) * TAM, pag * TAM);
  const actual = enPagina.find((x) => x.id === activo) ?? enPagina[0] ?? null;
  const cifras = cifrasDe(h, p, solesCompacto, numero);
  const altas = todos.filter((x) => x.severidad === "alta").length;
  const faltan = clase ? omitidosDe(h, clase) : null;
  if (!todos.length) return null;

  const filtrar = (cambio: () => void) => {
    cambio();
    setPagina(1);
    setActivo(null);
  };

  const ver = (x: Hallazgo) => {
    irAPestana("tiempo", "hv");
    const pedido: PedidoLinea = { clave, tipo: x.tipo, id: x.tipo === "evento" ? x.e.id : x.tipo === "secuencia" ? x.s.id : x.p.id };
    // La línea se monta la primera vez que se abre su pestaña: se le pide cuando ya está (y ya escucha).
    let vueltas = 0;
    const pedir = () => {
      if (document.getElementById(idLinea(clave)) || vueltas++ > 60) window.setTimeout(() => window.dispatchEvent(new CustomEvent(VER_EN_LINEA, { detail: pedido })), 80);
      else requestAnimationFrame(pedir);
    };
    requestAnimationFrame(pedir);
  };

  return (
    <section aria-label="Lo más grave de su historia" className="space-y-3">
      {cifras.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label={p ? `Cifras de ${p.etiqueta}` : "Cifras de toda su historia"}>
          {cifras.map((c) => {
            const cuerpo = (
              <>
                <span className="block text-meta font-medium text-inkSoft">{c.etiqueta}</span>
                <span className="mt-0.5 block font-display text-seccion font-bold tabular-nums text-ink">{numero(c.valor)}</span>
                <span className="block text-rotulo text-mute">{c.contexto ?? (p ? "en ese periodo" : "en toda su historia")}</span>
              </>
            );
            return (
              <li key={c.clave}>
                {c.href ? (
                  <Link
                    href={c.href}
                    prefetch={false}
                    className="block h-full rounded-xl border border-line bg-paper px-3 py-2.5 transition-colors hover:border-granate/40 hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                  >
                    {cuerpo}
                  </Link>
                ) : (
                  <div className="h-full rounded-xl border border-line bg-paper px-3 py-2.5">{cuerpo}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-2 rounded-2xl border border-line bg-paper p-3 sm:p-4">
        {/* Los filtros, en dos filas cortas: qué clase de hecho y de cuándo. */}
        <div role="group" aria-label="Clase de hecho" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            aria-pressed={!clase}
            onClick={() => filtrar(() => setClase(""))}
            className={cn(CHIP, !clase ? "border-granate/30 bg-granate-50 font-semibold text-granate" : "border-line bg-paper text-inkSoft hover:border-granate/30 hover:text-ink")}
          >
            Todo <span className="tabular-nums">{numero(porLoDemas.length)}</span>
          </button>
          {clases.map((c) => {
            const on = clase === c.clave;
            return (
              <button
                key={c.clave}
                type="button"
                aria-pressed={on}
                disabled={!c.n && !on}
                onClick={() => filtrar(() => setClase(on ? "" : c.clave))}
                className={cn(CHIP, on ? "border-granate/30 bg-granate-50 font-semibold text-granate" : "border-line bg-paper text-inkSoft hover:border-granate/30 hover:text-ink")}
              >
                {c.etiqueta} <span className="tabular-nums">{numero(c.n)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {periodos.opciones.length > 1 && (
            <span className={cn(CAJA, p ? "border-granate" : "border-line hover:border-paperEdge")}>
              <span aria-hidden className="min-w-0 truncate">
                {p ? (
                  <>
                    <span className="text-mute">{periodos.nombre}:</span> <span className="font-semibold">{p.etiqueta}</span>
                  </>
                ) : (
                  `${periodos.nombre}: ${periodos.nombre === "Gestión" ? "todas" : "todos"}`
                )}
              </span>
              <ChevronDown size={14} className="ml-auto shrink-0 text-mute" aria-hidden />
              <select
                aria-label={periodos.nombre === "Gestión" ? "Ver sólo lo de una gestión" : "Ver sólo lo de un año"}
                value={periodo}
                onChange={(e) => filtrar(() => setPeriodo(e.target.value))}
                className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full text-destacado opacity-0"
              >
                <option value="">{periodos.nombre === "Gestión" ? "Todas las gestiones" : "Todos los años"}</option>
                {periodos.opciones.map((o) => (
                  <option key={o.clave} value={o.clave}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </span>
          )}
          {altas > 0 && altas < todos.length && (
            <button
              type="button"
              aria-pressed={soloAlta}
              onClick={() => filtrar(() => setSoloAlta((v) => !v))}
              className={cn(CHIP, "bg-paper", soloAlta ? "border-granate font-semibold text-ink" : "border-line text-inkSoft hover:border-paperEdge hover:text-ink")}
            >
              {soloAlta && <Check size={14} className="shrink-0" aria-hidden />}
              Sólo señal alta
            </button>
          )}
          <p className="ml-auto text-rotulo text-mute" aria-live="polite">
            {plural(vistos.length, "hallazgo", "hallazgos")}, lo más grave primero
          </p>
        </div>

        {vistos.length === 0 ? (
          <VacioEnLinea variante="compacta" icono={<SearchX size={16} />}>
            Nada con esos filtros. Quita la gestión o la clase para ver los demás.
          </VacioEnLinea>
        ) : (
          <div className="grid gap-4 pt-1 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="min-w-0 space-y-2">
              <ul className="space-y-0.5" aria-label="Hallazgos">
                {enPagina.map((x) => {
                  const on = actual?.id === x.id;
                  const Icono = ICONO_NIVEL[x.severidad];
                  return (
                    <li key={x.id}>
                      <button
                        type="button"
                        onClick={() => setActivo(x.id)}
                        aria-current={on ? "true" : undefined}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                          on ? "border-granate/40 bg-paperSoft" : "border-transparent hover:bg-paperSoft",
                        )}
                      >
                        <Icono size={15} className={cn("mt-0.5 shrink-0", COLOR[x.severidad])} aria-hidden />
                        <span className="sr-only">{PALABRA[x.severidad]}: </span>
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-meta font-semibold leading-snug text-ink text-pretty">{x.titulo}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-rotulo text-mute">
                            {!clase && <span className="font-medium text-inkSoft">{nombreDeClase(h, x.clase)}</span>}
                            <span>{cuandoDe(x)}</span>
                            {x.monto ? <span className="font-mono tabular-nums text-inkSoft">{solesCompacto(x.monto)}</span> : null}
                          </span>
                        </span>
                      </button>
                      {on && (
                        <div className="px-1 pb-3 pt-2 md:hidden">
                          <Detalle h={h} x={x} ver={() => ver(x)} bajoSuFila />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {vistos.length > TAM && (
                <Paginacion actual={pag} paginas={paginas} total={vistos.length} tam={TAM} navegacion="interna" cargando={false} nombre="hallazgos" onChange={(n) => { setPagina(n); setActivo(null); }} />
              )}
              {faltan && (
                <p className="text-rotulo text-mute">
                  Aquí van los más graves y los más grandes de cada año. Hay {numero(faltan.n)} más:{" "}
                  {faltan.href ? (
                    <Link href={faltan.href} prefetch={false} className="font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
                      ver la lista entera
                    </Link>
                  ) : (
                    "la lista entera está en su pestaña de la ficha"
                  )}
                  .
                </p>
              )}
            </div>
            <div className="hidden min-w-0 md:block">
              {actual && (
                <div className="sticky top-[calc(var(--alto-barra-fija,0px)+0.75rem)] rounded-xl border border-line bg-paperSoft/60 p-4">
                  <Detalle h={h} x={actual} ver={() => ver(actual)} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function cuandoDe(x: Hallazgo): string {
  if (x.tipo === "patron") return x.p.hasta && x.p.hasta !== x.p.mes ? `${mesLargo(x.p.mes)} a ${mesLargo(x.p.hasta)}` : mesLargo(x.p.mes);
  return x.hasta ? `${fechaConAnio(x.fecha)} a ${fechaConAnio(x.hasta)}` : fechaConAnio(x.fecha);
}

/** Los días entre dos fechas «aaaa-mm-dd» (para «170 días después» entre dos pasos). */
function dias(a: string, b: string): number | null {
  const x = Date.parse(a.slice(0, 10));
  const y = Date.parse(b.slice(0, 10));
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86_400_000) : null;
}

const ENLACE = "inline-flex min-h-[32px] items-center gap-1.5 text-meta font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";

/** El hallazgo elegido entero: qué es, cuándo, sus datos (o sus pasos, o las cifras del pico), su fuente y a dónde ir. */
function Detalle({ h, x, ver, bajoSuFila = false }: { h: Historia; x: Hallazgo; ver: () => void; bajoSuFila?: boolean }) {
  const enLinea = (
    <button type="button" onClick={ver} className={ENLACE}>
      <LocateFixed size={14} aria-hidden />
      Verlo en la línea de tiempo
    </button>
  );
  // Bajo su fila (en el celular), la fila ya dice su título: no se repite.
  const titulo = !bajoSuFila && <p className="font-display text-destacado font-bold leading-snug text-ink text-pretty">{x.titulo}</p>;
  if (x.tipo === "evento") {
    return (
      <div className={cn("space-y-3", bajoSuFila && "border-l-2 border-granate/30 pl-3")}>
        {titulo}
        <DetalleHecho e={x.e} renglon={nombreDeClase(h, x.clase)} />
        <div className="border-t border-line pt-2">{enLinea}</div>
      </div>
    );
  }
  return (
    <div className={cn("space-y-3", bajoSuFila && "border-l-2 border-granate/30 pl-3")}>
      {!bajoSuFila && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Severidad bandera={x.severidad} formato="linea" />
          <span className="inline-flex items-center gap-1 text-rotulo font-semibold text-inkSoft">
            {x.tipo === "secuencia" ? <Link2 size={13} aria-hidden /> : <TrendingUp size={13} aria-hidden />}
            {nombreDeClase(h, x.clase)}
          </span>
          <span className="text-rotulo text-mute">{cuandoDe(x)}</span>
        </div>
      )}
      {titulo}
      {x.tipo === "secuencia" ? (
        <>
          {/* Los pasos en una línea vertical: la fecha, lo que pasó y, entre uno y otro, cuántos días pasaron. */}
          <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-paperEdge">
            {x.s.pasos.map((paso, k) => {
              const d = k > 0 ? dias(x.s.pasos[k - 1].fecha, paso.fecha) : null;
              return (
                <li key={k} className="relative pl-6">
                  <span className={cn("absolute left-0 top-1 size-[11px] rounded-full border-2 border-paper", k === x.s.pasos.length - 1 ? "bg-granate" : "bg-inkSoft")} aria-hidden />
                  <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-rotulo tabular-nums text-inkSoft">
                    {fechaConAnio(paso.fecha)}
                    {d != null && d >= 0 && <span className="font-sans font-semibold text-ink">{d === 0 ? "el mismo día" : d === 1 ? "1 día después" : `${numero(d)} días después`}</span>}
                  </p>
                  <p className="text-meta leading-snug text-ink text-pretty">
                    <TextoPaso texto={paso.texto} href={paso.href} />
                  </p>
                </li>
              );
            })}
          </ol>
          <p className="text-rotulo leading-snug text-mute text-pretty">{x.s.explica}</p>
        </>
      ) : (
        <>
          <CifrasDelPico h={h} x={x} />
          <p className="text-meta leading-relaxed text-inkSoft text-pretty">{x.p.explica}</p>
        </>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2">
        {enLinea}
        {x.tipo === "secuencia" && x.s.href && (
          <Link href={x.s.href} prefetch={false} className={ENLACE}>
            Ver la evidencia
            <ArrowRight size={14} aria-hidden />
          </Link>
        )}
      </div>
      <p className="text-rotulo text-mute">Fuente: {x.tipo === "secuencia" ? x.s.fuente : h.series.find((s) => s.carril === x.p.carril)?.fuente ?? "las series de esta historia"}</p>
    </div>
  );
}

/** Un mes fuera de lo normal, en cifras: cuánto hubo, cuánto era lo normal y cuántas veces es. */
function CifrasDelPico({ h, x }: { h: Historia; x: Extract<Hallazgo, { tipo: "patron" }> }) {
  if (x.p.tipo !== "pico") return null;
  const serie = h.series.find((s) => s.carril === x.p.carril && !s.porAnio);
  // El mes del tope va en el id («pico:<renglón>:<AAAA-MM>»); en la planilla el pico es de los que entraron.
  const mes = x.p.id.split(":")[2] ?? x.p.mes;
  const punto = serie?.puntos.find((q) => q.periodo === mes);
  if (!serie || !punto) return null;
  const valor = serie.carril === "planilla" ? punto.extra ?? 0 : punto.n;
  const normal = serie.carril === "planilla" ? null : normalDeSerie(serie).get(mes)?.mediana ?? null;
  const unidad = serie.carril === "planilla" ? "personas entraron" : serie.unidad;
  return (
    <dl className="grid grid-cols-2 gap-2">
      <div className="rounded-xl border border-line bg-paper px-3 py-2">
        <dt className="text-rotulo text-mute">En {mesLargo(mes)}</dt>
        <dd className="font-display text-bloque font-bold tabular-nums text-ink">{numero(valor)}</dd>
        <dd className="text-rotulo text-inkSoft">{unidad}</dd>
      </div>
      {normal != null && (
        <div className="rounded-xl border border-line bg-paper px-3 py-2">
          <dt className="text-rotulo text-mute">Lo normal en los doce meses de antes</dt>
          <dd className="font-display text-bloque font-bold tabular-nums text-ink">{numero(Math.round(normal))}</dd>
          <dd className="text-rotulo text-inkSoft">{unidad} al mes</dd>
        </div>
      )}
    </dl>
  );
}
