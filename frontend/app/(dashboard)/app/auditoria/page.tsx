import Link from "next/link";
import { Activity, ArrowRight, CheckCircle2, Clock, Cpu, ShieldCheck } from "lucide-react";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { FiltroRegion } from "@/components/auditoria/FiltroRegion";
import { FiltrosHistorico } from "@/components/auditoria/FiltrosHistorico";
import { HistoricoProcesados } from "@/components/auditoria/HistoricoProcesados";
import { PanelProcesamiento } from "@/components/auditoria/PanelProcesamiento";
import { getFinanciadoresProcesamientos, getProcesamientos, getProcesamientosPaginado } from "@/lib/auditoria";
import { getResumenVivo } from "@/lib/contratos";
import { getZonas } from "@/lib/financiamiento";

export const metadata = {
  title: "Auditoría en vivo — Vigía Perú",
  description:
    "Mira en tiempo real cómo cada contrato público financiado pasa de la cola al análisis de 10 fases y al dictamen con señales de riesgo.",
};

export const revalidate = 10;

const HIST_TAM = 24;
const FECHA_RX = /^\d{4}-\d{2}-\d{2}$/;

export default async function AuditoriaPage({ searchParams }: { searchParams?: { ubigeo?: string; desde?: string; hasta?: string; financiador?: string; pagina?: string } }) {
  const ubigeo = searchParams?.ubigeo && /^\d{2,6}$/.test(searchParams.ubigeo) ? searchParams.ubigeo : undefined;
  const desde = searchParams?.desde && FECHA_RX.test(searchParams.desde) ? searchParams.desde : undefined;
  const hasta = searchParams?.hasta && FECHA_RX.test(searchParams.hasta) ? searchParams.hasta : undefined;
  const financiador = searchParams?.financiador?.trim().slice(0, 120) || undefined;
  const paginaActual = Math.max(1, Number.parseInt(searchParams?.pagina ?? "1", 10) || 1);
  const histQuery = { ubigeo, desde, hasta, financiador, estado: "procesado" as const };
  const [resumen, zonas, initial, historico, financiadores] = await Promise.all([
    getResumenVivo(),
    getZonas("departamento"),
    getProcesamientos({ ubigeo, limit: 100 }),
    getProcesamientosPaginado({ ...histQuery, limit: HIST_TAM, offset: (paginaActual - 1) * HIST_TAM }),
    getFinanciadoresProcesamientos(),
  ]);
  const opciones = (zonas ?? [])
    .filter((z) => z.totalCola > 0 || z.financiados > 0)
    .sort((a, b) => b.financiados - a.financiados || a.nombre.localeCompare(b.nombre, "es"))
    .map((z) => ({ ubigeo: z.ubigeo, nombre: z.nombre, hint: z.financiados > 0 ? `${z.financiados.toLocaleString("es-PE")} financiados` : undefined }));
  const zonaActual = ubigeo ? (zonas ?? []).find((z) => z.ubigeo === ubigeo)?.nombre : undefined;

  return (
    <div className="bg-paper">
      {/* ─── HERO ─── */}
      <section className="border-b border-line bg-paperDeep">
        <div className="container-page space-y-6 py-10">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-mute">
              <Activity size={12} /> Tablero público · se actualiza solo
            </span>
            <h1 className="mt-4 font-serif text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-5xl">
              Auditoría en vivo
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-mute">
              Cada contrato financiado por un aliado de transparencia pasa por <strong className="text-ink">10 fases de análisis</strong>:
              reglas de contratación, lectura del expediente, precios de mercado, prensa, red de personas y dictamen.
              Aquí lo ves ocurrir, contrato por contrato.
            </p>
          </div>
          {/* Una franja + una fila "ahora mismo": descargados, cola, procesando, procesados hoy, errores, pendientes */}
          <PanelProcesamiento initial={resumen} pollMs={5000} />
        </div>
      </section>

      {/* ─── TABLERO ─── */}
      <section className="container-page py-10">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-bold text-ink">{zonaActual ? `En vivo en ${zonaActual}` : "En vivo en todo el Perú"}</h2>
            <p className="mt-0.5 text-sm text-mute">Los contratos entran por orden de llegada. Nadie elige cuáles.</p>
          </div>
          {/* Un solo lugar para todos los filtros (región, fecha, patrocinador) — antes estaban
              repartidos entre acá arriba y el histórico de abajo, cada uno con su propia caja. */}
          <div className="flex flex-wrap items-center gap-2">
            <FiltroRegion opciones={opciones} valor={ubigeo} />
            <FiltrosHistorico desde={desde} hasta={hasta} financiador={financiador} financiadores={financiadores} />
          </div>
        </div>
        <TableroAuditoria key={ubigeo ?? "all"} ubigeo={ubigeo} initial={initial} autoRefreshMs={5000} verMasHref="#historico" />
      </section>

      {/* ─── HISTÓRICO (todo lo ya procesado; los filtros están arriba, junto con región) ─── */}
      <section id="historico" className="container-page border-t border-line py-10 scroll-mt-6">
        <h2 className="sr-only">Histórico de contratos procesados</h2>
        <HistoricoProcesados
          pagina={historico}
          paginaActual={paginaActual}
          pathname="/app/auditoria"
          ubigeo={ubigeo}
          desde={desde}
          hasta={hasta}
          financiador={financiador}
        />
      </section>

      {/* ─── LEYENDA + CTA ─── */}
      <section className="border-t border-line bg-paperDeep py-12">
        <div className="container-page grid gap-6 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-start">
          <Paso icon={<Clock size={16} />} titulo="En cola">
            Asignado a un aporte confirmado. Espera turno por antigüedad de la convocatoria.
          </Paso>
          <Paso icon={<Cpu size={16} />} titulo="Procesando">
            Los agentes leen el expediente y cruzan fuentes oficiales. Entre 3 y 10 minutos por contrato.
          </Paso>
          <Paso icon={<CheckCircle2 size={16} />} titulo="Procesado">
            Dictamen publicado con cada señal de riesgo citando norma y evidencia. Se publica aunque señale al financiador.
          </Paso>
          <div className="rounded-2xl border border-line bg-paper p-5 lg:max-w-xs">
            <ShieldCheck size={18} className="text-moss" />
            <div className="mt-2 text-sm font-semibold text-ink">¿Tu zona no aparece?</div>
            <p className="mt-1 text-[13px] text-mute">Cuando alguien financia la auditoría de una zona, sus contratos entran aquí. Puedes ser tú.</p>
            <Link href="/app/financiar" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline-offset-2 hover:underline">
              Financiar una auditoría <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function Paso({ icon, titulo, children }: { icon: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="inline-flex items-center gap-2 text-ink">{icon}<h3 className="font-semibold">{titulo}</h3></div>
      <p className="mt-1 text-sm leading-relaxed text-mute">{children}</p>
    </div>
  );
}
