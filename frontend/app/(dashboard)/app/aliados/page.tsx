import Link from "next/link";
import { Ayuda, EncabezadoPagina, EstadoError, Pagina } from "@/components/patrones";
import { BarraFiltros, Indicadores, Listado, ZonaResultados, type Indicador } from "@/components/listado";
import { MuroAliados, ORDEN_LABEL, RESUMEN_LIMIT, parseOrden, type ClaveOrden } from "@/components/aliados/MuroAliados";
import { ReglasIndependencia } from "@/components/aliados/ReglasIndependencia";
import { InvitacionFinanciar } from "@/components/aliados/InvitacionFinanciar";
import { AvisoMaqueta } from "@/components/aliados/AvisoMaqueta";
import { pctProporcion } from "@/components/aliados/proporcion";
import { alcanceCorto, getEstadoGlobal, getRankingPaginado, getZonas, type EstadoGlobal, type Zona } from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";
import { numero, soles } from "@/lib/formato";
import { hrefSinMaqueta, maquetaActiva, rankingMaqueta, totalesMaqueta } from "@/lib/maqueta-aliados";

export const metadata = {
  title: "Aliados de transparencia",
  description:
    "Cuánto se ha leído de todo lo que hay por leer, y quién pagó por ello. El reconocimiento se cuenta en contratos, nunca en soles, y nadie elige qué se audita.",
};

export const revalidate = 300;

/**
 * /app/aliados — la plantilla Listado (DESIGN_SYSTEM.md §14.1) al servicio del muro:
 * encabezado → Indicadores del ámbito (cuánto se financió, se leyó y salió con señales,
 * y cuánto queda en cola) → barra de filtros (región y orden, en la URL) → el muro →
 * las reglas que hacen que ese dinero no compre nada → la única invitación a financiar.
 *
 * Antes la región iba en una barra pegajosa propia, el orden en píldoras propias y las
 * cifras en tres lugares distintos (junto al título, en la cabecera del muro y en una
 * cascada de barras al pie). Ahora son las piezas de todo listado.
 *
 * En DESARROLLO la página mezcla tres aliados INVENTADOS (lib/maqueta-aliados.ts) para
 * mirar el diseño con volumen, y lo avisa arriba y en cada tarjeta; `?maqueta=0` los
 * apaga. En PRODUCCIÓN no existen nunca, ni con `?maqueta=1` escrito a mano.
 */
export default async function AliadosPage({
  searchParams,
}: {
  searchParams?: { ubigeo?: string; pagina?: string; maqueta?: string; orden?: string };
}) {
  const ubigeo = searchParams?.ubigeo && /^\d{2,6}$/.test(searchParams.ubigeo) ? searchParams.ubigeo : undefined;
  const pagina = Math.max(1, Number.parseInt(searchParams?.pagina ?? "1", 10) || 1);
  const maqueta = maquetaActiva(searchParams?.maqueta);
  const orden = parseOrden(searchParams?.orden);

  // El ranking es el mismo fetch que hace el muro (misma URL, se memoiza en la petición):
  // acá sólo hace falta saber cuántos nombres hay para ofrecer el orden o no.
  const [estado, zonas, resumenPais, resumenZona, ranking] = await Promise.all([
    getEstadoGlobal(),
    getZonas("departamento"),
    getResumenContratos(),
    ubigeo ? getResumenContratos({ ubigeo }) : Promise.resolve(null),
    getRankingPaginado({ periodo: "todo", region: ubigeo, limit: RESUMEN_LIMIT }),
  ]);

  // El filtro lista toda región con cola, también las que nadie financia: una región con
  // cola y sin aliados es justo la que hay que poder mirar.
  const regiones = (zonas ?? [])
    .filter((z) => z.totalCola > 0)
    .sort((a, b) => b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre, "es"));
  const zona = ubigeo ? (zonas ?? []).find((z) => z.ubigeo === ubigeo) : undefined;

  // Con un solo nombre (o ninguno) un orden sugiere una competencia que no existe; pasados
  // los 60, el orden lo pone el API y un selector que no ordena sería mentira.
  const totalAliados = (ranking?.total ?? 0) + (maqueta ? rankingMaqueta(ubigeo).length : 0);
  const ordenable = totalAliados > 1 && totalAliados <= RESUMEN_LIMIT;

  // Los aliados de maqueta financian y hacen leer contratos de mentira: si no se suman
  // también a las cifras, arriba dirían "45 financiados" y el muro listaría 247. Con
  // `maqueta` apagado esto es exactamente cero.
  const extra = maqueta ? totalesMaqueta(ubigeo) : { financiados: 0, leidos: 0, conSenal: 0, enRevision: 0 };
  // Financiados leídos (asignaciones procesadas), no "leídos" a secas (§10.1).
  const leidos = (zona ? zona.procesados : estado?.contratosProcesados ?? 0) + extra.leidos;
  const financiados = (zona ? zona.financiados : estado?.contratosFinanciados ?? 0) + extra.financiados;

  // `?maqueta=0`: en desarrollo la vista sin parámetro vuelve a encender la maqueta.
  const salirMaqueta = hrefSinMaqueta(ubigeo ? `/app/aliados?ubigeo=${ubigeo}` : "/app/aliados");

  return (
    <Pagina className="space-y-6">
      <EncabezadoPagina
        titulo="Aliados de transparencia"
        bajada="Quién financia que estos contratos se lean. Se cuenta en contratos, nunca en soles."
        ayuda={
          <Ayuda titulo="¿Qué compra un aliado?">
            <span className="block">
              Nada: ni un resultado ni una región. Los contratos se asignan por antigüedad, en código, y lo que salga se
              publica igual, aunque señale a quien pagó.
            </span>
            <span className="mt-2 block text-mute">
              El muro no es un ranking de mérito. Todos los que figuran pasaron el chequeo de conflicto de interés: sin
              sanción vigente del OECE ni alertas activas como proveedor.
            </span>
          </Ayuda>
        }
      />

      {maqueta && <AvisoMaqueta volverHref={salirMaqueta} financiados={extra.financiados} leidos={extra.leidos} />}

      {/* Si el API cae, se dice: no se dibujan ceros que parezcan dato. */}
      {estado ? (
        <Indicadores
          items={indicadoresAmbito({
            estado,
            zona,
            publicados: (ubigeo ? resumenZona?.total : resumenPais?.total) ?? null,
            financiados,
            leidos,
            conSenal: (zona ? zona.senales : estado.senalesHalladas) + extra.conSenal,
            enRevision: ((zona ? zona.enRevision : estado.enRevision) ?? 0) + extra.enRevision,
          })}
        />
      ) : (
        <EstadoError titulo="No pudimos leer el estado de la cola" />
      )}

      <Listado
        ruta="/app/aliados"
        parametros={{ ubigeo, orden: orden !== "financiados" ? orden : undefined, maqueta: searchParams?.maqueta }}
      >
        <div className="space-y-4">
          <BarraFiltros
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
            {/* EL MURO VA ANTES QUE LAS REGLAS: esta página existe para reconocer a quien financia. */}
            <MuroAliados
              region={ubigeo}
              pagina={pagina}
              nombreRegion={zona?.nombre}
              financiadosAmbito={financiados}
              maqueta={maqueta}
              orden={orden}
            />
          </ZonaResultados>
        </div>
      </Listado>

      <ReglasIndependencia />

      {/* La ÚNICA invitación a financiar de esta página. */}
      <InvitacionFinanciar />

      {/* La puerta de vuelta a la maqueta existe sólo en desarrollo (tras salir con
          ?maqueta=0). En producción la maqueta no existe: maquetaActiva() devuelve false
          aunque alguien escriba ?maqueta=1. */}
      {process.env.NODE_ENV !== "production" && !maqueta && (
        <p className="text-[12px] text-mute">
          <Link
            href={ubigeo ? `/app/aliados?ubigeo=${ubigeo}&maqueta=1` : "/app/aliados?maqueta=1"}
            className="underline underline-offset-2 hover:text-ink"
          >
            Ver esta página con aliados de maqueta
          </Link>
          : sólo en desarrollo.
        </p>
      )}
    </Pagina>
  );
}

/**
 * Las cifras del ámbito (todo el Perú o la región filtrada), con la palabra de §10.1:
 * aquí se habla de lo FINANCIADO. "Financiados leídos", no "leídos": la portada cuenta
 * también las lecturas que nadie financió y por eso allá el número es mayor.
 *
 * Antes era una cascada de cuatro barras (publicados → entran a la cola → financiados →
 * leídos), una barra apilada y una línea más de cifras al pie. Las notas de cada escalón
 * viven ahora en el ⓘ de cada cifra.
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
  const pctPublicados = publicados ? pctProporcion(financiados, publicados) : null;
  return [
    {
      valor: numero(financiados),
      etiqueta: "contratos financiados",
      contexto: publicados ? `${pctPublicados} de ${numero(publicados)} publicados` : undefined,
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
      contexto: `de ${numero(leidos)} leídos${enRevision > 0 ? ` · ${numero(enRevision)} en revisión` : ""}`,
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
