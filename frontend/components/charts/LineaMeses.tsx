import { TriangleAlert } from "lucide-react";
import { mesCorto } from "@/lib/partidosApi";
import { numero, soles, solesCompacto } from "@/lib/formato";

/**
 * La línea de tiempo de lo que cobró una persona, mes a mes: el sueldo de cada mes de planilla, o lo que le pagaron por
 * órdenes cada mes. Pedido del usuario (2026-10-22): "publicar la línea de tiempo de sueldos, así la gente ve si capaz es
 * un error". Un mes que se dispara frente a los demás salta a la vista: si es uno solo, suele ser un pago acumulado o un
 * error de carga; si son todos, es su sueldo.
 *
 * Gramática:
 *   · barra llena  → la parte principal (el sueldo; o lo cobrado por órdenes).
 *   · barra clara encima → lo que vino fuera del sueldo (gratificación, otros beneficios, incentivo).
 *   · triángulo ámbar sobre la barra → mes fuera de lo normal (3 veces o más su mes típico) o con un posible error de
 *     carga. Si pasa la escala, la barra llega al techo con un corte y su monto escrito: la escala es la de los meses
 *     normales, para que un error de S/ 46 M no aplaste a los demás en una línea.
 *   · hueco punteado → un mes sin dato (la entidad no publicó su planilla ese mes); con `cero`, un mes sin órdenes.
 *   · raya vertical punteada en añil → un cambio de gobierno en la entidad (`cambios`): asumió una gestión nueva. Su texto
 *     va en la leyenda y en la nota del mes, no sobre el gráfico (en enero chocaría con el rótulo del año).
 * Barras en CSS (se adaptan al ancho sin estirar el texto), cada una con su `title`; la tabla mes a mes va debajo,
 * plegada. Server-safe.
 */

export interface PuntoMes {
  /** "YYYY-MM" */
  mes: string;
  /** La parte principal: el sueldo del mes o lo cobrado por órdenes. */
  base: number | null;
  /** Lo de fuera del sueldo (planilla). */
  extra?: number | null;
  /** Un posible error de carga de quien publicó el dato. */
  dudoso?: boolean;
  /** Lo que el Estado publicó con un posible error y va aparte (órdenes): se dibuja como mes fuera de lo normal. */
  aparte?: number | null;
}

interface Mes extends PuntoMes {
  valor: number;
  hueco: boolean;
}

function completar(puntos: PuntoMes[], huecos: "sin_dato" | "cero"): Mes[] {
  if (!puntos.length) return [];
  const orden = [...puntos].sort((a, b) => a.mes.localeCompare(b.mes));
  const por = new Map(orden.map((p) => [p.mes, p]));
  const [a0, m0] = orden[0].mes.split("-").map(Number);
  const [a1, m1] = orden[orden.length - 1].mes.split("-").map(Number);
  const out: Mes[] = [];
  for (let a = a0, m = m0; a < a1 || (a === a1 && m <= m1); m === 12 ? ((m = 1), a++) : m++) {
    const clave = `${a}-${String(m).padStart(2, "0")}`;
    const p = por.get(clave);
    if (p) out.push({ ...p, valor: (p.base ?? 0) + (p.extra ?? 0) + (p.aparte ?? 0), hueco: false });
    else out.push({ mes: clave, base: huecos === "cero" ? 0 : null, valor: 0, hueco: huecos === "sin_dato" });
  }
  return out;
}

const mediana = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

export function LineaMeses({
  puntos,
  etiqueta,
  nombres = { base: "Sueldo", extra: "Fuera del sueldo" },
  huecos = "sin_dato",
  quienCarga = "de la entidad",
  ordenes,
  cambios,
  etiquetaCambios = "Cambio de gobierno en la entidad",
}: {
  puntos: PuntoMes[];
  /** Para el lector de pantalla: "Sueldo mes a mes de …". */
  etiqueta: string;
  nombres?: { base: string; extra?: string };
  /** Un mes sin dato: "sin_dato" (planilla no publicada) o "cero" (un mes sin órdenes). */
  huecos?: "sin_dato" | "cero";
  /** "de la entidad", "de CONOSCE": en el texto del posible error. */
  quienCarga?: string;
  /** Meses en que la persona ADEMÁS cobró por órdenes de servicio (otra fuente): se marcan con ◆, no se suman al sueldo
   *  (si se sumaran, el mes parecería "fuera de lo normal" y la mediana se distorsionaría). */
  ordenes?: { meses: string[]; monto: number | null } | null;
  /** Los meses en que asumió un gobierno nuevo en la entidad ("YYYY-MM" y qué cambió): una raya punteada en ese mes. */
  cambios?: { mes: string; texto: string }[];
  /** El nombre de la raya en la leyenda: «Cambio de gobierno en la Municipalidad de …». */
  etiquetaCambios?: string;
}) {
  const meses = completar(puntos, huecos);
  if (meses.length < 2) return null;
  const enRango = new Set(meses.map((m) => m.mes));
  const cambio = new Map((cambios ?? []).filter((c) => enRango.has(c.mes)).map((c) => [c.mes, c.texto]));
  const conOrden = new Set(ordenes?.meses ?? []);
  // Con un solo mes conocemos su monto exacto; con varios, sólo el total (va en el texto), así que la nota no lo reparte.
  const notaOrden = conOrden.size === 1 && ordenes?.monto != null ? `+ ${soles(ordenes.monto)} en órdenes de servicio` : "+ órdenes de servicio ese mes";
  const conDato = meses.filter((m) => !m.hueco && m.valor > 0);
  const tipico = mediana(conDato.map((m) => m.valor));
  const fuera = (m: Mes) => !m.hueco && (m.dudoso || (m.aparte ?? 0) > 0 || (tipico > 0 && m.valor >= 3 * tipico && m.valor - tipico >= 3000));
  const normales = conDato.filter((m) => !fuera(m));
  const techo = Math.max(1, (normales.length ? Math.max(...normales.map((m) => m.valor)) : Math.max(...conDato.map((m) => m.valor), 1)) * 1.12);
  const raros = meses.filter(fuera);
  // El monto escrito sobre las barras que pasan la escala, sin encimarse: con muchos meses las columnas son angostas y
  // dos vecinos («S/ 155 mil» y «S/ 139 mil») se pisaban. Se escribe uno si el anterior escrito quedó a una distancia de
  // al menos el 6 % de los meses (y dos columnas); los demás conservan el triángulo, y su monto va en el título y la tabla.
  const conMonto = new Set<string>();
  {
    const brecha = Math.max(2, Math.ceil(meses.length * 0.06));
    let ultimo = -Infinity;
    meses.forEach((m, i) => {
      if (fuera(m) && m.valor > techo && i - ultimo >= brecha) {
        conMonto.add(m.mes);
        ultimo = i;
      }
    });
  }
  const conExtra = meses.some((m) => (m.extra ?? 0) > 0);

  const marca = (m: Mes, i: number) => i === 0 || m.mes.endsWith("-01");

  return (
    // data-lista="grafico": la tabla plegada de abajo son los datos del gráfico (su versión accesible), no una lista
    // para buscar (e2e/visual/chequeos.js).
    <figure className="space-y-3" data-lista="grafico">
      <p className="text-meta leading-snug text-inkSoft">
        {tipico > 0 && <>Su mes típico: <b className="font-mono tabular-nums text-ink">{soles(tipico)}</b>. </>}
        {raros.length === 0
          ? "Ningún mes se aparta de lo normal."
          : raros.length === 1
            ? <>En <b className="text-ink">{mesCorto(raros[0].mes)}</b> se aparta: {soles(raros[0].valor)}{tipico > 0 ? `, ${numero(Math.round(raros[0].valor / tipico))} veces su mes típico` : ""}. Si es un solo mes, suele ser un pago acumulado o un error {quienCarga} al subir el dato.</>
            : <>{numero(raros.length)} meses se apartan de lo normal (marcados en ámbar).</>}
        {conOrden.size > 0 && <> El <span className="text-anilTexto">◆</span> marca {conOrden.size === 1 ? "el mes" : "los meses"} en que además cobró por órdenes de servicio{ordenes?.monto != null ? <> (<b className="font-mono tabular-nums text-ink">{soles(ordenes.monto)}</b> en total)</> : null}.</>}
      </p>
      {/* Barras en CSS (no un SVG estirado): se adaptan al ancho y el texto no cambia de tamaño. */}
      <div role="img" aria-label={`${etiqueta}: ${numero(conDato.length)} meses con dato${raros.length ? `, ${numero(raros.length)} fuera de lo normal` : ""}`}>
        <div className="flex h-36 items-end gap-[3px] border-b border-line pt-9">
          {meses.map((m) => {
            if (m.hueco) {
              return (
                <div key={m.mes} className="relative flex h-full max-w-7 flex-1 flex-col justify-end" title={`${mesCorto(m.mes)}: sin dato (no se publicó ese mes)${cambio.has(m.mes) ? `. ${cambio.get(m.mes)}` : ""}`}>
                  {cambio.has(m.mes) && <RayaCambio />}
                  <div className="h-1.5 rounded-sm border border-dashed border-mute/60" />
                </div>
              );
            }
            const raro = fuera(m);
            const pasa = m.valor > techo;
            const pctTot = Math.min(100, (m.valor / techo) * 100);
            const pctBase = m.valor > 0 ? pctTot * ((m.base ?? 0) / m.valor) : 0;
            const pctResto = Math.max(0, pctTot - pctBase);
            const titulo = [
              `${mesCorto(m.mes)}: ${soles(m.valor)}`,
              conExtra && m.extra ? `${nombres.base} ${soles(m.base ?? 0)}, ${(nombres.extra ?? "otros").toLowerCase()} ${soles(m.extra)}` : null,
              m.dudoso || (m.aparte ?? 0) > 0 ? `posible error ${quienCarga}` : raro ? "fuera de lo normal" : null,
              conOrden.has(m.mes) ? "también órdenes de servicio ese mes" : null,
              cambio.get(m.mes) ?? null,
            ].filter(Boolean).join(". ");
            return (
              <div key={m.mes} className="relative flex h-full max-w-7 flex-1 flex-col justify-end" title={titulo}>
                {cambio.has(m.mes) && <RayaCambio />}
                {conOrden.has(m.mes) && (
                  <span className="mb-0.5 flex justify-center" aria-hidden>
                    <span className="h-2 w-2 rotate-45 rounded-[1px] bg-anil" />
                  </span>
                )}
                {raro && (
                  <span className="relative mb-0.5 flex justify-center">
                    {pasa && conMonto.has(m.mes) && (
                      <span className="absolute bottom-full mb-0.5 whitespace-nowrap font-mono text-micro tabular-nums text-amberTexto">{solesCompacto(m.valor)}</span>
                    )}
                    <TriangleAlert size={11} strokeWidth={2.5} className="text-amberTexto" aria-hidden />
                  </span>
                )}
                {pctResto > 0.5 && (
                  <div className={(raro ? "bg-amber/45" : "bg-granate/30") + " mb-[2px] rounded-t-[3px]"} style={{ height: `${pctResto}%` }} />
                )}
                {pctBase > 0 && (
                  <div
                    className={(raro ? "bg-amber" : "bg-granate") + (pctResto > 0.5 ? " rounded-b-[1px]" : " rounded-t-[3px]") + (pasa ? " border-t-2 border-dashed border-paper" : "")}
                    style={{ height: `${Math.max(pctBase, 1)}%` }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex gap-[3px] pt-1" aria-hidden>
          {meses.map((m, i) => (
            <div key={m.mes} className="relative h-4 max-w-7 flex-1">
              {marca(m, i) && (
                <span className="absolute left-0 whitespace-nowrap font-mono text-micro text-mute">
                  {m.mes.endsWith("-01") ? m.mes.slice(0, 4) : mesCorto(m.mes)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-rotulo text-inkSoft" aria-label="Qué es cada color">
        <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-granate" aria-hidden />{nombres.base}</li>
        {conExtra && nombres.extra && <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-granate/30" aria-hidden />{nombres.extra}</li>}
        {conOrden.size > 0 && <li className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 rounded-[1px] bg-anil" aria-hidden />Órdenes de servicio ese mes</li>}
        {raros.length > 0 && (
          <li className="inline-flex items-center gap-1.5">
            <TriangleAlert size={12} className="text-amberTexto" aria-hidden />
            Fuera de lo normal o posible error {quienCarga}
          </li>
        )}
        {meses.some((m) => m.hueco) && <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-mute" aria-hidden />Sin dato ese mes</li>}
        {cambio.size > 0 && <li className="inline-flex items-center gap-1.5"><span className="h-3 w-0 border-l-2 border-dashed border-anil" aria-hidden />{etiquetaCambios}</li>}
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
                <th className="px-3.5 py-2 text-right font-medium">{nombres.base}</th>
                {conExtra && <th className="px-3.5 py-2 text-right font-medium">{nombres.extra}</th>}
                <th className="px-3.5 py-2 text-right font-medium">Total</th>
                <th className="px-3.5 py-2 font-medium">Nota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {[...meses].reverse().map((m) => (
                <tr key={m.mes} className={fuera(m) ? "bg-amber-soft/40" : undefined}>
                  <td className="px-3.5 py-1.5 tabular-nums text-inkSoft">{mesCorto(m.mes)}</td>
                  <td className="px-3.5 py-1.5 text-right font-mono tabular-nums text-ink">{m.hueco ? "Sin dato" : soles(m.base ?? 0)}</td>
                  {conExtra && <td className="px-3.5 py-1.5 text-right font-mono tabular-nums text-inkSoft">{m.hueco ? "" : soles(m.extra ?? 0)}</td>}
                  <td className="px-3.5 py-1.5 text-right font-mono tabular-nums text-ink">{m.hueco ? "" : soles(m.valor)}</td>
                  <td className="px-3.5 py-1.5 text-rotulo">
                    {m.hueco ? (
                      <span className="text-mute">No se publicó</span>
                    ) : (
                      <span className="flex flex-col gap-0.5">
                        {(m.dudoso || (m.aparte ?? 0) > 0) && <span className="text-amberTexto">{`Posible error ${quienCarga}`}</span>}
                        {!(m.dudoso || (m.aparte ?? 0) > 0) && fuera(m) && <span className="text-amberTexto">Fuera de lo normal</span>}
                        {conOrden.has(m.mes) && <span className="text-anilTexto">{notaOrden}</span>}
                        {cambio.has(m.mes) && <span className="text-anilTexto">{cambio.get(m.mes)}</span>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** La raya de un cambio de gobierno: punteada, a la izquierda del mes, de arriba abajo (no tapa la barra). */
function RayaCambio() {
  return <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-[2px] border-l-2 border-dashed border-anil/70" />;
}
