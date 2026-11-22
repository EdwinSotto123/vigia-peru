import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, ArrowRight, ArrowUpRight, Building2, Cable, ClipboardList, Database, EyeOff, FileClock, Fingerprint, Gavel, GraduationCap, History, IdCard, Landmark,
  MessageSquareWarning, Phone, Pill, RefreshCw, RotateCw, Rows3, Scissors, ShieldOff, Stethoscope, TriangleAlert, UserX, ChevronRight, type LucideIcon,
} from "lucide-react";
import { EstadoError } from "@/components/gobserva/ui/Estados";
import { FuenteFecha, InsigniaEstado, InsigniaHecho } from "@/components/salud/comun";
import { ClasesDeHecho } from "@/components/salud/fuentes/ClasesDeHecho";
import { URL_CMP, URL_DENUNCIA_SUSALUD, URL_SUNEDU } from "@/components/salud/fuentes/urls";
import { Faq } from "@/components/licitaciones/Faq";
import { Pestanas } from "@/components/patrones/Pestanas";
import { CabeceraSeccion, Encabezado, Ruta } from "@/components/salud/portada/Piezas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { ESTADOS_CHEQUEO, fechaCorta, getFuentesSalud, numero, type EstadoChequeo, type EstadoFuentes, type FuenteSalud } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Fuentes y método",
  description:
    "De dónde sale cada dato de Gobserva Salud: RENIPRESS, el Registro de Sanciones y los datos abiertos de SUSALUD, con la fecha, las filas y la huella de cada carga, qué clase de hecho aporta cada fuente y lo que no verificamos de forma automática.",
  alternates: { canonical: urlCanonica("salud", "/fuentes") },
};

/** Lo que significa cada estado de un chequeo de la ficha, en una línea (antes en la portada; desde 2026-11-21, aquí). */
const SIGNIFICA_ESTADO: Record<EstadoChequeo, string> = {
  ok: "La fuente oficial lo confirma, a la fecha que se indica.",
  atencion: "Hay algo que conviene preguntar antes de atenderte: no es un veredicto.",
  alerta: "La fuente registra una baja, un cierre o que el establecimiento ya no figura.",
  sin_dato: "La fuente no trae ese dato: no se afirma nada.",
  externo: "Lo confirma otra institución (el Colegio Médico, SUNEDU): te llevamos ahí.",
};

const ICONO: Record<string, LucideIcon> = {
  renipress: Building2,
  sanciones: Gavel,
  denuncias: MessageSquareWarning,
  recursos: Activity,
  cirugias: Scissors,
  cmp: Stethoscope,
  sunedu: GraduationCap,
  precios: Pill,
  alertas: TriangleAlert,
};

/** La fecha de la tabla de cada fuente (lo que hay cargado), cuando no hay una carga registrada con su archivo. */
function fechaTabla(clave: string, e: EstadoFuentes): string | number | null {
  switch (clave) {
    case "renipress":
      return e.renipressAl;
    case "sanciones":
      return e.sancionesAl;
    case "denuncias":
      return e.denunciasAl;
    case "recursos":
      return e.recursosAl ? e.recursosAl.slice(0, 7) : null;
    case "cirugias":
      return e.cirugiasAl ? e.cirugiasAl.slice(0, 7) : null;
    case "precios":
      return e.preciosAl ?? null;
    case "alertas":
      return e.alertasAl ?? null;
    default:
      return null;
  }
}

/** «2026-11-20T09:41» → «20 nov. 2026, 09:41». */
const fechaHora = (t: string | null) => (t ? `${fechaCorta(t)}${t.length > 10 ? `, ${t.slice(11, 16)}` : ""}` : "sin fecha");

/**
 * /fuentes de Gobserva Salud (2026-11-20): el método y la trazabilidad. Cada fuente con qué es, qué clase de hecho aporta,
 * su «ojo», cada cuánto se actualiza, su enlace oficial y su última carga (archivo, fecha, filas y el comienzo de su
 * sha256); la cobertura del detalle por establecimiento; las cuatro clases de hecho; la privacidad; y lo que no se verifica
 * de forma automática y por qué. GET /salud/fuentes.
 */
export default async function Fuentes() {
  const base = baseProducto("salud");
  const d = await getFuentesSalud();
  const ruta = (p: string) => rutaEn(base, p);
  const e = d?.estado;
  const pct = e && e.detalle.total ? Math.round((e.detalle.leidas / e.detalle.total) * 1000) / 10 : 0;

  return (
    <div className="container-page pb-10 pt-5 sm:pb-14 sm:pt-6">
      <Ruta items={[{ etiqueta: "Inicio", href: ruta("/") }, { etiqueta: "Fuentes y método" }]} />
      <Encabezado figura="documento"
        className="mt-2"
        titulo="Fuentes y método"
        bajada="Cada dato de Gobserva Salud sale de un registro oficial, con su fecha. Aquí está cada fuente, qué aporta, qué hay que saber de ella y la última vez que la cargamos."
      />

      {!d || !e ? (
        <div className="mt-8 rounded-2xl border border-line bg-paper">
          <EstadoError
            texto="No pudimos leer el estado de las fuentes ahora. Vuelve a intentarlo en unos segundos."
            acciones={
              <a href={ruta("/fuentes")} className={claseAccion("secundario", "min-h-11")}>
                <RotateCw size={15} aria-hidden /> Volver a intentar
              </a>
            }
          />
        </div>
      ) : (
        // 2026-11-21 («scrolls infinitos»; «secciones que sólo son texto, dales forma»): una pestaña por tema, una a la vez.
        <Pestanas
          className="mt-6"
          etiqueta="Fuentes y método"
          param="ver"
          pestanas={[
            {
              clave: "fuentes",
              etiqueta: "Cada fuente",
              contenido: (
                <div className="space-y-12">
          {/* ── Cada fuente ────────────────────────────────────────────────────── */}
          <section aria-labelledby="cada-t">
            {/* Un h2 del tamaño de una sección (antes, más grande que el título de la página). */}
            <h2 id="cada-t" className="font-display text-seccion font-bold leading-tight text-ink">
              Cada fuente, con su última carga
            </h2>
            <p className="mt-1 text-meta text-inkSoft">Toca una para ver qué cuidar al leerla, cada cuánto se actualiza y sus enlaces.</p>
            <ol className="mt-4 space-y-2">
              {d.fuentes.map((f) => (
                <Fuente key={f.clave} f={f} e={e} />
              ))}
            </ol>
          </section>

          {/* ── Cobertura del detalle ────────────────────────────────────────── */}
          <section aria-labelledby="detalle-t" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-12">
            <div className="min-w-0">
              <CabeceraSeccion
                id="detalle-t"
                titulo="El detalle de cada establecimiento"
                bajada="Los servicios autorizados (UPSS), las especialidades, los documentos declarados y la colegiatura del responsable no vienen en el archivo de RENIPRESS: se leen de la ficha de cada IPRESS, una por una, cada 30 días o al abrir su ficha aquí."
              />
            </div>
            <div className="min-w-0 rounded-2xl border border-line bg-paper p-5 sm:p-6">
              <p className="flex items-baseline justify-between gap-3">
                <span className="text-dato font-semibold text-ink">Detalle leído</span>
                <span className="font-display text-seccion font-bold tabular-nums text-ink">
                  {numero(e.detalle.leidas)} <span className="text-dato font-medium text-inkSoft">de {numero(e.detalle.total)}</span>
                </span>
              </p>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={e.detalle.total}
                aria-valuenow={e.detalle.leidas}
                aria-label="Establecimientos con el detalle leído"
                className="mt-3 h-2.5 overflow-hidden rounded-full bg-paperDeep"
              >
                <div className="h-full rounded-full bg-granate" style={{ width: `${Math.max(pct, 0.6)}%` }} />
              </div>
              <p className="mt-2 text-meta text-inkSoft">
                {pct.toLocaleString("es-PE")} % de los establecimientos registrados. Mientras no se lea el detalle de uno, su ficha dice «sin dato» en lo
                que depende de él, nunca que no lo tiene.
              </p>
              <p className="mt-3 border-t border-line pt-3">
                <FuenteFecha nombre="RENIPRESS, ficha de cada IPRESS (SUSALUD)" url={null}>
                  RENIPRESS, ficha de cada IPRESS (SUSALUD), última lectura el {fechaHora(e.detalle.ultimaLectura)}
                </FuenteFecha>
              </p>
            </div>
          </section>

                </div>
              ),
            },
            { clave: "lectura", etiqueta: "Cómo se lee", contenido: <>
          {/* ── Clases de hecho ─────────────────────────────────────────────────── */}
          <section aria-labelledby="hechos-t">
            <CabeceraSeccion
              id="hechos-t"
              titulo="Cuatro clases de hecho"
              bajada="Cada fuente aporta una sola clase de hecho, con su rótulo. Nunca se suman entre ellas ni se presentan una como otra."
            />
            <ClasesDeHecho conFuente className="mt-6" />
            <div className="mt-8 max-w-3xl rounded-2xl border border-line bg-paper p-5 sm:p-6">
              <h3 className="font-display text-bloque font-bold leading-tight text-ink">Y lo que dice cada chequeo de la ficha</h3>
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
          </section>

            </> },
            { clave: "privacidad", etiqueta: "Privacidad", contenido: <>
          {/* ── Privacidad ──────────────────────────────────────────────────────── */}
          <section aria-labelledby="privacidad-t">
            <CabeceraSeccion id="privacidad-t" titulo="Privacidad" bajada="Verificar a un establecimiento o a un médico no exige exponer a nadie." />
            <ul className="mt-6 grid gap-x-8 gap-y-5 md:grid-cols-2">
              <Punto Icono={UserX} titulo="Sin nombres ni documentos de profesionales">
                Ninguna tabla de Gobserva Salud guarda nombres ni documentos de profesionales, pacientes o denunciantes. El buscador busca establecimientos: algunos consultorios están inscritos en RENIPRESS con el nombre de su titular, y así aparecen.
              </Punto>
              <Punto Icono={IdCard} titulo="Del responsable, sólo lo que sirve para verificarlo">
                De quien figura como responsable de una IPRESS mostramos su colegio, su número de colegiatura y su especialidad registrada (RNE): lo
                que se necesita para confirmarlo en su colegio.
              </Punto>
              <Punto Icono={EyeOff} titulo="Denuncias sin datos de quien denuncia">
                SUSALUD publica las denuncias anonimizadas y por año: mostramos cuántas recibió cada institución, nunca quién las presentó ni de qué
                trataba cada una.
              </Punto>
              <Punto Icono={Phone} titulo="Lo que parece personal, tapado">
                Si un dato de RENIPRESS parece de una persona, como un número de celular, se muestra tapado.
              </Punto>
            </ul>
          </section>

            </> },
            {
              clave: "fuera",
              etiqueta: "Lo que no verificamos",
              contenido: (
                <div className="space-y-12">
          {/* ── Lo que no verificamos automáticamente ───────────────────────────── */}
          <section aria-labelledby="fuera-t">
            <CabeceraSeccion
              id="fuera-t"
              titulo="Lo que no verificamos de forma automática"
              bajada="Estas fuentes existen, pero no se pueden leer de forma automática o no son públicas por establecimiento. Te decimos cómo consultarlas tú."
            />
            <ul className="mt-6 divide-y divide-line rounded-2xl border border-line bg-paper">
              <Fuera Icono={Stethoscope} titulo="La habilitación de un médico (Colegio Médico del Perú)" href={URL_CMP} enlace="Abrir «Conoce a tu médico»">
                Su consulta pide una cuenta y un captcha, y limita las consultas. Si un médico está hábil, su especialidad registrada (RNE) y su
                recertificación las confirma sólo el CMP: te llevamos ahí con su número de colegiatura.
              </Fuera>
              <Fuera Icono={GraduationCap} titulo="El título universitario (SUNEDU)" href={URL_SUNEDU} enlace="Abrir el registro de SUNEDU">
                El Registro Nacional de Grados y Títulos tiene captcha. Ahí se ve el título de médico cirujano y la segunda especialidad.
              </Fuera>
              <Fuera Icono={Landmark} titulo="La licencia municipal de funcionamiento">
                La otorga la municipalidad de cada distrito y no hay un registro nacional abierto. Mostramos si la IPRESS declaró una licencia en
                RENIPRESS; para confirmarla, pídela en el establecimiento o en la municipalidad.
              </Fuera>
              <Fuera Icono={ClipboardList} titulo="Los reclamos">
                Se presentan en el libro de reclamaciones de cada establecimiento, que los resuelve. No hay una fuente pública de reclamos por IPRESS.
              </Fuera>
            </ul>
          </section>

          {/* ── Más ─────────────────────────────────────────────────────────────── */}
          <section aria-labelledby="mas-t" className="grid gap-3 sm:grid-cols-2">
            <h2 id="mas-t" className="sr-only">
              Más sobre los datos
            </h2>
            <Link href={ruta("/cambios")} className="flex min-h-16 items-center gap-3.5 rounded-2xl border border-line bg-paper px-5 py-4 transition-colors duration-rapido hover:border-granate/40">
              <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
                <History size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-dato font-semibold text-ink">Historial de actualizaciones</span>
                <span className="block text-meta text-inkSoft">Altas, bajas y cambios de estado o categoría en RENIPRESS, semana a semana.</span>
              </span>
              <ArrowRight size={16} aria-hidden className="shrink-0 text-mute" />
            </Link>
            <Link href={ruta("/mcp")} className="flex min-h-16 items-center gap-3.5 rounded-2xl border border-line bg-paper px-5 py-4 transition-colors duration-rapido hover:border-granate/40">
              <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
                <Cable size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-dato font-semibold text-ink">Los mismos datos en tu IA</span>
                <span className="block text-meta text-inkSoft">El MCP abierto de Gobserva Salud, con la herramienta fuentes_salud.</span>
              </span>
              <ArrowRight size={16} aria-hidden className="shrink-0 text-mute" />
            </Link>
          </section>
                </div>
              ),
            },
            { clave: "preguntas", etiqueta: "Preguntas frecuentes", contenido: <>
      <section aria-labelledby="preguntas-t">
        <h2 id="preguntas-t" className="font-display text-seccion font-bold leading-tight text-ink">Preguntas frecuentes</h2>
        <div className="mt-4">
            <Faq
              preguntas={[
                {
                  p: "¿De dónde salen los datos?",
                  r: "De registros oficiales: RENIPRESS, el Registro de Sanciones y los datos abiertos de SUSALUD (denuncias, recursos y cirugías). La habilitación de un médico la confirma el Colegio Médico del Perú y su título, SUNEDU: te llevamos a sus sitios. Cada dato dice de qué fuente sale y a qué fecha.",
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
        </div>
      </section>
            </> },
          ]}
        />
      )}
    </div>
  );
}

/** Una fuente: quién, qué clase de hecho, qué trae, el «ojo», cada cuánto, su última carga y sus enlaces. */
/**
 * Una fuente, plegada (2026-11-22, auditoría: «cada fuente mide 1,3 pantallas en el celular; los datos técnicos no los
 * usa la gente»): a la vista su nombre, quién la publica, qué clase de hecho aporta, qué trae y cuándo se cargó; al
 * abrirla, el «Ojo», los enlaces, cada cuánto y, plegados otra vez, los datos técnicos de la carga.
 */
function Fuente({ f, e }: { f: FuenteSalud; e: EstadoFuentes }) {
  const Icono = ICONO[f.clave] ?? Database;
  const carga = e.cargas[f.clave];
  const externa = f.tipo === "verificacion_externa";
  const tabla = fechaTabla(f.clave, e);
  const cuando = externa
    ? "Se consulta en vivo en su sitio"
    : carga
      ? `Última carga: ${fechaHora(carga.cargadoAl)}`
      : tabla == null
        ? "Sin fecha registrada"
        : `Datos al ${typeof tabla === "number" || /^\d{4}$/.test(tabla) ? tabla : fechaCorta(tabla)}`;
  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-paper">
      <details className="group/f">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-4 transition-colors duration-rapido hover:bg-ink/[0.02] sm:px-5 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
            <Icono size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-bloque font-bold leading-snug text-ink">{f.nombre}</span>
            <span className="mt-0.5 block text-meta text-inkSoft">{f.entidad}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <InsigniaHecho tipo={f.tipo} />
              <span className="inline-flex items-center gap-1 text-rotulo text-mute">
                <FileClock size={13} aria-hidden />
                {cuando}
              </span>
            </span>
            <span className="mt-1.5 block text-meta leading-snug text-inkSoft group-open/f:hidden">
              <span className="line-clamp-2">{f.que}</span>
            </span>
          </span>
          <ChevronRight size={18} aria-hidden className="mt-1 shrink-0 text-mute transition-transform duration-rapido group-open/f:rotate-90" />
        </summary>

        <div className="space-y-3 border-t border-line px-4 py-4 sm:px-5">
          <p className="text-dato leading-relaxed text-ink">{f.que}</p>
          <p className="flex items-start gap-2 rounded-xl bg-amber-soft px-3.5 py-2.5 text-meta leading-relaxed text-ink">
            <TriangleAlert size={15} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
            <span>
              <b className="font-semibold">Ojo:</b> {f.ojo}
            </span>
          </p>
          <dl className="grid gap-x-6 gap-y-2.5 text-meta sm:grid-cols-2">
            <Meta Icono={RefreshCw} rotulo="Cada cuánto">
              {f.frecuencia}
            </Meta>
            {externa ? (
              <Meta Icono={ShieldOff} rotulo="Carga">
                No se carga: se consulta en vivo en su sitio.
              </Meta>
            ) : carga ? (
              <Meta Icono={FileClock} rotulo="Última carga">
                {fechaHora(carga.cargadoAl)}
              </Meta>
            ) : (
              <Meta Icono={FileClock} rotulo="Datos cargados">
                {tabla == null ? "Sin fecha registrada" : `Al ${typeof tabla === "number" || /^\d{4}$/.test(tabla) ? tabla : fechaCorta(tabla)}`}
              </Meta>
            )}
          </dl>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
            <a href={f.consulta} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-granate underline-offset-2 hover:underline sm:min-h-0">
              {externa ? "Consultar en su sitio" : "Consulta oficial"} <ArrowUpRight size={13} aria-hidden />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
            {f.url !== f.consulta && (
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-granate underline-offset-2 hover:underline sm:min-h-0">
                Datos abiertos <ArrowUpRight size={13} aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            )}
          </p>
          {/* Lo técnico (filas, huella, archivo), plegado otra vez: sirve a quien quiera reproducir la carga. */}
          {!externa && carga && (
            <details className="group/tec">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-meta font-semibold text-granate sm:min-h-0 [&::-webkit-details-marker]:hidden">
                <ChevronRight size={14} aria-hidden className="transition-transform duration-rapido group-open/tec:rotate-90" />
                Datos técnicos de la carga
              </summary>
              <dl className="mt-2 grid gap-x-6 gap-y-2.5 text-meta sm:grid-cols-2">
                <Meta Icono={Rows3} rotulo="Filas">
                  <span className="tabular-nums">{numero(carga.filas)}</span>
                </Meta>
                {carga.sha256 && (
                  <Meta Icono={Fingerprint} rotulo="Huella (comienzo del sha256)">
                    <span className="break-all font-mono text-rotulo">{carga.sha256}</span>
                  </Meta>
                )}
                <Meta Icono={Database} rotulo="Archivo" className="sm:col-span-2">
                  <span className="break-all font-mono text-rotulo">
                    {carga.url ? (
                      <a href={carga.url} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
                        {(carga.archivo ?? "archivo").replace(/\?.*$/, "")}
                      </a>
                    ) : (
                      (carga.archivo ?? "sin nombre").replace(/\?.*$/, "")
                    )}
                  </span>
                </Meta>
              </dl>
            </details>
          )}
        </div>
      </details>
    </li>
  );
}

/** Un dato de la carga: su ícono y su rótulo arriba, el valor debajo (un par dt/dd de la lista). */
function Meta({ Icono, rotulo, children, className }: { Icono: LucideIcon; rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="flex items-center gap-2 font-semibold text-ink">
        <Icono size={14} aria-hidden className="shrink-0 text-mute" />
        {rotulo}
      </dt>
      <dd className="mt-0.5 pl-[22px] text-inkSoft">{children}</dd>
    </div>
  );
}

function Punto({ Icono, titulo, children }: { Icono: LucideIcon; titulo: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paperDeep text-ink">
        <Icono size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-dato font-semibold leading-snug text-ink">{titulo}</span>
        <span className="mt-1 block text-meta leading-relaxed text-inkSoft">{children}</span>
      </span>
    </li>
  );
}

function Fuera({ Icono, titulo, href, enlace, children }: { Icono: LucideIcon; titulo: string; href?: string; enlace?: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5 px-4 py-4 sm:px-5">
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paperDeep text-ink">
        <Icono size={18} />
      </span>
      <div className="min-w-0">
        <h3 className="text-cuerpo font-semibold leading-snug text-ink">{titulo}</h3>
        <p className="mt-1 max-w-[80ch] text-meta leading-relaxed text-inkSoft">{children}</p>
        {href && enlace && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center gap-1 text-meta font-semibold text-granate underline-offset-2 hover:underline sm:min-h-8">
            {enlace} <ArrowUpRight size={13} aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        )}
      </div>
    </li>
  );
}
