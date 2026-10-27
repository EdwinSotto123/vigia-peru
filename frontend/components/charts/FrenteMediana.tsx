import { soles } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Lo que cobra una persona frente a la mediana de su grupo (su cargo, los locadores de su entidad): dos barras en la
 * misma escala, desde cero, con el monto al lado. Se ve de un vistazo cuántas veces la mediana es, sin comparar dos
 * números de cabeza. La mediana en gris, la persona en granate; los montos, en texto. Server-safe.
 */
export function FrenteMediana({
  valor,
  mediana,
  etiquetaValor,
  etiquetaMediana,
  className,
}: {
  valor: number;
  mediana: number;
  etiquetaValor: string;
  etiquetaMediana: string;
  className?: string;
}) {
  if (!(valor > 0) || !(mediana > 0)) return null;
  const max = Math.max(valor, mediana);
  const veces = valor / mediana;
  const filas = [
    { etiqueta: etiquetaMediana, monto: mediana, barra: "bg-mute/45" },
    { etiqueta: etiquetaValor, monto: valor, barra: "bg-granate/80" },
  ];
  return (
    <figure className={cn("space-y-2 rounded-xl border border-line bg-paperSoft px-3.5 py-3", className)}>
      <dl className="space-y-2">
        {filas.map((f) => (
          <div key={f.etiqueta} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-x-3">
            <dt className="text-meta leading-tight text-inkSoft">{f.etiqueta}</dt>
            <dd aria-hidden className="h-2.5 rounded-full bg-paperDeep">
              <span className={cn("block h-full rounded-full", f.barra)} style={{ width: `${Math.max(2, (f.monto / max) * 100)}%` }} />
            </dd>
            <dd className="text-right font-mono text-meta tabular-nums text-ink">{soles(f.monto)}</dd>
          </div>
        ))}
      </dl>
      <figcaption className="text-rotulo text-mute">
        {veces >= 1.05
          ? `${veces.toFixed(1).replace(".", ",")} veces la mediana.`
          : veces <= 0.95
            ? `Por debajo de la mediana.`
            : "Casi igual a la mediana."}{" "}
        La mediana es el monto del medio: la mitad cobra menos y la otra mitad, más.
      </figcaption>
    </figure>
  );
}
