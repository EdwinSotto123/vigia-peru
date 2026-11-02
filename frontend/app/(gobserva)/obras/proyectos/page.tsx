import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { BellRing, Building2, ChartNoAxesCombined, Landmark, SearchX, Wallet, X } from "lucide-react";
import { AccionesBusqueda } from "@/components/gobserva/cuenta/AccionesBusqueda";
import { FiltrosProyectos } from "@/components/gobserva-obras/Filtros";
import { Dato, Paginador } from "@/components/gobserva-obras/Piezas";
import { TarjetaProyecto } from "@/components/gobserva-obras/TarjetaProyecto";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { numero, plural, soles, solesCompacto } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import {
  FASES,
  MODALIDADES,
  NIVELES,
  PESTANAS,
  SECTORES,
  TIPOS_PROYECTO,
  filtrosDeUrl,
  getProyectos,
  nombreEntidad,
  nombreSector,
  paramsApi,
  qsObras,
  type FiltrosObras,
  type Pestana,
} from "@/lib/gobserva-obras";
import { baseProducto } from "@/lib/gobserva-servidor";
import { REGIONES_UBIGEO, nombreRegion } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

const POR_PAGINA = 20;

type Props = { searchParams?: Record<string, string | string[] | undefined> };

const TITULO: Record<Pestana, string> = {
  se_vienen: "Proyectos que se vienen",
  en_marcha: "Obras en marcha",
  paralizadas: "Obras paralizadas",
  todos: "Todas las inversiones activas",
};

/** El título según la pestaña y los filtros: «Obras en marcha de agua y saneamiento en Cusco». */
function tituloLista(f: FiltrosObras): string {
  const partes = [TITULO[f.pestana ?? "se_vienen"]];
  if (f.q) partes.push(`con «${f.q}»`);
  if (f.sector) partes.push(`de ${nombreSector(f.sector).toLocaleLowerCase("es-PE")}`);
  if (f.region) partes.push(`en ${nombreRegion(f.region)}`);
  return partes.join(" ");
}

export function generateMetadata({ searchParams }: Props): Metadata {
  const f = filtrosDeUrl(searchParams);
  const filtrado = Object.entries(f).some(([k, v]) => v != null && k !== "pestana");
  return {
    title: tituloLista(f),
    description:
      "Los proyectos de inversión pública del Perú que se vienen (viables, con expediente técnico o licitándose), las obras en marcha y las paralizadas, con su costo, su avance y quién las construye. Filtra por región, sector y monto.",
    alternates: { canonical: urlCanonica("obras", `/proyectos${f.pestana && f.pestana !== "se_vienen" ? `?pestana=${f.pestana}` : ""}`) },
    // Una combinación de filtros no es una página para el buscador: sólo cada pestaña entera.
    robots: filtrado ? { index: false, follow: true } : undefined,
  };
}

/**
 * /proyectos de Gobserva Obras: las cuatro pestañas (se vienen, en marcha, paralizadas, todos), los filtros en la URL (un
 * formulario GET), los filtros puestos como chips para quitar, las cifras de lo filtrado, los conteos por sector y por
 * región (enlaces que suman ese filtro), las tarjetas y el paginador. GET /proyectos/lista.
 */
export default async function Proyectos({ searchParams }: Props) {
  const base = baseProducto("obras");
  const f = filtrosDeUrl(searchParams);
  const pestana = f.pestana ?? "se_vienen";
  const d = await getProyectos(paramsApi(f, POR_PAGINA));
  const lista = rutaEn(base, "/proyectos");
  const enlace = (cambios: Partial<FiltrosObras>) => `${lista}${qsObras({ ...f, page: undefined, ...cambios })}`;
  const paginas = d ? Math.min(50, Math.max(1, Math.ceil(d.total / POR_PAGINA))) : 1;
  const pestanaInfo = PESTANAS.find((p) => p.clave === pestana) ?? PESTANAS[0];

  const puestos: { texto: string; href: string }[] = [
    f.q ? { texto: `«${f.q}»`, href: enlace({ q: undefined }) } : null,
    f.region ? { texto: nombreRegion(f.region), href: enlace({ region: undefined }) } : null,
    f.sector ? { texto: nombreSector(f.sector), href: enlace({ sector: undefined }) } : null,
    f.nivel ? { texto: NIVELES.find((n) => n.clave === f.nivel)?.nombre ?? f.nivel, href: enlace({ nivel: undefined }) } : null,
    f.fase ? { texto: FASES[f.fase].nombre, href: enlace({ fase: undefined }) } : null,
    f.modalidad ? { texto: MODALIDADES.find((m) => m.clave === f.modalidad)?.nombre ?? f.modalidad, href: enlace({ modalidad: undefined }) } : null,
    f.tipo ? { texto: TIPOS_PROYECTO.find((t) => t.clave === f.tipo)?.nombre ?? f.tipo, href: enlace({ tipo: undefined }) } : null,
    f.min ? { texto: `Desde ${soles(Number(f.min))}`, href: enlace({ min: undefined }) } : null,
    f.max ? { texto: `Hasta ${soles(Number(f.max))}`, href: enlace({ max: undefined }) } : null,
    f.entidad
      ? { texto: d?.data[0]?.entidadRuc === f.entidad && d.data[0].entidad ? `De ${nombreEntidad(d.data[0].entidad)}` : `Entidad ${f.entidad}`, href: enlace({ entidad: undefined }) }
      : null,
  ].filter((x): x is { texto: string; href: string } => x != null);

  return (
    <div className="container-page py-8 sm:py-12">
      <nav aria-label="Ruta" className="text-meta text-mute">
        <Link href={rutaEn(base, "/")} className="hover:text-granate hover:underline">
          Inicio
        </Link>
        <span aria-hidden className="mx-1.5">/</span>
        <span className="text-inkSoft">Proyectos</span>
      </nav>
      <h1 className="mt-3 text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">{tituloLista(f)}</h1>
      <p className="mt-2 max-w-[72ch] text-cuerpo leading-relaxed text-inkSoft">{pestanaInfo.bajada}</p>

      {/* Las pestañas: la fase del proyecto. Cambiar de pestaña quita el filtro de fase (es de cada pestaña). */}
      <nav aria-label="Qué proyectos ver" className="mt-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {PESTANAS.map((p) => {
            const activa = p.clave === pestana;
            return (
              <li key={p.clave}>
                <Link
                  href={`${lista}${qsObras({ ...f, pestana: p.clave, fase: undefined, page: undefined })}`}
                  aria-current={activa ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex min-h-11 items-center border-b-2 px-4 text-dato font-semibold transition-colors duration-rapido",
                    activa ? "border-granate text-ink" : "border-transparent text-inkSoft hover:border-line hover:text-ink",
                  )}
                >
                  {p.nombre}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <FiltrosProyectos base={base} f={f} facetas={d?.facetas} className="mt-5" />

      {puestos.length > 0 && (
        <ul className="mt-4 flex flex-wrap items-center gap-2" aria-label="Filtros puestos">
          {puestos.map((p) => (
            <li key={p.texto}>
              <Link
                href={p.href}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-granate/40 bg-granate-50 px-3 text-meta font-medium text-ink transition-colors duration-rapido hover:border-granate"
              >
                {p.texto}
                <X size={13} aria-hidden />
                <span className="sr-only"> (quitar)</span>
              </Link>
            </li>
          ))}
          <li>
            <Link href={`${lista}${pestana !== "se_vienen" ? `?pestana=${pestana}` : ""}`} className="inline-flex min-h-9 items-center px-2 text-meta font-semibold text-granate underline-offset-2 hover:underline">
              Quitar todos
            </Link>
          </li>
        </ul>
      )}

      <div id="crear-alerta" className="mt-4 scroll-mt-24">
        <Suspense>
          <AccionesBusqueda producto="obras" base={base} />
        </Suspense>
      </div>

      {!d ? (
        <p className="mt-8 rounded-2xl border border-line bg-paperSoft p-6 text-dato text-inkSoft">No pudimos leer los proyectos ahora. Vuelve a intentarlo en un momento.</p>
      ) : (
        <>
          {/* Cifras de lo filtrado. */}
          <dl className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
            <Dato Icono={Landmark} valor={numero(d.total)} etiqueta={d.total === 1 ? "proyecto" : "proyectos"} />
            <Dato Icono={ChartNoAxesCombined} valor={solesCompacto(d.resumen.monto)} etiqueta="de costo, sumados" />
            <Dato Icono={Wallet} valor={solesCompacto(d.resumen.porEjecutar)} etiqueta="por ejecutar todavía" destacado />
            <Dato Icono={Building2} valor={numero(d.resumen.entidades)} etiqueta={d.resumen.entidades === 1 ? "entidad" : "entidades"} />
          </dl>

          {/* Conteos por sector y por región: cada uno suma ese filtro. */}
          <div className="mt-5 space-y-2">
            <Chips
              etiqueta="Por sector"
              items={d.facetas.sector
                .filter((x) => SECTORES.some((s) => s.clave === x.clave))
                .map((x) => ({ clave: x.clave, texto: `${nombreSector(x.clave)} ${numero(x.n)}`, href: enlace({ sector: f.sector === x.clave ? undefined : x.clave }), activo: f.sector === x.clave }))}
            />
            <Chips
              etiqueta="Por región"
              // recorte: las 12 regiones con más proyectos; las 25 están en el filtro de arriba (más regiones en el desplegable).
              items={d.facetas.region
                .filter((x) => REGIONES_UBIGEO.some((r) => r.ubigeo === x.clave))
                .slice(0, 12)
                .map((x) => ({ clave: x.clave, texto: `${nombreRegion(x.clave)} ${numero(x.n)}`, href: enlace({ region: f.region === x.clave ? undefined : x.clave }), activo: f.region === x.clave }))}
            />
          </div>

          {d.data.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-line bg-paper p-8 text-center sm:p-12">
              <SearchX size={36} aria-hidden className="mx-auto text-mute" />
              <p className="mt-4 font-display text-seccion font-bold text-ink">Ningún proyecto con estos filtros</p>
              <p className="mx-auto mt-2 max-w-[56ch] text-dato leading-relaxed text-inkSoft">
                Prueba con menos palabras (el sector en vez del nombre exacto), otra región o la pestaña «Todos». Cada semana se declaran viables
                proyectos nuevos: con las alertas, te avisamos cuando aparezca uno como el que buscas.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link href={`${lista}?pestana=todos`} className={claseAccion("secundario")}>
                  Ver todas las inversiones
                </Link>
                <a href="#crear-alerta" className={claseAccion("primario")}>
                  <BellRing size={16} aria-hidden /> Avísame cuando aparezca
                </a>
              </div>
            </div>
          ) : (
            <>
              <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Proyectos">
                {d.data.map((p) => (
                  <li key={p.cui} className="min-w-0">
                    <TarjetaProyecto p={p} base={base} />
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Paginador
                  pagina={f.page ?? 1}
                  paginas={paginas}
                  href={(pg) => `${lista}${qsObras({ ...f, page: pg })}`}
                  total={<> ({plural(d.total, "proyecto", "proyectos")})</>}
                />
              </div>
              {d.total > POR_PAGINA * 50 && (
                <p className="mt-3 text-center text-meta text-mute">
                  Se muestran las primeras 50 páginas. Afina con los filtros para ver el resto (o descárgalos en Excel con el plan Pro).
                </p>
              )}
            </>
          )}
        </>
      )}

      <div className="mt-16 grid gap-6 rounded-3xl border border-line bg-paperSoft p-5 sm:p-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <h2 className="text-balance font-display text-seccion font-bold leading-tight text-ink">Que estos proyectos te lleguen solos</h2>
          <p className="mt-3 text-cuerpo leading-relaxed text-inkSoft">
            Guarda esta búsqueda como alerta: te avisamos de los proyectos nuevos que calzan contigo y de los que cambian de fase (cuando aprueban
            su expediente técnico, pasan a licitación o se paralizan). Con la cuenta gratis llegan cada semana; con Pro, cada mañana.
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

/** Conteos que suman un filtro. En el celular, una fila que se desliza (envueltos ocupaban media pantalla). */
function Chips({ etiqueta, items }: { etiqueta: string; items: { clave: string; texto: string; href: string; activo: boolean }[] }) {
  if (!items.length) return null;
  return (
    <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
      <span className="mr-1 shrink-0 text-meta font-semibold text-mute">{etiqueta}</span>
      {items.map((i) => (
        <Link
          key={i.clave}
          href={i.href}
          aria-current={i.activo ? "true" : undefined}
          className={cn(
            "inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-meta font-medium transition-colors duration-rapido",
            i.activo ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
          )}
        >
          {i.texto}
        </Link>
      ))}
    </div>
  );
}
