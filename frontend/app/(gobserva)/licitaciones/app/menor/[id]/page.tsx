import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Building2, CalendarDays, Clock, FileDown, Layers, Lock, MapPin, Receipt, Tag, Trophy, Users } from "lucide-react";
import { CLASE_ENLACE_PIE, Caja, ESPACIO_CAJAS, Pagina, VacioCaja } from "@/components/gobserva/app/Caja";
import { CopiarEnlace } from "@/components/licitaciones-app/detalle/CopiarEnlace";
import { SeguirConEtapa } from "@/components/licitaciones-app/seguimiento/BotonSeguir";
import { Insignia, InsigniaTipo } from "@/components/licitaciones-app/ui/Insignia";
import { numero, soles, solesCompacto } from "@/lib/formato";
import { fichaEmpresaVigia, rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { tituloNatural } from "@/lib/landing";
import { cierreMenor, getMenor, limpiar, nombreRegion, urlRequerimientoMenor, type FichaMenor } from "@/lib/licitaciones";
import { aParamsMenores, leerMenores } from "@/lib/licitaciones-app/filtrosMenores";
import { fechaCortaLima, haceDias } from "@/lib/licitaciones-app/formato";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const BUSCADOR_SEACE = "https://prod6.seace.gob.pe/buscador-publico/contrataciones";
const HORA = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false });
const fechaHora = (iso: string) => `${fechaCortaLima(iso)}, ${HORA.format(new Date(iso))}`;

type Props = { params: { id: string }; searchParams?: { volver?: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = /^\d{1,9}$/.test(params.id) ? await getMenor(params.id) : null;
  return { title: m ? `${m.codigo}: ${limpiar(m.descripcion).slice(0, 60)}` : "Contrato menor no encontrado", robots: { index: false, follow: false } };
}

/**
 * Un contrato menor (≤8 UIT) dentro de la app, con la misma estructura que el detalle de un proceso: volver a la lista
 * con sus filtros, qué es y quién compra, las acciones (seguir con su etapa, el requerimiento, cotizar en el SEACE,
 * copiar el enlace) y las cuatro cifras que deciden si cotizar. Debajo, en cajas: qué se compra, lo que se pagó antes
 * por lo mismo, cómo cotizar paso a paso y el comprador (a quién le compró en 12 meses; sólo empresas).
 */
export default async function DetalleMenor({ params, searchParams }: Props) {
  const base = baseProducto("licitaciones");
  if (!/^\d{1,9}$/.test(params.id)) notFound();
  const m = await getMenor(params.id);
  if (!m) notFound();

  const ahora = Date.now();
  // La vuelta se rearma desde los filtros (nunca se usa un texto cualquiera como enlace).
  const volverQs = searchParams?.volver ? aParamsMenores(leerMenores(new URLSearchParams(searchParams.volver))).toString() : "";
  const volver = rutaEn(base, `/app/menores${volverQs ? `?${volverQs}` : ""}`);
  const titulo = limpiar(m.descripcion) || "Contratación sin descripción registrada";
  const cierre = cierreMenor(m.cierra, ahora);
  const cerrada = !!m.invitacion && !/abierta/i.test(m.invitacion);
  const lugar = m.regiones?.length ? m.regiones.map((r) => nombreRegion(r) ?? r).join(", ") : null;
  // En un contrato menor el fin de consultas suele ser el mismo minuto que el cierre: entonces es «hasta el cierre».
  const consultasAlCierre = !!m.consultasHasta && Math.abs(Date.parse(m.consultasHasta) - Date.parse(m.cierra)) < 60_000;
  const consultasPasaron = !!m.consultasHasta && Date.parse(m.consultasHasta) < ahora;
  const horasAlCierre = (Date.parse(m.cierra) - ahora) / 3_600_000;

  return (
    <Pagina>
      <header className="mb-6">
        <Link href={volver} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg text-dato font-semibold text-inkSoft underline-offset-4 hover:text-ink hover:underline">
          <ArrowLeft size={16} aria-hidden /> Contratos menores
        </Link>
        {/* Las insignias y las acciones se envuelven: lado a lado sólo desde xl, y aun ahí los botones pasan de línea antes que desbordar. */}
        <div className="mt-3 flex flex-col-reverse gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 xl:pt-2.5">
            <span className="font-mono text-meta font-semibold text-inkSoft">{m.codigo}</span>
            <InsigniaTipo tipo={m.tipo} />
            <Insignia>Contrato menor</Insignia>
            {m.abierta && !cierre.cerrada ? <Insignia tono="acento">Recibe cotizaciones</Insignia> : <Insignia>Ya no recibe cotizaciones</Insignia>}
            {cerrada && (
              <Insignia tono="aviso" Icono={Lock}>
                Invitación cerrada
              </Insignia>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
            <SeguirConEtapa id={String(m.id)} codigo={m.codigo} titulo={titulo} tipo="menor" />
            {m.tieneRequerimiento && (
              <a
                href={urlRequerimientoMenor(m.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-caja px-3.5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-ink/20"
              >
                <FileDown size={15} aria-hidden /> Requerimiento
                <span className="sr-only"> en PDF (se abre en otra pestaña)</span>
              </a>
            )}
            <a
              href={BUSCADOR_SEACE}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-caja px-3.5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-ink/20"
            >
              Cotizar en el SEACE <ArrowUpRight size={15} aria-hidden />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
            <CopiarEnlace />
          </div>
        </div>
        <div className="mt-3 min-w-0">
          {/* recorte: la descripción llega a tener 400 letras; aquí van tres renglones y entera al pasar el mouse. */}
          <h1 title={titulo} className="line-clamp-3 max-w-[80ch] text-pretty font-display text-bloque font-bold leading-snug tracking-tight text-ink sm:text-seccion">
            {titulo}
          </h1>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-dato text-inkSoft">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Building2 size={15} aria-hidden className="shrink-0 text-mute" />
              {m.entidad ? tituloNatural(m.entidad) : "Entidad sin nombre"}
              {m.entidadRuc && <span className="font-mono text-meta text-mute">RUC {m.entidadRuc}</span>}
            </span>
            {m.area && (
              <span className="inline-flex items-center gap-1.5">
                <Users size={15} aria-hidden className="text-mute" />
                {tituloNatural(m.area)}
              </span>
            )}
            {lugar && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={15} aria-hidden className="text-mute" />
                {lugar}
              </span>
            )}
          </p>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-caja lg:grid-cols-4">
          <div className="min-w-0 bg-caja p-4 sm:p-5">
            <dt className="text-meta font-semibold text-inkSoft">Cierra la cotización</dt>
            <dd className={cn("mt-2 font-display text-bloque font-bold leading-tight tabular-nums sm:text-seccion", cierre.cerrada ? "text-inkSoft" : "text-ink")}>
              {cierre.cerrada ? "Cerrada" : fechaHora(m.cierra)}
            </dd>
            <dd className="mt-1.5">
              {cierre.cerrada ? (
                <span className="text-meta text-mute">El {fechaHora(m.cierra)}</span>
              ) : (
                <Insignia tono={cierre.urgente ? "urgente" : horasAlCierre <= 36 ? "aviso" : "neutro"} Icono={Clock}>
                  {cierre.texto}
                </Insignia>
              )}
            </dd>
          </div>
          <Cifra
            etiqueta="Consultas"
            valor={!m.consultasHasta ? "Sin consultas" : consultasAlCierre ? "Hasta el cierre" : consultasPasaron ? "Cerradas" : fechaHora(m.consultasHasta)}
            detalle={!m.consultasHasta ? "Esta compra no abrió consultas" : consultasPasaron && !consultasAlCierre ? `Cerraron el ${fechaHora(m.consultasHasta)}` : "Se preguntan en el SEACE"}
          />
          <Cifra etiqueta="Publicada" valor={m.publicada ? fechaCortaLima(m.publicada) : "Sin fecha"} detalle={m.publicada ? haceDias(m.publicada, ahora) : "La fecha no vino en el SEACE"} />
          <Cifra
            etiqueta="Qué pide"
            valor={m.items.length ? `${numero(m.items.length)} ${m.items.length === 1 ? "ítem" : "ítems"}` : "Ver requerimiento"}
            detalle={m.tieneRequerimiento ? "Requerimiento en PDF" : "Requerimiento en el SEACE"}
          />
        </dl>
      </header>

      <div className={cn("grid grid-cols-[minmax(0,1fr)] items-start xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]", ESPACIO_CAJAS)}>
        <div className={cn("grid grid-cols-[minmax(0,1fr)]", ESPACIO_CAJAS)}>
          <QueSeCompra m={m} />
          <Precios m={m} />
        </div>
        <div className={cn("grid grid-cols-[minmax(0,1fr)]", ESPACIO_CAJAS)}>
          <ComoCotizar m={m} cerrada={cierre.cerrada} consultasAlCierre={consultasAlCierre} />
          <Comprador m={m} />
        </div>
      </div>
    </Pagina>
  );
}

function Cifra({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle: string }) {
  return (
    <div className="min-w-0 bg-caja p-4 sm:p-5">
      <dt className="text-meta font-semibold text-inkSoft">{etiqueta}</dt>
      <dd className="mt-2 truncate font-display text-bloque font-bold leading-tight tabular-nums text-ink sm:text-seccion">{valor}</dd>
      <dd className="mt-1.5 text-meta text-mute">{detalle}</dd>
    </div>
  );
}

/** Los ítems: el nombre del catálogo (CUBSO) dice qué es; la descripción de la entidad va debajo si dice algo distinto. */
function QueSeCompra({ m }: { m: FichaMenor }) {
  return (
    <Caja
      id="items"
      titulo="Qué se compra"
      descripcion={m.items.length ? "Cada ítem con su cantidad y su lugar de entrega." : undefined}
      relleno={false}
    >
      {m.items.length === 0 ? (
        <VacioCaja Icono={Layers} titulo="El detalle está en el requerimiento" texto="El SEACE no publicó los ítems de esta compra por separado: léelos en el requerimiento." />
      ) : (
        <ol className="divide-y divide-line">
          {m.items.map((i, k) => {
            const nombre = limpiar(i.nombre) || limpiar(i.descripcion) || "Ítem sin descripción";
            const detalle = limpiar(i.descripcion);
            return (
              <li key={k} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-5">
                <span aria-hidden className="mt-0.5 grid h-6 w-6 place-items-center rounded-full bg-ink/[0.06] text-rotulo font-semibold tabular-nums text-inkSoft">
                  {k + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-dato font-semibold leading-snug text-ink">{nombre}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-mute">
                    {detalle && detalle.toLocaleLowerCase("es-PE") !== nombre.toLocaleLowerCase("es-PE") && <span className="text-inkSoft">{detalle}</span>}
                    {i.cubso && <span className="font-mono">CUBSO {i.cubso}</span>}
                    {i.distrito && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} aria-hidden /> {tituloNatural(i.distrito.replaceAll("/", ", "))}
                      </span>
                    )}
                  </p>
                </div>
                {i.cantidad != null && (
                  <p className="col-start-2 mt-1 text-dato font-semibold tabular-nums text-ink sm:col-start-3 sm:mt-0 sm:text-right">
                    {numero(i.cantidad)} <span className="font-normal text-mute">{i.unidad ? i.unidad.toLocaleLowerCase("es-PE") : ""}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Caja>
  );
}

/** Lo que se pagó por los mismos ítems: contratos menores adjudicados (24 meses) y procesos del Estado (el último año). */
function Precios({ m }: { m: FichaMenor }) {
  const hay = m.precios.length + m.preciosProcesos.length > 0;
  return (
    <Caja
      id="precios"
      titulo="Lo que se pagó antes por lo mismo"
      descripcion={hay ? "Para estimar tu cotización: el precio por unidad de los mismos ítems (mismo CUBSO)." : undefined}
      relleno={hay}
    >
      {!hay ? (
        <VacioCaja Icono={Tag} titulo="Todavía no hay precios de estos ítems" texto="Los sumamos con cada adjudicación de contratos menores y de procesos del Estado." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {m.precios.map((p) => (
            <Precio
              key={`m-${p.cubso}`}
              nombre={limpiar(p.nombre) || `CUBSO ${p.cubso}`}
              mediana={p.mediana}
              unidad={p.unidad}
              fuente="Contratos menores"
              detalle={`Entre ${soles(p.minimo)} y ${soles(p.maximo)} en ${p.veces === 1 ? "1 contrato menor" : `${numero(p.veces)} contratos menores`} de los últimos 24 meses.`}
            />
          ))}
          {m.preciosProcesos.map((p) => (
            <Precio
              key={`p-${p.cubso}-${p.unidad}`}
              nombre={limpiar(m.items.find((i) => i.cubso === p.cubso)?.nombre) || `CUBSO ${p.cubso}`}
              mediana={p.mediana}
              unidad={p.unidad}
              fuente={`Procesos de ${p.anio}`}
              detalle={`La mitad de los precios, entre ${soles(p.p25)} y ${soles(p.p75)}, en ${p.veces === 1 ? "1 proceso" : `${numero(p.veces)} procesos`} del Estado.`}
            />
          ))}
        </ul>
      )}
    </Caja>
  );
}

function Precio({ nombre, mediana, unidad, fuente, detalle }: { nombre: string; mediana: number; unidad: string | null; fuente: string; detalle: string }) {
  return (
    <li className="flex min-w-0 flex-col rounded-xl border border-line bg-ink/[0.02] p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 min-w-0 text-dato font-semibold leading-snug text-ink">{nombre}</p>
        <Insignia className="shrink-0">{fuente}</Insignia>
      </div>
      <p className="mt-3 font-display text-seccion font-bold leading-none tabular-nums text-ink">{soles(mediana)}</p>
      <p className="mt-1 text-meta text-mute">por {unidad ? unidad.toLocaleLowerCase("es-PE") : "unidad"}, la mediana</p>
      <p className="mt-2 text-meta leading-snug text-inkSoft">{detalle}</p>
    </li>
  );
}

/** Cómo se cotiza un contrato menor, en pasos numerados, con el código a mano y el botón al SEACE. */
function ComoCotizar({ m, cerrada, consultasAlCierre }: { m: FichaMenor; cerrada: boolean; consultasAlCierre: boolean }) {
  const pasos = [
    m.tieneRequerimiento ? (
      <>
        Lee el{" "}
        <a href={urlRequerimientoMenor(m.id)} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline underline-offset-2">
          requerimiento en PDF
        </a>
        : qué piden, cuánto y dónde se entrega.
      </>
    ) : (
      <>Lee el requerimiento en la ficha del SEACE: qué piden, cuánto y dónde se entrega.</>
    ),
    m.consultasHasta ? (
      <>Si algo no está claro, pregúntalo en el SEACE {consultasAlCierre ? "antes del cierre" : `hasta el ${fechaHora(m.consultasHasta)}`}.</>
    ) : (
      <>Esta compra no abrió consultas: cotiza con lo que dice el requerimiento.</>
    ),
    <>
      Entra al SEACE con tu usuario del RNP y busca el código <span className="font-mono font-semibold text-ink">{m.codigo}</span>.
    </>,
    <>Envía tu cotización {cerrada ? "(esta ya cerró)" : `antes del ${fechaHora(m.cierra)}`}.</>,
  ];
  return (
    <Caja
      id="cotizar"
      titulo="Cómo cotizar"
      pie={
        <a href={BUSCADOR_SEACE} target="_blank" rel="noopener noreferrer" className={CLASE_ENLACE_PIE}>
          Abrir el buscador del SEACE <ArrowUpRight size={14} aria-hidden />
        </a>
      }
    >
      <ol className="space-y-3">
        {pasos.map((p, k) => (
          <li key={k} className="flex gap-3 text-dato leading-snug text-inkSoft">
            <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-granate text-rotulo font-bold text-paper">
              {k + 1}
            </span>
            <span className="min-w-0 pt-0.5">{p}</span>
          </li>
        ))}
      </ol>
    </Caja>
  );
}

/** El comprador: cuánto compró así en 12 meses, con cuántos proveedores y a qué empresas (una persona no se nombra). */
function Comprador({ m }: { m: FichaMenor }) {
  const e = m.entidadMenores;
  const nombre = m.entidad ? tituloNatural(m.entidad) : "Entidad sin nombre";
  return (
    <Caja
      id="comprador"
      titulo="El comprador"
      descripcion={nombre}
      pie={
        m.entidadRuc ? (
          <a href={`https://vigia.gobserva.cloud/entidad/${m.entidadRuc}`} className={CLASE_ENLACE_PIE}>
            <Receipt size={14} aria-hidden /> Todo lo que compra, en Vigía
          </a>
        ) : undefined
      }
    >
      {!e || e.contratos === 0 ? (
        <p className="text-dato leading-snug text-inkSoft">No tenemos contratos menores adjudicados de esta entidad en los últimos 12 meses.</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <Mini etiqueta="Contratos" valor={numero(e.contratos)} />
            <Mini etiqueta="Monto" valor={solesCompacto(e.monto)} />
            <Mini etiqueta="Proveedores" valor={numero(e.proveedores)} />
          </dl>
          <p className="mt-3 flex items-start gap-1.5 text-meta leading-snug text-mute">
            <CalendarDays size={13} aria-hidden className="mt-0.5 shrink-0" />
            Contratos menores de los últimos 12 meses
            {e.aPersonas > 0 ? `; ${numero(e.aPersonas)} con personas naturales, que no nombramos.` : "."}
          </p>
          {e.ganadores.length > 0 && (
            <>
              <p className="mt-4 flex items-center gap-1.5 text-meta font-semibold text-inkSoft">
                <Trophy size={13} aria-hidden /> Las empresas que más le vendieron
              </p>
              <ol className="mt-2 divide-y divide-line">
                {/* recorte: las 6 primeras; todas están en Vigía (el enlace del pie). */}
                {e.ganadores.slice(0, 6).map((g) => {
                  const href = fichaEmpresaVigia(g.ruc);
                  const n = g.nombre ? tituloNatural(g.nombre) : g.ruc;
                  return (
                    <li key={g.ruc} className="flex min-w-0 items-baseline justify-between gap-3 py-2 text-meta">
                      {href ? (
                        <a href={href} className="min-w-0 truncate text-ink underline-offset-2 hover:text-granate hover:underline" title={`${n}: su historial en Vigía`}>
                          {n}
                        </a>
                      ) : (
                        <span className="min-w-0 truncate text-ink">{n}</span>
                      )}
                      <span className="shrink-0 font-semibold tabular-nums text-inkSoft">{solesCompacto(g.monto)}</span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </>
      )}
    </Caja>
  );
}

function Mini({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-ink/[0.035] px-3 py-2.5">
      <dt className="text-rotulo font-semibold text-mute">{etiqueta}</dt>
      <dd className="mt-0.5 truncate font-display text-destacado font-bold tabular-nums text-ink">{valor}</dd>
    </div>
  );
}
