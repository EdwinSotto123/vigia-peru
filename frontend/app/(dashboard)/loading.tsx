import { Cargando } from "@/components/patrones";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Espera de navegación del dashboard. Next lo muestra al instante mientras el
 * server component de la ruta destino hace su fetch: el clic "responde" de
 * inmediato en vez de dejar la pantalla congelada.
 *
 * La forma es la de toda página del dashboard —título, bajada y el contenido
 * debajo— y el contenido es el patrón `Cargando` (DESIGN_SYSTEM.md §10.5): la
 * llamita caminando (quieta con movimiento reducido) y el esqueleto. Antes eran
 * cuatro tarjetas de métrica que ninguna página tiene arriba: la pantalla
 * saltaba al llegar el contenido real.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 px-4 py-8 sm:px-6 lg:px-10">
      <div className="space-y-3 border-b border-line pb-5" aria-hidden>
        <Skeleton className="h-8 w-72 max-w-full rounded-lg" />
        <Skeleton className="h-4 w-[32rem] max-w-full" />
      </div>
      <Cargando lineas={6} />
    </div>
  );
}
