import type { Metadata } from "next";
import Link from "next/link";
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
  filas: Record<string, { valor: string; href?: string; sub?: string }>;
  banderas: { nombre: string; severidad: string; href: string }[];
}

const FILAS: { clave: string; titulo: string }[] = [
  { clave: "contratos", titulo: "Contratos desde 2015" },
  { clave: "ordenes", titulo: "Órdenes de compra y de servicio" },
  { clave: "personas", titulo: "Personas contratadas por órdenes" },
  { clave: "planilla", titulo: "Personas en su planilla" },
  { clave: "plazas", titulo: "Plazas CAS convocadas" },
  { clave: "visitas", titulo: "Visitas registradas" },
  { clave: "informes", titulo: "Informes de la Contraloría" },
  { clave: "presupuesto", titulo: "Presupuesto del último año" },
];

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
      contratos: { valor: numero(Number(e.contratos ?? 0)), href: `${base}?seccion=contratos&vista=contratos` },
      ordenes: c ? { valor: c.ordenes != null ? numero(c.ordenes) : "Sin contar", sub: c.ordenesMonto ? solesCompacto(c.ordenesMonto) : undefined, href: `${base}?seccion=contratos&vista=ordenes` } : { valor: "Sin dato" },
      personas: { valor: c ? numero(c.personas) : "Sin dato", href: `${base}?seccion=personas` },
      planilla: { valor: c ? numero(c.planilla) : "Sin dato", href: `${base}?seccion=planilla` },
      plazas: { valor: c ? numero(c.plazas) : "Sin dato", href: `${base}?seccion=plazas` },
      visitas: { valor: c?.visitas != null ? numero(c.visitas) : "Sin dato", href: `${base}?seccion=visitas` },
      informes: { valor: c ? numero(c.informes) : "Sin dato", sub: r.informes?.penal ? `${numero(r.informes.penal)} con responsabilidad penal` : undefined, href: `${base}?seccion=control` },
      presupuesto: mef
        ? { valor: solesCompacto(Number(mef.pim)), sub: `${mef.year}: ${porcentaje((Number(mef.devengado) / Number(mef.pim)) * 100, { decimales: 0 })} gastado`, href: `${base}?seccion=presupuesto` }
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

      <form method="get" action="/app/comparar" className="grid gap-3 rounded-xl border border-line bg-paper p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        {(["a", "b"] as const).map((k, i) => (
          <label key={k} className="block space-y-1">
            <span className="text-rotulo font-semibold text-ink">{i === 0 ? "Primera entidad" : "Segunda entidad"}</span>
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
          <div key={k} className="space-y-2">
            <p className="text-meta text-inkSoft">¿Cuál de estas es la {k === "a" ? "primera" : "segunda"}?</p>
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

      {(a || b) && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-left">
            <caption className="sr-only">Comparación de las dos entidades</caption>
            <thead>
              <tr className="border-b border-line bg-paperSoft">
                <th scope="col" className="w-[30%] px-4 py-3 text-rotulo font-semibold uppercase tracking-wide text-mute">Qué</th>
                {[a, b].map((x, i) => (
                  <th key={i} scope="col" className="px-4 py-3 align-top">
                    {x ? (
                      <Link href={`/entidad/${x.ruc}`} className="block text-dato font-bold text-ink hover:text-granate">
                        {x.nombre}
                        <span className="mt-0.5 block text-rotulo font-normal text-inkSoft">{[x.tipo, x.lugar].filter(Boolean).join(", ")}</span>
                      </Link>
                    ) : (
                      <span className="text-meta text-mute">Elige una entidad</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FILAS.map((f) => (
                <tr key={f.clave} className="border-b border-line/60">
                  <th scope="row" className="px-4 py-2.5 text-meta font-semibold text-ink">{f.titulo}</th>
                  {[a, b].map((x, i) => {
                    const v = x?.filas[f.clave];
                    return (
                      <td key={i} className="px-4 py-2.5 align-top">
                        {v ? (
                          v.href ? (
                            <Link href={v.href} prefetch={false} className="font-mono text-dato tabular-nums text-ink underline decoration-line underline-offset-2 hover:decoration-granate">
                              {v.valor}
                            </Link>
                          ) : (
                            <span className="font-mono text-dato tabular-nums text-inkSoft">{v.valor}</span>
                          )
                        ) : null}
                        {v?.sub && <span className="block text-rotulo text-mute">{v.sub}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th scope="row" className="px-4 py-2.5 align-top text-meta font-semibold text-ink">Banderas</th>
                {[a, b].map((x, i) => (
                  <td key={i} className="px-4 py-2.5 align-top">
                    {x && x.banderas.length === 0 && <span className="text-meta text-mute">Ninguna</span>}
                    <ul className="flex flex-wrap gap-1.5">
                      {x?.banderas.map((bd) => (
                        <li key={bd.nombre}>
                          <Link
                            href={bd.href}
                            prefetch={false}
                            className={cn(
                              "inline-flex min-h-[28px] items-center rounded-full border px-2.5 text-rotulo font-semibold",
                              bd.severidad === "alta" ? "border-crimsonTexto/40 text-crimsonTexto" : "border-amberTexto/40 text-amberTexto",
                            )}
                          >
                            {bd.nombre}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {a && b && (
        <Nota>
          Compara entidades del mismo tipo y tamaño (dos municipalidades distritales, dos hospitales): un ministerio siempre tendrá más de
          todo. Una bandera es un indicio para revisar, no una acusación.
        </Nota>
      )}
      <FuenteDato fuente="OECE, Portal de Transparencia, SERVIR, registro de visitas, Contraloría y MEF (las fuentes de cada ficha)" />
    </Pagina>
  );
}
