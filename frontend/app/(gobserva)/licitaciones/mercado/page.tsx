import type { Metadata } from "next";
import { CLASE_PAGINA } from "@/components/gobserva/app/Caja";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BadgePercent, BellRing, Building2, ChartNoAxesCombined, ChevronDown, Handshake, Inbox, Landmark, Search, Target, Trophy, Users, type LucideIcon } from "lucide-react";
import { BarrasEnlace, SerieMeses, type FilaBarra } from "@/components/licitaciones/Graficas";
import { MontoCompacto } from "@/components/licitaciones/Piezas";
import { PersonajePregunta } from "@/components/pixel/Escena";
import { Beneficios } from "@/components/patrones/Franja";
import { Nota } from "@/components/patrones/Estructura";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA, claseAccion } from "@/components/ui/EnlaceAccion";
import { decimal, fechaCorta, numero, porcentaje, solesCompacto } from "@/lib/formato";
import { fichaEmpresaVigia, rutaEn, urlCanonica } from "@/lib/gobserva";
import { planesServidor } from "@/lib/gobserva-planes";
import { baseProducto, enLaApp } from "@/lib/gobserva-servidor";
import { tituloNatural } from "@/lib/landing";
import { RUBROS_EJEMPLO, getMercado, limpiar } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

export async function generateMetadata({ searchParams }: { searchParams?: { q?: string } }): Promise<Metadata> {
  const q = (searchParams?.q ?? "").trim().slice(0, 80);
  return {
    title: q ? `Mercado de «${q}» en el Estado` : "Inteligencia de mercado",
    description: q
      ? `Cuánto compra el Estado peruano de «${q}» en 12 meses, quién compra, quién gana y cuántos compiten.`
      : "Cuánto compra el Estado peruano de tu rubro en 12 meses, quién compra, quién gana y cuántos compiten.",
    alternates: { canonical: urlCanonica("licitaciones", q ? `/mercado?q=${encodeURIComponent(q)}` : "/mercado") },
  };
}

/** Los departamentos que se ven de entrada; el resto, plegado (con la misma escala). */
const DEPARTAMENTOS_A_LA_VISTA = 9;

/**
 * Inteligencia de mercado de un rubro (modo operar, 2026-11-02): las palabras en la descripción de lo adjudicado, 12 meses
 * de CONOSCE. Seis cifras (monto, entidades, postores, un solo postor, adjudicado frente al referencial y cuánto se llevan
 * las empresas), el monto por mes con su tabla, quién compra (enlaza a sus oportunidades), quién gana (sólo empresas), en
 * qué departamentos (todos) y las últimas adjudicaciones. GET /licitaciones/mercado (6 h en caché).
 */
export default async function Mercado({ searchParams }: { searchParams?: { q?: string } }) {
  const base = baseProducto("licitaciones");
  const enApp = enLaApp("licitaciones");
  const ruta = (p: string) => rutaEn(base, p);
  const q = (searchParams?.q ?? "").trim().slice(0, 80);
  const [m, cat] = await Promise.all([q.length >= 3 ? getMercado(q) : Promise.resolve(null), planesServidor("licitaciones")]);
  const unSolo = m?.conPostores ? m.unSoloPostor / m.conPostores : null;
  const empresas = m && m.monto ? m.montoEmpresas / m.monto : null;
  const mayorDepartamento = m ? Math.max(1, ...m.regiones.map((x) => x.procesos)) : 1;
  const departamentos: FilaBarra[] = (m?.regiones ?? []).map((x) => ({
    clave: x.nombre,
    etiqueta: tituloNatural(x.nombre),
    valor: x.procesos,
    detalle: `${solesCompacto(x.monto)} adjudicados`,
  }));

  return (
    <div className={enApp ? CLASE_PAGINA : "container-page py-8 sm:py-12"}>
      <header className="max-w-3xl">
        <h1 className="text-balance font-display text-cifra font-bold leading-tight tracking-tight text-ink sm:text-titulo">Inteligencia de mercado</h1>
        <p className="mt-1.5 text-pretty text-cuerpo leading-relaxed text-inkSoft">
          Escribe lo que vendes y mira cuánto le compró el Estado en los últimos 12 meses, quién compra, quién gana y cuántos compiten.
        </p>
      </header>

      <form method="get" action={ruta("/mercado")} role="search" className="mt-5 flex max-w-3xl gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Tu rubro</span>
          <Search size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Tu rubro: combustible, uniformes…"
            minLength={3}
            maxLength={80}
            enterKeyHint="search"
            className="h-12 w-full rounded-2xl border border-line bg-paper pl-11 pr-4 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30"
          />
        </label>
        <button type="submit" className={claseAccion("primario", "h-12 shrink-0 px-5")}>
          <ChartNoAxesCombined size={16} aria-hidden />
          <span className="sm:hidden">Ver</span>
          <span className="hidden sm:inline">Ver mi mercado</span>
        </button>
      </form>
      <ul
        className="-my-1 mt-2 flex gap-1.5 overflow-x-auto py-1 [mask-image:linear-gradient(to_right,black_88%,transparent)] [scrollbar-width:none] sm:mt-3 sm:flex-wrap sm:overflow-visible sm:[mask-image:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Rubros de ejemplo"
      >
        {RUBROS_EJEMPLO.map((x) => (
          <li key={x} className="shrink-0">
            <Link
              href={`${ruta("/mercado")}?q=${encodeURIComponent(x)}`}
              aria-current={x === q ? "true" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-3 text-meta font-medium transition-colors duration-rapido sm:min-h-8",
                x === q ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
              )}
            >
              {x}
            </Link>
          </li>
        ))}
      </ul>

      {!q ? (
        <section aria-labelledby="que-t" className="mt-10">
          <h2 id="que-t" className="font-display text-seccion font-bold leading-tight text-ink">
            Lo que vas a ver de tu rubro
          </h2>
          <Beneficios
            className="mt-4"
            items={[
              { icono: <ChartNoAxesCombined size={16} aria-hidden />, titulo: "El tamaño de tu mercado", texto: "Procesos y monto adjudicado mes a mes: cuándo compra el Estado lo que vendes." },
              { icono: <Building2 size={16} aria-hidden />, titulo: "Quién compra", texto: "Las entidades que más compran tu rubro, con un enlace a sus convocatorias abiertas." },
              { icono: <Trophy size={16} aria-hidden />, titulo: "Quién gana y cuántos compiten", texto: "Las empresas que más ganan, cuántos postores suele haber y cuántas veces hubo uno solo." },
            ]}
          />
        </section>
      ) : q.length < 3 ? (
        <Nota className="mt-8">Escribe al menos tres letras de lo que vendes.</Nota>
      ) : !m ? (
        <div role="alert" className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-line bg-paperSoft p-5 sm:flex-row sm:items-center sm:p-6">
          <PersonajePregunta nombre="emprendedora" escala={2} className="shrink-0" />
          <p className="min-w-0 flex-1 text-dato text-inkSoft">No pudimos calcular este mercado ahora. Suele ser momentáneo.</p>
          <Link href={`${ruta("/mercado")}?q=${encodeURIComponent(q)}`} className={cn(CLASE_ACCION_LISTA, "min-h-11")}>
            Volver a intentar
          </Link>
        </div>
      ) : m.procesos === 0 ? (
        <div className="mt-8 rounded-2xl border border-line bg-paperSoft p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <PersonajePregunta nombre="emprendedora" escala={2.5} className="shrink-0" />
            <div className="min-w-0">
              <p className="font-display text-bloque font-bold leading-tight text-ink">No hay adjudicaciones con «{q}» en los últimos 12 meses</p>
              <p className="mt-1 text-dato text-inkSoft">Prueba con una palabra más general (por ejemplo, «combustible» en vez de «diésel B5 S50»).</p>
              <Link href={`${ruta("/oportunidades")}?q=${encodeURIComponent(q)}&dias=60`} className={cn(CLASE_ACCION_LISTA, "mt-3 min-h-11")}>
                Ver si hay convocatorias de «{q}» abiertas
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          <section aria-labelledby="resumen-t">
            <h2 id="resumen-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink">
              El mercado de «{q}» en 12 meses
            </h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
              <Cifra
                Icono={ChartNoAxesCombined}
                etiqueta="Adjudicado"
                valor={<MontoCompacto valor={m.monto} unidad="text-cuerpo sm:text-bloque" />}
                contexto={`en ${numero(m.procesos)} ${m.procesos === 1 ? "proceso" : "procesos"}`}
              />
              <Cifra Icono={Building2} etiqueta="Entidades que compran" valor={numero(m.entidades)} contexto="compraron este rubro" />
              <Cifra Icono={Users} etiqueta="Postores por proceso" valor={m.postoresPromedio ? decimal(m.postoresPromedio) : "Sin dato"} contexto="en promedio" />
              <Cifra
                Icono={Target}
                etiqueta="Con un solo postor"
                valor={unSolo != null ? porcentaje(unSolo * 100) : "Sin dato"}
                contexto={m.conPostores ? `${numero(m.unSoloPostor)} de ${numero(m.conPostores)} procesos` : undefined}
                destacado={unSolo != null && unSolo >= 0.3}
              />
              <Cifra
                Icono={BadgePercent}
                etiqueta="Se adjudica al"
                valor={m.adjSobreRef ? porcentaje(m.adjSobreRef * 100) : "Sin dato"}
                contexto="del valor referencial, en promedio"
              />
              <Cifra
                Icono={Handshake}
                etiqueta="Lo ganan empresas"
                valor={empresas != null ? porcentaje(empresas * 100) : "Sin dato"}
                contexto="del monto (RUC 20); el resto, consorcios y personas naturales"
              />
            </dl>
          </section>

          <section aria-labelledby="serie-t" className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <h2 id="serie-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
              <ChartNoAxesCombined size={18} aria-hidden className="text-granate" /> Mes a mes
            </h2>
            <div className="mt-4">
              <SerieMeses serie={m.serie} etiqueta={`Monto adjudicado de «${q}» por mes`} />
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section aria-labelledby="compran-t" className="min-w-0 rounded-2xl border border-line bg-paper p-4 sm:p-5">
              <h2 id="compran-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                <Building2 size={18} aria-hidden className="text-granate" /> Quién compra
              </h2>
              <p className="mt-1 text-meta leading-snug text-inkSoft">
                {m.compradores.length === 1 ? "La entidad que más compró" : `Las ${numero(m.compradores.length)} entidades que más compraron`}. Toca una para ver
                sus convocatorias de los últimos 60 días.
              </p>
              <BarrasEnlace
                className="mt-4"
                etiqueta="Entidades que más compran"
                filas={m.compradores.map((c) => ({
                  clave: c.ruc,
                  etiqueta: c.nombre ? tituloNatural(c.nombre) : c.ruc,
                  valor: c.monto ?? 0,
                  texto: solesCompacto(c.monto ?? 0),
                  detalle: `${numero(c.procesos)} ${c.procesos === 1 ? "proceso" : "procesos"}`,
                  href: /^\d{11}$/.test(c.ruc) ? `${ruta("/oportunidades")}?entidad=${c.ruc}&dias=60` : undefined,
                }))}
              />
            </section>
            <section aria-labelledby="ganan-t" className="min-w-0 rounded-2xl border border-line bg-paper p-4 sm:p-5">
              <h2 id="ganan-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                <Trophy size={18} aria-hidden className="text-granate" /> Quién gana
              </h2>
              <p className="mt-1 text-meta leading-snug text-inkSoft">
                {m.ganadoresTop.length === 1 ? "La empresa (RUC 20) que más ganó" : `Las ${numero(m.ganadoresTop.length)} empresas (RUC 20) que más ganaron`}. Los
                consorcios y las personas naturales cuentan en el total, sin nombre.
              </p>
              <BarrasEnlace
                className="mt-4"
                etiqueta="Empresas que más ganan"
                filas={m.ganadoresTop.map((g) => ({
                  clave: g.ruc,
                  etiqueta: g.nombre ? tituloNatural(g.nombre) : g.ruc,
                  valor: g.monto ?? 0,
                  texto: solesCompacto(g.monto ?? 0),
                  detalle: `${numero(g.procesos)} ${g.procesos === 1 ? "proceso" : "procesos"}${m.monto ? `, ${porcentaje(((g.monto ?? 0) / m.monto) * 100)} del mercado` : ""}`,
                  // Su historial completo (contratos, antecedentes) en Vigía.
                  href: fichaEmpresaVigia(g.ruc) ?? undefined,
                }))}
              />
            </section>
          </div>

          <section aria-labelledby="regiones-t" className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <h2 id="regiones-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
              <Landmark size={18} aria-hidden className="text-granate" /> Dónde
            </h2>
            <p className="mt-1 text-meta leading-snug text-inkSoft">
              Procesos por departamento de la entidad que compra, de más a menos ({numero(departamentos.length)} {departamentos.length === 1 ? "departamento" : "departamentos"}).
            </p>
            <BarrasEnlace
              className="mt-4 grid gap-x-8 gap-y-1 space-y-0 md:grid-cols-2 xl:grid-cols-3"
              etiqueta="Procesos por departamento"
              mayor={mayorDepartamento}
              filas={departamentos.slice(0, DEPARTAMENTOS_A_LA_VISTA)}
            />
            {departamentos.length > DEPARTAMENTOS_A_LA_VISTA && (
              <details className="group/dep mt-2">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-meta font-semibold text-granate underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
                  <ChevronDown size={15} aria-hidden className="transition-transform duration-rapido group-open/dep:rotate-180" />
                  Ver los {numero(departamentos.length - DEPARTAMENTOS_A_LA_VISTA)} departamentos que faltan
                </summary>
                <BarrasEnlace
                  className="mt-2 grid gap-x-8 gap-y-1 space-y-0 md:grid-cols-2 xl:grid-cols-3"
                  etiqueta="Más departamentos"
                  mayor={mayorDepartamento}
                  filas={departamentos.slice(DEPARTAMENTOS_A_LA_VISTA)}
                />
              </details>
            )}
          </section>

          {m.recientes.length > 0 && (
            <section aria-labelledby="ultimas-t" className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
              <h2 id="ultimas-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                <Handshake size={18} aria-hidden className="text-granate" /> Las últimas adjudicaciones
              </h2>
              <p className="mt-1 text-meta leading-snug text-inkSoft">
                {m.recientes.length === 1 ? "La más reciente" : `Las ${numero(m.recientes.length)} más recientes`}, con quién ganó (el nombre, sólo si es una
                empresa).
              </p>
              <ul className="mt-3 divide-y divide-line">
                {m.recientes.map((x) => (
                  <li key={x.codigo} className="grid gap-x-6 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-dato font-medium leading-snug text-ink">{limpiar(x.item) || "Sin descripción"}</p>
                      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-meta text-inkSoft">
                        <Dato tipo="entidad">{x.entidad ? tituloNatural(x.entidad) : "Entidad sin nombre"}</Dato>
                        <Dato tipo="fecha">{fechaCorta(x.fecha)}</Dato>
                      </p>
                      <p className="mt-1 flex items-start gap-1.5 text-meta leading-snug">
                        <Trophy size={14} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                        {x.ganador ? (
                          <span className="min-w-0 text-inkSoft">
                            Ganó <span className="font-semibold text-ink">{tituloNatural(x.ganador)}</span>
                          </span>
                        ) : (
                          <span className="text-mute">Ganó un consorcio o una persona natural</span>
                        )}
                      </p>
                    </div>
                    {x.monto != null && (
                      <p className="flex items-baseline gap-2 sm:flex-col sm:items-end sm:gap-0 sm:text-right">
                        <span className="font-display text-bloque font-bold leading-tight tabular-nums text-ink">{solesCompacto(x.monto)}</span>
                        <span className="text-rotulo text-mute">adjudicado</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="alerta-t" className="grid gap-5 rounded-3xl border border-granate/30 bg-granate-50 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <h2 id="alerta-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink">
                ¿Quieres que te avisemos de cada convocatoria de «{q}»?
              </h2>
              <ul className="mt-3 space-y-2 text-dato leading-snug text-inkSoft">
                <li className="flex gap-2.5">
                  <BellRing size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                  <span>Guarda la búsqueda como alerta: gratis cada semana; con Pro, cada mañana.</span>
                </li>
                <li className="flex gap-2.5">
                  <Inbox size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                  <span>
                    {cat.correoActivo
                      ? "Te llega por correo y, si lo activas, como notificación en tu celular."
                      : "Te espera en tu cuenta y, si lo activas, como notificación en tu celular. Los correos salen en los próximos días."}
                  </span>
                </li>
              </ul>
            </div>
            <Link href={`${ruta("/oportunidades")}?q=${encodeURIComponent(q)}#crear-alerta`} className={claseAccion("primario", "shrink-0", "md")}>
              Crear la alerta <ArrowRight size={16} aria-hidden />
            </Link>
          </section>

          <Nota>
            Cómo se cuenta: se busca «{q}» en la descripción de cada ítem adjudicado y del proceso; un mismo proceso con varios ítems cuenta una vez. Fuente:
            CONOSCE (OECE), adjudicaciones con buena pro en los últimos 12 meses.
          </Nota>
        </div>
      )}
    </div>
  );
}

/** Una cifra del mercado: qué es (con su ícono), el número y su contexto debajo. */
function Cifra({ Icono, etiqueta, valor, contexto, destacado = false }: { Icono: LucideIcon; etiqueta: string; valor: ReactNode; contexto?: string; destacado?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-2xl border p-3.5 sm:p-4", destacado ? "border-granate/40 bg-granate-50" : "border-line bg-paper")}>
      <dt className="flex min-w-0 items-center gap-1.5 text-meta font-medium leading-snug text-inkSoft">
        <Icono size={15} aria-hidden className="shrink-0 text-granate" />
        <span className="min-w-0">{etiqueta}</span>
      </dt>
      <dd className="mt-2 font-display text-seccion font-bold leading-none tabular-nums text-ink sm:text-cifra">{valor}</dd>
      {contexto && <dd className="mt-1.5 text-meta leading-snug text-mute">{contexto}</dd>}
    </div>
  );
}
