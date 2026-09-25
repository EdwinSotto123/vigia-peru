import type { Metadata } from "next";
import Link from "next/link";
import { Flag } from "lucide-react";
import { EntidadesPanel } from "@/components/EntidadesPanel";
import { Ayuda, EncabezadoPagina, EstadoError, Pagina } from "@/components/patrones";
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
    "Municipalidades, gobiernos regionales, ministerios y empresas públicas, ordenados por cuántos de sus contratos ya tienen dictamen publicado.",
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

  // El conteo por entidad (`alertas` del API) es de contratos con dictamen PUBLICADO, tengan
  // o no señales: un dictamen de score 0 también suma. Por eso esta página dice "con dictamen
  // publicado" y no "con señales" (DESIGN_SYSTEM.md §10.1): con la palabra vieja decía 80
  // entidades mientras /app/hallazgos, que sí cuenta señales, decía 61.
  return (
    <Pagina className="space-y-5">
      <EncabezadoPagina
        titulo="Entidades del Estado"
        bajada="Ordenadas por cuántos de sus contratos ya tienen dictamen publicado."
        ayuda={
          <Ayuda titulo="¿Qué muestra la ficha de una entidad?">
            Sus contratos con dictamen publicado, lo que se encontró en cada uno y su ejecución presupuestal según el
            MEF. &ldquo;Con dictamen publicado&rdquo; cuenta los contratos leídos y publicados, tengan o no señales.
          </Ayuda>
        }
        acciones={
          <Link
            href="/reporte/nuevo?modo=entidad"
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors duration-150 hover:border-granate/40 hover:bg-granate-50"
          >
            <Flag size={14} aria-hidden /> Denunciar una entidad
          </Link>
        }
      />
      {pagina && resumen ? (
        <EntidadesPanel query={query} initial={pagina} resumen={resumen} />
      ) : (
        <EstadoError
          titulo="No pudimos leer las entidades"
          accion={
            <Link
              href={qs ? `/app/entidades?${qs}` : "/app/entidades"}
              className="inline-flex min-h-[40px] items-center rounded-full bg-granate px-5 py-2 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-granate-deep"
            >
              Reintentar
            </Link>
          }
        >
          El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento.
        </EstadoError>
      )}
    </Pagina>
  );
}
