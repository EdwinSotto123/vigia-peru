import { AlertTriangle, WifiOff } from "lucide-react";
import { AlertasLista } from "@/components/alertas/AlertasLista";
import { FiltrosAlertas } from "@/components/alertas/FiltrosAlertas";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { PulseDot } from "@/components/ui/PulseDot";
import { getAlertasPagina, type ApiAlerta } from "@/lib/api-client";
import { parseAlertasQuery } from "@/lib/alertas-query";

export const metadata = {
  title: "Alertas — Vigía Perú",
  description: "Señales de riesgo publicadas por el motor de Vigía, filtrables por región, estado y score.",
};

const TAM = 24;

/**
 * /app/alertas — lista completa y paginada (antes: un lote fijo de 12 sin filtros ni
 * paginación real). Mismo patrón que /app/contratos: el server component resuelve
 * `searchParams` a una query tipada, pide la página al API y se la pasa a AlertasLista
 * junto con los links de paginación (`navegacion="url"`).
 */
export default async function AlertasPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { pagina, ...query } = parseAlertasQuery(searchParams);

  let data: ApiAlerta[] = [];
  let total = 0;
  let source: "api" | "mock" = "api";
  try {
    const r = await getAlertasPagina({ ...query, limit: TAM, offset: (pagina - 1) * TAM });
    data = r.data;
    total = r.total;
  } catch (e) {
    console.error("[alertas page] API falló:", (e as Error).message);
    data = [];
    total = 0;
    source = "mock";
  }

  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <PageHeader
        title="Señales de riesgo detectadas"
        subtitle="Ordenadas por score de riesgo. Click cualquier alerta para ver el dossier completo con red de personas y fuentes."
        actions={
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest " +
              (source === "api"
                ? "border-moss/40 bg-moss/10 text-moss"
                : "border-amber/40 bg-amber-soft text-amber")
            }
          >
            {/* Mismo indicador "en vivo" que TableroAuditoria/ContratoEnVivo/PanelProcesamiento
                (PulseDot) en vez de un ícono de nube estático — el badge dice "live" pero antes
                no tenía el mismo lenguaje visual pulsante que el resto del sitio usa para eso. */}
            {source === "api" ? <PulseDot color="moss" size={6} /> : <WifiOff size={11} />}
            {source === "api" ? "live · Cloud SQL" : "mock (API caída)"}
          </span>
        }
      />
      <FiltrosAlertas query={query} />
      <AlertasLista data={data} total={total} pagina={pagina} tam={TAM} query={query} fallo={source === "mock"} />
    </div>
  );
}
