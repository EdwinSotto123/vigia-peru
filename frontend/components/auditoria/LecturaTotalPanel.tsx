import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { BarraSegmentada, Medidor, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { Ayuda } from "@/components/patrones";
import { fechaCorta, numero, relativo } from "@/lib/formato";
import type { LecturaTotal } from "@/lib/auditoria";

/**
 * Todo lo que Vigía leyó y lo que costó leerlo (2026-11-14: «hemos procesado miles de contratos y en la auditoría no
 * sale, ni cuánto hemos gastado»). La auditoría sólo contaba los contratos financiados por aportes (320); el análisis
 * masivo, que es casi todo lo leído, no aparecía. Va arriba de la página: primero el total, después el detalle de lo
 * financiado. Server-safe.
 */
const NOMBRE_RED: Record<string, string> = {
  obras: "Obras",
  bienes: "Bienes",
  servicios: "Servicios",
  consultoria: "Consultorías",
  otros: "Convenios y otros",
  directas: "Convenios y otros",
};

const usd = (n: number) =>
  `US$ ${n >= 100 ? numero(Math.round(n)) : n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function LecturaTotalPanel({ datos }: { datos: LecturaTotal }) {
  const m = datos.masivo;
  const leidos = datos.alertas.analizados;
  const porContrato = m.leidos > 0 ? m.costoLeidos / m.leidos : null;
  const minutos = m.segundos ? m.segundos / 60 : null;
  // Lo leído antes de que existiera el libro del análisis masivo (las primeras lecturas del año).
  const anteriores = Math.max(0, leidos - m.leidos - datos.financiados);
  const usado = datos.tope && datos.tope > 0 ? Math.min(1, m.costo / datos.tope) : null;

  const cifras: Cifra[] = [
    {
      valor: numero(leidos),
      etiqueta: "contratos leídos",
      contexto: [
        `${numero(m.leidos)} del análisis masivo`,
        `${numero(datos.financiados)} financiados por aportes`,
        ...(anteriores > 0 ? [`${numero(anteriores)} de lecturas anteriores`] : []),
      ].join(", "),
      ayuda: (
        <Ayuda titulo="¿Qué cuenta como leído?">
          <span className="block">Un contrato que los agentes analizaron de principio a fin, tenga o no señales.</span>
          <span className="mt-2 block text-mute">
            {numero(datos.alertas.conDictamen)} tienen su dictamen publicado; el resto está en revisión.
          </span>
        </Ayuda>
      ),
    },
    {
      valor: usd(m.costo),
      etiqueta: "gastado en leerlos",
      contexto:
        usado != null ? (
          <span className="block">
            <Medidor parte={usado} etiqueta={`Gastado ${usd(m.costo)} de ${usd(datos.tope!)}`} className="mb-1.5 mt-1" />
            de {usd(datos.tope!)} presupuestados
          </span>
        ) : (
          "costo del modelo que lee, medido en cada lectura"
        ),
      ayuda: (
        <Ayuda titulo="¿Qué incluye este gasto?">
          <span className="block">
            Lo que cobra el modelo de inteligencia artificial por cada lectura, medido corrida por corrida. Son modelos
            abiertos.
          </span>
          <span className="mt-2 block text-mute">
            {usd(m.costoLeidos)} en lecturas terminadas, {usd(m.costoFallidos)} en lecturas que fallaron y {usd(m.costoPruebas)} en
            pruebas de calidad. No incluye servidores ni base de datos.
          </span>
        </Ayuda>
      ),
    },
    {
      valor: porContrato != null ? usd(porContrato) : null,
      etiqueta: "por contrato leído",
      contexto: minutos != null ? `unos ${Math.round(minutos)} minutos de lectura cada uno` : undefined,
    },
    {
      valor: numero(m.enCurso),
      etiqueta: "leyéndose ahora",
      contexto: m.ultimo ? `última lectura ${relativo(m.ultimo)}` : undefined,
      tono: m.enCurso > 0 ? "positivo" : "neutro",
    },
  ];

  const redes = datos.porRed.filter((r) => r.costo > 0 || r.leidos > 0);
  const dias = datos.porDia;
  const maxDia = Math.max(1, ...dias.map((d) => d.n));
  const conLectura = dias.filter((d) => d.n > 0);

  return (
    <section aria-labelledby="lectura-total-titulo" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="lectura-total-titulo" className="font-display text-bloque font-bold text-ink">
          Todo lo que Vigía ya leyó
        </h2>
        {m.primero && <p className="text-meta text-inkSoft">Análisis masivo desde el {fechaCorta(m.primero)}</p>}
      </div>
      <CifrasEnFila items={cifras} />

      <div className="grid gap-3 lg:grid-cols-2">
        {redes.length > 0 && (
          <div className="rounded-xl border border-line bg-paper p-4">
            <h3 className="text-cuerpo font-semibold text-ink">En qué tipo de contrato se fue el gasto</h3>
            <BarraSegmentada
              className="mt-3"
              etiqueta="Gasto de lectura por tipo de contrato"
              partes={redes.map((r) => ({ clave: r.red, nombre: NOMBRE_RED[r.red] ?? r.red, valor: r.costo, texto: usd(r.costo) }))}
            />
            <ul className="mt-3 space-y-1.5">
              {redes.map((r, i) => (
                <li key={r.red} className="flex items-baseline justify-between gap-3 text-dato">
                  <span className="inline-flex min-w-0 items-center gap-2 text-ink">
                    <MuestraSerie i={i} />
                    <span className="truncate">{NOMBRE_RED[r.red] ?? r.red}</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-inkSoft">
                    {numero(r.leidos)} <span className="text-mute">leídos,</span> {usd(r.costo)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {conLectura.length > 0 && (
          <div className="rounded-xl border border-line bg-paper p-4">
            <h3 className="text-cuerpo font-semibold text-ink">Contratos leídos por día</h3>
            <p className="text-meta text-inkSoft">Últimos {dias.length} días, hora de Lima</p>
            <ol
              className="mt-3 flex h-32 items-end gap-1"
              aria-label={`Contratos leídos por día: ${conLectura.map((d) => `${fechaCorta(d.dia)}, ${numero(d.n)}`).join("; ")}`}
            >
              {dias.map((d) => (
                <li key={d.dia} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${fechaCorta(d.dia)}: ${numero(d.n)} leídos, ${usd(d.costo)}`}>
                  {d.n === maxDia && <span className="mb-1 text-center font-mono text-meta tabular-nums text-ink">{numero(d.n)}</span>}
                  <span
                    aria-hidden
                    className="block w-full rounded-t"
                    style={{ height: `${Math.max(d.n > 0 ? 4 : 1, (d.n / maxDia) * 82)}%`, background: d.n > 0 ? "rgb(var(--serie-1))" : "rgb(var(--serie-otros) / 0.4)" }}
                  />
                </li>
              ))}
            </ol>
            <p className="mt-1.5 flex justify-between font-mono text-meta tabular-nums text-mute">
              <span>{fechaCorta(dias[0].dia)}</span>
              <span>{fechaCorta(dias[dias.length - 1].dia)}</span>
            </p>
          </div>
        )}
      </div>

      {m.fallidos > 0 && (
        <p className="text-meta text-inkSoft">
          {numero(m.fallidos)} lecturas no terminaron (el modelo o un documento fallaron). Se les carga un costo estimado,{" "}
          {usd(m.costoFallidos)} en total, que ya está en el gasto; cada contrato se reintenta hasta dos veces.
        </p>
      )}
    </section>
  );
}
