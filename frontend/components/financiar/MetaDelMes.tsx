import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";
import { numero, soles } from "@/lib/formato";
import { dolares, nombreMes, type ResumenVigilancia } from "@/lib/financiamiento";

/**
 * La meta del mes (migración 206): lo recaudado contra lo que cuesta, en dos tramos que se pagan en orden. Primero el
 * piso (seguir encendidos: la base de datos, los servidores y la captura de datos del mes) y después el resto de la meta
 * (leer a fondo los contratos con banderas graves de un mes). Las cifras salen de GET /financiamiento/vigilancia, cada una
 * con su fuente en /app/cuanto-cuesta. Server-safe.
 *
 * Rehecha el 2026-10-29 («texto y ya, nada de jerarquía»): la barra tenía una marca sin rótulo y debajo dos cajas grises
 * que no se ataban a ella; /app/apoyar repetía los dos montos en otra sección. Ahora la barra va en dos tramos con su
 * escala, y cada tramo es un paso numerado con su monto: lo mismo que contaba «En qué se usa tu aporte».
 */
export function MetaDelMes({ v, conEnlace = true }: { v: ResumenVigilancia; conEnlace?: boolean }) {
  const { pisoPen, completaPen } = v.meta;
  const recaudado = v.recaudado.mesPen;
  if (pisoPen == null || completaPen == null) {
    return (
      <div className="rounded-2xl border border-line bg-paper p-5">
        <p className="text-dato text-inkSoft">Todavía no tenemos los costos de este mes cargados. Vuelve en unos días.</p>
      </div>
    );
  }
  const resto = Math.max(0, completaPen - pisoPen);
  const llenado = (desde: number, hasta: number) =>
    hasta > desde ? `${(Math.min(1, Math.max(0, (recaudado - desde) / (hasta - desde))) * 100).toFixed(1)}%` : "0%";
  const posPiso = completaPen > 0 ? (pisoPen / completaPen) * 100 : 0;
  const pasos = [
    {
      titulo: "Seguir encendidos",
      monto: `${soles(pisoPen)} al mes`,
      detalle: "La base de datos, los servidores y la captura diaria de lo que publica el Estado.",
    },
    {
      titulo: "Leer a fondo lo más grave",
      monto: `${soles(resto)} más`,
      detalle: `Los ~${numero(v.graves.porMes)} contratos con banderas graves de un mes${
        v.graves.costoLeerlosUsd != null ? `, ${dolares(v.graves.costoLeerlosUsd)} en IA` : ""
      }.`,
    },
  ];
  const estado =
    (v.recaudado.aportes > 0
      ? `${numero(v.recaudado.aportes)} ${v.recaudado.aportes === 1 ? "aporte validado" : "aportes validados"} este mes.`
      : "Todavía no hay aportes validados este mes.") +
    (v.recaudado.semillaPen > 0 ? ` Vigía puso ${soles(v.recaudado.semillaPen)} de su capital semilla.` : "");

  return (
    <section aria-labelledby="meta-mes" className="rounded-2xl border border-line bg-paper p-5 sm:p-6">
      <p className="inline-flex items-center gap-1.5 text-meta font-semibold text-inkSoft">
        <Target size={15} aria-hidden className="text-granate" />
        <span id="meta-mes">Meta de {nombreMes(v.mes)}</span>
      </p>
      <p className="mt-1 font-display text-cifra font-bold leading-tight text-ink">
        {soles(recaudado)} <span className="text-bloque font-semibold text-inkSoft">de {soles(completaPen)}</span>
      </p>
      <p className="mt-1 text-meta leading-snug text-inkSoft">{estado}</p>

      {/* La barra en sus dos tramos, con la escala debajo. Los pasos de abajo dicen lo mismo para quien no la ve. */}
      <div className="mt-5" aria-hidden>
        <div className="flex h-3 gap-[3px]">
          <div className="h-full overflow-hidden rounded-l-full bg-paperDeep" style={{ flexGrow: pisoPen, flexBasis: 0 }}>
            <div className="h-full bg-granate" style={{ width: llenado(0, pisoPen) }} />
          </div>
          <div className="h-full overflow-hidden rounded-r-full bg-paperDeep" style={{ flexGrow: resto, flexBasis: 0 }}>
            <div className="h-full bg-granate" style={{ width: llenado(pisoPen, completaPen) }} />
          </div>
        </div>
        <div className="relative mt-1.5 h-4 font-mono text-rotulo tabular-nums text-mute">
          <span className="absolute left-0">{soles(0)}</span>
          {posPiso > 14 && posPiso < 80 && (
            <span className="absolute -translate-x-1/2" style={{ left: `${posPiso}%` }}>
              {soles(pisoPen)}
            </span>
          )}
          <span className="absolute right-0">{soles(completaPen)}</span>
        </div>
      </div>

      <ol className="mt-4 space-y-3 border-t border-line pt-4">
        {pasos.map((p, i) => (
          <li key={p.titulo} className="flex gap-3">
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-granate-deep font-display text-meta font-bold text-maiz"
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-2 text-dato">
                <span className="min-w-0 font-semibold text-ink">{p.titulo}</span>
                <span aria-hidden className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-line" />
                <span className="shrink-0 font-mono font-semibold tabular-nums text-ink">{p.monto}</span>
              </p>
              <p className="mt-0.5 text-meta leading-snug text-mute">{p.detalle}</p>
            </div>
          </li>
        ))}
      </ol>

      {conEnlace && (
        <Link href="/app/cuanto-cuesta" prefetch={false} className="mt-4 inline-flex min-h-[32px] items-center gap-1 text-meta font-semibold text-granate hover:underline">
          Cuánto cuesta Vigía, rubro por rubro <ArrowRight size={14} aria-hidden />
        </Link>
      )}
    </section>
  );
}
