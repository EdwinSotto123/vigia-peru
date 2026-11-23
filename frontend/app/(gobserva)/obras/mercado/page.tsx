import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  Building2,
  CalendarClock,
  ChartNoAxesCombined,
  CirclePause,
  ClipboardList,
  Gavel,
  HardHat,
  Hourglass,
  Landmark,
  MapPin,
  Ruler,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Wallet,
} from "lucide-react";
import { Barras, BarrasDobles, Histograma } from "@/components/gobserva-obras/Graficas";
import { BarraAvance, Dato, TiraCifras, iconoSector } from "@/components/gobserva-obras/Piezas";
import { Odometro } from "@/components/gobserva/portada/Odometro";
import { PestanasVivas } from "@/components/gobserva/portada/PestanasVivas";
import { Nota } from "@/components/patrones/Estructura";
import { PersonajePregunta } from "@/components/pixel/Escena";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { fechaConAnio, numero, porcentaje, solesCompacto } from "@/lib/formato";
import { fichaEmpresaVigia, rutaEn, urlCanonica } from "@/lib/gobserva";
import { SECTORES, TAMANOS, getMercadoObras, nombreEmpresa, nombreLugar, nombreProyecto, nombreSector, type Ranking } from "@/lib/gobserva-obras";
import { baseProducto } from "@/lib/gobserva-servidor";
import { REGIONES_UBIGEO, nombreRegion } from "@/lib/licitaciones";

type Props = { searchParams?: { region?: string; sector?: string } };

const valido = (sp: Props["searchParams"]) => {
  const region = sp?.region && /^(0[1-9]|1\d|2[0-5])$/.test(sp.region) ? sp.region : undefined;
  const sector = sp?.sector && SECTORES.some((s) => s.clave === sp.sector) ? sp.sector : undefined;
  return { region, sector };
};

const titulo = (region?: string, sector?: string) =>
  `El mercado de obras públicas${sector ? ` de ${nombreSector(sector).toLocaleLowerCase("es-PE")}` : ""}${region ? ` en ${nombreRegion(region)}` : " del Perú"}`;

export function generateMetadata({ searchParams }: Props): Metadata {
  const { region, sector } = valido(searchParams);
  const qs = new URLSearchParams({ ...(region ? { region } : {}), ...(sector ? { sector } : {}) }).toString();
  return {
    title: titulo(region, sector),
    description: `Cuánta plata hay en obras que se vienen y en ejecución${region ? ` en ${nombreRegion(region)}` : ""}, el tamaño típico de una obra, cuántas se paralizan y por qué, y qué empresas ganan las obras y las supervisiones.`,
    alternates: { canonical: urlCanonica("obras", `/mercado${qs ? `?${qs}` : ""}`) },
  };
}

/**
 * El mercado de obras de una región y un sector: lo que se viene y lo que está en ejecución (en plata y en número), por
 * zona (regiones o provincias), por sector y por tamaño; las paralizadas, sus causas y las más grandes; y quién gana las
 * obras y las supervisiones en 12 meses (CONOSCE). GET /proyectos/mercado (6 h en caché).
 */
export default async function MercadoObras({ searchParams }: Props) {
  const base = baseProducto("obras");
  const ruta = (p: string) => rutaEn(base, p);
  const { region, sector } = valido(searchParams);
  const m = await getMercadoObras(region, sector);
  const anio = new Date().getFullYear();
  const lista = (extra: Record<string, string>) =>
    `${ruta("/proyectos")}?${new URLSearchParams({ ...(region ? { region } : {}), ...(sector ? { sector } : {}), ...extra }).toString()}`;
  const enMarchaYParalizadas = m ? m.enMarcha.n + m.paralizadas.n : 0;
  const pctParalizadas = m && enMarchaYParalizadas ? (m.paralizadas.n / enMarchaYParalizadas) * 100 : null;
  const pctAnio = m && m.pimAnio ? (m.devengadoAnio / m.pimAnio) * 100 : null;
  const zonas = m ? [...m.porZona].sort((a, b) => b.seVienenMonto + b.enMarchaMonto - (a.seVienenMonto + a.enMarchaMonto)) : [];
  const IconoSector = iconoSector(sector);

  return (
    <div className="container-page pb-10 pt-5 sm:pb-14 sm:pt-6">
      <nav aria-label="Ruta" className="hidden text-meta text-mute sm:block">
        <Link href={ruta("/")} className="inline-flex min-h-11 items-center hover:text-granate hover:underline">
          Inicio
        </Link>
        <span aria-hidden className="mx-1.5">/</span>
        <span className="text-inkSoft">Mercado</span>
      </nav>
      <h1 className="text-balance font-display text-cifra font-bold leading-tight text-ink sm:text-titulo">{titulo(region, sector)}</h1>
      <p className="mt-2 max-w-[70ch] text-dato leading-relaxed text-inkSoft sm:text-cuerpo">
        Cuánta plata hay en lo que se viene y en lo que está en ejecución, de qué tamaño son las obras, cuántas se paralizan y quién gana las
        licitaciones de obra y de supervisión. Elige una región y un sector.
      </p>

      <form method="get" action={ruta("/mercado")} className="mt-5 grid grid-cols-2 gap-2.5 rounded-2xl border border-line bg-paper p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:p-4" aria-label="Elegir región y sector">
        <label className="block min-w-0">
          <span className="text-rotulo font-medium text-mute">Región</span>
          <select name="region" defaultValue={region ?? ""} className="mt-1 h-11 w-full min-w-0 rounded-xl border border-line bg-paper px-3 text-destacado text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato">
            <option value="">Todo el Perú</option>
            {REGIONES_UBIGEO.map((r) => (
              <option key={r.ubigeo} value={r.ubigeo}>
                {r.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="text-rotulo font-medium text-mute">Sector</span>
          <select name="sector" defaultValue={sector ?? ""} className="mt-1 h-11 w-full min-w-0 rounded-xl border border-line bg-paper px-3 text-destacado text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato">
            <option value="">Todos los sectores</option>
            {SECTORES.map((s) => (
              <option key={s.clave} value={s.clave}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
        <div className="col-span-2 flex items-end sm:col-span-1">
          <button type="submit" className={claseAccion("primario", "h-11 w-full sm:w-auto")}>
            <SlidersHorizontal size={16} aria-hidden /> Ver el mercado
          </button>
        </div>
      </form>

      {!m ? (
        <div className="mt-10 flex items-center gap-4 rounded-2xl border border-line bg-paperSoft p-6">
          <PersonajePregunta nombre="obrero" escala={2.5} className="shrink-0" />
          <p className="min-w-0 text-dato text-inkSoft">No pudimos calcular este mercado ahora. Vuelve a intentarlo en un momento.</p>
        </div>
      ) : m.activas === 0 ? (
        <div className="mt-10 flex items-start gap-4 rounded-2xl border border-line bg-paperSoft p-6">
          <PersonajePregunta nombre="obrero" escala={2.5} className="shrink-0" />
          <div className="min-w-0">
            <p className="font-display text-bloque font-bold leading-tight text-ink">No hay inversiones activas con esta región y este sector</p>
            <p className="mt-1 text-dato text-inkSoft">Prueba con todo el Perú o con otro sector.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {region && (
                <Link href={`${ruta("/mercado")}${sector ? `?sector=${sector}` : ""}`} prefetch={false} className={claseAccion("secundario", "min-h-11")}>
                  {sector ? `${nombreSector(sector)} en todo el Perú` : "Todo el Perú"}
                </Link>
              )}
              {sector && (
                <Link href={`${ruta("/mercado")}${region ? `?region=${region}` : ""}`} prefetch={false} className={claseAccion("secundario", "min-h-11")}>
                  Todos los sectores{region ? ` en ${nombreRegion(region)}` : ""}
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-10 space-y-12">
          {/* Las cifras */}
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
            <Dato Icono={Wallet} valor={<Odometro texto={solesCompacto(m.porEjecutar)} />} etiqueta="por ejecutar entre lo que se viene y lo que está en marcha" destacado />
            <Dato Icono={Sparkles} valor={<Odometro texto={numero(m.seVienen.n)} />} etiqueta={`proyectos se vienen, por ${solesCompacto(m.seVienen.monto)}`} detalle={`${numero(m.seVienen.conExpediente)} ya tienen expediente técnico o se licitan`} />
            <Dato Icono={HardHat} valor={<Odometro texto={numero(m.enMarcha.n)} />} etiqueta={`obras en marcha, por ${solesCompacto(m.enMarcha.monto)}`} detalle={`Les faltan ${solesCompacto(m.enMarcha.porEjecutar)}`} />
            <Dato
              Icono={CirclePause}
              valor={<Odometro texto={pctParalizadas != null ? porcentaje(pctParalizadas, { decimales: pctParalizadas < 10 ? 1 : 0 }) : "Sin dato"} />}
              etiqueta={`de las obras en marcha está paralizada (${numero(m.paralizadas.n)})`}
              detalle={`Con ${solesCompacto(m.paralizadas.porEjecutar)} sin ejecutar`}
            />
            <Dato Icono={Ruler} valor={<Odometro texto={solesCompacto(m.enMarcha.mediana)} />} etiqueta="cuesta la obra típica en marcha (la mediana)" detalle={`La que se viene: ${solesCompacto(m.seVienen.mediana)}`} />
            <Dato
              Icono={CalendarClock}
              valor={<Odometro texto={solesCompacto(m.pimAnio)} />}
              etiqueta={`de presupuesto de inversión ${anio} (PIM)`}
              detalle={pctAnio != null ? `Gastado: ${solesCompacto(m.devengadoAnio)} (${porcentaje(pctAnio)})` : undefined}
            />
          </dl>

          <div className="flex flex-wrap gap-2">
            <Link href={lista({})} className={claseAccion("primario", "min-h-11")}>
              Ver los {numero(m.seVienen.n)} que se vienen <ArrowRight size={16} aria-hidden />
            </Link>
            <Link href={lista({ pestana: "en_marcha" })} className={claseAccion("secundario", "min-h-11")}>
              Ver las {numero(m.enMarcha.n)} obras en marcha
            </Link>
          </div>

          {/* El mercado por dentro, en pestañas (2026-11-22, el usuario: «itera sobre todo»): dónde, qué, de qué tamaño y qué se
              paraliza eran cuatro placas apiladas más la lista de las paralizadas (11,000 px en el celular). */}
          <section aria-labelledby="dentro-t">
            <h2 id="dentro-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
              Dónde, qué y de qué tamaño
            </h2>
            <PestanasVivas
              etiqueta="El mercado por dentro"
              className="-mx-1 mt-3 overflow-x-clip px-1"
              pestanas={[
                { titulo: region ? "Por provincia" : "Por región", icono: <MapPin size={16} aria-hidden /> },
                { titulo: sector ? nombreSector(sector) : "Por sector", icono: sector ? <IconoSector size={16} aria-hidden /> : <ChartNoAxesCombined size={16} aria-hidden /> },
                { titulo: "De qué tamaño", icono: <Ruler size={16} aria-hidden /> },
                ...(m.paralizadas.n > 0
                  ? [
                      {
                        titulo: (
                          <>
                            Paralizadas
                            <span className="rounded-full bg-crimson-soft px-2 py-0.5 text-meta font-semibold tabular-nums text-crimsonTexto">{numero(m.paralizadas.n)}</span>
                          </>
                        ),
                        icono: <CirclePause size={16} aria-hidden />,
                      },
                    ]
                  : []),
              ]}
            >
              {/* Dónde */}
              <div className="rounded-3xl border border-line bg-paper p-5 sm:p-6">
                <p className="text-meta text-inkSoft">{region ? "En soles, por la provincia que registra cada inversión." : "En soles. Toca una región para ver su mercado."}</p>
                <BarrasDobles
                  className="mt-4"
                  etiqueta={region ? "Monto por provincia" : "Monto por región"}
                  serieA="Se vienen"
                  serieB="En ejecución"
                  columnas={zonas.length > 8 ? 2 : 1}
                  visibles={10}
                  mas={region ? "Ver las otras {n} provincias" : "Ver las otras {n} regiones"}
                  filas={zonas.map((z) => ({
                    clave: z.clave,
                    etiqueta: region ? nombreLugar(z.clave) ?? "Varias provincias" : nombreRegion(z.clave),
                    a: z.seVienenMonto,
                    b: z.enMarchaMonto,
                    detalle: `${numero(z.seVienen)} se vienen, ${numero(z.enMarcha)} en marcha${z.paralizadas ? `, ${numero(z.paralizadas)} paralizadas` : ""}`,
                    href: region ? undefined : `${ruta("/mercado")}?${new URLSearchParams({ region: z.clave, ...(sector ? { sector } : {}) }).toString()}`,
                  }))}
                />
              </div>

              {/* Qué: todos los sectores o, con uno elegido, sus cifras. */}
              {!sector ? (
                <div className="rounded-3xl border border-line bg-paper p-5 sm:p-6">
                  <p className="text-meta text-inkSoft">En soles. Toca un sector para ver su mercado.</p>
                  <BarrasDobles
                    className="mt-4"
                    etiqueta="Monto por sector"
                    serieA="Se vienen"
                    serieB="En ejecución"
                    columnas={2}
                    filas={[...m.porSector]
                      .filter((s) => s.seVienen > 0 || s.enMarcha > 0)
                      .sort((a, b) => b.seVienenMonto - a.seVienenMonto)
                      .map((s) => ({
                        clave: s.clave,
                        etiqueta: nombreSector(s.clave),
                        a: s.seVienenMonto,
                        b: s.enMarchaMonto,
                        detalle: `${numero(s.seVienen)} se vienen, ${numero(s.enMarcha)} en marcha`,
                        href: `${ruta("/mercado")}?${new URLSearchParams({ ...(region ? { region } : {}), sector: s.clave }).toString()}`,
                      }))}
                  />
                </div>
              ) : (
                <div className="rounded-3xl border border-line bg-paper p-5 sm:p-6">
                  <dl className="grid grid-cols-2 gap-3">
                    <div className="min-w-0 rounded-2xl border border-line bg-paperSoft px-3.5 py-3">
                      <dt className="flex items-center gap-1.5 text-meta text-inkSoft">
                        <Landmark size={15} aria-hidden className="shrink-0 text-granate" /> Inversiones activas
                      </dt>
                      <dd className="mt-1 font-display text-seccion font-bold leading-tight tabular-nums text-ink">
                        <Odometro texto={numero(m.activas)} />
                      </dd>
                    </div>
                    <div className="min-w-0 rounded-2xl border border-line bg-paperSoft px-3.5 py-3">
                      <dt className="flex items-center gap-1.5 text-meta text-inkSoft">
                        <Wallet size={15} aria-hidden className="shrink-0 text-granate" /> Costo sumado
                      </dt>
                      <dd className="mt-1 font-display text-seccion font-bold leading-tight tabular-nums text-ink">
                        <Odometro texto={solesCompacto(m.costo)} />
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-meta text-inkSoft">
                    De {nombreSector(sector).toLocaleLowerCase("es-PE")}
                    {region ? ` en ${nombreRegion(region)}` : " en todo el Perú"}.{" "}
                    <Link
                      href={`${ruta("/mercado")}${region ? `?region=${region}` : ""}`}
                      prefetch={false}
                      className="inline-flex min-h-11 items-center font-semibold text-granate underline-offset-2 hover:underline sm:min-h-0"
                    >
                      Ver todos los sectores
                    </Link>
                  </p>
                </div>
              )}

              {/* De qué tamaño */}
              <div className="rounded-3xl border border-line bg-paper p-5 sm:p-6">
                <p className="text-meta text-inkSoft">Cuántos proyectos hay en cada rango de costo.</p>
                <div className="mt-5">
                  <Histograma
                    etiqueta="Proyectos por tamaño de obra"
                    serieA="Se vienen"
                    serieB="En marcha o paralizadas"
                    barras={m.tamanos.map((t) => ({ clave: t.rango, etiqueta: TAMANOS[t.rango] ?? t.rango, a: t.seVienen, b: t.enMarcha }))}
                  />
                </div>
              </div>

              {/* Paralizadas: por qué y las más grandes, como fichas. */}
              {m.paralizadas.n > 0 ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
                  <div className="min-w-0 rounded-3xl border border-line bg-paper p-5 sm:p-6">
                    <h3 className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
                      <CirclePause size={18} aria-hidden className="text-crimsonTexto" /> Por qué se paralizan
                    </h3>
                    <p className="mt-1 text-meta text-inkSoft">La causa que registra la entidad en INFOBRAS, de las {numero(m.paralizadas.n)} paralizadas hoy.</p>
                    <Barras
                      className="mt-4"
                      tono="alerta"
                      etiqueta="Obras paralizadas por causa"
                      visibles={6}
                      mas="Ver las otras {n} causas"
                      filas={m.causales.map((c) => ({ clave: c.causal, etiqueta: c.causal, valor: c.n }))}
                    />
                  </div>
                  {m.mayoresParalizadas.length > 0 && (
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
                        <Hourglass size={18} aria-hidden className="text-granate" /> Las paralizadas más grandes
                      </h3>
                      <p className="mt-1 text-meta text-inkSoft">Muchas vuelven a licitarse como saldo de obra.</p>
                      <ol className="mt-3 grid gap-3">
                        {m.mayoresParalizadas.map((p) => (
                          <li key={p.cui} className="gs-mira relative min-w-0 rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-crimson/40">
                            <div className="flex items-start gap-3">
                              <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-crimson-soft text-crimsonTexto">
                                <CirclePause size={18} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <Link
                                  href={ruta(`/proyecto/${p.cui}`)}
                                  className="group line-clamp-2 text-dato font-semibold leading-snug text-ink after:absolute after:inset-0 after:rounded-2xl hover:text-granate focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-granate"
                                >
                                  {nombreProyecto(p.nombre, p)}
                                </Link>
                                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-meta text-inkSoft">
                                  <span className="inline-flex items-center gap-1">
                                    <MapPin size={13} aria-hidden className="shrink-0 text-mute" />
                                    {[nombreLugar(p.provincia), p.region ? nombreRegion(p.region) : null].filter(Boolean).join(", ") || "Varias regiones"}
                                  </span>
                                  {p.desde && <span className="text-crimsonTexto">Paralizada desde el {fechaConAnio(p.desde)}</span>}
                                </p>
                              </div>
                              <span className="shrink-0 font-display text-cuerpo font-bold tabular-nums text-ink">{solesCompacto(p.costo)}</span>
                            </div>
                            {p.fisico != null && <BarraAvance className="mt-3" real={p.fisico} />}
                          </li>
                        ))}
                      </ol>
                      <Link href={lista({ pestana: "paralizadas" })} className="mt-2 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
                        Ver las {numero(m.paralizadas.n)} paralizadas <ArrowRight size={15} aria-hidden />
                      </Link>
                    </div>
                  )}
                </div>
              ) : null}
            </PestanasVivas>
          </section>

          {/* Quién gana */}
          <section aria-labelledby="quien-t">
            <h2 id="quien-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
              Quién gana las obras{region ? ` en ${nombreRegion(region)}` : ""}
            </h2>
            <p className="mt-2 max-w-[75ch] text-cuerpo leading-relaxed text-inkSoft">
              Las obras que se adjudicaron con buena pro en los últimos 12 meses y las empresas que más ganan, solas o en consorcio: tu competencia.
            </p>
            {m.adjudicadoObras && m.adjudicadoObras.procesos > 0 ? (
              <TiraCifras
                className="mt-5"
                etiqueta="Las obras adjudicadas en los últimos 12 meses"
                items={[
                  { Icono: Gavel, etiqueta: "Obras adjudicadas", valor: numero(m.adjudicadoObras.procesos) },
                  { Icono: Wallet, etiqueta: "Monto adjudicado", valor: solesCompacto(m.adjudicadoObras.monto) },
                  {
                    Icono: Ruler,
                    etiqueta: "La obra típica",
                    valor: m.adjudicadoObras.mediana ? solesCompacto(m.adjudicadoObras.mediana) : "Sin dato",
                    detalle: "La mediana de lo adjudicado",
                  },
                  { Icono: Building2, etiqueta: "Empresas que ganaron", valor: numero(m.adjudicadoObras.empresas), detalle: "Solas o en consorcio" },
                ]}
              />
            ) : (
              <Nota className="mt-4">No hay obras adjudicadas con estos filtros en los últimos 12 meses.</Nota>
            )}
            <PestanasVivas
              etiqueta="Quién gana"
              className="-mx-1 mt-6 overflow-x-clip px-1"
              pestanas={[
                { titulo: "Las obras", icono: <Trophy size={16} aria-hidden /> },
                { titulo: "Las supervisiones", icono: <ClipboardList size={16} aria-hidden /> },
              ]}
            >
              <RankingEmpresas Icono={Trophy} titulo="Las que más obras ganan" filas={m.quienConstruye} />
              <RankingEmpresas Icono={ClipboardList} titulo="Las que más supervisiones y consultorías de obra ganan" filas={m.quienSupervisa} />
            </PestanasVivas>
            <Nota className="mt-3">
              Fuente: adjudicaciones con buena pro de CONOSCE (OECE) en los últimos 12 meses{m.conosceHasta ? `, hasta el ${fechaConAnio(m.conosceHasta)}` : ""}, en el departamento
              de la obra. Sólo empresas (RUC 20); lo que gana un consorcio se reparte en partes iguales entre sus integrantes (la participación de cada uno no
              se publica en estos datos).{sector ? " Con sector, sólo cuentan los procesos que citan un CUI de ese sector." : ""}
            </Nota>
          </section>

          <div className="flex flex-col items-start gap-4 rounded-3xl border border-granate/40 bg-granate-50 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="min-w-0">
              <p className="font-display text-bloque font-bold leading-tight text-ink">
                ¿Quieres que te avisemos de cada proyecto nuevo{sector ? ` de ${nombreSector(sector).toLocaleLowerCase("es-PE")}` : ""}
                {region ? ` en ${nombreRegion(region)}` : ""}?
              </p>
              <p className="mt-1 text-dato text-inkSoft">Cuando se declara viable, cuando aprueba su expediente técnico y cuando se licita: guarda la búsqueda como alerta, gratis cada semana.</p>
            </div>
            <Link
              href={`${ruta("/proyectos")}?pestana=todos${sector ? `&sector=${encodeURIComponent(sector)}` : ""}${region ? `&region=${region}` : ""}#crear-alerta`}
              className={claseAccion("primario", "min-h-11 shrink-0")}
            >
              <BellRing size={16} aria-hidden /> Recibir alertas
            </Link>
          </div>

          <Nota icono={<Landmark size={15} aria-hidden />}>
            Inversiones activas de Invierte.pe (MEF){m.alDia?.inversiones ? ` al ${fechaConAnio(m.alDia.inversiones)}` : ""}, su obra en INFOBRAS (Contraloría)
            {m.alDia?.infobras ? ` al ${fechaConAnio(m.alDia.infobras)}` : ""} y sus procesos en el SEACE. «Se vienen»: viables o con expediente técnico, sin obra
            en ejecución ni contrato de obra, declarados viables en los últimos 3 años o con presupuesto este año.
          </Nota>
        </div>
      )}
    </div>
  );
}

function RankingEmpresas({ Icono, titulo, filas }: { Icono: typeof Trophy; titulo: string; filas: Ranking[] }) {
  return (
    <section className="min-w-0 rounded-3xl border border-line bg-paper p-5 sm:p-6">
      <h3 className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
        <Icono size={18} aria-hidden className="text-granate" /> {titulo}
      </h3>
      {filas.length === 0 ? (
        <p className="mt-3 text-dato text-mute">Sin adjudicaciones a empresas con estos filtros.</p>
      ) : (
        <Barras
          className="mt-4"
          etiqueta={titulo}
          numerado
          filas={filas.map((e) => ({
            clave: e.ruc,
            etiqueta: nombreEmpresa(e.nombre),
            valor: e.monto,
            texto: solesCompacto(e.monto),
            detalle: `RUC ${e.ruc}, ${numero(e.procesos)} ${e.procesos === 1 ? "proceso" : "procesos"}${e.enConsorcio ? ` (${numero(e.enConsorcio)} en consorcio)` : ""}`,
            // Su historial completo (contratos, antecedentes) en Vigía.
            href: fichaEmpresaVigia(e.ruc) ?? undefined,
          }))}
        />
      )}
    </section>
  );
}
