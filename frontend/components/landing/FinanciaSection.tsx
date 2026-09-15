import Link from "next/link";
import { ArrowRight, Landmark, ShieldCheck } from "lucide-react";
import { CampaignMap } from "@/components/financiar/CampaignMap";
import { RankingTable } from "@/components/financiar/RankingTable";
import { getEstadoGlobal, getRanking, getZonas, formatPEN } from "@/lib/financiamiento";

/** Sección de la landing: métricas globales + mapa de estados + top 3 + CTA. Server component. */
export async function FinanciaSection() {
  const [zonas, estado, ranking] = await Promise.all([getZonas("departamento"), getEstadoGlobal(), getRanking("todo")]);
  const precio = estado?.tarifa.precioPen ?? 3;

  return (
    <section id="financiar" className="scroll-mt-20 border-y border-line bg-paperDeep py-20">
      <div className="container-page">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-mute">
              <Landmark size={12} /> Financia una auditoría
            </span>
            <h2 className="mt-4 font-serif text-4xl font-bold leading-tight text-ink sm:text-5xl">
              Cada contrato público que nadie lee cuesta <em className="text-clay">{formatPEN(precio)}</em> leerlo.
            </h2>
            <p className="mt-4 max-w-lg text-mute">
              Elige una región, provincia o distrito y financia la capacidad de auditar sus contratos pendientes.
              Recibes un comprobante público con cada contrato procesado y las señales halladas. Nadie elige
              qué se analiza ni qué se publica: <strong className="text-ink">financias capacidad, no resultados</strong>.
            </p>

            <div className="mt-6 grid grid-cols-3 gap-3">
              <Mini label="contratos financiados" v={estado?.contratosFinanciados ?? 0} />
              <Mini label="destinados a auditoría" v={estado?.montoPen ?? 0} prefix="S/ " />
              <Mini label="regiones con auditoría" v={estado?.regionesConAuditoria ?? 0} />
            </div>

            <div className="mt-6">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-mute">Ranking de impacto</div>
              <RankingTable rows={ranking ?? []} compact />
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/app/financiar" className="group inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-paper transition-transform hover:scale-[1.02]">
                Financiar una auditoría <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link href="/app/financiar#independencia" className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-5 py-3 text-sm font-semibold text-ink hover:bg-paperDeep">
                <ShieldCheck size={16} /> Reglas de independencia
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-line bg-paper p-4 sm:p-6">
            {zonas ? <CampaignMap zonas={zonas} compact /> : <div className="p-10 text-center text-sm text-mute">Mapa no disponible por ahora.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function Mini({ label, v, prefix = "" }: { label: string; v: number; prefix?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <div className="font-mono text-xl font-semibold text-ink">{prefix}{v.toLocaleString("es-PE")}</div>
      <div className="text-[10px] uppercase tracking-wide text-mute">{label}</div>
    </div>
  );
}
