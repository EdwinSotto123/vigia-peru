import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { tituloNatural } from "@/lib/landing";
import { numero, porcentaje, solesCompacto } from "@/lib/formato";
import { GRUPOS_CRUCE } from "@/lib/cruces";

/**
 * Las piezas de la pestaña "Inicio" de una entidad, un partido o una región: el resumen de todo en una pantalla
 * (en qué gasta, sus contratos, las banderas levantadas y los casos de corrupción), cada bloque con un enlace a la
 * pestaña que tiene el detalle. Sin estado: se arman en el servidor con lo que ya trae cada página.
 * Colores sólo con los tokens del tema (DESIGN_SYSTEM.md): nada de hex.
 */

export function RejillaInicio({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 lg:grid-cols-2">{children}</div>;
}

/** Un bloque: título con su "?", el contenido y, si hay, el enlace a la pestaña con el detalle. */
export function BloqueInicio({
  titulo,
  ayuda,
  enlace,
  ancho = false,
  children,
}: {
  titulo: string;
  ayuda?: ReactNode;
  enlace?: { href: string; texto: string };
  /** Ocupa las dos columnas de la rejilla. */
  ancho?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line bg-paper p-4 sm:p-5${ancho ? " lg:col-span-2" : ""}`}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
          {titulo}
          {ayuda}
        </h3>
        {enlace && (
          <Link href={enlace.href} prefetch={false} className="inline-flex min-h-8 shrink-0 items-center gap-0.5 text-[13px] font-semibold text-granate underline-offset-4 hover:underline">
            {enlace.texto} <ChevronRight size={14} aria-hidden />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/** Texto en gris cuando no hay dato: nunca un 0 inventado. */
export function SinDato({ children }: { children: ReactNode }) {
  return <p className="text-[13.5px] text-mute">{children}</p>;
}

export interface RubroGasto {
  nombre: string;
  pim: number;
  devengado: number;
}

/**
 * "En qué gasta": los rubros más grandes del presupuesto (PIM), cada barra con la parte ya gastada (devengado)
 * encima. El largo es contra el rubro mayor; el texto dice qué parte del total es.
 */
export function BarrasGasto({ rubros, total, maximo = 5 }: { rubros: RubroGasto[]; total: number; maximo?: number }) {
  const lista = [...rubros].filter((r) => r.pim > 0).sort((a, b) => b.pim - a.pim).slice(0, maximo);
  const mayor = Math.max(1, ...lista.map((r) => r.pim));
  return (
    <ol className="space-y-3">
      {lista.map((r) => {
        const gastado = r.pim > 0 ? (r.devengado / r.pim) * 100 : 0;
        return (
          <li key={r.nombre}>
            <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
              <span className="min-w-0 truncate text-ink" title={r.nombre}>{tituloNatural(r.nombre)}</span>
              <span className="shrink-0 font-mono tabular-nums text-inkSoft">{solesCompacto(r.pim)}</span>
            </div>
            <div
              className="mt-1 h-2 overflow-hidden rounded-full bg-paperDeep"
              role="img"
              aria-label={`${solesCompacto(r.pim)} de presupuesto, ${porcentaje(gastado)} ya gastado`}
            >
              <div className="h-full rounded-full bg-granate/25" style={{ width: `${Math.max(2, (r.pim / mayor) * 100)}%` }}>
                <div className="h-full rounded-full bg-granate" style={{ width: `${Math.min(100, gastado)}%` }} />
              </div>
            </div>
            <dl className="mt-1 flex flex-wrap gap-x-5 text-[12px]">
              <div className="flex gap-1">
                <dt className="text-mute">Gastado</dt>
                <dd className="font-mono tabular-nums text-ink">{porcentaje(gastado)}</dd>
              </div>
              <div className="flex gap-1">
                <dt className="text-mute">Del total</dt>
                <dd className="font-mono tabular-nums text-ink">{porcentaje(total > 0 ? (r.pim / total) * 100 : 0)}</dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ol>
  );
}

/** Filas "etiqueta … número", cada una con su enlace al filtro que la muestra. */
export function ListaConteos({ filas }: { filas: { etiqueta: string; n: number; href?: string; detalle?: string; grave?: boolean }[] }) {
  return (
    <ul className="divide-y divide-line/70 rounded-xl border border-line">
      {filas.map((f) => {
        const cuerpo = (
          <>
            <span className="min-w-0">
              <span className={`block truncate text-[13.5px] ${f.grave ? "font-semibold text-ink" : "text-ink"}`}>{f.etiqueta}</span>
              {f.detalle && <span className="block truncate text-[12px] text-mute">{f.detalle}</span>}
            </span>
            <span className="shrink-0 font-mono text-[13.5px] tabular-nums text-ink">{numero(f.n)}</span>
          </>
        );
        return (
          <li key={f.etiqueta}>
            {f.href && f.n > 0 ? (
              <Link href={f.href} prefetch={false} className="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2 transition-colors hover:bg-granate-50">
                {cuerpo}
              </Link>
            ) : (
              <span className="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2">{cuerpo}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Nombre corto de un tipo de antecedente ("Sancionado por el OECE"), del mismo catálogo que el desplegable. */
const CORTO = new Map(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t.corto] as const)));
export const nombreCruce = (tipo: string) => CORTO.get(tipo) ?? tipo.replace(/_/g, " ");

/**
 * Banderas levantadas: riesgo de lo leído y antecedentes del ganador (con uno grave, con alguno y los tipos más
 * frecuentes). `href(filtro)` arma el enlace a la lista de contratos ya filtrada.
 */
export function Banderas({
  porRiesgo,
  porCruces,
  href,
  tipos = 5,
}: {
  porRiesgo: Partial<Record<string, number>> | null | undefined;
  porCruces: { con: number; alta: number; tipos?: Record<string, number> } | null | undefined;
  href: (filtro: Record<string, string>) => string;
  tipos?: number;
}) {
  if (!porRiesgo && !porCruces) return <SinDato>Sin dato: el servicio de contratos no respondió.</SinDato>;
  const filas = [
    { etiqueta: "Leídos con riesgo alto", n: porRiesgo?.alto ?? 0, href: href({ riesgo: "alto" }), grave: true },
    { etiqueta: "Leídos con riesgo medio", n: porRiesgo?.medio ?? 0, href: href({ riesgo: "medio" }) },
    ...(porCruces
      ? [
          { etiqueta: "Ganador con un antecedente grave", n: porCruces.alta, href: href({ cruces: "alta" }), grave: true },
          { etiqueta: "Ganador con algún antecedente", n: porCruces.con, href: href({ cruces: "con" }) },
          ...Object.entries(porCruces.tipos ?? {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, tipos)
            .map(([tipo, n]) => ({ etiqueta: nombreCruce(tipo), detalle: "antecedente del ganador", n, href: href({ cruces: tipo }) })),
        ]
      : []),
  ];
  return <ListaConteos filas={filas} />;
}

/** Barras de un solo valor (monto), contra el mayor: "en qué contrataron", "dónde". Cada fila puede llevar a su filtro. */
export function BarrasMonto({ items, maximo = 6 }: { items: { nombre: string; monto: number; detalle?: string; href?: string }[]; maximo?: number }) {
  const lista = [...items].filter((i) => i.monto > 0).sort((a, b) => b.monto - a.monto).slice(0, maximo);
  const mayor = Math.max(1, ...lista.map((i) => i.monto));
  return (
    <ol className="space-y-3">
      {lista.map((i) => {
        const fila = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-[13.5px]">
              <span className="min-w-0 truncate text-ink" title={i.nombre}>{tituloNatural(i.nombre)}</span>
              <span className="shrink-0 font-mono tabular-nums text-inkSoft">{solesCompacto(i.monto)}</span>
            </span>
            <span className="mt-1 block h-2 overflow-hidden rounded-full bg-paperDeep" role="img" aria-label={`${solesCompacto(i.monto)}`}>
              <span className="block h-full rounded-full bg-granate" style={{ width: `${Math.max(2, (i.monto / mayor) * 100)}%` }} />
            </span>
            {i.detalle && <span className="mt-0.5 block text-[12px] text-mute">{i.detalle}</span>}
          </>
        );
        return (
          <li key={i.nombre}>
            {i.href ? (
              <Link href={i.href} prefetch={false} className="block rounded-lg transition-colors hover:bg-granate-50">{fila}</Link>
            ) : (
              <span className="block">{fila}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Un reparto en fichas: cada parte con su nombre y su número, cada ficha su propio enlace (si lo tiene). Para "por tipo"
 * y "¿lo leyó Vigía?": datos distintos lado a lado, no una frase con separadores.
 */
export function Fichas({ items }: { items: { etiqueta: string; n: number; href?: string; destacada?: boolean }[] }) {
  const visibles = items.filter((i) => i.n > 0);
  if (!visibles.length) return <span className="text-mute">Ninguno</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {visibles.map((i) => {
        const cuerpo = (
          <>
            <span className={i.destacada ? "font-semibold text-ink" : "text-inkSoft"}>{i.etiqueta}</span>
            <span className="font-mono text-[12.5px] tabular-nums text-ink">{numero(i.n)}</span>
          </>
        );
        const clase = "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-paper px-3 text-[13px]";
        return (
          <li key={i.etiqueta}>
            {i.href ? (
              <Link href={i.href} prefetch={false} className={`${clase} transition-colors hover:border-granate/40 hover:bg-granate-50`}>{cuerpo}</Link>
            ) : (
              <span className={clase}>{cuerpo}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
