import type { Metadata } from "next";
import { NO_INDEXAR } from "@/lib/seo";
import type { ReactNode } from "react";
import Link from "next/link";
import { DoorOpen, FileSearch, FileText, Flag, IdCard, Receipt, Ruler, Users, Wallet } from "lucide-react";
import { EncabezadoPagina, FuenteDato, Migas, Nota, Pagina } from "@/components/patrones";
import { getConteosEntidad, getEntidad, getEntidades, type ApiEntidad } from "@/lib/api-client";
import { banderasEntidad } from "@/lib/banderasEntidad";
import { numero, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { etiquetaTipoVisible } from "@/lib/entidad-tipo";
import { uno } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Comparar entidades",
  description: "Dos entidades del Estado lado a lado: contratos, órdenes, locadores, planilla, visitas, informes de control, banderas y presupuesto.",
  // Una herramienta: lo que muestra son dos fichas que ya se indexan por su cuenta.
  robots: NO_INDEXAR,
};

/**
 * /app/comparar?a=&b= — dos entidades lado a lado (fase 6 del plan del 2026-10-27): las mismas cifras de su ficha, cada una
 * con el enlace a su pestaña, y sus banderas. Cada lado acepta un RUC o un nombre (con un nombre, se elige de una lista).
 * Sin JavaScript: el formulario recarga la página con los dos parámetros.
 */
type Busqueda = Record<string, string | string[] | undefined>;

interface Lado {
  ruc: string;
  nombre: string;
  tipo: string | null;
  lugar: string | null;
  /** `n`: la cifra en bruto, para la barra que la compara con la del otro lado. */
  filas: Record<string, { valor: string; n?: number | null; href?: string; sub?: string }>;
  banderas: { nombre: string; severidad: string; href: string }[];
}

const FILAS: { clave: string; titulo: string; icono: ReactNode }[] = [
  { clave: "contratos", titulo: "Contratos desde 2015", icono: <FileText size={15} aria-hidden /> },
  { clave: "ordenes", titulo: "Órdenes de compra y de servicio", icono: <Receipt size={15} aria-hidden /> },
  { clave: "personas", titulo: "Personas contratadas por órdenes", icono: <Users size={15} aria-hidden /> },
  { clave: "planilla", titulo: "Personas en su planilla", icono: <IdCard size={15} aria-hidden /> },
  { clave: "plazas", titulo: "Plazas CAS convocadas", icono: <Ruler size={15} aria-hidden /> },
  { clave: "visitas", titulo: "Visitas registradas", icono: <DoorOpen size={15} aria-hidden /> },
  { clave: "informes", titulo: "Informes de la Contraloría", icono: <FileSearch size={15} aria-hidden /> },
  { clave: "presupuesto", titulo: "Presupuesto del último año", icono: <Wallet size={15} aria-hidden /> },
];

/** Cada lado con su color, el mismo de los duelos de partidos: lima el primero, añil el segundo. */
const LADO = [
  { barra: "bg-granate", muestra: "bg-granate" },
  { barra: "bg-anil", muestra: "bg-anil" },
] as const;

/** La rejilla de cada fila: en el celular, el nombre de la cifra arriba y los dos lados debajo; desde sm, tres columnas. */
const REJILLA = "grid grid-cols-2 gap-x-3 gap-y-1.5 px-4 sm:grid-cols-[minmax(0,30%)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-5 sm:px-5";

/** Las banderas a la vista por lado; las demás, plegadas. */
const BANDERAS_A_LA_VISTA = 5;

async function lado(ruc: string): Promise<Lado | null> {
  const [r, c] = await Promise.all([getEntidad(ruc).catch(() => null), getConteosEntidad(ruc).catch(() => null)]);
  if (!r?.entidad) return null;
  const e = r.entidad;
  const base = `/entidad/${ruc}`;
  const mef = r.mef?.kind === "ok" ? [...(r.mef.by_year ?? [])].sort((x, y) => Number(y.year) - Number(x.year)).find((y) => Number(y.pim) > 0) : null;
  const banderas = (banderasEntidad(ruc, r.senales, r.informes, r.nepotismo?.total ?? 0) ?? []).map((b) => ({ nombre: b.chip, severidad: b.severidad, href: b.href }));
  return {
    ruc,
    nombre: e.nombre ? tituloNatural(String(e.nombre)) : `Entidad con RUC ${ruc}`,
    tipo: etiquetaTipoVisible(e.tipo ?? null, e.nombre),
    lugar: [e.region, e.provincia, e.distrito].filter(Boolean).join(", ") || null,
    filas: {
      contratos: { valor: numero(Number(e.contratos ?? 0)), n: Number(e.contratos ?? 0), href: `${base}?seccion=contratos&vista=contratos` },
      ordenes: c ? { valor: c.ordenes != null ? numero(c.ordenes) : "Sin contar", n: c.ordenes, sub: c.ordenesMonto ? solesCompacto(c.ordenesMonto) : undefined, href: `${base}?seccion=contratos&vista=ordenes` } : { valor: "Sin dato" },
      personas: { valor: c ? numero(c.personas) : "Sin dato", n: c?.personas, href: `${base}?seccion=personas` },
      planilla: { valor: c ? numero(c.planilla) : "Sin dato", n: c?.planilla, href: `${base}?seccion=planilla` },
      plazas: { valor: c ? numero(c.plazas) : "Sin dato", n: c?.plazas, href: `${base}?seccion=plazas` },
      visitas: { valor: c?.visitas != null ? numero(c.visitas) : "Sin dato", n: c?.visitas, href: `${base}?seccion=visitas` },
      informes: { valor: c ? numero(c.informes) : "Sin dato", n: c?.informes, sub: r.informes?.penal ? `${numero(r.informes.penal)} con responsabilidad penal` : undefined, href: `${base}?seccion=control` },
      presupuesto: mef
        ? { valor: solesCompacto(Number(mef.pim)), n: Number(mef.pim), sub: `${mef.year}: ${porcentaje((Number(mef.devengado) / Number(mef.pim)) * 100, { decimales: 0 })} gastado`, href: `${base}?seccion=presupuesto` }
        : { valor: "Sin dato del MEF" },
    },
    banderas,
  };
}

/** Un RUC tal cual; un nombre, las entidades que lo llevan (para elegir). */
async function resolver(texto: string | undefined): Promise<{ ruc: string | null; opciones: ApiEntidad[] }> {
  const t = (texto ?? "").trim();
  if (!t) return { ruc: null, opciones: [] };
  if (/^\d{11}$/.test(t)) return { ruc: t, opciones: [] };
  const opciones = await getEntidades({ q: t, limit: 8 }).catch(() => [] as ApiEntidad[]);
  return { ruc: opciones.length === 1 ? opciones[0].ruc : null, opciones };
}

export default async function CompararPage({ searchParams }: { searchParams?: Busqueda }) {
  const qa = uno(searchParams?.a);
  const qb = uno(searchParams?.b);
  const [ra, rb] = await Promise.all([resolver(qa), resolver(qb)]);
  const [a, b] = await Promise.all([ra.ruc ? lado(ra.ruc) : null, rb.ruc ? lado(rb.ruc) : null]);
  const enlace = (x: string | null | undefined, y: string | null | undefined) => `/app/comparar?${new URLSearchParams({ ...(x ? { a: x } : {}), ...(y ? { b: y } : {}) })}`;
  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Entidades", href: "/app/entidades" }, { etiqueta: "Comparar", href: "/app/comparar" }]} />
      <EncabezadoPagina titulo="Comparar dos entidades" bajada="Las mismas cifras de su ficha, lado a lado. Escribe un RUC o un nombre en cada lado." />

      <form method="get" action="/app/comparar" className="grid gap-3 rounded-2xl border border-line bg-paper p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        {(["a", "b"] as const).map((k, i) => (
          <label key={k} className="block space-y-1">
            <span className="flex items-center gap-2 text-rotulo font-semibold text-ink">
              <span aria-hidden className={cn("h-2.5 w-2.5 rounded-sm", LADO[i].muestra)} />
              {i === 0 ? "Primera entidad" : "Segunda entidad"}
            </span>
            <input
              name={k}
              defaultValue={(k === "a" ? (a?.ruc ?? qa) : (b?.ruc ?? qb)) ?? ""}
              placeholder="RUC o nombre (p. ej., Municipalidad de Comas)"
              className="h-10 w-full rounded-xl border border-line bg-paper px-3 text-dato text-ink hover:border-paperEdge focus:border-granate"
            />
          </label>
        ))}
        <button type="submit" className="h-10 rounded-full bg-ink px-5 text-dato font-semibold text-paper hover:bg-ink/90">
          Comparar
        </button>
      </form>

      {/* Con un nombre que calza con varias, se elige de la lista. */}
      {([["a", ra, qb] as const, ["b", rb, qa] as const]).map(([k, r, otra]) =>
        !r.ruc && r.opciones.length > 1 ? (
          <div key={k} className="space-y-2 rounded-2xl border border-line bg-paper p-4">
            <h2 className="font-display text-bloque font-bold text-ink">¿Cuál de estas es la {k === "a" ? "primera" : "segunda"}?</h2>
            <ul className="flex flex-wrap gap-2">
              {r.opciones.map((o) => (
                <li key={o.ruc}>
                  <Link
                    href={k === "a" ? enlace(o.ruc, b?.ruc ?? otra) : enlace(a?.ruc ?? otra, o.ruc)}
                    className="inline-flex min-h-[36px] items-center rounded-full border border-line bg-paper px-3 text-meta text-ink hover:border-granate/40"
                  >
                    {tituloNatural(o.nombre ?? o.ruc)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}

      {/* Lado a lado en una tarjeta (2026-11-23, el usuario: «esta mierda es texto plano»): cada cifra con su ícono, el
          número grande y, con las dos entidades, una barra de su color que la mide contra la del otro lado. Las banderas, con
          cuántas y de qué gravedad, y las primeras a la vista. */}
      {(a || b) && (
        <section aria-label="Comparación de las dos entidades" className="tarjeta overflow-hidden rounded-2xl border border-line bg-paper">
          {/* Una rejilla, no una tabla: en el celular el nombre de cada cifra va arriba, a todo el ancho, y los dos lados
              debajo, mitad y mitad (en una tabla de tres columnas el nombre de la entidad se partía en una palabra por línea). */}
          <div role="table" aria-label="Comparación de las dos entidades">
            <div role="rowgroup">
              <div role="row" className={cn(REJILLA, "border-b border-line bg-paperSoft py-3")}>
                <span role="columnheader" className="hidden sm:block">
                  <span className="sr-only">Cifra</span>
                </span>
                {[a, b].map((x, i) => (
                  <div key={i} role="columnheader" className="min-w-0">
                    {x ? (
                      <Link href={`/entidad/${x.ruc}`} className="group block">
                        <span className="flex items-start gap-2">
                          <span aria-hidden className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm", LADO[i].muestra)} />
                          <span className="min-w-0">
                            <span className="block break-words font-display text-dato font-bold leading-snug text-ink group-hover:text-granate sm:text-bloque">{x.nombre}</span>
                            <span className="mt-0.5 block text-rotulo font-normal text-inkSoft">{[x.tipo, x.lugar].filter(Boolean).join(", ")}</span>
                          </span>
                        </span>
                      </Link>
                    ) : (
                      <span className="flex items-start gap-2 text-meta font-normal text-mute">
                        <span aria-hidden className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-sm opacity-40", LADO[i].muestra)} />
                        Elige una entidad arriba
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div role="rowgroup" className="divide-y divide-line/70">
              {FILAS.map((f) => {
                const ns = [a, b].map((x) => x?.filas[f.clave]?.n ?? null);
                const tope = a && b && ns.every((n) => n != null) ? Math.max(ns[0]!, ns[1]!) : 0;
                return (
                  <div key={f.clave} role="row" className={cn(REJILLA, "py-3")}>
                    <span role="rowheader" className="col-span-2 flex items-start gap-2 text-meta font-semibold leading-snug text-ink sm:col-span-1">
                      <span className="mt-px shrink-0 text-mute">{f.icono}</span>
                      <span className="min-w-0">{f.titulo}</span>
                    </span>
                    {[a, b].map((x, i) => {
                      const v = x?.filas[f.clave];
                      const n = ns[i];
                      return (
                        <div key={i} role="cell" className="min-w-0">
                          {v ? (
                            v.href ? (
                              <Link href={v.href} prefetch={false} className="font-display text-dato font-bold tabular-nums text-ink underline decoration-line underline-offset-[3px] hover:decoration-granate sm:text-bloque">
                                {v.valor}
                              </Link>
                            ) : (
                              <span className="text-meta text-inkSoft">{v.valor}</span>
                            )
                          ) : null}
                          {tope > 0 && n != null ? (
                            <span aria-hidden className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-paperDeep">
                              <span className={cn("block h-full rounded-full", LADO[i].barra)} style={{ width: `${n > 0 ? Math.max(3, Math.round((100 * n) / tope)) : 0}%` }} />
                            </span>
                          ) : null}
                          {v?.sub && <span className="mt-1 block text-rotulo text-mute">{v.sub}</span>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div role="row" className={cn(REJILLA, "py-3")}>
                <span role="rowheader" className="col-span-2 flex items-start gap-2 text-meta font-semibold leading-snug text-ink sm:col-span-1">
                  <Flag size={15} aria-hidden className="mt-px shrink-0 text-mute" />
                  Banderas
                </span>
                {[a, b].map((x, i) => {
                  if (!x) return <div key={i} role="cell" />;
                  const graves = x.banderas.filter((bd) => bd.severidad === "alta").length;
                  const vista = x.banderas.slice(0, BANDERAS_A_LA_VISTA);
                  const resto = x.banderas.slice(BANDERAS_A_LA_VISTA);
                  const chip = (bd: Lado["banderas"][number]) => (
                    <li key={bd.nombre}>
                      <Link
                        href={bd.href}
                        prefetch={false}
                        className={cn(
                          "inline-flex min-h-[28px] items-center rounded-lg border px-2 py-0.5 text-rotulo font-semibold leading-snug",
                          bd.severidad === "alta" ? "border-crimson/30 bg-crimson-soft text-crimsonTexto" : "border-amber/40 bg-amber-soft text-amberTexto",
                        )}
                      >
                        {bd.nombre}
                      </Link>
                    </li>
                  );
                  return (
                    <div key={i} role="cell" className="min-w-0">
                      {x.banderas.length === 0 ? (
                        <span className="text-meta text-mute">Ninguna</span>
                      ) : (
                        <>
                          <p className="text-meta text-inkSoft">
                            <b className="font-display text-dato font-bold tabular-nums text-ink sm:text-bloque">{numero(x.banderas.length)}</b>
                            {graves > 0 ? <span className="text-crimsonTexto">, {numero(graves)} {graves === 1 ? "grave" : "graves"}</span> : null}
                          </p>
                          {graves > 0 && (
                            <span aria-hidden className="mt-1.5 flex h-1.5 gap-[2px] overflow-hidden rounded-full">
                              <span className="h-full bg-crimson" style={{ width: `${(100 * graves) / x.banderas.length}%` }} />
                              <span className="h-full flex-1 bg-amber" />
                            </span>
                          )}
                          <ul className="mt-2 flex flex-wrap gap-1.5">{vista.map(chip)}</ul>
                          {resto.length > 0 && (
                            <details className="group/banderas mt-1.5">
                              <summary className="inline-flex min-h-9 cursor-pointer list-none items-center text-meta font-semibold text-granate hover:underline [&::-webkit-details-marker]:hidden">
                                <span className="group-open/banderas:hidden">Ver {resto.length === 1 ? "la otra" : `las otras ${numero(resto.length)}`}</span>
                                <span className="hidden group-open/banderas:inline">Ver menos</span>
                              </summary>
                              <ul className="mt-1 flex flex-wrap gap-1.5">{resto.map(chip)}</ul>
                            </details>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <FuenteDato
            fuente="OECE, Portal de Transparencia, SERVIR, registro de visitas, Contraloría y MEF (las fuentes de cada ficha)"
            className="border-t border-line px-4 py-2.5 sm:px-5"
          />
        </section>
      )}
      {a && b && (
        <Nota>
          Compara entidades del mismo tipo y tamaño (dos municipalidades distritales, dos hospitales): un ministerio siempre tendrá más de
          todo. Una bandera es un indicio para revisar, no una acusación.
        </Nota>
      )}
    </Pagina>
  );
}
