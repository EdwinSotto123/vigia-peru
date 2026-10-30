"use client";

import { usePathname } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Lo que se pinta al instante al cambiar de página en el panel, mientras llega la
 * página nueva (su código y, en dev, su compilación). Usa el mismo AdminShell que
 * las páginas: la barra lateral no parpadea y el encabezado ya dice a dónde vas.
 * Los datos no se esperan acá: cada página pinta sus propios esqueletos por tarjeta.
 * Resumen, Clasificación y Análisis tienen el suyo, con la forma del rediseño del
 * 2026-10-30 (nada salta al llegar la página); las demás, uno genérico.
 */

const TITULOS: [string, string][] = [
  ["/admin/contribuciones", "Contribuciones"],
  ["/admin/financiadores", "Financiadores"],
  ["/admin/pagos", "Medios de pago"],
  ["/admin/revision/", "Revisión"],
  ["/admin/revision", "Revisión humana"],
  ["/admin/procesamientos", "Procesamiento"],
  ["/admin/clasificacion", "Clasificación"],
  ["/admin/cobertura", "Cobertura"],
  ["/admin/analisis", "Análisis a demanda"],
  ["/admin/bitacora", "Bitácora"],
  ["/admin/equipo", "Equipo"],
];

export default function AdminLoading() {
  const pathname = usePathname() ?? "/admin";
  // El login no lleva el panel alrededor.
  if (pathname.startsWith("/admin/login")) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paperDeep p-6" aria-busy="true" aria-label="Cargando">
        <Skeleton className="h-72 w-full max-w-sm rounded-2xl" />
      </div>
    );
  }
  const titulo = pathname === "/admin" ? "Resumen" : TITULOS.find(([p]) => pathname.startsWith(p))?.[1] ?? "Panel";
  const cuerpo =
    pathname === "/admin" ? <CuerpoResumen />
    : pathname.startsWith("/admin/clasificacion") ? <CuerpoClasificacion />
    : pathname.startsWith("/admin/analisis") ? <CuerpoAnalisis />
    : pathname.startsWith("/admin/procesamientos") ? <CuerpoProcesamiento />
    : <CuerpoTabla />;
  return (
    // Subtítulo de un espacio: el encabezado ya ocupa sus dos líneas y no salta al llegar la página.
    <AdminShell title={titulo} subtitle={" "}>
      <div aria-busy="true" aria-label="Cargando">
        {cuerpo}
      </div>
    </AdminShell>
  );
}

const Caja = ({ className }: { className: string }) => (
  <div className={`rounded-2xl border border-line bg-paperSoft p-4 ${className}`}>
    <Skeleton className="h-3 w-24" />
    <Skeleton className="mt-3 h-6 w-20" />
    <Skeleton className="mt-2 h-3 w-4/5" />
  </div>
);

/** El título de una sección (PageSection): la línea que va sobre cada bloque. */
const Titulo = ({ className = "" }: { className?: string }) => <Skeleton className={`h-4 w-40 ${className}`} />;

/** Una cifra suelta (StatCard): etiqueta y número, en dos líneas. */
const Cifra = ({ className = "" }: { className?: string }) => (
  <div className={`rounded-2xl border border-line bg-paperSoft px-3.5 py-2.5 ${className}`}>
    <Skeleton className="h-3 w-28" />
    <Skeleton className="mt-2 h-5 w-14" />
  </div>
);

/** Una franja de cifras (StatGrid de sólo lectura): UNA caja con las cifras adentro, sin marco cada una. `deADos`: dos por fila siempre. */
function Franja({ n, deADos = false }: { n: number; deADos?: boolean }) {
  return (
    <div className={`grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl border border-line bg-paperSoft px-6 py-5 ${deADos ? "" : "lg:grid-cols-4"}`}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2.5 h-7 w-16" />
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Resumen: tres cifras sueltas y dos columnas (salud, cola y últimos; plata y bitácora). */
function CuerpoResumen() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <Titulo />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Cifra className="col-span-2 sm:col-span-1" />
          <Cifra />
          <Cifra />
        </div>
      </div>
      <div className="grid items-start gap-4 sm:gap-6 xl:grid-cols-2">
        <div className="space-y-4 sm:space-y-6">
          <div>
            <Titulo />
            <Filas filas={5} className="mt-3" />
          </div>
          <div>
            <Titulo />
            <div className="mt-3 space-y-3 rounded-2xl border border-line bg-paperSoft px-4 py-3">
              <Skeleton className="hidden h-2 w-full rounded-full sm:block" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
          <div>
            <Titulo />
            <Filas filas={5} className="mt-3" />
          </div>
        </div>
        <div className="space-y-4 sm:space-y-6">
          <div>
            <Titulo />
            <div className="mt-3">
              <Franja n={4} deADos />
            </div>
          </div>
          <div>
            <Titulo />
            <Filas filas={6} className="mt-3" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Clasificación: el formulario de la cola, la franja de cifras y la matriz tipo × etapa. */
function CuerpoClasificacion() {
  return (
    <div className="space-y-6">
      <div>
        <Titulo />
        <div className="mt-3 space-y-2.5 rounded-2xl border border-line bg-paperSoft p-3">
          {[6, 5, 1].map((n, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <Skeleton className="mr-1 h-3 w-12" />
              {Array.from({ length: n }, (_, j) => <Skeleton key={j} className="h-[34px] w-24 rounded-full" />)}
            </div>
          ))}
        </div>
      </div>
      <div>
        <Titulo />
        <div className="mt-3 space-y-3">
          <Franja n={4} />
          <Filas filas={6} />
        </div>
      </div>
    </div>
  );
}

/** Análisis a demanda: el campo de despacho y la lista con su buscador y su fila de filtros. */
function CuerpoAnalisis() {
  return (
    <div className="space-y-6">
      <div>
        <Titulo className="w-56" />
        <Skeleton className="mt-2 h-3 w-72 max-w-full" />
        <Skeleton className="mt-3 h-12 w-full rounded-xl" />
      </div>
      <div>
        <Titulo />
        <Skeleton className="mt-3 h-10 w-full max-w-sm rounded-xl" />
        <div className="mt-2 flex gap-1.5 overflow-hidden">
          {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-[34px] w-24 shrink-0 rounded-full" />)}
        </div>
        <Filas filas={8} className="mt-3" />
      </div>
    </div>
  );
}

function CuerpoProcesamiento() {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Caja key={i} className="h-24" />)}
      </div>
      <Skeleton className="mt-6 h-5 w-28" />
      <Lista filas={8} className="mt-3" />
    </>
  );
}

function CuerpoTabla() {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Caja key={i} className="h-24" />)}
      </div>
      <Lista filas={8} className="mt-6" />
    </>
  );
}

/** Una lista con separadores, sin título adentro (el título va afuera, como en PageSection). */
function Filas({ filas, className = "" }: { filas: number; className?: string }) {
  return (
    <ul className={`divide-y divide-line rounded-2xl border border-line bg-paperSoft ${className}`}>
      {Array.from({ length: filas }, (_, i) => (
        <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="h-3 w-16" />
        </li>
      ))}
    </ul>
  );
}

function Lista({ filas, className = "" }: { filas: number; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-paperSoft p-5 ${className}`}>
      <Skeleton className="h-4 w-40" />
      <ul className="mt-3 divide-y divide-line">
        {Array.from({ length: filas }, (_, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-2.5">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3 w-16" />
          </li>
        ))}
      </ul>
    </section>
  );
}
