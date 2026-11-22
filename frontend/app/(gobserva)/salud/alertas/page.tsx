import type { Metadata } from "next";
import Link from "next/link";
import { RotateCw, Search, TriangleAlert, X } from "lucide-react";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { FuenteFecha } from "@/components/salud/comun";
import { Paginas } from "@/components/salud/lista/Paginas";
import { FilaAlerta } from "@/components/salud/medicamentos/piezas";
import { Encabezado, Ruta } from "@/components/salud/portada/Piezas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { getAlertas, numero, TIPOS_ALERTA, type TipoAlerta } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const POR_PAGINA = 10;
const ORDEN: TipoAlerta[] = ["falsificado", "calidad", "seguridad", "modificacion", "internacional", "otra"];

type Props = { searchParams?: Record<string, string | string[] | undefined> };
const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim().slice(0, 80) : "");
const tipoDe = (v: string | string[] | undefined): TipoAlerta | undefined => (ORDEN.includes(texto(v) as TipoAlerta) ? (texto(v) as TipoAlerta) : undefined);

export function generateMetadata({ searchParams }: Props): Metadata {
  const tipo = tipoDe(searchParams?.tipo);
  const q = texto(searchParams?.q);
  return {
    title: tipo ? `Alertas DIGEMID: ${TIPOS_ALERTA[tipo].nombre.toLowerCase()}` : "Alertas DIGEMID de medicamentos y dispositivos",
    description: "Las alertas de DIGEMID sobre productos falsificados, lotes retirados por control de calidad, seguridad y modificaciones, cada una con su PDF oficial.",
    alternates: { canonical: urlCanonica("salud", "/alertas") },
    robots: tipo || q ? { index: false, follow: true } : undefined,
  };
}

/**
 * /alertas de Gobserva Salud (2026-11-21): las alertas DIGEMID, de la más nueva a la más vieja, 10 por página. Una fila de
 * tipos con cuántas hay (falsificados primero: es lo que más le importa a quien compra) y un buscador por producto o lote.
 * GET /salud/alertas (10 min en caché).
 */
export default async function Alertas({ searchParams }: Props) {
  const base = baseProducto("salud");
  const tipo = tipoDe(searchParams?.tipo);
  const q = texto(searchParams?.q);
  const pagina = Math.max(1, Number(texto(searchParams?.pagina)) || 1);
  const d = await getAlertas(new URLSearchParams({ ...(tipo ? { tipo } : {}), ...(q ? { q } : {}), pagina: String(pagina), tamano: String(POR_PAGINA) }));
  const lista = rutaEn(base, "/alertas");
  const qs = (c: { tipo?: TipoAlerta | null; q?: string | null; pagina?: number }) => {
    const p = new URLSearchParams();
    const t = c.tipo === undefined ? tipo : c.tipo;
    const qq = c.q === undefined ? q : c.q;
    if (t) p.set("tipo", t);
    if (qq) p.set("q", qq);
    if (c.pagina && c.pagina > 1) p.set("pagina", String(c.pagina));
    const s = p.toString();
    return s ? `${lista}?${s}` : lista;
  };
  const paginas = d ? Math.min(500, Math.max(1, Math.ceil(d.total / POR_PAGINA))) : 1;
  const totalTipos = d ? Object.values(d.tipos).reduce((a, b) => a + (b ?? 0), 0) : 0;

  return (
    <div className="container-page pb-10 pt-5 sm:pb-14 sm:pt-6">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Medicamentos", href: rutaEn(base, "/medicamentos") }, { etiqueta: "Alertas de DIGEMID" }]} />
      <Encabezado
        figura="frasco"
        className="mt-2"
        titulo="Alertas de DIGEMID"
        bajada="Lo que DIGEMID avisa sobre medicamentos, dispositivos y productos sanitarios: falsificados, lotes retirados, riesgos y cambios. Cada una con su PDF oficial, donde están el lote y el registro sanitario."
      >
        {d && <FuenteFecha nombre="Alertas DIGEMID" url={d.fuente.avisos.url} al={d.fuente.avisos.al} />}
      </Encabezado>

      <form role="search" action={lista} className="mt-6 flex flex-col gap-2 sm:flex-row">
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        <label htmlFor="buscar-alerta" className="sr-only">Buscar por producto o lote</label>
        <div className="relative min-w-0 flex-1">
          <Search size={17} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
          <input
            id="buscar-alerta"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Producto, principio activo o lote"
            className="h-12 w-full rounded-xl border border-line bg-paper pl-10 pr-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30"
          />
        </div>
        <button type="submit" className={claseAccion("primario", "h-12 justify-center")}>Buscar</button>
      </form>

      {d && (
        <nav aria-label="Tipos de alerta" className="mt-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex gap-2 sm:flex-wrap">
            <li>
              <Link
                href={qs({ tipo: null })}
                aria-current={!tipo ? "page" : undefined}
                className={cn("inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-meta font-semibold transition-colors duration-rapido sm:min-h-9", !tipo ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/50")}
              >
                Todas <span className="tabular-nums opacity-80">{numero(totalTipos)}</span>
              </Link>
            </li>
            {ORDEN.filter((t) => d.tipos[t]).map((t) => (
              <li key={t}>
                <Link
                  href={qs({ tipo: t })}
                  aria-current={tipo === t ? "page" : undefined}
                  className={cn("inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-meta font-semibold transition-colors duration-rapido sm:min-h-9", tipo === t ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/50")}
                >
                  {TIPOS_ALERTA[t].nombre} <span className="tabular-nums opacity-80">{numero(d.tipos[t] ?? 0)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {tipo && <p className="mt-2 text-meta text-inkSoft">{TIPOS_ALERTA[tipo].explica}</p>}
      {q && (
        <p className="mt-3">
          <Link href={qs({ q: null })} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-granate/40 bg-granate-50 px-3.5 text-meta font-medium text-ink hover:border-granate sm:min-h-9">
            «{q}» <X size={13} aria-hidden /> <span className="sr-only">(quitar)</span>
          </Link>
        </p>
      )}

      {!d ? (
        <div className="mt-6 rounded-2xl border border-line bg-paper">
          <EstadoError
            texto="No pudimos leer las alertas ahora. Suele ser momentáneo: vuelve a intentarlo en unos segundos."
            acciones={<a href={qs({ pagina })} className={claseAccion("secundario", "min-h-11")}><RotateCw size={15} aria-hidden /> Volver a intentar</a>}
          />
        </div>
      ) : d.filas.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-line bg-paper">
          <EstadoVacio Icono={TriangleAlert} titulo="Ninguna alerta con estos filtros" texto="Prueba con menos palabras o con el principio activo. El lote se busca dentro del PDF de cada alerta." />
        </div>
      ) : (
        <>
          <div id="resultados" className="scroll-mt-32">
            <Paginas className="mt-6" pagina={Math.min(pagina, paginas)} paginas={paginas} total={d.total} tamano={POR_PAGINA} nombre={d.total === 1 ? "alerta" : "alertas"} href={(n) => qs({ pagina: n })} />
          </div>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper" aria-label="Alertas de DIGEMID">
            {d.filas.map((a) => (
              <li key={a.id}>
                <FilaAlerta a={a} />
              </li>
            ))}
          </ul>
          {paginas > 1 && (
            <Paginas className="mt-6" pagina={Math.min(pagina, paginas)} paginas={paginas} total={d.total} tamano={POR_PAGINA} nombre={d.total === 1 ? "alerta" : "alertas"} href={(n) => qs({ pagina: n })} />
          )}
        </>
      )}
    </div>
  );
}
