import { numero, soles } from "@/lib/formato";

/** Dónde cae lo que paga la plaza entre las plazas iguales, en una frase (la usan la figura y el resumen de la ficha). */
export function fraseSueldo(sueldo: number | null, p25: number, mediana: number, p75: number): string {
  if (sueldo == null) return "Esta plaza no dice cuánto paga.";
  if (sueldo > p75) return "Paga más que la mayoría de plazas iguales.";
  if (sueldo >= mediana) return "Paga por encima de la mediana de plazas iguales.";
  if (sueldo >= p25) return "Paga por debajo de la mediana de plazas iguales.";
  return "Paga menos que la mayoría de plazas iguales.";
}

/**
 * Lo que paga esta plaza frente a lo que pagan otras entidades por el mismo puesto: una pista con la franja del medio
 * (del 25 % al 75 % de las plazas iguales), la mediana marcada y el sueldo de esta plaza como un punto. Debajo, en una
 * frase, dónde cae. Sólo con tres plazas iguales o más (la API no compara con menos). Server-safe.
 */
export function RangoSueldo({
  sueldo,
  p25,
  mediana,
  p75,
  plazas,
  entidades,
}: {
  sueldo: number | null;
  p25: number | null;
  mediana: number | null;
  p75: number | null;
  plazas: number;
  entidades: number;
}) {
  if (mediana == null || p25 == null || p75 == null) return null;
  const valores = [p25, mediana, p75, ...(sueldo ? [sueldo] : [])];
  const min = Math.min(...valores) * 0.85;
  const max = Math.max(...valores) * 1.1;
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  const frase = fraseSueldo(sueldo, p25, mediana, p75);
  return (
    <figure className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <figcaption className="text-dato leading-relaxed text-inkSoft">
        <b className="text-ink">{frase}</b> Comparada con {numero(plazas)} plazas del mismo puesto en {numero(entidades)} {entidades === 1 ? "entidad" : "entidades"}.
      </figcaption>
      <div className="relative mt-8 h-3" role="img" aria-label={`Mediana de plazas iguales: ${soles(mediana)}; la mitad del medio va de ${soles(p25)} a ${soles(p75)}${sueldo ? `; esta plaza: ${soles(sueldo)}` : ""}.`}>
        <span aria-hidden className="absolute inset-0 rounded-full bg-paperDeep" />
        <span aria-hidden className="absolute inset-y-0 rounded-full bg-granate/30" style={{ left: pos(p25), width: `calc(${pos(p75)} - ${pos(p25)})` }} />
        <span aria-hidden className="absolute -top-1 h-5 w-0.5 -translate-x-1/2 rounded bg-ink/60" style={{ left: pos(mediana) }} />
        {sueldo != null && (
          <span aria-hidden className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-paper bg-granate shadow" style={{ left: pos(sueldo) }}>
            <span className="absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-granate px-1.5 py-0.5 font-mono text-rotulo font-semibold text-paper">
              {soles(sueldo)}
            </span>
          </span>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-rotulo text-mute">Las que menos pagan</dt>
          <dd className="font-mono text-dato font-semibold tabular-nums text-ink">{soles(p25)}</dd>
        </div>
        <div>
          <dt className="text-rotulo text-mute">Mediana</dt>
          <dd className="font-mono text-dato font-semibold tabular-nums text-ink">{soles(mediana)}</dd>
        </div>
        <div>
          <dt className="text-rotulo text-mute">Las que más pagan</dt>
          <dd className="font-mono text-dato font-semibold tabular-nums text-ink">{soles(p75)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-rotulo text-mute">«Las que menos» y «las que más»: el 25 % de abajo y de arriba de las plazas iguales.</p>
    </figure>
  );
}
