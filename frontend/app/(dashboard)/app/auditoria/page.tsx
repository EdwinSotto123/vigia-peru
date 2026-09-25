import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Ayuda, EncabezadoPagina, Pagina, Seccion } from "@/components/patrones";
import { PASOS, TOTAL_AGENTES, TOTAL_PASOS, porCarril } from "@/components/agentes/catalogo";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { FiltroRegion } from "@/components/auditoria/FiltroRegion";
import { FiltrosPlegables } from "@/components/auditoria/FiltrosPlegables";
import { FiltroFechas, FiltroPatrocinador, FiltrosActivos } from "@/components/auditoria/FiltrosHistorico";
import { HistoricoProcesados } from "@/components/auditoria/HistoricoProcesados";
import { PanelProcesamiento } from "@/components/auditoria/PanelProcesamiento";
import { UltimoAnalisis } from "@/components/auditoria/UltimoAnalisis";
import {
  getFinanciadoresProcesamientos,
  getProcesamiento,
  getProcesamientos,
  getProcesamientosPaginado,
  type Procesamiento,
} from "@/lib/auditoria";
import { getResumenVivo } from "@/lib/contratos";
import { getZonas } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";

export const metadata = {
  title: "Auditoría en vivo",
  // El recuento sale del catálogo, nunca de una cadena escrita a mano: el producto llegó a
  // afirmar cinco números distintos de agentes en páginas que el mismo usuario visita seguidas.
  description:
    `Mira en tiempo real cómo cada contrato público financiado pasa de la cola al análisis de ${TOTAL_AGENTES} agentes en ${TOTAL_PASOS} pasos, y al dictamen con señales de riesgo.`,
};

export const revalidate = 10;

const carriles = porCarril(PASOS);
const listaY = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

const HIST_TAM = 24;
const FECHA_RX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `fases` (el estado por agente, ~1 KB por fila) sólo se dibuja en las filas que están
 * "procesando". En las demás cruzaba al navegador sin usarse: 110 de los 177 KB del tablero
 * y 60 de los 77 KB del histórico. Se quita antes de pasarlas a los client components; el
 * primer sondeo del tablero trae las filas completas igual.
 */
function sinFasesInactivas(ps: Procesamiento[]): Procesamiento[] {
  return ps.map((p) => (p.estado === "procesando" || p.fases == null ? p : { ...p, fases: null }));
}

export default async function AuditoriaPage({ searchParams }: { searchParams?: { ubigeo?: string; desde?: string; hasta?: string; financiador?: string; pagina?: string } }) {
  const ubigeo = searchParams?.ubigeo && /^\d{2,6}$/.test(searchParams.ubigeo) ? searchParams.ubigeo : undefined;
  const desde = searchParams?.desde && FECHA_RX.test(searchParams.desde) ? searchParams.desde : undefined;
  const hasta = searchParams?.hasta && FECHA_RX.test(searchParams.hasta) ? searchParams.hasta : undefined;
  const financiador = searchParams?.financiador?.trim().slice(0, 120) || undefined;
  const paginaActual = Math.max(1, Number.parseInt(searchParams?.pagina ?? "1", 10) || 1);
  const histQuery = { ubigeo, desde, hasta, financiador, estado: "procesado" as const };
  const filtrosVivo = { ubigeo, desde, hasta, financiador };
  const [resumen, zonas, initialCompleto, historicoCompleto, financiadores, ultimo, procesados] = await Promise.all([
    getResumenVivo(),
    getZonas("departamento"),
    // El tablero en vivo obedece los mismos filtros que el histórico (región, fecha, quién pagó).
    getProcesamientos({ ...filtrosVivo, limit: 300 }),
    getProcesamientosPaginado({ ...histQuery, limit: HIST_TAM, offset: (paginaActual - 1) * HIST_TAM }),
    getFinanciadoresProcesamientos(),
    // El último análisis terminado CON LOS FILTROS PUESTOS: es lo que se muestra cuando no
    // hay nada en análisis, que es el estado normal de esta pantalla. Consulta propia (no la
    // primera fila del histórico) para que no dependa de en qué página esté el paginador.
    // Su detalle (con la bitácora, que es lo que permite repetir la corrida) se encadena acá
    // mismo: antes se pedía DESPUÉS de todo lo demás, en serie.
    getProcesamientos({ ...histQuery, limit: 1 }).then((ref) => (ref?.[0]?.ocid ? getProcesamiento(ref[0].ocid) : null)),
    // Ritmo real (todo el Perú, como la barra de estado): cuándo terminó cada análisis.
    getProcesamientos({ estado: "procesado", limit: 300 }),
  ]);
  const initial = initialCompleto ? sinFasesInactivas(initialCompleto) : null;
  const historico = historicoCompleto ? { ...historicoCompleto, data: sinFasesInactivas(historicoCompleto.data ?? []) } : null;
  const finalizados = procesados ? procesados.map((p) => p.finalizadoAt).filter((f): f is string => !!f) : null;
  const hayFiltros = !!(ubigeo || desde || hasta || financiador);
  // Un selector con una sola opción no filtra nada: se muestra sólo si hay a quién elegir (o si ya hay uno puesto).
  const conPatrocinador = financiadores.length > 1 || !!financiador;
  const nActivos = (ubigeo ? 1 : 0) + (desde || hasta ? 1 : 0) + (financiador ? 1 : 0);
  const opciones = (zonas ?? [])
    .filter((z) => z.totalCola > 0 || z.financiados > 0)
    .sort((a, b) => b.financiados - a.financiados || a.nombre.localeCompare(b.nombre, "es"))
    .map((z) => ({ ubigeo: z.ubigeo, nombre: z.nombre, hint: z.financiados > 0 ? `${numero(z.financiados)} financiados` : undefined }));
  const zonaActual = ubigeo ? (zonas ?? []).find((z) => z.ubigeo === ubigeo)?.nombre : undefined;

  return (
    <Pagina>
      {/* Esta pantalla es un tablero: se entra a MIRAR, no a leer una introducción. Cómo se lee
          un contrato está a un clic, en el ⓘ del título; el estado queda arriba del pliegue. */}
      <EncabezadoPagina
        titulo="Auditoría en vivo"
        bajada="Cada contrato financiado, de la cola al dictamen, en orden de antigüedad: nadie elige cuál se lee."
        ayuda={
          <Ayuda titulo="¿Cómo se lee un contrato?" ancho="w-[22rem]">
            <span className="block">
              <span className="font-semibold text-ink">{TOTAL_AGENTES} agentes</span> lo leen en{" "}
              <span className="font-semibold text-ink">{TOTAL_PASOS} pasos</span>. Dos ramas corren a la vez y una síntesis
              junta todo al final:
            </span>
            {/* Derivado del catálogo: la lista y el número no pueden contradecirse. */}
            {carriles.map((c) => (
              <span key={c.key} className="mt-1 block text-mute">
                <span className="font-semibold text-ink">{c.label}:</span> {listaY(c.pasos.map((p) => p.titulo.toLowerCase()))}.
              </span>
            ))}
            <span className="mt-2 block border-t border-line pt-2 text-mute">
              <span className="font-semibold text-ink">En espera:</span> asignado a un aporte confirmado, espera sus
              documentos del SEACE o su turno. <span className="font-semibold text-ink">En análisis:</span> unos minutos por
              contrato. <span className="font-semibold text-ink">Con dictamen publicado:</span> cada señal cita su norma y
              su evidencia, y se publica aunque señale a quien lo pagó.
            </span>
          </Ayuda>
        }
      />

      {/* Única fuente de conteos de la página. */}
      <PanelProcesamiento initial={resumen} pollMs={5000} finalizados={finalizados} />

      {/* Un solo lugar para los tres filtros (región, fecha, quién lo pagó), al costado del título. */}
      <Seccion
        id="en-vivo"
        titulo={zonaActual ? `En vivo en ${zonaActual}` : "En vivo en todo el Perú"}
        ayuda={
          <Ayuda titulo="¿En qué orden entran?">
            Por orden de llegada: nadie elige cuál se lee. Los filtros acotan esta lista y la de lo ya leído, más abajo.
          </Ayuda>
        }
        acciones={
          <FiltrosPlegables activos={nActivos} columnas={conPatrocinador ? 3 : 2}>
            <FiltroRegion opciones={opciones} valor={ubigeo} />
            <FiltroFechas desde={desde} hasta={hasta} />
            {conPatrocinador && <FiltroPatrocinador financiador={financiador} financiadores={financiadores} />}
          </FiltrosPlegables>
        }
      >
        <div className="mb-3 empty:hidden">
          <FiltrosActivos zona={zonaActual} ubigeo={ubigeo} desde={desde} hasta={hasta} financiador={financiador} />
        </div>
        <TableroAuditoria
          key={[ubigeo, desde, hasta, financiador].map((v) => v ?? "").join("|")}
          ubigeo={ubigeo}
          desde={desde}
          hasta={hasta}
          financiador={financiador}
          initial={initial}
          autoRefreshMs={5000}
          verMasHref="#historico"
          conteosExternos
          conLlamita
          panelSecundario={<UltimoAnalisis p={ultimo} hayFiltros={hayFiltros} />}
        />
      </Seccion>

      {/* ─── HISTÓRICO (todo lo ya leído; los filtros están arriba, junto con región) ─── */}
      <Seccion
        id="historico"
        className="border-t border-line pt-6"
        titulo="Todo lo que ya se leyó"
        ayuda={
          <Ayuda titulo="¿Qué entra aquí?">
            Cada contrato financiado cuyo análisis terminó, con sus señales y quién pagó esa lectura. Incluye los que están
            en revisión: se leyeron enteros, pero su dictamen todavía no se publica. Los filtros de arriba también lo acotan.
          </Ayuda>
        }
      >
        <HistoricoProcesados
          pagina={historico}
          paginaActual={paginaActual}
          pathname="/app/auditoria"
          ubigeo={ubigeo}
          desde={desde}
          hasta={hasta}
          financiador={financiador}
        />
      </Seccion>

      {/* Una sola invitación a financiar, en una línea. */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-5 text-[13px] text-inkSoft">
        <span>¿Tu zona no aparece? Entra aquí en cuanto alguien financia su auditoría.</span>
        <Link href="/app/financiar" className="inline-flex items-center gap-1 font-semibold text-granate underline-offset-2 hover:underline">
          Financiar una auditoría <ArrowRight size={13} aria-hidden />
        </Link>
      </p>
    </Pagina>
  );
}
