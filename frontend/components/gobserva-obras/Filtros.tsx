import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { FASES, MODALIDADES, NIVELES, SECTORES, TIPOS_PROYECTO, type Conteo, type Fase, type FiltrosObras } from "@/lib/gobserva-obras";
import { REGIONES_UBIGEO } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";

const CAMPO =
  "w-full min-w-0 rounded-xl border border-line bg-paper px-3 py-2.5 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato";

/** Las fases que tienen sentido en cada pestaña (en «en marcha» y «paralizadas» la pestaña ya es la fase). */
const FASES_DE: Record<string, Fase[]> = {
  se_vienen: ["viable", "expediente", "licitacion"],
  todos: ["viable", "expediente", "licitacion", "ejecucion", "paralizada", "terminada", "sin_movimiento"],
};

/**
 * Los filtros de /proyectos en un formulario GET (sin JavaScript: cada filtro queda en la URL y se puede compartir). Cada
 * opción dice cuántos proyectos tiene con los demás filtros puestos. La pestaña y la entidad viajan escondidas. Server-safe.
 */
export function FiltrosProyectos({
  base,
  f,
  facetas,
  className,
}: {
  base: string;
  f: FiltrosObras;
  facetas?: { region: Conteo[]; sector: Conteo[]; nivel: Conteo[]; fase: Conteo[]; modalidad: Conteo[]; tipo: Conteo[] } | null;
  className?: string;
}) {
  const pestana = f.pestana ?? "se_vienen";
  const cuenta = (lista: Conteo[] | undefined, clave: string) => {
    const n = lista?.find((x) => x.clave === clave)?.n;
    return n != null ? ` (${numero(n)})` : facetas ? " (0)" : "";
  };
  const fases = FASES_DE[pestana] ?? [];
  const hayFiltros = !!(f.q || f.region || f.sector || f.nivel || f.fase || f.modalidad || f.tipo || f.min || f.max || f.entidad || f.orden === "reciente");
  return (
    <form method="get" action={rutaEn(base, "/proyectos")} className={cn("rounded-2xl border border-line bg-paper p-3 sm:p-4", className)} role="search" aria-label="Filtrar proyectos">
      {pestana !== "se_vienen" && <input type="hidden" name="pestana" value={pestana} />}
      {f.entidad && <input type="hidden" name="entidad" value={f.entidad} />}
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="relative block">
          <span className="sr-only">Qué buscas</span>
          <Search size={17} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input name="q" defaultValue={f.q ?? ""} placeholder="Agua potable, carretera, colegio, una municipalidad, un CUI…" maxLength={120} className={cn(CAMPO, "pl-10")} />
        </label>
        <label className="block">
          <span className="sr-only">Región</span>
          <select name="region" defaultValue={f.region ?? ""} className={CAMPO}>
            <option value="">Todo el Perú</option>
            {REGIONES_UBIGEO.map((r) => (
              <option key={r.ubigeo} value={r.ubigeo}>
                {r.nombre}
                {cuenta(facetas?.region, r.ubigeo)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Sector</span>
          <select name="sector" defaultValue={f.sector ?? ""} className={CAMPO}>
            <option value="">Todos los sectores</option>
            {SECTORES.map((s) => (
              <option key={s.clave} value={s.clave}>
                {s.nombre}
                {cuenta(facetas?.sector, s.clave)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
        <label className="block">
          <span className="text-rotulo font-medium text-mute">Quién la hace</span>
          <select name="nivel" defaultValue={f.nivel ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Todo el Estado</option>
            {NIVELES.map((n) => (
              <option key={n.clave} value={n.clave}>
                {n.nombre}
                {cuenta(facetas?.nivel, n.clave)}
              </option>
            ))}
          </select>
        </label>
        {fases.length > 0 ? (
          <label className="block">
            <span className="text-rotulo font-medium text-mute">Fase</span>
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
        <label className="block">
          <span className="text-rotulo font-medium text-mute">Modalidad</span>
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
        <label className="block">
          <span className="text-rotulo font-medium text-mute">Qué es</span>
          <select name="tipo" defaultValue={f.tipo ?? ""} className={cn(CAMPO, "mt-1")}>
            <option value="">Obras y equipos</option>
            {TIPOS_PROYECTO.map((t) => (
              <option key={t.clave} value={t.clave}>
                {t.nombre}
                {cuenta(facetas?.tipo, t.clave)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-rotulo font-medium text-mute">Costo desde (S/)</span>
          <input name="min" defaultValue={f.min ?? ""} inputMode="numeric" placeholder="0" maxLength={14} className={cn(CAMPO, "mt-1")} />
        </label>
        <label className="block">
          <span className="text-rotulo font-medium text-mute">Costo hasta (S/)</span>
          <input name="max" defaultValue={f.max ?? ""} inputMode="numeric" placeholder="Sin tope" maxLength={14} className={cn(CAMPO, "mt-1")} />
        </label>
        <label className="block">
          <span className="text-rotulo font-medium text-mute">Ordenar por</span>
          <select name="orden" defaultValue={f.orden ?? "monto"} className={cn(CAMPO, "mt-1")}>
            <option value="monto">Mayor costo</option>
            <option value="reciente">{pestana === "paralizadas" ? "Paralizadas hace menos" : pestana === "en_marcha" ? "Empezaron hace menos" : "Viables hace menos"}</option>
          </select>
        </label>
        <div className="col-span-2 flex items-end gap-2 md:col-span-4 xl:col-span-1">
          <button
            type="submit"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-granate px-5 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2 xl:flex-none"
          >
            <SlidersHorizontal size={16} aria-hidden /> Filtrar
          </button>
          {hayFiltros && (
            <Link
              href={`${rutaEn(base, "/proyectos")}${pestana !== "se_vienen" ? `?pestana=${pestana}` : ""}`}
              className="inline-flex min-h-11 items-center rounded-full px-3 text-dato font-semibold text-granate underline-offset-2 hover:underline"
            >
              Limpiar
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}
