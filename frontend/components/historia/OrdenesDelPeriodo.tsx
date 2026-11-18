"use client";

import Link from "next/link";
import { Building2, Loader2, RotateCcw, UserPlus, Users } from "lucide-react";
import { usePoder } from "@/components/grafo/vista";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { cn } from "@/lib/utils";

/**
 * Qué se ordenó en el periodo de un patrón de órdenes (un pico, el cierre de una gestión, diciembre) frente a las mismas
 * fechas un año antes: API GET /ordenes/ventana (2026-11-18), la misma que la herramienta `ordenes_en_periodo` del MCP.
 * De las personas naturales sólo cuentas; las empresas, con su ficha. Se pide al abrir el detalle del patrón.
 */
interface Cifras {
  ordenes: number; monto: number; ordenesAPersonas: number; montoAPersonas: number; personas: number; personasNuevas: number;
  ordenesAPersonasNuevas: number; empresas: number; empresasNuevas: number; montoEmpresasNuevas: number;
}
interface Ventana {
  desde: string; hasta: string; comparadoCon: { desde: string; hasta: string };
  ventana: Cifras; unAnioAntes: Cifras;
  conceptos: { concepto: string; ordenes: number; monto: number; personas: number; empresas: number }[];
  empresas: { ruc: string; empresa: string | null; ordenes: number; monto: number; nueva: boolean }[];
}

/** «2022-10» → «2022-10-01»; el último día del mes de `hasta`. */
const primerDia = (m: string) => `${m.slice(0, 7)}-01`;
const ultimoDia = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

export const rutaVentana = (entidadRuc: string, mes: string, hasta?: string | null) =>
  `/ordenes/ventana?entidad=${entidadRuc}&desde=${primerDia(mes)}&hasta=${ultimoDia(hasta ?? mes)}`;

/** Sólo patrones de órdenes de una entidad, desde 2019 (se comparan con un año antes y las órdenes empiezan en 2018). */
export const tieneVentana = (tipoSujeto: string, carril: string, mes: string) =>
  tipoSujeto === "entidad" && (carril === "ordenes" || carril === "personas") && mes >= "2019-01";

function Cifra({ icono, etiqueta, ahora, antes, unidad }: { icono: React.ReactNode; etiqueta: string; ahora: number; antes: number; unidad: string }) {
  const veces = antes > 0 ? ahora / antes : null;
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-2">
      <dt className="flex items-center gap-1.5 text-rotulo text-mute">
        {icono}
        {etiqueta}
      </dt>
      <dd className="font-display text-bloque font-bold tabular-nums text-ink">{numero(ahora)}</dd>
      <dd className="text-rotulo text-inkSoft">
        {unidad}; un año antes, {numero(antes)}
        {veces != null && veces >= 1.5 ? <span className="font-semibold text-ink">{` (${numero(Math.round(veces * 10) / 10)} veces)`}</span> : null}
      </dd>
    </div>
  );
}

export function OrdenesDelPeriodo({ entidadRuc, mes, hasta }: { entidadRuc: string; mes: string; hasta?: string | null }) {
  const carga = usePoder<Ventana>(rutaVentana(entidadRuc, mes, hasta));
  if (carga.cargando && !carga.datos) {
    return (
      <p className="inline-flex items-center gap-2 text-meta text-mute">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Buscando qué se ordenó en ese periodo…
      </p>
    );
  }
  if (carga.error || !carga.datos) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-meta text-mute">
        No pudimos traer las órdenes de ese periodo.
        <button type="button" onClick={carga.reintentar} className="inline-flex items-center gap-1 font-semibold text-granate underline underline-offset-2">
          <RotateCcw size={13} aria-hidden />
          Reintentar
        </button>
      </p>
    );
  }
  const v = carga.datos;
  const a = v.ventana;
  const b = v.unAnioAntes;
  return (
    <section className="space-y-3" aria-label="Qué se ordenó en ese periodo">
      <h4 className="text-meta font-semibold text-ink">Qué se ordenó en ese periodo, frente al mismo periodo un año antes</h4>
      <dl className="grid grid-cols-2 gap-2">
        <Cifra icono={<Users size={13} aria-hidden />} etiqueta="Órdenes a personas" ahora={a.ordenesAPersonas} antes={b.ordenesAPersonas} unidad={plural(a.personas, "persona", "personas")} />
        <Cifra icono={<UserPlus size={13} aria-hidden />} etiqueta="Personas nuevas para la entidad" ahora={a.personasNuevas} antes={b.personasNuevas} unidad="sin órdenes suyas antes" />
        <Cifra icono={<Building2 size={13} aria-hidden />} etiqueta="Órdenes en total" ahora={a.ordenes} antes={b.ordenes} unidad={solesCompacto(a.monto)} />
        <Cifra icono={<Building2 size={13} aria-hidden />} etiqueta="Empresas nuevas" ahora={a.empresasNuevas} antes={b.empresasNuevas} unidad={`de ${numero(a.empresas)} empresas`} />
      </dl>
      {v.conceptos.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-rotulo font-semibold text-mute">Lo que más se repite en las órdenes</p>
          <ul className="divide-y divide-line/70 rounded-xl border border-line">
            {v.conceptos.slice(0, 5).map((c) => (
              <li key={c.concepto} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-meta">
                <span className="min-w-0 text-ink">{c.concepto.charAt(0) + c.concepto.slice(1).toLowerCase()}…</span>
                <span className="shrink-0 font-mono text-rotulo tabular-nums text-inkSoft">
                  {plural(c.ordenes, "orden", "órdenes")}
                  {c.personas ? `, ${plural(c.personas, "persona", "personas")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {v.empresas.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-rotulo font-semibold text-mute">Las empresas que más recibieron</p>
          <ul className="divide-y divide-line/70 rounded-xl border border-line">
            {v.empresas.slice(0, 5).map((e) => (
              <li key={e.ruc} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-meta">
                <span className="min-w-0">
                  <Link href={`/empresa/${e.ruc}`} prefetch={false} className="font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate">
                    {e.empresa ? tituloNatural(e.empresa) : e.ruc}
                  </Link>
                  {e.nueva && <span className={cn("ml-2 rounded-full bg-amber/15 px-1.5 py-0.5 text-rotulo font-semibold text-ink")}>nueva</span>}
                </span>
                <span className="shrink-0 font-mono text-rotulo tabular-nums text-inkSoft">{solesCompacto(e.monto)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-rotulo leading-snug text-mute text-pretty">
        «Nueva»: no había recibido ninguna orden de esta entidad desde 2018. De las personas naturales sólo damos cuentas. Comparado con{" "}
        {v.comparadoCon.desde.slice(0, 4)}. Fuente: órdenes de compra y de servicio de CONOSCE (OECE).
      </p>
    </section>
  );
}
