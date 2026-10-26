import { Pagina } from "@/components/patrones";
import { IndicadoresSkeleton } from "@/components/listado";
import { Skeleton } from "@/components/ui/Skeleton";
import { TablaContratosCargando } from "@/components/contratos/TablaContratos";

/**
 * Espera de /app/contratos con la forma exacta de la página (plantilla Listado, §14.1):
 * migas, encabezado, las vistas, las cuatro cifras, la barra de filtros y la tabla, con las
 * mismas piezas de esqueleto que usan los `Suspense` de la página. Al llegar los datos nada
 * salta de lugar; el `loading.tsx` general del dashboard (título + llamita) dejaba un hueco
 * distinto.
 *
 * Una carga lenta (los cruces, una búsqueda amplia) no queda muda (§10.5): pasado 1 s, en el
 * renglón del paginador aparece qué se espera, con la llamita caminando (`TablaContratosCargando`).
 * El patrón `Cargando` del kit es una caja con renglones genéricos: aquí la forma la da la tabla.
 *
 * Sólo se ve al ENTRAR a la ruta: al filtrar o paginar, la navegación es una transición y
 * lo anterior queda en pantalla (atenuado al filtrar, en ZonaResultados) en vez de volver al esqueleto.
 */
export default function ContratosLoading() {
  return (
    <Pagina className="space-y-5">
      <div aria-hidden className="space-y-5">
        <Skeleton className="h-4 w-36 max-w-full" />
        <div className="space-y-3 border-b border-line pb-5">
          <Skeleton className="h-8 w-64 max-w-full rounded-lg" />
          <Skeleton className="h-4 w-[30rem] max-w-full" />
        </div>
        <Skeleton className="h-12 w-80 max-w-full rounded-full" />
        <IndicadoresSkeleton n={4} />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
      <TablaContratosCargando />
    </Pagina>
  );
}
