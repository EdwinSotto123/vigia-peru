import { Suspense } from "react";
import Link from "next/link";
import { Activity, ExternalLink } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ConvocatoriaSearch } from "@/components/convocatoria/ConvocatoriaSearch";

// useSearchParams() en ConvocatoriaSearch requiere render dinámico.
export const dynamic = "force-dynamic";

/**
 * Análisis a demanda (herramienta interna). Es la experiencia que antes vivía
 * en el "Inicio" del dashboard: pegar un código SEACE, despachar los agentes,
 * sortear una convocatoria, ver los análisis recientes. El público ya no
 * analiza a demanda: los contratos se procesan cuando alguien financia la
 * auditoría de su zona (ver /admin/procesamientos).
 */
export default function AdminAnalisisPage() {
  return (
    <AdminShell
      title="Análisis a demanda"
      subtitle="Pega un código SEACE y corre el pipeline completo, sortea uno o revisa los análisis recientes"
      actions={
        <>
          <Link
            href="/admin/procesamientos"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paperDeep"
          >
            <Activity size={12} /> Procesamiento automático
          </Link>
          <Link
            href="/app/auditoria"
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paperDeep"
          >
            <ExternalLink size={12} /> Tablero público
          </Link>
        </>
      }
    >
      <div className="mb-4 rounded-xl border border-amber/40 bg-amber-soft px-4 py-2.5 text-xs text-ink">
        Cada corrida cuesta ≈ S/ 1 y no se acredita a ningún aporte. Úsala para verificar un contrato puntual o
        para demos; la cola financiada la procesa el dispatcher solo.
      </div>
      <Suspense fallback={<div className="text-sm text-mute">Cargando…</div>}>
        <ConvocatoriaSearch />
      </Suspense>
    </AdminShell>
  );
}
