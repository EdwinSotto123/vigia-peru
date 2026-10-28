import { FuenteDato } from "@/components/patrones";
import { mesCorto } from "@/lib/partidosApi";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { getPlanillaMensual, nombrePartido, type PlanillaMensual } from "@/lib/planilla";

/**
 * La planilla de una entidad mes a mes (GET /planilla/mensual, migración 182): cuántas personas tuvo con sueldo cada mes
 * que publicó y, debajo, cuántas entraron (hacia arriba) y salieron (hacia abajo) frente al mes anterior publicado
 * completo (un mes que la entidad publicó a medias va punteado y no se compara con él: si no, al mes siguiente parecía que
 * «entraba» toda la planilla). Una
 * raya punteada marca el mes en que asumió un gobierno nuevo: así se ve si una gestión llegó con su gente. Barras en CSS
 * (como LineaMeses), cada una con su `title`; la tabla mes a mes va plegada. Con menos de tres meses no se dibuja.
 * Server component.
 */
export async function EvolucionPlanilla({ entidad }: { entidad: string }) {
  const d = await getPlanillaMensual(entidad);
  if (!d || d.meses.length < 3) return null;
  return <Grafico d={d} />;
}

type Mes = PlanillaMensual["meses"][number] & { hueco: boolean };

/** Los meses de corrido, del primero al último publicado; los que la entidad no publicó, como hueco. */
function completar(meses: PlanillaMensual["meses"]): Mes[] {
  const por = new Map(meses.map((m) => [m.mes, m]));
  const [a0, m0] = meses[0].mes.split("-").map(Number);
  const [a1, m1] = meses[meses.length - 1].mes.split("-").map(Number);
  const out: Mes[] = [];
  for (let a = a0, m = m0; a < a1 || (a === a1 && m <= m1); m === 12 ? ((m = 1), a++) : m++) {
    const clave = `${a}-${String(m).padStart(2, "0")}`;
    const x = por.get(clave);
    out.push(x ? { ...x, hueco: false } : { mes: clave, personas: 0, base: null, altas: null, bajas: null, hueco: true });
  }
  return out;
}

/** «Asumió la nueva gestión municipal, de Somos Perú» o «Asumió José Jerí». */
function textoCambio(c: PlanillaMensual["cambios"][number]): string {
  if (c.nivel === "nacional") {
    if (!c.quien) return "Asumió un nuevo Presidente";
    return /^Elegido/i.test(c.quien) ? `Asumió el Presidente ${c.quien.charAt(0).toLowerCase()}${c.quien.slice(1)}` : `Asumió ${c.quien}`;
  }
  const gestion = c.nivel === "regional" ? "la nueva gestión regional" : "la nueva gestión municipal";
  const partido = nombrePartido(c.quien);
  return partido ? `Asumió ${gestion}, de ${partido}` : `Asumió ${gestion}`;
}

function Grafico({ d }: { d: PlanillaMensual }) {
  const meses = completar(d.meses);
  const conDato = meses.filter((m) => !m.hueco);
  // Lo que se cuenta y se compara: los meses publicados completos (el primero y el último del texto, también).
  const completos = conDato.filter((m) => !m.incompleto);
  const primero = completos[0] ?? conDato[0];
  const ultimo = completos[completos.length - 1] ?? conDato[conDato.length - 1];
  const tope = Math.max(1, ...conDato.map((m) => m.personas)) * 1.08;
  const flujo = Math.max(1, ...conDato.map((m) => Math.max(m.altas ?? 0, m.bajas ?? 0)));
  const enRango = new Set(meses.map((m) => m.mes));
  const cambios = d.cambios.filter((c) => enRango.has(c.mes));
  const cambio = new Map(cambios.map((c) => [c.mes, textoCambio(c)]));
  const masAltas = [...conDato].filter((m) => m.altas != null).sort((a, b) => (b.altas ?? 0) - (a.altas ?? 0))[0];
  const variacion = ultimo.personas - primero.personas;
  // Lo que entró en los tres meses que siguieron a cada cambio de gobierno (el mes del cambio y los dos siguientes).
  const trasCambio = cambios.map((c) => {
    const i = meses.findIndex((m) => m.mes === c.mes);
    const tramo = meses.slice(i, i + 3).filter((m) => !m.hueco);
    return { c, altas: tramo.reduce((t, m) => t + (m.altas ?? 0), 0), meses: tramo.length };
  });
  const marca = (m: Mes, i: number) => i === 0 || m.mes.endsWith("-01");
  return (
    <section aria-labelledby="planilla-mes-a-mes" className="tarjeta space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5" data-lista="grafico">
      <h3 id="planilla-mes-a-mes" className="font-display text-bloque font-bold text-ink">Su planilla mes a mes</h3>
      <p className="text-meta leading-snug text-inkSoft">
        En <b className="text-ink">{mesCorto(ultimo.mes)}</b> tenía <b className="font-mono tabular-nums text-ink">{numero(ultimo.personas)}</b>{" "}
        {ultimo.personas === 1 ? "persona" : "personas"} con sueldo
        {variacion !== 0 && (
          <>
            , {numero(Math.abs(variacion))} {variacion > 0 ? "más" : "menos"} que en {mesCorto(primero.mes)}
          </>
        )}
        .{" "}
        {masAltas && (masAltas.altas ?? 0) > 0 && (
          <>
            El mes con más ingresos fue <b className="text-ink">{mesCorto(masAltas.mes)}</b>: entraron {numero(masAltas.altas ?? 0)}.{" "}
          </>
        )}
        {trasCambio
          .filter((x) => x.altas > 0)
          .map((x) => (
            <span key={x.c.mes}>
              Tras el cambio de gobierno de {mesCorto(x.c.mes)} entraron {numero(x.altas)} en {plural(x.meses, "mes", "meses")}.{" "}
            </span>
          ))}
      </p>
      <div role="img" aria-label={`Personas con sueldo en la planilla mes a mes: de ${numero(primero.personas)} en ${mesCorto(primero.mes)} a ${numero(ultimo.personas)} en ${mesCorto(ultimo.mes)}`}>
        <div className="flex h-32 items-end gap-[3px] border-b border-line">
          {meses.map((m) => (
            <div
              key={m.mes}
              className="relative flex h-full max-w-8 flex-1 flex-col justify-end"
              title={
                m.hueco
                  ? `${mesCorto(m.mes)}: la entidad no publicó su planilla`
                  : m.incompleto
                    ? `${mesCorto(m.mes)}: publicó sólo ${numero(m.personas)} personas, menos de la mitad que los meses vecinos (parece incompleta)`
                    : `${mesCorto(m.mes)}: ${numero(m.personas)} personas${m.base != null ? `, ${solesCompacto(m.base)} en sueldos` : ""}${cambio.has(m.mes) ? `. ${cambio.get(m.mes)}` : ""}`
              }
            >
              {cambio.has(m.mes) && <RayaCambio />}
              {m.hueco ? (
                <div className="h-1.5 rounded-sm border border-dashed border-mute/60" />
              ) : m.incompleto ? (
                <div className="rounded-t-[3px] border border-dashed border-granate/70" style={{ height: `${Math.max((m.personas / tope) * 100, 4)}%` }} />
              ) : (
                <div className="rounded-t-[3px] bg-granate" style={{ height: `${Math.max((m.personas / tope) * 100, 1)}%` }} />
              )}
            </div>
          ))}
        </div>
      </div>
      {/* Quiénes entraron (arriba) y salieron (abajo) frente al mes anterior publicado. */}
      <div role="img" aria-label={`Personas que entraron y salieron cada mes; el mes con más ingresos, ${masAltas ? mesCorto(masAltas.mes) : "sin dato"}`}>
        <div className="flex h-24 gap-[3px]">
          {meses.map((m) => {
            const alta = m.altas ?? 0;
            const baja = m.bajas ?? 0;
            return (
              <div
                key={m.mes}
                className="relative flex h-full max-w-8 flex-1 flex-col"
                title={m.hueco || m.altas == null ? `${mesCorto(m.mes)}: sin comparar` : `${mesCorto(m.mes)}: entraron ${numero(alta)} y salieron ${numero(baja)}`}
              >
                {cambio.has(m.mes) && <RayaCambio />}
                <div className="flex h-1/2 flex-col justify-end border-b border-line">
                  {alta > 0 && <div className="mx-auto w-full rounded-t-[3px] bg-anil" style={{ height: `${Math.max((alta / flujo) * 100, 2)}%` }} />}
                </div>
                <div className="flex h-1/2 flex-col justify-start">
                  {baja > 0 && <div className="mx-auto w-full rounded-b-[3px] bg-mute/50" style={{ height: `${Math.max((baja / flujo) * 100, 2)}%` }} />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-[3px] pt-1" aria-hidden>
          {meses.map((m, i) => (
            <div key={m.mes} className="relative h-4 max-w-8 flex-1">
              {marca(m, i) && (
                <span className="absolute left-0 whitespace-nowrap font-mono text-micro text-mute">{m.mes.endsWith("-01") ? m.mes.slice(0, 4) : mesCorto(m.mes)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-rotulo text-inkSoft" aria-label="Qué es cada color">
        <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-granate" aria-hidden />Personas con sueldo</li>
        <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-anil" aria-hidden />Entraron ese mes</li>
        <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-mute/50" aria-hidden />Salieron ese mes</li>
        {meses.some((m) => m.hueco) && <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-mute" aria-hidden />No publicó ese mes</li>}
        {meses.some((m) => m.incompleto) && <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-granate" aria-hidden />Publicó a medias (no se compara)</li>}
        {cambio.size > 0 && <li className="inline-flex items-center gap-1.5"><span className="h-3 w-0 border-l-2 border-dashed border-anil" aria-hidden />Cambio de gobierno</li>}
      </ul>
      {cambio.size > 0 && (
        <ul className="space-y-0.5 text-rotulo text-inkSoft" aria-label="Cambios de gobierno en la entidad">
          {[...cambio.entries()].map(([mes, texto]) => (
            <li key={mes} className="flex gap-2">
              <b className="shrink-0 font-mono font-medium tabular-nums text-ink">{mesCorto(mes)}</b>
              <span>{texto}</span>
            </li>
          ))}
        </ul>
      )}
      <details className="group rounded-xl border border-line [.tarjeta_&]:rounded-none [.tarjeta_&]:border-x-0 [.tarjeta_&]:border-b-0">
        <summary className="cursor-pointer select-none px-3.5 py-2 text-meta font-semibold text-granate">Ver mes por mes</summary>
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-meta">
            <thead className="bg-paperSoft text-left text-rotulo text-mute">
              <tr>
                <th className="px-3.5 py-2 font-medium">Mes</th>
                <th className="px-3.5 py-2 text-right font-medium">Personas</th>
                <th className="px-3.5 py-2 text-right font-medium">Entraron</th>
                <th className="px-3.5 py-2 text-right font-medium">Salieron</th>
                <th className="px-3.5 py-2 text-right font-medium">Sueldos del mes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {[...meses].reverse().map((m) => (
                <tr key={m.mes}>
                  <td className="px-3.5 py-1.5 tabular-nums text-inkSoft">
                    {mesCorto(m.mes)}
                    {cambio.has(m.mes) && <span className="block text-rotulo text-anilTexto">{cambio.get(m.mes)}</span>}
                  </td>
                  <td className="px-3.5 py-1.5 text-right font-mono tabular-nums text-ink">{m.hueco ? "No publicó" : m.incompleto ? `${numero(m.personas)}, a medias` : numero(m.personas)}</td>
                  <td className="px-3.5 py-1.5 text-right font-mono tabular-nums text-inkSoft">{m.altas == null ? "Sin comparar" : numero(m.altas)}</td>
                  <td className="px-3.5 py-1.5 text-right font-mono tabular-nums text-inkSoft">{m.bajas == null ? "Sin comparar" : numero(m.bajas)}</td>
                  <td className="px-3.5 py-1.5 text-right font-mono tabular-nums text-inkSoft">{m.base != null ? solesCompacto(m.base) : "Sin dato"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="text-rotulo text-mute">
        Entrar o salir es frente al mes anterior que la entidad publicó: un mes sin publicar no cuenta como salida.
      </p>
      <FuenteDato fuente="Portal de Transparencia Estándar, personal de la entidad (desde enero de 2025)" />
    </section>
  );
}

/** La raya de un cambio de gobierno: punteada, a la izquierda del mes, de arriba abajo (no tapa la barra). */
function RayaCambio() {
  return <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-[2px] border-l-2 border-dashed border-anil/70" />;
}
