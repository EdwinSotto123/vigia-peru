import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BellRing,
  Building2,
  CalendarDays,
  CircleDollarSign,
  FileDown,
  Hash,
  Layers,
  MapPin,
  MessageSquareWarning,
  ShieldCheck,
  Users,
} from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { decimal, fechaCorta, numero, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { palabrasClave, rutaEn, urlCanonica } from "@/lib/gobserva";
import { BotonGuardar } from "@/components/gobserva/cuenta/BotonGuardar";
import { baseProducto } from "@/lib/gobserva-servidor";
import { tituloNatural } from "@/lib/landing";
import { TIPO_DOCUMENTO, diasHasta, getFicha, haceDias, limpiar, nombreRegion, nombreTipo } from "@/lib/licitaciones";

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
 * La ficha de una oportunidad: qué se compra (ítems con su CUBSO), quién y dónde, el valor referencial, las fechas que se
 * conocen y las bases; y la inteligencia: la entidad en 12 meses (sus proveedores, cuántos compiten, cuánto adjudica
 * frente al referencial), los precios de referencia del mismo CUBSO y procesos parecidos con quién los ganó.
 * GET /licitaciones/oportunidades/:ocid.
 */
export default async function FichaOportunidad({ params }: { params: { ocid: string } }) {
  const base = baseProducto("licitaciones");
  const f = await getFicha(decodeURIComponent(params.ocid));
  if (!f) notFound();
  const ruta = (p: string) => rutaEn(base, p);
  const consultas = diasHasta(f.consultas?.hasta);
  const intel = f.inteligencia ?? {};
  const unSolo = intel.conPostores ? (intel.unSoloPostor ?? 0) / intel.conPostores : null;
  const rubro = limpiar(f.objeto).split(" ").filter((w) => w.length > 4).slice(0, 3).join(" ");

  return (
    <div className="container-page py-8 sm:py-12">
      <Link href={ruta("/oportunidades")} className="inline-flex items-center gap-1 text-meta font-semibold text-granate underline-offset-2 hover:underline">
        <ArrowLeft size={15} aria-hidden /> Oportunidades
      </Link>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── La convocatoria ── */}
        <div className="min-w-0 space-y-8">
          <header>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-granate-50 px-2.5 py-0.5 text-rotulo font-semibold text-granate">{nombreTipo(f.tipo)}</span>
              {f.procedimiento && <span className="rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">{f.procedimiento}</span>}
              <span className="rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">Convocada {haceDias(f.fecha)}</span>
              {/* Una que ya pasó de etapa no es una oportunidad abierta: se dice arriba. */}
              {f.etapa && f.etapa !== "convocada" && (
                <span className="rounded-full bg-amber-soft px-2.5 py-0.5 text-rotulo font-semibold text-amberTexto">Etapa: {f.etapa}</span>
              )}
            </div>
            <h1 className="mt-3 text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">{limpiar(f.objeto) || "Convocatoria sin objeto registrado"}</h1>
            {f.descripcion && limpiar(f.descripcion) !== limpiar(f.objeto) && <p className="mt-3 max-w-[72ch] text-cuerpo leading-relaxed text-inkSoft">{limpiar(f.descripcion)}</p>}
          </header>

          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DatoFicha Icono={Building2} etiqueta="Quién compra">
              {f.entidad ? tituloNatural(f.entidad) : "Entidad sin nombre registrado"}
            </DatoFicha>
            <DatoFicha Icono={MapPin} etiqueta="Dónde">
              {nombreRegion(f.region)}
              {f.entidadProvincia ? `, ${tituloNatural(f.entidadProvincia)}` : ""}
            </DatoFicha>
            <DatoFicha Icono={CircleDollarSign} etiqueta="Valor referencial">
              {f.valor ? soles(f.valor) : "No publicado (suele pasar en subasta inversa y comparación de precios)"}
            </DatoFicha>
            <DatoFicha Icono={CalendarDays} etiqueta="Convocada">
              {fechaCorta(f.fecha)} ({haceDias(f.fecha)})
            </DatoFicha>
            <DatoFicha Icono={MessageSquareWarning} etiqueta="Consultas y observaciones">
              {f.consultas?.hasta ? (
                <>
                  {f.consultas.desde && f.consultas.desde !== f.consultas.hasta ? `Del ${fechaCorta(f.consultas.desde)} al ` : "Hasta el "}
                  {fechaCorta(f.consultas.hasta)}
                  {consultas != null && consultas >= 0 && <span className="ml-1 font-semibold text-amberTexto">({consultas === 0 ? "vence hoy" : `quedan ${numero(consultas)} días`})</span>}
                </>
              ) : (
                "La entidad no publicó el plazo en el OCDS: míralo en el cronograma del SEACE"
              )}
            </DatoFicha>
            <DatoFicha Icono={Hash} etiqueta="Código del proceso">
              <span className="font-mono">{f.codigo ?? f.ocid}</span>
            </DatoFicha>
          </dl>

          {/* Ítems */}
          <section aria-labelledby="items-t">
            <h2 id="items-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
              <Layers size={18} aria-hidden className="text-granate" /> Qué se compra ({numero(f.items.length)} {f.items.length === 1 ? "ítem" : "ítems"})
            </h2>
            {f.items.length === 0 ? (
              <p className="mt-3 text-dato text-mute">El OCDS no trae los ítems de esta convocatoria: están en las bases.</p>
            ) : (
              <ol className="mt-3 divide-y divide-line rounded-2xl border border-line bg-paper">
                {/* recorte: los primeros 40 ítems; el resto está en las bases y en el SEACE (más ítems abajo). */}
                {f.items.slice(0, 40).map((i) => (
                  <li key={i.posicion} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 px-4 py-3">
                    <span className="font-mono text-meta font-semibold text-mute">{numero(i.posicion)}</span>
                    <div className="min-w-0">
                      <p className="text-dato font-medium leading-snug text-ink">{limpiar(i.descripcion) || "Ítem sin descripción"}</p>
                      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-meta text-inkSoft">
                        {i.cantidad != null && (
                          <span>
                            {numero(i.cantidad)} {i.unidad ? i.unidad.toLocaleLowerCase("es-PE") : ""}
                          </span>
                        )}
                        {i.valor != null && <span>Valor del ítem: {solesCompacto(i.valor)}</span>}
                        {i.cubso && (
                          <span title={i.cubsoNombre ?? undefined}>
                            CUBSO <span className="font-mono">{i.cubso}</span>
                            {i.cubsoNombre ? `: ${limpiar(i.cubsoNombre)}` : ""}
                          </span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {f.items.length > 40 && <p className="mt-2 text-meta text-mute">Y {numero(f.items.length - 40)} ítems más en las bases.</p>}
          </section>

          {/* Documentos */}
          {f.documentos.length > 0 && (
            <section aria-labelledby="docs-t">
              <h2 id="docs-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                <FileDown size={18} aria-hidden className="text-granate" /> Bases y documentos
              </h2>
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {f.documentos.map((d) => (
                  <li key={d.url} className="min-w-0">
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 transition-colors duration-rapido hover:border-granate/40"
                    >
                      <FileDown size={18} aria-hidden className="shrink-0 text-granate" />
                      <span className="min-w-0">
                        <span className="block truncate text-dato font-medium text-ink">{limpiar(d.titulo)}</span>
                        <span className="block text-rotulo text-mute">
                          {d.tipo ? TIPO_DOCUMENTO[d.tipo] ?? "Documento" : "Documento"}
                          {d.fecha ? `, ${fechaCorta(d.fecha)}` : ""}
                        </span>
                      </span>
                      <span className="sr-only"> (se abre en otra pestaña, en el SEACE)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Precios de referencia */}
          {f.precios.length > 0 && (
            <section aria-labelledby="precios-t">
              <h2 id="precios-t" className="font-display text-bloque font-bold text-ink">
                A qué precio se compra esto en el Estado
              </h2>
              <p className="mt-1 text-meta text-mute">Por CUBSO y unidad, de procesos de otras entidades (OCDS y CONOSCE). El rango va del cuarto más barato al cuarto más caro.</p>
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {f.precios.map((p) => (
                  <li key={`${p.cubso}-${p.unidad}`} className="min-w-0 rounded-2xl border border-line bg-paper p-4">
                    <p className="text-meta text-mute">
                      CUBSO <span className="font-mono">{p.cubso}</span>, por {p.unidad.toLocaleLowerCase("es-PE")}
                    </p>
                    <p className="mt-2 font-display text-cifra font-bold leading-none tabular-nums text-ink">{p.mediana != null ? soles(p.mediana) : "Sin dato"}</p>
                    <p className="mt-1 text-meta text-inkSoft">
                      precio {p.base === "adjudicado" ? "adjudicado" : "referencial"} típico (mediana) en {p.anio}
                    </p>
                    <p className="mt-2 text-meta text-inkSoft">
                      Rango: {p.p25 != null ? soles(p.p25) : "Sin dato"} a {p.p75 != null ? soles(p.p75) : "Sin dato"}, en {numero(p.n)} compras de {numero(p.entidades)}{" "}
                      {p.entidades === 1 ? "entidad" : "entidades"}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Procesos parecidos */}
          <section aria-labelledby="parecidos-t">
            <h2 id="parecidos-t" className="font-display text-bloque font-bold text-ink">
              Procesos parecidos y quién los ganó
            </h2>
            <p className="mt-1 text-meta text-mute">Con el mismo CUBSO, adjudicados desde el año pasado. De quien ganó, el nombre sólo si es una empresa.</p>
            {f.parecidos.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-line bg-paperSoft p-4 text-dato text-inkSoft">
                No hay procesos adjudicados con el mismo código. Mira el mercado de tu rubro en{" "}
                <Link href={`${ruta("/mercado")}?q=${encodeURIComponent(rubro)}`} className="font-semibold text-granate underline-offset-2 hover:underline">
                  Inteligencia de mercado
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-paper">
                {f.parecidos.map((p) => {
                  const rebaja = p.unitRef && p.unitAdj ? 1 - p.unitAdj / p.unitRef : null;
                  return (
                    <li key={`${p.ocid}-${p.descripcion}`} className="px-4 py-3">
                      <p className="line-clamp-2 text-dato font-medium leading-snug text-ink">{limpiar(p.descripcion || p.objeto) || "Proceso sin descripción"}</p>
                      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-meta text-inkSoft">
                        <span>{p.entidad ? tituloNatural(p.entidad) : "Entidad sin nombre"}</span>
                        {p.fecha && <span>{fechaCorta(p.fecha)}</span>}
                        {p.cantidad != null && p.unidad && (
                          <span>
                            {numero(p.cantidad)} {p.unidad.toLocaleLowerCase("es-PE")}
                          </span>
                        )}
                        {p.unitAdj != null && <span className="font-semibold text-ink">Adjudicado a {soles(p.unitAdj)} por unidad</span>}
                        {rebaja != null && rebaja > 0.005 && <span className="text-mossTexto">{porcentaje(rebaja * 100)} bajo el referencial</span>}
                      </p>
                      <p className="mt-1 text-meta text-mute">Ganó: {p.proveedor ? tituloNatural(p.proveedor) : "un consorcio o una persona natural"}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* ── Columna: inteligencia y acciones ── */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-3xl border border-line bg-paper p-5">
            <a href={f.enlaces.busqueda ?? f.enlaces.oece} target="_blank" rel="noopener noreferrer" className={claseAccion("primario", "w-full")}>
              Ver en el portal oficial <ArrowUpRight size={16} aria-hidden />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
            <p className="mt-2 text-center text-rotulo text-mute">El cronograma y la presentación de ofertas, en el SEACE.</p>
            <BotonGuardar
              producto="licitaciones"
              base={base}
              tipo="oportunidad"
              codigo={f.ocid}
              titulo={limpiar(f.objeto) || f.codigo || f.ocid}
              datos={{ cierre: f.consultas?.hasta ?? null, entidad: f.entidad ?? null }}
              className="mt-3"
            />
            <Link
              href={`${ruta("/oportunidades")}?${new URLSearchParams({ q: palabrasClave(limpiar(f.objeto), 2), ...(f.region ? { region: f.region } : {}), ...(f.tipo ? { tipo: f.tipo } : {}) })}`}
              className={claseAccion("fantasma", "mt-2 w-full")}
            >
              <BellRing size={16} aria-hidden /> Crear una alerta así
            </Link>
          </div>

          <section aria-labelledby="entidad-t" className="sobre-oscuro rounded-3xl bg-ink p-5 text-paper">
            <h2 id="entidad-t" className="font-display text-bloque font-bold leading-tight">
              La entidad en 12 meses
            </h2>
            <p className="mt-1 text-meta text-paper/65">Lo que adjudicó y a quién (CONOSCE, OECE).</p>
            {intel.procesos ? (
              <>
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <Mini valor={numero(intel.procesos)} etiqueta="procesos adjudicados" />
                  <Mini valor={solesCompacto(intel.monto ?? 0)} etiqueta="adjudicados" />
                  <Mini valor={intel.postoresPromedio ? decimal(intel.postoresPromedio) : "Sin dato"} etiqueta="postores por proceso" />
                  <Mini valor={unSolo != null ? porcentaje(unSolo * 100) : "Sin dato"} etiqueta="con un solo postor" />
                </dl>
                {intel.adjSobreRef ? (
                  <p className="mt-3 rounded-xl bg-paper/[0.07] px-3 py-2 text-meta text-paper/80">
                    Adjudica, en promedio, al <b className="text-maiz">{porcentaje(intel.adjSobreRef * 100)}</b> del valor referencial.
                  </p>
                ) : null}
                {(intel.proveedores ?? []).length > 0 && (
                  <div className="mt-4">
                    <p className="flex items-center gap-1.5 text-meta font-semibold text-paper/75">
                      <Users size={14} aria-hidden /> Sus principales proveedores
                    </p>
                    {/* Barras propias (claras sobre la banda oscura): la mayor llena la barra. */}
                    <ul className="mt-2 space-y-2.5">
                      {(intel.proveedores ?? []).map((p, _i, todos) => {
                        const mayor = Math.max(1, ...todos.map((x) => x.monto ?? 0));
                        return (
                          <li key={p.ruc} className="min-w-0">
                            <span className="flex items-baseline justify-between gap-2 text-meta">
                              <span className="min-w-0 truncate text-paper" title={p.nombre ?? p.ruc}>
                                {p.nombre ? tituloNatural(p.nombre) : p.ruc}
                              </span>
                              <span className="shrink-0 font-mono tabular-nums text-paper/80">{solesCompacto(p.monto ?? 0)}</span>
                            </span>
                            <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-paper/10">
                              <span className="block h-full rounded-full bg-maiz" style={{ width: `${Math.max(3, ((p.monto ?? 0) / mayor) * 100)}%` }} />
                            </span>
                            <span className="mt-0.5 block text-rotulo text-paper/55">
                              {numero(p.procesos)} {p.procesos === 1 ? "proceso" : "procesos"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-4 text-dato text-paper/75">Sin adjudicaciones de esta entidad en CONOSCE en los últimos 12 meses.</p>
            )}
            {f.entidadRuc && (
              <a
                href={`https://vigia.gobserva.cloud/entidad/${f.entidadRuc}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-meta font-semibold text-maiz underline-offset-2 hover:underline"
              >
                <ShieldCheck size={15} aria-hidden /> Sus antecedentes en Vigía <ArrowUpRight size={13} aria-hidden />
              </a>
            )}
          </section>

          {rubro && (
            <Link href={`${ruta("/mercado")}?q=${encodeURIComponent(rubro)}`} className="block rounded-3xl border border-line bg-paperSoft p-5 transition-colors duration-rapido hover:border-granate/40">
              <p className="font-display text-bloque font-bold leading-tight text-ink">El mercado de «{rubro}»</p>
              <p className="mt-1 text-meta text-inkSoft">Cuánto compra el Estado en 12 meses, quién compra y quién gana.</p>
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

function DatoFicha({ Icono, etiqueta, children }: { Icono: typeof Building2; etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3 rounded-2xl border border-line bg-paper p-4">
      <Icono size={18} aria-hidden className="mt-0.5 shrink-0 text-granate" />
      <div className="min-w-0">
        <dt className="text-meta text-mute">{etiqueta}</dt>
        <dd className="mt-0.5 text-dato font-medium leading-snug text-ink">{children}</dd>
      </div>
    </div>
  );
}

function Mini({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse rounded-xl bg-paper/[0.07] px-3 py-2.5">
      <dt className="mt-1 text-rotulo leading-snug text-paper/65">{etiqueta}</dt>
      <dd className="font-display text-bloque font-bold leading-none tabular-nums text-paper">{valor}</dd>
    </div>
  );
}
