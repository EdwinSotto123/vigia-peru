import Link from "next/link";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { numero } from "@/lib/formato";
import { REGIONES_UBIGEO, TIPOS } from "@/lib/licitaciones";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";

export interface ValoresFiltro {
  q?: string;
  region?: string;
  tipo?: string;
  dias?: string;
  orden?: string;
  min?: string;
  max?: string;
  entidad?: string;
}

/** Cuántas oportunidades hay en cada región y en cada tipo con los demás filtros puestos: van en sus opciones. */
export interface ConteosFiltro {
  region?: Record<string, number>;
  tipo?: Record<string, number>;
}

const CAMPO =
  "h-11 w-full min-w-0 rounded-xl border border-line bg-paper px-3 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato";
const ROTULO = "mb-1 block text-rotulo font-medium text-mute";
const BOTON =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-granate px-4 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2";

/**
 * Los filtros de las oportunidades en un formulario GET (sin JavaScript: cada filtro queda en la URL y se puede
 * compartir). Desde md, en dos filas: lo que vendes, la región y el tipo arriba; los días y el rango de valor abajo. En el
 * celular sólo se ve el buscador y un botón «Filtros» (con cuántos hay puestos) que despliega el resto: es una casilla
 * con su etiqueta, sin JavaScript. Las opciones de región y tipo dicen cuántas oportunidades tienen. El orden se elige en
 * la lista (va escondido para que filtrar no lo pierda). Server-safe.
 */
export function FiltrosOportunidades({ base, v, conteos, className }: { base: string; v: ValoresFiltro; conteos?: ConteosFiltro; className?: string }) {
  const diasPuestos = !!v.dias && v.dias !== "15";
  const plegados = [v.region, v.tipo, v.min, v.max].filter(Boolean).length + (diasPuestos ? 1 : 0);
  const hayFiltros = !!(v.q || v.region || v.tipo || v.min || v.max || v.entidad || diasPuestos || (v.orden && v.orden !== "reciente"));
  const cuenta = (n: number | undefined) => (n == null ? "" : ` (${numero(n)})`);
  return (
    <form
      method="get"
      action={rutaEn(base, "/oportunidades")}
      role="search"
      aria-label="Filtrar oportunidades"
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-2xl border border-line bg-paper p-3 sm:p-4 md:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:gap-x-3 md:gap-y-3",
        className,
      )}
    >
      <label className="relative col-start-1 row-start-1 block min-w-0">
        <span className="sr-only">Qué vendes</span>
        <Search size={17} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
        <input
          name="q"
          type="search"
          defaultValue={v.q ?? ""}
          placeholder="¿Qué vendes? Ej.: combustible"
          maxLength={120}
          enterKeyHint="search"
          className={cn(CAMPO, "pl-10")}
        />
      </label>
      <button type="submit" className={cn(BOTON, "col-start-2 row-start-1 md:col-start-4 md:px-5")}>
        <Search size={16} aria-hidden />
        <span className="max-md:sr-only">Buscar</span>
      </button>

      {/* En el celular el resto se pliega: la casilla abre el panel (la etiqueta es el botón; sin JavaScript). */}
      <input id="lic-mas-filtros" type="checkbox" className="peer sr-only md:hidden" />
      <label
        htmlFor="lic-mas-filtros"
        className="col-span-2 row-start-2 flex min-h-11 cursor-pointer select-none items-center justify-between gap-2 rounded-xl border border-line bg-paperSoft px-3.5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 peer-focus-visible:ring-2 peer-focus-visible:ring-granate md:hidden"
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal size={16} aria-hidden className="text-granate" />
          Filtros
          {plegados > 0 && (
            <span className="rounded-full bg-granate px-2 py-0.5 text-rotulo font-semibold tabular-nums text-paper">
              {plegados}
              <span className="sr-only"> {plegados === 1 ? "puesto" : "puestos"}</span>
            </span>
          )}
        </span>
        <ChevronDown size={18} aria-hidden className="text-mute transition-transform duration-rapido [.peer:checked~label_&]:rotate-180" />
      </label>

      <div className="col-span-2 row-start-3 hidden grid-cols-2 gap-2 peer-checked:grid md:contents md:peer-checked:contents">
        <label className="col-span-2 block min-w-0 md:col-span-1 md:col-start-2 md:row-start-1">
          <span className={cn(ROTULO, "md:sr-only")}>Región</span>
          <select name="region" defaultValue={v.region ?? ""} className={CAMPO}>
            <option value="">Todo el Perú</option>
            {REGIONES_UBIGEO.map((r) => (
              <option key={r.ubigeo} value={r.ubigeo}>
                {`${r.nombre}${conteos?.region ? cuenta(conteos.region[r.ubigeo] ?? 0) : ""}`}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block min-w-0 md:col-span-1 md:col-start-3 md:row-start-1">
          <span className={cn(ROTULO, "md:sr-only")}>Tipo de contratación</span>
          <select name="tipo" defaultValue={v.tipo ?? ""} className={CAMPO}>
            <option value="">Bienes, servicios y obras</option>
            {TIPOS.map((t) => (
              <option key={t.clave} value={t.clave}>
                {`${t.nombre}${conteos?.tipo ? cuenta(conteos.tipo[t.clave] ?? 0) : ""}`}
              </option>
            ))}
          </select>
        </label>
        <div className="col-span-2 grid grid-cols-2 gap-2 md:col-span-3 md:col-start-1 md:row-start-2 md:flex md:flex-wrap md:items-end md:gap-3">
          <label className="col-span-2 block min-w-0 md:w-56">
            <span className={ROTULO}>Convocadas en</span>
            <select name="dias" defaultValue={v.dias ?? "15"} className={CAMPO}>
              <option value="7">Los últimos 7 días</option>
              <option value="15">Los últimos 15 días</option>
              <option value="30">Los últimos 30 días</option>
              <option value="60">Los últimos 60 días</option>
            </select>
          </label>
          <label className="block min-w-0 md:w-40">
            <span className={ROTULO}>Valor desde (S/)</span>
            <input name="min" defaultValue={v.min ?? ""} inputMode="numeric" placeholder="0" maxLength={12} className={CAMPO} />
          </label>
          <label className="block min-w-0 md:w-40">
            <span className={ROTULO}>Valor hasta (S/)</span>
            <input name="max" defaultValue={v.max ?? ""} inputMode="numeric" placeholder="Sin tope" maxLength={12} className={CAMPO} />
          </label>
        </div>
        <div className="col-span-2 flex items-center gap-2 md:col-span-1 md:col-start-4 md:row-start-2 md:justify-end">
          <button type="submit" className={cn(BOTON, "flex-1 md:hidden")}>
            <SlidersHorizontal size={16} aria-hidden /> Aplicar filtros
          </button>
          {hayFiltros && (
            <Link
              href={rutaEn(base, "/oportunidades")}
              className="inline-flex min-h-11 items-center rounded-xl px-3 text-dato font-semibold text-granate underline-offset-2 hover:underline"
            >
              Limpiar
            </Link>
          )}
        </div>
      </div>

      {v.entidad && <input type="hidden" name="entidad" value={v.entidad} />}
      {v.orden === "valor" && <input type="hidden" name="orden" value="valor" />}
    </form>
  );
}
