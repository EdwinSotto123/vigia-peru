import { EyeOff } from "lucide-react";
import { frasePartesTarifa, getEstadoGlobal, getRankingPaginado, partesTarifa, TIPO_FINANCIADOR_LABEL, type RankingRow } from "@/lib/financiamiento";
import { esSlugMaqueta, queryMaqueta, rankingMaqueta } from "@/lib/maqueta-aliados";
import { numero, soles } from "@/lib/formato";
import { Paginacion } from "@/components/ui/Paginacion";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { AvatarAliado, TarjetaAliado, esFundador } from "./TarjetaAliado";
import { Podio } from "./Podio";
import { ResumenAliado } from "./ResumenAliado";
import { getPerfilAliado, resumirContribuciones } from "./perfil";

/** Tamaño de página del libro mayor (tope del backend también es 60). */
const TAM = 24;
/**
 * Muestra para el recuento de anónimos y el orden: no se pagina, solo da contexto. Hasta
 * esta cantidad el muro se ordena en la página; pasada, lo ordena el API (por financiados).
 */
export const RESUMEN_LIMIT = 60;
/**
 * Hasta acá el muro se dibuja con fichas; pasado esto, con tabla.
 *
 * Antes el corte estaba en 3, y con cuatro nombres el muro caía a una tabla de
 * cuatro filas: quien financia —que es la razón de que exista cada auditoría—
 * quedaba reducido a un renglón. Una docena de fichas en grilla todavía se lee
 * como un muro; a partir de ahí, la tabla es la que respeta el volumen.
 */
const UMBRAL_FICHA = 12;
/** Con uno o dos nombres el muro es sobre todo una invitación, y se diseña como tal. */
const UMBRAL_INVITACION = 3;
/**
 * Cuántos resúmenes laterales se traen. Es un fetch por aliado: con la grilla
 * topada en 12 fichas, son 12 llamadas paralelas de 30 s de caché. Pasado eso
 * manda la tabla, que no abre paneles.
 */
const MAX_RESUMEN = 12;

export type ClaveOrden = "financiados" | "senales" | "regiones";

/** Las opciones del orden, para el `orden` de `BarraFiltros` (la página lo arma). */
export const ORDEN_LABEL: Record<ClaveOrden, string> = {
  financiados: "Más contratos financiados",
  senales: "Más contratos con señales",
  regiones: "Más regiones alcanzadas",
};

const ORDEN_VALOR: Record<ClaveOrden, (r: RankingRow) => number> = {
  financiados: (r) => r.contratosFinanciados,
  senales: (r) => r.senalesHalladas,
  regiones: (r) => r.zonas,
};

/** Lee `?orden=` y descarta cualquier otra cosa. */
export function parseOrden(v: string | string[] | undefined): ClaveOrden {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "senales" || s === "regiones" ? s : "financiados";
}

function ordenar(rows: RankingRow[], orden: ClaveOrden): RankingRow[] {
  const valor = ORDEN_VALOR[orden];
  return [...rows].sort(
    (a, b) =>
      valor(b) - valor(a) ||
      b.contratosFinanciados - a.contratosFinanciados ||
      a.nombre.localeCompare(b.nombre, "es"),
  );
}

const esAnonimo = (r: RankingRow) => r.tipo === "persona" && (r.nombre === "Anónimo" || !r.nombre);
const num = numero;

/**
 * El muro de aliados: libro mayor, nunca podio.
 *
 * Lo que había antes: un podio de tres puestos (dos de ellos losas "vacante"),
 * medallas emoji y una animación infinita sobre el puesto 1. Con un único
 * financiador —que además es la propia plataforma— eso no probaba legitimidad:
 * probaba soledad, y le daba superficie heroica justamente a quien paga, que es
 * lo contrario de lo que este producto promete.
 *
 * Lo que hay ahora: una ficha por aliado con su identidad, su logo clickeable
 * hacia su página, y un resumen que se abre al costado sin perder el muro.
 * Sin puestos, sin medallas, sin montos. El reconocimiento se mide en contratos
 * leídos —300 vecinos que financian 300 pesan igual que una empresa que
 * financia 300— y por eso este componente nunca muestra soles.
 *
 * La invitación a financiar NO vive acá: /app/aliados tiene un solo botón para eso, al
 * pie de la página. (Antes el muro, la cascada del déficit y la página tenían uno cada uno.)
 *
 * Va dentro de la `ZonaResultados` de /app/aliados (§14.1): la región y el orden viven
 * en la `BarraFiltros` de la página, y las cifras del ámbito en sus `Indicadores`. Pasadas
 * las doce fichas, el muro es la `Tabla` de todo listado.
 */
export async function MuroAliados({
  region,
  pagina = 1,
  nombreRegion,
  financiadosAmbito,
  maqueta = false,
  orden = "financiados",
}: {
  /** Ubigeo de 2–6 dígitos; en la URL de /app/aliados viaja como `?ubigeo=`. */
  region?: string;
  pagina?: number;
  /** Nombre de la región filtrada, para que el vacío diga de dónde habla. */
  nombreRegion?: string;
  /**
   * Contratos financiados en este ámbito, exacto (de `/financiamiento/estado` o de la
   * zona, más los de maqueta si el interruptor está puesto). Sin esto habría que sumar
   * las filas del ranking, que están paginadas: con más de 60 aliados esa suma mentiría
   * por lo bajo.
   */
  financiadosAmbito?: number;
  /** Maqueta activa (sólo en desarrollo): mezcla los aliados inventados de lib/maqueta-aliados.ts. */
  maqueta?: boolean;
  orden?: ClaveOrden;
}) {
  const paginaActual = Math.max(1, pagina);
  const offset = (paginaActual - 1) * TAM;
  const [resumenRaw, paginaRaw, estado] = await Promise.all([
    getRankingPaginado({ periodo: "todo", region, limit: RESUMEN_LIMIT }),
    getRankingPaginado({ periodo: "todo", region, limit: TAM, offset }),
    getEstadoGlobal(),
  ]);

  // El API cayó: se dice, no se dibuja un muro vacío que parezca "todavía no hay nadie".
  if (!resumenRaw) {
    return (
      <EstadoError
        titulo="No pudimos leer el registro de aportes"
        accion={
          <EnlaceAccion variante="secundario" href={region ? `/app/aliados?ubigeo=${region}` : "/app/aliados"}>
            Volver a intentarlo
          </EnlaceAccion>
        }
      >
        Es una falla de esta página, no un muro vacío: los aportes siguen registrados.
      </EstadoError>
    );
  }

  const inventados = maqueta ? rankingMaqueta(region) : [];
  const resumen = [...(resumenRaw.data ?? []), ...inventados];
  const totalVisible = (resumenRaw.total ?? 0) + inventados.length;
  const anonimos = resumen.filter(esAnonimo);
  const anonimosContratos = anonimos.reduce((n, r) => n + r.contratosFinanciados, 0);
  const conNombre = resumen.filter((r) => !esAnonimo(r));
  const financiadosMuro = financiadosAmbito ?? resumen.reduce((n, r) => n + r.contratosFinanciados, 0);
  const regionesConCola = estado?.regionesConCola ?? 0;
  const precio = estado?.tarifa.precioPen ?? null;
  const partes = partesTarifa(estado?.tarifa.nota);

  if (totalVisible === 0) {
    return <MuroVacio nombreRegion={nombreRegion} region={region} precio={precio} />;
  }

  const enFichas = totalVisible <= UMBRAL_FICHA;
  const cabeEnUnaPagina = totalVisible <= RESUMEN_LIMIT;
  const href = (r: RankingRow) =>
    r.slug ? `/aliado/${r.slug}${esSlugMaqueta(r.slug) ? queryMaqueta(true) : ""}` : undefined;

  // ── Muro de /app/aliados ────────────────────────────────────────────────
  const ordenadas = ordenar(conNombre, orden);
  const filasPagina = (paginaRaw?.data ?? []).filter((r) => !esAnonimo(r));
  const totalPagina = paginaRaw?.total ?? totalVisible;
  const paginas = Math.max(1, Math.ceil(totalPagina / TAM));

  // Los resúmenes laterales sólo se traen para lo que de verdad se va a pintar
  // como ficha: en tabla no hay panel que abrir.
  const conPerfil = enFichas ? ordenadas.filter((r) => r.slug).slice(0, MAX_RESUMEN) : [];
  // 300 s, no los 30 de la ficha: el TTL de una ruta en Next 14 es el mínimo de
  // sus fetches, y este muro no necesita refrescarse cada medio minuto.
  const perfiles = await Promise.all(conPerfil.map((r) => getPerfilAliado(r.slug as string, maqueta, 300)));
  const porSlug = new Map(conPerfil.map((r, i) => [r.slug as string, perfiles[i]]));

  const queryMaquetaPaginacion = !maqueta && process.env.NODE_ENV !== "production" ? "0" : undefined;
  const paginado = !cabeEnUnaPagina && paginas > 1;
  const paginacion = paginado ? (
    <Paginacion
      actual={paginaActual}
      paginas={paginas}
      total={totalPagina}
      tam={TAM}
      navegacion="url"
      hrefBase="/app/aliados"
      query={{ ubigeo: region, maqueta: queryMaquetaPaginacion, orden: orden !== "financiados" ? orden : undefined }}
      cargando={false}
      nombre="aliados"
    />
  ) : null;

  // El podio sólo existe ordenando por contratos financiados: con el muro
  // ordenado por señales o por regiones, un pedestal más alto significaría otra
  // cosa que la que el podio promete, y un podio que miente es peor que ninguno.
  const conPodio = enFichas && orden === "financiados" && ordenadas.length >= 3;
  const enPodio = conPodio ? ordenadas.slice(0, 3) : [];
  const fueraDelPodio = conPodio ? ordenadas.slice(3) : ordenadas;

  const cuerpo = enFichas ? (
    <div className="space-y-4">
      {conPodio && (
        <Podio filas={enPodio} financiadosAmbito={financiadosMuro} esMaqueta={(r) => esSlugMaqueta(r.slug)} />
      )}
      {/* Siempre en grilla, aunque haya un solo nombre: una ficha estirada a todo el ancho
          se lee como un cartel, no como una ficha. */}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {fueraDelPodio.map((r) => {
          const perfil = r.slug ? porSlug.get(r.slug) : null;
          return (
            <li key={r.id} className="flex [&>article]:w-full">
              <TarjetaAliado
                row={r}
                financiadosMuro={financiadosMuro}
                regionesConCola={regionesConCola}
                regionesAlcanzadas={perfil ? resumirContribuciones(perfil.contribuciones).regionesDistintas : undefined}
                href={href(r)}
                esMaqueta={esSlugMaqueta(r.slug)}
                resumen={
                  perfil ? (
                    <ResumenAliado
                      nombre={r.nombre}
                      contribuciones={perfil.contribuciones}
                      regionesConCola={regionesConCola}
                      financiadosMuro={financiadosMuro}
                      esMaqueta={perfil.esMaqueta}
                    />
                  ) : undefined
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  ) : (
    <Tabla
      columnas={COLUMNAS_TABLA}
      filas={(cabeEnUnaPagina ? ordenadas : [...inventados, ...filasPagina]).map((r) =>
        filaAliado(r, href(r), esSlugMaqueta(r.slug)),
      )}
      etiqueta={`Aliados, ordenados por ${ORDEN_LABEL[orden].toLowerCase()}`}
    />
  );

  return (
    <section aria-labelledby="muro-titulo" className="space-y-4">
      {/* El h2 existe para la jerarquía (las fichas y el podio llevan h3); a la vista, la
          barra de filtros y los indicadores de la página ya dicen de qué es el muro. */}
      <h2 id="muro-titulo" className="sr-only">Quién financió la lectura</h2>

      {paginacion && <div className="flex justify-end">{paginacion}</div>}
      {!cabeEnUnaPagina && totalVisible > 1 && (
        <p className="text-[12.5px] text-mute">Con más de {num(RESUMEN_LIMIT)} aliados, el muro se ordena por contratos financiados.</p>
      )}
      {!cabeEnUnaPagina && filasPagina.length === 0 && (
        <p className="text-sm text-mute">Los aportes de esta página se hicieron sin nombre: cuentan igual en el total.</p>
      )}

      {cuerpo}

      {paginacion && <div className="flex justify-end">{paginacion}</div>}

      {totalVisible <= UMBRAL_INVITACION && (
        <Invitacion totalVisible={totalVisible} nombreRegion={nombreRegion} precio={precio} desglose={frasePartesTarifa(partes)} />
      )}
      <Anonimos cantidad={anonimos.length} contratos={anonimosContratos} />
    </section>
  );
}

/**
 * La tabla del muro, con la anatomía de fila de todo listado: el aliado (logo, nombre y
 * qué es) · lo que hizo leer, a la derecha y con su denominador · desde cuándo · ›.
 * Sin montos: el reconocimiento se cuenta en contratos.
 */
const COLUMNAS_TABLA: Columna[] = [
  { clave: "aliado", titulo: "Aliado", ancho: "minmax(0,1fr)" },
  { clave: "financiados", titulo: "Financiados", ancho: "104px", alinear: "der" },
  { clave: "leidos", titulo: "Leídos", ancho: "104px", alinear: "der", desde: "md" },
  { clave: "senales", titulo: "Con señales", ancho: "104px", alinear: "der", desde: "lg" },
  {
    clave: "zonas",
    titulo: "Zonas",
    ancho: "80px",
    alinear: "der",
    desde: "xl",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta “zonas”?">
        Regiones, provincias o distritos distintos donde cayeron sus aportes, tal como se financiaron.
      </Ayuda>
    ),
  },
  { clave: "desde", titulo: "Desde", ancho: "96px", desde: "xl" },
];

function filaAliado(r: RankingRow, href: string | undefined, esMaqueta: boolean): Fila {
  const tipo = esFundador(r) ? "La propia plataforma" : TIPO_FINANCIADOR_LABEL[r.tipo];
  return {
    id: String(r.id),
    href,
    celdas: {
      aliado: (
        <span className="flex w-full min-w-0 items-center gap-3">
          {/* El nombre ya lo dice: el logo es decorativo para el lector de pantalla. */}
          <span aria-hidden className="shrink-0">
            <AvatarAliado tipo={r.tipo} logoUrl={r.logoUrl} nombre={r.nombre} size="sm" maqueta={esMaqueta} />
          </span>
          <CeldaPrincipal titulo={r.nombre} meta={esMaqueta ? `Maqueta, no existe · ${tipo}` : tipo} />
        </span>
      ),
      financiados: <CeldaNumero>{num(r.contratosFinanciados)}</CeldaNumero>,
      leidos: <CeldaNumero sub={`de ${num(r.contratosFinanciados)}`}>{num(r.contratosProcesados)}</CeldaNumero>,
      senales: <CeldaNumero sub={`de ${num(r.contratosProcesados)}`}>{num(r.senalesHalladas)}</CeldaNumero>,
      zonas: <CeldaNumero>{num(r.zonas)}</CeldaNumero>,
      desde: <CeldaFecha fecha={r.desde} />,
    },
  };
}

/**
 * Con uno o dos nombres, este muro es sobre todo una invitación — y se diseña
 * como tal, explicando el mecanismo, en vez de rellenar una grilla con losas
 * "vacante" que solo subrayan que no hay nadie. Tres pasos de una línea, lado a
 * lado (§10.7); el desglose del precio, en su ⓘ.
 */
function Invitacion({ totalVisible, nombreRegion, precio, desglose }: {
  totalVisible: number;
  nombreRegion?: string;
  /** Precio real de la tarifa; sin él no se dice un monto. */
  precio: number | null;
  /** "procesamiento (S/ 1), infraestructura y datos (S/ 1) y ...", o vacío. */
  desglose: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paperSoft px-5 py-4">
      <h3 className="font-display text-base font-bold text-ink">
        {totalVisible === 1
          ? `Hay un solo nombre en este muro${nombreRegion ? ` para ${nombreRegion}` : ""}`
          : `Hay ${num(totalVisible)} nombres en este muro${nombreRegion ? ` para ${nombreRegion}` : ""}`}
      </h3>
      <ol className="mt-2 grid gap-x-6 gap-y-2 text-[13px] leading-snug text-inkSoft md:grid-cols-3">
        <li className="flex gap-2">
          <span className="font-mono text-mute">1.</span>
          <span>
            Eliges una región y cuántos contratos.
            {precio != null && (
              <>
                {" "}
                {soles(precio)} cada uno
                {desglose && (
                  <>
                    {" "}
                    <Ayuda titulo="¿En qué se va cada contrato?">{desglose}.</Ayuda>
                  </>
                )}
              </>
            )}
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-mono text-mute">2.</span>
          <span>La cola los asigna por antigüedad: no los eliges tú ni Vigía Perú.</span>
        </li>
        <li className="flex gap-2">
          <span className="font-mono text-mute">3.</span>
          <span>Cada dictamen se publica con su norma, y tu comprobante lista cada contrato leído.</span>
        </li>
      </ol>
    </div>
  );
}

/**
 * Nadie ha aportado todavía en este ámbito: se dice qué falta y qué hacer, no se finge
 * una grilla. Con una región filtrada la acción lleva a financiar ESA zona (un destino
 * distinto de la invitación general del pie de /app/aliados).
 */
function MuroVacio({ nombreRegion, region, precio }: { nombreRegion?: string; region?: string; precio: number | null }) {
  return (
    <section aria-labelledby="muro-titulo">
      <h2 id="muro-titulo" className="sr-only">Quién financió la lectura</h2>
      <EstadoVacio
        titulo={
          nombreRegion
            ? `Todavía nadie financió la lectura de un contrato de ${nombreRegion}`
            : "Todavía nadie financió la lectura de un contrato"
        }
        accion={
          <EnlaceAccion href={region ? `/app/financiar/${region}` : "/app/financiar"}>
            {nombreRegion ? `Financiar la lectura de ${nombreRegion}` : "Financiar una auditoría"}
          </EnlaceAccion>
        }
      >
        Sus contratos ya están descargados: falta quien pague su lectura
        {precio != null && <>, a {soles(precio)} por contrato</>}.
      </EstadoVacio>
    </section>
  );
}

/** Los aportes sin nombre pesan igual en el conteo; solo no aparecen en la lista. */
function Anonimos({ cantidad, contratos }: { cantidad: number; contratos: number }) {
  if (cantidad === 0) return null;
  return (
    <p className="inline-flex items-start gap-1.5 text-[12px] leading-relaxed text-mute">
      <EyeOff size={13} className="mt-0.5 shrink-0" aria-hidden />
      {/* Dos cifras dentro de una frase: se dicen con la frase, no con un punto
          medio entre medio. La prosa ya tiene puntuación propia. */}
      <span>
        <span className="font-mono text-inkSoft">{num(cantidad)}</span>{" "}
        {cantidad === 1 ? "persona aportó" : "personas aportaron"} sin nombre y{" "}
        {cantidad === 1 ? "financió" : "financiaron"}{" "}
        <span className="font-mono text-inkSoft">{num(contratos)}</span> {contratos === 1 ? "contrato" : "contratos"}: cuentan
        igual, solo no figuran en la lista.
      </span>
    </p>
  );
}
