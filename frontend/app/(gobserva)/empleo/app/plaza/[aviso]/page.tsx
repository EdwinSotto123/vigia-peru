import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, BellRing, Bot, Building2, CircleCheckBig, Clock, Eye, FileText, Lock, MapPin, MessageSquareText, ScrollText, ShieldCheck, Users } from "lucide-react";
import { LoEsencial } from "@/components/empleo/LoEsencial";
import { LasBases } from "@/components/empleo/LasBases";
import { CLASE_ENLACE_PIE, Caja, ESPACIO_CAJAS, Pagina } from "@/components/gobserva/app/Caja";
import { CumplesRequisitos, type Requisito } from "@/components/empleo/CumplesRequisitos";
import { RangoSueldo, fraseSueldo } from "@/components/empleo/RangoSueldo";
import { CopiarEnlace } from "@/components/licitaciones-app/detalle/CopiarEnlace";
import { SeguirConEtapa } from "@/components/licitaciones-app/seguimiento/BotonSeguir";
import { Insignia } from "@/components/licitaciones-app/ui/Insignia";
import {
  aniosCorto, claseRequisito, diasParaCierre, entidadNombre, enumerar, fechaDia, lugar, puesto, textoCierre, tipoContrato,
} from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { palabrasClave, rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { SENAL_PLAZA, getFichaPlaza } from "@/lib/planilla";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Las ofertas laborales del Estado en SERVIR. */
const SERVIR = "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml";

type Props = { params: { aviso: string }; searchParams: Record<string, string | string[] | undefined> };

/** Un texto de SERVIR que no dice nada («.», «-», vacío) no es un requisito. */
const conTexto = (t: string | null | undefined) => (t && t.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 ? t.trim() : null);
/** SERVIR escribe los requisitos en mayúsculas con viñetas sueltas: en oración, cada viñeta en su línea. */
const legible = (t: string) => puesto(t.replace(/\s*[•▪●]\s*/g, "\n").replace(/^\n+/, ""));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getFichaPlaza(params.aviso);
  if (!d) return { title: "Plaza no encontrada", robots: { index: false, follow: false } };
  return { title: `${puesto(d.plaza.titulo)} en ${entidadNombre(d.plaza.entidad)}`, robots: { index: false, follow: false } };
}

/**
 * La ficha de una plaza CAS dentro de la app de Empleo (2026-11-07), como la ficha de una licitación: arriba el puesto, la
 * entidad, guardarla con su etapa (el tablero de postulaciones), postular y copiar el enlace; cuatro cifras (sueldo,
 * cierre, experiencia, vacantes); y en cajas, si cumples los requisitos, lo que pagan otras entidades, lo que nadie te
 * dice, cómo postular y la misma plaza en esta entidad. «Plazas» vuelve a la lista con los filtros (?volver=).
 */
export default async function DetallePlaza({ params, searchParams }: Props) {
  const d = await getFichaPlaza(params.aviso);
  if (!d) notFound();
  const base = baseProducto("empleo");
  const p = d.plaza;
  const crudo = Array.isArray(searchParams.volver) ? searchParams.volver[0] : searchParams.volver;
  const volver = rutaEn(base, `/app/plazas${crudo && /^[\w%=&.,+-]*$/.test(crudo) ? `?${crudo}` : ""}`);
  const dias = diasParaCierre(p.fechaFin);
  const cerrada = dias != null && dias < 0;
  const titulo = puesto(p.titulo);
  const entidad = entidadNombre(p.entidad);
  const vacantes = p.vacantes ?? 1;
  const contrato = tipoContrato(p.numero, p.titulo);
  const expCorta = aniosCorto(p.expGeneral);
  const comparada =
    d.enOtras && d.enOtras.mediana != null && d.enOtras.p25 != null && d.enOtras.p75 != null
      ? { p25: d.enOtras.p25, mediana: d.enOtras.mediana, p75: d.enOtras.p75, plazas: d.enOtras.plazas, entidades: d.enOtras.entidades }
      : null;
  const regionSlug = (p.ubicacion ?? "").split(" - ")[0].trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-") || null;
  const palabras = palabrasClave(p.titulo) || titulo.slice(0, 40);
  const parecidas = rutaEn(base, `/app/plazas?${new URLSearchParams({ q: palabras, ...(regionSlug ? { region: regionSlug } : {}) })}`);

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

  const boton = "inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-caja px-3.5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-ink/20";

  return (
    <Pagina>
      <header className="mb-6">
        <Link href={volver} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg text-dato font-semibold text-inkSoft underline-offset-4 hover:text-ink hover:underline">
          <ArrowLeft size={16} aria-hidden /> Plazas
        </Link>
        <div className="mt-3 flex flex-col-reverse gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 xl:pt-2.5">
            <span className="font-mono text-meta font-semibold text-inkSoft">Aviso {p.aviso}</span>
            <Insignia>Plaza CAS</Insignia>
            {contrato.temporal != null && <Insignia>{contrato.temporal ? "Temporal" : "A plazo indeterminado"}</Insignia>}
            {cerrada ? (
              <Insignia tono="aviso" Icono={Lock}>Ya cerró</Insignia>
            ) : (
              <Insignia tono="acento">Recibe postulaciones</Insignia>
            )}
            {p.senales?.length ? <Insignia tono="aviso" Icono={Eye}>{p.senales.length === 1 ? "1 cosa que saber" : `${p.senales.length} cosas que saber`}</Insignia> : null}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
            <SeguirConEtapa id={String(p.aviso)} codigo={null} titulo={titulo} tipo="plaza" />
            {!cerrada && p.detalleUrl && (
              <a href={p.detalleUrl} target="_blank" rel="noopener noreferrer" className={boton}>
                Postular en la entidad <ArrowUpRight size={15} aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            )}
            <Link href={rutaEn(base, `/app/asistente?pregunta=${encodeURIComponent(`Explícame la plaza ${p.aviso} (${titulo} en ${entidad}): qué piden, si me conviene y qué documentos preparo.`)}`)} className={boton}>
              <Bot size={15} aria-hidden /> Preguntarle al asistente
            </Link>
            <CopiarEnlace />
          </div>
        </div>
        <div className="mt-3 min-w-0">
          <h1 className="max-w-[80ch] text-pretty font-display text-bloque font-bold leading-snug tracking-tight text-ink sm:text-seccion">{titulo}</h1>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-dato text-inkSoft">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Building2 size={15} aria-hidden className="shrink-0 text-mute" />
              {entidad}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={15} aria-hidden className="text-mute" />
              {lugar(p.ubicacion)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users size={15} aria-hidden className="text-mute" />
              {vacantes === 1 ? "1 vacante" : `${numero(vacantes)} vacantes`}
            </span>
          </p>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-caja lg:grid-cols-4">
          <Cifra
            etiqueta="Sueldo al mes"
            valor={p.remuneracion ? soles(p.remuneracion) : "Sin dato"}
            detalle={comparada && p.remuneracion ? fraseSueldo(p.remuneracion, comparada.p25, comparada.mediana, comparada.p75) : "Lo publica la entidad en SERVIR"}
          />
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
          <Cifra etiqueta="Experiencia" valor={expCorta ?? "Según el aviso"} detalle={p.expGeneral === 0 ? "No pide experiencia" : "Experiencia general que pide"} />
          <Cifra etiqueta="Publicada" valor={p.fechaInicio ? fechaDia(p.fechaInicio) : "Sin fecha"} detalle={hace(p.fechaInicio)} />
        </dl>
      </header>

      <div className={cn("grid grid-cols-[minmax(0,1fr)] items-start xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]", ESPACIO_CAJAS)}>
        <div className={cn("grid grid-cols-[minmax(0,1fr)]", ESPACIO_CAJAS)}>
          <LoEsencial aviso={p.aviso} />
          <LasBases aviso={p.aviso} numero={p.numero} />
          <Caja
            id="cumples"
            titulo="¿Cumples los requisitos?"
            descripcion={
              requisitos.length > 0
                ? "Marca lo que ya tienes. Es lo que pide la entidad en su aviso; las bases completas están en su publicación."
                : "El aviso no trae requisitos para marcar: están en las bases de la convocatoria."
            }
          >
            <div className="space-y-3">
              {requisitos.length > 0 && <CumplesRequisitos aviso={p.aviso} requisitos={requisitos} postular={p.detalleUrl} servir={SERVIR} cerrada={cerrada} />}
              {enBases.length > 0 && (
                <Nota icono={<ScrollText size={15} aria-hidden />}>El aviso no detalla {enumerar(enBases)}: remite a las bases de la convocatoria. Revísalas antes de postular.</Nota>
              )}
              {noPide.length > 0 && <Nota icono={<CircleCheckBig size={15} aria-hidden />}>No pide {enumerar(noPide, "ni")}.</Nota>}
              {requisitos.length === 0 && enBases.length === 0 && noPide.length === 0 && (
                <Nota icono={<ScrollText size={15} aria-hidden />}>Revisa las bases en la web de la entidad o en SERVIR.</Nota>
              )}
            </div>
          </Caja>

          {comparada && (
            <Caja id="sueldo" titulo="Lo que pagan otras entidades por este puesto" descripcion={`${numero(comparada.plazas)} plazas parecidas en ${numero(comparada.entidades)} entidades.`}>
              <RangoSueldo sueldo={p.remuneracion} p25={comparada.p25} mediana={comparada.mediana} p75={comparada.p75} plazas={comparada.plazas} entidades={comparada.entidades} />
            </Caja>
          )}

          <Caja id="saber" titulo="Lo que nadie te dice" descripcion="Datos públicos cruzados por Vigía. No prueban que la plaza esté arreglada: te ayudan a decidir dónde pones tu esfuerzo.">
            {p.senales?.length ? (
              <ul className="space-y-3">
                {p.senales.map((s) => {
                  const info = SENAL_PLAZA[s.tipo];
                  const extra = detalleSenal(s.tipo, (s.detalle ?? {}) as Record<string, unknown>);
                  return (
                    <li key={s.tipo} className="rounded-xl border border-amber/30 bg-amber-soft/40 p-4">
                      <p className="flex items-start gap-2 text-dato font-semibold leading-snug text-ink">
                        <Eye size={17} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
                        {info?.titulo ?? s.tipo}
                      </p>
                      <p className="mt-1.5 text-dato leading-relaxed text-inkSoft">{info?.explica}</p>
                      {extra && <p className="mt-2 border-t border-amber/20 pt-2 text-meta leading-relaxed text-inkSoft">{extra}</p>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <ul className="divide-y divide-line">
                {[
                  "No pide experiencia en la misma entidad que convoca.",
                  "No encontramos personas que ya hicieran ese trabajo por órdenes de servicio.",
                  "No la convocó una gestión de salida.",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2.5 py-2.5 text-dato leading-snug text-inkSoft first:pt-0 last:pb-0">
                    <CircleCheckBig size={17} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </Caja>
        </div>

        <div className={cn("grid grid-cols-[minmax(0,1fr)]", ESPACIO_CAJAS)}>
          <Caja
            id="postular"
            titulo={cerrada ? "Esta plaza ya cerró" : "Cómo postular"}
            pie={
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                {p.detalleUrl && (
                  <a href={p.detalleUrl} target="_blank" rel="noopener noreferrer" className={CLASE_ENLACE_PIE}>
                    Web de la entidad <ArrowUpRight size={14} aria-hidden />
                    <span className="sr-only"> (se abre en otra pestaña)</span>
                  </a>
                )}
                <a href={SERVIR} target="_blank" rel="noopener noreferrer" className={CLASE_ENLACE_PIE}>
                  <FileText size={14} aria-hidden /> Buscarla en SERVIR <span className="sr-only">(aviso {p.aviso}, se abre en otra pestaña)</span>
                </a>
              </span>
            }
          >
            {cerrada ? (
              <p className="text-dato leading-relaxed text-inkSoft">
                Ya no recibe postulaciones. Puede haber otras iguales abiertas hoy:{" "}
                <Link href={parecidas} className="font-semibold text-granate underline-offset-4 hover:underline">ver plazas parecidas</Link>.
              </p>
            ) : (
              <>
              <ol className="space-y-4">
                <Paso n={1} titulo="Junta tus documentos">
                  Tu CV documentado: una copia simple de cada título, certificado y constancia que pruebe lo que piden (la experiencia, con fechas de
                  inicio y fin). Tu DNI y las declaraciones juradas, en los formatos de las bases.
                </Paso>
                <Paso n={2} titulo="Revisa las bases">
                  Si las encontramos, están arriba en «Las bases, leídas»: el cronograma, cómo te evalúan, qué presentar y por dónde se postula. Si no,{" "}
                  {p.numero ? <>busca la convocatoria <b className="font-semibold text-ink">{p.numero}</b> en la web de la entidad.</> : <>busca el aviso <b className="font-mono font-semibold text-ink">{p.aviso}</b> en SERVIR.</>}
                </Paso>
                <Paso n={3} titulo="Postula antes del cierre">
                  {p.fechaFin ? `Tienes hasta el ${fechaDia(p.fechaFin).replace(/\.$/, "")}. ` : ""}Es gratis: nadie puede cobrarte por una plaza del Estado. Con «Guardar» la llevas en tu
                  tablero y en tu calendario, y te avisamos antes de que cierre.
                </Paso>
                <Paso n={4} titulo="Las etapas">
                  Primero revisan tu CV contra el perfil; quien pasa va a una entrevista. Algunas entidades suman un examen de conocimientos. Los resultados
                  se publican en la web de la entidad, en las fechas del cronograma.
                </Paso>
              </ol>
              <p className="mt-4 rounded-lg bg-granate-50/60 px-3 py-2.5 text-meta leading-relaxed text-inkSoft">
                <b className="font-semibold text-ink">Puntaje extra por ley.</b> Si tienes una discapacidad acreditada (15%), eres licenciado de las Fuerzas Armadas
                (10%) o deportista calificado, decláralo y adjunta el documento que lo prueba.
              </p>
              </>
            )}
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-ink/[0.035] px-3 py-2.5 text-meta leading-relaxed text-inkSoft">
              <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
              Postular es siempre en la entidad. Gobserva no recibe postulaciones.
            </p>
          </Caja>

          {!cerrada && (
            <Caja id="asistente" titulo="Pregúntale al asistente" descripcion="Conoce esta plaza y tu perfil. Cada pregunta usa 5 créditos de tu plan.">
              <ul className="space-y-2">
                {[
                  `¿Cumplo con la plaza ${p.aviso}? Revisa sus requisitos contra mi perfil y dime qué me falta.`,
                  `¿Qué documentos preparo para postular a la plaza ${p.aviso} y cómo pruebo la experiencia que pide?`,
                  `¿Hay plazas parecidas a la ${p.aviso} que paguen más o pidan menos experiencia?`,
                ].map((q) => (
                  <li key={q}>
                    <Link
                      href={rutaEn(base, `/app/asistente?pregunta=${encodeURIComponent(q)}`)}
                      className="flex items-start gap-2.5 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-dato leading-snug text-ink transition-colors duration-rapido hover:border-granate/50"
                    >
                      <MessageSquareText size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                      {q}
                    </Link>
                  </li>
                ))}
              </ul>
            </Caja>
          )}

          {d.mismoTitulo.length > 0 && (
            <Caja
              id="misma"
              titulo="La misma plaza en esta entidad"
              descripcion={`${d.mismoTitulo.length === 1 ? "Otra convocatoria" : `${numero(d.mismoTitulo.length)} convocatorias más`} con el mismo puesto: una plaza que se repite puede ser de alta rotación.`}
              relleno={false}
            >
              <ul className="divide-y divide-line">
                {d.mismoTitulo.slice(0, 8).map((m) => (
                  <li key={m.aviso}>
                    <Link href={rutaEn(base, `/app/plaza/${m.aviso}`)} className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 transition-colors duration-rapido hover:bg-ink/[0.03] sm:px-5">
                      <span className="min-w-0">
                        <span className="block truncate text-dato font-medium text-ink">{m.numero ?? `Aviso ${m.aviso}`}</span>
                        <span className="mt-0.5 block text-meta text-mute">{m.fechaInicio ? `Publicada el ${fechaDia(m.fechaInicio)}` : "Sin fecha de publicación"}</span>
                      </span>
                      <span className="shrink-0 text-dato font-semibold tabular-nums text-inkSoft">{m.remuneracion ? soles(m.remuneracion) : "Sin dato"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Caja>
          )}

          <Caja
            id="parecidas"
            titulo="Plazas como esta"
            descripcion="La lista ya filtrada con este puesto y esta región. Desde ahí la guardas como alerta y te avisamos cuando salga otra."
            pie={
              <Link href={parecidas} className={CLASE_ENLACE_PIE}>
                <BellRing size={14} aria-hidden /> Ver plazas parecidas
              </Link>
            }
          >
            <p className="text-dato text-inkSoft">
              Buscamos «<b className="font-semibold text-ink">{palabras}</b>»{regionSlug ? <> en {lugar(p.ubicacion).split(",")[0]}</> : null}.
            </p>
          </Caja>
        </div>
      </div>
    </Pagina>
  );
}

/** «Hoy», «Ayer», «Hace 5 días»: cuándo se publicó en SERVIR. */
function hace(fecha: string | null): string {
  const d = diasParaCierre(fecha);
  if (d == null) return "SERVIR no trae la fecha";
  if (d >= 0) return "Publicada hoy";
  return d === -1 ? "Ayer, en SERVIR" : `Hace ${-d} días, en SERVIR`;
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

function Nota({ icono, children }: { icono: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-ink/[0.035] px-3 py-2.5 text-dato leading-relaxed text-inkSoft">
      <span className="mt-0.5 shrink-0 text-mute">{icono}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-granate font-mono text-meta font-bold text-paper">{n}</span>
      <div className="min-w-0 pt-1">
        <p className="text-dato font-semibold leading-snug text-ink">{titulo}</p>
        <p className="mt-0.5 text-dato leading-relaxed text-inkSoft">{children}</p>
      </div>
    </li>
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

