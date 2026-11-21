import type { Metadata } from "next";
import { CLASE_PAGINA } from "@/components/gobserva/app/Caja";
import Link from "next/link";
import { Suspense } from "react";
import { BellRing, Building2, ChevronLeft, ChevronRight, CircleDollarSign, Inbox, MessageSquareWarning, RotateCcw, X } from "lucide-react";
import { AccionesBusqueda } from "@/components/gobserva/cuenta/AccionesBusqueda";
import { FiltrosOportunidades, type ValoresFiltro } from "@/components/licitaciones/Filtros";
import { FilaOportunidad } from "@/components/licitaciones/TarjetaOportunidad";
import { PersonajePregunta } from "@/components/pixel/Escena";
import { Nota } from "@/components/patrones/Estructura";
import { CLASE_ACCION_LISTA, claseAccion } from "@/components/ui/EnlaceAccion";
import { paginasVisibles } from "@/lib/paginas";
import { numero, soles, solesCompacto } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { planesServidor } from "@/lib/gobserva-planes";
import { baseProducto, enLaApp } from "@/lib/gobserva-servidor";
import { tituloNatural } from "@/lib/landing";
import { TIPOS, getOportunidades, nombreRegion, nombreTipo } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Oportunidades",
  description: "Las convocatorias del SEACE de los últimos días, con filtros por rubro, región, tipo y valor referencial.",
  alternates: { canonical: urlCanonica("licitaciones", "/oportunidades") },
};

type Params = Record<string, string | string[] | undefined>;
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const CLAVES = ["q", "region", "tipo", "dias", "orden", "min", "max", "entidad", "consultas", "page"] as const;
/** La API sirve hasta la página 50 (de 20 en 20): las primeras 1,000 de una búsqueda. */
const PAGINAS_MAX = 50;

const PAGINA_BASE =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border text-meta font-semibold tabular-nums transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate sm:min-h-9 sm:min-w-9";

/**
 * Las oportunidades (modo operar, 2026-11-02): los filtros en la URL (un formulario GET que en el celular se pliega), los
 * filtros puestos como chips que se quitan, los conteos por tipo y región (enlaces que suman ese filtro), la cabecera de
 * resultados con su orden y las acciones de la búsqueda (alerta, Excel), y la lista en filas con el valor y el plazo de
 * consultas alineados. Paginación numerada que vuelve al inicio de la lista. GET /licitaciones/oportunidades.
 */
export default async function Oportunidades({ searchParams }: { searchParams?: Params }) {
  const base = baseProducto("licitaciones");
  const enApp = enLaApp("licitaciones");
  const v: ValoresFiltro & { page?: string } = {};
  for (const k of CLAVES) v[k] = uno(searchParams?.[k]);
  // Sólo lo que vale: un filtro vacío o mal escrito no viaja (la API respondería 400).
  const api = new URLSearchParams();
  if (v.q) api.set("q", v.q.slice(0, 120));
  if (v.region && /^\d{2}$/.test(v.region)) api.set("region", v.region);
  if (v.tipo && TIPOS.some((t) => t.clave === v.tipo)) api.set("tipo", v.tipo);
  if (v.dias && ["7", "15", "30", "60"].includes(v.dias)) api.set("dias", v.dias);
  if (v.orden === "valor" || v.orden === "consultas") api.set("orden", v.orden);
  if (v.consultas === "abiertas" || v.consultas === "semana") api.set("consultas", v.consultas);
  const cifra = (x?: string) => (x ? Number(x.replace(/[^\d.]/g, "")) : NaN);
  if (Number.isFinite(cifra(v.min)) && cifra(v.min) > 0) api.set("min", String(cifra(v.min)));
  if (Number.isFinite(cifra(v.max)) && cifra(v.max) > 0) api.set("max", String(cifra(v.max)));
  if (v.entidad && /^\d{11}$/.test(v.entidad)) api.set("entidad", v.entidad);
  const pagina = Math.min(PAGINAS_MAX, Math.max(1, Number(v.page) || 1));
  if (pagina > 1) api.set("page", String(pagina));
  const [d, cat] = await Promise.all([getOportunidades(api), planesServidor("licitaciones")]);

  const lista = rutaEn(base, "/oportunidades");
  /** La búsqueda de ahora con algunos cambios (null quita ese filtro); vuelve siempre a la página 1. */
  const enlace = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(api);
    p.delete("page");
    for (const [k, x] of Object.entries(cambios)) {
      if (x == null) p.delete(k);
      else p.set(k, x);
    }
    const s = p.toString();
    return `${lista}${s ? `?${s}` : ""}`;
  };
  /** Otra página de la misma búsqueda, con el ancla que lleva al inicio de la lista (no al pie, donde está el paginador). */
  const enlacePagina = (n: number) => {
    const p = new URLSearchParams(api);
    if (n > 1) p.set("page", String(n));
    else p.delete("page");
    const s = p.toString();
    return `${lista}${s ? `?${s}` : ""}#resultados`;
  };

  const dias = Number(api.get("dias") ?? 15);
  const tipo = api.get("tipo");
  const region = api.get("region");
  const orden = api.get("orden") === "valor" ? "valor" : api.get("orden") === "consultas" ? "consultas" : "reciente";
  const consultas = api.get("consultas");
  const ultima = d ? Math.min(PAGINAS_MAX, Math.max(1, Math.ceil(d.total / d.size))) : 1;
  const entidadNombre = v.entidad ? d?.data.find((o) => o.entidadRuc === v.entidad)?.entidad : undefined;
  const conRango = !!(api.get("min") || api.get("max"));

  // Los filtros puestos, cada uno con el enlace que lo quita.
  const activos = [
    api.get("q") ? { clave: "q", texto: `«${api.get("q")}»`, href: enlace({ q: null }) } : null,
    region ? { clave: "region", texto: nombreRegion(region), href: enlace({ region: null }) } : null,
    tipo ? { clave: "tipo", texto: nombreTipo(tipo), href: enlace({ tipo: null }) } : null,
    dias !== 15 ? { clave: "dias", texto: `Últimos ${numero(dias)} días`, href: enlace({ dias: null }) } : null,
    api.get("min") ? { clave: "min", texto: `Desde ${soles(Number(api.get("min")))}`, href: enlace({ min: null }) } : null,
    api.get("max") ? { clave: "max", texto: `Hasta ${soles(Number(api.get("max")))}`, href: enlace({ max: null }) } : null,
    api.get("entidad") ? { clave: "entidad", texto: entidadNombre ? tituloNatural(entidadNombre) : "Una entidad", href: enlace({ entidad: null }) } : null,
    consultas ? { clave: "consultas", texto: consultas === "semana" ? "Consultas vencen esta semana" : "Consultas abiertas", href: enlace({ consultas: null }) } : null,
  ].filter((x): x is { clave: string; texto: string; href: string } => !!x);

  // Lo que se puede probar cuando no hay ninguna.
  const sugerencias = [
    api.get("q") ? { texto: `Sin «${api.get("q")}»`, href: enlace({ q: null }) } : null,
    region ? { texto: "En todo el Perú", href: enlace({ region: null }) } : null,
    tipo ? { texto: "De todos los tipos", href: enlace({ tipo: null }) } : null,
    conRango ? { texto: "Sin rango de valor", href: enlace({ min: null, max: null }) } : null,
    dias < 60 ? { texto: "Los últimos 60 días", href: enlace({ dias: "60" }) } : null,
    api.get("entidad") ? { texto: "De todas las entidades", href: enlace({ entidad: null }) } : null,
    consultas ? { texto: "Con o sin plazo de consultas", href: enlace({ consultas: null }) } : null,
  ].filter((x): x is { texto: string; href: string } => !!x);

  const conteos = d
    ? {
        region: Object.fromEntries(d.porRegion.map((x) => [x.clave, x.n])),
        tipo: Object.fromEntries(d.porTipo.map((x) => [x.clave, x.n])),
      }
    : undefined;
  const desde = d && d.total ? (pagina - 1) * d.size + 1 : 0;
  const hasta = d ? Math.min(d.total, pagina * d.size) : 0;

  return (
    <div className={enApp ? CLASE_PAGINA : "container-page py-8 sm:py-12"}>
      <header className="max-w-3xl">
        <h1 className="font-display text-cifra font-bold leading-tight tracking-tight text-ink sm:text-titulo">Oportunidades</h1>
        <p className="mt-1.5 text-pretty text-cuerpo leading-relaxed text-inkSoft">
          Las convocatorias del SEACE de los últimos {numero(dias)} días que siguen en convocatoria
          {tipo ? `, de ${nombreTipo(tipo).toLocaleLowerCase("es-PE")}` : ""}
          {region ? ` en ${nombreRegion(region)}` : ""}
          {entidadNombre ? `, de ${tituloNatural(entidadNombre)}` : v.entidad ? ", de la entidad elegida" : ""}, con su valor referencial y su plazo de
          consultas.
        </p>
      </header>

      <FiltrosOportunidades base={base} v={v} conteos={conteos} className="mt-5" />

      {activos.length > 0 && (
        <div role="group" aria-label="Filtros puestos" className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-meta font-semibold text-mute">Filtros:</span>
          {activos.map((a) => (
            <Link
              key={a.clave}
              href={a.href}
              aria-label={`Quitar el filtro ${a.texto}`}
              className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-granate/40 bg-granate-50 pl-3 pr-2 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate sm:min-h-9"
            >
              <span className="min-w-0 truncate">{a.texto}</span>
              <X size={14} aria-hidden className="shrink-0 text-granate" />
            </Link>
          ))}
          {activos.length > 1 && (
            <Link href={lista} className="inline-flex min-h-11 items-center px-2 text-meta font-semibold text-granate underline-offset-2 hover:underline sm:min-h-9">
              Quitar todos
            </Link>
          )}
        </div>
      )}

      {d && (
        <div className="mt-4 space-y-2">
          <Facetas
            etiqueta="Por tipo"
            items={d.porTipo
              .filter((t) => TIPOS.some((x) => x.clave === t.clave))
              .map((t) => ({ clave: t.clave, texto: nombreTipo(t.clave), n: t.n, href: enlace({ tipo: tipo === t.clave ? null : t.clave }), activo: tipo === t.clave }))}
          />
          <Facetas
            etiqueta="Por región"
            items={d.porRegion.map((x) => ({
              clave: x.clave,
              texto: nombreRegion(x.clave),
              n: x.n,
              href: enlace({ region: region === x.clave ? null : x.clave }),
              activo: region === x.clave,
            }))}
          />
        </div>
      )}

      {/* Lo que se hace con esta búsqueda: guardarla como alerta y bajarla en Excel (también si la lista no cargó). */}
      <div id="crear-alerta" className="mt-4 scroll-mt-24">
        <Suspense fallback={null}>
          <AccionesBusqueda producto="licitaciones" base={base} variante="barra" resumen={false} />
        </Suspense>
      </div>

      {!d ? (
        <div role="alert" className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-line bg-paperSoft p-5 sm:flex-row sm:items-center sm:p-6">
          <PersonajePregunta nombre="emprendedora" escala={2} className="shrink-0" />
          <p className="min-w-0 flex-1 text-dato text-inkSoft">No pudimos leer las convocatorias ahora. Suele ser momentáneo.</p>
          <Link href={enlace({})} className={cn(CLASE_ACCION_LISTA, "min-h-11")}>
            <RotateCcw size={15} aria-hidden className="mr-1.5" /> Volver a intentar
          </Link>
        </div>
      ) : (
        <section id="resultados" aria-labelledby="resultados-t" className="mt-6 scroll-mt-24 border-t border-line pt-6">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h2 id="resultados-t" className="font-display text-seccion font-bold leading-tight text-ink">
                {numero(d.total)} {d.total === 1 ? "oportunidad" : "oportunidades"}
              </h2>
              <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-meta text-inkSoft">
                <div>
                  <dt className="sr-only">Entidades que compran</dt>
                  <dd className="inline-flex items-center gap-1.5">
                    <Building2 size={14} aria-hidden className="shrink-0 text-mute" />
                    {numero(d.resumen.entidades)} {d.resumen.entidades === 1 ? "entidad compra" : "entidades compran"}
                  </dd>
                </div>
                <div>
                  <dt className="sr-only">Valor referencial publicado</dt>
                  <dd className="inline-flex items-center gap-1.5">
                    <CircleDollarSign size={14} aria-hidden className="shrink-0 text-mute" />
                    {d.resumen.conValor > 0
                      ? `${solesCompacto(d.resumen.valorTotal)} en valor referencial (${numero(d.resumen.conValor)} lo publicaron)`
                      : "Ninguna publicó su valor referencial"}
                  </dd>
                </div>
              </dl>
            </div>
            <nav aria-label="Ordenar las oportunidades" className="flex items-center gap-2">
              <span className="hidden text-meta text-mute sm:inline">Ordenar</span>
              <span className="inline-flex rounded-full border border-line bg-paper p-0.5">
                {(
                  [
                    { clave: "reciente", texto: "Más recientes", href: `${enlace({ orden: null })}#resultados` },
                    { clave: "valor", texto: "Mayor valor", href: `${enlace({ orden: "valor" })}#resultados` },
                    // Las que vencen antes arriba (sólo las que todavía tienen consultas abiertas; las demás, al final).
                    { clave: "consultas", texto: "Por vencer", href: `${enlace({ orden: "consultas" })}#resultados` },
                  ] as const
                ).map((o) => (
                  <Link
                    key={o.clave}
                    href={o.href}
                    aria-current={orden === o.clave ? "true" : undefined}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-full px-3.5 text-meta font-semibold transition-colors duration-rapido sm:min-h-8",
                      orden === o.clave ? "bg-granate text-paper" : "text-inkSoft hover:bg-paperDeep hover:text-ink",
                    )}
                  >
                    {o.texto}
                  </Link>
                ))}
              </span>
            </nav>
          </div>

          {conRango && (
            <Nota className="mt-4">Con un rango de valor sólo salen las convocatorias que publicaron su valor referencial: casi ninguna de bienes lo hace.</Nota>
          )}

          {d.data.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-line bg-paperSoft p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <PersonajePregunta nombre="emprendedora" escala={2.5} className="shrink-0" />
                <div className="min-w-0">
                  <p className="font-display text-bloque font-bold leading-tight text-ink">Ninguna convocatoria con estos filtros</p>
                  {sugerencias.length > 0 && (
                    <>
                      <p className="mt-1 text-dato text-inkSoft">Prueba con alguno de estos cambios:</p>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {sugerencias.map((s) => (
                          <li key={s.texto}>
                            <Link href={s.href} className={cn(CLASE_ACCION_LISTA, "min-h-11")}>
                              {s.texto}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p className="mt-4 flex items-start gap-2 text-dato text-inkSoft">
                    <BellRing size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                    <span>
                      O deja esta búsqueda como alerta y te avisamos cuando salga una:{" "}
                      <a href="#crear-alerta" className="font-semibold text-granate underline-offset-2 hover:underline">
                        crear la alerta
                      </a>
                      .
                    </span>
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <ol className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
              {d.data.map((o) => (
                <li key={o.ocid} className="min-w-0">
                  <FilaOportunidad o={o} base={base} />
                </li>
              ))}
            </ol>
          )}

          {d.total > 0 && (
            <nav aria-label="Páginas de oportunidades" className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <p className="text-meta text-inkSoft">
                Mostrando{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {numero(desde)} a {numero(hasta)}
                </span>{" "}
                de <span className="font-semibold tabular-nums text-ink">{numero(d.total)}</span>
              </p>
              {ultima > 1 && (
                <ul className="flex flex-wrap items-center gap-1.5">
                  <li>
                    {pagina > 1 ? (
                      <Link href={enlacePagina(pagina - 1)} aria-label="Página anterior" className={cn(PAGINA_BASE, "border-line bg-paper text-ink hover:bg-paperDeep")}>
                        <ChevronLeft size={15} aria-hidden />
                      </Link>
                    ) : (
                      <span aria-hidden className={cn(PAGINA_BASE, "border-line bg-paper text-mute opacity-40")}>
                        <ChevronLeft size={15} />
                      </span>
                    )}
                  </li>
                  {paginasVisibles(pagina, ultima).map((n, i) =>
                    n === null ? (
                      <li key={`salto-${i}`} aria-hidden className="px-1 text-mute">
                        …
                      </li>
                    ) : (
                      <li key={n}>
                        <Link
                          href={enlacePagina(n)}
                          aria-label={`Página ${n}`}
                          aria-current={n === pagina ? "page" : undefined}
                          className={cn(PAGINA_BASE, n === pagina ? "border-granate bg-granate text-paper" : "border-line bg-paper text-ink hover:bg-paperDeep")}
                        >
                          {numero(n)}
                        </Link>
                      </li>
                    ),
                  )}
                  <li>
                    {pagina < ultima ? (
                      <Link href={enlacePagina(pagina + 1)} aria-label="Página siguiente" className={cn(PAGINA_BASE, "border-line bg-paper text-ink hover:bg-paperDeep")}>
                        <ChevronRight size={15} aria-hidden />
                      </Link>
                    ) : (
                      <span aria-hidden className={cn(PAGINA_BASE, "border-line bg-paper text-mute opacity-40")}>
                        <ChevronRight size={15} />
                      </span>
                    )}
                  </li>
                </ul>
              )}
            </nav>
          )}
          {d.total > PAGINAS_MAX * d.size && (
            <Nota className="mt-4">
              Se pueden recorrer las primeras {numero(PAGINAS_MAX * d.size)} de {numero(d.total)}. Para llegar a las demás, afina la búsqueda: una región, un
              tipo o las palabras de lo que vendes.
            </Nota>
          )}
          <Nota className="mt-4">
            El plazo de consultas sale de los datos abiertos del OECE cuando la entidad lo publica; la fecha para presentar ofertas está en el cronograma de cada
            proceso en el SEACE (cada ficha enlaza al portal oficial).
          </Nota>
        </section>
      )}

      {/* Dentro de la app no va: el plan y las alertas están en la barra lateral. */}
      {!enApp && (
      <section aria-labelledby="alerta-t" className="mt-12 grid gap-6 rounded-3xl border border-granate/30 bg-granate-50 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <h2 id="alerta-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink">
            Que estas oportunidades te lleguen solas
          </h2>
          <ul className="mt-3 space-y-2 text-dato leading-snug text-inkSoft">
            <li className="flex gap-2.5">
              <BellRing size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
              <span>Lo nuevo de esta búsqueda: gratis cada semana; con Pro, cada mañana.</span>
            </li>
            <li className="flex gap-2.5">
              <MessageSquareWarning size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
              <span>Cada convocatoria con su plazo de consultas y lo que sabemos de la entidad que compra.</span>
            </li>
            <li className="flex gap-2.5">
              <Inbox size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
              <span>
                {cat.correoActivo
                  ? "Por correo y, si lo activas, como notificación en tu celular."
                  : "En tu cuenta y, si lo activas, como notificación en tu celular. Los correos salen en los próximos días."}
              </span>
            </li>
          </ul>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <a href="#crear-alerta" className={claseAccion("primario", "", "md")}>
            <BellRing size={16} aria-hidden /> Crear alerta con esta búsqueda
          </a>
          <Link href={rutaEn(base, "/planes")} className={claseAccion("secundario", "", "md")}>
            Ver los planes
          </Link>
        </div>
      </section>
      )}
    </div>
  );
}

/**
 * Los conteos de una dimensión como chips que suman (o quitan) ese filtro, todos (nada recortado): en el celular, en una
 * sola fila que se desliza; desde sm, en varias filas.
 */
function Facetas({ etiqueta, items }: { etiqueta: string; items: { clave: string; texto: string; n: number; href: string; activo: boolean }[] }) {
  if (!items.length) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 sm:items-start">
      <span className="w-20 shrink-0 text-meta font-semibold text-mute sm:pt-1.5">{etiqueta}</span>
      <ul className="-my-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1 [mask-image:linear-gradient(to_right,black_88%,transparent)] [scrollbar-width:none] sm:my-0 sm:flex-wrap sm:overflow-visible sm:py-0 sm:[mask-image:none] [&::-webkit-scrollbar]:hidden">
        {items.map((i) => (
          <li key={i.clave} className="shrink-0">
            <Link
              href={i.href}
              aria-current={i.activo ? "true" : undefined}
              aria-label={`${i.texto}: ${numero(i.n)} ${i.n === 1 ? "oportunidad" : "oportunidades"}${i.activo ? " (filtro puesto: toca para quitarlo)" : ""}`}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-meta font-medium transition-colors duration-rapido sm:min-h-8",
                i.activo ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
              )}
            >
              {i.texto}
              <span className={cn("tabular-nums", i.activo ? "text-paper/80" : "text-mute")}>{numero(i.n)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
