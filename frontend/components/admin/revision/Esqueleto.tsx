/**
 * Esqueletos de carga con la forma de la página final (barra de decisión, informe con su columna
 * lateral, juicio del evaluador), para que nada salte cuando llegan los datos.
 */

const Barra = ({ className = "" }: { className?: string }) => <div className={`animate-pulse rounded-md bg-paperDeep motion-reduce:animate-none ${className}`} />;

export function EsqueletoDecision() {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4 sm:p-5" aria-hidden>
      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex gap-2"><Barra className="h-5 w-40 rounded-full" /><Barra className="h-5 w-28" /></div>
          <Barra className="h-5 w-11/12" />
          <Barra className="h-4 w-3/4" />
          <Barra className="mt-4 h-3 w-40" />
          <Barra className="h-4 w-full max-w-xl" />
          <Barra className="h-3 w-2/3 max-w-md" />
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 lg:w-60 lg:grid-cols-1">
          <Barra className="h-10 rounded-xl" />
          <Barra className="h-10 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function EsqueletoInforme() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),360px]" role="status" aria-label="Cargando el informe">
      <div className="min-w-0 space-y-3">
        <div className="space-y-2 rounded-2xl border border-line p-4"><Barra className="h-3 w-24" /><Barra className="h-6 w-5/6" /></div>
        <div className="space-y-2 rounded-2xl border border-line p-4"><Barra className="h-4 w-1/2" /><Barra className="h-3 w-full" /><Barra className="h-3 w-4/5" /></div>
        <div className="flex gap-1 overflow-hidden rounded-2xl border border-line p-1.5">
          {["w-16", "w-20", "w-24", "w-24", "w-20", "w-16", "w-24"].map((w, i) => <Barra key={i} className={`h-8 shrink-0 rounded-xl ${w}`} />)}
        </div>
        <div className="space-y-2 rounded-2xl border border-line p-4">
          <Barra className="h-4 w-1/3" /><Barra className="h-16 w-full" /><Barra className="h-16 w-full" />
        </div>
      </div>
      <div className="hidden space-y-3 lg:block">
        <div className="flex gap-3 rounded-2xl border border-line p-4"><Barra className="h-16 w-16 rounded-xl" /><div className="flex-1 space-y-2"><Barra className="h-3 w-24" /><Barra className="h-4 w-32" /></div></div>
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-line p-3"><Barra className="h-10" /><Barra className="h-10" /><Barra className="h-10" /></div>
      </div>
    </div>
  );
}

export function EsqueletoPorQue() {
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5" aria-hidden>
      <Barra className="h-3 w-32" />
      <Barra className="h-3 w-2/3 max-w-lg" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3 border-t border-line pt-3">
          <Barra className="h-5 w-5 rounded-full" />
          <div className="flex-1 space-y-1.5"><Barra className="h-4 w-1/2" /><Barra className="h-3 w-full" /></div>
        </div>
      ))}
    </div>
  );
}

export function EsqueletoPagina() {
  return (
    <div className="space-y-6">
      <EsqueletoDecision />
      <div className="overflow-hidden rounded-2xl border border-line bg-paper">
        <div className="border-b border-line bg-paperSoft px-4 py-2"><Barra className="h-3 w-48" /></div>
        <div className="px-3 py-4 sm:px-6 sm:py-6"><EsqueletoInforme /></div>
      </div>
      <EsqueletoPorQue />
    </div>
  );
}
