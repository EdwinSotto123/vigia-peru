import Link from "next/link";
import { ArrowRight, MapPin, Layers, Activity, AlertTriangle, Camera } from "lucide-react";
import { CampaignMap } from "@/components/financiar/CampaignMap";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { getEstadoGlobal, getZonas, ESTADO_FILL } from "@/lib/financiamiento";
import { getResumenProcesamientos } from "@/lib/auditoria";

/**
 * Sección "el mapa es la interfaz" (server component). Va justo después del
 * hero: tres cifras reales (cola, procesados hoy, señales), el mapa por estado
 * de auditoría y las regiones con más contratos esperando. Un solo destino:
 * /app/mapa, donde cada región abre su panel con financiar/denunciar.
 */
export async function MapaHubSection() {
  const [zonas, estado, resumen] = await Promise.all([
    getZonas("departamento"),
    getEstadoGlobal(),
    getResumenProcesamientos(),
  ]);

  const colaGlobal = estado?.colaGlobal ?? (zonas ?? []).reduce((n, z) => n + z.totalCola, 0);
  const procesadosHoy = resumen?.procesadosHoy ?? estado?.procesadosHoy ?? 0;
  const senales = estado?.senalesHalladas ?? (zonas ?? []).reduce((n, z) => n + z.senales, 0);
  const enProceso = resumen?.porEstado?.procesando ?? 0;

  const topCola = [...(zonas ?? [])]
    .filter((z) => z.totalCola > 0)
    .sort((a, b) => b.totalCola - a.totalCola)
    .slice(0, 6);

  return (
    <section id="mapa" className="scroll-mt-20 border-b border-line bg-paper py-20">
      <div className="container-page">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-paperSoft px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-clay">
            <MapPin size={11} /> El mapa es la interfaz
          </div>
          <h2 className="font-serif text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-6xl">
            El Estado publica todo.
            <br />
            <span className="text-rust">Nadie lee nada.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-mute sm:text-lg">
            Cada región tiene contratos públicos esperando ser leídos. Elige la tuya: verás cuántos hay en cola,
            qué señales de riesgo ya se hallaron, y podrás <strong className="text-ink">financiar su auditoría</strong> o{" "}
            <strong className="text-ink">denunciar una obra</strong> desde el mismo mapa.
          </p>
        </div>

        {/* KPIs reales */}
        <div className="mx-auto mt-10 grid max-w-4xl gap-3 sm:grid-cols-3">
          <Kpi
            icon={<Layers size={14} />}
            value={colaGlobal}
            label="contratos en cola"
            hint="esperan que alguien financie su lectura"
            tone="text-ink"
          />
          <Kpi
            icon={<Activity size={14} />}
            value={procesadosHoy}
            label="procesados hoy"
            hint={enProceso > 0 ? `${enProceso} analizándose ahora mismo` : "el dispatcher procesa en orden de llegada"}
            tone="text-moss"
            live={enProceso > 0}
          />
          <Kpi
            icon={<AlertTriangle size={14} />}
            value={senales}
            label="señales de riesgo halladas"
            hint="cada una cita norma y fuente oficial"
            tone="text-rust"
          />
        </div>

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-[1.15fr_1fr]">
          {/* Mapa (clic → hub) */}
          <Link
            href="/app/mapa"
            className="group relative block rounded-3xl border border-line bg-paperSoft p-4 transition-shadow hover:shadow-paper sm:p-6"
            aria-label="Abrir el mapa interactivo"
          >
            {zonas && zonas.length > 0 ? (
              <CampaignMap zonas={zonas} compact />
            ) : (
              <div className="p-10 text-center text-sm text-mute">Mapa no disponible por ahora.</div>
            )}
            <span className="pointer-events-none absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[11px] font-semibold text-paper opacity-90 transition-transform group-hover:translate-x-0.5">
              Abrir el mapa <ArrowRight size={12} />
            </span>
          </Link>

          {/* Regiones con más cola + acciones */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-line bg-paperSoft p-5">
              <div className="flex items-baseline justify-between">
                <h3 className="font-serif text-lg font-bold text-ink">Regiones con más contratos esperando</h3>
                <span className="font-mono text-[11px] text-mute">{estado?.regionesConCola ?? topCola.length} con cola</span>
              </div>
              {topCola.length > 0 ? (
                <ul className="mt-3 divide-y divide-line">
                  {topCola.map((z) => {
                    const regionId = UBIGEO_REGION[z.ubigeo];
                    const href = regionId ? `/app/mapa?region=${regionId}` : `/financiar/${z.ubigeo}`;
                    const pct = z.totalCola > 0 ? Math.min(100, Math.round((z.financiados / z.totalCola) * 100)) : 0;
                    return (
                      <li key={z.ubigeo}>
                        <Link href={href} className="group flex items-center gap-3 py-2.5 transition-colors hover:text-clay">
                          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ESTADO_FILL[z.estado] }} />
                          <span className="flex-1 text-sm font-medium text-ink group-hover:text-clay">{z.nombre}</span>
                          <span className="hidden w-24 sm:block">
                            <span className="block h-1 overflow-hidden rounded-full bg-paperDeep">
                              <span className="block h-full rounded-full bg-amber" style={{ width: `${pct}%` }} />
                            </span>
                          </span>
                          <span className="font-mono text-xs text-mute">
                            {z.financiados}/{z.totalCola.toLocaleString("es-PE")}
                          </span>
                          <ArrowRight size={13} className="shrink-0 text-mute opacity-0 transition-opacity group-hover:opacity-100" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-mute">
                  Aún no hay contratos en cola. La ingesta diaria del OECE está arrancando.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/app/mapa"
                className="group inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-paper transition-transform hover:scale-[1.02]"
              >
                <MapPin size={16} /> Explorar el mapa
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/reporte/nuevo"
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-5 py-3 text-sm font-semibold text-ink hover:bg-paperDeep"
              >
                <Camera size={16} className="text-rust" /> Denunciar una obra
              </Link>
            </div>
            <p className="text-[11px] leading-relaxed text-mute">
              Señales de riesgo, no acusaciones. Nadie elige qué contrato se analiza ni qué se publica.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Kpi({
  icon,
  value,
  label,
  hint,
  tone,
  live,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  hint: string;
  tone: string;
  live?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-line bg-paperSoft p-5">
      <div className="flex items-center justify-between text-mute">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-paper">{icon}</span>
        {live && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-moss">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-moss" /> en vivo
          </span>
        )}
      </div>
      <div className={`mt-3 font-serif text-4xl font-bold leading-none ${tone}`}>{value.toLocaleString("es-PE")}</div>
      <div className="mt-1.5 text-sm font-medium text-ink">{label}</div>
      <div className="mt-0.5 text-[11px] text-mute">{hint}</div>
    </div>
  );
}
