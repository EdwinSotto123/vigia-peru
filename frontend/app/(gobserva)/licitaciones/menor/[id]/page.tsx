import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { ArrowUpRight, CalendarClock, CalendarDays, FileDown, Layers, Lock, MessageSquareWarning, Receipt, Tag, Trophy, Users, type LucideIcon } from "lucide-react";
import { BotonGuardar } from "@/components/gobserva/cuenta/BotonGuardar";
import { CierreMenor, regionesMenor } from "@/components/licitaciones/FilaMenor";
import { ChipTipo, IconoTipo } from "@/components/licitaciones/Piezas";
import { Nota, Volver } from "@/components/patrones/Estructura";
import { Dato } from "@/components/ui/Dato";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { numero, soles, solesCompacto } from "@/lib/formato";
import { fichaEmpresaVigia, rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { tituloNatural } from "@/lib/landing";
import { cierreMenor, getMenor, limpiar, urlRequerimientoMenor } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

const BUSCADOR_SEACE = "https://prod6.seace.gob.pe/buscador-publico/contrataciones";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const m = await getMenor(params.id);
  if (!m) return { title: "Contratación no encontrada" };
  const que = limpiar(m.descripcion).slice(0, 90) || "Contratación menor";
  return {
    title: que,
    description: `${que}. ${m.entidad ? tituloNatural(m.entidad) : "Entidad pública"}. ${cierreMenor(m.cierra).texto}. Ítems, requerimiento y lo que se pagó antes por lo mismo.`,
    alternates: { canonical: urlCanonica("licitaciones", `/menor/${m.id}`) },
  };
}

const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-PE", { timeZone: "America/Lima", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "Sin fecha";

/**
 * Una contratación menor abierta (≤8 UIT) en Gobserva Licitaciones (2026-11-07). Arriba lo que decide si se cotiza:
 * cuándo cierra, hasta cuándo hay consultas, cuántos ítems y si está el requerimiento; las acciones (el requerimiento en
 * PDF, cotizar en el SEACE, la entidad en Vigía). Después, los ítems con su CUBSO y su lugar de entrega, lo que se pagó
 * por los mismos ítems en contratos menores adjudicados y lo que esa entidad compró así en 12 meses y a quién (sólo
 * empresas: una persona natural se cuenta sin nombrarla). GET /licitaciones/menores/:id.
 */
export default async function FichaMenor({ params }: { params: { id: string } }) {
  const base = baseProducto("licitaciones");
  if (!/^\d{1,9}$/.test(params.id)) notFound();
  const m = await getMenor(params.id);
  if (!m) notFound();
  const ruta = (p: string) => rutaEn(base, p);
  const cierre = cierreMenor(m.cierra);
  const cerrada = !!m.invitacion && !/abierta/i.test(m.invitacion);
  const entidad = m.entidad ? tituloNatural(m.entidad) : "Entidad sin nombre registrado";
  const e = m.entidadMenores;

  return (
    <div className="container-page py-6 sm:py-10">
      <Volver href={ruta("/menores")} className="min-h-11">
        Contratos menores
      </Volver>

      <div className="mt-2 grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-x-10">
        {/* En el celular, las piezas de las dos columnas se intercalan (order): las acciones van justo después de los datos clave. */}
        <div className="contents lg:block lg:min-w-0 lg:space-y-8">
          <header className="order-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <IconoTipo tipo={m.tipo} className="mr-1 h-9 w-9" />
              <ChipTipo tipo={m.tipo} />
              {cerrada && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2.5 py-0.5 text-rotulo font-semibold text-amberTexto">
                  <Lock size={11} aria-hidden /> Invitación cerrada: sólo cotizan los invitados
                </span>
              )}
              {!m.abierta && <span className="rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-semibold text-mute">Ya no recibe cotizaciones</span>}
            </div>
            <h1 className="mt-3 text-balance font-display text-seccion font-bold leading-snug tracking-tight text-ink sm:text-cifra sm:leading-tight">
              {limpiar(m.descripcion) || "Contratación sin descripción registrada"}
            </h1>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-dato text-inkSoft">
              <Dato tipo="entidad" className="font-medium text-ink">
                {entidad}
              </Dato>
              {m.area && <Dato icono={Users}>{tituloNatural(m.area)}</Dato>}
              <Dato tipo="lugar">{regionesMenor(m.regiones)}</Dato>
              <Dato icono={CalendarDays}>Publicada el {fechaHora(m.publicada)}</Dato>
              <Dato tipo="codigo" mono>
                {m.codigo}
              </Dato>
            </p>
          </header>

          <dl className="order-1 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line xl:grid-cols-4">
            <Clave Icono={CalendarClock} etiqueta="Cotización" valor={cierre.cerrada ? "Cerrada" : fechaHora(m.cierra)} tono={cierre.cerrada ? "text-inkSoft" : undefined}>
              <CierreMenor cierra={m.cierra} sinRotulo />
            </Clave>
            <Clave Icono={MessageSquareWarning} etiqueta="Consultas" valor={m.consultasHasta ? `Hasta el ${fechaHora(m.consultasHasta)}` : "Sin etapa de consultas"} tono={m.consultasHasta ? undefined : "text-inkSoft"}>
              Las preguntas a la entidad se hacen en el SEACE, antes de cotizar.
            </Clave>
            <Clave Icono={Layers} etiqueta="Qué pide" valor={m.items.length ? (m.items.length === 1 ? "1 ítem" : `${numero(m.items.length)} ítems`) : "En el requerimiento"}>
              {m.items.length ? "Con su cantidad y su lugar de entrega, abajo." : "El detalle llega en la próxima actualización."}
            </Clave>
            <Clave Icono={FileDown} etiqueta="Requerimiento" valor={m.tieneRequerimiento ? "Disponible" : "En el SEACE"} tono={m.tieneRequerimiento ? undefined : "text-inkSoft"}>
              {m.tieneRequerimiento ? "Términos de referencia o especificaciones, en PDF." : "Lo descargas desde la contratación en el SEACE."}
            </Clave>
          </dl>

          {m.items.length > 0 && (
            <section aria-labelledby="items-t" className="order-3 min-w-0">
              <h2 id="items-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                <Layers size={18} aria-hidden className="text-granate" /> Qué se compra
              </h2>
              <ol className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
                {m.items.map((i, k) => {
                  // El nombre del catálogo (CUBSO) dice qué es; la descripción de la entidad suele ser «Según EETT» o una
                  // precisión: va debajo si dice algo distinto.
                  const titulo = limpiar(i.nombre) || limpiar(i.descripcion) || "Ítem sin descripción";
                  const detalle = limpiar(i.descripcion);
                  return (
                  <li key={k} className="grid min-w-0 gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5">
                    <div className="min-w-0">
                      <p className="text-dato font-semibold leading-snug text-ink">{titulo}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-mute">
                        {detalle && detalle.toLocaleLowerCase("es-PE") !== titulo.toLocaleLowerCase("es-PE") && <span className="text-inkSoft">{detalle}</span>}
                        {i.cubso && <span className="font-mono">CUBSO {i.cubso}</span>}
                        {i.distrito && <Dato tipo="lugar">{tituloNatural(i.distrito.replaceAll("/", ", "))}</Dato>}
                      </p>
                    </div>
                    {i.cantidad != null && (
                      <p className="text-dato font-semibold tabular-nums text-ink sm:text-right">
                        {numero(i.cantidad)} <span className="font-normal text-mute">{i.unidad ? i.unidad.toLocaleLowerCase("es-PE") : ""}</span>
                      </p>
                    )}
                  </li>
                  );
                })}
              </ol>
            </section>
          )}

          <section aria-labelledby="precios-t" className="order-4 min-w-0">
            <h2 id="precios-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
              <Tag size={18} aria-hidden className="text-granate" /> Lo que se pagó antes por lo mismo
            </h2>
            {m.precios.length > 0 && (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {m.precios.map((p) => (
                  <li key={p.cubso} className="rounded-2xl border border-line bg-paper p-4">
                    <p className="line-clamp-2 text-dato font-semibold leading-snug text-ink">{limpiar(p.nombre) || `CUBSO ${p.cubso}`}</p>
                    <p className="mt-2 font-display text-bloque font-bold tabular-nums text-ink">
                      {soles(p.mediana)} <span className="text-meta font-normal text-mute">por {p.unidad ? p.unidad.toLocaleLowerCase("es-PE") : "unidad"}, mediana</span>
                    </p>
                    <p className="mt-1 text-meta text-inkSoft">
                      Entre {soles(p.minimo)} y {soles(p.maximo)} en {p.veces === 1 ? "1 contrato menor" : `${numero(p.veces)} contratos menores`} de los últimos 24 meses.
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {m.preciosProcesos.length > 0 && (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {m.preciosProcesos.map((p) => {
                  const item = m.items.find((i) => i.cubso === p.cubso);
                  return (
                    <li key={`${p.cubso}-${p.unidad}`} className="rounded-2xl border border-line bg-paper p-4">
                      <p className="line-clamp-2 text-dato font-semibold leading-snug text-ink">{limpiar(item?.nombre) || `CUBSO ${p.cubso}`}</p>
                      <p className="mt-2 font-display text-bloque font-bold tabular-nums text-ink">
                        {soles(p.mediana)} <span className="text-meta font-normal text-mute">por {p.unidad ? p.unidad.toLocaleLowerCase("es-PE") : "unidad"}, mediana</span>
                      </p>
                      <p className="mt-1 text-meta text-inkSoft">
                        La mitad de los precios, entre {soles(p.p25)} y {soles(p.p75)}, en {p.veces === 1 ? "1 proceso" : `${numero(p.veces)} procesos`} del Estado de {p.anio}.
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            {m.precios.length === 0 && m.preciosProcesos.length === 0 && (
              <Nota className="mt-3">Todavía no tenemos precios pagados por estos ítems: los vamos sumando con cada adjudicación.</Nota>
            )}
          </section>
        </div>

        <aside className="contents lg:sticky lg:top-24 lg:block lg:min-w-0 lg:space-y-4">
          <div className="order-2 space-y-2 rounded-2xl border border-line bg-paperSoft p-4">
            {m.tieneRequerimiento && (
              <a href={urlRequerimientoMenor(m.id)} target="_blank" rel="noopener noreferrer" className={claseAccion("primario", "min-h-11 w-full")}>
                <FileDown size={16} aria-hidden /> Ver el requerimiento (PDF)
              </a>
            )}
            <a href={BUSCADOR_SEACE} target="_blank" rel="noopener noreferrer" className={claseAccion(m.tieneRequerimiento ? "secundario" : "primario", "min-h-11 w-full")}>
              Cotizar en el SEACE <ArrowUpRight size={15} aria-hidden />
            </a>
            <p className="text-meta leading-snug text-inkSoft">
              Entra con tu usuario del RNP y busca el código <span className="font-mono font-semibold text-ink">{m.codigo}</span>.
            </p>
            {/* Guardarlo lo lleva al tablero de Seguimiento y al Calendario, con su cierre. BotonGuardar lee la URL: va en Suspense. */}
            <Suspense fallback={<span aria-hidden className="inline-block h-11 w-full animate-pulse rounded-full bg-paperDeep" />}>
              <BotonGuardar
                producto="licitaciones"
                base={base}
                tipo="menor"
                codigo={String(m.id)}
                titulo={limpiar(m.descripcion) || m.codigo || String(m.id)}
                datos={{ cierre: m.cierra ?? null, entidad: m.entidad ?? null }}
                className="w-full"
              />
            </Suspense>
          </div>

          <section aria-labelledby="entidad-t" className="order-5 rounded-2xl border border-line bg-paper p-4">
            <h2 id="entidad-t" className="font-display text-bloque font-bold leading-tight text-ink">
              {entidad}
            </h2>
            {e && e.contratos > 0 ? (
              <>
                <p className="mt-2 text-dato leading-snug text-inkSoft">
                  En los últimos 12 meses firmó {numero(e.contratos)} {e.contratos === 1 ? "contrato menor" : "contratos menores"} por {solesCompacto(e.monto)}, con{" "}
                  {numero(e.proveedores)} {e.proveedores === 1 ? "proveedor" : "proveedores"}
                  {e.aPersonas > 0 ? `; ${e.aPersonas === e.contratos ? (e.contratos === 1 ? "fue" : "todos fueron") : `${numero(e.aPersonas)} fueron`} con personas naturales` : ""}.
                </p>
                {e.ganadores.length > 0 && (
                  <>
                    <p className="mt-4 flex items-center gap-1.5 text-meta font-semibold text-mute">
                      <Trophy size={13} aria-hidden /> Las empresas que más le vendieron
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {e.ganadores.slice(0, 6).map((g) => {
                        const href = fichaEmpresaVigia(g.ruc);
                        const nombre = g.nombre ? tituloNatural(g.nombre) : g.ruc;
                        return (
                          <li key={g.ruc} className="flex min-w-0 items-baseline justify-between gap-3 text-meta">
                            {href ? (
                              <a href={href} className="min-w-0 truncate text-ink underline-offset-2 hover:text-granate hover:underline" title={`${nombre}: su historial en Vigía`}>
                                {nombre}
                              </a>
                            ) : (
                              <span className="min-w-0 truncate text-ink">{nombre}</span>
                            )}
                            <span className="shrink-0 tabular-nums text-inkSoft">{solesCompacto(g.monto)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </>
            ) : (
              <p className="mt-2 text-dato leading-snug text-inkSoft">No tenemos contratos menores adjudicados de esta entidad en los últimos 12 meses.</p>
            )}
            {m.entidadRuc && (
              <a href={`https://vigia.gobserva.cloud/entidad/${m.entidadRuc}`} className={claseAccion("secundario", "mt-4 min-h-11 w-full")}>
                <Receipt size={15} aria-hidden /> Todo lo que compra, en Vigía
              </a>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Clave({ Icono, etiqueta, valor, tono, children }: { Icono: LucideIcon; etiqueta: string; valor: string; tono?: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-paper p-4">
      <dt className="flex items-center gap-1.5 text-rotulo font-semibold text-mute">
        <Icono size={13} aria-hidden /> {etiqueta}
      </dt>
      <dd className={cn("font-display text-dato font-bold leading-snug text-ink [overflow-wrap:anywhere] sm:text-bloque", tono)}>{valor}</dd>
      {children && <dd className="text-meta leading-snug text-inkSoft">{children}</dd>}
    </div>
  );
}
