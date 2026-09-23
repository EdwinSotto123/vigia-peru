import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  MapPin,
  MapPinOff,
  Calendar,
  CheckCircle2,
  Clock,
  Camera,
  GitMerge,
  ShieldAlert,
  ChevronRight,
  WifiOff,
} from "lucide-react";
import { formatSoles } from "@/lib/formato";
import { getReporte, getReportes, getConvergencias, getAlerta, type ApiConvergencia, type ApiReporte } from "@/lib/api-client";
import { CATEGORIA_META, estaConfirmada, tieneUbicacion, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { REGIONES } from "@/lib/peru-data";
import { DenunciasMap } from "@/components/denuncias/DenunciasMap";
import { CompartirDenuncia } from "@/components/denuncias/CompartirDenuncia";
import { TextoProtegido } from "@/components/alertas/Protegido";

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  return { title: `Denuncia ${decodeURIComponent(params.id)}` };
}

/**
 * La columna es DATE: el backend la serializa como medianoche UTC
 * ("2026-04-12T00:00:00.000Z"), que en Lima cae el día ANTERIOR. Se toma sólo
 * la fecha y se fija al mediodía de Lima antes de formatear.
 */
function fechaLima(v: string | null | undefined): string | null {
  const ymd = String(v ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return new Date(`${ymd}T12:00:00-05:00`).toLocaleDateString("es-PE", {
    timeZone: "America/Lima",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function diasDesde(v: string | null | undefined): number | null {
  const ymd = String(v ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(`${ymd}T12:00:00-05:00`).getTime()) / 86_400_000));
}

/** Lo que devuelve `GET /alertas/:id`: snake_case, a diferencia de la lista. */
interface AlertaVinculada {
  codigo_convocatoria?: string | null;
  objeto?: string | null;
  score?: number | string | null;
  monto_adjudicado?: number | string | null;
}

export default async function DenunciaDetallePage({ params }: { params: { id: string } }) {
  // Antes, si el API no respondía, esta página buscaba el id en REPORTES_MOCK y
  // mostraba una denuncia inventada como si fuera real. Ahora lo dice.
  let r: ApiReporte | null = null;
  let fallo = false;
  try {
    r = await getReporte(params.id);
  } catch (e) {
    console.error("[denuncia] el API no respondió:", (e as Error).message);
    fallo = true;
  }
  if (fallo) return <NoSePudoLeer id={params.id} />;
  if (!r) notFound();
  const rep = r;

  const meta = CATEGORIA_META[rep.categoria as CategoriaDenuncia];
  const Icon = meta?.icon ?? Camera;
  const confirmada = estaConfirmada(rep);
  const conUbicacion = tieneUbicacion(rep);
  const fecha = fechaLima(rep.fecha);
  const dias = diasDesde(rep.fecha);
  const regionId = rep.region ? REGIONES.find((x) => x.nombre === rep.region)?.id : undefined;

  // Una coincidencia con un contrato sólo se muestra si existe de verdad (las 3
  // de demo ya vienen filtradas en getConvergencias). Hoy nada las genera.
  const [convs, otrasApi] = await Promise.all([
    getConvergencias().catch(() => [] as ApiConvergencia[]),
    rep.region ? getReportes({ region: rep.region, limit: 5 }).catch(() => [] as ApiReporte[]) : Promise.resolve([] as ApiReporte[]),
  ]);
  const convergencia = convs.find((c) => c.reporteIds.includes(rep.id));
  const otras = otrasApi.filter((x) => x.id !== rep.id).slice(0, 4);
  const alerta: AlertaVinculada | null = convergencia
    ? ((await getAlerta(convergencia.alertaId).catch(() => null)) as unknown as AlertaVinculada | null)
    : null;
  const codigoAlerta = alerta?.codigo_convocatoria ?? null;

  return (
    <div className="space-y-6 px-4 py-8 sm:px-6 lg:px-10">
      <Link href="/app/denuncias" className="inline-flex items-center gap-2 text-xs font-medium text-mute hover:text-ink">
        <ArrowLeft size={13} aria-hidden /> Volver a las denuncias
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <article className="space-y-6">
          <article className="surface overflow-hidden p-0">
            {rep.fotoUrl ? (
              <div className="relative h-72 sm:h-96">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={rep.fotoUrl} alt={`Foto de la denuncia ${rep.id}`} className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
                <div className="absolute left-5 top-5 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md ${meta?.tone ?? "border-line bg-paperSoft text-ink"}`}>
                    <Icon size={12} aria-hidden />
                    {meta?.label ?? "Denuncia"}
                  </span>
                  {convergencia && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-paper">
                      <GitMerge size={11} className="text-amber" aria-hidden />
                      Coincide con un contrato con señales
                    </span>
                  )}
                </div>
                <div className="absolute bottom-4 left-5 right-5 text-paper">
                  <div className="font-mono text-[11px] uppercase tracking-widest">{rep.id}</div>
                  <p className="mt-1 max-w-2xl text-base leading-snug">
                    <TextoProtegido texto={rep.descripcion ?? ""} nombres={[]} />
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta?.tone ?? "border-line bg-paperSoft text-ink"}`}>
                    <Icon size={12} aria-hidden />
                    {meta?.label ?? "Denuncia"}
                  </span>
                  <span className="rounded-full border border-line bg-paperDeep px-2 py-0.5 text-[11px] uppercase tracking-wider text-mute">
                    Sin foto
                  </span>
                  <span className="font-mono text-[11px] text-mute">{rep.id}</span>
                </div>
                <p className="text-base leading-relaxed text-ink">
                  <TextoProtegido texto={rep.descripcion ?? ""} nombres={[]} />
                </p>
              </div>
            )}
          </article>

          {meta && (
            <section className="surface p-5">
              <h2 className="font-serif text-lg font-bold text-ink">Sobre esta categoría: {meta.label.toLowerCase()}</h2>
              <p className="mt-2 text-sm leading-relaxed text-mute">{meta.descripcion}</p>
            </section>
          )}

          {convergencia && (
            <section className="rounded-2xl border-2 border-ink bg-ink p-6 text-paper">
              <div className="flex items-center gap-2 text-amber">
                <GitMerge size={16} aria-hidden />
                <span className="text-[11px] font-bold uppercase tracking-widest">Coincide con un contrato</span>
              </div>
              <h2 className="mt-1 font-serif text-2xl font-bold leading-tight">
                Esta denuncia se vinculó con un contrato que tiene señales de riesgo.
              </h2>
              {convergencia.resumen && (
                <p className="mt-2 text-sm leading-relaxed text-paper/85">{convergencia.resumen}</p>
              )}
              {alerta && codigoAlerta && (
                <div className="mt-4 rounded-xl bg-white/5 p-4">
                  <div className="font-mono text-[11px] text-paper/70">{codigoAlerta}</div>
                  {alerta.objeto && <div className="text-sm font-semibold">{alerta.objeto}</div>}
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-xs text-paper/75">
                    {alerta.score != null && <span>Puntaje de riesgo {Number(alerta.score)} de 100</span>}
                    {alerta.monto_adjudicado != null && Number.isFinite(Number(alerta.monto_adjudicado)) && (
                      <span className="font-mono">{formatSoles(Number(alerta.monto_adjudicado))}</span>
                    )}
                  </div>
                  <Link
                    href={`/app/convocatoria/${encodeURIComponent(codigoAlerta)}`}
                    className="mt-3 inline-flex items-center gap-1 rounded-full bg-amber px-3 py-1.5 text-[12px] font-semibold text-ink transition-transform duration-200 hover:scale-[1.02]"
                  >
                    Ver el dossier del contrato <ChevronRight size={12} aria-hidden />
                  </Link>
                </div>
              )}
            </section>
          )}

          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-lg font-bold text-ink">
                Ubicación{rep.region ? `: ${rep.region}` : ""}
              </h2>
              {conUbicacion && (
                <span className="font-mono text-[11px] text-mute">
                  {Number(rep.lat).toFixed(4)}, {Number(rep.lon).toFixed(4)}
                </span>
              )}
            </div>
            {conUbicacion ? (
              <DenunciasMap reporte={{ lat: rep.lat, lon: rep.lon, categoria: rep.categoria, region: rep.region }} />
            ) : (
              <p className="surface flex items-start gap-2 p-4 text-sm text-mute">
                <MapPinOff size={15} className="mt-0.5 shrink-0" aria-hidden />
                Quien denunció no marcó un punto en el mapa{rep.region ? `; sólo indicó la región (${rep.region})` : ""}.
              </p>
            )}
          </section>
        </article>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="surface p-5">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-mute">Estado de la denuncia</h2>
            <div className="mt-2 flex items-center gap-3">
              {confirmada ? (
                <>
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-moss text-paper">
                    <CheckCircle2 size={22} aria-hidden />
                  </span>
                  <div>
                    <div className="font-serif text-lg font-bold text-mossTexto">Confirmada</div>
                    <div className="text-[12px] text-mute">
                      La respaldan {rep.confirmaciones} reportes independientes del mismo lugar.
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-paperDeep text-mute">
                    <Clock size={22} aria-hidden />
                  </span>
                  <div>
                    <div className="font-serif text-lg font-bold text-ink">Sin confirmar</div>
                    <div className="text-[12px] text-mute">
                      La respalda un solo reporte. Figura como confirmada cuando la respaldan dos o más reportes
                      independientes del mismo lugar.
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="surface overflow-hidden p-0">
            <div className="border-b border-line bg-paperDeep px-4 py-2.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-mute">Datos de la denuncia</h2>
            </div>
            <dl className="divide-y divide-line text-sm">
              {rep.region && <Row icon={<MapPin size={13} />} label="Región" value={rep.region} />}
              {fecha && (
                <Row
                  icon={<Calendar size={13} />}
                  label="Reportada el"
                  value={fecha}
                  sub={dias == null ? undefined : dias === 0 ? "hoy" : `hace ${dias} día${dias === 1 ? "" : "s"}`}
                />
              )}
              <Row icon={<ShieldAlert size={13} />} label="Categoría" value={meta?.label ?? "Sin categoría"} />
              <Row icon={<Camera size={13} />} label="Foto" value={rep.fotoUrl ? "Con foto" : "Sin foto"} />
              <Row
                icon={conUbicacion ? <MapPin size={13} /> : <MapPinOff size={13} />}
                label="Punto en el mapa"
                value={conUbicacion ? "Marcado por quien denunció" : "No se marcó"}
              />
            </dl>
          </div>

          <div className="space-y-2">
            <CompartirDenuncia id={rep.id} titulo={`${meta?.label ?? "Denuncia ciudadana"} en Vigía Perú`} />
            {conUbicacion && (
              <Link
                href={`/app/mapa?${regionId ? `region=${regionId}&` : ""}tab=denuncias`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-paperDeep"
              >
                <MapPin size={14} aria-hidden /> Verla en el mapa
              </Link>
            )}
          </div>

          {otras.length > 0 && rep.region && (
            <div className="surface overflow-hidden p-0">
              <div className="border-b border-line bg-paperDeep px-4 py-2.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-widest text-mute">Otras denuncias en {rep.region}</h2>
              </div>
              <ul className="divide-y divide-line">
                {otras.map((c) => {
                  const cmeta = CATEGORIA_META[c.categoria as CategoriaDenuncia];
                  const CIcon = cmeta?.icon ?? Camera;
                  return (
                    <li key={c.id}>
                      <Link href={`/app/denuncias/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-paperDeep">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cmeta?.tone ?? "bg-paperSoft text-ink"}`}>
                          <CIcon size={13} aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-1 text-xs font-medium text-ink">
                            <TextoProtegido texto={c.descripcion ?? ""} nombres={[]} />
                          </div>
                          <div className="font-mono text-[11px] text-mute">{c.id}</div>
                        </div>
                        <ChevronRight size={12} className="shrink-0 text-mute" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function NoSePudoLeer({ id }: { id: string }) {
  return (
    <div className="space-y-6 px-4 py-8 sm:px-6 lg:px-10">
      <Link href="/app/denuncias" className="inline-flex items-center gap-2 text-xs font-medium text-mute hover:text-ink">
        <ArrowLeft size={13} aria-hidden /> Volver a las denuncias
      </Link>
      <div className="rounded-2xl border border-dashed border-line bg-paperSoft/60 px-6 py-10 text-center">
        <span className="inline-flex text-mute" aria-hidden><WifiOff size={18} /></span>
        <h1 className="mt-2 font-serif text-lg font-bold text-ink">No pudimos leer esta denuncia</h1>
        <p className="mx-auto mt-1 max-w-[60ch] text-[13.5px] leading-relaxed text-mute">
          El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento.
        </p>
        <div className="mt-4 text-sm">
          <Link href={`/app/denuncias/${encodeURIComponent(id)}`} className="font-medium text-heroViolet hover:underline">
            Reintentar
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex gap-2.5 px-4 py-2.5">
      <div className="mt-0.5 text-mute" aria-hidden>{icon}</div>
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] uppercase tracking-wider text-mute">{label}</dt>
        <dd className="text-sm font-medium text-ink">{value}</dd>
        {sub && <div className="text-[11px] text-mute">{sub}</div>}
      </div>
    </div>
  );
}
