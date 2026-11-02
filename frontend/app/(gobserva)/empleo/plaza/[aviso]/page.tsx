import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ArrowUpRight, BellRing, Building2, CircleCheckBig, Eye, FileText, MapPin, ScrollText, ShieldCheck, Timer, TrendingDown, TrendingUp, Users } from "lucide-react";
import { BarraPostular } from "@/components/empleo/BarraPostular";
import { CumplesRequisitos, type Requisito } from "@/components/empleo/CumplesRequisitos";
import { Ruta } from "@/components/empleo/Piezas";
import { RangoSueldo, fraseSueldo } from "@/components/empleo/RangoSueldo";
import { Chip, tonoCierre } from "@/components/empleo/TarjetaPlaza";
import { BotonGuardar } from "@/components/gobserva/cuenta/BotonGuardar";
import { Nota } from "@/components/patrones/Estructura";
import { Franja } from "@/components/patrones/Franja";
import { DatosEstructurados } from "@/components/seo/DatosEstructurados";
import { Dato } from "@/components/ui/Dato";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import {
  aniosCorto,
  canalAlertas,
  cierreConFecha,
  claseRequisito,
  diasParaCierre,
  entidadNombre,
  enumerar,
  fechaDia,
  lugar,
  puesto,
  textoCierre,
  tipoContrato,
} from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { palabrasClave, rutaEn, urlCanonica } from "@/lib/gobserva";
import { planesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";
import { SENAL_PLAZA, getFichaPlaza, type FichaPlaza } from "@/lib/planilla";
import { cn } from "@/lib/utils";

/** Las ofertas laborales del Estado en SERVIR (lib/fuentes.ts). */
const SERVIR = "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml";

/** Las primeras convocatorias de «la misma plaza» a la vista; las demás, en «Ver N más» (la lista entera, sin recorte mudo). */
const MISMA_A_LA_VISTA = 8;

type Props = { params: { aviso: string } };

/** Un texto de SERVIR que no dice nada («.», «-», vacío) no es un requisito. */
const conTexto = (t: string | null | undefined) => (t && t.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 ? t.trim() : null);
/** SERVIR escribe los requisitos en mayúsculas con viñetas sueltas: en oración, cada viñeta en su línea. */
const legible = (t: string) => puesto(t.replace(/\s*[•▪●]\s*/g, "\n").replace(/^\n+/, ""));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getFichaPlaza(params.aviso);
  if (!d) return { title: "Plaza no encontrada" };
  const p = d.plaza;
  const vacantes = p.vacantes ?? 1;
  return {
    title: `${puesto(p.titulo)} en ${entidadNombre(p.entidad)}`,
    description: `Plaza CAS: ${puesto(p.titulo)} en ${entidadNombre(p.entidad)} (${lugar(p.ubicacion)}). ${p.remuneracion ? `Paga ${soles(p.remuneracion)} al mes, ` : ""}${numero(vacantes)} ${vacantes === 1 ? "vacante" : "vacantes"}, cierra el ${fechaDia(p.fechaFin)}. Requisitos y cómo postular.`,
    alternates: { canonical: urlCanonica("empleo", `/plaza/${p.aviso}`) },
  };
}

/** La oferta como JobPosting de schema.org: lo que Google muestra en su buscador de empleos (con el enlace oficial). */
function jobPosting(d: FichaPlaza) {
  const p = d.plaza;
  const region = (p.ubicacion ?? "").split(" - ")[0] || undefined;
  const ciudad = (p.ubicacion ?? "").split(" - ")[1] || undefined;
  const contrato = tipoContrato(p.numero, p.titulo);
  const descripcion = [
    `Plaza CAS (Contrato Administrativo de Servicios) convocada por ${entidadNombre(p.entidad)}.`,
    conTexto(p.formacion) ? `Formación: ${conTexto(p.formacion)}.` : null,
    conTexto(p.experiencia) ? `Experiencia: ${conTexto(p.experiencia)}.` : null,
    conTexto(p.especializacion) ? `Especialización: ${conTexto(p.especializacion)}.` : null,
    conTexto(p.conocimiento) ? `Conocimientos: ${conTexto(p.conocimiento)}.` : null,
    "Postula en la publicación oficial de la entidad o en SERVIR.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: puesto(p.titulo),
    description: descripcion,
    identifier: { "@type": "PropertyValue", name: "SERVIR", value: String(p.aviso) },
    datePosted: p.fechaInicio ?? undefined,
    validThrough: p.fechaFin ? `${p.fechaFin}T23:59:00-05:00` : undefined,
    // El plazo sólo si la convocatoria lo dice (un CAS también puede ser a plazo indeterminado).
    employmentType: contrato.temporal ? ["FULL_TIME", "TEMPORARY"] : ["FULL_TIME"],
    hiringOrganization: { "@type": "GovernmentOrganization", name: entidadNombre(p.entidad) },
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: ciudad ? lugar(ciudad) : undefined, addressRegion: region ? lugar(region) : undefined, addressCountry: "PE" } },
    totalJobOpenings: p.vacantes ?? 1,
    baseSalary: p.remuneracion ? { "@type": "MonetaryAmount", currency: "PEN", value: { "@type": "QuantitativeValue", value: p.remuneracion, unitText: "MONTH" } } : undefined,
    directApply: false,
    url: urlCanonica("empleo", `/plaza/${p.aviso}`),
  };
}

/**
 * La ficha de una plaza CAS en Gobserva Empleo, para responder en segundos «¿me sirve?, ¿cuánto paga?, ¿cuándo cierra?,
 * ¿cumplo?, ¿cómo postulo?». Arriba el puesto, la entidad, el cierre y el lugar; al lado (en el celular, justo debajo) lo
 * que paga, los botones para postular, guardar y SERVIR, y los datos del aviso. Después: «¿Cumples?» con cada requisito
 * (lo que el aviso deja «según el perfil» va aparte, no como casilla), lo que pagan otras entidades, lo que nadie te dice
 * (las señales de Vigía, sin nombres de personas), cómo postular en tres pasos y la misma plaza en esta entidad. En el
 * celular, al bajar, una barra con el sueldo y «Postular» queda a mano del pulgar. GET /plazas/:aviso.
 */
export default async function FichaPlazaEmpleo({ params }: Props) {
  const [d, cat] = await Promise.all([getFichaPlaza(params.aviso), planesServidor("empleo")]);
  if (!d) notFound();
  const base = baseProducto("empleo");
  const p = d.plaza;
  const dias = diasParaCierre(p.fechaFin);
  const cerrada = dias != null && dias < 0;
  const titulo = puesto(p.titulo);
  const entidad = entidadNombre(p.entidad);
  const vacantes = p.vacantes ?? 1;
  const contrato = tipoContrato(p.numero, p.titulo);
  const expCorta = aniosCorto(p.expGeneral);
  const cierre = cierreConFecha(dias, p.fechaFin);
  const sueldo = p.remuneracion ? soles(p.remuneracion) : null;
  // La región de la plaza para proponer la alerta («PASCO - YANACANCHA» → «pasco»).
  const regionSlug = (p.ubicacion ?? "").split(" - ")[0].trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-") || null;
  const palabras = palabrasClave(p.titulo) || titulo.slice(0, 40);
  const parecidas = rutaEn(base, `/plazas?${new URLSearchParams({ q: palabras })}`);
  const alerta = rutaEn(base, `/plazas?${new URLSearchParams({ q: palabras, ...(regionSlug ? { region: regionSlug } : {}) })}#crear-alerta`);
  const primario: "entidad" | "servir" | "parecidas" = cerrada ? "parecidas" : p.detalleUrl ? "entidad" : "servir";
  const comparada =
    d.enOtras && d.enOtras.mediana != null && d.enOtras.p25 != null && d.enOtras.p75 != null
      ? { p25: d.enOtras.p25, mediana: d.enOtras.mediana, p75: d.enOtras.p75, plazas: d.enOtras.plazas, entidades: d.enOtras.entidades }
      : null;

  // Cada requisito del aviso: los que se pueden cumplir van a «¿Cumples?»; «según el perfil del puesto» o «no aplica», aparte.
  const campos = [
    { clave: "formacion", nombre: "formación", titulo: "Formación", valor: p.formacion, resumen: undefined },
    { clave: "experiencia", nombre: "experiencia", titulo: "Experiencia", valor: p.experiencia, resumen: expCorta ?? undefined },
    { clave: "especializacion", nombre: "cursos o especialización", titulo: "Cursos o especialización", valor: p.especializacion, resumen: undefined },
    { clave: "conocimiento", nombre: "conocimientos", titulo: "Conocimientos", valor: p.conocimiento, resumen: undefined },
  ];
  const requisitos: Requisito[] = [];
  const enBases: string[] = [];
  const noPide: string[] = [];
  for (const c of campos) {
    const t = conTexto(c.valor);
    if (!t) continue;
    const clase = claseRequisito(t);
    if (clase === "en_bases") enBases.push(c.nombre);
    else if (clase === "no_pide") noPide.push(c.nombre);
    else requisitos.push({ clave: c.clave, titulo: c.titulo, resumen: c.resumen, texto: legible(t) });
  }

  return (
    <div className="container-page pb-4 pt-6 sm:pt-10">
      <DatosEstructurados datos={jobPosting(d)} />
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Plazas", href: rutaEn(base, "/plazas") }, { etiqueta: `Aviso ${p.aviso}` }]} />

      <div className="mt-3 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <header className="min-w-0 lg:col-start-1 lg:row-start-1">
          <h1 className={cn("text-balance font-display font-bold leading-tight text-ink", titulo.length <= 32 ? "text-cifra sm:text-vitrina" : "text-cifra sm:text-titulo")}>{titulo}</h1>
          <p className="mt-2 flex items-start gap-2 text-cuerpo text-inkSoft">
            <Building2 size={18} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            {entidad}
          </p>
          <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-meta text-inkSoft [&>li]:min-w-0 [&>li]:max-w-full" aria-label="Datos de la plaza">
            <li>
              <Chip icono={<Timer size={13} aria-hidden />} tono={cerrada ? "neutro" : tonoCierre(dias)}>
                {cerrada ? cierre : `${textoCierre(dias)}${p.fechaFin ? ` (${fechaDia(p.fechaFin)})` : ""}`}
              </Chip>
            </li>
            <li>
              <Dato icono={MapPin} nombre="Lugar">
                {lugar(p.ubicacion)}
              </Dato>
            </li>
            <li>
              <Dato icono={Users} nombre="Vacantes">
                {vacantes === 1 ? "1 vacante" : `${numero(vacantes)} vacantes`}
              </Dato>
            </li>
          </ul>
          {/* El botón a las parecidas va en el bloque de al lado (en el celular, justo debajo): aquí sólo el aviso. */}
          {cerrada && (
            <Franja icono={<Timer size={18} aria-hidden />} titulo="Esta plaza ya cerró" className="mt-5">
              Ya no recibe postulaciones. Puede haber otras iguales abiertas hoy: están en «Ver plazas parecidas».
            </Franja>
          )}
        </header>

        <aside aria-label="Sueldo y cómo postular" className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <div className="rounded-3xl border border-line bg-paper p-5">
            <p className="text-meta text-mute">Sueldo mensual</p>
            <p className="mt-1 font-display text-cifra font-bold leading-none tabular-nums text-ink">{sueldo ?? "Sin dato"}</p>
            {comparada && p.remuneracion ? (
              <a href="#sueldo" className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-meta font-medium text-inkSoft underline-offset-4 hover:text-granate hover:underline">
                {p.remuneracion >= comparada.mediana ? <TrendingUp size={15} aria-hidden className="shrink-0 text-mossTexto" /> : <TrendingDown size={15} aria-hidden className="shrink-0 text-amberTexto" />}
                {fraseSueldo(p.remuneracion, comparada.p25, comparada.mediana, comparada.p75)}
              </a>
            ) : null}

            <div id="acciones-plaza" className="mt-4 grid grid-cols-2 gap-2">
              {primario === "entidad" && p.detalleUrl && (
                <a href={p.detalleUrl} target="_blank" rel="noopener noreferrer" className={claseAccion("primario", "col-span-2 min-h-11")}>
                  Postular en la entidad <ArrowUpRight size={16} aria-hidden />
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </a>
              )}
              {primario === "parecidas" && (
                <Link href={parecidas} className={claseAccion("primario", "col-span-2 min-h-11")}>
                  Ver plazas parecidas
                </Link>
              )}
              <a href={SERVIR} target="_blank" rel="noopener noreferrer" className={claseAccion(primario === "servir" ? "primario" : "secundario", cn("min-h-11 px-3", primario === "servir" && "col-span-2"))}>
                <FileText size={16} aria-hidden /> Ver en SERVIR
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
              <div className={cn("min-w-0", primario === "servir" && "col-span-2")}>
                <Suspense fallback={<span aria-hidden className="block h-11 animate-pulse rounded-full bg-paperDeep" />}>
                  <BotonGuardar
                    producto="empleo"
                    base={base}
                    tipo="plaza"
                    codigo={String(p.aviso)}
                    titulo={titulo}
                    datos={{ cierre: p.fechaFin ?? null, entidad }}
                    className="min-h-11 w-full"
                  />
                </Suspense>
              </div>
            </div>

            <dl className="mt-5 text-dato">
              <Fila t="Cierra">
                <span className={cn(!cerrada && dias != null && dias <= 1 && "font-semibold text-crimsonTexto")}>{cierre}</span>
              </Fila>
              <Fila t="Experiencia">{expCorta ?? "Según el aviso"}</Fila>
              <Fila t="Contrato">{contrato.texto}</Fila>
              {p.fechaInicio && <Fila t="Publicada">{fechaDia(p.fechaInicio)}</Fila>}
              {p.numero && (
                <Fila t="Convocatoria" apilada>
                  {p.numero}
                </Fila>
              )}
              <Fila t="Aviso en SERVIR">
                <span className="font-mono tabular-nums">{p.aviso}</span>
              </Fila>
            </dl>
            <Nota icono={<ShieldCheck size={15} aria-hidden />} className="mt-4">
              Postular es gratis y siempre en la entidad. Nadie puede cobrarte por una plaza del Estado.
            </Nota>
          </div>
          <div className="hidden lg:block">
            <AlertaParecidas id="parecidas-lado" href={alerta} canal={canalAlertas(cat.correoActivo)} />
          </div>
        </aside>

        <div className="min-w-0 space-y-12 lg:col-start-1 lg:row-start-2">
          {(requisitos.length > 0 || enBases.length > 0 || noPide.length > 0) && (
            <section aria-labelledby="cumples-t" id="cumples" className="scroll-mt-24">
              <h2 id="cumples-t" className="font-display text-seccion font-bold leading-tight text-ink">
                ¿Cumples los requisitos?
              </h2>
              <p className="mt-1.5 max-w-[70ch] text-dato leading-relaxed text-inkSoft">
                {requisitos.length > 0
                  ? "Marca lo que ya tienes. Es lo que pide la entidad en su aviso; las bases completas están en su publicación oficial."
                  : "El aviso no trae requisitos que se puedan marcar: están en las bases de la convocatoria."}
              </p>
              <div className="mt-4 space-y-3">
                <CumplesRequisitos aviso={p.aviso} requisitos={requisitos} postular={p.detalleUrl} servir={SERVIR} cerrada={cerrada} />
                {enBases.length > 0 && (
                  <Nota icono={<ScrollText size={15} aria-hidden />}>
                    El aviso no detalla {enumerar(enBases)}: remite a las bases de la convocatoria. Revísalas antes de postular.
                  </Nota>
                )}
                {noPide.length > 0 && <Nota icono={<CircleCheckBig size={15} aria-hidden />}>No pide {enumerar(noPide, "ni")}.</Nota>}
              </div>
            </section>
          )}

          {comparada && (
            <section aria-labelledby="sueldo-t" id="sueldo" className="scroll-mt-24">
              <h2 id="sueldo-t" className="font-display text-seccion font-bold leading-tight text-ink">
                Lo que pagan otras entidades por este puesto
              </h2>
              <div className="mt-4">
                <RangoSueldo sueldo={p.remuneracion} p25={comparada.p25} mediana={comparada.mediana} p75={comparada.p75} plazas={comparada.plazas} entidades={comparada.entidades} />
              </div>
            </section>
          )}

          <section aria-labelledby="nadie-t">
            <h2 id="nadie-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
              <Eye size={22} aria-hidden className="shrink-0 text-amberTexto" /> Lo que nadie te dice
            </h2>
            {p.senales?.length ? (
              <ul className="mt-4 space-y-3">
                {p.senales.map((s) => {
                  const info = SENAL_PLAZA[s.tipo];
                  const extra = detalleSenal(s.tipo, (s.detalle ?? {}) as Record<string, unknown>);
                  return (
                    <li key={s.tipo} className="rounded-2xl border border-amber/30 bg-amber-soft/40 p-4 sm:p-5">
                      <p className="flex items-start gap-2 text-cuerpo font-semibold leading-snug text-ink">
                        <Eye size={18} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
                        {info?.titulo ?? s.tipo}
                      </p>
                      <p className="mt-1.5 max-w-[70ch] text-dato leading-relaxed text-inkSoft">{info?.explica}</p>
                      {extra && <p className="mt-2 max-w-[70ch] border-t border-amber/20 pt-2 text-meta leading-relaxed text-inkSoft">{extra}</p>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-4 rounded-2xl border border-line bg-paper">
                <p className="border-b border-line px-4 py-3 text-dato font-semibold text-ink sm:px-5">Nada que destacar en esta plaza</p>
                <ul className="divide-y divide-line">
                  {[
                    "No pide experiencia en la misma entidad que convoca.",
                    "No encontramos personas que ya hicieran ese trabajo por órdenes de servicio.",
                    "No la convocó una gestión de salida.",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2.5 px-4 py-3 text-dato leading-snug text-inkSoft sm:px-5">
                      <CircleCheckBig size={17} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Nota className="mt-3">
              {p.senales?.length
                ? "Son datos públicos cruzados por Vigía, el proyecto cívico de Gobserva. No prueban que la plaza esté arreglada: te ayudan a decidir dónde pones tu esfuerzo."
                : "Vigía, el proyecto cívico de Gobserva, cruza cada plaza con lo que la entidad ya pagaba por órdenes de servicio y con quién gobierna."}
            </Nota>
          </section>

          {!cerrada && (
            <section aria-labelledby="postular-t" id="como-postular" className="scroll-mt-24">
              <h2 id="postular-t" className="font-display text-seccion font-bold leading-tight text-ink">
                Cómo postular
              </h2>
              <ol className="mt-5 space-y-5">
                <Paso n={1} titulo="Lee las bases">
                  {p.detalleUrl ? (
                    <>
                      Están en la web de la entidad
                      {p.numero ? (
                        <>
                          : busca la convocatoria <b className="font-semibold text-ink">{p.numero}</b>
                        </>
                      ) : null}
                      . Ahí van el perfil completo, el cronograma y cómo se presenta la postulación.
                    </>
                  ) : (
                    <>
                      Están en la publicación de la entidad. En SERVIR, busca el aviso <b className="font-mono font-semibold text-ink">{p.aviso}</b>.
                    </>
                  )}
                  <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {p.detalleUrl && (
                      <a href={p.detalleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-granate underline-offset-4 hover:underline">
                        Abrir la web de la entidad <ArrowUpRight size={15} aria-hidden />
                        <span className="sr-only"> (se abre en otra pestaña)</span>
                      </a>
                    )}
                    <a href={SERVIR} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-granate underline-offset-4 hover:underline">
                      Abrir SERVIR <ArrowUpRight size={15} aria-hidden />
                      <span className="sr-only"> (se abre en otra pestaña)</span>
                    </a>
                  </span>
                </Paso>
                <Paso n={2} titulo="Prepara lo que piden">
                  Las bases dicen qué documentos y formatos debes presentar, y si se postula en línea, por correo o en mesa de partes.
                </Paso>
                <Paso n={3} titulo="Postula antes del cierre">
                  {p.fechaFin ? `Tienes hasta el ${fechaDia(p.fechaFin)} (${textoCierre(dias).toLowerCase()}). ` : "Revisa la fecha de cierre en las bases. "}
                  Postular es gratis: nadie puede cobrarte por una plaza del Estado.
                  {dias != null && dias > 2 ? " Guárdala y te recordamos 2 días antes de que cierre." : ""}
                </Paso>
              </ol>
            </section>
          )}

          {d.mismoTitulo.length > 0 && (
            <section aria-labelledby="misma-t">
              <h2 id="misma-t" className="font-display text-seccion font-bold leading-tight text-ink">
                La misma plaza en esta entidad
              </h2>
              <p className="mt-1.5 max-w-[70ch] text-dato leading-relaxed text-inkSoft">
                {d.mismoTitulo.length === 1 ? "Otra convocatoria" : `${numero(d.mismoTitulo.length)} convocatorias más`} con el mismo puesto: una plaza que se repite puede ser de alta rotación.
              </p>
              <ListaMisma filas={d.mismoTitulo.slice(0, MISMA_A_LA_VISTA)} base={base} className="mt-4" />
              {d.mismoTitulo.length > MISMA_A_LA_VISTA && (
                <details className="group mt-2">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-dato font-semibold text-granate [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Ver las {numero(d.mismoTitulo.length - MISMA_A_LA_VISTA)} restantes</span>
                    <span className="hidden group-open:inline">Ocultar las {numero(d.mismoTitulo.length - MISMA_A_LA_VISTA)} restantes</span>
                  </summary>
                  <ListaMisma filas={d.mismoTitulo.slice(MISMA_A_LA_VISTA)} base={base} className="mt-2" />
                </details>
              )}
            </section>
          )}

          <div className="lg:hidden">
            <AlertaParecidas id="parecidas-pie" href={alerta} canal={canalAlertas(cat.correoActivo)} />
          </div>
        </div>
      </div>

      <BarraPostular
        observar="acciones-plaza"
        sueldo={sueldo}
        cierre={cerrada ? cierre : `${textoCierre(dias)}${p.fechaFin ? `, ${fechaDia(p.fechaFin)}` : ""}`}
        urgente={!cerrada && dias != null && dias <= 1}
        href={primario === "entidad" && p.detalleUrl ? p.detalleUrl : primario === "servir" ? SERVIR : parecidas}
        etiqueta={primario === "entidad" ? "Postular" : primario === "servir" ? "Ver en SERVIR" : "Ver parecidas"}
        externo={primario !== "parecidas"}
      />
    </div>
  );
}

/** Lo que la señal sabe de esta plaza, en una frase (sin nombres de personas: sólo cuántas). */
function detalleSenal(tipo: string, det: Record<string, unknown>): string | null {
  if (tipo === "pide_experiencia_propia" && typeof det.texto === "string") return `Lo que dice el aviso: «${legible(det.texto).slice(0, 240)}».`;
  if (tipo === "ya_hay_locadores") {
    const n = Array.isArray(det.personas) ? det.personas.length : typeof det.personas === "number" ? det.personas : null;
    return n ? `${n === 1 ? "Una persona hacía" : `${numero(n)} personas hacían`} ese trabajo por órdenes de servicio en los 12 meses anteriores.` : null;
  }
  if (tipo === "gestion_saliente" && typeof det.entrega === "string") return `La gestión que convocó entrega el cargo el ${fechaDia(det.entrega.slice(0, 10))}.`;
  return null;
}

/**
 * La invitación a la alerta de plazas parecidas: lleva a la lista ya filtrada, directo a «Crear alerta». Va dos veces (al
 * lado en la computadora, al final en el celular; una sola se ve), por eso cada una con su `id`.
 */
function AlertaParecidas({ id, href, canal }: { id: string; href: string; canal: string }) {
  return (
    <section aria-labelledby={id} className="rounded-3xl border border-granate/30 bg-granate-50 p-5">
      <h2 id={id} className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
        <BellRing size={18} aria-hidden className="shrink-0 text-granate" />
        Plazas como esta, sin buscarlas
      </h2>
      <p className="mt-1.5 text-dato leading-relaxed text-inkSoft">
        Guarda la búsqueda como alerta y te avisamos {canal} cuando se publique otra parecida. Si guardas esta plaza, te recordamos 2 días antes de que cierre.
      </p>
      <Link href={href} className={claseAccion("primario", "mt-4 min-h-11 w-full")}>
        <BellRing size={16} aria-hidden /> Crear una alerta así
      </Link>
    </section>
  );
}

function ListaMisma({ filas, base, className }: { filas: FichaPlaza["mismoTitulo"]; base: string; className?: string }) {
  return (
    <ul className={cn("divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper", className)}>
      {filas.map((m) => (
        <li key={m.aviso}>
          <Link
            href={rutaEn(base, `/plaza/${m.aviso}`)}
            className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
          >
            <span className="min-w-0">
              <span className="block truncate text-dato font-medium text-ink">{m.numero ?? `Aviso ${m.aviso}`}</span>
              <span className="mt-0.5 block text-meta text-mute">{m.fechaInicio ? `Publicada el ${fechaDia(m.fechaInicio)}` : "Sin fecha de publicación"}</span>
            </span>
            <span className="shrink-0 font-mono text-dato tabular-nums text-inkSoft">{m.remuneracion ? soles(m.remuneracion) : "Sueldo sin dato"}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-granate font-mono text-dato font-bold text-paper">
        {n}
      </span>
      <div className="min-w-0 pt-1.5">
        <p className="text-cuerpo font-semibold leading-snug text-ink">{titulo}</p>
        <p className="mt-1 max-w-[70ch] text-dato leading-relaxed text-inkSoft">{children}</p>
      </div>
    </li>
  );
}

function Fila({ t, children, apilada = false }: { t: string; children: ReactNode; apilada?: boolean }) {
  return (
    <div className={cn("border-b border-line/70 py-2.5 first:pt-0 last:border-0 last:pb-0", apilada ? "flex flex-col gap-0.5" : "flex items-baseline justify-between gap-3")}>
      <dt className="shrink-0 text-mute">{t}</dt>
      <dd className={cn("min-w-0 font-medium text-ink", apilada ? "break-words" : "text-right")}>{children}</dd>
    </div>
  );
}
