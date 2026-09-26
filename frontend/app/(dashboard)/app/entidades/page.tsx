import type { Metadata } from "next";
import Link from "next/link";
import { Flag } from "lucide-react";
import { EntidadesPanel, hrefEntidades, ORDENES_ENTIDADES, type OrdenEntidades } from "@/components/EntidadesPanel";
import { BarraFiltros, Indicadores, Listado, ZonaResultados } from "@/components/listado";
import { Ayuda, EncabezadoPagina, Pagina } from "@/components/patrones";
import {
  getEntidadesPagina,
  getEntidadesResumen,
  parseEntidadesQuery,
  type EntidadesPagina,
  type EntidadesResumen,
} from "@/lib/api-client";
import { numero, plural, solesCompacto } from "@/lib/formato";

export const metadata: Metadata = {
  title: "Entidades del Estado",
  description:
    "Municipalidades, gobiernos regionales, ministerios y empresas públicas, ordenados por cuántos de sus contratos ya tienen dictamen publicado.",
};

const ORDENES = new Set<string>(ORDENES_ENTIDADES.map((o) => o.valor));

const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * /app/entidades — plantilla Listado (DESIGN_SYSTEM.md §14.1): encabezado →
 * indicadores → barra (búsqueda + orden) → resultados. Búsqueda, orden y página
 * viven en la URL (`?q=&orden=&pagina=`); antes el orden era estado local y se
 * perdía al recargar o al compartir el enlace.
 *
 * Sin faceta de tipo: el backend tiene `tipo` nulo en la mayoría de las 2.121
 * entidades, así que "Gobierno regional" dejaba fuera a casi todos los gobiernos
 * regionales. El tipo se sigue MOSTRANDO, inferido del nombre.
 *
 * Ya no se pide `/alertas?limit=500` para descontar las alertas de demo `ALT-…`: se
 * borraron de la base (0 en la copia de producción del 2026-09-25), así que el descuento
 * no cambiaba ninguna cifra y costaba 178 KB por render.
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
  const ordenPedido = texto(sp.orden);
  const orden = (ordenPedido && ORDENES.has(ordenPedido) ? ordenPedido : "dictamen") as OrdenEntidades;
  const actual = query.page ?? 1;

  let pagina: EntidadesPagina | null = null;
  let resumen: EntidadesResumen | null = null;
  try {
    [pagina, resumen] = await Promise.all([getEntidadesPagina(query), getEntidadesResumen()]);
  } catch (e) {
    console.error("[entidades] el API no respondió:", (e as Error).message);
  }

  // Datos planos (nunca funciones) hacia los componentes cliente del Listado.
  const parametros = { q, orden: orden === "dictamen" ? undefined : orden };
  const aqui = hrefEntidades({ ...parametros, pagina: actual > 1 ? String(actual) : undefined });

  // El conteo por entidad (`alertas` del API) es de contratos con dictamen PUBLICADO, tengan
  // o no señales: un dictamen de score 0 también suma. Por eso esta página dice "con dictamen
  // publicado" y no "con señales" (DESIGN_SYSTEM.md §10.1): con la palabra vieja decía 80
  // entidades mientras /app/hallazgos, que sí cuenta señales, decía 61.
  return (
    <Pagina className="space-y-5">
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
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
          >
            <Flag size={14} aria-hidden /> Denunciar una entidad
          </Link>
        }
      />

      {resumen && (
        <Indicadores
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
      )}

      <Listado ruta="/app/entidades" parametros={parametros}>
        <BarraFiltros
          busqueda={{ param: "q", placeholder: "Buscar por nombre o RUC…", etiqueta: "Buscar una entidad por su nombre" }}
          orden={{ param: "orden", porDefecto: "dictamen", opciones: ORDENES_ENTIDADES }}
        />
        <ZonaResultados>
          <EntidadesPanel pagina={pagina} actual={actual} orden={orden} parametros={parametros} q={q} aqui={aqui} />
        </ZonaResultados>
      </Listado>
    </Pagina>
  );
}
