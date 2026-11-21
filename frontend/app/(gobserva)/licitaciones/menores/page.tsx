import type { Metadata } from "next";
import { CLASE_PAGINA } from "@/components/gobserva/app/Caja";
import Link from "next/link";
import { BellRing, Building2, ChevronLeft, ChevronRight, Clock, FileText, RotateCcw, Search, Sparkles, X } from "lucide-react";
import { FilaMenor } from "@/components/licitaciones/FilaMenor";
import { PersonajePregunta } from "@/components/pixel/Escena";
import { Nota } from "@/components/patrones/Estructura";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA, claseAccion } from "@/components/ui/EnlaceAccion";
import { paginasVisibles } from "@/lib/paginas";
import { numero } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto, enLaApp } from "@/lib/gobserva-servidor";
import { REGIONES_UBIGEO, TIPOS, getMenores, nombreRegion, nombreTipo } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Contratos menores abiertos",
  description: "Las contrataciones de hasta 8 UIT que todavía se pueden cotizar en el SEACE, con su cierre, sus ítems y su requerimiento.",
  alternates: { canonical: urlCanonica("licitaciones", "/menores") },
};

type Params = Record<string, string | string[] | undefined>;
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const CLAVES = ["q", "region", "tipo", "cuando", "orden", "page"] as const;
const PAGINAS_MAX = 100;

const PAGINA_BASE =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border text-meta font-semibold tabular-nums transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate sm:min-h-9 sm:min-w-9";
const CAMPO =
  "h-11 w-full rounded-xl border border-line bg-paper px-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/20";

/**
 * Contrataciones menores abiertas (≤8 UIT) de Gobserva Licitaciones (2026-11-07): lo que todavía se puede cotizar en el
 * SEACE (prod6), con cuándo cierra cada una. Se actualiza cada hora. Filtros en la URL (texto, región, tipo, «cierran
 * hoy», «nuevas»), los conteos por tipo y región como chips que suman el filtro, el orden (las que cierran antes o las
 * más recientes) y la paginación. GET /licitaciones/menores.
 */
export default async function ContratosMenores({ searchParams }: { searchParams?: Params }) {
  const base = baseProducto("licitaciones");
  const enApp = enLaApp("licitaciones");
  const v: Partial<Record<(typeof CLAVES)[number], string>> = {};
  for (const k of CLAVES) v[k] = uno(searchParams?.[k]);
  const api = new URLSearchParams();
  if (v.q) api.set("q", v.q.slice(0, 120));
  if (v.region && /^\d{2}$/.test(v.region)) api.set("region", v.region);
  if (v.tipo && TIPOS.some((t) => t.clave === v.tipo)) api.set("tipo", v.tipo);
  if (v.cuando === "hoy" || v.cuando === "nuevas") api.set("cuando", v.cuando);
  if (v.orden === "reciente") api.set("orden", "reciente");
  const pagina = Math.min(PAGINAS_MAX, Math.max(1, Number(v.page) || 1));
  if (pagina > 1) api.set("page", String(pagina));
  const d = await getMenores(api);

  const lista = rutaEn(base, "/menores");
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
  const enlacePagina = (n: number) => {
    const p = new URLSearchParams(api);
    if (n > 1) p.set("page", String(n));
    else p.delete("page");
    const s = p.toString();
    return `${lista}${s ? `?${s}` : ""}#resultados`;
  };

  const tipo = api.get("tipo");
  const region = api.get("region");
  const cuando = api.get("cuando");
  const orden = api.get("orden") === "reciente" ? "reciente" : "cierra";
  const ultima = d ? Math.min(PAGINAS_MAX, Math.max(1, Math.ceil(d.total / d.size))) : 1;
  const activos = [
    api.get("q") ? { clave: "q", texto: `«${api.get("q")}»`, href: enlace({ q: null }) } : null,
    region ? { clave: "region", texto: nombreRegion(region), href: enlace({ region: null }) } : null,
    tipo ? { clave: "tipo", texto: nombreTipo(tipo), href: enlace({ tipo: null }) } : null,
    cuando ? { clave: "cuando", texto: cuando === "hoy" ? "Cierran hoy" : "Nuevas (24 horas)", href: enlace({ cuando: null }) } : null,
  ].filter((x): x is { clave: string; texto: string; href: string } => !!x);
  const desde = d && d.total ? (pagina - 1) * d.size + 1 : 0;
  const hasta = d ? Math.min(d.total, pagina * d.size) : 0;
  const actualizado = d?.cabecera.actualizado
    ? new Date(d.cabecera.actualizado).toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false })
    : null;

  return (
    <div className={enApp ? CLASE_PAGINA : "container-page py-8 sm:py-12"}>
      <header className="max-w-3xl">
        <h1 className="font-display text-cifra font-bold leading-tight tracking-tight text-ink sm:text-titulo">Contratos menores abiertos</h1>
        <p className="mt-1.5 text-pretty text-cuerpo leading-relaxed text-inkSoft">
          Las contrataciones de hasta 8 UIT que todavía se pueden cotizar en el SEACE. Sus plazos son cortos, a veces de horas: cada una dice cuándo cierra, qué
          pide y dónde.
        </p>
        {d && (
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-dato text-inkSoft">
            <Dato icono={FileText} className="font-medium text-ink">
              {numero(d.cabecera.abiertas)} abiertas ahora
            </Dato>
            <Link href={enlace({ cuando: "hoy" })} className="underline-offset-2 hover:underline">
              <Dato icono={Clock}>{numero(d.cabecera.cierranHoy)} cierran hoy</Dato>
            </Link>
            <Link href={enlace({ cuando: "nuevas" })} className="underline-offset-2 hover:underline">
              <Dato icono={Sparkles}>{numero(d.cabecera.nuevas24h)} nuevas en 24 horas</Dato>
            </Link>
            {actualizado && <span className="text-meta text-mute">Actualizado a las {actualizado}, cada hora</span>}
          </p>
        )}
      </header>

      <form action={lista} method="get" role="search" className="mt-5 grid gap-2 rounded-2xl border border-line bg-paperSoft p-3 sm:grid-cols-[minmax(0,1fr)_12rem_11rem_auto] sm:p-4">
        <label className="relative min-w-0">
          <span className="sr-only">Qué vendes</span>
          <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input name="q" defaultValue={v.q ?? ""} placeholder="Qué vendes: tóner, catering, camioneta…" className={cn(CAMPO, "pl-9")} />
        </label>
        <label className="min-w-0">
          <span className="sr-only">Región</span>
          <select name="region" defaultValue={region ?? ""} className={CAMPO}>
            <option value="">Todo el Perú</option>
            {REGIONES_UBIGEO.map((r) => (
              <option key={r.ubigeo} value={r.ubigeo}>
                {r.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="sr-only">Tipo</span>
          <select name="tipo" defaultValue={tipo ?? ""} className={CAMPO}>
            <option value="">Todos los tipos</option>
            {TIPOS.map((t) => (
              <option key={t.clave} value={t.clave}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
        {cuando && <input type="hidden" name="cuando" value={cuando} />}
        {orden === "reciente" && <input type="hidden" name="orden" value="reciente" />}
        <button type="submit" className={claseAccion("primario", "min-h-11 w-full sm:w-auto")}>
          Buscar
        </button>
      </form>

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
            etiqueta="Cuándo"
            items={[
              { clave: "hoy", texto: "Cierran hoy", n: d.cabecera.cierranHoy, href: enlace({ cuando: cuando === "hoy" ? null : "hoy" }), activo: cuando === "hoy" },
              { clave: "nuevas", texto: "Nuevas (24 h)", n: d.cabecera.nuevas24h, href: enlace({ cuando: cuando === "nuevas" ? null : "nuevas" }), activo: cuando === "nuevas" },
            ]}
          />
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

      {!d ? (
        <div role="alert" className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-line bg-paperSoft p-5 sm:flex-row sm:items-center sm:p-6">
          <PersonajePregunta nombre="emprendedora" escala={2} className="shrink-0" />
          <p className="min-w-0 flex-1 text-dato text-inkSoft">No pudimos leer los contratos menores ahora. Suele ser momentáneo.</p>
          <Link href={enlace({})} className={cn(CLASE_ACCION_LISTA, "min-h-11")}>
            <RotateCcw size={15} aria-hidden className="mr-1.5" /> Volver a intentar
          </Link>
        </div>
      ) : (
        <section id="resultados" aria-labelledby="resultados-t" className="mt-6 scroll-mt-24 border-t border-line pt-6">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h2 id="resultados-t" className="font-display text-seccion font-bold leading-tight text-ink">
                {numero(d.total)} {d.total === 1 ? "contratación abierta" : "contrataciones abiertas"}
              </h2>
              <p className="mt-1.5 text-meta text-inkSoft">
                <Dato icono={Building2}>{numero(d.resumen.entidades)} {d.resumen.entidades === 1 ? "entidad compra" : "entidades compran"}</Dato>
              </p>
            </div>
            <nav aria-label="Ordenar" className="flex items-center gap-2">
              <span className="hidden text-meta text-mute sm:inline">Ordenar</span>
              <span className="inline-flex rounded-full border border-line bg-paper p-0.5">
                {(
                  [
                    { clave: "cierra", texto: "Cierran antes", href: `${enlace({ orden: null })}#resultados` },
                    { clave: "reciente", texto: "Más recientes", href: `${enlace({ orden: "reciente" })}#resultados` },
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

          {d.data.length === 0 ? (
            <div className="mt-4 flex items-start gap-4 rounded-2xl border border-line bg-paperSoft p-5 sm:p-6">
              <PersonajePregunta nombre="emprendedora" escala={2.5} className="shrink-0" />
              <div className="min-w-0">
                <p className="font-display text-bloque font-bold leading-tight text-ink">Ninguna contratación abierta con estos filtros</p>
                <p className="mt-1 text-dato text-inkSoft">Salen y cierran todo el día: prueba con menos filtros o vuelve en un rato.</p>
                {activos.length > 0 && (
                  <Link href={lista} className={cn(CLASE_ACCION_LISTA, "mt-3 min-h-11")}>
                    Ver todas las abiertas
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <ol className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
              {d.data.map((m) => (
                <li key={m.id} className="min-w-0">
                  <FilaMenor m={m} base={base} />
                </li>
              ))}
            </ol>
          )}

          {d.total > 0 && (
            <nav aria-label="Páginas de contratos menores" className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
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
          <Nota className="mt-4">
            Para cotizar entras al SEACE con tu usuario del RNP y buscas el código de la contratación (CM-…). Las entidades no publican un monto referencial en
            estas compras: lo que se pagó antes por los mismos ítems está en cada ficha.
          </Nota>
        </section>
      )}

      {/* Dentro de la app no va: el plan y las alertas están en la barra lateral. */}
      {!enApp && (
      <section aria-labelledby="alerta-t" className="mt-12 grid gap-4 rounded-3xl border border-granate/30 bg-granate-50 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <h2 id="alerta-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink">
            ¿Vendes al Estado? Mira también los procesos grandes
          </h2>
          <p className="mt-2 flex items-start gap-2.5 text-dato leading-snug text-inkSoft">
            <BellRing size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
            <span>Las convocatorias del SEACE de más de 8 UIT, con su valor referencial, su plazo de consultas y quién gana lo parecido.</span>
          </p>
        </div>
        <Link href={rutaEn(base, "/oportunidades")} className={claseAccion("primario", "", "md")}>
          Ver las oportunidades
        </Link>
      </section>
      )}
    </div>
  );
}

/** Los conteos de una dimensión como chips que suman (o quitan) ese filtro; en el celular, en una fila que se desliza. */
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
              aria-label={`${i.texto}: ${numero(i.n)}${i.activo ? " (filtro puesto: toca para quitarlo)" : ""}`}
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
