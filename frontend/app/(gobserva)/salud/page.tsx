import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, CalendarClock, LocateFixed, Search } from "lucide-react";
import { FuenteFecha } from "@/components/salud/comun";
import { URL_CMP, URL_DATOS_SUSALUD, URL_DENUNCIA_SUSALUD, URL_RENIPRESS_CONSULTA, URL_SANCIONES, URL_SUNEDU } from "@/components/salud/fuentes/urls";
import { nombreLugar } from "@/components/salud/lista/filtros";
import { BloqueAsistenteSalud } from "@/components/salud/portada/BloqueAsistenteSalud";
import { BuscadorSalud } from "@/components/salud/portada/BuscadorSalud";
import { CienEstablecimientos } from "@/components/salud/pixel/CienEstablecimientos";
import { EscenaPuerta } from "@/components/salud/pixel/EscenaPuerta";
import { FranjaMCP } from "@/components/gobserva/BloqueMCP";
import { Pixel } from "@/components/pixel/Pixel";
import { Puertas } from "@/components/pixel/Puertas";
import type { NombreSprite } from "@/components/pixel/sprites";
import { AvisoEmergencia, CabeceraSeccion } from "@/components/salud/portada/Piezas";
import { Faq } from "@/components/licitaciones/Faq";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { fechaCorta, getResumenSalud, numero } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";
import { NECESIDADES_RAPIDAS } from "@/lib/salud-necesidades";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Salud: verifica tu clínica y a tu médico con fuentes oficiales" },
  description:
    "Antes de atenderte, revisa si el establecimiento está registrado y activo en RENIPRESS, su categoría, sus servicios y si tiene sanciones firmes de SUSALUD, y cómo verificar a tu médico en el Colegio Médico. Cada dato con su fuente y su fecha. Gratis y sin cuenta.",
  alternates: { canonical: urlCanonica("salud", "/") },
};

/** El ícono de píxeles de cada necesidad de la portada (lib/salud-necesidades.ts; components/pixel/sprites.ts). */
const ICONO_NECESIDAD: Record<string, NombreSprite> = {
  emergencia: "iconoEmergencia", dientes: "iconoDientes", parto: "iconoParto", ninos: "iconoNinos", ojos: "iconoOjos", piel: "iconoPiel",
  corazon: "iconoCorazon", huesos: "iconoHuesos", mental: "iconoMental", analisis: "iconoAnalisis", imagenes: "iconoImagenes", operacion: "iconoOperacion",
};

/** «al 20 nov. 2026», «al oct. 2026» o «al 2026», como FuenteFecha. */
function alFecha(al: string | number | null | undefined): string | null {
  if (al == null) return null;
  if (typeof al === "number" || /^\d{4}$/.test(al)) return `al ${al}`;
  return `al ${fechaCorta(al)}`;
}

/**
 * Portada de Gobserva Salud. Rehecha el 2026-11-21 (el usuario: mejorar la UX/UI; la portada medía 10,5 pantallas en
 * la computadora y 18,7 en el celular, con partes de tablero: 25 departamentos, 7 fuentes en tabla, 4 teselas de cifras,
 * las clases de hecho y los estados de la ficha). Ahora es un relato corto para quien va a atenderse:
 * 1. el héroe: la frase, el buscador (el producto) y la escena de la vecina en la puerta de la clínica;
 * 2. «¿Qué necesitas hoy?»: tres puertas con su gente (la clínica, el médico, cerca de mí) y las necesidades directas;
 * 3. lo que no se ve desde la puerta: cuatro preguntas antes de atenderte (antes el problema y los pasos, por separado);
 * 4. de cada 100 establecimientos: la proporción con sanción firme, tres cifras con su fuente y tu departamento;
 * 5. el asistente; 6. de dónde sale cada dato (una lista corta; las clases de hecho y los estados viven en /fuentes)
 * y la franja del MCP abierto; 7. las preguntas; 8. el cierre con el buscador.
 * GET /salud/resumen (10 min en caché); sin él, la portada se arma sin las cifras.
 */
export default async function InicioSalud() {
  const base = baseProducto("salud");
  const r = await getResumenSalud();
  const ruta = (p: string) => rutaEn(base, p);
  const f = r?.fuentes;
  const mes = (x: string | null | undefined) => (x ? x.slice(0, 7) : null);
  const deCada100 = r && r.ipress > 0 ? Math.max(r.conSanciones > 0 ? 1 : 0, Math.round((r.conSanciones / r.ipress) * 100)) : null;

  const fuentes: { nombre: string; entidad: string; url: string; al: string | number | null; vivo?: boolean }[] = [
    { nombre: "RENIPRESS", entidad: "SUSALUD", url: URL_RENIPRESS_CONSULTA, al: f?.renipressAl ?? null },
    { nombre: "Registro de Sanciones", entidad: "SUSALUD", url: URL_SANCIONES, al: f?.sancionesAl ?? null },
    { nombre: "Consultas y denuncias", entidad: "SUSALUD", url: URL_DATOS_SUSALUD, al: f?.denunciasAl ?? null },
    { nombre: "Recursos de salud", entidad: "SUSALUD", url: URL_DATOS_SUSALUD, al: mes(f?.recursosAl) },
    { nombre: "Intervenciones quirúrgicas", entidad: "SUSALUD", url: URL_DATOS_SUSALUD, al: mes(f?.cirugiasAl) },
    { nombre: "Conoce a tu médico", entidad: "Colegio Médico del Perú", url: URL_CMP, al: null, vivo: true },
    { nombre: "Grados y títulos", entidad: "SUNEDU", url: URL_SUNEDU, al: null, vivo: true },
  ];

  return (
    <>
      {/* ── 1. Héroe: la frase, el buscador y la escena ─────────────────────── */}
      <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper" aria-labelledby="heroe-t">
        <div className="container-page relative grid gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-14 lg:py-20">
          <div className="min-w-0">
            <h1 id="heroe-t" className="text-balance font-display text-cifra font-bold leading-[1.06] tracking-[-0.025em] sm:text-portada lg:text-cartel">
              Verifica tu clínica y a tu médico <span className="text-maiz">antes de atenderte.</span>
            </h1>
            <p className="mt-5 max-w-[56ch] text-pretty text-cuerpo leading-relaxed text-paper/75 sm:text-bloque">
              Busca cualquier establecimiento de salud del Perú: si está registrado y activo, qué servicios declaró y si tiene sanciones firmes de
              SUSALUD. Con la fuente oficial y su fecha. Gratis y sin cuenta.
            </p>
            <BuscadorSalud accion={ruta("/buscar")} oscuro className="mt-7" id="buscar" />
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
              <span className="text-meta text-paper/65">Prueba con</span>
              <ul className="flex flex-wrap gap-2" aria-label="Búsquedas de ejemplo">
                {[
                  { t: "Hospital Loayza", q: "hospital loayza" },
                  { t: "Clínicas de Miraflores", q: "clinica miraflores" },
                  { t: "00006207", q: "00006207" },
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
            </div>
            <AvisoEmergencia oscuro className="mt-7 border-t border-paper/10 pt-6" />
          </div>
          <EscenaPuerta renipressAl={f?.renipressAl ?? null} sancionesAl={f?.sancionesAl ?? null} className="lg:mt-6" />
        </div>
      </section>

      <div className="container-page space-y-20 py-14 sm:space-y-28 sm:py-20">
        {/* ── 2. ¿Qué necesitas hoy? ──────────────────────────────────────────── */}
        <section aria-labelledby="necesitas-t">
          <h2 id="necesitas-t" className="text-balance font-display text-titulo font-bold leading-[1.1] tracking-[-0.02em] text-ink sm:text-vitrina">
            ¿Qué necesitas hoy?
          </h2>
          <Puertas
            etiqueta="Lo que puedes hacer en Gobserva Salud"
            className="mt-8"
            puertas={[
              {
                gente: (
                  <>
                    <Pixel nombre="vecina" escala={3} retardo={300} className="px-salta" />
                    <Pixel nombre="clinica" escala={2} retardo={1100} className="max-md:hidden" />
                  </>
                ),
                necesidad: "Me van a atender en una clínica",
                que: "Mira si está registrada y activa, qué servicios declaró, como el centro quirúrgico, y si tiene sanciones firmes.",
                accion: "Verificar la clínica",
                href: ruta("/buscar"),
              },
              {
                gente: (
                  <>
                    <Pixel nombre="doctora" escala={3} retardo={800} className="px-salta" />
                    <Pixel nombre="carnet" escala={3} acento="accion" className="mb-2 max-md:hidden" />
                  </>
                ),
                necesidad: "Quiero saber si mi médico está habilitado",
                que: "Con su número de colegiatura te llevamos, paso a paso, a confirmarlo en el Colegio Médico y su título en SUNEDU.",
                accion: "Verificar al médico",
                href: ruta("/medico"),
              },
              {
                gente: (
                  <>
                    <Pixel nombre="vecinaCamina" escala={3} retardo={1500} className="px-salta" />
                    <Pixel nombre="alfiler" escala={3} acento="accion" className="max-md:hidden" />
                  </>
                ),
                necesidad: "Necesito atenderme cerca de mí",
                que: "Usa tu ubicación y te mostramos los establecimientos cercanos y activos, con lo que declararon atender.",
                accion: "Buscar cerca de mí",
                href: `${ruta("/cerca")}?ubicar=1`,
              },
            ]}
          />
          <div className="mt-8">
            <h3 className="font-display text-bloque font-bold leading-snug text-ink">¿Ya sabes lo que necesitas? Te decimos dónde lo atienden cerca.</h3>
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Lo que necesitas">
              {NECESIDADES_RAPIDAS.map((n) => {
                const icono = ICONO_NECESIDAD[n.clave];
                return (
                  <li key={n.clave}>
                    <Link
                      href={`${ruta("/cerca")}?ubicar=1&necesidad=${n.clave}`}
                      prefetch={false}
                      className="group inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-paper py-1.5 pl-2.5 pr-4 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/50 hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                    >
                      {icono && <Pixel nombre={icono} escala={2} acento="accion" animado={false} className="px-salta" />}
                      {n.etiqueta}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 flex items-start gap-1.5 text-meta leading-relaxed text-inkSoft">
              <LocateFixed size={14} aria-hidden className="mt-0.5 shrink-0 text-mute" />
              <span>Tu ubicación no se guarda. En una emergencia no busques: llama al 106.</span>
            </p>
          </div>
        </section>

        {/* ── 3. Lo que no se ve desde la puerta ──────────────────────────────── */}
        <section aria-labelledby="puerta-t">
          <CabeceraSeccion
            id="puerta-t"
            grande
            titulo="Lo que no se ve desde la puerta"
            bajada="Un letrero, una página web o una recomendación no te dicen esto. Una verificación sí, y en un par de minutos: no reemplaza la consulta, te da mejores preguntas para hacerla."
          />
          <ul className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-2">
            <Pregunta sprite="clinica" titulo="¿Está registrado y activo?">
              Todo establecimiento de salud se inscribe en RENIPRESS, el registro de SUSALUD. Si no figura, o figura con cierre o baja, pregunta antes
              de entrar.
            </Pregunta>
            <Pregunta sprite="iconoOperacion" titulo="¿Puede hacer lo que te ofrece?">
              Su categoría y los servicios que declaró dicen qué puede hacer. Un consultorio no es una sala de operaciones: si te ofrecen operarte,
              mira si declaró un centro quirúrgico.
            </Pregunta>
            <Pregunta sprite="documento" titulo="¿Tiene sanciones firmes?" accion={{ href: ruta("/sanciones"), etiqueta: "Ver el Registro de Sanciones" }}>
              Salen del Registro de Sanciones de SUSALUD. Las denuncias son otra cosa, pedidos de ciudadanos y no hechos comprobados: aquí nunca se
              suman.
            </Pregunta>
            <Pregunta sprite="carnet" titulo="¿Quién te atiende tiene esa especialidad?" accion={{ href: ruta("/medico"), etiqueta: "Verificar a un médico" }}>
              Un médico colegiado puede no tener registrada la especialidad del procedimiento que te ofrece. Con su número de colegiatura, el Colegio
              Médico lo confirma.
            </Pregunta>
          </ul>
        </section>

        {/* ── 4. De cada 100 establecimientos ─────────────────────────────────── */}
        {r && deCada100 != null && (
          <section aria-labelledby="pais-t" className="grid gap-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start lg:gap-16">
            <CienEstablecimientos marcadas={Math.max(r.conSanciones > 0 ? 1 : 0, (r.conSanciones / r.ipress) * 100)} className="h-auto w-36 sm:w-[11.5rem]" />
            <div className="min-w-0">
              <h2 id="pais-t" className="max-w-[24ch] text-balance font-display text-titulo font-bold leading-[1.1] tracking-[-0.02em] text-ink sm:text-vitrina">
                De cada 100 establecimientos, {deCada100} {deCada100 === 1 ? "tiene" : "tienen"} una sanción firme
              </h2>
              <p className="mt-3 max-w-[62ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">
                Al menos una, en el Registro de Sanciones de SUSALUD. Los demás no figuran en él. La sanción es de la institución, no de sus médicos.
              </p>
              <dl className="mt-7 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
                <Cifra
                  valor={numero(r.activas)}
                  etiqueta="establecimientos activos"
                  detalle={`De ${numero(r.ipress)} registrados en RENIPRESS.`}
                  href={ruta("/establecimientos")}
                  pie={<FuenteFecha nombre="RENIPRESS (SUSALUD)" url={URL_RENIPRESS_CONSULTA} al={f?.renipressAl} />}
                />
                <Cifra
                  valor={numero(r.sanciones)}
                  etiqueta="sanciones firmes"
                  detalle={`${numero(r.sancionesUltimoAnio)} en los últimos 12 meses.`}
                  href={ruta("/sanciones")}
                  pie={<FuenteFecha nombre="Registro de Sanciones (SUSALUD)" url={URL_SANCIONES} al={f?.sancionesAl} />}
                />
                <Cifra
                  valor={numero(r.denuncias)}
                  etiqueta={`denuncias en ${r.denunciasAnio ?? "el último año"}`}
                  detalle="Pedidos de ciudadanos: no son sanciones."
                  pie={<FuenteFecha nombre="Consultas y denuncias (SUSALUD)" url={URL_DATOS_SUSALUD} al={r.denunciasAnio} />}
                />
              </dl>
              {r.porDepartamento.length > 0 && (
                <form method="get" action={ruta("/establecimientos")} className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="min-w-0 flex-1 sm:max-w-sm">
                    <span className="block text-dato font-semibold text-ink">¿Y en tu departamento?</span>
                    <select
                      name="departamento"
                      defaultValue=""
                      required
                      className="mt-2 h-12 w-full rounded-2xl border border-line bg-caja px-4 text-destacado text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30"
                    >
                      <option value="" disabled>
                        Elige tu departamento
                      </option>
                      {[...r.porDepartamento]
                        .sort((a, b) => nombreLugar(a.clave).localeCompare(nombreLugar(b.clave), "es"))
                        .map((d) => (
                          <option key={d.clave} value={d.clave}>
                            {nombreLugar(d.clave)}: {numero(d.activas)} activos, {numero(d.conSanciones)} con sanción firme
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-granate px-6 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2"
                  >
                    Ver su lista
                  </button>
                </form>
              )}
            </div>
          </section>
        )}

        {/* ── 5. El asistente ─────────────────────────────────────────────────── */}
        <BloqueAsistenteSalud href={ruta("/asistente")} renipressAl={f?.renipressAl ?? null} sancionesAl={f?.sancionesAl ?? null} />

        {/* ── 6. De dónde sale cada dato, y el MCP abierto ───────────────────── */}
        <section aria-labelledby="fuentes-t" className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div className="min-w-0">
            <CabeceraSeccion
              id="fuentes-t"
              grande
              titulo="Sólo registros oficiales, con su fecha"
              bajada="Cada dato dice de qué fuente sale y a qué fecha. Una denuncia nunca se muestra como una sanción, ni lo que declaró la clínica como algo que SUSALUD comprobó. Y cuando una fuente no registra algo, lo decimos con su fecha: nunca «no tiene sanciones»."
            />
            <Link
              href={ruta("/fuentes")}
              className="mt-4 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline"
            >
              Ver el método y cada carga
            </Link>
          </div>
          <ul className="min-w-0 divide-y divide-line self-start border-y border-line" aria-label="Las fuentes de Gobserva Salud">
            {fuentes.map((x) => (
              <li key={x.nombre} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-3.5">
                <span className="min-w-0 text-dato">
                  <a
                    href={x.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-ink underline decoration-line underline-offset-4 transition-colors duration-rapido hover:decoration-ink"
                  >
                    {x.nombre}
                    <ArrowUpRight size={13} aria-hidden className="ml-0.5 inline align-baseline" />
                    <span className="sr-only"> (fuente oficial, se abre en otra pestaña)</span>
                  </a>{" "}
                  <span className="text-inkSoft">{x.entidad}</span>
                </span>
                <span className="text-meta tabular-nums text-inkSoft">{x.vivo ? "se consulta en su sitio" : alFecha(x.al) ?? "sin fecha de carga"}</span>
              </li>
            ))}
          </ul>
        </section>

        <FranjaMCP
          que="establecimientos"
          href={ruta("/mcp")}
          bajada="Conecta tu IA a Gobserva Salud y pregúntale por un establecimiento, sus sanciones firmes o cómo verificar a un médico: responde con los registros de SUSALUD y su fecha. Gratis y sin cuenta."
        />

        {/* ── 7. Preguntas ────────────────────────────────────────────────────── */}
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

        {/* ── 8. Cierre ───────────────────────────────────────────────────────── */}
        <section aria-labelledby="cierre-t" className="sobre-oscuro overflow-hidden rounded-3xl border border-paper/10 bg-ink p-6 text-paper sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12">
            <div className="min-w-0">
              <h2 id="cierre-t" className="text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em] sm:text-vitrina">
                Antes de tu próxima cita, búscala aquí.
              </h2>
              <p className="mt-3 flex items-start gap-2 text-dato leading-relaxed text-paper/75">
                <CalendarClock size={16} aria-hidden className="mt-0.5 shrink-0 text-maiz" />
                <span>Registros de SUSALUD al {f?.renipressAl ? <FechaCorta f={f.renipressAl} /> : "último viernes"}.</span>
              </p>
            </div>
            <div className="min-w-0">
              <div aria-hidden className="mb-5 flex items-end gap-3">
                <Pixel nombre="vecina" escala={4} retardo={1600} />
                <Pixel nombre="doctora" escala={4} retardo={300} />
              </div>
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

/** El tamaño de cada viñeta en su cuadro de 56 px. */
const ESCALA_PREGUNTA: Partial<Record<NombreSprite, number>> = { clinica: 1.4, iconoOperacion: 3.25, carnet: 2.75, documento: 3 };

/** Una de las preguntas antes de atenderte: la viñeta de píxeles en su cuadro, la pregunta, la respuesta y, si hay, adónde ir. */
function Pregunta({ sprite, titulo, children, accion }: { sprite: NombreSprite; titulo: string; children: ReactNode; accion?: { href: string; etiqueta: string } }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-paperDeep">
        <Pixel nombre={sprite} escala={ESCALA_PREGUNTA[sprite] ?? 2} acento="accion" animado={false} />
      </span>
      <div className="min-w-0">
        <h3 className="text-balance font-display text-bloque font-bold leading-snug text-ink sm:text-seccion">{titulo}</h3>
        <p className="mt-1.5 max-w-[54ch] text-pretty text-dato leading-relaxed text-inkSoft">{children}</p>
        {accion && (
          <Link href={accion.href} className="mt-1 inline-flex min-h-11 items-center text-dato font-semibold text-granate underline-offset-4 hover:underline">
            {accion.etiqueta}
          </Link>
        )}
      </div>
    </li>
  );
}

/** Una cifra del país con lo que es, un detalle y su fuente; con `href`, la cifra lleva a su lista. */
function Cifra({ valor, etiqueta, detalle, pie, href }: { valor: string; etiqueta: string; detalle: string; pie: ReactNode; href?: string }) {
  return (
    <div className="flex min-w-0 flex-col bg-paper p-4 sm:p-5">
      <dt className="order-2 mt-1 text-dato font-semibold leading-snug text-ink">
        {href ? (
          <Link href={href} className="underline decoration-line underline-offset-4 hover:decoration-ink">
            {etiqueta}
          </Link>
        ) : (
          etiqueta
        )}
      </dt>
      <dd className="order-1 font-display text-cifra font-bold leading-none tabular-nums text-ink">{valor}</dd>
      <dd className="order-3 mt-0.5 text-meta leading-snug text-inkSoft">{detalle}</dd>
      <dd className="order-4 mt-auto pt-3">{pie}</dd>
    </div>
  );
}
