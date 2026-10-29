import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";
import { numero, soles } from "@/lib/formato";
import { dolares, nombreMes, type ResumenVigilancia } from "@/lib/financiamiento";

/**
 * La meta del mes (migración 206): lo recaudado contra lo que cuesta. Dos marcas: el piso (seguir encendidos: la base de
 * datos, los servidores y la captura de datos del mes) y la meta completa (además, leer a fondo todos los contratos con
 * banderas graves de un mes). Las cifras salen de GET /financiamiento/vigilancia, cada una con su fuente en
 * /app/cuanto-cuesta. Server-safe.
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
  const pct = (x: number) => `${Math.min(100, Math.max(0, (x / completaPen) * 100)).toFixed(1)}%`;
  const iaGravesPen = completaPen - pisoPen;
  return (
    <section aria-labelledby="meta-mes" className="rounded-2xl border border-line bg-paper p-5 sm:p-6">
      <p className="inline-flex items-center gap-1.5 text-meta font-semibold text-inkSoft">
        <Target size={15} aria-hidden className="text-granate" />
        <span id="meta-mes">Meta de {nombreMes(v.mes)}</span>
      </p>
      <p className="mt-1 font-display text-cifra font-bold leading-tight text-ink">
        {soles(recaudado)} <span className="text-bloque font-semibold text-inkSoft">de {soles(completaPen)}</span>
      </p>
      {/* La barra: lo recaudado, con la marca del piso. El texto de abajo dice lo mismo para quien no la ve. */}
      <div className="relative mt-4 h-3 rounded-full bg-paperDeep" aria-hidden>
        <div className="h-3 rounded-full bg-granate" style={{ width: pct(recaudado) }} />
        <div className="absolute -top-1 h-5 w-0.5 rounded-full bg-ink" style={{ left: pct(pisoPen) }} />
      </div>
      <dl className="mt-4 grid gap-3 text-meta sm:grid-cols-2">
        <div className="rounded-xl bg-paperSoft px-3.5 py-2.5">
          <dt className="text-inkSoft">Para seguir encendidos</dt>
          <dd className="font-semibold text-ink">{soles(pisoPen)} al mes</dd>
          <dd className="text-rotulo text-mute">Base de datos, servidores y captura de datos</dd>
        </div>
        <div className="rounded-xl bg-paperSoft px-3.5 py-2.5">
          <dt className="text-inkSoft">Para leer a fondo lo más grave</dt>
          <dd className="font-semibold text-ink">{soles(iaGravesPen)} más</dd>
          <dd className="text-rotulo text-mute">
            Los ~{numero(v.graves.porMes)} contratos con banderas graves de un mes
            {v.graves.costoLeerlosUsd != null ? `, ${dolares(v.graves.costoLeerlosUsd)} en IA` : ""}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-rotulo text-inkSoft">
        {v.recaudado.aportes > 0
          ? `${numero(v.recaudado.aportes)} ${v.recaudado.aportes === 1 ? "aporte validado" : "aportes validados"} este mes.`
          : "Todavía no hay aportes validados este mes."}
        {v.recaudado.semillaPen > 0 ? ` Vigía puso ${soles(v.recaudado.semillaPen)} de su capital semilla.` : ""}
      </p>
      {conEnlace && (
        <Link href="/app/cuanto-cuesta" prefetch={false} className="mt-3 inline-flex min-h-[32px] items-center gap-1 text-meta font-semibold text-granate hover:underline">
          Cuánto cuesta Vigía, rubro por rubro <ArrowRight size={14} aria-hidden />
        </Link>
      )}
    </section>
  );
}
