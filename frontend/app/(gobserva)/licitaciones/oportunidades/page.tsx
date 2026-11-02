import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccionesBusqueda } from "@/components/gobserva/cuenta/AccionesBusqueda";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { FiltrosOportunidades, type ValoresFiltro } from "@/components/licitaciones/Filtros";
import { TarjetaOportunidad } from "@/components/licitaciones/TarjetaOportunidad";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { TIPOS, getOportunidades, nombreRegion, nombreTipo } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Oportunidades",
  description: "Las convocatorias del SEACE de los últimos días, con filtros por rubro, región, tipo y valor referencial.",
  alternates: { canonical: urlCanonica("licitaciones", "/oportunidades") },
};

type Params = Record<string, string | string[] | undefined>;
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const CLAVES = ["q", "region", "tipo", "dias", "orden", "min", "max", "entidad", "page"] as const;

/**
 * Las oportunidades: los filtros en la URL (un formulario GET), las cifras de lo filtrado, los conteos por tipo y región
 * (enlaces que suman ese filtro), las tarjetas y la paginación. GET /licitaciones/oportunidades.
 */
export default async function Oportunidades({ searchParams }: { searchParams?: Params }) {
  const base = baseProducto("licitaciones");
  const v: ValoresFiltro & { page?: string } = {};
  for (const k of CLAVES) v[k] = uno(searchParams?.[k]);
  // Sólo lo que vale: un filtro vacío o mal escrito no viaja (la API respondería 400).
  const api = new URLSearchParams();
  if (v.q) api.set("q", v.q.slice(0, 120));
  if (v.region && /^\d{2}$/.test(v.region)) api.set("region", v.region);
  if (v.tipo && TIPOS.some((t) => t.clave === v.tipo)) api.set("tipo", v.tipo);
  if (v.dias && ["7", "15", "30", "60"].includes(v.dias)) api.set("dias", v.dias);
  if (v.orden === "valor") api.set("orden", "valor");
  const cifra = (x?: string) => (x ? Number(x.replace(/[^\d.]/g, "")) : NaN);
  if (Number.isFinite(cifra(v.min)) && cifra(v.min) > 0) api.set("min", String(cifra(v.min)));
  if (Number.isFinite(cifra(v.max)) && cifra(v.max) > 0) api.set("max", String(cifra(v.max)));
  if (v.entidad && /^\d{11}$/.test(v.entidad)) api.set("entidad", v.entidad);
  const pagina = Math.min(50, Math.max(1, Number(v.page) || 1));
  if (pagina > 1) api.set("page", String(pagina));
  const d = await getOportunidades(api);

  const enlace = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(api);
    p.delete("page");
    for (const [k, x] of Object.entries(cambios)) {
      if (x == null) p.delete(k);
      else p.set(k, x);
    }
    const s = p.toString();
    return `${rutaEn(base, "/oportunidades")}${s ? `?${s}` : ""}`;
  };
  const dias = Number(api.get("dias") ?? 15);
  const paginas = d ? Math.max(1, Math.ceil(d.total / d.size)) : 1;
  const entidadNombre = v.entidad && d?.data.find((o) => o.entidadRuc === v.entidad)?.entidad;

  return (
    <div className="container-page py-10 sm:py-14">
      <h1 className="font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Oportunidades</h1>
      <p className="mt-2 max-w-[70ch] text-cuerpo leading-relaxed text-inkSoft">
        Las convocatorias del SEACE de los últimos {numero(dias)} días que siguen en etapa de convocatoria
        {api.get("tipo") ? `, de ${nombreTipo(api.get("tipo")).toLocaleLowerCase("es-PE")}` : ""}
        {api.get("region") ? ` en ${nombreRegion(api.get("region"))}` : ""}
        {entidadNombre ? `, de ${entidadNombre}` : v.entidad ? ", de la entidad elegida" : ""}. El cronograma de cada una (presentación de ofertas) está en el SEACE.
      </p>

      <FiltrosOportunidades base={base} v={v} className="mt-6" />
      <div id="crear-alerta" className="mt-4 scroll-mt-24">
        <Suspense>
          <AccionesBusqueda producto="licitaciones" base={base} />
        </Suspense>
      </div>

      {!d ? (
        <p className="mt-8 rounded-2xl border border-line bg-paperSoft p-6 text-dato text-inkSoft">No pudimos leer las convocatorias ahora. Vuelve a intentarlo en un momento.</p>
      ) : (
        <>
          {/* Cifras de lo filtrado. */}
          <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Cifra valor={numero(d.total)} etiqueta={d.total === 1 ? "oportunidad" : "oportunidades"} />
            <Cifra valor={solesCompacto(d.resumen.valorTotal)} etiqueta={`de valor referencial publicado (${numero(d.resumen.conValor)} de ${numero(d.total)})`} />
            <Cifra valor={numero(d.resumen.entidades)} etiqueta={d.resumen.entidades === 1 ? "entidad comprando" : "entidades comprando"} />
            <Cifra valor={`${numero(dias)} días`} etiqueta="hacia atrás desde hoy" />
          </dl>

          {/* Conteos por tipo y por región: cada uno suma ese filtro. */}
          <div className="mt-5 space-y-2">
            <Chips
              etiqueta="Por tipo"
              items={d.porTipo
                .filter((t) => TIPOS.some((x) => x.clave === t.clave))
                .map((t) => ({ clave: t.clave, texto: `${nombreTipo(t.clave)} ${numero(t.n)}`, href: enlace({ tipo: api.get("tipo") === t.clave ? null : t.clave }), activo: api.get("tipo") === t.clave }))}
            />
            <Chips
              etiqueta="Por región"
              // recorte: las 10 regiones con más convocatorias; las 25 están en el filtro de arriba (más regiones en el desplegable).
              items={d.porRegion.slice(0, 10).map((x) => ({
                clave: x.clave,
                texto: `${nombreRegion(x.clave)} ${numero(x.n)}`,
                href: enlace({ region: api.get("region") === x.clave ? null : x.clave }),
                activo: api.get("region") === x.clave,
              }))}
            />
          </div>

          {d.data.length === 0 ? (
            <div className="mt-8 flex flex-col items-start gap-3 rounded-3xl border border-line bg-paperSoft p-6 sm:p-8">
              <SearchX size={28} aria-hidden className="text-mute" />
              <p className="font-display text-bloque font-bold text-ink">Ninguna convocatoria con esos filtros</p>
              <p className="max-w-[60ch] text-dato text-inkSoft">
                Prueba con menos palabras, otra región o más días hacia atrás. Y si quieres que te avisemos apenas salga una, déjanos tu rubro
                abajo.
              </p>
              <Link href={enlace({ q: null, region: null, tipo: null, min: null, max: null, dias: "60" })} className="text-dato font-semibold text-granate underline-offset-2 hover:underline">
                Ver las de los últimos 60 días, sin filtros
              </Link>
            </div>
          ) : (
            <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {d.data.map((o) => (
                <li key={o.ocid} className="min-w-0">
                  <TarjetaOportunidad o={o} base={base} />
                </li>
              ))}
            </ul>
          )}

          {paginas > 1 && (
            <nav aria-label="Páginas" className="mt-8 flex items-center justify-between gap-3">
              {pagina > 1 ? (
                <Link href={`${enlace({})}${enlace({}).includes("?") ? "&" : "?"}page=${pagina - 1}`} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-paper px-4 text-dato font-semibold text-ink hover:border-granate/40">
                  <ChevronLeft size={16} aria-hidden /> Anterior
                </Link>
              ) : (
                <span />
              )}
              <span className="text-meta text-mute">
                Página {numero(pagina)} de {numero(Math.min(paginas, 50))} ({plural(d.total, "oportunidad", "oportunidades")})
              </span>
              {pagina < Math.min(paginas, 50) ? (
                <Link href={`${enlace({})}${enlace({}).includes("?") ? "&" : "?"}page=${pagina + 1}`} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-paper px-4 text-dato font-semibold text-ink hover:border-granate/40">
                  Siguiente <ChevronRight size={16} aria-hidden />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}

      <div className="mt-16 grid gap-8 rounded-3xl border border-line bg-paperSoft p-5 sm:p-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <h2 className="text-balance font-display text-seccion font-bold leading-tight text-ink">Que estas oportunidades te lleguen solas</h2>
          <p className="mt-3 text-cuerpo leading-relaxed text-inkSoft">
            Guarda esta búsqueda como alerta: te mandamos las convocatorias nuevas que calzan contigo, con el plazo de consultas y lo que
            sabemos de la entidad. Con el plan gratis llegan cada semana; con Pro, cada mañana.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 sm:flex-row sm:items-center lg:justify-end">
          <a href="#crear-alerta" className={claseAccion("primario", "", "md")}>Crear alerta con esta búsqueda</a>
          <Link href={rutaEn(base, "/planes")} className={claseAccion("secundario", "", "md")}>Ver los planes</Link>
        </div>
      </div>
    </div>
  );
}

function Cifra({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse rounded-2xl border border-line bg-paper px-4 py-3.5">
      <dt className="mt-1.5 text-meta leading-snug text-inkSoft">{etiqueta}</dt>
      <dd className="font-display text-cifra font-bold leading-none tabular-nums text-ink">{valor}</dd>
    </div>
  );
}

function Chips({ etiqueta, items }: { etiqueta: string; items: { clave: string; texto: string; href: string; activo: boolean }[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-meta font-semibold text-mute">{etiqueta}</span>
      {items.map((i) => (
        <Link
          key={i.clave}
          href={i.href}
          aria-current={i.activo ? "true" : undefined}
          className={cn(
            "inline-flex min-h-8 items-center rounded-full border px-3 text-meta font-medium transition-colors duration-rapido",
            i.activo ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
          )}
        >
          {i.texto}
        </Link>
      ))}
    </div>
  );
}
