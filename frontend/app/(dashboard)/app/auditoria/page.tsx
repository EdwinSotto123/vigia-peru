import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, Cpu, Info } from "lucide-react";
import { EncabezadoPagina, Seccion } from "@/components/patrones";
import { Popover } from "@/components/ui/Flotante";
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
 * `fases` (el estado por agente, ~1 KB por fila) sólo se dibuja en las tarjetas que están
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
    <div className="space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      {/* Esta pantalla es un tablero: se entra a MIRAR, no a leer una introducción. La
          explicación sigue disponible, a un clic, y el estado queda arriba del pliegue. */}
      <EncabezadoPagina
        titulo="Auditoría en vivo"
        bajada="Cada contrato financiado pasa de la cola al análisis y al dictamen. Nadie elige cuál se lee: entran por antigüedad."
        acciones={
          <Popover
            titulo="Qué pasa acá adentro"
            anchoClase="w-[22rem]"
            className="inline-flex min-h-[36px] items-center rounded-full border border-line bg-paper px-3.5 py-1.5 text-[12px] font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
            trigger={<span className="inline-flex items-center gap-1.5"><Info size={13} aria-hidden /> Cómo se lee un contrato</span>}
          >
            <p className="text-mute">
              <span className="font-semibold text-ink">{TOTAL_AGENTES} agentes</span> leen cada contrato en{" "}
              <span className="font-semibold text-ink">{TOTAL_PASOS} pasos</span>. Dos ramas corren a la vez y una
              síntesis junta todo al final:
            </p>
            {/* Derivado del catálogo: la lista y el número no pueden contradecirse. */}
            <ul className="mt-1.5 space-y-1 text-mute">
              {carriles.map((c) => (
                <li key={c.key}>
                  <span className="font-semibold text-ink">{c.label}:</span> {listaY(c.pasos.map((p) => p.titulo.toLowerCase()))}.
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-2.5 border-t border-line pt-2.5">
              <Paso icon={<Clock size={14} />} titulo="En espera">
                Asignado a un aporte confirmado. Espera sus documentos del SEACE, o su turno por antigüedad de la convocatoria.
              </Paso>
              <Paso icon={<Cpu size={14} />} titulo="En análisis">
                Los agentes leen el expediente y cruzan fuentes oficiales. Toma unos minutos por contrato: el ritmo real
                está en el panel de arriba.
              </Paso>
              <Paso icon={<CheckCircle2 size={14} />} titulo="Con dictamen publicado">
                Cada señal cita su norma y su evidencia. Se publica aunque señale a quien lo pagó.
              </Paso>
            </dl>
          </Popover>
        }
      />

      {/* Única fuente de conteos de la página. */}
      <PanelProcesamiento initial={resumen} pollMs={5000} finalizados={finalizados} />

      {/* Un solo lugar para los tres filtros (región, fecha, quién lo pagó), al costado del título. */}
      <Seccion
        id="en-vivo"
        titulo={zonaActual ? `En vivo en ${zonaActual}` : "En vivo en todo el Perú"}
        descripcion="Los contratos entran por orden de llegada. Los filtros acotan este tablero y el histórico."
        acciones={
          <FiltrosPlegables activos={nActivos} columnas={conPatrocinador ? 3 : 2}>
            <FiltroRegion opciones={opciones} valor={ubigeo} />
            <FiltroFechas desde={desde} hasta={hasta} />
            {conPatrocinador && <FiltroPatrocinador financiador={financiador} financiadores={financiadores} />}
          </FiltrosPlegables>
        }
      >
        <div className="empty:hidden">
          <FiltrosActivos zona={zonaActual} ubigeo={ubigeo} desde={desde} hasta={hasta} financiador={financiador} />
        </div>
        <div className="mt-4">
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
        </div>
      </Seccion>

      {/* ─── HISTÓRICO (todo lo ya leído; los filtros están arriba, junto con región) ─── */}
      <Seccion
        id="historico"
        className="border-t border-line pt-6"
        titulo="Todo lo que ya se leyó"
        descripcion="Cada contrato financiado leído, con las señales que encontró y quién pagó esa lectura. Incluye los que están en revisión: se leyeron enteros, pero su dictamen todavía no se publica. Los filtros de arriba también lo acotan."
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
        <span>¿Tu zona no aparece? Sus contratos entran acá en cuanto alguien financia su auditoría.</span>
        <Link href="/app/financiar" className="inline-flex items-center gap-1 font-semibold text-granate underline-offset-2 hover:underline">
          Financiar una auditoría <ArrowRight size={13} aria-hidden />
        </Link>
      </p>
    </div>
  );
}

function Paso({ icon, titulo, children }: { icon: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 shrink-0 text-mute" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <dt className="text-[13px] font-semibold text-ink">{titulo}</dt>
        <dd className="text-[12px] leading-snug text-mute">{children}</dd>
      </div>
    </div>
  );
}
