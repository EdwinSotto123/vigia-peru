import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CalendarClock, Clock, GraduationCap, MapPin, RotateCcw, Search, SearchX } from "lucide-react";
import { CabeceraPagina, Caja, Pagina, VacioCaja } from "@/components/gobserva/app/Caja";
import { Chip, tonoCierre } from "@/components/empleo/TarjetaPlaza";
import { EstadoError } from "@/components/licitaciones-app/ui/Estados";
import { Paginacion } from "@/components/licitaciones-app/ui/Paginacion";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { diasParaCierre, entidadNombre, lugar, nombreRegion, puesto, slugRegion, textoCierre } from "@/lib/empleo";
import {
  MODALIDAD, filtrosPracticas, getPracticas, leerRequerimientos, qsPracticas, textoDuracion, type FiltrosPracticas, type Practica,
} from "@/lib/empleo-practicas";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prácticas", robots: { index: false, follow: false } };

const POR_PAGINA = 20;
type Props = { searchParams?: Record<string, string | string[] | undefined> };

/**
 * Las prácticas del Estado en la app de Empleo (2026-11-08, docs/automatizacion_cas.md fase 0): las preprofesionales
 * (para estudiantes) y las profesionales (para egresados) que publican las entidades en Talento Perú, con su subvención.
 * Arriba la modalidad como pestañas, la búsqueda y la región; cada práctica abre su ficha. Todo en la URL.
 */
export default async function PracticasApp({ searchParams }: Props) {
  const base = baseProducto("empleo");
  const f = filtrosPracticas(searchParams);
  const d = await getPracticas(f, POR_PAGINA);
  const lista = rutaEn(base, "/app/practicas");
  const pagina = f.page ?? 1;
  const paginas = d ? Math.max(1, Math.ceil(d.total / POR_PAGINA)) : 1;
  const enModalidad = (k: string) => d?.porModalidad.find((x) => x.clave === k)?.n ?? 0;
  const todas = (d?.porModalidad ?? []).reduce((a, x) => a + x.n, 0);
  const pestanas: { clave: FiltrosPracticas["modalidad"]; texto: string; n: number }[] = [
    { clave: undefined, texto: "Todas", n: todas },
    { clave: "practica_pre", texto: "Preprofesionales", n: enModalidad("practica_pre") },
    { clave: "practica_pro", texto: "Profesionales", n: enModalidad("practica_pro") },
  ];

  return (
    <Pagina>
      <CabeceraPagina
        titulo="Prácticas en el Estado"
        bajada="Las preprofesionales son para estudiantes y las profesionales para egresados. Todas pagan una subvención mensual y cuentan como experiencia laboral (Ley 31396)."
      />

      <nav aria-label="Modalidad" className="-mx-4 mb-4 border-b border-line px-4 sm:mx-0 sm:px-0">
        <ul className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {pestanas.map((p) => {
            const activa = p.clave === f.modalidad;
            return (
              <li key={p.texto} className="shrink-0">
                <Link
                  href={`${lista}${qsPracticas({ ...f, modalidad: p.clave, page: undefined })}`}
                  aria-current={activa ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-dato font-semibold transition-colors duration-rapido",
                    activa ? "border-granate text-ink" : "border-transparent text-inkSoft hover:border-ink/20 hover:text-ink",
                  )}
                >
                  {p.texto}
                  <span className={cn("rounded-full px-1.5 text-rotulo tabular-nums", activa ? "bg-granate-50 text-granate" : "bg-ink/[0.06] text-inkSoft")}>{numero(p.n)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <form action={lista} method="get" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        {f.modalidad && <input type="hidden" name="modalidad" value={f.modalidad} />}
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-meta font-semibold text-inkSoft">Carrera, puesto o entidad</span>
          <span className="relative block">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <input
              name="q"
              defaultValue={f.q ?? ""}
              minLength={2}
              maxLength={80}
              placeholder="Derecho, contabilidad, Indecopi…"
              className="h-11 w-full rounded-lg border border-line bg-caja pl-9 pr-3 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato"
            />
          </span>
        </label>
        <label className="sm:w-56">
          <span className="mb-1 block text-meta font-semibold text-inkSoft">Región</span>
          <select
            name="region"
            defaultValue={f.region ?? ""}
            className="h-11 w-full rounded-lg border border-line bg-caja px-3 text-destacado text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato"
          >
            <option value="">Todo el país</option>
            {(d?.porRegion ?? []).map((r) => (
              <option key={r.clave} value={slugRegion(r.clave)}>
                {nombreRegion(r.clave)} ({numero(r.n)})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={cn(claseAccion("primario"), "h-11 justify-center")}>
          <Search size={15} aria-hidden /> Buscar
        </button>
      </form>

      {!d ? (
        <Caja>
          <EstadoError
            titulo="No pudimos leer las prácticas ahora"
            texto="Suele pasar un momento. Vuelve a intentarlo: tu búsqueda se mantiene."
            acciones={
              <Link href={`${lista}${qsPracticas(f)}`} className={claseAccion("secundario")}>
                <RotateCcw size={15} aria-hidden /> Volver a intentar
              </Link>
            }
          />
        </Caja>
      ) : d.data.length === 0 ? (
        <Caja>
          <VacioCaja
            Icono={SearchX}
            titulo="No hay prácticas abiertas con estos filtros"
            texto="Prueba con otra carrera o quita la región. Las entidades publican prácticas nuevas casi todos los días."
            accion={<Link href={lista} className={claseAccion("primario")}>Ver todas las prácticas</Link>}
          />
        </Caja>
      ) : (
        <>
          <p className="mb-2 text-meta text-mute">
            {numero(d.total)} {d.total === 1 ? "práctica abierta" : "prácticas abiertas"}
            {d.actualizado ? `, al ${d.actualizado.slice(8, 10)}/${d.actualizado.slice(5, 7)} a las ${d.actualizado.slice(11, 16)}` : ""}. Las que cierran primero, arriba.
          </p>
          <ol className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Prácticas">
            {d.data.map((p) => (
              <li key={p.id} className="min-w-0">
                <TarjetaPractica p={p} href={rutaEn(base, `/app/practica/${p.id}`)} />
              </li>
            ))}
          </ol>
          <div className="mt-4">
            <Paginacion
              pagina={pagina}
              paginas={paginas}
              total={d.total}
              tamano={POR_PAGINA}
              href={(n) => `${lista}${qsPracticas({ ...f, page: n === 1 ? undefined : n })}`}
              nombre="prácticas"
            />
          </div>
        </>
      )}
    </Pagina>
  );
}

function TarjetaPractica({ p, href }: { p: Practica; href: string }) {
  const dias = diasParaCierre(p.fechaFin);
  const r = leerRequerimientos(p.requerimientos);
  const MAX = 3;
  const carreras = r.carreras.slice(0, MAX);
  const resto = r.carreras.length - carreras.length;
  const duracion = textoDuracion(p);
  return (
    <Link
      href={href}
      className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-caja p-4 shadow-caja transition-colors duration-rapido hover:border-granate/50 sm:p-5"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-pretty font-display text-cuerpo font-bold leading-snug text-ink">{puesto(p.titulo)}</p>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-meta text-inkSoft">
            <Building2 size={14} aria-hidden className="shrink-0 text-mute" />
            <span className="min-w-0">{entidadNombre(p.entidad)}</span>
          </p>
        </div>
        <p className="shrink-0 text-right">
          <span className="block font-display text-cuerpo font-bold tabular-nums text-ink">{p.subvencion ? `S/ ${numero(p.subvencion)}` : "Sin dato"}</span>
          <span className="block text-rotulo text-mute">al mes</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tono="bien" icono={<GraduationCap size={13} aria-hidden />}>{MODALIDAD[p.modalidad]?.corto ?? "Prácticas"}</Chip>
        <Chip tono={tonoCierre(dias)} icono={<CalendarClock size={13} aria-hidden />}>{textoCierre(dias)}</Chip>
        {p.ubicacion && <Chip icono={<MapPin size={13} aria-hidden />}>{lugar(p.ubicacion)}</Chip>}
      </div>
      {(r.condicion || carreras.length > 0) && (
        <p className="text-meta leading-relaxed text-inkSoft">
          {r.condicion && <b className="font-semibold text-ink">{r.condicion}</b>}
          {r.condicion && carreras.length > 0 ? " de " : ""}
          {carreras.map((c) => puesto(c)).join(", ")}
          {resto > 0 ? ` y ${resto} ${resto === 1 ? "carrera más" : "carreras más"}` : ""}
        </p>
      )}
      {duracion && (
        <p className="mt-auto flex items-center gap-1.5 text-rotulo text-mute">
          <Clock size={13} aria-hidden className="shrink-0" /> {duracion}
        </p>
      )}
    </Link>
  );
}

