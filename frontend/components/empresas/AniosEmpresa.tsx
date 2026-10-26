import { numero, plural, soles, solesCompacto } from "@/lib/formato";
import type { AnioEmpresa } from "@/lib/empresas";

/**
 * Lo que la empresa recibió del Estado cada año: lo que ganó en contratos sola (barra llena) y lo que le compraron por
 * órdenes (barra clara), una fila por año, con el total escrito al lado. Lo ganado en consorcio no se apila (es el monto
 * de todo el consorcio) y va en la tabla. Un año con montos de posible error de carga lleva su aviso: no se suman.
 * Barras en CSS con su `title`; la tabla completa, plegada debajo. Server-safe.
 */
export function AniosEmpresa({ anual, nombre }: { anual: AnioEmpresa[]; nombre: string }) {
  if (!anual.length) return null;
  const total = (a: AnioEmpresa) => a.adjudicado + a.ordenado;
  const max = Math.max(1, ...anual.map(total));
  const filas = [...anual].sort((a, b) => b.anio - a.anio);
  const conConsorcio = anual.some((a) => a.enConsorcio > 0);
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-paper p-4" aria-labelledby="anios-titulo">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="anios-titulo" className="font-display text-bloque font-bold text-ink">Año por año</h3>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft" aria-label="Leyenda">
          <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-granate" aria-hidden />Contratos que ganó sola</li>
          <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-granate/35" aria-hidden />Órdenes de compra y de servicio</li>
        </ul>
      </div>
      <ol className="space-y-1.5" aria-label={`Lo que recibió ${nombre} cada año`}>
        {filas.map((a) => {
          const pa = (a.adjudicado / max) * 100;
          const po = (a.ordenado / max) * 100;
          const raro = a.contratosDudosos > 0 || a.dudosas > 0;
          return (
            <li key={a.anio} className="grid grid-cols-[3rem_minmax(0,1fr)_5.5rem] items-center gap-3">
              <span className="font-mono text-meta tabular-nums text-inkSoft">{a.anio}</span>
              <span
                className="flex h-3.5 w-full items-stretch gap-[2px]"
                title={`${a.anio}: ${soles(a.adjudicado)} en contratos, ${soles(a.ordenado)} en órdenes`}
              >
                {a.adjudicado > 0 && <span className="rounded-[3px] bg-granate" style={{ width: `${Math.max(0.6, pa)}%` }} />}
                {a.ordenado > 0 && <span className="rounded-[3px] bg-granate/35" style={{ width: `${Math.max(0.6, po)}%` }} />}
                {raro && <span className="ml-1 self-center text-micro font-semibold text-amberTexto" aria-label="con un posible error de carga aparte">▲</span>}
              </span>
              <span className="text-right font-mono text-meta tabular-nums text-ink">{solesCompacto(total(a))}</span>
            </li>
          );
        })}
      </ol>
      {anual.some((a) => a.contratosDudosos > 0 || a.dudosas > 0) && (
        <p className="text-meta text-mute">
          <span className="font-semibold text-amberTexto">▲</span> Ese año hay montos con un posible error de carga: se muestran en
          sus listas con su bandera y no entran en estas barras.
        </p>
      )}
      <details className="group rounded-xl border border-line/80 [.tarjeta_&]:rounded-none [.tarjeta_&]:border-x-0 [.tarjeta_&]:border-b-0">
        <summary className="cursor-pointer select-none px-3 py-2 text-meta font-semibold text-granate">Ver la tabla año por año</summary>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-meta">
            <thead className="bg-paperSoft text-left text-rotulo text-mute">
              <tr>
                <th className="px-3 py-2 font-medium">Año</th>
                <th className="px-3 py-2 text-right font-medium">Contratos sola</th>
                {conConsorcio && <th className="px-3 py-2 text-right font-medium">En consorcio (de todo el consorcio)</th>}
                <th className="px-3 py-2 text-right font-medium">Órdenes</th>
                <th className="px-3 py-2 text-right font-medium">Aparte, posible error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {filas.map((a) => (
                <tr key={a.anio}>
                  <td className="px-3 py-2 font-mono tabular-nums">{a.anio}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {soles(a.adjudicado)} <span className="font-sans text-mute">({plural(a.contratos, "proceso", "procesos")})</span>
                  </td>
                  {conConsorcio && (
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {a.enConsorcio ? <>{soles(a.adjudicadoConsorcio)} <span className="font-sans text-mute">({numero(a.enConsorcio)})</span></> : <span className="font-sans text-mute">Ninguno</span>}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {soles(a.ordenado)} <span className="font-sans text-mute">({plural(a.ordenes, "orden", "órdenes")})</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {a.contratosDudosos || a.dudosas ? soles(a.adjudicadoDudoso + a.ordenadoDudoso) : <span className="font-sans text-mute">Nada</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
