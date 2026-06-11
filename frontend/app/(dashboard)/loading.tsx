/**
 * Skeleton de navegación del dashboard. Next lo muestra al instante mientras
 * el server component de la ruta destino hace su fetch — así el click "responde"
 * de inmediato en vez de dejar la pantalla congelada.
 */
export default function DashboardLoading() {
  return (
    <div className="px-6 py-8 lg:px-10" aria-busy="true" aria-label="Cargando">
      <div className="animate-pulse space-y-6">
        <div className="space-y-2">
          <div className="h-3 w-32 rounded bg-paperDeep" />
          <div className="h-7 w-72 rounded bg-paperDeep" />
          <div className="h-3 w-96 max-w-full rounded bg-paperSoft" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="surface h-24 p-4">
              <div className="h-3 w-16 rounded bg-paperDeep" />
              <div className="mt-3 h-6 w-20 rounded bg-paperSoft" />
            </div>
          ))}
        </div>
        <div className="surface divide-y divide-line p-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-4">
              <div className="h-12 w-12 shrink-0 rounded-xl bg-paperDeep" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-40 rounded bg-paperSoft" />
                <div className="h-4 w-3/4 rounded bg-paperDeep" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
