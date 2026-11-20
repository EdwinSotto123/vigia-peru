import Link from "next/link";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { CATEGORIAS_ORDEN, SECTORES, TIPOS_IPRESS, claveTipo, numero, type Facetas, type Sector } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { DEPARTAMENTOS, ESTADOS, ORDENES, nombreLugar, type FiltrosLista } from "./filtros";

const CAMPO =
  "min-h-11 w-full min-w-0 rounded-xl border border-line bg-caja px-3 py-2.5 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato";
const ROTULO = "text-rotulo font-medium text-inkSoft";
const ID_MAS = "salud-mas-filtros";

/**
 * Los filtros de /establecimientos en un formulario GET (sin JavaScript: cada filtro queda en la URL y se puede compartir).
 * Cada opción dice cuántos hay con los demás filtros puestos (las facetas de la API). En escritorio todo a la vista; en el
 * celular sólo el buscador y «Filtros y orden», que abre el resto con una casilla escondida y CSS (como Obras). La
 * provincia no va aquí: se elige con los chips del departamento, debajo. Server-safe.
 */
export function FiltrosEstablecimientos({ accion, f, facetas, limpiar, className }: { accion: string; f: FiltrosLista; facetas?: Facetas | null; limpiar: string; className?: string }) {
  const cuenta = (lista: { clave: string; n: number }[] | undefined, clave: string) => {
    const n = lista?.find((x) => x.clave === clave)?.n;
    return n != null ? ` (${numero(n)})` : "";
  };
  const cuentaTipo = (clave: string) => {
    const n = facetas?.tipo.find((x) => claveTipo(x.clave) === clave)?.n;
    return n != null ? ` (${numero(n)})` : "";
  };
  const enPanel = [f.departamento, f.categoria, f.sector, f.tipo, f.estado, f.sanciones, f.quirurgico, f.internamiento, f.orden].filter(Boolean).length;
  const hayFiltros = enPanel > 0 || !!f.q;
  const varias = f.categoria?.includes(",") ? f.categoria : null;

  return (
    <form
      method="get"
      action={accion}
      role="search"
      aria-label="Filtrar establecimientos"
      className={cn("group/filtros grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-2xl border border-line bg-paper p-2.5 sm:p-3 md:grid-cols-12 md:gap-3 md:p-4", className)}
    >
      {f.provincia && <input type="hidden" name="provincia" value={f.provincia} />}
      {f.distrito && <input type="hidden" name="distrito" value={f.distrito} />}
      {(f.provincia || f.distrito) && <input type="hidden" name="provinciaDe" value={f.departamento ?? ""} />}

      <label className="relative block min-w-0 self-end md:col-span-12 lg:col-span-6">
        <span className="sr-only">Nombre, código IPRESS, RUC o distrito</span>
        <Search size={17} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
        <input name="q" type="search" defaultValue={f.q ?? ""} placeholder="Nombre, código IPRESS, RUC o distrito" maxLength={120} className={cn(CAMPO, "pl-10 [&::-webkit-search-cancel-button]:hidden")} />
      </label>
      <button
        type="submit"
        aria-label="Buscar"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-granate px-3 text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2 md:hidden"
      >
        <Search size={18} aria-hidden />
      </button>

      <input type="checkbox" id={ID_MAS} className="sr-only md:hidden" aria-controls="salud-panel-filtros" />
      <label
        htmlFor={ID_MAS}
        className="col-span-2 flex min-h-11 cursor-pointer select-none items-center justify-between gap-2 rounded-xl border border-line bg-paperSoft px-3.5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 group-has-[#salud-mas-filtros:checked]/filtros:border-granate/40 group-has-[#salud-mas-filtros:checked]/filtros:bg-granate-50 group-has-[#salud-mas-filtros:focus-visible]/filtros:ring-2 group-has-[#salud-mas-filtros:focus-visible]/filtros:ring-granate md:hidden"
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
        <ChevronDown size={17} aria-hidden className="text-mute transition-transform duration-rapido group-has-[#salud-mas-filtros:checked]/filtros:rotate-180" />
      </label>

      <div
        id="salud-panel-filtros"
        className="col-span-2 grid-cols-2 gap-2.5 rounded-xl border border-line bg-paperSoft p-3 max-md:hidden max-md:group-has-[#salud-mas-filtros:checked]/filtros:grid md:contents"
      >
        <label className="col-span-2 block min-w-0 md:col-span-6 lg:col-span-3">
          <span className={ROTULO}>Departamento</span>
          <select name="departamento" defaultValue={f.departamento ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Todo el Perú</option>
            {DEPARTAMENTOS.map((d) => (
              <option key={d} value={d}>
                {nombreLugar(d)}
                {cuenta(facetas?.departamento, d)}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block min-w-0 md:col-span-6 lg:col-span-3">
          <span className={ROTULO}>Categoría</span>
          <select name="categoria" defaultValue={f.categoria ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Todas</option>
            {/* Una lista de varias categorías (de un enlace) se conserva si no se elige otra. */}
            {varias && <option value={varias}>Varias: {varias.replace(/,/g, ", ")}</option>}
            {CATEGORIAS_ORDEN.map((c) => (
              <option key={c} value={c}>
                {c}
                {cuenta(facetas?.categoria, c)}
              </option>
            ))}
            <option value="SIN">Sin categoría{cuenta(facetas?.categoria, "SIN")}</option>
          </select>
        </label>
        <label className="block min-w-0 md:col-span-4 lg:col-span-2">
          <span className={ROTULO}>Sector</span>
          <select name="sector" defaultValue={f.sector ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Todos</option>
            {(Object.keys(SECTORES) as Sector[]).map((s) => (
              <option key={s} value={s}>
                {SECTORES[s]}
                {cuenta(facetas?.sector, s)}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 md:col-span-4 lg:col-span-3">
          <span className={ROTULO}>Tipo</span>
          <select name="tipo" defaultValue={f.tipo ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Todos</option>
            {TIPOS_IPRESS.map((t) => (
              <option key={t.clave} value={t.clave}>
                {t.nombre}
                {cuentaTipo(t.clave)}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 md:col-span-4 lg:col-span-3">
          <span className={ROTULO}>Estado en RENIPRESS</span>
          <select name="estado" defaultValue={f.estado ?? "activos"} className={cn(CAMPO, "mt-1")}>
            {ESTADOS.map((e) => (
              <option key={e.clave} value={e.clave}>
                {e.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 md:col-span-6 lg:col-span-4">
          <span className={ROTULO}>Ordenar por</span>
          <select name="orden" defaultValue={f.orden ?? "relevancia"} className={cn(CAMPO, "mt-1")}>
            {ORDENES.map((o) => (
              <option key={o.clave} value={o.clave}>
                {o.nombre}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="col-span-2 min-w-0 md:col-span-12 lg:col-span-8">
          <legend className={cn(ROTULO, "mb-1")}>Sólo los que</legend>
          <div className="flex flex-wrap gap-2">
            <Casilla nombre="sanciones" valor="con" marcada={f.sanciones === "con"}>
              tienen una sanción firme
            </Casilla>
            <Casilla nombre="quirurgico" valor="si" marcada={f.quirurgico === "si"}>
              registran centro quirúrgico
            </Casilla>
            <Casilla nombre="internamiento" valor="si" marcada={f.internamiento === "si"}>
              tienen internamiento
            </Casilla>
          </div>
        </fieldset>
        <div className="col-span-2 flex items-end gap-2 md:col-span-12 lg:col-span-4 lg:justify-end">
          <button
            type="submit"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-granate px-6 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2 lg:flex-none"
          >
            <SlidersHorizontal size={16} aria-hidden />
            <span className="md:hidden">Aplicar filtros</span>
            <span className="hidden md:inline">Buscar</span>
          </button>
          {hayFiltros && (
            <Link href={limpiar} prefetch={false} className="inline-flex min-h-11 items-center rounded-full px-3 text-dato font-semibold text-granate underline-offset-2 hover:underline">
              Limpiar
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}

function Casilla({ nombre, valor, marcada, children }: { nombre: string; valor: string; marcada: boolean; children: React.ReactNode }) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-caja px-3.5 text-dato text-ink transition-colors duration-rapido hover:border-granate/40 has-[:checked]:border-granate/50 has-[:checked]:bg-granate-50 has-[:checked]:font-semibold">
      <input type="checkbox" name={nombre} value={valor} defaultChecked={marcada} className="h-4 w-4 shrink-0 accent-[rgb(var(--granate))]" />
      {children}
    </label>
  );
}
