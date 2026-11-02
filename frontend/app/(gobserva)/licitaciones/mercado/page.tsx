import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, ChartNoAxesCombined, Landmark, Search, Target, Trophy, Users } from "lucide-react";
import { BarrasEnlace, SerieMeses } from "@/components/licitaciones/Graficas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { decimal, fechaCorta, numero, porcentaje, solesCompacto } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { tituloNatural } from "@/lib/landing";
import { RUBROS_EJEMPLO, getMercado, limpiar } from "@/lib/licitaciones";

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

/**
 * Inteligencia de mercado de un rubro (palabras en la descripción de lo adjudicado): 12 meses de CONOSCE con el monto
 * por mes, quién compra (enlaza a sus oportunidades), quién gana (sólo empresas), cuántos compiten y en qué regiones.
 * GET /licitaciones/mercado (6 h en caché).
 */
export default async function Mercado({ searchParams }: { searchParams?: { q?: string } }) {
  const base = baseProducto("licitaciones");
  const ruta = (p: string) => rutaEn(base, p);
  const q = (searchParams?.q ?? "").trim().slice(0, 80);
  const m = q.length >= 3 ? await getMercado(q) : null;
  const unSolo = m?.conPostores ? m.unSoloPostor / m.conPostores : null;

  return (
    <div className="container-page py-10 sm:py-14">
      <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Inteligencia de mercado</h1>
      <p className="mt-2 max-w-[68ch] text-cuerpo leading-relaxed text-inkSoft">
        Escribe lo que vendes y mira cuánto le compró el Estado en los últimos 12 meses, quién compra, quién gana y cuántos compiten. Sale de
        las adjudicaciones de CONOSCE (OECE).
      </p>

      <form method="get" action={ruta("/mercado")} role="search" className="mt-6 flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Tu rubro</span>
          <Search size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Tu rubro: combustible, medicamentos, uniformes…"
            minLength={3}
            maxLength={80}
            className="h-12 w-full rounded-2xl border border-line bg-paper pl-11 pr-4 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30"
          />
        </label>
        <button type="submit" className={claseAccion("primario", "h-12")}>
          Ver mi mercado
        </button>
      </form>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Rubros de ejemplo">
        {RUBROS_EJEMPLO.map((x) => (
          <li key={x}>
            <Link
              href={`${ruta("/mercado")}?q=${encodeURIComponent(x)}`}
              aria-current={x === q ? "true" : undefined}
              className={
                x === q
                  ? "inline-flex min-h-8 items-center rounded-full border border-granate bg-granate px-3 text-meta font-medium text-paper"
                  : "inline-flex min-h-8 items-center rounded-full border border-line bg-paper px-3 text-meta font-medium text-inkSoft hover:border-granate/40 hover:text-ink"
              }
            >
              {x}
            </Link>
          </li>
        ))}
      </ul>

      {!q ? (
        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Explica Icono={ChartNoAxesCombined} titulo="El tamaño de tu mercado" texto="Procesos y monto adjudicado mes a mes: cuándo compra el Estado lo que vendes." />
          <Explica Icono={Building2} titulo="Quién compra" texto="Las entidades que más compran tu rubro, con un enlace a sus convocatorias abiertas." />
          <Explica Icono={Trophy} titulo="Quién gana y cuántos compiten" texto="Las empresas que más ganan, cuántos postores suele haber y cuántas veces hubo uno solo." />
        </div>
      ) : !m ? (
        <p className="mt-10 rounded-2xl border border-line bg-paperSoft p-6 text-dato text-inkSoft">
          {q.length < 3 ? "Escribe al menos tres letras." : "No pudimos calcular este mercado ahora. Vuelve a intentarlo en un momento."}
        </p>
      ) : m.procesos === 0 ? (
        <p className="mt-10 rounded-2xl border border-line bg-paperSoft p-6 text-dato text-inkSoft">
          No hay adjudicaciones con «{q}» en los últimos 12 meses. Prueba con una palabra más general (por ejemplo, «combustible» en vez de
          «diésel B5 S50»).
        </p>
      ) : (
        <div className="mt-10 space-y-10">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra Icono={ChartNoAxesCombined} valor={solesCompacto(m.monto)} etiqueta={`adjudicados en ${numero(m.procesos)} procesos (12 meses)`} />
            <Cifra Icono={Building2} valor={numero(m.entidades)} etiqueta={m.entidades === 1 ? "entidad compradora" : "entidades compradoras"} />
            <Cifra Icono={Users} valor={m.postoresPromedio ? decimal(m.postoresPromedio) : "Sin dato"} etiqueta="postores por proceso, en promedio" />
            <Cifra
              Icono={Target}
              valor={unSolo != null ? porcentaje(unSolo * 100) : "Sin dato"}
              etiqueta={`con un solo postor${m.conPostores ? ` (${numero(m.unSoloPostor)} de ${numero(m.conPostores)})` : ""}`}
              destacado={unSolo != null && unSolo >= 0.3}
            />
          </dl>
          {m.adjSobreRef ? (
            <p className="rounded-2xl border border-line bg-paperSoft px-4 py-3 text-dato text-inkSoft">
              En este rubro se adjudica, en promedio, al <b className="text-ink">{porcentaje(m.adjSobreRef * 100)}</b> del valor referencial
              {m.montoEmpresas ? <>, y las empresas (RUC 20) se llevan {porcentaje((m.montoEmpresas / m.monto) * 100)} del monto</> : null}.
            </p>
          ) : null}

          <section aria-labelledby="serie-t" className="rounded-2xl border border-line bg-paper p-5">
            <h2 id="serie-t" className="font-display text-bloque font-bold text-ink">
              Mes a mes
            </h2>
            <div className="mt-4">
              <SerieMeses serie={m.serie} etiqueta={`Monto adjudicado de «${q}» por mes`} />
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section aria-labelledby="compran-t" className="min-w-0 rounded-2xl border border-line bg-paper p-5">
              <h2 id="compran-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                <Building2 size={18} aria-hidden className="text-granate" /> Quién compra
              </h2>
              <p className="mt-1 text-meta text-mute">Toca una entidad para ver sus convocatorias de los últimos 60 días.</p>
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
            <section aria-labelledby="ganan-t" className="min-w-0 rounded-2xl border border-line bg-paper p-5">
              <h2 id="ganan-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                <Trophy size={18} aria-hidden className="text-granate" /> Quién gana
              </h2>
              <p className="mt-1 text-meta text-mute">Empresas (RUC 20). Los consorcios y las personas naturales cuentan en el total, sin nombre.</p>
              <BarrasEnlace
                className="mt-4"
                etiqueta="Empresas que más ganan"
                filas={m.ganadoresTop.map((g) => ({
                  clave: g.ruc,
                  etiqueta: g.nombre ? tituloNatural(g.nombre) : g.ruc,
                  valor: g.monto ?? 0,
                  texto: solesCompacto(g.monto ?? 0),
                  detalle: `${numero(g.procesos)} ${g.procesos === 1 ? "proceso" : "procesos"}${m.monto ? `, ${porcentaje(((g.monto ?? 0) / m.monto) * 100)} del mercado` : ""}`,
                }))}
              />
            </section>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <section aria-labelledby="regiones-t" className="min-w-0 rounded-2xl border border-line bg-paper p-5">
              <h2 id="regiones-t" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                <Landmark size={18} aria-hidden className="text-granate" /> Dónde
              </h2>
              <BarrasEnlace
                className="mt-4"
                etiqueta="Procesos por departamento"
                // recorte: los 12 departamentos con más procesos; el total está en las cifras de arriba (más departamentos en la API).
                filas={m.regiones.slice(0, 12).map((x) => ({ clave: x.nombre, etiqueta: tituloNatural(x.nombre), valor: x.procesos, detalle: solesCompacto(x.monto) }))}
              />
            </section>
            <section aria-labelledby="ultimas-t" className="min-w-0 rounded-2xl border border-line bg-paper p-5">
              <h2 id="ultimas-t" className="font-display text-bloque font-bold text-ink">
                Las últimas adjudicaciones
              </h2>
              <ul className="mt-3 divide-y divide-line">
                {m.recientes.map((x) => (
                  <li key={x.codigo} className="py-3">
                    <p className="line-clamp-2 text-dato font-medium leading-snug text-ink">{limpiar(x.item) || "Sin descripción"}</p>
                    <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-meta text-inkSoft">
                      <span>{x.entidad ? tituloNatural(x.entidad) : "Entidad sin nombre"}</span>
                      <span>{fechaCorta(x.fecha)}</span>
                      {x.monto != null && <span className="font-semibold text-ink">{solesCompacto(x.monto)}</span>}
                    </p>
                    <p className="mt-0.5 text-meta text-mute">Ganó: {x.ganador ? tituloNatural(x.ganador) : "un consorcio o una persona natural"}</p>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="flex flex-col items-start gap-4 rounded-3xl border border-granate/40 bg-granate-50 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="min-w-0">
              <p className="font-display text-bloque font-bold leading-tight text-ink">¿Quieres que te avisemos de cada convocatoria de «{q}»?</p>
              <p className="mt-1 text-dato text-inkSoft">Guarda la búsqueda como alerta y te llega cada convocatoria nueva a tu correo, gratis cada semana o cada mañana con Pro.</p>
            </div>
            <Link href={`${ruta("/oportunidades")}?q=${encodeURIComponent(q)}#crear-alerta`} className={claseAccion("primario", "shrink-0")}>
              Crear la alerta <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
          <p className="text-meta text-mute">
            Busca «{q}» en la descripción de cada ítem adjudicado y del proceso; un mismo proceso con varios ítems cuenta una vez. Fuente: CONOSCE
            (OECE), adjudicaciones con buena pro en los últimos 12 meses.
          </p>
        </div>
      )}
    </div>
  );
}

function Cifra({ Icono, valor, etiqueta, destacado = false }: { Icono: typeof Target; valor: string; etiqueta: string; destacado?: boolean }) {
  return (
    <div className={destacado ? "min-w-0 rounded-2xl border border-granate/40 bg-granate-50 p-4" : "min-w-0 rounded-2xl border border-line bg-paper p-4"}>
      <dt className="sr-only">{etiqueta}</dt>
      <dd>
        <Icono size={18} aria-hidden className="text-granate" />
        <span className="mt-2 block font-display text-cifra font-bold leading-none tabular-nums text-ink">{valor}</span>
        <span className="mt-1.5 block text-meta leading-snug text-inkSoft">{etiqueta}</span>
      </dd>
    </div>
  );
}

function Explica({ Icono, titulo, texto }: { Icono: typeof Target; titulo: string; texto: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-paper p-5">
      <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl bg-granate-50 text-granate">
        <Icono size={20} />
      </span>
      <h2 className="mt-4 font-display text-bloque font-bold leading-tight text-ink">{titulo}</h2>
      <p className="mt-2 text-dato leading-relaxed text-inkSoft">{texto}</p>
    </div>
  );
}
