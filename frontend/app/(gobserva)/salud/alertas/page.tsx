import type { Metadata } from "next";
import Link from "next/link";
import { Pill, RotateCw, TriangleAlert } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { FuenteFecha } from "@/components/salud/comun";
import { BarraFiltros, ProveedorFiltros, Resultados } from "@/components/salud/filtros/BarraFiltros";
import { Paginas } from "@/components/salud/lista/Paginas";
import { FilaAlerta } from "@/components/salud/medicamentos/piezas";
import { CabeceraLista, Ruta } from "@/components/salud/portada/Piezas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { getAlertas, numero, TIPOS_ALERTA, type TipoAlerta } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";

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
 * /alertas de Gobserva Salud: las alertas DIGEMID, de la más nueva a la más vieja, 10 por página. 2026-11-22: la franja con
 * cuántas hay, la barra con el tipo (falsificados primero, con cuántas de cada uno) y la búsqueda por producto o lote, que
 * se aplican sin recargar. GET /salud/alertas (10 min en caché).
 */
export default async function Alertas({ searchParams }: Props) {
  const base = baseProducto("salud");
  const tipo = tipoDe(searchParams?.tipo);
  const q = texto(searchParams?.q);
  const pagina = Math.max(1, Number(texto(searchParams?.pagina)) || 1);
  const d = await getAlertas(new URLSearchParams({ ...(tipo ? { tipo } : {}), ...(q ? { q } : {}), pagina: String(pagina), tamano: String(POR_PAGINA) }));
  const lista = rutaEn(base, "/alertas");
  const qs = (c: { pagina?: number }) => {
    const p = new URLSearchParams();
    if (tipo) p.set("tipo", tipo);
    if (q) p.set("q", q);
    if (c.pagina && c.pagina > 1) p.set("pagina", String(c.pagina));
    const s = p.toString();
    return s ? `${lista}?${s}` : lista;
  };
  const paginas = d ? Math.min(500, Math.max(1, Math.ceil(d.total / POR_PAGINA))) : 1;
  const params: Record<string, string> = { ...(tipo ? { tipo } : {}), ...(q ? { q } : {}) };

  return (
    <div className="container-page pb-10 pt-4 sm:pb-14 sm:pt-5">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Medicamentos", href: rutaEn(base, "/medicamentos") }, { etiqueta: "Alertas de DIGEMID" }]} />
      <ProveedorFiltros ruta={lista} params={params}>
        <CabeceraLista
          className="mt-2"
          titulo={tipo ? `Alertas de DIGEMID: ${TIPOS_ALERTA[tipo].nombre.toLowerCase()}` : "Alertas de DIGEMID"}
          resumen={
            d && (
              <>
                <span>
                  <b className="font-semibold tabular-nums text-ink">{numero(d.total)}</b> {d.total === 1 ? "alerta" : "alertas"}, la más nueva primero
                </span>
                <Ayuda titulo="¿Qué es una alerta de DIGEMID?" etiqueta="Qué es una alerta de DIGEMID">
                  <span className="block">Un aviso oficial sobre un medicamento, un dispositivo o un producto sanitario: falsificados, lotes retirados, riesgos o cambios.</span>
                  <span className="mt-1 block">El lote y el registro sanitario están en el PDF de cada alerta: compáralos con tu caja. Una alerta de un lote no dice que todo el producto esté observado.</span>
                </Ayuda>
              </>
            )
          }
          acciones={
            <Link href={rutaEn(base, "/medicamentos")} className="gs-hunde inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-paper px-4 text-dato font-semibold text-ink hover:border-granate/60 hover:text-granate sm:min-h-10">
              <Pill size={16} aria-hidden className="text-granate" />
              <span className="sm:hidden">Verificar</span>
              <span className="hidden sm:inline">Verificar un medicamento</span>
            </Link>
          }
        />

        <BarraFiltros
          className="mt-4"
          busqueda={{ clave: "q", valor: q, ejemplo: "Producto, principio activo o lote" }}
          filtros={[
            {
              tipo: "uno",
              clave: "tipo",
              etiqueta: "Tipo de alerta",
              valor: tipo,
              opciones: ORDEN.filter((t) => d?.tipos[t]).map((t) => ({ valor: t, nombre: TIPOS_ALERTA[t].nombre, detalle: TIPOS_ALERTA[t].explica, n: d?.tipos[t] ?? null })),
            },
          ]}
        />

        <Resultados clave={`${tipo ?? ""}-${q}-${pagina}`} className="mt-4">
          {!d ? (
            <div className="rounded-2xl border border-line bg-paper">
              <EstadoError
                texto="No pudimos leer las alertas ahora. Suele ser momentáneo: vuelve a intentarlo en unos segundos."
                acciones={
                  <a href={qs({ pagina })} className={claseAccion("secundario", "min-h-11")}>
                    <RotateCw size={15} aria-hidden /> Volver a intentar
                  </a>
                }
              />
            </div>
          ) : d.filas.length === 0 ? (
            <div className="rounded-2xl border border-line bg-paper">
              <EstadoVacio Icono={TriangleAlert} titulo="Ninguna alerta con estos filtros" texto="Prueba con menos palabras o con el principio activo. El lote se busca dentro del PDF de cada alerta." />
            </div>
          ) : (
            <>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper" aria-label="Alertas de DIGEMID">
                {d.filas.map((a) => (
                  <li key={a.id}>
                    <FilaAlerta a={a} />
                  </li>
                ))}
              </ul>
              <p className="mt-3">
                <FuenteFecha nombre="Alertas DIGEMID" url={d.fuente.avisos.url} al={d.fuente.avisos.al} />
              </p>
              {paginas > 1 && (
                <Paginas className="mt-5" pagina={Math.min(pagina, paginas)} paginas={paginas} total={d.total} tamano={POR_PAGINA} nombre={d.total === 1 ? "alerta" : "alertas"} href={(n) => qs({ pagina: n })} />
              )}
            </>
          )}
        </Resultados>
      </ProveedorFiltros>
    </div>
  );
}
