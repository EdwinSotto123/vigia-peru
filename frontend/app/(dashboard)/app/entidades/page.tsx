import { Building2, Cloud } from "lucide-react";
import { EntidadesPanel } from "@/components/EntidadesPanel";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { PulseDot } from "@/components/ui/PulseDot";
import {
  ENTIDADES_PAGE_SIZE,
  getEntidadesPagina,
  getEntidadesResumen,
  parseEntidadesQuery,
  type ApiEntidad,
  type EntidadesPagina,
  type EntidadesQuery,
  type EntidadesResumen,
} from "@/lib/api-client";
import { ENTIDADES, type Entidad } from "@/lib/mock-entities";

/** Mock → forma ApiEntidad, para que el fallback tenga el mismo tipo que la API real. */
function mockToApi(e: Entidad): ApiEntidad {
  return {
    ruc: e.ruc,
    nombre: e.nombre,
    tipo: e.tipo,
    region: e.region,
    provincia: e.provincia ?? null,
    distrito: e.distrito ?? null,
    pliegoNombreMef: null,
    alertas: e.alertas,
    monto: e.monto,
    scorePromedio: e.scorePromedio,
    reportes: e.reportes,
    contratos: e.contratos,
    contratosVigilados: e.contratosVigilados,
    serie: e.serie,
  };
}

/** Mismo filtro (q/tipo) que antes hacía el panel en el cliente, ahora aplicado al mock y ya
 *  paginado — para que el modo degradado (API caída) siga respetando la búsqueda y la página. */
function paginarMock(query: EntidadesQuery): EntidadesPagina {
  const q = (query.q ?? "").trim().toLowerCase();
  const filtered = ENTIDADES.filter((e) => {
    if (query.tipo && e.tipo !== query.tipo) return false;
    if (!q) return true;
    return (
      e.nombre.toLowerCase().includes(q) ||
      e.ruc.includes(q) ||
      e.region.toLowerCase().includes(q) ||
      (e.provincia ?? "").toLowerCase().includes(q)
    );
  });
  const sorted = [...filtered].sort((a, b) => b.alertas - a.alertas);
  const page = Math.max(1, query.page ?? 1);
  const start = (page - 1) * ENTIDADES_PAGE_SIZE;
  return {
    data: sorted.slice(start, start + ENTIDADES_PAGE_SIZE).map(mockToApi),
    total: filtered.length,
    page,
    size: ENTIDADES_PAGE_SIZE,
  };
}

function resumenMock(): EntidadesResumen {
  return {
    totalEntidades: ENTIDADES.length,
    conAlertas: ENTIDADES.filter((e) => e.alertas > 0).length,
    monto: ENTIDADES.reduce((s, e) => s + e.monto, 0),
  };
}

export default async function EntidadesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const query = parseEntidadesQuery(searchParams);
  let pagina: EntidadesPagina;
  let resumen: EntidadesResumen;
  let source: "api" | "mock" = "api";
  try {
    [pagina, resumen] = await Promise.all([getEntidadesPagina(query), getEntidadesResumen()]);
  } catch (e) {
    console.error("[entidades page] API falló, uso mock:", (e as Error).message);
    source = "mock";
    pagina = paginarMock(query);
    resumen = resumenMock();
  }

  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <PageHeader
        eyebrow="Ranking de entidades"
        icon={<Building2 size={11} className="text-heroViolet" />}
        title="Gobiernos regionales y municipios"
        subtitle="Ordenados por riesgo. Click cualquier entidad para ver perfil completo con ejecución MEF y proveedores."
        actions={
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest " +
              (source === "api"
                ? "border-moss/40 bg-moss/10 text-moss"
                : "border-amber/40 bg-amber-soft text-amber")
            }
          >
            {/* Mismo indicador "en vivo" que TableroAuditoria/ContratoEnVivo/PanelProcesamiento/
                /app/alertas (PulseDot) — el badge decía "live" pero mostraba un ícono de nube
                estático en vez del mismo lenguaje visual pulsante que el resto del sitio usa
                para datos que se refrescan solos. */}
            {source === "api" ? <PulseDot color="moss" size={6} /> : <Cloud size={11} />}
            {source === "api" ? "live · Cloud SQL" : "mock"}
          </span>
        }
      />
      <EntidadesPanel query={query} initial={pagina} resumen={resumen} />
    </div>
  );
}
