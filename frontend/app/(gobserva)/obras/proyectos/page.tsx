import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { BellRing, Building2, ChartNoAxesCombined, Landmark, Wallet, X } from "lucide-react";
import { AccionesBusqueda } from "@/components/gobserva/cuenta/AccionesBusqueda";
import { FacetasProyectos, FiltrosProyectos } from "@/components/gobserva-obras/Filtros";
import { Paginador, TiraCifras } from "@/components/gobserva-obras/Piezas";
import { FilaProyecto } from "@/components/gobserva-obras/TarjetaProyecto";
import { Nota } from "@/components/patrones/Estructura";
import { PersonajePregunta } from "@/components/pixel/Escena";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { numero, plural, soles, solesCompacto } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import {
  FASES,
  MODALIDADES,
  NIVELES,
  PESTANAS,
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
import { COBROS_EN_PAUSA } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";
import { nombreRegion } from "@/lib/licitaciones";
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
 * formulario GET, plegado en el celular), los filtros puestos como chips para quitar, la alerta de la búsqueda, lo que
 * suma lo filtrado, los conteos por fase, sector, región, nivel y modalidad (columna lateral en escritorio ancho; enlaces
 * que ponen o quitan ese filtro), una fila por proyecto con su costo alineado a la derecha y el paginador.
 * GET /proyectos/lista.
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
  // Buscar un CUI es seguir ese proyecto: la alerta de esta búsqueda avisa cuando cambia de fase.
  const esCui = !!f.q && /^\d{7}$/.test(f.q);

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
  const sinFiltros = `${lista}${pestana !== "se_vienen" ? `?pestana=${pestana}` : ""}`;

  const chips = (centrados = false) => (
    <ul className={cn("flex flex-wrap items-center gap-2", centrados && "justify-center")} aria-label="Filtros puestos">
      {puestos.map((p) => (
        <li key={p.texto}>
          <Link
            href={p.href}
            prefetch={false}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-granate/40 bg-granate-50 px-3.5 text-meta font-medium text-ink transition-colors duration-rapido hover:border-granate sm:min-h-9 sm:px-3"
          >
            {p.texto}
            <X size={13} aria-hidden />
            <span className="sr-only"> (quitar)</span>
          </Link>
        </li>
      ))}
      <li>
        <Link href={sinFiltros} prefetch={false} className="inline-flex min-h-11 items-center px-2 text-meta font-semibold text-granate underline-offset-2 hover:underline sm:min-h-9">
          Quitar todos
        </Link>
      </li>
    </ul>
  );

  return (
    <div className="container-page pb-8 pt-5 sm:pb-12 sm:pt-6">
      {/* En el celular no va: la pestaña «Proyectos» del menú ya dice dónde se está, y el espacio es para los resultados. */}
      <nav aria-label="Ruta" className="hidden text-meta text-mute sm:block">
        <Link href={rutaEn(base, "/")} className="inline-flex min-h-11 items-center hover:text-granate hover:underline">
          Inicio
        </Link>
        <span aria-hidden className="mx-1.5">/</span>
        <span className="text-inkSoft">Proyectos</span>
      </nav>
      <h1 className="text-balance font-display text-cifra font-bold leading-tight text-ink sm:text-titulo">{tituloLista(f)}</h1>
      <p className="mt-1.5 max-w-[72ch] text-dato leading-relaxed text-inkSoft sm:text-cuerpo">{pestanaInfo.bajada}</p>

      {/* Las pestañas: la fase del proyecto. Cambiar de pestaña quita el filtro de fase (es de cada pestaña). */}
      <nav aria-label="Qué proyectos ver" className="-mx-4 mt-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:mt-5 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <ul className="flex min-w-max gap-0.5 border-b border-line sm:gap-1">
          {PESTANAS.map((p) => {
            const activa = p.clave === pestana;
            const n = d?.pestanas?.[p.clave];
            return (
              <li key={p.clave}>
                <Link
                  href={`${lista}${qsObras({ ...f, pestana: p.clave, fase: undefined, page: undefined })}`}
                  prefetch={false}
                  aria-current={activa ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex min-h-11 items-center border-b-2 px-2.5 text-dato font-semibold transition-colors duration-rapido sm:px-4",
                    activa ? "border-granate text-ink" : "border-transparent text-inkSoft hover:border-line hover:text-ink",
                  )}
                >
                  {p.nombre}
                  {n != null && (
                    <span className={cn("ml-1.5 rounded-full px-1.5 py-px text-rotulo font-semibold tabular-nums", activa ? "bg-granate-50 text-granate" : "bg-paperDeep text-inkSoft")}>
                      {numero(n)}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <FiltrosProyectos base={base} f={f} facetas={d?.facetas} className="mt-4" />

      {puestos.length > 0 && <div className="mt-3">{chips()}</div>}

      {esCui && (
        <Nota icono={<BellRing size={15} aria-hidden />} className="mt-3">
          Buscas el proyecto con CUI {f.q}. Crea la alerta con esta búsqueda y te avisamos cada vez que cambie de fase: cuando apruebe su expediente
          técnico, se licite, empiece la obra o se paralice.
        </Nota>
      )}

      <div id="crear-alerta" className="mt-3 scroll-mt-32">
        <Suspense>
          <AccionesBusqueda producto="obras" base={base} variante="barra" resumen={false} />
        </Suspense>
      </div>

      {!d ? (
        <div className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-line bg-paperSoft p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <PersonajePregunta nombre="obrero" escala={2.5} className="shrink-0" />
            <p className="text-dato text-inkSoft">No pudimos leer los proyectos ahora. Suele ser momentáneo: vuelve a intentarlo en unos segundos.</p>
          </div>
          <a href={`${lista}${qsObras(f)}`} className={claseAccion("secundario", "min-h-11 shrink-0")}>
            Volver a intentar
          </a>
        </div>
      ) : (
        <div className="mt-5 xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-8">
          <aside className="hidden min-w-0 xl:block">
            <FacetasProyectos base={base} f={f} facetas={d.facetas} />
          </aside>

          <div className="min-w-0">
            <TiraCifras
              etiqueta="Lo que suma esta búsqueda"
              items={[
                { Icono: Landmark, etiqueta: d.total === 1 ? "Proyecto" : "Proyectos", valor: numero(d.total) },
                { Icono: ChartNoAxesCombined, etiqueta: "Costo sumado", valor: solesCompacto(d.resumen.monto) },
                { Icono: Wallet, etiqueta: "Por ejecutar todavía", valor: solesCompacto(d.resumen.porEjecutar), destacado: true },
                { Icono: Building2, etiqueta: d.resumen.entidades === 1 ? "Entidad" : "Entidades", valor: numero(d.resumen.entidades) },
              ]}
            />

            {d.data.length === 0 ? (
              <div className="mt-5 rounded-3xl border border-line bg-paper p-6 text-center sm:p-10">
                <PersonajePregunta nombre="obrero" escala={3} />
                <h2 className="mt-4 font-display text-seccion font-bold text-ink">Ningún proyecto con estos filtros</h2>
                <p className="mx-auto mt-2 max-w-[56ch] text-dato leading-relaxed text-inkSoft">
                  Quita un filtro, prueba con menos palabras (el sector en vez del nombre exacto) o busca en todas las fases.
                </p>
                {puestos.length > 0 && <div className="mt-5">{chips(true)}</div>}
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  {pestana !== "todos" ? (
                    <Link href={`${lista}${qsObras({ ...f, pestana: "todos", fase: undefined, page: undefined })}`} prefetch={false} className={claseAccion("secundario", "min-h-11")}>
                      Buscar en todas las fases
                    </Link>
                  ) : (
                    <Link href={sinFiltros} prefetch={false} className={claseAccion("secundario", "min-h-11")}>
                      Ver todas las inversiones
                    </Link>
                  )}
                  <a href="#crear-alerta" className={claseAccion("primario", "min-h-11")}>
                    <BellRing size={16} aria-hidden /> Avísame cuando aparezca
                  </a>
                </div>
                <p className="mx-auto mt-5 max-w-[56ch] text-meta leading-relaxed text-mute">
                  Cada semana se declaran viables proyectos nuevos: con la alerta te avisamos cuando aparezca uno como el que buscas.
                </p>
              </div>
            ) : (
              <>
                <ul className="mt-4 space-y-3" aria-label="Proyectos">
                  {d.data.map((p) => (
                    <li key={p.cui} className="min-w-0">
                      <FilaProyecto p={p} base={base} />
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
                  <Nota className="mx-auto mt-4 max-w-2xl">
                    Se muestran las primeras 50 páginas, ordenadas como elegiste. Afina con los filtros para llegar al resto, o descárgalos en Excel
                    {COBROS_EN_PAUSA ? ", gratis con tu cuenta." : " con el plan Pro."}
                  </Nota>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="mt-16 grid gap-6 rounded-3xl border border-line bg-paperSoft p-5 sm:p-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <h2 className="text-balance font-display text-seccion font-bold leading-tight text-ink">Que estos proyectos te lleguen solos</h2>
          <p className="mt-3 text-cuerpo leading-relaxed text-inkSoft">
            Guarda esta búsqueda como alerta: te avisamos de los proyectos nuevos que calzan contigo y de los que cambian de fase (cuando aprueban
            su expediente técnico, pasan a licitación o se paralizan).{" "}
            {COBROS_EN_PAUSA ? "Llegan cada mañana, gratis con tu cuenta." : "Con la cuenta gratis llegan cada semana; con Pro, cada mañana."}
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 sm:flex-row sm:items-center lg:justify-end">
          <a href="#crear-alerta" className={claseAccion("primario", "", "md")}>
            <BellRing size={17} aria-hidden /> Crear alerta con esta búsqueda
          </a>
          <Link href={rutaEn(base, "/planes")} className={claseAccion("secundario", "", "md")}>
            {COBROS_EN_PAUSA ? "Lo que incluye tu cuenta" : "Ver los planes"}
          </Link>
        </div>
      </div>
    </div>
  );
}
