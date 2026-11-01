import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
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

const CAMPO =
  "w-full min-w-0 rounded-xl border border-line bg-paper px-3 py-2.5 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato";

/**
 * Los filtros de las oportunidades en un formulario GET (sin JavaScript: cada filtro queda en la URL y se puede
 * compartir). Las opciones vacías no viajan a la API (la página las quita). Server-safe.
 */
export function FiltrosOportunidades({ base, v, className }: { base: string; v: ValoresFiltro; className?: string }) {
  const hayFiltros = !!(v.q || v.region || v.tipo || v.min || v.max || v.entidad || (v.dias && v.dias !== "15") || (v.orden && v.orden !== "reciente"));
  return (
    <form method="get" action={rutaEn(base, "/oportunidades")} className={cn("rounded-2xl border border-line bg-paper p-3 sm:p-4", className)} role="search" aria-label="Filtrar oportunidades">
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="relative block">
          <span className="sr-only">Qué vendes</span>
          <Search size={17} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input name="q" defaultValue={v.q ?? ""} placeholder="¿Qué vendes? combustible, uniformes, obras viales…" maxLength={120} className={cn(CAMPO, "pl-10")} />
        </label>
        <label className="block">
          <span className="sr-only">Región</span>
          <select name="region" defaultValue={v.region ?? ""} className={CAMPO}>
            <option value="">Todo el Perú</option>
            {REGIONES_UBIGEO.map((r) => (
              <option key={r.ubigeo} value={r.ubigeo}>
                {r.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Tipo de contratación</span>
          <select name="tipo" defaultValue={v.tipo ?? ""} className={CAMPO}>
            <option value="">Bienes, servicios y obras</option>
            {TIPOS.map((t) => (
              <option key={t.clave} value={t.clave}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5 md:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <label className="block">
          <span className="text-rotulo font-medium text-mute">Convocadas en</span>
          <select name="dias" defaultValue={v.dias ?? "15"} className={cn(CAMPO, "mt-1")}>
            <option value="7">Los últimos 7 días</option>
            <option value="15">Los últimos 15 días</option>
            <option value="30">Los últimos 30 días</option>
            <option value="60">Los últimos 60 días</option>
          </select>
        </label>
        <label className="block">
          <span className="text-rotulo font-medium text-mute">Valor desde (S/)</span>
          <input name="min" defaultValue={v.min ?? ""} inputMode="numeric" placeholder="0" maxLength={12} className={cn(CAMPO, "mt-1")} />
        </label>
        <label className="block">
          <span className="text-rotulo font-medium text-mute">Valor hasta (S/)</span>
          <input name="max" defaultValue={v.max ?? ""} inputMode="numeric" placeholder="Sin tope" maxLength={12} className={cn(CAMPO, "mt-1")} />
        </label>
        <label className="block">
          <span className="text-rotulo font-medium text-mute">Ordenar por</span>
          <select name="orden" defaultValue={v.orden ?? "reciente"} className={cn(CAMPO, "mt-1")}>
            <option value="reciente">Más recientes</option>
            <option value="valor">Mayor valor referencial</option>
          </select>
        </label>
        {v.entidad && <input type="hidden" name="entidad" value={v.entidad} />}
        <div className="col-span-2 flex items-end gap-2 md:col-span-1">
          <button
            type="submit"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-granate px-5 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2 md:flex-none"
          >
            <SlidersHorizontal size={16} aria-hidden /> Filtrar
          </button>
          {hayFiltros && (
            <Link href={rutaEn(base, "/oportunidades")} className="inline-flex min-h-11 items-center rounded-full px-3 text-dato font-semibold text-granate underline-offset-2 hover:underline">
              Limpiar
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}
