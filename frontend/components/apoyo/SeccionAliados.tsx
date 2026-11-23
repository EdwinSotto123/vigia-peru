import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { Sprout } from "lucide-react";
import { Ayuda, EstadoError, Nota } from "@/components/patrones";
import { BarraFiltros, Listado, ZonaResultados } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
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
import { HREF_APOYO } from "@/components/sitio/VistasSeccion";
import { getRankingPaginado } from "@/lib/financiamiento";

/**
 * La pestaña «Podio de aliados» de /app/apoyar (antes /app/aliados; pedido del usuario del 2026-10-29: «que sea un
 * PODIO»): barra de filtros (periodo, búsqueda y orden) → el podio, siempre de tres → del cuarto lugar en adelante, la
 * `Tabla` → la invitación. La barra sólo aparece cuando hay a quién buscar (o un filtro puesto, que hay que poder quitar).
 *
 * El podio cuenta MESES sosteniendo la vigilancia (ranking.ts), no contratos ni soles, y la semilla de Vigía Perú no
 * compite. Desde el 2026-11-13 sin la meta del mes (está en Aportar y en Cuánto cuesta) ni la cinta de últimos aportes
 * (la lista entera es la pestaña de al lado).
 */
export async function SeccionAliados({ pagina, orden: ordenPedido, periodo: periodoPedido, q: qPedida }: { pagina: number; orden?: string; periodo?: string; q?: string }) {
  const orden = parseOrden(ordenPedido);
  const periodo = parsePeriodo(periodoPedido);
  // Buscar un aliado por su nombre público: sólo figuran los visibles, que eligieron aparecer.
  const q = typeof qPedida === "string" && qPedida.trim().length >= 2 ? qPedida.trim().slice(0, 80) : undefined;

  const muestra = await getRankingPaginado({ periodo, limit: MUESTRA_RANKING });
  if (!muestra) noStore();
  // Pasados los 60 aliados, la página del ranking la trae el API (también la búsqueda).
  const paginaApi =
    muestra && muestra.total > MUESTRA_RANKING ? await getRankingPaginado({ periodo, limit: TAM_PAGINA, offset: (pagina - 1) * TAM_PAGINA, q }) : null;

  const rankingBase = muestra ? armarRanking({ muestra, pagina: q ? null : paginaApi, orden, paginaActual: pagina }) : null;
  const ranking = muestra && rankingBase && q ? buscarEnRanking({ muestra, pagina: paginaApi, q, base: rankingBase }) : rankingBase;

  // Con tres nombres o menos la tabla (del cuarto en adelante) no existe y un selector de orden no ordenaría nada;
  // pasados los 60, el orden lo pone el API.
  const ordenable = !!ranking && ranking.completa && ranking.totalNombres > 3 && !q;
  const conFiltros = (rankingBase?.totalNombres ?? 0) > 0 || periodo !== "todo" || !!q;

  return (
    <div className="space-y-4">
      <p className="text-meta leading-snug text-inkSoft">
        Quienes sostienen la vigilancia del dinero público. Estar aquí no compra nada: nadie elige qué se lee ni qué se publica.
        <span className="ml-1 inline-flex align-middle">
          <Ayuda titulo="¿Cómo se gana un lugar?">
            <span className="block">
              Por constancia, no por plata: cuenta cuántos meses distintos aportaste (con el pago ya validado). A igualdad, va
              primero quien llegó antes. Con S/ 5 al mes se llega al primer lugar igual que con S/ 500.
            </span>
            <span className="mt-2 block">
              Los que aportan sin nombre cuentan en la meta del mes, pero no ocupan lugar. La semilla con la que Vigía Perú empezó
              no compite.
            </span>
          </Ayuda>
        </span>
      </p>

      <Listado
        ruta="/app/apoyar"
        parametros={{ seccion: "aliados", periodo: periodo !== "todo" ? periodo : undefined, orden: orden !== "meses" ? orden : undefined, q }}
      >
        <div className="space-y-4">
          {conFiltros && (
            <BarraFiltros
              busqueda={{ param: "q", placeholder: "Buscar un aliado por su nombre…", etiqueta: "Buscar un aliado", min: 2 }}
              faceta={{ enBotones: true,
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
          )}
          <ZonaResultados>
            {ranking ? (
              <RankingAliados ranking={ranking} orden={orden} paginaActual={pagina} periodo={periodo} busqueda={q} />
            ) : (
              // Es una falla de la página, no un podio vacío: los aportes siguen registrados.
              <EstadoError
                titulo="No pudimos leer el podio"
                accion={
                  <EnlaceAccion variante="secundario" href={HREF_APOYO.aliados}>
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

      <Nota icono={<Sprout size={15} aria-hidden />}>
        Vigía Perú empezó con dinero propio: esa semilla está en las cifras, pero no compite en el podio. Cuánto cuesta cada mes
        y cuánto entró, en{" "}
        <Link href={HREF_APOYO.costos} className="font-semibold text-granate underline-offset-2 hover:underline">
          Cuánto cuesta
        </Link>
        ; cada aporte, con su recibo, en{" "}
        <Link href={HREF_APOYO.aportes} className="font-semibold text-granate underline-offset-2 hover:underline">
          Todos los aportes
        </Link>
        .
      </Nota>
    </div>
  );
}
