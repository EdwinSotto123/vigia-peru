import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, BookOpen, Building2, CheckCircle2, Clock, GraduationCap, Lock, Mail, MapPin, ShieldCheck, Users } from "lucide-react";
import { Caja, ESPACIO_CAJAS, Pagina } from "@/components/gobserva/app/Caja";
import { CopiarEnlace } from "@/components/licitaciones-app/detalle/CopiarEnlace";
import { Insignia } from "@/components/licitaciones-app/ui/Insignia";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { diasParaCierre, entidadNombre, fechaDia, lugar, puesto, textoCierre } from "@/lib/empleo";
import { MODALIDAD, getPractica, leerRequerimientos, textoSubvencion } from "@/lib/empleo-practicas";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getPractica(params.id);
  if (!p) return { title: "Práctica no encontrada", robots: { index: false, follow: false } };
  return { title: `${puesto(p.titulo)} en ${entidadNombre(p.entidad)}`, robots: { index: false, follow: false } };
}

/**
 * La ficha de una práctica (2026-11-08): qué es, cuánto paga y cuándo cierra; si puedes postular (la condición, estudiante
 * o egresado, y las carreras), qué harás, cómo y por dónde postular (el correo institucional y la web que la entidad
 * publicó en Talento Perú) y el cronograma con lo que ya pasó tachado.
 */
export default async function FichaPracticaPage({ params }: Props) {
  const p = await getPractica(params.id);
  if (!p) notFound();
  const base = baseProducto("empleo");
  const dias = diasParaCierre(p.fechaFin);
  const cerrada = !p.abierta;
  const r = leerRequerimientos(p.requerimientos);
  const m = MODALIDAD[p.modalidad] ?? MODALIDAD.otra;
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  // El correo llega tapado (a***@entidad.gob.pe) si es de una persona: sin botón para escribirle.
  const correo = p.correo && !p.correo.includes("*") ? p.correo : null;
  const horario = p.beneficios?.horario_ingreso && p.beneficios?.horario_salida ? `de ${p.beneficios.horario_ingreso} a ${p.beneficios.horario_salida}` : null;

  return (
    <Pagina>
      <header className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <Link href={rutaEn(base, "/app/practicas")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg text-dato font-semibold text-inkSoft underline-offset-4 hover:text-ink hover:underline">
            <ArrowLeft size={16} aria-hidden /> Prácticas
          </Link>
          <CopiarEnlace />
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
          {p.numero && <span className="font-mono text-meta font-semibold text-inkSoft">Convocatoria {p.numero}</span>}
          <Insignia tono="acento" Icono={GraduationCap}>{m.largo}</Insignia>
          {cerrada ? <Insignia tono="aviso" Icono={Lock}>Ya cerró</Insignia> : <Insignia>{m.quien}</Insignia>}
        </div>
        <h1 className="mt-3 max-w-[80ch] text-pretty font-display text-bloque font-bold leading-snug tracking-tight text-ink sm:text-seccion">{puesto(p.titulo)}</h1>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-dato text-inkSoft">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Building2 size={15} aria-hidden className="shrink-0 text-mute" />
            <span className="min-w-0">
              {entidadNombre(p.entidad)}
              {p.unidadOrganica ? <span className="text-mute">, {puesto(p.unidadOrganica)}</span> : null}
            </span>
          </span>
          {p.ubicacion && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={15} aria-hidden className="text-mute" />
              {lugar(p.ubicacion)}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Users size={15} aria-hidden className="text-mute" />
            {p.vacantes === 1 || p.vacantes == null ? "1 vacante" : `${numero(p.vacantes)} vacantes`}
          </span>
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-caja lg:grid-cols-4">
          <Cifra etiqueta="Subvención" valor={p.subvencion ? `S/ ${numero(p.subvencion)}` : "Sin dato"} detalle={p.subvencion ? "Al mes, por el convenio" : "Revísala en las bases"} />
          <div className="min-w-0 bg-caja p-4 sm:p-5">
            <dt className="text-meta font-semibold text-inkSoft">Cierra la postulación</dt>
            <dd className={cn("mt-2 font-display text-bloque font-bold leading-tight tabular-nums sm:text-seccion", cerrada ? "text-inkSoft" : "text-ink")}>
              {p.fechaFin ? fechaDia(p.fechaFin) : "Sin fecha"}
            </dd>
            <dd className="mt-1.5">
              {cerrada ? (
                <span className="text-meta text-mute">Ya no recibe postulaciones</span>
              ) : (
                <Insignia tono={dias != null && dias <= 1 ? "urgente" : dias != null && dias <= 3 ? "aviso" : "neutro"} Icono={Clock}>
                  {textoCierre(dias)}
                </Insignia>
              )}
            </dd>
          </div>
          <Cifra etiqueta="Convenio" valor={p.duracionMeses ? `${p.duracionMeses} ${p.duracionMeses === 1 ? "mes" : "meses"}` : "Sin dato"} detalle="Se puede renovar" />
          <Cifra etiqueta="Jornada" valor={p.jornadaHoras ? `${p.jornadaHoras} h` : "Sin dato"} detalle={horario ?? "A la semana"} />
        </dl>
      </header>

      <div className={cn("grid grid-cols-[minmax(0,1fr)] items-start xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]", ESPACIO_CAJAS)}>
        <div className={cn("grid grid-cols-[minmax(0,1fr)]", ESPACIO_CAJAS)}>
          <Caja id="requisitos" titulo="¿Puedes postular?" descripcion="Lo que la entidad publicó en Talento Perú. Las bases pueden pedir algo más.">
            <ul className="space-y-3">
              {r.condicion && (
                <Requisito titulo={r.condicion} texto={/estudiante/i.test(r.condicion) ? "Tienes que acreditar que estudias (constancia de estudios o de matrícula)." : /egresad/i.test(r.condicion) ? "Tienes que acreditar que egresaste (constancia de egreso). Muchas entidades piden que sea de los últimos 12 meses: revísalo en las bases." : null} />
              )}
              {(r.carreras.length > 0 || r.tipoCarrera) && (
                <li className="rounded-xl border border-line bg-paper p-3.5">
                  <p className="flex items-center gap-2 text-dato font-semibold text-ink">
                    <GraduationCap size={16} aria-hidden className="text-mute" /> {r.carreras.length === 1 ? "La carrera" : "Las carreras"}
                    {r.tipoCarrera && <span className="text-meta font-normal text-mute">({r.tipoCarrera.toLowerCase()})</span>}
                  </p>
                  {r.carreras.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {r.carreras.map((c) => (
                        <li key={c} className="rounded-full border border-line bg-caja px-3 py-1 text-meta text-inkSoft">{puesto(c)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              )}
              {p.conocimientos && <Requisito titulo="Conocimientos" texto={sinVineta(p.conocimientos)} Icono={BookOpen} />}
            </ul>
          </Caja>

          {p.actividades.length > 0 && (
            <Caja id="actividades" titulo="Lo que harás">
              <ul className="space-y-2">
                {p.actividades.map((a) => (
                  <li key={a} className="flex items-start gap-2.5 text-dato leading-snug text-ink">
                    <CheckCircle2 size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                    <span className="min-w-0">{sinVineta(a)}</span>
                  </li>
                ))}
              </ul>
            </Caja>
          )}
        </div>

        <div className={cn("grid grid-cols-[minmax(0,1fr)]", ESPACIO_CAJAS)}>
          <Caja
            id="como-postular"
            titulo={cerrada ? "Esta práctica ya cerró" : "Cómo postular"}
            pie={
              <p className="flex items-start gap-2 text-meta leading-relaxed text-inkSoft">
                <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
                Postular es siempre en la entidad y es gratis.
              </p>
            }
          >
            {cerrada ? (
              <p className="text-dato leading-relaxed text-inkSoft">
                Ya no recibe postulaciones. <Link href={rutaEn(base, "/app/practicas")} className="font-semibold text-granate underline-offset-4 hover:underline">Ver las prácticas abiertas</Link>.
              </p>
            ) : (
              <ol className="space-y-3 text-dato leading-relaxed text-inkSoft">
                <li>
                  <b className="font-semibold text-ink">1. Revisa las bases.</b> Dicen cómo se postula, qué documentos van y en qué formato.{" "}
                  {p.web ? "Están en la web de la entidad." : `Búscalas con el número ${p.numero ?? "de la convocatoria"}.`}
                </li>
                <li>
                  <b className="font-semibold text-ink">2. Prepara tus documentos:</b> CV, la constancia de {/egresad/i.test(r.condicion ?? "") ? "egreso" : "estudios"}, tu DNI y las
                  declaraciones juradas de las bases.
                </li>
                <li>
                  <b className="font-semibold text-ink">3. Postula antes del {p.fechaFin ? fechaDia(p.fechaFin) : "cierre"}</b>
                  {correo ? (
                    <>, por el canal que digan las bases. El correo de la entidad para esta convocatoria es <b className="font-semibold text-ink [overflow-wrap:anywhere]">{correo}</b>.</>
                  ) : p.correo ? (
                    ", por el canal que digan las bases. El correo de contacto está en el aviso de Talento Perú."
                  ) : (
                    ", por el canal que digan las bases."
                  )}
                </li>
              </ol>
            )}
            {!cerrada && (
              <div className="mt-4 flex flex-wrap gap-2">
                {p.web && (
                  <a href={p.web} target="_blank" rel="noopener noreferrer" className={claseAccion("primario")}>
                    Web de la entidad <ArrowUpRight size={15} aria-hidden />
                    <span className="sr-only"> (se abre en otra pestaña)</span>
                  </a>
                )}
                {correo && (
                  <a href={`mailto:${correo}?subject=${encodeURIComponent(`Convocatoria ${p.numero ?? ""}: ${puesto(p.titulo)}`)}`} className={claseAccion(p.web ? "secundario" : "primario")}>
                    <Mail size={15} aria-hidden /> Escribir a la entidad
                  </a>
                )}
                {p.detalleUrl && (
                  <a href={p.detalleUrl} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
                    Verla en Talento Perú <ArrowUpRight size={15} aria-hidden />
                    <span className="sr-only"> (se abre en otra pestaña)</span>
                  </a>
                )}
              </div>
            )}
          </Caja>

          {p.cronograma.length > 0 && (
            <Caja id="fechas" titulo="Las fechas" descripcion="El cronograma que publicó la entidad.">
              <ol className="space-y-2">
                {p.cronograma.map((x, i) => {
                  const paso = !!(x.fin && x.fin < hoy);
                  return (
                    <li key={`${x.etapa}-${i}`} className="grid grid-cols-[minmax(0,1fr)] gap-0.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:gap-3">
                      <span className={cn("text-meta font-semibold tabular-nums", paso ? "text-mute line-through" : "text-ink")}>
                        {x.inicio && x.fin && x.inicio !== x.fin ? `${fechaDia(x.inicio)} al ${fechaDia(x.fin)}` : fechaDia(x.fin ?? x.inicio)}
                      </span>
                      <span className={cn("text-dato leading-snug", paso ? "text-mute" : "text-inkSoft")}>{puesto(x.etapa)}</span>
                    </li>
                  );
                })}
              </ol>
            </Caja>
          )}

          <Caja id="beneficios" titulo="Lo que te dan">
            <ul className="space-y-1.5 text-dato leading-relaxed text-inkSoft">
              <li>
                <b className="font-semibold text-ink">{textoSubvencion(p.subvencion)}</b> de subvención.
              </li>
              {horario && <li>Horario {horario}.</li>}
              <li>Un seguro de salud y accidentes, por la ley de prácticas en el Estado (D. Leg. 1401); los demás beneficios están en las bases.</li>
              <li>Las prácticas cuentan como experiencia laboral para tus próximas postulaciones (Ley 31396).</li>
            </ul>
          </Caja>
        </div>
      </div>
    </Pagina>
  );
}

/** SERVIR escribe las viñetas dentro del texto («• Apoyar en…»): fuera, que la lista ya pone su ícono. */
const sinVineta = (t: string) => t.replace(/^[\s•·▪●\-–]+/, "").replace(/\s*[•▪●]\s*/g, ", ").trim();

function Cifra({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle: string }) {
  return (
    <div className="min-w-0 bg-caja p-4 sm:p-5">
      <dt className="text-meta font-semibold text-inkSoft">{etiqueta}</dt>
      <dd className="mt-2 truncate font-display text-bloque font-bold leading-tight tabular-nums text-ink sm:text-seccion">{valor}</dd>
      <dd className="mt-1.5 text-meta text-mute">{detalle}</dd>
    </div>
  );
}

function Requisito({ titulo, texto, Icono = CheckCircle2 }: { titulo: string; texto: string | null; Icono?: typeof CheckCircle2 }) {
  return (
    <li className="rounded-xl border border-line bg-paper p-3.5">
      <p className="flex items-center gap-2 text-dato font-semibold text-ink">
        <Icono size={16} aria-hidden className="shrink-0 text-mute" /> {titulo}
      </p>
      {texto && <p className="mt-1 text-meta leading-relaxed text-inkSoft">{texto}</p>}
    </li>
  );
}
