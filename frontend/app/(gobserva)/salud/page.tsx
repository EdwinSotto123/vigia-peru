import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, BadgeCheck, Building2, CalendarClock, CircleSlash, FileSearch, Gavel, GraduationCap, LocateFixed, MapPinned, MessageSquareWarning,
  Scissors, Search, Stethoscope, type LucideIcon,
} from "lucide-react";
import { FuenteFecha, InsigniaEstado, InsigniaHecho } from "@/components/salud/comun";
import { ClasesDeHecho } from "@/components/salud/fuentes/ClasesDeHecho";
import { URL_CMP, URL_DATOS_SUSALUD, URL_DENUNCIA_SUSALUD, URL_RENIPRESS_CONSULTA, URL_SANCIONES, URL_SUNEDU } from "@/components/salud/fuentes/urls";
import { nombreLugar } from "@/components/salud/lista/filtros";
import { BloqueAsistenteSalud } from "@/components/salud/portada/BloqueAsistenteSalud";
import { BloqueMCPSalud } from "@/components/salud/portada/BloqueMCPSalud";
import { BuscadorSalud } from "@/components/salud/portada/BuscadorSalud";
import { EjemploVerificacion } from "@/components/salud/portada/EjemploVerificacion";
import { AvisoEmergencia, CabeceraSeccion, PasoNumerado, Tesela } from "@/components/salud/portada/Piezas";
import { Faq } from "@/components/licitaciones/Faq";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { ESTADOS_CHEQUEO, getResumenSalud, numero, type EstadoChequeo, type TipoHecho } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Salud: verifica tu clínica y a tu médico con fuentes oficiales" },
  description:
    "Antes de atenderte, revisa si el establecimiento está registrado y activo en RENIPRESS, su categoría, sus servicios y si tiene sanciones firmes de SUSALUD, y cómo verificar a tu médico en el Colegio Médico. Cada dato con su fuente y su fecha. Gratis y sin cuenta.",
  alternates: { canonical: urlCanonica("salud", "/") },
};

/** Lo que significa cada estado de un chequeo (los de la ficha), en una línea. */
const SIGNIFICA_ESTADO: Record<EstadoChequeo, string> = {
  ok: "La fuente oficial lo confirma, a la fecha que se indica.",
  atencion: "Hay algo que conviene preguntar antes de atenderte: no es un veredicto.",
  alerta: "La fuente registra una baja, un cierre o que el establecimiento ya no figura.",
  sin_dato: "La fuente no trae ese dato: no se afirma nada.",
  externo: "Lo confirma otra institución (el Colegio Médico, SUNEDU): te llevamos ahí.",
};


/**
 * Portada de Gobserva Salud (2026-11-20). Aquí el buscador ES el producto: el héroe trae el buscador (nombre, código
 * IPRESS, RUC o colegiatura) y las dos entradas rápidas (el médico y el mapa). Debajo, un relato: lo que no se ve desde la
 * puerta, cómo verificar en tres pasos, qué significa cada clase de hecho y cada estado, de dónde sale cada dato y a qué
 * fecha, el país en cifras (cada una con su fuente y su fecha), el asistente, el MCP abierto, las preguntas frecuentes y
 * el cierre con el buscador otra vez. GET /salud/resumen (10 min en caché).
 */
export default async function InicioSalud() {
  const base = baseProducto("salud");
  const r = await getResumenSalud();
  const ruta = (p: string) => rutaEn(base, p);
  const f = r?.fuentes;
  const mes = (x: string | null | undefined) => (x ? x.slice(0, 7) : null);

  const fuentes: { Icono: LucideIcon; nombre: string; entidad: string; que: string; tipo: TipoHecho; url: string; al: string | number | null; vivo?: boolean }[] = [
    { Icono: Building2, nombre: "RENIPRESS", entidad: "SUSALUD", que: "Si el establecimiento está registrado y activo, su categoría, su dirección y los servicios que declaró.", tipo: "registro_administrativo", url: URL_RENIPRESS_CONSULTA, al: f?.renipressAl ?? null },
    { Icono: Gavel, nombre: "Registro de Sanciones", entidad: "SUSALUD", que: "Las sanciones firmes a establecimientos y aseguradoras: amonestación, multa o cierre.", tipo: "sancion_firme", url: URL_SANCIONES, al: f?.sancionesAl ?? null },
    { Icono: MessageSquareWarning, nombre: "Consultas y denuncias", entidad: "SUSALUD, datos abiertos", que: "Cuántas denuncias recibió SUSALUD sobre cada institución, por año y sin datos de las personas.", tipo: "denuncia", url: URL_DATOS_SUSALUD, al: f?.denunciasAl ?? null },
    { Icono: Activity, nombre: "Recursos de salud", entidad: "SUSALUD, datos abiertos", que: "Médicos, camas y consultorios que cada establecimiento declara cada mes.", tipo: "registro_administrativo", url: URL_DATOS_SUSALUD, al: mes(f?.recursosAl) },
    { Icono: Scissors, nombre: "Intervenciones quirúrgicas", entidad: "SUSALUD, datos abiertos", que: "Las cirugías que cada establecimiento declara al mes.", tipo: "registro_administrativo", url: URL_DATOS_SUSALUD, al: mes(f?.cirugiasAl) },
    { Icono: Stethoscope, nombre: "Conoce a tu médico", entidad: "Colegio Médico del Perú", que: "Si el médico está colegiado y hábil, y su especialidad registrada (RNE).", tipo: "verificacion_externa", url: URL_CMP, al: null, vivo: true },
    { Icono: GraduationCap, nombre: "Grados y títulos", entidad: "SUNEDU", que: "El título de médico cirujano y la segunda especialidad inscritos.", tipo: "verificacion_externa", url: URL_SUNEDU, al: null, vivo: true },
  ];

  return (
    <>
      {/* ── Héroe: el buscador ───────────────────────────────────────────────── */}
      <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper" aria-labelledby="heroe-t">
        <div className="container-page relative grid gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-14 lg:py-20">
          <div className="min-w-0">
            <h1 id="heroe-t" className="text-balance font-display text-cifra font-bold leading-[1.06] tracking-[-0.025em] sm:text-portada lg:text-cartel">
              Verifica tu clínica y a tu médico <span className="text-maiz">antes de atenderte.</span>
            </h1>
            <p className="mt-5 max-w-[58ch] text-pretty text-cuerpo leading-relaxed text-paper/75 sm:text-bloque">
              Busca cualquier establecimiento de salud del Perú: si está registrado y activo, su categoría, sus servicios y si tiene sanciones firmes de
              SUSALUD. Cada dato, con su fuente oficial y su fecha. Gratis y sin cuenta.
            </p>
            <BuscadorSalud accion={ruta("/buscar")} oscuro className="mt-7" id="buscar" />
            <p className="mt-2.5 text-meta leading-relaxed text-paper/65">
              Por nombre, código IPRESS (8 cifras), RUC (11 cifras) o número de colegiatura del médico.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Búsquedas de ejemplo">
              {[
                { t: "Hospital Loayza", q: "hospital loayza" },
                { t: "Clínicas de Miraflores", q: "clinica miraflores" },
                { t: "Código IPRESS 00006207", q: "00006207" },
              ].map((x) => (
                <li key={x.q}>
                  <Link
                    href={`${ruta("/buscar")}?q=${encodeURIComponent(x.q)}`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-paper/20 px-3.5 text-meta font-medium text-paper/85 transition-colors duration-rapido hover:border-maiz/60 hover:bg-paper/10 hover:text-paper sm:min-h-9"
                  >
                    <Search size={13} aria-hidden /> {x.t}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-col gap-2.5 border-t border-paper/10 pt-6 sm:flex-row sm:flex-wrap">
              <Link href={`${ruta("/cerca")}?ubicar=1`} className={claseAccion("contornoOscuro", "min-h-12 justify-start sm:justify-center", "sm")}>
                <LocateFixed size={17} aria-hidden /> Estoy adentro: buscar con mi ubicación
              </Link>
              <Link href={ruta("/medico")} className={claseAccion("contornoOscuro", "min-h-12 justify-start sm:justify-center", "sm")}>
                <Stethoscope size={17} aria-hidden /> Verificar a un médico
              </Link>
              <Link href={ruta("/mapa")} className={claseAccion("contornoOscuro", "min-h-12 justify-start sm:justify-center", "sm")}>
                <MapPinned size={17} aria-hidden /> Ver el mapa de establecimientos
              </Link>
            </div>
            <AvisoEmergencia oscuro className="mt-6" />
          </div>
          <EjemploVerificacion renipressAl={f?.renipressAl ?? null} sancionesAl={f?.sancionesAl ?? null} />
        </div>
      </section>

      <div className="container-page space-y-20 py-14 sm:space-y-24 sm:py-20">
        {/* ── Lo que no se ve desde la puerta ────────────────────────────────── */}
        <section aria-labelledby="problema-t" className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
          <div className="min-w-0">
            <CabeceraSeccion
              id="problema-t"
              grande
              titulo="Lo que no se ve desde la puerta"
              bajada="Un letrero, una página web o una recomendación no dicen si el lugar está registrado ni qué está autorizado a hacer, ni si quien te atiende tiene la especialidad del procedimiento. Esto es lo que una verificación te deja ver antes de entrar."
            />
          </div>
          <ul className="min-w-0 divide-y divide-line rounded-2xl border border-line bg-paper">
            <Situacion
              Icono={CircleSlash}
              titulo="Un lugar que no figura en el registro, o que figura cerrado"
              texto="Los establecimientos de salud se inscriben en RENIPRESS, el registro de SUSALUD. Si no aparece, o aparece con cierre o baja, pregunta antes de atenderte."
            />
            <Situacion
              Icono={Scissors}
              titulo="Una cirugía donde no hay centro quirúrgico registrado"
              texto="La categoría y los servicios que el establecimiento declaró dicen qué puede hacer. Un consultorio no es una sala de operaciones."
            />
            <Situacion
              Icono={Stethoscope}
              titulo="Un procedimiento fuera de la especialidad"
              texto="Un médico colegiado puede no tener registrada la especialidad del procedimiento que te ofrece. Eso se ve en el Colegio Médico, con su número de colegiatura."
            />
          </ul>
        </section>

        {/* ── Cómo verificar ───────────────────────────────────────────────── */}
        <section aria-labelledby="pasos-t">
          <CabeceraSeccion
            id="pasos-t"
            grande
            titulo="Cómo verificar, en tres pasos"
            bajada="Toma un par de minutos. No reemplaza la consulta: te da mejores preguntas para hacerla."
          />
          <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-8">
            <PasoNumerado n={1} Icono={Building2} titulo="Busca el establecimiento" accion={{ href: "#buscar", etiqueta: "Buscar un establecimiento" }}>
              Por su nombre, su código o su RUC. Mira si figura activo en RENIPRESS, su categoría y los servicios que declaró, como el centro quirúrgico.
            </PasoNumerado>
            <PasoNumerado n={2} Icono={Gavel} titulo="Revisa sanciones y denuncias" accion={{ href: ruta("/sanciones"), etiqueta: "Ver el Registro de Sanciones" }}>
              Las sanciones firmes salen del Registro de Sanciones de SUSALUD; las denuncias, de sus datos abiertos. No son lo mismo y aquí nunca se
              suman.
            </PasoNumerado>
            <PasoNumerado n={3} Icono={Stethoscope} titulo="Verifica al médico en su colegio" accion={{ href: ruta("/medico"), etiqueta: "Verificar a un médico" }}>
              Con su número de colegiatura: si está hábil y su especialidad registrada (RNE) en el Colegio Médico, y su título en SUNEDU. Te llevamos
              paso a paso.
            </PasoNumerado>
          </ol>
        </section>

        {/* ── Qué significa cada dato ─────────────────────────────────────────── */}
        <section aria-labelledby="hechos-t">
          <CabeceraSeccion
            id="hechos-t"
            grande
            titulo="Cuatro clases de hecho que nunca se mezclan"
            bajada="Cada dato lleva su rótulo, siempre el mismo y con su color: una denuncia no se ve como una sanción, ni lo que declaró la clínica como algo que SUSALUD comprobó."
          />
          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-10">
            <ClasesDeHecho />
            <div className="min-w-0 rounded-2xl border border-line bg-paper p-5 sm:p-6">
              <h3 className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
                <BadgeCheck size={18} aria-hidden className="text-granate" /> Y lo que dice cada chequeo de la ficha
              </h3>
              <ul className="mt-4 space-y-3.5">
                {(Object.keys(ESTADOS_CHEQUEO) as EstadoChequeo[]).map((e) => (
                  <li key={e} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3">
                    <span>
                      <InsigniaEstado estado={e} />
                    </span>
                    <span className="text-meta leading-snug text-inkSoft">{SIGNIFICA_ESTADO[e]}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 border-t border-line pt-4 text-meta leading-relaxed text-inkSoft">
                Cuando una fuente no registra algo, lo decimos con su fecha: «no figura en el Registro de Sanciones de SUSALUD revisado el…». Nunca
                «no tiene sanciones».
              </p>
            </div>
          </div>
        </section>

        {/* ── De dónde sale cada dato ─────────────────────────────────────────── */}
        <section aria-labelledby="fuentes-t">
          <CabeceraSeccion
            id="fuentes-t"
            grande
            titulo="De dónde sale cada dato, y a qué fecha"
            bajada="Sólo registros oficiales. Los archivos de SUSALUD se cargan cada semana; el Colegio Médico y SUNEDU se consultan en su propio sitio."
            accion={{ href: ruta("/fuentes"), etiqueta: "Ver el método y cada carga" }}
          />
          <ul className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
            {fuentes.map((x) => (
              <li key={x.nombre} className="grid gap-x-6 gap-y-2 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:items-center">
                <div className="flex min-w-0 gap-3">
                  <span aria-hidden className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
                    <x.Icono size={17} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-cuerpo font-semibold leading-snug text-ink">
                      {x.nombre} <span className="font-normal text-inkSoft">({x.entidad})</span>
                    </h3>
                    <p className="mt-0.5 text-meta leading-snug text-inkSoft">{x.que}</p>
                  </div>
                </div>
                <div className="flex min-w-0 flex-col items-start gap-1.5 pl-12 md:items-end md:pl-0 md:text-right">
                  <InsigniaHecho tipo={x.tipo} />
                  {x.vivo ? (
                    <FuenteFecha nombre={`${x.nombre} (${x.entidad})`} url={x.url}>
                      {x.entidad}, consulta en vivo
                    </FuenteFecha>
                  ) : (
                    <FuenteFecha nombre={x.nombre} url={x.url} al={x.al} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* ── El país, hoy ──────────────────────────────────────────────────── */}
        {r && (
          <section aria-labelledby="pais-t">
            <CabeceraSeccion
              id="pais-t"
              grande
              titulo="El país, según los registros de esta semana"
              bajada="Cifras vivas de RENIPRESS y de SUSALUD. Toca una para ver la lista completa."
            />
            <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Tesela
                Icono={Building2}
                valor={numero(r.activas)}
                etiqueta="establecimientos activos en RENIPRESS"
                detalle={`De ${numero(r.ipress)} registrados: ${numero(r.publicas)} públicos y ${numero(r.privadas)} privados.`}
                pie={<FuenteFecha nombre="RENIPRESS (SUSALUD)" url={URL_RENIPRESS_CONSULTA} al={f?.renipressAl} />}
                href={ruta("/establecimientos")}
              />
              <Tesela
                Icono={Gavel}
                tono="hecho"
                valor={numero(r.sanciones)}
                etiqueta="sanciones firmes en el registro"
                detalle={`${numero(r.sancionesUltimoAnio)} emitidas en los últimos 12 meses.`}
                pie={<FuenteFecha nombre="Registro de Sanciones (SUSALUD)" url={URL_SANCIONES} al={f?.sancionesAl} />}
                href={ruta("/sanciones")}
              />
              <Tesela
                Icono={FileSearch}
                tono="hecho"
                valor={numero(r.conSanciones)}
                etiqueta="establecimientos con al menos una sanción firme"
                detalle="La sanción es de la institución, no de sus médicos."
                pie={<FuenteFecha nombre="Registro de Sanciones (SUSALUD)" url={URL_SANCIONES} al={f?.sancionesAl} />}
                href={`${ruta("/establecimientos")}?sanciones=con&estado=todos`}
              />
              <Tesela
                Icono={MessageSquareWarning}
                tono="denuncia"
                valor={numero(r.denuncias)}
                etiqueta={`denuncias ante SUSALUD en ${r.denunciasAnio ?? "el último año"}`}
                detalle="Pedidos de ciudadanos: no son hechos comprobados ni sanciones."
                pie={<FuenteFecha nombre="Consultas y denuncias (SUSALUD)" url={URL_DATOS_SUSALUD} al={r.denunciasAnio} />}
              />
            </div>

            <div className="mt-10">
              <h3 className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
                <MapPinned size={18} aria-hidden className="text-granate" /> Por departamento
              </h3>
              <p className="mt-1 text-meta text-inkSoft">
                Establecimientos activos y cuántos tienen al menos una sanción firme. Toca un departamento para ver su lista.
              </p>
              <ul className="mt-4 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3" aria-label="Establecimientos por departamento">
                {r.porDepartamento.map((d) => (
                  <li key={d.clave} className="border-b border-line">
                    <Link
                      href={`${ruta("/establecimientos")}?departamento=${encodeURIComponent(d.clave)}`}
                      className="flex min-h-12 items-center justify-between gap-3 py-2 text-dato transition-colors duration-rapido hover:text-granate"
                    >
                      <span className="min-w-0 truncate font-semibold text-ink">{nombreLugar(d.clave)}</span>
                      <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
                        <span className="text-ink">
                          {numero(d.activas)} <span className="text-meta text-inkSoft">activos</span>
                        </span>
                        <span className="inline-flex items-center gap-1 text-meta text-crimsonTexto" title="Establecimientos con al menos una sanción firme">
                          <Gavel size={12} aria-hidden />
                          {numero(d.conSanciones)}
                          <span className="sr-only"> con sanción firme</span>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-3">
                <FuenteFecha nombre="RENIPRESS y Registro de Sanciones (SUSALUD)" url={URL_RENIPRESS_CONSULTA} al={f?.renipressAl} />
              </p>
            </div>
          </section>
        )}

        {/* ── El asistente ──────────────────────────────────────────────────── */}
        <BloqueAsistenteSalud href={ruta("/asistente")} renipressAl={f?.renipressAl ?? null} sancionesAl={f?.sancionesAl ?? null} />

        {/* ── El MCP abierto ────────────────────────────────────────────────── */}
        <BloqueMCPSalud
          bajada="¿Usas Claude, ChatGPT o Cursor? Conéctalos a Gobserva Salud y pregúntales por un establecimiento, sus sanciones firmes o cómo verificar a un médico: responden con los registros de SUSALUD y su fecha."
          pasos={ruta("/mcp")}
        />

        <Faq
          preguntas={[
            {
              p: "¿De dónde salen los datos?",
              r: (
                <>
                  De registros oficiales: RENIPRESS, el Registro de Sanciones y los datos abiertos de SUSALUD (denuncias, recursos y cirugías). La
                  habilitación de un médico la confirma el Colegio Médico del Perú y su título, SUNEDU: te llevamos a sus sitios. Cada dato dice de
                  qué fuente sale y a qué fecha.{" "}
                  <Link href={ruta("/fuentes")} className="font-semibold text-granate underline-offset-2 hover:underline">
                    Ver las fuentes y el método
                  </Link>
                  .
                </>
              ),
            },
            {
              p: "¿Qué es una IPRESS y qué es RENIPRESS?",
              r: "IPRESS quiere decir Institución Prestadora de Servicios de Salud: hospitales, clínicas, centros y puestos de salud, consultorios, laboratorios. RENIPRESS es el registro donde SUSALUD las inscribe, con su estado, su categoría y lo que cada una declaró.",
            },
            {
              p: "¿Qué quiere decir la categoría (I-1, II-1, III-1…)?",
              r: "El nivel de complejidad del establecimiento: el primer nivel (I-1 a I-4) son puestos, consultorios y centros de salud; el segundo (II-1, II-2, II-E), hospitales y clínicas con especialidades; el tercero (III-1, III-2, III-E), hospitales e institutos de alta complejidad. Muchos consultorios y servicios de apoyo no tienen una categoría registrada.",
            },
            {
              p: "Si no figura en el Registro de Sanciones, ¿nunca lo sancionaron?",
              r: "No necesariamente. El registro sólo trae sanciones firmes y SUSALUD puede retirar las que tienen más de un año. Por eso decimos «no figura en el Registro de Sanciones de SUSALUD revisado el…» y no «no tiene sanciones».",
            },
            {
              p: "¿Una denuncia quiere decir que la clínica hizo algo mal?",
              r: "No. Una denuncia es el pedido de un ciudadano ante SUSALUD: no es un hecho comprobado ni una sanción. Mostramos cuántas recibió cada institución por año, siempre aparte de las sanciones.",
            },
            {
              p: "¿La sanción de una clínica es una sanción a sus médicos?",
              r: "No. La sanción es de la institución. De los profesionales sólo mostramos el colegio, el número de colegiatura y la especialidad registrada (RNE) de quien figura como responsable en RENIPRESS, para que lo verifiques en su colegio.",
            },
            {
              p: "¿Por qué no puedo buscar a un médico por su nombre?",
              r: (
                <>
                  Porque no guardamos nombres de personas. La habilitación y la especialidad de un médico las confirma el Colegio Médico del Perú en{" "}
                  <a href={URL_CMP} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline-offset-2 hover:underline">
                    Conoce a tu médico
                  </a>
                  , con su número de colegiatura o sus apellidos. Aquí te llevamos paso a paso.
                </>
              ),
            },
            {
              p: "¿Cada cuánto se actualiza?",
              r: "RENIPRESS, el Registro de Sanciones y los datos abiertos de SUSALUD se cargan cada viernes, con el archivo que SUSALUD publique ese día. El detalle de cada establecimiento (sus servicios y documentos) se vuelve a leer cada 30 días o al abrir su ficha.",
            },
            {
              p: "¿Dónde presento una denuncia?",
              r: (
                <>
                  Ante SUSALUD, en{" "}
                  <a href={URL_DENUNCIA_SUSALUD} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline-offset-2 hover:underline">
                    su página de consultas y denuncias
                  </a>
                  . Un reclamo se presenta primero en el libro de reclamaciones del propio establecimiento. Gobserva Salud no recibe denuncias ni reclamos.
                </>
              ),
            },
            {
              p: "¿Cuánto cuesta? ¿Gobserva es del Estado?",
              r: "Es gratis y no pide cuenta. Gobserva no es una entidad del Estado: ordena datos públicos y enlaza siempre a la fuente oficial.",
            },
          ]}
        />

        {/* ── Cierre ────────────────────────────────────────────────────────── */}
        <section aria-labelledby="cierre-t" className="sobre-oscuro overflow-hidden rounded-3xl border border-paper/10 bg-ink p-6 text-paper sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12">
            <div className="min-w-0">
              <h2 id="cierre-t" className="text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em] sm:text-vitrina">
                Antes de tu próxima cita, búscala aquí.
              </h2>
              <p className="mt-3 flex items-start gap-2 text-dato leading-relaxed text-paper/75">
                <CalendarClock size={16} aria-hidden className="mt-0.5 shrink-0 text-maiz" />
                <span>
                  Registros de SUSALUD al {f?.renipressAl ? <FechaCorta f={f.renipressAl} /> : "último viernes"}.
                </span>
              </p>
            </div>
            <div className="min-w-0">
              <BuscadorSalud accion={ruta("/buscar")} oscuro id="buscar-cierre" />
              <AvisoEmergencia oscuro className="mt-5" />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function FechaCorta({ f }: { f: string }) {
  const [a, m, d] = f.slice(0, 10).split("-").map(Number);
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  return <>{d && m && a ? `${d} de ${meses[m - 1]} de ${a}` : f}</>;
}

function Situacion({ Icono, titulo, texto }: { Icono: LucideIcon; titulo: string; texto: string }) {
  return (
    <li className="flex gap-4 px-5 py-5">
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paperDeep text-ink">
        <Icono size={19} />
      </span>
      <div className="min-w-0">
        <h3 className="font-display text-bloque font-bold leading-snug text-ink">{titulo}</h3>
        <p className="mt-1 text-dato leading-relaxed text-inkSoft">{texto}</p>
      </div>
    </li>
  );
}
