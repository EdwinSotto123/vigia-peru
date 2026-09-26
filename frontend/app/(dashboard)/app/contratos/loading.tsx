import { Pagina } from "@/components/patrones";
import { IndicadoresSkeleton } from "@/components/listado";
import { Skeleton } from "@/components/ui/Skeleton";
import { TablaContratosSkeleton } from "@/components/contratos/TablaContratos";

/**
 * Espera de /app/contratos con la forma exacta de la página (plantilla Listado, §14.1):
 * encabezado, las cuatro cifras, la barra de filtros y la tabla, con las mismas piezas de
 * esqueleto que usan los `Suspense` de la página. Al llegar los datos nada salta de lugar;
 * el `loading.tsx` general del dashboard (título + llamita) dejaba un hueco distinto.
 *
 * Sólo se ve al ENTRAR a la ruta: al filtrar o paginar, la navegación es una transición y
 * lo anterior queda atenuado (ZonaResultados) en vez de volver al esqueleto.
 */
export default function ContratosLoading() {
  return (
    <Pagina className="space-y-5">
      <div role="status" aria-busy className="space-y-5">
        <span className="sr-only">Cargando los contratos…</span>
        <div className="space-y-3 border-b border-line pb-5" aria-hidden>
          <Skeleton className="h-8 w-64 max-w-full rounded-lg" />
          <Skeleton className="h-4 w-[30rem] max-w-full" />
        </div>
        <IndicadoresSkeleton n={4} />
        <Skeleton className="h-11 w-full rounded-xl" />
        <TablaContratosSkeleton />
      </div>
    </Pagina>
  );
}
