import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, BellRing, Building2, ChartNoAxesCombined, ClipboardList, Compass, HardHat, Landmark, Megaphone, PackageSearch, Ruler, Search, Sparkles, Truck } from "lucide-react";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { Planes } from "@/components/gobserva/Planes";
import { BarrasDobles, CaminoObra, type PasoCamino } from "@/components/gobserva-obras/Graficas";
import { BarraAvance, Cabecera, FaseInsignia, Paso, iconoSector } from "@/components/gobserva-obras/Piezas";
import { planesLicitaciones } from "@/components/licitaciones/planes";
import { TarjetaProyecto } from "@/components/gobserva-obras/TarjetaProyecto";
import { Faq } from "@/components/licitaciones/Faq";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { fechaCorta, numero, solesCompacto } from "@/lib/formato";
import { PRODUCTOS, rutaEn, urlCanonica } from "@/lib/gobserva";
import { BUSQUEDAS_EJEMPLO, FASES, getResumenObras, haceTiempo, lugarProyecto, nombreEmpresa, nombreEntidad, nombreProyecto, nombreSector, procesoConvocado } from "@/lib/gobserva-obras";
import { planesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";
import { nombreRegion } from "@/lib/licitaciones";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Obras: las obras públicas que se vienen, antes de que se liciten" },
  description:
    "Los proyectos de inversión pública viables o con expediente técnico que todavía no tienen contratista, y las obras en marcha con su plata, su avance y quién las construye. Invierte.pe, INFOBRAS y el SEACE en un solo lugar.",
  alternates: { canonical: urlCanonica("obras", "/") },
};

/**
 * Portada de Gobserva Obras (2026-11-01): el héroe con el buscador y las cifras vivas de Invierte.pe e INFOBRAS, el camino
 * de una obra (cuántos proyectos y cuánta plata hay en cada paso), los que se vienen con expediente técnico, los que se
 * están licitando, los recién declarados viables, las obras más grandes en marcha, la plata por región y por sector,
 * para quién es, cómo funciona, el MCP, los planes y las preguntas frecuentes. GET /proyectos/resumen (10 min en caché).
 */
export default async function InicioObras() {
  const base = baseProducto("obras");
  // Obras viene incluido en los planes de Gobserva Licitaciones (2026-11-07): sus planes, con enlaces a licitaciones.gobserva.cloud.
  const [r, cat] = await Promise.all([getResumenObras(), planesServidor("licitaciones")]);
  const ruta = (p: string) => rutaEn(base, p);
  const lista = (qs: string) => `${ruta("/proyectos")}${qs}`;
  const licitaciones = `https://${PRODUCTOS.licitaciones.host}`;
  const anio = new Date().getFullYear();

  const pasos: PasoCamino[] = r
    ? [
        { clave: "viable", nombre: "Viables", detalle: "Sin expediente técnico: la consultoría que lo elabora es lo que se contrata primero.", n: r.viables, monto: r.viablesMonto, href: lista("?fase=viable"), tono: "neutro" },
        { clave: "expediente", nombre: "Con expediente", detalle: FASES.expediente.detalle, n: r.expediente, monto: r.expedienteMonto, href: lista("?fase=expediente"), tono: "marca" },
        { clave: "licitacion", nombre: "Licitándose", detalle: "Un proceso de obra con su CUI está en convocatoria en el SEACE.", n: r.licitando, monto: r.licitandoMonto, href: lista("?fase=licitacion"), tono: "oportunidad" },
        { clave: "ejecucion", nombre: "En ejecución", detalle: "Ya tienen contratista o las ejecuta la entidad: compran materiales, equipos y supervisión.", n: r.enMarcha, monto: r.enMarchaMonto, href: lista("?pestana=en_marcha"), tono: "marcha" },
        { clave: "paralizada", nombre: "Paralizadas", detalle: "INFOBRAS las registra paralizadas hoy: muchas vuelven a licitarse como saldo de obra.", n: r.paralizadas, monto: r.paralizadasMonto, href: lista("?pestana=paralizadas"), tono: "alerta" },
      ]
    : [];

  return (
    <>
      {/* ── Héroe ─────────────────────────────────────────────────────────────── */}
      <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper">
        <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-50" />
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-maiz/10 blur-3xl" />
        <div className="container-page relative grid gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center">
          <div className="min-w-0">
            <h1 className="text-balance font-display text-portada font-bold leading-[1.04] tracking-tight sm:text-cartel">
              Las obras públicas que se vienen, <span className="text-maiz">antes de que se liciten.</span>
            </h1>
            <p className="mt-5 max-w-[60ch] text-pretty text-bloque leading-relaxed text-paper/75">
              {r ? `Más de ${numero(Math.floor(r.seVienen / 1000) * 1000)} proyectos del Estado` : "Miles de proyectos del Estado"} ya son viables o tienen expediente
              técnico y todavía no tienen quién los construya. Aquí están, con su plata y su entidad, junto con las obras en marcha, su avance y las
              empresas que las ejecutan.
            </p>
            <form method="get" action={ruta("/proyectos")} role="search" className="mt-8 flex flex-col gap-2 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Qué construyes</span>
                <Search size={19} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/50" />
                <input
                  name="q"
                  placeholder="¿Qué construyes? agua potable, pistas, colegios, riego…"
                  maxLength={120}
                  className="h-14 w-full rounded-2xl border border-paper/20 bg-paper pl-12 pr-4 text-destacado text-ink placeholder:text-ink/45 focus:outline-none focus:ring-4 focus:ring-maiz/40"
                />
              </label>
              <button type="submit" className={claseAccion("oscuro", "h-14 px-7", "md")}>
                Buscar proyectos <ArrowRight size={17} aria-hidden />
              </button>
            </form>
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Búsquedas de ejemplo">
              {BUSQUEDAS_EJEMPLO.slice(0, 6).map((x) => (
                <li key={x}>
                  <Link
                    href={lista(`?q=${encodeURIComponent(x)}`)}
                    className="inline-flex min-h-11 items-center rounded-full border border-paper/20 px-3.5 text-meta font-medium text-paper/85 sm:min-h-9 transition-colors duration-rapido hover:border-maiz/60 hover:bg-paper/10 hover:text-paper"
                  >
                    {x}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Invierte.pe e INFOBRAS hoy: cifras vivas. */}
          <div className="min-w-0 rounded-3xl border border-paper/15 bg-paper/[0.06] p-5 sm:p-6">
            <p className="flex items-center gap-2 text-meta font-semibold text-maiz">
              <span aria-hidden className="relative inline-flex h-2.5 w-2.5">
                <span className="absolute inset-0 rounded-full bg-maiz opacity-60 motion-safe:animate-ping" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-maiz" />
              </span>
              Invierte.pe e INFOBRAS, al día
            </p>
            {r ? (
              <>
                {/* El monto, a lo ancho (no entra en media columna en el celular); debajo, cuántos proyectos hay en cada paso. */}
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">
                  <Vivo valor={solesCompacto(r.porEjecutar)} etiqueta="por ejecutar entre lo que se viene y lo que está en marcha" ancho />
                  <Vivo valor={numero(r.seVienen)} etiqueta={`proyectos se vienen, por ${solesCompacto(r.seVienenMonto)}`} />
                  <Vivo valor={numero(r.expediente + r.licitando)} etiqueta="ya tienen expediente técnico o se están licitando" />
                  <Vivo valor={numero(r.enMarcha)} etiqueta={`obras en marcha, por ${solesCompacto(r.enMarchaMonto)}`} />
                  <Vivo valor={numero(r.paralizadas)} etiqueta={`obras paralizadas hoy, por ${solesCompacto(r.paralizadasMonto)}`} />
                </dl>
                {r.estado && (
                  <p className="mt-5 border-t border-paper/10 pt-4 text-meta leading-relaxed text-paper/60">
                    Invierte.pe al {fechaCorta(r.estado.inversionesAl)}, INFOBRAS al {fechaCorta(r.estado.infobrasAl)} y las convocatorias del SEACE, a
                    diario. {numero(r.nuevos30)} proyectos se declararon viables en los últimos 30 días.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-4 text-dato text-paper/70">Las cifras no cargaron ahora. Vuelve en un momento.</p>
            )}
            <Link href={ruta("/proyectos")} className="mt-3 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-maiz underline-offset-4 hover:underline">
              Ver los que se vienen <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      <div className="container-page space-y-20 py-14 sm:py-20">
        {/* ── El camino de una obra ───────────────────────────────────────────── */}
        {r && (
          <section aria-labelledby="camino-t">
            <Cabecera
              id="camino-t"
              titulo="El camino de una obra pública, hoy"
              bajada="Cada inversión pasa por estos pasos. Llegar cuando todavía es viable o recién tiene expediente técnico es la diferencia entre preparar tu oferta con tiempo y enterarte cuando ya se convocó."
            />
            <CaminoObra className="mt-6" pasos={pasos} etiqueta="Proyectos por fase" />
            <ul className="mt-5 flex flex-wrap gap-2" aria-label="Atajos">
              <Atajo href={lista("?min=10000000")} Icono={Ruler} texto={`De S/ 10 millones o más: ${numero(r.seVienen10m)}`} />
              <Atajo href={lista("?modalidad=contrata")} Icono={HardHat} texto={`Se licitan por contrata: ${numero(r.seVienenContrata)}`} />
              <Atajo href={lista("?tipo=equipamiento")} Icono={PackageSearch} texto={`Compra de equipos: ${numero(r.seVienenEquipamiento)}`} />
              <Atajo href={lista("?orden=reciente")} Icono={Sparkles} texto={`Viables en los últimos 30 días: ${numero(r.nuevos30)}`} />
            </ul>
          </section>
        )}

        {/* ── Se vienen ───────────────────────────────────────────────────────── */}
        {r && r.seVienenTop.length > 0 && (
          <section aria-labelledby="sevienen-t">
            <Cabecera
              id="sevienen-t"
              titulo="Se vienen: con expediente técnico y sin contratista"
              bajada="Los más grandes que se declararon viables en los últimos dos años y ya tienen expediente técnico. Lo siguiente es licitar la obra."
              accion={{ href: lista("?fase=expediente"), etiqueta: `Ver los ${numero(r.expediente)}` }}
            />
            {/* En el celular, una fila que se desliza (seis tarjetas una sobre otra eran 2,000 px); desde md, la rejilla. */}
            <ul
              aria-label="Proyectos con expediente técnico que se vienen"
              className="-mx-4 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-3 [&::-webkit-scrollbar]:hidden"
            >
              {r.seVienenTop.map((p) => (
                <li key={p.cui} className="w-[85%] min-w-0 shrink-0 snap-start scroll-ml-4 sm:w-[60%] sm:scroll-ml-6 md:w-auto">
                  <TarjetaProyecto p={p} base={base} compacta />
                </li>
              ))}
            </ul>
            {r.seVienenTop.length > 1 && <p className="mt-2 text-meta text-mute md:hidden">Desliza para ver los {numero(r.seVienenTop.length)}.</p>}
          </section>
        )}

        {/* ── Licitándose ahora y recién viables ─────────────────────────────── */}
        {r && (r.licitandoTop.length > 0 || r.nuevos.length > 0) && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {r.licitandoTop.length > 0 && (
              <section aria-labelledby="licitando-t" className="min-w-0 rounded-3xl border border-amber/40 bg-paper p-5 sm:p-6">
                <h2 id="licitando-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                  <Megaphone size={20} aria-hidden className="text-amberTexto" /> Se están licitando ahora
                </h2>
                <p className="mt-1 text-meta text-inkSoft">
                  Proyectos con un proceso de obra en convocatoria. El cronograma y las bases, en su ficha de Gobserva Licitaciones.
                </p>
                <ol className="mt-4 divide-y divide-line">
                  {r.licitandoTop.map((p) => (
                    <li key={p.cui} className="py-3">
                      <Link href={ruta(`/proyecto/${p.cui}`)} className="line-clamp-2 text-dato font-semibold leading-snug text-ink hover:text-granate">
                        {nombreProyecto(p.nombre, p)}
                      </Link>
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-inkSoft">
                        <span>{nombreEntidad(p.entidad)}</span>
                        <span>{lugarProyecto(p)}</span>
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
                        <span className="font-semibold text-ink">{p.costo ? solesCompacto(p.costo) : "Costo sin dato"}</span>
                        {p.convocatoriaFecha && (
                          <span className="text-amberTexto">
                            {procesoConvocado(p.convocatoriaTipo)} {haceTiempo(p.convocatoriaFecha)}
                          </span>
                        )}
                        {p.convocatoriaOcid && (
                          <a
                            href={`${licitaciones}/oportunidad/${encodeURIComponent(p.convocatoriaOcid)}`}
                            className="inline-flex min-h-11 items-center gap-0.5 font-semibold text-granate underline-offset-2 hover:underline sm:min-h-0"
                          >
                            Ver la convocatoria <ArrowUpRight size={13} aria-hidden />
                          </a>
                        )}
                      </p>
                    </li>
                  ))}
                </ol>
                <Link href={lista("?fase=licitacion")} className="mt-1 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
                  Ver los {numero(r.licitando)} que se están licitando <ArrowRight size={15} aria-hidden />
                </Link>
              </section>
            )}
            {r.nuevos.length > 0 && (
              <section aria-labelledby="nuevos-t" className="min-w-0 rounded-3xl border border-line bg-paper p-5 sm:p-6">
                <h2 id="nuevos-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                  <Sparkles size={20} aria-hidden className="text-granate" /> Recién declarados viables
                </h2>
                <p className="mt-1 text-meta text-inkSoft">Los últimos de S/ 1 millón o más: el pipeline que acaba de nacer.</p>
                <ol className="mt-4 divide-y divide-line">
                  {r.nuevos.map((p) => {
                    const Icono = iconoSector(p.sector);
                    return (
                      <li key={p.cui} className="flex gap-3 py-3">
                        <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-granate-50 text-granate">
                          <Icono size={16} />
                        </span>
                        <div className="min-w-0">
                          <Link href={ruta(`/proyecto/${p.cui}`)} className="line-clamp-2 text-dato font-semibold leading-snug text-ink hover:text-granate">
                            {nombreProyecto(p.nombre, p)}
                          </Link>
                          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-inkSoft">
                            <span className="font-semibold text-ink">{p.costo ? solesCompacto(p.costo) : "Costo sin dato"}</span>
                            <span>{p.region ? nombreRegion(p.region) : "Varias regiones"}</span>
                            <span>{p.fechaViable ? `Viable ${haceTiempo(p.fechaViable)}` : nombreSector(p.sector)}</span>
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <Link href={lista("?orden=reciente")} className="mt-1 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
                  Ver los más recientes <ArrowRight size={15} aria-hidden />
                </Link>
              </section>
            )}
          </div>
        )}

        {/* ── Las más grandes en marcha ──────────────────────────────────────── */}
        {r && r.enMarchaTop.length > 0 && (
          <section aria-labelledby="marcha-t">
            <Cabecera
              id="marcha-t"
              titulo="Las obras más grandes en marcha"
              bajada="Con su avance físico (lo construido contra lo programado, como lo registra la entidad en INFOBRAS) y la empresa que las construye. Proveedores de materiales y supervisores: aquí está la demanda de hoy."
              accion={{ href: lista("?pestana=en_marcha"), etiqueta: `Ver las ${numero(r.enMarcha)}` }}
            />
            <ol className="mt-6 divide-y divide-line rounded-3xl border border-line bg-paper">
              {r.enMarchaTop.map((p) => (
                // En el celular el costo va arriba a la derecha y la barra debajo, a lo ancho; desde md, tres columnas.
                <li key={p.cui} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] md:items-center md:gap-x-6">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <FaseInsignia fase={p.fase} />
                      <span className="text-rotulo text-mute">{lugarProyecto(p)}</span>
                    </div>
                    <Link href={ruta(`/proyecto/${p.cui}`)} className="mt-1.5 line-clamp-2 block text-dato font-semibold leading-snug text-ink hover:text-granate">
                      {nombreProyecto(p.nombre, p)}
                    </Link>
                    <p className="mt-1 truncate text-meta text-inkSoft">
                      {p.ejecutor && p.obraRepresenta ? (
                        <>
                          <HardHat size={13} aria-hidden className="mr-1 inline text-mute" />
                          {nombreEmpresa(p.ejecutor)}
                        </>
                      ) : (
                        nombreEntidad(p.entidad)
                      )}
                    </p>
                  </div>
                  {p.obraRepresenta && p.obraFisico != null ? (
                    <BarraAvance
                      className="col-span-2 md:col-span-1"
                      real={p.obraFisico}
                      programado={p.obraProgramado}
                      pie={p.obraAvanceAl ? `Registrado en INFOBRAS el ${fechaCorta(p.obraAvanceAl)}` : undefined}
                    />
                  ) : (
                    <BarraAvance
                      className="col-span-2 md:col-span-1"
                      real={p.avanceMef}
                      etiqueta="Avance físico (MEF)"
                      pie={p.obras > 1 ? `INFOBRAS registra ${numero(p.obras)} obras con su CUI` : undefined}
                    />
                  )}
                  <p className="col-start-2 row-start-1 self-start text-right font-display text-bloque font-bold tabular-nums text-ink md:col-start-3 md:self-center">
                    <span className="sr-only">Costo: </span>
                    {p.costo ? solesCompacto(p.costo) : "Sin dato"}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* ── Dónde está la plata ─────────────────────────────────────────────── */}
        {r && (
          <section aria-labelledby="regiones-t">
            <Cabecera
              id="regiones-t"
              titulo="Dónde está la plata"
              bajada="Lo que se viene y lo que está en ejecución en cada región, en soles. Toca una región para ver sus proyectos."
              accion={{ href: ruta("/mercado"), etiqueta: "Ver el mercado de tu región" }}
            />
            <div className="mt-6 rounded-3xl border border-line bg-paper p-5 sm:p-6">
              <BarrasDobles
                etiqueta="Monto por región"
                serieA="Se vienen"
                serieB="En ejecución"
                columnas={2}
                visibles={10}
                mas="Ver las otras {n} regiones"
                filas={r.porRegion.map((x) => ({
                  clave: x.clave,
                  etiqueta: nombreRegion(x.clave),
                  a: x.seVienenMonto,
                  b: x.enMarchaMonto,
                  detalle: `${numero(x.seVienen)} se vienen, ${numero(x.enMarcha)} en marcha${x.paralizadas ? `, ${numero(x.paralizadas)} paralizadas` : ""}`,
                  href: lista(`?region=${x.clave}`),
                }))}
              />
            </div>
          </section>
        )}

        {/* ── Por sector y para quién ─────────────────────────────────────────── */}
        {r && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <section aria-labelledby="sectores-t" className="min-w-0 rounded-3xl border border-line bg-paper p-5 sm:p-6">
              <h2 id="sectores-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                <ChartNoAxesCombined size={20} aria-hidden className="text-granate" /> Qué se va a construir
              </h2>
              <p className="mt-1 text-meta text-inkSoft">Por sector (la función del MEF), en soles.</p>
              <BarrasDobles
                className="mt-4"
                etiqueta="Monto por sector"
                serieA="Se vienen"
                serieB="En ejecución"
                visibles={8}
                mas="Ver los otros {n} sectores"
                filas={r.porSector
                  .filter((x) => x.clave !== "otros" && (x.seVienen > 0 || x.enMarcha > 0))
                  .map((x) => ({
                    clave: x.clave,
                    etiqueta: nombreSector(x.clave),
                    a: x.seVienenMonto,
                    b: x.enMarchaMonto,
                    detalle: `${numero(x.seVienen)} se vienen, ${numero(x.enMarcha)} en marcha`,
                    href: lista(`?sector=${x.clave}`),
                  }))}
              />
            </section>
            <section aria-labelledby="quien-t" className="sobre-oscuro min-w-0 rounded-3xl bg-ink p-5 text-paper sm:p-7 lg:self-start">
              <h2 id="quien-t" className="font-display text-seccion font-bold leading-tight">
                Para quién es
              </h2>
              <ul className="mt-5 space-y-5">
                <ParaQuien
                  Icono={HardHat}
                  titulo="Constructoras"
                  texto="Las obras con expediente técnico antes de la convocatoria, las que se licitan hoy y los saldos de obra de las paralizadas."
                />
                <ParaQuien
                  Icono={ClipboardList}
                  titulo="Consultoras y supervisoras"
                  texto="Los proyectos viables sin expediente técnico, las obras que van a necesitar supervisión y quién gana esos contratos."
                />
                <ParaQuien
                  Icono={Truck}
                  titulo="Proveedores de materiales y equipos"
                  texto="Las obras en marcha (también las que hace la entidad por administración directa) y la compra de equipos que se viene."
                />
                <ParaQuien
                  Icono={Compass}
                  titulo="Bancos, aseguradoras y gremios"
                  texto="El tamaño del mercado por región y sector, el presupuesto del año y cuánto se queda paralizado."
                />
              </ul>
              <p className="mt-6 border-t border-paper/10 pt-4 text-meta text-paper/65">
                Presupuesto de inversión {anio} de estos proyectos: {solesCompacto(r.pimAnio)}, con {solesCompacto(r.devengadoAnio)} ya gastado.
              </p>
            </section>
          </div>
        )}

        {/* ── Cómo funciona ───────────────────────────────────────────────────── */}
        <section aria-labelledby="como-t">
          <Cabecera id="como-t" titulo="Cómo funciona" bajada="Tres pasos, sin revisar Invierte.pe, INFOBRAS y el SEACE cada semana." />
          <ol className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
            <Paso n={1} Icono={Landmark} titulo="Dinos qué construyes y dónde" texto="Tus sectores (agua, pistas, colegios, riego), tus regiones y el tamaño de obra que puedes asumir." />
            <Paso
              n={2}
              Icono={BellRing}
              titulo="Te llega lo nuevo"
              texto={`Los proyectos que se declaran viables, los que aprueban su expediente técnico y los que pasan a licitación, ${cat.correoActivo ? "en tu correo" : "en tu cuenta"}: cada semana con la cuenta gratis, cada mañana con Pro.`}
            />
            <Paso
              n={3}
              Icono={Building2}
              titulo="Llega antes y con datos"
              texto="Cuánta plata tiene el proyecto este año, cuánto falta ejecutar, quién ganó obras parecidas en la región y a cuánto."
              ultimo
            />
          </ol>
        </section>

        {/* ── Planes ──────────────────────────────────────────────────────────── */}
        <section aria-labelledby="planes-t">
          <Cabecera
            id="planes-t"
            titulo="Planes"
            bajada="Obras viene incluido en Gobserva Licitaciones: con un solo plan tienes las obras que se vienen, las licitaciones y los contratos menores abiertos. Buscar y leer las fichas es gratis; un plan de pago te avisa cada mañana y baja tus búsquedas en Excel."
            accion={{ href: urlCanonica("licitaciones", "/planes"), etiqueta: "Comparar planes" }}
          />
          {/* En el celular, los planes se deslizan a los lados (uno sobre otro eran 2,400 px de portada); la comparación
              entera, en /planes. Desde md, la rejilla de siempre. */}
          <Planes
            className="-mx-4 mt-6 px-4 max-md:flex max-md:snap-x max-md:snap-mandatory max-md:overflow-x-auto max-md:pb-2 max-md:pt-4 max-md:[scrollbar-width:none] sm:-mx-6 sm:px-6 md:mx-0 md:px-0 max-md:[&::-webkit-scrollbar]:hidden max-md:[&>li]:w-[86%] max-md:[&>li]:shrink-0 max-md:[&>li]:snap-start max-md:[&>li]:scroll-ml-4 sm:max-md:[&>li]:w-[60%] sm:max-md:[&>li]:scroll-ml-6"
            planes={planesLicitaciones(`https://${PRODUCTOS.licitaciones.host}`, cat)}
          />
          <p className="mt-2 text-meta text-mute md:hidden">Desliza para ver los planes, o compáralos en la página de planes.</p>
        </section>

        {/* ── MCP ─────────────────────────────────────────────────────────────── */}
        <BloqueMCP
          id="mcp"
          titulo="Pregúntale a tu IA por las obras que se vienen"
          bajada="Conecta Claude, ChatGPT o Cursor al servidor MCP de Gobserva y pregunta en tus palabras: tu asistente consulta los proyectos, su avance y el mercado de obras en vivo, con la fuente oficial de cada dato. Gratis durante la beta."
          ejemplos={[
            "¿Qué proyectos de agua potable de más de S/ 5 millones tienen expediente técnico en Puno?",
            "Dame las obras paralizadas de Cusco, desde cuándo y por qué.",
            "¿Qué empresas ganan más obras en Arequipa y por cuánto?",
          ]}
          herramientas={[
            { nombre: "buscar_proyectos_inversion", descripcion: "Los proyectos que se vienen, en marcha o paralizados, con filtros por texto, región, sector, fase y monto." },
            { nombre: "ficha_proyecto", descripcion: "Un proyecto por su CUI: montos, fase, sus obras con su avance, sus procesos del SEACE y quién los ganó." },
            { nombre: "mercado_obras", descripcion: "El mercado de obras de una región y un sector: pipeline, ejecución, paralizadas y quién gana." },
          ]}
        />

        <Faq
          preguntas={[
            {
              p: "¿De dónde salen los datos?",
              r: "De fuentes públicas del Estado: las inversiones de Invierte.pe (MEF), con su CUI, sus montos, su fase y su gasto; el avance de cada obra en INFOBRAS (Contraloría), con sus paralizaciones y su contratista; y los procesos del SEACE y de CONOSCE (OECE) que citan el CUI, con quién los ganó. Cada ficha enlaza a la fuente oficial.",
            },
            {
              p: "¿Qué quiere decir que un proyecto «se viene»?",
              r: "Que es viable o está aprobado, se declaró en los últimos tres años (o tiene presupuesto este año) y todavía no tiene obra en ejecución ni contrato de obra: es el pipeline antes de la licitación. Si ya tiene expediente técnico, lo siguiente es convocar la obra.",
            },
            {
              p: "¿Qué tan al día está?",
              r: "Invierte.pe e INFOBRAS se cargan cada semana y las convocatorias del SEACE, a diario. El avance de una obra lo registra cada entidad en INFOBRAS y puede llegar con meses de atraso: cada ficha dice a qué fecha corresponde.",
            },
            {
              p: "¿Puedo saber quién construye una obra?",
              r: "Sí, cuando es una empresa (RUC 20): INFOBRAS y el SEACE lo publican, y de un consorcio mostramos sus empresas integrantes. De las personas naturales no mostramos nombres.",
            },
            { p: "¿Reemplaza al SEACE?", r: "No. Las ofertas se presentan en el SEACE, como siempre. Gobserva Obras te avisa antes y te da contexto para decidir; cada proyecto enlaza a sus procesos y a sus fichas oficiales." },
            { p: "¿Es legal usar esta información?", r: "Sí. Son datos públicos que el Estado publica por ley (transparencia y datos abiertos). Gobserva los ordena y los cruza; no vende datos personales ni nombra a personas naturales." },
            { p: "¿Cómo pago un plan?", r: "Con tarjeta de crédito o débito por Mercado Pago, que se cobra cada mes, o con Yape o Plin por 1, 3, 6 o 12 meses. Cada pago queda en tu cuenta con su comprobante; si necesitas factura para tu empresa, escríbenos." },
          ]}
        />
      </div>
    </>
  );
}

function Vivo({ valor, etiqueta, ancho = false }: { valor: string; etiqueta: string; ancho?: boolean }) {
  return (
    <div className={ancho ? "col-span-2 flex min-w-0 flex-col-reverse border-b border-paper/10 pb-4" : "flex min-w-0 flex-col-reverse"}>
      <dt className="mt-1.5 text-meta leading-snug text-paper/65">{etiqueta}</dt>
      <dd className={ancho ? "font-display text-titulo font-bold leading-none tabular-nums text-maiz" : "font-display text-cifra font-bold leading-none tabular-nums text-paper"}>{valor}</dd>
    </div>
  );
}

function Atajo({ href, Icono, texto }: { href: string; Icono: typeof Ruler; texto: string }) {
  return (
    <li>
      <Link
        href={href}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-paper px-4 text-meta font-semibold text-ink sm:min-h-10 transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
      >
        <Icono size={15} aria-hidden className="text-granate" /> {texto}
      </Link>
    </li>
  );
}

function ParaQuien({ Icono, titulo, texto }: { Icono: typeof Ruler; titulo: string; texto: string }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-maiz/15 text-maiz">
        <Icono size={19} />
      </span>
      <div className="min-w-0">
        <h3 className="font-display text-bloque font-bold leading-tight text-paper">{titulo}</h3>
        <p className="mt-1 text-dato leading-relaxed text-paper/75">{texto}</p>
      </div>
    </li>
  );
}
