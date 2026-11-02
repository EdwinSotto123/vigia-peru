import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowUpRight,
  BellRing,
  CalendarDays,
  ChartNoAxesCombined,
  CircleDollarSign,
  FileDown,
  FileText,
  Info,
  Layers,
  MessageSquareWarning,
  ShieldCheck,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { BotonGuardar } from "@/components/gobserva/cuenta/BotonGuardar";
import { ListaItems, type ItemLimpio } from "@/components/licitaciones/ListaItems";
import { ChipNeutro, ChipTipo, MontoCompacto, TONO_PLAZO, plazo, quedan } from "@/components/licitaciones/Piezas";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Nota, Volver } from "@/components/patrones/Estructura";
import { Dato } from "@/components/ui/Dato";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { decimal, fechaCorta, numero, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { fichaEmpresaVigia, palabrasClave, rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { tituloNatural } from "@/lib/landing";
import { tildesEnTitulo } from "@/lib/tildes";
import { TIPO_DOCUMENTO, getFicha, haceDias, limpiar, nombreRegion, ordenarDocumentos, rubroDe, sinValorHabitual, type Ficha } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: { ocid: string } }): Promise<Metadata> {
  const f = await getFicha(decodeURIComponent(params.ocid));
  if (!f) return { title: "Oportunidad no encontrada" };
  const objeto = limpiar(f.objeto).slice(0, 90) || "Convocatoria";
  return {
    title: objeto,
    description: `${objeto}. ${f.entidad ? tituloNatural(f.entidad) : "Entidad pública"}, ${nombreRegion(f.region)}. ${f.valor ? `Valor referencial ${solesCompacto(f.valor)}.` : ""} Ítems, bases y quién gana procesos parecidos.`,
    alternates: { canonical: urlCanonica("licitaciones", `/oportunidad/${encodeURIComponent(f.ocid)}`) },
  };
}

/**
 * La ficha de una oportunidad (modo operar, 2026-11-02). Arriba, lo que decide si conviene competir, en cuatro datos:
 * cuánto vale (y a cuánto suele adjudicar la entidad), hasta cuándo hay consultas, cuántos compiten en esa entidad y
 * quién gana los procesos parecidos; y las acciones: bajar las bases, el portal oficial, guardar y crear la alerta. Después,
 * qué se compra (ítems con su CUBSO, todos y con buscador), las bases, la entidad en 12 meses (sus proveedores), los
 * precios de referencia de cada ítem y los procesos parecidos con quién los ganó. En el celular las acciones van justo
 * debajo de los cuatro datos y la entidad antes de los precios (la columna lateral se reparte con `order`).
 * GET /licitaciones/oportunidades/:ocid.
 */
export default async function FichaOportunidad({ params }: { params: { ocid: string } }) {
  const base = baseProducto("licitaciones");
  const f = await getFicha(decodeURIComponent(params.ocid));
  if (!f) notFound();
  const ruta = (p: string) => rutaEn(base, p);
  const intel = f.inteligencia ?? {};
  const unSolo = intel.conPostores ? (intel.unSoloPostor ?? 0) / intel.conPostores : null;
  const objeto = limpiar(f.objeto) || "Convocatoria sin objeto registrado";
  const entidad = f.entidad ? tituloNatural(f.entidad) : "Entidad sin nombre registrado";
  const rubro = rubroDe(f.objeto);
  const consultas = plazo(f.consultas?.hasta);
  const docs = ordenarDocumentos(f.documentos);
  const bases = docs.find((d) => d.tipo === "biddingDocuments") ?? null;
  const portal = f.enlaces.busqueda ?? f.enlaces.oece;
  const items: ItemLimpio[] = [...f.items]
    .sort((a, b) => a.posicion - b.posicion)
    .map((i) => {
      const descripcion = limpiar(i.descripcion) || "Ítem sin descripción";
      const cubsoNombre = limpiar(i.cubsoNombre);
      return {
        posicion: i.posicion,
        descripcion,
        cantidad: i.cantidad,
        unidad: i.unidad ? i.unidad.toLocaleLowerCase("es-PE") : null,
        cubso: i.cubso,
        cubsoNombre: cubsoNombre && cubsoNombre.toLocaleLowerCase("es-PE") !== descripcion.toLocaleLowerCase("es-PE") ? cubsoNombre : null,
        valor: i.valor,
      };
    });
  const gana = quienGana(f.parecidos);
  const alerta = `${ruta("/oportunidades")}?${new URLSearchParams({
    q: rubro || palabrasClave(limpiar(f.objeto), 2),
    ...(f.region ? { region: f.region } : {}),
    ...(f.tipo ? { tipo: f.tipo } : {}),
  })}#crear-alerta`;

  return (
    <div className="container-page py-6 sm:py-10">
      <Volver href={ruta("/oportunidades")} className="min-h-11">
        Oportunidades
      </Volver>

      <div className="mt-2 grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-x-10">
        {/* La columna principal; en el celular sus piezas se intercalan con las de la lateral (order). */}
        <div className="contents lg:block lg:min-w-0 lg:space-y-10">
          <div className="order-1 min-w-0 space-y-5">
            <header className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <ChipTipo tipo={f.tipo} />
                {f.procedimiento && <ChipNeutro>{tildesEnTitulo(f.procedimiento)}</ChipNeutro>}
                {/* Una que ya pasó de etapa no es una oportunidad abierta: se dice arriba. */}
                {f.etapa && f.etapa !== "convocada" && (
                  <span className="rounded-full bg-amber-soft px-2.5 py-0.5 text-rotulo font-semibold text-amberTexto">Etapa: {f.etapa}</span>
                )}
              </div>
              <h1 className="mt-3 text-balance font-display text-seccion font-bold leading-snug tracking-tight text-ink sm:text-cifra sm:leading-tight lg:text-titulo">
                {objeto}
              </h1>
              <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-dato text-inkSoft">
                <Dato tipo="entidad" className="font-medium text-ink">
                  {entidad}
                </Dato>
                <Dato tipo="lugar">
                  {nombreRegion(f.region)}
                  {f.entidadProvincia ? `, ${tituloNatural(f.entidadProvincia)}` : ""}
                </Dato>
                <Dato icono={CalendarDays}>{`Convocada el ${fechaCorta(f.fecha)} (${haceDias(f.fecha)})`}</Dato>
                <Dato tipo="codigo" mono>
                  {f.codigo ?? f.ocid}
                </Dato>
              </p>
              {f.descripcion && limpiar(f.descripcion) !== objeto && <p className="mt-3 max-w-[72ch] text-cuerpo leading-relaxed text-inkSoft">{limpiar(f.descripcion)}</p>}
            </header>

            {/* Lo que decide si conviene competir. */}
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line xl:grid-cols-4">
              <Clave
                Icono={CircleDollarSign}
                etiqueta="Valor referencial"
                ayuda={
                  <Ayuda titulo="¿Qué es el valor referencial?">
                    El monto que la entidad calculó para esta compra (su estudio de mercado o el presupuesto de la obra). Las ofertas se comparan con él.
                  </Ayuda>
                }
                valor={f.valor ? soles(f.valor) : "No publicado"}
                tono={f.valor ? undefined : "text-inkSoft"}
              >
                {f.valor
                  ? intel.adjSobreRef
                    ? `En promedio, la entidad adjudica al ${porcentaje(intel.adjSobreRef * 100)} del referencial: serían unos ${solesCompacto(f.valor * intel.adjSobreRef)}.`
                    : "Publicado en la convocatoria."
                  : sinValorHabitual(f.procedimiento)
                    ? "Suele pasar en la subasta inversa y la comparación de precios: míralo en las bases."
                    : "La entidad no lo publicó en los datos abiertos: míralo en las bases."}
              </Clave>
              <Clave
                Icono={MessageSquareWarning}
                etiqueta="Consultas y observaciones"
                ayuda={
                  <Ayuda titulo="¿Qué es el plazo de consultas?">
                    Hasta esa fecha puedes hacerle preguntas a la entidad sobre las bases o pedirle que corrija algo (observaciones). Las ofertas se presentan
                    después: la fecha exacta está en el cronograma del proceso, en el SEACE.
                  </Ayuda>
                }
                valor={
                  !consultas || !f.consultas?.hasta
                    ? "Sin fecha publicada"
                    : consultas.tono === "cerrado"
                      ? `Cerró el ${fechaCorta(f.consultas?.hasta)}`
                      : `Hasta el ${fechaCorta(f.consultas?.hasta)}`
                }
                tono={!consultas || consultas.tono === "cerrado" ? "text-inkSoft" : undefined}
              >
                {consultas && consultas.tono !== "cerrado" ? (
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-rotulo font-semibold", TONO_PLAZO[consultas.tono])}>{quedan(consultas.dias)}</span>
                ) : consultas ? (
                  "Mira en el cronograma del SEACE las etapas que siguen."
                ) : (
                  "La entidad no la publicó en los datos abiertos: está en el cronograma del SEACE."
                )}
              </Clave>
              <Clave
                Icono={Users}
                etiqueta="Postores en esta entidad"
                ayuda={
                  <Ayuda titulo="¿Qué es un postor?">
                    Una empresa o un consorcio que presentó su oferta. Es el promedio de los procesos que la entidad adjudicó en los últimos 12 meses (CONOSCE, OECE).
                  </Ayuda>
                }
                valor={intel.postoresPromedio ? `${decimal(intel.postoresPromedio)} por proceso` : "Sin dato"}
                tono={intel.postoresPromedio ? undefined : "text-inkSoft"}
              >
                {unSolo != null
                  ? `${porcentaje(unSolo * 100)} de sus procesos tuvo un solo postor.`
                  : "La entidad no tiene procesos adjudicados con postores en los últimos 12 meses."}
              </Clave>
              <Clave Icono={Trophy} etiqueta="Quién gana lo parecido" valor={gana.valor} tono={gana.nombre ? undefined : "text-inkSoft"} recortar>
                {gana.contexto}
              </Clave>
            </dl>
          </div>

          {/* Qué se compra */}
          <section aria-labelledby="items-t" className="order-3 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 id="items-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                <Layers size={18} aria-hidden className="text-granate" /> Qué se compra
              </h2>
              <span className="text-dato text-mute">
                {numero(items.length)} {items.length === 1 ? "ítem" : "ítems"}
              </span>
              {items.some((i) => i.cubso) && (
                <Ayuda titulo="¿Qué es el CUBSO?">
                  El Catálogo Único de Bienes, Servicios y Obras del OECE: el código con que el Estado clasifica lo que compra. Con él se comparan los precios y los
                  procesos de distintas entidades.
                </Ayuda>
              )}
            </div>
            {items.length === 0 ? (
              <Nota className="mt-3">Los datos abiertos no traen los ítems de esta convocatoria: están en las bases.</Nota>
            ) : (
              <ListaItems items={items} />
            )}
          </section>

          {/* Documentos */}
          {docs.length > 0 && (
            <section id="documentos" aria-labelledby="docs-t" className="order-3 min-w-0 scroll-mt-24">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 id="docs-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                  <FileDown size={18} aria-hidden className="text-granate" /> Bases y documentos
                </h2>
                <span className="text-dato text-mute">
                  {numero(docs.length)} {docs.length === 1 ? "documento" : "documentos"}
                </span>
              </div>
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {docs.map((d) => (
                  <li key={d.url} className="min-w-0">
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "group flex min-h-14 min-w-0 items-center gap-3 rounded-xl border bg-paper px-3.5 py-3 transition-colors duration-rapido hover:border-granate/50",
                        d.tipo === "biddingDocuments" ? "border-granate/40" : "border-line",
                      )}
                    >
                      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-granate-50 text-granate">
                        {d.tipo === "biddingDocuments" ? <FileDown size={18} /> : <FileText size={18} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-dato font-semibold text-ink group-hover:text-granate">{limpiar(d.titulo) || "Documento"}</span>
                        <span className="block text-rotulo text-mute">
                          {d.tipo ? TIPO_DOCUMENTO[d.tipo] ?? "Documento" : "Documento"}
                          {d.fecha ? `, ${fechaCorta(d.fecha)}` : ""}
                          {formatoDoc(d) ? `, ${formatoDoc(d)}` : ""}
                        </span>
                      </span>
                      <ArrowUpRight size={15} aria-hidden className="shrink-0 text-mute group-hover:text-granate" />
                      <span className="sr-only"> (se abre en otra pestaña, en el SEACE)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Precios de referencia */}
          {f.precios.length > 0 && (
            <section aria-labelledby="precios-t" className="order-5 min-w-0">
              <h2 id="precios-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                <CircleDollarSign size={18} aria-hidden className="text-granate" /> A qué precio compra esto el Estado
              </h2>
              <p className="mt-1 max-w-[72ch] text-meta leading-snug text-inkSoft">
                El precio típico de cada ítem en compras de otras entidades, por su CUBSO y unidad (OCDS y CONOSCE). La barra va del cuarto más barato al cuarto
                más caro de esas compras; la raya es el precio típico (la mediana).
              </p>
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {f.precios.map((pr) => (
                  <TarjetaPrecio key={`${pr.cubso}-${pr.unidad}`} pr={pr} items={items} />
                ))}
              </ul>
            </section>
          )}

          {/* Procesos parecidos */}
          <section aria-labelledby="parecidos-t" className="order-6 min-w-0">
            <h2 id="parecidos-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
              <Trophy size={18} aria-hidden className="text-granate" /> Procesos parecidos y quién los ganó
            </h2>
            {f.parecidos.length === 0 ? (
              <div className="mt-3 flex flex-col items-start gap-3 rounded-2xl border border-line bg-paperSoft p-4 sm:flex-row sm:items-center">
                <p className="min-w-0 flex-1 text-dato text-inkSoft">No hay procesos adjudicados con el mismo CUBSO desde el año pasado.</p>
                {rubro && (
                  <Link href={`${ruta("/mercado")}?q=${encodeURIComponent(rubro)}`} className={claseAccion("secundario", "min-h-11 shrink-0")}>
                    <ChartNoAxesCombined size={16} aria-hidden /> Ver el mercado de «{rubro}»
                  </Link>
                )}
              </div>
            ) : (
              <>
                <p className="mt-1 max-w-[72ch] text-meta leading-snug text-inkSoft">
                  Las {numero(f.parecidos.length)} adjudicaciones más recientes con el mismo CUBSO, desde el año pasado. De quien ganó, el nombre sólo si es una
                  empresa (RUC 20).
                </p>
                <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
                  {f.parecidos.map((x, n) => (
                    <FilaParecido key={`${x.ocid}-${n}`} x={x} />
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        {/* La columna lateral: las acciones, la entidad y el mercado. */}
        <div className="contents lg:block lg:min-w-0 lg:space-y-4">
          <div className="order-2 min-w-0 rounded-2xl border border-line bg-paper p-4 sm:p-5">
            {bases ? (
              <a href={bases.url} target="_blank" rel="noopener noreferrer" className={claseAccion("primario", "min-h-11 w-full")}>
                <FileDown size={16} aria-hidden /> Descargar las bases
                <span className="sr-only"> (se abre en el SEACE, en otra pestaña)</span>
              </a>
            ) : docs.length > 0 ? (
              <a href="#documentos" className={claseAccion("primario", "min-h-11 w-full")}>
                <FileText size={16} aria-hidden /> Ver los documentos
              </a>
            ) : null}
            <a href={portal} target="_blank" rel="noopener noreferrer" className={claseAccion(docs.length > 0 ? "secundario" : "primario", "mt-2 min-h-11 w-full")}>
              Ver en el portal oficial <ArrowUpRight size={16} aria-hidden />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {/* BotonGuardar lee la URL (useSearchParams): va dentro de Suspense. */}
              <Suspense fallback={<span aria-hidden className="inline-block h-11 w-full animate-pulse rounded-full bg-paperDeep" />}>
                <BotonGuardar
                  producto="licitaciones"
                  base={base}
                  tipo="oportunidad"
                  codigo={f.ocid}
                  titulo={objeto || f.codigo || f.ocid}
                  datos={{ cierre: f.consultas?.hasta ?? null, entidad: f.entidad ?? null }}
                  className="min-h-11 w-full"
                />
              </Suspense>
              <Link href={alerta} className={claseAccion("secundario", "min-h-11 w-full px-3")}>
                <BellRing size={16} aria-hidden /> Crear alerta
              </Link>
            </div>
            <p className="mt-3 flex items-start gap-2 text-meta leading-snug text-inkSoft">
              <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-mute" />
              <span>Las ofertas se presentan en el SEACE, según el cronograma del proceso. La alerta te avisa de las nuevas que se parezcan a esta.</span>
            </p>
          </div>

          <section aria-labelledby="entidad-t" className="sobre-oscuro order-4 min-w-0 rounded-3xl bg-ink p-5 text-paper sm:p-6">
            <h2 id="entidad-t" className="font-display text-bloque font-bold leading-tight">
              La entidad en 12 meses
            </h2>
            <p className="mt-1 text-meta leading-snug text-paper/70">Lo que adjudicó y a quién, según CONOSCE (OECE).</p>
            {intel.procesos ? (
              <>
                <dl className="mt-4 grid grid-cols-2 gap-2.5">
                  <Mini valor={numero(intel.procesos)} etiqueta={intel.procesos === 1 ? "proceso adjudicado" : "procesos adjudicados"} />
                  <Mini valor={<MontoCompacto valor={intel.monto ?? 0} unidad="text-dato" />} etiqueta="adjudicados en total" />
                </dl>
                {intel.adjSobreRef ? (
                  <p className="mt-2.5 flex items-start gap-2 rounded-xl bg-paper/[0.07] px-3 py-2.5 text-meta leading-snug text-paper/85">
                    <ChartNoAxesCombined size={15} aria-hidden className="mt-0.5 shrink-0 text-maiz" />
                    <span>
                      Adjudica, en promedio, al <b className="text-maiz">{porcentaje(intel.adjSobreRef * 100)}</b> del valor referencial.
                    </span>
                  </p>
                ) : null}
                {(intel.proveedores ?? []).length > 0 && (
                  <div className="mt-5">
                    <h3 className="flex items-center gap-1.5 text-cuerpo font-semibold text-paper">
                      <Users size={15} aria-hidden className="text-maiz" />
                      {(intel.proveedores ?? []).length === 1 ? "La empresa que más le vendió" : `Las ${numero((intel.proveedores ?? []).length)} empresas que más le vendieron`}
                    </h3>
                    {/* Barras propias (claras sobre la banda oscura): la mayor llena la barra. */}
                    <ol className="mt-3 space-y-3">
                      {(intel.proveedores ?? []).map((p, _i, todos) => {
                        const mayor = Math.max(1, ...todos.map((x) => x.monto ?? 0));
                        return (
                          <li key={p.ruc} className="min-w-0">
                            <span className="flex items-baseline justify-between gap-2 text-meta">
                              {fichaEmpresaVigia(p.ruc) ? (
                                // Su historial completo en Vigía (sólo empresas, RUC 20).
                                <a href={fichaEmpresaVigia(p.ruc)!} className="min-w-0 truncate text-paper underline-offset-2 hover:underline" title={`${p.nombre ?? p.ruc}: su historial en Vigía`}>
                                  {p.nombre ? tituloNatural(p.nombre) : p.ruc}
                                </a>
                              ) : (
                                <span className="min-w-0 truncate text-paper" title={p.nombre ?? p.ruc}>
                                  {p.nombre ? tituloNatural(p.nombre) : p.ruc}
                                </span>
                              )}
                              <span className="shrink-0 font-mono tabular-nums text-paper/85">{solesCompacto(p.monto ?? 0)}</span>
                            </span>
                            <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-paper/10">
                              <span className="block h-full rounded-full bg-maiz" style={{ width: `${Math.max(3, ((p.monto ?? 0) / mayor) * 100)}%` }} />
                            </span>
                            <span className="mt-0.5 block text-rotulo text-paper/60">
                              {numero(p.procesos)} {p.procesos === 1 ? "proceso" : "procesos"}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-4 text-dato text-paper/80">Sin adjudicaciones de esta entidad en CONOSCE en los últimos 12 meses.</p>
            )}
            {f.entidadRuc && (
              <a
                href={`https://vigia.gobserva.cloud/entidad/${f.entidadRuc}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-meta font-semibold text-maiz underline-offset-2 hover:underline"
              >
                <ShieldCheck size={15} aria-hidden /> Sus antecedentes en Vigía <ArrowUpRight size={13} aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            )}
          </section>

          {rubro && (
            <Link
              href={`${ruta("/mercado")}?q=${encodeURIComponent(rubro)}`}
              className="group order-7 flex min-w-0 items-start gap-3 rounded-2xl border border-line bg-paperSoft p-4 transition-colors duration-rapido hover:border-granate/40 sm:p-5"
            >
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-granate-50 text-granate">
                <ChartNoAxesCombined size={18} />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-bloque font-bold leading-tight text-ink group-hover:text-granate">El mercado de «{rubro}»</span>
                <span className="mt-1 block text-meta leading-snug text-inkSoft">Cuánto le compró el Estado en 12 meses, quién compra, quién gana y cuántos compiten.</span>
              </span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** Uno de los cuatro datos de arriba: qué es (con su ⓘ), el valor y una línea de contexto. */
function Clave({
  Icono,
  etiqueta,
  ayuda,
  valor,
  tono,
  recortar = false,
  children,
}: {
  Icono: LucideIcon;
  etiqueta: string;
  ayuda?: ReactNode;
  valor: ReactNode;
  tono?: string;
  /** Un nombre largo (una empresa) va en dos líneas como mucho. */
  recortar?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 bg-paper p-4">
      <dt className="flex min-w-0 items-center gap-1.5 text-rotulo font-medium text-mute">
        <Icono size={14} aria-hidden className="shrink-0 text-granate" />
        <span className="min-w-0">{etiqueta}</span>
        {ayuda}
      </dt>
      <dd className="min-w-0">
        <span className={cn("block font-display font-bold leading-tight tabular-nums text-ink", recortar ? "line-clamp-2 text-cuerpo sm:text-destacado" : "text-cuerpo sm:text-bloque", tono)}>
          {valor}
        </span>
        {children && <span className="mt-1.5 block text-meta leading-snug text-inkSoft">{children}</span>}
      </dd>
    </div>
  );
}

function Mini({ valor, etiqueta }: { valor: ReactNode; etiqueta: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse rounded-xl bg-paper/[0.07] px-3 py-2.5">
      <dt className="mt-1 text-rotulo leading-snug text-paper/70">{etiqueta}</dt>
      <dd className="font-display text-bloque font-bold leading-none tabular-nums text-paper">{valor}</dd>
    </div>
  );
}

/**
 * Quién gana lo parecido: la empresa (RUC 20) que más procesos parecidos ganó, contando procesos y no ítems. Si ninguna se
 * repite o los ganaron consorcios y personas naturales (sin nombre), se dice eso.
 */
function quienGana(parecidos: Ficha["parecidos"]): { nombre: string | null; valor: string; contexto: string } {
  const procesos = new Set(parecidos.map((p) => p.ocid)).size;
  if (procesos === 0) return { nombre: null, valor: "Sin procesos parecidos", contexto: "No hay adjudicaciones con el mismo CUBSO desde el año pasado." };
  const porEmpresa = new Map<string, { nombre: string; procesos: Set<string> }>();
  for (const p of parecidos) {
    if (!p.proveedor) continue;
    const k = p.ruc ?? p.proveedor;
    const x = porEmpresa.get(k) ?? { nombre: p.proveedor, procesos: new Set<string>() };
    x.procesos.add(p.ocid);
    porEmpresa.set(k, x);
  }
  const primera = [...porEmpresa.values()].sort((a, b) => b.procesos.size - a.procesos.size)[0];
  if (!primera) {
    return procesos === 1
      ? { nombre: null, valor: "Un consorcio o una persona natural", contexto: "Ganó el único proceso parecido; su nombre no se muestra." }
      : { nombre: null, valor: "Consorcios o personas naturales", contexto: `Ganaron los ${numero(procesos)} procesos parecidos; sus nombres no se muestran.` };
  }
  if (procesos === 1) return { nombre: primera.nombre, valor: tituloNatural(primera.nombre), contexto: "Ganó el único proceso parecido." };
  if (primera.procesos.size < 2) return { nombre: null, valor: "Ninguna empresa se repite", contexto: `En los ${numero(procesos)} procesos parecidos, cada empresa ganó uno como mucho.` };
  return { nombre: primera.nombre, valor: tituloNatural(primera.nombre), contexto: `Ganó ${numero(primera.procesos.size)} de los ${numero(procesos)} procesos parecidos.` };
}

/** El formato de un documento, si se sabe: «PDF», «Word», «Excel», «ZIP». */
function formatoDoc(d: { formato: string | null; url: string }): string | null {
  const s = `${d.formato ?? ""} ${d.url}`.toLowerCase();
  if (/pdf/.test(s)) return "PDF";
  if (/zip|rar/.test(s)) return "ZIP";
  if (/xls|sheet|excel/.test(s)) return "Excel";
  if (/doc|word/.test(s)) return "Word";
  return null;
}

/** El precio de referencia de un ítem: su nombre, el precio típico, el rango y, si se puede calcular, el de esta convocatoria. */
function TarjetaPrecio({ pr, items }: { pr: Ficha["precios"][number]; items: ItemLimpio[] }) {
  const unidad = pr.unidad.toLocaleLowerCase("es-PE");
  const delCubso = items.filter((i) => i.cubso === pr.cubso);
  const nombre = delCubso[0] ? (delCubso[0].cubsoNombre ?? delCubso[0].descripcion) : null;
  // El precio por unidad de esta convocatoria: el valor del ítem entre su cantidad, si la unidad es la misma.
  const propio = delCubso.find((i) => i.valor != null && i.cantidad != null && i.cantidad > 0 && i.unidad === unidad);
  const unitario = propio && propio.valor != null && propio.cantidad ? propio.valor / propio.cantidad : null;
  const frente = unitario != null && pr.mediana ? unitario / pr.mediana - 1 : null;
  return (
    <li className="flex min-w-0 flex-col rounded-2xl border border-line bg-paper p-4">
      <p className="line-clamp-2 text-dato font-semibold leading-snug text-ink">{nombre ?? `CUBSO ${pr.cubso}`}</p>
      <p className="mt-0.5 text-rotulo text-mute">
        <span className="font-mono">CUBSO {pr.cubso}</span>, precio por {unidad}
      </p>
      <p className="mt-3 font-display text-cifra font-bold leading-none tabular-nums text-ink">{pr.mediana != null ? soles(pr.mediana) : "Sin dato"}</p>
      <p className="mt-1.5 text-meta leading-snug text-inkSoft">
        Precio {pr.base === "adjudicado" ? "adjudicado" : "referencial"} típico en {pr.anio}, en {numero(pr.n)} compras de {numero(pr.entidades)}{" "}
        {pr.entidades === 1 ? "entidad" : "entidades"}.
      </p>
      <RangoPrecio p25={pr.p25} mediana={pr.mediana} p75={pr.p75} propio={unitario} />
      {unitario != null && frente != null && (
        <p className="mt-2.5 flex items-start gap-2 text-meta leading-snug text-inkSoft">
          <span aria-hidden className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-amber" />
          <span>
            Esta convocatoria: <b className="font-semibold text-ink">{soles(unitario)}</b> por {unidad},{" "}
            {Math.abs(frente) < 0.005 ? "igual al típico" : `${porcentaje(Math.abs(frente) * 100)} ${frente > 0 ? "sobre" : "bajo"} el típico`}.
          </span>
        </p>
      )}
    </li>
  );
}

/** La barra del rango: del cuarto más barato al más caro, la raya en el precio típico y, en ámbar, el de esta convocatoria. */
function RangoPrecio({ p25, mediana, p75, propio }: { p25: number | null; mediana: number | null; p75: number | null; propio: number | null }) {
  if (p25 == null || p75 == null || mediana == null || p75 < p25) return null;
  const min = Math.min(p25, propio ?? p25);
  const max = Math.max(p75, propio ?? p75);
  const holgura = (max - min) * 0.15 || Math.max(1, max * 0.1);
  const desde = Math.max(0, min - holgura);
  const hasta = max + holgura;
  const pos = (x: number) => ((x - desde) / (hasta - desde)) * 100;
  return (
    <div className="mt-auto pt-4">
      <div aria-hidden className="relative h-2.5 rounded-full bg-paperDeep">
        <span className="absolute inset-y-0 rounded-full bg-granate/30" style={{ left: `${pos(p25)}%`, width: `${Math.max(1, pos(p75) - pos(p25))}%` }} />
        <span className="absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 rounded-full bg-granate" style={{ left: `${pos(mediana)}%` }} />
        {propio != null && <span className="absolute -bottom-1.5 -top-1.5 w-1 -translate-x-1/2 rounded-full bg-amber" style={{ left: `${pos(propio)}%` }} />}
      </div>
      <dl className="mt-2 flex justify-between gap-3 text-rotulo">
        <div>
          <dt className="text-mute">Desde</dt>
          <dd className="font-semibold tabular-nums text-ink">{soles(p25)}</dd>
        </div>
        <div className="text-right">
          <dt className="text-mute">Hasta</dt>
          <dd className="font-semibold tabular-nums text-ink">{soles(p75)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Un proceso parecido: qué se compró, quién y cuándo, quién ganó y a qué precio (por unidad si se compró más de una). */
function FilaParecido({ x }: { x: Ficha["parecidos"][number] }) {
  const rebaja = x.unitRef && x.unitAdj ? 1 - x.unitAdj / x.unitRef : null;
  const unidad = x.unidad ? x.unidad.toLocaleLowerCase("es-PE") : "unidad";
  const porUnidad = x.cantidad != null && x.cantidad !== 1;
  const precio = x.unitAdj ?? (x.cantidad === 1 ? x.adjudicado : null);
  return (
    <li className="grid gap-x-6 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0">
        <p className="line-clamp-2 text-dato font-medium leading-snug text-ink">{limpiar(x.descripcion || x.objeto) || "Proceso sin descripción"}</p>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-meta text-inkSoft">
          <Dato tipo="entidad">{x.entidad ? tituloNatural(x.entidad) : "Entidad sin nombre"}</Dato>
          {x.fecha && <Dato tipo="fecha">{fechaCorta(x.fecha)}</Dato>}
          {x.cantidad != null && <Dato icono={Layers} nombre="Cantidad">{`${Number.isInteger(x.cantidad) ? numero(x.cantidad) : decimal(x.cantidad, 2)} ${unidad}`}</Dato>}
        </p>
        <p className="mt-1.5 flex items-start gap-1.5 text-meta leading-snug">
          <Trophy size={14} aria-hidden className="mt-0.5 shrink-0 text-granate" />
          {x.proveedor ? (
            <span className="min-w-0 text-inkSoft">
              Ganó <span className="font-semibold text-ink">{tituloNatural(x.proveedor)}</span>
            </span>
          ) : (
            <span className="text-mute">Ganó un consorcio o una persona natural</span>
          )}
        </p>
      </div>
      {precio != null && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 sm:flex-col sm:items-end sm:text-right">
          <span className="font-display text-bloque font-bold leading-tight tabular-nums text-ink">{soles(precio)}</span>
          <span className="text-rotulo text-mute">{porUnidad ? `por ${unidad}, adjudicado` : "adjudicado"}</span>
          {rebaja != null && rebaja > 0.005 && (
            <span className="rounded-full bg-moss/10 px-2 py-0.5 text-rotulo font-semibold text-mossTexto">{porcentaje(rebaja * 100)} bajo el referencial</span>
          )}
        </div>
      )}
    </li>
  );
}
