/**
 * «Cuánto cuesta vigilar»: el gasto en modelos de IA de los últimos 30 días, día por día y por componente (pedido del
 * usuario del 2026-11-17: «falta métricas de gastos… estos 5 días ya gastamos 3 200 USD»). Sale de GET
 * /transparencia/gasto. Dos tamaños:
 *   · `compacto` (en «Cómo trabaja Vigía»): la frase, cuatro cifras y las barras de 30 días con su leyenda;
 *   · entero (en Métricas, pestaña «Cuánto cuesta»): además cada componente con lo que cubre, su gasto de 30 y 7 días,
 *     cuántas unidades y el costo por unidad, y la comparación con lo que factura Workers AI cuando está cargada.
 * Honesto con lo que no cubre: los libros de la base no anotan todo (laboratorio de precios, lecturas de empleo, pruebas
 * sueltas), y la página lo dice; si un libro no respondió, también.
 * Server-safe.
 */
import Link from "next/link";
import { Info } from "lucide-react";
import { BarraSegmentada, colorSerie, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { numero, plural, porcentaje } from "@/lib/formato";
import { diaCorto, dolares, type ClaveGasto, type GastoIa } from "@/lib/transparencia";

/** El color de cada componente, siempre el mismo (paleta --serie-1…6; el séptimo, gris). */
const ORDEN: ClaveGasto[] = ["analisis", "oro", "fichas", "transcripcion", "lectores", "menores", "otros"];
const serieDe = (k: ClaveGasto): number | "otros" => {
  const i = ORDEN.indexOf(k);
  return i >= 0 && i < 6 ? i : "otros";
};

/** Un monto de la lista: sin centavos, salvo los chicos (US$ 0.21 no es «US$ 0»). */
const monto = (n: number) => dolares(n, n > 0 && n < 10 ? 2 : 0);

const ENLACE = "font-medium text-ink underline underline-offset-2 transition-colors hover:text-granate";

export function CuantoCuesta({ g, compacto = false }: { g: GastoIa; compacto?: boolean }) {
  const t = g.totales;
  const comp = [...g.componentes].sort((a, b) => ORDEN.indexOf(a.clave) - ORDEN.indexOf(b.clave));
  const analisis = comp.find((k) => k.clave === "analisis");
  return (
    <div className="space-y-5">
      <p className="max-w-[70ch] text-destacado font-semibold leading-snug text-ink text-pretty">
        En los últimos 30 días leer y analizar costó {dolares(t.usd30, 0)} en modelos de IA: {dolares(t.usd7, 0)} en la última semana y{" "}
        {dolares(t.hoy, 0)} en lo que va de hoy.
        {g.factura?.usd30 != null && <> Cloudflare midió {dolares(g.factura.usd30, 0)} de Workers AI en el mismo periodo.</>}
      </p>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Cifra etiqueta="En lo que va del mes" valor={dolares(t.mes, 0)} />
        <Cifra etiqueta="Por contrato analizado" valor={g.medios.porAnalisis != null ? dolares(g.medios.porAnalisis, 2) : "Sin dato"}
               contexto={analisis ? `${plural(analisis.n30, "análisis", "análisis")} en 30 días` : undefined} />
        <Cifra etiqueta="Por documento leído" valor={g.medios.porFicha != null ? dolares(g.medios.porFicha, 3) : "Sin dato"} contexto="una ficha con página y cita" />
        <Cifra etiqueta="Por página escaneada" valor={g.medios.porPagina != null ? dolares(g.medios.porPagina, 4) : "Sin dato"} contexto="pasada a texto con visión" />
      </dl>

      <Barras g={g} />

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-rotulo text-inkSoft">
        {comp.map((k) => (
          <li key={k.clave} className="inline-flex items-center gap-1.5">
            <MuestraSerie i={serieDe(k.clave)} />
            {k.etiqueta}
            <span className="font-mono tabular-nums text-mute">{monto(k.usd30)}</span>
          </li>
        ))}
        {g.factura && (
          <li className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed border-ink" aria-hidden />
            Lo que midió Cloudflare
          </li>
        )}
      </ul>

      {!compacto && <Componentes g={g} />}

      <p className="flex max-w-[80ch] items-start gap-2 text-rotulo leading-relaxed text-mute">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          Suma lo que anotan los libros de Vigía: cada análisis, cada prueba de oro, cada documento leído y cada página transcrita, con el
          modelo que la hizo. No incluye el laboratorio de precios, la lectura de bases de empleo ni las pruebas sueltas.
          {g.factura?.cubren != null && <> Esos libros cubren el {porcentaje(g.factura.cubren * 100, { decimales: 0 })} de lo que midió Cloudflare (que cuenta los días en hora UTC).</>}
          {g.sinLibro.length > 0 && <> Ahora falta sumar {plural(g.sinLibro.length, "libro que no respondió", "libros que no respondieron")}.</>}
          {t.anthropic30 > 0 && <> {dolares(t.anthropic30, 0)} fueron de modelos de Anthropic, antes de pasar a modelos abiertos el 10 de noviembre.</>}
          {compacto && <> <Link href="/metricas?seccion=gasto" prefetch={false} className={ENLACE}>Ver el gasto por componente</Link>.</>}
        </span>
      </p>
    </div>
  );
}

function Cifra({ etiqueta, valor, contexto }: { etiqueta: string; valor: string; contexto?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-rotulo leading-snug text-mute">{etiqueta}</dt>
      <dd className="mt-0.5 whitespace-nowrap font-display text-bloque font-bold tabular-nums text-ink sm:text-cifra">{valor}</dd>
      {contexto && <dd className="text-rotulo text-mute">{contexto}</dd>}
    </div>
  );
}

/** Las barras de los 30 días, apiladas por componente; si hay factura de Cloudflare, una marca por día con lo que midió. */
function Barras({ g }: { g: GastoIa }) {
  const W = 30 * 20;
  const H = 150;
  const fact = new Map((g.factura?.dias ?? []).map((d) => [d.dia, d.usd]));
  const max = Math.max(1, ...g.dias.map((d) => Math.max(d.total, fact.get(d.dia) ?? 0)));
  const y = (v: number) => (H - 4) * (v / max);
  const mayor = g.dias.reduce((m, d) => (d.total > m.total ? d : m), g.dias[0]);
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 text-rotulo text-mute">
        <span className="font-semibold text-inkSoft">Gasto por día</span>
        <span className="font-mono tabular-nums">tope de la escala {dolares(max, 0)}</span>
      </figcaption>
      <div
        role="img"
        aria-label={`Gasto por día en los últimos 30 días. El día de más gasto fue el ${mayor ? diaCorto(mayor.dia) : ""}, con ${mayor ? dolares(mayor.total, 0) : ""}.`}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-40 w-full" aria-hidden>
          <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-line" strokeWidth={1} />
          {g.dias.map((d, i) => {
            let acum = 0;
            const f = fact.get(d.dia) ?? 0;
            return (
              <g key={d.dia}>
                <title>{`${diaCorto(d.dia)}: ${dolares(d.total, 0)} en los libros${f > 0 ? `, ${dolares(f, 0)} según Cloudflare` : ""}`}</title>
                <rect x={i * 20} y={0} width={20} height={H} fill="transparent" />
                {ORDEN.map((k) => {
                  const v = d.partes[k] ?? 0;
                  if (v <= 0) return null;
                  const alto = Math.max(1, y(v));
                  acum += alto;
                  return <rect key={k} x={i * 20 + 3} y={H - 1 - acum} width={14} height={alto} style={{ fill: colorSerie(serieDe(k)) }} />;
                })}
                {f >= max * 0.01 && (
                  <line x1={i * 20 + 1} x2={i * 20 + 19} y1={H - 1 - y(f)} y2={H - 1 - y(f)}
                        className="stroke-ink" strokeWidth={2} strokeDasharray="3 2" />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex justify-between font-mono text-rotulo tabular-nums text-mute" aria-hidden>
        {[0, 7, 14, 21, 29].map((i) => (
          <span key={i}>{g.dias[i] ? (i === 29 ? "hoy" : diaCorto(g.dias[i].dia)) : ""}</span>
        ))}
      </div>
    </figure>
  );
}

/** Cada componente: qué cubre, su gasto de 30 y 7 días, cuántas unidades y el costo por unidad, con su parte del total. */
function Componentes({ g }: { g: GastoIa }) {
  const comp = [...g.componentes].sort((a, b) => b.usd30 - a.usd30);
  const total = comp.reduce((t, k) => t + k.usd30, 0);
  return (
    <div className="space-y-3">
      <BarraSegmentada
        etiqueta="Reparto del gasto de 30 días"
        partes={comp.filter((k) => serieDe(k.clave) !== "otros").map((k) => ({ clave: k.clave, nombre: k.etiqueta, valor: k.usd30, texto: dolares(k.usd30, 0) }))}
        otros={(() => {
          const o = comp.find((k) => serieDe(k.clave) === "otros");
          return o ? { clave: o.clave, nombre: o.etiqueta, valor: o.usd30, texto: dolares(o.usd30, 0) } : null;
        })()}
      />
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[34rem] text-left text-dato">
          <caption className="sr-only">Gasto de cada componente en los últimos 30 y 7 días</caption>
          <thead className="bg-paperSoft text-rotulo text-mute">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Componente</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">30 días</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">7 días</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Volumen</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Por unidad</th>
            </tr>
          </thead>
          <tbody>
            {comp.map((k) => (
              <tr key={k.clave} className="border-t border-line align-top">
                <th scope="row" className="px-4 py-2.5 font-normal">
                  <span className="flex items-center gap-2 font-semibold text-ink"><MuestraSerie i={serieDe(k.clave)} />{k.etiqueta}</span>
                  <span className="mt-0.5 block max-w-[46ch] text-rotulo leading-snug text-mute">{k.que}</span>
                </th>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">
                  {monto(k.usd30)}
                  <span className="block text-rotulo text-mute">{total > 0 ? porcentaje((100 * k.usd30) / total, { decimales: 0 }) : ""}</span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-inkSoft">{monto(k.usd7)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-inkSoft">{numero(k.n30)} <span className="font-sans text-rotulo text-mute">{k.unidad}</span></td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-inkSoft">{k.n30 > 0 ? dolares(k.usd30 / k.n30, k.usd30 / k.n30 < 0.01 ? 4 : 3) : "Sin dato"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
