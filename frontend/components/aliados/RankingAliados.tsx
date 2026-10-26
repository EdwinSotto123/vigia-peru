import type { ReactNode } from "react";
import { EyeOff } from "lucide-react";
import { TIPO_FINANCIADOR_LABEL, type ContribucionReciente } from "@/lib/financiamiento";
import { numero, soles } from "@/lib/formato";
import { Dato } from "@/components/ui/Dato";
import { Paginacion } from "@/components/ui/Paginacion";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Ayuda, EstadoVacio } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { AvatarAliado, esFundador } from "./TarjetaAliado";
import { LUGAR_LIBRE, PodioRanking, Puesto } from "./Podio";
import { CintaAportes } from "./CintaAportes";
import { LlamadaPodio } from "./LlamadaPodio";
import { pctProporcion } from "./proporcion";
import { ORDEN_LABEL, TAM_PAGINA, hrefPerfil, type ClaveOrden, type FilaRanking, type Periodo, type Ranking } from "./ranking";

/**
 * El ranking de /app/aliados (DESIGN_SYSTEM.md §14.1 y §14.6): quién hizo leer más
 * contratos públicos, con su puesto (#1, #2…). Con tres aliados con nombre o más, los
 * tres primeros en el podio con sus medallas (`PodioRanking`, el mismo de la portada) y
 * del cuarto en adelante la `Tabla` de todo listado. Con uno o dos, sin podio: su fila en
 * la tabla y la invitación (un podio con dos losas vacantes probaba soledad, DIRECCION.md).
 * Cada fila lleva al perfil del aliado.
 *
 * Se cuenta en contratos, nunca en soles: trescientos vecinos que financian 300 contratos
 * pesan lo mismo que una empresa que financia 300. Va dentro de la `ZonaResultados` de la
 * página; la región, el periodo y el orden viven en su `BarraFiltros`.
 *
 * Server-safe: todo llega ya calculado (components/aliados/ranking.ts).
 */

const num = numero;

const COLUMNAS: Columna[] = [
  { clave: "puesto", titulo: "Puesto", ancho: "52px" },
  { clave: "aliado", titulo: "Aliado", ancho: "minmax(0,1fr)" },
  // Sin ⓘ en la cabecera: a 360 px cada píxel es del nombre. Cómo se ordena, en el ⓘ del título.
  { clave: "financiados", titulo: "Financiados", ancho: "84px", alinear: "der" },
  { clave: "leidos", titulo: "Leídos", ancho: "96px", alinear: "der", desde: "md" },
  { clave: "senales", titulo: "Con señales", ancho: "104px", alinear: "der", desde: "lg" },
  {
    clave: "zonas",
    titulo: "Zonas",
    ancho: "76px",
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

function filaRanking(f: FilaRanking, financiadosAmbito: number): Fila {
  const tipo = esFundador(f) ? "La propia plataforma" : TIPO_FINANCIADOR_LABEL[f.tipo];
  return {
    id: String(f.id),
    href: hrefPerfil(f.slug),
    celdas: {
      puesto: <Puesto n={f.puesto} />,
      aliado: (
        <span className="flex w-full min-w-0 items-center gap-3">
          {/* El nombre ya lo dice: el logo es decorativo. En el celular se va, para dejarle ancho al nombre. */}
          <span aria-hidden className="hidden shrink-0 sm:inline-flex">
            <AvatarAliado tipo={f.tipo} logoUrl={f.logoUrl} nombre={f.nombre} size="sm" />
          </span>
          <CeldaPrincipal titulo={f.nombre} meta={[<Dato key="t" tipo="tipo">{tipo}</Dato>]} />
        </span>
      ),
      financiados: (
        <CeldaNumero sub={pctProporcion(f.contratosFinanciados, financiadosAmbito) ?? undefined}>
          <span className="font-display text-bloque font-bold text-ink">{num(f.contratosFinanciados)}</span>
        </CeldaNumero>
      ),
      leidos: <CeldaNumero sub={`de ${num(f.contratosFinanciados)}`}>{num(f.contratosProcesados)}</CeldaNumero>,
      senales: <CeldaNumero sub={`de ${num(f.contratosProcesados)} leídos`}>{num(f.senalesHalladas)}</CeldaNumero>,
      zonas: <CeldaNumero>{num(f.zonas)}</CeldaNumero>,
      desde: <CeldaFecha fecha={f.desde} />,
    },
  };
}

export function RankingAliados({
  ranking,
  financiadosAmbito,
  orden,
  paginaActual,
  periodo,
  region,
  nombreRegion,
  precio,
  desglose,
  recientes = null,
  totalRecientes,
  franja,
  busqueda,
}: {
  ranking: Ranking;
  /** Contratos financiados en el ámbito (región y periodo): denominador de cada fila. */
  financiadosAmbito: number;
  orden: ClaveOrden;
  paginaActual: number;
  periodo: Periodo;
  region?: string;
  nombreRegion?: string;
  /** Precio real por contrato; sin él no se dice un monto. */
  precio: number | null;
  /** "procesamiento (S/ 1), infraestructura y datos (S/ 1)…", o vacío. */
  desglose: string;
  /** Los últimos aportes: van en la cinta que se desplaza, al pie. */
  recientes?: ContribucionReciente[] | null;
  /** Cuántos aportes hay en total (para el botón "Ver todos los aportes"). */
  totalRecientes?: number;
  /** Las cifras de apoyo, en tamaño discreto, justo debajo del podio. */
  franja?: ReactNode;
  /** El nombre buscado: la tabla son los que coinciden, con su puesto de siempre, sin podio. */
  busqueda?: string;
}) {
  const { podio, tabla: resto, anonimos, totalNombres, completa, paginas } = ranking;
  // El podio, sólo con tres; con uno o dos, esos van en la tabla como cualquier fila.
  const conPodio = podio.length >= 3;
  const tabla = conPodio ? resto : [...podio, ...resto];

  if (busqueda && tabla.length === 0) {
    return (
      <EstadoVacio compacto conLlamita={false} titulo={`Ningún aliado visible coincide con “${busqueda}”`}>
        {nombreRegion ? `Se buscó en ${nombreRegion}. ` : ""}Los que aportan sin nombre no se pueden buscar.
      </EstadoVacio>
    );
  }

  if (totalNombres === 0) {
    return (
      <section aria-labelledby="ranking-titulo" className="space-y-3">
        <h2 id="ranking-titulo" className="sr-only">
          Ranking de aliados
        </h2>
        <RankingVacio nombreRegion={nombreRegion} region={region} periodo={periodo} precio={precio} conAnonimos={anonimos.cantidad > 0} />
        <Anonimos cantidad={anonimos.cantidad} contratos={anonimos.contratos} />
      </section>
    );
  }

  const paginacion =
    !completa && paginas > 1 ? (
      <Paginacion
        actual={paginaActual}
        paginas={paginas}
        total={totalNombres}
        tam={TAM_PAGINA}
        navegacion="url"
        hrefBase="/app/aliados"
        query={{ ubigeo: region, periodo: periodo !== "todo" ? periodo : undefined, q: busqueda }}
        cargando={false}
        nombre="aliados"
      />
    ) : null;

  return (
    <div className="space-y-4">
      {/* El podio es el foco: los guardianes. Sólo con tres; cómo se gana un puesto está en el ⓘ del título de la página. */}
      {conPodio && (
        <PodioRanking
          filas={podio}
          financiadosAmbito={financiadosAmbito}
          lugarLibre={LUGAR_LIBRE}
          titulo="Guardianes de los recursos del Perú"
          subtitulo="Cada contrato que hicieron leer es dinero público bajo vigilancia."
        />
      )}

      {/* Las cifras, chicas y discretas: apoyan al ranking, no compiten con él (sin caja alrededor de sus tarjetas). */}
      {franja}

      {tabla.length > 0 && (
        <section aria-labelledby="ranking-titulo" className="space-y-2.5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            {/* Con podio, la tabla es "el resto"; sin él, es el ranking entero y el h1 ya lo dice. */}
            <h2 id="ranking-titulo" className={conPodio || busqueda ? "font-display text-bloque font-bold text-ink" : "sr-only"}>
              {busqueda
                ? `${numero(totalNombres)} ${totalNombres === 1 ? "aliado coincide" : "aliados coinciden"} con “${busqueda}”`
                : conPodio
                  ? "Del cuarto puesto en adelante"
                  : "Ranking de aliados"}
            </h2>
            {paginacion}
          </div>
          {!completa && !busqueda && (
            <p className="text-meta text-mute">Con tantos aliados, el ranking se ordena sólo por contratos financiados.</p>
          )}
          <Tabla
            columnas={COLUMNAS}
            filas={tabla.map((f) => filaRanking(f, financiadosAmbito))}
            etiqueta={`Aliados, ordenados por ${ORDEN_LABEL[orden].toLowerCase()}`}
            densidad="compacta"
          />
          {paginacion && <div className="flex justify-end">{paginacion}</div>}
        </section>
      )}

      {/* Sin podio todavía, la invitación lo dice: el podio se arma con tres. */}
      {!busqueda && totalNombres > 0 && totalNombres < 3 && (
        <p className="text-dato leading-snug text-inkSoft">
          {totalNombres === 1 ? "Por ahora hay un solo aliado con nombre." : "Por ahora hay dos aliados con nombre."} El podio se arma con tres. {LUGAR_LIBRE}
        </p>
      )}
      <LlamadaPodio precio={precio} desglose={desglose} nombreRegion={nombreRegion} hayPodio={conPodio} />

      {recientes && recientes.length > 0 && <CintaAportes items={recientes} total={totalRecientes} />}
      <Anonimos cantidad={anonimos.cantidad} contratos={anonimos.contratos} />
    </div>
  );
}

/**
 * Nadie con nombre en este ámbito: se dice qué falta y qué hacer, no se finge un ranking.
 * Con una región filtrada la acción lleva a financiar ESA zona (un destino distinto de la
 * acción general del encabezado); sin región, el encabezado ya la tiene.
 */
function RankingVacio({
  nombreRegion,
  region,
  periodo,
  precio,
  conAnonimos,
}: {
  nombreRegion?: string;
  region?: string;
  periodo: Periodo;
  precio: number | null;
  conAnonimos: boolean;
}) {
  const cuando = periodo === "mes" ? " este mes" : periodo === "anio" ? " este año" : "";
  const donde = nombreRegion ? ` de ${nombreRegion}` : "";
  return (
    <EstadoVacio
      titulo={
        conAnonimos
          ? `Los aportes${cuando}${donde} se hicieron sin nombre`
          : `Todavía nadie financió${cuando} la lectura de un contrato${donde}`
      }
      accion={
        region ? (
          <EnlaceAccion variante="secundario" href={`/app/financiar/${region}`}>
            {`Financiar la lectura de ${nombreRegion ?? "esta zona"}`}
          </EnlaceAccion>
        ) : undefined
      }
    >
      Sus contratos ya están descargados: falta quien pague su lectura
      {precio != null && <>, a {soles(precio)} por contrato</>}.
    </EstadoVacio>
  );
}

/** Los aportes sin nombre pesan igual en las cifras; sólo no ocupan puesto. */
function Anonimos({ cantidad, contratos }: { cantidad: number; contratos: number }) {
  if (cantidad === 0) return null;
  return (
    <p className="inline-flex items-start gap-1.5 text-meta leading-relaxed text-mute">
      <EyeOff size={13} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        {cantidad === 1 ? "1 persona aportó" : `${num(cantidad)} personas aportaron`} sin nombre y{" "}
        {cantidad === 1 ? "financió" : "financiaron"} {contratos === 1 ? "1 contrato" : `${num(contratos)} contratos`}: cuentan
        igual en las cifras, sólo no ocupan puesto.
      </span>
    </p>
  );
}
