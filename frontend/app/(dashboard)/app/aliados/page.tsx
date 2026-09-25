import { Ayuda, EncabezadoPagina, EstadoError, Pagina } from "@/components/patrones";
import { BarraFiltros, Indicadores, Listado, ZonaResultados, type Indicador } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { RankingAliados } from "@/components/aliados/RankingAliados";
import { ReglasIndependencia } from "@/components/aliados/ReglasIndependencia";
import { pctProporcion } from "@/components/aliados/proporcion";
import {
  MUESTRA_RANKING,
  ORDEN_LABEL,
  PERIODO_LABEL,
  TAM_PAGINA,
  armarRanking,
  parseOrden,
  parsePeriodo,
  type ClaveOrden,
  type Periodo,
  type Ranking,
} from "@/components/aliados/ranking";
import {
  alcanceCorto,
  frasePartesTarifa,
  getEstadoGlobal,
  getRankingPaginado,
  getZonas,
  partesTarifa,
  type EstadoGlobal,
  type Zona,
} from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";
import { numero, soles } from "@/lib/formato";

export const metadata = {
  title: "Ranking de aliados",
  description:
    "Quién hizo leer más contratos públicos, con su puesto. Se cuenta en contratos, nunca en soles, y nadie elige qué se audita.",
};

export const revalidate = 300;

/**
 * /app/aliados — un ranking, con la plantilla Listado (DESIGN_SYSTEM.md §14.1 y §14.6):
 * encabezado (con la única acción de financiar) → Indicadores del ámbito → barra de
 * filtros (periodo en chips; región y orden, en la URL) → los tres primeros destacados y
 * el resto en la `Tabla`, cada uno con su puesto (#1, #2…) y su perfil a un clic → las
 * reglas que hacen que ese dinero no compre nada.
 *
 * Sólo aliados reales, del API, en desarrollo igual que en producción.
 */
export default async function AliadosPage({
  searchParams,
}: {
  searchParams?: { ubigeo?: string; pagina?: string; orden?: string; periodo?: string };
}) {
  const ubigeo = searchParams?.ubigeo && /^\d{2,6}$/.test(searchParams.ubigeo) ? searchParams.ubigeo : undefined;
  const pagina = Math.max(1, Number.parseInt(searchParams?.pagina ?? "1", 10) || 1);
  const orden = parseOrden(searchParams?.orden);
  const periodo = parsePeriodo(searchParams?.periodo);

  const [estado, zonas, resumenPais, resumenZona, muestra] = await Promise.all([
    getEstadoGlobal(),
    getZonas("departamento"),
    getResumenContratos(),
    ubigeo ? getResumenContratos({ ubigeo }) : Promise.resolve(null),
    getRankingPaginado({ periodo, region: ubigeo, limit: MUESTRA_RANKING }),
  ]);
  // Pasados los 60 aliados, la página del ranking la trae el API.
  const paginaApi =
    muestra && muestra.total > MUESTRA_RANKING
      ? await getRankingPaginado({ periodo, region: ubigeo, limit: TAM_PAGINA, offset: (pagina - 1) * TAM_PAGINA })
      : null;

  const ranking = muestra ? armarRanking({ muestra, pagina: paginaApi, orden, paginaActual: pagina }) : null;

  // El filtro lista toda región con cola, también las que nadie financia: una región con
  // cola y sin aliados es justo la que hay que poder mirar.
  const regiones = (zonas ?? [])
    .filter((z) => z.totalCola > 0)
    .sort((a, b) => b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre, "es"));
  const zona = ubigeo ? (zonas ?? []).find((z) => z.ubigeo === ubigeo) : undefined;

  // Con un solo nombre un orden sugiere una competencia que no existe; pasados los 60, el
  // orden lo pone el API y un selector que no ordena sería mentira.
  const ordenable = !!ranking && ranking.completa && ranking.totalNombres > 1;

  const financiadosTodo = zona ? zona.financiados : estado?.contratosFinanciados ?? 0;
  // Con periodo, el ámbito es lo financiado en ese periodo: sale del propio ranking.
  const financiadosAmbito = periodo === "todo" ? financiadosTodo : ranking?.sumas.financiados ?? 0;

  const partes = partesTarifa(estado?.tarifa?.nota);

  let indicadores: Indicador[] | null = null;
  if (periodo !== "todo") {
    indicadores = ranking ? indicadoresPeriodo(ranking, periodo) : null;
  } else if (estado) {
    indicadores = indicadoresAmbito({
      estado,
      zona,
      publicados: (ubigeo ? resumenZona?.total : resumenPais?.total) ?? null,
      financiados: financiadosTodo,
      leidos: zona ? zona.procesados : estado.contratosProcesados ?? 0,
      conSenal: zona ? zona.senales : estado.senalesHalladas,
      enRevision: (zona ? zona.enRevision : estado.enRevision) ?? 0,
    });
  }

  return (
    <Pagina className="space-y-6">
      <EncabezadoPagina
        titulo="Ranking de aliados"
        bajada="Quién hizo leer más contratos públicos. Se cuenta en contratos, nunca en soles."
        ayuda={
          <Ayuda titulo="¿Qué compra un aliado?">
            <span className="block">
              Nada: ni un resultado ni una región. Los contratos se asignan por antigüedad, en código, y lo que salga se
              publica igual, aunque señale a quien pagó.
            </span>
            <span className="mt-2 block">
              El puesto se gana por contratos financiados (a igualdad, quien aportó primero), nunca por soles. Bajo cada
              cifra, su parte de todo lo financiado.
            </span>
            <span className="mt-2 block text-mute">
              Todos los que figuran pasaron el chequeo de conflicto de interés: sin sanción vigente del OECE ni alertas
              activas como proveedor.
            </span>
          </Ayuda>
        }
        acciones={
          <EnlaceAccion href="/app/financiar" flecha>
            Financiar una auditoría
          </EnlaceAccion>
        }
      />

      {/* Si el API cae, se dice: no se dibujan ceros que parezcan dato. */}
      {indicadores ? <Indicadores items={indicadores} /> : <EstadoError titulo="No pudimos leer las cifras de los aportes" />}

      <Listado
        ruta="/app/aliados"
        parametros={{
          ubigeo,
          periodo: periodo !== "todo" ? periodo : undefined,
          orden: orden !== "financiados" ? orden : undefined,
        }}
      >
        <div className="space-y-4">
          <BarraFiltros
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
            filtros={[
              {
                param: "ubigeo",
                etiqueta: "Región",
                todas: "Todo el Perú",
                opciones: regiones.map((z) => ({ valor: z.ubigeo, etiqueta: z.nombre })),
              },
            ]}
            orden={
              ordenable
                ? {
                    param: "orden",
                    porDefecto: "financiados",
                    opciones: (Object.keys(ORDEN_LABEL) as ClaveOrden[]).map((clave) => ({ valor: clave, etiqueta: ORDEN_LABEL[clave] })),
                  }
                : undefined
            }
          />
          <ZonaResultados>
            {ranking ? (
              <RankingAliados
                ranking={ranking}
                financiadosAmbito={financiadosAmbito}
                orden={orden}
                paginaActual={pagina}
                periodo={periodo}
                region={ubigeo}
                nombreRegion={zona?.nombre}
                precio={estado?.tarifa?.precioPen ?? null}
                desglose={frasePartesTarifa(partes)}
              />
            ) : (
              // Es una falla de la página, no un ranking vacío: los aportes siguen registrados.
              <EstadoError
                titulo="No pudimos leer el ranking"
                accion={
                  <EnlaceAccion variante="secundario" href={ubigeo ? `/app/aliados?ubigeo=${ubigeo}` : "/app/aliados"}>
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

      <ReglasIndependencia />
    </Pagina>
  );
}

/**
 * Las cifras del ámbito (todo el Perú o la región), desde el inicio, con la palabra de
 * §10.1: aquí se habla de lo FINANCIADO ("financiados leídos", no "leídos": la portada
 * cuenta también las lecturas que nadie financió).
 */
function indicadoresAmbito({
  estado,
  zona,
  publicados,
  financiados,
  leidos,
  conSenal,
  enRevision,
}: {
  estado: EstadoGlobal;
  zona: Zona | undefined;
  publicados: number | null;
  financiados: number;
  leidos: number;
  conSenal: number;
  enRevision: number;
}): Indicador[] {
  const precio = zona?.precioPen ?? estado.tarifa?.precioPen ?? null;
  // Lo que entró a la cola, financiado o no; "en cola" (§10.1) es lo que todavía espera.
  const cola = zona ? zona.totalCola : (estado.colaGlobal ?? 0) + estado.contratosFinanciados;
  const enCola = Math.max(0, cola - financiados);
  const documentosListos = (zona ? zona.documentosListos : estado.documentosListos) ?? 0;
  return [
    {
      valor: numero(financiados),
      etiqueta: "contratos financiados",
      contexto: publicados ? `${pctProporcion(financiados, publicados)} de ${numero(publicados)} publicados` : undefined,
      ayuda: (
        <Ayuda titulo="¿Cómo se asignan?">
          {precio != null ? `${soles(precio)} por contrato. ` : ""}Se asignan por antigüedad en la cola: nadie elige
          cuáles. La zona es la sede de la entidad que contrata.
        </Ayuda>
      ),
    },
    {
      valor: numero(leidos),
      etiqueta: "financiados leídos",
      contexto: `de ${numero(financiados)} financiados`,
      ayuda: (
        <Ayuda titulo="¿Financiados leídos o leídos?">
          Aquí se cuentan sólo las lecturas que pagó un aliado: expediente completo, norma citada y dictamen público. La
          portada cuenta todos los leídos, también los que nadie financió.
        </Ayuda>
      ),
    },
    {
      valor: numero(conSenal),
      etiqueta: "con señales",
      contexto: `de ${numero(leidos)} leídos${enRevision > 0 ? `, ${numero(enRevision)} en revisión` : ""}`,
      ayuda: (
        <Ayuda titulo="¿Se publica todo?">
          Sí: se publican igual, señalen a quien señalen, también a quien financió. Los que están en revisión no cuentan
          como señal hasta que una persona decida.
        </Ayuda>
      ),
    },
    {
      valor: numero(enCola),
      etiqueta: "en cola",
      contexto: precio != null ? `${soles(enCola * precio)} leerlos todos` : undefined,
      ayuda: (
        <Ayuda titulo="¿Qué entra a la cola?">
          Contratos que esperan financiamiento para leerse. Hoy entran solo {alcanceCorto(estado.alcance ?? null)}.
          {documentosListos > 0 &&
            ` Otros ${numero(documentosListos)} ya tienen sus documentos descargados, pero su tipo de contrato todavía no entra.`}
        </Ayuda>
      ),
    },
  ];
}

/**
 * Con un periodo (este año, este mes), las cifras salen del propio ranking: lo financiado
 * en aportes de ese periodo. Si hay más aliados que la muestra, la suma no sería exacta y
 * se dice "Sin dato" en vez de un número corto.
 */
function indicadoresPeriodo(ranking: Ranking, periodo: Periodo): Indicador[] {
  const { sumas, completa, totalNombres, anonimos } = ranking;
  const v = (n: number) => (completa ? numero(n) : null);
  const cuando = periodo === "mes" ? "en aportes de este mes" : "en aportes de este año";
  return [
    { valor: v(sumas.financiados), etiqueta: "contratos financiados", contexto: cuando },
    { valor: v(sumas.leidos), etiqueta: "financiados leídos", contexto: completa ? `de ${numero(sumas.financiados)} financiados` : undefined },
    {
      valor: v(sumas.conSenal),
      etiqueta: "con señales",
      contexto: completa
        ? `de ${numero(sumas.leidos)} leídos${sumas.enRevision > 0 ? `, ${numero(sumas.enRevision)} en revisión` : ""}`
        : undefined,
    },
    {
      valor: numero(totalNombres),
      etiqueta: totalNombres === 1 ? "aliado en el ranking" : "aliados en el ranking",
      contexto: anonimos.cantidad > 0 ? `y ${numero(anonimos.cantidad)} sin nombre` : cuando,
    },
  ];
}
