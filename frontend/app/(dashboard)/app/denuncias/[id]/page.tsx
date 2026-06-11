import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  CheckCircle2,
  Clock,
  Camera,
  Share2,
  GitMerge,
  ShieldAlert,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import {
  REPORTES_MOCK,
  CONVERGENCIAS_MOCK,
  ALERTAS_MOCK,
  formatSoles,
} from "@/lib/mock-data";
import { CATEGORIA_META, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { DenunciasMap } from "@/components/denuncias/DenunciasMap";

export default function DenunciaDetallePage({
  params,
}: {
  params: { id: string };
}) {
  const r = REPORTES_MOCK.find((x) => x.id === params.id);
  if (!r) notFound();

  const meta = CATEGORIA_META[r.categoria as CategoriaDenuncia];
  const Icon = meta?.icon ?? Camera;

  // Convergencias asociadas
  const convergencia = CONVERGENCIAS_MOCK.find((c) =>
    c.reporteIds.includes(r.id),
  );
  const alertaLinked = convergencia
    ? ALERTAS_MOCK.find((a) => a.id === convergencia.alertaId)
    : null;

  // Reportes cercanos (misma región + diferentes)
  const cercanos = REPORTES_MOCK.filter(
    (x) => x.id !== r.id && x.region === r.region,
  ).slice(0, 4);

  const diasDesde = (() => {
    const d = new Date(r.fecha);
    return Math.floor((Date.now() - d.getTime()) / 86_400_000);
  })();

  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <Link
        href="/app/denuncias"
        className="inline-flex items-center gap-2 text-xs font-medium text-mute hover:text-ink"
      >
        <ArrowLeft size={13} /> Volver al listado
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* MAIN */}
        <main className="space-y-6">
          {/* HERO — foto + categoria */}
          <article className="surface overflow-hidden p-0">
            {r.fotoUrl ? (
              <div className="relative h-72 sm:h-96">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.fotoUrl}
                  alt={r.descripcion}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                <div className="absolute left-5 top-5 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md ${meta?.tone}`}
                  >
                    <Icon size={12} />
                    {meta?.label ?? r.categoria}
                  </span>
                  {convergencia && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-paper">
                      <GitMerge size={11} className="text-amber" />
                      caso convergente
                    </span>
                  )}
                </div>
                <div className="absolute bottom-4 left-5 right-5 text-paper">
                  <div className="font-mono text-[10px] uppercase tracking-widest opacity-80">
                    {r.id}
                  </div>
                  <p className="mt-1 max-w-2xl text-base leading-snug">
                    {r.descripcion}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-6">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta?.tone}`}
                  >
                    <Icon size={12} />
                    {meta?.label}
                  </span>
                  <span className="rounded-full border border-line bg-paperDeep px-2 py-0.5 text-[10px] uppercase tracking-wider text-mute">
                    Sin foto
                  </span>
                </div>
                <p className="text-base leading-relaxed text-ink">
                  {r.descripcion}
                </p>
              </div>
            )}
          </article>

          {/* Meta + categoria explicación */}
          <section className="surface p-5">
            <div className="flex flex-wrap items-baseline gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
                  Sobre esta categoría
                </div>
                <h2 className="font-serif text-lg font-bold text-ink">
                  {meta?.label}
                </h2>
              </div>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-mute">
              {meta?.descripcion}
            </p>
          </section>

          {/* Si hay convergencia → bloque destacado */}
          {convergencia && alertaLinked && (
            <section className="rounded-2xl border-2 border-coal bg-coal p-6 text-paper">
              <div className="flex items-center gap-2 text-amber">
                <Sparkles size={16} />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  Caso convergente
                </span>
              </div>
              <h2 className="mt-1 font-serif text-2xl font-bold leading-tight">
                Este reporte coincide con una alerta automática del sistema.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-paper/85">
                {convergencia.resumen}
              </p>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-white/5 p-4">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-amber">
                    Alerta automática vinculada
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-paper/70">
                    {alertaLinked.codigoconvocatoria}
                  </div>
                  <div className="text-sm font-semibold">
                    {alertaLinked.objeto}
                  </div>
                  <div className="mt-1 text-xs text-paper/70">
                    Score {alertaLinked.score}/100 ·{" "}
                    {formatSoles(alertaLinked.montoSoles)}
                  </div>
                  <Link
                    href={`/alerta/${alertaLinked.id}`}
                    className="mt-3 inline-flex items-center gap-1 rounded-full bg-amber px-3 py-1.5 text-[11px] font-semibold text-coal hover:scale-[1.02]"
                  >
                    Ver dossier completo →
                  </Link>
                </div>
                <div className="rounded-xl bg-white/5 p-4 text-xs text-paper/85">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-amber">
                    Cómo se cruzaron
                  </div>
                  <ul className="mt-2 space-y-1">
                    <li>· Radio geográfico ≤ 500 m</li>
                    <li>· Ventana temporal ≤ 90 días</li>
                    <li>· Categoría coherente con la alerta</li>
                    <li>
                      · Generado por{" "}
                      <code className="rounded bg-white/10 px-1 font-mono">
                        citizen_match_agent
                      </code>
                    </li>
                  </ul>
                </div>
              </div>
            </section>
          )}

          {/* Mini-mapa de la denuncia */}
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
                  Ubicación
                </div>
                <h3 className="font-serif text-lg font-bold text-ink">
                  {r.region}
                </h3>
              </div>
              <span className="font-mono text-[10px] text-mute">
                {r.lat.toFixed(4)}, {r.lon.toFixed(4)}
              </span>
            </div>
            <DenunciasMap reportes={[r]} highlightId={r.id} />
          </section>
        </main>

        {/* SIDEBAR */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {/* ESTADO */}
          <div className="surface p-5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
              Estado de la denuncia
            </div>
            <div className="mt-2 flex items-center gap-3">
              {r.confirmado ? (
                <>
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-moss text-paper">
                    <CheckCircle2 size={22} />
                  </span>
                  <div>
                    <div className="font-serif text-lg font-bold text-moss">
                      Verificada
                    </div>
                    <div className="text-[11px] text-mute">
                      Confirmada por al menos 2 reportes independientes.
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber text-paper">
                    <Clock size={22} />
                  </span>
                  <div>
                    <div className="font-serif text-lg font-bold text-amber">
                      En validación
                    </div>
                    <div className="text-[11px] text-mute">
                      Pendiente de un segundo reporte independiente para
                      promoverse.
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* HECHOS */}
          <div className="surface overflow-hidden p-0">
            <div className="border-b border-line bg-paperDeep px-4 py-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-mute">
                Hechos clave
              </span>
            </div>
            <dl className="divide-y divide-line text-sm">
              <Row
                icon={<MapPin size={13} />}
                label="Región"
                value={r.region}
              />
              <Row
                icon={<Calendar size={13} />}
                label="Reportado"
                value={r.fecha}
                sub={`hace ${diasDesde} día${diasDesde === 1 ? "" : "s"}`}
                mono
              />
              <Row
                icon={<ShieldAlert size={13} />}
                label="Categoría"
                value={meta?.label ?? r.categoria}
              />
              <Row
                icon={<Camera size={13} />}
                label="Evidencia"
                value={r.fotoUrl ? "Con foto" : "Sin foto"}
                sub={
                  r.fotoUrl
                    ? "Pin público en el mapa"
                    : "Listado solamente — no aparece en mapa público"
                }
              />
            </dl>
          </div>

          {/* ACCIONES */}
          <div className="space-y-2">
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-line bg-paperSoft px-4 py-2.5 text-sm font-medium text-ink hover:bg-paperDeep"
            >
              <Share2 size={14} /> Compartir esta denuncia
            </button>
            <Link
              href={`/reporte/nuevo?cerca=${r.lat},${r.lon}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-rust px-4 py-2.5 text-sm font-medium text-paper hover:bg-rust/90"
            >
              <CheckCircle2 size={14} /> Yo también vi esto
            </Link>
            <p className="text-center text-[10px] text-mute">
              Si confirmás un segundo reporte cerca, este caso pasa a verificado.
            </p>
          </div>

          {/* CERCANOS */}
          {cercanos.length > 0 && (
            <div className="surface overflow-hidden p-0">
              <div className="border-b border-line bg-paperDeep px-4 py-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-mute">
                  Cercanos · {r.region}
                </span>
              </div>
              <ul className="divide-y divide-line">
                {cercanos.map((c) => {
                  const cmeta = CATEGORIA_META[c.categoria as CategoriaDenuncia];
                  const CIcon = cmeta?.icon ?? Camera;
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/app/denuncias/${c.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-paperDeep"
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cmeta?.tone}`}
                        >
                          <CIcon size={13} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-1 text-xs font-medium text-ink">
                            {c.descripcion}
                          </div>
                          <div className="font-mono text-[10px] text-mute">
                            {c.id}
                          </div>
                        </div>
                        <ExternalLink size={12} className="shrink-0 text-mute" />
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

function Row({
  icon,
  label,
  value,
  sub,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2.5 px-4 py-2.5">
      <div className="mt-0.5 text-mute">{icon}</div>
      <div className="min-w-0 flex-1">
        <dt className="text-[10px] uppercase tracking-wider text-mute">
          {label}
        </dt>
        <dd
          className={`text-sm font-medium text-ink ${mono ? "font-mono" : ""}`}
        >
          {value}
        </dd>
        {sub && <div className="text-[10px] text-mute">{sub}</div>}
      </div>
    </div>
  );
}
