import { Suspense } from "react";
import Link from "next/link";
import { Activity, ExternalLink } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ConvocatoriaSearch } from "@/components/convocatoria/ConvocatoriaSearch";
// Import directo (no el índice del kit): esta página es server component y solo usa piezas sin funciones.
import { Aviso } from "@/components/admin/ui/ErrorBanner";
import { SkeletonPanel } from "@/components/admin/ui/Skeleton";
import { claseBoton } from "@/components/admin/ui/boton";

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
      subtitle="Pega un código SEACE y corre el análisis completo, sortea uno o revisa los recientes"
      actions={
        <>
          <Link href="/admin/procesamientos" className={claseBoton("secundario")}>
            <Activity size={12} aria-hidden /> Procesamiento automático
          </Link>
          <Link href="/app/auditoria" target="_blank" className={claseBoton("secundario")}>
            <ExternalLink size={12} aria-hidden /> Tablero público
          </Link>
        </>
      }
    >
      <div className="space-y-6">
        <Aviso tono="warn" titulo="Cada corrida cuesta ≈ S/ 1 y no se acredita a ningún aporte">
          Úsala para verificar un contrato puntual o para demos. La cola financiada se procesa sola.
        </Aviso>
        <Suspense fallback={<SkeletonPanel lineas={4} />}>
          {/* Sólo un booleano (nunca una función): esta página es server component. */}
          <ConvocatoriaSearch enPanel />
        </Suspense>
      </div>
    </AdminShell>
  );
}
