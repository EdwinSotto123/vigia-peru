import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BellRing, Building2, ChartNoAxesCombined, Landmark, Search, Swords, Target, Users } from "lucide-react";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { Planes } from "@/components/gobserva/Planes";
import { Faq } from "@/components/licitaciones/Faq";
import { BarrasEnlace } from "@/components/licitaciones/Graficas";
import { planesLicitaciones } from "@/components/licitaciones/planes";
import { TarjetaOportunidad } from "@/components/licitaciones/TarjetaOportunidad";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { fechaCorta, numero, porcentaje, solesCompacto } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { RUBROS_EJEMPLO, getResumen, nombreRegion, nombreTipo } from "@/lib/licitaciones";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Licitaciones: las oportunidades para venderle al Estado, cada día" },
  description:
    "Todas las convocatorias del SEACE en un solo lugar, con lo que necesitas para ganarlas: quién compra, quién gana, a qué precio y cuántos compiten. Alertas por rubro y región.",
  alternates: { canonical: urlCanonica("licitaciones", "/") },
};

/**
 * Portada de Gobserva Licitaciones (2026-11-01): el héroe con el buscador y las cifras vivas del SEACE, las recién
 * convocadas, qué compra el Estado (por tipo y región, barras que filtran), cómo funciona, la competencia de los últimos
 * 12 meses, los planes, el MCP y las preguntas frecuentes. GET /licitaciones/resumen (10 min en caché).
 */
export default async function InicioLicitaciones() {
  const base = baseProducto("licitaciones");
  const r = await getResumen();
  const ruta = (p: string) => rutaEn(base, p);
  const comp = r?.competencia ?? {};
  const unSolo = comp.procesos ? (comp.unSoloPostor ?? 0) / comp.procesos : null;

  return (
    <>
      {/* ── Héroe ─────────────────────────────────────────────────────────────── */}
      <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper">
        <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-50" />
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-maiz/10 blur-3xl" />
        <div className="container-page relative grid gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center">
          <div className="min-w-0">
            <h1 className="text-balance font-display text-portada font-bold leading-[1.04] tracking-tight sm:text-cartel">
              Véndele al Estado. <span className="text-maiz">Las oportunidades de tu rubro, cada mañana.</span>
            </h1>
            <p className="mt-5 max-w-[58ch] text-pretty text-bloque leading-relaxed text-paper/75">
              Todas las convocatorias del SEACE en un solo lugar, con lo que necesitas para ganarlas: quién compra, quién gana, a qué
              precio y cuántos compiten.
            </p>
            <form method="get" action={ruta("/oportunidades")} role="search" className="mt-8 flex flex-col gap-2 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Qué vendes</span>
                <Search size={19} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/50" />
                <input
                  name="q"
                  placeholder="¿Qué vendes? combustible, uniformes, obras de saneamiento…"
                  maxLength={120}
                  className="h-14 w-full rounded-2xl border border-paper/20 bg-paper pl-12 pr-4 text-destacado text-ink placeholder:text-ink/45 focus:outline-none focus:ring-4 focus:ring-maiz/40"
                />
              </label>
              <button type="submit" className={claseAccion("oscuro", "h-14 px-7", "md")}>
                Buscar oportunidades <ArrowRight size={17} aria-hidden />
              </button>
            </form>
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Rubros de ejemplo">
              {RUBROS_EJEMPLO.slice(0, 6).map((x) => (
                <li key={x}>
                  <Link href={`${ruta("/oportunidades")}?q=${encodeURIComponent(x)}`} className="inline-flex min-h-9 items-center rounded-full border border-paper/20 px-3.5 text-meta font-medium text-paper/85 transition-colors duration-rapido hover:border-maiz/60 hover:bg-paper/10 hover:text-paper">
                    {x}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* El SEACE hoy: cifras vivas. */}
          <div className="min-w-0 rounded-3xl border border-paper/15 bg-paper/[0.06] p-5 backdrop-blur-sm sm:p-6">
            <p className="flex items-center gap-2 text-meta font-semibold text-maiz">
              <span aria-hidden className="relative inline-flex h-2.5 w-2.5">
                <span className="absolute inset-0 rounded-full bg-maiz opacity-60 motion-safe:animate-ping" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-maiz" />
              </span>
              El SEACE, al día
            </p>
            {r ? (
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">
                <Vivo valor={numero(r.delUltimoDia)} etiqueta={`convocatorias el ${r.ultimoDia ? fechaCorta(r.ultimoDia) : "último día"}`} />
                <Vivo valor={numero(r.semana)} etiqueta="en los últimos 7 días" />
                <Vivo valor={solesCompacto(r.valorEnJuego)} etiqueta={`en juego en 15 días (${numero(r.conValor)} con valor publicado)`} />
                <Vivo valor={numero(r.entidades)} etiqueta="entidades comprando en 15 días" />
              </dl>
            ) : (
              <p className="mt-4 text-dato text-paper/70">Las cifras no cargaron ahora. Vuelve en un momento.</p>
            )}
            <Link href={ruta("/oportunidades")} className="mt-6 inline-flex items-center gap-1 text-dato font-semibold text-maiz underline-offset-4 hover:underline">
              Ver todas las oportunidades <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      <div className="container-page space-y-20 py-14 sm:py-20">
        {/* ── Recién convocadas ───────────────────────────────────────────────── */}
        {r && r.recientes.length > 0 && (
          <section aria-labelledby="recientes-t">
            <Cabecera
              id="recientes-t"
              titulo="Recién convocadas"
              bajada="Las de los últimos días, de mayor valor primero. Cada una abre su ficha con los ítems, las bases y lo que se sabe de la entidad."
              accion={{ href: ruta("/oportunidades"), etiqueta: "Ver todas" }}
            />
            <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {r.recientes.map((o) => (
                <li key={o.ocid} className="min-w-0">
                  <TarjetaOportunidad o={o} base={base} compacta />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Qué compra el Estado ────────────────────────────────────────────── */}
        {r && (
          <section aria-labelledby="compra-t">
            <Cabecera id="compra-t" titulo="Qué está comprando el Estado" bajada={`Las ${numero(r.quince)} convocatorias de los últimos 15 días, por tipo y por región. Toca una barra para ver esas oportunidades.`} />
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="min-w-0 rounded-2xl border border-line bg-paper p-5">
                <h3 className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                  <ChartNoAxesCombined size={18} aria-hidden className="text-granate" /> Por tipo
                </h3>
                <BarrasEnlace
                  className="mt-4"
                  etiqueta="Convocatorias por tipo"
                  filas={r.porTipo.map((t) => ({
                    clave: t.clave,
                    etiqueta: nombreTipo(t.clave),
                    valor: t.n,
                    detalle: t.valor ? `${solesCompacto(t.valor)} de valor referencial publicado` : undefined,
                    href: ["bienes", "servicios", "obras", "consultoria"].includes(t.clave) ? `${ruta("/oportunidades")}?tipo=${t.clave}` : undefined,
                  }))}
                />
              </div>
              <div className="min-w-0 rounded-2xl border border-line bg-paper p-5">
                <h3 className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                  <Landmark size={18} aria-hidden className="text-granate" /> Por región
                </h3>
                <BarrasEnlace
                  className="mt-4"
                  etiqueta="Convocatorias por región"
                  // recorte: las 8 regiones con más convocatorias; todas están en el filtro de /oportunidades (ver todas).
                  filas={r.porRegion.slice(0, 8).map((x) => ({ clave: x.clave, etiqueta: nombreRegion(x.clave), valor: x.n, href: `${ruta("/oportunidades")}?region=${x.clave}` }))}
                />
                <Link href={ruta("/oportunidades")} className="mt-3 inline-flex text-meta font-semibold text-granate underline-offset-2 hover:underline">
                  Ver todas las regiones en el buscador
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* ── Cómo funciona ───────────────────────────────────────────────────── */}
        <section aria-labelledby="como-t">
          <Cabecera id="como-t" titulo="Cómo funciona" bajada="Tres pasos, sin entrar al SEACE cada mañana." />
          <ol className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Paso n={1} Icono={Target} titulo="Dinos qué vendes" texto="Tus rubros en tus palabras (combustible, señalización, consultoría de obras) y las regiones donde puedes atender." />
            <Paso n={2} Icono={BellRing} titulo="Cada mañana, tus oportunidades" texto="Las convocatorias nuevas que calzan contigo, en tu correo o tu WhatsApp, antes de que se venza el plazo de consultas." />
            <Paso n={3} Icono={Swords} titulo="Compite con datos" texto="Quién le vende a esa entidad, a qué precio se adjudica lo mismo en otras y cuántos postores suele haber." />
          </ol>
        </section>

        {/* ── Inteligencia ────────────────────────────────────────────────────── */}
        <section aria-labelledby="intel-t" className="rounded-3xl border border-line bg-paperSoft p-6 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center">
            <div className="min-w-0">
              <h2 id="intel-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
                Hay más espacio para competir del que crees
              </h2>
              <p className="mt-3 max-w-[56ch] text-cuerpo leading-relaxed text-inkSoft">
                En los últimos 12 meses, según CONOSCE (OECE). Con Gobserva ves estas cifras para tu rubro, para cada entidad y para cada
                convocatoria antes de ofertar.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href={ruta("/mercado")} className={claseAccion("primario")}>
                  Mira tu mercado <ArrowRight size={16} aria-hidden />
                </Link>
                <Link href={ruta("/planes")} className={claseAccion("secundario")}>
                  Ver planes
                </Link>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <Dato Icono={Users} valor={comp.postoresPromedio ? numero(Math.round(comp.postoresPromedio * 10) / 10) : "Sin dato"} etiqueta="postores por proceso, en promedio" />
              <Dato Icono={Target} valor={unSolo != null ? porcentaje(unSolo * 100) : "Sin dato"} etiqueta={`de los procesos tuvo un solo postor${comp.procesos ? ` (de ${numero(comp.procesos)})` : ""}`} destacado />
              <Dato Icono={Building2} valor={comp.adjudicado ? solesCompacto(comp.adjudicado) : "Sin dato"} etiqueta="adjudicados por el Estado en 12 meses" />
              <Dato Icono={ChartNoAxesCombined} valor={comp.adjSobreRef ? porcentaje(comp.adjSobreRef * 100) : "Sin dato"} etiqueta="del valor referencial es lo que se adjudica, en promedio" />
            </dl>
          </div>
        </section>

        {/* ── Planes ──────────────────────────────────────────────────────────── */}
        <section aria-labelledby="planes-t">
          <Cabecera
            id="planes-t"
            titulo="Planes"
            bajada="Durante la beta todo lo que ves en la web es gratis. Reserva tu plan con precio de fundador: no cobramos nada hasta que lo abramos y lo confirmes."
            accion={{ href: ruta("/planes"), etiqueta: "Comparar planes" }}
          />
          <Planes className="mt-6" planes={planesLicitaciones(base)} />
        </section>

        {/* ── MCP ─────────────────────────────────────────────────────────────── */}
        <BloqueMCP
          id="mcp"
          titulo="Pregúntale a tu IA por las licitaciones del día"
          bajada="Conecta Claude, ChatGPT o Cursor al servidor MCP de Gobserva y pregunta en tus palabras: tu asistente consulta las convocatorias y el mercado en vivo, con la fuente oficial de cada dato. Gratis durante la beta; el plan Empresa suma una API para tu CRM."
          ejemplos={[
            "¿Qué licitaciones de combustible se convocaron esta semana en Puno y Cusco?",
            "Dame las obras de saneamiento de más de S/ 5 millones convocadas en los últimos 15 días.",
            "¿Quién le gana más contratos de uniformes al Estado y a qué precio?",
          ]}
          herramientas={[
            { nombre: "buscar_licitaciones", descripcion: "Las convocatorias recientes del SEACE, con filtros por palabras, región, tipo y valor referencial." },
            { nombre: "mercado_rubro", descripcion: "El mercado de un rubro en 12 meses: procesos, monto adjudicado, quién compra, quién gana y cuántos compiten." },
          ]}
        />

        <Faq
          preguntas={[
            {
              p: "¿De dónde salen los datos?",
              r: (
                <>
                  De fuentes públicas del Estado: las convocatorias del SEACE (datos abiertos OCDS del OECE) y las adjudicaciones y postores
                  de CONOSCE. Cada ficha enlaza al proceso en el portal oficial.
                </>
              ),
            },
            { p: "¿Reemplaza al SEACE?", r: "No. Las ofertas se presentan en el SEACE, como siempre. Gobserva te avisa a tiempo y te da contexto para decidir; el cronograma oficial y las bases están en el SEACE y enlazamos cada proceso." },
            { p: "¿Es legal usar esta información?", r: "Sí. Son datos públicos que el Estado publica por ley (transparencia y datos abiertos). Gobserva los ordena y los cruza; no vende datos personales ni nombra a personas naturales." },
            { p: "¿Cuándo se presentan las ofertas?", r: "Lo dice el cronograma de cada proceso en el SEACE. Te mostramos la fecha de convocatoria y, cuando la entidad lo publica, el plazo de consultas y observaciones; la presentación de ofertas suele venir después." },
            { p: "¿Emiten factura?", r: "Sí: al abrir los planes de pago emitiremos factura electrónica. Ahora sólo reservas tu lugar, sin pagar." },
            { p: "¿Qué hacen con mis datos?", r: "Los usamos sólo para escribirte sobre Gobserva Licitaciones. Nunca los vendemos y puedes pedir que los borremos cuando quieras." },
          ]}
        />
      </div>
    </>
  );
}

function Vivo({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="mt-1.5 text-meta leading-snug text-paper/65">{etiqueta}</dt>
      <dd className="font-display text-cifra font-bold leading-none tabular-nums text-paper">{valor}</dd>
    </div>
  );
}

function Cabecera({ id, titulo, bajada, accion }: { id: string; titulo: string; bajada?: string; accion?: { href: string; etiqueta: string } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-3xl">
        <h2 id={id} className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
          {titulo}
        </h2>
        {bajada && <p className="mt-2 text-pretty text-cuerpo leading-relaxed text-inkSoft">{bajada}</p>}
      </div>
      {accion && (
        <Link href={accion.href} className="inline-flex shrink-0 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
          {accion.etiqueta} <ArrowRight size={15} aria-hidden />
        </Link>
      )}
    </div>
  );
}

function Paso({ n, Icono, titulo, texto }: { n: number; Icono: typeof Target; titulo: string; texto: string }) {
  return (
    <li className="relative min-w-0 rounded-2xl border border-line bg-paper p-5">
      <span aria-hidden className="absolute right-5 top-4 font-mono text-cifra font-bold text-granate/15">{n}</span>
      <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl bg-granate-50 text-granate">
        <Icono size={20} />
      </span>
      <h3 className="mt-4 font-display text-bloque font-bold leading-tight text-ink">
        <span className="sr-only">Paso {n}: </span>
        {titulo}
      </h3>
      <p className="mt-2 text-dato leading-relaxed text-inkSoft">{texto}</p>
    </li>
  );
}

function Dato({ Icono, valor, etiqueta, destacado = false }: { Icono: typeof Target; valor: string; etiqueta: string; destacado?: boolean }) {
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
