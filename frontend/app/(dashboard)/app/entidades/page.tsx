import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { EstadoVacio as AvisoEnLinea } from "@/components/ui/EstadoVacio";
import type { Metadata } from "next";
import Link from "next/link";
import { CloudOff, Flag } from "lucide-react";
import { EntidadesPanel, hrefEntidades } from "@/components/EntidadesPanel";
import { BarraFiltros, Listado, ZonaResultados } from "@/components/listado";
import { Ayuda, EncabezadoPagina, Migas, Pagina } from "@/components/patrones";
import {
  getEntidadesPagina,
  getEntidadesResumen,
  getRegionesEntidades,
  parseEntidadesQuery,
  type EntidadesPagina,
  type EntidadesResumen,
} from "@/lib/api-client";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";

export const metadata: Metadata = {
  title: "Entidades del Estado",
  description:
    "Municipalidades, gobiernos regionales, ministerios y empresas públicas, ordenados por cuántos de sus contratos ya tienen dictamen publicado.",
};

const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * /app/entidades — plantilla Listado (DESIGN_SYSTEM.md §14.1): encabezado →
 * indicadores → barra (búsqueda + filtros) → resultados. Búsqueda, filtros y página
 * viven en la URL (`?q=&region=&clase=&nepotismo=&pagina=`).
 *
 * Un solo orden, el del API (contratos con dictamen publicado): «Mayor monto» y «Mayor
 * puntaje» reordenaban sólo la página a la vista (20 de 3,162) y el API no ordena por
 * ellos, así que se quitaron. Un `?orden=` de un enlace viejo se ignora.
 *
 * Filtros de Región y Tipo: el campo `entidades.tipo` está casi todo en NULL, así que el filtro de tipo
 * se deriva del NOMBRE en el backend (param `clase`: ministerio/regional/municipal/organismo), las mismas
 * reglas con que se MUESTRA el tipo (lib/entidad-tipo.ts). La región ya la filtraba el endpoint.
 *
 * Las tres consultas van por separado (`allSettled`): si cae el resumen, la lista sigue, y lo que no llegó se dice
 * en una línea en vez de desaparecer sin aviso.
 */
export default async function EntidadesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const sp = searchParams ?? {};
  // `pagina` es el parámetro de todos los listados; `page` queda por los enlaces viejos.
  const query = { ...parseEntidadesQuery({ ...sp, page: texto(sp.pagina) ?? texto(sp.page) }), tipo: undefined };
  const q = query.q?.trim() || undefined;
  const actual = query.page ?? 1;

  const [rPagina, rResumen, rRegiones] = await Promise.allSettled([getEntidadesPagina(query), getEntidadesResumen(), getRegionesEntidades()]);
  for (const r of [rPagina, rResumen]) if (r.status === "rejected") console.error("[entidades] el API no respondió:", (r.reason as Error)?.message);
  const pagina: EntidadesPagina | null = rPagina.status === "fulfilled" ? rPagina.value : null;
  const resumen: EntidadesResumen | null = rResumen.status === "fulfilled" ? rResumen.value : null;
  const regiones: string[] = rRegiones.status === "fulfilled" ? rRegiones.value : [];

  // Datos planos (nunca funciones) hacia los componentes cliente del Listado.
  const parametros = { q, region: query.region, clase: query.clase, nepotismo: query.nepotismo ? "1" : undefined };
  const aqui = hrefEntidades({ ...parametros, pagina: actual > 1 ? String(actual) : undefined });

  // El conteo por entidad (`alertas` del API) es de contratos con dictamen PUBLICADO, tengan
  // o no señales: un dictamen de score 0 también suma. Por eso esta página dice "con dictamen
  // publicado" y no "con señales" (DESIGN_SYSTEM.md §10.1): con la palabra vieja decía 80
  // entidades mientras /app/hallazgos, que sí cuenta señales, decía 61.
  return (
    <Pagina className="space-y-5">
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Entidades" }]} />
      <EncabezadoPagina
        titulo="Entidades del Estado"
        bajada="Ordenadas por cuántos de sus contratos ya tienen dictamen publicado."
        ayuda={
          <Ayuda titulo="¿Qué cuenta esta lista?">
            <span className="block">
              &ldquo;Con dictamen&rdquo; cuenta los contratos de la entidad leídos y publicados, tengan o no señales, sobre
              los que tiene registrados.
            </span>
            <span className="mt-2 block">
              El puntaje promedio va de 0 a 100 y un contrato sin señales puntúa 0. No es una probabilidad de delito: la
              ficha de cada entidad muestra las señales que lo explican y su ejecución presupuestal según el MEF.
            </span>
          </Ayuda>
        }
        acciones={
          <Link
            href="/reporte/nuevo?modo=entidad"
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-dato leading-5 font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
          >
            <Flag size={14} aria-hidden /> Denunciar una entidad
          </Link>
        }
      />

      {resumen ? (
        <CifrasEnFila
          items={[
            {
              valor: numero(resumen.conAlertas),
              etiqueta: "entidades con dictamen publicado",
              contexto: `de ${numero(resumen.totalEntidades)} registradas`,
              ayuda: (
                <Ayuda titulo="¿Qué cuentan estas cifras?">
                  <span className="block">
                    Las entidades con al menos un contrato leído y publicado, con o sin señales, sobre todas las
                    compradoras del Estado que Vigía tiene registradas.
                  </span>
                  <span className="mt-2 block text-mute">Son cifras de toda la base: no cambian con la búsqueda.</span>
                </Ayuda>
              ),
            },
            {
              valor: solesCompacto(resumen.monto),
              etiqueta: "adjudicado en contratos con dictamen",
              contexto: `de ${plural(resumen.conAlertas, "entidad", "entidades")}`,
            },
          ]}
        />
      ) : (
        // Sin las cifras de arriba, se dice (antes desaparecían sin aviso). Si la lista tampoco llegó, su error lo dice.
        pagina && (
          <AvisoEnLinea icono={<CloudOff size={16} />} accion={{ href: aqui, etiqueta: "Reintentar" }}>
            No pudimos leer las cifras de todas las entidades: el servidor no respondió.
          </AvisoEnLinea>
        )
      )}

      <Listado ruta="/app/entidades" parametros={parametros}>
        <BarraFiltros
          busqueda={{ param: "q", placeholder: "Buscar por nombre o RUC…", etiqueta: "Buscar una entidad por su nombre" }}
          visibles={[
            {
              param: "clase",
              etiqueta: "Tipo",
              corta: "Tipo",
              todas: "Todos los tipos",
              opciones: [
                { valor: "ministerio", etiqueta: "Ministerio" },
                { valor: "regional", etiqueta: "Gobierno regional" },
                { valor: "municipal", etiqueta: "Municipalidad" },
                { valor: "organismo", etiqueta: "Organismo autónomo" },
              ],
            },
            {
              param: "region",
              etiqueta: "Región",
              corta: "Región",
              todas: "Todo el Perú",
              opciones: regiones.map((r) => ({ valor: r, etiqueta: tituloNatural(r) })),
            },
            {
              param: "nepotismo",
              etiqueta: "Indicio",
              corta: "Indicio",
              todas: "Todas",
              opciones: [{ valor: "1", etiqueta: "Con posible nepotismo" }],
            },
          ]}
        />
        <ZonaResultados>
          <EntidadesPanel pagina={pagina} actual={actual} parametros={parametros} q={q} aqui={aqui} />
        </ZonaResultados>
      </Listado>
    </Pagina>
  );
}
