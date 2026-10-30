/**
 * Esqueletos de carga con la forma de la ficha final (rediseño 2026-10-30), para que nada salte cuando llegan los
 * datos: a la izquierda el objeto, la barra de pestañas y la tarjeta de «Por qué se bloqueó» (resumen y filas); a la
 * derecha la decisión y los datos (en el celular, debajo). El del informe imita la página pública.
 */

const Barra = ({ className = "" }: { className?: string }) => <div className={`animate-pulse rounded-md bg-paperDeep motion-reduce:animate-none ${className}`} />;

/** La decisión: el estado y los dos botones. */
export function EsqueletoDecision() {
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-paperSoft p-3.5" aria-hidden>
      <Barra className="h-5 w-40 rounded-full" />
      <div className="grid gap-2">
        <Barra className="h-10 rounded-full" />
        <Barra className="h-10 rounded-full" />
      </div>
    </div>
  );
}

/** Los datos del contrato y del análisis: filas de rótulo y valor. */
function EsqueletoDatos() {
  return (
    <div className="space-y-2 rounded-2xl border border-line bg-paperSoft p-3.5" aria-hidden>
      <Barra className="h-3 w-24" />
      {["w-32", "w-24", "w-20", "w-28", "w-24", "w-32"].map((w, i) => (
        <div key={i} className="flex gap-3"><Barra className="h-3.5 w-16" /><Barra className={`h-3.5 ${w}`} /></div>
      ))}
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

/**
 * Las filas de las señales mientras llegan: dentro de la tarjeta de «Por qué se bloqueó» (el resumen ya se ve y el
 * juicio del evaluador espera los nombres a tapar) o en el esqueleto entero. Se anuncia («Cargando…», como los
 * esqueletos del kit) salvo dentro del esqueleto de la página, que ya lo dice una vez.
 */
export function EsqueletoFilas({ anunciar = true }: { anunciar?: boolean }) {
  return (
    <div className="px-4 py-3 sm:px-5" role={anunciar ? "status" : undefined}>
      {anunciar && <span className="sr-only">Cargando el juicio del evaluador…</span>}
      <div aria-hidden>
        <Barra className="h-4 w-24" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5 border-b border-line py-2.5 last:border-0">
            <Barra className="h-4 w-4 rounded-full" />
            <Barra className="h-4 w-1/3" />
            <Barra className="ml-auto h-5 w-24 rounded-full" />
            <Barra className="hidden h-5 w-24 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** «Por qué se bloqueó» entera: el resumen arriba y las filas con ícono, nombre y etiquetas, separadas por filetes. */
export function EsqueletoPorQue({ anunciar = true }: { anunciar?: boolean }) {
  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-paperSoft">
      <div className="flex gap-2 px-4 py-3.5 sm:px-5" aria-hidden><Barra className="h-4 w-4 rounded-full" /><Barra className="h-4 w-2/3 max-w-lg" /></div>
      <EsqueletoFilas anunciar={anunciar} />
    </div>
  );
}

export function EsqueletoPagina() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:items-start" role="status">
      <span className="sr-only">Cargando la revisión…</span>
      <div className="min-w-0 space-y-3" aria-hidden>
        <Barra className="h-5 w-11/12" />
        <Barra className="h-5 w-2/3" />
        <Barra className="h-12 w-full rounded-2xl" />
        <EsqueletoPorQue anunciar={false} />
      </div>
      {/* Como la ficha: en el celular la decisión va en la barra de abajo, no en esta columna. */}
      <div className="flex flex-col gap-3" aria-hidden>
        <div className="hidden lg:block"><EsqueletoDecision /></div>
        <EsqueletoDatos />
      </div>
    </div>
  );
}
