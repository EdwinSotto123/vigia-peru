import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { EntidadesPanel } from "@/components/EntidadesPanel";
import { PageHeader } from "@/components/dashboard/PageHeader";
import {
  API_BASE,
  getEntidadesPagina,
  getEntidadesResumen,
  parseEntidadesQuery,
  entidadesQueryString,
  type ApiAlerta,
  type ApiEntidad,
  type EntidadesPagina,
  type EntidadesResumen,
} from "@/lib/api-client";
import { esAlertaDemo } from "@/lib/semillas";

export const metadata: Metadata = {
  title: "Entidades del Estado",
  description:
    "Municipalidades, gobiernos regionales, ministerios y empresas públicas, ordenados por cuántos de sus contratos tienen señales de riesgo.",
};

/**
 * Las 10 alertas de demo (`ALT-2026-00xx`, ver lib/semillas.ts) siguen en la
 * base y el backend las cuenta en `GET /entidades` y en `/entidades/summary`:
 * le sumaban un contrato con señales a diez entidades reales y S/ 45,7 millones
 * al monto total. Hasta que se borren, se descuentan aquí, entidad por entidad,
 * leyendo cuáles son desde la lista pública de alertas.
 */
interface Demo {
  n: number;
  monto: number;
  score: number;
}

async function alertasDemoPorEntidad(): Promise<{ demo: Map<string, Demo>; conReales: Set<string> } | null> {
  try {
    const res = await fetch(`${API_BASE}/alertas?limit=500`, { next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) return null;
    const data = ((await res.json()) as { data?: ApiAlerta[] }).data ?? [];
    const demo = new Map<string, Demo>();
    const conReales = new Set<string>();
    for (const a of data) {
      const ruc = String(a.rucEntidad ?? "");
      if (!ruc) continue;
      if (esAlertaDemo(a)) {
        const d = demo.get(ruc) ?? { n: 0, monto: 0, score: 0 };
        d.n += 1;
        d.monto += Number(a.montoSoles ?? 0);
        d.score += Number(a.score ?? 0);
        demo.set(ruc, d);
      } else if (a.codigo) {
        conReales.add(ruc);
      }
    }
    return { demo, conReales };
  } catch {
    return null;
  }
}

function descontarFila(e: ApiEntidad, d: Demo | undefined): ApiEntidad {
  if (!d) return e;
  const alertas = Math.max(0, e.alertas - d.n);
  const score = alertas > 0 ? Math.round((e.scorePromedio * e.alertas - d.score) / alertas) : 0;
  return {
    ...e,
    alertas,
    monto: Math.max(0, e.monto - d.monto),
    scorePromedio: Math.max(0, Math.min(100, score)),
    contratosVigilados: alertas,
  };
}

function descontarResumen(r: EntidadesResumen, demo: Map<string, Demo>, conReales: Set<string>): EntidadesResumen {
  let soloDemo = 0;
  let monto = 0;
  for (const [ruc, d] of demo) {
    monto += d.monto;
    if (!conReales.has(ruc)) soloDemo++;
  }
  return { ...r, conAlertas: Math.max(0, r.conAlertas - soloDemo), monto: Math.max(0, r.monto - monto) };
}

export default async function EntidadesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  // El filtro por tipo se retiró: el backend tiene `tipo` nulo en la mayoría de
  // las 2.121 entidades, así que "Gobierno regional" dejaba fuera a casi todos
  // los gobiernos regionales. El tipo se sigue MOSTRANDO, inferido del nombre.
  const query = { ...parseEntidadesQuery(searchParams), tipo: undefined };

  let pagina: EntidadesPagina | null = null;
  let resumen: EntidadesResumen | null = null;
  try {
    const [p, r, ajuste] = await Promise.all([getEntidadesPagina(query), getEntidadesResumen(), alertasDemoPorEntidad()]);
    if (ajuste) {
      pagina = { ...p, data: p.data.map((e) => descontarFila(e, ajuste.demo.get(e.ruc))) };
      resumen = descontarResumen(r, ajuste.demo, ajuste.conReales);
    }
  } catch (e) {
    console.error("[entidades] el API no respondió:", (e as Error).message);
  }

  const qs = entidadesQueryString(query);

  return (
    <div className="space-y-6 px-4 py-8 sm:px-6 lg:px-10">
      <PageHeader
        title="Entidades del Estado"
        subtitle="Ordenadas por cuántos de sus contratos tienen señales de riesgo. Toca una entidad para ver su ficha, con su ejecución presupuestal según el MEF."
      />
      {pagina && resumen ? (
        <EntidadesPanel query={query} initial={pagina} resumen={resumen} />
      ) : (
        <div className="rounded-2xl border border-dashed border-line bg-paperSoft/60 px-6 py-10 text-center">
          <span className="inline-flex text-mute" aria-hidden>
            <WifiOff size={18} />
          </span>
          <h2 className="mt-2 font-serif text-lg font-bold text-ink">No pudimos leer las entidades</h2>
          <p className="mx-auto mt-1 max-w-[60ch] text-[13.5px] leading-relaxed text-mute">
            El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento.
          </p>
          <div className="mt-4 text-sm">
            <Link href={qs ? `/app/entidades?${qs}` : "/app/entidades"} className="font-medium text-heroViolet hover:underline">
              Reintentar
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
