import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Banknote, BookOpenCheck, Briefcase, Building2, FileText, HardHat, Landmark, Receipt, Users, type LucideIcon } from "lucide-react";
import { porcentaje } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Las cifras de cabecera de una vista: 1 a 4 tarjetas iguales, cada una con lo que ES arriba (una línea), el número
 * grande y su contexto pequeño debajo (DESIGN_SYSTEM.md §10.7: número, qué es, contexto).
 *
 * Historia: primero eran cajas de 270 x 110 px con dos líneas de texto (60 % vacías); después una franja sin cajas,
 * con la etiqueta AL LADO del número, que en 4 columnas partía "personas contratadas con 16,268,389 órdenes de
 * servicio" en cuatro renglones apretados. Ahora la tarjeta apila sus tres niveles y mide lo que mide su texto; las
 * tarjetas llenan la fila según cuántas son (2, 3 o 4 columnas; una sola ocupa un cuarto). En el celular, 2 por fila.
 *
 * Server-safe (sin estado): `href` usa <Link>, y `ayuda` recibe un <Ayuda/> ya armado.
 *
 * Props de cada cifra (`Cifra`):
 *   valor     ya formateado ("18,393", "S/ 1.3 M"). `null` = sin dato: se dice "Sin dato", no se inventa un 0.
 *   etiqueta  qué es, en pocas palabras ("contratos leídos").
 *   contexto  denominador, fuente o fecha, en tercer nivel ("de 18,393 publicados").
 *   ayuda     <Ayuda/> junto a la etiqueta (el ⓘ).
 *   tono      "neutro" | "alta" | "media" | "positivo": solo severidad y lo positivo colorean el número.
 *   href      la tarjeta entera es el enlace a su lista filtrada.
 *   marca     clase de relleno de un punto junto a la etiqueta (une la cifra con su tramo en `pie`).
 * Props del grupo: `chico` (cifras de apoyo que no son el foco de la página), `items` (máx. 4), `pie` (una barra
 * opcional debajo, p. ej. el reparto), `className` y `apilado` (dos por fila en todos los anchos: para una columna
 * angosta, p. ej. una ficha con barra lateral).
 */

export interface Cifra {
  valor: ReactNode | null;
  etiqueta: string;
  contexto?: ReactNode;
  ayuda?: ReactNode;
  tono?: "neutro" | "alta" | "media" | "positivo";
  href?: string;
  marca?: string;
  /** Ícono de la cifra. Sin él, sale de la etiqueta (contratos, órdenes, soles, personas…); `null` lo quita. */
  icono?: ReactNode | null;
  /** La proporción que dibuja la barra (0 a 1). Sin ella, sale del contexto («de 2,540 con dictamen», «53 % gastado»); `null` la quita. */
  parte?: number | null;
}

/** El ícono que le toca a una cifra por lo que dice su etiqueta: el orden importa (lo más específico primero). */
const ICONOS: [RegExp, LucideIcon][] = [
  [/riesgo|grave|señal|sanci|penalidad|alerta|antecedente/i, AlertTriangle],
  [/le[ií]d|dictamen|lectura|en cola|revisi[oó]n|analiz/i, BookOpenCheck],
  [/presupuesto|monto|adjudicad|gast|aport|soles|cost|pagad|valor|recaud/i, Banknote],
  [/[oó]rden|compra/i, Receipt],
  [/obra|inversi/i, HardHat],
  [/contrat|convocatoria|proceso|buenas? pro|informe|denuncia/i, FileText],
  [/empresa|proveedor|postor/i, Briefcase],
  [/persona|funcionari|planilla|plaza|visita|trabajador|aliado/i, Users],
  [/partido|gobiern|autoridad|candidat/i, Landmark],
  [/entidad|municip|regi[oó]n|distrito|provincia/i, Building2],
];
function iconoDe(it: Cifra): ReactNode | null {
  if (it.icono !== undefined) return it.icono;
  const Icono = ICONOS.find(([re]) => re.test(it.etiqueta))?.[1];
  return Icono ? <Icono size={15} strokeWidth={1.9} aria-hidden /> : null;
}

const entero = (s: string) => Number(s.replace(/,/g, ""));
/**
 * La proporción de una cifra, leída de lo que ya dice: «763» con contexto «de 2,540 con dictamen» es 30 %; un contexto
 * que empieza con su porcentaje («53 % ya gastado») es ese porcentaje. Sin denominador a la vista no hay barra: no se
 * inventa una. `rotulo` es falso cuando el contexto ya dice el porcentaje (no se repite junto a la barra).
 */
function parteDe(it: Cifra): { p: number; rotulo: boolean } | null {
  if (it.parte === null) return null;
  // Si la cifra ya ES el porcentaje («12 %»), la barra va sin repetirlo.
  if (typeof it.parte === "number") return it.parte >= 0 && it.parte <= 1 ? { p: it.parte, rotulo: !(typeof it.valor === "string" && it.valor.includes("%")) } : null;
  if (typeof it.contexto !== "string") return null;
  const pct = it.contexto.match(/^\s*(\d+(?:[.,]\d+)?)\s?%/);
  if (pct) {
    const p = Number(pct[1].replace(",", ".")) / 100;
    return p >= 0 && p <= 1 ? { p, rotulo: false } : null;
  }
  // «de 2017 a 2025» es un periodo, no un denominador.
  if (/^de \d{4}( a |[,.]|$)/.test(it.contexto)) return null;
  const de = it.contexto.match(/^de ([\d,]+)(?!\.\d)\b/);
  if (!de || typeof it.valor !== "string" || !/^[\d,]+$/.test(it.valor.trim())) return null;
  const total = entero(de[1]);
  const v = entero(it.valor.trim());
  return total > 0 && v <= total ? { p: v / total, rotulo: !/%/.test(it.contexto) } : null;
}

const BARRA: Record<NonNullable<Cifra["tono"]>, string> = {
  neutro: "bg-[rgb(var(--acento-cifra))]",
  alta: "bg-rust",
  media: "bg-amber",
  positivo: "bg-moss",
};
const PLACA: Record<NonNullable<Cifra["tono"]>, string> = {
  neutro: "bg-paperDeep text-inkSoft",
  alta: "bg-crimson-soft text-rust",
  media: "bg-amber-soft text-amberTexto",
  positivo: "bg-paperDeep text-mossTexto",
};

const TONO: Record<NonNullable<Cifra["tono"]>, string> = {
  neutro: "text-[rgb(var(--acento-cifra))]",
  alta: "text-rust",
  media: "text-amberTexto",
  positivo: "text-mossTexto",
};

/** Un valor con letras ("12 mar. 2025", "hace 3 h") va más chico: a 26 px partía en dos líneas. */
const tieneLetras = (v: ReactNode | null) => typeof v === "string" && /[a-zá-ú]/i.test(v.replace(/^S\//, ""));

export function CifrasEnFila({
  items,
  pie,
  className,
  apilado = false,
  chico = false,
  tarjetas = false,
}: {
  items: Cifra[];
  pie?: ReactNode;
  className?: string;
  apilado?: boolean;
  chico?: boolean;
  /** Ya no hace falta: la franja es lo de siempre (se acepta para no romper llamadas). */
  franja?: boolean;
  /** Las tarjetas de antes (una caja por cifra), sólo si una página las pide. */
  tarjetas?: boolean;
}) {
  const visibles = items.slice(0, 4);
  // Desde el 2026-11-05 la franja es la forma de siempre (el usuario: «sigo viendo cajas así, grandes con poca info»).
  if (!tarjetas) return <Franja items={visibles} pie={pie} className={className} />;
  const fila = (
    // En el celular van de a 2 por fila: con un total impar, la última a todo el ancho (no media fila con un hueco al lado).
    // `apilado` (de a 2 en todo ancho), lo mismo en todos los anchos: la tercera del panel del mapa quedaba sola en media fila.
    <dl
      className={cn(
        "grid grid-cols-2 gap-2.5 max-sm:[&>div:last-child:nth-child(odd)]:col-span-2",
        apilado ? "[&>div:last-child:nth-child(odd)]:col-span-2" : COLUMNAS[visibles.length],
      )}
    >
      {visibles.map((it) => (
        <div
          key={it.etiqueta}
          className={cn(
            // Dentro de una tarjeta, placa suave sin borde (una tarjeta dentro de otra era ruido).
            "relative flex min-w-0 flex-col rounded-2xl border border-line bg-paper [.tarjeta_&]:border-0 [.tarjeta_&]:bg-paperSoft",
            chico ? "gap-1 px-3 py-2.5" : "gap-1.5 px-4 py-3.5",
            it.href && "transition-colors duration-rapido hover:border-granate/40 hover:bg-paperSoft focus-within:ring-2 focus-within:ring-granate",
          )}
        >
          <dt className={cn("flex min-w-0 items-center gap-1 font-medium leading-tight text-inkSoft", chico ? "text-rotulo" : "text-meta")}>
            {it.marca && <span className={cn("mr-0.5 h-2 w-2 shrink-0 rounded-full", it.marca)} aria-hidden />}
            <span className="min-w-0">{it.etiqueta}</span>
            {/* El ⓘ queda por encima del enlace estirado para poder tocarlo. */}
            {it.ayuda && <span className="relative z-[1] shrink-0">{it.ayuda}</span>}
          </dt>
          <dd
            className={cn(
              "font-display font-bold leading-none tracking-tight tabular-nums",
              tieneLetras(it.valor) ? (chico ? "text-cuerpo" : "text-bloque") : chico ? "text-bloque" : "text-cifra",
              TONO[it.tono ?? "neutro"],
            )}
          >
            {it.valor == null ? (
              <span className="text-destacado font-semibold text-mute">Sin dato</span>
            ) : it.href ? (
              // Sin prefetch: el enlace de una cifra filtra el listado; se pide al hacer clic.
              <Link href={it.href} prefetch={false} className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none">
                {it.valor}
              </Link>
            ) : (
              it.valor
            )}
          </dd>
          {it.contexto != null && (
            <dd className={cn("leading-snug text-mute tabular-nums", chico ? "text-micro" : "text-rotulo")}>{it.contexto}</dd>
          )}
        </div>
      ))}
    </dl>
  );
  if (!pie) return <div className={className}>{fila}</div>;
  return (
    <div className={cn("space-y-2.5", className)}>
      {fila}
      <div>{pie}</div>
    </div>
  );
}

/** Columnas desde `sm` según cuántas cifras hay: llenan la fila (clases literales para Tailwind). */
const COLUMNAS: Record<number, string> = {
  1: "sm:grid-cols-2 sm:gap-3 lg:grid-cols-4",
  2: "sm:gap-3",
  3: "sm:grid-cols-3 sm:gap-3",
  4: "sm:gap-3 lg:grid-cols-4",
};

/**
 * Las cifras de cabecera (de una lista o de una ficha) en una franja baja: el número y lo que es en la
 * misma línea, con su contexto a continuación y en tercer nivel, y las cifras una tras otra con aire entre ellas (sin
 * separadores: al partirse en dos renglones, una raya quedaba al inicio del segundo). Pedido del usuario del
 * 2026-11-05: las cuatro tarjetas de 110 px «ocupan tanto espacio» para cifras de toda la base que no cambian con los
 * filtros. Mide ~50 px en escritorio (dos renglones a lo sumo) contra ~120; en el celular, una cifra por renglón.
 * Cada cifra con `href` es un enlace (número y etiqueta), y el ⓘ queda al final de la suya.
 */
const COLUMNAS_FRANJA: Record<number, string> = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "lg:grid-cols-4" };

function Franja({ items, pie, className }: { items: Cifra[]; pie?: ReactNode; className?: string }) {
  return (
    <div className={cn("cifras-franja-caja space-y-2", className)}>
      {/* Una caja y, dentro, una celda por cifra separada por una raya (el hueco de 1 px deja ver el fondo `line`). Antes
          era una línea de texto corrido («4,161 contratos leídos de 60,972…»): no se leía como cifras (2026-11-13). Las
          columnas también miran el ancho de la caja (globals.css, `.cifras-franja`): en una columna angosta cuatro cifras
          lado a lado se leían una palabra por renglón (Lo nuevo, 2026-11-23). */}
      <dl className={cn("cifras-franja grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line [.tarjeta_&]:border-0", COLUMNAS_FRANJA[items.length] ?? "lg:grid-cols-4")}>
        {items.map((it) => {
          const icono = iconoDe(it);
          const parte = it.valor == null ? null : parteDe(it);
          const tono = it.tono ?? "neutro";
          return (
          <div key={it.etiqueta} className="relative flex min-w-0 flex-col gap-0.5 bg-paper px-3.5 py-3 last:odd:col-span-2 sm:last:odd:col-span-1 [.tarjeta_&]:bg-paperSoft">
            <dt className="order-1 flex min-w-0 items-center gap-1 text-rotulo font-medium leading-tight text-mute">
              {it.marca && <span className={cn("h-2 w-2 shrink-0 rounded-full", it.marca)} aria-hidden />}
              {icono && !it.marca && <span className={cn("mr-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md", PLACA[tono])}>{icono}</span>}
              <span className="min-w-0">
                {it.href ? (
                  <Link href={it.href} prefetch={false} className="underline decoration-line underline-offset-4 after:absolute after:inset-0 hover:decoration-granate focus-visible:outline-none">
                    {it.etiqueta}
                  </Link>
                ) : (
                  it.etiqueta
                )}
              </span>
              {it.ayuda && <span className="relative z-[1] shrink-0">{it.ayuda}</span>}
            </dt>
            <dd className={cn("order-2 font-display text-bloque font-bold leading-tight tracking-tight tabular-nums sm:text-seccion", TONO[it.tono ?? "neutro"])}>
              {it.valor == null ? <span className="text-dato font-semibold text-mute">Sin dato</span> : it.valor}
            </dd>
            {parte && (
              <dd className="order-3 mt-1 flex items-center gap-2" aria-hidden>
                <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paperDeep">
                  <span className={cn("block h-full rounded-full", BARRA[tono])} style={{ width: `${parte.p > 0 ? Math.max(2, parte.p * 100) : 0}%` }} />
                </span>
                {parte.rotulo && <span className="shrink-0 font-mono text-rotulo font-semibold tabular-nums text-inkSoft">{parte.p > 0 && parte.p < 0.01 ? `menos de ${porcentaje(1)}` : porcentaje(parte.p * 100)}</span>}
              </dd>
            )}
            {it.contexto != null && <dd className="order-4 mt-0.5 text-rotulo leading-snug text-mute tabular-nums">{it.contexto}</dd>}
          </div>
          );
        })}
      </dl>
      {pie && <div>{pie}</div>}
    </div>
  );
}

/** Las mismas tarjetas mientras llegan los datos: números en esqueleto, nunca un 0 provisional. */
export function CifrasEnFilaSkeleton({ n = 4, className, tarjetas = false }: { n?: number; className?: string; franja?: boolean; tarjetas?: boolean }) {
  if (!tarjetas) {
    return (
      <div className={cn("flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-line bg-paper px-4 py-3.5", className)} aria-hidden>
        {Array.from({ length: Math.min(4, Math.max(1, n)) }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    );
  }
  const k = Math.min(4, Math.max(1, n));
  return (
    <div className={cn("grid grid-cols-2 gap-2.5", COLUMNAS[k], className)} aria-hidden>
      {Array.from({ length: k }).map((_, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-paper px-4 py-3.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
