import Link from "next/link";
import { Ayuda, EncabezadoPagina, EstadoError, Migas, Pagina } from "@/components/patrones";
import { BarraFiltros, Listado, ZonaResultados } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { MetaDelMes } from "@/components/financiar/MetaDelMes";
import { RankingAliados } from "@/components/aliados/RankingAliados";
import {
  MUESTRA_RANKING,
  ORDEN_LABEL,
  PERIODO_LABEL,
  TAM_PAGINA,
  armarRanking,
  buscarEnRanking,
  parseOrden,
  parsePeriodo,
  type ClaveOrden,
} from "@/components/aliados/ranking";
import { getRankingPaginado, getRecientesPagina, getVigilancia } from "@/lib/financiamiento";

export const metadata = {
  title: "Podio de aliados",
  description:
    "Quienes sostienen la vigilancia del dinero público, mes a mes. El podio se gana por constancia, no por plata, y no compra nada: nadie elige qué se lee ni qué se publica.",
};

export const revalidate = 300;

/**
 * /app/aliados: el podio de quienes sostienen Vigía (pedido del usuario del 2026-10-29: «que sea un PODIO, mejora los
 * mensajes»), con la plantilla Listado (DESIGN_SYSTEM.md §14.1 y §14.6): encabezado → barra de filtros (periodo en
 * chips, búsqueda y orden) → el podio, siempre de tres, con los lugares libres que invitan → la meta del mes → del
 * cuarto lugar en adelante, la `Tabla` → «¿Quieres estar en el podio?» → la cinta de últimos aportes.
 *
 * Desde el modelo de apoyo (migración 206) el aporte va al fondo común: el podio cuenta MESES sosteniendo la
 * vigilancia (ranking.ts), no contratos ni soles, y la semilla de Vigía Perú no compite. Ya no hay filtro por región:
 * un apoyo no se reparte por zonas (lo que lo motiva es sólo informativo).
 *
 * Sólo aliados reales, del API, en desarrollo igual que en producción.
 */
export default async function AliadosPage({ searchParams }: { searchParams?: { pagina?: string; orden?: string; periodo?: string; q?: string } }) {
  const pagina = Math.max(1, Number.parseInt(searchParams?.pagina ?? "1", 10) || 1);
  const orden = parseOrden(searchParams?.orden);
  const periodo = parsePeriodo(searchParams?.periodo);
  // Buscar un aliado por su nombre público: sólo figuran los visibles, que eligieron aparecer.
  const q = typeof searchParams?.q === "string" && searchParams.q.trim().length >= 2 ? searchParams.q.trim().slice(0, 80) : undefined;

  const [muestra, recientesPag, vigilancia] = await Promise.all([
    getRankingPaginado({ periodo, limit: MUESTRA_RANKING }),
    // La cinta, sin la semilla: quienes se suman.
    getRecientesPagina(20, 0, undefined, { sinSemilla: true }).catch(() => null),
    getVigilancia().catch(() => null),
  ]);
  // Pasados los 60 aliados, la página del ranking la trae el API (también la búsqueda).
  const paginaApi =
    muestra && muestra.total > MUESTRA_RANKING
      ? await getRankingPaginado({ periodo, limit: TAM_PAGINA, offset: (pagina - 1) * TAM_PAGINA, q })
      : null;

  const rankingBase = muestra ? armarRanking({ muestra, pagina: q ? null : paginaApi, orden, paginaActual: pagina }) : null;
  const ranking = muestra && rankingBase && q ? buscarEnRanking({ muestra, pagina: paginaApi, q, base: rankingBase }) : rankingBase;

  // Con tres nombres o menos, la tabla (del cuarto en adelante) no existe y un selector de orden no ordenaría nada;
  // pasados los 60, el orden lo pone el API.
  const ordenable = !!ranking && ranking.completa && ranking.totalNombres > 3 && !q;

  return (
    <Pagina className="space-y-6">
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Aliados", href: "/app/aliados" }]} />
      <EncabezadoPagina
        titulo="Podio de aliados"
        bajada="Quienes sostienen la vigilancia del dinero público. Estar aquí no compra nada: nadie elige qué se lee ni qué se publica."
        ayuda={
          <Ayuda titulo="¿Cómo se gana un lugar?">
            <span className="block">
              Por constancia, no por plata: cuenta cuántos meses distintos aportaste (con el pago ya validado). A igualdad,
              va primero quien llegó antes. Con S/ 5 al mes se llega al primer lugar igual que con S/ 500.
            </span>
            <span className="mt-2 block">
              Los que aportan sin nombre cuentan en la meta del mes, pero no ocupan lugar. La semilla con la que Vigía Perú
              empezó no compite.
            </span>
            <span className="mt-2 block text-mute">
              Estar en el podio no da nada: lo más grave se lee primero, aporte quien aporte, y lo que se encuentra se publica
              igual, también si señala a un aliado.
            </span>
          </Ayuda>
        }
      />

      <Listado
        ruta="/app/aliados"
        parametros={{
          periodo: periodo !== "todo" ? periodo : undefined,
          orden: orden !== "meses" ? orden : undefined,
          q,
        }}
      >
        <div className="space-y-4">
          <BarraFiltros
            busqueda={{ param: "q", placeholder: "Buscar un aliado por su nombre…", etiqueta: "Buscar un aliado", min: 2 }}
            faceta={{
              param: "periodo",
              etiqueta: "Periodo",
              todas: PERIODO_LABEL.todo,
              nombreEnChip: false,
              opciones: [
                { valor: "anio", etiqueta: PERIODO_LABEL.anio },
                { valor: "mes", etiqueta: PERIODO_LABEL.mes },
              ],
            }}
            orden={
              ordenable
                ? {
                    param: "orden",
                    porDefecto: "meses",
                    opciones: (Object.keys(ORDEN_LABEL) as ClaveOrden[]).map((clave) => ({ valor: clave, etiqueta: ORDEN_LABEL[clave] })),
                  }
                : undefined
            }
          />
          <ZonaResultados>
            {ranking ? (
              <RankingAliados
                ranking={ranking}
                orden={orden}
                paginaActual={pagina}
                periodo={periodo}
                busqueda={q}
                recientes={recientesPag?.data ?? null}
                totalRecientes={recientesPag?.total}
                meta={vigilancia ? <MetaDelMes v={vigilancia} /> : undefined}
              />
            ) : (
              // Es una falla de la página, no un podio vacío: los aportes siguen registrados.
              <EstadoError
                titulo="No pudimos leer el podio"
                accion={
                  <EnlaceAccion variante="secundario" href="/app/aliados">
                    Volver a intentarlo
                  </EnlaceAccion>
                }
              >
                Es una falla de esta página: los aportes siguen registrados.
              </EstadoError>
            )}
          </ZonaResultados>
        </div>
      </Listado>

      {/* De dónde salió el primer dinero y dónde están las cuentas: en una línea, al pie. */}
      <p className="text-meta leading-relaxed text-mute">
        Vigía Perú empezó con dinero propio: esa semilla está en las cifras, pero no compite en el podio. Cuánto cuesta cada
        mes y cuánto entró, en{" "}
        <Link href="/app/cuanto-cuesta" className="font-semibold text-granate underline-offset-2 hover:underline">
          Cuánto cuesta Vigía
        </Link>
        ; cada aporte, con su recibo, en{" "}
        <Link href="/app/aliados/aportes" className="font-semibold text-granate underline-offset-2 hover:underline">
          todos los aportes
        </Link>
        .
      </p>
    </Pagina>
  );
}
