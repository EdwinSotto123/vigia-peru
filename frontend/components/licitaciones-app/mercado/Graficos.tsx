import { numero, solesCompacto } from "@/lib/formato";

/**
 * Los gráficos de Mercado, en SVG propio (sin librería), con los tokens de la app: una serie, en el color de la marca;
 * ejes y rejilla apagados; el valor exacto al pasar el mouse (title) y siempre una tabla para el lector de pantalla.
 */
const MES = new Intl.DateTimeFormat("es-PE", { month: "short", timeZone: "UTC" });
const mes = (m: string) => MES.format(new Date(`${m.slice(0, 7)}-15T12:00:00Z`)).replace(".", "");

/** Lo adjudicado por mes: barras verticales con su monto, el mes debajo. */
export function BarrasMes({ serie }: { serie: { mes: string; procesos: number; monto: number }[] }) {
  const max = Math.max(1, ...serie.map((s) => s.monto));
  const ancho = 100 / Math.max(1, serie.length);
  return (
    <figure>
      <div className="relative h-44" aria-hidden>
        {[0.5, 1].map((t) => (
          <span key={t} className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${t * 100}%` }} />
        ))}
        <div className="absolute inset-0 flex items-end gap-[3px]">
          {serie.map((s) => (
            <div key={s.mes} className="group relative flex h-full flex-1 items-end" style={{ maxWidth: `${ancho}%` }} title={`${mes(s.mes)}: ${solesCompacto(s.monto)} en ${numero(s.procesos)} procesos`}>
              <div className="w-full rounded-t-[4px] bg-granate/80 transition-colors duration-rapido group-hover:bg-granate" style={{ height: `${Math.max(2, (s.monto / max) * 100)}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex gap-[3px]" aria-hidden>
        {serie.map((s, i) => (
          <span key={s.mes} className="flex-1 text-center text-rotulo capitalize text-mute">{i % 2 === 0 || serie.length <= 8 ? mes(s.mes) : ""}</span>
        ))}
      </div>
      <figcaption className="mt-2 text-meta text-mute">Lo adjudicado por mes. El tope del gráfico: {solesCompacto(max)}.</figcaption>
      <table className="sr-only">
        <caption>Adjudicado por mes</caption>
        <thead>
          <tr>
            <th>Mes</th>
            <th>Procesos</th>
            <th>Adjudicado</th>
          </tr>
        </thead>
        <tbody>
          {serie.map((s) => (
            <tr key={s.mes}>
              <td>{s.mes}</td>
              <td>{s.procesos}</td>
              <td>{solesCompacto(s.monto)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Una lista con su barra horizontal (las regiones): nombre, barra y cifra. */
export function BarrasLista({ filas }: { filas: { nombre: string; valor: number; detalle: string }[] }) {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return (
    <ul className="space-y-2.5">
      {filas.map((f) => (
        <li key={f.nombre} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3 text-dato">
          <span className="truncate text-ink" title={f.nombre}>{f.nombre}</span>
          <span className="h-2 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
            <span className="block h-full rounded-full bg-granate/80" style={{ width: `${Math.max(2, (f.valor / max) * 100)}%` }} />
          </span>
          <span className="whitespace-nowrap text-right text-meta tabular-nums text-inkSoft">{f.detalle}</span>
        </li>
      ))}
    </ul>
  );
}
