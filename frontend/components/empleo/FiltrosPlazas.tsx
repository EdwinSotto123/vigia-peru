"use client";

import { useRouter } from "next/navigation";
import { useRef, type FormEvent } from "react";
import { SlidersHorizontal } from "lucide-react";
import { NIVEL, NIVELES_ORDEN, REGIONES_EMPLEO, nombreRegion, qsEmpleo, slugRegion, type Conteo, type FiltrosEmpleo, type NivelEmpleo } from "@/lib/empleo";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";

const CAMPO =
  "h-11 w-full min-w-0 rounded-xl border border-line bg-paper px-3 text-destacado text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato";

const SUELDOS = [
  { v: "", e: "Cualquier sueldo" },
  { v: "2500", e: "Desde S/ 2,500" },
  { v: "4000", e: "Desde S/ 4,000" },
  { v: "6000", e: "Desde S/ 6,000" },
  { v: "10000", e: "Desde S/ 10,000" },
];
const EXPERIENCIA = [
  { v: "", e: "Cualquier experiencia" },
  { v: "1", e: "Hasta 1 año" },
  { v: "2", e: "Hasta 2 años" },
  { v: "3", e: "Hasta 3 años" },
  { v: "5", e: "Hasta 5 años" },
];

/**
 * Los filtros de /plazas: cambiar un desplegable aplica el filtro (la URL cambia y la lista se vuelve a pedir); el texto,
 * con Enter o el botón. Sin JavaScript también funciona: es un formulario GET con su botón. Cada región y cada nivel dice
 * cuántas plazas tiene con los demás filtros puestos.
 */
export function FiltrosPlazas({ base, filtros, facetas }: { base: string; filtros: FiltrosEmpleo; facetas: { region: Conteo[]; nivel: Conteo[] } }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const porRegion = new Map(facetas.region.map((f) => [f.clave, f.n]));
  const porNivel = new Map(facetas.nivel.map((f) => [f.clave, f.n]));

  const aplicar = (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!form.current) return;
    const d = new FormData(form.current);
    const v = (k: string) => String(d.get(k) ?? "").trim() || undefined;
    const f: FiltrosEmpleo = {
      q: v("q"),
      region: v("region"),
      nivel: v("nivel") as NivelEmpleo | undefined,
      sueldo: v("sueldo") ? Number(v("sueldo")) : undefined,
      exp: v("exp") ? Number(v("exp")) : undefined,
      cierra: v("cierra") as FiltrosEmpleo["cierra"],
      senal: filtros.senal,
      orden: (v("orden") as FiltrosEmpleo["orden"]) ?? "cierre",
    };
    router.push(`${rutaEn(base, "/plazas")}${qsEmpleo(f)}`);
  };
  const cambio = () => aplicar();

  return (
    <form ref={form} onSubmit={aplicar} action={rutaEn(base, "/plazas")} method="get" className="rounded-2xl border border-line bg-paper p-3 sm:p-4" aria-label="Filtrar plazas">
      <div className="flex min-w-0 gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Puesto, entidad o lugar</span>
          <input name="q" type="search" defaultValue={filtros.q} placeholder="Puesto, entidad o lugar" maxLength={80} className={CAMPO} />
        </label>
        <button type="submit" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-granate px-4 text-dato font-semibold text-paper hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate">
          <SlidersHorizontal size={16} aria-hidden />
          <span className="max-sm:sr-only">Filtrar</span>
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-6">
        <label className="min-w-0">
          <span className="sr-only">Región</span>
          <select name="region" defaultValue={filtros.region ?? ""} onChange={cambio} className={CAMPO}>
            <option value="">Todas las regiones</option>
            {REGIONES_EMPLEO.map((r) => (
              <option key={r} value={slugRegion(r)}>
                {nombreRegion(r)} ({numero(porRegion.get(r) ?? 0)})
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="sr-only">Estudios que piden</span>
          <select name="nivel" defaultValue={filtros.nivel ?? ""} onChange={cambio} className={CAMPO}>
            <option value="">Cualquier estudio</option>
            {NIVELES_ORDEN.map((n) => (
              <option key={n} value={n}>
                {NIVEL[n].largo} ({numero(porNivel.get(n) ?? 0)})
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="sr-only">Sueldo mínimo</span>
          <select name="sueldo" defaultValue={filtros.sueldo ? String(filtros.sueldo) : ""} onChange={cambio} className={CAMPO}>
            {SUELDOS.map((s) => (
              <option key={s.v} value={s.v}>
                {s.e}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="sr-only">Experiencia que tienes</span>
          <select name="exp" defaultValue={filtros.exp != null ? String(filtros.exp) : ""} onChange={cambio} className={CAMPO}>
            {EXPERIENCIA.map((s) => (
              <option key={s.v} value={s.v}>
                {s.e}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="sr-only">Cuándo cierra</span>
          <select name="cierra" defaultValue={filtros.cierra ?? ""} onChange={cambio} className={CAMPO}>
            <option value="">Cierre: cualquier día</option>
            <option value="hoy">Cierran hoy</option>
            <option value="2dias">Cierran en 2 días</option>
            <option value="semana">Cierran esta semana</option>
          </select>
        </label>
        <label className="min-w-0">
          <span className="sr-only">Ordenar</span>
          <select name="orden" defaultValue={filtros.orden ?? "cierre"} onChange={cambio} className={CAMPO}>
            <option value="cierre">Cierran primero</option>
            <option value="sueldo">Mejor pagadas</option>
            <option value="reciente">Más recientes</option>
            <option value="vacantes">Más vacantes</option>
          </select>
        </label>
      </div>
    </form>
  );
}
