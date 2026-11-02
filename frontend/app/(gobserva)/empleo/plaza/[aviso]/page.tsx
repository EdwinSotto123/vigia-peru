import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, BellRing, Building2, CalendarDays, Eye, FileText, Hash, MapPin, Timer, Users } from "lucide-react";
import { CumplesRequisitos, type Requisito } from "@/components/empleo/CumplesRequisitos";
import { RangoSueldo } from "@/components/empleo/RangoSueldo";
import { Chip, tonoCierre } from "@/components/empleo/TarjetaPlaza";
import { DatosEstructurados } from "@/components/seo/DatosEstructurados";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { diasParaCierre, entidadNombre, fechaDia, lugar, puesto, textoCierre, textoExperiencia } from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { palabrasClave, rutaEn, urlCanonica } from "@/lib/gobserva";
import { BotonGuardar } from "@/components/gobserva/cuenta/BotonGuardar";
import { baseProducto } from "@/lib/gobserva-servidor";
import { SENAL_PLAZA, getFichaPlaza, type FichaPlaza } from "@/lib/planilla";

/** Las ofertas laborales del Estado en SERVIR (lib/fuentes.ts). */
const SERVIR = "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml";

type Props = { params: { aviso: string } };

/** Un texto de SERVIR que no dice nada («.», «-», vacío) no es un requisito. */
const conTexto = (t: string | null | undefined) => (t && t.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 ? t.trim() : null);
/** SERVIR escribe los requisitos en mayúsculas con viñetas sueltas: en oración, cada viñeta en su línea. */
const legible = (t: string) => puesto(t.replace(/\s*[•▪●]\s*/g, "\n").replace(/^\n+/, ""));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getFichaPlaza(params.aviso);
  if (!d) return { title: "Plaza no encontrada" };
  const p = d.plaza;
  return {
    title: `${puesto(p.titulo)} en ${entidadNombre(p.entidad)}`,
    description: `Plaza CAS: ${puesto(p.titulo)} en ${entidadNombre(p.entidad)} (${lugar(p.ubicacion)}). Paga ${soles(p.remuneracion)} al mes, ${p.vacantes ?? 1} ${p.vacantes === 1 ? "vacante" : "vacantes"}, cierra el ${fechaDia(p.fechaFin)}. Requisitos y cómo postular.`,
    alternates: { canonical: urlCanonica("empleo", `/plaza/${p.aviso}`) },
  };
}

/** La oferta como JobPosting de schema.org: lo que Google muestra en su buscador de empleos (con el enlace oficial). */
function jobPosting(d: FichaPlaza) {
  const p = d.plaza;
  const region = (p.ubicacion ?? "").split(" - ")[0] || undefined;
  const ciudad = (p.ubicacion ?? "").split(" - ")[1] || undefined;
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
    employmentType: ["FULL_TIME", "TEMPORARY"],
    hiringOrganization: { "@type": "GovernmentOrganization", name: entidadNombre(p.entidad) },
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: ciudad ? puesto(ciudad) : undefined, addressRegion: region ? puesto(region) : undefined, addressCountry: "PE" } },
    totalJobOpenings: p.vacantes ?? 1,
    baseSalary: p.remuneracion ? { "@type": "MonetaryAmount", currency: "PEN", value: { "@type": "QuantitativeValue", value: p.remuneracion, unitText: "MONTH" } } : undefined,
    directApply: false,
    url: urlCanonica("empleo", `/plaza/${p.aviso}`),
  };
}

/**
 * La ficha de una plaza CAS en Gobserva Empleo: qué es, cuánto paga y cuándo cierra; «¿Cumples?» con cada requisito;
 * lo que pagan otras entidades por el mismo puesto; lo que nadie te dice (las señales de Vigía, sin nombres de
 * personas); la misma plaza en esta entidad; y cómo postular (la publicación oficial y SERVIR). GET /plazas/:aviso.
 */
export default async function FichaPlazaEmpleo({ params }: Props) {
  const d = await getFichaPlaza(params.aviso);
  if (!d) notFound();
  const base = baseProducto("empleo");
  const p = d.plaza;
  const dias = diasParaCierre(p.fechaFin);
  const cerrada = dias != null && dias < 0;
  // La región de la plaza para proponer la alerta («PASCO - YANACANCHA» → «pasco»).
  const regionSlug = (p.ubicacion ?? "").split(" - ")[0].trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-") || null;
  const exp = textoExperiencia(p.expGeneral);

  const requisitos: Requisito[] = [
    conTexto(p.formacion) ? { clave: "formacion", titulo: "Formación", texto: legible(p.formacion!) } : null,
    conTexto(p.experiencia) ? { clave: "experiencia", titulo: exp ? `Experiencia (${exp.toLowerCase()})` : "Experiencia", texto: legible(p.experiencia!) } : null,
    conTexto(p.especializacion) ? { clave: "especializacion", titulo: "Cursos o especialización", texto: legible(p.especializacion!) } : null,
    conTexto(p.conocimiento) ? { clave: "conocimiento", titulo: "Conocimientos", texto: legible(p.conocimiento!) } : null,
  ].filter((r): r is Requisito => r != null);

  return (
    <div className="container-page py-8 sm:py-12">
      <DatosEstructurados datos={jobPosting(d)} />
      <nav aria-label="Ruta" className="text-meta text-mute">
        <Link href={rutaEn(base, "/")} className="hover:text-granate hover:underline">
          Inicio
        </Link>
        <span aria-hidden className="mx-1.5">/</span>
        <Link href={rutaEn(base, "/plazas")} className="hover:text-granate hover:underline">
          Plazas
        </Link>
        <span aria-hidden className="mx-1.5">/</span>
        <span className="text-inkSoft">Aviso {p.aviso}</span>
      </nav>

      <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-10">
          <header>
            <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">{puesto(p.titulo)}</h1>
            <p className="mt-3 flex items-start gap-2 text-cuerpo text-inkSoft">
              <Building2 size={18} aria-hidden className="mt-0.5 shrink-0 text-mute" />
              {entidadNombre(p.entidad)}
            </p>
            <ul className="mt-4 flex flex-wrap gap-1.5 [&>li]:min-w-0 [&>li]:max-w-full" aria-label="Datos de la plaza">
              <li>
                <Chip icono={<Timer size={13} aria-hidden />} tono={tonoCierre(dias)}>
                  {textoCierre(dias)}
                  {p.fechaFin ? ` (${fechaDia(p.fechaFin)})` : ""}
                </Chip>
              </li>
              <li>
                <Chip icono={<MapPin size={13} aria-hidden />}>{lugar(p.ubicacion)}</Chip>
              </li>
              <li>
                <Chip icono={<Users size={13} aria-hidden />}>{p.vacantes === 1 ? "1 vacante" : `${numero(p.vacantes ?? 1)} vacantes`}</Chip>
              </li>
              {p.numero && (
                <li>
                  <Chip icono={<Hash size={13} aria-hidden />}>{p.numero}</Chip>
                </li>
              )}
              {p.fechaInicio && (
                <li>
                  <Chip icono={<CalendarDays size={13} aria-hidden />}>Publicada el {fechaDia(p.fechaInicio)}</Chip>
                </li>
              )}
            </ul>
            {cerrada && (
              <p className="mt-4 rounded-2xl border border-line bg-paperSoft px-4 py-3 text-dato text-inkSoft">
                Esta plaza ya cerró. Mira{" "}
                <Link href={rutaEn(base, `/plazas?q=${encodeURIComponent(p.titulo.slice(0, 40))}`)} className="font-semibold text-granate underline-offset-2 hover:underline">
                  las plazas parecidas que siguen abiertas
                </Link>
                .
              </p>
            )}
          </header>

          {requisitos.length > 0 && (
            <section aria-labelledby="cumples-t">
              <h2 id="cumples-t" className="font-display text-seccion font-bold leading-tight text-ink">
                ¿Cumples los requisitos?
              </h2>
              <p className="mt-1.5 text-dato leading-relaxed text-inkSoft">Marca lo que ya tienes. Es lo que pide la entidad en su aviso; las bases completas están en la publicación oficial.</p>
              <div className="mt-4">
                <CumplesRequisitos aviso={p.aviso} requisitos={requisitos} postular={p.detalleUrl} />
              </div>
            </section>
          )}

          {d.enOtras && (
            <section aria-labelledby="sueldo-t">
              <h2 id="sueldo-t" className="font-display text-seccion font-bold leading-tight text-ink">
                Lo que pagan otras entidades por este puesto
              </h2>
              <div className="mt-4">
                <RangoSueldo sueldo={p.remuneracion} p25={d.enOtras.p25} mediana={d.enOtras.mediana} p75={d.enOtras.p75} plazas={d.enOtras.plazas} entidades={d.enOtras.entidades} />
              </div>
            </section>
          )}

          <section aria-labelledby="nadie-t">
            <h2 id="nadie-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
              <Eye size={22} aria-hidden className="text-amberTexto" /> Lo que nadie te dice
            </h2>
            {p.senales?.length ? (
              <ul className="mt-4 space-y-3">
                {p.senales.map((s) => {
                  const info = SENAL_PLAZA[s.tipo];
                  const det = (s.detalle ?? {}) as Record<string, unknown>;
                  const extra =
                    s.tipo === "pide_experiencia_propia" && typeof det.texto === "string"
                      ? `Lo que dice el aviso: «${legible(det.texto).slice(0, 240)}».`
                      : s.tipo === "ya_hay_locadores"
                        ? (() => {
                            const n = Array.isArray(det.personas) ? det.personas.length : typeof det.personas === "number" ? det.personas : null;
                            return n ? `${n === 1 ? "Una persona hacía" : `${numero(n)} personas hacían`} ese trabajo por órdenes de servicio en los 12 meses anteriores.` : null;
                          })()
                        : s.tipo === "gestion_saliente" && typeof det.entrega === "string"
                          ? `La gestión que convocó entrega el cargo el ${fechaDia(det.entrega.slice(0, 10))}.`
                          : null;
                  return (
                    <li key={s.tipo} className="rounded-2xl border border-amber/30 bg-amber-soft/40 p-4 sm:p-5">
                      <p className="text-cuerpo font-semibold text-ink">{info?.titulo ?? s.tipo}</p>
                      <p className="mt-1 text-dato leading-relaxed text-inkSoft">{info?.explica}</p>
                      {extra && <p className="mt-2 text-meta leading-relaxed text-inkSoft">{extra}</p>}
                    </li>
                  );
                })}
                <li className="px-1 text-meta leading-relaxed text-mute">
                  Son datos públicos cruzados por Vigía, el proyecto cívico de Gobserva. No prueban que la plaza esté arreglada: te ayudan a decidir dónde pones tu esfuerzo.
                </li>
              </ul>
            ) : (
              <p className="mt-3 rounded-2xl border border-line bg-paper p-4 text-dato leading-relaxed text-inkSoft">
                Nada que destacar: no pide experiencia en la propia entidad, no había personas haciendo ese trabajo por órdenes de servicio y no la convocó una gestión de salida.
              </p>
            )}
          </section>

          {d.mismoTitulo.length > 0 && (
            <section aria-labelledby="misma-t">
              <h2 id="misma-t" className="font-display text-seccion font-bold leading-tight text-ink">
                La misma plaza en esta entidad
              </h2>
              <p className="mt-1.5 text-dato text-inkSoft">Otras convocatorias con el mismo puesto: una plaza que se repite puede ser de alta rotación.</p>
              <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-paper">
                {d.mismoTitulo.slice(0, 8).map((m) => (
                  <li key={m.aviso}>
                    <Link href={rutaEn(base, `/plaza/${m.aviso}`)} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft">
                      <span className="text-dato font-medium text-ink">
                        {m.numero ?? `Aviso ${m.aviso}`}
                        <span className="ml-2 text-meta font-normal text-mute">{m.fechaInicio ? `publicada el ${fechaDia(m.fechaInicio)}` : "sin fecha"}</span>
                      </span>
                      <span className="font-mono text-dato tabular-nums text-inkSoft">{soles(m.remuneracion)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {d.mismoTitulo.length > 8 && <p className="mt-2 text-meta text-mute">Y {numero(d.mismoTitulo.length - 8)} más en esta entidad.</p>}
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-3xl border border-line bg-paper p-5">
            <p className="text-meta text-mute">Sueldo mensual</p>
            <p className="mt-1 font-display text-cifra font-bold leading-none tabular-nums text-ink">{soles(p.remuneracion)}</p>
            <dl className="mt-5 space-y-2.5 text-dato">
              <Fila t="Cierra">{p.fechaFin ? `${fechaDia(p.fechaFin)} (${textoCierre(dias).toLowerCase()})` : "Sin dato"}</Fila>
              <Fila t="Vacantes">{numero(p.vacantes ?? 1)}</Fila>
              <Fila t="Experiencia">{exp ?? "Según el aviso"}</Fila>
              <Fila t="Contrato">CAS, a plazo determinado</Fila>
            </dl>
            <div className="mt-5 space-y-2">
              {p.detalleUrl && !cerrada && (
                <a href={p.detalleUrl} target="_blank" rel="noopener noreferrer" className={claseAccion("primario", "w-full")}>
                  Postular en la web de la entidad <ArrowUpRight size={16} aria-hidden />
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </a>
              )}
              <a href={SERVIR} target="_blank" rel="noopener noreferrer" className={claseAccion(p.detalleUrl && !cerrada ? "secundario" : "primario", "w-full")}>
                <FileText size={16} aria-hidden /> Ver en SERVIR
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
              <BotonGuardar
                producto="empleo"
                base={base}
                tipo="plaza"
                codigo={String(p.aviso)}
                titulo={puesto(p.titulo)}
                datos={{ cierre: p.fechaFin ?? null, entidad: entidadNombre(p.entidad) }}
              />
            </div>
            <p className="mt-3 text-meta leading-relaxed text-mute">Postular es gratis y siempre en la entidad. Nadie puede cobrarte por una plaza del Estado.</p>
          </div>
          <div className="rounded-3xl border border-granate/30 bg-granate-50 p-5">
            <p className="font-display text-bloque font-bold leading-tight text-ink">Plazas como esta, cada mañana</p>
            <p className="mt-1.5 text-dato leading-relaxed text-inkSoft">Te avisamos por correo cuando se publique otra parecida. Guarda esta y te recordamos 2 días antes de que cierre.</p>
            <Link
              href={rutaEn(base, `/plazas?${new URLSearchParams({ q: palabrasClave(p.titulo) || puesto(p.titulo).slice(0, 40), ...(regionSlug ? { region: regionSlug } : {}) })}`)}
              className={claseAccion("primario", "mt-4 w-full")}
            >
              <BellRing size={16} aria-hidden /> Crear una alerta así
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Fila({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-2.5 last:border-0 last:pb-0">
      <dt className="text-mute">{t}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}
