import Link from "next/link";
import { ArrowRight, EyeOff } from "lucide-react";
import { getEstadoGlobal, getRankingPaginado, type RankingRow } from "@/lib/financiamiento";
import { Paginacion } from "@/components/ui/Paginacion";
import { FilaAliado, TarjetaAliado } from "./TarjetaAliado";

/** Tamaño de página del libro mayor (tope del backend también es 60). */
const TAM = 24;
/** Muestra para el encabezado y el recuento de anónimos: no se pagina, solo da contexto. */
const RESUMEN_LIMIT = 60;
/**
 * Hasta acá el muro se dibuja con fichas; pasado esto, con tabla. Con uno o dos
 * nombres una fila de tabla parece un error de carga; con veinte, veinte fichas
 * son un scroll inútil. El mismo dato, dos densidades.
 */
const UMBRAL_FICHA = 3;

const esAnonimo = (r: RankingRow) => r.tipo === "persona" && (r.nombre === "Anónimo" || !r.nombre);
const num = (n: number) => n.toLocaleString("es-PE");

/**
 * El muro de aliados, ahora libro mayor y no podio.
 *
 * Lo que había antes: un podio de tres puestos (dos de ellos losas "vacante"),
 * medallas emoji y una animación infinita sobre el puesto 1. Con un único
 * financiador —que además es la propia plataforma— eso no probaba legitimidad:
 * probaba soledad, y le daba superficie heroica justamente a quien paga, que es
 * lo contrario de lo que este producto promete.
 *
 * Lo que hay ahora: quién aportó, cuánto de eso ya se leyó y cuánto salió con
 * señal. Sin puestos, sin medallas, sin montos. El reconocimiento se mide en
 * contratos leídos — 300 vecinos que financian 300 pesan igual que una empresa
 * que financia 300 — y por eso este componente nunca muestra soles.
 *
 * `compact` es el bloque de la landing (sección Aliados), que comparte el mismo
 * dato y las mismas reglas.
 */
export async function MuroAliados({
  compact = false,
  region,
  pagina = 1,
  nombreRegion,
  financiadosAmbito,
}: {
  compact?: boolean;
  /** Ubigeo de 2–6 dígitos; en la URL de /app/aliados viaja como `?ubigeo=`. */
  region?: string;
  pagina?: number;
  /** Nombre de la región filtrada, para que el vacío diga de dónde habla. */
  nombreRegion?: string;
  /**
   * Contratos financiados en este ámbito, exacto (de `/financiamiento/estado` o de la
   * zona). Sin esto habría que sumar las filas del ranking, que están paginadas: con
   * más de 60 aliados esa suma mentiría por lo bajo.
   */
  financiadosAmbito?: number;
}) {
  const paginaActual = Math.max(1, pagina);
  const offset = (paginaActual - 1) * TAM;
  const [resumenRaw, paginaRaw, estado] = await Promise.all([
    getRankingPaginado({ periodo: "todo", region, limit: RESUMEN_LIMIT }),
    compact ? Promise.resolve(null) : getRankingPaginado({ periodo: "todo", region, limit: TAM, offset }),
    getEstadoGlobal(),
  ]);

  // El API cayó: se dice, no se dibuja un muro vacío que parezca "todavía no hay nadie".
  if (!resumenRaw) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-sm text-mute">
        No se pudo leer el registro de aportes ahora mismo. Es una falla de esta página, no un muro
        vacío: los aportes siguen registrados. Volvé a intentar en un momento.
      </p>
    );
  }

  const resumen = resumenRaw.data ?? [];
  const totalVisible = resumenRaw.total ?? 0;
  const anonimos = resumen.filter(esAnonimo);
  const anonimosContratos = anonimos.reduce((n, r) => n + r.contratosFinanciados, 0);
  const conNombre = resumen.filter((r) => !esAnonimo(r));
  const financiadosMuro = financiadosAmbito ?? resumen.reduce((n, r) => n + r.contratosFinanciados, 0);
  const regionesConCola = estado?.regionesConCola ?? 0;

  const filasPagina = (paginaRaw?.data ?? []).filter((r) => !esAnonimo(r));
  const totalPagina = paginaRaw?.total ?? totalVisible;
  const paginas = Math.max(1, Math.ceil(totalPagina / TAM));
  const pocos = totalVisible <= UMBRAL_FICHA;

  if (totalVisible === 0) {
    return <MuroVacio nombreRegion={nombreRegion} plano={compact} />;
  }

  const fichas = (conNombre.length ? conNombre : resumen).slice(0, compact ? UMBRAL_FICHA : RESUMEN_LIMIT);

  const cuerpo = pocos ? (
    <div className={compact ? "divide-y divide-line" : "space-y-3"}>
      {fichas.map((r) => (
        <TarjetaAliado
          key={r.id}
          row={r}
          financiadosMuro={financiadosMuro}
          regionesConCola={regionesConCola}
          plano={compact}
        />
      ))}
    </div>
  ) : (
    <div className={compact ? "overflow-x-auto" : "overflow-x-auto rounded-2xl border border-line bg-paper"}>
      <table className="w-full min-w-[34rem] text-left">
        <caption className="sr-only">
          Aliados ordenados por contratos financiados. El orden no es un ranking de mérito: nadie elige
          qué se audita.
        </caption>
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-mute">
            <th scope="col" className="px-4 py-2.5 font-medium">Aliado</th>
            <th scope="col" className="py-2.5 pl-3 text-right font-medium">Financiados</th>
            <th scope="col" className="py-2.5 pl-3 text-right font-medium">Leídos</th>
            <th scope="col" className="py-2.5 pl-3 text-right font-medium">Con señal</th>
            <th scope="col" className="hidden py-2.5 pl-3 text-right font-medium sm:table-cell">Regiones</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium"><span className="sr-only">Ficha</span></th>
          </tr>
        </thead>
        <tbody className="[&>tr>*:first-child]:pl-4 [&>tr>*:last-child]:pr-4">
          {(compact ? fichas : filasPagina).map((r) => (
            <FilaAliado key={r.id} row={r} regionesConCola={regionesConCola} />
          ))}
          {!compact && filasPagina.length === 0 && (
            <tr className="border-t border-line">
              <td colSpan={6} className="px-4 py-5 text-sm text-mute">
                Todos los aportes de esta página se hicieron sin nombre. Cuentan igual en el total de
                arriba; solo no figuran en la lista.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  if (compact) {
    return (
      <div>
        <h3 className="font-serif text-lg font-bold text-ink">
          {totalVisible === 1
            ? "Un solo aliado sostiene la lectura hoy"
            : `${num(totalVisible)} aliados sostienen la lectura hoy`}
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-mute">
          {num(financiadosMuro)} contratos financiados · {num(resumen.reduce((n, r) => n + r.contratosProcesados, 0))} ya
          leídos. Se cuenta en contratos, nunca en soles.
        </p>
        <div className="mt-4">{cuerpo}</div>
        <Anonimos cantidad={anonimos.length} contratos={anonimosContratos} breve />
        <Link
          href="/app/aliados"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline-offset-2 hover:underline"
        >
          Ver el libro mayor completo <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    );
  }

  return (
    <section aria-labelledby="muro-titulo" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-2">
        <h2 id="muro-titulo" className="font-serif text-lg font-bold text-ink">
          Quién financió la lectura
        </h2>
        <p className="font-mono text-[12px] text-mute">
          {num(totalVisible)} {totalVisible === 1 ? "aliado" : "aliados"} · {num(financiadosMuro)} contratos
          financiados{nombreRegion ? ` en ${nombreRegion}` : ""}
        </p>
      </div>

      {!pocos && paginas > 1 && (
        <Paginacion
          actual={paginaActual}
          paginas={paginas}
          total={totalPagina}
          tam={TAM}
          navegacion="url"
          hrefBase="/app/aliados"
          query={{ ubigeo: region }}
          cargando={false}
          nombre="aliados"
        />
      )}

      {cuerpo}

      {!pocos && paginas > 1 && (
        <Paginacion
          actual={paginaActual}
          paginas={paginas}
          total={totalPagina}
          tam={TAM}
          navegacion="url"
          hrefBase="/app/aliados"
          query={{ ubigeo: region }}
          cargando={false}
          nombre="aliados"
        />
      )}

      {pocos && <Invitacion totalVisible={totalVisible} nombreRegion={nombreRegion} />}
      <Anonimos cantidad={anonimos.length} contratos={anonimosContratos} />
    </section>
  );
}

/**
 * Con uno o dos nombres, este muro es sobre todo una invitación — y se diseña
 * como tal, explicando el mecanismo, en vez de rellenar una grilla con losas
 * "vacante" que solo subrayan que no hay nadie.
 */
function Invitacion({ totalVisible, nombreRegion }: { totalVisible: number; nombreRegion?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-5">
      <h3 className="text-sm font-semibold text-ink">
        {totalVisible === 1
          ? `Hay un solo nombre en este muro${nombreRegion ? ` para ${nombreRegion}` : ""}`
          : `Hay ${num(totalVisible)} nombres en este muro${nombreRegion ? ` para ${nombreRegion}` : ""}`}
      </h3>
      <ol className="mt-3 max-w-[72ch] space-y-2 text-[13px] leading-relaxed text-mute">
        <li>
          <span className="font-mono text-inkSoft">1.</span> Elegís una región y cuántos contratos querés que
          se lean. S/ 3 cada uno, que es lo que cuesta procesarlo.
        </li>
        <li>
          <span className="font-mono text-inkSoft">2.</span> Los contratos concretos los saca la cola por
          antigüedad. No los elegís vos, ni los elige Vigía Perú.
        </li>
        <li>
          <span className="font-mono text-inkSoft">3.</span> Cuando cada uno termina de leerse, su dictamen se
          publica con la norma citada, y tu comprobante lista uno por uno los contratos que tu aporte hizo
          leer — hayan salido con señal o limpios.
        </li>
      </ol>
      <Link
        href="/app/financiar"
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-heroViolet px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-heroViolet-deep"
      >
        Financiar una auditoría <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

/** Nadie ha aportado todavía en este ámbito: se dice qué falta, no se finge una grilla. */
function MuroVacio({ nombreRegion, plano = false }: { nombreRegion?: string; plano?: boolean }) {
  return (
    <section aria-labelledby="muro-titulo" className={plano ? "" : "rounded-2xl border border-dashed border-line px-5 py-6"}>
      <h2 id="muro-titulo" className="font-serif text-lg font-bold text-ink">
        {nombreRegion
          ? `Todavía nadie financió la lectura de un contrato de ${nombreRegion}`
          : "Todavía nadie financió la lectura de un contrato"}
      </h2>
      <p className="mt-2 max-w-[72ch] text-[13px] leading-relaxed text-mute">
        Los contratos {nombreRegion ? `de ${nombreRegion} ` : ""}ya están descargados y clasificados: lo que
        falta es capacidad para leerlos. Cuesta S/ 3 por contrato, se asignan por antigüedad y el primer
        nombre que aporte abre este muro.
      </p>
      <Link
        href="/app/financiar"
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-heroViolet px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-heroViolet-deep"
      >
        Financiar una auditoría <ArrowRight size={14} aria-hidden />
      </Link>
    </section>
  );
}

/** Los aportes sin nombre pesan igual en el conteo; solo no aparecen en la lista. */
function Anonimos({ cantidad, contratos, breve = false }: { cantidad: number; contratos: number; breve?: boolean }) {
  if (cantidad === 0) return null;
  return (
    <p className={`inline-flex items-start gap-1.5 text-[12px] leading-relaxed text-mute ${breve ? "mt-3" : ""}`}>
      <EyeOff size={13} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        <span className="font-mono text-inkSoft">{num(cantidad)}</span>{" "}
        {cantidad === 1 ? "persona aportó" : "personas aportaron"} sin nombre ·{" "}
        <span className="font-mono text-inkSoft">{num(contratos)}</span> contratos financiados. Cuentan
        exactamente igual; solo no figuran en la lista.
      </span>
    </p>
  );
}
