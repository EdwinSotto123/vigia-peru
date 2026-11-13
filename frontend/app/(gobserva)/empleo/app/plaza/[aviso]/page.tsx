import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BellRing, Building2, CircleCheckBig, Eye, Lock, MapPin, MessageSquareText, Users } from "lucide-react";
import { AccionesPlaza, BarraPlaza, CifraCierre, CuentaBases, CuentaCumplo } from "@/components/empleo/BarraPlaza";
import { FichaPlaza, Pastilla, type PestanaPlaza } from "@/components/empleo/FichaPlaza";
import { LasBases } from "@/components/empleo/LasBases";
import { PuedesPostular, TuPerfil } from "@/components/empleo/PuedesPostular";
import { QueHacer } from "@/components/empleo/QueHacer";
import type { PlazaParaCumplir } from "@/components/empleo/usePlaza";
import { CLASE_ENLACE_PIE, Caja, ESPACIO_CAJAS, Pagina } from "@/components/gobserva/app/Caja";
import { RangoSueldo, fraseSueldo } from "@/components/empleo/RangoSueldo";
import { CopiarEnlace } from "@/components/licitaciones-app/detalle/CopiarEnlace";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { aniosCorto, diasParaCierre, entidadNombre, fechaDia, lugar, puesto, tipoContrato } from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { palabrasClave, rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { SENAL_PLAZA, getFichaPlaza } from "@/lib/planilla";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Las ofertas laborales del Estado en SERVIR. */
const SERVIR = "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml";

type Props = { params: { aviso: string }; searchParams: Record<string, string | string[] | undefined> };

/** SERVIR escribe los requisitos en mayúsculas con viñetas sueltas: en oración, cada viñeta en su línea. */
const legible = (t: string) => puesto(t.replace(/\s*[•▪●]\s*/g, "\n").replace(/^\n+/, ""));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getFichaPlaza(params.aviso);
  if (!d) return { title: "Plaza no encontrada", robots: { index: false, follow: false } };
  return { title: `${puesto(d.plaza.titulo)} en ${entidadNombre(d.plaza.entidad)}`, robots: { index: false, follow: false } };
}

/**
 * La ficha de una plaza CAS dentro de la app de Empleo, en pestañas (2026-11-08, el usuario: «sigue apilado, sin saber
 * si cumples, sin decirte qué hacer, sin botón de previsualizar bases» y luego «ordénalo en subpestañas, con un top fijo»):
 *
 *   - Arriba el puesto, la entidad y cuatro cifras (el cierre con la fecha de las bases si difiere de SERVIR).
 *   - Una barra fija bajo la cabecera de la app (BarraPlaza): cuánto cumples, cuándo se postula y las acciones (postular,
 *     ver las bases en un panel, guardar); al bajar, el título en corto. Debajo, las pestañas (FichaPlaza, en #ancla):
 *     ¿Cumples?, Cómo postular, Bases, Lo que nadie te dice, Sueldo y parecidas y Asistente.
 *
 * «Plazas» vuelve a la lista con los filtros (?volver=); ?tab= o #ancla abren una pestaña.
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

  const tab = Array.isArray(searchParams.tab) ? searchParams.tab[0] : searchParams.tab;
  const plaza: PlazaParaCumplir = {
    aviso: p.aviso,
    formacion: p.formacion,
    experiencia: p.experiencia,
    especializacion: p.especializacion,
    conocimiento: p.conocimiento,
    expGeneral: p.expGeneral,
    region: regionSlug,
    remuneracion: p.remuneracion,
  };
  const senales = p.senales ?? [];

  const pestanas: PestanaPlaza[] = [
    {
      clave: "cumples",
      titulo: "¿Cumples?",
      cuenta: <CuentaCumplo plaza={plaza} />,
      contenido: (
        <div className={cn("grid grid-cols-[minmax(0,1fr)] items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]", ESPACIO_CAJAS)}>
          <PuedesPostular base={base} cerrada={cerrada} plaza={plaza} />
          <TuPerfil base={base} />
        </div>
      ),
    },
    {
      clave: "postular",
      titulo: "Cómo postular",
      contenido: (
        <QueHacer
          aviso={p.aviso}
          numero={p.numero}
          fechaFin={p.fechaFin}
          publicada={p.fechaInicio}
          postular={p.detalleUrl}
          servir={SERVIR}
          cerrada={cerrada}
          parecidas={parecidas}
        />
      ),
    },
    {
      clave: "bases",
      titulo: "Bases",
      cuenta: <CuentaBases aviso={p.aviso} />,
      contenido: <LasBases aviso={p.aviso} numero={p.numero} web={p.detalleUrl} servir={SERVIR} />,
    },
    {
      clave: "saber",
      titulo: "Lo que nadie te dice",
      cuenta: senales.length ? (
        <Pastilla tono="confirma" etiqueta={senales.length === 1 ? "cosa que saber" : "cosas que saber"}>
          {senales.length}
        </Pastilla>
      ) : undefined,
      contenido: (
        <Caja id="saber" titulo="Lo que nadie te dice" descripcion="Datos públicos cruzados por Vigía. No prueban que la plaza esté arreglada: te ayudan a decidir dónde pones tu esfuerzo.">
          {senales.length ? (
            <ul className="grid gap-3 lg:grid-cols-2">
              {senales.map((s) => {
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
            <ul className="grid gap-3 lg:grid-cols-3">
              {[
                "No pide experiencia en la misma entidad que convoca.",
                "No encontramos personas que ya hicieran ese trabajo por órdenes de servicio.",
                "No la convocó una gestión de salida.",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 rounded-xl border border-line bg-paper p-3.5 text-dato leading-snug text-inkSoft">
                  <CircleCheckBig size={17} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
                  {t}
                </li>
              ))}
            </ul>
          )}
        </Caja>
      ),
    },
    {
      clave: "sueldo",
      titulo: "Sueldo y parecidas",
      contenido: (
        <div className={cn("grid grid-cols-[minmax(0,1fr)] items-start xl:grid-cols-2", ESPACIO_CAJAS)}>
          {comparada ? (
            <Caja id="sueldo" titulo="Lo que pagan otras entidades por este puesto" descripcion={`${numero(comparada.plazas)} plazas parecidas en ${numero(comparada.entidades)} entidades.`}>
              <RangoSueldo sueldo={p.remuneracion} p25={comparada.p25} mediana={comparada.mediana} p75={comparada.p75} plazas={comparada.plazas} entidades={comparada.entidades} />
            </Caja>
          ) : (
            <Caja id="sueldo" titulo="El sueldo">
              <p className="text-dato leading-relaxed text-inkSoft">
                {p.remuneracion ? <>Paga <b className="font-semibold text-ink">{soles(p.remuneracion)}</b> al mes. </> : "La entidad no publicó el sueldo en SERVIR. "}
                No hay suficientes plazas parecidas para compararlo con otras entidades.
              </p>
            </Caja>
          )}
          <div className={cn("grid grid-cols-[minmax(0,1fr)]", ESPACIO_CAJAS)}>
            {d.mismoTitulo.length > 0 && (
              <Caja
                id="misma"
                titulo="La misma plaza en esta entidad"
                descripcion={`${d.mismoTitulo.length === 1 ? "Otra convocatoria" : `${numero(d.mismoTitulo.length)} convocatorias más`} con el mismo puesto: una plaza que se repite puede ser de alta rotación.`}
                relleno={false}
              >
                <ul className="divide-y divide-line">
                  {/* recorte: las 8 más recientes; la descripción dice cuántas son en total */}
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
      ),
    },
    ...(cerrada
      ? []
      : [
          {
            clave: "asistente" as const,
            titulo: "Asistente",
            contenido: (
              <Caja id="asistente" titulo="Pregúntale al asistente" descripcion="Conoce esta plaza y tu perfil. Cada pregunta usa 5 créditos de tu plan.">
                <ul className="grid gap-3 lg:grid-cols-3">
                  {[
                    `¿Cumplo con la plaza ${p.aviso}? Revisa sus requisitos contra mi perfil y dime qué me falta.`,
                    `¿Qué documentos preparo para postular a la plaza ${p.aviso} y cómo pruebo la experiencia que pide?`,
                    `¿Hay plazas parecidas a la ${p.aviso} que paguen más o pidan menos experiencia?`,
                  ].map((q) => (
                    <li key={q}>
                      <Link
                        href={rutaEn(base, `/app/asistente?pregunta=${encodeURIComponent(q)}`)}
                        className="flex h-full items-start gap-2.5 rounded-xl border border-line bg-paper px-3.5 py-3 text-dato leading-snug text-ink transition-colors duration-rapido hover:border-granate/50"
                      >
                        <MessageSquareText size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                        {q}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Caja>
            ),
          },
        ]),
  ];

  return (
    <Pagina>
      <header id="cabecera-plaza">
        <div className="flex items-center justify-between gap-3">
          <Link href={volver} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg text-dato font-semibold text-inkSoft underline-offset-4 hover:text-ink hover:underline">
            <ArrowLeft size={16} aria-hidden /> Plazas
          </Link>
          <CopiarEnlace />
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-mono text-meta font-semibold text-inkSoft">Aviso {p.aviso}</span>
          <Insignia>Plaza CAS</Insignia>
          {contrato.temporal != null && <Insignia>{contrato.temporal ? "Temporal" : "A plazo indeterminado"}</Insignia>}
          {cerrada ? (
            <Insignia tono="aviso" Icono={Lock}>Ya cerró</Insignia>
          ) : (
            <Insignia tono="acento">Recibe postulaciones</Insignia>
          )}
          {senales.length ? (
            <a href="#saber" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate">
              <Insignia tono="aviso" Icono={Eye}>{senales.length === 1 ? "1 cosa que saber" : `${senales.length} cosas que saber`}</Insignia>
            </a>
          ) : null}
        </div>
        <div className="mt-3 min-w-0">
          <h1 id="titulo-plaza" className="max-w-[80ch] text-pretty font-display text-bloque font-bold leading-snug tracking-tight text-ink sm:text-seccion">{titulo}</h1>
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
        <AccionesPlaza aviso={p.aviso} titulo={titulo} />

        <dl className="mb-2 mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-caja lg:grid-cols-4">
          <Cifra
            etiqueta="Sueldo al mes"
            valor={p.remuneracion ? soles(p.remuneracion) : "Sin dato"}
            detalle={comparada && p.remuneracion ? fraseSueldo(p.remuneracion, comparada.p25, comparada.mediana, comparada.p75) : "Lo publica la entidad en SERVIR"}
          />
          <CifraCierre aviso={p.aviso} fechaFin={p.fechaFin} cerrada={cerrada} />
          <Cifra etiqueta="Experiencia" valor={expCorta ?? "Según el aviso"} detalle={p.expGeneral === 0 ? "No pide experiencia" : "Experiencia general que pide"} />
          <Cifra etiqueta="Publicada" valor={p.fechaInicio ? fechaDia(p.fechaInicio) : "Sin fecha"} detalle={hace(p.fechaInicio)} />
        </dl>
      </header>

      <FichaPlaza
        inicial={tab}
        barra={<BarraPlaza plaza={plaza} titulo={titulo} entidad={entidad} fechaFin={p.fechaFin} cerrada={cerrada} postular={p.detalleUrl} servir={SERVIR} />}
        pestanas={pestanas}
      />
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

