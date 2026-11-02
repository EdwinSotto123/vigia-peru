import { Skeleton } from "@/components/ui/Skeleton";

/**
 * La espera de navegación de un producto de Gobserva (2026-11-02): Next la muestra al instante bajo la cabecera del
 * producto mientras el servidor arma la página de destino, en vez de dejar la pantalla congelada en la anterior hasta
 * que llega la nueva. Además, con este límite de carga la precarga de cada enlace sólo trae esta forma (y no la página
 * entera con sus consultas a la API): la lista de Licitaciones precargaba sus 20 fichas completas. La forma es la de
 * las páginas del producto: migas, título, bajada y una lista. Server-safe.
 */
export function CargandoProducto() {
  return (
    <div className="container-page py-6 sm:py-10" role="status" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <Skeleton className="h-4 w-40 rounded-full" />
      <Skeleton className="mt-4 h-9 w-[28rem] max-w-full rounded-lg" />
      <Skeleton className="mt-3 h-4 w-[36rem] max-w-full" />
      <div className="mt-8 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2.5">
                <Skeleton className="h-5 w-3/4 rounded-md" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
              </div>
              <Skeleton className="h-6 w-20 shrink-0 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
