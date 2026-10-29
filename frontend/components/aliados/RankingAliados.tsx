import type { ReactNode } from "react";
import { EyeOff } from "lucide-react";
import { TIPO_FINANCIADOR_LABEL, type ContribucionReciente } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { Dato } from "@/components/ui/Dato";
import { Paginacion } from "@/components/ui/Paginacion";
import { EstadoVacio } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { AvatarAliado } from "./TarjetaAliado";
import { PodioRanking, Puesto } from "./Podio";
import { CintaAportes } from "./CintaAportes";
import { LlamadaPodio } from "./LlamadaPodio";
import { ORDEN_LABEL, TAM_PAGINA, hrefPerfil, type ClaveOrden, type FilaRanking, type Periodo, type Ranking } from "./ranking";

/**
 * El podio de /app/aliados (pedido del usuario del 2026-10-29: «que sea un PODIO»): arriba, siempre, los tres
 * lugares (`PodioRanking`, el mismo de la portada), ocupados o libres; debajo, la meta del mes; del cuarto lugar en
 * adelante, la `Tabla` de todo listado; la invitación, los últimos aportes y los que aportan sin nombre.
 *
 * Se gana por constancia (los meses con un aporte), nunca por soles: quien pone S/ 5 cada mes le gana a quien puso
 * S/ 500 una vez. La semilla de Vigía Perú no compite. Va dentro de la `ZonaResultados` de la página; el periodo, la
 * búsqueda y el orden viven en su `BarraFiltros`.
 *
 * Server-safe: todo llega ya calculado (components/aliados/ranking.ts).
 */

const COLUMNAS: Columna[] = [
  { clave: "puesto", titulo: "Puesto", ancho: "52px" },
  { clave: "aliado", titulo: "Aliado", ancho: "minmax(0,1fr)" },
  // Sin ⓘ en la cabecera: a 360 px cada píxel es del nombre. Cómo se ordena, en el ⓘ del título de la página.
  { clave: "meses", titulo: "Meses", ancho: "84px", alinear: "der" },
  { clave: "aportes", titulo: "Aportes", ancho: "84px", alinear: "der", desde: "md" },
  { clave: "desde", titulo: "Desde", ancho: "96px", desde: "lg" },
];

function filaRanking(f: FilaRanking): Fila {
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
          <CeldaPrincipal
            titulo={f.nombre}
            meta={[
              <Dato key="t" tipo="tipo">{TIPO_FINANCIADOR_LABEL[f.tipo]}</Dato>,
              f.mensual ? <Dato key="m" tipo="fecha" nombre="Aporta">Cada mes</Dato> : null,
              // Del modelo anterior (S/ 3 por contrato): lo que hizo leer.
              f.contratosFinanciados > 0 ? (
                <Dato key="c" tipo="documento" nombre="Hizo leer">{`${numero(f.contratosFinanciados)} ${f.contratosFinanciados === 1 ? "contrato" : "contratos"}`}</Dato>
              ) : null,
            ]}
          />
        </span>
      ),
      meses: (
        <CeldaNumero>
          <span className="font-display text-bloque font-bold text-ink">{numero(f.meses)}</span>
        </CeldaNumero>
      ),
      aportes: <CeldaNumero>{numero(f.aportes)}</CeldaNumero>,
      desde: <CeldaFecha fecha={f.desde} />,
    },
  };
}

/** El título del podio según el periodo («El podio de octubre», «El podio de 2026»). */
function tituloPodio(periodo: Periodo, ocupados: number): string | undefined {
  if (ocupados === 0) return undefined;
  const ahora = new Date();
  if (periodo === "mes") return `El podio de ${new Intl.DateTimeFormat("es-PE", { month: "long", timeZone: "America/Lima" }).format(ahora)}`;
  if (periodo === "anio") return `El podio de ${new Intl.DateTimeFormat("es-PE", { year: "numeric", timeZone: "America/Lima" }).format(ahora)}`;
  return "Quienes más meses sostienen la vigilancia";
}

export function RankingAliados({
  ranking,
  orden,
  paginaActual,
  periodo,
  recientes = null,
  totalRecientes,
  meta,
  busqueda,
}: {
  ranking: Ranking;
  orden: ClaveOrden;
  paginaActual: number;
  periodo: Periodo;
  /** Los últimos aportes (sin la semilla): van en la cinta que se desplaza, al pie. */
  recientes?: ContribucionReciente[] | null;
  /** Cuántos aportes hay en total (para el botón "Ver todos los aportes"). */
  totalRecientes?: number;
  /** La meta del mes, justo debajo del podio. */
  meta?: ReactNode;
  /** El nombre buscado: la tabla son los que coinciden, con su puesto de siempre, sin podio. */
  busqueda?: string;
}) {
  const { podio, tabla, anonimos, totalNombres, completa, paginas } = ranking;
  const cuando = periodo === "mes" ? " este mes" : periodo === "anio" ? " este año" : "";

  if (busqueda && tabla.length === 0) {
    return (
      <EstadoVacio compacto conLlamita={false} titulo={`Ningún aliado visible coincide con “${busqueda}”`}>
        Los que aportan sin nombre no se pueden buscar.
      </EstadoVacio>
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
        query={{ periodo: periodo !== "todo" ? periodo : undefined, q: busqueda }}
        cargando={false}
        nombre="aliados"
      />
    ) : null;

  return (
    <div className="space-y-4">
      {/* El podio es el foco: siempre los tres lugares, ocupados o libres. En una búsqueda, sólo la tabla. Sin `nota` al
          costado: «estar aquí no compra nada» ya lo dice la bajada de la página, y «lo más grave se lee primero», la
          invitación de abajo. */}
      {!busqueda && paginaActual === 1 && (
        <PodioRanking
          filas={podio}
          titulo={tituloPodio(periodo, podio.length)}
          subtitulo="Personas, colectivos y empresas que mantienen Vigía encendida, mes a mes."
          cuando={cuando}
        />
      )}

      {!busqueda && meta}

      {tabla.length > 0 && (
        <section aria-labelledby="ranking-titulo" className="space-y-2.5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="ranking-titulo" className="font-display text-bloque font-bold text-ink">
              {busqueda
                ? `${numero(totalNombres)} ${totalNombres === 1 ? "aliado coincide" : "aliados coinciden"} con “${busqueda}”`
                : "Del cuarto lugar en adelante"}
            </h2>
            {paginacion}
          </div>
          {!completa && !busqueda && <p className="text-meta text-mute">Con tantos aliados, la tabla va en el orden del podio.</p>}
          <Tabla
            columnas={COLUMNAS}
            filas={tabla.map(filaRanking)}
            etiqueta={`Aliados, ordenados por ${ORDEN_LABEL[orden].toLowerCase()}`}
            densidad="compacta"
          />
          {paginacion && <div className="flex justify-end">{paginacion}</div>}
        </section>
      )}

      <LlamadaPodio />

      {recientes && recientes.length > 0 && <CintaAportes items={recientes} total={totalRecientes} />}
      <Anonimos cantidad={anonimos.cantidad} />
    </div>
  );
}

/** Los aportes sin nombre pesan igual en la meta; sólo no ocupan lugar. */
function Anonimos({ cantidad }: { cantidad: number }) {
  if (cantidad === 0) return null;
  return (
    <p className="inline-flex items-start gap-1.5 text-meta leading-relaxed text-mute">
      <EyeOff size={13} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        {cantidad === 1 ? "1 persona aporta" : `${numero(cantidad)} personas aportan`} sin nombre: cuentan igual en la meta del mes,
        sólo no ocupan lugar en el podio.
      </span>
    </p>
  );
}
