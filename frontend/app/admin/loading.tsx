"use client";

import { usePathname } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Lo que se pinta al instante al cambiar de página en el panel, mientras llega la
 * página nueva (su código y, en dev, su compilación). Usa el mismo AdminShell que
 * las páginas: la barra lateral no parpadea y el encabezado ya dice a dónde vas.
 * Los datos no se esperan acá: cada página pinta sus propios esqueletos por tarjeta.
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
  return (
    // Subtítulo de un espacio: el encabezado ya ocupa sus dos líneas y no salta al llegar la página.
    <AdminShell title={titulo} subtitle={" "}>
      <div aria-busy="true" aria-label="Cargando">
        {pathname === "/admin" ? <CuerpoResumen /> : pathname.startsWith("/admin/procesamientos") ? <CuerpoProcesamiento /> : <CuerpoTabla />}
      </div>
    </AdminShell>
  );
}

const Caja = ({ className }: { className: string }) => (
  <div className={`rounded-2xl border border-line bg-paper p-4 ${className}`}>
    <Skeleton className="h-3 w-24" />
    <Skeleton className="mt-3 h-6 w-20" />
    <Skeleton className="mt-2 h-3 w-4/5" />
  </div>
);

function CuerpoResumen() {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => <Caja key={i} className="h-[76px] px-5 py-4" />)}
      </div>
      <Skeleton className="mt-6 h-3 w-12" />
      <div className="mt-2 grid gap-3 md:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => <Caja key={i} className="h-28" />)}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <Lista key={i} filas={6} />)}
      </div>
    </>
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

function Lista({ filas, className = "" }: { filas: number; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-paper p-5 ${className}`}>
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
