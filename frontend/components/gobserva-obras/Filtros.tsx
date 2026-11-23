import Link from "next/link";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { FASES, MODALIDADES, NIVELES, SECTORES, TIPOS_PROYECTO, qsObras, type Conteo, type Fase, type FiltrosObras } from "@/lib/gobserva-obras";
import { REGIONES_UBIGEO, nombreRegion } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

const CAMPO =
  "min-h-11 w-full min-w-0 rounded-xl border border-line bg-paper px-3 py-2.5 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato";
const ROTULO = "text-rotulo font-medium text-mute";

/** Las fases que tienen sentido en cada pestaña (en «en marcha» y «paralizadas» la pestaña ya es la fase). */
const FASES_DE: Record<string, Fase[]> = {
  se_vienen: ["viable", "expediente", "licitacion"],
  todos: ["viable", "expediente", "licitacion", "ejecucion", "paralizada", "terminada", "sin_movimiento"],
};

/** La casilla que abre y cierra los filtros en el celular (sin JavaScript: el panel se muestra con `:has(:checked)`). */
const ID_MAS = "obras-mas-filtros";

type Facetas = { region: Conteo[]; sector: Conteo[]; nivel: Conteo[]; fase: Conteo[]; modalidad: Conteo[]; tipo: Conteo[] };

/**
 * Los filtros de /proyectos en un formulario GET (sin JavaScript: cada filtro queda en la URL y se puede compartir). Cada
 * opción dice cuántos proyectos tiene con los demás filtros puestos. La pestaña y la entidad viajan escondidas. Server-safe.
 *
 * En escritorio, todo a la vista en dos filas: el buscador con la región y el sector, y debajo el resto con «Buscar». En el
 * celular sólo el buscador (con su botón) y «Filtros y orden», que abre el resto: antes los nueve campos ocupaban 560 px
 * antes del primer resultado. El panel se abre con una casilla escondida y CSS (`group-has`), así funciona sin JavaScript;
 * en escritorio el panel es `display: contents` y sus campos se acomodan en la misma rejilla del formulario.
 */
export function FiltrosProyectos({ base, f, facetas, className }: { base: string; f: FiltrosObras; facetas?: Facetas | null; className?: string }) {
  const pestana = f.pestana ?? "se_vienen";
  const cuenta = (lista: Conteo[] | undefined, clave: string) => {
    const n = lista?.find((x) => x.clave === clave)?.n;
    return n != null ? ` (${numero(n)})` : facetas ? " (0)" : "";
  };
  const fases = FASES_DE[pestana] ?? [];
  const hayFiltros = !!(f.q || f.region || f.sector || f.nivel || f.fase || f.modalidad || f.tipo || f.min || f.max || f.entidad || f.orden === "reciente");
  // Cuántos filtros hay puestos dentro del panel: el número va en el botón que lo abre.
  const enPanel = [f.region, f.sector, f.nivel, f.fase, f.modalidad, f.tipo, f.min, f.max, f.orden === "reciente" ? f.orden : undefined].filter(Boolean).length;
  const limpiar = `${rutaEn(base, "/proyectos")}${pestana !== "se_vienen" ? `?pestana=${pestana}` : ""}`;
  // La celda del botón llena la segunda fila en escritorio: sin la fase, sobra una celda más.
  const anchoBotones = fases.length > 0 ? "lg:col-span-3" : "lg:col-span-6";

  return (
    <form
      method="get"
      action={rutaEn(base, "/proyectos")}
      role="search"
      aria-label="Filtrar proyectos"
      className={cn(
        "group/filtros grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-2xl border border-line bg-paper p-2.5 sm:p-3 md:grid-cols-[repeat(24,minmax(0,1fr))] md:gap-2.5 md:p-4",
        className,
      )}
    >
      {pestana !== "se_vienen" && <input type="hidden" name="pestana" value={pestana} />}
      {f.entidad && <input type="hidden" name="entidad" value={f.entidad} />}

      <label className="relative block min-w-0 md:col-span-12">
        <span className="sr-only">Qué buscas</span>
        <Search size={17} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
        <input name="q" defaultValue={f.q ?? ""} placeholder="Obra, entidad o CUI" maxLength={120} className={cn(CAMPO, "pl-10")} />
      </label>
      {/* El primero del formulario: Enter en el buscador lo usa también en escritorio, donde no se ve. */}
      <button
        type="submit"
        aria-label="Buscar"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-granate px-3 text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2 md:hidden"
      >
        <Search size={18} aria-hidden />
      </button>

      {/* Sin `name`: no viaja en la URL. Fuera del celular no se enfoca (ahí el panel siempre está abierto). */}
      <input type="checkbox" id={ID_MAS} className="sr-only md:hidden" aria-controls="obras-panel-filtros" />
      <label
        htmlFor={ID_MAS}
        className="col-span-2 flex min-h-11 cursor-pointer select-none items-center justify-between gap-2 rounded-xl border border-line bg-paperSoft px-3.5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 group-has-[#obras-mas-filtros:checked]/filtros:border-granate/40 group-has-[#obras-mas-filtros:checked]/filtros:bg-granate-50 group-has-[#obras-mas-filtros:focus-visible]/filtros:ring-2 group-has-[#obras-mas-filtros:focus-visible]/filtros:ring-granate md:hidden"
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal size={16} aria-hidden className="text-granate" />
          Filtros y orden
          {enPanel > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-granate px-1.5 text-micro font-bold tabular-nums text-paper">
              {enPanel}
              <span className="sr-only"> {enPanel === 1 ? "puesto" : "puestos"}</span>
            </span>
          )}
        </span>
        <ChevronDown size={17} aria-hidden className="text-mute transition-transform duration-rapido group-has-[#obras-mas-filtros:checked]/filtros:rotate-180" />
      </label>

      <div
        id="obras-panel-filtros"
        className="col-span-2 grid-cols-2 gap-2.5 rounded-xl border border-line bg-paperSoft p-3 max-md:hidden max-md:group-has-[#obras-mas-filtros:checked]/filtros:grid md:contents"
      >
        <label className="col-span-2 block min-w-0 md:col-span-6">
          <span className={cn(ROTULO, "md:sr-only")}>Región</span>
          <select name="region" defaultValue={f.region ?? ""} className={cn(CAMPO, "mt-1 md:mt-0")}>
            <option value="">Todo el Perú</option>
            {REGIONES_UBIGEO.map((r) => (
              <option key={r.ubigeo} value={r.ubigeo}>
                {r.nombre}
                {cuenta(facetas?.region, r.ubigeo)}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block min-w-0 md:col-span-6">
          <span className={cn(ROTULO, "md:sr-only")}>Sector</span>
          <select name="sector" defaultValue={f.sector ?? ""} className={cn(CAMPO, "mt-1 md:mt-0")}>
            <option value="">Todos los sectores</option>
            {SECTORES.map((s) => (
              <option key={s.clave} value={s.clave}>
                {s.nombre}
                {cuenta(facetas?.sector, s.clave)}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 md:col-span-6 lg:col-span-3">
          <span className={ROTULO}>Quién la hace</span>
          <select name="nivel" defaultValue={f.nivel ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Todos</option>
            {NIVELES.map((n) => (
              <option key={n.clave} value={n.clave}>
                {n.nombre}
                {cuenta(facetas?.nivel, n.clave)}
              </option>
            ))}
          </select>
        </label>
        {fases.length > 0 ? (
          <label className="block min-w-0 md:col-span-6 lg:col-span-3">
            <span className={ROTULO}>Fase</span>
            <select name="fase" defaultValue={f.fase ?? ""} className={cn(CAMPO, "mt-1")}>
              <option value="">Todas</option>
              {fases.map((x) => (
                <option key={x} value={x}>
                  {FASES[x].nombre}
                  {cuenta(facetas?.fase, x)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block min-w-0 md:col-span-6 lg:col-span-3">
          <span className={ROTULO}>Modalidad</span>
          <select name="modalidad" defaultValue={f.modalidad ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Todas</option>
            {MODALIDADES.map((m) => (
              <option key={m.clave} value={m.clave}>
                {m.nombre}
                {cuenta(facetas?.modalidad, m.clave)}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 md:col-span-6 lg:col-span-3">
          <span className={ROTULO}>Qué es</span>
          <select name="tipo" defaultValue={f.tipo ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Todo</option>
            {TIPOS_PROYECTO.map((t) => (
              <option key={t.clave} value={t.clave}>
                {t.nombre}
                {cuenta(facetas?.tipo, t.clave)}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 md:col-span-6 lg:col-span-3">
          <span className={ROTULO}>Costo desde (S/)</span>
          <input name="min" defaultValue={f.min ?? ""} inputMode="numeric" placeholder="0" maxLength={14} className={cn(CAMPO, "mt-1")} />
        </label>
        <label className="block min-w-0 md:col-span-6 lg:col-span-3">
          <span className={ROTULO}>Costo hasta (S/)</span>
          <input name="max" defaultValue={f.max ?? ""} inputMode="numeric" placeholder="Sin tope" maxLength={14} className={cn(CAMPO, "mt-1")} />
        </label>
        <label className="col-span-2 block min-w-0 md:col-span-6 lg:col-span-3">
          <span className={ROTULO}>Ordenar por</span>
          <select name="orden" defaultValue={f.orden ?? "monto"} className={cn(CAMPO, "mt-1")}>
            <option value="monto">Mayor costo</option>
            <option value="reciente">Más recientes</option>
          </select>
        </label>
        <div className={cn("col-span-2 flex items-end gap-2 md:col-span-6", anchoBotones)}>
          <button
            type="submit"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-granate px-5 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2 lg:flex-none"
          >
            <SlidersHorizontal size={16} aria-hidden />
            <span className="md:hidden">Aplicar filtros</span>
            <span className="hidden md:inline">Buscar</span>
          </button>
          {/* En escritorio no hace falta: «Quitar todos» va en los chips de los filtros puestos, justo debajo. */}
          {hayFiltros && (
            <Link href={limpiar} prefetch={false} className="inline-flex min-h-11 items-center rounded-full px-3 text-dato font-semibold text-granate underline-offset-2 hover:underline md:hidden">
              Limpiar
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}

interface ItemFaceta {
  clave: string;
  nombre: string;
  n: number;
  activo: boolean;
  href: string;
}

/**
 * Los conteos de la búsqueda como columna lateral (escritorio ancho): por fase, sector, región, nivel de gobierno y
 * modalidad, todos (no las doce primeras), cada uno un enlace que pone ese filtro o lo quita si ya está puesto. Eran tres
 * filas de chips que empujaban los resultados 200 px hacia abajo. En pantallas más chicas no va: los mismos conteos están
 * en cada opción de los filtros. Server-safe.
 */
export function FacetasProyectos({ base, f, facetas, className }: { base: string; f: FiltrosObras; facetas: Facetas; className?: string }) {
  const pestana = f.pestana ?? "se_vienen";
  const lista = rutaEn(base, "/proyectos");
  const enlace = (cambios: Partial<FiltrosObras>) => `${lista}${qsObras({ ...f, page: undefined, ...cambios })}`;
  const n = (xs: Conteo[], clave: string) => xs.find((x) => x.clave === clave)?.n ?? 0;
  const nombreNivelLista = (c: string) => NIVELES.find((x) => x.clave === c)?.nombre ?? c;
  const nombreModalidad = (c: string) => MODALIDADES.find((x) => x.clave === c)?.nombre ?? c;
  const nombreSectorLista = (c: string) => SECTORES.find((x) => x.clave === c)?.nombre ?? c;

  const grupos: { clave: string; titulo: string; items: ItemFaceta[] }[] = [
    {
      clave: "fase",
      titulo: "Fase",
      items: (FASES_DE[pestana] ?? [])
        .map((x) => ({ clave: x, nombre: FASES[x].corto, n: n(facetas.fase, x), activo: f.fase === x, href: enlace({ fase: f.fase === x ? undefined : x }) }))
        .filter((i) => i.n > 0 || i.activo),
    },
    {
      clave: "sector",
      titulo: "Sector",
      items: facetas.sector
        .filter((x) => SECTORES.some((s) => s.clave === x.clave))
        .map((x) => ({ clave: x.clave, nombre: nombreSectorLista(x.clave), n: x.n, activo: f.sector === x.clave, href: enlace({ sector: f.sector === x.clave ? undefined : x.clave }) })),
    },
    {
      clave: "region",
      titulo: "Región",
      items: facetas.region
        .filter((x) => REGIONES_UBIGEO.some((r) => r.ubigeo === x.clave))
        .map((x) => ({ clave: x.clave, nombre: nombreRegion(x.clave), n: x.n, activo: f.region === x.clave, href: enlace({ region: f.region === x.clave ? undefined : x.clave }) })),
    },
    {
      clave: "nivel",
      titulo: "Quién la hace",
      items: facetas.nivel
        .filter((x) => NIVELES.some((v) => v.clave === x.clave))
        .map((x) => ({ clave: x.clave, nombre: nombreNivelLista(x.clave), n: x.n, activo: f.nivel === x.clave, href: enlace({ nivel: f.nivel === x.clave ? undefined : x.clave }) })),
    },
    {
      clave: "modalidad",
      titulo: "Modalidad",
      items: facetas.modalidad
        .filter((x) => MODALIDADES.some((m) => m.clave === x.clave))
        .map((x) => ({ clave: x.clave, nombre: nombreModalidad(x.clave), n: x.n, activo: f.modalidad === x.clave, href: enlace({ modalidad: f.modalidad === x.clave ? undefined : x.clave }) })),
    },
  ].filter((g) => g.items.length > 0);

  if (!grupos.length) return null;
  // Las seis más grandes a la vista (y la elegida, si está más abajo); el resto, a un toque. Sector y región tenían 18 y
  // 25 filas: la columna medía tres pantallas.
  const VISIBLES = 6;
  return (
    <nav aria-label="Filtrar por" className={cn("space-y-6", className)}>
      <h2 className="sr-only">Filtrar por</h2>
      {grupos.map((g) => {
        const max = Math.max(...g.items.map((i) => i.n), 1);
        const vista = g.items.filter((i, k) => k < VISIBLES || i.activo);
        const resto = g.items.filter((i, k) => k >= VISIBLES && !i.activo);
        const fila = (i: ItemFaceta) => (
          <li key={i.clave}>
            <Link
              href={i.href}
              prefetch={false}
              aria-current={i.activo ? "true" : undefined}
              className={cn(
                "block rounded-lg px-2.5 py-1.5 text-dato transition-colors duration-rapido",
                i.activo ? "bg-granate-50 font-semibold text-ink ring-1 ring-inset ring-granate/30" : "text-inkSoft hover:bg-paperDeep hover:text-ink",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 leading-snug">{i.nombre}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-meta tabular-nums text-mute">
                  {numero(i.n)}
                  {i.activo && <X size={13} aria-hidden className="text-granate" />}
                </span>
              </span>
              {/* Cuánto pesa cada opción en la búsqueda, a la misma escala dentro del grupo. */}
              <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-ink/[0.05]">
                <span className={cn("block h-full rounded-full", i.activo ? "bg-granate" : "bg-granate/45")} style={{ width: `${Math.max(2, (i.n / max) * 100)}%` }} />
              </span>
              {i.activo && <span className="sr-only"> (quitar este filtro)</span>}
            </Link>
          </li>
        );
        return (
          <section key={g.clave} aria-labelledby={`faceta-${g.clave}`}>
            <h3 id={`faceta-${g.clave}`} className="px-2.5 font-display text-cuerpo font-bold text-ink">
              {g.titulo}
            </h3>
            <ul className="mt-1.5 space-y-0.5">{vista.map(fila)}</ul>
            {resto.length > 0 && (
              <details className="group/faceta">
                <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 px-2.5 text-meta font-semibold text-granate hover:underline [&::-webkit-details-marker]:hidden">
                  <ChevronDown size={14} aria-hidden className="transition-transform duration-rapido group-open/faceta:rotate-180" />
                  <span className="group-open/faceta:hidden">Ver {resto.length === 1 ? "una más" : `las ${numero(resto.length)} más`}</span>
                  <span className="hidden group-open/faceta:inline">Ver menos</span>
                </summary>
                <ul className="space-y-0.5">{resto.map(fila)}</ul>
              </details>
            )}
          </section>
        );
      })}
    </nav>
  );
}
