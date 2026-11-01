import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, Briefcase, CalendarClock, Coins, Eye, GraduationCap, Landmark, MapPin, Sparkles, Users } from "lucide-react";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { BarrasEnlace, Buscador, CifraEmpleo, Preguntas } from "@/components/empleo/Piezas";
import { TarjetaPlaza } from "@/components/empleo/TarjetaPlaza";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { NIVEL, NIVELES_ORDEN, entidadNombre, getResumenEmpleo, nombreRegion, qsEmpleo, slugRegion, type ResumenEmpleo, type SenalEmpleo } from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { SENAL_PLAZA } from "@/lib/planilla";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Empleo: todas las plazas CAS del Estado peruano, en un solo lugar" },
  description:
    "Las convocatorias CAS abiertas hoy en todo el Perú: cuánto pagan, qué piden, cuándo cierran y lo que nadie te dice de cada plaza. Gratis, con alertas y para tu asistente de IA.",
  alternates: { canonical: urlCanonica("empleo", "/") },
};

/** Las señales de Vigía que se explican en la portada, en este orden (las que más ayudan a quien postula). */
const SENALES_PORTADA: SenalEmpleo[] = ["pide_experiencia_propia", "ya_hay_locadores", "gestion_saliente"];

const fechaHora = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(`${iso}:00-05:00`);
  return Number.isNaN(d.getTime())
    ? null
    : new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }).format(d);
};

/**
 * La portada de Gobserva Empleo (empleo.gobserva.cloud, 2026-11-01): quien busca trabajo en el Estado llega, busca y ve
 * de un vistazo qué hay hoy. En este orden: el buscador con atajos, las cifras del día, lo que cierra primero y lo mejor
 * pagado, dónde hay plazas y qué estudios piden (con lo que paga cada nivel), lo que nadie te dice (las señales de Vigía),
 * quién convoca, las alertas, el MCP y las preguntas frecuentes. GET /empleo/resumen (5 min en caché).
 */
export default async function InicioEmpleo() {
  const base = baseProducto("empleo");
  const r = await getResumenEmpleo();
  const plazas = (f: Parameters<typeof qsEmpleo>[0]) => `${rutaEn(base, "/plazas")}${qsEmpleo(f)}`;

  return (
    <>
      <Heroe base={base} r={r} plazas={plazas} />
      {!r ? (
        <div className="container-page py-12">
          <p className="rounded-2xl border border-line bg-paper p-6 text-cuerpo text-inkSoft">
            No pudimos leer las plazas ahora. Vuelve a intentarlo en un momento o{" "}
            <Link href={rutaEn(base, "/plazas")} className="font-semibold text-granate underline-offset-2 hover:underline">
              entra a la lista
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="container-page space-y-16 py-12 sm:py-16">
          <section aria-label="Las plazas de hoy en cifras" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CifraEmpleo icono={<Briefcase size={15} aria-hidden />} valor={numero(r.abiertas)} etiqueta="plazas abiertas hoy" contexto={`en ${numero(r.entidades)} entidades del Estado`} tono="acento" />
            <CifraEmpleo icono={<Users size={15} aria-hidden />} valor={numero(r.vacantes)} etiqueta="vacantes" contexto="una plaza puede tener varias" />
            <CifraEmpleo icono={<Coins size={15} aria-hidden />} valor={soles(r.medianaSueldo)} etiqueta="sueldo mediano" contexto="la mitad paga más que esto" />
            <CifraEmpleo icono={<CalendarClock size={15} aria-hidden />} valor={numero(r.cierranSemana)} etiqueta="cierran esta semana" contexto={r.cierran2dias ? `${numero(r.cierran2dias)} en los próximos 2 días` : "ninguna en los próximos 2 días"} tono="urgente" />
          </section>

          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
            <ListaCorta
              titulo="Cierran pronto"
              bajada="Las que vencen primero: si te interesa una, no la dejes para mañana."
              plazas={r.cierranPronto}
              base={base}
              mas={{ href: plazas({ orden: "cierre" }), texto: "Ver todas por fecha de cierre" }}
            />
            <ListaCorta
              titulo="Las mejor pagadas"
              bajada="Lo que más paga hoy, con lo que pide cada una."
              plazas={r.mejorPagadas}
              base={base}
              mas={{ href: plazas({ orden: "sueldo" }), texto: "Ver todas por sueldo" }}
            />
          </div>

          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <section aria-labelledby="regiones-t" className="min-w-0">
              <Titulo id="regiones-t" icono={<MapPin size={20} aria-hidden />} titulo="Dónde hay plazas" bajada="Toca tu región para ver sus plazas. Al lado, el sueldo mediano de cada una." />
              <div className="mt-5 rounded-2xl border border-line bg-paper p-4 sm:p-5">
                <BarrasEnlace
                  etiqueta="Plazas abiertas por región"
                  columnas={2}
                  filas={r.porRegion.map((x) => ({
                    clave: x.clave,
                    nombre: nombreRegion(x.clave),
                    n: x.n,
                    href: plazas({ region: slugRegion(x.clave) }),
                    detalle: x.mediana ? `${numero(x.vacantes ?? 0)} vacantes, mediana ${soles(x.mediana)}` : undefined,
                  }))}
                />
              </div>
            </section>
            <section aria-labelledby="niveles-t" className="min-w-0">
              <Titulo id="niveles-t" icono={<GraduationCap size={20} aria-hidden />} titulo="Qué estudios piden" bajada="El nivel mínimo que acepta cada plaza, y lo que paga en la mediana." />
              <div className="mt-5 rounded-2xl border border-line bg-paper p-4 sm:p-5">
                <BarrasEnlace
                  etiqueta="Plazas abiertas por estudios"
                  filas={NIVELES_ORDEN.flatMap((n) => {
                    const x = r.porNivel.find((y) => y.clave === n);
                    return x ? [{ clave: n, nombre: NIVEL[n].largo, n: x.n, href: plazas({ nivel: n }), detalle: x.mediana ? `Sueldo mediano ${soles(x.mediana)}` : undefined }] : [];
                  })}
                />
              </div>
            </section>
          </div>

          <NadieTeDice r={r} plazas={plazas} />

          <section aria-labelledby="entidades-t">
            <Titulo id="entidades-t" icono={<Landmark size={20} aria-hidden />} titulo="Quién está convocando" bajada="Las entidades con más plazas abiertas hoy." />
            <ol className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {r.entidadesTop.map((e, i) => (
                <li key={`${e.entidad}-${i}`} className="flex min-w-0 flex-col justify-between rounded-2xl border border-line bg-paper p-4">
                  <p className="line-clamp-2 text-dato font-semibold leading-snug text-ink" title={entidadNombre(e.entidad)}>
                    {entidadNombre(e.entidad)}
                  </p>
                  <p className="mt-3 flex items-baseline gap-2">
                    <span className="font-display text-bloque font-bold tabular-nums text-ink">{numero(e.n)}</span>
                    <span className="text-meta text-mute">
                      {e.n === 1 ? "plaza" : "plazas"}, {numero(e.vacantes)} {e.vacantes === 1 ? "vacante" : "vacantes"}
                    </span>
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <Alertas base={base} />

          <BloqueMCP
            id="mcp"
            titulo="Busca trabajo hablando con tu IA"
            bajada="Conecta Claude, ChatGPT o Cursor a Gobserva y pregúntale por plazas en tus palabras: te responde con las convocatorias abiertas de hoy, lo que pagan y el enlace oficial de cada una. Es el estándar MCP (Model Context Protocol): tu asistente consulta los datos en vivo en vez de inventarlos."
            ejemplos={[
              "¿Qué plazas CAS de abogado hay abiertas en Cusco que paguen más de S/ 4,000?",
              "Soy técnica en enfermería con un año de experiencia: ¿a qué puedo postular esta semana en Lima?",
              "¿Cuáles cierran mañana y no piden estudios universitarios?",
              "Compárame lo que pagan las plazas de contador en Arequipa y en Lima.",
            ]}
            herramientas={[
              { nombre: "buscar_plazas_cas", descripcion: "Las plazas abiertas con filtros: puesto, región, sueldo, estudios, experiencia y cierre." },
              { nombre: "ficha_plaza_cas", descripcion: "Una plaza completa: requisitos, sueldo frente a otras entidades, señales y enlace oficial." },
            ]}
          />

          <Preguntas
            items={[
              {
                p: "¿Qué es una plaza CAS?",
                r: "Un puesto en el Estado con Contrato Administrativo de Servicios: sueldo mensual, vacaciones, aguinaldo y seguro. Cada entidad publica sus convocatorias en SERVIR y elige por concurso: evaluación curricular, examen y entrevista.",
              },
              {
                p: "¿Gobserva cobra por postular o elige a alguien?",
                r: "No. Postulas siempre en la web de la entidad o en SERVIR, gratis. Gobserva sólo ordena lo que el Estado publica y te avisa a tiempo. Nadie te puede cobrar por una plaza del Estado.",
              },
              {
                p: "¿De dónde salen las plazas y cada cuánto se actualizan?",
                r: (
                  <>
                    De las ofertas laborales que las entidades publican en SERVIR, que Gobserva lee todos los días.
                    {r.actualizado ? ` La última lectura fue el ${fechaHora(r.actualizado)}.` : ""} Cada plaza enlaza a su publicación oficial: ahí están las bases completas.
                  </>
                ),
              },
              {
                p: "¿Qué significa «Ojo» en una plaza?",
                r: "Es una señal de Vigía, el proyecto cívico de Gobserva: un dato público que conviene saber antes de postular, como que la plaza pide experiencia en la misma entidad o que ya hay personas haciendo ese trabajo por órdenes de servicio. No prueba que la plaza esté arreglada: te ayuda a decidir dónde pones tu esfuerzo.",
              },
              {
                p: "¿Qué hacen con mis datos si me anoto a las alertas?",
                r: "Sólo te escribimos sobre las plazas que pediste. No vendemos ni compartimos tus datos, y puedes pedir que los borremos cuando quieras.",
              },
            ]}
          />
        </div>
      )}
    </>
  );
}

function Titulo({ id, icono, titulo, bajada }: { id: string; icono: React.ReactNode; titulo: string; bajada?: string }) {
  return (
    <div>
      <h2 id={id} className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
        <span className="text-granate">{icono}</span>
        {titulo}
      </h2>
      {bajada && <p className="mt-1.5 max-w-[70ch] text-dato leading-relaxed text-inkSoft">{bajada}</p>}
    </div>
  );
}

/** El héroe: el titular, el buscador y los atajos con cuántas plazas hay en cada uno. */
function Heroe({ base, r, plazas }: { base: string; r: ResumenEmpleo | null; plazas: (f: Parameters<typeof qsEmpleo>[0]) => string }) {
  const atajos = r
    ? [
        { texto: "Hasta 1 año de experiencia", n: r.hasta1Anio, href: plazas({ exp: 1 }) },
        { texto: "Con secundaria completa", n: r.porNivel.find((x) => x.clave === "secundaria")?.n ?? 0, href: plazas({ nivel: "secundaria" }) },
        { texto: "Con estudios técnicos", n: r.porNivel.find((x) => x.clave === "tecnica")?.n ?? 0, href: plazas({ nivel: "tecnica" }) },
        { texto: "Más de S/ 5,000", n: r.mas5000, href: plazas({ sueldo: 5000, orden: "sueldo" }) },
        { texto: "Cierran en 2 días", n: r.cierran2dias, href: plazas({ cierra: "2dias" }) },
        { texto: "En Lima", n: r.porRegion.find((x) => x.clave === "LIMA")?.n ?? 0, href: plazas({ region: "lima" }) },
      ].filter((a) => a.n > 0)
    : [];
  return (
    <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper" aria-labelledby="heroe-t">
      <div aria-hidden className="fondo-puntos-tenue pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-maiz/10 blur-3xl" />
      <div className="container-page relative py-14 sm:py-20">
        {r && (
          <p className="inline-flex items-center gap-2 rounded-full border border-maiz/40 bg-maiz/10 px-3 py-1 text-meta font-semibold text-maiz">
            <span aria-hidden className="relative inline-flex h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-maiz opacity-60 motion-safe:animate-ping" />
              <span className="relative h-2 w-2 rounded-full bg-maiz" />
            </span>
            {numero(r.abiertas)} plazas abiertas hoy en {numero(r.porRegion.length)} regiones
          </p>
        )}
        <h1 id="heroe-t" className="mt-5 max-w-[18ch] text-balance font-display text-portada font-bold leading-[1.05] sm:text-cartel">
          Trabajo en el Estado, sin perderte ninguna plaza.
        </h1>
        <p className="mt-5 max-w-[62ch] text-pretty text-bloque leading-relaxed text-paper/75">
          Todas las convocatorias CAS del Perú en un solo lugar: lo que pagan, lo que piden, cuándo cierran y lo que nadie te
          dice de cada una. Gratis.
        </p>
        <Buscador accion={rutaEn(base, "/plazas")} oscuro className="mt-8 max-w-3xl" />
        {atajos.length > 0 && (
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="Atajos">
            {atajos.map((a) => (
              <li key={a.texto}>
                <Link
                  href={a.href}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full border border-paper/20 bg-paper/5 px-4 text-dato text-paper/90 transition-colors duration-rapido hover:border-maiz/60 hover:bg-paper/10"
                >
                  {a.texto}
                  <span className="rounded-full bg-paper/10 px-2 py-0.5 font-mono text-rotulo tabular-nums text-maiz">{numero(a.n)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Una lista corta de plazas (cierran pronto, mejor pagadas) con su enlace a la lista entera. */
function ListaCorta({ titulo, bajada, plazas, base, mas }: { titulo: string; bajada: string; plazas: ResumenEmpleo["cierranPronto"]; base: string; mas: { href: string; texto: string } }) {
  const id = `lc-${titulo.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="min-w-0">
      <Titulo id={id} icono={titulo.startsWith("Cierran") ? <CalendarClock size={20} aria-hidden /> : <Coins size={20} aria-hidden />} titulo={titulo} bajada={bajada} />
      <div className="mt-5 grid grid-cols-1 gap-3">
        {plazas.map((p) => (
          <TarjetaPlaza key={p.aviso} p={p} base={base} compacta />
        ))}
      </div>
      <Link href={mas.href} className="mt-4 inline-flex min-h-10 items-center text-dato font-semibold text-granate underline-offset-2 hover:underline">
        {mas.texto}
      </Link>
    </section>
  );
}

/** Lo que nadie te dice: las señales de Vigía en las plazas abiertas, explicadas, con cuántas hay y su lista. */
function NadieTeDice({ r, plazas }: { r: ResumenEmpleo; plazas: (f: Parameters<typeof qsEmpleo>[0]) => string }) {
  const n = (t: SenalEmpleo) => r.porSenal.find((s) => s.tipo === t)?.n ?? 0;
  return (
    <section aria-labelledby="nadie-t" className="rounded-3xl border border-amber/30 bg-amber-soft/40 p-6 sm:p-10">
      <div className="max-w-3xl">
        <h2 id="nadie-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
          <Eye size={24} aria-hidden className="text-amberTexto" />
          Lo que nadie te dice
        </h2>
        <p className="mt-2 text-cuerpo leading-relaxed text-inkSoft">
          Gobserva cruza cada plaza con lo que la entidad ya pagaba y con quién gobierna. {numero(r.conSenales)} de las {numero(r.abiertas)} plazas abiertas
          tienen algo que conviene saber antes de postular. No prueba que estén arregladas: te ayuda a decidir dónde pones tu esfuerzo.
        </p>
      </div>
      <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        {SENALES_PORTADA.map((t) => (
          <li key={t} className="flex min-w-0 flex-col rounded-2xl border border-line bg-paper p-5">
            <p className="font-display text-cifra font-bold leading-none tabular-nums text-amberTexto">{numero(n(t))}</p>
            <p className="mt-2 text-cuerpo font-semibold leading-snug text-ink">{SENAL_PLAZA[t].titulo}</p>
            <p className="mt-2 flex-1 text-meta leading-relaxed text-inkSoft">{SENAL_PLAZA[t].explica}</p>
            {n(t) > 0 && (
              <Link href={plazas({ senal: t })} className="mt-4 inline-flex min-h-10 items-center text-dato font-semibold text-granate underline-offset-2 hover:underline">
                Ver esas plazas
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** La invitación a las alertas: lo que llega y cuánto cuesta. */
function Alertas({ base }: { base: string }) {
  return (
    <section aria-labelledby="alertas-t" className="overflow-hidden rounded-3xl border border-granate/30 bg-granate-50">
      <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.3fr_1fr] lg:items-center">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-granate px-3 py-1 text-meta font-semibold text-paper">
            <Sparkles size={14} aria-hidden /> Precio de fundador
          </p>
          <h2 id="alertas-t" className="mt-4 text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">
            Que las plazas te busquen a ti.
          </h2>
          <p className="mt-3 max-w-[56ch] text-cuerpo leading-relaxed text-inkSoft">
            Dinos qué puesto, en qué región y desde cuánto sueldo. Cada mañana te llega por correo o WhatsApp lo nuevo que
            calza contigo, y un recordatorio antes de que cierre.
          </p>
        </div>
        <div className="space-y-3">
          <ul className="space-y-2 text-dato text-ink">
            {["Alertas diarias con tus filtros", "Aviso 2 días antes del cierre", "Tu lista de «¿Cumples?» guardada"].map((x) => (
              <li key={x} className="flex items-center gap-2">
                <BellRing size={16} aria-hidden className="shrink-0 text-granate" />
                {x}
              </li>
            ))}
          </ul>
          <Link href={rutaEn(base, "/planes#unete")} className={claseAccion("primario", "w-full", "md")}>
            Quiero mis alertas por S/ 4.90
          </Link>
          <p className="text-center text-meta text-mute">Los 3 primeros meses; después S/ 9.90. Sin tarjeta para anotarte.</p>
        </div>
      </div>
    </section>
  );
}

