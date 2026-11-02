import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  ChartNoAxesCombined,
  CirclePause,
  ClipboardList,
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
import { Dato, iconoSector } from "@/components/gobserva-obras/Piezas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { fechaConAnio, numero, porcentaje, solesCompacto } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
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
    <div className="container-page py-10 sm:py-14">
      <nav aria-label="Ruta" className="text-meta text-mute">
        <Link href={ruta("/")} className="hover:text-granate hover:underline">
          Inicio
        </Link>
        <span aria-hidden className="mx-1.5">/</span>
        <span className="text-inkSoft">Mercado</span>
      </nav>
      <h1 className="mt-3 text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">{titulo(region, sector)}</h1>
      <p className="mt-2 max-w-[70ch] text-cuerpo leading-relaxed text-inkSoft">
        Cuánta plata hay en lo que se viene y en lo que está en ejecución, de qué tamaño son las obras, cuántas se paralizan y quién gana las
        licitaciones de obra y de supervisión. Elige una región y un sector.
      </p>

      <form method="get" action={ruta("/mercado")} className="mt-6 grid grid-cols-1 gap-2.5 rounded-2xl border border-line bg-paper p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:p-4" aria-label="Elegir región y sector">
        <label className="block">
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
        <label className="block">
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
        <div className="flex items-end">
          <button type="submit" className={claseAccion("primario", "h-11 w-full sm:w-auto")}>
            <SlidersHorizontal size={16} aria-hidden /> Ver el mercado
          </button>
        </div>
      </form>

      {!m ? (
        <p className="mt-10 rounded-2xl border border-line bg-paperSoft p-6 text-dato text-inkSoft">No pudimos calcular este mercado ahora. Vuelve a intentarlo en un momento.</p>
      ) : m.activas === 0 ? (
        <p className="mt-10 rounded-2xl border border-line bg-paperSoft p-6 text-dato text-inkSoft">No hay inversiones activas con esta región y este sector. Prueba con todo el Perú o con otro sector.</p>
      ) : (
        <div className="mt-10 space-y-12">
          {/* Las cifras */}
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
            <Dato Icono={Wallet} valor={solesCompacto(m.porEjecutar)} etiqueta="por ejecutar entre lo que se viene y lo que está en marcha" destacado />
            <Dato Icono={Sparkles} valor={numero(m.seVienen.n)} etiqueta={`proyectos se vienen, por ${solesCompacto(m.seVienen.monto)}`} detalle={`${numero(m.seVienen.conExpediente)} ya tienen expediente técnico o se licitan`} />
            <Dato Icono={HardHat} valor={numero(m.enMarcha.n)} etiqueta={`obras en marcha, por ${solesCompacto(m.enMarcha.monto)}`} detalle={`Les faltan ${solesCompacto(m.enMarcha.porEjecutar)}`} />
            <Dato
              Icono={CirclePause}
              valor={pctParalizadas != null ? porcentaje(pctParalizadas, { decimales: pctParalizadas < 10 ? 1 : 0 }) : "Sin dato"}
              etiqueta={`de las obras en marcha está paralizada (${numero(m.paralizadas.n)})`}
              detalle={`Con ${solesCompacto(m.paralizadas.porEjecutar)} sin ejecutar`}
            />
            <Dato Icono={Ruler} valor={solesCompacto(m.enMarcha.mediana)} etiqueta="cuesta la obra típica en marcha (la mediana)" detalle={`La que se viene: ${solesCompacto(m.seVienen.mediana)}`} />
            <Dato
              Icono={CalendarClock}
              valor={solesCompacto(m.pimAnio)}
              etiqueta={`de presupuesto de inversión ${anio} (PIM)`}
              detalle={pctAnio != null ? `Gastado: ${solesCompacto(m.devengadoAnio)} (${porcentaje(pctAnio)})` : undefined}
            />
          </dl>

          <div className="flex flex-wrap gap-2">
            <Link href={lista({})} className={claseAccion("primario")}>
              Ver los {numero(m.seVienen.n)} que se vienen <ArrowRight size={16} aria-hidden />
            </Link>
            <Link href={lista({ pestana: "en_marcha" })} className={claseAccion("secundario")}>
              Ver las obras en marcha
            </Link>
          </div>

          {/* Dónde */}
          <section aria-labelledby="zonas-t" className="rounded-3xl border border-line bg-paper p-5 sm:p-6">
            <h2 id="zonas-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
              <MapPin size={20} aria-hidden className="text-granate" /> {region ? `Por provincia de ${nombreRegion(region)}` : "Por región"}
            </h2>
            <p className="mt-1 text-meta text-inkSoft">{region ? "En soles, por la provincia que registra cada inversión." : "En soles. Toca una región para ver su mercado."}</p>
            <BarrasDobles
              className="mt-4"
              etiqueta={region ? "Monto por provincia" : "Monto por región"}
              serieA="Se vienen"
              serieB="En ejecución"
              columnas={zonas.length > 8 ? 2 : 1}
              filas={zonas.map((z) => ({
                clave: z.clave,
                etiqueta: region ? nombreLugar(z.clave) ?? "Varias provincias" : nombreRegion(z.clave),
                a: z.seVienenMonto,
                b: z.enMarchaMonto,
                detalle: `${numero(z.seVienen)} se vienen, ${numero(z.enMarcha)} en marcha${z.paralizadas ? `, ${numero(z.paralizadas)} paralizadas` : ""}`,
                href: region ? undefined : `${ruta("/mercado")}?${new URLSearchParams({ region: z.clave, ...(sector ? { sector } : {}) }).toString()}`,
              }))}
            />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Qué */}
            {!sector ? (
              <section aria-labelledby="sectores-t" className="min-w-0 rounded-3xl border border-line bg-paper p-5 sm:p-6">
                <h2 id="sectores-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                  <ChartNoAxesCombined size={20} aria-hidden className="text-granate" /> Por sector
                </h2>
                <p className="mt-1 text-meta text-inkSoft">En soles. Toca un sector para ver su mercado.</p>
                <BarrasDobles
                  className="mt-4"
                  etiqueta="Monto por sector"
                  serieA="Se vienen"
                  serieB="En ejecución"
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
              </section>
            ) : (
              <section aria-labelledby="sector-t" className="min-w-0 rounded-3xl border border-line bg-paper p-5 sm:p-6">
                <h2 id="sector-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                  <IconoSector size={20} aria-hidden className="text-granate" /> {nombreSector(sector)}
                </h2>
                <p className="mt-2 text-dato leading-relaxed text-inkSoft">
                  {numero(m.activas)} inversiones activas de {nombreSector(sector).toLocaleLowerCase("es-PE")}
                  {region ? ` en ${nombreRegion(region)}` : " en el Perú"}, por {solesCompacto(m.costo)} en total.{" "}
                  <Link href={`${ruta("/mercado")}${region ? `?region=${region}` : ""}`} className="font-semibold text-granate underline-offset-2 hover:underline">
                    Ver todos los sectores
                  </Link>
                </p>
              </section>
            )}

            {/* Tamaño */}
            <section aria-labelledby="tamanos-t" className="min-w-0 rounded-3xl border border-line bg-paper p-5 sm:p-6 lg:self-start">
              <h2 id="tamanos-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                <Ruler size={20} aria-hidden className="text-granate" /> De qué tamaño son
              </h2>
              <p className="mt-1 text-meta text-inkSoft">Cuántos proyectos hay en cada rango de costo.</p>
              <div className="mt-5">
                <Histograma
                  etiqueta="Proyectos por tamaño de obra"
                  serieA="Se vienen"
                  serieB="En marcha o paralizadas"
                  barras={m.tamanos.map((t) => ({ clave: t.rango, etiqueta: TAMANOS[t.rango] ?? t.rango, a: t.seVienen, b: t.enMarcha }))}
                />
              </div>
            </section>
          </div>

          {/* Quién gana */}
          <section aria-labelledby="quien-t">
            <h2 id="quien-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
              Quién gana las obras{region ? ` en ${nombreRegion(region)}` : ""}
            </h2>
            <p className="mt-2 max-w-[75ch] text-cuerpo leading-relaxed text-inkSoft">
              {m.adjudicadoObras && m.adjudicadoObras.procesos > 0 ? (
                <>
                  En los últimos 12 meses se adjudicaron <b className="text-ink">{numero(m.adjudicadoObras.procesos)}</b> obras por{" "}
                  <b className="text-ink">{solesCompacto(m.adjudicadoObras.monto)}</b>
                  {m.adjudicadoObras.mediana ? <>; la obra típica, por {solesCompacto(m.adjudicadoObras.mediana)}</> : null}. Las ganaron{" "}
                  {numero(m.adjudicadoObras.empresas)} empresas, solas o en consorcio.
                </>
              ) : (
                "No hay obras adjudicadas con estos filtros en los últimos 12 meses."
              )}
            </p>
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RankingEmpresas Icono={Trophy} titulo="Las que más obras ganan" filas={m.quienConstruye} />
              <RankingEmpresas Icono={ClipboardList} titulo="Las que más supervisiones y consultorías de obra ganan" filas={m.quienSupervisa} />
            </div>
            <p className="mt-3 text-meta text-mute">
              Fuente: adjudicaciones con buena pro de CONOSCE (OECE) en los últimos 12 meses{m.conosceHasta ? `, hasta el ${fechaConAnio(m.conosceHasta)}` : ""}, en el departamento
              de la obra. Sólo empresas (RUC 20); lo que gana un consorcio se reparte en partes iguales entre sus integrantes (la participación de cada uno no
              se publica en estos datos).{sector ? " Con sector, sólo cuentan los procesos que citan un CUI de ese sector." : ""}
            </p>
          </section>

          {/* Paralizadas */}
          {m.paralizadas.n > 0 && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <section aria-labelledby="causas-t" className="min-w-0 rounded-3xl border border-line bg-paper p-5 sm:p-6">
                <h2 id="causas-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                  <CirclePause size={20} aria-hidden className="text-crimsonTexto" /> Por qué se paralizan
                </h2>
                <p className="mt-1 text-meta text-inkSoft">La causa que registra la entidad en INFOBRAS, de las {numero(m.paralizadas.n)} paralizadas hoy.</p>
                <Barras
                  className="mt-4"
                  tono="alerta"
                  etiqueta="Obras paralizadas por causa"
                  // recorte: las 10 causas más frecuentes; el total está en el título de la sección (más causas en INFOBRAS).
                  filas={m.causales.slice(0, 10).map((c) => ({ clave: c.causal, etiqueta: c.causal, valor: c.n }))}
                />
              </section>
              <section aria-labelledby="mayores-t" className="min-w-0 rounded-3xl border border-line bg-paper p-5 sm:p-6">
                <h2 id="mayores-t" className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
                  <Hourglass size={20} aria-hidden className="text-granate" /> Las paralizadas más grandes
                </h2>
                <p className="mt-1 text-meta text-inkSoft">Muchas vuelven a licitarse como saldo de obra.</p>
                <ol className="mt-3 divide-y divide-line">
                  {m.mayoresParalizadas.map((p) => (
                    <li key={p.cui} className="py-3">
                      <Link href={ruta(`/proyecto/${p.cui}`)} className="line-clamp-2 text-dato font-semibold leading-snug text-ink hover:text-granate">
                        {nombreProyecto(p.nombre, p)}
                      </Link>
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-inkSoft">
                        <span className="font-semibold text-ink">{solesCompacto(p.costo)}</span>
                        <span>{[nombreLugar(p.provincia), p.region ? nombreRegion(p.region) : null].filter(Boolean).join(", ") || "Varias regiones"}</span>
                        {p.desde && <span>Paralizada desde el {fechaConAnio(p.desde)}</span>}
                        {p.fisico != null && <span>Avance {porcentaje(p.fisico)}</span>}
                      </p>
                    </li>
                  ))}
                </ol>
                <Link href={lista({ pestana: "paralizadas" })} className="mt-2 inline-flex items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
                  Ver las {numero(m.paralizadas.n)} paralizadas <ArrowRight size={15} aria-hidden />
                </Link>
              </section>
            </div>
          )}

          <div className="flex flex-col items-start gap-4 rounded-3xl border border-granate/40 bg-granate-50 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="min-w-0">
              <p className="font-display text-bloque font-bold leading-tight text-ink">
                ¿Quieres que te avisemos de cada proyecto nuevo{sector ? ` de ${nombreSector(sector).toLocaleLowerCase("es-PE")}` : ""}
                {region ? ` en ${nombreRegion(region)}` : ""}?
              </p>
              <p className="mt-1 text-dato text-inkSoft">Cuando se declara viable, cuando aprueba su expediente técnico y cuando se licita: guarda la búsqueda como alerta, gratis cada semana.</p>
            </div>
            <Link href={`${ruta("/proyectos")}?pestana=todos${sector ? `&sector=${encodeURIComponent(sector)}` : ""}${region ? `&region=${region}` : ""}#crear-alerta`} className={claseAccion("primario", "shrink-0")}>
              Recibir alertas <ArrowRight size={16} aria-hidden />
            </Link>
          </div>

          <p className="flex items-start gap-1.5 text-meta text-mute">
            <Landmark size={14} aria-hidden className="mt-0.5 shrink-0" />
            <span>
              Inversiones activas de Invierte.pe (MEF){m.alDia?.inversiones ? ` al ${fechaConAnio(m.alDia.inversiones)}` : ""}, su obra en INFOBRAS (Contraloría)
              {m.alDia?.infobras ? ` al ${fechaConAnio(m.alDia.infobras)}` : ""} y sus procesos en el SEACE. «Se vienen»: viables o con expediente técnico, sin obra
              en ejecución ni contrato de obra, declarados viables en los últimos 3 años o con presupuesto este año.
            </span>
          </p>
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
          filas={filas.map((e) => ({
            clave: e.ruc,
            etiqueta: nombreEmpresa(e.nombre),
            valor: e.monto,
            texto: solesCompacto(e.monto),
            detalle: `RUC ${e.ruc}, ${numero(e.procesos)} ${e.procesos === 1 ? "proceso" : "procesos"}${e.enConsorcio ? ` (${numero(e.enConsorcio)} en consorcio)` : ""}`,
          }))}
        />
      )}
    </section>
  );
}
