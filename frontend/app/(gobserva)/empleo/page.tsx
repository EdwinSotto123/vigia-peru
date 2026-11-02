import type { Metadata } from "next";
import Link from "next/link";
import { Bookmark, Briefcase, CalendarClock, Clock, Coins, Eye, FileSpreadsheet, GraduationCap, Landmark, MapPin, Sparkles, Timer, Users } from "lucide-react";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { BarrasEnlace, Buscador, CLASE_VER_TODAS, CifraEmpleo, Preguntas } from "@/components/empleo/Piezas";
import { TarjetaPlaza } from "@/components/empleo/TarjetaPlaza";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import {
  NIVEL, NIVELES_ORDEN, canalAlertas, entidadNombre, getResumenEmpleo, nombreRegion, plazasHasta, qsEmpleo, slugRegion, type ResumenEmpleo, type SenalEmpleo,
} from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { planesServidor, precioDe, type PlanesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";
import { SENAL_PLAZA } from "@/lib/planilla";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Empleo: todas las plazas CAS del Estado peruano, en un solo lugar" },
  description:
    "Las convocatorias CAS abiertas hoy en todo el Perú: cuánto pagan, qué piden, cuándo cierran y lo que nadie te dice de cada plaza. Gratis, con alertas y para tu asistente de IA.",
  alternates: { canonical: urlCanonica("empleo", "/") },
};

/** Las señales de Vigía que se explican en la portada, en este orden (las que más ayudan a quien postula). */
const SENALES_PORTADA: SenalEmpleo[] = ["pide_experiencia_propia", "ya_hay_locadores", "gestion_saliente"];

/** En el celular, cada muestra («Cierran pronto», «Las mejor pagadas») enseña 4 plazas; el botón de abajo dice cuántas hay. */
const MUESTRA_CELULAR = 4;

const fechaHora = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(`${iso}:00-05:00`);
  return Number.isNaN(d.getTime())
    ? null
    : new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }).format(d);
};

type ArmaUrl = (f: Parameters<typeof qsEmpleo>[0]) => string;

/**
 * La portada de Gobserva Empleo (empleo.gobserva.cloud), en modo «persuadir»: quien busca trabajo en el Estado llega,
 * busca y ve de un vistazo qué hay hoy. En este orden: el titular, el buscador con lo que hay hoy (y cuándo se leyó) y
 * los atajos con cuántas plazas tiene cada uno; las cifras del día; lo que cierra primero y lo mejor pagado (con el botón
 * a la lista entera y cuántas son); dónde hay plazas y qué estudios piden; lo que nadie te dice (las señales de Vigía);
 * quién convoca (cada entidad abre sus plazas); las alertas; el MCP y las preguntas. GET /empleo/resumen (5 min en caché).
 */
export default async function InicioEmpleo() {
  const base = baseProducto("empleo");
  const [r, cat] = await Promise.all([getResumenEmpleo(), planesServidor("empleo")]);
  const plazas: ArmaUrl = (f) => `${rutaEn(base, "/plazas")}${qsEmpleo(f)}`;

  return (
    <>
      <Heroe base={base} r={r} plazas={plazas} />
      {!r ? (
        <div className="container-page py-12">
          <div role="alert" className="rounded-2xl border border-line bg-paper p-6">
            <p className="font-display text-bloque font-bold text-ink">No pudimos leer las plazas ahora</p>
            <p className="mt-1 text-dato text-inkSoft">Vuelve a intentarlo en un momento. Mientras tanto, la lista completa sigue abierta.</p>
            <Link href={rutaEn(base, "/plazas")} className={claseAccion("primario", "mt-4 min-h-11")}>
              Ver las plazas abiertas
            </Link>
          </div>
        </div>
      ) : (
        <div className="container-page space-y-16 py-12 sm:py-16">
          <section aria-label="Las plazas de hoy en cifras" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CifraEmpleo icono={<Briefcase size={15} aria-hidden />} valor={numero(r.abiertas)} etiqueta="plazas abiertas hoy" contexto={`en ${numero(r.entidades)} entidades del Estado`} tono="acento" />
            <CifraEmpleo icono={<Users size={15} aria-hidden />} valor={numero(r.vacantes)} etiqueta="vacantes" contexto="una plaza puede tener varias" />
            <CifraEmpleo icono={<Coins size={15} aria-hidden />} valor={soles(r.medianaSueldo)} etiqueta="sueldo mediano" contexto="la mitad paga más que esto" />
            <CifraEmpleo
              icono={<CalendarClock size={15} aria-hidden />}
              valor={numero(r.cierranSemana)}
              etiqueta="cierran esta semana"
              contexto={r.cierran2dias ? `${numero(r.cierran2dias)} en los próximos 2 días` : "ninguna en los próximos 2 días"}
              tono="urgente"
            />
          </section>

          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-10">
            <ListaCorta
              id="cierran-t"
              icono={<CalendarClock size={20} aria-hidden />}
              titulo="Cierran pronto"
              bajada="Las que vencen primero: si te interesa una, no la dejes para mañana."
              muestra={r.cierranPronto}
              base={base}
              mas={
                r.cierranSemana > 0
                  ? { href: plazas({ cierra: "semana" }), texto: `Ver las ${numero(r.cierranSemana)} que cierran esta semana` }
                  : { href: plazas({ orden: "cierre" }), texto: "Ver todas por fecha de cierre" }
              }
            />
            <ListaCorta
              id="pagadas-t"
              icono={<Coins size={20} aria-hidden />}
              titulo="Las mejor pagadas"
              bajada="Lo que más paga hoy, con lo que pide cada una."
              muestra={r.mejorPagadas}
              base={base}
              mas={
                r.mas5000 > 0
                  ? { href: plazas({ sueldo: 5000, orden: "sueldo" }), texto: `Ver las ${numero(r.mas5000)} que pagan desde ${soles(5000)}` }
                  : { href: plazas({ orden: "sueldo" }), texto: "Ver todas por sueldo" }
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-10">
            <section aria-labelledby="regiones-t" className="min-w-0">
              <Titulo id="regiones-t" icono={<MapPin size={20} aria-hidden />} titulo="Dónde hay plazas" bajada="Toca tu región para ver sus plazas; debajo de cada una, su sueldo mediano." />
              <div className="mt-5 rounded-2xl border border-line bg-paper p-4 sm:p-5">
                <BarrasEnlace
                  etiqueta="Plazas abiertas por región"
                  columnas={2}
                  columnasCelular={2}
                  filas={r.porRegion.map((x) => ({
                    clave: x.clave,
                    nombre: nombreRegion(x.clave),
                    n: x.n,
                    href: plazas({ region: slugRegion(x.clave) }),
                    detalle: x.mediana ? `Mediana ${soles(x.mediana)}` : undefined,
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
            <Titulo id="entidades-t" icono={<Landmark size={20} aria-hidden />} titulo="Quién está convocando" bajada="Las entidades con más plazas abiertas hoy. Toca una para ver las suyas." />
            <div className="mt-5 rounded-2xl border border-line bg-paper p-4 sm:p-5">
              <BarrasEnlace
                etiqueta="Entidades con más plazas abiertas"
                columnas={2}
                filas={r.entidadesTop.map((e, i) => ({
                  clave: `${e.entidad}-${i}`,
                  nombre: entidadNombre(e.entidad),
                  n: e.n,
                  // Por su RUC, la cifra exacta (el nombre como texto también traía plazas de otras entidades).
                  href: e.ruc ? plazas({ entidad: e.ruc }) : plazas({ q: entidadNombre(e.entidad).slice(0, 80) }),
                  detalle: `${numero(e.vacantes)} ${e.vacantes === 1 ? "vacante" : "vacantes"}`,
                }))}
              />
            </div>
          </section>

          <Alertas base={base} cat={cat} />

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
                p: "¿Cómo postulo a una plaza?",
                r: "Abre la plaza, revisa si cumples los requisitos y toca «Postular en la entidad»: te lleva a la web de la entidad, donde están las bases, el cronograma y cómo se presenta la postulación. También puedes buscarla en SERVIR con su número de aviso, que está en cada ficha.",
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
                p: "¿Qué significa «Lo que nadie te dice» en una plaza?",
                r: "Son las señales de Vigía, el proyecto cívico de Gobserva: un dato público que conviene saber antes de postular, como que la plaza pide experiencia en la misma entidad o que ya hay personas haciendo ese trabajo por órdenes de servicio. No prueba que la plaza esté arreglada: te ayuda a decidir dónde pones tu esfuerzo.",
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
        <span className="shrink-0 text-granate">{icono}</span>
        {titulo}
      </h2>
      {bajada && <p className="mt-1.5 max-w-[70ch] text-dato leading-relaxed text-inkSoft">{bajada}</p>}
    </div>
  );
}

/**
 * El héroe: el titular, lo que hay hoy (cuántas plazas abiertas y cuándo se leyó SERVIR, como dato y no como etiqueta
 * encima del título), el buscador y los atajos con cuántas plazas hay en cada uno: en el celular, de a dos por fila (en
 * píldoras sueltas ocupaban una fila cada una).
 */
function Heroe({ base, r, plazas }: { base: string; r: ResumenEmpleo | null; plazas: ArmaUrl }) {
  const atajos = r
    ? [
        { texto: "Hasta 1 año de experiencia", n: r.hasta1Anio, href: plazas({ exp: 1 }) },
        // Lo que puede postular quien tiene esos estudios: su nivel y los de abajo (un técnico también a las de secundaria).
        { texto: "Con secundaria completa", n: plazasHasta(r.porNivel, "secundaria"), href: plazas({ tengo: "secundaria" }) },
        { texto: "Con estudios técnicos", n: plazasHasta(r.porNivel, "tecnica"), href: plazas({ tengo: "tecnica" }) },
        { texto: `Desde ${soles(5000)}`, n: r.mas5000, href: plazas({ sueldo: 5000, orden: "sueldo" }) },
        { texto: "Cierran en 2 días", n: r.cierran2dias, href: plazas({ cierra: "2dias" }) },
        { texto: "En Lima", n: r.porRegion.find((x) => x.clave === "LIMA")?.n ?? 0, href: plazas({ region: "lima" }) },
      ].filter((a) => a.n > 0)
    : [];
  const leido = r ? fechaHora(r.actualizado) : null;
  return (
    <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper" aria-labelledby="heroe-t">
      <div aria-hidden className="fondo-puntos-tenue pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-maiz/10 blur-3xl" />
      <div className="container-page relative py-12 sm:py-20">
        <h1 id="heroe-t" className="max-w-[18ch] text-balance font-display text-portada font-bold leading-[1.05] sm:text-cartel">
          Trabajo en el Estado, sin perderte ninguna plaza.
        </h1>
        <p className="mt-5 max-w-[62ch] text-pretty text-cuerpo leading-relaxed text-paper/80 sm:text-bloque">
          Todas las convocatorias CAS del Perú en un solo lugar: lo que pagan, lo que piden, cuándo cierran y lo que nadie te dice de cada una. Gratis.
        </p>
        {r && (
          <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-meta text-paper/75" aria-label="Lo que hay hoy">
            <li className="inline-flex items-center gap-2">
              <span aria-hidden className="relative inline-flex h-2 w-2 shrink-0">
                <span className="absolute inset-0 rounded-full bg-maiz opacity-60 motion-safe:animate-ping" />
                <span className="relative h-2 w-2 rounded-full bg-maiz" />
              </span>
              <span>
                <b className="font-semibold tabular-nums text-maiz">{numero(r.abiertas)}</b> plazas abiertas hoy en {numero(r.porRegion.length)} regiones
              </span>
            </li>
            {leido && (
              <li className="inline-flex items-center gap-1.5">
                <Clock size={13} aria-hidden className="shrink-0" />
                Leídas de SERVIR el {leido}
              </li>
            )}
          </ul>
        )}
        <Buscador accion={rutaEn(base, "/plazas")} oscuro className="mt-6 max-w-3xl" />
        {atajos.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-2 max-sm:[&>li:last-child:nth-child(odd)]:col-span-2 sm:flex sm:flex-wrap" aria-label="Atajos">
            {atajos.map((a) => (
              <li key={a.texto} className="min-w-0">
                <Link
                  href={a.href}
                  className="flex h-full min-h-12 items-center justify-between gap-2 rounded-2xl border border-paper/20 bg-paper/5 px-3 py-2 text-dato leading-snug text-paper/90 transition-colors duration-rapido hover:border-maiz/60 hover:bg-paper/10 sm:min-h-11 sm:rounded-full sm:px-4 sm:py-0"
                >
                  <span className="min-w-0">{a.texto}</span>
                  <span className="shrink-0 rounded-full bg-paper/10 px-2 py-0.5 font-mono text-rotulo tabular-nums text-maiz">{numero(a.n)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * Una muestra de plazas (cierran pronto, mejor pagadas) con su botón a la lista entera, que dice cuántas son. En el
 * celular enseña las primeras cuatro (el botón lleva a todas).
 */
function ListaCorta({
  id,
  icono,
  titulo,
  bajada,
  muestra,
  base,
  mas,
}: {
  id: string;
  icono: React.ReactNode;
  titulo: string;
  bajada: string;
  muestra: ResumenEmpleo["cierranPronto"];
  base: string;
  mas: { href: string; texto: string };
}) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <Titulo id={id} icono={icono} titulo={titulo} bajada={bajada} />
      <ul className="mt-5 grid grid-cols-1 gap-3">
        {muestra.map((p, i) => (
          <li key={p.aviso} className={cn("min-w-0", i >= MUESTRA_CELULAR && "max-sm:hidden")}>
            <TarjetaPlaza p={p} base={base} compacta />
          </li>
        ))}
      </ul>
      <Link href={mas.href} className={cn(CLASE_VER_TODAS, "mt-4")}>
        {mas.texto}
      </Link>
    </section>
  );
}

/** Lo que nadie te dice: las señales de Vigía en las plazas abiertas, explicadas, con cuántas hay y su lista. */
function NadieTeDice({ r, plazas }: { r: ResumenEmpleo; plazas: ArmaUrl }) {
  const n = (t: SenalEmpleo) => r.porSenal.find((s) => s.tipo === t)?.n ?? 0;
  return (
    <section aria-labelledby="nadie-t" className="rounded-3xl border border-amber/30 bg-amber-soft/40 p-5 sm:p-10">
      <div className="max-w-3xl">
        <h2 id="nadie-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
          <Eye size={24} aria-hidden className="shrink-0 text-amberTexto" />
          Lo que nadie te dice
        </h2>
        <p className="mt-2 text-cuerpo leading-relaxed text-inkSoft">
          Gobserva cruza cada plaza con lo que la entidad ya pagaba y con quién gobierna: <b className="font-semibold text-ink">{numero(r.conSenales)}</b> de las{" "}
          {numero(r.abiertas)} plazas abiertas tienen algo que conviene saber antes de postular. No prueba que estén arregladas: te ayuda a decidir dónde pones tu
          esfuerzo.
        </p>
      </div>
      <ul className="mt-6 grid grid-cols-1 gap-3 sm:mt-8 md:grid-cols-3 md:gap-4">
        {SENALES_PORTADA.map((t) => (
          <li key={t} className="flex min-w-0 flex-col rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <p className="flex items-baseline gap-2">
              <span className="font-display text-cifra font-bold leading-none tabular-nums text-amberTexto">{numero(n(t))}</span>
              <span className="text-meta text-mute">{n(t) === 1 ? "plaza" : "plazas"}</span>
            </p>
            <p className="mt-2 text-cuerpo font-semibold leading-snug text-ink">{SENAL_PLAZA[t].titulo}</p>
            <p className="mt-2 flex-1 text-meta leading-relaxed text-inkSoft">{SENAL_PLAZA[t].explica}</p>
            {n(t) > 0 && (
              <Link href={plazas({ senal: t })} className="mt-3 inline-flex min-h-11 items-center text-dato font-semibold text-granate underline-offset-4 hover:underline">
                {n(t) === 1 ? "Ver esa plaza" : `Ver las ${numero(n(t))} plazas`}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * La invitación a las alertas: lo que llega (con un ícono por cosa) y por dónde llega hoy (sin prometer el correo mientras
 * no sale), cuánto cuesta (el catálogo de la API, con el precio de fundador junto al precio y no como etiqueta encima del
 * título) y el camino gratis.
 */
function Alertas({ base, cat }: { base: string; cat: PlanesServidor }) {
  const plan = cat.planes.find((p) => p.id === "alertas");
  const precio = plan ? precioDe(plan) : null;
  const canal = canalAlertas(cat.correoActivo);
  const gratis = cat.gratis.alertas === 1 ? "1 alerta" : `${numero(cat.gratis.alertas)} alertas`;
  const incluye = [
    { Icono: CalendarClock, t: "Lo nuevo cada mañana, con tus filtros" },
    { Icono: Timer, t: "Aviso 2 días antes de que cierre una plaza guardada" },
    { Icono: Bookmark, t: "Tus plazas guardadas y tus postulaciones al día" },
    { Icono: FileSpreadsheet, t: "Tus búsquedas en Excel" },
  ];
  return (
    <section aria-labelledby="alertas-t" className="overflow-hidden rounded-3xl border border-granate/30 bg-granate-50">
      <div className="grid gap-8 p-5 sm:p-10 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:gap-12">
        <div className="min-w-0">
          <h2 id="alertas-t" className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">
            Que las plazas te busquen a ti.
          </h2>
          <p className="mt-3 max-w-[56ch] text-cuerpo leading-relaxed text-inkSoft">
            Guarda tu búsqueda (qué puesto, en qué región, desde cuánto sueldo) y te avisamos {canal} de lo nuevo que calza contigo. Gratis una vez por semana;
            cada mañana con Alertas.
          </p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {incluye.map(({ Icono, t }) => (
              <li key={t} className="flex items-start gap-2.5 text-dato leading-snug text-ink">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper text-granate">
                  <Icono size={16} aria-hidden />
                </span>
                <span className="min-w-0 pt-1.5">{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 space-y-3">
          {precio && (
            <>
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-display text-cifra font-bold leading-none tracking-tight tabular-nums text-ink">{precio.precio}</span>
                <span className="text-dato text-inkSoft">{precio.periodo}</span>
                {precio.antes && <span className="text-dato text-mute line-through">{precio.antes}</span>}
              </p>
              {precio.nota && (
                <p className="flex items-center gap-1.5 text-meta font-semibold text-granate">
                  <Sparkles size={14} aria-hidden className="shrink-0" />
                  {precio.nota}
                  {precio.antes ? `; después, ${precio.antes} al mes` : ""}
                </p>
              )}
              <Link href={rutaEn(base, "/checkout?plan=alertas")} className={claseAccion("primario", "w-full", "md")}>
                Quiero mis alertas
              </Link>
            </>
          )}
          <Link href={rutaEn(base, `/entrar?crear=1&next=${encodeURIComponent("/plazas")}`)} className={claseAccion("secundario", "w-full", "md")}>
            Empezar gratis
          </Link>
          <p className="text-center text-meta text-mute">
            Gratis: {gratis} por semana.{precio ? " El plan Alertas se cancela cuando quieras." : ""}
          </p>
        </div>
      </div>
    </section>
  );
}
