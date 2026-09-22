import Link from "next/link";
import { ArrowRight, EyeOff, HeartHandshake } from "lucide-react";
import { getRankingPaginado, type RankingRow } from "@/lib/financiamiento";
import { Paginacion } from "@/components/ui/Paginacion";
import { BlurFade } from "@/components/magicui/BlurFade";
import { TarjetaAliado } from "./TarjetaAliado";
import { Podio } from "./Podio";

/** Tope de items con stagger propio: pasado esto, todos entran juntos al delay tope en
 * vez de seguir sumando 60-80ms por tarjeta (con TAM=24 por página, una cascada sin tope
 * tardaría más de 1.5s en terminar de revelarse — se siente lenta, no "viva"). */
const STAGGER_MAX = 14;

const esAnonimo = (r: RankingRow) => r.tipo === "persona" && (r.nombre === "Anónimo" || !r.nombre);

/** Tamaño de muestra para destacados/encabezado/anónimos: no se pagina, solo da contexto. */
const RESUMEN_LIMIT = 60;
/** Tamaño de página real de "Todos los aliados" (tope del backend también es 60). */
const TAM = 24;

/**
 * Muro de aliados de transparencia (server component).
 *  - normal:  "Aliados del mes" (top 3 destacado, sin paginar) + "Todos los aliados"
 *             (paginación real por `pagina`, filtrable por `region`) + anónimos.
 *  - compact: solo el top 3 del mes (o histórico si el mes está vacío) + enlace a /aliados.
 * El ranking cuenta contratos, no soles. `region` es un ubigeo de 2-6 dígitos; en la URL de
 * /app/aliados viaja como `?ubigeo=` (mismo contrato que FiltroRegion) — este componente lo
 * recibe ya resuelto y solo lo reexpone como `region` al backend y como `?ubigeo=` en los
 * enlaces de paginación que arma.
 */
export async function MuroAliados({ compact = false, region, pagina = 1 }: { compact?: boolean; region?: string; pagina?: number }) {
  const paginaActual = Math.max(1, pagina);
  const offset = (paginaActual - 1) * TAM;
  const [mesRaw, todoResumenRaw, todoPaginaRaw] = await Promise.all([
    getRankingPaginado({ periodo: "mes", region, limit: RESUMEN_LIMIT }),
    getRankingPaginado({ periodo: "todo", region, limit: RESUMEN_LIMIT }),
    compact ? Promise.resolve(null) : getRankingPaginado({ periodo: "todo", region, limit: TAM, offset }),
  ]);
  const mes = mesRaw?.data ?? [];
  const todoResumen = todoResumenRaw?.data ?? [];
  const filasPagina = (todoPaginaRaw?.data ?? []).filter((r) => !esAnonimo(r));
  const totalPagina = todoPaginaRaw?.total ?? 0;

  const visiblesMes = mes.filter((r) => !esAnonimo(r));
  const visiblesTodo = todoResumen.filter((r) => !esAnonimo(r));
  const anonimos = todoResumen.filter(esAnonimo);
  const anonimosContratos = anonimos.reduce((n, r) => n + r.contratosFinanciados, 0);

  const leidosMes = mes.reduce((n, r) => n + r.contratosProcesados, 0);
  const financiadosMes = mes.reduce((n, r) => n + r.contratosFinanciados, 0);
  const leidosTotal = todoResumen.reduce((n, r) => n + r.contratosProcesados, 0);
  const financiadosTotal = todoResumen.reduce((n, r) => n + r.contratosFinanciados, 0);

  // Top 3 a destacar: el mes; si el mes está vacío, el histórico (para que el muro nunca quede en blanco).
  const destacados = (visiblesMes.length ? visiblesMes : visiblesTodo).slice(0, 3);
  const periodoDestacado = visiblesMes.length ? "del mes" : "históricos";

  if (!todoResumen.length) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-8 text-center">
        <HeartHandshake size={22} className="mx-auto text-mute" aria-hidden />
        <p className="mt-2 text-sm text-mute">
          {region
            ? "Todavía no hay aliados que hayan financiado auditorías en esta región."
            : "Todavía no hay aportes confirmados. El primer aliado abre este muro."}
        </p>
        <Link href="/app/financiar" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-heroViolet px-4 py-2 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper">
          Financiar una auditoría <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    );
  }

  // Mientras el único financiador sea Vigía Perú mismo (capital semilla), "gracias a
  // ellos" en plural sería engañoso — se dice tal cual es hasta que llegue el primer
  // aliado externo real (en cuanto totalResumen tenga 2+, vuelve solo al texto normal).
  const soloFundador = visiblesTodo.length === 1 && visiblesTodo[0].slug === "vigia-peru";
  const totalLeidoOAuditoria = leidosTotal || financiadosTotal;
  const encabezado = soloFundador
    ? <>Vigía Perú financió su propia auditoría inicial con capital semilla: <span className="font-mono">{totalLeidoOAuditoria.toLocaleString("es-PE")}</span> contratos {leidosTotal ? "leídos" : "en auditoría"}. El primer aliado externo abre el resto.</>
    : leidosMes > 0
      ? <>Gracias a ellos, <span className="font-mono">{leidosMes.toLocaleString("es-PE")}</span> contratos públicos fueron leídos este mes.</>
      : financiadosMes > 0
        ? <>Gracias a ellos, <span className="font-mono">{financiadosMes.toLocaleString("es-PE")}</span> contratos públicos entraron a auditoría este mes.</>
        : <>Gracias a ellos, <span className="font-mono">{totalLeidoOAuditoria.toLocaleString("es-PE")}</span> contratos públicos {leidosTotal ? "fueron leídos" : "entraron a auditoría"}.</>;

  if (compact) {
    // Siempre 3 columnas, incluso con 1-2 destacados reales: los slots que faltan se
    // rellenan con una invitación a ser el próximo aliado en vez de dejar el panel con
    // un tercio (o dos tercios) de espacio vacío — hoy el caso normal, con Vigía Perú
    // como único registro (capital semilla).
    const slotsVacios = Math.max(0, 3 - destacados.length);
    return (
      <div>
        <p className="font-serif text-2xl font-bold text-ink">{encabezado}</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {destacados.map((r, i) => (
            <BlurFade key={r.id} delayMs={i * 80} className="flex">
              <TarjetaAliado row={r} posicion={i + 1} destacado />
            </BlurFade>
          ))}
          {Array.from({ length: slotsVacios }).map((_, i) => (
            <BlurFade key={`placeholder-${i}`} delayMs={(destacados.length + i) * 80} className="flex">
              <AliadoPlaceholder />
            </BlurFade>
          ))}
        </div>
        {anonimos.length > 0 && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-mute">
            <EyeOff size={12} aria-hidden /> {anonimos.length} {anonimos.length === 1 ? "persona aportó" : "personas aportaron"} de forma anónima · {anonimosContratos.toLocaleString("es-PE")} contratos
          </p>
        )}
        <div className="mt-4">
          <Link href="/app/aliados" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline-offset-2 hover:underline">
            Ver todos los aliados <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  const paginas = Math.max(1, Math.ceil(totalPagina / TAM));
  const paginacion = (
    <Paginacion
      actual={paginaActual}
      paginas={paginas}
      total={totalPagina}
      tam={TAM}
      navegacion="url"
      hrefBase="/app/aliados"
      query={{ ubigeo: region }}
      cargando={false}
      nombre="patrocinadores"
    />
  );

  return (
    <div className="space-y-12">
      <section>
        {/* Antes esta línea era un titular font-serif 2xl/3xl -- competía en peso visual con
            el propio H1 de la página y con el podio de abajo. Es contexto de apoyo, no el
            protagonista: la empresa lo es. */}
        <p className="max-w-2xl text-sm leading-relaxed text-mute sm:text-base">{encabezado}</p>
        <div className="mt-6">
          <Podio destacados={destacados} periodoDestacado={periodoDestacado} />
        </div>
      </section>

      {/* totalPagina > destacados.length, no totalPagina > 0: con 1-3 aliados en total, ya
          están los 3 arriba en "Aliados del mes" — repetir la misma única tarjeta acá abajo
          (con paginación completa para una sola página) era ruido, no información nueva. */}
      {totalPagina > destacados.length && (
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-[11px] uppercase tracking-wide text-mute">Todos los aliados</h2>
            <span className="font-mono text-[11px] text-mute">{totalPagina.toLocaleString("es-PE")}</span>
          </div>
          {paginas > 1 && <div className="mt-3">{paginacion}</div>}
          {filasPagina.length > 0 ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {filasPagina.map((r, i) => (
                <BlurFade key={r.id} delayMs={Math.min(i, STAGGER_MAX) * 60} className="flex">
                  <TarjetaAliado row={r} posicion={r.posicion} />
                </BlurFade>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-mute">Los aliados de esta página aportaron de forma anónima.</p>
          )}
          {paginas > 1 && filasPagina.length > 8 && <div className="mt-4">{paginacion}</div>}
        </section>
      )}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-paperDeep px-5 py-4">
        <div className="inline-flex items-center gap-2 text-sm text-inkSoft">
          <EyeOff size={16} className="text-mute" aria-hidden />
          <span>
            Personas que aportaron de forma anónima: <span className="font-mono font-semibold text-ink">{anonimos.length}</span>
            {anonimosContratos > 0 && <span className="text-mute"> · {anonimosContratos.toLocaleString("es-PE")} contratos financiados</span>}
          </span>
        </div>
        <span className="text-[12px] text-mute">Valen exactamente lo mismo en el conteo. Sólo no aparecen con nombre.</span>
      </section>
    </div>
  );
}

/** Slot vacío del muro compacto (landing): en vez de dejar la grilla con espacio en
 * blanco mientras haya menos de 3 destacados, ofrece el lugar como llamada a la acción. */
function AliadoPlaceholder() {
  return (
    <Link
      href="/app/financiar"
      className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line p-5 text-center transition-colors hover:border-heroGreen/40 hover:bg-heroGreen/5"
    >
      <HeartHandshake size={22} className="text-mute" aria-hidden />
      <span className="text-sm font-semibold text-ink">Sé el próximo aliado</span>
      <span className="text-[11px] text-mute">Financiá una auditoría y aparecé acá</span>
    </Link>
  );
}
