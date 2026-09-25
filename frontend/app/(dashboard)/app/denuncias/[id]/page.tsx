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
} from "lucide-react";
import { solesCompacto } from "@/lib/formato";
import { maskDnis } from "@/lib/privacidad";
import { getReporte, getReportes, getConvergencias, getAlerta, type ApiConvergencia, type ApiReporte } from "@/lib/api-client";
import { CATEGORIA_META, estaConfirmada, tieneUbicacion, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { REGIONES } from "@/lib/peru-data";
import { DenunciasMap } from "@/components/denuncias/DenunciasMap";
import { fechaDeDenuncia, haceCuantoSeReporto } from "@/components/denuncias/fechaDenuncia";
import { TextoProtegido } from "@/components/alertas/Protegido";
import { Severidad } from "@/components/ui/Severidad";
import { BarraCompartir, Ayuda, EncabezadoPagina, EstadoError, Pagina } from "@/components/patrones";

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  return { title: `Denuncia ${decodeURIComponent(params.id)}` };
}

/** Tarjeta en reposo del sistema: borde sobre papel, sin sombra. */
const TARJETA = "rounded-2xl border border-line bg-paper";

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
  const fecha = fechaDeDenuncia(rep.fecha);
  const cuando = haceCuantoSeReporto(rep.fecha);
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
    <Pagina>
      <Link href="/app/denuncias" className="inline-flex min-h-[24px] items-center gap-2 text-[13px] font-medium text-inkSoft hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Volver a las denuncias
      </Link>

      <EncabezadoPagina
        titulo={`${meta?.label ?? "Denuncia ciudadana"}${rep.region ? ` en ${rep.region}` : ""}`}
        bajada={
          <>
            {fecha ? `Reportada el ${fecha}` : "Sin fecha de reporte"} · código{" "}
            <span className="font-mono text-[13px]" translate="no">{rep.id}</span>. Es el testimonio de un vecino, no un
            hallazgo de Vigía.
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <article className="space-y-6">
          <div className={`${TARJETA} overflow-hidden`}>
            {rep.fotoUrl ? (
              <div className="relative h-72 sm:h-96">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={rep.fotoUrl} alt={`Foto de la denuncia ${rep.id}`} className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/75 via-ink/15 to-transparent" aria-hidden />
                <div className="absolute left-5 top-5 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md ${meta?.tone ?? "border-line bg-paperSoft text-ink"}`}>
                    <Icon size={12} aria-hidden />
                    {meta?.label ?? "Denuncia"}
                  </span>
                  {convergencia && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-paper">
                      <GitMerge size={11} className="text-maiz" aria-hidden />
                      Coincide con un contrato con señales
                    </span>
                  )}
                </div>
                <div className="absolute bottom-4 left-5 right-5 text-paper">
                  <p className="max-w-2xl text-base leading-snug">
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
                  <span className="rounded-full border border-line bg-paperDeep px-2 py-0.5 text-[11px] font-medium text-inkSoft">
                    Sin foto
                  </span>
                </div>
                <p className="text-base leading-relaxed text-ink">
                  <TextoProtegido texto={rep.descripcion ?? ""} nombres={[]} />
                </p>
              </div>
            )}
          </div>

          {convergencia && (
            // Sección de dato sobre tinta: acento maíz y `sobre-oscuro` para que el foco se vea.
            <section className="sobre-oscuro rounded-2xl bg-ink p-6 text-paper">
              <h2 className="flex items-start gap-2 font-display text-xl font-bold leading-tight sm:text-2xl">
                <GitMerge size={20} className="mt-1 shrink-0 text-maiz" aria-hidden />
                Esta denuncia coincide con un contrato que tiene señales
              </h2>
              {convergencia.resumen && (
                <p className="mt-2 text-sm leading-relaxed text-paper/75">{convergencia.resumen}</p>
              )}
              {alerta && codigoAlerta && (
                <div className="mt-4 rounded-xl bg-paper/5 p-4">
                  <div className="font-mono text-[11px] text-paper/75" translate="no">{codigoAlerta}</div>
                  {alerta.objeto && <div className="text-sm font-semibold">{alerta.objeto}</div>}
                  {/* El peso del riesgo en palabras, sin el puntaje suelto: el número sólo se
                      muestra junto a las señales que lo explican, y esas viven en el dossier. */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-paper/75">
                    {alerta.score != null && Number.isFinite(Number(alerta.score)) && (
                      <Severidad score={Number(alerta.score)} formato="pastilla" />
                    )}
                    {alerta.monto_adjudicado != null && Number.isFinite(Number(alerta.monto_adjudicado)) && (
                      <span className="font-mono tabular-nums">Adjudicado por {solesCompacto(Number(alerta.monto_adjudicado))}</span>
                    )}
                  </div>
                  <Link
                    href={`/app/convocatoria/${encodeURIComponent(codigoAlerta)}`}
                    className="mt-3 inline-flex min-h-[36px] items-center gap-1 rounded-full bg-paper px-4 py-1.5 text-[13px] font-semibold text-granate transition-colors duration-rapido hover:bg-maiz-soft"
                  >
                    Ver el dossier del contrato <ChevronRight size={12} aria-hidden />
                  </Link>
                </div>
              )}
            </section>
          )}

          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-bold text-ink">
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
              <p className={`${TARJETA} flex items-start gap-2 p-4 text-sm text-inkSoft`}>
                <MapPinOff size={15} className="mt-0.5 shrink-0" aria-hidden />
                Quien denunció no marcó un punto en el mapa{rep.region ? `; sólo indicó la región (${rep.region})` : ""}.
              </p>
            )}
          </section>
        </article>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {/* El estado como chip + una línea; cuándo se confirma, a un clic (§10.7). */}
          <div className={`${TARJETA} p-4`}>
            <h2 className="text-xs font-semibold text-mute">Estado de la denuncia</h2>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              {confirmada ? (
                <span className="pill border-moss/30 bg-moss/10 font-semibold text-mossTexto">
                  <CheckCircle2 size={12} aria-hidden /> Confirmada
                </span>
              ) : (
                <span className="pill border-line bg-paperDeep text-inkSoft">
                  <Clock size={12} aria-hidden /> Sin confirmar
                </span>
              )}
              <span className="text-[13px] text-inkSoft">
                {confirmada
                  ? `La respaldan ${rep.confirmaciones} reportes independientes del mismo lugar.`
                  : "La respalda un solo reporte."}
              </span>
              <Ayuda titulo="¿Cuándo se confirma una denuncia?">
                Figura como confirmada cuando la respaldan dos o más reportes independientes del mismo lugar. Nadie la
                edita antes de publicarla.
              </Ayuda>
            </p>
          </div>

          <div className={`${TARJETA} overflow-hidden`}>
            <div className="border-b border-line bg-paperSoft px-4 py-2.5">
              <h2 className="text-xs font-semibold text-mute">Datos de la denuncia</h2>
            </div>
            <dl className="divide-y divide-line text-sm">
              {rep.region && <Row icon={<MapPin size={13} />} label="Región" value={rep.region} />}
              {fecha && (
                <Row
                  icon={<Calendar size={13} />}
                  label="Reportada el"
                  value={fecha}
                  sub={cuando && cuando !== fecha ? cuando : undefined}
                />
              )}
              <Row
                icon={<ShieldAlert size={13} />}
                label="Categoría"
                value={meta?.label ?? "Sin categoría"}
                ayuda={
                  meta ? (
                    <Ayuda titulo={`¿Qué es «${meta.label.toLowerCase()}»?`}>{meta.descripcion}</Ayuda>
                  ) : undefined
                }
              />
              <Row icon={<Camera size={13} />} label="Foto" value={rep.fotoUrl ? "Con foto" : "Sin foto"} />
              <Row
                icon={conUbicacion ? <MapPin size={13} /> : <MapPinOff size={13} />}
                label="Punto en el mapa"
                value={conUbicacion ? "Marcado por quien denunció" : "No se marcó"}
              />
            </dl>
          </div>

          <div className="space-y-2">
            <BarraCompartir compacto ruta={`/app/denuncias/${rep.id}`} titulo={`${meta?.label ?? "Denuncia ciudadana"} en Vigía Perú`} texto={`${meta?.label ?? "Denuncia ciudadana"} en Vigía Perú`} />
            {conUbicacion && (
              <Link
                href={`/app/mapa?${regionId ? `region=${regionId}&` : ""}tab=denuncias`}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
              >
                <MapPin size={16} aria-hidden /> Verla en el mapa
              </Link>
            )}
          </div>

          {otras.length > 0 && rep.region && (
            <div className={`${TARJETA} overflow-hidden`}>
              <div className="border-b border-line bg-paperSoft px-4 py-2.5">
                <h2 className="text-xs font-semibold text-mute">Otras denuncias en {rep.region}</h2>
              </div>
              <ul className="divide-y divide-line">
                {otras.map((c) => {
                  const cmeta = CATEGORIA_META[c.categoria as CategoriaDenuncia];
                  const CIcon = cmeta?.icon ?? Camera;
                  return (
                    <li key={c.id}>
                      <Link href={`/app/denuncias/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-rapido hover:bg-paperSoft">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${cmeta?.tone ?? "border-line bg-paperSoft text-ink"}`}>
                          <CIcon size={13} aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          {/* Dentro de un enlace no cabe el vidrio revelable (sería un botón dentro de un <a>): DNI tapado sin más. */}
                          <div className="line-clamp-1 text-xs font-medium text-ink">{maskDnis(c.descripcion)}</div>
                          <div className="font-mono text-[11px] text-mute" translate="no">{c.id}</div>
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
    </Pagina>
  );
}

function NoSePudoLeer({ id }: { id: string }) {
  return (
    <Pagina>
      <Link href="/app/denuncias" className="inline-flex min-h-[24px] items-center gap-2 text-[13px] font-medium text-inkSoft hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Volver a las denuncias
      </Link>
      <EncabezadoPagina titulo="Denuncia ciudadana" />
      <EstadoError
        titulo="No pudimos leer esta denuncia"
        accion={
          <Link href={`/app/denuncias/${encodeURIComponent(id)}`} className="text-sm font-semibold text-granate underline-offset-2 hover:underline">
            Reintentar
          </Link>
        }
      >
        El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento.
      </EstadoError>
    </Pagina>
  );
}

function Row({
  icon,
  label,
  value,
  sub,
  ayuda,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  /** `<Ayuda>` ya armado, junto al valor. */
  ayuda?: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5 px-4 py-2.5">
      <div className="mt-0.5 text-mute" aria-hidden>{icon}</div>
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-mute">{label}</dt>
        <dd className="flex items-center gap-1 text-sm font-medium text-ink">
          {value}
          {ayuda}
        </dd>
        {sub && <div className="text-[11px] text-mute">{sub}</div>}
      </div>
    </div>
  );
}
