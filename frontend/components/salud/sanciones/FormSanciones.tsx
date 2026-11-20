import Link from "next/link";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { DEPARTAMENTOS, nombreLugar } from "@/components/salud/lista/filtros";
import { cn } from "@/lib/utils";
import { ADMINISTRADAS, GRAVEDADES, TIPOS_FILTRO, type FiltrosSanciones } from "./filtros";

const CAMPO =
  "min-h-11 w-full min-w-0 rounded-xl border border-line bg-caja px-3 py-2.5 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato";
const ROTULO = "text-rotulo font-medium text-inkSoft";
const ID_MAS = "sanciones-mas-filtros";

/**
 * Los filtros del Registro de Sanciones en un formulario GET (cada filtro en la URL). En el celular, el buscador y
 * «Filtros y orden», que abre el resto (casilla escondida y CSS, sin JavaScript). El año va en los chips de debajo, con
 * cuántas hay en cada uno; el código de una IPRESS viaja escondido. Server-safe.
 */
export function FormSanciones({ accion, f, limpiar, className }: { accion: string; f: FiltrosSanciones; limpiar: string; className?: string }) {
  const enPanel = [f.departamento, f.tipo, f.gravedad, f.administrada, f.naturaleza, f.judicial, f.orden].filter(Boolean).length;
  return (
    <form
      method="get"
      action={accion}
      role="search"
      aria-label="Filtrar sanciones"
      className={cn("group/filtros grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-2xl border border-line bg-paper p-2.5 sm:p-3 md:grid-cols-12 md:gap-3 md:p-4", className)}
    >
      {f.anio && <input type="hidden" name="anio" value={f.anio} />}
      {f.ipress && <input type="hidden" name="ipress" value={f.ipress} />}

      <label className="relative block min-w-0 self-end md:col-span-12 lg:col-span-6">
        <span className="sr-only">Nombre de la clínica, el hospital o la aseguradora</span>
        <Search size={17} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
        <input
          name="q"
          type="search"
          defaultValue={f.q ?? ""}
          placeholder="Nombre de la clínica, el hospital o la aseguradora"
          maxLength={120}
          className={cn(CAMPO, "pl-10 [&::-webkit-search-cancel-button]:hidden")}
        />
      </label>
      <button
        type="submit"
        aria-label="Buscar"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-granate px-3 text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2 md:hidden"
      >
        <Search size={18} aria-hidden />
      </button>

      <input type="checkbox" id={ID_MAS} className="sr-only md:hidden" aria-controls="sanciones-panel" />
      <label
        htmlFor={ID_MAS}
        className="col-span-2 flex min-h-11 cursor-pointer select-none items-center justify-between gap-2 rounded-xl border border-line bg-paperSoft px-3.5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 group-has-[#sanciones-mas-filtros:checked]/filtros:border-granate/40 group-has-[#sanciones-mas-filtros:checked]/filtros:bg-granate-50 group-has-[#sanciones-mas-filtros:focus-visible]/filtros:ring-2 group-has-[#sanciones-mas-filtros:focus-visible]/filtros:ring-granate md:hidden"
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
        <ChevronDown size={17} aria-hidden className="text-mute transition-transform duration-rapido group-has-[#sanciones-mas-filtros:checked]/filtros:rotate-180" />
      </label>

      <div id="sanciones-panel" className="col-span-2 grid-cols-2 gap-2.5 rounded-xl border border-line bg-paperSoft p-3 max-md:hidden max-md:group-has-[#sanciones-mas-filtros:checked]/filtros:grid md:contents">
        <label className="col-span-2 block min-w-0 md:col-span-6 lg:col-span-3">
          <span className={ROTULO}>Departamento</span>
          <select name="departamento" defaultValue={f.departamento ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Todo el Perú</option>
            {DEPARTAMENTOS.map((d) => (
              <option key={d} value={d}>
                {nombreLugar(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block min-w-0 md:col-span-6 lg:col-span-3">
          <span className={ROTULO}>Tipo de sanción</span>
          <select name="tipo" defaultValue={f.tipo ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Todas</option>
            {TIPOS_FILTRO.map((t) => (
              <option key={t.clave} value={t.clave}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 md:col-span-6 lg:col-span-2">
          <span className={ROTULO}>Gravedad</span>
          <select name="gravedad" defaultValue={f.gravedad ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Todas</option>
            {GRAVEDADES.map((g) => (
              <option key={g.clave} value={g.clave}>
                {g.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 md:col-span-6 lg:col-span-4">
          <span className={ROTULO}>Institución</span>
          <select name="administrada" defaultValue={f.administrada ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Todas</option>
            {ADMINISTRADAS.map((a) => (
              <option key={a.clave} value={a.clave}>
                {a.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 md:col-span-6 lg:col-span-3">
          <span className={ROTULO}>Pública o privada</span>
          <select name="naturaleza" defaultValue={f.naturaleza ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Las dos</option>
            <option value="publica">Pública</option>
            <option value="privada">Privada</option>
          </select>
        </label>
        <label className="block min-w-0 md:col-span-6 lg:col-span-3">
          <span className={ROTULO}>Ordenar por</span>
          <select name="orden" defaultValue={f.orden ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Las más recientes</option>
            <option value="multa">La multa más alta</option>
          </select>
        </label>
        <div className="col-span-2 flex min-w-0 items-end md:col-span-6 lg:col-span-8">
          <label className="inline-flex min-h-11 w-full cursor-pointer lg:w-auto items-center gap-2 rounded-full border border-line bg-caja px-3.5 text-dato text-ink transition-colors duration-rapido hover:border-granate/40 has-[:checked]:border-granate/50 has-[:checked]:bg-granate-50 has-[:checked]:font-semibold">
            <input type="checkbox" name="judicial" value="si" defaultChecked={f.judicial === "si"} className="h-4 w-4 shrink-0 accent-[rgb(var(--granate))]" />
            Sólo en proceso judicial
          </label>
        </div>
        <div className="col-span-2 flex items-end gap-2 md:col-span-6 lg:col-span-4 md:justify-end">
          <button
            type="submit"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-granate px-6 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2 lg:flex-none"
          >
            <SlidersHorizontal size={16} aria-hidden />
            <span className="md:hidden">Aplicar filtros</span>
            <span className="hidden md:inline">Buscar</span>
          </button>
          {(enPanel > 0 || f.q || f.anio || f.ipress) && (
            <Link href={limpiar} prefetch={false} className="inline-flex min-h-11 items-center rounded-full px-3 text-dato font-semibold text-granate underline-offset-2 hover:underline">
              Limpiar
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}
